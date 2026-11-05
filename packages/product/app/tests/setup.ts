// JSDOM lacks a native fullscreen matcher. nwsapi 2.2.27 delegates this
// selector back to Element.matches, recursively reentering its own matcher
// when Floating UI checks the editor's computed styles.
if (typeof Element !== 'undefined') {
  const matches = Element.prototype.matches;
  Element.prototype.matches = function (selector: string) {
    if (selector === ':fullscreen')
      return this.ownerDocument.fullscreenElement === this;
    return matches.call(this, selector);
  };
}
