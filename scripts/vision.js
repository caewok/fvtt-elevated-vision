/* globals
canvas,
GlobalLightSource,
FogManager,
game,
PIXI,
PolygonMesher,
PointSource
*/
"use strict";

import { drawPolygonWithHoles } from "./util.js";
import { ShadowShader } from "./ShadowShader.js";
import { ShadowShaderNoRadius } from "./ShadowShaderNoRadius.js";

/**
 * Override CanvasVisionMask.prototype.refresh
 * This version draws the FOV and LOS polygons with holes, which creates shadows for
 * walls below the source, but does not (a) make higher terrain in the shadow visible or
 * (b) shadow terrain higher than the viewer.
 */
export function refreshCanvasVisibilityPolygons({forceUpdateFog=false}={}) {
  if ( !this.initialized ) return;
  if ( !this.tokenVision ) {
    this.visible = false;
    return this.restrictVisibility();
  }

  // Stage the priorVision vision container to be saved to the FOW texture
  let commitFog = false;
  const priorVision = canvas.masks.vision.detachVision();
  if ( priorVision._explored ) {
    this.pending.addChild(priorVision);
    commitFog = this.pending.children.length >= FogManager.COMMIT_THRESHOLD;
  }
  else priorVision.destroy({children: true});

  // Create a new vision for this frame
  const vision = canvas.masks.vision.createVision();

  // Draw field-of-vision for lighting sources
  for ( let lightSource of canvas.effects.lightSources ) {
    if ( !canvas.effects.visionSources.size || !lightSource.active || lightSource.disabled ) continue;
    const shadows = lightSource.los._elevatedvision?.combinedShadows || [];
    if ( shadows.length ) {
      drawPolygonWithHoles(shadows, { graphics: vision.fov });
    } else {
      vision.fov.beginFill(0xFFFFFF, 1.0).drawShape(lightSource.los).endFill();
    }

    if ( lightSource.data.vision ) {
      if ( shadows.length ) {
        drawPolygonWithHoles(shadows, { graphics: vision.los });
      } else {
        vision.los.beginFill(0xFFFFFF, 1.0).drawShape(lightSource.los).endFill();
      }
    }
  }

  // Draw sight-based visibility for each vision source
  for ( let visionSource of canvas.effects.visionSources ) {
    visionSource.active = true;
    const shadows = visionSource.los._elevatedvision?.combinedShadows || [];

    // Draw FOV polygon or provide some baseline visibility of the token's space
    if ( visionSource.radius > 0 ) {
      vision.fov.beginFill(0xFFFFFF, 1.0).drawShape(visionSource.fov).endFill();
    } else {
      const baseR = canvas.dimensions.size / 2;
      vision.base.beginFill(0xFFFFFF, 1.0).drawCircle(visionSource.x, visionSource.y, baseR).endFill();
    }

    // Draw LOS mask
    if ( shadows.length ) {
      drawPolygonWithHoles(shadows, { graphics: vision.los });
    } else {
      vision.los.beginFill(0xFFFFFF, 1.0).drawShape(visionSource.los).endFill();
    }

    // Record Fog of war exploration
    if ( canvas.fog.update(visionSource, forceUpdateFog) ) vision._explored = true;
  }


  // Commit updates to the Fog of War texture
  if ( commitFog ) canvas.fog.commit();

  // Alter visibility of the vision layer
  this.visible = canvas.effects.visionSources.size || !game.user.isGM;

  // Restrict the visibility of other canvas objects
  this.restrictVisibility();
}

/**
 * Wrap VisionSource.prototype._updateLosGeometry
 * Add simple geometry for using ShadowShader without a radius
 */
export function _updateLosGeometryVisionSource(wrapped, polygon) {
  wrapped(polygon);

  this._EV_geometry = {}

  // LOS
  const los_vertices = this.los.points;
  const los_indices = PIXI.utils.earcut(los_vertices);
  this._EV_geometry.los = new PIXI.Geometry()
      .addAttribute("aVertexPosition", los_vertices, 2)
      .addAttribute("aTextureCoord", [], 2)
      .addIndex(los_indices);

  // FOV
  const fov_vertices = this.fov.points;
  const fov_indices = PIXI.utils.earcut(fov_vertices);
  this._EV_geometry.fov = new PIXI.Geometry()
      .addAttribute("aVertexPosition", fov_vertices, 2)
      .addAttribute("aTextureCoord", [], 2)
      .addIndex(fov_indices);
}

/**
 * Wrap LightSource.prototype._updateLosGeometry
 * Add simple geometry for using ShadowShader without a radius
 */
export function _updateLosGeometryLightSource(wrapped, polygon) {
  wrapped(polygon);

  this._EV_geometry = {}

  // LOS
  const los_vertices = this.los.points;
  const los_indices = PIXI.utils.earcut(los_vertices);
  this._EV_geometry.los = new PIXI.Geometry()
      .addAttribute("aVertexPosition", los_vertices, 2)
      .addAttribute("aTextureCoord", [], 2)
      .addIndex(los_indices);
}

export function _createEVMeshVisionSource(type = "los") {
  const mesh = this._createMesh(ShadowShaderNoRadius);
  mesh.geometry = this._EV_geometry[type];
  return mesh;
}

export function _createEVMeshLightSource() {
  const mesh = this._createMesh(ShadowShaderNoRadius);
  mesh.geometry = this._EV_geometry.los;
  return mesh;
}

/**
 * Create an EV shadow mask of the LOS polygon.
 * @returns {PIXI.Mesh}
 */
export function _createEVMask(type = "los") {
  const mesh = this._createEVMesh(type);
  mesh.shader.updateUniforms(this);
  return mesh;
}

export function refreshCanvasVisibilityShader({forceUpdateFog=false}={}) {
  if ( !this.initialized ) return;
  if ( !this.tokenVision ) {
    this.visible = false;
    return this.restrictVisibility();
  }

  // Stage the priorVision vision container to be saved to the FOW texture
  let commitFog = false;
  const priorVision = canvas.masks.vision.detachVision();
  if ( priorVision._explored ) {
    this.pending.addChild(priorVision);
    commitFog = this.pending.children.length >= FogManager.COMMIT_THRESHOLD;
  }
  else priorVision.destroy({children: true});

  // Create a new vision for this frame
  const vision = canvas.masks.vision.createVision();
  const fillColor = 0xFF0000;


  // Draw field-of-vision for lighting sources
  for ( let lightSource of canvas.effects.lightSources ) {
    if ( !canvas.effects.visionSources.size || !lightSource.active || lightSource.disabled ) continue;

    if ( lightSource instanceof GlobalLightSource ) {
      // No shadows possible for the global light source
      const g = vision.fov.addChild(new PIXI.LegacyGraphics());
      g.beginFill(fillColor, 1.0).drawShape(lightSource.los).endFill();
      continue;
    }

    const mask = lightSource._createEVMask();
    vision.fov.addChild(mask);

    if ( lightSource.data.vision ) {
      vision.los.addChild(mask);
    }
  }

  // Draw sight-based visibility for each vision source
  for ( let visionSource of canvas.effects.visionSources ) {
    visionSource.active = true;

    // Draw FOV polygon or provide some baseline visibility of the token's space
    if ( visionSource.radius > 0 ) {
      vision.fov.addChild(visionSource._createEVMask("fov"));
    } else {
      const baseR = canvas.dimensions.size / 2;
      vision.base.beginFill(fillColor, 1.0).drawCircle(visionSource.x, visionSource.y, baseR).endFill();
    }

    vision.los.addChild(visionSource._createEVMask("los"));

    // Record Fog of war exploration
    if ( canvas.fog.update(visionSource, forceUpdateFog) ) vision._explored = true;
  }

  // Commit updates to the Fog of War texture
  if ( commitFog ) canvas.fog.commit();

  // Alter visibility of the vision layer
  this.visible = canvas.effects.visionSources.size || !game.user.isGM;

  // Restrict the visibility of other canvas objects
  this.restrictVisibility();
}


/**
 * Override LightSource/VisionSource.prototype._createMask
 * Added by Perfect Vision
 */
export function _createMaskPolygons(wrapped, ...args) {
  const mesh = wrapped(...args);
  const shadows = this.los._elevatedvision?.shadows;
  if ( shadows?.length ) {
    const graphics = mesh.addChild(new PIXI.LegacyGraphics());
    graphics.beginFill();
    for ( const shadow of shadows ) {
      graphics.drawShape(shadow);
    }
    graphics.endFill();
    graphics.renderable = false;
    graphics._stencilHole = true;
    mesh._stencilMasks = [mesh, graphics];
  }
  return mesh;
}

/**
 * Override VisionSource.prototype._createMask
 * Added by Perfect Vision
 */
export function _createMaskVisionSourceShader(wrapped, los = false) {
  const mesh = wrapped(los);
  mesh.shader = (los ? ShadowShaderNoRadius : ShadowShader).create();
  mesh.shader.updateUniforms(this);
  return mesh;
}

/**
 * Override LightSource.prototype._createMask
 * Added by Perfect Vision
 */
export function _createMaskLightSourceShader(wrapped) {
  const mesh = wrapped();
  if ( !(this instanceof GlobalLightSource) ) {
    mesh.shader = ShadowShader.create();
    mesh.shader.updateUniforms(this);
  }
  return mesh;
}
