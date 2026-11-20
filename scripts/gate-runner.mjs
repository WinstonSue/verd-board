import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function writeRecord(file, record) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(record, null, 2) + '\n');
  await fs.rename(temporary, file);
}

/** Continue independent checks; never execute a node whose prerequisite failed. */
export async function collectStages(
  plan,
  { update = async () => {}, checkpoint = async () => {} } = {},
) {
  const seen = new Set();
  for (const node of plan) {
    if (seen.has(node.id)) throw new Error('Duplicate gate stage: ' + node.id);
    for (const id of node.dependsOn ?? [])
      if (!seen.has(id))
        throw new Error('Missing or unordered gate dependency: ' + id);
    seen.add(node.id);
  }
  const stages = [];
  let fatal;
  let updates = Promise.resolve();
  const runNode = async (node) => {
    if (stages.some((stage) => stage.id === node.id))
      throw new Error('Duplicate gate stage: ' + node.id);
    const dependencies = node.dependsOn ?? [];
    for (const id of dependencies)
      if (!stages.some((stage) => stage.id === id))
        throw new Error('Missing or unordered gate dependency: ' + id);
    const blockedBy = dependencies.filter(
      (id) => stages.find((stage) => stage.id === id).status !== 'passed',
    );
    const stage = {
      id: node.id,
      dependsOn: dependencies,
      status: 'blocked',
      startedAt: new Date().toISOString(),
    };
    stages.push(stage);
    if (fatal || blockedBy.length) {
      stage.blockedBy = blockedBy;
      stage.error =
        fatal ?? 'Prerequisites did not pass: ' + blockedBy.join(', ');
    } else {
      const started = performance.now();
      try {
        await node.run(stage);
        stage.status = 'passed';
        stage.exitCode = 0;
      } catch (error) {
        stage.status = 'failed';
        stage.exitCode = error.exitCode ?? 1;
        stage.error = error.message;
        if (
          error.fatal ||
          ['SIGINT', 'SIGTERM', 'SIGKILL'].includes(error.signal)
        )
          fatal = error.message;
      }
      stage.durationMs = Math.round(performance.now() - started);
      try {
        await checkpoint();
      } catch (error) {
        fatal = error.message;
        stage.status = 'failed';
        stage.commandExitCode = stage.exitCode;
        stage.exitCode = 1;
        stage.error = error.message;
      }
    }
    stage.finishedAt = new Date().toISOString();
    updates = updates.then(() => update(stages));
    await updates;
    console.log(
      `[gate:stage] ${stage.id}: ${stage.status}${stage.error ? ' — ' + stage.error : ''}`,
    );
  };
  // Only explicitly grouped unit nodes share a pool. Builds and GUI stages
  // remain sequential, and package workers keep the existing CPU budget.
  for (let index = 0; index < plan.length;) {
    const node = plan[index];
    const width = node.pool ? node.concurrency : 1;
    if (!Number.isInteger(width) || width < 1)
      throw new Error('Invalid gate concurrency: ' + node.id);
    let end = index + 1;
    while (
      node.pool &&
      end < plan.length &&
      end - index < width &&
      plan[end].pool === node.pool &&
      !(plan[end].dependsOn ?? []).some((id) =>
        plan.slice(index, end).some((entry) => entry.id === id),
      )
    )
      end++;
    await Promise.all(plan.slice(index, end).map(runNode));
    index = end;
  }
  return {
    status: stages.every((stage) => stage.status === 'passed')
      ? 'passed'
      : 'failed',
    stages,
    ...(fatal ? { error: fatal } : {}),
  };
}

export function assertStagesPassed(result) {
  if (
    result.status !== 'passed' ||
    result.stages.some((stage) => stage.status !== 'passed')
  ) {
    const failed = result.stages.filter((stage) => stage.status !== 'passed');
    throw Object.assign(
      new Error(
        'Gate failed; return to the repair owner:\n' +
          failed
            .map((stage) => `${stage.id}: ${stage.status}: ${stage.error}`)
            .join('\n'),
      ),
      { exitCode: 1, stages: failed },
    );
  }
}
