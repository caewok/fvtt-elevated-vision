/* globals
canvas,
GlobalLightSource,
FogManager,
game,
PIXI,
PolygonMesher,
PointSourceMesh,
PointSource
*/
"use strict";

import { log, drawPolygonWithHoles, drawPolygonWithHolesPV } from "./util.js";
import { ShadowLOSFilter } from "./ShadowLOSFilter.js";
import { GraphicsStencilMask } from "./perfect-vision/graphics-stencil-mask.js";
import { ShadowShader, updateShadowShaderUniforms } from "./ShadowShader.js";


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
 * Override CanvasVisionMask.prototype.createVision
 * From Perfect Vision module.
 * So that the LOS mask can be applied using a mesh.
 */
// export function createVisionCanvasVisionMask() {
//   const vision = new PIXI.Container();
//   const fill = vision.addChild(
//     new PIXI.LegacyGraphics()
//       .beginFill(0xFF0000)
//       .drawShape(canvas.dimensions.rect.clone())
//       .endFill()
//     );
//
//     vision.fov = vision.addChild(new GraphicsStencilMask());
//     vision.los = vision.addChild(new GraphicsStencilMask());
//     vision.base = vision.fov.addChild(new PIXI.LegacyGraphics());
//
//     vision.mask = vision.los;
//     vision._explored = false;
//     return vision;
// }

export function createVisionCanvasVisionMask() {
  const vision = new PIXI.Container();
  vision.base = vision.addChild(new PIXI.LegacyGraphics());
  vision.fov = vision.addChild(new PIXI.LegacyGraphics());
  vision.los = vision.addChild(new PIXI.LegacyGraphics());
  vision.mask = vision.los;
  vision._explored = false;
  return vision;
}

/**
 * Wrap VisionSource.prototype._updateLosGeometry
 * Add a _sourceGeometryLOS b/c the _sourceGeometry for vision uses the fov.
 */
export function _updateLosGeometryVisionSource(wrapper, polygon) {
  wrapper(polygon);

  const polyMesherLOS = new PolygonMesher(this.los, {
    normalize: true,
    x: this.x,
    y: this.y,
    radius: this.radius,
    offset: this._flags.renderSoftEdges ? PointSource.EDGE_OFFSET : 0
  });

  this._sourceGeometryLOS = polyMesherLOS.triangulate(this._sourceGeometryLOS);
}

/**
 * Wrap VisionSource.prototype._initializeMeshes
 * Add meshes for FOV and LOS
 */
export function _createMeshes(wrapper) {
  wrapper();
  this._createEVMeshes();
}

export function _createEVMeshesVisionSource() {
  if ( !this._sourceGeometryLOS || !this._sourceGeometry ) this._updateLosGeometry(this.fov);

  if ( this._EV_mesh?.los ) this._EV_mesh.los.destroy();
  if ( this._EV_mesh?.fov ) this._EV_mesh.fov.destroy();

  this._EV_mesh = {};
  this._EV_mesh.los = this._createEVMesh(ShadowShader, this._sourceGeometryLOS);
  this._EV_mesh.fov = this._createEVMesh(ShadowShader, this._sourceGeometry);

  // ShadowLOSFilter
  // TestShader
}

export function _createEVMeshesLightSource() {
  if ( !this._sourceGeometry ) this._updateLosGeometry(this.los);
  if ( this._EV_mesh?.los ) this._EV_mesh.los.destroy();

  this._EV_mesh = {};
  this._EV_mesh.los = this._createEVMesh(ShadowShader, this._sourceGeometry);
}

class TestShader extends AdaptiveLightingShader {
  static fragmentShader = `
  void main() {
    gl_FragColor = vec4(1., 0., 0., 1.);
  }
  `;
}


/**
 * Create an EV shadow mask of the LOS polygon.
 * @returns {PIXI.Mesh}
 */
export function _createEVMask(type = "los") {
  if ( !this._EV_mesh || this._EV_mesh[type].destroyed ) this._createEVMeshes();
  const mesh = this._EV_mesh[type];
  if ( mesh._destroyed || !mesh.position ) {
    log("_createMask fails!");
  }

  updateShadowShaderUniforms(this._EV_mesh[type].shader.uniforms, this);
  return this._updateMesh(mesh);
}

/**
 * New function based on _createMesh
 * Used to construct LOS mesh for VisionSources
 * @param {Function} shaderCls  The subclass of AdaptiveLightingShader being used for this Mesh
 * @returns {PIXI.Mesh}         The created Mesh
 */
export function _createEVMesh(shaderCls, geometry) {
  const state = new PIXI.State();
  const mesh = new PointSourceMesh(geometry, shaderCls.create({}, this), state);

  const shader = mesh.shader;
  shader.texture = this.texture ?? PIXI.Texture.WHITE;
  shader.textureMatrix = this._textureMatrix?.clone() ?? PIXI.Matrix.IDENTITY;
  shader.alphaThreshold = 0.75;

//   mesh.drawMode = PIXI.DRAW_MODES.TRIANGLES;
  Object.defineProperty(mesh, "uniforms", {get: () => mesh.shader.uniforms});
  return mesh;
}

export function destroyVisionSource(wrapper) {
  wrapper();
  this._sourceGeometryLOS?.destroy();
  this._EV_mesh?.los.destroy();
  this._EV_mesh?.fov.destroy();
}

export function destroyLightSource(wrapper) {
  wrapper();
  this._EV_mesh?.los.destroy();
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
 * Override PointSource.prototype._createMask
 * Added by Perfect Vision.
 */
// export function _createMaskPointSourcePV() {
//
//
//   log("_createMaskPointSourcePV");
//
//   const mesh = this._updateMesh(this._createEVMesh(ShadowShader));
//   const shader = mesh.shader;
//
//   shader.texture = this._texture ?? PIXI.Texture.WHITE;
//   shader.textureMatrix = this._textureMatrix?.clone() ?? PIXI.Matrix.IDENTITY;
//   shader.alphaThreshold = 0.75;
//
//   updateShadowShaderUniforms(shader.uniforms, this);
//
//   return mesh;
// }

/**
 * Override VisionSource.prototype._createMask
 * Added by Perfect Vision.
 */
export function _createMaskVisionSourcePV(los = false) {
  const type = los ? "los" : "fov";
  return this._createEVMask(type);
}

/**
 * Add LightSource.prototype._createMask
 */
export function _createMaskLightSourcePV() {
  return this._createEVMask();
}



/**
 * New function based on _createMesh
 * Used to construct LOS mesh for VisionSources
 * @param {Function} shaderCls  The subclass of AdaptiveLightingShader being used for this Mesh
 * @returns {PIXI.Mesh}         The created Mesh
 */
// export function _createEVMeshPV(shaderCls) {
//   const state = new PIXI.State();
//   const mesh = new PointSourceMesh(this._sourceGeometry, shaderCls.create({}, this), state);
//   mesh.source = this;
//   return mesh;
// }
