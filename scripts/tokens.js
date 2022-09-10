/* globals
Token,
CONFIG,
ClockwiseSweepPolygon,
canvas
*/
"use strict";

import { Point3d } from "./Point3d.js";
import { points2dAlmostEqual, log } from "./util.js";
import { getSetting, SETTINGS } from "./settings.js";

/*
Adjustments for token visibility.

token cube = visibility test points for a token at bottom and top of token size
 - so if elevation is 10 and token height is 5, test points at 10 and 15

1. Testing visibility of a token
If not visible due to los/fov:
- visible if direct line of sight to token cube
- token may need to be within illuminated area or fov

*/

export function cloneToken(wrapper) {
  log(`cloneToken ${this.name} at elevation ${this.document.elevation}`);
  const clone = wrapper();

  this._EV_elevationOrigin = this.document.elevation;
  clone.document.elevation = this.document.elevation;
  return clone;
}

// Rule:
// If token elevation currently equals the terrain elevation, then assume
// moving the token should update the elevation.
// E.g. Token is flying at 30' above terrain elevation of 0'
// Token moves to 25' terrain. No auto update to elevation.
// Token moves to 35' terrain. No auto update to elevation.
// Token moves to 30' terrain. Token & terrain elevation now match.
// Token moves to 35' terrain. Auto update, b/c previously at 30' (Token "landed.")

export function _refreshToken(wrapper, options) {
  if ( !getSetting(SETTINGS.AUTO_ELEVATION) ) return wrapper(options);

  // Old position: this.position
  // New position: this.document

  // Drag starts with position set to 0, 0 (likely, not yet set).
  log(`token _refresh at ${this.document.x},${this.document.y} with elevation ${this.document.elevation}`);
  if ( !this.position.x && !this.position.y ) return wrapper(options);

  const newElevation = autoElevationChangeForToken(this, this.position, this.document);
  if ( newElevation === null ) return wrapper(options);

  log(`token _refresh at ${this.document.x},${this.document.y} from ${this.position.x},${this.position.y}`, options, this);
  log(`token _refresh newElevation ${newElevation}`);

  this.document.elevation = newElevation;
  return wrapper(options);
}


/**
 * Determine if a token elevation should change provided a new destination point.
 * @param {Token} token         Token
 * @param {Point} newPosition   {x,y} coordinates of position token is moving to
 * @param {object} [options]    Options that affect the token shape
 * @returns {number|null} Elevation, in grid coordinates. Null if no change.
 */
export function autoElevationChangeForToken(token, oldPosition, newPosition) {
  if ( points2dAlmostEqual(oldPosition, newPosition) ) return null;

  const useAveraging = getSetting(SETTINGS.AUTO_AVERAGING);
  const oldCenter = token.getCenter(oldPosition.x, oldPosition.y);

  const currTerrainElevation = useAveraging
    ? averageElevationForToken(oldPosition.x, oldPosition.y, token.w, token.h)
    : canvas.elevation.elevationAt(oldCenter.x, oldCenter.y);

  // Token must be "on the ground" to start.
  log(`token elevation ${token.document.elevation} at ${oldCenter.x},${oldCenter.y}; current terrain elevation ${currTerrainElevation} (averaging ${useAveraging})`);
  if ( currTerrainElevation !== token.document.elevation ) return null;

  const newCenter = token.getCenter(newPosition.x, newPosition.y);
  const newTerrainElevation = useAveraging
    ? averageElevationForToken(newPosition.x, newPosition.y, token.w, token.h)
    : canvas.elevation.elevationAt(newCenter.x, newCenter.y);

  log(`new terrain elevation ${newTerrainElevation} at ${newCenter.x},${newCenter.y}`);
  return (currTerrainElevation === newTerrainElevation) ? null : newTerrainElevation;
}

function averageElevationForToken(x, y, w, h) {
  const tokenShape = canvas.elevation._tokenShape(x, y, w, h);
  return canvas.elevation.averageElevationWithinShape(tokenShape);
}

/**
 * Helper function to construct a test object for testVisiblity
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {object}  Object with { point, los }
 *  See CanvasVisibility.prototype.testVisibility
 */
function buildTestObject(x, y, z = 0) {
  return { point: new Point3d(x, y, z), los: new Map() };
}

/**
 * Add 3d points for testing visibility
 * Try a single 3d center point for middle, top, bottom.
 * Then add middle, top, bottom for all other points around the boundary.
 * @param {object[]} tests    Object array with { point, hasLOS, hasFOV }
 * @param {object} object     An optional reference to the object whose visibility is being tested
 * @returns {object[]} Modified tests array
 */
function create3dTestPoints(tests, object) {
  // We need a point that provides both LOS and FOV membership, and
  // also, if in shadow, has line of sight to a vision source without intersecting a wall.
  // Top and bottom of the token cube---the points to test along the token.
  // Test the middle for better consistency with how offsets above also test center
  const obj_top = object.topZ;
  const obj_bottom = object.bottomZ;
  const obj_center = (obj_top + obj_bottom) / 2;
  const skip_top = obj_top === obj_bottom;

  // Try a single 3d center point for middle, top, bottom.
  // Then add middle, top, bottom for all other points around the boundary.
  const t0 = tests.shift();
  const tests3d = [];
  tests3d.push(buildTestObject(t0.point.x, t0.point.y, obj_center));

  tests.forEach(t => {
    const { x, y } = t.point;

    tests3d.push(buildTestObject(x, y, obj_center));
    if ( skip_top ) return;

    tests3d.push(
      buildTestObject(x, y, obj_top),
      buildTestObject(x, y, obj_bottom));
  });

  return tests3d;
}

/**
 * Wrap LightSource.prototype.testVisibility
 */
export function testVisibilityLightSource(wrapper, {tests, object} = {}) {
  if ( !object || !(object instanceof Token) ) return wrapper({tests, object});

  tests = create3dTestPoints(tests, object);
  const doc = object.document;
  if ( (doc instanceof Token) && doc.hasStatusEffect(CONFIG.specialStatusEffects.INVISIBLE) ) return false;
  return tests.some(test => {
    const contains = testVisionSourceLOS(this, test.point);
    if ( contains ) {
      if ( this.data.vision ) test.hasLOS = true;
      test.hasFOV = true;
      return test.hasLOS;
    }
    return false;
  });
}

/**
 * Wrap DetectionMode.prototype.testVisibility
 * Add additional 3d test points for token objects
 */
export function testVisibilityDetectionMode(wrapper, visionSource, mode, {object, tests} = {}) {
  if ( object && object instanceof Token) tests = create3dTestPoints(tests, object);
  return wrapper(visionSource, mode, {object, tests});
}

/**
 * Wrap DetectionMode.prototype._testRange
 * Use a 3-D range test if the test point is 3d.
 */
export function _testRangeDetectionMode(wrapper, visionSource, mode, target, test) {
  const res2d = wrapper(visionSource, mode, target, test);
  if ( !res2d || !Object.prototype.hasOwnProperty.call(test.point, "z") ) return res2d;

  const radius = visionSource.object.getLightRadius(mode.range);
  const dx = test.point.x - visionSource.x;
  const dy = test.point.y - visionSource.y;
  const dz = test.point.z - visionSource.topZ;
  return ((dx * dx) + (dy * dy) + (dz * dz)) <= (radius * radius);
}

/**
 * Wrap DetectionMode.prototype._testLOS
 * Tokens only.
 */
export function _testLOSDetectionMode(wrapper, visionSource, mode, target, test) {
  const res2d = wrapper(visionSource, mode, target, test);

  if ( !res2d || !Object.prototype.hasOwnProperty.call(test.point, "z") ) return res2d;
  if ( !this.walls ) return true;

  const hasLOS = testVisionSourceLOS(visionSource, test.point);
  test.los.set(visionSource, hasLOS);

  return hasLOS;
}

/**
 * Wrap VisionMode.prototype.testNaturalVisibility
 */
// export function testNaturalVisibilityVisionMode(wrapper, {tests, object} = {}) {
//   if ( !object || !(object instanceof Token) ) return wrapper({tests, object});
//
//   tests = create3dTestPoints(tests, object);
//
//   return tests.some(test => {
//     if ( !test.hasFOV && testVisionSourceLOS(this, test.point) ) {
//       test.hasFOV = test.hasLOS = true;
//       return true;
//     }
//     if ( !test.hasLOS && testVisionSourceLOS(this, test.point)) test.hasLOS = true;
//     return (test.hasFOV && test.hasLOS);
//   });
// }

function testVisionSourceLOS(source, p) {
  if ( !source.los.contains(p.x, p.y) ) return false;
  if ( !source.los.shadows?.length ) return true;

  const point_in_shadow = source.los.shadows.some(s => s.contains(p.x, p.y));
  if ( !point_in_shadow ) return true;

  return !ClockwiseSweepPolygon.testCollision3d(new Point3d(source.x, source.y, source.elevationZ), p, { type: "sight", mode: "any" });
}


// No longer used in v10
/**
 * Wrap VisionSource.prototype.drawSight
 */
// export function drawSightVisionSource(wrapped) {
//   log("drawSightVisionSource");
//
//   const c = wrapped();
//
//   const shadows = this.los.shadows;
//   if ( !shadows || !shadows.length ) {
//     log("drawSightVisionSource|no shadows");
//     return c;
//   }
//
//   for ( const shadow of shadows ) {
//     const g = c.addChild(new PIXI.LegacyGraphics());
//     g.beginFill(0x000000, 1.0).drawShape(shadow).endFill();
//   }
//
//   return c;
// }
