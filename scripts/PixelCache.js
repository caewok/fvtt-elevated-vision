/* globals
PIXI,
canvas,
Ray
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/* Pixel Cache
 "Matrix" constructed as array used to store integer pixel values between 0 and 255.
 Represents a rectangle on the canvas, but need not be 1:1 and could be rotated, etc.

 Base class: Represent any set of pixels extracted from a texture.
   - Matrix starts at 0,0. Defined number of rows and columns.
   - Convert to/from canvas coordinates.
   - Extends PIXI.Rectangle.
 Elevation: Adds

*/

import { extractPixels } from "./perfect-vision/extract-pixels.js";
import { Draw } from "./geometry/Draw.js";
import { roundFastPositive, bresenhamLine, bresenhamLineIterator, trimLineSegmentToPixelRectangle } from "./util.js";
import { Matrix } from "./geometry/Matrix.js";

/* Testing
api = game.modules.get("elevatedvision").api
Draw = CONFIG.GeometryLib.Draw
draw = new Draw
extractPixels = api.extract.extractPixels
PixelCache = api.PixelCache
TilePixelCache = api.TilePixelCache
gridSize = canvas.dimensions.size
gridPrecision = gridSize >= 128 ? 16 : 8;
Matrix = CONFIG.GeometryLib.Matrix

cache = canvas.elevation.elevationPixelCache

cache.drawLocal({ gammaCorrect: true })
cache.draw({ gammaCorrect: true })


dims = canvas.dimensions
opts = {
      resolution: 0.5, // TODO: Remove these defaults
      width: dims.sceneWidth,
      height: dims.sceneHeight,
      mipmap: PIXI.MIPMAP_MODES.OFF,
      scaleMode: PIXI.SCALE_MODES.NEAREST,
      multisample: PIXI.MSAA_QUALITY.NONE,
      format: PIXI.FORMATS.RED
      // Cannot be extracted ( GL_INVALID_OPERATION: Invalid format and type combination)
      // format: PIXI.FORMATS.RED_INTEGER,
      // type: PIXI.TYPES.INT
    }

tex = PIXI.RenderTexture.create(opts);
cache = PixelCache.fromTexture(tex, { x: dims.sceneX, y: dims.sceneY })


// For the moment, evTexture is
evTexture = canvas.elevation._elevationTexture
cache = PixelCache.fromTexture(evTexture, { frame: canvas.dimensions.sceneRect })

// Average pixel value
let sum = 0;
sumFn = px => {
  sum += px;
}
cache.applyFunction(sumFn, { frame: _token.bounds })
cache.pixels.reduce((acc, curr) => acc + curr)


// Too big to actually reliably draw.
// cache.draw()

// Instead pull a token-sized amount and draw it
evTexture = canvas.elevation._elevationTexture
cache = PixelCache.fromTexture(evTexture, { frame: _token.bounds })
cache.draw({ alphaAdder: .2})

// Take a texture at resolution 1 and shrink it.


cache = PixelCache.fromTexture(evTexture, { frame: canvas.dimensions.sceneRect, resolution: 1/gridPrecision })
cache.pixels.reduce((acc, curr) => acc + curr)
cache.draw({ alphaAdder: .2})

evTexture = canvas.elevation._elevationTexture
cacheOrig = PixelCache.fromTexture(evTexture, { frame: _token.bounds })
cacheSmall = PixelCache.fromTexture(evTexture, { frame: _token.bounds, resolution: gridPrecision / gridSize })
cacheOrig.draw({ alphaAdder: .2})
cacheSmall.draw({ color: Draw.COLORS.red })

cacheOrig2 = PixelCache.fromTexture(evTexture, { frame: _token.bounds, scalingMethod: PixelCache.boxDownscaling })
cacheSmall2 = PixelCache.fromTexture(evTexture, {
  frame: _token.bounds,
  resolution: gridPrecision / gridSize,
  scalingMethod: PixelCache.boxDownscaling })


colors = {}
colors["0"] = Draw.COLORS.gray
colors["5"] = Draw.COLORS.lightred,
colors["10"] = Draw.COLORS.lightblue,
colors["15"] = Draw.COLORS.lightgreen,
colors["20"] = Draw.COLORS.red,
colors["25"] = Draw.COLORS.blue,
colors["30"] = Draw.COLORS.green

cacheSmall.drawColors({ defaultColor: Draw.COLORS.yellow, colors})
cacheOrig.drawColors({ defaultColor: Draw.COLORS.yellow, colors})

cacheSmall.pixels.reduce((acc, curr) => Math.min(acc, curr))
cacheSmall.pixels.reduce((acc, curr) => Math.max(acc, curr))


[tile] = canvas.tiles.placeables
cacheTile1 = TilePixelCache.fromTileAlpha(tile);
cacheTile1sm = TilePixelCache.fromTileAlpha(tile, { resolution: 0.25 });
cacheTile2 = TilePixelCache.fromOverheadTileAlpha(tile);

cacheTile1.draw({local: true})
cacheTile1sm.draw({local: true})
cacheTile2.draw({local: true})

cacheTile1.draw()
cacheTile1sm.draw()
cacheTile2.draw()

cacheTile1.drawLocal()
cacheTile1sm.drawLocal()
cacheTile2.drawLocal()

function testCoordinateTransform(pixelCache) {
  const { left, right, top, bottom } = pixelCache;
  for ( let x = left; x <= right; x += 1 ) {
    for ( let y = top; y <= bottom; y += 1 ) {
      const local = pixelCache._fromCanvasCoordinates(x, y);
      const canvas = pixelCache._toCanvasCoordinates(local.x, local.y);
      if ( !canvas.almostEqual({x, y}) ) {
        console.log(`${x},${y} not equal.`);
        return false;
      }
    }
  }
  return true;
}

testCoordinateTransform(cacheTile1)
testCoordinateTransform(cacheTile1sm)

fn = function() {
  return PixelCache.fromTexture(canvas.elevation._elevationTexture);
}

fn2 = function() {
  const { pixels } = extractPixels(canvas.app.renderer, canvas.elevation._elevationTexture);
  return pixels;
}

async function fn3() {
  const pixels = await canvas.app.renderer.plugins.extractAsync.pixels(canvas.elevation._elevationTexture)
  return pixels
}

async function fn4() {
  return canvas.app.renderer.plugins.extractAsync.pixels(canvas.elevation._elevationTexture)
}

await foundry.utils.benchmark(fn, 100)
await foundry.utils.benchmark(fn2, 100)
await foundry.utils.benchmark(fn3, 100)


*/

/* Resolution math

Assume 4000 x 3000 texture.

If resolution is 0.5 --> 2000 x 1500.

If texture resolution is 0.5 --> 2000 x 1500.

Combined ---> 1000 x 750. Which is 0.5 * 0.5 = 0.25.
*/


// Original function:
// function fastFixed(num, n) {
//   const pow10 = Math.pow(10,n);
//   return Math.round(num*pow10)/pow10; // roundFastPositive fails for very large numbers
// }

/**
 * Fix a number to 8 decimal places
 * @param {number} x    Number to fix
 * @returns {number}
 */
const POW10_8 = Math.pow(10, 8);
function fastFixed(x) {
  return Math.round(x * POW10_8) / POW10_8;
}


/**
 * Class representing a rectangular array of pixels, typically pulled from a texture.
 * The underlying rectangle is in canvas coordinates.
 */
export class PixelCache extends PIXI.Rectangle {
  /** @type {Uint8ClampedArray} */
  pixels = new Uint8ClampedArray(0);

  /** @type {number} */
  #localWidth = 0;

  /** @type {number} */
  #localHeight = 0;

  /** @type {PIXI.Rectangle} */
  localFrame = new PIXI.Rectangle();

  /** @type {number} */
  #maximumPixelValue = 255;

  /** @type {Map<number,PIXI.Rectangle>} */
  #thresholdLocalBoundingBoxes = new Map();

  /** @type {Map<number,PIXI.Rectangle>} */
  #thresholdCanvasBoundingBoxes = new Map();

  /**
   * @type {object}
   * @property {number} x           Translation in x direction
   * @property {number} y           Translation in y direction
   * @property {number} resolution  Ratio of pixels to canvas values.
   */
  scale = {
    resolution: 1
  };

  /** @type {Matrix} */
  #toLocalTransform;

  /** @type {Matrix} */
  #toCanvasTransform;

  /**
   * @param {number[]} pixels     Array of integer values.
   * @param {number} pixelWidth   The width of the pixel rectangle.
   * @param {object} [opts]       Optional translation
   * @param {number} [opts.x]           Starting left canvas coordinate
   * @param {number} [opts.y]           Starting top canvas coordinate
   * @param {number} [opts.resolution]  Ratio between pixel width and canvas width:
   *   pixel width * resolution = canvas width.
   */
  constructor(pixels, pixelWidth, { x = 0, y = 0, pixelHeight, resolution = 1 } = {}) {
    // Clean up pixel width and define pixel height if not already.
    const nPixels = pixels.length;
    pixelWidth = roundFastPositive(pixelWidth);
    pixelHeight ??= nPixels / pixelWidth;
    if ( !Number.isInteger(pixelHeight) ) {
      console.warn(`PixelCache pixelHeight is non-integer: ${pixelHeight}`);
      pixelHeight = Math.ceil(pixelHeight);
    }

    // Define the canvas rectangle.
    const invResolution = 1 / resolution;
    const canvasWidth = Math.ceil(pixelWidth * invResolution);
    const canvasHeight = Math.ceil(pixelHeight * invResolution);
    super(x, y, canvasWidth, canvasHeight);

    // Store values needed to translate between local and canvas coordinates.
    this.pixels = pixels;
    this.scale.resolution = resolution;
    this.scale.invResolution = invResolution;
    this.#localWidth = pixelWidth;
    this.#localHeight = pixelHeight;
    this.localFrame.width = this.#localWidth;
    this.localFrame.height = this.#localHeight;
  }

  /**
   * Test whether the pixel cache contains a specific canvas point.
   * See Tile.prototype.containsPixel
   * @param {number} x    Canvas x-coordinate
   * @param {number} y    Canvas y-coordinate
   * @param {number} [alphaThreshold=0.75]  Value required for the pixel to "count."
   * @returns {boolean}
   */
  containsPixel(x, y, alphaThreshold = 0.75) {
    // First test against the bounding box
    const bounds = this.getThresholdCanvasBoundingBox(alphaThreshold);
    if ( !bounds.contains(x, y) ) return false;

    // Next test a specific pixel
    const value = this.pixelAtCanvas(x, y);
    return value > (alphaThreshold * this.#maximumPixelValue);
  }

  /** @type {Matrix} */
  get toLocalTransform() {
    return this.#toLocalTransform ?? (this.#toLocalTransform = this._calculateToLocalTransform());
  }

  /** @type {Matrix} */
  get toCanvasTransform() {
    return this.#toCanvasTransform ?? (this.#toCanvasTransform = this.toLocalTransform.invert());
  }

  /** @type {number} */
  get maximumPixelValue() { return this.#maximumPixelValue; }

  /**
   * Reset transforms. Typically used when size or resolution has changed.
   */
  clearTransforms() {
    this.#toLocalTransform = undefined;
    this.#toCanvasTransform = undefined;
    this.#thresholdCanvasBoundingBoxes.clear();
  }

  /**
   * Clear the threshold bounding boxes. Should be rare, if ever, b/c these are local rects
   * based on supposedly unchanging pixels.
   */
  _clearLocalThresholdBoundingBoxes() {
    this.#thresholdCanvasBoundingBoxes.clear();
    this.#thresholdLocalBoundingBoxes.clear();
  }

  _clearCanvasThresholdBoundingBoxes() { this.#thresholdCanvasBoundingBoxes.clear(); }

  /**
   * Matrix that takes a canvas point and transforms to a local point.
   * @returns {Matrix}
   */
  _calculateToLocalTransform() {
    // Translate so top corner is at 0, 0
    const { x, y, scale } = this;
    const mTranslate = Matrix.translation(-x, -y);

    // Scale based on resolution.
    const resolution = scale.resolution;
    const mRes = Matrix.scale(resolution, resolution);

    // Combine the matrices
    return mTranslate.multiply3x3(mRes);
  }

  /**
   * Get a canvas bounding box based on a specific threshold.
   * @param {number} [threshold=0.75]   Values lower than this will be ignored around the edges.
   * @returns {PIXI.Rectangle} Rectangle based on local coordinates.
   */
  getThresholdLocalBoundingBox(threshold = 0.75) {
    const map = this.#thresholdLocalBoundingBoxes;
    if ( !map.has(threshold) ) map.set(threshold, this.#calculateLocalBoundingBox(threshold));
    return map.get(threshold);
  }

  /**
   * Get a canvas bounding polygon or box based on a specific threshold.
   * If you require a rectangle, use getThresholdLocalBoundingBox
   * @returns {PIXI.Rectangle|PIXI.Polygon}    Rectangle or polygon in canvas coordinates.
   */
  getThresholdCanvasBoundingBox(threshold = 0.75) {
    const map = this.#thresholdCanvasBoundingBoxes;
    if ( !map.has(threshold) ) map.set(threshold, this.#calculateCanvasBoundingBox(threshold));
    return map.get(threshold);
  }

  /**
   * Calculate a canvas bounding box based on a specific threshold.
   */
  #calculateCanvasBoundingBox(threshold=0.75) {
    const localRect = this.getThresholdLocalBoundingBox(threshold);

    const { left, right, top, bottom } = localRect;
    const TL = this._toCanvasCoordinates(left, top);
    const TR = this._toCanvasCoordinates(right, top);
    const BL = this._toCanvasCoordinates(left, bottom);
    const BR = this._toCanvasCoordinates(right, bottom);

    // Can the box be represented with a rectangle? Points must be horizontal and vertical.
    // Could also be rotated 90º
    if ( (TL.x.almostEqual(BL.x) && TL.y.almostEqual(TR.y))
      || (TL.x.almostEqual(TR.x) && TL.y.almostEqual(BL.y)) ) {
      const xMinMax = Math.minMax(TL.x, TR.x, BL.x, BR.x);
      const yMinMax = Math.minMax(TL.y, TR.y, BL.y, BR.y);
      return new PIXI.Rectangle(xMinMax.min, yMinMax.min, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
    }

    // Alternatively, represent as polygon, which allows for a tighter contains test.
    return new PIXI.Polygon(TL, TR, BR, BL);
  }


  /**
   * Calculate a bounding box based on a specific threshold.
   * @param {number} [threshold=0.75]   Values lower than this will be ignored around the edges.
   * @returns {PIXI.Rectangle} Rectangle based on local coordinates.
   */
  #calculateLocalBoundingBox(threshold=0.75) {
    // (Faster or equal to the old method that used one double non-breaking loop.)
    threshold = threshold * this.#maximumPixelValue;

    // By definition, the local frame uses 0 or positive integers. So we can use -1 as a placeholder value.
    const { left, right, top, bottom } = this.localFrame;
    let minLeft = -1;
    let maxRight = -1;
    let minTop = -1;
    let maxBottom = -1;

    // Test left side
    for ( let x = left; x <= right; x += 1 ) {
      for ( let y = top; y <= bottom; y += 1 ) {
        const a = this._pixelAtLocal(x, y);
        if ( a > threshold ) {
          minLeft = x;
          break;
        }
      }
      if ( ~minLeft ) break;
    }
    if ( !~minLeft ) return new PIXI.Rectangle();

    // Test right side
    for ( let x = right; x >= left; x -= 1 ) {
      for ( let y = top; y <= bottom; y += 1 ) {
        const a = this._pixelAtLocal(x, y);
        if ( a > threshold ) {
          maxRight = x;
          break;
        }
      }
      if ( ~maxRight ) break;
    }

    // Test top side
    for ( let y = top; y <= bottom; y += 1 ) {
      for ( let x = left; x <= right; x += 1 ) {
        const a = this._pixelAtLocal(x, y);
        if ( a > threshold ) {
          minTop = y;
          break;
        }
      }
      if ( ~minTop ) break;
    }

    // Test bottom side
    for ( let y = bottom; y >= top; y -= 1 ) {
      for ( let x = left; x <= right; x += 1 ) {
        const a = this._pixelAtLocal(x, y);
        if ( a > threshold ) {
          maxBottom = y;
          break;
        }
      }
      if ( ~maxBottom ) break;
    }

    return (new PIXI.Rectangle(minLeft, minTop, maxRight - minLeft, maxBottom - minTop));
  }

  _calculateCanvasBoundingBox(threshold=0.75) {
    return this.#calculateCanvasBoundingBox(threshold);
  }

  _calculateCanvasBoundingBox_Old(threshold=0.75) {
    threshold = threshold * this.#maximumPixelValue;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.POSITIVE_INFINITY;

    // Mapping pixels would be faster, but the different resolution, width/height, and scaleX, scaley
    // makes that inaccurate.
    // Possibly could map pixels and pad, if padding could be calculated correctly.
    const { left, right, top, bottom } = this.localFrame;
    for ( let x = left; x < right; x += 1 ) {
      for ( let y = top; y < bottom; y += 1 ) {
        const a = this._pixelAtLocal(x, y);
        if ( a > threshold ) {
          minX = Math.min(x, minX);
          minY = Math.min(y, minY);

          // Flip to handle the right side. Treat same as left side; move from end --> center.
          maxX = Math.min(1 - x, maxX);
          maxY = Math.min(1 - y, maxY);
        }
      }
    }

    // Flip back the right-side coordinates.
    maxX = 1 - maxX;
    maxY = 1 - maxY;

    // The maximums will be off by one.
    maxX += 1;
    maxY += 1;

    return (new PIXI.Rectangle(minX, minY, maxX - minX, maxY - minY)).normalize();
  }

  /**
   * Get the pixel index for a specific texture location
   * @param {number} x      Local texture x coordinate
   * @param {number} y      Local texture y coordinate
   * @returns {number}
   */
  _indexAtLocal(x, y) {
    if ( x < 0 || y < 0 || x >= this.#localWidth || y >= this.#localHeight ) return -1;

    // Use floor to ensure consistency when converting to/from coordinates <--> index.
    return ((~~y) * this.#localWidth) + (~~x);
    // Equivalent: return (roundFastPositive(y) * this.#localWidth) + roundFastPositive(x);
  }

  /**
   * Get the pixel index for a specific texture location
   * This floors the values.
   * @param {number} x      Local texture x coordinate
   * @param {number} y      Local texture y coordinate
   * @returns {number}
   */
  _flooredAtLocal(x, y) { return ((~~y) * this.#localWidth) + (~~x); }


  /**
   * Get the nearest neighbor for a specific texture location.
   * @param {number} x      Local texture x coordinate. Must be positive.
   * @param {number} y      Local texture y coordinate. Must be positive.
   * @returns {number}
   */
  _nearestAtLocal(x, y) {
    return (roundFastPositive(y) * this.#localWidth) + roundFastPositive(x);
  }

  /**
   * Calculate local coordinates given a pixel index.
   * Inverse of _indexAtLocal
   * @param {number} i    The index, corresponding to a pixel in the array.
   * @returns {PIXI.Point}
   */
  _localAtIndex(i) {
    const width = this.#localWidth;
    const col = i % width;
    const row = ~~(i / width); // Floor the row.
    return new PIXI.Point(col, row);
  }

  /**
   * Calculate the canvas coordinates for a specific pixel index
   * @param {number} i    The index, corresponding to a pixel in the array.
   * @returns {PIXI.Point}
   */
  _canvasAtIndex(i) {
    const local = this._localAtIndex(i);
    return this._toCanvasCoordinates(local.x, local.y);
  }

  /**
   * Get the pixel index for a specific texture location
   * @param {number} x      Canvas x coordinate
   * @param {number} y      Canvas y coordinate
   * @returns {number}
   */
  _indexAtCanvas(x, y) {
    const local = this._fromCanvasCoordinates(x, y);
    return this._indexAtLocal(local.x, local.y);
  }

  /**
   * Transform canvas coordinates into the local pixel rectangle coordinates.
   * @param {number} x    Canvas x coordinate
   * @param {number} y    Canvas y coordinate
   * @returns {PIXI.Point}
   */
  _fromCanvasCoordinates(x, y) {
    const pt = new PIXI.Point(x, y);
    const local = this.toLocalTransform.multiplyPoint2d(pt, pt);

    // Avoid common rounding errors, like 19.999999999998.
    local.x = fastFixed(local.x);
    local.y = fastFixed(local.y);
    return local;
  }

  /**
   * Transform local coordinates into canvas coordinates.
   * Inverse of _fromCanvasCoordinates
   * @param {number} x    Local x coordinate
   * @param {number} y    Local y coordinate
   * @returns {PIXI.Point}
   */
  _toCanvasCoordinates(x, y) {
    const pt = new PIXI.Point(x, y);
    const canvas = this.toCanvasTransform.multiplyPoint2d(pt, pt);

    // Avoid common rounding errors, like 19.999999999998.
    canvas.x = fastFixed(canvas.x);
    canvas.y = fastFixed(canvas.y);
    return canvas;
  }

  /**
   * Convert a ray to local texture coordinates
   * @param {Ray}
   * @returns {Ray}
   */
  _rayToLocalCoordinates(ray) {
    return new Ray(
      this._fromCanvasCoordinates(ray.A.x, ray.A.y),
      this._fromCanvasCoordinates(ray.B.x, ray.B.y));
  }

  /**
   * Convert a circle to local texture coordinates
   * @param {PIXI.Circle}
   * @returns {PIXI.Circle}
   */
  _circleToLocalCoordinates(circle) {
    const origin = this._fromCanvasCoordinates(circle.x, circle.y);

    // For radius, use two points of equivalent distance to compare.
    const radius = this._fromCanvasCoordinates(circle.radius, 0).x
      - this._fromCanvasCoordinates(0, 0).x;
    return new PIXI.Circle(origin.x, origin.y, radius);
  }

  /**
   * Convert an ellipse to local texture coordinates
   * @param {PIXI.Ellipse}
   * @returns {PIXI.Ellipse}
   */
  _ellipseToLocalCoordinates(ellipse) {
    const origin = this._fromCanvasCoordinates(ellipse.x, ellipse.y);

    // For halfWidth and halfHeight, use two points of equivalent distance to compare.
    const halfWidth = this._fromCanvasCoordinates(ellipse.halfWidth, 0).x
      - this._fromCanvasCoordinates(0, 0).x;
    const halfHeight = this._fromCanvasCoordinates(ellipse.halfHeight, 0).x
      - this._fromCanvasCoordinates(0, 0).x;
    return new PIXI.Ellipse(origin.x, origin.y, halfWidth, halfHeight);
  }

  /**
   * Convert a rectangle to local texture coordinates
   * @param {PIXI.Rectangle} rect
   * @returns {PIXI.Rectangle}
   */
  _rectangleToLocalCoordinates(rect) {
    const TL = this._fromCanvasCoordinates(rect.left, rect.top);
    const BR = this._fromCanvasCoordinates(rect.right, rect.bottom);
    return new PIXI.Rectangle(TL.x, TL.y, BR.x - TL.x, BR.y - TL.y);
  }

  /**
   * Convert a polygon to local texture coordinates
   * @param {PIXI.Polygon}
   * @returns {PIXI.Polygon}
   */
  _polygonToLocalCoordinates(poly) {
    const points = poly.points;
    const ln = points.length;
    const newPoints = Array(ln);
    for ( let i = 0; i < ln; i += 2 ) {
      const x = points[i];
      const y = points[i + 1];
      const local = this._fromCanvasCoordinates(x, y);
      newPoints[i] = local.x;
      newPoints[i + 1] = local.y;
    }
    return new PIXI.Polygon(newPoints);
  }

  /**
   * Convert a shape to local coordinates.
   * @param {PIXI.Rectangle|PIXI.Polygon|PIXI.Circle|PIXI.Ellipse} shape
   * @returns {PIXI.Rectangle|PIXI.Polygon|PIXI.Circle|PIXI.Ellipse}
   */
  _shapeToLocalCoordinates(shape) {
    if ( shape instanceof PIXI.Rectangle ) return this._rectangleToLocalCoordinates(shape);
    else if ( shape instanceof PIXI.Polygon ) return this._polygonToLocalCoordinates(shape);
    else if ( shape instanceof PIXI.Circle ) return this._circleToLocalCoordinates(shape);
    else if ( shape instanceof PIXI.Ellipse ) return this._ellipseToLocalCoordinates(shape);
    else console.error("applyFunctionToShape: shape not recognized.");
  }

  /**
   * Get a pixel value given local coordinates.
   * @param {number} x    Local x coordinate
   * @param {number} y    Local y coordinate
   * @returns {number}
   */
  _pixelAtLocal(x, y) { return this.pixels[this._indexAtLocal(x, y)]; }

  /**
   * Get a pixel value given canvas coordinates.
   * @param {number} x    Canvas x coordinate
   * @param {number} y    Canvas y coordinate
   * @returns {number}
   */
  pixelAtCanvas(x, y) { return this.pixels[this._indexAtCanvas(x, y)]; }

  /**
   * Trim a line segment to only the portion that intersects this cache bounds.
   * @param {Point} a     Starting location, in canvas coordinates
   * @param {Point} b     Ending location, in canvas coordinates
   * @param {number} alphaThreshold   Value of threshold, if threshold bounds should be used.
   * @returns {Point[2]|null} Points, in local coordinates.
   */
  _trimCanvasRayToLocalBounds(a, b, alphaThreshold) {
    const aLocal = this._fromCanvasCoordinates(a.x, a.y);
    const bLocal = this._fromCanvasCoordinates(b.x, b.y);
    return this._trimLocalRayToLocalBounds(aLocal, bLocal, alphaThreshold);
  }

  /**
   * Trim a line segment to only the portion that intersects this cache bounds.
   * @param {Point} a     Starting location, in local coordinates
   * @param {Point} b     Ending location, in local coordinates
   * @param {number} alphaThreshold   Value of threshold, if threshold bounds should be used.
   * @returns {Point[2]|null}  Points, in local coordinates
   */
  _trimLocalRayToLocalBounds(a, b, alphaThreshold) {
    const bounds = alphaThreshold ? this.getThresholdLocalBoundingBox(alphaThreshold) : this.localFrame;
    return trimLineSegmentToPixelRectangle(bounds, a, b);
  }

  // Convert a local point to canvas point, overwriting the local point.
  #localToCanvasInline(pt) {
    const canvasPt = this._toCanvasCoordinates(pt.x, pt.y);
    pt.x = canvasPt.x;
    pt.y = canvasPt.y;
    return pt;
  }

  // TODO: Combine the extraction functions so there is less repetition of code.

  /**
   * Extract all pixel values for a canvas ray.
   * @param {Point} a   Starting location, in local coordinates
   * @param {Point} b   Ending location, in local coordinates
   * @param {object} [opts]                 Optional parameters
   * @param {number} [opts.alphaThreshold]  Percent between 0 and 1, used to trim the pixel bounds
   * @param {number[]} [opts.localOffsets]  Numbers to add to the local x,y position when pulling the pixel(s)
   * @param {function} [opts.reducerFn]     Function that takes pixel array and reduces to a value or object to return
   * @returns {number[]}    The pixel values
   */
  _extractAllPixelValuesAlongCanvasRay(a, b, { alphaThreshold, localOffsets, reducerFn } = {}) {
    const localBoundsIx = this._trimCanvasRayToLocalBounds(a, b, alphaThreshold);
    if ( !localBoundsIx ) return []; // Ray never intersects the cache bounds.

    const pixels = this._extractAllPixelValuesAlongLocalRay(
      localBoundsIx[0], localBoundsIx[1], localOffsets, reducerFn);
    pixels.forEach(pt => this.#localToCanvasInline(pt));
    return pixels;
  }

  /**
   * Extract all pixel values for a local ray.
   * It is assumed, without checking, that a and be are within the bounds of the shape.
   * @param {Point} a   Starting location, in local coordinates
   * @param {Point} b   Ending location, in local coordinates
   * @param {number[]} [localOffsets]  Numbers to add to the local x,y position when pulling the pixel(s)
   * @param {function} [reducerFn]     Function that takes pixel array and reduces to a value or object to return
   * @returns {number[]}    The pixel values
   */
  _extractAllPixelValuesAlongLocalRay(a, b, localOffsets, reducerFn) {
    localOffsets ??= [0, 0];
    reducerFn ??= this.constructor.pixelAggregator("first");

    const bresPts = bresenhamLine(a.x, a.y, b.x, b.y);
    const nPts = bresPts.length;
    const pixels = Array(nPts * 0.5);
    for ( let i = 0, j = 0; i < nPts; i += 2, j += 1 ) {
      const x = bresPts[i];
      const y = bresPts[i + 1];
      const pixelsAtPoint = this._pixelsForRelativePointsFromLocal(x, y, localOffsets);
      const currPixel = reducerFn(pixelsAtPoint);
      pixels[j] = { x, y, currPixel };
    }
    return pixels;
  }

  /**
   * Extract all pixels values along a canvas ray that meet a test function.
   * @param {Point} a   Starting location, in canvas coordinates
   * @param {Point} b   Ending location, in canvas coordinates
   * @param {function} markPixelFn    Function to test pixels: (current pixel, previous pixel); returns true to mark
   * @param {object} [opts]                 Optional parameters
   * @param {number} [opts.alphaThreshold]  Percent between 0 and 1, used to trim the pixel bounds
   * @param {boolean} [opts.skipFirst]      Skip the first pixel if true
   * @param {boolean} [opts.forceLast]      Include the last pixel (at b) even if unmarked
   * @param {number[]} [opts.localOffsets]  Numbers to add to the local x,y position when pulling the pixel(s)
   * @param {function} [opts.reducerFn]     Function that takes pixel array and reduces to a value or object to return
   * @returns {object[]} Array of objects, each of which have:
   *   - {number} x           Canvas coordinates
   *   - {number} y           Canvas coordinates
   *   - {number} currPixel
   *   - {number} prevPixel
   */
  _extractAllMarkedPixelValuesAlongCanvasRay(a, b, markPixelFn,
    { alphaThreshold, skipFirst, forceLast, localOffsets, reducerFn } = {}) {
    const localBoundsIx = this._trimCanvasRayToLocalBounds(a, b, alphaThreshold);
    if ( !localBoundsIx ) return []; // Ray never intersects the cache bounds.

    const pixels = this._extractAllMarkedPixelValuesAlongLocalRay(
      localBoundsIx[0], localBoundsIx[1], markPixelFn, skipFirst, forceLast, localOffsets, reducerFn);
    pixels.forEach(pt => this.#localToCanvasInline(pt));
    return pixels;
  }

  /**
   * Extract all pixel values along a local ray that meet a test function.
   * @param {Point} a   Starting location, in local coordinates
   * @param {Point} b   Ending location, in local coordinates
   * @param {function} markPixelFn    Function to test pixels: (currentPixel, previousPixel); returns true to mark
   * @param {boolean} skipFirst       Skip the first pixel if true
   * @param {boolean} forceLast        Include the last pixel (at b) even if unmarked
   * @param {number[]} [localOffsets]  Numbers to add to the local x,y position when pulling the pixel(s)
   * @param {function} [reducerFn]     Function that takes pixel array and reduces to a value or object to return
   * @returns {object[]} Array of objects, each of which have:
   *   - {number} x           Local coordinates
   *   - {number} y           Local coordinates
   *   - {number} currPixel
   *   - {number} prevPixel
   */
  _extractAllMarkedPixelValuesAlongLocalRay(a, b, markPixelFn, skipFirst, forceLast, localOffsets, reducerFn) {
    skipFirst ??= false;
    forceLast ??= false;
    localOffsets ??= [0, 0];
    reducerFn ??= this.constructor.pixelAggregator("first");

    const bresPts = bresenhamLine(a.x, a.y, b.x, b.y);
    const pixels = [];
    let prevPixel;
    if ( skipFirst ) {
      const x = bresPts.shift();
      const y = bresPts.shift();
      if ( typeof y === "undefined" ) return pixels; // No more pixels!
      const pixelsAtPoint = this._pixelsForRelativePointsFromLocal(x, y, localOffsets);
      prevPixel = reducerFn(pixelsAtPoint);
    }

    const nPts = bresPts.length;
    for ( let i = 0; i < nPts; i += 2 ) {
      const x = bresPts[i];
      const y = bresPts[i + 1];
      const pixelsAtPoint = this._pixelsForRelativePointsFromLocal(x, y, localOffsets);
      const currPixel = reducerFn(pixelsAtPoint);
      if ( markPixelFn(currPixel, prevPixel) ) pixels.push({ currPixel, prevPixel, x, y });
      prevPixel = currPixel;
    }

    if ( forceLast ) {
      const x = bresPts.at(-2);
      const y = bresPts.at(-1);
      // Add the last pixel regardless.
      pixels.push({ currPixel: prevPixel, x, y, forceLast });
    }

    return pixels;
  }

  /**
   * Convenience function.
   * Extract the first pixel value along a canvas ray that meets a test function.
   * @param {Point} a   Starting location, in canvas coordinates
   * @param {Point} b   Ending location, in canvas coordinates
   * @param {function} markPixelFn    Function to test pixels.
   *   Function takes current pixel, previous pixel
   * @returns {object|null} If pixel found, returns:
   *   - {number} x           Canvas coordinate
   *   - {number} y           Canvas coordinate
   *   - {number} currPixel
   *   - {number} prevPixel
   */
  _extractNextMarkedPixelValueAlongCanvasRay(a, b, markPixelFn,
    { alphaThreshold, skipFirst, forceLast, localOffsets, reducerFn } = {}) {

    const localBoundsIx = this._trimCanvasRayToLocalBounds(a, b, alphaThreshold);
    if ( !localBoundsIx ) return []; // Ray never intersects the cache bounds.

    const pixel = this._extractNextMarkedPixelValueAlongLocalRay(
      localBoundsIx[0], localBoundsIx[1], markPixelFn, skipFirst, forceLast, localOffsets, reducerFn);
    if ( !pixel ) return pixel;
    this.#localToCanvasInline(pixel);
    return pixel;
  }

  /**
   * Extract the first pixel value along a local ray that meets a test function.
   * @param {Point} a   Starting location, in local coordinates
   * @param {Point} b   Ending location, in local coordinates
   * @param {function} markPixelFn    Function to test pixels.
   *   Function takes current pixel, previous pixel
   * @returns {object|null} If pixel found, returns:
   *   - {number} x         Local coordinate
   *   - {number} y         Local coordinate
   *   - {number} currPixel
   *   - {number} prevPixel
   */
  _extractNextMarkedPixelValueAlongLocalRay(a, b, markPixelFn, skipFirst, forceLast, localOffsets, reducerFn) {
    skipFirst ??= false;
    forceLast ??= false;
    localOffsets ??= [0, 0];
    reducerFn ??= this.constructor.pixelAggregator("first");

    const bresIter = bresenhamLineIterator(a.x, a.y, b.x, b.y);
    let prevPixel;
    let pt; // Needed to recall the last point for forceLast.
    if ( skipFirst ) {
      // Iterate over the first value
      pt = bresIter.next().value;
      if ( !pt ) return null; // No more pixels!
      const pixelsAtPoint = this._pixelsForRelativePointsFromLocal(pt.x, pt.y, localOffsets);
      prevPixel = reducerFn(pixelsAtPoint);
    }

    for ( pt of bresIter ) {
      const pixelsAtPoint = this._pixelsForRelativePointsFromLocal(pt.x, pt.y, localOffsets);
      const currPixel = reducerFn(pixelsAtPoint);
      if ( markPixelFn(currPixel, prevPixel) ) return { currPixel, prevPixel, x: pt.x, y: pt.y };
      prevPixel = currPixel;
    }

    if ( forceLast ) return { currPixel: prevPixel, x: pt.x, y: pt.y, forceLast }; // Might be repeat but this is faster than checking.

    return null;
  }

  /**
   * For a given location, retrieve a set of pixel values based on x/y differences
   * @param {number} x          The center x coordinate, in local coordinates
   * @param {number} y          The center y coordinate, in local coordinates
   * @param {number[]} offsets  Array of offsets: [x0, y0, x1, y1]
   * @returns {number|undefined[]} Array of pixels
   *   Each pixel is the value at x + x0, y + y0, ...
   */
  _pixelsForRelativePointsFromLocal(x, y, offsets) {
    offsets ??= [0, 0];
    const nOffsets = offsets.length;
    const out = new this.pixels.constructor(nOffsets * 0.5);
    for ( let i = 0, j = 0; i < nOffsets; i += 2, j += 1 ) {
      out[j] = this._pixelAtLocal(x + offsets[i], y + offsets[i + 1]);
    }
    return out;
  }

  /**
   * For a given canvas location, retrieve a set of pixel values based on x/y differences
   * @param {number} x          The center x coordinate, in local coordinates
   * @param {number} y          The center y coordinate, in local coordinates
   * @param {number[]} offsets  Array of offsets: [x0, y0, x1, y1]. Offsets are pixel values, in local
   * @returns {number|undefined[]} Array of pixels
   *   Each pixel is the value at x + x0, y + y0, ...
   */
  pixelsForRelativePointsFromCanvas(x, y, offsets) {
    const pt = this._fromCanvasCoordinates(x, y);
    return this._pixelsForRelativePointsFromLocal(pt.x, pt.y, offsets);
  }

  // Function to aggregate pixels. Must handle undefined pixels.

  /**
   * Utility method to construct a function that can aggregate pixel array generated from offsets
   * @param {string} type     Type of aggregation to perform
   *   - first: take the first value, which in the case of offsets will be [0,0]
   *   - min: Minimum pixel value, excluding undefined pixels.
   *   - max: Maximum pixel value, excluding undefined pixels
   *   - sum: Add pixels. Returns object with total, numUndefined, numPixels.
   *   - countThreshold: Count pixels greater than a threshold.
   *     Returns object with count, numUndefined, numPixels, threshold.
   * @param {number} [threshold]    Optional pixel value used by "count" methods
   * @returns {function}
   */
  static pixelAggregator(type, threshold = -1) {
    let reducerFn;
    let startValue;
    switch ( type ) {
      case "first": return pixels => pixels[0];
      case "min": {
        reducerFn = (acc, curr) => {
          if ( typeof curr === "undefined" ) return acc;
          return Math.min(acc, curr);
        };
        break;
      }
      case "max": {
        reducerFn = (acc, curr) => {
          if ( typeof curr === "undefined" ) return acc;
          return Math.min(acc, curr);
        };
        break;
      }
      case "sum": {
        startValue = { numUndefined: 0, numPixels: 0, total: 0 };
        reducerFn = (acc, curr) => {
          acc.numPixels += 1;
          if ( typeof curr === "undefined" ) acc.numUndefined += 1;
          else acc.total += curr;
          return acc;
        };
        break;
      }
      case "countThreshold": {
        startValue = { numUndefined: 0, numPixels: 0, threshold, count: 0 };
        reducerFn = (acc, curr) => {
          acc.numPixels += 1;
          if ( typeof curr === "undefined" ) acc.numUndefined += 1;
          else if ( curr > acc.threshold ) acc.count += 1;
          return acc;
        };
        break;
        // TODO: Do we need to re-zero the start values if called repeatedly?
      }
    }

    const reducePixels = this.reducePixels;
    return pixels => reducePixels(pixels, reducerFn, startValue);
  }

  /**
   * Version of array.reduce that improves speed and handles some unique cases.
   * @param {number[]} pixels
   * @param {function} reducerFn      Function that takes accumulated values and current value
   *   If startValue is undefined, the first acc will be pixels[0]; the first curr will be pixels[1].
   * @param {object} startValue
   * @returns {object} The object returned by the reducerFn
   */
  static reducePixels(pixels, reducerFn, startValue) {
    const numPixels = pixels.length;
    if ( numPixels < 2 ) return pixels[0];

    if ( reducerFn.initialize ) reducerFn.initialize();
    let acc = startValue;
    let startI = 0;
    if ( typeof startValue === "undefined" ) {
      acc = pixels[0];
      startI = 1;
    }
    for ( let i = startI; i < numPixels; i += 1 ) {
      const curr = pixels[i];
      acc = reducerFn(acc, curr);
    }
    return acc;
  }

  static pixelOffsets(shape, skip = 0) {
    if ( shape instanceof PIXI.Rectangle ) return this.rectanglePixelOffsets(shape, skip);
    if ( shape instanceof PIXI.Polygon ) return this.polygonPixelOffsets(shape, skip);
    if ( shape instanceof PIXI.Circle ) return this.shapePixelOffsets(shape, skip);
    console.warn("PixelCache|pixelOffsets|shape not recognized.", shape);
    return this.polygonPixelOffsets(shape.toPolygon(), skip);
  }

  /**
   * For a rectangle, construct an array of pixel offsets from the center of the rectangle.
   * @param {PIXI.Rectangle} rect
   * @returns {number[]}
   */
  static rectanglePixelOffsets(rect, skip = 0) {
    /* Example
    Draw = CONFIG.GeometryLib.Draw
    api = game.modules.get("elevatedvision").api
    PixelCache = api.PixelCache

    rect = new PIXI.Rectangle(100, 200, 275, 300)
    offsets = PixelCache.rectanglePixelOffsets(rect, skip = 10)

    tmpPt = new PIXI.Point;
    center = rect.center;
    for ( let i = 0; i < offsets.length; i += 2 ) {
      tmpPt.copyFrom({ x: offsets[i], y: offsets[i + 1] });
      tmpPt.translate(center.x, center.y, tmpPt);
      Draw.point(tmpPt, { radius: 1 })
      if ( !rect.contains(tmpPt.x, tmpPt.y) )
        console.debug(`Rectangle does not contain {tmpPt.x},${tmpPt.y} (${offsets[i]},${offsets[i+1]})`)
    }
    Draw.shape(rect)

    */

    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    const incr = skip + 1;
    const w_1_2 = Math.floor(width * 0.5);
    const h_1_2 = Math.floor(height * 0.5);
    const xiMax = width - w_1_2;
    const yiMax = height - h_1_2;

    // Handle 0 row and 0 column. Add only if it would have been added by the increment or half increment.
    const addZeroX = ((xiMax - 1) % (Math.ceil(incr * 0.5))) === 0;
    const addZeroY = ((yiMax - 1) % (Math.ceil(incr * 0.5))) === 0;

    // Faster to pre-allocate the array, although the math is hard.
    const xMod = Boolean((xiMax - 1) % incr);
    const yMod = Boolean((yiMax - 1) % incr);
    const numX = (xiMax < 2) ? 0 : Math.floor((xiMax - 1) / incr) + xMod;
    const numY = (yiMax < 2) ? 0 : Math.floor((yiMax - 1) / incr) + yMod;
    const total = (numX * numY * 4 * 2) + (addZeroX * 4 * numY) + (addZeroY * 4 * numX) + 2;
    const offsets = new Array(total);

    // To make skipping pixels work well, set up so it always captures edges and corners
    // and works its way in.
    // And always add the 0,0 point.
    offsets[0] = 0;
    offsets[1] = 0;
    offsets._centerPoint = rect.center; // Helpful when processing pixel values later.
    let j = 2;
    for ( let xi = xiMax - 1; xi > 0; xi -= incr ) {
      for ( let yi = yiMax - 1; yi > 0; yi -= incr ) {
        offsets[j++] = xi;
        offsets[j++] = yi;
        offsets[j++] = -xi;
        offsets[j++] = yi;
        offsets[j++] = -xi;
        offsets[j++] = -yi;
        offsets[j++] = xi;
        offsets[j++] = -yi;


//         offsets.push(
//           xi, yi,     // BL quadrant
//           -xi, yi,    // BR quadrant
//           -xi, -yi,   // TL quadrant
//           xi, -yi     // TR quadrant
//         );
      }
    }

    // Handle 0 row and 0 column. Add only if it would have been added by the increment or half increment.
    if ( addZeroX ) {
      for ( let yi = yiMax - 1; yi > 0; yi -= incr ) {
        offsets[j++] = 0;
        offsets[j++] = yi;
        offsets[j++] = 0;
        offsets[j++] = -yi;
        //offsets.push(0, yi, 0, -yi);
      }
    }

    if ( addZeroY ) {
      for ( let xi = xiMax - 1; xi > 0; xi -= incr ) {
        offsets[j++] = xi;
        offsets[j++] = 0;
        offsets[j++] = -xi;
        offsets[j++] = 0;
        // offsets.push(xi, 0, -xi, 0);
      }
    }

    // if ( offsets.length !== total ) console.error(`rectanglePixelOffsets failed for ${xiMax}, ${yiMax}, ${incr}`);

    return offsets;
  }

  // For checking that offsets are not repeated:
  //   s = new Set();
  //   pts = []
  //   for ( let i = 0; i < offsets.length; i += 2 ) {
  //     pt = new PIXI.Point(offsets[i], offsets[i + 1]);
  //     pts.push(pt)
  //     s.add(pt.key)
  //   }

  /**
   * For a polygon, construct an array of pixel offsets from the bounds center.
   * Uses a faster multiple contains test specific to PIXI.Polygon.
   * @param {PIXI.Rectangle} poly
   * @param {number} skip
   * @returns {number[]}
   */
  static polygonPixelOffsets(poly, skip = 0) {
    /* Example
    poly = new PIXI.Polygon({x: 100, y: 100}, {x: 200, y: 100}, {x: 150, y: 300});
    offsets = PixelCache.polygonPixelOffsets(poly, skip = 10)
    tmpPt = new PIXI.Point;
    center = poly.getBounds().center;
    for ( let i = 0; i < offsets.length; i += 2 ) {
      tmpPt.copyFrom({ x: offsets[i], y: offsets[i + 1] });
      tmpPt.translate(center.x, center.y, tmpPt);
      Draw.point(tmpPt, { radius: 1 })
      if ( !poly.contains(tmpPt.x, tmpPt.y) )
        console.debug(`Poly does not contain {tmpPt.x},${tmpPt.y} (${offsets[i]},${offsets[i+1]})`)
    }
    Draw.shape(poly)
    */
    const bounds = poly.getBounds();
    const { x, y } = bounds.center;
    const offsets = this.rectanglePixelOffsets(bounds, skip);
    const nOffsets = offsets.length;
    const testPoints = new Array(offsets.length);
    for ( let i = 0; i < nOffsets; i += 2 ) {
      testPoints[i] = x + offsets[i];
      testPoints[i + 1] = y + offsets[i + 1];
    }
    const isContained = this.polygonMultipleContains(poly, testPoints);
    const polyOffsets = []; // Unclear how many pixels until we test containment.
    polyOffsets._centerPoint = offsets._centerPoint;
    for ( let i = 0, j = 0; i < nOffsets; i += 2 ) {
      if ( isContained[j++] ) polyOffsets.push(offsets[i], offsets[i + 1]);
    }
    return polyOffsets;
  }

  /**
   * For an arbitrary shape with contains and bounds methods,
   * construct a grid of pixels from the bounds center that are within the shape.
   * @param {object} shape      Shape to test
   * @param {number} [skip=0]   How many pixels to skip when constructing the grid
   * @returns {number[]}
   */
  static shapePixelOffsets(shape, skip = 0) {
    const bounds = shape.getBounds();
    const { x, y } = bounds.center;
    const offsets = this.rectanglePixelOffsets(bounds, skip);
    const nOffsets = offsets.length;
    const shapeOffsets = []; // Unclear how many pixels until we test containment.
    shapeOffsets._centerPoint = offsets._centerPoint;
    for ( let i = 0; i < nOffsets; i += 2 ) {
      const xOffset = offsets[i];
      const yOffset = offsets[i + 1];
      if ( shape.contains(x + xOffset, y + yOffset) ) shapeOffsets.push(xOffset, yOffset);
    }
    return shapeOffsets;
  }

  /**
   * Run contains test on a polygon for multiple points.
   * @param {PIXI.Polygon} poly
   * @param {number[]} testPoints     Array of [x0, y0, x1, y1,...] coordinates
   * @returns {number[]} Array of 0 or 1 values
   */
  static polygonMultipleContains(poly, testPoints) {
    // Modification of PIXI.Polygon.prototype.contains
    const nPoints = testPoints.length;
    if ( nPoints < 2 ) return undefined;
    const res = new Uint8Array(nPoints * 0.5); // If we really need speed, could use bit packing
    const r = poly.points.length / 2;
    for ( let n = 0, o = r - 1; n < r; o = n++ ) {
      const a = poly.points[n * 2];
      const h = poly.points[(n * 2) + 1];
      const l = poly.points[o * 2];
      const c = poly.points[(o * 2) + 1];

      for ( let i = 0, j = 0; i < nPoints; i += 2, j += 1 ) {
        const x = testPoints[i];
        const y = testPoints[i + 1];
        h > y != c > y && x < (l - a) * ((y - h) / (c - h)) + a && (res[j] = !res[j])
      }
    }
    return res;
  }



  /**
   * Extract pixel values for a line by transforming to a Bresenham line.
   * The line will be intersected with the pixel cache bounds.
   * Points outside the bounds will be given null values.
   * @param {Point} a                       Starting coordinate
   * @param {Point} b                       Ending coordinate
   * @param {object} [opts]                 Optional parameters
   * @param {number} [opts.alphaThreshold]  Percent between 0 and 1.
   *   If defined, a and b will be intersected at the alpha boundary.
   * @param {number} [opts.skip]            How many pixels to skip along the walk
   * @param {function} [opts.markPixelFn]   Function to mark pixels along the walk.
   *   Function takes prev, curr, idx, and maxIdx; returns boolean. True if pixel should be marked.
   * @returns {object|null}  If the a --> b never overlaps the rectangle, then null.
   *   Otherwise, object with:
   *   - {number[]} coords: bresenham path coordinates between the boundsIx. These are in local coordinates.
   *   - {number[]} pixels: pixels corresponding to the path
   *   - {Point[]}  boundsIx: the intersection points with this frame
   *   - {object[]} markers: If markPixelFn, the marked pixel information.
   *      Object has x, y, currPixel, prevPixel, tLocal (% of total)
   */
  pixelValuesForLine(a, b, { alphaThreshold, skip = 0, markPixelFn } = {}) {
    const aLocal = this._fromCanvasCoordinates(a.x, a.y);
    const bLocal = this._fromCanvasCoordinates(b.x, b.y);

    // Find the points within the bounds (or alpha bounds) of this cache.
    const bounds = alphaThreshold ? this.getThresholdLocalBoundingBox(alphaThreshold) : this.localFrame;
    const localBoundsIx = trimLineSegmentToPixelRectangle(bounds, aLocal, bLocal);
    if ( !localBoundsIx ) return null; // Segment never intersects the cache bounds.

    const out = this._pixelValuesForLocalLine(localBoundsIx[0], localBoundsIx[1], markPixelFn, skip);
    out.localBoundsIx = localBoundsIx;
    out.canvasBoundsIx = localBoundsIx.map(pt => this._toCanvasCoordinates(pt.x, pt.y)); // Used by TravelElevationRay
    out.skip = skip; // All coords are returned but only some pixels if skip ≠ 0.
    return out;
  }

  /**
   * Retrieve the pixel values (along the local bresenham line) between two points.
   * @param {Point} a           Start point, in canvas coordinates
   * @param {Point} b           End point, in canvas coordinates
   * @param {number} [skip=0]   How many pixels to skip along the walk
   * @returns {object}
   *  - {number[]} coords     Local pixel coordinates, in [x0, y0, x1, y1]
   *  - {number[]} pixels     Pixel value at each coordinate
   *  - {object[]} markers    Pixels that meet the markPixelFn, if any
   */
  _pixelValuesForLocalLine(a, b, markPixelFn, skip = 0) {
    const coords = bresenhamLine(a.x, a.y, b.x, b.y);
    const jIncr = skip + 1;
    return markPixelFn
      ? this.#markPixelsForLocalCoords(coords, jIncr, markPixelFn, a, b)
      : this.#pixelValuesForLocalCoords(coords, jIncr);
  }

  /**
   * Retrieve pixel values for coordinate set at provided intervals.
   * @param {number[]} coords   Coordinate array, in [x0, y0, x1, y1, ...] for which to pull pixels.
   * @param {number} jIncr      How to increment the walk over the pixels (i.e., skip?)
   * @returns {object}
   *  - {number[]} coords     Local pixel coordinates, in [x0, y0, x1, y1]
   *  - {number[]} pixels     Pixel value at each coordinate
   */
  #pixelValuesForLocalCoords(coords, jIncr) {
    const nCoords = coords.length;
    const width = this.#localWidth;
    const iIncr = jIncr * 2;
    const pixels = new this.pixels.constructor(nCoords * 0.5 * (1 / jIncr));
    for ( let i = 0, j = 0; i < nCoords; i += iIncr, j += jIncr ) {
      // No need to floor the coordinates b/c already done in bresenham.
      const x = coords[i];
      const y = coords[i + 1];
      const idx = (y * width) + x;
      pixels[j] = this.pixels[idx];
    }
    return { coords, pixels };
  }

  /**
   * Retrieve pixel values for coordinate set at provided intervals.
   * Also mark pixel values along the walk, based on some test function.
   * @param {number[]} coords       Coordinate array, in [x0, y0, x1, y1, ...] for which to pull pixels.
   * @param {number} jIncr          How to increment the walk over the pixels (i.e., skip?)
   * @param {function} markPixelFn  Function to mark pixels along the walk.
   * @returns {object}
   *  - {number[]} coords     Local pixel coordinates, in [x0, y0, x1, y1]
   *  - {object[]} markers    Pixels that meet the markPixelFn
   */
  #markPixelsForLocalCoords(coords, jIncr, markPixelFn, start, end) {
    const nCoords = coords.length;
    const nCoordsInv = 1 / (nCoords - 2);
    const markers = [];
    const markerOpts = PixelMarker.calculateOptsFn(this, coords);
    const startingMarker = new PixelMarker(0, start, end, markerOpts(0));
    markers.push(startingMarker);

    // Cycle over the coordinates, adding new markers whenever the markPixelFn test is met.
    let prevMarker = startingMarker;
    let prevPixel = startingMarker.options.currPixel;
    const iIncr = jIncr * 2;
    for ( let i = iIncr; i < nCoords; i += iIncr) {
      const opts = markerOpts(i);
      if ( markPixelFn(prevPixel, opts.currPixel, i, nCoords) ) {
        const t = i * nCoordsInv;
        opts.prevPixel = prevPixel;
        prevMarker = prevMarker._addSubsequentMarkerFast(t, opts);
        markers.push(prevMarker);
      }
      prevPixel = opts.currPixel;
    }

    // Add an end marker if not already done.
    if ( prevMarker.t !== 1 ) {
      const opts = markerOpts(nCoords - 2);
      opts.prevPixel = prevPixel;
      const endingMarker = prevMarker._addSubsequentMarkerFast(1, opts);
      markers.push(endingMarker);
    }

    return { coords, markers };
  }

  // Use the new pixel offsets to calculate average, percent, total.
  _aggregation(shape, skip, reducerFn) {
    const localShape = this._shapeToLocalCoordinates(shape);
    const offsets = this.constructor.pixelOffsets(localShape, skip);
    const localBounds = localShape instanceof PIXI.Rectangle ? localShape : localShape.getBounds();
    const { x, y } = localBounds.center;
    const pixels = this._pixelsForRelativePointsFromLocal(x, y, offsets);
    return reducerFn(pixels);
  }

  total2(shape, skip) {
    const reducerFn = this.constructor.pixelAggregator("sum");
    const aggregation = this._aggregation(shape, skip, reducerFn);
    return aggregation.total;
  }

  average2(shape, skip) {
    const reducerFn = this.constructor.pixelAggregator("sum");
    const aggregation = this._aggregation(shape, skip, reducerFn);
    return aggregation.total / (aggregation.numPixels - aggregation.numUndefined);
  }

  count2(shape, threshold, skip) {
    const reducerFn = this.constructor.pixelAggregator("countThreshold", threshold);
    return this._aggregation(shape, skip, reducerFn);
  }

  /**
   * Calculate the average pixel value, over an optional framing shape.
   * @param {object} [options]        Options that affect the calculation
   * @param {PIXI.Rectangle|PIXI.Polygon} [options.shape]  Shape, in canvas coordinates,
   *   over which to average the pixels
   * @param {number} [options.skip=1]         Skip every N pixels in the frame. 1 means test them all.
   *                                          Should be an integer greater than 0 (this is not checked).
   * @returns {number}
   */
  average(shape, skip) {
    const { sum, denom } = this.total(shape, skip);
    return sum / denom;
  }

  percent(shape, threshold, skip) {
    const { sum, denom } = this.count(shape, threshold, skip);
    return sum / denom;
  }


  total(shape, skip = 1) {
    const averageFn = PixelCache.averageFunction();
    const denom = this.applyFunctionToShape(averageFn, shape, skip);
    return { sum: averageFn.sum, denom };
  }

  count(shape, threshold, skip = 1) {
    const countFn = PixelCache.countFunction(threshold);
    const denom = this.applyFunctionToShape(countFn, shape, skip);
    return { sum: countFn.sum, denom };
  }

  static countFunction(threshold) {
    const countFn = value => {
      if ( value > threshold ) countFn.sum += 1;
    };
    countFn.sum = 0;
    return countFn;
  }

  static averageFunction() {
    const averageFn = value => averageFn.sum += value;
    averageFn.sum = 0;
    return averageFn;
  }

  static maxFunction() {
    const maxFn = value => maxFn.max = Math.max(maxFn.max, value);
    maxFn.max = Number.NEGATIVE_INFINITY;
    return maxFn;
  }

  /**
   * Apply a function to each pixel value.
   * @param {function} fn             Function to apply. Passed the pixel and the index.
   * @param {PIXI.Rectangle} [frame]  Optional frame to limit the pixels to which the function applies.
   *                                  Frame is in local coordinates
   * @returns {number}  Number of pixels to which the function was applied.
   */
  _applyFunction(fn, localFrame, skip=1) {
    // Don't go outside the cache frame
    localFrame = localFrame ? this.localFrame.intersection(localFrame) : this.localFrame;

    // Somewhat counter-intuitively, this can be faster than
    // just looping straight through the points, probably because by centering,
    // it often hits less points.

    // Test each local coordinate.
    // Center, such that skipping builds a grid out from the center point.
    const { left, top, right, bottom, width, height } = localFrame;
    const midX = left + (width * 0.5);
    const midY = top + (height * 0.5);

    // Test from the center in each direction, avoiding repeats.
    const xDec = midX - skip;
    const yDec = midY - skip;

    let denom = 0;
    for ( let ptX = midX; ptX < right; ptX += skip ) {
      for ( let ptY = midY; ptY < bottom; ptY += skip ) {
        const px = this._indexAtLocal(ptX, ptY);
        const value = this.pixels[px];
        fn(value, px, ptX, ptY);
        denom += 1;
      }

      for ( let ptY = yDec; ptY > top; ptY -= skip ) {
        const px = this._indexAtLocal(ptX, ptY);
        const value = this.pixels[px];
        fn(value, px, ptX, ptY);
        denom += 1;
      }
    }

    for ( let ptX = xDec; ptX > left; ptX -= skip ) {
      for ( let ptY = midY; ptY < bottom; ptY += skip ) {
        const px = this._indexAtLocal(ptX, ptY);
        const value = this.pixels[px];
        fn(value, px, ptX, ptY);
        denom += 1;
      }

      for ( let ptY = yDec; ptY > top; ptY -= skip ) {
        const px = this._indexAtLocal(ptX, ptY);
        const value = this.pixels[px];
        fn(value, px, ptX, ptY);
        denom += 1;
      }
    }

    return denom;
  }

  /**
   * Apply a function to each pixel value contained within a shape.
   * @param {function} fn             Function to apply. Passed the pixel and the index.
   * @param {PIXI.Rectangle} shape    Shape to limit the pixels to which the function applies.
   *                                  Shape is in canvas coordinates
   * @returns {number} Total number of pixels to which the function applied.
   */
  applyFunctionToShape(fn, shape, skip) {
    // Shift the shape to texture coordinates; likely faster than converting each pixel to canvas.
    shape = this._shapeToLocalCoordinates(shape);
    return this._applyFunctionToLocalShape(fn, shape, skip);
  }

  _applyFunctionToLocalShape(fn, localShape, skip) {
    // If shape is a rectangle, no need to test containment.
    if ( localShape instanceof PIXI.Rectangle ) return this._applyFunction(fn, localShape, skip);

    // Track number of pixels contained within the shape.
    let denom = 0;
    const shapeFn = (value, i, localX, localY) => {
      if ( localShape.contains(localX, localY) ) {
        denom += 1;
        fn(value, i, localX, localY);
      }
    };
    this._applyFunction(shapeFn, localShape.getBounds(), skip);
    return denom;
  }

  /**
   * Locate the next value along a local ray that crosses this pixel cache that meets a comparison test.
   * @param {Ray} ray           Ray, in local coordinates
   * @param {function} cmp      Function that takes a value and returns true if the iteration should stop
   * @param {object} [options]  Options to indicate how the ray should be traversed
   * @param {number} [options.stepT]    How far to jump along the ray between tests of the function.
   *                                    Between 0 and 1.
   * @param {number} [options.startT]   Where along the ray to start, where 0 means A endpoint
   *                                    and 1 is the B endpoint
   * @returns {Point}   Point, with t0 set to the t value along the ray.
   */
  nextPixelValueAlongCanvasRay(ray, cmp, { stepT = 0.1, startT = stepT, spacer, frame, skip, countFn } = {}) {
    const localRay = this._rayToLocalCoordinates(ray);
    let foundPt;
    if ( frame ) {
      countFn ??= PixelCache.averageFunction();
      frame = this._shapeToLocalCoordinates(frame);
      foundPt = this._nextPixelValueAlongLocalRayFrame(localRay, cmp, frame, countFn, skip, stepT, startT);
    } else if ( spacer ) {
      spacer = PIXI.Point.distanceBetween( this._fromCanvasCoordinates(0, 0), this._fromCanvasCoordinates(spacer, 0));
      foundPt = this._nextPixelValueAlongLocalRaySpacer(localRay, cmp, spacer, stepT, startT);
    } else foundPt = this._nextPixelValueAlongLocalRay(localRay, cmp, stepT, startT);

    if ( foundPt ) {
      const t0 = foundPt.t0;
      const value = foundPt.value;
      foundPt = this._toCanvasCoordinates(foundPt.x, foundPt.y);
      foundPt.t0 = t0;
      foundPt.value = value;
    }
    return foundPt;
  }

  /**
   * Locate the next value along a local ray that crosses this pixel cache that meets a comparison test.
   * @param {Ray} ray           Ray, in local coordinates
   * @param {function} cmp      Function that takes a value and returns true if the iteration should stop
   * @param {object} [options]  Options to indicate how the ray should be traversed
   * @param {number} [options.stepT]    How far to jump along the ray between tests of the function.
   *                                    Between 0 and 1.
   * @param {number} [options.startT]   Where along the ray to start, where 0 means A endpoint
   *                                    and 1 is the B endpoint
   *
   * @returns {Point}   Point, with t0 set to the t value along the ray.
   */
  _nextPixelValueAlongLocalRay(localRay, cmp, stepT = 0.1, startT = stepT) {
    // Step along the ray until we hit the threshold
    let t = startT;
    while ( t <= 1 ) {
      const pt = localRay.project(t);
      const value = this._pixelAtLocal(pt.x, pt.y);
      if ( cmp(value) ) {
        pt.t0 = t;
        pt.value = value;
        return pt;
      }
      t += stepT;
    }
    return null;
  }

  _nextPixelValueAlongLocalRaySpacer(localRay, cmp, spacer = 1, stepT = 0.1, startT = stepT) {
    const localFrame = this.localFrame;

    // Step along the ray until we hit the threshold
    let t = startT;
    while ( t <= 1 ) {
      const pt = localRay.project(t);
      const testPoints = [
        pt,
        { x: pt.x - spacer, y: pt.y },
        { x: pt.x + spacer, y: pt.y },
        { x: pt.x, y: pt.y - spacer },
        { x: pt.x, y: pt.y + spacer }];

      for ( const pt of testPoints ) {
        if ( !localFrame.contains(pt.x, pt.y) ) continue;
        const value = this._pixelAtLocal(pt.x, pt.y);
        if ( cmp(value) ) {
          pt.t0 = t;
          pt.value = value;
          return pt;
        }
      }

      t += stepT;
    }
    return null;
  }

  _nextPixelValueAlongLocalRayFrame(ray, cmp, localFrame, countFn, skip = 1, stepT = 0.1, startT = stepT) {
    // Step along the ray until we hit the threshold
    // Each point assumed to be the center of the frame.
    const center = localFrame.center;

    // Step along the ray in stepT increments, starting at startT.
    let t = startT;
    while ( t <= 1 ) {
      // Center the frame over the point on the ray.
      const pt = ray.project(t);
      const dx = pt.x - center.x;
      const dy = pt.y - center.y;
      const testFrame = localFrame.translate(dx, dy);

      // Calculate the average pixel value in the frame.
      countFn.sum = 0;
      const denom = this._applyFunctionToLocalShape(countFn, testFrame, skip);
      const value = countFn.sum / denom;

      // Return the point if the comparison function is met.
      if ( cmp(value) ) {
        pt.t0 = t;
        pt.value = value;
        return pt;
      }
      t += stepT;
    }
    return null;
  }

  /**
   * Find the points at which a pixel cache boundary intersects a ray,
   * given a specific threshold defining the boundary.
   * @param {Ray} ray             The ray to test against the boundary, in canvas coordinates.
   * @param {number} threshold    Threshold for the boundary.
   * @returns {Point[]}  Points. Intersection positions along ray will be marked with t0,
   *   where t0 = 0 is endpoint A and t0 = 1 is endpoint B.
   */
  rayIntersectsBoundary(ray, threshold = 0.75) {
    const { A, B } = ray;
    const a = this._fromCanvasCoordinates(A.x, A.y);
    const b = this._fromCanvasCoordinates(B.x, B.y);
    const localBounds = this.getThresholdLocalBoundingBox(threshold);
    const CSZ = PIXI.Rectangle.CS_ZONES;
    const ixs = localBounds.segmentIntersections(a, b);

    // Return the intersections to canvas coordinates.
    ixs.map(ix => {
      const canvasIx = this._toCanvasCoordinates(ix.x, ix.y);
      ix.x = canvasIx.x;
      ix.y = canvasIx.y;
      return ix;
    });

    return {
      aInside: localBounds._getZone(a) === CSZ.INSIDE,
      bInside: localBounds._getZone(b) === CSZ.INSIDE,
      ixs
    };
  }

  /**
   * Construct a pixel cache from a texture.
   * Will automatically adjust the resolution of the pixel cache based on the texture resolution.
   * @param {PIXI.Texture} texture      Texture from which to pull pixel data
   * @param {object} [options]          Options affecting which pixel data is used
   * @param {PIXI.Rectangle} [options.frame]    Optional rectangle to trim the extraction
   * @param {number} [options.resolution=1]     At what resolution to pull the pixels
   * @param {number} [options.x=0]              Move the texture in the x direction by this value
   * @param {number} [options.y=0]              Move the texture in the y direction by this value
   * @param {number} [options.channel=0]        Which RGBA channel, where R = 0, A = 3.
   * @param {function} [options.scalingMethod=PixelCache.nearestNeighborScaling]
   * @param {function} [options.combineFn]      Function to combine multiple channels of pixel data.
   *   Will be passed the r, g, b, and a channels.
   * @param {TypedArray} [options.arrayClass]        What array class to use to store the resulting pixel values
   * @returns {PixelCache}
   */
  static fromTexture(texture, opts = {}) {
    const { pixels, x, y, width, height } = extractPixels(canvas.app.renderer, texture, opts.frame);
    const combinedPixels = opts.combineFn ? this.combinePixels(pixels, opts.combineFn, opts.arrayClass) : pixels;

    opts.x ??= 0;
    opts.y ??= 0;
    opts.resolution ??= 1;
    opts.channel ??= 0;
    opts.scalingMethod ??= this.nearestNeighborScaling;
    const arr = opts.scalingMethod(combinedPixels, width, height, opts.resolution, {
      channel: opts.channel,
      skip: opts.combineFn ? 1 : 4,
      arrayClass: opts.arrayClass });

    opts.x += x;
    opts.y += y;
    opts.resolution *= texture.resolution;
    opts.pixelHeight = height;
    return new this(arr, width, opts);
  }

  /**
   * Combine pixels using provided method.
   * @param {number[]} pixels       Array of pixels to consolidate. Assumed 4 channels.
   * @param {function} combineFn    Function to combine multiple channels of pixel data.
   *   Will be passed the r, g, b, and a channels.
   * @param {TypedArray} [options.arrayClass]        What array class to use to store the resulting pixel values
   */
  static combinePixels(pixels, combineFn, arrayClass = Float32Array) {
    const numPixels = pixels.length;
    if ( numPixels % 4 !== 0 ) {
      console.error("fromTextureChannels requires a texture with 4 channels.");
      return pixels;
    }

    const combinedPixels = new arrayClass(numPixels * 0.25);
    for ( let i = 0, j = 0; i < numPixels; i += 4, j += 1 ) {
      combinedPixels[j] = combineFn(pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]);
    }
    return combinedPixels;
  }

  /**
   * Consider the nearest neighbor when upscaling or downscaling a texture pixel array.
   * Average together.
   * See https://towardsdatascience.com/image-processing-image-scaling-algorithms-ae29aaa6b36c.
   * @param {number[]} pixels   The original texture pixels
   * @param {number} width      Width of the original texture
   * @param {number} height     Height of the original texture
   * @param {number} resolution Amount to grow or shrink the pixel array size.
   * @param {object} [options]  Parameters that affect which pixels are used.
   * @param {number} [options.channel=0]    Which RGBA channel (0–3) should be pulled?
   * @param {number} [options.skip=4]       How many channels to skip.
   * @param {TypedArray}   [options.arrayClass=Uint8Array]  What array class to use to store the resulting pixel values
   * @returns {number[]}
   */
  static nearestNeighborScaling(pixels, width, height, resolution, { channel, skip, arrayClass } = {}) {
    channel ??= 0;
    skip ??= 4;
    arrayClass ??= Uint8Array;

    const invResolution = 1 / resolution;
    const localWidth = Math.round(width * resolution);
    const localHeight = Math.round(height * resolution);
    const N = localWidth * localHeight;
    const arr = new arrayClass(N);

    for ( let col = 0; col < localWidth; col += 1 ) {
      for ( let row = 0; row < localHeight; row += 1 ) {
        // Locate the corresponding pixel in the original texture.
        const x_nearest = roundFastPositive(col * invResolution);
        const y_nearest = roundFastPositive(row * invResolution);
        const j = ((y_nearest * width * skip) + (x_nearest * skip)) + channel;

        // Fill in the corresponding local value.
        const i = ((~~row) * localWidth) + (~~col);
        arr[i] = pixels[j];
      }
    }
    return arr;
  }

  /**
   * Consider every pixel in the downscaled image as a box in the original.
   * Average together.
   * See https://towardsdatascience.com/image-processing-image-scaling-algorithms-ae29aaa6b36c.
   * @param {number[]} pixels   The original texture pixels
   * @param {number} width      Width of the original texture
   * @param {number} height     Height of the original texture
   * @param {number} resolution Amount to shrink the pixel array size. Must be less than 1.
   * @param {object} [options]  Parameters that affect which pixels are used.
   * @param {number} [options.channel=0]    Which RGBA channel (0–3) should be pulled?
   * @param {number} [options.skip=4]       How many channels to skip.
   * @param {TypedArray}   [options.arrayClass=Uint8Array]  What array class to use to store the resulting pixel values
   * @returns {number[]}
   */
  static boxDownscaling(pixels, width, height, resolution, { channel, skip, arrayClass } = {}) {
    channel ??= 0;
    skip ??= 4;
    arrayClass ??= Uint8Array;

    const invResolution = 1 / resolution;
    const localWidth = Math.round(width * resolution);
    const localHeight = Math.round(height * resolution);
    const N = localWidth * localHeight;
    const arr = new arrayClass(N);

    const boxWidth = Math.ceil(invResolution);
    const boxHeight = Math.ceil(invResolution);

    for ( let col = 0; col < localWidth; col += 1 ) {
      for ( let row = 0; row < localHeight; row += 1 ) {
        // Locate the corresponding pixel in the original texture.
        const x_ = ~~(col * invResolution);
        const y_ = ~~(row * invResolution);

        // Ensure the coordinates are not out-of-bounds.
        const x_end = Math.min(x_ + boxWidth, width - 1) + 1;
        const y_end = Math.min(y_ + boxHeight, height - 1) + 1;

        // Average colors in the box.
        const values = [];
        for ( let x = x_; x < x_end; x += 1 ) {
          for ( let y = y_; y < y_end; y += 1 ) {
            const j = ((y * width * skip) + (x * skip)) + channel;
            values.push(pixels[j]);
          }
        }

        // Fill in the corresponding local value.
        const i = ((~~row) * localWidth) + (~~col);
        const avgPixel = values.reduce((a, b) => a + b, 0) / values.length;
        arr[i] = roundFastPositive(avgPixel);
      }
    }
    return arr;
  }

  // TODO: Would cubic splines be useful or overkill here?
  // https://blog.ivank.net/interpolation-with-cubic-splines.html
  // https://towardsdatascience.com/image-processing-image-scaling-algorithms-ae29aaa6b36c

  /**
   * Helper method to apply a function directly to a texture.
   * If the texture is large, this may be faster than using the cache.
   */
  static applyFunctionToTexture(texture, fn, { frame, resolution = 1, channel = 0 } = {}) {
    let { pixels, width, height } = extractPixels(canvas.app.renderer, texture, frame);
    const nPixels = width * height * 4; // RGBA channels are extracted
    const invResolution = 1 / resolution;
    const skip = 4 * invResolution * invResolution; // Need only one channel, so use every 4th.
    for ( let i = channel; i < nPixels; i += skip ) fn(pixels[i]);
    return { pixels, width, height, nPixels, resolution };
  }

  /**
   * Draw a representation of this pixel cache on the canvas, where alpha channel is used
   * to represent values. For debugging.
   * @param {Hex} [color]   Color to use for the fill
   */
  draw({color = Draw.COLORS.blue, gammaCorrect = false, local = false } = {}) {
    const ln = this.pixels.length;
    const coordFn = local ? this._localAtIndex : this._canvasAtIndex;
    const gammaExp = gammaCorrect ? 1 / 2.2 : 1;

    for ( let i = 0; i < ln; i += 1 ) {
      const value = this.pixels[i];
      if ( !value ) continue;
      const alpha = Math.pow(value / this.#maximumPixelValue, gammaExp);
      const pt = coordFn.call(this, i);
      Draw.point(pt, { color, alpha, radius: 1 });
    }
  }

  /**
   * Draw a representation of this pixel cache on the canvas, where alpha channel is used
   * to represent values. For debugging.
   * @param {Hex} [color]   Color to use for the fill
   */
  drawLocal({color = Draw.COLORS.blue, gammaCorrect = false } = {}) {
    const ln = this.pixels.length;
    const gammaExp = gammaCorrect ? 1 / 2.2 : 1;
    for ( let i = 0; i < ln; i += 1 ) {
      const value = this.pixels[i];
      if ( !value ) continue;
      const alpha = Math.pow(value / this.#maximumPixelValue, gammaExp);
      const pt = this._canvasAtIndex(i);
      const local = this._fromCanvasCoordinates(pt.x, pt.y);
      Draw.point(local, { color, alpha, radius: 1 });
    }
  }

  /**
   * Draw a representation of this pixel cache on the canvas, where alpha channel is used
   * to represent values. For debugging.
   * @param {Hex} [color]   Color to use for the fill
   */
  drawColors({defaultColor = Draw.COLORS.blue, colors = {}, local = false } = {}) {
    const ln = this.pixels.length;
    const coordFn = local ? this._localAtIndex : this._canvasAtIndex;
    for ( let i = 0; i < ln; i += 1 ) {
      const pt = coordFn.call(this, i);
      const value = this.pixels[i];
      const color = colors[value] ?? defaultColor;
      Draw.point(pt, { color, alpha: .9, radius: 1 });
    }
  }

  drawCanvasCoords({color = Draw.COLORS.blue, gammaCorrect = false, skip = 10, radius = 1 } = {}) {
    const gammaExp = gammaCorrect ? 1 / 2.2 : 1;
    const { right, left, top, bottom } = this;
    skip *= Math.round(1 / this.scale.resolution);
    for ( let x = left; x <= right; x += skip ) {
      for ( let y = top; y <= bottom; y += skip ) {
        const value = this.pixelAtCanvas(x, y);
        if ( !value ) continue;
        const alpha = Math.pow(value / 255, gammaExp);
        Draw.point({x, y}, { color, alpha, radius });
      }
    }
  }

  drawLocalCoords({color = Draw.COLORS.blue, gammaCorrect = false, skip = 10, radius = 2 } = {}) {
    const gammaExp = gammaCorrect ? 1 / 2.2 : 1;
    const { right, left, top, bottom } = this.localFrame;
    for ( let x = left; x <= right; x += skip ) {
      for ( let y = top; y <= bottom; y += skip ) {
        const value = this._pixelAtLocal(x, y);
        if ( !value ) continue;
        const alpha = Math.pow(value / 255, gammaExp);
        Draw.point({x, y}, { color, alpha, radius });
      }
    }
  }
}


/**
 * Pixel cache specific to a tile texture.
 * Adds additional handling for tile rotation, scaling.
 */
export class TilePixelCache extends PixelCache {
  /** @type {Tile} */
  tile;

  /**
   * @param {Tile} [options.tile]   Tile for which this cache applies
                                    If provided, scale will be updated
   * @inherits
   */
  constructor(pixels, width, opts = {}) {
    super(pixels, width, opts);
    this.tile = opts.tile;
    this._resize();
  }

  /** @type {numeric} */
  get scaleX() { return this.tile.document.texture.scaleX; }

  /** @type {numeric} */
  get scaleY() { return this.tile.document.texture.scaleY; }

  /** @type {numeric} */
  get rotation() { return Math.toRadians(this.tile.document.rotation); }

  /** @type {numeric} */
  get rotationDegrees() { return this.tile.document.rotation; }

  /** @type {numeric} */
  get proportionalWidth() { return this.tile.document.width / this.tile.texture.width; }

  /** @type {numeric} */
  get proportionalHeight() { return this.tile.document.height / this.tile.texture.height; }

  /** @type {numeric} */
  get textureWidth() { return this.tile.texture.width; }

  /** @type {numeric} */
  get textureHeight() { return this.tile.texture.height; }

  /** @type {numeric} */
  get tileX() { return this.tile.document.x; }

  /** @type {numeric} */
  get tileY() { return this.tile.document.y; }

  /** @type {numeric} */
  get tileWidth() { return this.tile.document.width; }

  /** @type {numeric} */
  get tileHeight() { return this.tile.document.height; }

  /**
   * Resize canvas dimensions for the tile.
   * Account for rotation and scale by converting from local frame.
   */
  _resize() {
    const { width, height } = this.localFrame;
    const TL = this._toCanvasCoordinates(0, 0);
    const TR = this._toCanvasCoordinates(width, 0);
    const BL = this._toCanvasCoordinates(0, height);
    const BR = this._toCanvasCoordinates(width, height);

    const xMinMax = Math.minMax(TL.x, TR.x, BL.x, BR.x);
    const yMinMax = Math.minMax(TL.y, TR.y, BL.y, BR.y);
    this.x = xMinMax.min;
    this.y = yMinMax.min;
    this.width = xMinMax.max - xMinMax.min;
    this.height = yMinMax.max - yMinMax.min;

    this.clearTransforms();
  }

  /**
   * Transform canvas coordinates into the local pixel rectangle coordinates.
   * @inherits
   */
  _calculateToLocalTransform() {
    // 1. Clear the rotation
    // Translate so the center is 0,0
    const { x, y, width, height } = this.tile.document;
    const mCenterTranslate = Matrix.translation(-(width * 0.5) - x, -(height * 0.5) - y);

    // Rotate around the Z axis
    // (The center must be 0,0 for this to work properly.)
    const rotation = -this.rotation;
    const mRot = Matrix.rotationZ(rotation, false);

    // 2. Clear the scale
    // (The center must be 0,0 for this to work properly.)
    const { scaleX, scaleY } = this;
    const mScale = Matrix.scale(1 / scaleX, 1 / scaleY);

    // 3. Clear the width/height
    // Translate so top corner is 0,0
    const { textureWidth, textureHeight, proportionalWidth, proportionalHeight } = this;
    const currWidth = textureWidth * proportionalWidth;
    const currHeight = textureHeight * proportionalHeight;
    const mCornerTranslate = Matrix.translation(currWidth * 0.5, currHeight * 0.5);

    // Scale the canvas width/height back to texture width/height, if not 1:1.
    // (Must have top left corner at 0,0 for this to work properly.)
    const mProportion = Matrix.scale(1 / proportionalWidth, 1 / proportionalHeight);

    // 4. Scale based on resolution of the underlying pixel data
    const resolution = this.scale.resolution;
    const mRes = Matrix.scale(resolution, resolution);

    // Combine the matrices.
    return mCenterTranslate
      .multiply3x3(mRot)
      .multiply3x3(mScale)
      .multiply3x3(mCornerTranslate)
      .multiply3x3(mProportion)
      .multiply3x3(mRes);
  }

  /**
   * Convert a tile's alpha channel to a pixel cache.
   * At the moment mostly for debugging, b/c overhead tiles have an existing array that
   * can be used.
   * @param {Tile} tile     Tile to pull a texture from
   * @param {object} opts   Options passed to `fromTexture` method
   * @returns {TilePixelCache}
   */
  static fromTileAlpha(tile, opts = {}) {
    const texture = tile.texture;
    opts.tile = tile;
    opts.channel ??= 3;
    return this.fromTexture(texture, opts);
  }

  /**
   * Convert an overhead tile's alpha channel to a pixel cache.
   * Relies on already-cached overhead tile pixel data.
   * @param {Tile} tile     Tile to pull a texture from
   * @param {object} opts   Options passed to `fromTexture` method
   * @returns {TilePixelCache}
   */
  static fromOverheadTileAlpha(tile) {
    if ( !tile.document.overhead ) return this.fromTileAlpha(tile);
    if ( !tile.mesh._textureData ) tile.mesh.updateTextureData();

    // Resolution consistent with `_createTextureData` which divides by 4.
    const pixelWidth = tile.mesh._textureData.aw;
    const texWidth = tile.mesh.texture.baseTexture.realWidth;
    const pixelHeight = tile.mesh._textureData.ah;
    const resolution = pixelWidth / texWidth;

    return new this(tile.mesh._textureData.pixels, pixelWidth, { pixelHeight, tile, resolution });
  }

  /**
   * Convert a circle to local texture coordinates, taking into account scaling.
   * @returns {PIXI.Circle|PIXI.Polygon}
   */
  _circleToLocalCoordinates(_circle) {
    console.error("_circleToLocalCoordinates: Not yet implemented for tiles.");
  }

  /**
   * Convert an ellipse to local texture coordinates, taking into account scaling.
   * @returns {PIXI.Ellipse|PIXI.Polygon}
   */
  _ellipseToLocalCoordinates(_ellipse) {
    console.error("_circleToLocalCoordinates: Not yet implemented for tiles.");
  }

  /**
   * Convert a rectangle to local texture coordinates, taking into account scaling.
   * @returns {PIXI.Rectangle|PIXI.Polygon}
   * @inherits
   */
  _rectangleToLocalCoordinates(rect) {
    switch ( this.rotationDegrees ) {
      case 0:
      case 360: return super._rectangleToLocalCoordinates(rect);
      case 90:
      case 180:
      case 270: {
        // Rotation will change the TL and BR points; adjust accordingly.
        const { left, right, top, bottom } = rect;
        const TL = this._fromCanvasCoordinates(left, top);
        const TR = this._fromCanvasCoordinates(right, top);
        const BR = this._fromCanvasCoordinates(right, bottom);
        const BL = this._fromCanvasCoordinates(left, bottom);
        const localX = Math.minMax(TL.x, TR.x, BR.x, BL.x);
        const localY = Math.minMax(TL.y, TR.y, BR.y, BL.y);
        return new PIXI.Rectangle(localX.min, localY.min, localX.max - localX.min, localY.max - localY.min);
      }
      default: {
        // Rotation would form a rotated rectangle-Use polygon instead.
        const { left, right, top, bottom } = rect;
        const poly = new PIXI.Polygon([left, top, right, top, right, bottom, left, bottom]);
        return this._polygonToLocalCoordinates(poly);
      }
    }
  }
}

// ----- Marker class ----- //

/**
 * Store a point, a t value, and the underlying coordinate system
 */
export class Marker {
  /** @type {PIXI.Point} */
  #point;

  /** @type {number} */
  t = -1;

  /** @type {object} */
  range = {
    start: new PIXI.Point(),  /** @type {PIXI.Point} */
    end: new PIXI.Point()       /** @type {PIXI.Point} */
  };

  /** @type {object} */
  options = {};

  /** @type {Marker} */
  next;

  constructor(t, start, end, opts = {}) {
    this.t = t;
    this.options = opts;
    this.range.start.copyFrom(start);
    this.range.end.copyFrom(end);
  }

  /** @type {PIXI.Point} */
  get point() { return this.#point ?? (this.#point = this.pointAtT(this.t)); }

  /**
   * Given a t position, project the location given this marker's range.
   * @param {number} t
   * @returns {PIXI.Point}
   */
  pointAtT(t) { return this.range.start.projectToward(this.range.end, t); }

  /**
   * Build a new marker and link it as the next marker to this one.
   * If this marker has a next marker, insert in-between.
   * Will insert at later spot as necessary
   * @param {number} t      Must be greater than or equal to this t.
   * @param {object} opts   Will be combined with this marker options.
   * @returns {Marker}
   */
  addSubsequentMarker(t, opts) {
    if ( this.t === t ) { return this; }

    // Insert further down the line if necessary.
    if ( this.next && this.next.t < t ) return this.next.addSubsequentMarker(t, opts);

    // Merge the options with this marker's options and create a new marker.
    if ( t < this.t ) console.error("Marker asked to create a next marker with a previous t value.");
    const next = new this.constructor(t, this.range.start, this.range.end, { ...this.options, ...opts });

    // Insert at the correct position.
    if ( this.next ) next.next = this.next;
    this.next = next;
    return next;
  }

  /**
   * Like addSubsequentMarker but does not merge options and performs less checks.
   * Assumes it should be the very next item and does not check for existing next object.
   */
  _addSubsequentMarkerFast(t, opts) {
    const next = new this.constructor(t, this.range.start, this.range.end, opts);
    this.next = next;
    return next;
  }
}

/**
 * Class used by #markPixelsForLocalCoords to store relevant data for the pixel point.
 */
export class PixelMarker extends Marker {

  static calculateOptsFn(cache, coords ) {
    const width = cache.localFrame.width;
    return i => {
      const localX = coords[i];
      const localY = coords[i+1];
      const idx = (localY * width) + localX;
      const currPixel = cache.pixels[idx];
      return { localX, localY, currPixel };
    };
  }
}
