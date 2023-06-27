/* globals
canvas,
PIXI
*/
"use strict";

import { MODULE_ID } from "../const.js";
import { Point3d } from "../geometry/3d/Point3d.js";

import { AbstractEVShader } from "./AbstractEVShader.js";
import { defineFunction } from "./GLSLFunctions.js";
import { PointSourceShadowWallGeometry } from "./SourceShadowWallGeometry.js";


export class TestGeometryShader extends AbstractEVShader {
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aWallCorner1;
in vec3 aWallCorner2;

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
    vVertexPosition = aWallCorner1.xy;

  } else if ( vertexNum == 2 ) {
    vVertexPosition = aWallCorner2.xy;
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

    defaultUniforms.uLightPosition = [lightPosition.x, lightPosition.y, lightPosition.z];
    return super.create(defaultUniforms);
  }
}

/**
 * Draw shadow for wall without shading for penumbra and without the outer penumbra.
 */
export class ShadowWallShader extends AbstractEVShader {
  /**
   * Vertices are light --> wall corner to intersection on surface.
   * 3 vertices: light, ix for corner 1, ix for corner 2
   * No consideration of penumbra---just light --> corner --> canvas.
   * @type {string}
   */
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aWallCorner1;
in vec3 aWallCorner2;
in float aLimitedWall;

out vec2 vVertexPosition;
out vec3 vBary;
flat out float fLimitedWall;
flat out vec2 fWallHeights; // r: topZ to canvas bottom; g: bottomZ to canvas bottom
flat out float fWallRatio;
flat out float fNearRatio;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec4 uElevationRes;
uniform vec3 uLightPosition;

${defineFunction("normalizeRay")}
${defineFunction("rayFromPoints")}
${defineFunction("intersectRayPlane")}

#define EV_CONST_INFINITE_SHADOW_OFFSET   0.01

void main() {
  // Shadow is a trapezoid formed from the intersection of the wall with the
  // triangle ABC, where
  // C is the light position.
  // A is the intersection of the line light --> wall endpointA --> canvas plane
  // B is the intersection of the line light --> wall endpointB --> canvas plane
  int vertexNum = gl_VertexID % 3;

  // Set the barymetric coordinates for each corner of the triangle.
  vBary = vec3(0.0, 0.0, 0.0);
  vBary[vertexNum] = 1.0;

  // Vertex 0 is the light; can end early.
  if ( vertexNum == 0 ) {
    vVertexPosition = uLightPosition.xy;
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(vVertexPosition.xy, 1.0)).xy, 0.0, 1.0);
    return;
  }

  // Plane describing the canvas surface at minimum elevation for the scene.
  float canvasElevation = uElevationRes.x;
  vec3 planeNormal = vec3(0.0, 0.0, 1.0);
  vec3 planePoint = vec3(0.0, 0.0, canvasElevation);
  Plane canvasPlane = Plane(planePoint, planeNormal);

  // Determine top and bottom wall coordinates at this vertex
  vec2 vertex2d = vertexNum == 1 ? aWallCorner1.xy : aWallCorner2.xy;
  vec3 wallTop = vec3(vertex2d, aWallCorner1.z);
  vec3 wallBottom = vec3(vertex2d, aWallCorner2.z);

  // Trim walls to be between light elevation and canvas elevation.
  // If wall top is above or equal to the light, need to approximate an infinite shadow.
  // Cannot just set the ray to the scene maxR, b/c the ray from light --> vertex is
  // different lengths for each vertex. Instead, make wall very slightly lower than light,
  // thus casting a very long shadow.
  float actualWallTop = wallTop.z;
  wallTop.z = min(wallTop.z, uLightPosition.z - EV_CONST_INFINITE_SHADOW_OFFSET);
  wallBottom.z = max(wallBottom.z, canvasElevation);

  // Intersect the canvas plane: light --> vertex --> plane
  // We know there is an intersect because we manipulated the wall height.
  Ray rayLT = rayFromPoints(uLightPosition, wallTop);
  vec3 ixFarShadow;
  intersectRayPlane(rayLT, canvasPlane, ixFarShadow);

  // Calculate wall dimensions used in fragment shader.
  if ( vertexNum == 2 ) {
    float distWallTop = distance(uLightPosition.xy, wallTop.xy);
    float distShadow = distance(uLightPosition.xy, ixFarShadow.xy);
    float wallRatio = 1.0 - (distWallTop / distShadow);
    float nearRatio = wallRatio;
    if ( wallBottom.z > canvasElevation ) {
      // Wall bottom floats above the canvas.
      vec3 ixNearPenumbra;
      Ray rayLB = rayFromPoints(uLightPosition, wallBottom);
      intersectRayPlane(rayLB, canvasPlane, ixNearPenumbra);
      nearRatio = 1.0 - (distance(uLightPosition.xy, ixNearPenumbra.xy) / distShadow);
    }

    // Flat variables.
    // Use actual wall top so that terrain does not poke above a wall that was cut off.
    fWallHeights = vec2(actualWallTop, wallBottom.z);
    fWallRatio = wallRatio;
    fNearRatio = nearRatio;
    fLimitedWall = aLimitedWall;
  }

  vVertexPosition = ixFarShadow.xy;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(vVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

  /**
   * Shadow shaders use an encoding for the percentage of light present at the fragment.
   * See lightEncoding.
   * This mask shader is binary: encodes either full light or no light.
   */
  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

// #define SHADOW true

uniform sampler2D uTerrainSampler;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier
uniform vec4 uSceneDims;
uniform vec3 uLightPosition;

in vec2 vVertexPosition;
in vec3 vBary;

flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in float fWallRatio;
flat in float fNearRatio;
flat in float fLimitedWall;

out vec4 fragColor;

${defineFunction("colorToElevationPixelUnits")}
${defineFunction("between")}

/**
 * Get the terrain elevation at this fragment.
 * @returns {float}
 */
float terrainElevation() {
  vec2 evTexCoord = (vVertexPosition.xy - uSceneDims.xy) / uSceneDims.zw;
  float canvasElevation = uElevationRes.x;

  // If outside scene bounds, elevation is set to the canvas minimum.
  if ( !all(lessThan(evTexCoord, vec2(1.0)))
    || !all(greaterThan(evTexCoord, vec2(0.0))) ) return canvasElevation;

  // Inside scene bounds. Pull elevation from the texture.
  vec4 evTexel = texture(uTerrainSampler, evTexCoord);
  return colorToElevationPixelUnits(evTexel);
}

/**
 * Shift the front and end percentages of the wall, relative to the light, based on height
 * of this fragment. Higher fragment elevation means less shadow.
 * @param {vec2} nearFarShadowRatios  The close and far shadow ratios, where far starts at 0.
 * @param {vec2} elevRatio            Elevation change as a percentage of wall bottom/top height from canvas.
 * @returns {vec2} Modified elevation ratio
 */
vec2 elevateShadowRatios(in vec2 nearFarRatios, in vec2 wallHeights, in float wallRatio, in float elevChange) {
  vec2 toWallRatios = wallRatio - nearFarRatios;
  vec2 heightFractions = elevChange / wallHeights.yx;
  return nearFarRatios + (heightFractions * toWallRatios);
}

/**
 * Encode the amount of light in the fragment color to accommodate limited walls.
 * Percentage light is used so 2+ shadows can be multiplied together.
 * For example, if two shadows each block 50% of the light, would expect 25% of light to get through.
 * @param {float} light   Percent of light for this fragment, between 0 and 1.
 * @returns {vec4}
 *   - r: percent light for a non-limited wall fragment
 *   - g: wall type: limited (1.0) or non-limited (0.5) (again, for multiplication: .5 * .5 = .25)
 *   - b: percent light for a limited wall fragment
 *   - a: unused (1.0)
 * @example
 * light = 0.8
 * r: (0.8 * (1. - ltd)) + ltd
 * g: 1. - (0.5 * ltd)
 * b: (0.8 * ltd) + (1. - ltd)
 * limited == 0: 0.8, 1.0, 1.0
 * limited == 1: 1.0, 0.5, 0.8
 *
 * light = 1.0
 * limited == 0: 1.0, 1.0, 1.0
 * limited == 1: 1.0, 0.5, 1.0
 *
 * light = 0.0
 * limited == 0: 0.0, 1.0, 1.0
 * limited == 1: 1.0, 0.5, 0.0
 */

// If not in shadow, need to treat limited wall as non-limited
vec4 noShadow() {
  #ifdef SHADOW
  return vec4(0.0);
  #endif
  return vec4(1.0);
}

vec4 lightEncoding(in float light) {
  if ( light == 1.0 ) return noShadow();

  // float ltd = float(fLimitedWall > 0.5); // If using a varying here.
  float ltd = fLimitedWall;
  float ltdInv = 1.0 - ltd;

  vec4 c = vec4((light * ltdInv) + ltd, 1.0 - (0.5 * ltd), (light * ltd) + ltdInv, 1.0);

  #ifdef SHADOW
  // For testing, return the amount of shadow, which can be directly rendered to the canvas.
  if ( light < 1.0 && light > 0.0 ) return vec4(0.0, 1.0, 0.0, 1.0);

  c = vec4(vec3(0.0), (1.0 - light) * 0.7);
  #endif

  return c;
}



void main() {

  // If in front of the wall, can return early.
  if ( vBary.x > fWallRatio ) {
    fragColor = noShadow();
    return;
  }

  // Get the elevation at this fragment.
  float canvasElevation = uElevationRes.x;
  float elevation = terrainElevation();



  // If elevation is above or equal to the light, then shadow.
  if ( elevation >= uLightPosition.z ) {
    fragColor = lightEncoding(0.0);
    return;
  }

  // If elevation is above the wall, then no shadow.
  if ( elevation > fWallHeights.x ) {
    fragColor = noShadow();
    return;
  }

  // Determine the start and end of the shadow, relative to the light.
  vec2 nearFarShadowRatios = vec2(fNearRatio, 0.0);
  if ( elevation > canvasElevation ) {
    // Calculate the proportional elevation change relative to wall height.
    float elevationChange = elevation - canvasElevation;
    nearFarShadowRatios = elevateShadowRatios(nearFarShadowRatios, max(fWallHeights - canvasElevation, 0.0), fWallRatio, elevationChange);
  }

  // If fragment is between the start and end shadow points, then full shadow.
  // If in front of the near shadow or behind the far shadow, then full light.
  // Remember, vBary.x is 1.0 at the light, and 0.0 at the far end of the shadow.
  float farShadowRatio = nearFarShadowRatios.y;
  float nearShadowRatio = nearFarShadowRatios.x;
  float lightPercentage = 1.0 - between(farShadowRatio, nearShadowRatio, vBary.x);
  fragColor = lightEncoding(lightPercentage);
}`;

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
  static create(lightPosition, defaultUniforms = {}) {
    if ( !lightPosition ) console.error("ShadowMaskWallShader requires a lightPosition.");

    defaultUniforms.uLightPosition = [lightPosition.x, lightPosition.y, lightPosition.z];
    const { sceneRect, distancePixels } = canvas.dimensions;
    defaultUniforms.uSceneDims ??= [
      sceneRect.x,
      sceneRect.y,
      sceneRect.width,
      sceneRect.height
    ];

    const ev = canvas.elevation;
    defaultUniforms.uElevationRes ??= [
      ev.elevationMin,
      ev.elevationStep,
      ev.elevationMax,
      distancePixels
    ];
    defaultUniforms.uTerrainSampler = ev._elevationTexture;
    return super.create(defaultUniforms);
  }

  /**
   * Update the light position.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  updateLightPosition(x, y, z) {
    this.uniforms.uLightPosition = [x, y, z];
  }
}

export class ShadowWallPointSourceMesh extends PIXI.Mesh {
  constructor(source, geometry, shader, state, drawMode) {
    geometry ??= source[MODULE_ID]?.wallGeometry ?? new PointSourceShadowWallGeometry(source);
    if ( !shader ) {
      const sourcePosition = Point3d.fromPointSource(source);
      shader = ShadowWallShader.create(sourcePosition);
    }

    super(geometry, shader, state, drawMode);
    this.blendMode = PIXI.BLEND_MODES.MULTIPLY;

    /** @type {LightSource} */
    this.source = source;
  }

  /**
   * Update the source position.
   */
  updateLightPosition() {
    const { x, y, elevationZ } = this.source;
    this.shader.updateLightPosition(x, y, elevationZ);
  }
}

/* Testing
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get("elevatedvision").api
PointSourceShadowWallGeometry = api.PointSourceShadowWallGeometry
defineFunction = api.defineFunction;
AbstractEVShader = api.AbstractEVShader
ShadowWallShader = api.ShadowWallShader
ShadowWallPointSourceMesh = api.ShadowWallPointSourceMesh
TestGeometryShader = api.TestGeometryShader

let [l] = canvas.lighting.placeables;
source = l.source;
sourcePosition = Point3d.fromPointSource(source)


source = _token.vision
sourcePosition = Point3d.fromPointSource(source)


shader = ShadowWallShader.create(sourcePosition);
mesh = new ShadowWallPointSourceMesh(source, shader)

canvas.stage.addChild(mesh)
canvas.stage.removeChild(mesh)

geomShader = TestGeometryShader.create(sourcePosition);
geomMesh = new ShadowWallPointSourceMesh(source, geomShader)
canvas.stage.addChild(geomMesh)
canvas.stage.removeChild(geomMesh)

*/
