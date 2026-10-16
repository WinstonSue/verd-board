const svgBox = {
  x: 0,
  y: 0,
  width: 100,
  height: 20,
  top: 0,
  right: 100,
  bottom: 20,
  left: 0,
};

if (typeof SVGElement !== 'undefined') {
  if (typeof SVGElement.prototype.getBBox !== 'function') {
    SVGElement.prototype.getBBox = function getBBox() {
      return { ...svgBox };
    };
  }
  if (typeof SVGElement.prototype.getComputedTextLength !== 'function') {
    SVGElement.prototype.getComputedTextLength = function getComputedTextLength() {
      return this.textContent?.length ?? 0;
    };
  }
  if (typeof SVGElement.prototype.getTotalLength !== 'function') {
    SVGElement.prototype.getTotalLength = function getTotalLength() {
      return 100;
    };
  }
  if (typeof SVGElement.prototype.getPointAtLength !== 'function') {
    SVGElement.prototype.getPointAtLength = function getPointAtLength(
      length: number,
    ) {
      return { x: length, y: 0 };
    };
  }
}

if (
  typeof SVGGraphicsElement !== 'undefined' &&
  typeof SVGGraphicsElement.prototype.getTotalLength !== 'function'
) {
  SVGGraphicsElement.prototype.getTotalLength = function getTotalLength() {
    return 100;
  };
}

if (typeof SVGPathElement !== 'undefined') {
  if (typeof SVGPathElement.prototype.getTotalLength !== 'function') {
    SVGPathElement.prototype.getTotalLength = function getTotalLength() {
      return 100;
    };
  }
  if (typeof SVGPathElement.prototype.getPointAtLength !== 'function') {
    SVGPathElement.prototype.getPointAtLength = function getPointAtLength(
      length: number,
    ) {
      return { x: length, y: 0 };
    };
  }
}

if (typeof HTMLElement !== 'undefined') {
  if (typeof HTMLElement.prototype.getBBox !== 'function') {
    Object.defineProperty(HTMLElement.prototype, 'getBBox', {
      configurable: true,
      value() {
        return { ...svgBox };
      },
    });
  }
}
