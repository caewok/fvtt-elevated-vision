/* globals
*/
"use strict";

import { log } from "./util.js";

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
 * Wrap of Token.prototype.isVisible getter.
 *
 */
function EVTokenIsVisible(wrapped) {
  if ( wrapped() ) return true;

  // Only GM users can see hidden tokens
  const gm = game.user.isGM;
  if ( this.data.hidden && !gm ) return false;

  // If we get here, canvas.sight.testVisibility returned false.
  // Will need to redo the tests in testVisibility with some alterations.
  const visionSources = canvas.sight.sources;
  if ( !visionSources.size ) return game.user.isGM;

  // Determine the array of offset points to test
  const t = Math.min(this.w, this.h) / 4;;
  const offsets = t > 0 ? [[0, 0],[-t,-t],[-t,t],[t,t],[t,-t],[-t,0],[t,0],[0,-t],[0,t]] : [[0,0]];
  const points = offsets.map(o => new PIXI.Point(point.x + o[0], point.y + o[1]));

  // If the point is entirely inside the buffer region, it may be hidden from view
  const d = canvas.dimensions;
  if ( !canvas.sight._inBuffer && !points.some(p => d.sceneRect.contains(p.x, p.y)) ) return false;

  // If we get here, we know:
  // (a) If !requireFOV:
  //     (1) no visionSource LOS contained any of the points and
  //     (2) no lightSource contained any of the points (or the lightSource was inactive)
  // (b) If requireFOV:
  //     (1) no visionSource LOS contained any of the points or the source FOV did not
  //         contain the points and
  //      (2) same as (a)(2).
  const lightSources = canvas.lighting.sources;
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
      return this.restrictVisibility()
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


