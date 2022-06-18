/* globals
Token,
canvas,
game,
PIXI,
Ray
*/
"use strict";

import { log } from "./util.js";
import { EVClockwiseSweepPolygon } from "./ClockwiseSweep/ClockwiseSweepPolygon.js";
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
 * Override of SightLayer.prototype.testVisibility (canvas.sight.testVisibility)
 */
export function EVSightTestVisibility(wrapped, point, {tolerance=2, object=null}={}) {
  if ( !object || !(object instanceof Token) ) return wrapped(point, { tolerance, object });

  log(`EVSightTestVisibility at ${point.x},${point.y} for ${object.id}`, object);
  // ** This is copied directly from SightLayer.prototype.testVisibility **

  const visionSources = this.sources;
  const lightSources = canvas.lighting.sources;
  const d = canvas.dimensions;
  if ( !visionSources.size ) return game.user.isGM;

  // Determine the array of offset points to test
  const t = tolerance;  // For tokens: tolerance = Math.min(object.w, object.h) / 4;
  const offsets = t > 0
    ? [[0, 0], [-t, -t], [-t, t], [t, t], [t, -t], [-t, 0], [t, 0], [0, -t], [0, t]]
    : [[0, 0]];
  const points = offsets.map(o => new PIXI.Point(point.x + o[0], point.y + o[1]));

  // If the point is entirely inside the buffer region, it may be hidden from view
  if ( !this._inBuffer && !points.some(p => d.sceneRect.contains(p.x, p.y)) ) return false;

  // ** Modified after this **

  // We need a point that provides both LOS and FOV membership, and
  // also, if in shadow, has line of sight to a vision source without intersecting a wall.
  // Top and bottom of the token cube---the points to test along the token.
  // Test the middle for better consistency with how offsets above also test center
  const obj_top = object.topZ;
  const obj_bottom = object.bottomZ;
  const obj_center = (obj_top + obj_bottom) / 2;
  const points3d = [];
  const skip_top = obj_top === obj_bottom;

  // Try a single 3d center point for middle, top, bottom.
  // Then add middle, top, bottom for all other points around the boundary.
  const p0 = points.shift();
  points3d.push(new Point3d(p0.x, p0.y, obj_center));

  points.forEach(p => {
    points3d.push(new Point3d(p.x, p.y, obj_center));
    if ( skip_top ) return;

    points3d.push(
      new Point3d(p.x, p.y, obj_top),
      new Point3d(p.x, p.y, obj_bottom));
  });

  return points3d.some(p => {
    let hasLOS = false;
    let hasFOV = false;
    let requireFOV = !canvas.lighting.globalLight;

    // Check vision sources
    for ( const source of visionSources.values() ) {
      if ( !source.active ) continue;               // The source may be currently inactive
      if ( !hasLOS || (!hasFOV && requireFOV) ) {   // Do we need to test for LOS?
        hasLOS = testVisionSourceLOS(source, p);
        if ( !hasFOV && requireFOV ) {  // Do we need to test for FOV?
          if ( source.fov.contains(p.x, p.y) ) hasFOV = true;
        }
      }

      if ( hasLOS && (!requireFOV || hasFOV) ) {    // Did we satisfy all required conditions?
        return true;
      }
    }

    // Check light sources
    for ( const source of lightSources.values() ) {
      if ( !source.active ) continue;               // The source may be currently inactive
      if ( source.containsPoint(p) ) {
        if ( source.data.vision && testVisionSourceLOS(source, p) ) hasLOS = true;
        hasFOV = true;
      }
      if ( hasLOS && (!requireFOV || hasFOV) ) return true;
    }
    return false;
  });
}

function testVisionSourceLOS(source, p) {
  if ( !source.los.contains(p.x, p.y) ) { return false; }
  if ( !source.los.shadows?.length ) { return true; }

  const point_in_shadow = source.los.shadows.some(s => s.contains(p.x, p.y));
  if ( !point_in_shadow ) { return true; }

  const ray = new Ray(new Point3d(source.x, source.y, source.elevationZ), p);
  return !EVClockwiseSweepPolygon.getRayCollisions3d(ray, { type: "sight", mode: "any" });
}


/**
 * Wrap VisionSource.prototype._drawRenderTextureContainer
 */
export function EVVisionSourceDrawRenderTextureContainer(wrapped) {
  const c = wrapped();

  const shadows = this.los.shadows;
  if ( !shadows || !shadows.length ) {
    log("EVVisionSourceDrawRenderTextureContainer|no shadows");
    return c;
  }

  for ( const shadow of shadows ) {
    const g = c.addChild(new PIXI.LegacyGraphics());
    g.beginFill(0x000000, 1.0).drawShape(shadow).endFill();
  }

  return c;
}

/**
 * Wrap VisionSource.prototype.drawSight
 */
export function EVVisionSourceDrawSight(wrapped) {
  const c = wrapped();

  const shadows = this.los.shadows;
  if ( !shadows || !shadows.length ) {
    log("EVVisionSourceDrawSight|no shadows");
    return c;
  }

  for ( const shadow of shadows ) {
    const g = c.addChild(new PIXI.LegacyGraphics());
    g.beginFill(0x000000, 1.0).drawShape(shadow).endFill();
  }

  return c;
}
