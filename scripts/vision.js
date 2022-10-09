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

import { drawPolygonWithHoles, drawPolygonWithHolesPV } from "./util.js";
import { ShadowShader } from "./ShadowShader.js";
import { ShadowShaderNoRadius } from "./ShadowShaderNoRadius.js";
import { SmoothGeometry } from "./perfect-vision/smooth-geometry.js";

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
    const shadows = lightSource.los.combinedShadows || [];
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
    const shadows = visionSource.los.combinedShadows || [];

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
 * Override for creating vision with polygon shadow holes, compatible with Perfect Vision.
 * Add the holes directly when creating the vision object.
 */
export function createVisionCanvasVisionMaskPV(wrapper) {
  const vision = wrapper();

  for ( let lightSource of canvas.effects.lightSources ) {
    if ( !canvas.effects.visionSources.size
      || !lightSource.active
      || lightSource.disabled
      || lightSource instanceof GlobalLightSource ) continue;

    const shadows = lightSource.los.combinedShadows || [];
    if ( shadows.length ) {
      drawPolygonWithHolesPV(shadows, { graphics: vision.fov });

      if ( lightSource.data.vision ) {
        drawPolygonWithHolesPV(shadows, { graphics: vision.los });
      }
    }
  }

  for ( let visionSource of canvas.effects.visionSources ) {
    const shadows = visionSource.los.combinedShadows || [];
    if ( shadows.length ) {
      drawPolygonWithHolesPV(shadows, { graphics: vision.los });
    }
  }

  return vision;
}

/**
 * Wrap VisionSource.prototype.initialize
 * Add _sourceLosGeometry --- needed for vision los. vision._sourceGeometry uses fov.
 * See equivalent version for Perfect Vision: https://github.com/dev7355608/perfect-vision/blob/90176cc99ea1663433f3d41b25f245da6d9da474/scripts/core/point-source-mesh.js#L95
 */
export function initializeVisionSource(wrapped, ...args) {
  wrapped(...args);



  return this;
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

export function _updateLosGeometryVisionSourcePV(wrapped, polygon) {
  wrapped(polygon);

  this._EV_geometry ??= {}

  // LOS
  if ( this._EV_geometry.los ) {
    this._EV_geometry.los.update([this.los]);
  } else {
    this._EV_geometry.los = new SmoothGeometry([this.los]);
  }

  // FOV
  if ( this._EV_geometry.fov ) {
    this._EV_geometry.fov.update([this.fov]);
  } else {
    this._EV_geometry.fov = new SmoothGeometry([this.fov]);
  }
}

export function _updateLosGeometryLightSourcePV(wrapped, polygon) {
  wrapped(polygon);

  this._EV_geometry ??= {}

  // LOS
  if ( this._EV_geometry.los ) {
    this._EV_geometry.los.update([this.los]);
  } else {
    this._EV_geometry.los = new SmoothGeometry([this.los]);
  }
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

//   const shader = mesh.shader;
//   shader.texture = this.texture ?? PIXI.Texture.WHITE;
//   shader.textureMatrix = this._textureMatrix?.clone() ?? PIXI.Matrix.IDENTITY;
//   shader.alphaThreshold = 0.75;

  mesh.shader.updateUniforms(this);

//   this._updateMesh(mesh);

  // To avoid a bug in PolygonMesher and because ShadowShader assumes normalized geometry
  // based on radius, set radius to 1 if radius is 0.
//   if ( !this.radius ) mesh.scale.set(1);

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
 * Override VisionSource.prototype._createMask
 * Added by Perfect Vision.
 */
export function _createMaskVisionSourcePV(los = false) {
  return this._createEVMask(los ? "los" : "fov");
}

/**
 * Override LightSource.prototype._createMask
 * Added by Perfect Vision
 * Avoid creating a mask for LightingRegionSource (GlobalLightSource)
 */
export function _createMaskLightSourcePV(wrapped) {
  if ( this.constructor.name === "LightingRegionSource" ) return wrapped();
  return this._createEVMask();
}

