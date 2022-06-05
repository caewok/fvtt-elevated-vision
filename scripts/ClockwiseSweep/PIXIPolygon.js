/* globals
PIXI,
foundry,
*/

"use strict";

import { ClipperLib } from "./clipper_unminified.js";

/* Additions to the PIXI.Polygon class:
Getters:
- isClosed: Are the points closed (first and last points are same)?
- isConvex: Is the polygon convex?
- isClockwise: Are the points in clockwise or counterclockwise order?

Generators:
- iteratePoints: iterator for the polygon points.

Methods:
- close: Close the polygon (if not already)
- reverse: Reverse point order
- getBounds: Bounding rectangle for the polygon
- getCenter: Center of the polygon, based on its bounding rectangle center.
- scale: change each point by (pt - position) / size and return new polygon
- unscale: change each point by (pt * size) + position and return new polygon

Static methods:
- fromPoints: Construct from array of {x, y} points.

Helper methods:
- determineConvexity: Measure if the polygon is convex.
- determineOrientation: Measure the orientation of the polygon
*/

/**
 * Construct a new PIXI.Polygon from an array of x,y point objects.
 * @param {Points[]}  points
 * @return {PIXI.Polygon}
 */
function fromPoints(points) {
  // Flat map is slow: const out = new this(points.flatMap(pt => [pt.x, pt.y]));
  // Switch to for loop. https://jsbench.me/eeky2ei5rw
  const pts = [];
  for (const pt of points) {
    pts.push(pt.x, pt.y);
  }
  const out = new this(...pts);
  out.close();
  return out;
}

/**
 * Iterate over the polygon's {x, y} points in order.
 * If the polygon is closed and close is false,
 * the last two points (which should equal the first two points) will be dropped.
 * Otherwise, all points will be returned regardless of the close value.
 * @return {x, y} PIXI.Point
 */
function* iteratePoints({close = true} = {}) {
  const dropped = (!this.isClosed || close) ? 0 : 2;
  const ln = this.points.length - dropped;
  for (let i = 0; i < ln; i += 2) {
    yield new PIXI.Point(this.points[i], this.points[i + 1]);
  }
}

/**
 * Iterate over the polygon's edges in order.
 * If the polygon is closed and close is false,
 * the last two points (which should equal the first two points) will be dropped and thus
 * the final edge closing the polygon will be ignored.
 * Otherwise, all edges, including the closing edge, will be returned regardless of the
 * close value.
 * @return Return an object { A: {x, y}, B: {x, y}} for each edge
 * Edges link, such that edge0.B === edge.1.A.
 */
function* iterateEdges({close = true} = {}) {
  // Very similar to iteratePoints
  const dropped = (!this.isClosed || close) ? 0 : 2;
  const iter = this.points.length - dropped - 2;
  for (let i = 0; i < iter; i += 2) {
    yield { A: { x: this.points[i], y: this.points[i + 1] },       // eslint-disable-line indent
            B: { x: this.points[i + 2], y: this.points[i + 3] } }; // eslint-disable-line indent
  }
}

/**
 * Getter to store the coordinate point set.
 */
function coordinates() {
  return [...this.iteratePoints({close: false})];
}

/**
 * Is the polygon open or closed?
 * @return {boolean}  True if closed.
 */
function isClosed() {
  if (typeof this._isClosed === "undefined") {
    const ln = this.points.length;
    if (ln < 2) return undefined;

    this._isClosed =    this.points[0].almostEqual(this.points[ln - 2])  // eslint-disable-line no-multi-spaces
                     && this.points[1].almostEqual(this.points[ln - 1]);
  }
  return this._isClosed;
}

/**
 * Close the polygon by adding the first point to the end.
 */
function close() {
  if (typeof this.isClosed === "undefined" || this.isClosed) return;
  this.points.push(this.points[0], this.points[1]);
  this._isClosed = true;
}

/**
 * Open the polygon by removing the first point from the end.
 */
function open() {
  if (!this.isClosed || this.points.length < 4) return;
  this.points.pop();
  this.points.pop();
  this._isClosed = false;
}

/**
 * Is the polygon convex?
 * https://stackoverflow.com/questions/40738013/how-to-determine-the-type-of-polygon
 * If you already know the polygon convexity, you should set this._isConvex manually.
 */
function isConvex() {
  if (typeof this._isConvex === "undefined") {
    this._isConvex = this.determineConvexity();
  }
  return this._isConvex;
}


/**
 * Measure the polygon convexity
 * https://stackoverflow.com/questions/40738013/how-to-determine-the-type-of-polygon
 * Check sign of the cross product for triplet points.
 * Must all be +  or all - to be convex.
 * WARNING: Will not work if the polygon is complex
 * (meaning it intersects itself, forming 2+ smaller polygons)
 */
function determineConvexity() {
  if (!this.isClosed) {
    console.warn("Convexity is not defined for open polygons.");
    return undefined;
  }

  // If a closed triangle, then always convex (2 coords / pt * 3 pts + repeated pt)
  if (this.points.length === 8) return true;

  const iter = this.iteratePoints();
  let prev_pt = iter.next().value;
  let curr_pt = iter.next().value;
  let next_pt = iter.next().value;
  let new_pt;

  const sign = Math.sign(foundry.utils.orient2dFast(prev_pt, curr_pt, next_pt));

  // If polygon is a triangle, while loop should be skipped and will always return true
  while ( (new_pt = iter.next().value) ) {
    prev_pt = curr_pt;
    curr_pt = next_pt;
    next_pt = new_pt;
    const new_sign = Math.sign(foundry.utils.orient2dFast(prev_pt, curr_pt, next_pt));

    if (sign !== new_sign) return false;
  }
  return true;
}

/**
 * Determine if a polygon is oriented clockwise, meaning tracing the polygon
 * moves in a clockwise direction.
 * @return {Boolean}  True if clockwise. Cached using ._isClockwise property.
 */
function isClockwise() {
  if (typeof this._isClockwise === "undefined") {
    // Recall that orient2dFast returns positive value if points are ccw
    this._isClockwise = this.determineOrientation() < 0;
  }
  return this._isClockwise;
}

/**
 * Determine if the polygon points are oriented clockwise or counter-clockwise
 * https://en.wikipedia.org/wiki/Curve_orientation#Orientation_of_a_simple_polygon
 * Locate a point on the convex hull, and find its orientation in relation to the
 * prior point and next point.
 */
function determineOrientation() {
  if (this.isConvex) {
    // Can use any point to determine orientation
    const iter = this.iteratePoints();
    const prev_pt = iter.next().value;
    const curr_pt = iter.next().value;
    const next_pt = iter.next().value;
    return foundry.utils.orient2dFast(prev_pt, curr_pt, next_pt);
  }

  // Locate the index of the vertex with the smallest x coordinate.
  // Break ties with smallest y
  const pts = this.points;
  const ln = this.isClosed ? pts.length - 2 : pts.length; // Don't repeat the first point
  let min_x = Number.POSITIVE_INFINITY;
  let min_y = Number.POSITIVE_INFINITY;
  let min_i = 0;
  for (let i = 0; i < ln; i += 2) {
    const curr_x = pts[i];
    const curr_y = pts[i+1];

    if (curr_x < min_x || (curr_x === min_x && curr_y < min_y)) {
      min_x = curr_x;
      min_y = curr_y;
      min_i = i;
    }
  }

  // Min_x, min_y are the B (the point on the convex hull)
  const curr_pt = { x: min_x, y: min_y };

  const prev_i = min_i > 1 ? (min_i - 2) : (ln - 2);
  const prev_pt = { x: pts[prev_i], y: pts[prev_i + 1] };

  const next_i = min_i < (ln - 2) ? (min_i + 2) : 0;
  const next_pt = { x: pts[next_i], y: pts[next_i + 1] };

  return foundry.utils.orient2dFast(prev_pt, curr_pt, next_pt);
}

/**
 * Reverse the order of the polygon points.
 */
function reverse() {
  const reversed_pts = [];
  const pts = this.points;
  const ln = pts.length - 2;
  for (let i = ln; i >= 0; i -= 2) {
    reversed_pts.push(pts[i], pts[i + 1]);
  }
  this.points = reversed_pts;
  if (typeof this._isClockwise !== "undefined") {
    this._isClockwise = !this._isClockwise;
  }
}

/**
 * Returns the framing rectangle of the polygon as a Rectangle object
 * Comparable to PIXI.Circle.getBounds().
 * @return {PIXI.Rectangle}
 */
function getBounds() {
  const iter = this.iteratePoints({ close: false });
  const bounds = [...iter].reduce((prev, pt) => {
    return {
      min_x: Math.min(pt.x, prev.min_x),
      min_y: Math.min(pt.y, prev.min_y),
      max_x: Math.max(pt.x, prev.max_x),
      max_y: Math.max(pt.y, prev.max_y) };

    }, { min_x: Number.POSITIVE_INFINITY, max_x: Number.NEGATIVE_INFINITY,    // eslint-disable-line indent
         min_y: Number.POSITIVE_INFINITY, max_y: Number.NEGATIVE_INFINITY }); // eslint-disable-line indent

  return new PIXI.Rectangle(bounds.min_x, bounds.min_y,
                            bounds.max_x - bounds.min_x,  // eslint-disable-line indent
                            bounds.max_y - bounds.min_y); // eslint-disable-line indent
}

/**
 * Locate the center of the polygon, defined as the center of its bounding rectangle
 * @return {Point}
 */
function getCenter() {
  const rect = this.getBounds();
  return rect.getCenter();
}

/**
 * Scale a polygon by shifting its position and size.
 * Each point will be changed by the formula:
 * pt.x = (pt.x - position_dx) / size_dx;
 * pt.y = (pt.y - position_dy) / size_dy;
 * Typically, dx and dy are the same. Providing different dx and dy
 * will warp the polygon shape accordingly.
 * Default values will not change the points.
 *
 * Useful for enlarging or shrinking a polygon, such as an approximate circle.
 *
 * @param {number} position_dx
 * @param {number} position_dy
 * @param {number} size_dx
 * @param {number} size_dy
 * @return {Array[number]} The scaled points
 */
function scale({ position_dx = 0, position_dy = 0, size_dx = 1, size_dy = 1} = {}) {
  const pts = [...this.points];
  const ln = pts.length;
  for (let i = 0; i < ln; i += 2) {
    pts[i]   = (pts[i] - position_dx) / size_dx;   // eslint-disable-line no-multi-spaces
    pts[i+1] = (pts[i+1] - position_dy) / size_dy;
  }

  const out = new this.constructor(pts);
  out._isClockwise = this._isClockwise;
  out._isConvex = this._isConvex;
  out._isClosed = this._isClosed;

  return out;
}

/**
 * Unscale a polygon by shifting its position and size (opposite of scale).
 * Each point will be changed by the formula:
 * pt.x = (pt.x * size_dx) + position_dx;
 * pt.y = (pt.y * size_dy) + position_dy;
 * Typically, dx and dy are the same. Providing different dx and dy
 * will warp the polygon shape accordingly.
 * Default values will not change the points.
 *
 * Useful for enlarging or shrinking a polygon, such as an approximate circle.
 *
 * @param {number} position_dx
 * @param {number} position_dy
 * @param {number} size_dx
 * @param {number} size_dy
 * @return {PIXI.Polygon} A new PIXI.Polygon
 */
function unscale({ position_dx = 0, position_dy = 0, size_dx = 1, size_dy = 1 } = {}) {
  const pts = [...this.points];
  const ln = pts.length;
  for (let i = 0; i < ln; i += 2) {
    pts[i]   = (pts[i] * size_dx) + position_dx;   // eslint-disable-line no-multi-spaces
    pts[i+1] = (pts[i+1] * size_dy) + position_dy;
  }

  const out = new this.constructor(pts);
  out._isClockwise = this._isClockwise;
  out._isConvex = this._isConvex;
  out._isClosed = this._isClosed;

  return out;
}

/**
 * Translate, shifting it in the x and y direction.
 * @param {Number} delta_x  Movement in the x direction.
 * @param {Number} delta_y  Movement in the y direction.
 */
function translate(delta_x, delta_y) {
  const ln = this.points.length;
  for (let i = 0; i < ln; i += 2) {
    this.points[i] = this.points[i] + delta_x;
    this.points[i + 1] = this.points[i + 1] + delta_y;
  }
}

// ---------------- Clipper JS library ---------------------------------------------------

/**
 * Intersect another polygon
 */
function intersectPolygon(other) {
  return this.clipperClip(other, { cliptype: ClipperLib.ClipType.ctIntersection });
}

/**
 * Union another polygon
 */
function unionPolygon(other) {
  return this.clipperClip(other, { cliptype: ClipperLib.ClipType.ctUnion });
}

/**
 * Transform array of X, Y points to a PIXI.Polygon
 */
function fromClipperPoints(points) {
  // Flat map is slow: const out = new this(points.flatMap(pt => [pt.X, pt.Y]));
  // Switch to for loop. https://jsbench.me/eeky2ei5rw
  const pts = [];
  for (const pt of points) {
    pts.push(pt.X, pt.Y);
  }
  const out = new this(...pts);


  out.close();
  return out;
}

/**
 * Iterate over the polygon's {x, y} points in order.
 * Return in ClipperLib format: {X, Y}
 * @return {x, y} PIXI.Point
 */
function* iterateClipperLibPoints({close = true} = {}) {
  const dropped = (!this.isClosed || close) ? 0 : 2;
  for (let i = 0; i < (this.points.length - dropped); i += 2) {
    yield {X: this.points[i], Y: this.points[i + 1]};
  }
}

/**
 * Getter to store the clipper coordinate point set.
 */
function clipperCoordinates() {
  return [...this.iterateClipperLibPoints({close: false})];
}

/**
 * Point contained in polygon
 * Returns 0 if false, -1 if pt is on poly and +1 if pt is in poly.
 */
function clipperContains(pt) {
  const path = this.clipperCoordinates;

  return ClipperLib.Clipper.PointInPolygon(new ClipperLib.FPoint(pt.x, pt.y), path);
}

/**
 * Are the polygon points oriented clockwise?
 */
function clipperIsClockwise() {
  const path = this.clipperCoordinates;
  return ClipperLib.Clipper.Orientation(path);
}

/**
 * Get bounding box
 * @return {PIXI.Rectangle}
 */
function clipperBounds() {
  const path = this.clipperCoordinates;
  const bounds = ClipperLib.JS.BoundsOfPath(path); // Returns ClipperLib.FRect

  /* eslint-disable indent */
  return new PIXI.Rectangle(bounds.left,
                            bounds.top,
                            bounds.right - bounds.left,
                            bounds.bottom - bounds.top);
  /* eslint-disable indent */
}

/**
 * Clip a polygon with another.
 * Union, Intersect, diff, x-or
 */
function clipperClip(poly, { cliptype = ClipperLib.ClipType.ctUnion } = {}) {
  const subj = this.clipperCoordinates;
  const clip = poly.clipperCoordinates;

  const solution = new ClipperLib.Paths();
  const c = new ClipperLib.Clipper();
  c.AddPath(subj, ClipperLib.PolyType.ptSubject, true); // True to be considered closed
  c.AddPath(clip, ClipperLib.PolyType.ptClip, true);
  c.Execute(cliptype, solution);

  return PIXI.Polygon.fromClipperPoints(solution[0]);
}

/**
 * Area of polygon
 */
function area() {
  return Math.abs(this.clipperArea());
}

function clipperArea() {
  const path = this.clipperCoordinates;
  return ClipperLib.Clipper.Area(path);
}


// ----------------  ADD METHODS TO THE PIXI.POLYGON PROTOTYPE --------------------------
export function registerPIXIPolygonMethods() {
  Object.defineProperty(PIXI.Polygon, "fromPoints", {
    value: fromPoints,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "iteratePoints", {
    value: iteratePoints,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "iterateEdges", {
    value: iterateEdges,
    writable: true,
    configurable: true
  });

  if ( !Object.hasOwn(PIXI.Polygon.prototype, "coordinates") ) {
    Object.defineProperty(PIXI.Polygon.prototype, "coordinates", {
      get: coordinates
    });
  }

  if ( !Object.hasOwn(PIXI.Polygon.prototype, "isClosed") ) {
    Object.defineProperty(PIXI.Polygon.prototype, "isClosed", {
      get: isClosed
    });
  }

  if ( !Object.hasOwn(PIXI.Polygon.prototype, "isConvex") ) {
    Object.defineProperty(PIXI.Polygon.prototype, "isConvex", {
      get: isConvex
    });
  }

  if ( !Object.hasOwn(PIXI.Polygon.prototype, "isClockwise") ) {
    Object.defineProperty(PIXI.Polygon.prototype, "isClockwise", {
      get: isClockwise
    });
  }

  Object.defineProperty(PIXI.Polygon.prototype, "determineConvexity", {
    value: determineConvexity,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "determineOrientation", {
    value: determineOrientation,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "close", {
    value: close,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "open", {
    value: open,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "reverse", {
    value: reverse,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "getBounds", {
    value: getBounds,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "getCenter", {
    value: getCenter,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "scale", {
    value: scale,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "unscale", {
    value: unscale,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "translate", {
    value: translate,
    writable: true,
    configurable: true
  });

  // ----------------  CLIPPER LIBRARY METHODS ------------------------

  Object.defineProperty(PIXI.Polygon.prototype, "intersectPolygon", {
    value: intersectPolygon,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "unionPolygon", {
    value: unionPolygon,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "iterateClipperLibPoints", {
    value: iterateClipperLibPoints,
    writable: true,
    configurable: true
  });

  if ( !Object.hasOwn(PIXI.Polygon.prototype, "clipperCoordinates") ) {
    Object.defineProperty(PIXI.Polygon.prototype, "clipperCoordinates", {
      get: clipperCoordinates
    });
  }

  Object.defineProperty(PIXI.Polygon, "fromClipperPoints", {
    value: fromClipperPoints,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "clipperIsClockwise", {
    value: clipperIsClockwise,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "clipperBounds", {
    value: clipperBounds,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "clipperClip", {
    value: clipperClip,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "clipperContains", {
    value: clipperContains,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "area", {
    value: area,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "clipperArea", {
    value: clipperArea,
    writable: true,
    configurable: true
  });
}
