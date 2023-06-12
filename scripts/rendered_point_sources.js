/* globals
PIXI
*/
"use strict";

import { shadowUniforms } from "./shader_uniforms.js";

// Functions and hooks related to rendered point sources
// In v11, RenderedPointSource extends PointSource.
// It contains functionality for rendering shaders.
// Extended by LightSource and VisionSource subclasses.

/**
 * Hook to update uniforms and geometry for the LightSource.
 * Note that GlobalLightSource has a distinct hook.
 * A hook event that fires after RenderedPointSource shaders have initialized.
 * @param {LightSource} src
 */
export function initializeLightSourceShadersHook(src) {
  initializeRenderedPointSourceShaders(src);
}

/**
 * Hook to update uniforms and geometry for the VisionSource.
 * A hook event that fires after RenderedPointSource shaders have initialized.
 * @param {VisionSource} src
 */
export function initializeVisionSourceShadersHook(src) {
  initializeRenderedPointSourceShaders(src);
  addFOVGeometry(src);
}

/**
 * Add uniforms to illumination and coloration shaders for the source.
 * Add LOS polygon geometry to the source.
 * @param {RenderedPointSource} src
 */
function initializeRenderedPointSourceShaders(src) {
  for ( const layerID of ["illumination", "coloration"] ) {
    const shader = src.layers[layerID]?.shader;
    if ( !shader ) continue;
    shadowUniforms(src, true, shader.uniforms);
  }
  addLOSGeometry(src);
}

/**
 * Add the LOS polygon as a set of vertices to the source's shader.
 * @param {RenderedPointSource} src
 */
function addLOSGeometry(src) {
  if ( !src.shape ) return;

  src._EV_geometry ??= {};
  const los_vertices = src.shape.points;
  const los_indices = PIXI.utils.earcut(los_vertices);
  src._EV_geometry.los = new PIXI.Geometry()
    .addAttribute("aVertexPosition", los_vertices, 2)
    .addAttribute("aTextureCoord", [], 2)
    .addIndex(los_indices);
}

/**
 * Add the FOV polygon as a set of vertices to the source's shader.
 * Only required for vision sources.
 * @param {RenderedPointSource} src
 */
function addFOVGeometry(src) {
  if ( !src.shape ) return;

  src._EV_geometry ??= {};
  const fov_vertices = src.fov.points;
  const fov_indices = PIXI.utils.earcut(fov_vertices);
  src._EV_geometry.fov = new PIXI.Geometry()
    .addAttribute("aVertexPosition", fov_vertices, 2)
    .addAttribute("aTextureCoord", [], 2)
    .addIndex(fov_indices);
}
