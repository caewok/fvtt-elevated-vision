/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI
*/
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import { sourceAtCanvasElevation } from "../util.js";
import { AbstractEVShader } from "./AbstractEVShader.js";
import { fetchGLSLCode, interpolate } from "./GLSLFunctions.js";
import { EdgeData } from "./BVH.js";

/* BVH shadow shader
One per rendered source.
Use the BVH to store all the relevant edges for the source.
The shader shoots rays from each fragment to the sized source,
testing for intersections.
The result is the shadow for the source from all walls and elevated terrain.
*/

const GLSL_UNSIZED_VERTEX = ""; // Currently unused.

const GLSL_UNSIZED_FRAGMENT = ""; // Currently unused.

const GLSL_SIZED_VERTEX = interpolate(
  await fetchGLSLCode("BVHShader_Sized_Vertex")
);

const GLSL_SIZED_FRAGMENT = interpolate(
  await fetchGLSLCode("BVHShader_Sized_Fragment")
);

export class ShadowBVHShader extends AbstractEVShader {
  /** @type {RenderedSource} */
  source;

  /** @type {BVH} */
  bvh;

  /**
   * Vertices are light --> wall corner to intersection on surface.
   * 3 vertices: light, ix for corner 1, ix for corner 2
   * No consideration of penumbra---just light --> corner --> canvas.
   * @type {string}
   */
  static vertexShader = GLSL_UNSIZED_VERTEX;

  // NOTE: ShadowWallShader.fragmentShader
  /**
   * Shadow shaders use an encoding for the percentage of light present at the fragment.
   * See lightEncoding.
   * This mask shader is binary: encodes either full light or no light.
   */
  static fragmentShader = GLSL_UNSIZED_FRAGMENT;

  static get time() { return Date.now() * 1e-12; }

  /**
   * Set the basic uniform structures.
   * uSceneDims: [sceneX, sceneY, sceneWidth, sceneHeight]
   * uElevationRes: [minElevation, elevationStep, maxElevation, gridScale]
   * uTerrainSampler: elevation texture
   * uLightPosition: [x, y, elevation] for the source
   * uLightRadius2: Radius squared for the source
   * uSourceType: Type of source
   * uTime: Current time, used for pseudorandom number generation
   */
  static defaultUniforms = {
    uSceneDims: [0, 0, 1, 1],
    uElevationRes: [0, 1, 256 * 256, 1],
    uTerrainSampler: 0,
    uBVHSampler: 0,
    uEdgeSampler: 0,
    uLightPosition: [0, 0, 0],
    uLightSize: 0,
    uSourceType: 0,
    uTime: this.time,
    uNumEdges: 0,
    uNumNodes: 0
  };

  /**
   * Factory function.
   * @param {object} defaultUniforms    Changes from the default uniforms set here.
   * @returns {ShadowMaskWallShader}
   */
  static create(source, bvh, defaultUniforms = {}) {
    const { sceneRect, distancePixels } = canvas.dimensions;
    defaultUniforms.uSceneDims ??= [
      sceneRect.x,
      sceneRect.y,
      sceneRect.width,
      sceneRect.height
    ];

    const ev = canvas.scene[MODULE_ID];
    defaultUniforms.uElevationRes ??= [
      ev.elevationMin,
      ev.elevationStep,
      ev.elevationMax,
      distancePixels
    ];

    // Texture uniforms.
    // TODO: Create an edge texture handler that mimics ElevationTextureHandler found at ev.
    //   Store at ev, so it is ev.elevation._texture and ev.edges._texture.
    defaultUniforms.uTerrainSampler = ev._elevationTexture;
    defaultUniforms.uBVHSampler = bvh.texture;
    defaultUniforms.uEdgeSampler = CONFIG[MODULE_ID].edgeTexture;
    defaultUniforms.uNumEdges = EdgeData.edges.length;
    defaultUniforms.uNumNodes = bvh.nodes.length;

    // Uniforms related to the source.
    const lightPosition = CONFIG.GeometryLib.threeD.Point3d.fromPointSource(source);
    if ( sourceAtCanvasElevation(lightPosition) ) lightPosition.z += 1;
    defaultUniforms.uLightPosition = [lightPosition.x, lightPosition.y, lightPosition.z];
    defaultUniforms.uLightSize = source.data.lightSize;
    defaultUniforms.uSourceType = CONST.WALL_RESTRICTION_TYPES.findIndex(elem => elem === source.constructor.sourceType);

    // Uniforms related to sampling.
    defaultUniforms.uTime = this.time;

    const shader = super.create(defaultUniforms);
    shader.source = source;
    shader.bvh = bvh;
    return shader;
  }

  /**
   * Update based on indicated changes to the source.
   * @param {Set<string>} changes         Change keys for the source.
   * @returns {boolean} True if the indicated changes resulted in a change to the shader.
   */
  sourceUpdated(changes) {
    const changedPosition = changes.has("x") || changes.has("y");
    const changedElevation = changes.has("elevation");
    const changedSize = changes.has(`flags.${MODULE_ID}.${FLAGS.LIGHT_SIZE}`);
    if ( changedPosition || changedElevation ) this.updateLightPosition();
    if ( changedSize ) this.updateLightSize();
    return changedPosition || changedElevation || changedSize;
  }

  /**
   * Update the light position.
   */
  updateLightPosition() {
    const lightPosition = CONFIG.GeometryLib.threeD.Point3d.fromPointSource(this.source);
    if ( sourceAtCanvasElevation(lightPosition) ) lightPosition.z += 1;
    this.uniforms.uLightPosition = [...lightPosition];
  }

  /**
   * Update the light size.
   * TODO: Handle setting light size to 0.
   */
  updateLightSize() { this.uniforms.uLightSize = this.source.data.lightSize; }

  /**
   * Update the bvh and edge lengths.
   */
  updateBVH() {
    defaultUniforms.uNumEdges = EdgeData.edges.length;
    defaultUniforms.uNumNodes = this.bvh.nodes.length;
  }

  /**
   * Remove links to large objects.
   */
  destroy() {
    this.source = null;
    super.destroy();
  }
}

export class SizedSourceShadowBVHShader extends ShadowBVHShader {
  /**
   * Vertices are light --> wall corner to intersection on surface.
   * 3 vertices: light, ix for corner 1, ix for corner 2
   * No consideration of penumbra---just light --> corner --> canvas.
   * @type {string}
   */
  static vertexShader = GLSL_SIZED_VERTEX;

  // NOTE: ShadowWallShader.fragmentShader
  /**
   * Shadow shaders use an encoding for the percentage of light present at the fragment.
   * See lightEncoding.
   * This mask shader is binary: encodes either full light or no light.
   */
  static fragmentShader = GLSL_SIZED_FRAGMENT;
}
