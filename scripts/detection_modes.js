/* globals
canvas,
foundry,
GlobalLightSource,
TokenDocument
*/
"use strict";

import { DirectionalLightSource } from "./DirectionalLightSource.js";

export const PATCHES_DetectionMode = {};
export const PATCHES_DetectionModeBasicSight = {};
export const PATCHES_DetectionModeTremor = {};

PATCHES_DetectionMode.VISIBILITY = {};
PATCHES_DetectionModeBasicSight.VISIBILITY = {};
PATCHES_DetectionModeTremor.BASIC = {};

/**
 * Override DetectionMode.prototype._testLOS
 * Test using shadow texture or ray-wall collisions
 */
function _testLOS(visionSource, mode, target, test) {
  // LOS has no radius limitation.
  if ( !this._testAngle(visionSource, mode, target, test) ) return false;

  let hasLOS = test.los.get(visionSource);
  if ( hasLOS === undefined ) {
    hasLOS = visionSource.targetInShadow(target, test.point) < 0.5;
    test.los.set(visionSource, hasLOS);
  }
  return hasLOS;
}

PATCHES_DetectionMode.VISIBILITY.OVERRIDES = { _testLOS };

/**
 * Override DetectionModeBasicSight.prototype._testPoint
 * Test using shadow texture or ray-wall collisions
 */
function _testPoint(visionSource, mode, target, test) {
  if ( !this._testLOS(visionSource, mode, target, test) ) return false;
  if ( this._testRange(visionSource, mode, target, test) ) return true;

  for ( const lightSource of canvas.effects.lightSources.values() ) {
    if ( !lightSource.active ) continue;
    if ( lightSource instanceof foundry.canvas.sources.GlobalLightSource ) return true;
    if ( !testWithinRadius(lightSource, test) ) continue;
    if ( !testSourceAngle(lightSource, test) ) continue;
    if ( lightSource.targetInShadow(target, test.point) < 0.5 ) return true;
  }
  return false;
}

PATCHES_DetectionModeBasicSight.VISIBILITY.OVERRIDES = { _testPoint };

/* Testing
api = game.modules.get("elevatedvision").api
DirectionalLightSource = api.DirectionalLightSource
Draw = CONFIG.GeometryLib.Draw
*/


// see DetectionMode.prototype._testRange.
function testWithinRadius(source, test) {
  if ( source instanceof DirectionalLightSource
    || source instanceof foundry.canvas.sources.GlobalLightSource ) return true;
  const radius = source.radius || source.data.externalRadius;
  const dx = test.point.x - source.x;
  const dy = test.point.y - source.y;
  return ((dx * dx) + (dy * dy)) <= (radius * radius);
}

function testSourceAngle(source, test) {
  const { angle, rotation, externalRadius } = source.data;
  if ( angle >= 360 ) return true;
  const point = test.point;
  const dx = point.x - source.x;
  const dy = point.y - source.y;
  if ( (dx * dx) + (dy * dy) <= (externalRadius * externalRadius) ) return true;
  const aMin = rotation + 90 - (angle / 2);
  const a = Math.toDegrees(Math.atan2(dy, dx));
  return (((a - aMin) % 360) + 360) % 360 <= angle;
}
