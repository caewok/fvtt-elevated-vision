/* globals
Token,
canvas,
game,
PIXI,
Ray,
LightSource
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
  const t = tolerance;
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
  const obj_top = object.top;
  const obj_bottom = object.bottom;
  const obj_center = Math.round((obj_top + obj_bottom) / 2);
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

  return points.some(p => {
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

  const ray = new Ray(new Point3d(source.x, source.y, source.elevation), p);
  return !EVClockwiseSweepPolygon.getRayCollisions3d(ray, { type: "sight", mode: "any" });
}


function drawShadowHoles(source, mask) {
  if ( source.los?.shadows && source.los.shadows.length ) {
    log("\ndrawShadowHoles", source, mask);
    source.los.shadows.forEach(s => {
      log(`\tdrawShadowHoles|${s.points.length} shadow`);
      mask.beginHole().drawShape(s).endHole();
    });
  }
}

/**
 * Override VisionSource.prototype.drawVision
 * Appears to remove parts of the token field of view circle if unlimited vision
 */
export function EVDrawVision() {
  if ( this._flags.renderFOV ) {
    this.losMask.clear().beginFill(0xFFFFFF).drawShape(this.los);
    drawShadowHoles(this, this.losMask);
    this.losMask.endFill();

    if ( this._flags.useFov ) this._renderTexture();
  }
  return LightSource.prototype.drawLight.call(this);
}

/**
 * Override VisionSource.prototype.drawSight
 */
export function EVDrawSight() {
  const c = new PIXI.Container();
  const fov = c.addChild(new PIXI.LegacyGraphics());
  fov.beginFill(0xFFFFFF).drawCircle(this.x, this.y, this.radius).endFill();
  const los = c.addChild(new PIXI.LegacyGraphics());
  los.beginFill(0xFFFFFF).drawShape(this.los);
  drawShadowHoles(this, los);
  los.endFill();
  c.mask = los;
  return c;
}

/**
 * Override SightLayer.prototype.refresh
 */
export function EVSightLayerRefresh({forceUpdateFog=false, skipUpdateFog=false}={}) {
  if ( !this._initialized ) return;
  if ( !this.tokenVision ) {
    this.visible = false;
    return this.restrictVisibility();
  }

  // Configuration variables
  const d = canvas.dimensions;
  const unrestrictedVisibility = canvas.lighting.globalLight;
  let commitFog = false;

  // Stage the prior vision container to be saved to the FOW texture
  const prior = this.explored.removeChild(this.vision);
  if ( prior._explored && !skipUpdateFog ) {
    this.pending.addChild(prior);
    commitFog = this.pending.children.length >= this.constructor.FOG_COMMIT_THRESHOLD;
  }
  else prior.destroy({children: true});

  // Create a new vision container for this frame
  const vision = this._createVisionContainer();
  this.explored.addChild(vision);

  // Draw standard vision sources
  let inBuffer = canvas.scene.data.padding === 0;

  // Unrestricted visibility, everything in LOS is visible
  if ( unrestrictedVisibility ) vision.base.beginFill(0xFFFFFF, 1.0).drawShape(d.rect).endFill();

  // Otherwise, provided minimum visibility for each vision source
  else {
    for ( let source of this.sources ) {
      vision.base.beginFill(0xFFFFFF, 1.0).drawCircle(source.x, source.y, d.size / 2);
    }
  }

  // Draw field-of-vision for lighting sources
  for ( let source of canvas.lighting.sources ) {
    if ( !this.sources.size || !source.active ) continue;
    const g = new PIXI.LegacyGraphics();
    g.beginFill(0xFFFFFF, 1.0).drawShape(source.los).endFill();
    vision.fov.addChild(g);
    if ( source.data.vision ) {  // Some ambient lights provide vision
      vision.los.beginFill(0xFFFFFF).drawShape(source.los);
      drawShadowHoles(source, vision.los);
      vision.los.endFill();
    }
  }

  // Draw sight-based visibility for each vision source
  for ( let source of this.sources ) {
    source.active = true;
    if ( !inBuffer && !d.sceneRect.contains(source.x, source.y) ) inBuffer = true;
    if ( !unrestrictedVisibility && (source.radius > 0) ) {             // Token FOV radius
      vision.fov.addChild(source.drawSight());
    }
    vision.los.beginFill(0xFFFFFF).drawShape(source.los);
    drawShadowHoles(source, vision.los);
    vision.los.endFill();     // Token LOS mask
    if ( !skipUpdateFog ) this.updateFog(source, forceUpdateFog);       // Update fog exploration
  }

  // Commit updates to the Fog of War texture
  if ( commitFog ) this.commitFog();

  // Alter visibility of the vision layer
  this.visible = this.sources.size || !game.user.isGM;

  // Apply a mask to the exploration container
  if ( this.explored.msk ) {
    const noMask = this.sources.size && inBuffer;
    this.explored.mask = noMask ? null : this.explored.msk;
    this.explored.msk.visible = !noMask;
  }

  // Restrict the visibility of other canvas objects
  this._inBuffer = inBuffer;
  this.restrictVisibility();
}


