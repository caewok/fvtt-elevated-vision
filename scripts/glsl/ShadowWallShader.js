/* globals
canvas,
CONFIG,
PIXI
*/
"use strict";

import { MODULE_ID } from "../const.js";
import { sourceAtCanvasElevation } from "../util.js";
import { AbstractEVShader } from "./AbstractEVShader.js";
import { defineFunction, defineStruct } from "./GLSLFunctions.js";


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

/**
 * Fetch GLSL code as text.
 * @param {string} fileName     The file name without extension or directory path.
 * @returns {string}
 */
async function fetchGLSLCode(fileName) {
  const resp = await foundry.utils.fetchWithTimeout(`modules/${MODULE_ID}/scripts/glsl/glsl/${fileName}.glsl`);
  return resp.text();
}

/**
 * Limited string replacement so the imported glsl code can be treated as a template literal
 * (without using eval).
 * See https://stackoverflow.com/questions/29182244/convert-a-string-to-a-template-string
 * @param {string} str      String with ${} values to replace
 * @param {object} params   Valid objects that can be replaced; either variables or function names
 * @returns {string}
 */
function interpolate(str, params = {}) {
  // Add in some params that are always used.
  params["PRECISION_VERTEX"] = PIXI.settings.PRECISION_VERTEX;
  params.defineStruct = defineStruct;
  params.defineFunction = defineFunction;

  // Replace the names with the relevant values.
  const names = Object.keys(params);
  const vals = Object.values(params);
  return new Function(...names, `return \`${str}\`;`)(...vals);
}

// NOTE: GLSL Shared functions and calculations.
const PENUMBRA_VERTEX_FUNCTIONS = interpolate(
  await fetchGLSLCode("WallShader_Penumbra_Vertex_Functions")
);

const PENUMBRA_VERTEX_CALCULATIONS = interpolate(
  await fetchGLSLCode("WallShader_Penumbra_Vertex")
);

const PENUMBRA_FRAGMENT_FUNCTIONS = interpolate(
  await fetchGLSLCode("WallShader_Penumbra_Fragment_Functions")
);

const PENUMBRA_FRAGMENT_CALCULATIONS = interpolate(
  await fetchGLSLCode("WallShader_Penumbra_Fragment")
);

// NOTE: GLSL code for each class.
const GLSL_UNSIZED_VERTEX = interpolate(
  await fetchGLSLCode("WallShader_Unsized_Vertex"),
  { PENUMBRA_VERTEX_FUNCTIONS, PENUMBRA_VERTEX_CALCULATIONS }
);

const GLSL_UNSIZED_FRAGMENT = interpolate(
  await fetchGLSLCode("WallShader_Unsized_Fragment"),
  { PENUMBRA_FRAGMENT_FUNCTIONS, PENUMBRA_FRAGMENT_CALCULATIONS }
);
const GLSL_DIRECTIONAL_VERTEX = interpolate(
  await fetchGLSLCode("WallShader_Directional_Vertex"),
  { PENUMBRA_VERTEX_FUNCTIONS, PENUMBRA_VERTEX_CALCULATIONS }
);

const GLSL_DIRECTIONAL_FRAGMENT = interpolate(
  await fetchGLSLCode("WallShader_Directional_Fragment"),
  { PENUMBRA_FRAGMENT_FUNCTIONS, PENUMBRA_FRAGMENT_CALCULATIONS }
);

const GLSL_SIZED_VERTEX = interpolate(
  await fetchGLSLCode("WallShader_Sized_Vertex"),
  { PENUMBRA_VERTEX_FUNCTIONS, PENUMBRA_VERTEX_CALCULATIONS }
);

const GLSL_SIZED_FRAGMENT = interpolate(
  await fetchGLSLCode("WallShader_Sized_Fragment"),
  { PENUMBRA_FRAGMENT_FUNCTIONS, PENUMBRA_FRAGMENT_CALCULATIONS }
);

const GLSL_SIZED_VERTEX2 = interpolate(
  await fetchGLSLCode("WallShader_Sized_Vertex2"),
  { PENUMBRA_VERTEX_FUNCTIONS, PENUMBRA_VERTEX_CALCULATIONS }
);

const GLSL_SIZED_FRAGMENT2 = interpolate(
  await fetchGLSLCode("WallShader_Sized_Fragment2"),
  { PENUMBRA_FRAGMENT_FUNCTIONS, PENUMBRA_FRAGMENT_CALCULATIONS }
);


export class TestGeometryShader extends AbstractEVShader {
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec4 aWallCorner0;
in vec4 aWallCorner1;

out vec2 vVertexPosition;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec3 uLightPosition;

void main() {
  int vertexNum = gl_VertexID % 3;

  // testing
  if ( vertexNum == 0 ) {
    vVertexPosition = uLightPosition.xy;

  } else if ( vertexNum == 1 ) {
    vVertexPosition = aWallCorner0.xy;

  } else if ( vertexNum == 2 ) {
    vVertexPosition = aWallCorner1.xy;
  }

  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(vVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

out vec4 fragColor;

void main() {
  fragColor = vec4(1.0, 0.0, 0.0, 1.0);
  return;
}`;

  static defaultUniforms = {
    uLightPosition: [0, 0, 0]
  };

  /**
   * Factory function.
   * @param {Point3d} lightPosition
   * @param {object} defaultUniforms    Changes from the default uniforms set here.
   * @returns {ShadowMaskWallShader}
   */
  static create(lightPosition, defaultUniforms = {}) {
    if ( !lightPosition ) console.error("ShadowMaskWallShader requires a lightPosition.");
    if ( sourceAtCanvasElevation(lightPosition) ) lightPosition.z += 1;
    defaultUniforms.uLightPosition = [lightPosition.x, lightPosition.y, lightPosition.z];
    return super.create(defaultUniforms);
  }
}

/**
 * Draw shadow for wall without shading for penumbra and without the outer penumbra.
 */
export class ShadowWallShader extends AbstractEVShader {
  // NOTE: ShadowWallShader.vertexShader
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
    uLightPosition: [0, 0, 0]
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
    defaultUniforms.uLightPosition = [lightPosition.x, lightPosition.y, lightPosition.z];
    return super.create(defaultUniforms);
  }

  /**
   * Update based on indicated changes to the source.
   * @param {RenderedSourcePoint} source
   * @param {object} [changes]    Object indicating which properties of the source changed
   * @param {boolean} [changes.changedPosition]   True if the source changed position
   * @param {boolean} [changes.changedElevation]  True if the source changed elevation
   * @returns {boolean} True if the indicated changes resulted in a change to the shader.
   */
  sourceUpdated(source, { changedPosition, changedElevation } = {}) {
    if ( changedPosition || changedElevation ) this.updateLightPosition(source);
    return changedPosition || changedElevation;
  }

  /**
   * Update the light position.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  updateLightPosition(source) {
    const lightPosition = CONFIG.GeometryLib.threeD.Point3d.fromPointSource(source);
    if ( sourceAtCanvasElevation(lightPosition) ) lightPosition.z += 1;
    this.uniforms.uLightPosition = [lightPosition.x, lightPosition.y, lightPosition.z];
  }
}

/**
 * Draw directional shadow for wall with shading for penumbra and with the outer penumbra.
 * https://www.researchgate.net/publication/266204563_Calculation_of_the_shadow-penumbra_relation_and_its_application_on_efficient_architectural_design
 */
export class DirectionalShadowWallShader extends AbstractEVShader {
  // NOTE: DirectionalShadowWallShader.vertexShader
  /**
   * Vertices are light --> wall corner to intersection on surface.
   * 3 vertices: light, ix for corner 1, ix for corner 2
   * No consideration of penumbra---just light --> corner --> canvas.
   * @type {string}
   */
  static vertexShader = GLSL_DIRECTIONAL_VERTEX;

  // NOTE: DirectionalShadowWallShader.fragmentShader
  /**
   * Shadow shaders use an encoding for the percentage of light present at the fragment.
   * See lightEncoding.
   * This mask shader is binary: encodes either full light or no light.
   */
  static fragmentShader = GLSL_DIRECTIONAL_FRAGMENT;

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
    uAzimuth: 0,
    uElevationAngle: Math.toRadians(45),
    uSolarAngle: Math.toRadians(1)   // Must be at least 0.
  };

  /**
   * Factory function.
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

    defaultUniforms.uAzimuth = source.azimuth;
    defaultUniforms.uElevationAngle = source.elevationAngle;
    defaultUniforms.uSolarAngle = source.solarAngle;

    return super.create(defaultUniforms);
  }

  /**
   * Update based on indicated changes to the source.
   * @param {RenderedSourcePoint} source
   * @param {object} [changes]    Object indicating which properties of the source changed
   * @param {boolean} [changes.changedPosition]   True if the source changed position
   * @param {boolean} [changes.changedElevation]  True if the source changed elevation
   * @returns {boolean} True if the indicated changes resulted in a change to the shader.
   */
  sourceUpdated(source, { changedAzimuth, changedElevationAngle, changedSolarAngle } = {}) {
    if ( changedAzimuth ) this.updateAzimuth(source);
    if ( changedElevationAngle ) this.updateElevationAngle(source);
    if ( changedSolarAngle ) this.updateSolarAngle(source);
    return changedAzimuth || changedElevationAngle || changedSolarAngle;
  }

  updateAzimuth(source) { this.uniforms.uAzimuth = source.azimuth; }

  updateElevationAngle(source) { this.uniforms.uElevationAngle = source.elevationAngle; }

  updateSolarAngle(source) { this.uniforms.uSolarAngle = source.solarAngle; }
}

/**
 * Draw shadow from a sized source for wall with shading for penumbra and with the outer penumbra
 * https://www.researchgate.net/publication/266204563_Calculation_of_the_shadow-penumbra_relation_and_its_application_on_efficient_architectural_design
 */
export class SizedPointSourceShadowWallShader extends AbstractEVShader {
  // NOTE: SizedPointSourceShadowWallShader.vertexShader
  /**
   * Wall shadow with side, near, and far penumbra.
   * Vertices are light --> wall corner to intersection on surface.
   * If the light has a size, the intersection is extended based on the size.
   * 3 vertices: light, ix for corner 1, ix for corner 2
   * @type {string}
   */
  static vertexShader = GLSL_SIZED_VERTEX;

  // NOTE: SizedPointSourceShadowWallShader.fragmentShader
  /**
   * Shadow shaders use an encoding for the percentage of light present at the fragment.
   * See lightEncoding.
   * This mask shader is binary: encodes either full light or no light.
   */
  static fragmentShader = GLSL_SIZED_FRAGMENT;

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
    uLightSize: 1,
    uTime: Date.now()
  };

  /**
   * Factory function.
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
    defaultUniforms.uLightPosition = [lightPosition.x, lightPosition.y, lightPosition.z];
    defaultUniforms.uLightSize = source.data.lightSize;

    defaultUniforms.uTime = Date.now();

    return super.create(defaultUniforms);
  }

  /**
   * Update based on indicated changes to the source.
   * @param {RenderedSourcePoint} source
   * @param {object} [changes]    Object indicating which properties of the source changed
   * @param {boolean} [changes.changedPosition]   True if the source changed position
   * @param {boolean} [changes.changedElevation]  True if the source changed elevation
   * @returns {boolean} True if the indicated changes resulted in a change to the shader.
   */
  sourceUpdated(source, { changedPosition, changedElevation, changedLightSize } = {}) {
    if ( changedPosition || changedElevation ) this.updateLightPosition(source);
    if ( changedLightSize ) this.updateLightSize(source);
    return changedPosition || changedElevation || changedLightSize;
  }

  updateLightPosition(source) {
    const lightPosition = CONFIG.GeometryLib.threeD.Point3d.fromPointSource(source);
    if ( sourceAtCanvasElevation(lightPosition) ) lightPosition.z += 1;
    this.uniforms.uLightPosition = [lightPosition.x, lightPosition.y, lightPosition.z];
    this.uniforms.uTime = Date.now();
  }

  updateLightSize(source) {
    this.uniforms.uLightSize = source.data.lightSize;
    this.uniforms.uTime = Date.now();
  }
}

/**
 * Draw shadow from a sized source for wall using light rays in the fragment shader to estimate shadow percentage.
 * https://www.researchgate.net/publication/266204563_Calculation_of_the_shadow-penumbra_relation_and_its_application_on_efficient_architectural_design
 */
export class SizedPointSourceShadowWallShader2 extends AbstractEVShader {
  // NOTE: SizedPointSourceShadowWallShader.vertexShader
  /**
   * Wall shadow with side, near, and far penumbra.
   * Vertices are light --> wall corner to intersection on surface.
   * If the light has a size, the intersection is extended based on the size.
   * 3 vertices: light, ix for corner 1, ix for corner 2
   * @type {string}
   */
  static vertexShader = GLSL_SIZED_VERTEX2;

  // NOTE: SizedPointSourceShadowWallShader.fragmentShader
  /**
   * Shadow shaders use an encoding for the percentage of light present at the fragment.
   * See lightEncoding.
   * This mask shader is binary: encodes either full light or no light.
   */
  static fragmentShader = GLSL_SIZED_FRAGMENT2;

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
    uLightSize: 1,
    uTime: Date.now()
  };

  /**
   * Factory function.
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
    defaultUniforms.uLightPosition = [lightPosition.x, lightPosition.y, lightPosition.z];
    defaultUniforms.uLightSize = source.data.lightSize;

    defaultUniforms.uTime = Date.now();

    return super.create(defaultUniforms);
  }

  /**
   * Update based on indicated changes to the source.
   * @param {RenderedSourcePoint} source
   * @param {object} [changes]    Object indicating which properties of the source changed
   * @param {boolean} [changes.changedPosition]   True if the source changed position
   * @param {boolean} [changes.changedElevation]  True if the source changed elevation
   * @returns {boolean} True if the indicated changes resulted in a change to the shader.
   */
  sourceUpdated(source, { changedPosition, changedElevation, changedLightSize } = {}) {
    if ( changedPosition || changedElevation ) this.updateLightPosition(source);
    if ( changedLightSize ) this.updateLightSize(source);
    return changedPosition || changedElevation || changedLightSize;
  }

  updateLightPosition(source) {
    const lightPosition = CONFIG.GeometryLib.threeD.Point3d.fromPointSource(source);
    if ( sourceAtCanvasElevation(lightPosition) ) lightPosition.z += 1;
    this.uniforms.uLightPosition = [lightPosition.x, lightPosition.y, lightPosition.z];
    this.uniforms.uTime = Date.now();
  }

  updateLightSize(source) {
    this.uniforms.uLightSize = source.data.lightSize;
    this.uniforms.uTime = Date.now();
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

