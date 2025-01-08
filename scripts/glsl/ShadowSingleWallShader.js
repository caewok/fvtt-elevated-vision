/* globals
canvas,
CONFIG,
<<<<<<< Updated upstream
=======
CONST,
foundry,
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
  params["PRECISION_VERTEX"] = PIXI.settings.PRECISION_VERTEX;
=======
  params.PRECISION_VERTEX = PIXI.settings.PRECISION_VERTEX;
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
  await fetchGLSLCode("SingleWallShader_Unsized_Vertex"))
=======
  await fetchGLSLCode("SingleWallShader_Unsized_Vertex")
>>>>>>> Stashed changes
);

const GLSL_UNSIZED_FRAGMENT = interpolate(
  await fetchGLSLCode("SingleWallShader_Unsized_Fragment")
);

const GLSL_DIRECTIONAL_VERTEX = interpolate(
  await fetchGLSLCode("WallShader_Directional_Vertex"),
  { PENUMBRA_VERTEX_FUNCTIONS, PENUMBRA_VERTEX_CALCULATIONS }
);

const GLSL_DIRECTIONAL_FRAGMENT = interpolate(
  await fetchGLSLCode("WallShader_Directional_Fragment"),
  { PENUMBRA_FRAGMENT_FUNCTIONS, PENUMBRA_FRAGMENT_CALCULATIONS }
);

const GLSL_DIRECTIONAL_VERTEX2 = interpolate(
  await fetchGLSLCode("WallShader_Directional_Vertex2"),
  { PENUMBRA_VERTEX_FUNCTIONS, PENUMBRA_VERTEX_CALCULATIONS }
);

const GLSL_DIRECTIONAL_FRAGMENT2 = interpolate(
  await fetchGLSLCode("WallShader_Directional_Fragment2"),
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


/**
 * Draw shadow for wall without shading for penumbra and without the outer penumbra.
 */
export class ShadowSingleWallShader extends AbstractEVShader {
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
    uThresholdRadius2: 0,
    uLightPosition: [0, 0, 0]
  };

  /**
   * Factory function.
   * @param {Point3d} lightPosition
   * @param {object} defaultUniforms    Changes from the default uniforms set here.
   * @returns {ShadowMaskWallShader}
   */
  static create(source, edge, defaultUniforms = {}) {
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
    defaultUniforms.uThresholdRadius2 = this.threshold2Attribute(source, edge);

    const lightPosition = CONFIG.GeometryLib.threeD.Point3d.fromPointSource(source);
    if ( sourceAtCanvasElevation(lightPosition) ) lightPosition.z += 1;
    defaultUniforms.uLightPosition = [...lightPosition];

    return super.create(defaultUniforms);
  }

  /**
   * For threshold edges, determine if threshold applies.
   * @param {Edge} edge
   * @returns {boolean} True if the threshold applies.
   */
  thresholdApplies(source, edge) {
    const sourceType = source.constructor.sourceType;
    return edge.applyThreshold(sourceType, source, source.data.externalRadius);
  }

  /**
   * For threshold edge, get the threshold distance
   * @param {Edge} edge
   * @returns {number}  Distance of the threshold in pixel units, or 0 if none.
   */
  threshold2Attribute(source, edge) {
    if ( !this.thresholdApplies(source, edge) ) return 0;
    const { inside, outside } = this.calculateThresholdAttenuation(source, edge);
    return Math.min(Number.MAX_SAFE_INTEGER, Math.pow(inside + outside, 2)); // Avoid infinity.
  }

  /**
   * Calculate threshold attenuation for an edge.
   * If the edge is not attenuated, inside + outside will be >= source radius.
   * See PointSourcePolygon.prototype.#calculateThresholdAttenuation
   * @param {Edge} edge
   * @returns {{inside: number, outside: number}} The inside and outside portions of the radius
   */
  calculateThresholdAttenuation(source, edge) {
    const sourceType = source.constructor.sourceType;
    const externalRadius = 0;
    const radius = source.radius;
    const origin = source;
    const d = edge.threshold?.[sourceType];
    if ( !d ) return { inside: radius, outside: radius };
    const proximity = edge[sourceType] === CONST.WALL_SENSE_TYPES.PROXIMITY;

    // Find the closest point on the threshold wall to the source.
    // Calculate the proportion of the source radius that is "inside" and "outside" the threshold wall.
    const pt = foundry.utils.closestPointToSegment(origin, edge.a, edge.b);
    const inside = Math.hypot(pt.x - origin.x, pt.y - origin.y);
    const outside = radius - inside;
    if ( (outside < 0) || outside.almostEqual(0) ) return { inside, outside: 0 };

    // Attenuate the radius outside the threshold wall based on source proximity to the wall.
    const sourceDistance = proximity ? Math.max(inside - externalRadius, 0) : (inside + externalRadius);
    const thresholdDistance = d * canvas.scene.dimensions.distancePixels;
    const percentDistance = sourceDistance / thresholdDistance;
    const pInv = proximity ? 1 - percentDistance : Math.min(1, percentDistance - 1);
    const a = (pInv / (2 * (1 - pInv))) * CONFIG.Wall.thresholdAttenuationMultiplier;
    return { inside, outside: a * thresholdDistance };
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
   * Update based on indicated changes to the edge.
   * @param {Edge} edge
   * @returns {boolean} True if the indicated changes resulted in a change to the shader.
   */
  edgeUpdated(edge) {

  }


  /**
   * Update the wall threshold.
   * @param {number}

  /**
   * Update the light position.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  updateLightPosition(source) {
    const lightPosition = CONFIG.GeometryLib.threeD.Point3d.fromPointSource(source);
    if ( sourceAtCanvasElevation(lightPosition) ) lightPosition.z += 1;
    this.uniforms.uLightPosition = [...lightPosition];
  }
}

/**
 * Draw directional shadow for wall with shading for penumbra and with the outer penumbra.
 * https://www.researchgate.net/publication/266204563_Calculation_of_the_shadow-penumbra_relation_and_its_application_on_efficient_architectural_design
 */
export class DirectionalShadowSingleWallShader extends ShadowSingleWallShader {
  // NOTE: DirectionalShadowWallShader.vertexShader
  /**
   * Vertices are light --> wall corner to intersection on surface.
   * 3 vertices: light, ix for corner 1, ix for corner 2
   * No consideration of penumbra---just light --> corner --> canvas.
   * @type {string}
   */
  static vertexShader = GLSL_DIRECTIONAL_VERTEX2;

  // NOTE: DirectionalShadowWallShader.fragmentShader
  /**
   * Shadow shaders use an encoding for the percentage of light present at the fragment.
   * See lightEncoding.
   * This mask shader is binary: encodes either full light or no light.
   */
  static fragmentShader = GLSL_DIRECTIONAL_FRAGMENT2;

  /**
   * Factory function.
   * @param {Point3d} lightPosition
   * @param {object} defaultUniforms    Changes from the default uniforms set here.
   * @returns {ShadowMaskWallShader}
   */
  static create(source, edge, defaultUniforms = {}) {
    defaultUniforms.uNumSamples = 10; // TODO: Link to config.
    return super.create(source, edge, defaultUniforms);
  }
}

/**
 * Draw shadow from a sized source for wall with shading for penumbra and with the outer penumbra
 * https://www.researchgate.net/publication/266204563_Calculation_of_the_shadow-penumbra_relation_and_its_application_on_efficient_architectural_design
 */
export class SizedPointSourceShadowSingleWallShader extends ShadowSingleWallShader {
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
   * Factory function.
   * @param {Point3d} lightPosition
   * @param {object} defaultUniforms    Changes from the default uniforms set here.
   * @returns {ShadowMaskWallShader}
   */
  static create(source, edge, defaultUniforms = {}) {
    defaultUniforms.uNumSamples = 10; // TODO: Link to config.
    return super.create(source, edge, defaultUniforms);
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

