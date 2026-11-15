import './buffer-shim';
import * as git from 'isomorphic-git';
import type { GitLocation } from './tree';

interface Version {
  paths: Map<string, string>;
  parents: string[];
}

/**
 * Plain files have no persistent document identity. Follow continuous paths
 * and unambiguous content moves; never expand a historical alias globally.
 */
export async function traceGitPaths(
  location: GitLocation,
  commits: readonly string[],
  targets: readonly string[],
  seeds: readonly { path: string; blobOid: string }[] = [],
) {
  const versions = new Map<string, Version>(),
    edges = new Map<string, Set<string>>();
  const ambiguous = new Map<string, string>();
  const renameWarnings = new Map<string, string>();
  const chunks = new Map<
    string,
    Promise<{ length: number; counts: Map<string, number> }>
  >();
  const spans = (oid: string) => {
    let value = chunks.get(oid);
    if (!value) {
      value = git.readBlob({ ...location, oid }).then(({ blob }) => {
        const counts = new Map<string, number>();
        let span = '';
        const flush = () => {
          if (span) counts.set(span, (counts.get(span) ?? 0) + 1);
          span = '';
        };
        for (const byte of blob) {
          span += String.fromCharCode(byte);
          if (byte === 10 || span.length === 64) flush();
        }
        flush();
        return { length: blob.length, counts };
      });
      chunks.set(oid, value);
    }
    return value;
  };
  const similarity = async (a: string, b: string) => {
    const [source, target] = await Promise.all([spans(a), spans(b)]);
    if (!source.length || !target.length)
      return source.length === target.length ? 1 : 0;
    let shared = 0;
    for (const [span, count] of source.counts)
      shared += span.length * Math.min(count, target.counts.get(span) ?? 0);
    return shared / Math.max(source.length, target.length);
  };
  const key = (oid: string, path: string) => `${oid}\0${path}`;
  const connect = (a: string, b: string) => {
    if (!edges.has(a)) edges.set(a, new Set());
    if (!edges.has(b)) edges.set(b, new Set());
    edges.get(a)!.add(b);
    edges.get(b)!.add(a);
  };
  const load = async (oid: string): Promise<Version> => {
    const cached = versions.get(oid);
    if (cached) return cached;
    const paths = new Map<string, string>();
    const visit = async (oid: string, prefix: string) => {
      for (const entry of (await git.readTree({ ...location, oid })).tree) {
        if (entry.type === 'tree')
          await visit(entry.oid, `${prefix}${entry.path}/`);
        else if (entry.type === 'blob')
          paths.set(prefix + entry.path, entry.oid);
      }
    };
    await visit(oid, '');
    const value = {
      paths,
      parents: (await git.readCommit({ ...location, oid })).commit.parent,
    };
    versions.set(oid, value);
    return value;
  };
  for (const oid of commits) await load(oid);
  for (const [oid, child] of versions)
    for (const parentOid of child.parents) {
      const parent = await load(parentOid);
      for (const path of child.paths.keys())
        if (parent.paths.has(path))
          connect(key(oid, path), key(parentOid, path));
      const added = new Map<string, string[]>(),
        removed = new Map<string, string[]>();
      for (const [path, blob] of child.paths)
        if (!parent.paths.has(path))
          added.set(blob, [...(added.get(blob) ?? []), path]);
      for (const [path, blob] of parent.paths)
        if (!child.paths.has(path))
          removed.set(blob, [...(removed.get(blob) ?? []), path]);
      for (const [blob, additions] of added) {
        const deletions = removed.get(blob) ?? [];
        if (!deletions.length) continue;
        if (additions.length === 1 && deletions.length === 1)
          connect(key(oid, additions[0]!), key(parentOid, deletions[0]!));
        else {
          const message = `Ambiguous rename history at ${oid}: ${[...deletions, ...additions].join(', ')}`;
          for (const path of additions) ambiguous.set(key(oid, path), message);
          for (const path of deletions)
            ambiguous.set(key(parentOid, path), message);
        }
      }
      let unmatchedAdditions = [...added]
        .filter(([blob]) => !removed.has(blob))
        .flatMap(([, paths]) => paths);
      let unmatchedDeletions = [...removed]
        .filter(([blob]) => !added.has(blob))
        .flatMap(([, paths]) => paths);
      const scores = new Map<string, number>();
      for (const addition of unmatchedAdditions)
        for (const deletion of unmatchedDeletions)
          scores.set(
            `${addition}\0${deletion}`,
            await similarity(
              child.paths.get(addition)!,
              parent.paths.get(deletion)!,
            ),
          );
      const matchedAdditions = new Set<string>(),
        matchedDeletions = new Set<string>();
      for (const addition of unmatchedAdditions) {
        const candidates = unmatchedDeletions.map((deletion) => ({
          deletion,
          score: scores.get(`${addition}\0${deletion}`)!,
        }));
        const maximum = Math.max(
          0,
          ...candidates.map((candidate) => candidate.score),
        );
        const best = candidates.filter(
          (candidate) => candidate.score === maximum,
        );
        if (maximum < 0.5 || best.length !== 1) continue;
        const deletion = best[0]!.deletion;
        const reverse = unmatchedAdditions.filter(
          (other) => scores.get(`${other}\0${deletion}`) === maximum,
        );
        const reverseMaximum = Math.max(
          ...unmatchedAdditions.map((other) =>
            scores.get(`${other}\0${deletion}`)!,
          ),
        );
        if (reverseMaximum !== maximum || reverse.length !== 1) continue;
        connect(key(oid, addition), key(parentOid, deletion));
        matchedAdditions.add(addition);
        matchedDeletions.add(deletion);
        const warning = `Content similarity identified rename ${deletion} → ${addition} (${Math.floor(maximum * 100)}%) at ${oid}`;
        renameWarnings.set(key(oid, addition), warning);
        renameWarnings.set(key(parentOid, deletion), warning);
      }
      unmatchedAdditions = unmatchedAdditions.filter(
        (path) => !matchedAdditions.has(path),
      );
      unmatchedDeletions = unmatchedDeletions.filter(
        (path) => !matchedDeletions.has(path),
      );
      if (unmatchedAdditions.length && unmatchedDeletions.length) {
        const message = `Cannot safely trace a possible modified rename at ${oid}: ${[...unmatchedDeletions, ...unmatchedAdditions].join(', ')}`;
        for (const path of unmatchedAdditions)
          ambiguous.set(key(oid, path), message);
        for (const path of unmatchedDeletions)
          ambiguous.set(key(parentOid, path), message);
      }
    }
  let head: string | undefined;
  try {
    head = await git.resolveRef({ ...location, ref: 'HEAD' });
  } catch {
    /* Empty history. */
  }
  const nearest = (path: string) => {
    if (!head) return [];
    let queue = [head];
    const seen = new Set<string>();
    while (queue.length) {
      const found = queue.filter((oid) => versions.get(oid)?.paths.has(path));
      if (found.length) return found.map((oid) => key(oid, path));
      const next: string[] = [];
      for (const oid of queue) {
        if (seen.has(oid)) continue;
        seen.add(oid);
        next.push(
          ...(versions.get(oid)?.parents ?? []).filter(
            (parent) => !seen.has(parent),
          ),
        );
      }
      queue = [...new Set(next)];
    }
    return [];
  };
  const selected = new Set<string>(),
    blocked = new Set<string>();
  for (const path of targets) {
    const anchors = seeds.filter((seed) => seed.path === path);
    const groups = anchors.length
      ? anchors.map((anchor) =>
          [...versions]
            .filter(([, version]) => version.paths.get(path) === anchor.blobOid)
            .map(([oid]) => key(oid, path)),
        )
      : [nearest(path)];
    if (
      anchors.length &&
      groups.some((group) => !group.length) &&
      [...versions.values()].some((version) => version.paths.has(path))
    )
      blocked.add(
        'Cannot determine the historical identity of the deleted file: ' + path,
      );
    for (const seeds of groups) {
      const component = new Set<string>();
      const visit = (seed: string) => {
        const queue = [seed];
        for (let at = 0; at < queue.length; at++) {
          const node = queue[at]!;
          if (component.has(node)) continue;
          component.add(node);
          if (ambiguous.has(node)) blocked.add(ambiguous.get(node)!);
          for (const neighbor of edges.get(node) ?? [])
            if (!component.has(neighbor)) queue.push(neighbor);
        }
      };
      if (seeds[0]) visit(seeds[0]);
      if (seeds.some((seed) => !component.has(seed)))
        blocked.add('Ambiguous merged file history: ' + path);
      component.forEach((node) => selected.add(node));
    }
  }
  const pathsByCommit: Record<string, string[]> = {};
  for (const node of selected) {
    const separator = node.indexOf('\0'),
      oid = node.slice(0, separator),
      path = node.slice(separator + 1);
    (pathsByCommit[oid] ??= []).push(path);
  }
  return {
    pathsByCommit,
    blocked: [...blocked],
    warnings: [
      ...new Set(
        [...selected].flatMap((node) => renameWarnings.get(node) ?? []),
      ),
    ],
  };
}
