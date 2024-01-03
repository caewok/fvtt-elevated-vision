/* globals
CONFIG,
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { CoordinateElevationCalculator } from "./CoordinateElevationCalculator.js";
import { Settings } from "./settings.js";
import { PixelCache } from "./PixelCache.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { Draw } from "./geometry/Draw.js";

export class TokenElevationCalculator extends CoordinateElevationCalculator {
  /** @type {number} */
  static #MAXIMUM_TILE_PIXEL_VALUE = 255;

  /** @type {Token} */
  #token;

  /** @type {PIXI.Rectangle|Square|PIXI.Polygon} */
  #tokenShape;

  /** @type {number[]} */
  #canvasOffsetGrid;

  /** @type {Map<tile, number[]} */
  #localOffsetsMap = new Map();

  /** @type {boolean} */
  overrideTokenPosition = false;

  /**
   * Uses a token instead of a point. Options permit the token location and elevation to be changed.
   * @param {Token} token
   * @param {object} [opts]
   * @param {Point} [opts.tokenCenter]
   * @param {number} [opts.tokenElevation]
   */
  constructor(token, opts = {}) {
    const coordinate = Point3d.fromTokenCenter(token);
    opts.elevationMeasurement ??= Settings.get(Settings.KEYS.ELEVATION_MEASUREMENT.ALGORITHM);
    super(coordinate, opts);

    this.#token = token;
    this.terrainPixelAggregationFn = this.#calculateTerrainPixelAggregationFn();
    this.tilePixelAggregationFn = this.#calculateTilePixelAggregationFn();
  }

  /** @type {Token} */
  get token() { return this.#token; }

  /** @type {number[]} */
  get canvasOffsetGrid() {
    return this.#canvasOffsetGrid || (this.#canvasOffsetGrid = this.#calculateTokenOffsets());
  }

  /**
   * Token shape is expensive, so avoid until necessary.
   * @type {PIXI.Polygon|PIXI.Rectangle}
   */
  get tokenShape() {
    return this.#tokenShape || (this.#tokenShape = this.#calculateTokenShape(this.location));
  }

  /** @type {number} */
  get tileStep() { return this.options.tileStep ?? this.#token.tokenVisionHeight ?? 0; }

  /** @type {number} */
  get terrainStep() {
    return this.options.terrainStep ?? this.#token.tokenVisionHeight ?? canvas.elevation.elevationStep;
  }

  /** @type {string} */
  get elevationMeasurementAlgorithm() {
    return this.#token.document.getFlag(MODULE_ID, FLAGS.ELEVATION_MEASUREMENT.ALGORITHM);
  }

  // Force location and elevation to be based on the token.
  get bounds() {
    const bounds = this.#token.bounds;
    if ( this.overrideTokenPosition ) {
      const delta = this.location.subtract(this.#token.center);
      bounds.translate(delta.x, delta.y);
    }
    return bounds;
  }

  get coordinate() {
    if ( this.overrideTokenPosition ) return super.coordinate;
    return Point3d.fromTokenCenter(this.#token);
  }

  // Need a setter if a getter is defined; will not fall through to super without it.
  set coordinate(value) {
    if ( this.overrideTokenPosition ) super.coordinate = value;
  }

  get location() {
    if ( this.overrideTokenPosition ) return super.location;
    return this.#token.center;
  }

  set location(value) {
    if ( this.overrideTokenPosition ) super.location = value;
  }

  get elevationZ() {
    if ( this.overrideTokenPosition ) return super.elevationZ;
    return this.#token.elevationZ;
  }

  set elevationZ(value) {
    if ( this.overrideTokenPosition ) super.location = value;
  }

  resetToTokenPosition() {
    this.overrideTokenPosition = false;
    this.coordinate = Point3d.fromTokenCenter(this.#token);
    this.overrideTokenPosition = true;
  }

  refreshTokenShape() {
    this.#tokenShape = undefined;
    this.#localOffsetsMap.clear();
    this.#canvasOffsetGrid = undefined;
  }

  refreshTokenElevationMeasurementAlgorithm() {
    this.terrainPixelAggregationFn = this.#calculateTerrainPixelAggregationFn();
    this.tilePixelAggregationFn = this.#calculateTilePixelAggregationFn();
    this.refreshTokenShape();
  }

  /**
   * Retrieve or calculate local offsets for the terrain or a given tile.
   * @param {Tile|"terrain"} key   Tile or "terrain" string for which local offsets are needed.
   * @returns {number[]}
   */
  _getLocalOffsets(key) {
    let localOffsets = this.#localOffsetsMap.get(key);
    if ( localOffsets ) return localOffsets;
    const cache = key === "terrain" ? canvas.elevation.elevationPixelCache : key.evPixelCache;
    localOffsets = this.#localGridOffsets(cache);
    this.#localOffsetsMap.set(key, localOffsets);
    return localOffsets;
  }

  /**
   * For a given pixel cache, convert this token's offset grid to local.
   * @param {PixelCache} cache
   * @returns {number[]} Local offsets
   */
  #localGridOffsets(cache) {
    const canvasOffsets = this.canvasOffsetGrid;
    if ( canvasOffsets.equals([0, 0]) ) return [0, 0];
    return cache.convertCanvasOffsetGridToLocal(this.canvasOffsetGrid);
  }

  /**
   * Measure terrain elevation based on the token shape and elevation measurement settings.
   * @returns {number}
   */
  terrainElevation() {
    const pixels = this._pixelsForGridOffset("terrain");
    const pixelValue = this.terrainPixelAggregationFn(pixels);
    return canvas.elevation._scaleNormalizedElevation(pixelValue);
  }

  /**
   * Measure tile opacity based on token shape and elevation measurement settings.
   * @param {Tile} tile
   * @returns {number}
   */
  tileOpacity(tile) {
    const pixels = this._pixelsForGridOffset(tile);
    return this.tilePixelAggregationFn(pixels) / tile.evPixelCache.maximumPixelValue;
  }

  _pixelsForGridOffset(key) {
    const localOffsets = this._getLocalOffsets(key);
    const { x, y } = this.location;
    const cache = key === "terrain" ? canvas.elevation.elevationPixelCache : key.evPixelCache;
    return cache.pixelsForRelativePointsFromCanvas(x, y, undefined, localOffsets);
  }

  /**
   * Is this tile opaque at the given point?
   * @param {Tile} tile
   * @returns {boolean}
   */
  tileIsOpaque(tile) { return this.tileOpacity(tile) > this.options.alphaThreshold; }

  /**
   * Could the tile support the token?
   * Either the tile is sufficiently opaque, the terrain is sufficiently high,
   * or a combination of the two.
   * Terrain above the tile is presumed not to support at the tile (allows underground tiles to work).
   */
  tileCouldSupport(tile) {
    // This is tricky, b/c we want terrain to count if it is the same height as the tile.
    // So if a token is 40% on a tile at elevation 30, 40% on terrain elevation 30 and
    // 20% on transparent tile with elevation 0, the token elevation should be 30.
    // In the easy cases, there is 50% coverage for either tile or terrain alone.
    // But the hard case makes us iterate over both tile and terrain at once,
    // b/c otherwise we cannot tell where the overlaps occur. E.g., 30% tile, 20% terrain?

    // If tile is opaque for the token at this position, it can support it.
    const tilePixels = this._pixelsForGridOffset(tile);
    const tileOpacity = this.tilePixelAggregationFn(tilePixels) / tile.evPixelCache.maximumPixelValue;
    if ( tileOpacity > this.options.alphaThreshold ) return true;

    // If the terrain equals the tile elevation at this position, simply ignore the tile.
    const tileE = tile.elevationE;
    const terrainPixels = this._pixelsForGridOffset("terrain");
    const terrainValue = this.terrainPixelAggregationFn(terrainPixels);
    const terrainE = canvas.elevation._scaleNormalizedElevation(terrainValue);
    if ( tileE === terrainE ) return true;

    // Check for overlapping other tiles and terrain sufficient to support.
    const otherTiles = this.tiles.filter(t => t !== tile && t.elevationE === tileE);
    const tilePixelsArr = [tilePixels];
    for ( const otherTile of otherTiles ) { tilePixelsArr.push(this._pixelsForGridOffset(otherTile)); }

    // In theory, each pixel array should be the same length and each pixel represents the same
    // canvas location.
    // Wall over each in parallel, checking for terrain elevation or tile opacity at each.
    // Once we hit 50%, we are done.
    const numPixels = terrainPixels.length;
    let numOpaque = 0;
    const terrainETarget = canvas.elevation._normalizeElevation(tileE);
    const tileOpacityTarget = this.options.alphaThreshold * this.constructor.#MAXIMUM_TILE_PIXEL_VALUE;
    const numOpaqueTarget = numPixels * 0.5;

    for ( let i = 0; i < numPixels; i += 1 ) {
      if ( numOpaque > numOpaqueTarget ) return true;
      if ( terrainPixels[i] === terrainETarget ) {
        numOpaque += 1;
        continue;
      }

      // Cycle over each tile, looking for an opaque value.
      for ( const tilePixels of tilePixelsArr ) {
        if ( tilePixels[i] > tileOpacityTarget ) {
          numOpaque += 1;
          break;
        }
      }
    }
    return false;
  }

  /**
   * Get token shape for the token
   * @param {Point} [tokenCenter]   Optional location of the token
   * @returns {PIXI.Polygon|PIXI.Rectangle}
   */
  #calculateTokenShape(tokenCenter) {
    tokenCenter ??= this.location;
    const tokenTL = this.token.getTopLeft(tokenCenter.x, tokenCenter.y);
    return canvas.elevation._tokenShape(tokenTL, this.token.w, this.token.h);
  }

  #calculateTokenOffsets() {
    const TYPES = FLAGS.ELEVATION_MEASUREMENT.TYPES;
    const algorithm = this.elevationMeasurementAlgorithm;
    const { w, h } = this.token;
    const skipPercent = CONFIG[MODULE_ID].skipPercentage[algorithm];
    switch ( algorithm ) {
      case TYPES.POINT: return [0, 0];
      case TYPES.AVERAGE: {
        const skip = Math.min(this.token.w, this.token.h) * skipPercent;
        return PixelCache.pixelOffsetGrid(this.tokenShape, skip);
      }
      case TYPES.POINTS_CLOSE:
      case TYPES.POINTS_SPREAD: {
        const t = Math.min(w, h) * skipPercent;
        return [0, 0, -t, -t, -t, t, t, t, t, -t, -t, 0, t, 0, 0, -t, 0, t];
      }
    }
  }

  /**
   * Create function used to calculate a terrain pixel value from an array of terrain pixels.
   * Terrain pixels represent an elevation, and so some sort of averaging is appropriate.
   * For the single-pixel option, use the first pixel.
   * For points, use median.
   * For average, use sum (from which an average will be derived).
   * @returns {function}
   */
  #calculateTerrainPixelAggregationFn() {
    const TYPES = FLAGS.ELEVATION_MEASUREMENT.TYPES;
    switch ( this.elevationMeasurementAlgorithm ) {
      case TYPES.POINT: return PixelCache.pixelAggregator("first");
      case TYPES.POINTS_CLOSE:
      case TYPES.POINTS_SPREAD: return PixelCache.pixelAggregator("median_no_null");
      case TYPES.AVERAGE: return PixelCache.pixelAggregator("average");
    }
  }

  /**
   * Create function used to calculate a tile pixel value from an array of tile pixels.
   * Tile pixels are checked for opacity, so the percentage of pixels that are opaque
   * is the relevant question.
   * For the single pixel option, use the first pixel.
   * Otherwise, use count (from which percentage can be derived).
   * @returns {function}
   */
  #calculateTilePixelAggregationFn() {
    const TYPES = FLAGS.ELEVATION_MEASUREMENT.TYPES;
    switch ( this.elevationMeasurementAlgorithm ) {
      case TYPES.POINT: return PixelCache.pixelAggregator("first");
      case TYPES.POINTS_CLOSE:
      case TYPES.POINTS_SPREAD: return PixelCache.pixelAggregator("max");
      case TYPES.AVERAGE: return PixelCache.pixelAggregator("average");
    }
  }

  /**
   * Draw the pixel offset grid.
   */
  drawOffsetGrid(tile) {
    const offsets = this.canvasOffsetGrid;
    const nOffsets = offsets.length;
    const draw = new Draw();
    const center = this.location;
    const threshold = this.options.alphaThreshold * this.constructor.#MAXIMUM_TILE_PIXEL_VALUE;

    let pixels;
    let color = Draw.COLORS.blue;
    pixels = this._pixelsForGridOffset(tile ?? "terrain");
    for ( let i = 0, j = 0; i < nOffsets; i += 2 ) {
      const x = offsets[i] + center.x;
      const y = offsets[i + 1] + center.y;
      if ( tile ) color = pixels[j++] > threshold ? Draw.COLORS.green : Draw.COLORS.red;
      else color = canvas.elevation.elevationColor(canvas.elevation._scaleNormalizedElevation(pixels[j++]));
      draw.point({x, y}, { radius: 1, color });
    }
    return pixels;
  }
}
