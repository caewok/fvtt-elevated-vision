/* globals
game,
foundry,
canvas,
ClipperLib,
CONFIG,
PIXI
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";


/**
 * N modulus 256
 */
export function mod256(n) { return (n & 255); }

/**
 * Math.floor(n / 256)
 */
export function quotient256(n) { return (n >> 8); }

export function almostLessThan(a, b) { return a < b || a.almostEqual(b); }

export function almostGreaterThan(a, b) { return a > b || a.almostEqual(b); }

export function almostBetween(value, min, max) {
  return almostLessThan(value, max) && almostGreaterThan(value, min);
}

/**
 * Fast rounding for positive numbers
 * @param {number} n
 * @returns {number}
 */
export function roundFastPositive(n) { return (n + 0.5) << 0; }

/**
 * @typedef {object} PixelFrame
 * @property {number[]} pixels
 * @property {number} width
 * @property {number} height
 * @property {number} [resolution]
 */

/**
 * Extract a rectangular array of pixels from an array of pixels, representing 2d rectangle of pixels.
 * @param {number[]} pixels         Pixel array to extract from
 * @param {number} pxWidth          Width of the pixel array as a 2d rectangle
 * @param {PIXI.Rectangle} frame    Rectangle to use for the extraction
 * @returns {PixelFrame}
 */
export function extractRectangleFromPixelArray(pixels, pxWidth, frame) {
  const left = Math.round(frame.left);
  const top = Math.round(frame.top);
  const right = frame.right + 1;
  const bottom = frame.bottom + 1;
  const N = frame.width * frame.height;
  const arr = new Uint8Array(N);
  let j = 0;
  for ( let ptX = left; ptX < right; ptX += 1 ) {
    for ( let ptY = top; ptY < bottom; ptY += 1) {
      const px = (ptY * pxWidth) + ptX;
      arr[j] = pixels[px];
      j += 1;
    }
  }
  return { pixels: arr, width: frame.width, height: frame.height };
}

/**
 * Extract a rectangular array of pixels from an array of pixels, representing 2d rectangle of pixels.
 * @param {number[]} pixels         Pixel array to extract from
 * @param {number} pxWidth          Width of the pixel array as a 2d rectangle
 * @param {PIXI.Rectangle} frame    Rectangle to use for the extraction
 * @param {function} fn             Function to apply to each pixel. Is passed pixel value and index.
 * @returns {PixelFrame}
 */
export function applyFunctionToPixelArray(pixels, pxWidth, frame, fn) {
  const left = Math.round(frame.left);
  const top = Math.round(frame.top);
  const right = frame.right + 1;
  const bottom = frame.bottom + 1;
  const N = frame.width * frame.height;
  const arr = new Uint8Array(N);
  let j = 0;
  for ( let ptX = left; ptX < right; ptX += 1 ) {
    for ( let ptY = top; ptY < bottom; ptY += 1) {
      const px = (ptY * pxWidth) + ptX;
      const value = pixels[px];
      arr[j] = value;
      fn(value, px);
      j += 1;
    }
  }
  return { pixels: arr, width: frame.width, height: frame.height };
}

/**
 * Combine a PIXI polygon with 1 or more holes contained within (or partially within) the boundary.
 * If no holes, will clean the polygon, which may (rarely) result in holes.
 * @param {PIXI.Polygon} boundary   Polygon representing the boundary shape.
 * @param {PIXI.Polygon[]} holes    Array of polygons representing holes in the boundary shape.
 * @returns {PIXI.Polygon[]} Array of polygons where holes are labeled with isHole
 */
export function combineBoundaryPolygonWithHoles(boundary, holes, { scalingFactor = 1, cleanDelta = 0.1 } = {}) {
  const c = new ClipperLib.Clipper();
  const solution = new ClipperLib.Paths();
  const ln = holes.length;

  if ( ln > 1) {
    // First, combine all the shadows. This avoids inversion issues. See issue #17.
    const c1 = new ClipperLib.Clipper();
    const combinedShadows = new ClipperLib.Paths();
    c1.AddPath(holes[0].toClipperPoints({scalingFactor}), ClipperLib.PolyType.ptSubject, true);
    for ( let i = 1; i < ln; i += 1 ) {
      const hole = holes[i];
      c1.AddPath(hole.toClipperPoints({scalingFactor}), ClipperLib.PolyType.ptClip, true);
    }

    // To avoid the checkerboard issue, use a positive fill type so any overlap is filled.
    c1.Execute(ClipperLib.ClipType.ctUnion,
      combinedShadows,
      ClipperLib.PolyFillType.pftPositive,
      ClipperLib.PolyFillType.pftPositive);

    /* Testing
    api = game.modules.get("elevatedvision").api
    Shadow = api.Shadow
    tmp = combinedShadows.map(pts => {
      const poly = PIXI.Polygon.fromClipperPoints(pts, scalingFactor);
      poly.isHole = !ClipperLib.Clipper.Orientation(pts);
      return poly;
    });
    tmp.map(t => t.isHole)
    shadow = tmp.map(p => new Shadow(p.points))
    */

    // Then invert against the boundary (e.g., LOS) polygon
    ClipperLib.Clipper.CleanPolygons(combinedShadows, cleanDelta * scalingFactor);
    c.AddPath(boundary.toClipperPoints({scalingFactor}), ClipperLib.PolyType.ptSubject, true);
    c.AddPaths(combinedShadows, ClipperLib.PolyType.ptClip, true);
    c.Execute(ClipperLib.ClipType.ctDifference, solution);

    /* Testing
    tmp = solution.map(pts => {
      const poly = PIXI.Polygon.fromClipperPoints(pts, scalingFactor);
      poly.isHole = !ClipperLib.Clipper.Orientation(pts);
      return poly;
    });
    tmp.map(t => t.isHole)
    shadow = tmp.map(p => new Shadow(p.points))
    */

  } else if ( ln === 1 ) {
    c.AddPath(boundary.toClipperPoints({scalingFactor}), ClipperLib.PolyType.ptSubject, true);
    c.AddPath(holes[0].toClipperPoints({scalingFactor}), ClipperLib.PolyType.ptClip, true);
    c.Execute(ClipperLib.ClipType.ctDifference, solution);

  } else {
    solution.push(boundary.toClipperPoints({scalingFactor}));
  }

  ClipperLib.Clipper.CleanPolygons(solution, cleanDelta * scalingFactor);
  return solution.map(pts => {
    const poly = PIXI.Polygon.fromClipperPoints(pts, scalingFactor);
    poly.isHole = !ClipperLib.Clipper.Orientation(pts);
    return poly;
  });
}

/**
 * Draw an array of polygons, where polygons marked with "isHole" should be considered holes.
 * To avoid artifacts, this polygon array should be created using "combineBoundaryPolygonWithHoles"
 * or otherwise cleaned such that holes are entirely contained in the polygon.
 * Other PIXI shapes may or may not work, as currently PIXI holes work only with polygon boundaries.
 * See https://pixijs.download/release/docs/PIXI.Graphics.html#beginHole
 * @param {PIXI.Polygon} polygonArray         Polygons representing boundaries or holes.
 * @param {object} [options]                  Options to affect the drawing
 * @param {PIXI.Graphics} [options.graphics]  Graphics object to use
 * @param {hex} [options.fill]                Fill color
 * @param {number} [options.alpha]            Alpha value for the fill
 */
export function drawPolygonWithHoles(polygonArray, {
  graphics = canvas.controls.debug,
  fillColor = 0xFFFFFF,
  alpha = 1.0 } = {}) {

  graphics.beginFill(fillColor, alpha);
  for ( const poly of polygonArray ) {
    if ( poly.isHole ) {
      graphics.beginHole();
      graphics.drawShape(poly);
      graphics.endHole();
    } else graphics.drawShape(poly);
  }
  graphics.endFill();
}

export function drawPolygonWithHolesPV(polygonArray, {
  graphics,
  fillColor = 0xFFFFFF,
  alpha = 1.0 } = {}) {

  for ( const poly of polygonArray ) {
    const g1 = new PIXI.LegacyGraphics();
    graphics.addChild(g1);
    g1.beginFill(fillColor, alpha).drawShape(poly).endFill();
    g1._stencilHole = poly.isHole;
  }
  return graphics;
}


/**
 * From https://stackoverflow.com/questions/14446511/most-efficient-method-to-groupby-on-an-array-of-objects
 * Takes an Array<V>, and a grouping function,
 * and returns a Map of the array grouped by the grouping function.
 *
 * @param {Array} list An array of type V.
 * @param {Function} keyGetter A Function that takes the the Array type V as an input, and returns a value of type K.
 *                  K is generally intended to be a property key of V.
 *                  keyGetter: (input: V) => K): Map<K, Array<V>>
 *
 * @returns Map of the array grouped by the grouping function. map = new Map<K, Array<V>>()
 */
export function groupBy(list, keyGetter) {
  const map = new Map();
  list.forEach(item => {
    const key = keyGetter(item);
    const collection = map.get(key);

    if (!collection) map.set(key, [item]);
    else collection.push(item);
  });
  return map;
}

/**
 * Log message only when debug flag is enabled from DevMode module.
 * @param {Object[]} args  Arguments passed to console.log.
 */
export function log(...args) {
  try {
    const isDebugging = game.modules.get("_dev-mode")?.api?.getPackageDebugValue(MODULE_ID);
    if ( isDebugging ) {
      console.debug(MODULE_ID, "|", ...args);
    }
  } catch(e) {
    // Empty
  }
}

/**
 * User FileReader to retrieve the DataURL from the file.
 * Parallels readTextFromFile
 * @param {File} file   A File object
 * @return {Promise.<String>} A Promise which resolves to the loaded DataURL.
 */
export function readDataURLFromFile(file) {
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = ev => { // eslint-disable-line no-unused-vars
      resolve(reader.result);
    };
    reader.onerror = ev => { // eslint-disable-line no-unused-vars
      reader.abort();
      reject();
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Convert base64 image to raw binary data
 * @param {object} image64  HTML image64 object
 * @returns {ArrayBuffer} The raw image data.
 */
export function convertBase64ToImage(image64) {
  const byteString = atob(image64.split(",")[1]);

  // Write the bytes of the string to an ArrayBuffer
  const ln = byteString.length;
  const ab = new ArrayBuffer(ln);
  const dw = new DataView(ab);
  for ( let i = 0; i < ln; i += 1 ) dw.setUint8(i, byteString.charCodeAt(i));

  return ab;
}

/**
 * Quickly test whether the line segment AB intersects with a wall in 3d.
 * Extension of lineSegmentPlaneIntersects where the plane is not infinite.
 * Takes advantage of the fact that 3d walls in Foundry move straight out of the canvas
 * @param {Point3d} a   The first endpoint of segment AB
 * @param {Point3d} b   The second endpoint of segment AB
 * @param {Point3d} c   The first corner of the rectangle
 * @param {Point3d} d   The second corner of the rectangle
 * @param {Point3d} e   The third corner of the rectangle
 * @param {Point3d} f   The fourth corner of the rectangle
 *                      Optional. Default is for the plane to go up in the z direction.
 *
 * @returns {boolean} Does the line segment intersect the rectangle in 3d?
 */
export function lineSegment3dWallIntersection(a, b, wall, epsilon = 1e-8) {
  let bottomZ = wall.bottomZ;
  let topZ = wall.bottomZ;

  if ( !isFinite(bottomZ) ) bottomZ = Number.MIN_SAFE_INTEGER;
  if ( !isFinite(topZ) ) topZ = Number.MAX_SAFE_INTEGER;

  // Four corners of the wall: c, d, e, f
  const c = new Point3d(wall.edge.a.x, wall.edge.a.y, bottomZ);
  const d = new Point3d(wall.edge.b.x, wall.edge.b.y, bottomZ);

  // First test if wall and segment intersect from 2d overhead.
  if ( !foundry.utils.lineSegmentIntersects(a, b, c, d) ) { return null; }

  // Second test if segment intersects the wall as a plane
  const e = new Point3d(wall.edge.a.x, wall.edge.a.y, topZ);

  if ( !CONFIG.GeometryLib.utils.lineSegment3dPlaneIntersects(a, b, c, d, e) ) { return null; }

  // At this point, we know the wall, if infinite, would intersect the segment
  // But the segment might pass above or below.
  // Simple approach is to get the actual intersection with the infinite plane,
  // and then test for height.
  const ix = lineWall3dIntersection(a, b, wall, epsilon);
  if ( !ix || ix.z < wall.bottomZ || ix.z > wall.topZ ) { return null; }

  return ix;
}


/**
 * Get the intersection of a 3d line with a wall extended as a plane.
 * See https://stackoverflow.com/questions/5666222/3d-line-plane-intersection
 * @param {Point3d} a   First point on the line
 * @param {Point3d} b   Second point on the line
 * @param {Wall} wall   Wall to intersect
 */
export function lineWall3dIntersection(a, b, wall, epsilon = 1e-8) {
  const x = wall.edge.a.x;
  const y = wall.edge.a.y;
  const c = new Point3d(x, y, 0);

  // Perpendicular vectors are (-dy, dx) and (dy, -dx)
  const d = new Point3d(-(wall.edge.b.y - y), (wall.edge.b.x - x), 0);

  return linePlane3dIntersection(a, b, c, d, epsilon);
}

export function linePlane3dIntersection(a, b, c, d, epsilon = 1e-8) {
  const u = b.subtract(a);
  const dot = d.dot(u);

  if ( Math.abs(dot) > epsilon ) {
    // The factor of the point between a -> b (0 - 1)
    // if 'fac' is between (0 - 1) the point intersects with the segment.
    // Otherwise:
    // < 0.0: behind a.
    // > 1.0: infront of b.
    const w = a.subtract(c);
    const fac = -d.dot(w) / dot;
    const uFac = u.multiplyScalar(fac);
    return a.add(uFac);
  }

  // The segment is parallel to the plane.
  return null;
}

/**
 * Transform a point coordinate to be in relation to a circle center and radius.
 * Between 0 and 1 where [0.5, 0.5] is the center
 * [0, .5] is at the edge in the westerly direction.
 * [1, .5] is the edge in the easterly direction
 * @param {Point} point       The point to transform
 * @param {Point} center      The center of the source
 * @param {number} radius     The radius of the source
 * @param {number} [invR]     Inverse of the radius; for repeated calcs
 * @returns {Point}
 */
export function pointCircleCoord(point, center, radius, invR = 1 / radius) {
  return {
    x: circleCoord(point.x, radius, center.x, invR),
    y: circleCoord(point.y, radius, center.y, invR)
    // Unused: z: point.z * 0.5 * r_inv
  };
}

/**
 * Transform a coordinate to be in relation to a circle center and radius.
 * Between 0 and 1 where [0.5, 0.5] is the center.
 * @param {number} a    Coordinate value
 * @param {number} r    Light circle radius
 * @param {number} [c]    Center value, along the axis of interest
 * @param {number} [invR] Inverse of the radius; for repeated calcs
 * @returns {number}
 */
function circleCoord(a, r, c = 0, invR = 1 / r) {
  return (a - c) * invR;
}

/**
 * Inverse of circleCoord.
 * @param {number} p    Coordinate value, in the shader coordinate system between 0 and 1.
 * @param {number} c    Center value, along the axis of interest
 * @param {number} r    Radius
 * @returns {number}
 */
export function revCircleCoord(p, r, c = 0) { // eslint-disable-line no-unused-vars
  // ((a - c) * 1/r * 0.5) + 0.5 = p
  // (a - c) * 1/r = (p - 0.5) / 0.5
  // a - c = 2 * (p - 0.5) / 1/r = 2 * (p - 0.5) * r
  // a = 2 * (p - 0.5) * r + c
  return (p * r) + c;
}

/**
 * Get walls that share an endpoint with this wall.
 * Organize by shared endpoint.
 * See Wall.prototype.getLinkedSegments for recursive version.
 * @param {Wall} wall
 * @returns {object}
 */
export function getLinkedWalls(wall) {
  const linkedA = new Set();
  const linkedB = new Set();
  const keyA = wall.edge.a.key;
  const keyB = wall.edge.b.key;
  canvas.walls.placeables.forEach(w => {
    if ( w === wall ) return;
    const wallKeys = new Set([w.edge.a.key, w.edge.b.key]);
    if ( wallKeys.has(keyA) ) linkedA.add(w);
    else if ( wallKeys.has(keyB) ) linkedB.add(w);
  });
  return { linkedA, linkedB };
}

/**
 * Test if point is inside a "V" formed by two walls: a --> b --> c
 * @param {Point} a
 * @param {Point} b
 * @param {Point} c
 * @param {Point} pt
 * @returns {number} Return angle in degrees outside the "V" if point is outside; otherwise angle inside.
 */
export function pointVTest(a, b, c, pt) {
  const angle = Math.toDegrees(PIXI.Point.angleBetween(a, b, c));
  if ( isNaN(angle) || !angle ) return 180; // collinear lines

  const oAC = foundry.utils.orient2dFast(b, a, c);
  let ccwRay = { A: b, B: a };
  let cwRay = { A: b, B: c };
  if ( oAC > 0 ) [ccwRay, cwRay] = [cwRay, ccwRay];
  const ptBetween = LimitedAnglePolygon.pointBetweenRays(pt, ccwRay, cwRay, angle);
  return ptBetween ? angle : 360 - angle;
}


/**
 * Test if 2d line from origin to the point of a V is tangent to the V.
 * In other words, does the line go to the inside of the V?
 * "V" formed by two walls: a --> b --> c
 * @param {Point} a
 * @param {Point} b
 * @param {Point} c
 * @param {Point} pt
 */
export function tangentToV(a, b, c, pt) {
  const orient2d = foundry.utils.orient2dFast;
  const oA = orient2d(b, a, pt);
  const oC = orient2d(b, c, pt);
  if ( oA.almostEqual(0) || oC.almostEqual(0) ) return false; // In line with origin.
  return (oA * oC) > 0; // True if both are CW or CCW
}

/**
 * Test if two points both lie within or outside a "V" formed by two walls.
 * @param {Point} sharedEndpoint    Shared endpoint for the two walls
 * @param {Point} other1            Other endpoint of the first wall
 * @param {Point} other2            Other endpoint of the second wall
 * @param {Point} testPoint1        First test point
 * @param {Point} testPoint2        Second test point
 * @returns {boolean}  True if both are on the same side
 */
export function pointsOppositeSideV(sharedEndpoint, other1, other2, testPoint1, testPoint2) {
  const ccw = foundry.utils.orient2dFast;

  // See LimitedAnglePolygon.pointBetweenRays
  const sourceOriginOutside = (ccw(sharedEndpoint, other1, testPoint1) <= 0)
    && (ccw(sharedEndpoint, other2, testPoint1) >= 0);
  const sourceDestOutside = (ccw(sharedEndpoint, other1, testPoint2) <= 0)
    && (ccw(sharedEndpoint, other2, testPoint2) >= 0);
  return Boolean(sourceOriginOutside ^ sourceDestOutside);
}


/**
 * Bresenham line algorithm to generate pixel coordinates for a line between two points.
 * All coordinates must be positive or zero.
 * @param {number} x0   First coordinate x value
 * @param {number} y0   First coordinate y value
 * @param {number} x1   Second coordinate x value
 * @param {number} y1   Second coordinate y value
 * @testing
Draw = CONFIG.GeometryLib.Draw
let [t0, t1] = canvas.tokens.controlled
pixels = bresenhamLine(t0.center.x, t0.center.y, t1.center.x, t1.center.y)
for ( let i = 0; i < pixels.length; i += 2 ) {
  Draw.point({ x: pixels[i], y: pixels[i + 1]}, { radius: 1 });
}
 */
export function bresenhamLine(x0, y0, x1, y1) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = (x0 < x1) ? 1 : -1;
  const sy = (y0 < y1) ? 1 : -1;
  let err = dx - dy;

  const pixels = [x0, y0];
  while ( x0 !== x1 || y0 !== y1 ) {
    const e2 = err * 2;
    if ( e2 > -dy ) {
      err -= dy;
      x0 += sx;
    }
    if ( e2 < dx ) {
      err += dx;
      y0 += sy;
    }

    pixels.push(x0, y0);
  }
  return pixels;
}

export function* bresenhamLineIterator(x0, y0, x1, y1) {
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  x1 = Math.floor(x1);
  y1 = Math.floor(y1);

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = (x0 < x1) ? 1 : -1;
  const sy = (y0 < y1) ? 1 : -1;
  let err = dx - dy;
  yield { x: x0, y: y0 };
  while ( x0 !== x1 || y0 !== y1 ) {
    const e2 = err * 2;
    if ( e2 > -dy ) {
      err -= dy;
      x0 += sx;
    }
    if ( e2 < dx ) {
      err += dx;
      y0 += sy;
    }

    yield { x: x0, y: y0 };
  }
}

/**
 * Trim line segment to its intersection points with a rectangle.
 * If the endpoint is inside the rectangle, keep it.
 * Note: points on the right or bottom border of the rectangle do not count b/c we want the pixel positions.
 * @param {PIXI.Rectangle} rect
 * @param {Point} a
 * @param {Point} b
 * @returns { Point[2]|null } Null if both are outside.
 */
export function trimLineSegmentToPixelRectangle(rect, a, b) {
  rect = new PIXI.Rectangle(rect.x, rect.y, rect.width - 1, rect.height - 1);

  if ( !rect.lineSegmentIntersects(a, b, { inside: true }) ) return null;

  const ixs = rect.segmentIntersections(a, b);
  if ( ixs.length === 2 ) return ixs;
  if ( ixs.length === 0 ) return [a, b];

  // If only 1 intersection:
  //   1. a || b is inside and the other is outside.
  //   2. a || b is on the edge and the other is outside.
  //   3. a || b is on the edge and the other is inside.
  // Point on edge will be considered inside by _getZone.

  // 1 or 2 for a
  const aOutside = rect._getZone(a) !== PIXI.Rectangle.CS_ZONES.INSIDE;
  if ( aOutside ) return [ixs[0], b];

  // 1 or 2 for b
  const bOutside = rect._getZone(b) !== PIXI.Rectangle.CS_ZONES.INSIDE;
  if ( bOutside ) return [a, ixs[0]];

  // 3. One point on the edge; other inside. Doesn't matter which.
  return [a, b];
}
