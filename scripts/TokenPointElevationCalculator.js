/* globals
CONFIG,
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { CoordinateElevationCalculator } from "./CoordinateElevationCalculator.js";

export class TokenPointElevationCalculator extends CoordinateElevationCalculator {
  /** @type {Token} */
  #token;

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

    super(location, opts);
    this.#token = token;
  }

  /** @type {Token} */
  get token() { return this.#token; }
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
  const cache = tile._evPixelCache;
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
  const cache = tile._evPixelCache;
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
  const cache = tile._evPixelCache;
  if ( !cache ) return false;
  const pixelThreshold = MAXIMUM_TILE_PIXEL_VALUE * alphaThreshold;
  return cache.percent(tokenShape, pixelThreshold, averageTiles) > 0.5;
}

