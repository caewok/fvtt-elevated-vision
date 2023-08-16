/* globals
CONFIG,
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { CoordinateElevationCalculator } from "./CoordinateElevationCalculator.js";
import { SETTINGS, getSetting } from "./settings.js";
import { PixelCache } from "./PixelCache.js";
import { Point3d } from "./geometry/3d/Point3d.js";

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

  /**
   * Uses a token instead of a point. Options permit the token location and elevation to be changed.
   * @param {Token} token
   * @param {object} [opts]
   * @param {Point} [opts.tokenCenter]
   * @param {number} [opts.tokenElevation]
   */
  constructor(token, opts = {}) {
    const coordinate = Point3d.fromTokenCenter(token);
    opts.elevationMeasurement ??= getSetting(SETTINGS.ELEVATION_MEASUREMENT.ALGORITHM);
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

  resetToTokenPosition() { this.coordinate = Point3d.fromTokenCenter(this.#token); }

  refreshTokenShape() {
    this.#tokenShape = undefined;
    this.#localOffsetsMap.clear();
    this.#canvasOffsetGrid = undefined;
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
    const pixels = this.#pixelsForGridOffset("terrain");
    const pixelValue = this.terrainPixelAggregationFn(pixels);
    return canvas.elevation._scaleNormalizedElevation(pixelValue);
  }

  /**
   * Measure tile opacity based on token shape and elevation measurement settings.
   * @param {Tile} tile
   * @returns {number}
   */
  tileOpacity(tile) {
    const pixels = this.#pixelsForGridOffset(tile);
    return this.tilePixelAggregationFn(pixels) / tile.evPixelCache.maximumPixelValue;
  }

  #pixelsForGridOffset(key) {
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
    const tilePixels = this.#pixelsForGridOffset(tile);
    const tileOpacity = this.tilePixelAggregationFn(tilePixels) / tile.evPixelCache.maximumPixelValue;
    if ( tileOpacity > this.options.alphaThreshold ) return true;

    // If the terrain equals the tile elevation at this position, simply ignore the tile.
    const tileE = tile.elevationE;
    const terrainPixels = this.#pixelsForGridOffset("terrain");
    const terrainValue = this.terrainPixelAggregationFn(terrainPixels);
    const terrainE = canvas.elevation._scaleNormalizedElevation(terrainValue);
    if ( tileE === terrainE ) return true;

    // Check for overlapping other tiles and terrain sufficient to support.
    const otherTiles = this.tiles.filter(t => t !== tile && t.elevationE === tileE);
    const tilePixelsArr = [tilePixels];
    for ( const otherTile of otherTiles ) { tilePixelsArr.push(this.#pixelsForGridOffset(otherTile)); }

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
    const { TYPES, ALGORITHM } = SETTINGS.ELEVATION_MEASUREMENT;
    const algorithm = getSetting(ALGORITHM);
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
   * Function used to calculate a terrain pixel value from an array of terrain pixels.
   * Terrain pixels represent an elevation, and so some sort of averaging is appropriate.
   * For the single-pixel option, use the first pixel.
   * For points, use median.
   * For average, use sum (from which an average will be derived).
   * @returns {function}
   */
  #calculateTerrainPixelAggregationFn() {
    const { TYPES, ALGORITHM } = SETTINGS.ELEVATION_MEASUREMENT;
    switch ( getSetting(ALGORITHM) ) {
      case TYPES.POINT: return PixelCache.pixelAggregator("first");
      case TYPES.POINTS_CLOSE:
      case TYPES.POINTS_FAR: return PixelCache.pixelAggregator("median_no_null");
      case TYPES.AVERAGE: {
        const aggFn = PixelCache.pixelAggregator("sum");
        aggFn.finalize = acc => acc.numPixels / acc.total; // Treats undefined as 0.
        return aggFn;
      }
    }
  }

  /**
   * Function used to calculate a tile pixel value from an array of tile pixels.
   * Tile pixels are checked for opacity, so the percentage of pixels that are opaque
   * is the relevant question.
   * For the single pixel option, use the first pixel.
   * Otherwise, use count (from which percentage can be derived).
   * @returns {function}
   */
  #calculateTilePixelAggregationFn() {
    const TYPES = SETTINGS.ELEVATION_MEASUREMENT.TYPES;
    switch ( this.options.elevationMeasurement ) {
      case TYPES.POINT: return PixelCache.pixelAggregator("first");
      case TYPES.POINTS_CLOSE:
      case TYPES.POINTS_FAR: return PixelCache.pixelAggregator("median_zero_null");
      case TYPES.POINTS_AVERAGE: {
        const threshold = this.alphaThreshold * this.constructor.#MAXIMUM_TILE_PIXEL_VALUE;
        const aggFn = PixelCache.pixelAggregator("count_gt_threshold", threshold);
        aggFn.finalize = acc => acc.numPixels / acc.total; // Treats undefined as 0.
      }
    }
  }
}
