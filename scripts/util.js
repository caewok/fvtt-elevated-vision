/* globals
game,
foundry,
canvas,
ClipperLib,
PIXI
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { Point3d } from "./Point3d.js";

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
  if ( holes.length) {
    c.AddPath(boundary.toClipperPoints({scalingFactor}), ClipperLib.PolyType.ptSubject, true);
    for ( const hole of holes ) {
      c.AddPath(hole.toClipperPoints({scalingFactor}), ClipperLib.PolyType.ptClip, true);
    }
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
 * Test if two points are almost equal.
 * If points have keys, better to use p.equal
 * @param {Point} a   Point with 2 dimensions
 * @param {Point} b   Point with 2 dimensions
 * @returns {boolean}
 */
export function points2dAlmostEqual(a, b, epsilon = 1e-08) {
  return a.x.almostEqual(b.x, epsilon) && a.y.almostEqual(b.y, epsilon);
}

export function points3dAlmostEqual(a, b, epsilon = 1e-08) {
  return a.x.almostEqual(b.x, epsilon)
    && a.y.almostEqual(b.y, epsilon)
    && a.z.almostEqual(b.z, epsilon);
}

/**
 * From https://pixijs.download/release/docs/packages_extract_src_Extract.ts.html
 * canvas.app.renderer.extract.pixels doesn't work in 6.4.2
 * Appears fixed in 6.5.0. https://github.com/pixijs/pixijs/pull/8388
 *
 * Will return a one-dimensional array containing the pixel data of the entire texture in RGBA
 * order, with integer values between 0 and 255 (included).
 * @param {DisplayObject|RenderTexture} target  A displayObject or renderTexture
 *   to convert. If left empty will use the main renderer
 * @param {PixelExtractOptions|PIXI.Rectangle} The frame the extraction is restricted to.
 * @returns {Uint8Array} One-dimensional array containing the pixel data of the entire texture
 */
export function extractPixels(target, frame) {

  const renderer = canvas.app.renderer;
  let resolution;
  let renderTexture;
  let generated = false;
  if (target)
  {
    if (target instanceof PIXI.RenderTexture)
    {
      renderTexture = target;
    }
    else
    {
      renderTexture = renderer.generateTexture(target);
      generated = true;
    }
  }
  if (renderTexture)
  {
    resolution = renderTexture.baseTexture.resolution;
    frame = frame ?? renderTexture.frame;
    renderer.renderTexture.bind(renderTexture);
  }
  else
  {
    resolution = renderer.resolution;
    if (!frame)
    {
      frame = new PIXI.Rectangle();
      frame.width = renderer.width;
      frame.height = renderer.height;
    }
    renderer.renderTexture.bind(null);
  }
  const width = Math.round(frame.width * resolution);
  const height = Math.round(frame.height * resolution);
  const BYTES_PER_PIXEL = 4;

  const webglPixels = new Uint8Array(BYTES_PER_PIXEL * width * height);
  // Read pixels to the array
  const gl = renderer.gl;
  gl.readPixels(
    Math.round(frame.x * resolution),
    Math.round(frame.y * resolution),
    width,
    height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    webglPixels
  );
  if (generated)
  {
    renderTexture.destroy(true);
  }
  PIXI.Extract.arrayPostDivide(webglPixels, webglPixels);
  return webglPixels;
}

/**
 * Convert a grid units value to pixel units, for equivalency with x,y values.
 */
export function zValue(value) {
  const { distance, size } = canvas.scene.grid;
  return (value * size) / distance;
}

/**
 * Log message only when debug flag is enabled from DevMode module.
 * @param {Object[]} args  Arguments passed to console.log.
 */
export function log(...args) {
  try {
    const isDebugging = game.modules.get("_dev-mode")?.api?.getPackageDebugValue(MODULE_ID);
    if ( isDebugging ) {
      console.log(MODULE_ID, "|", ...args);
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
  const byteString = atob(image64.src.split(",")[1]);

  // Write the bytes of the string to an ArrayBuffer
  const ln = byteString.length;
  const ab = new ArrayBuffer(ln);
  const dw = new DataView(ab);
  for ( let i = 0; i < ln; i += 1 ) dw.setUint8(i, byteString.charCodeAt(i));

  return ab;
}

/**
 * Get the point on a line AB that forms a perpendicular line to a point C.
 * From https://stackoverflow.com/questions/10301001/perpendicular-on-a-line-segment-from-a-given-point
 * This is basically simplified vector projection: https://en.wikipedia.org/wiki/Vector_projection
 * @param {Point} a
 * @param {Point} b
 * @param {Point} c
 * @return {Point} The point on line AB or null if a,b,c are collinear. Not
 *                 guaranteed to be within the line segment a|b.
 */
export function perpendicularPoint(a, b, c) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dab = Math.pow(dx, 2) + Math.pow(dy, 2);
  if ( !dab ) return null;

  const u = (((c.x - a.x) * dx) + ((c.y - a.y) * dy)) / dab;
  return {
    x: a.x + (u * dx),
    y: a.y + (u * dy)
  };
}

export function distanceBetweenPoints(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function distanceSquaredBetweenPoints(a, b) {
  return Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2);
}

/**
 * See https://github.com/mourner/robust-predicates
 * Each Point3d should have {x, y, z} coordinates.
 * @param {Point3d} a
 * @param {Point3d} b
 * @param {Point3d} c
 * @param {Point3d} d
 * @return {number}
 * Returns a positive value if the point d lies above the plane passing through a, b, and c,
 *   meaning that a, b, and c appear in counterclockwise order when viewed from d.
 * Returns a negative value if d lies below the plane.
 * Returns zero if the points are coplanar.
 *
 * The result is also an approximation of six times the signed volume of the tetrahedron
 * defined by the four points.
 */
export function orient3dFast(a, b, c, d) {
  const adx = a.x - d.x;
  const bdx = b.x - d.x;
  const cdx = c.x - d.x;
  const ady = a.y - d.y;
  const bdy = b.y - d.y;
  const cdy = c.y - d.y;
  const adz = a.z - d.z;
  const bdz = b.z - d.z;
  const cdz = c.z - d.z;

  return (adx * ((bdy * cdz) - (bdz * cdy)))
    + (bdx * ((cdy * adz) - (cdz * ady)))
    + (cdx * ((ady * bdz) - (adz * bdy)));
}

/**
 * Quickly test whether the line segment AB intersects with a plane.
 * This method does not determine the point of intersection, for that use lineLineIntersection.
 * Each Point3d should have {x, y, z} coordinates.
 *
 * @param {Point3d} a   The first endpoint of segment AB
 * @param {Point3d} b   The second endpoint of segment AB
 * @param {Point3d} c   The first point defining the plane
 * @param {Point3d} d   The second point defining the plane
 * @param {Point3d} e   The third point defining the plane.
 *                      Optional. Default is for the plane to go up in the z direction.
 *
 * @returns {boolean} Does the line segment intersect the plane?
 * Note that if the segment is part of the plane, this returns false.
 */
export function lineSegment3dPlaneIntersects(a, b, c, d, e = {x: c.x, y: c.y, z: c.z + 1}) {
  // A and b must be on opposite sides.
  // Parallels the 2d case.
  const xa = orient3dFast(a, c, d, e);
  const xb = orient3dFast(b, c, d, e);
  return xa * xb <= 0;
}

/**
 * Get the angle between three points, A --> B --> C, to the right of B.
 * Assumes A|B and B|C have lengths > 0.
 * @param {Point} a   First point
 * @param {Point} b   Second point
 * @param {Point} c   Third point
 * @returns {number}  Angle, in radians
 */
export function angleBetweenPoints(a, b, c) {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = (ba.x * bc.x) + (ba.y * bc.y);
  const denom = distanceBetweenPoints(a, b) * distanceBetweenPoints(b, c);
  return Math.acos(dot / denom);
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
  // Four corners of the wall: c, d, e, f
  const c = new Point3d(wall.A.x, wall.A.y, wall.bottomZ);
  const d = new Point3d(wall.B.x, wall.B.y, wall.bottomZ);

  if ( c.z === Number.NEGATIVE_INFINITY ) c.z = Number.MIN_SAFE_INTEGER;
  if ( d.z === Number.NEGATIVE_INFINITY ) d.z = Number.MIN_SAFE_INTEGER;

  // First test if wall and segment intersect from 2d overhead.
  if ( !foundry.utils.lineSegmentIntersects(a, b, c, d) ) { return null; }

  // Second test if segment intersects the wall as a plane
  const e = new Point3d(wall.A.x, wall.A.y, wall.topZ);
  if ( e.z === Number.POSITIVE_INFINITY ) e.z = Number.MAX_SAFE_INTEGER;

  if ( !lineSegment3dPlaneIntersects(a, b, c, d, e) ) { return null; }

  // At this point, we know the wall, if infinite, would intersect the segment
  // But the segment might pass above or below.
  // Simple approach is to get the actual intersection with the infinite plane,
  // and then test for height.
  const ix = lineWall3dIntersection(a, b, wall, epsilon);
  if ( !ix || ix.z < wall.bottomZ || ix.z > wall.topZ ) { return null; }

  return ix;
}


/**
 * Get the intersection of a 3d line with a plane.
 * See https://stackoverflow.com/questions/5666222/3d-line-plane-intersection
 * @param {Point3d} rayPoint        Any point on the line
 * @param {Point3d} rayDirection    Line direction
 * @param {Point3d} planePoint      Any point on the plane
 * @param {Point3d} planeNormal  Plane normal
 * @return {Point3d|null}
 */
// export function linePlane3dIntersection(rayPoint, rayDirection, planePoint, planeNormal, epsilon = 1e-8) {
//   const ndotu = planeNormal.dot(rayDirection);
//   if ( Math.abs(ndotu) < epsilon ) { return null; } // no intersection; line is parallel
//   const w = rayPoint.sub(planePoint);
//   const si = (-planeNormal.dot(w)) / ndotu;
//   return rayDirection.mul(si).add(w).add(planePoint);
// }
//
//
// export function lineWall3dIntersection(a, b, wall, epsilon = 1e-8) {
//   const rayPoint = a;
//   const rayDirection = b.sub(a);
//
//   // 3 points on the wall to define the plane
//   const q = new Point3d(wall.A.x, wall.A.y, wall.bottomZ);
//   const r = new Point3d(wall.A.x, wall.A.y, wall.topZ);
//   const s = new Point3d(wall.B.x, wall.B.y, wall.bottomZ);
//
//   // Take the cross-product of the vectors qr and qs
//   const qr = r.sub(q);
//   const qs = s.sub(q);
//   const planeNormal = new Point3d(
//     (qr.y * qs.z) - (qr.z * qs.y),
//     -((qr.x * qs.z) - (qr.z * qs.x)),
//     (qr.x * qs.y) - (qr.y * qs.x))
//
//   const planePoint = q;
//
//
// }

export function linePlane3dIntersection(a, b, c, d, epsilon = 1e-8) {
  const u = b.sub(a);
  const dot = d.dot(u);

  if ( Math.abs(dot) > epsilon ) {
    // The factor of the point between a -> b (0 - 1)
    // if 'fac' is between (0 - 1) the point intersects with the segment.
    // Otherwise:
    // < 0.0: behind a.
    // > 1.0: infront of b.
    const w = a.sub(c);
    const fac = -d.dot(w) / dot;
    const uFac = u.mul(fac);
    return a.add(uFac);
  }

  // The segment is parallel to the plane.
  return null;
}

/**
 * Get the intersection of a 3d line with a wall extended as a plane.
 * See https://stackoverflow.com/questions/5666222/3d-line-plane-intersection
 * @param {Point3d} a   First point on the line
 * @param {Point3d} b   Second point on the line
 * @param {Wall} wall   Wall to intersect
 */
export function lineWall3dIntersection(a, b, wall, epsilon = 1e-8) {
  const x = wall.A.x;
  const y = wall.A.y;
  const c = new Point3d(x, y, 0);

  // Perpendicular vectors are (-dy, dx) and (dy, -dx)
  const d = new Point3d(-(wall.B.y - y), (wall.B.x - x), 0);

  return linePlane3dIntersection(a, b, c, d, epsilon);
}


/**
 * Key for 2d points
 */
export function point2dKey(p) {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  return (x << 16) ^ y;
}

/**
 * Key for 3d points
 */
export function point3dKey(p) {
  const z = Math.round(p.z);
  return (BigInt(point2dKey(p)) << 32n) ^ BigInt(z);
}
