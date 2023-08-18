/* globals
CONFIG,
DefaultTokenConfig,
flattenObject,
game,
PIXI,
Ray
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { log } from "./util.js";
import { MODULE_ID, FLAGS } from "./const.js";
import { getSceneSetting, SETTINGS } from "./settings.js";
import { TravelElevationCalculator } from "./TravelElevationCalculator.js";
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
  console.debug("drawTokenHook", arguments);
  const ev = token[MODULE_ID] ??= {};
  ev.TEC = new TokenElevationCalculator(token);

  // It is possible for existing tokens to not have the flag at all.
  const { ALGORITHM, TYPES } = FLAGS.ELEVATION_MEASUREMENT;
  if ( !token.document.getFlag(MODULE_ID, ALGORITHM) ) {
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

  console.debug(`updateTokenHook hook ${changed.x}, ${changed.y}, ${changed.elevation} at ${tokenD.object.center.x},${tokenD.object.center.y} and elevation ${tokenD.elevation}`);


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
function preUpdateTokenHook(tokenD, changes, _options, _userId) {
  if ( !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return;

  const changeKeys = new Set(Object.keys(flattenObject(changes)));
  if ( !(changeKeys.has("x") || changeKeys.has("y")) ) return;
  if ( changeKeys.has("elevation") ) return; // Do not override existing elevation changes.

  const token = tokenD.object;
  console.debug(`preUpdateToken hook ${changes.x}, ${changes.y}, ${changes.elevation} at elevation ${token.document?.elevation} with elevationD ${tokenD.elevation}`, changes);
  console.debug(`preUpdateToken hook moving ${tokenD.x},${tokenD.y} --> ${changes.x ? changes.x : tokenD.x},${changes.y ? changes.y : tokenD.y}`);

  const destination = token.getCenter(changes.x ?? token.x, changes.y ?? token.y);
  const ter = new TravelElevationRay(token, { destination });
  changes.elevation = ter.endingElevation;
  token[MODULE_ID].ter = ter; // TODO: can we use this in the animation?

  console.debug(`preUpdate path: ${ter.origin.x},${ter.origin.y},${ter.originElevation} --> ${ter.destination.x},${ter.destination.y},${ter.endingElevation}`)

}

/**
 * Hook Token refresh
 * Adjust elevation as the token moves.
 */
function refreshTokenHook(token, flags) {
  if ( !flags.refreshPosition ) return;
  if ( !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return;

  if ( token._original ) {
    // This token is a clone in a drag operation.
    // Adjust elevation of the clone by calculating the elevation from origin to line.
    const center = token._original.center;
    const origin = new Point3d(center.x, center.y, token._original.bottomZ);
    const destination = token.center;
    const ter = new TravelElevationRay(token, { origin, destination });
    token.document.elevation = ter.endingElevation;

    if ( ter.endingElevation !== token._original.bottomE ) {
      console.debug(`Token clone: {x: ${origin.x}, y: ${origin.y}, e: ${token._original.bottomE} } --> {x: ${destination.x}, y: ${destination.y}, e: ${token.document.elevation} }`);
    }

    return;
  } else if ( token._animation ) {
    console.debug(`EV refreshToken for ${token.name} at ${token.position.x},${token.position.y}; e: ${token.document.elevation}. Token is ${token._original ? "Clone" : "Original"}. Token is ${token._animation ? "" : "not "}animating.`);

    const ter = token[MODULE_ID].ter;
    if ( !ter ) return;

    const center = token.getCenter(token.position.x, token.position.y);
    const elevation = ter.elevationAtClosestPoint(center);

    if ( isNaN(elevation) ) {
      console.debug("elevation is NaN")
    }

    if ( typeof elevation === "undefined" ) {
      console.debug("elevation is undefined")
    }


    console.debug(`refresh path: elevation ${elevation}. ${ter.origin.x},${ter.origin.y},${ter.originElevation} --> ${ter.destination.x},${ter.destination.y},${ter.endingElevation}`)
    if ( token.document.elevation !== elevation ) {
      token.document.updateSource({ elevation });
      token.renderFlags.set({refreshElevation: true});
    }
  }

//   if ( token._animation ) {
//     // Adjust the elevation as the token is moved by locating where we are on the travel ray.
//     const tokenCenter = token.center;
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
//     if ( token.document.elevation !== change.currE ) {
//       token.document.updateSource({ elevation: change.currE });
//       token.renderFlags.set({refreshElevation: true});
//     }
//     console.debug(`Token Original: {x: ${tokenCenter.x}, y: ${tokenCenter.y}, e: ${change.currE} }`, ev.travel);
//   }
}

PATCHES_Token.BASIC.HOOKS = {
  preUpdateToken: preUpdateTokenHook,
  refreshToken: refreshTokenHook,
  drawToken: drawTokenHook,
  updateToken: updateTokenHook
};


// ----- NOTE: Wraps ----- //

// See WalledTemplates for similar animation approach.

/**
 * Wrap Token.prototype.animate
 * Modify the token elevation in real-time during the animation.
 */
async function animate(wrapped, updateData, opts) {
  if ( !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return;

  const updateKeys = new Set(Object.keys(updateData));
  if ( !(updateKeys.has("x") || updateKeys.has("y")) ) return wrapped(updateData, opts);

  console.debug(`Starting animation. Token at ${this.center.x},${this.center.y} with elevation ${this.document.elevation}`)

//   let travelRay = this[MODULE_ID]?.ter;
//   const destination = PIXI.Point.fromObject(this.center);
//   if ( !travelRay || !travelRay.destination.equals(this.center) ) {
//     // Elevation may be a problem if it was changed elsewhere...
//     if ( updateKeys.has("elevation") ) return wrapped(updateData, opts);
//     const origin = this.getCenter(this.x, this.y)
//     travelRay = new TravelElevationRay(this, { origin, destination });
//     travelRay._walkPath(); // Run before animation starts b/c it is resource-intensive.
//   } else delete this[MODULE_ID].ter;
//
//   console.debug(`Animation path: ${travelRay.origin.x},${travelRay.origin.y},${travelRay.originElevation} --> ${travelRay.destination.x},${travelRay.destination.y},${travelRay.endingElevation}`)
//
//   // TODO: Test that destination elevation matches updateData elevation? Return if not matched?
//   if ( opts.ontick ) {
//     const ontickOriginal = opts.ontick;
//     opts.ontick = (dt, anim, documentData, config) => {
//       adjustTokenElevation(travelRay, anim, documentData, config)
//       ontickOriginal(dt, anim, documentData, config);
//     };
//   } else {
//     opts.ontick = (dt, anim, documentData, config) => {
//       adjustTokenElevation(travelRay, anim, documentData, config);
//     };
//   }

  await wrapped(updateData, opts);
  console.debug(`Finished animation. Token at ${this.center.x},${this.center.y} with elevation ${this.document.elevation}`)
}


function adjustTokenElevation(travelRay, anim, documentData, config) {
  const pt = {
    x: documentData.x ?? travelRay.origin.x,
    y: documentData.y ?? travelRay.origin.y
  };

  const elevation = travelRay.elevationAtClosestPoint(pt);

  // Rest is basically from Token.prototype.#animateFrame.
  // #animateFrame is called immediately before this, unfortunately.
  // Update the document
  const token = anim.context;
  const tokenD = token.document;
  if ( tokenD.elevation === elevation ) return;
  // foundry.utils.mergeObject(tokenD, { elevation }, {insertKeys: false});

  tokenD.updateSource({ elevation }, { defer: true });
  token.renderFlags.set({ refreshElevation: true });

//   // Animate perception changes if necessary
//   if ( !config.animatePerception && !config.sound ) return;
//
//   console.debug(`Animation: adjusting token elevation to ${elevation}. animatePerception: ${config.animatePerception}`);
//
//
//   const refreshOptions = { refreshSounds: config.sound }
//   if ( config.animatePerception ) {
//     token.updateSource({defer: true});
//     refreshOptions.refreshLighting = refreshOptions.refreshVision = refreshOptions.refreshTiles = true;
//   }
//   canvas.perception.update(refreshOptions);
}



/**
 * Wrap Token.prototype.clone
 * Determine if the clone should adjust elevation
 */
function clone(wrapper) {
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

PATCHES_Token.BASIC.WRAPS = { clone, animate };

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
  if ( !effect.statuses.has(CONFIG.GeometryLib.proneStatusId) ) return;

  const tokens = effect.parent?.getActiveTokens();
  if ( !tokens) return;

  tokens.forEach(t => t.vision._updateEVShadowData({changedElevation: true}));
}

PATCHES_ActiveEffect.BASIC.HOOKS = {
  createActiveEffect: createOrRemoveActiveEffectHook,
  deleteActiveEffect: createOrRemoveActiveEffectHook
};
