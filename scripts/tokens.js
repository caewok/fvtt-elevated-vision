/* globals
Token,
Ray,
CONFIG,
ClockwiseSweepPolygon
*/
"use strict";

import { log } from "./util.js";
import { Point3d } from "./Point3d.js";

/*
Adjustments for token visibility.

token cube = visibility test points for a token at bottom and top of token size
 - so if elevation is 10 and token height is 5, test points at 10 and 15

1. Testing visibility of a token
If not visible due to los/fov:
- visible if direct line of sight to token cube
- token may need to be within illuminated area or fov

*/

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
    const { hasLOS, hasFOV } = t;

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
  const res2d = wrapper(visionSource, mode, target, test)
  if ( !res2d || !test.hasOwnProperty("z") ) return res2d;

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
export function _testLOSDetectionMode(wrapper, visionSource, test) {
  const res2d = wrapper(visionSource, test);

  if ( !res2d || !test.hasOwnProperty("z") ) return res2d;
  if ( !this.walls ) return true;

  return testVisionSourceLOS(visionSource, test)
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

  const ray = new Ray(new Point3d(source.x, source.y, source.elevationZ), p);
  return !ClockwiseSweepPolygon.testCollision3d(ray, { type: "sight", mode: "any" });
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
