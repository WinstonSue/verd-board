const path = require('node:path');

/** Playwright does not await asynchronous test callbacks before calling onEnd. */
class SerializedRemoteReporter {
  constructor(options, Reporter) {
    const implementation =
      Reporter ?? require(process.env.REMOTE_TEST_REPORTER);
    this.delegate = new implementation(options);
    this.pending = Promise.resolve();
  }
  enqueue(method, args) {
    this.pending = this.pending.then(() => this.delegate[method]?.(...args));
    // Keep callback failures observable by onEnd without unhandled rejections.
    this.pending.catch(() => {});
    return this.pending;
  }
  onBegin(...args) {
    return this.enqueue('onBegin', args);
  }
  onTestEnd(...args) {
    return this.enqueue('onTestEnd', args);
  }
  onError(...args) {
    return this.enqueue('onError', args);
  }
  onEnd(...args) {
    return this.enqueue('onEnd', args);
  }
  printsToStdio() {
    return this.delegate.printsToStdio?.() ?? false;
  }
}

module.exports = SerializedRemoteReporter;
module.exports.reporterPath = path.resolve(__filename);
