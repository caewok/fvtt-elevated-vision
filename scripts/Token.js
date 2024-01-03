/* globals
CONFIG,
DefaultTokenConfig,
flattenObject,
game,
PIXI
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, FLAGS } from "./const.js";
import { getSceneSetting, Settings } from "./settings.js";
import { TokenElevationCalculator } from "./TokenElevationCalculator.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { TravelElevationRay } from "./TravelElevationRay.js";

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

export const PATCHES_Token = {};
export const PATCHES_ActiveEffect = {};
PATCHES_Token.BASIC = {};
PATCHES_ActiveEffect.BASIC = {};


// NOTE: Token hooks

/**
 * Hook drawToken to add an elevation calculator.
 */
function drawTokenHook(token) {
  // Debug: log("drawTokenHook", arguments);
  const ev = token[MODULE_ID] ??= {};
  ev.TEC = new TokenElevationCalculator(token);

  // It is possible for existing tokens to not have the flag at all.
  // token.document.isOwner check to fix issue #84
  const { ALGORITHM, TYPES } = FLAGS.ELEVATION_MEASUREMENT;
  if ( !token.document.getFlag(MODULE_ID, ALGORITHM) && token.document.isOwner ) {
    const defaults = game.settings.get("core", DefaultTokenConfig.SETTING);
    const type = defaults.flags?.[MODULE_ID]?.[ALGORITHM] ?? TYPES.POINTS_CLOSE;
    token.document.setFlag(MODULE_ID, ALGORITHM, type);
  }
}

/**
 * Hook updateToken to wipe the token calculator if the token shape is modified.
 */
function updateTokenHook(tokenD, changed, _options, _userId) {
  const changeKeys = new Set(Object.keys(flattenObject(changed)));

  // Debug
  // console.debug(`updateTokenHook hook ${changed.x}, ${changed.y}, ${changed.elevation}
  //   at ${tokenD.object.center.x},${tokenD.object.center.y} and elevation ${tokenD.elevation}`);

  // Width and Height affect token shape; the elevation measurement flag affects the offset grid.
  const elevationMeasurementFlag = `flags.${MODULE_ID}.${FLAGS.ELEVATION_MEASUREMENT.ALGORITHM}`;
  if ( !(changeKeys.has("width")
      || changeKeys.has("height")
      || changeKeys.has(elevationMeasurementFlag)) ) return;

  // Prototype tokens, maybe others, will not have a tec.
  const tec = tokenD.object?.[MODULE_ID]?.TEC;
  if ( !tec ) return;

  // Token shape or algorithm has changed; update the tec accordingly.
  if ( changeKeys.has(elevationMeasurementFlag) ) tec.refreshTokenElevationMeasurementAlgorithm();
  else tec.refreshTokenShape();
}

// If the token moves, calculate its new elevation.
function preUpdateTokenHook(tokenD, changes, options, _userId) {
  // options.ridingMovement: issue #83—compatibility with Rideables.
  if ( !getSceneSetting(Settings.KEYS.AUTO_ELEVATION) || options.RidingMovement ) return;

  // Debug
  // console.debug(`preUpdateToken hook ${changes.x}, ${changes.y}, ${changes.elevation}
  // at elevation ${tokenD.elevation} with elevationD ${tokenD.elevation}`, changes);

  const token = tokenD.object;
  const origTER = token[MODULE_ID].ter;
  const destination = token.getCenter(changes.x ?? token.x, changes.y ?? token.y);

  const changeKeys = new Set(Object.keys(flattenObject(changes)));
  if ( changeKeys.has("elevation") && origTER ) {
    // Something, like Levels Stairs, has changed the token elevation during an animation.
    // Redo the travel elevation ray from this point.
    const ter = new TravelElevationRay(token, { destination });
    origTER.origin = destination;
    origTER.originElevation = changes.elevation;
    changes.elevation = ter.endingElevation;
    return;
  }

  if ( !(changeKeys.has("x") || changeKeys.has("y")) ) return;
  if ( changeKeys.has("elevation") ) return; // Do not override existing elevation changes.

  // Debug: log(`preUpdateToken hook moving ${tokenD.x},${tokenD.y} -->
  // ${changes.x ? changes.x : tokenD.x},${changes.y ? changes.y : tokenD.y}`);

  const ter = new TravelElevationRay(token, { destination });

  // Debug
  // console.debug(`preUpdating token.document.elevation to ${ter.endingElevation}`);
  changes.elevation = ter.endingElevation;
  token[MODULE_ID].ter = ter; // TODO: can we use this in the animation?

  // Debug: log(`preUpdate path: ${ter.origin.x},${ter.origin.y},${ter.originElevation}
  // --> ${ter.destination.x},${ter.destination.y},${ter.endingElevation}`)

}

/**
 * Hook Token refresh
 * Adjust elevation as the token moves.
 */
function refreshTokenHook(token, flags) {
  if ( !flags.refreshPosition ) return;
  if ( !getSceneSetting(Settings.KEYS.AUTO_ELEVATION) ) return;

  // Debug
//   console.debug(`EV refreshToken for ${token.name} at ${token.position.x},${token.position.y};
//   e: ${token.document.elevation}. Token is ${token._original ? "Clone" : "Original"}.
//   Token is ${token._animation ? "" : "not "}animating.`);

  if ( token._original ) {
    // This token is a clone in a drag operation.
    // Adjust elevation of the clone by calculating the elevation from origin to line.
    const center = token._original.center;
    const origin = new Point3d(center.x, center.y, token._original.bottomZ);
    const destination = token.center;
    const ter = new TravelElevationRay(token, { origin, destination });

    // Debug
    // console.debug(`clone refresh path: ${ter.origin.x},${ter.origin.y},${ter.originElevation}
    //    --> ${ter.destination.x},${ter.destination.y},${ter.endingElevation}`);

    token.document.elevation = ter.endingElevation;

    // Debug
    // console.debug(`Clone Updating token.document.elevation to ${ter.endingElevation}`);

  } else if ( token._animation ) {
    const ter = token[MODULE_ID].ter;
    if ( !ter ) return;

    const center = token.getCenter(token.position.x, token.position.y);
    const elevation = ter.elevationAtClosestPoint(center);

    // Debug
    // console.debug(`animation refresh path: elevation ${elevation}. ${ter.origin.x},${ter.origin.y},${ter.originElevation}
    // --> ${ter.destination.x},${ter.destination.y},${ter.endingElevation}`);
    if ( token.document.elevation !== elevation ) {
      // Debug
      // console.debug(`Animation Updating token.document.elevation to ${elevation}`);
      token.document.updateSource({ elevation });
      token.renderFlags.set({refreshElevation: true});
    }
  }
}

PATCHES_Token.BASIC.HOOKS = {
  preUpdateToken: preUpdateTokenHook,
  refreshToken: refreshTokenHook,
  drawToken: drawTokenHook,
  updateToken: updateTokenHook
};


// ----- NOTE: Wraps ----- //

/**
 * Calculate the top left corner location for a token given an assumed center point.
 * Used for automatic elevation determination.
 * @param {number} x    Assumed x center coordinate
 * @param {number} y    Assumed y center coordinate
 * @returns {PIXI.Point}
 */
function getTopLeft(x, y) {
  return new PIXI.Point(x - (this.w * 0.5), y - (this.h * 0.5));
}

PATCHES_Token.BASIC.METHODS = { getTopLeft };

/**
 * Monitor for the prone active effect and update vision for affected tokens.
 * This will cause shadows to change based on the changed token height.
 */
function createOrRemoveActiveEffectHook(effect, _opts, _userId) {
  if ( getSceneSetting(Settings.KEYS.SHADING.ALGORITHM) === Settings.KEYS.SHADING.TYPES.NONE ) return;
  if ( !effect.statuses.has(CONFIG.GeometryLib.proneStatusId) ) return;

  const tokens = effect.parent?.getActiveTokens();
  if ( !tokens) return;

  tokens.forEach(t => t.vision._updateEVShadowData({changedElevation: true}));
}

PATCHES_ActiveEffect.BASIC.HOOKS = {
  createActiveEffect: createOrRemoveActiveEffectHook,
  deleteActiveEffect: createOrRemoveActiveEffectHook
};
