/* globals
canvas,
ClockwiseSweepPolygon,
Token
*/
"use strict";

// import { drawPolygonWithHolesPV } from "./util.js";
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
  if ( (shaderAlgorithm === TYPES.POLYGONS || shaderAlgorithm === TYPES.WEBGL) && Object.hasOwn(shape, "_evPolygons") ) {
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


/**
 * Override CanvasVisibility.prototype.refreshVisibility
 * Use mask meshes instead of drawing shapes except for the basic shapes.
 * Requires several additions to work around private methods.
 * v11.302.
 */
export function refreshVisibilityCanvasVisibility() {
  if ( !this.vision?.children.length ) return;
  const fillColor = 0xFF0000;
  const vision = this.vision;

  // A flag to know if the lights cache render texture need to be refreshed
  let refreshCache = false;

  // A flag to know if fog need to be refreshed.
  let commitFog = false;

  // Checking if the lights cache need a full redraw
  let lightsFullRedraw = this.checkLights();
  if ( lightsFullRedraw ) {
    this.pointSourcesStates.clear();
    vision.fov.lights.clear();
  }
  vision.base.clear();
  vision.base.beginFill(fillColor, 1.0);
  vision.fov.lights.beginFill(fillColor, 1.0);
  vision.fov.tokens.clear();
  vision.fov.tokens.beginFill(fillColor, 1.0);

  vision.los.clear();
  vision.los.beginFill(fillColor, 1.0);
  vision.los.preview.clear();
  vision.los.preview.beginFill(fillColor, 1.0);

  // Iterating over each light source
  for ( const lightSource of canvas.effects.lightSources ) {
    // The light source is providing vision and has an active layer?
    if ( lightSource.active && lightSource.data.vision ) {
      if ( !lightSource.isPreview ) vision.los.drawShape(lightSource.shape);
      else vision.los.preview.drawShape(lightSource.shape);
    }

    // The light source is emanating from a token?
    if ( lightSource.object instanceof Token ) {
      if ( !lightSource.active ) continue;
      if ( !lightSource.isPreview ) vision.fov.tokens.drawShape(lightSource.shape);
      else vision.base.drawShape(lightSource.shape);
      continue;
    }

    // Determine whether this light source needs to be drawn to the texture
    let draw = lightsFullRedraw;
    if ( !lightsFullRedraw ) {
      const priorState = this.pointSourcesStates.get(lightSource);
      if ( !priorState || priorState.wasActive === false ) draw = lightSource.active;
    }

    // Save the state of this light source
    this.pointSourcesStates.set(lightSource,
      {wasActive: lightSource.active, updateId: lightSource.updateId});

    if ( !lightSource.active ) continue;
    refreshCache = true;
    if ( draw ) vision.fov.lights.drawShape(lightSource.shape);
  }

  // Do we need to cache the lights into the lightsSprite render texture?
  // Note: With a full redraw, we need to refresh the texture cache, even if no elements are present
  if ( refreshCache || lightsFullRedraw ) this.cacheLights(lightsFullRedraw);

  // Iterating over each vision source
  for ( const visionSource of canvas.effects.visionSources ) {
    if ( !visionSource.active ) continue;
    // Draw FOV polygon or provide some baseline visibility of the token's space
    if ( (visionSource.radius > 0) && !visionSource.data.blinded && !visionSource.isPreview ) {
      vision.fov.tokens.drawShape(visionSource.fov);
    } else vision.base.drawShape(visionSource.fov);
    // Draw LOS mask (with exception for blinded tokens)
    if ( !visionSource.data.blinded && !visionSource.isPreview ) {
      vision.los.drawShape(visionSource.los);
      commitFog = true;
    } else vision.los.preview.drawShape(visionSource.data.blinded ? visionSource.fov : visionSource.los);
  }

  // Fill operations are finished for LOS and FOV lights and tokens
  vision.base.endFill();
  vision.fov.lights.endFill();
  vision.fov.tokens.endFill();
  vision.los.endFill();
  vision.los.preview.endFill();

  // Update fog of war texture (if fow is activated)
  if ( commitFog ) canvas.fog.commit();
}

/**
 * Copy CanvasVisibility.prototype.#checkLights into public method.
 * Required to override CanvasVisibility.prototype.refreshVisibility.
 * Assumes this.#pointSourcesStates is made public
 * ---
 * Check if the lightsSprite render texture cache needs to be fully redrawn.
 * @returns {boolean}              return true if the lights need to be redrawn.
 */
export function checkLightsCanvasVisibility() {
  // Counter to detect deleted light source
  let lightCount = 0;
  // First checking states changes for the current effects lightsources
  for ( const lightSource of canvas.effects.lightSources ) {
    if ( lightSource.object instanceof Token ) continue;
    const state = this.pointSourcesStates.get(lightSource);
    if ( !state ) continue;
    if ( (state.updateId !== lightSource.updateId) || (state.wasActive && !lightSource.active) ) return true;
    lightCount++;
  }
  // Then checking if some lightsources were deleted
  return this.pointSourcesStates.size > lightCount;
}

/**
 * Wrap CanvasVisibility.prototype._tearDown
 * Clear the pointSourcesStates in tear down.
 */
export async function _tearDownCanvasVisibility(wrapped, options) {
  this.pointSourcesStates.clear();
  return wrapped(options);
}

/**
 * Copy CanvasVisibility.prototype.#cacheLights to a public method.
 * Required to override CanvasVisibility.prototype.refreshVisibility.
 * Relies on fact that vision.fov.lightsSprite = this.#lightsSprite
 * Assumes a public renderTransform = new PIXI.Matrix has been defined
 * ---
 * Cache into the lightsSprite render texture elements contained into vision.fov.lights
 * Note: A full cache redraw needs the texture to be cleared.
 * @param {boolean} clearTexture       If the texture need to be cleared before rendering.
 */
export function cacheLightsCanvasVisibility(clearTexture) {
  this.vision.fov.lights.renderable = true;
  const dims = canvas.dimensions;
  this.renderTransform.tx = -dims.sceneX;
  this.renderTransform.ty = -dims.sceneY;

  // Render the currently revealed vision to the texture
  canvas.app.renderer.render(this.vision.fov.lights, {
    renderTexture: this.vision.fov.lightsSprite.texture,
    clear: clearTexture,
    transform: this.renderTransform
  });
  this.vision.fov.lights.renderable = false;
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

