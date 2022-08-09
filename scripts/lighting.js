/* globals
PIXI,
canvas
*/
"use strict";

import { log } from "./util.js";
import { MODULE_ID } from "./const.js";
// import { InvertFilter } from "./InvertFilter.js";

// export function _createLOSLightSource(wrapped) {
//   log("_createLOSLightSource");
//   const los = wrapped();
//   if ( !los.shadows || !los.shadows.length ) return los;
//
//   log("Adding shadow filter");
//   this.createReverseShadowMaskFilter()
//   this.illumination.filters = [this.reverseShadowMaskFilter];
//   this.coloration.filters = [this.reverseShadowMaskFilter];
//
//   return los;
// }


export function drawLightLightSource(wrapped) {
  log("drawLightLightSource")
  if ( this.los.shadows && this.los.shadows.length ) {
    log("drawLightLightSource has shadows")
//     this.illumination.filters = [this.createReverseShadowMaskFilter()];
  }

  if ( this.los._drawShadows ) this.los._drawShadows();
  return wrapped();
}
//
// export function createReverseShadowMaskFilter() {
// //   if ( !this.reverseShadowMaskFilter ) {
//     this.shadowsRenderTexture =
//        canvas.primary.createRenderTexture({renderFunction: this.renderShadows.bind(this), clearColor: [0, 0, 0, 0]});
//     this.reverseShadowMaskFilter = ReverseMaskFilter.create({
//       uMaskSampler: this.shadowsRenderTexture,
//       channel: "a"
//     });
//     this.reverseShadowMaskFilter.blendMode = PIXI.BLEND_MODES.NORMAL;
// //   }
//   return this.reverseShadowMaskFilter;
// }
//
// export function renderShadows(renderer) {
//   const cir = new PIXI.Circle(0, 0, 50);
//   const graphics = new PIXI.Graphics();
//   const rt = renderer.renderTexture;
//   graphics.beginFill(0, 1); // color, alpha
//   graphics.drawCircle(cir);
//   graphics.endFill;
//   renderer.render(graphics, rt);
//   return rt;
// }

// Simple version
export function _createLOSLightSource(wrapped) {
  const los = wrapped();
  this.createReverseMaskFilter();
  this.illumination.filters = [this.reverseMaskFilter];
  this.coloration.filters = [this.reverseMaskFilter];
  return los;
}

// Added to LightSource.prototype
export function createReverseMaskFilter() {
  const rt = canvas.primary.createRenderTexture({renderFunction: renderInnerCircle.bind(this), clearColor: [0, 0, 0, 0]});
  this.reverseMaskFilter = ReverseMaskFilter.create({
    uMaskSampler: rt,
    channel: "a"
  });
  this.reverseMaskFilter.blendMode = PIXI.BLEND_MODES.NORMAL;
  return this.reverseMaskFilter;
}

function renderInnerCircle(renderer) {
  const cir = new PIXI.Circle(0, 0, 50);
  const graphics = new PIXI.Graphics();
  const rt = renderer.renderTexture;
  graphics.beginFill(0, 1); // color, alpha
  graphics.drawCircle(cir);
  graphics.endFill;
  renderer.render(graphics, rt);
  return rt;
}




// export function renderShadows(renderer) {
//   if ( !this.los.shadows || !this.los.shadows.length ) return;
//
//   const graphics = new PIXI.Graphics();
//   const rt = renderer.renderTexture;
//
//   for ( const shadow of this.los.shadows) {
//     graphics.beginFill(0, 1); // color, alpha
//     graphics.drawPolygon(shadow);
//     graphics.endFill;
//   }
//   renderer.render(graphics, rt);
//   return rt;
// }




//   #createReverseMaskFilter() {
//     if ( !this.reverseMaskfilter ) {
//       this.reverseMaskfilter = ReverseMaskFilter.create({
//         uMaskSampler: canvas.primary.tokensRenderTexture,
//         channel: "a"
//       });
//       this.reverseMaskfilter.blendMode = PIXI.BLEND_MODES.NORMAL;
//     }
//     return this.reverseMaskfilter;
//   }
//
//
//    this.tokensRenderTexture =
//       this.createRenderTexture({renderFunction: this._renderTokens.bind(this), clearColor: [0, 0, 0, 0]});
//
//
//
//
//
//   createRenderTexture({renderFunction, clearColor}={}) {
//     const renderOptions = {};
//     const renderer = canvas.app?.renderer;
//
//     // Creating the render texture
//     const renderTexture = PIXI.RenderTexture.create({
//       width: renderer?.screen.width ?? window.innerWidth,
//       height: renderer?.screen.height ?? window.innerHeight,
//       resolution: renderer.resolution ?? PIXI.settings.RESOLUTION
//     });
//     renderOptions.renderFunction = renderFunction;            // Binding the render function
//     renderOptions.clearColor = clearColor;                    // Saving the optional clear color
//     this.#renderPaths.set(renderTexture, renderOptions);      // Push into the render paths
//
//     // Return a reference to the render texture
//     return renderTexture;
//   }
//
//   _renderTokens(renderer) {
//     for ( const tokenMesh of this.tokens ) {
//       tokenMesh.render(renderer);
//     }
//


// Class PointSource:
/**
 * Create a new Mesh for this source using a provided shader class
 * @param {Function} shaderCls  The subclass of AdaptiveLightingShader being used for this Mesh
 * @returns {PIXI.Mesh}         The created Mesh
 * @protected
 */
//   _createMesh(shaderCls) {
//     const state = new PIXI.State();
//     const mesh = new PIXI.Mesh(this.constructor.GEOMETRY, shaderCls.create(), state);
//     mesh.mask = this.losMask;
//     Object.defineProperty(mesh, "uniforms", {get: () => mesh.shader.uniforms});
//     return mesh;
//   }

/**
 * Update the position and size of the mesh each time it is drawn.
 * @param {PIXI.Mesh} mesh      The Mesh being updated
 * @returns {PIXI.Mesh}         The updated Mesh
 * @protected
 */
// _updateMesh(mesh) {
//   mesh.position.set(this.data.x, this.data.y);
//   mesh.width = mesh.height = this.radius * 2;
//   return mesh




