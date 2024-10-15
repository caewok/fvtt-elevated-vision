/* globals

*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "./const.js";


/* Testing
source = _token.vision
ev = source.elevatedvision

canvas.stage.addChild(ev.shadowMesh)
canvas.stage.removeChild(ev.shadowMesh)

canvas.stage.addChild(ev.terrainShadowMesh)
canvas.stage.removeChild(ev.terrainShadowMesh)


// Test wall geometry
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
buffers = ev.wallGeometry.buffers;

// Wall corners repeated 3x
// Each has 4 values:
// A.x, A.y, top, blocksA
// B.x, B.y, bottom, blocksB

segments = [];
buff1 = buffers[1].data;
buff2 = buffers[2].data;

for ( let i = 0; i < buff1.length; i += 12 ) {
  const segment = {
    A: new Point3d(buff1[i], buff1[i + 1], buff1[i + 2]),
    B: new Point3d(buff2[i], buff2[i + 1], buff2[i + 2])
  };
  segment.A.blocks = buff1[i + 3];
  segment.B.blocks = buff2[i + 3];
  segments.push(segment)

  Draw.segment(segment, { color: Draw.COLORS.blue, width: 5 })
  Draw.point(segment.A, { radius: 7, color: ~segment.A.blocks ? Draw.COLORS.red : Draw.COLORS.green })
  Draw.point(segment.B, { radius: 7, color: ~segment.B.blocks ? Draw.COLORS.red : Draw.COLORS.green })
}


*/

// Methods related to VisionSource

export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.VISION = {};
PATCHES.VISIBILITY = {};

// ----- NOTE: Methods -----

/**
 * New method: VisionSource.prototype.targetInShadow
 * Do not use the shadow texture cache b/c it takes too long to construct and vision moves a lot.
 */
function targetInShadow(target, testPoint) {
  const RegionMovementWaypoint3d = CONFIG.GeometryLib.threeD.RegionMovementWaypoint3d;
  testPoint ??= target instanceof Token
    ? RegionMovementWaypoint3d.fromLocationWithElevation(target.center, target.elevationE)
    : target;
  if ( !Object.hasOwn(testPoint, "z") ) {
    testPoint = RegionMovementWaypoint3d.fromLocationWithElevation(testPoint, canvas.scene[MODULE_ID].elevationAt(testPoint));
  }
  return this[MODULE_ID].elevatedPointInShadow(testPoint);
}

PATCHES.VISIBILITY.METHODS = { targetInShadow };

// ----- NOTE: Wraps -----

/**
 * Wrap VisionSource.prototype._createRestrictedPolygon
 * Create/update the graphics used for the FOV.
 */
function _createRestrictedPolygon(wrapped) {
  this[MODULE_ID].updateFOV();
  return wrapped();
}

PATCHES.VISION.WRAPS = { _createRestrictedPolygon };
