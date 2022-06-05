/* globals
PIXI,
foundry
*/

"use strict";

/* Additions to the PIXI.Rectangle class:
- getCenter: center point of the rectangle
- toPolygon: convert to a PIXI.Polygon
- containsPoint: if the point is within epsilon of the rectangle, return true
*/

// reminder:
// bottom = y + height
// right = x + width

/**
 * Locate the center of the rectangle
 * @return {Point}
 */
function getCenter() {
  return new PIXI.Point(this.x + (this.width / 2), this.y + (this.height / 2));
}

/**
 * Convert to closed PIXI.Polygon, where each corner is a vertex.
 * Ordered clockwise from top left corner.
 * @return {PIXI.Polygon}
 */
function toPolygon() {
  /* eslint-disable indent */
  const out = new PIXI.Polygon(this.x, this.y,
                               this.right, this.y,
                               this.right, this.bottom,
                               this.x, this.bottom,
                               this.x, this.y);
  /* eslint-enable indent */
  out._isClockwise = true;
  out._isConvex = true;
  out._isClosed = true;
  return out;
}

/**
 * Is this point contained by the rectangle?
 * Default PIXI.Rectangle.prototype.contains is problematic, in that it just compares
 * using "<", so points on the west and south edges are not included and points very
 * near an edge may or may not be included.
 * @param {Point} p
 * @param {number} e  Some permitted epsilon, by default 1e-8
 * @returns {boolean} Is the point contained by or on the edge of the rectangle?
 */
function containsPoint(p, e = 1e-8) {
  // Follow how contains method handles this
  if (this.width <= 0 || this.height <= 0) { return false; }

  const x_inside = (p.x > this.x && p.x < this.right) || p.x.almostEqual(this.x, e) || p.x.almostEqual(this.right, e);
  if (!x_inside) return false;

  // Y inside
  return (p.y > this.y && p.y < this.bottom) || p.y.almostEqual(this.y, e) || p.y.almostEqual(this.bottom, e);
}

/**
 * Does this rectangle overlap another?
 * @param {PIXI.Rectangle} other
 * @return {Boolean}
 */
function overlapsRectangle(other) {
  // https://www.geeksforgeeks.org/find-two-rectangles-overlap
  // One rectangle is completely above the other
  if ( this.top > other.bottom || other.top > this.bottom ) return false;

  // One rectangle is completely to the left of the other
  if ( this.left > other.right || other.left > this.right ) return false;

  return true;
}

/**
 * Does this rectangle overlap a circle?
 * @param {PIXI.Circle} circle
 * @return {Boolean}
 */
function overlapsCircle(circle) {
  // https://www.geeksforgeeks.org/check-if-any-point-overlaps-the-given-circle-and-rectangle
  // {xn,yn} is the nearest point on the rectangle to the circle center
  const xn = Math.max(this.right, Math.min(circle.x, this.left));
  const yn = Math.max(this.top, Math.min(circle.y, this.bottom));

  // Find the distance between the nearest point and the center of the circle
  const dx = xn - circle.x;
  const dy = yn - circle.y;
  return (Math.pow(dx, 2) + Math.pow(dy, 2)) <= Math.pow(circle.radius, 2);
}

/**
 * Does this rectangle overlap a polygon?
 * @param {PIXI.Polygon} poly
 * @return {Boolean}
 */
function overlapsPolygon(poly) {
  if ( poly.contains(this.left, this.top)
    || poly.contains(this.right, this.top)
    || poly.contains(this.left, this.bottom)
    || poly.contains(this.right, this.bottom)) { return true; }

  for ( const edge of poly.iterateEdges() ) {
    if ( this.lineSegmentIntersects(edge.A, edge.B)
      || this.containsPoint(edge.A)
      || this.containsPoint(edge.B)) { return true; }
  }
  return false;
}

/**
 * Is this segment contained by or intersects the rectangle?
 * @param {Segment} s   Object with {A: {x, y}, B: {x, y}} coordinates.
 * @param {Number}  e   Permitted epsilon. Default: 1e-8.
 * @return {Boolean} Is the segment contained by or intersects the rectangle?
 */
function encountersSegment(s, e = 1e-8) {
  if (this.containsPoint(s.A, e) || this.containsPoint(s.B, e)) return true;

  // Point are both outside the rectangle. Only true if the segment intersects.
  return this.lineSegmentIntersects(s.A, s.B);
}

/**
 * Pad rectangle to contain given point
 * @param {Point} p
 */
function padToPoint(p) {
  const horiz = Math.max(0, p.x > this.x ? (p.x - this.right) : (this.x - p.x));
  const vert  = Math.max(0, p.y > this.y ? (p.y - this.bottom) : (this.y - p.y)); // eslint-disable-line no-multi-spaces
  this.pad(horiz, vert);
}

/**
 * Helper methods to track whether a segment intersects an edge.
 */
function _intersectsTop(a, b) {
  return foundry.utils.lineSegmentIntersects(a, b,
    { x: this.x, y: this.y },
    { x: this.right, y: this.y });
}

function _intersectionTop(a, b) {
  return foundry.utils.lineSegmentIntersection(a, b,
    { x: this.x, y: this.y },
    { x: this.right, y: this.y });
}

function _intersectsRight(a, b) {
  return foundry.utils.lineSegmentIntersects(a, b,
    { x: this.right, y: this.y },
    { x: this.right, y: this.bottom });
}

function _intersectionRight(a, b) {
  return foundry.utils.lineSegmentIntersection(a, b,
    { x: this.right, y: this.y },
    { x: this.right, y: this.bottom });
}

function _intersectsBottom(a, b) {
  return foundry.utils.lineSegmentIntersects(a, b,
    { x: this.right, y: this.bottom },
    { x: this.x, y: this.bottom });
}

function _intersectionBottom(a, b) {
  return foundry.utils.lineSegmentIntersection(a, b,
    { x: this.right, y: this.bottom },
    { x: this.x, y: this.bottom });
}

function _intersectsLeft(a, b) {
  return foundry.utils.lineSegmentIntersects(a, b,
    { x: this.x, y: this.bottom },
    { x: this.x, y: this.y });
}

function _intersectionLeft(a, b) {
  return foundry.utils.lineSegmentIntersection(a, b,
    { x: this.x, y: this.bottom },
    { x: this.x, y: this.y });
}


/**
 * Use the Cohen-Sutherland algorithm approach to split a rectangle into zones:
 *          left    central   right
 * top      1001    1000      1010
 * central  0001    0000      0010
 * bottom   0101    0100      0110
 * https://en.wikipedia.org/wiki/Cohen%E2%80%93Sutherland_algorithm
 */
const rectZones = {
  INSIDE: 0x0000,
  LEFT: 0x0001,
  RIGHT: 0x0010,
  TOP: 0x1000,
  BOTTOM: 0x0100,
  TOPLEFT: 0x1001,
  TOPRIGHT: 0x1010,
  BOTTOMRIGHT: 0x0110,
  BOTTOMLEFT: 0x0101
};

/**
 * Get the rectZone for a given x,y point located around or in a rectangle.
 *
 * @param {Point} p
 * @return {Integer}
 */
function _zone(p) {
  let code = rectZones.INSIDE;
  if ( p.x < this.x ) {
    code |= rectZones.LEFT;
  } else if ( p.x > this.right ) {
    code |= rectZones.RIGHT;
  }

  if ( p.y < this.y ) {
    code |= rectZones.TOP;
  } else if ( p.y > this.bottom ) {
    code |= rectZones.BOTTOM;
  }
  return code;
}

function lineSegmentIntersects(a, b) {
  const zone_a = this._zone(a);
  const zone_b = this._zone(b);

  if ( !(zone_a | zone_b) ) { return false; } // Bitwise OR is 0: both points inside rectangle.
  if ( zone_a & zone_b ) { return false; } // Bitwise AND is not 0: both points share outside zone
  // LEFT, RIGHT, TOP, BOTTOM

  if ( !zone_a || !zone_b ) { return true; } // Regular OR: One point inside, one outside

  // Line likely intersects, but some possibility that the line starts at, say,
  // center left and moves to center top which means it may or may not cross the
  // rectangle
  switch ( zone_a ) {
    case rectZones.LEFT: return this._intersectsLeft(a, b);
    case rectZones.RIGHT: return this._intersectsRight(a, b);
    case rectZones.BOTTOM: return this._intersectsBottom(a, b);
    case rectZones.TOP: return this._intersectsTop(a, b);

    case rectZones.TOPLEFT: return this._intersectsTop(a, b) || this._intersectsLeft(a, b);
    case rectZones.TOPRIGHT: return this._intersectsTop(a, b) || this._intersectsRight(a, b);
    case rectZones.BOTTOMLEFT: return this._intersectsBottom(a, b) || this._intersectsLeft(a, b);
    case rectZones.BOTTOMRIGHT: return this._intersectsBottom(a, b) || this._intersectsRight(a, b);
  }
}

function lineSegmentIntersection(a, b) {
  const zone_a = this._zone(a);
  const zone_b = this._zone(b);

  if ( !(zone_a | zone_b) ) { return null; } // Bitwise OR is 0: both points inside rectangle.
  if ( zone_a & zone_b ) { return null; } // Bitwise AND is not 0: both points share outside zone

  switch ( zone_a ) {
    case rectZones.LEFT: return this._intersectionLeft(a, b);
    case rectZones.RIGHT: return this._intersectionRight(a, b);
    case rectZones.BOTTOM: return this._intersectionBottom(a, b);
    case rectZones.TOP: return this._intersectionTop(a, b);

    case rectZones.TOPLEFT: return this._intersectionTop(a, b) || this._intersectionLeft(a, b);
    case rectZones.TOPRIGHT: return this._intersectionTop(a, b) || this._intersectionRight(a, b);
    case rectZones.BOTTOMLEFT: return this._intersectionBottom(a, b) || this._intersectionLeft(a, b);
    case rectZones.BOTTOMRIGHT: return this._intersectionBottom(a, b) || this._intersectionRight(a, b);
  }


}


/**
 * From PIXI.js mathextras
 * https://pixijs.download/dev/docs/packages_math-extras_src_rectangleExtras.ts.html
 * If the area of the intersection between the Rectangles `other` and `this` is not zero,
 * returns the area of intersection as a Rectangle object. Otherwise, return an empty Rectangle
 * with its properties set to zero.
 * Rectangles without area (width or height equal to zero) can't intersect or be intersected
 * and will always return an empty rectangle with its properties set to zero.
 *
 * _Note: Only available with **@pixi/math-extras**._
 *
 * @method intersects
 * @memberof PIXI.Rectangle#
 * @param {Rectangle} other - The Rectangle to intersect with `this`.
 * @param {Rectangle} [outRect] - A Rectangle object in which to store the value,
 * optional (otherwise will create a new Rectangle).
 * @returns {Rectangle} The intersection of `this` and `other`.
 */
function rectangleIntersection(other, outRect) {
  const x0 = this.x < other.x ? other.x : this.x;
  const x1 = this.right > other.right ? other.right : this.right;

  if (!outRect) { outRect = new PIXI.Rectangle(); }

  if (x1 <= x0) {
    outRect.x = outRect.y = outRect.width = outRect.height = 0;
    return outRect;
  }

  const y0 = this.y < other.y ? other.y : this.y;
  const y1 = this.bottom > other.bottom ? other.bottom : this.bottom;
  if (y1 <= y0) {
    outRect.x = outRect.y = outRect.width = outRect.height = 0;
    return outRect;
  }

  outRect.x = x0;
  outRect.y = y0;
  outRect.width = x1 - x0;
  outRect.height = y1 - y0;

  return outRect;
}

/**
 * Translate a rectangle, shifting it in the x and y direction.
 * (Basic but useful b/c it is equivalent to polygon.translate)
 * @param {Number} delta_x  Movement in the x direction.
 * @param {Number} delta_y  Movement in the y direction.
 */
function translate(delta_x, delta_y) {
  this.x += delta_x;
  this.y += delta_y;
}


// ----------------  ADD METHODS TO THE PIXI.RECTANGLE PROTOTYPE ------------------------
export function registerPIXIRectangleMethods() {

  Object.defineProperty(PIXI.Rectangle.prototype, "getCenter", {
    value: getCenter,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "toPolygon", {
    value: toPolygon,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "containsPoint", {
    value: containsPoint,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "encountersSegment", {
    value: encountersSegment,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "padToPoint", {
    value: padToPoint,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "lineSegmentIntersects", {
    value: lineSegmentIntersects,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "lineSegmentIntersection", {
    value: lineSegmentIntersection,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "_intersectsTop", {
    value: _intersectsTop,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "_intersectsBottom", {
    value: _intersectsBottom,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "_intersectsLeft", {
    value: _intersectsLeft,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "_intersectsRight", {
    value: _intersectsRight,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "_intersectionTop", {
    value: _intersectionTop,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "_intersectionBottom", {
    value: _intersectionBottom,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "_intersectionLeft", {
    value: _intersectionLeft,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "_intersectionRight", {
    value: _intersectionRight,
    writable: true,
    configurable: true
  });


  Object.defineProperty(PIXI.Rectangle.prototype, "_zone", {
    value: _zone,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "intersection", {
    value: rectangleIntersection,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "overlapsPolygon", {
    value: overlapsPolygon,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "overlapsRectangle", {
    value: overlapsRectangle,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "overlapsCircle", {
    value: overlapsCircle,
    writable: true,
    configurable: true
  });

  // For equivalence with a PIXI.Polygon
  if ( !Object.hasOwn(PIXI.Rectangle.prototype, "isClosed") ) {
    Object.defineProperty(PIXI.Rectangle.prototype, "isClosed", {
      get: () => true
    });
  }

  Object.defineProperty(PIXI.Rectangle.prototype, "translate", {
    value: translate,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "getBounds", {
    value: () => this,
    writable: true,
    configurable: true
  });
}
