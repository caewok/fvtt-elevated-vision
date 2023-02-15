/* globals
canvas,
Ray,
CONFIG
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { log } from "./util.js";
import { MODULE_ID } from "./const.js";
import { getSetting, getSceneSetting, SETTINGS } from "./settings.js";
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

/**
 * Wrap Token.prototype._refresh
 * Adjust elevation as the token moves.
 */
export function _refreshToken(wrapper, options) {
  if ( !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return wrapper(options);

  // Old position: this.position
  // New position: this.document

  // Drag starts with position set to 0, 0 (likely, not yet set).
  log(`token _refresh at ${this.document.x},${this.document.y} (center ${this.center.x},${this.center.y}) with elevation ${this.document.elevation} animate: ${Boolean(this._animation)}`);
  if ( !this.position.x && !this.position.y ) return wrapper(options);

  const ev = this._elevatedVision;
  if ( !ev || !ev.tokenAdjustElevation ) return wrapper(options);

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
  if ( !isTokenOnGround(this, { tokenCenter }) && !TravelElevation.autoElevationFly() ) return clone;

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
export function isTokenOnTile(token, { tokenCenter, tokenElevation, useAveraging }) {
  tokenElevation ??= token.bottomE;
  const tileElevation = tokenTileElevation(token, { tokenCenter, tokenElevation, useAveraging, checkTopOnly: true });
  return tileElevation !== null && tileElevation.almostEqual(tokenElevation);
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
  let elevation = null;
  if ( considerTiles ) elevation = tokenTileElevation(token, { tokenCenter, tokenElevation, useAveraging });

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
  if ( useAveraging ) return averageElevationForTokenShape(
    token.getTopLeft(tokenCenter.x, tokenCenter.y), token.w, token.h);
  return canvas.elevation.elevationAt(tokenCenter);
}

function averageElevationForTokenShape(tokenTLCorner, w, h) {
  const tokenShape = canvas.elevation._tokenShape(tokenTLCorner, w, h);
  return canvas.elevation.averageElevationWithinShape(tokenShape);
}

/**
 * Determine ground elevation of a token, taking into account tiles.
 * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
 * @param {object} [options]  Options that affect the tile elevation calculation
 * @param {Point} [options.tokenCenter]       Position to use for the token center.
 * @param {boolean} [options.useAveraging]    Token at tileE only if 50% of the token is over the tile.
 * @param {object} [options.selectedTile]     Object (can be empty) in which "tile" property will
 *                                            be set to the tile found, if any. Primarily for debugging.
 * @param {boolean} [options.checkTopOnly]    Should all tiles under the token be checked, or only the top-most tile?
 * @return {number|null} Return the tile elevation or null otherwise.
 */
export function tokenTileElevation(token,
  { tokenCenter, tokenElevation, useAveraging, selectedTile = {}, checkTopOnly = false } = {} ) {
  tokenCenter ??= token.center;
  useAveraging ??= getSetting(SETTINGS.AUTO_AVERAGING);
  tokenElevation ??= token.bottomE;

  // Filter tiles that potentially serve as ground.
  let tiles = [...canvas.tiles.quadtree.getObjects(token.bounds)].filter(tile => {
    if ( !tile.document.overhead ) return false;
    const tileE = tile.elevationE;
    return isFinite(tileE) && (tileE.almostEqual(tokenElevation) || tileE < tokenElevation);
  });
  if ( !tiles.length ) return null;

  // Take the tiles in order, from the top.
  // No averaging:
  // - Elevation is the highest tile that contains the position (alpha-excluded).
  // Averaging:
  // - Tile > 50% of the token shape: tileE.
  // - Tile < 50% of token shape: fall to tile below.
  // - Only non-transparent tile portions count.
  tiles.sort((a, b) => b.elevationZ - a.elevationZ);
  if ( checkTopOnly ) tiles = [tiles[0]];

  const alphaThreshold = CONFIG[MODULE_ID]?.alphaThreshold ?? 0.75;
  if ( useAveraging ) {
    const skip = CONFIG[MODULE_ID]?.averageTiles ?? 1;
    const tokenTL = token.getTopLeft(tokenCenter.x, tokenCenter.y);
    let tokenShape = canvas.elevation._tokenShape(tokenTL, token.w, token.h);
    const evCache = canvas.elevation.elevationPixelCache;

    for ( const tile of tiles ) {
      const cache = tile._textureData?._evPixelCache;
      if ( !cache ) continue;

      // This is tricky, b/c we want terrain to count if it is the same height as the tile.
      // So if a token is 40% on a tile at elevation 30, 40% on terrain elevation 30 and
      // 20% on transparent tile with elevation 0, the token elevation should be 30.
      // In the easy cases, there is 50% coverage for either tile or terrain alone.
      // But the hard case makes us iterate over both tile and terrain at once,
      // b/c otherwise we cannot tell where the overlaps occur. E.g., 30% tile, 20% terrain?
      let sum = 0;
      const tileE = tile.elevationE;
      const pixelE = canvas.elevation.elevationToPixelValue(tileE);
      const countFn = (value, _i, localX, localY) => {
         if ( value > alphaThreshold ) return sum += 1;
         const canvas = cache._toCanvasCoordinates(localX, localY);
         const terrainValue = evCache.pixelAtCanvas(canvas.x, canvas.y);
         if ( terrainValue.almostEqual(pixelE) ) return sum += 1;
         return;
      }
      const denom = cache.applyFunctionToShape(countFn, tokenShape, skip);
      const percentCoverage = sum / denom;
      if ( percentCoverage > 0.5 ) {
        selectedTile.tile = tile;
        return tile.elevationE;
      }
    }

  } else {
    for ( const tile of tiles ) {
      if ( tile.containsPixel(tokenCenter.x, tokenCenter.y, alphaThreshold) ) {
        selectedTile.tile = tile;
        return tile.elevationE;
      }
    }
  }

  // No tile matches the criteria
  return null;
}
