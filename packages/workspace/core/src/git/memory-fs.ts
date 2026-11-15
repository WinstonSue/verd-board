/** A disposable fs overlay. Hosts publish its bytes in their own transaction. */
export class GitMemoryFs {
  readonly files: Map<string, Uint8Array> = new Map();
  readonly directories = new Set<string>(['/']);
  constructor(files: Iterable<readonly [string, Uint8Array]> = []) {
    for (const [path, content] of files) this.put(path, content);
  }
  private path(input: string) {
    const parts: string[] = [];
    for (const part of input.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return '/' + parts.join('/');
  }
  private error(code: string, path: string): never {
    throw Object.assign(new Error(`${code}: ${path}`), { code });
  }
  put(input: string, content: Uint8Array) {
    const path = this.path(input);
    const parts = path.split('/').slice(1, -1);
    let parent = '';
    for (const part of parts) {
      parent += '/' + part;
      this.directories.add(parent);
    }
    // Buffer.slice() is a view over a pooled allocation. Always own a compact
    // Uint8Array so publishing .buffer to IndexedDB preserves the exact bytes.
    this.files.set(path, new Uint8Array(content));
  }
  exportFiles(prefix: string): Map<string, Uint8Array> {
    const start = this.path(prefix) + '/';
    return new Map(
      [...this.files]
        .filter(([path]) => path.startsWith(start))
        .map(([path, bytes]) => [path.slice(start.length), bytes.slice()]),
    );
  }
  readonly promises = {
    readFile: async (
      input: string,
      options?: string | { encoding?: string },
    ): Promise<string | Uint8Array> => {
      const path = this.path(input),
        bytes = this.files.get(path);
      if (!bytes) return this.error('ENOENT', path);
      return typeof options === 'string' || options?.encoding
        ? new TextDecoder().decode(bytes)
        : bytes.slice();
    },
    writeFile: async (input: string, data: string | Uint8Array) => {
      const path = this.path(input),
        parent = path.slice(0, path.lastIndexOf('/')) || '/';
      if (!this.directories.has(parent)) this.error('ENOENT', parent);
      this.put(
        path,
        typeof data === 'string' ? new TextEncoder().encode(data) : data,
      );
    },
    unlink: async (input: string) => {
      const path = this.path(input);
      if (!this.files.delete(path)) this.error('ENOENT', path);
    },
    readdir: async (input: string) => {
      const path = this.path(input);
      if (!this.directories.has(path)) this.error('ENOENT', path);
      const prefix = path === '/' ? '/' : path + '/';
      return [
        ...new Set(
          [...this.files.keys(), ...this.directories]
            .filter((key) => key.startsWith(prefix) && key !== path)
            .map((key) => key.slice(prefix.length).split('/')[0]!),
        ),
      ].sort();
    },
    mkdir: async (
      input: string,
      options?: number | { recursive?: boolean },
    ) => {
      const path = this.path(input);
      if (this.directories.has(path)) {
        if (typeof options === 'object' && options.recursive) return;
        this.error('EEXIST', path);
      }
      const parent = path.slice(0, path.lastIndexOf('/')) || '/';
      if (
        !this.directories.has(parent) &&
        !(typeof options === 'object' && options.recursive)
      )
        this.error('ENOENT', parent);
      const parts = path.split('/').slice(1);
      let current = '';
      for (const part of parts) {
        current += '/' + part;
        this.directories.add(current);
      }
    },
    rmdir: async (input: string) => {
      const path = this.path(input);
      if (
        [...this.files.keys(), ...this.directories].some((key) =>
          key.startsWith(path + '/'),
        )
      )
        this.error('ENOTEMPTY', path);
      if (!this.directories.delete(path)) this.error('ENOENT', path);
    },
    stat: async (input: string) => this.stat(input),
    lstat: async (input: string) => this.stat(input),
    readlink: async (input: string): Promise<string> =>
      this.error('EINVAL', input),
    symlink: async (_target: string, input: string): Promise<void> =>
      this.error('ENOTSUP', input),
    chmod: async (_input: string, _mode: number) => {},
  };
  private stat(input: string) {
    const path = this.path(input),
      file = this.files.get(path),
      directory = this.directories.has(path);
    if (!file && !directory) this.error('ENOENT', path);
    let stamp = 0x811c9dc5;
    for (const byte of file ?? [])
      stamp = Math.imul(stamp ^ byte, 0x01000193) >>> 0;
    return {
      size: file?.length ?? 0,
      mode: directory ? 0o040755 : 0o100644,
      mtimeMs: stamp,
      ctimeMs: stamp,
      atimeMs: 0,
      birthtimeMs: 0,
      uid: 0,
      gid: 0,
      ino: 0,
      dev: 0,
      isFile: () => !!file,
      isDirectory: () => directory,
      isSymbolicLink: () => false,
    };
  }
}
