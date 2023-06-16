/* globals
canvas,
CONFIG
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import {
  TokenPointElevationCalculator,
  tileTerrainOpaqueAverageAt,
  tileOpaqueAverageAt } from "./TokenPointElevationCalculator.js";
import { MODULE_ID } from "./const.js";

export class TokenAverageElevationCalculator extends TokenPointElevationCalculator {
  /** @type {PIXI.Polygon|PIXI.Rectangle} */
  #tokenShape;

  /** @type {number} */
  static #maximumTilePixelValue = 255;

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
