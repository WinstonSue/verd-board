// The ESM build of isomorphic-git expects Buffer, including inside Web Workers.
// The trailing slash selects the browser package instead of Node's builtin.
import { Buffer } from 'buffer/';
const runtime = globalThis as unknown as { Buffer?: unknown };
if (runtime.Buffer === undefined) runtime.Buffer = Buffer;
