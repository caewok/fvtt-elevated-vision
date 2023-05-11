/* globals
canvas,
ClipperLib,
CONFIG,
foundry,
game,
PIXI
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { Matrix } from "./geometry/Matrix.js";

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
  const left = Math.roundFast(frame.left);
  const top = Math.roundFast(frame.top);
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
  const left = Math.roundFast(frame.left);
  const top = Math.roundFast(frame.top);
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
  const c = new Point3d(wall.A.x, wall.A.y, bottomZ);
  const d = new Point3d(wall.B.x, wall.B.y, bottomZ);

  // First test if wall and segment intersect from 2d overhead.
  if ( !foundry.utils.lineSegmentIntersects(a, b, c, d) ) { return null; }

  // Second test if segment intersects the wall as a plane
  const e = new Point3d(wall.A.x, wall.A.y, topZ);

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
  const x = wall.A.x;
  const y = wall.A.y;
  const c = new Point3d(x, y, 0);

  // Perpendicular vectors are (-dy, dx) and (dy, -dx)
  const d = new Point3d(-(wall.B.y - y), (wall.B.x - x), 0);

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
 * Construct an orthographic matrix.
 * https://www.scratchapixel.com/lessons/3d-basic-rendering/perspective-and-orthographic-projection-matrix/orthographic-projection-matrix.html
 * http://learnwebgl.brown37.net/08_projections/projections_ortho.html
 * Convert a bounding box to range [-1, 1].
 * @param {number} xmin   Left, or minimum x value of the bounding box.
 * @param {number} xmax   Right, or maximum x value of the bounding box.
 * @param {number} ymin   Top, or minimum y value of the bounding box.
 * @param {number} ymax   Bottom, or maximum y value of the bounding box.
 * @param {number} near   Near, or minimum z value of the bounding box.
 * @param {number} far    Far, or maximum y value of the bounding box.
 * @returns {Matrix[4][4]}
 */
export function orthographicMatrix(xmin, xmax, ymin, ymax, near, far) {
  // http://learnwebgl.brown37.net/08_projections/projections_ortho.html
  // left = xmin; right = xmax
  // bottom = ymin; top = ymax
  // near = zmin; far = zmax

  // 1. Center at the origin.
  const midX = (xmin + xmax) * 0.5;
  const midY = (ymin + ymax) * 0.5;
  const midZ = (-near - far) * 0.5;
  const centerAroundOrigin = new Matrix([
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [-midX, -midY, -midZ, 1]
  ]);

  // 2. Scale the viewing volume to 2 units wide
  const scaleX = 2 / (xmax - xmin);
  const scaleY = 2 / (ymax - ymin);
  const scaleZ = 2 / (far - near);
  const scaleViewingVolume = new Matrix([
    [scaleX, 0, 0, 0],
    [0, scaleY, 0, 0],
    [0, 0, scaleZ, 0],
    [0, 0, 0, 1]
  ]);

  // 3. Flip coordinate system
  const convertToLeftHanded = new Matrix([
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, -1, 0],
    [0, 0, 0, 1]
  ]);

  // TODO: Store out matrix to speed up the multiplications.
  return centerAroundOrigin.multiply4x4(scaleViewingVolume).multiply4x4(convertToLeftHanded);
}


/**
 * Construct a perspective matrix based on field-of-view.
 * https://www.scratchapixel.com/lessons/3d-basic-rendering/perspective-and-orthographic-projection-matrix/opengl-perspective-projection-matrix.html
 * http://learnwebgl.brown37.net/08_projections/projections_perspective.html
 * https://webgl2fundamentals.org/webgl/lessons/webgl-3d-perspective.html
 * @param {number} fovy   The angle between the upper and lower sides of the viewing frustrum
 * @param {number} aspect The aspect ratio of the view window (width/height)
 * @param {number} near   Distance to the near clipping plane along the -z axis
 * @param {number} far    Distance to the far clipping plane along the -z axis
 * @returns {Matrix}
 */
export function perspectiveMatrixFOVY(fovy, aspect, near, far) {
  if ( !fovy.between(0, 180) || aspect <= 0 || near >= far || near <= 0 ) {
    console.error("Invalid parameters to perspectiveMatrixFOVY.");
    return Matrix.identity();
  }

  const half_fovy = Math.toRadians(fovy) * 0.5;
  const top = near * Math.tan(half_fovy);
  const bottom = -top;
  const right = top * aspect;
  const left = -right;
  return perspectiveMatrix(left, right, bottom, top, near, far);
}

/**
 * Construct a perspective matrix.
 * http://learnwebgl.brown37.net/08_projections/projections_perspective.html
 * Convert a bounding box to range [-1, 1].
 * @param {number} xmin   Left, or minimum x value of the bounding box.
 * @param {number} xmax   Right, or maximum x value of the bounding box.
 * @param {number} ymin   Top, or minimum y value of the bounding box.
 * @param {number} ymax   Bottom, or maximum y value of the bounding box.
 * @param {number} near   Near, or minimum z value of the bounding box.
 * @param {number} far    Far, or maximum y value of the bounding box.
 * @returns {Matrix[4][4]}
 */
export function perspectiveMatrix(xmin, xmax, ymin, ymax, near, far) {
  // Ensure no division by zero.
  if ( xmin === xmax || ymin === ymax || near === far ) {
    console.error("Invalid perspectiveMatrix parameters.");
    return Matrix.identity();
  }

  // Ensure correct near/far distances.
  if ( near <= 0 || far <= 0 ) {
    console.error("For a perspective projection, the near and far distances must be positive.");
    return Matrix.identity();
  }

  const xdiffInv = 1 / (xmax - xmin);
  const ydiffInv = 1 / (ymax - ymin);

  const sx = 2 * near * xdiffInv;
  const sy = 2 * near * ydiffInv;

  const c2 = -(far + near) / (far - near);
  const c1 = (2 * near * far) / (near - far);

  const tx = -near * (xmin + xmax) * xdiffInv;
  const ty = -near * (ymin + ymax) * ydiffInv;

  return new Matrix([
    [sx, 0, 0, 0],
    [0, sy, 0, 0],
    [0, 0, c2, -1],
    [tx, ty, c1, 0]
  ]);
}


/**
 * Construct a perspective matrix.
 * https://www.scratchapixel.com/lessons/3d-basic-rendering/perspective-and-orthographic-projection-matrix/orthographic-projection-matrix.html
 * http://learnwebgl.brown37.net/08_projections/projections_perspective.html
 * Convert a bounding box to range [-1, 1].
 * @param {number} xmin   Left, or minimum x value of the bounding box.
 * @param {number} xmax   Right, or maximum x value of the bounding box.
 * @param {number} ymin   Top, or minimum y value of the bounding box.
 * @param {number} ymax   Bottom, or maximum y value of the bounding box.
 * @param {number} near   Near, or minimum z value of the bounding box.
 * @param {number} far    Far, or maximum y value of the bounding box.
 * @returns {Matrix[4][4]}
 */
export function perspectiveMatrix2(xmin, xmax, ymin, ymax, near, far) {
  // Coordinates:
  // left = xmin; right = xmax
  // bottom = ymin; top = ymax
  // near = zmin; far = zmax

  // 1. Move frustrum apex to the origin
  const midX = (xmin + xmax) * 0.5;
  const midY = (ymin + ymax) * 0.5;
  const centerAroundOrigin = new Matrix([
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [-midX, -midY, 0, 1]
  ]);

  // 2. Map depth (z-values) to [-1, 1]
  // non-linear mapping between [-near, -far] and [-1, 1]
  // use c1 / -z + c2, where c1 and c2 are constants based on range of [-near, -far]
  // z = -near ==> c1 / -z + c2 == -1
  // z = -far ==> c1 / -z + c2 == 1
  const c1 = (2 * far * near) / (near - far);
  const c2 = (far + near) / (far - near);
  const depthMap = new Matrix([
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, -c2, -1],
    [0, 0, c1, 0]
  ]);

  // 3. Perspective calculation
  const perspectiveCalc = new Matrix([
    [near, 0, 0, 0],
    [0, near, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 0]
  ]);

  // 4. Scale the view window to between [-1, 1] and [1, 1]
  const scaleX = 2 / (xmax - xmin);
  const scaleY = 2 / (ymax - ymin);
  const scaleViewingVolume = new Matrix([
    [scaleX, 0, 0, 0],
    [0, scaleY, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1]
  ]);

  // TODO: Store out matrix to speed up the multiplications.
  // Or combine all into one.
  return centerAroundOrigin.multiply4x4(depthMap).multiply4x4(perspectiveCalc).multiply4x4(scaleViewingVolume);
}


/**
 * Perspective matrix
 * http://www.songho.ca/opengl/gl_projectionmatrix.html
 */
export function perspectiveMatrix3(xmin, xmax, ymin, ymax, near, far) {
  // Coordinates:
  // left = xmin; right = xmax
  // bottom = ymin; top = ymax
  // near = zmin; far = zmax
  const fnDiffInv = 1 / (far - near);
  const rlDiffInv = 1 / (xmax - xmin);
  const tbDiffInv = 1 / (ymax - ymin);
  return new Matrix([
    [2 * near * rlDiffInv, 0, 0, 0],
    [0, 2 * near * tbDiffInv, 0, 0],
    [(xmax + xmin) * rlDiffInv, (ymax + ymin) * tbDiffInv, -(far + near) * fnDiffInv, -1],
    [0, 0, -2 * far * near * fnDiffInv, 0]
  ]);
}

/**
 * Perspective matrix where the viewing volume is symmetric
 * http://www.songho.ca/opengl/gl_projectionmatrix.html
 */
export function perspectiveMatrix3Symmetric(xmin, xmax, ymin, ymax, near, far) {
  if ( xmin !== -xmax || ymin !== -ymax ) {
    console.warn("perspectiveMatrix3Symmetric requirements not met.");
    return perspectiveMatrix3(xmin, xmax, ymin, ymax, near, far);
  }

  // Coordinates:
  // left = xmin; right = xmax
  // bottom = ymin; top = ymax
  // near = zmin; far = zmax
  const fnDiffInv = 1 / (far - near);
  return new Matrix([
    [near / xmin, 0, 0, 0],
    [0, near / ymin, 0, 0],
    [0, 0, -(far + near) * fnDiffInv, -1],
    [0, 0, -2 * far * near * fnDiffInv, 0]
  ]);
}

/**
 * Convert a Matrix in row-major order to column-major order and return the array.
 * Used to convert Matrix to WebGL format.
 * @param {Matrix[r][c]} mat
 * @returns {Array[r x c]}
 */
export function toColMajorArray(mat) {
  // Add data to array row-by-row.
  const nRow = mat.dim1;
  const nCol = mat.dim2;
  const arr = new Array(nRow * nCol);
  for ( let r = 0, i = 0; r < nRow; r += 1 ) {
    for ( let c = 0; c < nCol; c += 1, i += 1 ) {
      arr[i] = mat.arr[r][c];
    }
  }
  return arr;
}

// https://thebookofshaders.com/glossary/?search=smoothstep
export function smoothStep(edge0, edge1, x) {
  const t = Math.clamped((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return (t * t) * (3.0 - (2.0 * t));
}
