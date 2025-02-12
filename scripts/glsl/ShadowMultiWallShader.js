/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI
*/
"use strict";

import { MODULE_ID } from "../const.js";
import { sourceAtCanvasElevation } from "../util.js";
import { AbstractEVShader } from "./AbstractEVShader.js";
import { defineFunction, defineStruct, fetchGLSLCode, interpolate } from "./GLSLFunctions.js";


// Calculation used to construct penumbra vertices from a set of light directions.
// Added directly to the directional and point source penumbra shaders below.
/* Terms:
- Penumbra: Partial shadow created when lightSize is greater than 0.
- Near: The penumbra created when the wall bottom hovers above the canvas.
- Far: The far penumbra caused by the spherical light in the z direction.
    Furthest shadow point from the wall. Creates a line parallel to the wall.
- Side: Penumbra along the ray from the light to each endpoint along the sides of the shadow trapezoid.
- Mid: Middle of the penumbra. Equivalent to the start of the shadow when no penumbra is present.
    (Light is point source.)
- Umbra: End of the penumbra; beginning of 100% shadow.
*/


// NOTE: GLSL Shared functions and calculations.


// NOTE: GLSL code for each class.
const GLSL_UNSIZED_VERTEX = interpolate(
  await fetchGLSLCode("MultiWallShader_Unsized_Vertex")
);

const GLSL_UNSIZED_FRAGMENT = interpolate(
  await fetchGLSLCode("MultiWallShader_Unsized_Fragment")
);

/**
 * Draw shadow for wall without shading for penumbra and without the outer penumbra.
 */
export class ShadowMultiWallShader extends AbstractEVShader {
  // NOTE: ShadowWallShader.vertexShader

  /** @type {RenderedSource} */
  source;

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

  /**
   * Set the basic uniform structures.
   * uSceneDims: [sceneX, sceneY, sceneWidth, sceneHeight]
   * uElevationRes: [minElevation, elevationStep, maxElevation, gridScale]
   * uTerrainSampler: elevation texture
   * uLightPosition: [x, y, elevation] for the light
   */

  static defaultUniforms = {
    uSceneDims: [0, 0, 1, 1],
    uElevationRes: [0, 1, 256 * 256, 1],
    uTerrainSampler: 0,
    uLightPosition: [0, 0, 0],
    uNumSamples: 1
  };

  /**
   * Factory function.
   * @param {Point3d} lightPosition
   * @param {object} defaultUniforms    Changes from the default uniforms set here.
   * @returns {ShadowMaskWallShader}
   */
  static create(source, defaultUniforms = {}) {
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
    defaultUniforms.uTerrainSampler = ev._elevationTexture;

    const lightPosition = CONFIG.GeometryLib.threeD.Point3d.fromPointSource(source);
    if ( sourceAtCanvasElevation(lightPosition) ) lightPosition.z += 1;
    defaultUniforms.uLightPosition = [...lightPosition];

    const shader = super.create(defaultUniforms);
    shader.source = source;
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
    if ( changedPosition || changedElevation ) this.updateLightPosition();
    return changedPosition || changedElevation;
  }

  /**
   * Update the light position.
   * @param {RenderedSource} source
   */
  updateLightPosition() {
    const lightPosition = CONFIG.GeometryLib.threeD.Point3d.fromPointSource(this.source);
    if ( sourceAtCanvasElevation(lightPosition) ) lightPosition.z += 1;
    this.uniforms.uLightPosition = [...lightPosition];
  }

  /**
   * Remove links to large objects.
   */
  destroy() {
    this.source = null;
    super.destroy();
  }
}

/**
 * Draw directional shadow for wall with shading for penumbra and with the outer penumbra.
 * https://www.researchgate.net/publication/266204563_Calculation_of_the_shadow-penumbra_relation_and_its_application_on_efficient_architectural_design
 */
export class DirectionalSourceShadowMultiWallShader extends ShadowMultiWallShader {
  // NOTE: DirectionalShadowWallShader.vertexShader
  /**
   * Vertices are light --> wall corner to intersection on surface.
   * 3 vertices: light, ix for corner 1, ix for corner 2
   * No consideration of penumbra---just light --> corner --> canvas.
   * @type {string}
   */
  static vertexShader = GLSL_UNSIZED_VERTEX;

  // NOTE: DirectionalShadowWallShader.fragmentShader
  /**
   * Shadow shaders use an encoding for the percentage of light present at the fragment.
   * See lightEncoding.
   * This mask shader is binary: encodes either full light or no light.
   */
  static fragmentShader = GLSL_UNSIZED_FRAGMENT;

  /**
   * Factory function.
   * @param {Point3d} lightPosition
   * @param {object} defaultUniforms    Changes from the default uniforms set here.
   * @returns {ShadowMaskWallShader}
   */
  static create(source, defaultUniforms = {}) {
    defaultUniforms.uNumSamples = CONFIG[MODULE_ID].webGLShadowSamples;
    return super.create(source, defaultUniforms);
  }

}

/**
 * Draw shadow from a sized source for wall with shading for penumbra and with the outer penumbra
 * https://www.researchgate.net/publication/266204563_Calculation_of_the_shadow-penumbra_relation_and_its_application_on_efficient_architectural_design
 */
export class PointSourceShadowMultiWallShader extends ShadowMultiWallShader {
  // NOTE: SizedPointSourceShadowWallShader.vertexShader
  /**
   * Wall shadow with side, near, and far penumbra.
   * Vertices are light --> wall corner to intersection on surface.
   * If the light has a size, the intersection is extended based on the size.
   * 3 vertices: light, ix for corner 1, ix for corner 2
   * @type {string}
   */
  static vertexShader = GLSL_UNSIZED_VERTEX;

  // NOTE: SizedPointSourceShadowWallShader.fragmentShader
  /**
   * Shadow shaders use an encoding for the percentage of light present at the fragment.
   * See lightEncoding.
   * This mask shader is binary: encodes either full light or no light.
   */
  static fragmentShader = GLSL_UNSIZED_FRAGMENT;

  /**
   * Factory function.
   * @param {Point3d} lightPosition
   * @param {object} defaultUniforms    Changes from the default uniforms set here.
   * @returns {ShadowMaskWallShader}
   */
  static create(source, defaultUniforms = {}) {
    defaultUniforms.uNumSamples = CONFIG[MODULE_ID].webGLShadowSamples;
    defaultUniforms.uLightSize = source.data.lightSize;
    return super.create(source, defaultUniforms);
  }

  /**
   * Update based on indicated changes to the source.
   * @param {Set<string>} changes         Change keys for the source.
   * @returns {boolean} True if the indicated changes resulted in a change to the shader.
   */
  sourceUpdated(changes) {
    const otherUpdates = super.sourceUpdated(changes);
    const changedLightSize = changes.has("lightSize");
    if ( changedLightSize ) this.updateLightSize();
    return otherUpdates || changedLightSize;
  }

  updateLightSize() {
    this.uniforms.uLightSize = this.source.data.lightSize;
    this.uniforms.uTime = Date.now() * 1e-12;
  }
}


export class ShadowMesh extends PIXI.Mesh {
  constructor(...args) {
    super(...args);
    this.blendMode = PIXI.BLEND_MODES.MULTIPLY;
  }
}


/* Testing
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw
Plane = CONFIG.GeometryLib.threeD.Plane
api = game.modules.get("elevatedvision").api
DirectionalLightSource = api.DirectionalLightSource

let [l] = canvas.lighting.placeables;
source = l.lightSource;
ev = source.elevatedvision

sourcePosition = Point3d.fromPointSource(source)


source = _token.vision
sourcePosition = Point3d.fromPointSource(source)

mesh = ev.shadowMesh
mesh = new ShadowWallPointSourceMesh(source)

canvas.stage.addChild(mesh)
canvas.stage.removeChild(mesh)

geomShader = TestGeometryShader.create(sourcePosition);
geomMesh = new ShadowWallPointSourceMesh(source, geomShader)
canvas.stage.addChild(geomMesh)
canvas.stage.removeChild(geomMesh)

ev = source.elevatedvision;

mesh = ev.shadowTerrainMesh
mesh = ev.shadowMesh
mesh = ev.shadowVisionMask
canvas.stage.addChild(mesh)
canvas.stage.removeChild(mesh)

mesh = ev.terrainShadowMesh

dir = mesh.shader.uniforms.uLightDirection
dirV = new PIXI.Point(dir[0], dir[1])

[wall] = canvas.walls.controlled
pt = PIXI.Point.fromObject(wall.A)
projPoint = pt.add(dirV.multiplyScalar(500))
Draw.segment({A: pt, B: projPoint})

pt = PIXI.Point.fromObject(wall.B)
projPoint = pt.add(dirV.multiplyScalar(500))
Draw.segment({A: pt, B: projPoint})


*/

