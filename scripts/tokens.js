/* globals
CONFIG,
PIXI,
Ray
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { log } from "./util.js";
import { getSceneSetting, SETTINGS } from "./settings.js";
import { TravelElevationCalculator } from "./TravelElevationCalculator.js";

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


const PATCHES_Token = {};
PATCHES_Token.BASIC = {};

// NOTE: Token hooks

// Reset the token elevation when moving the token after a cloned drag operation.
// Token refresh is then used to update the elevation as the token is moved.
function preUpdateTokenHook(tokenD, changes, _options, _userId) {
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
  const te = token._elevatedVision.te = new TravelElevationCalculator(token, travelRay);
  const travel = token._elevatedVision.travel = te.calculateElevationAlongRay(token.document.elevation);
  if ( !travel.adjustElevation ) return;

  if ( tokenD.elevation !== travel.finalElevation ) changes.elevation = travel.finalElevation;
  token._elevatedVision.tokenAdjustElevation = true;
}

/**
 * Hook Token refresh
 * Adjust elevation as the token moves.
 */
function refreshTokenHook(token, flags) {
  if ( !flags.refreshPosition ) return;
  if ( !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return;
  log(`EV refreshToken for ${token.name} at ${token.position.x},${token.position.y}. Token is ${token._original ? "Clone" : "Original"}. Token is ${token._animation ? "" : "not "}animating.`);
  const ev = token._elevatedVision;
  if ( !ev || !ev.tokenAdjustElevation ) return;
  log("EV refreshToken ev data present.");

  if ( token._original ) {
    // This token is a clone in a drag operation.
    // Adjust elevation of the clone by calculating the elevation from origin to line.
    const { startPosition, startElevation, te } = ev;

    // Update the previous travel ray
    te.travelRay = new Ray(startPosition, token.center);
    // Determine the new final elevation.
    const finalElevation = te.calculateFinalElevation(startElevation);
    log(`Token clone: {x: ${te.travelRay.A.x}, y: ${te.travelRay.A.y}, e: ${startElevation} } --> {x: ${te.travelRay.B.x}, y: ${te.travelRay.B.y}, e: ${finalElevation} }`, te);
    token.document.elevation = finalElevation;
    return;
  }

  if ( token._animation ) {
    // Adjust the elevation as the token is moved by locating where we are on the travel ray.
    const tokenCenter = token.center;
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

    const TERRAIN = TravelElevationCalculator.TOKEN_ELEVATION_STATE.TERRAIN;
    change ??= { currState: TERRAIN };
    if ( change.currState === TERRAIN ) {
      const tec = ev.te.TEC;
      tec.location = tokenCenter;
      change.currE = tec.terrainElevation();
    }
    if ( token.document.elevation !== change.currE ) {
      token.document.updateSource({ elevation: change.currE });
      token.renderFlags.set({refreshElevation: true});
    }

    log(`Token Original: {x: ${tokenCenter.x}, y: ${tokenCenter.y}, e: ${change.currE} }`, ev.travel);
  }
}

PATCHES_Token.BASIC.HOOKS = {
  preUpdateToken: preUpdateTokenHook,
  refreshToken: refreshTokenHook
};

// _refreshToken(wrapper, options) {
//   if ( !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return wrapper(options);
//
//   // Old position: this.position
//   // New position: this.document
//
//   // Drag starts with position set to 0, 0 (likely, not yet set).
//   if ( !this.position.x && !this.position.y ) return wrapper(options);
//
//   if ( this.position.x === this.document.x && this.position.y === this.document.y ) return wrapper(options);
//
//   log(`token _refresh at ${this.document.x},${this.document.y} (center ${this.center.x},${this.center.y})
//        with elevation ${this.document.elevation} animate: ${Boolean(this._animation)}`);
//
//
//   const ev = this._elevatedVision;
//   if ( !ev || !ev.tokenAdjustElevation ) {
//     log("Token _refresh: Adjust elevation is false.");
//     return wrapper(options);
//   }
//
//   if ( this._original ) {
//     log("token _refresh is clone.");
//     // This token is a clone in a drag operation.
//     // Adjust elevation of the clone by calculating the elevation from origin to line.
//     const { startPosition, startElevation, te } = ev;
//
//     // Update the previous travel ray
//     te.travelRay = new Ray(startPosition, this.center);
//
//     // Determine the new final elevation.
//     const finalElevation = te.calculateFinalElevation(startElevation);
//     log(`{x: ${te.travelRay.A.x}, y: ${te.travelRay.A.y}, e: ${startElevation} } -->
//          {x: ${te.travelRay.B.x}, y: ${te.travelRay.B.y}, e: ${finalElevation} }`, te);
//     this.document.elevation = finalElevation;
//
//   } else if ( this._animation ) {
//     // Adjust the elevation as the token is moved by locating where we are on the travel ray.
//     log("token _refresh: animation");
//     const tokenCenter = this.center;
//     const { travelRay, elevationChanges } = ev.travel;
//     const currT = travelRay.tConversion(tokenCenter);
//     const ln = elevationChanges.length;
//     let change = elevationChanges[ln - 1];
//     for ( let i = 1; i < ln; i += 1 ) {
//       if ( elevationChanges[i].ix.t0 > currT ) {
//         change = elevationChanges[i-1];
//         break;
//       }
//     }
//
//     const TERRAIN = TravelElevationCalculator.TOKEN_ELEVATION_STATE.TERRAIN;
//     change ??= { currState: TERRAIN };
//     if ( change.currState === TERRAIN ) {
//       const tec = ev.te.TEC;
//       tec.location = tokenCenter;
//       change.currE = tec.terrainElevation();
//     }
//     options.elevation ||= this.document.elevation !== change.currE;
//
//     this.document.elevation = change.currE;
//     log(`{x: ${tokenCenter.x}, y: ${tokenCenter.y}, e: ${change.currE} }`, ev.travel);
//   }
//
//   return wrapper(options);
// }

/**
 * Wrap Token.prototype.clone
 * Determine if the clone should adjust elevation
 */
function cloneToken(wrapper) {
  log(`cloneToken ${this.name} at elevation ${this.document.elevation}`);
  const clone = wrapper();

  clone._elevatedVision ??= {};
  clone._elevatedVision.tokenAdjustElevation = false; // Just a placeholder

  if ( !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return clone;

  const FLY = TravelElevationCalculator.TOKEN_ELEVATION_STATE.FLY;
  const {x, y} = clone.center;
  const travelRay = new Ray({ x, y }, { x, y }); // Copy; don't reference.
  const te = new TravelElevationCalculator(clone, travelRay);
  te.TEC.elevation = this.document.elevation;
  if ( typeof TravelElevationCalculator.autoElevationFly() === "undefined" ) {
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

PATCHES_Token.BASIC.WRAPS = { cloneToken };

/**
 * Calculate the top left corner location for a token given an assumed center point.
 * Used for automatic elevation determination.
 * @param {number} x    Assumed x center coordinate
 * @param {number} y    Assumed y center coordinate
 * @returns {PIXI.Point}
 */
function getTopLeftTokenCorner(x, y) {
  return new PIXI.Point(x - (this.w * 0.5), y - (this.h * 0.5));
}

PATCHES_Token.BASIC.METHODS = { getTopLeft: getTopLeftTokenCorner };


/**
 * Monitor for the prone active effect and update vision for affected tokens.
 * This will cause shadows to change based on the changed token height.
 */
function createOrRemoveActiveEffectHook(effect, _opts, _userId) {
  if ( !effect.statuses.has(CONFIG.GeometryLib.proneStatusId) ) return;

  const tokens = effect.parent?.getActiveTokens();
  if ( !tokens) return;

  tokens.forEach(t => t.vision._updateEVShadowData({changedElevation: true}));
}

export const PATCHES_ActiveEffect = {};
PATCHES_ActiveEffect.BASIC = {};
PATCHES_ActiveEffect.BASIC = {
  createActiveEffect: createOrRemoveActiveEffectHook,
  deleteActiveEffect: createOrRemoveActiveEffectHook
};
