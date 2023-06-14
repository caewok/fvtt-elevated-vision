/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { almostGreaterThan, almostLessThan, almostBetween } from "./util.js";
import { MODULE_ID } from "./const.js";
import { getSetting, SETTINGS, averageTilesSetting, averageTerrainSetting } from "./settings.js";
import { tileTerrainOpaqueAverageAt } from "./TokenPointElevationCalculator";

/* Testing
TokenElevationCalculator = canvas.elevation.TokenElevationCalculator
Draw = CONFIG.GeometryLib.Draw
draw = new Draw()

draw.clearDrawings()
draw.clearLabels()


TokenElevationCalculator.isTokenOnATile(_token)
TokenElevationCalculator.isTokenOnGround(_token)
TokenElevationCalculator.isTokenOnTerrain(_token)
TokenElevationCalculator.findSupportingTileNearToken(_token)
TokenElevationCalculator.findTileNearToken(_token)
TokenElevationCalculator.findTileBelowToken(_token)
TokenElevationCalculator.groundElevationAtToken(_token)
TokenElevationCalculator.terrainElevationAtToken(_token)


[tile] = canvas.tiles.placeables
TokenElevationCalculator.tileSupportsToken(_token, tile)
TokenElevationCalculator.tokenOnTile(_token, tile)

tec = new TokenElevationCalculator(_token)
tec.isTokenOnATile()
tec.isTokenOnGround()
tec.isTokenOnTerrain()
tec.findSupportingTileNearToken()
tec.findTileNearToken()
tec.findTileBelowToken()
tec.groundElevationAtToken()
tec.terrainElevationAtToken()

[tile] = canvas.tiles.placeables
tec.tileSupportsToken(tile)
tec.tokenOnTile(tile)

tec.tokenCenter = _token.center;
tec.tokenElevation = _token.bottomE;


*/


/* Token elevation tests

I. Token elevation known.
√ A. isTokenOnTerrain
  - is the token in contact with the terrain?

√ B. isTokenOnATile
  - tokenOnTile
  - is the token in contact with a tile at the given elevation
  - non-averaging: token center is on an opaque tile pixel
  - averaging: token shape is 50% on opaque tile pixels

√ C. isTokenOnGround
  - A or B

  D. tileForToken
  - 50% or more of the tile is under the token
  - tile is within tileStep of token

  E. supportingTileForToken
  - 50% or more of the tile + terrain at tile height is under token
  - tile is within tileStep of token

"ForToken": Use the token elevation to limit the search; only tiles under the token within tileStep.

II. Token elevation unknown
√ A. terrainElevationAtToken
  - Determine the terrain elevation at a given location for the token

√ B. groundElevationAtToken
  - C, fall back to A if no tiles found

√ C. findSupportingTileBelowToken
  - 50% or more of the tile + terrain at tile height is under token

  D. findTileBelowToken
  - 50% or more of the tile is under the token

"Find": search all tiles underneath the token


III. Helpers
√ A. tileSupportsToken
  - Token is sufficiently near tile to be considered on it.
  - Within tileStep above the tile
  - No averaging: token center on an opaque tile pixel
  - Averaging: Token shape 50% on tile + terrain at tile elevation

√ B. tokenOnTile
  - Token elevation is at the tile elevation
  - No averaging: token center on an opaque tile pixel
  - Averaging: Token shape 50% on tile

*/

/* Token elevation rules: No averaging
1. Token center point is the measure.
2. Tile:
- Highest tile not above the token.
- If transparent at that point, fall to point below.
3. Terrain:
- Terrain at that point.
*/

/* Token elevation rules: averaging
1. Token shape is the measure.
2. Tile:
- Opaque Tile > 50% of token: tile elevation
- Opaque Tile + Terrain @ tile elevation > 50% of token: tile elevation
3. Terrain:
- Terrain average for that shape

*/

// Class to track and estimate token elevation.
// Basic usage can rely on static methods.
// Advanced usage can instantiate the class to avoid re-constructing options repeatedly.

export class TokenElevationCalculator {

  /** @type {TokenElevationOptions} */
  #options = {};

  /** @type {number} */
  static #maximumTilePixelValue = 255;

  constructor(token, opts = {}) {
    this.#options = TokenElevationCalculator.tokenElevationOptions(token, opts);
  }

  // NOTE: Token elevation options setup

  /**
   * @typedef {object} TokenElevationOptions
   * @property {Token} token
   * @property {Point} tokenCenter        Location to use for the token
   * @property {number} tokenElevation    Elevation to use for the token
   * @property {number} alphaThreshold    Threshold under which a tile pixel is considered a (transparent) hole.
   * @property {boolean} useAveraging     Whether or not to average over token shape
   * @property {number} averageTiles      0 if no averaging; positive number otherwise
   * @property {number} averageTerrain    0 if no averaging; positive number otherwise
   * @property {number} tileStep          How far from a tile a token can be and still move to the tile
   * @property {PIXI.Rectangle|PIXI.Polygon} tokenShape
   */

  /**
   * Options repeatedly used in these token elevation methods
   * @param {Token} token             Token data to pull if not otherwise provided
   * @param {object} opts             Preset options
   * @returns {TokenElevationOptions}
   */
  static tokenElevationOptions(token, opts = {}) {
    const tokenCenter = token.center;

    opts.token = token;
    opts.tokenCenter ??= { x: tokenCenter.x, y: tokenCenter.y };
    opts.tokenElevation ??= token.bottomE;
    opts.useAveraging ??= getSetting(SETTINGS.AUTO_AVERAGING);
    opts.alphaThreshold ??= CONFIG[MODULE_ID]?.alphaThreshold ?? 0.75;
    opts.averageTiles ??= opts.useAveraging ? averageTilesSetting() : 0;
    opts.averageTerrain ??= opts.useAveraging ? averageTerrainSetting() : 0;
    opts.tileStep ??= CONFIG[MODULE_ID]?.tileStep ?? token.topE - token.bottomE;
    opts.terrainStep ??= CONFIG[MODULE_ID]?.terrainStep ?? canvas.elevation.elevationStep;

    // Token shape is expensive, so avoid setting unless we have to.
    if ( !opts.tokenShape && opts.averageTiles ) {
      Object.defineProperty(opts, "tokenShape", {
        get: function() { return this._tokenShape || (this._tokenShape = getTokenShape(this.token, this.tokenCenter)); }
      });
    }

    // Locating tiles is expensive, so avoid setting unless we have to.
    if ( !opts.tiles ) Object.defineProperty(opts, "tiles", {
      get: function() { return this._tiles || (this._tiles = _locateTiles(this.token)); }
    });

    return opts;
  }

  get tokenCenter() { return this.#options.tokenCenter; }

  set tokenCenter(value) {
    const tokenCenter = this.#options.tokenCenter;
    if ( tokenCenter.x.almostEqual(value.x) && tokenCenter.y.almostEqual(value.y) ) return;

    // Move the token shape if it has been created.
    const tokenShape = this.#options._tokenShape;
    if ( tokenShape ) {
      const dx = value.x - tokenCenter.x;
      const dy = value.y - tokenCenter.y;
      this.#options._tokenShape = tokenShape.translate(dx, dy);
    }
    this.#options.tokenCenter = { x: value.x, y: value.y };
  }

  get tokenElevation() { return this.#options.tokenElevation; }

  set tokenElevation(value) { this.#options.tokenElevation = value; }

  get tiles() { return this.#options._tiles; }

  set tiles(value) { this.#options._tiles = value; }

  get terrainStep() { return this.#options.terrainStep; }

  get tileStep() { return this.#options.tileStep; }

  get averageTiles() { return this.#options.averageTiles; }

  get averageTerrain() { return this.#options.averageTerrain; }

  get alphaThreshold() { return this.#options.alphaThreshold; }

  get token() { return this.#options.token; }


  // NOTE: Token functions where elevation is known

  /**
   * Is the token in contact with the terrain?
   * @param {Token} token       Token to test
   * @param {TokenElevationOptions} [options]  Options that affect the calculation
   * @returns {boolean}
   */
  static isTokenOnTerrain(token, opts) {
    opts = TokenElevationCalculator.tokenElevationOptions(token, opts);
    return TokenElevationCalculator.#isTokenOnTerrain(opts);
  }

  isTokenOnTerrain() {
    const opts = this.#options;
    return TokenElevationCalculator.#terrainElevationAtToken(opts);
  }

  static #isTokenOnTerrain(opts) {
    return this.#terrainElevationAtToken(opts).almostEqual(opts.tokenElevation);
  }

  /**
   * Determine whether a token is on a tile, meaning the token is in contact with the tile.
   * @param {Token} token       Token to test
   * @param {TokenElevationOptions} [options]  Options that affect the calculation
   * @returns {boolean}
   */
  static isTokenOnATile(token, opts) {
    opts = TokenElevationCalculator.tokenElevationOptions(token, opts);
    return TokenElevationCalculator.#isTokenOnATile(opts);
  }

  isTokenOnATile() {
    const opts = this.#options;
    return TokenElevationCalculator.#isTokenOnATile(opts);
  }

  static #isTokenOnATile(opts) {
    const tiles = opts.tiles.filter(tile => tile.elevationE.almostEqual(opts.tokenElevation));
    if ( !tiles.length ) return false;

    // Determine whether the token is on a tile or only on the transparent portions
    for ( const tile of tiles ) {
      if ( TokenElevationCalculator.#tokenOnTile(tile, opts) ) return true;
    }
    return false;
  }

  /**
   * Determine whether a token is "on the ground", meaning that the token is in contact
   * with the ground layer according to elevation of the background terrain.
   * @param {Token} token       Token to test
   * @param {object} [opts]  Options that affect the calculation
   * @returns {boolean}
   */
  static isTokenOnGround(token, opts) {
    opts = TokenElevationCalculator.tokenElevationOptions(token, opts);
    return TokenElevationCalculator.#isTokenOnGround(opts);
  }

  isTokenOnGround() {
    const opts = this.#options;
    return TokenElevationCalculator.#isTokenOnGround(opts);
  }

  static #isTokenOnGround(opts) {
    if ( opts.tiles.length && TokenElevationCalculator.#isTokenOnATile(opts) ) return true;
    const terrainE = TokenElevationCalculator.#terrainElevationAtToken(opts);
    return opts.tokenElevation.almostEqual(terrainE);
  }


  /**
   * Find a tile within tileStep of the token elevation.
   * Only counts if the token is directly above the opaque portions of the tile.
   * (See supportingTileForToken for finding tiles adjacent to the token when averaging)
   * @param {Token} token
   * @param {TokenElevationOptions} opts
   * @returns {Tile|null}
   */
  static tileForToken(token, opts) {
    opts = TokenElevationCalculator.tokenElevationOptions(token, opts);
    return TokenElevationCalculator.#tileForToken(opts);
  }

  tileForToken() {
    const opts = this.#options;
    return TokenElevationCalculator.#tileForToken(opts);
  }

  static #tileForToken(opts) {
    const { tokenElevation, tileStep } = opts;
    const excludeFn = excludeUndergroundTilesFn(opts.tokenCenter, tokenElevation);
    for ( const tile of opts.tiles ) {
      const tileE = tile.elevationE;
      if ( excludeFn(tileE) ) continue;
      if ( !this.withinStep(tokenElevation, tileE, tileStep) ) continue;

      // If the token was at the tile elevation, would it be on the tile?
      opts.tokenElevation = tileE;
      if ( this.#tokenOnTile(tile, opts)) {
        opts.tokenElevation = tokenElevation;
        return tile;
      }
    }
    opts.tokenElevation = tokenElevation;
    return null;
  }

  /**
   * Find the closest tile beneath the token that would support the token.
   * If averaging, a tile sufficiently adjacent to the token, given underlying terrain, will be returned.
   * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
   * @param {TokenElevationOptions} [opts]  Options that affect the tile elevation calculation
   * @return {Tile|null} Return the tile. Elevation can then be easily determined: tile.elevationE;
   */
  static supportingTileForToken(token, opts) {
    opts = TokenElevationCalculator.tokenElevationOptions(token, opts);
    return TokenElevationCalculator.#supportingTileForToken(opts);
  }

  supportingTileForToken() {
    const opts = this.#options;
    return TokenElevationCalculator.#supportingTileForToken(opts);
  }

  static #supportingTileForToken(opts) {
    const excludeFn = excludeUndergroundTilesFn(opts.tokenCenter, opts.tokenElevation);
    for ( const tile of opts.tiles ) {
      const tileE = tile.elevation;
      if ( excludeFn(tileE) ) continue;
      if ( this.#tileSupportsToken(tile, opts)) return tile;
    }
    return null;
  }


  // NOTE: Token functions where elevation is unknown

  /**
   * Determine terrain elevation at the token location.
   * @param {Token} token       Token to test
   * @param {TokenElevationOptions} [options]  Options that affect the calculation.
   * @returns {number} Elevation in grid units.
   */
  static terrainElevationAtToken(token, opts) {
    opts = TokenElevationCalculator.tokenElevationOptions(token, opts);
    return TokenElevationCalculator.#terrainElevationAtToken(opts);
  }

  terrainElevationAtToken() {
    const opts = this.#options;
    return TokenElevationCalculator.#terrainElevationAtToken(opts);
  }

  static #terrainElevationAtToken(opts) {
    return opts.averageTerrain
      ? canvas.elevation.averageElevationWithinShape(opts.tokenShape)
      : canvas.elevation.elevationAt(opts.tokenCenter);
  }

  /**
   * Find highest tile at token location that is 50% or more under the token.
   * @param {Token} token   Token to test
   * @param {TokenElevationOptions} [options]  Options that affect the calculation.
   * @returns {number} Elevation in grid units.
   */
  static findHighestTileAtToken(token, opts) {
    opts = TokenElevationCalculator.tokenElevationOptions(token, opts);
    return TokenElevationCalculator.#findHighestTileAtToken(opts);
  }

  findHighestTileAtToken() {
    const opts = this.#options;
    return TokenElevationCalculator.#findHighestTileAtToken(opts);
  }

  static #findHighestTileAtToken(opts) {
    const tokenElevation = opts.tokenElevation;
    for ( const tile of opts.tiles ) {
      const tileE = tile.elevationE;
      opts.tokenElevation = tileE;
      if ( this.#tokenOnTile(tile, opts) ) {
        opts.tokenElevation = tokenElevation;
        return tile;
      }
    }
    opts.tokenElevation = tokenElevation;
    return null;
  }


  /**
   * Determine token elevation for a give canvas location
   * Will be either the tile elevation, if the token is on the tile, or the terrain elevation.
   * @param {Token} token       Token to test
   * @param {object} [opts]     Options that affect the calculation
   * @returns {number} Elevation in grid units.
   */
  static groundElevationAtToken(token, opts) {
    opts = TokenElevationCalculator.tokenElevationOptions(token, opts);
    return TokenElevationCalculator.#groundElevationAtToken(opts);
  }

  groundElevationAtToken() {
    const opts = this.#options;
    return TokenElevationCalculator.#groundElevationAtToken(opts);
  }

  static #groundElevationAtToken(opts) {
    const matchingTile = this.#findSupportingTileUnderToken(opts);
    const terrainE = this.#terrainElevationAtToken(opts);

    // If the terrain is above the tile, use the terrain elevation. (Math.max(null, 5) returns 5.)
    return Math.max(terrainE, matchingTile?.elevationE ?? null);
  }

  /**
   * Determine tile directly under the token location (tile and token share elevation).
   * @param {Token} token   Token to test
   * @param {TokenElevationOptions} [options]  Options that affect the calculation.
   * @returns {number} Elevation in grid units.
   */
  static findTileUnderToken(token, opts, excludeTile) {
    opts = TokenElevationCalculator.tokenElevationOptions(token, opts);
    return TokenElevationCalculator.#findTileUnderToken(opts, excludeTile);
  }

  findTileUnderToken(excludeTile) {
    const opts = this.#options;
    return TokenElevationCalculator.#findTileUnderToken(opts, excludeTile);
  }

  static #findTileUnderToken(opts, excludeTile) {
    const tokenElevation = opts.tokenElevation;
    const excludeFn = excludeUndergroundTilesFn(opts.tokenCenter, tokenElevation);
    for ( const tile of opts.tiles ) {
      if ( tile === excludeTile ) continue;
      const tileE = tile.elevationE;
      if ( excludeFn(tileE) || !almostLessThan(tileE, tokenElevation) ) continue;
      if ( this.#tokenOnTile(tile, opts) ) return tile;
    }
    return null;
  }

  /**
   * Find the highest tile beneath the token that would support the token.
   * Might be only a small part of the tile beneath the token; the rest of the space
   * could be terrain equal to the tile elevation.
   * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
   * @param {TokenElevationOptions} [opts]  Options that affect the tile elevation calculation
   * @return {Tile|null} Return the tile. Elevation can then be easily determined: tile.elevationE;
   */
  static findSupportingTileUnderToken(token, opts, excludeTile) {
    opts = TokenElevationCalculator.tokenElevationOptions(token, opts);
    return TokenElevationCalculator.#findSupportingTileUnderToken(opts, excludeTile);
  }

  findSupportingTileUnderToken(excludeTile) {
    const opts = this.#options;
    return TokenElevationCalculator.#findSupportingTileUnderToken(opts, excludeTile);
  }

  static #findSupportingTileUnderToken(opts, excludeTile) {
    const tokenElevation = opts.tokenElevation;
    const excludeFn = excludeUndergroundTilesFn(opts.tokenCenter, tokenElevation);
    for ( const tile of opts.tiles ) {
      if ( tile === excludeTile ) continue;
      const tileE = tile.elevationE;
      if ( excludeFn(tileE) || !almostLessThan(tileE, tokenElevation) ) continue;
      if ( this.#tileCouldSupportToken(tile, opts)) return tile;
    }
    return null;
  }

  // NOTE: Tile tests

  /**
   * Is the token on the tile?
   * Averaging: > 50% on the tile.
   * Not averaging: not over a hole pixel.
   * @param {Token} token       Token to test
   * @param {object} [opts]  Options that affect the calculation
   * @returns {boolean}
   */
  static tokenOnTile(token, tile, opts) {
    opts = TokenElevationCalculator.tokenElevationOptions(token, opts);
    return TokenElevationCalculator.#tokenOnTile(tile, opts);
  }

  tokenOnTile(tile) {
    const opts = this.#options;
    return TokenElevationCalculator.#tokenOnTile(tile, opts);
  }

  static #tokenOnTile(tile, opts) {
    // If token not at the tile elevation, not on the tile.
    const tileE = tile.elevationE;
    if ( !opts.tokenElevation.almostEqual(tileE) ) return false;

    return opts.averageTiles
      ? tileOpaqueAverageAt(tile, opts.tokenShape, opts.alphaThreshold, opts.averageTiles)
      : tileOpaqueAt(tile, opts.tokenCenter, opts.alphaThreshold);
  }

  /**
   * Is the token sufficiently near a tile such that it can be considered on the tile?
   * Token must be at tile elevation or within tileStep of it.
   * If not averaging, then token center has to be contained by the tile and on a non-transparent pixel.
   * If averaging, token elevation at terrain + tile portions must be equal to the tile at > 50% of the space.
   * @param {Token} token   Token to test
   * @param {Tile} tile     Tile to test
   * @param {TokenElevationOptions} [opts]  Options that affect the tile elevation calculation
   * @returns {boolean}
   */
  static tileSupportsToken(token, tile, opts) {
    opts = TokenElevationCalculator.tokenElevationOptions(token, opts);
    return TokenElevationCalculator.#tileSupportsToken(tile, opts);
  }

  tileSupportsToken(tile) {
    const opts = this.#options;
    return TokenElevationCalculator.#tileSupportsToken(tile, opts);
  }

  static #tileSupportsToken(tile, opts) {
    const tileE = tile.elevationE;

    // If token not within tileStep of the tile, tile does not support token.
    if ( !this.withinStep(opts.tokenElevation, tileE, opts.tileStep) ) return false;
    return this.#tileCouldSupportToken(tile, opts);
  }

  /**
   * Token could be supported by tile, assuming elevation step constraint is met.
   * If not averaging, then token center has to be contained by the tile and on a non-transparent pixel.
   * If averaging, token elevation at terrain + tile portions must be equal to the tile at > 50% of the space.
   * @param {Token} token   Token to test
   * @param {Tile} tile     Tile to test
   * @param {TokenElevationOptions} [opts]  Options that affect the tile elevation calculation
   * @returns {boolean}
   */
  static tileCouldSupportToken(token, tile, opts) {
    opts = TokenElevationCalculator.tokenElevationOptions(token, opts);
    return TokenElevationCalculator.#tileSupportsToken(tile, opts);
  }

  tileCouldSupportToken(tile) {
    const opts = this.#options;
    return TokenElevationCalculator.#tileCouldSupportToken(tile, opts);
  }

  static #tileCouldSupportToken(tile, opts) {
    if ( opts.averageTiles ) {
      return tileTerrainOpaqueAverageAt(tile, opts.tokenShape, opts.alphaThreshold, opts.averageTiles);
    }

    // If not averaging, token must be within the tile alpha bounds and on an opaque point
    // or at terrain level equal to the tile.
    const terrainE = canvas.elevation.elevationAt(opts.tokenCenter);
    if ( this.withinStep(terrainE, tile.elevationE, opts.tileStep) ) return true;
    return tileOpaqueAt(tile, opts.tokenCenter, opts.alphaThreshold); // Do slower test last.
  }

  /**
   * Object is within a permitted step from provided elevation.
   * @param {number} tokenE       Token elevation to test against
   * @param {number} objE         Object elevation
   * @param {number} tileStep     Permitted tile step
   * @returns {boolean}
   */
  static withinStep(tokenE, objE, step) { return almostBetween(tokenE, objE, objE + step); }

  /*
   * Tile is within a permitted step from provided elevation.
   * @param {Tile} tile           Tile to test
   * @returns {boolean}
   */
  tileWithinStep(tile) {
    const opts = this.#options;
    const tileE = tile.elevationE;
    return almostBetween(opts.tokenElevation, tileE, tileE + opts.tileStep);
  }

  /*
   * Terrain is within a permitted step from provided elevation.
   * @param {number} terrainE     Tile to test
   * @returns {boolean}
   */
  terrainWithinStep(terrainE) {
    const opts = this.#options;
    terrainE ??= TokenElevationCalculator.#terrainElevationAtToken(opts);
    return almostBetween(opts.tokenElevation, terrainE, terrainE + opts.terrainStep);
  }
}

// NOTE: Helper functions

/**
 * Function to check whether tiles should be excluded because either the tile or the token
 * is underground. (tile underground xor token underground)
 * @param {Point} tokenCenter
 * @param {number} tokenElevation
 * @returns {function}
 */
function excludeUndergroundTilesFn(tokenCenter, tokenElevation) {
  // If token is below ground, tiles must be below ground, and vice-versa.
  const terrainE = canvas.elevation.elevationAt(tokenCenter);
  return almostGreaterThan(tokenElevation, terrainE)
    ? tileE => tileE < terrainE // Token is above ground; exclude below
    : tileE => almostGreaterThan(tileE, terrainE); // Token is below ground
}

/**
 * Get token shape for the token
 * @param {Token} token
 * @param {Point} [tokenCenter]   Optional location of the token
 * @returns {PIXI.Polygon|PIXI.Rectangle}
 */
function getTokenShape(token, tokenCenter) {
  tokenCenter ??= token.center;
  const tokenTL = token.getTopLeft(tokenCenter.x, tokenCenter.y);
  return canvas.elevation._tokenShape(tokenTL, token.w, token.h);
}

/**
 * Find tiles that qualify as "terrain" tiles, meaning they are overhead tiles
 * with finite elevation.
 * @returns {Tile[]}
 */
function _locateTiles(token) {
  // Filter tiles that potentially serve as ground from canvas tiles.
  const tiles = [...canvas.tiles.quadtree.getObjects(token.bounds)].filter(tile => {
    if ( !tile.document.overhead ) return false;
    return isFinite(tile.elevationE);
  });
  tiles.sort((a, b) => b.elevationZ - a.elevationZ);
  return tiles;
}

// NOTE: Measurements of tile opacity / transparency

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
export function tileOpaqueAt(tile, tokenCenter, alphaThreshold) {
  const cache = tile._evPixelCache;
  if ( !cache ) return false;
  return cache.containsPixel(tokenCenter.x, tokenCenter.y, alphaThreshold);
}
