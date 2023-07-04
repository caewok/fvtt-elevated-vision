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
in float aWallSenseType;
in float aThresholdRadius2;

out vec2 vVertexPosition;
out vec3 vBary;
flat out float fWallSenseType;
flat out float fThresholdRadius2;
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
  // If the light (or token vision) is at canvas elevation, lower the canvas elevation slightly.
  float canvasElevation = uElevationRes.x;
  vec3 planeNormal = vec3(0.0, 0.0, 1.0);
  vec3 planePoint = vec3(0.0, 0.0, canvasElevation);
  Plane canvasPlane = Plane(planePoint, planeNormal);

  // Determine top and bottom wall coordinates at this vertex
  vec2 vertex2d = vertexNum == 1 ? aWallCorner1.xy : aWallCorner2.xy;
  vec3 wallTop = vec3(vertex2d, aWallCorner1.z);
  vec3 wallBottom = vec3(vertex2d, aWallCorner2.z);

  // Light position must be above the canvas floor to get expected shadows.
  vec3 lightPosition = uLightPosition;
  lightPosition.z = max(canvasElevation + 1.0, lightPosition.z);

  // Trim walls to be between light elevation and canvas elevation.
  // If wall top is above or equal to the light, need to approximate an infinite shadow.
  // Cannot just set the ray to the scene maxR, b/c the ray from light --> vertex is
  // different lengths for each vertex. Instead, make wall very slightly lower than light,
  // thus casting a very long shadow.
  float actualWallTop = wallTop.z;
  wallTop.z = min(wallTop.z, lightPosition.z - EV_CONST_INFINITE_SHADOW_OFFSET);
  wallBottom.z = max(wallBottom.z, canvasElevation);

  // Intersect the canvas plane: light --> vertex --> plane
  // We know there is an intersect because we manipulated the wall height.
  Ray rayLT = rayFromPoints(lightPosition, wallTop);
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
      Ray rayLB = rayFromPoints(lightPosition, wallBottom);
      intersectRayPlane(rayLB, canvasPlane, ixNearPenumbra);
      nearRatio = 1.0 - (distance(uLightPosition.xy, ixNearPenumbra.xy) / distShadow);
    }

    // Flat variables.
    // Use actual wall top so that terrain does not poke above a wall that was cut off.
    fWallHeights = vec2(actualWallTop, wallBottom.z);
    fWallRatio = wallRatio;
    fNearRatio = nearRatio;
    fWallSenseType = aWallSenseType;
    fThresholdRadius2 = aThresholdRadius2;
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

// From CONST.WALL_SENSE_TYPES
#define LIMITED_WALL      10.0
#define PROXIMATE_WALL    30.0
#define DISTANCE_WALL     40.0

uniform sampler2D uTerrainSampler;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier
uniform vec4 uSceneDims;
uniform vec3 uLightPosition;

in vec2 vVertexPosition;
in vec3 vBary;

flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in float fWallRatio;
flat in float fNearRatio;
flat in float fWallSenseType;
flat in float fThresholdRadius2;

out vec4 fragColor;

${defineFunction("colorToElevationPixelUnits")}
${defineFunction("between")}
${defineFunction("distanceSquared")}

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
  vec2 nearFarDist = wallRatio - nearFarRatios; // Distance between wall and the near/far canvas intersect as a ratio.
  vec2 heightFractions = elevChange / wallHeights.yx; // Wall bottom, top
  vec2 nfRatios = nearFarRatios + (heightFractions * nearFarDist);
  if ( wallHeights.y == 0.0 ) nfRatios.x = 1.0;
  if ( wallHeights.x == 0.0 ) nfRatios.y = 1.0;
  return nfRatios;
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

  float ltd = fWallSenseType == LIMITED_WALL ? 1.0 : 0.0;
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
//   if ( vBary.x > fWallRatio ) {
//     fragColor = vec4(vBary.x, 0.0, 0.0, 0.8);
//   } else {
//     fragColor = vec4(0.0, vBary.x, 0.0, 0.8);
//   }
//   return;

  // Get the elevation at this fragment.
  float canvasElevation = uElevationRes.x;
  float elevation = terrainElevation();

  // Assume no shadow as the default
  fragColor = noShadow();

  // If elevation is above the light, then shadow.
  // Equal to light elevation should cause shadow, but foundry defaults to lights at elevation 0.
  if ( elevation > uLightPosition.z ) {
    fragColor = lightEncoding(0.0);
    return;
  }

  // If in front of the wall, can return early.
  if ( vBary.x > fWallRatio ) return;

  // If a threshold applies, we may be able to ignore the wall.
  if ( (fWallSenseType == DISTANCE_WALL || fWallSenseType == PROXIMATE_WALL)
    && fThresholdRadius2 != 0.0
    && distanceSquared(vVertexPosition, uLightPosition.xy) < fThresholdRadius2 ) return;

  // If elevation is above the wall, then no shadow.
  if ( elevation > fWallHeights.x ) {
    fragColor = noShadow();
    return;
  }

  // Determine the start and end of the shadow, relative to the light.
  vec2 nearFarShadowRatios = vec2(fNearRatio, 0.0);
  if ( elevation > canvasElevation ) {
    // Elevation change relative the canvas.
    float elevationChange = elevation - canvasElevation;

    // Wall heights relative to the canvas.
    vec2 wallHeights = max(fWallHeights - canvasElevation, 0.0);

    // Adjust the end of the shadows based on terrain height for this fragment.
    nearFarShadowRatios = elevateShadowRatios(nearFarShadowRatios, wallHeights, fWallRatio, elevationChange);
  }

  // If fragment is between the start and end shadow points, then full shadow.
  // If in front of the near shadow or behind the far shadow, then full light.
  // Remember, vBary.x is 1.0 at the light, and 0.0 at the far end of the shadow.
  float nearShadowRatio = nearFarShadowRatios.x;
  float farShadowRatio = nearFarShadowRatios.y;
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
  updateLightPosition(x, y, z) { this.uniforms.uLightPosition = [x, y, z]; }
}

/**
 * Draw directional shadow for wall with shading for penumbra and with the outer penumbra.
 * https://www.researchgate.net/publication/266204563_Calculation_of_the_shadow-penumbra_relation_and_its_application_on_efficient_architectural_design
 */
export class DirectionalShadowWallShader extends AbstractEVShader {
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
in float aWallSenseType;
// Note: no thresholds for walls apply for directional lighting.

out vec2 vVertexPosition;
out vec3 vBary;
out vec3 vSidePenumbra1;
out vec3 vSidePenumbra2;

flat out float fWallSenseType;
flat out vec2 fWallHeights; // r: topZ to canvas bottom; g: bottomZ to canvas bottom
flat out float fWallRatio;
flat out vec3 fNearRatios; // x: penumbra, y: mid-penumbra, z: umbra
flat out vec3 fFarRatios;  // x: penumbra, y: mid-penumbra, z: umbra

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec4 uElevationRes;
uniform vec3 uLightDirection;
uniform float uLightSizeProjected; // Must be greater than or equal to 0.
uniform vec4 uSceneDims;

${defineFunction("normalizeRay")}
${defineFunction("rayFromPoints")}
${defineFunction("intersectRayPlane")}
${defineFunction("lineLineIntersection")}
${defineFunction("barycentric")}

#define EV_CONST_INFINITE_SHADOW_OFFSET   0.01

// Calculate the flat ratios needed for shading the penumbra.
// x: penumbra; y: mid-penumbra; z: umbra
void calculateFlats(in vec2 lightCenter, in vec3 lightDirection, in vec3 outerPenumbra1, in Plane canvasPlane) {
  float canvasElevation = uElevationRes.x;
  float wallBottomZ = max(aWallCorner2.z, canvasElevation);
  float wallTopZ = aWallCorner1.z;
  float distShadow = distance(lightCenter, outerPenumbra1.xy);
  float distShadowInv = 1.0 / distShadow;
  float distWallTop1 = distance(lightCenter, aWallCorner1.xy);
  float lightSizeProjectedUnit = uLightSizeProjected * distShadowInv;

  fWallRatio = 1.0 - (distWallTop1 * distShadowInv); // mid-penumbra
  fNearRatios = vec3(fWallRatio);
  fFarRatios = vec3(lightSizeProjectedUnit * 2.0, lightSizeProjectedUnit, 0.0); // 0.0 is the penumbra value (0 at shadow end)

  if ( wallBottomZ > canvasElevation ) {
    vec3 wallBottom = vec3(aWallCorner1.xy, wallBottomZ);
    vec3 ixNearMidPenumbra;
    Ray rayBottom = Ray(wallBottom, -lightDirection);
    intersectRayPlane(rayBottom, canvasPlane, ixNearMidPenumbra);
    fNearRatios.y = 1.0 - (distance(lightCenter, ixNearMidPenumbra.xy) * distShadowInv);
    fNearRatios.x = fNearRatios.y + lightSizeProjectedUnit;
    fNearRatios.z = fNearRatios.y - lightSizeProjectedUnit;
  }

  fWallHeights = vec2(wallTopZ, wallBottomZ);
  fWallSenseType = aWallSenseType;
}

void main() {
  // Shadow is a trapezoid formed from the intersection of the wall with the
  // triangle ABC, where
  // C is the light position.
  // A is the intersection of the line light --> wall endpointA --> canvas plane
  // B is the intersection of the line light --> wall endpointB --> canvas plane
  // Tricky part for directional lights is the light position.
  // Intersect the canvas from A --> -light direction --> canvas; B --> -dir --> canvas.
  // Shift the point along AB out by uLightSize, then use the shiftedIxA --> A and shiftedIxB --> B
  // to locate a fake light position.
  // Why do this instead of building triangles from the shadow?
  // 1. Would require different geometry
  // 2. Much easier to deal with penumbra shading as a triangle.
  // 3. Would require much different approach to the fragment shader.


  // Define some terms for ease-of-reference.
  float canvasElevation = uElevationRes.x;
  float wallTopZ = aWallCorner1.z;
  float maxR = sqrt(uSceneDims.z * uSceneDims.z + uSceneDims.w * uSceneDims.w) * 2.0;
  float lightSizeProjected = max(uLightSizeProjected, 2.0); // TODO: Why is between 1.0 and 1.5 failing for infinite walls?

  int vertexNum = gl_VertexID % 3;

  // Set the barymetric coordinates for each corner of the triangle.
  vBary = vec3(0.0, 0.0, 0.0);
  vBary[vertexNum] = 1.0;

  // Plane describing the canvas surface at minimum elevation for the scene.
  vec3 planeNormal = vec3(0.0, 0.0, 1.0);
  vec3 planePoint = vec3(0.0, 0.0, canvasElevation);
  Plane canvasPlane = Plane(planePoint, planeNormal);

  // Intersect the canvas plane: light --> vertex --> plane
  // We know there is an intersect b/c we are using direction for the light and direction
  // points up. Ensure this by setting the z component to a positive value.
  // One degree for elevationAngle would be 0.017 rise in z.
  vec3 lightDirection = uLightDirection;
  lightDirection.z = max(lightDirection.z, 1e-06);

  // Find the maximum shadow extent from the top wall corners.
  vec3 wallTop1 = vec3(aWallCorner1.xy, wallTopZ);
  vec3 wallTop2 = vec3(aWallCorner2.xy, wallTopZ);
  Ray rayTop1 = Ray(wallTop1, -lightDirection);
  vec3 ixCanvas1;
  bool ixFound = intersectRayPlane(rayTop1, canvasPlane, ixCanvas1);
  if ( !ixFound || distance(wallTop1.xy, ixCanvas1.xy) > maxR ) {
    ixCanvas1 = wallTop1 - (lightDirection * maxR);
  }

  // Shift out along the wall direction by lightSize. This is the outer penumbra.
  vec3 dir = normalize(wallTop1 - wallTop2);
  vec3 dirSized = dir * lightSizeProjected;
  vec3 outerPenumbra1 = ixCanvas1 + dirSized;

  // Calculate the other penumbra coordinates.
  Ray rayTop2 = Ray(wallTop2, -lightDirection);
  vec3 ixCanvas2;
  ixFound = intersectRayPlane(rayTop2, canvasPlane, ixCanvas2);
  if ( !ixFound || distance(wallTop2.xy, ixCanvas2.xy) > maxR ) {
    ixCanvas2 = wallTop2 - (lightDirection * maxR);
  }

  vec3 outerPenumbra2 = ixCanvas2 - dirSized;

  // Light position is the xy intersection of the ixShift --> wall corner
  vec2 lightCenter;
  lineLineIntersection(outerPenumbra1.xy, wallTop1.xy, outerPenumbra2.xy, wallTop2.xy, lightCenter);

  // Shift inward along the wall direction by lightSize. This is the inner penumbra, then the umbra.
  vec3 innerPenumbra1 = ixCanvas1 - dirSized;
  vec3 innerPenumbra2 = ixCanvas2 + dirSized;

  // Big triangle ABC is the bounds of the potential shadow.
  //   A = lightCenter;
  //   B = outerPenumbra1;
  //   C = outerPenumbra2;

  switch ( vertexNum ) {
    case 0: // Fake light position
      vVertexPosition = lightCenter;
      break;
    case 1:
      vVertexPosition = outerPenumbra1.xy;
      break;
    case 2:
      vVertexPosition = outerPenumbra2.xy;
      calculateFlats(lightCenter, lightDirection, outerPenumbra1, canvasPlane);
      break;
  }

  // Penumbra1 triangle
  vec2 p1A = wallTop1.xy;
  vec2 p1B = outerPenumbra1.xy;
  vec2 p1C = innerPenumbra1.xy;
  vSidePenumbra1 = barycentric(vVertexPosition, p1A, p1B, p1C);

  // Penumbra2 triangle
  vec2 p2A = wallTop2.xy;
  vec2 p2C = innerPenumbra2.xy;
  vec2 p2B = outerPenumbra2.xy;
  vSidePenumbra2 = barycentric(vVertexPosition, p2A, p2B, p2C);

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

// From CONST.WALL_SENSE_TYPES
#define LIMITED_WALL      10.0
#define PROXIMATE_WALL    30.0
#define DISTANCE_WALL     40.0

uniform sampler2D uTerrainSampler;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier
uniform vec4 uSceneDims;
uniform vec3 uLightDirection;

in vec2 vVertexPosition;
in vec3 vBary;
in vec3 vSidePenumbra1;
in vec3 vSidePenumbra2;

flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in float fWallRatio;
flat in vec3 fNearRatios;
flat in vec3 fFarRatios;
flat in float fWallSenseType;

out vec4 fragColor;

${defineFunction("colorToElevationPixelUnits")}
${defineFunction("between")}
${defineFunction("distanceSquared")}
${defineFunction("elevateShadowRatios")}
${defineFunction("linearConversion")}
${defineFunction("barycentricPointInsideTriangle")}

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

  float ltd = fWallSenseType == LIMITED_WALL ? 1.0 : 0.0;
  float ltdInv = 1.0 - ltd;

  vec4 c = vec4((light * ltdInv) + ltd, 1.0 - (0.5 * ltd), (light * ltd) + ltdInv, 1.0);

  #ifdef SHADOW
  // For testing, return the amount of shadow, which can be directly rendered to the canvas.
  // if ( light < 1.0 && light > 0.0 ) return vec4(0.0, 1.0, 0.0, 1.0);

  c = vec4(vec3(0.0), (1.0 - light) * 0.7);
  #endif

  return c;
}

void main() {
  // Assume no shadow as the default
  fragColor = noShadow();

  // If in front of the wall, no shadow.
  if ( vBary.x > fWallRatio ) return;

  // The light position is artificially set to the intersection of the outer two penumbra
  // lines. So all fragment points must be either in a penumbra or in the umbra.
  // (I.e., not possible to be outside the side penumbras.)

  // Get the elevation at this fragment.
  float canvasElevation = uElevationRes.x;
  float elevation = terrainElevation();

  // Determine the start and end of the shadow, relative to the light.
  vec3 nearRatios = fNearRatios;
  vec3 farRatios = fFarRatios;

  if ( elevation > canvasElevation ) {
    // Elevation change relative the canvas.
    float elevationChange = elevation - canvasElevation;

    // Wall heights relative to the canvas.
    vec2 wallHeights = max(fWallHeights - canvasElevation, 0.0); // top, bottom

    // Adjust the near and far shadow borders based on terrain height for this fragment.
    nearRatios = elevateShadowRatios(nearRatios, wallHeights.y, fWallRatio, elevationChange);
    farRatios = elevateShadowRatios(farRatios, wallHeights.x, fWallRatio, elevationChange);
  }

  // If in front of the near shadow or behind the far shadow, then no shadow.
  if ( between(farRatios.z, nearRatios.x, vBary.x) == 0.0 ) return;

  // ----- Calculate percentage of light ----- //

  // Determine if the fragment is within one or more penumbra.
  // x, y, z ==> u, v, w barycentric
  bool inSidePenumbra1 = barycentricPointInsideTriangle(vSidePenumbra1);
  bool inSidePenumbra2 = barycentricPointInsideTriangle(vSidePenumbra2);
  bool inFarPenumbra = vBary.x < farRatios.x; // And vBary.x > 0.0
  bool inNearPenumbra = vBary.x > nearRatios.z; // And vBary.x <= nearRatios.x; handled by in front of wall test.

//   fragColor = vec4(vec3(0.0), 0.8);
//   if ( inSidePenumbra1 || inSidePenumbra2 ) fragColor.r = 1.0;
//   if ( inFarPenumbra ) fragColor.b = 1.0;
//   if ( inNearPenumbra ) fragColor.g = 1.0;
//   return;


  float percentLightSides = 1.0;
  float percentLightFN = 1.0;
  bool inPenumbra = false;
  bool inSidePenumbras = false;
  bool inNearFarPenumbras = false;

  // Blend the two side penumbras if overlapping by multiplying the light amounts.
  if ( inSidePenumbra1 ) {
    float penumbraPercentShadow = vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z);
    percentLightSides = 1.0 - penumbraPercentShadow;
    inPenumbra = true;
    inSidePenumbras = true;
  }

  if ( inSidePenumbra2 ) {
    float penumbraPercentShadow = vSidePenumbra2.z / (vSidePenumbra2.y + vSidePenumbra2.z);
    percentLightSides *= (1.0 - penumbraPercentShadow);
    inPenumbra = true;
    inSidePenumbras = true;
  }

  // Blend the near/far penumbras if overlapping by multiplying the light amounts.
  if ( inFarPenumbra ) {
    bool inLighterPenumbra = vBary.x < farRatios.y;
    float penumbraPercentShadow = inLighterPenumbra
      ? linearConversion(vBary.x, 0.0, farRatios.y, 0.0, 0.5)
      : linearConversion(vBary.x, farRatios.y, farRatios.x, 0.5, 1.0);
    percentLightFN = 1.0 - penumbraPercentShadow;
    inPenumbra = true;
    inNearFarPenumbras = true;
  }

  if ( inNearPenumbra ) {
    bool inLighterPenumbra = vBary.x > nearRatios.y;
    float penumbraPercentShadow = inLighterPenumbra
      ? linearConversion(vBary.x, nearRatios.x, nearRatios.y, 0.0, 0.5)
      : linearConversion(vBary.x, nearRatios.y, nearRatios.z, 0.5, 1.0);
    percentLightFN *= 1.0 - penumbraPercentShadow;
    inPenumbra = true;
    inNearFarPenumbras = true;
  }

  float totalLight = inSidePenumbras && inNearFarPenumbras
    ? max(percentLightSides, percentLightFN) : inPenumbra
    ? (percentLightSides * percentLightFN) : 0.0;
  fragColor = lightEncoding(totalLight);
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
    uLightDirection: [Math.SQRT1_2, 0, Math.SQRT1_2], // 45º elevation rise, due east, normalized
    uLightSizeProjected: 1  // Perceived size of the light source. Must be at least 0 for directional light.
  };

  /**
   * Factory function.
   * @param {Point3d} lightDirection
   * @param {object} defaultUniforms    Changes from the default uniforms set here.
   * @returns {ShadowMaskWallShader}
   */
  static create(lightDirection, defaultUniforms = {}) {
    if ( lightDirection ) {
      const normD = lightDirection.normalize();
      defaultUniforms.uLightDirection = [normD.x, normD.y, normD.z];
    }

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
   * Update the light direction.
   * @param {Point3d} lightDirection
   */
  updateLightDirection(lightDirection) {
    const normD = lightDirection.normalize();
    this.uniforms.uLightDirection = [normD.x, normD.y, normD.z];
  }

  updateProjectedLightSize(lightSizeProjected) { this.uniforms.uLightSizeProjected = lightSizeProjected; }
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

export class ShadowWallDirectionalSourceMesh extends PIXI.Mesh {
  constructor(source, geometry, shader, state, drawMode) {
    geometry ??= source[MODULE_ID]?.wallGeometry ?? new PointSourceShadowWallGeometry(source);
    if ( !shader ) {
      const lightDirection = source.lightDirection;
      const uLightSizeProjected = source.data.lightSizeProjected ?? 0;
      shader = DirectionalShadowWallShader.create(lightDirection, { uLightSizeProjected });
    }

    super(geometry, shader, state, drawMode);
    this.blendMode = PIXI.BLEND_MODES.MULTIPLY;

    /** @type {LightSource} */
    this.source = source;
  }

  /**
   * Update the source position.
   */
  updateLightDirection() {
    const lightDirection = this.source.lightDirection;
    this.shader.updateLightDirection(lightDirection);
  }

  /**
   * Update light projected size.
   */
  updateProjectedLightSize() {
    const lightSizeProjected = this.source.data.lightSizeProjected;
    this.shader.updateProjectedLightSize(lightSizeProjected);
  }
}

/* Testing
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw
api = game.modules.get("elevatedvision").api
PointSourceShadowWallGeometry = api.PointSourceShadowWallGeometry
defineFunction = api.defineFunction;
AbstractEVShader = api.AbstractEVShader
ShadowWallShader = api.ShadowWallShader
ShadowWallPointSourceMesh = api.ShadowWallPointSourceMesh
TestGeometryShader = api.TestGeometryShader
ShadowTextureRenderer = api.ShadowTextureRenderer

let [l] = canvas.lighting.placeables;
l.convertToDirectionalLight()
source = l.source;
ev = source.elevatedvision

sourcePosition = Point3d.fromPointSource(source)


source = _token.vision
sourcePosition = Point3d.fromPointSource(source)


mesh = new ShadowWallPointSourceMesh(source)

canvas.stage.addChild(mesh)
canvas.stage.removeChild(mesh)

geomShader = TestGeometryShader.create(sourcePosition);
geomMesh = new ShadowWallPointSourceMesh(source, geomShader)
canvas.stage.addChild(geomMesh)
canvas.stage.removeChild(geomMesh)

ev = source.elevatedvision;

mesh = ev.shadowMesh
mesh = ev.shadowVisionLOSMesh
canvas.stage.addChild(mesh)
canvas.stage.removeChild(mesh)


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

/*
function barycentric(p, a, b, c) {
  const v0 = b.subtract(a);
  const v1 = c.subtract(a);
  const v2 = p.subtract(a);

  const d00 = v0.dot(v0);
  const d01 = v0.dot(v1);
  const d11 = v1.dot(v1);
  const d20 = v2.dot(v0);
  const d21 = v2.dot(v1);

  const denom = d00 * d11 - d01 * d01;
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1 - v - w;

  return new Point3d(u, v, w);
}

*/

/* Checking the directional math
Plane = CONFIG.GeometryLib.threeD.Plane
mesh = ev.shadowMesh
uLightDirection = mesh.shader.uniforms.uLightDirection
lightDirection = new Point3d(uLightDirection[0], uLightDirection[1], uLightDirection[2])
uSceneDims = mesh.shader.uniforms.uSceneDims
uLightSizeProjected = mesh.shader.uniforms.uLightSizeProjected
lightSizeProjected = Math.max(uLightSizeProjected, 1)
maxR = Math.sqrt(uSceneDims[2] * uSceneDims[2] + uSceneDims[3] * uSceneDims[3]) * 2

canvasPlane = new Plane()
lightDirection.z = Math.max(lightDirection.z, 1e-06)

wallCoords = Point3d.fromWall(wall)
wallCoords.A.top.z = Math.min(wallCoords.A.top.z, 1e06)
wallCoords.B.top.z = Math.min(wallCoords.B.top.z, 1e06)
wallCoords.A.bottom.z = Math.max(wallCoords.A.bottom.z, -1e06)
wallCoords.B.bottom.z = Math.max(wallCoords.B.bottom.z, -1e06)

wallTop1 = wallCoords.A.top;
wallTop2 = wallCoords.B.top

rayTop1 = { origin: wallTop1, direction: lightDirection.multiplyScalar(-1)}
t = canvasPlane.rayIntersection(rayTop1.origin, rayTop1.direction)
ixFarPenumbra1 = rayTop1.origin.projectToward(rayTop1.origin.add(rayTop1.direction), t)

if ( PIXI.Point.distanceBetween(wallTop1, ixFarPenumbra1) > maxR ) {
  ixFarPenumbra1 = wallTop1.subtract(lightDirection.multiplyScalar(maxR))
}

dir = wallTop1.subtract(wallTop2).normalize()
dirSized = dir.multiplyScalar(lightSizeProjected);
outerPenumbra1 = ixFarPenumbra1.add(dirSized);

rayTop2 = { origin: wallTop2, direction: lightDirection.multiplyScalar(-1)}
t = canvasPlane.rayIntersection(rayTop2.origin, rayTop2.direction)
ixFarPenumbra2 = rayTop2.origin.projectToward(rayTop2.origin.add(rayTop2.direction), t)
outerPenumbra2 = ixFarPenumbra2.subtract(dirSized);

lightCenter = foundry.utils.lineLineIntersection(outerPenumbra1, wallTop1, outerPenumbra2, wallTop2)

innerPenumbra1 = ixFarPenumbra1.subtract(dirSized)
innerPenumbra2 = ixFarPenumbra2.add(dirSized)

canvasElevation = mesh.shader.uniforms.uElevationRes[0]
wallBottomZ = Math.max(wallCoords.B.bottom.z, canvasElevation);
wallTopZ = wallCoords.A.top.z;
distShadow = PIXI.Point.distanceBetween(lightCenter, ixFarPenumbra1)
distShadowInv = 1.0 / distShadow;
lightSizeProjectedUnit = uLightSizeProjected * distShadowInv;
distWallTop1 = PIXI.Point.distanceBetween(lightCenter, wallCoords.A.top);
fWallRatio = 1.0 - (distWallTop1 * distShadowInv); // mid-penumbra
fNearRatios = new Point3d(fWallRatio, fWallRatio, fWallRatio)
fFarRatios = new Point3d(lightSizeProjectedUnit * 2.0, lightSizeProjectedUnit, 0.0); // 0.0 is the penumbra value (0 at shadow end)
fWallHeights = { x: wallTopZ, y: wallBottomZ };

vVertexPosition = PIXI.Point.fromObject(lightCenter)
vVertexPosition = outerPenumbra1.to2d()
vVertexPosition = outerPenumbra2.to2d()

// Penumbra1 triangle
p1A = wallTop1.to2d();
p1B = outerPenumbra1.to2d();
p1C = innerPenumbra1.to2d();
vSidePenumbra1 = barycentric(vVertexPosition, p1A, p1B, p1C);

// Penumbra2 triangle
p2A = wallTop2.to2d();
p2C = innerPenumbra2.to2d();
p2B = outerPenumbra2.to2d();
vSidePenumbra2 = barycentric(vVertexPosition, p2A, p2B, p2C);

// ----- Fragment
// Adjust ratios for elevation change
/**
 * @param {Point3d} ratios
 * @param {float} wallHeight
 * @param {float} wallRatio
 * @param {float} elevChange
 * @returns {Point3d}
 */
/*
function elevateShadowRatios(ratios, wallHeight, wallRatio, elevChange) {
  if ( wallHeight == 0.0 ) return ratios;
  const ratiosDist = ratios.subtract(new Point3d(wallRatio, wallRatio, wallRatio)).multiplyScalar(-1) // wallRatio - ratios
  const heightFraction = elevChange / wallHeight;
  return ratios.add(ratiosDist.multiplyScalar(heightFraction))
}

elevationChange = CONFIG.GeometryLib.utils.gridUnitsToPixels(5)
wallHeights = {
  x: Math.max(fWallHeights.x - canvasElevation, 0.0),
  y: Math.max(fWallHeights.y - canvasElevation, 0.0)
}
nearRatios = elevateShadowRatios(fNearRatios, wallHeights.y, fWallRatio, elevationChange)
farRatios = elevateShadowRatios(fFarRatios, wallHeights.x, fWallRatio, elevationChange)

between(farRatios.z, nearRatios.x, .3)

*/

/* intersection

a = { origin: outerPenumbra1, direction: wallTop1.subtract(outerPenumbra1) }
b = { origin: outerPenumbra2, direction: wallTop2.subtract(outerPenumbra2) }

denom = (b.direction.y * a.direction.x) - (b.direction.x * a.direction.y);
diff = a.origin.subtract(b.origin);
t = ((b.direction.x * diff.y) - (b.direction.y * diff.x)) / denom;
ix = a.origin.add(a.direction.multiplyScalar(t));

*/
