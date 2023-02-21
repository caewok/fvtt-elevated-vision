/* globals
canvas,
Ray,
CONFIG,
Hooks
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { log, almostLessThan, almostGreaterThan } from "./util.js";
import { MODULE_ID } from "./const.js";
import { getSceneSetting, getSetting, SETTINGS, averageTilesSetting } from "./settings.js";
import { TravelElevation } from "./TravelElevation.js";

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
    const { tokenCenter, tokenElevation } = ev;
    const travelRay = new Ray(tokenCenter, this.center);
    const te = new TravelElevation(this, travelRay);
    const travel = te.calculateElevationAlongRay(tokenElevation);

    log(`{x: ${travelRay.A.x}, y: ${travelRay.A.y}, e: ${tokenElevation} } --> {x: ${travelRay.B.x}, y: ${travelRay.B.y}, e: ${travel.finalElevation} }`, travel);
    this.document.elevation = travel.finalElevation;

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
    if ( change.currState === TERRAIN ) change.currE = tokenTerrainElevation(this, { tokenCenter });
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
  log(`cloneToken ${this.name} at elevation ${this.document?.elevation}`);
  const clone = wrapper();

  clone._elevatedVision ??= {};
  clone._elevatedVision.tokenAdjustElevation = false; // Just a placeholder

  if ( !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return clone;

  const tokenCenter = { x: this.center.x, y: this.center.y };
  if ( !TravelElevation.autoElevationFly() ) {
    const { currState } = TravelElevation.currentTokenState(this, { tokenCenter });
    if ( currState === TravelElevation.TOKEN_ELEVATION_STATE.FLY ) return clone;
  }

  const { currState } = TravelElevation.currentTokenState(this, { tokenCenter });
  if ( currState === TravelElevation.TOKEN_ELEVATION_STATE.FLY
    && !TravelElevation.autoElevationFly() ) return clone;

  log(`cloneToken ${this.name} at elevation ${this.document?.elevation}: setting adjust elevation to true`);

  clone._elevatedVision.tokenAdjustElevation = true;
  clone._elevatedVision.tokenCenter = tokenCenter;
  clone._elevatedVision.tokenElevation = this.bottomE;
  return clone;
}

/**
 * Determine whether a token is "on the ground", meaning that the token is in contact
 * with the ground layer according to elevation of the background terrain.
 * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
 * @param {object} [options]  Options that affect the calculation
 * @param {Point} [options.tokenCenter]       Canvas coordinates to use for token center
 * @param {boolean} [options.useAveraging]    Use averaging instead of exact center point of the token.
 *                                            Defaults to SETTINGS.AUTO_AVERAGING.
 * @param {boolean} [options.considerTiles]   First consider tiles under the token?
 * @return {boolean}
 */
export function isTokenOnGround(token, { tokenCenter, tokenElevation, useAveraging, considerTiles } = {}) {
  tokenElevation ??= token.bottomE;
  const currTerrainElevation = tokenGroundElevation(token,
    { tokenCenter, tokenElevation, useAveraging, considerTiles });
  return currTerrainElevation.almostEqual(tokenElevation);
}

export function isTokenOnTerrain(token, { tokenCenter, tokenElevation, useAveraging, considerTiles = true } = {}) {
  if ( considerTiles && isTokenOnTile(token, { tokenCenter, tokenElevation, useAveraging }) ) return false;
  return isTokenOnGround(token, { tokenCenter, useAveraging, considerTiles: false });
}

/**
 * Determine whether a token is on a tile, meaning the token is in contact with the tile.
 * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
 * @param {object} [options]  Options that affect the calculation
 * @param {Point} [options.tokenCenter]       Canvas coordinates to use for token top center.
 * @param {boolean} [options.useAveraging]    Use averaging instead of exact center point of the token.
 *                                            Defaults to SETTINGS.AUTO_AVERAGING.
 * @param {boolean} [options.considerTiles]   First consider tiles under the token?
 * @return {boolean}
 */
export function isTokenOnTile(token, { tokenCenter, tokenElevation, averageTiles }) {
  tokenElevation ??= token.bottomE;

  // Filter tiles in advance so only ones with nearly equal elevation to the token remain.
  const tiles = [...canvas.tiles.quadtree.getObjects(token.bounds)].filter(tile => {
    if ( !tile.document.overhead ) return false;
    const tileE = tile.elevationE;
    return isFinite(tileE) && tileE.almostEqual(tokenElevation);
  });
  if ( !tiles.length ) return false;

  // Determine whether the token is on a tile or only on the transparent portions
  tiles.sort((a, b) => b.elevationZ - a.elevationZ);
  const tile = tileAtTokenElevation(token, { tokenCenter, tokenElevation, averageTiles, tiles });
  return Boolean(tile);
}

/**
 * Determine token elevation for a give canvas location
 * Will be either the tile elevation, if the token is on the tile, or the terrain elevation.
 * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
 * @param {object} [options]  Options that affect the calculation.
 * @param {Point} [options.tokenCenter]       Canvas coordinates to use for token center
 * @param {boolean} [options.useAveraging]    Use averaging instead of exact center point of the token.
 *                                            Defaults to SETTINGS.AUTO_AVERAGING.
 * @param {boolean} [options.considerTiles]   First consider tiles under the token?
 * @returns {number} Elevation in grid units.
 */
export function tokenGroundElevation(token, { tokenCenter, tokenElevation, useAveraging, considerTiles = true } = {}) {
  useAveraging ??= getSetting(SETTINGS.AUTO_AVERAGING);
  let elevation = null;
  if ( considerTiles ) {
    const averageTiles = useAveraging ? averageTilesSetting() : 0;
    const tile = tileAtTokenElevation(token, { tokenCenter, tokenElevation, averageTiles });
    if ( tile ) elevation = tile.elevationE;
  }

  // If the terrain is above the tile, use the terrain elevation. (Math.max(null, 5) returns 5.)
  return Math.max(elevation, tokenTerrainElevation(token, { tokenCenter, useAveraging }));
}

/**
 * Determine token elevation for a give canvas location
 * Will be either the tile elevation, if the token is on the tile, or the terrain elevation.
 * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
 * @param {object} [options]  Options that affect the calculation.
 * @param {Point} [options.tokenCenter]       Canvas coordinates to use for token center.
 * @param {boolean} [options.useAveraging]    se averaging instead of exact center point of the token.
 *                                            Defaults to SETTINGS.AUTO_AVERAGING.
 * @returns {number} Elevation in grid units.
 */
export function tokenTerrainElevation(token, { tokenCenter, useAveraging } = {}) {
  useAveraging ??= getSetting(SETTINGS.AUTO_AVERAGING);
  tokenCenter ??= token.center;
  if ( useAveraging ) {
    const tokenTLCorner = token.getTopLeft(tokenCenter.x, tokenCenter.y);
    const tokenShape = canvas.elevation._tokenShape(tokenTLCorner, token.w, token.h);
    return canvas.elevation.averageElevationWithinShape(tokenShape);
  }
  return canvas.elevation.elevationAt(tokenCenter);
}

/**
 * Determine whether a token is sufficiently near a tile such that the token can be considered on the tile.
 * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
 * @param {object} [options]  Options that affect the tile elevation calculation
 * @param {Point} [options.tokenCenter]       Position to use for the token center.
 * @param {number} [options.tokenElevation]   Elevation of the token
 * @param {PIXI.Rectangle|PIXI.Polygon} [tokenShape]  Shape representing a token boundary
 * @param {number} [options.averageTiles]     0 for no averaging.
 *                                            Otherwise an integer for every N pixels to test in average
 * @param {number} [options.alphaThreshold]   Percent minimum pixel value before considered transparent
 * @param {Tile[]} [options.tiles]            Array of tiles to test
 * @return {Tile|null} Return the tile. Elevation can then be easily determined: tile.elevationE;
 */
export function tileAtTokenElevation(token,
  { tokenCenter, tokenElevation, tokenShape, averageTiles, alphaThreshold, tiles } = {} ) {
  tokenCenter ??= token.center;
  tokenElevation ??= token.bottomE;
  averageTiles ??= averageTilesSetting();
  alphaThreshold = CONFIG[MODULE_ID]?.alphaThreshold ?? 0.75;

  // Filter tiles that potentially serve as ground from canvas tiles.
  if ( typeof tiles === "undefined" ) {
    tiles = [...canvas.tiles.quadtree.getObjects(token.bounds)].filter(tile => {
      if ( !tile.document.overhead ) return false;
      const tileE = tile.elevationE;
      return isFinite(tileE);
    });
    tiles.sort((a, b) => b.elevationZ - a.elevationZ);
  }
  if ( !tiles.length ) return null;

  // Token shape only required when averaging
  tokenShape ??= averageTiles
    ? canvas.elevation._tokenShape(token.getTopLeft(tokenCenter.x, tokenCenter.y), token.w, token.h)
    : undefined;

  // If token is below ground, tiles must be below ground, and vice-versa.
  const terrainE = canvas.elevation.elevationAt(tokenCenter);
  const excludeTileFn = almostGreaterThan(tokenElevation, terrainE)
    ? tileE => tileE < terrainE // Token is above ground; exclude below
    : tileE => almostGreaterThan(tileE, terrainE); // Token is below ground

  for ( const tile of tiles ) {
    if ( excludeTileFn(tile.elevationE) ) continue;
    if ( tileSupports(tile, tokenCenter, tokenElevation, averageTiles, alphaThreshold, tokenShape) ) return tile;
  }

  // No tile matches the criteria
  return null;
}

/**
 * Determine if a tile "supports" a token, meaning the token would not fall through.
 * Token would fall through if tile is transparent unless terrain would fill the gap(s).
 * @param {Tile} tile                                 Tile to test
 * @param {Point} tokenCenter                         Center point
 * @param {number} tokenElevation                     Maximum elevation point to test
 * @param {number} averageTiles                       Positive integer to skip pixels when averaging.
 *                                                    0 if point-based.
 * @param {number} alphaThreshold                     Threshold to determine transparency
 * @param {PIXI.Rectangle|PIXI.Polygon} [tokenShape]  Shape representing a token boundary
 *                                                    Required if not averaging
 * @returns {boolean}
 */
export function tileSupports(tile, tokenCenter, tokenElevation, averageTiles, alphaThreshold, tokenShape) {
  if ( !almostLessThan(tile.elevationE, tokenElevation) ) return false;
  return tileOpaqueAt(tile, tokenCenter, averageTiles, alphaThreshold, tokenShape);
}

/**
 * Determine if a tile is opaque at a given location for a tile.
 * Opaqueness depends on the alphaThreshold and whether measuring the point or the average.
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
export function tileOpaqueAt(tile, tokenCenter, averageTiles, alphaThreshold, tokenShape) {
  const cache = tile._textureData?._evPixelCache;
  if ( !cache ) return false;
  const tileE = tile.elevationE;
  if ( !averageTiles ) return cache.containsPixel(tokenCenter.x, tokenCenter.y, alphaThreshold);

  // This is tricky, b/c we want terrain to count if it is the same height as the tile.
  // So if a token is 40% on a tile at elevation 30, 40% on terrain elevation 30 and
  // 20% on transparent tile with elevation 0, the token elevation should be 30.
  // In the easy cases, there is 50% coverage for either tile or terrain alone.
  // But the hard case makes us iterate over both tile and terrain at once,
  // b/c otherwise we cannot tell where the overlaps occur. E.g., 30% tile, 20% terrain?
  const evCache = canvas.elevation.elevationPixelCache;
  const pixelE = canvas.elevation.elevationToPixelValue(tileE);
  const pixelThreshold = canvas.elevation.maximumPixelValue * alphaThreshold;
  let sum = 0;
  const countFn = (value, _i, localX, localY) => {
    if ( value > pixelThreshold ) return sum += 1;
    const canvas = cache._toCanvasCoordinates(localX, localY);
    const terrainValue = evCache.pixelAtCanvas(canvas.x, canvas.y);
    if ( terrainValue.almostEqual(pixelE) ) return sum += 1;
    return sum;
  };
  const denom = cache.applyFunctionToShape(countFn, tokenShape, averageTiles);
  const percentCoverage = sum / denom;
  return percentCoverage > 0.5;
}

