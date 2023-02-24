/* globals
canvas,
Ray,
CONFIG,
Hooks
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { log, almostGreaterThan, almostBetween } from "./util.js";
import { MODULE_ID } from "./const.js";
import { getSceneSetting, getSetting, SETTINGS, averageTilesSetting, averageTerrainSetting } from "./settings.js";
import { TravelElevation } from "./TravelElevation.js";

/* Testing
TokenElevation = canvas.elevation.TokenElevation
Draw = CONFIG.GeometryLib.Draw
draw = new Draw()

draw.clearDrawings()
draw.clearLabels()


TokenElevation.isTokenOnATile(_token)
TokenElevation.isTokenOnGround(_token)
TokenElevation.isTokenOnTerrain(_token)
TokenElevation.findSupportingTileNearToken(_token)
TokenElevation.findTileNearToken(_token)
TokenElevation.findTileBelowToken(_token)
TokenElevation.groundElevationAtToken(_token)
TokenElevation.terrainElevationAtToken(_token)


[tile] = canvas.tiles.placeables
TokenElevation.tileSupportsToken(_token, tile)
TokenElevation.tokenOnTile(_token, tile)

te = new TokenElevation(_token)
te.isTokenOnATile()
te.isTokenOnGround()
te.isTokenOnTerrain()
te.findSupportingTileNearToken()
te.findTileNearToken()
te.findTileBelowToken()
te.groundElevationAtToken()
te.terrainElevationAtToken()

[tile] = canvas.tiles.placeables
te.tileSupportsToken(tile)
te.tokenOnTile(tile)

te.tokenCenter = _token.center;
te.tokenElevation = _token.bottomE;


*/

/* Token movement flow:

I. Arrow keys:

1. preUpdateToken hook (args: tokenDoc, changes obj, {diff: true, render: true}, id)
2. token.prototype._refresh (animate: false)
3. (2) may repeat
4. refreshToken hook (args: token, empty object)
5. updateToken hook (args: tokenDoc, changes obj, {diff: true, render: true}, id)

6. token.prototype._refresh (animate: true)
7. refreshToken hook (args: token,  {bars: false, border: true, effects: false, elevation: false, nameplate: false})
8. (6) and (7) may repeat, a lot. In between, lighting and sight updated

II. Dragging:

1. token.prototype.clone
2. token.prototype._refresh (animate: false)
3. refreshToken hook (args: token, empty object)
4. token.prototype._refresh (animate: false, clone)
5. refreshToken hook (args: token, empty object) (token is probably the clone)
(this cycle repeats for awhile)
...
6. destroyToken hook (args: token) (token is probably the clone)
7. token.prototype._refresh (animate: false)
8. preUpdateToken hook (args: tokenDoc, changes obj, {diff: true, render: true}, id)
9. sight & lighting refresh
10. token.prototype._refresh (animate: false) (this is the entire dragged move, origin --> destination)
11. refreshToken hook (args: token, empty object)
12. updateToken hook (args: tokenDoc, changes obj, {diff: true, render: true}, id)

13. token.prototype._refresh (animate: true) (increments vary)
14.refreshToken hook (args: token,  {bars: false, border: true, effects: false, elevation: false, nameplate: false})
15. (13) and (14) may repeat, a lot. In between, lighting and sight updated

*/

/* Token move segment elevation
What is needed in order to tell final token elevation in a line from origin --> destination?
Assume a token that walks "off" a tile is now "flying" and stops elevation changes.

1. If token origin is not on the ground, no automated elevation changes.

2. If no tiles present in the line, this is easy: token changes elevation.

3. Tile(s) present. For each tile:
Line through tile.
Start elevation is the point immediately prior to the tile start on the line.
If tile is above start elevation, ignore.
Each pixel of the tile on the line:
- If transparent, automation stops unless ground at this point is at or above tile.
- If terrain above, current elevation changes. Check for new tiles between this point and destination.

Probably need:
a. Terrain elevation array for a given line segment.
b. Tile alpha array for a given line segment.
c. Tile - line segment intersection; get ground and tile elevation at that point.
d. Locate tiles along a line segment, and filter according to elevations.
*/

// Automatic elevation Rule:
// If token elevation currently equals the terrain elevation, then assume
// moving the token should update the elevation.
// E.g. Token is flying at 30' above terrain elevation of 0'
// Token moves to 25' terrain. No auto update to elevation.
// Token moves to 35' terrain. No auto update to elevation.
// Token moves to 30' terrain. Token & terrain elevation now match.
// Token moves to 35' terrain. Auto update, b/c previously at 30' (Token "landed.")


/*
Fly-mode:
Origination   Destination   Lower       Same (§)    Higher
terrain       terrain       fly         terrain     terrain
terrain       tile          fly         tile        NA (stays on origination terrain)
tile          tile          fly         tile        NA (stays on origination tile)
tile          terrain       fly         terrain     terrain
fly           terrain       fly         terrain     terrain

No-fly-mode:
Origination   Destination   Lower       Same (§)    Higher
terrain       terrain       terrain     terrain     terrain
terrain       tile          tile        tile        NA (stays on origination terrain)
tile          tile          tile        tile        NA (stays on origination tile)
tile          terrain       terrain     terrain     terrain

§ Within 1 elevation unit in either direction, treated as Same.
*/

/*
Programming by testing a position for the token:
- Need to know the straight-line path taken.
- Locate tile-terrain intersections and tile-tile intersections.
- At each intersection, pick terrain or tile. Remember the tile elevation.
- If fly is enabled, can pick "fly" as the third transition. Remember fly elevation

Animating for any given location:
- Check against segment spans. Point between:
  - tile: use tile elevation
  - terrain: get current terrain elevation
  - fly: use fly elevation
*/

// NOTE: Token hooks

// Reset the token elevation when moving the token after a cloned drag operation.
// Token.prototype._refresh is then used to update the elevation as the token is moved.
Hooks.on("preUpdateToken", function(tokenD, changes, options, userId) {  // eslint-disable-line no-unused-vars
  const token = tokenD.object;
  log(`preUpdateToken hook ${changes.x}, ${changes.y}, ${changes.elevation} at elevation ${token.document?.elevation} with elevationD ${tokenD.elevation}`, changes);
  log(`preUpdateToken hook moving ${tokenD.x},${tokenD.y} --> ${changes.x ? changes.x : tokenD.x},${changes.y ? changes.y : tokenD.y}`);

  token._elevatedVision ??= {};
  token._elevatedVision.tokenAdjustElevation = false; // Just a placeholder
  token._elevatedVision.tokenHasAnimated = false;

  if ( !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return;
  if ( typeof changes.x === "undefined" && typeof changes.y === "undefined" ) return;

  const tokenCenter = token.center;
  const tokenDestination = token.getCenter(changes.x ? changes.x : tokenD.x, changes.y ? changes.y : tokenD.y );
  const travelRay = new Ray(tokenCenter, tokenDestination);
  const te = new TravelElevation(token, travelRay);
  const travel = token._elevatedVision.travel = te.calculateElevationAlongRay(token.document.elevation);
  if ( !travel.adjustElevation ) return;

  if ( tokenD.elevation !== travel.finalElevation ) changes.elevation = travel.finalElevation;
  tokenD.object._elevatedVision.tokenAdjustElevation = true;
});

/**
 * Wrap Token.prototype._refresh
 * Adjust elevation as the token moves.
 */
export function _refreshToken(wrapper, options) {
  if ( !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return wrapper(options);

  // Old position: this.position
  // New position: this.document

  // Drag starts with position set to 0, 0 (likely, not yet set).
  if ( !this.position.x && !this.position.y ) return wrapper(options);

  if ( this.position.x === this.document.x && this.position.y === this.document.y ) return wrapper(options);

  log(`token _refresh at ${this.document.x},${this.document.y} (center ${this.center.x},${this.center.y}) with elevation ${this.document.elevation} animate: ${Boolean(this._animation)}`);


  const ev = this._elevatedVision;
  if ( !ev || !ev.tokenAdjustElevation ) {
    log("Token _refresh: Adjust elevation is false.");
    return wrapper(options);
  }

  if ( this._original ) {
    log("token _refresh is clone.");
    // This token is a clone in a drag operation.
    // Adjust elevation of the clone by calculating the elevation from origin to line.
    const { startPosition, startElevation, te } = ev;

    // Update the previous travel ray
    te.travelRay = new Ray(startPosition, this.center);
   // const newTE = new TravelElevation(this, travelRay);

    // Determine the new final elevation.
    const finalElevation = te.calculateFinalElevation(startElevation);
    log(`{x: ${te.travelRay.A.x}, y: ${te.travelRay.A.y}, e: ${startElevation} } --> {x: ${te.travelRay.B.x}, y: ${te.travelRay.B.y}, e: ${finalElevation} }`, te);
    this.document.elevation = finalElevation;

  } else if ( this._animation ) {
    // Adjust the elevation as the token is moved by locating where we are on the travel ray.
    log("token _refresh: animation");
    const tokenCenter = this.center;
    const { travelRay, elevationChanges } = ev.travel;
    const currT = travelRay.tConversion(tokenCenter);
    const ln = elevationChanges.length;
    let change = elevationChanges[ln - 1];
    for ( let i = 1; i < ln; i += 1 ) {
      if ( elevationChanges[i].ix.t0 > currT ) {
        change = elevationChanges[i-1];
        break;
      }
    }

    const TERRAIN = TravelElevation.TOKEN_ELEVATION_STATE.TERRAIN;
    change ??= { currState: TERRAIN };
    if ( change.currState === TERRAIN ) change.currE = TokenElevation.terrainElevationAtToken(this, { tokenCenter });
    options.elevation ||= this.document.elevation !== change.currE;

    this.document.elevation = change.currE;
    log(`{x: ${tokenCenter.x}, y: ${tokenCenter.y}, e: ${change.currE} }`, ev.travel);
  }

  return wrapper(options);
}

/**
 * Wrap Token.prototype.clone
 * Determine if the clone should adjust elevation
 */
export function cloneToken(wrapper) {
  log(`cloneToken ${this.name} at elevation ${this.document.elevation}`);
  const clone = wrapper();

  clone._elevatedVision ??= {};
  clone._elevatedVision.tokenAdjustElevation = false; // Just a placeholder

  if ( !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return clone;

  const FLY = TravelElevation.TOKEN_ELEVATION_STATE.FLY;
  const {x, y} = clone.center;
  const travelRay = new Ray({ x, y }, { x, y }); // Copy; don't reference.
  const te = new TravelElevation(clone, travelRay);
  te.tokenElevation.tokenElevation = this.document.elevation;
  if ( !te.fly ) {
    const { currState } = te.currentTokenState();
    if ( currState === FLY ) return clone;
  }

  log(`cloneToken ${this.name} at elevation ${this.document.elevation}: setting adjust elevation to true`);

  clone._elevatedVision.tokenAdjustElevation = true;
  clone._elevatedVision.startPosition = {x, y};
  clone._elevatedVision.startElevation = this.document.elevation;
  clone._elevatedVision.te = te;
  return clone;
}

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

II. Token elevation unknown
√ A. terrainElevationAtToken
  - Determine the terrain elevation at a given location for the token

√ B. findTileBelowToken
  - Determine the tile at a given location that is at or below token
  - Token must be on the tile at the given tile elevation
  - null if no tile qualifies.

√ C. groundElevationAtToken
  - B, fall back to A if no tiles found

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

C. findTileNearToken
  - tokenOnTile
  - meaning token is above tile no more than tile step

D. findSupportingTileNearToken
  - nearest tile that could support the token

*/


// Class to track and estimate token elevation.
// Basic usage can rely on static methods.
// Advanced usage can instantiate the class to avoid re-constructing options repeatedly.

export class TokenElevation {

  /** @type {TokenElevationOptions} */
  #options = {};

  constructor(token, opts = {}) {
    this.#options = TokenElevation.tokenElevationOptions(token, opts);
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
    opts = TokenElevation.tokenElevationOptions(token, opts);
    return TokenElevation.#isTokenOnTerrain(opts);
  }

  isTokenOnTerrain() {
    const opts = this.#options;
    return TokenElevation.#terrainElevationAtToken(opts);
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
    opts = TokenElevation.tokenElevationOptions(token, opts);
    return TokenElevation.#isTokenOnATile(opts);
  }

  isTokenOnATile() {
    const opts = this.#options;
    return TokenElevation.#isTokenOnATile(opts);
  }

  static #isTokenOnATile(opts) {
    const tiles = opts.tiles.filter(tile => tile.elevationE.almostEqual(opts.tokenElevation));
    if ( !tiles.length ) return false;

    // Determine whether the token is on a tile or only on the transparent portions
    for ( const tile of tiles ) {
      if ( TokenElevation.#tokenOnTile(tile, opts) ) return true;
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
    opts = TokenElevation.tokenElevationOptions(token, opts);
    return TokenElevation.#isTokenOnGround(opts);
  }

  isTokenOnGround() {
    const opts = this.#options;
    return TokenElevation.#isTokenOnGround(opts);
  }

  static #isTokenOnGround(opts) {
    if ( opts.tiles.length && TokenElevation.#isTokenOnATile(opts) ) return true;
    const terrainE = TokenElevation.#terrainElevationAtToken(opts);
    return opts.tokenElevation.almostEqual(terrainE);
  }

  /**
   * Is the token on the tile?
   * Averaging: > 50% on the tile.
   * Not averaging: not over a hole pixel.
   * @param {Token} token       Token to test
   * @param {object} [opts]  Options that affect the calculation
   * @returns {boolean}
   */
  static tokenOnTile(token, tile, opts) {
    opts = TokenElevation.tokenElevationOptions(token, opts);
    return TokenElevation.#tokenOnTile(tile, opts);
  }

  tokenOnTile(tile) {
    const opts = this.#options;
    return TokenElevation.#tokenOnTile(tile, opts);
  }

  static #tokenOnTile(tile, opts) {
    // If token not at the tile elevation, not on the tile.
    const tileE = tile.elevationE;
    if ( !opts.tokenElevation.almostEqual(tileE) ) return false;

    return opts.averageTiles
      ? tileOpaqueAverageAt(tile, opts.tokenShape, opts.alphaThreshold, opts.averageTiles)
      : tileOpaqueAt(tile, opts.tokenCenter, opts.alphaThreshold);
  }

  // NOTE: Token functions where elevation is unknown

  /**
   * Determine terrain elevation at the token location.
   * @param {Token} token       Token to test
   * @param {TokenElevationOptions} [options]  Options that affect the calculation.
   * @returns {number} Elevation in grid units.
   */
  static terrainElevationAtToken(token, opts) {
    opts = TokenElevation.tokenElevationOptions(token, opts);
    return TokenElevation.#terrainElevationAtToken(opts);
  }

  terrainElevationAtToken() {
    const opts = this.#options;
    return TokenElevation.#terrainElevationAtToken(opts);
  }

  static #terrainElevationAtToken(opts) {
    return opts.averageTerrain
      ? canvas.elevation.averageElevationWithinShape(opts.tokenShape)
      : canvas.elevation.elevationAt(opts.tokenCenter);
  }

  /**
   * Find highest tile at token location.
   * @param {Token} token   Token to test
   * @param {TokenElevationOptions} [options]  Options that affect the calculation.
   * @returns {number} Elevation in grid units.
   */
  static findHighestTileAtToken(token, opts) {
    opts = TokenElevation.tokenElevationOptions(token, opts);
    return TokenElevation.#findTileBelowToken(opts);
  }

  findHighestTileAtToken() {
    const opts = this.#options;
    return TokenElevation.#findHighestTileAtToken(opts);
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
   * Determine tile directly under the token location (tile and token share elevation).
   * @param {Token} token   Token to test
   * @param {TokenElevationOptions} [options]  Options that affect the calculation.
   * @returns {number} Elevation in grid units.
   */
  static findTileBelowToken(token, opts, excludeTile) {
    opts = TokenElevation.tokenElevationOptions(token, opts);
    return TokenElevation.#findTileBelowToken(opts, excludeTile);
  }

  findTileBelowToken(excludeTile) {
    const opts = this.#options;
    return TokenElevation.#findTileBelowToken(opts, excludeTile);
  }

  static #findTileBelowToken(opts, excludeTile) {
    const excludeFn = excludeUndergroundTilesFn(opts.tokenCenter, opts.tokenElevation);
    for ( const tile of opts.tiles ) {
      if ( tile === excludeTile ) continue;
      const tileE = tile.elevationE;
      if ( excludeFn(tileE) ) continue;
      if ( this.#tokenOnTile(tile, opts) ) return tile;
    }
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
    opts = TokenElevation.tokenElevationOptions(token, opts);
    return TokenElevation.#groundElevationAtToken(opts);
  }

  groundElevationAtToken() {
    const opts = this.#options;
    return TokenElevation.#groundElevationAtToken(opts);
  }

  static #groundElevationAtToken(opts) {
    const matchingTile = this.#findTileBelowToken(opts);
    const terrainE = this.#terrainElevationAtToken(opts);

    // If the terrain is above the tile, use the terrain elevation. (Math.max(null, 5) returns 5.)
    return Math.max(terrainE, matchingTile?.elevationE ?? null);
  }

  /**
   * Find a tile within tileStep of the token elevation.
   * Only counts if the token is directly above the opaque portions of the tile.
   * (See findSupportingTileNearToken for finding tiles adjacent to the token when averaging)
   * @param {Token} token
   * @param {TokenElevationOptions} opts
   * @returns {Tile|null}
   */
  static findTileNearToken(token, opts) {
    opts = TokenElevation.tokenElevationOptions(token, opts);
    return TokenElevation.#findTileNearToken(opts);
  }

  findTileNearToken() {
    const opts = this.#options;
    return TokenElevation.#findTileNearToken(opts);
  }

  static #findTileNearToken(opts) {
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
  static findSupportingTileNearToken(token, opts) {
    opts = TokenElevation.tokenElevationOptions(token, opts);
    return TokenElevation.#findSupportingTileNearToken(opts);
  }

  findSupportingTileNearToken() {
    const opts = this.#options;
    return TokenElevation.#findSupportingTileNearToken(opts);
  }

  static #findSupportingTileNearToken(opts) {
    const excludeFn = excludeUndergroundTilesFn(opts.tokenCenter, opts.tokenElevation);
    for ( const tile of opts.tiles ) {
      const tileE = tile.elevation;
      if ( excludeFn(tileE) ) continue;
      if ( this.#tileSupportsToken(tile, opts)) return tile;
    }
    return null;
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
    opts = TokenElevation.tokenElevationOptions(token, opts);
    return TokenElevation.#tileSupportsToken(tile, opts);
  }

  tileSupportsToken(tile) {
    const opts = this.#options;
    return TokenElevation.#tileSupportsToken(tile, opts);
  }

  static #tileSupportsToken(tile, opts) {
    const tileE = tile.elevationE;

    // If token not within tileStep of the tile, tile does not support token.
    if ( !this.withinStep(opts.tokenElevation, tileE, opts.tileStep) ) return false;
    return this.tileCouldSupportToken(tile, opts);
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
    opts = TokenElevation.tokenElevationOptions(token, opts);
    return TokenElevation.#tileSupportsToken(tile, opts);
  }

  tileCouldSupportToken(tile) {
    const opts = this.#options;
    return TokenElevation.#tileCouldSupportToken(tile, opts);
  }

  static #tileCouldSupportToken(tile, opts) {
    return opts.averageTiles
      ? tileTerrainOpaqueAverageAt(tile, opts.tokenShape, opts.alphaThreshold, opts.averageTiles)
      : tileOpaqueAt(tile, opts.tokenCenter, opts.alphaThreshold);
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
    terrainE ??= TokenElevation.#terrainElevationAtToken(opts);
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
  const cache = tile._textureData?._evPixelCache;
  if ( !cache ) return false;
  return cache.containsPixel(tokenCenter.x, tokenCenter.y, alphaThreshold);
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
  const cache = tile._textureData?._evPixelCache;
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
  const cache = tile._textureData?._evPixelCache;
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

export function tileOpaqueAverageAt(tile, tokenShape, alphaThreshold, averageTiles) {
  const cache = tile._textureData?._evPixelCache;
  if ( !cache ) return false;
  const pixelThreshold = canvas.elevation.maximumPixelValue * alphaThreshold;
  return cache.percent(tokenShape, pixelThreshold, averageTiles) > 0.5;
}
