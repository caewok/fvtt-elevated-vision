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

export class TokenPointElevationCalculator extends CoordinateElevationCalculator {
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
    const location = opts.tokenCenter ?? token.center;
    opts.elevation ??= opts.tokenElevation ?? token.bottomE;

    // Set tileStep and terrainStep to token height if not otherwise defined.
    // (Do this here b/c _configure method does not yet have the token set.)
    const tokenHeight = token.topE - token.bottomE;
    opts.tileStep ??= CONFIG[MODULE_ID]?.tileStep ?? (tokenHeight || 1);
    opts.terrainStep ??= CONFIG[MODULE_ID]?.terrainStep ?? (tokenHeight || canvas.elevation.elevationStep);
    opts.elevationMeasurement ??= getSetting(SETTINGS.ELEVATION_MEASUREMENT.ALGORITHM);

    super(location, opts);
    this.#token = token;

    this.terrainPixelAggregationFn = this.#calculateTerrainPixelAggregationFn();
    this.tilePixelAggregationFn = this.#calculateTilePixelAggregationFn();
  }

  /** @type {Token} */
  get token() { return this.#token; }

  /** @type {number[]} */
  get canvasOffsetGrid() {
    return this.#canvasOffsetGrid || (this.#canvasOffsetGrid = this.#calculateTokenOffsets);
  }

  /**
   * Token shape is expensive, so avoid until necessary.
   * @type {PIXI.Polygon|PIXI.Rectangle}
   */
  get tokenShape() {
    return this.#tokenShape || (this.#tokenShape = this.#calculateTokenShape(this.location));
  }

  terrainElevation() {
    const localOffsets = this.#localOffsetsMap("terrain")
      || (this.#localOffsetsMap.set("terrain", this.#localGridOffsets(canvas.elevation.elevationPixelCache)).get("terrain"));
    const pixels = this.pixelsForRelativePointsFromCanvas();
    return this.terrainPixelAggregationFn(pixels);
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
   * Get token shape for the token
   * @param {Point} [tokenCenter]   Optional location of the token
   * @returns {PIXI.Polygon|PIXI.Rectangle}
   */
  #calculateTokenShape(tokenCenter) {
    tokenCenter ??= this.location;
    const tokenTL = this.token.getTopLeft(tokenCenter.x, tokenCenter.y);
    return canvas.elevation._tokenShape(tokenTL, this.token.w, this.token.h);
  }

  #calculateTokenOffsets(cache) {
    const { TYPES, ALGORITHM } = SETTINGS.ELEVATION_MEASUREMENT;
    const algorithm = getSetting(ALGORITHM);
    const { w, h } = this.token;
    const skipPercent = CONFIG[MODULE_ID].skipPercentage[ALGORITHM];
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
      case TYPES.POINTS_FAR: return PixelCache.pixelAggregator("median");
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
    switch ( this.options.setting.elevationMeasurement ) {
      case TYPES.POINT: return PixelCache.pixelAggregator("first");
      case TYPES.POINTS_CLOSE:
      case TYPES.POINTS_FAR: return PixelCache.pixelAggregator("median_zero_null");
      case TYPES.POINTS_AVERAGE: {
        const threshold = this.alphaThreshold;
        return PixelCache.pixelAggregator("count_gt_threshold", threshold);
      }
    }
  }
}

/**
 * Determine the percentage of which the tile + terrain covers a token shape.
 * Tile opaqueness depends on the alphaThreshold and whether measuring the point or the average.
 * Token would fall through if tile is transparent unless terrain would fill the gap(s).
 * @param {Tile} tile                                 Tile to test
 * @param {Point} tokenCenter                         Center point
 * @param {number} averageTiles                       Positive integer to skip pixels when averaging.
 *                                                    0 if point-based.
 * @param {number} alphaThreshold                     Threshold to determine transparency
 * @param {PIXI.Rectangle|PIXI.Polygon} [tokenShape]  Shape representing a token boundary
 *                                                    Required if not averaging
 * @returns {boolean}
 */
export function tileTerrainOpaqueAverageAt(tile, tokenShape, alphaThreshold, averageTiles) {
  const cache = tile.evPixelCache;
  if ( !cache ) return false;

  // This is tricky, b/c we want terrain to count if it is the same height as the tile.
  // So if a token is 40% on a tile at elevation 30, 40% on terrain elevation 30 and
  // 20% on transparent tile with elevation 0, the token elevation should be 30.
  // In the easy cases, there is 50% coverage for either tile or terrain alone.
  // But the hard case makes us iterate over both tile and terrain at once,
  // b/c otherwise we cannot tell where the overlaps occur. E.g., 30% tile, 20% terrain?
  const countFn = tileTerrainOpacityCountFunction(tile, alphaThreshold);
  const denom = cache.applyFunctionToShape(countFn, tokenShape, averageTiles);
  const percentCoverage = countFn.sum / denom;
  return percentCoverage > 0.5;
}

const MAXIMUM_TILE_PIXEL_VALUE = 255;

function tileTerrainOpacityCountFunction(tile, alphaThreshold) {
  // This is tricky, b/c we want terrain to count if it is the same height as the tile.
  // So if a token is 40% on a tile at elevation 30, 40% on terrain elevation 30 and
  // 20% on transparent tile with elevation 0, the token elevation should be 30.
  // In the easy cases, there is 50% coverage for either tile or terrain alone.
  // But the hard case makes us iterate over both tile and terrain at once,
  // b/c otherwise we cannot tell where the overlaps occur. E.g., 30% tile, 20% terrain?
  const cache = tile.evPixelCache;
  const tileE = tile.elevationE;
  const evCache = canvas.elevation.elevationPixelCache;
  const pixelE = canvas.elevation._normalizeElevation(tileE);
  const pixelThreshold = MAXIMUM_TILE_PIXEL_VALUE * alphaThreshold;
  const countFn = (value, _i, localX, localY) => {
    if ( value > pixelThreshold ) countFn.sum += 1;
    else {
      const canvas = cache._toCanvasCoordinates(localX, localY);
      const terrainValue = evCache.pixelAtCanvas(canvas.x, canvas.y);
      if ( terrainValue.almostEqual(pixelE) ) countFn.sum += 1;
    }
  };
  countFn.sum = 0;
  return countFn;
}

export function tileOpaqueAverageAt(tile, tokenShape, alphaThreshold, averageTiles) {
  const cache = tile.evPixelCache;
  if ( !cache ) return false;
  const pixelThreshold = MAXIMUM_TILE_PIXEL_VALUE * alphaThreshold;
  return cache.percent(tokenShape, pixelThreshold, averageTiles) > 0.5;
}

