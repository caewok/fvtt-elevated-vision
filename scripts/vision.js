/* globals
canvas,
GlobalLightSource,
FogManager,
game,
PIXI
*/
"use strict";

import { drawPolygonWithHolesPV } from "./util.js";
// import { ShadowShader } from "./glsl/ShadowShader.js";
// import { ShadowShaderNoRadius } from "./glsl/ShadowShaderNoRadius.js";
import { getSceneSetting, SETTINGS } from "./settings.js";

// NOTE: Polygon and Shader methods

/**
 * Wrap PIXI.Graphics.drawShape.
 * If passed a polygon with an array of polygons property, use that to draw with holes.
 */
export function drawShapePIXIGraphics(wrapped, shape) {
  if ( !(shape instanceof ClockwiseSweepPolygon) ) return wrapped(shape);

  const { ALGORITHM, TYPES } = SETTINGS.SHADING;
  const shaderAlgorithm = getSceneSetting(ALGORITHM) ?? TYPES.NONE;
  if ( (shaderAlgorithm === TYPES.POLYGONS ||  shaderAlgorithm === TYPES.WEBGL) && Object.hasOwn(shape, "_evPolygons") ) {
    for ( const poly of shape._evPolygons ) {
      if ( poly.isHole ) {
        this.beginHole();
        this.drawShape(poly);
        this.endHole();
      } else this.drawShape(poly);
    }
  } else {
    return wrapped(shape);
  }

  return this;
}


// NOTE: Shader methods

/**
 * Create an EV shadow mask of the LOS polygon.
 * @returns {PIXI.Mesh}
 */
// export function _createEVMask(type = "los") {
//   const mesh = this._createEVMesh(type);
//   mesh.shader.updateUniforms(this);
//   return mesh;
// }
//
//
// export function _createEVMeshVisionSource(type = "los") {
//   const mesh = _createMesh(ShadowShaderNoRadius, this._EV_geometry[type]);
//   return mesh;
// }
//
// export function _createEVMeshLightSource() {
//   const mesh = _createMesh(ShadowShaderNoRadius, this._EV_geometry.los);
//   return mesh;
// }
//
// function _createMesh(shaderCls, geometry) {
//   const state = new PIXI.State();
//   const mesh = new PointSourceMesh(geometry, shaderCls.create(), state);
//   mesh.drawMode = PIXI.DRAW_MODES.TRIANGLES;
//   Object.defineProperty(mesh, "uniforms", {get: () => mesh.shader.uniforms});
//   return mesh;
// }
//
// // export function refreshCanvasVisibilityShader({forceUpdateFog=false}={}) {
// //   if ( !this.initialized ) return;
// //   if ( !this.tokenVision ) {
// //     this.visible = false;
// //     return this.restrictVisibility();
// //   }
// //
// //   // Stage the priorVision vision container to be saved to the FOW texture
// //   let commitFog = false;
// //   const priorVision = canvas.masks.vision.detachVision();
// //   if ( priorVision._explored ) {
// //     this.pending.addChild(priorVision);
// //     commitFog = this.pending.children.length >= FogManager.COMMIT_THRESHOLD;
// //   }
// //   else priorVision.destroy({children: true});
// //
// //   // Create a new vision for this frame
// //   const vision = canvas.masks.vision.createVision();
// //   const fillColor = 0xFF0000;
// //
// //
// //   // Draw field-of-vision for lighting sources
// //   for ( let lightSource of canvas.effects.lightSources ) {
// //     if ( !canvas.effects.visionSources.size || !lightSource.active || lightSource.disabled ) continue;
// //
// //     if ( lightSource instanceof GlobalLightSource ) {
// //       // No shadows possible for the global light source
// //       const g = vision.fov.addChild(new PIXI.LegacyGraphics());
// //       g.beginFill(fillColor, 1.0).drawShape(lightSource.los).endFill();
// //       continue;
// //     }
// //
// //     const mask = lightSource._createEVMask();
// //     vision.fov.addChild(mask);
// //
// //     if ( lightSource.data.vision ) {
// //       vision.los.addChild(mask);
// //     }
// //   }
// //
// //   // Draw sight-based visibility for each vision source
// //   for ( let visionSource of canvas.effects.visionSources ) {
// //     visionSource.active = true;
// //
// //     // Draw FOV polygon or provide some baseline visibility of the token's space
// //     if ( visionSource.radius > 0 ) {
// //       vision.fov.addChild(visionSource._createEVMask("fov"));
// //     } else {
// //       const baseR = canvas.dimensions.size / 2;
// //       vision.base.beginFill(fillColor, 1.0).drawCircle(visionSource.x, visionSource.y, baseR).endFill();
// //     }
// //
// //     vision.los.addChild(visionSource._createEVMask("los"));
// //
// //     // Record Fog of war exploration
// //     if ( canvas.fog.update(visionSource, forceUpdateFog) ) vision._explored = true;
// //   }
// //
// //   // Commit updates to the Fog of War texture
// //   if ( commitFog ) canvas.fog.commit();
// //
// //   // Alter visibility of the vision layer
// //   this.visible = canvas.effects.visionSources.size || !game.user.isGM;
// //
// //   // Restrict the visibility of other canvas objects
// //   this.restrictVisibility();
// // }
//
// // NOTE: PerfectVision functions for compatibility
// // TODO: Need to fix this if PV v11 comes out
//
// /**
//  * Override for creating vision with polygon shadow holes, compatible with Perfect Vision.
//  * Add the holes directly when creating the vision object.
//  */
// export function createVisionCanvasVisionMaskPV(wrapper) {
//   const vision = wrapper();
//
//   for ( let lightSource of canvas.effects.lightSources ) {
//     if ( !canvas.effects.visionSources.size
//       || !lightSource.active
//       || lightSource.disabled
//       || lightSource instanceof GlobalLightSource ) continue;
//
//     const shadows = lightSource.los._elevatedvision?.combinedShadows || [];
//     if ( shadows.length ) {
//       drawPolygonWithHolesPV(shadows, { graphics: vision.fov });
//
//       if ( lightSource.data.vision ) {
//         drawPolygonWithHolesPV(shadows, { graphics: vision.los });
//       }
//     }
//   }
//
//   for ( let visionSource of canvas.effects.visionSources ) {
//     const shadows = visionSource.los._elevatedvision?.combinedShadows || [];
//     if ( shadows.length ) {
//       drawPolygonWithHolesPV(shadows, { graphics: vision.los });
//     }
//   }
//
//   return vision;
// }
//
// export function _createEVMeshVisionSourcePV(type = "los") {
//   if ( type === "los" ) {
//     const mesh = this._createMesh(ShadowShaderNoRadius);
//     mesh.geometry = this._sourceLosGeometry;
//     return mesh;
//   }
//
//   const mesh = this._createMesh(ShadowShader);
//   mesh.geometry = this._sourceGeometry;
//   return mesh;
// }
//
//
// export function _createEVMeshLightSourcePV() {
//   const mesh = this._createMesh(ShadowShader);
//   mesh.geometry = this._sourceGeometry;
//   return mesh;
// }
//
// /**
//  * Override VisionSource.prototype._createMask
//  * Added by Perfect Vision.
//  */
// export function _createMaskVisionSourcePV(los = false) {
//   return this._createEVMask(los ? "los" : "fov");
// }
//
// /**
//  * Override LightSource.prototype._createMask
//  * Added by Perfect Vision
//  * Avoid creating a mask for LightingRegionSource (GlobalLightSource)
//  */
// export function _createMaskLightSourcePV(wrapped) {
//   if ( this.constructor.name === "LightingRegionSource" ) return wrapped();
//   return this._createEVMask();
// }

