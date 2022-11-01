/* globals
Token,
CONFIG,
ClockwiseSweepPolygon,
canvas
*/
"use strict";

import { Point3d } from "./Point3d.js";
import { log } from "./util.js";
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
  log(`token _refresh at ${this.document.x},${this.document.y} with elevation ${this.document.elevation} animate: ${Boolean(this._animation)}`);
  if ( !this.position.x && !this.position.y ) return wrapper(options);

  if ( !this._elevatedVision || !this._elevatedVision.tokenAdjustElevation ) return wrapper(options);

  if ( this._original ) {
    log("token _refresh is clone");
    // This token is a clone in a drag operation.
    // Adjust elevation of the clone

  } else {
    const hasAnimated = this._elevatedVision.tokenHasAnimated;
    if ( !this._animation && hasAnimated ) {
      // Reset flag on token to prevent further elevation adjustments
      this._elevatedVision.tokenAdjustElevation = false;
      return wrapper(options);
    } else if ( !hasAnimated ) this._elevatedVision.tokenHasAnimated = true;
  }

  // Adjust the elevation
  this.document.elevation = tokenElevationAt(this, this.document);

  log(`token _refresh at ${this.document.x},${this.document.y} from ${this.position.x},${this.position.y} to elevation ${this.document.elevation}`, options, this);

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

  if ( !getSetting(SETTINGS.AUTO_ELEVATION) ) return clone;

  const tokenOrigin = { x: this.x, y: this.y };
  if ( !tokenOnGround(this, tokenOrigin) ) return clone;

  clone._elevatedVision.tokenAdjustElevation = true;
  return clone;
}

/**
 * Determine whether a token is "on the ground", meaning that the token is in contact
 * with the ground layer according to elevation of the background terrain.
 * @param {Token} token
 * @param {Point} position    Position to use for the token position.
 *   Should be a grid position (a token x,y).
 * @return {boolean}
 */
export function tokenOnGround(token, position) {
  const currTerrainElevation = tokenElevationAt(token, position);
  return currTerrainElevation.almostEqual(token.document?.elevation);
}

/**
 * Determine whether a token is "on a tile", meaning the token is at the elevation of the
 * bottom of a tile.
 * @param {Token} token
 * @param {Point} position    Position to use for the token position.
 *   Should be a grid position (a token x,y). Defaults to current token position.
 * @return {number|null} Return the tile elevation or null otherwise.
 */
export function tokenTileElevation(token, position = { x: token.x, y: token.y }) {
  const tokenE = token.document.elevation;
  const bounds = token.bounds;
  bounds.x = position.x;
  bounds.y = position.y;

  const tiles = canvas.tiles.quadtree.getObjects(token.bounds);
  if ( !tiles.size ) return null;

  for ( const tile of tiles ) {
    // If using Levels, prefer the bottom of the token range
    const tileE = tile.document.flags?.levels?.rangeBottom ?? tile.document.elevation;
    if ( tokenE.almostEqual(tileE) ) return tileE;
  }
  return null;
}


/**
 * Determine token elevation for a give grid position.
 * Will be either the tile elevation, if the token is on the tile, or the terrain elevation.
 * @param {Token} token
 * @param {Point} position     Position to use for the token position.
 *   Should be a grid position (a token x,y).
 * @param {object} [options]
 * @param {boolean} [useAveraging]    Use averaging versus use the exact center point of the token at the position.
 *   Defaults to the GM setting.
 * @param {boolean} [considerTiles]   If false, skip testing tile elevations; return the underlying terrain elevation.
 * @returns {number} Elevation in grid units.
 */
export function tokenElevationAt(token, position, { useAveraging = getSetting(SETTINGS.AUTO_AVERAGING), considerTiles = true } = {}) {
  if ( considerTiles ) {
    const tileE = tokenTileElevation(token, position);
    if ( tileE !== null ) return tileE;
  }

  if ( useAveraging ) return averageElevationForToken(position.x, position.y, token.w, token.h);

  const center = token.getCenter(position.x, position.y);
  return canvas.elevation.elevationAt(center.x, center.y);
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
  if ( !res2d || !Object.hasOwn(test.point, "z") ) return res2d;

  const radius = visionSource.object.getLightRadius(mode.range);
  const dx = test.point.x - visionSource.x;
  const dy = test.point.y - visionSource.y;
  const dz = test.point.z - visionSource.elevationZ;
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
