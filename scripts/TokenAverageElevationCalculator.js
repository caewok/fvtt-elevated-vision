/* globals
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { TokenPointElevationCalculator } from "./TokenPointElevationCalculator.js";
import { averageTilesSetting, averageTerrainSetting } from "./settings.js";
import { MODULE_ID } from "./const.js";

export class TokenAverageElevationCalculator extends TokenPointElevationCalculator {
  /** @type {PIXI.Polygon|PIXI.Rectangle} */
  #tokenShape;

  /**
   * Add averaging settings to the config.
   * @inheritDocs
   */
  _configure(opts = {}) {
    // Need this value to be always greater than 0
    opts.averageTiles ||= CONFIG[MODULE_ID]?.averageTiles || 1;
    opts.averageTerrain ||= CONFIG[MODULE_ID]?.averageTerrain || 1;
    super._configure(opts);
  }

  /**
   * Token shape is expensive, so avoid until necessary.
   * @type {PIXI.Polygon|PIXI.Rectangle}
   */
  get tokenShape() {
    return this.#tokenShape
      || (this.#tokenShape = TokenAverageElevationCalculator.getTokenShape(this.token, this.location));
  }

  set tokenShape(value) { this.#tokenShape = value; }

  get bounds() {
    return this.tokenShape.getBounds();
  }

  _refreshLocation() {
    this.#tokenShape = undefined;
    super._refreshLocation();
  }

  /**
   * Get token shape for the token
   * @param {Token} token
   * @param {Point} [tokenCenter]   Optional location of the token
   * @returns {PIXI.Polygon|PIXI.Rectangle}
   */
  static getTokenShape(token, tokenCenter) {
    tokenCenter ??= token.center;
    const tokenTL = token.getTopLeft(tokenCenter.x, tokenCenter.y);
    return canvas.elevation._tokenShape(tokenTL, token.w, token.h);
  }

  /**
   * Find the average terrain elevation for this token
   * @param {Token}
   * @param {Point} [location]
   * @returns {number}
   */
  static terrainElevationAt(token, location) {
    const tokenShape = TokenAverageElevationCalculator.getTokenShape(token, location);
    return canvas.elevation.averageElevationWithinShape(tokenShape);
  }


  /**
   * Find the terrain elevation for this token
   * @returns {number}
   */
  terrainElevation() {
    return Math.max(canvas.elevation.averageElevationWithinShape(this.tokenShape), this.findHighestETL());
  }

  /**
   * Determine if the token is on the tile.
   * Point must be approximately at the tile elevation and not over a hole pixel of the tile.
   * @param {Tile} tile       Tile to test
   * @returns {bolean}
   */
  isOnTile(tile) {
    if ( !tile ) return Boolean(this.findTileAtElevation());
    const tileE = tile.elevationE;
    if ( !this.elevation.almostEqual(tileE) ) return false;
    return tileOpaqueAverageAt(tile, this.tokenShape, this.options.alphaThreshold, this.options.averageTiles);
  }

  /**
   * This coordinate could be supported by the tile
   * @param {Tile} tile
   * @returns {boolean}
   */
  tileCouldSupport(tile) {
    return tileTerrainOpaqueAverageAt(tile, this.tokenShape, this.options.alphaThreshold, this.options.averageTiles);
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
function tileTerrainOpaqueAverageAt(tile, tokenShape, alphaThreshold, averageTiles) {
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
  const pixelE = canvas.elevation.elevationToPixelValue(tileE);
  const pixelThreshold = canvas.elevation.maximumPixelValue * alphaThreshold;
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

function tileOpaqueAverageAt(tile, tokenShape, alphaThreshold, averageTiles) {
  const cache = tile._evPixelCache;
  if ( !cache ) return false;
  const pixelThreshold = canvas.elevation.maximumPixelValue * alphaThreshold;
  return cache.percent(tokenShape, pixelThreshold, averageTiles) > 0.5;
}
