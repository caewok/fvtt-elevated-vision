/* globals
GhostLightIlluminationShader,
PIXI,
canvas
*/
"use strict";

import { log } from "./util.js";
import { MODULE_ID } from "./const.js";
import { InvertFilter } from "./InvertFilter.js";

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


/**
 * Wrap LightSource.prototype._drawRenderTextureContainer
 */
export function EVLightSourceDrawRenderTextureContainer(wrapped) {
  const c = wrapped();

  const shadows = this.los.shadows;
  if ( !shadows || !shadows.length ) {
    log("EVLightSourceDrawRenderTexture|no shadows");
    return c;
  }

  for ( const shadow of shadows ) {
    const g = c.addChild(new PIXI.LegacyGraphics());
    g.beginFill(0x000000, 1.0).drawShape(shadow).endFill();
  }

  return c;
}


