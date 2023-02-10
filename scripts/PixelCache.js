/* globals
PIXI,
canvas,
Ray
*/
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
import { roundFastPositive } from "./util.js";

/* Testing
api = game.modules.get("elevatedvision").api
Draw = CONFIG.GeometryLib.Draw
draw = new Draw
extractPixels = api.extract.extractPixels
PixelCache = api.PixelCache
TilePixelCache = api.TilePixelCache
gridSize = canvas.dimensions.size
gridPrecision = gridSize >= 128 ? 16 : 8;

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
cacheSmall2 = PixelCache.fromTexture(evTexture, { frame: _token.bounds, resolution: gridPrecision / gridSize, scalingMethod: PixelCache.boxDownscaling })


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

*/


/**
 * Class representing a rectangular array of pixels, typically pulled from a texture.
 * The underlying rectangle is in canvas coordinates.
 */
export class PixelCache extends PIXI.Rectangle {
  /** @type {Uint8ClampedArray} */
  pixels = new Uint8ClampedArray(0);

  /** @type {number} */
  #localWidth = 0;

  /** @type {PIXI.Rectangle} */
  #localFrame = new PIXI.Rectangle();

  /** @type {number} */
  #maximumPixelValue = 255;

  /** @type {Map<PIXI.Rectangle>} */
  #thresholdBoundingBoxes = new Map();

  /**
   * @type {object}
   * @property {number} x           Translation in x direction
   * @property {number} y           Translation in y direction
   * @property {number} resolution  Ratio of pixels to canvas values.
   */
  scale = {
    resolution: 1,
    resolutionInv: 1
  };

  /**
   * @param {number[]} pixels     Array of integer values.
   * @param {number} width        The width of the rectangle.
   * @param {object} [options]    Optional translation
   * @param {number} [options.x]  Starting left canvas coordinate
   * @param {number} [options.y]  Starting top canvas coordinate
   */
  constructor(pixels, width, { x = 0, y = 0, height, resolution = 1 } = {}) {
    const localWidth = Math.round(width * resolution);
    const nPixels = pixels.length;
    height ??= nPixels / (localWidth * resolution);

    if ( !Number.isInteger(height) ) {
      console.warn(`PixelCache: width ${width} does not evenly divide into ${pixels.length} pixels.`);
      height = Math.floor(height);
    }

    super(x, y, width, height);
    this.pixels = pixels;
    this.scale.resolution = resolution;
    this.scale.resolutionInv = 1 / resolution;
    this.#localWidth = localWidth;
    this.#localFrame = this.#rectangleToLocalCoordinates(this);
  }

  /**
   * Get a canvas bounding box based on a specific threshold.
   * @param {number} [threshold=0.75]   Values lower than this will be ignored around the edges.
   * @returns {PIXI.Rectangle} Rectangle based on local coordinates.
   */
  getThresholdCanvasBoundingBox(threshold = 0.75) {
    const bounds = this.getThresholdBoundingBox(threshold);
    const TL = this._toCanvasCoordinate(bounds.left, bounds.top);
    const BR = this._toCanvasCoordinate(bounds.right, bounds.bottom);
    return new PIXI.Rectangle(TL.x, TL.y, BR.x - TL.x, BR.y - TL.y);
  }

  /**
   * Cache a bounding box based on a specific threshold.
   * @param {number} [threshold=0.75]   Values lower than this will be ignored around the edges.
   * @returns {PIXI.Rectangle} Rectangle based on local coordinates.
   */
  getThresholdBoundingBox(threshold = 0.75) {
    const map = this.#thresholdBoundingBoxes;
    if ( !map.has(threshold) ) map.set(threshold, this.#calculateBoundingBox(threshold));
    return map.get(threshold);
  }

  /**
   * Calculate a bounding box based on a specific threshold.
   * @param {number} [threshold=0.75]   Values lower than this will be ignored around the edges.
   * @returns {PIXI.Rectangle} Rectangle based on local coordinates.
   */
  #calculateBoundingBox(threshold=0.75) {
    threshold = threshold * this.#maximumPixelValue;
    let minX = undefined;
    let maxX = undefined;
    let minY = undefined;
    let maxY = undefined;

    // Map the pixels
    const pixels = this.pixels;
    const width = this.#localWidth;
    for ( let i = 0; i < pixels.length; i += 1 ) {
      const a = pixels[i];
      if ( a > threshold ) {
        const x = i % width;
        const y = ~~(i / width); // Floor
        if ( (minX === undefined) || (x < minX) ) minX = x;
        else if ( (maxX === undefined) || (x + 1 > maxX) ) maxX = x + 1;
        if ( (minY === undefined) || (y < minY) ) minY = y;
        else if ( (maxY === undefined) || (y + 1 > maxY) ) maxY = y + 1;
      }
    }
    return (new PIXI.Rectangle(minX, minY, maxX - minX, maxY - minY)).normalize();
  }

  /**
   * Get the pixel index for a specific texture location
   * Default is to floor the values, but this can be changed to another method.
   * @param {number} x      Local texture x coordinate
   * @param {number} y      Local texture y coordinate
   * @returns {number}
   */
  _indexAtLocal(x, y) { return ((~~y) * this.#localWidth) + (~~x); }

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
    pt.translate(-this.x, -this.y, pt);
    pt.multiplyScalar(this.scale.resolution, pt);
    return pt;
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
    pt.multiplyScalar(this.scale.resolutionInv, pt);
    pt.translate(this.x, this.y, pt);
    return pt;
  }

  /**
   * Convert a circle to local texture coordinates
   * @param {PIXI.Circle}
   * @returns {PIXI.Circle}
   */
  #circleToLocalCoordinates(circle) {
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
  #ellipseToLocalCoordinates(ellipse) {
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
   * @param {PIXI.Rectangle}
   * @returns {PIXI.Rectangle}
   */
  #rectangleToLocalCoordinates(rect) {
    const TL = this._fromCanvasCoordinates(rect.left, rect.top);
    const BR = this._fromCanvasCoordinates(rect.right, rect.bottom);
    return new PIXI.Rectangle(TL.x, TL.y, BR.x - TL.x, BR.y - TL.y);
  }

  /**
   * Convert a polygon to local texture coordinates
   * @param {PIXI.Polygon}
   * @returns {PIXI.Polygon}
   */
  #polygonToLocalCoordinates(poly) {
    const points = poly.points;
    const ln = points.length;
    const newPoints = Array(ln);
    for ( let i = 0; i < ln; i += 2 ) {
      const x = points[i];
      const y = points[i + 1];
      const local = this._fromCanvasCoordinates(x, y);
      newPoints.push(local.x, local.y);
    }
    return new PIXI.Polygon(newPoints);
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
   * Apply a function to each pixel value.
   * @param {function} fn             Function to apply. Passed the pixel and the index.
   * @param {PIXI.Rectangle} [frame]  Optional frame to limit the pixels to which the function applies.
   *                                  Frame is in canvas coordinates
   * @returns {number}  Number of pixels to which the function was applied.
   */
  applyFunction(fn, frame) {
    if ( frame ) frame = this.#rectangleToLocalCoordinates(frame);
    else frame = this.#localFrame;

    // In local coordinates, TL is always {0,0}.
    const { right, bottom } = frame;
    for ( let ptX = 0; ptX < right; ptX += 1 ) {
      for ( let ptY = 0; ptY < bottom; ptY += 1) {
        const px = this._indexAtLocal(ptX, ptY);
        const value = this.pixels[px];
        fn(value, px);
      }
    }
    return right * bottom;
  }

  /**
   * Apply a function to each pixel value, returning the pixels as a new cache.
   */

  /**
   * Apply a function to each pixel value contained within a shape.
   * @param {function} fn             Function to apply. Passed the pixel and the index.
   * @param {PIXI.Rectangle} shape    Shape to limit the pixels to which the function applies.
   *                                  Shape is in canvas coordinates
   * @returns {number} Total number of pixels to which the function applied.
   */
  applyFunctionToShape(fn, shape) {
    if ( shape instanceof PIXI.Rectangle ) return this.applyFunction(fn, shape);

    // Limit the pixels tested to the shape boundary.
    const border = shape.getBounds(shape);

    // Shift the shape to texture coordinates; likely faster than converting each pixel to canvas.
    if ( shape instanceof PIXI.Polygon ) shape = this.#polygonToLocalCoordinates(shape);
    else if ( shape instanceof PIXI.Circle ) shape = this.#circleToLocalCoordinates(shape);
    else if ( shape instanceof PIXI.Ellipse ) shape = this.#ellipseToLocalCoordinates(shape);

    // Track number of pixels within the shape.
    let denom = 0;
    const shapeFn = (value, i) => {
      const local = this._localCoordinatesAtPixelIndex(i);
      if ( shape.contains(local.x, local.y) ) {
        denom += 1;
        fn(value, i);
      }
    };
    this.applyFunction(shapeFn, border);
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
  nextPixelValueAlongRay(ray, cmp, opts) {
    const textureRay = new Ray(this._fromCanvasCoordinates(ray.A), this._fromCanvasCoordinates(ray.B));
    return this._nextPixelValueAlongRay(textureRay, cmp, opts);
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
  _nextPixelValueAlongRay(ray, cmp, { stepT = 0.1, startT = stepT } = {}) {
    // Step along the ray until we hit the threshold
    let t = startT;
    while ( t <= 1 ) {
      const pt = ray.project(t);
      const value = this._pixelAtLocal(pt.x, pt.y);
      if ( cmp(value) ) {
        pt.t0 = t;
        return pt;
      }
      t += stepT;
    }
    return null;
  }

  /**
   * Construct a pixel cache from a texture.
   * @param {PIXI.Texture} texture      Texture from which to pull pixel data
   * @param {object} [options]          Options affecting which pixel data is used
   * @param {PIXI.Rectangle} [options.frame]    Optional rectangle to trim the extraction
   * @param {number} [options.resolution=1]     At what resolution to pull the pixels
   * @param {number} [options.x=0]              Move the texture in the x direction by this value
   * @param {number} [options.y=0]              Move the texture in the y direction by this value
   * @param {number} [options.channel=0]        Which RGBA channel, where R = 0, A = 3.
   * @param {function} [options.scalingMethod=PixelCache.nearestNeighborScaling]
   * @returns {PixelCache}
   */
  static fromTexture(texture, opts) {
    opts.x ??= 0;
    opts.y ??= 0;
    opts.resolution ??= 1;
    const channel = opts.channel ?? 0;
    const scalingMethod = opts.scalingMethod ?? this.nearestNeighborScaling;

    const { pixels, x: texX, y: texY, width, height } = extractPixels(canvas.app.renderer, texture, opts.frame);
    const arr = scalingMethod(pixels, width, height, opts.resolution, { channel });
    opts.x += texX;
    opts.y += texY;
    opts.height = height;
    return new this(arr, width, opts);
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
   * @returns {number[]}
   */
  static nearestNeighborScaling(pixels, width, height, resolution, { channel = 0, skip = 4 } = {}) {
    const invResolution = 1 / resolution;
    const localWidth = Math.round(width * resolution);
    const localHeight = Math.round(height * resolution);
    const N = localWidth * localHeight;
    const arr = new Uint8Array(N);

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
   * @returns {number[]}
   */
  static boxDownscaling(pixels, width, height, resolution, { channel = 0, skip = 4 } = {}) {
    const invResolution = 1 / resolution;
    const localWidth = Math.round(width * resolution);
    const localHeight = Math.round(height * resolution);
    const N = localWidth * localHeight;
    const arr = new Uint8Array(N);

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
  draw({color = Draw.COLORS.blue, alphaAdder = 0, local = false } = {}) {
    const ln = this.pixels.length;
    const coordFn = local ? this._localAtIndex : this._canvasAtIndex;
    for ( let i = 0; i < ln; i += 1 ) {
      const value = this.pixels[i];
      if ( !value ) continue;
      const alpha = (value + alphaAdder) / this.#maximumPixelValue;
      const pt = coordFn.call(this, i);
      Draw.point(pt, { color, alpha, radius: 1 });
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
    if ( opts.tile ) {
      opts.x ??= opts.tile.x;
      opts.y ??= opts.tile.y;
      width ??= opts.tile.texture.width;
      opts.height ??= opts.tile.texture.height;
    }

    super(pixels, width, opts);
    if ( opts.tile ) {
      this.tile = opts.tile;
      this.#setTileScaleData(opts.tile);
    }

  }

  /** @type {numeric} */
  get scaleX() { return this.scale.sscX * this.scale.ascX; }

  /** @type {numeric} */
  set scaleX(value) {
    this.scale.sscX = Math.sign(value);
    this.scale.ascX = Math.abs(value);
  }

  /** @type {numeric} */
  get scaleY() { return this.scale.sscY * this.scale.ascY; }

  /** @type {numeric} */
  set scaleY(value) {
    this.scale.sscY = Math.sign(value);
    this.scale.ascY = Math.abs(value);
  }

  /** @type {numeric} */
  get rotation() { return this.scale.rotation; }

  /** @type {numeric} */
  set rotation(value) { this.scale.rotation = Math.normalizeRadians(value); }

  /** @type {numeric} */
  get rotationDegrees() { return Math.toDegrees(this.scale.rotation); }

  /** @type {numeric} */
  set rotationDegrees(value) { this.scale.rotation = Math.toRadians(value); }

  /**
   * Set scaling data from a given tile.
   * @param {Tile} tile
   */
  #setTileScaleData(tile) {
    const tileDoc = tile.document;
    this.scaleX = tileDoc.texture.scaleX;
    this.scaleY = tileDoc.texture.scaleY;
    this.rotationDegrees = tileDoc.rotation;
  }

  /**
   * Transform canvas coordinates into the local pixel rectangle coordinates.
   * @inherits
   */
  _fromCanvasCoordinates(x, y) {
    const pt = new PIXI.Point(x, y);

    // See Tile.prototype.#getTextureCoordinate
    const { scale, width, height, left, top, rotation } = this;
    const { sscX, sscY, ascX, ascY } = scale;
    const width1_2 = width * 0.5;
    const height1_2 = height * 0.5;

    // Account for tile rotation
    if ( rotation ) {
      // Center the coordinate so the tile center is 0,0 so the coordinate can be easily rotated.
      pt.subtract(this.center, pt);
      pt.rotate(-rotation, pt);
      pt.add(this.center, pt);
    }

    // Move from 0,0 to the tile location
    pt.translate(-this.x, -this.y, pt);

    // Account for scale
    // Mirror if scale is negative
    const xMult = sscX * (ascX - 1);
    const yMult = sscY * (ascY - 1);
    if ( sscX < 0 ) {
      pt.x = (-pt.x + width - (xMult*left) - (xMult*width1_2)) / (1 - xMult);
    } else {
      pt.x = (pt.x + (xMult*left) + (xMult*width1_2)) / (1 + xMult);
    }

    if ( sscY < 0 ) {
      pt.y = (-pt.y + height - (yMult*top) - (yMult*height1_2)) / (1 - yMult);
    } else {
      pt.y = (pt.y + (yMult*top) + (yMult*height1_2)) / (1 + yMult);
    }

    pt.multiplyScalar(scale.resolution, pt);

    return pt;
  }

  /**
   * Transform local coordinates into canvas coordinates.
   * Inverse of _fromCanvasCoordinates
   * @inherits
   */
  _toCanvasCoordinates(x, y) {
    const pt = new PIXI.Point(x, y);
    const { scale, width, height, left, top, rotation } = this;
    const { sscX, sscY, ascX, ascY } = scale;

    pt.multiplyScalar(scale.resolutionInv, pt);

    const xStart = (pt.x - left - (width / 2));
    const yStart = (pt.y - top - (height / 2));

    // Mirror if scale is negative.
    if ( sscX < 0 ) pt.x = width - pt.x;
    if ( sscY < 0 ) pt.y = height - pt.y;

    // Account for scale.
    const xMult = sscX * (ascX - 1);
    const yMult = sscY * (ascY - 1);
    pt.translate(xMult * xStart, yMult * yStart, pt);

    // Shift to the tile location on the canvas.
    pt.translate(this.x, this.y, pt);

    // Account for tile rotation
    if ( rotation ) {
      // Center the coordinate so that the tile center is 0,0 so the coordinate can be easily rotated.
      pt.subtract(this.center, pt);
      pt.rotate(rotation, pt);
      pt.add(this.center, pt);
    }

    return pt;
  }

  /**
   * Get a canvas bounding box based on a specific threshold.
   * @param {number} [threshold=0.75]   Values lower than this will be ignored around the edges.
   * @returns {PIXI.Rectangle} Rectangle based on local coordinates.
   */
  getThresholdCanvasBoundingBox(threshold = 0.75) {
    const bounds = this.getThresholdBoundingBox(threshold);
    const TL = this._toCanvasCoordinate(bounds.left, bounds.top);
    const BR = this._toCanvasCoordinate(bounds.right, bounds.bottom);
    const r = this.rotation;
    return PIXI.Rectangle.fromRotation(TL.x, TL.y, BR.x - TL.x, BR.y - TL.y, r).normalize();
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
    opts.x = tile.x;
    opts.y = tile.y;
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

    // The aw and ah properties must be rounded to determine the dimensions.
    const localWidth = tile._textureData.aw;
    const width = tile.texture.width;
    const resolution = localWidth / width;

    // Resolution consistent with `_createTextureData` which divides by 4.
    return new this(tile._textureData.pixels, width, { tile, resolution });
  }

}