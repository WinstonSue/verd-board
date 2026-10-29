// Isolate Mermaid's DOM-dependent parsers from the caller's globals.
import { parentPort, workerData } from 'node:worker_threads';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
async function run() {
  try {
    const { parseMermaidToUmlFrame } =
      await import('@sue/board-mermaid-to-board');
    parentPort.postMessage({
      snapshot: await parseMermaidToUmlFrame(
        workerData.source,
        workerData.scene,
      ),
    });
  } catch (error) {
    parentPort.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    dom.window.close();
    parentPort.close();
  }
}
void run();
