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

// NOTE: PENUMBRA_VERTEX_FUNCTIONS
const PENUMBRA_VERTEX_FUNCTIONS =
`
${defineStruct("Plane")}

${defineFunction("almostEqual")}
${defineFunction("orient")}
${defineFunction("projectRay")}
${defineFunction("toRadians")}
${defineFunction("angleBetween")}
${defineFunction("toDegrees")}
${defineFunction("wallKeyCoordinates")}
${defineFunction("terrainElevation")}
${defineFunction("normalizedDirection")}
${defineFunction("barycentric")}
${defineFunction("fromAngle")}
${defineFunction("intersectRayPlane")}
${defineFunction("lineLineIntersection")}
${defineFunction("normalizeRay")}

#define EV_ENDPOINT_LINKED_UNBLOCKED  -10.0

// From CONST.WALL_SENSE_TYPES.
#define LIMITED_WALL      10.0
#define PROXIMATE_WALL    30.0
#define DISTANCE_WALL     40.0

// Enumerated parts of the shadow.
#define UMBRA                             0
#define MIDPENUMBRA                       2
#define PENUMBRA                          1
#define TOP                               0
#define BOTTOM                            1
#define FAR                               0
#define NEAR                              1

// Structs to simplify the data organization.

/** Representation of a Foundry wall */
struct Wall {
  vec3[2] top;
  vec3[2] bottom;
};

/** Represent the three directions of a shadow from a wall endpoint. */
struct ShadowDirections {
  vec3 umbra;
  vec3 midpenumbra;
  vec3 penumbra;
};

/** Represent the three directions of a shadow from a wall endpoint in 2d. */
struct ShadowDirections2d {
  vec2 umbra;
  vec2 midpenumbra;
  vec2 penumbra;
};

/**
 * Determine the four points of the wall and its properties.
 */
Wall calculateWallPositions() {
  vec3 aTop = vec3(aWallCorner0.x, aWallCorner0.y, aWallCorner0.z);
  vec3 bTop = vec3(aWallCorner1.x, aWallCorner1.y, aWallCorner0.z);
  vec3 aBottom = vec3(aWallCorner0.x, aWallCorner0.y, aWallCorner1.z);
  vec3 bBottom = vec3(aWallCorner1.x, aWallCorner1.y, aWallCorner1.z);
  return Wall(
    vec3[2](aTop, bTop),
    vec3[2](aBottom, bBottom)
  );
}

/**
 * Determine the barymetric coordinates of a point for a given triangle.
 */
vec3 baryForPoint(vec2 pt, vec2[3] tri) {
  return barycentric(pt, tri[0], tri[1], tri[2]);
}

/**
 * Does this light/wall combination cast a near shadow?
 * True only if the wall is "floating" above the canvas elevation.
 */
bool hasNearShadows() {
  float canvasElevation = uElevationRes.x;
  float wallBottomZ = aWallCorner1.z;
  return wallBottomZ > canvasElevation;
}

/**
 * Minimum canvas plane for this light/wall combination.
 */
Plane constructCanvasPlane() {
  float canvasElevation = uElevationRes.x;
  vec3 planeNormal = vec3(0.0, 0.0, 1.0);
  vec3 planePoint = vec3(0.0, 0.0, canvasElevation);
  return Plane(planePoint, planeNormal);
}

/**
 * For side penumbra directions, determine if they must be moved to address light leakage
 * from linked endpoints.
 * @returns True if not blocked.
 */
bool adjustSideShadowForLinkedEndpoints(inout ShadowDirections2d shadowDirs, in Wall wall, in int idx) {
  vec2 wXY = wall.top[idx].xy; // Wall endpoint from which a penumbra is cast.

  // If no linked wall, full penumbra is used.
  vec2 linkValue = vec2(aWallCorner0.w, aWallCorner1.w);
  float linkAngle = linkValue[idx];
  if ( linkAngle == EV_ENDPOINT_LINKED_UNBLOCKED ) return true;
  // return;

  // Determine orientation relative to the mid-penumbra.
  // 4 quadrants:
  // 1 & 2: linked wall is on opposite side from wall, so it blocks.
  // 3 & 4: linked wall is on same side as light:
  // - 3: Linked wall not between wall and mid: no block (tight "V")
  // - 4: Linked wall between wall and mid
  //     - If umbra - linked - mid-penumbra, adjust umbra direction.
  //     - If umbra - mid - linked - penumbra, umbra set to mid.

  // Point positions.
  vec2 linkPt = fromAngle(wXY, linkAngle, 1.0);
  Ray2d midR = Ray2d(wXY, shadowDirs.midpenumbra);
  vec2 midPt = projectRay(midR, 1.0);

  // Orientation re mid.
  vec2 other = (wall.top[1 - idx]).xy;
  float oMidLink = orient(wXY, midPt, linkPt);
  float oMidWall = orient(wXY, midPt, other);

  // 1 & 2: linked wall blocks light.
  bool linkOppositeWall = oMidWall * oMidLink <= 0.0;
  if ( linkOppositeWall ) {
    shadowDirs.umbra.x = shadowDirs.midpenumbra.x;
    shadowDirs.umbra.y = shadowDirs.midpenumbra.y;
    return false;
  }

  // 3 & 4: Linked wall between wall and mid
  // 3: Linked wall in quadrant with light, not blocking.
  float oLinkWall = orient(wXY, linkPt, other);
  float oLinkMid = orient(wXY, linkPt, midPt);
  bool linkBetweenWallAndMid = oLinkWall * oLinkMid < 0.0;
  if ( !linkBetweenWallAndMid ) return true;

  // 4. possible block.
  // What side of umbra is the linked wall on? If not on the mid-side, it doesn't block.
  Ray2d umbraR = Ray2d(wXY, shadowDirs.umbra);
  vec2 umbraPt = projectRay(umbraR, 1.0);
  float oUmbraLink = orient(wXY, umbraPt, linkPt);
  float oUmbraMid = orient(wXY, umbraPt, midPt);
  bool linkAfterUmbra = oUmbraLink * oUmbraMid > 0.0;
  if ( !linkAfterUmbra ) return true;

  // Linked wall is after umbra, moving toward mid.
  float oMidUmbra = orient(wXY, midPt, umbraPt);

  // Set umbra to the link direction.
  vec2 linkDir = normalizedDirection(wXY, linkPt);
  shadowDirs.umbra.x = linkDir.x;
  shadowDirs.umbra.y = linkDir.y;
  // if ( oMidUmbra * oMidLink > 0.0 ) return true;

  // Linked wall is after mid.
  return true;
}

/**
 * Get the corner that can be used to project a far parallel ray to a wall.
 * Used in penumbraEndpoints to determine the infinite shadow parallel ray.
 */
vec2 directionalCorner(in vec2 direction) {
  const int TL = 0;
  const int TR = 1;
  const int BR = 2;
  const int BL = 3;

  // Ensure the shadow extends to the canvas edges.
  // Set the far parallel to intersect a corner.
  vec2[4] sceneRect;
  sceneRect[TL] = vec2(0.0, 0.0);
  sceneRect[TR] = vec2((uSceneDims.x * 2.0) + uSceneDims.z, 0.0);
  sceneRect[BR] = vec2((uSceneDims.x * 2.0) + uSceneDims.z, (uSceneDims.y * 2.0) + uSceneDims.w);
  sceneRect[BL] = vec2(0.0, (uSceneDims.y * 2.0) + uSceneDims.w);

  // Direction is moving into one of 4 quadrants.
  if ( direction.x > 0.0 ) return direction.y > 0.0 ? sceneRect[BR] : sceneRect[TR];

  // Moving left. x <= 0.
  return direction.y > 0.0 ? sceneRect[BL] : sceneRect[TL];
}

/**
 * Intersect a 3d vector the canvas.
 * @param {Ray} lightRay
 * @param {out vec2} ix   Intersection or the canvas edge point to use instead.
 * @returns {bool} True if there was an actual canvas intersection.
 */
bool canvasIntersection(in Ray lightRay, out vec2 ix) {
  bool infiniteShadow = lightRay.direction.z >= 0.0 || almostEqual(lightRay.direction.z, 0.0, 1e-06); // Ray is rising as it moves from light --> wall.
  if ( infiniteShadow ) {
    ix = directionalCorner(lightRay.direction.xy);
    return false;
  }

  // Plane at the minimum canvas elevation.
  Plane canvasPlane = constructCanvasPlane();
  vec3 canvasIx;
  if ( !intersectRayPlane(lightRay, canvasPlane, canvasIx) ) {
    ix = directionalCorner(lightRay.direction.xy);
    return false;
  }
  ix = canvasIx.xy;
  return true;
}

/**
 * Ray either parallel to the wall or, for infinite shadow, ray through a scene corner
 * perpendicular to the light direction.
 * @param {Wall} wall
 * @param {vec3} lightDir
 * @param {int} far
 * @returns {Ray2d}
 */
Ray2d shadowNearFarRay(in Wall wall, in vec3 lightDir, in int nearFar) {
  // Wall position.
  vec3 wall0 = nearFar == FAR ? wall.top[0] : wall.bottom[0];
  vec3 wall1 = nearFar == FAR ? wall.top[1] : wall.bottom[1];
  vec3 wallMid = (wall0 + wall1) * 0.5;

  // Construct a ray from light --> wall and get the canvas intersection.
  // If this is an infinite light, use the perpendicular to the light ray as the direction.
  Ray lightRay = Ray(wallMid, lightDir);
  vec2 ix;
  vec2 dir = normalizedDirection(wall0.xy, wall1.xy);
  if ( !canvasIntersection(lightRay, ix) ) dir = normalize(vec2(lightDir.y, -lightDir.x));
  return Ray2d(ix, dir);
}

/**
 * Calculate a near or far shadow ratio.
 * @param {Wall} wall
 * @param {vec2[3]} penumbraTri
 * @param {ShadowDirections} shadowDirs
 * @param {int} nearFar
 * @param {int} shadowType
 * @returns {float}
 */
float calculateNearFarRatio(in Wall wall, in vec2[3] penumbraTri, in ShadowDirections shadowDirs, in int nearFar, in int shadowType) {
  vec3 nfDir = shadowType == PENUMBRA ? shadowDirs.penumbra : shadowDirs.umbra;
  Ray2d nfRay = shadowNearFarRay(wall, nfDir, nearFar);
  vec2 ix;
  lineLineIntersection(nfRay, normalizeRay(rayFromPoints(penumbraTri[0], penumbraTri[1])), ix);
  return baryForPoint(ix, penumbraTri).x;
}

/**
 * Calculate the flat variables, including near/far ratios.
 */
void calculateFlatVariables(
  in vec2[3] penumbraTri,
  in Wall wall,
  in ShadowDirections farShadowDirs,
  in ShadowDirections nearShadowDirs,
  in bvec2 hasUmbraShadows) {

  vec3 wTop = wall.top[0];
  vec3 wBottom = wall.bottom[0];

  // Wall top and bottom in the z direction.
  fWallHeights[TOP] = wTop.z;
  fWallHeights[BOTTOM] = wBottom.z;

  // Threshold radius and sense type.
  fWallSenseType = aWallSenseType;
  #ifndef EV_DIRECTIONAL_LIGHT
  fThresholdRadius2 = !(aWallSenseType == DISTANCE_WALL || aWallSenseType == PROXIMATE_WALL)
    ? -1.0 : aThresholdRadius2;
  #endif

  // Location of the wall along the x axis of the barycentric penumbra triangle
  fWallRatio = baryForPoint(wTop.xy, penumbraTri).x;

  // Location of the far umbra intersection. Penumbra intersection is 0.0 by definition.
  fFarRatio = hasUmbraShadows[FAR] ? calculateNearFarRatio(wall, penumbraTri, farShadowDirs, FAR, UMBRA) : 0.0;

  // Location of the near shadow along the x axis of the barycentric penumbra triangle.
  fNearRatios = vec2(fWallRatio); // Near shadow starts at wall unless the wall is "floating."
  float canvasElevation = uElevationRes.x;
  if ( hasNearShadows() ) {
    fNearRatios[PENUMBRA] = calculateNearFarRatio(wall, penumbraTri, nearShadowDirs, NEAR, PENUMBRA );
    fNearRatios[UMBRA] = hasUmbraShadows[NEAR]
      ? calculateNearFarRatio(wall, penumbraTri, nearShadowDirs, NEAR, UMBRA) : fNearRatios[PENUMBRA];
  }
}

`;

// NOTE: PENUMBRA_VERTEX_CALCULATIONS
const PENUMBRA_VERTEX_CALCULATIONS =
`
// Defined constants.
int vertexNum = gl_VertexID % 3;

// Penumbra structures.
// Defined by the subclass (Point or DirectionalLight):
// - @type {Wall} wall
// - @type {bvec2} hasSideShadows
// - @type {vec2[3]} penumbraTri
// - @type {bvec2} hasUmbraShadows
// If has respective side:
// - @type {vec2[3]} side0Tri
// - @type {vec2[3]} side1Tri

// Side shadows.
#ifndef UNSIZED_SOURCE
if ( hasSideShadows[0] ) hasSideShadows[0] = adjustSideShadowForLinkedEndpoints(sideShadowDirs[0], wall, 0);
if ( hasSideShadows[1] ) hasSideShadows[1] = adjustSideShadowForLinkedEndpoints(sideShadowDirs[1], wall, 1);
#endif


// Triangle.
vec2[3] penumbraTri = calculatePenumbraTriangle(wall, sideShadowDirs, farShadowDirs);

#ifndef UNSIZED_SOURCE
vec2[3] sideTri0;
vec2[3] sideTri1;
if ( hasSideShadows[0] ) sideTri0 = calculateSideTriangle(0, penumbraTri, wall, sideShadowDirs, farShadowDirs);
if ( hasSideShadows[1] ) sideTri1 = calculateSideTriangle(1, penumbraTri, wall, sideShadowDirs, farShadowDirs);
#endif

// Location of this vertex.
vVertexPosition = penumbraTri[vertexNum];

// Set barymetric coordinates for each corner of the triangle.
vPenumbra[vertexNum] = 1.0;

// Define side triangles in relation to the penumbra triangle.
vSidePenumbra0 = vec3(-1.0);
vSidePenumbra1 = vec3(-1.0);

// If no real side penumbra, set values to -1 to avoid inclusion.
// Otherwise baryForPoint may return NaN if set to the midpenumbra for linked walls.
#ifndef UNSIZED_SOURCE
if ( hasSideShadows[0] && abs(orient(sideTri0[0], sideTri0[1], sideTri0[2])) > 1.0 ) vSidePenumbra0 = baryForPoint(vVertexPosition, sideTri0);
if ( hasSideShadows[1] && abs(orient(sideTri1[0], sideTri1[1], sideTri1[2])) > 1.0 ) vSidePenumbra1 = baryForPoint(vVertexPosition, sideTri1);
#endif

// Calculate the terrain texture coordinate at this vertex based on scene dimensions.
vTerrainTexCoord = (vVertexPosition - uSceneDims.xy) / uSceneDims.zw;

gl_Position = vec4((projectionMatrix * translationMatrix * vec3(vVertexPosition, 1.0)).xy, 0.0, 1.0);

// Finally, set the flat variables when we hit the last vertex for this triangle.
if ( vertexNum == 2 ) {
  if ( hasUmbraShadows[FAR] ) hasUmbraShadows[FAR] = farShadowDirs.umbra.z < 0.0;
  if ( hasNearShadows() && hasUmbraShadows[NEAR] ) hasUmbraShadows[NEAR] = nearShadowDirs.umbra.z < 0.0;
  calculateFlatVariables(penumbraTri, wall, farShadowDirs, nearShadowDirs, hasUmbraShadows);
}
`;

// NOTE: PENUMBRA_FRAGMENT_FUNCTIONS
const PENUMBRA_FRAGMENT_FUNCTIONS =
`
// From CONST.WALL_SENSE_TYPES.
#define LIMITED_WALL      10.0
#define PROXIMATE_WALL    30.0
#define DISTANCE_WALL     40.0

// Enumerated parts of the shadow.
#define UMBRA                             0
#define MIDPENUMBRA                       2
#define PENUMBRA                          1
#define TOP                               0
#define BOTTOM                            1

${defineFunction("terrainElevation")}
${defineFunction("between")}
${defineFunction("distanceSquared")}
${defineFunction("linearConversion")}
${defineFunction("barycentricPointInsideTriangle")}

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

  #ifdef SHADOW
  // For testing, return the amount of shadow, which can be directly rendered to the canvas.
  // if ( light < 1.0 && light > 0.0 ) return vec4(0.0, 1.0, 0.0, 1.0);
  vec4 c = vec4(vec3(0.0), (1.0 - light) * 0.7);
  #endif

  #ifndef SHADOW
  vec4 c = vec4((light * ltdInv) + ltd, 1.0 - (0.5 * ltd), (light * ltd) + ltdInv, 1.0);
  #endif

  return c;
}

/**
 * Elevate given shadow ratios
 * Use a stored height fraction to avoid repetitive calcs.
 */
float _elevateShadowRatioUsingHeightFraction(in float ratio, in float wallRatio, in float heightFraction) {
  return ratio + (heightFraction * (wallRatio - ratio));
}

/**
 * Calculate the height fraction for elevating shadow ratios.
 */
float _elevationHeightFraction(in float elevation, in float wallHeight) {
  float canvasElevation = uElevationRes.x;
  if ( elevation <= canvasElevation ) return 0.0;

  wallHeight = max(wallHeight - canvasElevation, 0.0);
  if ( wallHeight == 0.0 ) return 0.0;

  float elevationChange = elevation - canvasElevation;
  return elevationChange / wallHeight;
}

/**
 * Is the fragment location in front of the wall?
 */
bool inFrontOfWall() { return vPenumbra.x > fWallRatio; }

/**
 * Does a threshold apply?
 */
bool thresholdApplies() {
  #ifdef EV_DIRECTIONAL_LIGHT
  return false;
  #endif
  #ifndef EV_DIRECTIONAL_LIGHT
  return fThresholdRadius2 != 0.0
    && distanceSquared(vVertexPosition, uLightPosition.xy) < fThresholdRadius2;
  #endif
}
`;

// NOTE: PENUMBRA_FRAGMENT_CALCULATIONS
const PENUMBRA_FRAGMENT_CALCULATIONS =
`
  // Assume no shadow as the default
  fragColor = noShadow();



  // If in front of the wall, no shadow.
  if ( inFrontOfWall() ) return;

  #ifndef EV_DIRECTIONAL_LIGHT
  // If a threshold applies, we may be able to ignore the wall.
  if ( thresholdApplies() ) return;
  #endif

  // For debugging:
  // fragColor = vec4(1.0, 0.0, 0.0, 0.8);
  // return;

  // The light position is artificially set to the intersection of the outer two penumbra
  // lines. So all fragment points must be either in a penumbra or in the umbra.
  // (I.e., not possible to be outside the side penumbras.)

  // Get the elevation at this fragment.
  float canvasElevation = uElevationRes.x;
  float elevation = terrainElevation(uTerrainSampler, vTerrainTexCoord, uElevationRes);

  // Elevate the far penumbra ratio and confirm inclusion.
  float farElevationHeightFraction = _elevationHeightFraction(elevation, fWallHeights[TOP]);
  float farPenumbraRatio = _elevateShadowRatioUsingHeightFraction(0.0, fWallRatio, farElevationHeightFraction);
  if ( vPenumbra.x < farPenumbraRatio ) return;

  // Elevate the near penumbra ratio and confirm inclusion.
  float nearElevationHeightFraction = _elevationHeightFraction(elevation, fWallHeights[BOTTOM]);
  float nearPenumbraRatio = _elevateShadowRatioUsingHeightFraction(fNearRatios[PENUMBRA], fWallRatio, nearElevationHeightFraction);
  if ( vPenumbra.x > nearPenumbraRatio ) return;

  // The point is either in the umbra or in a penumbra.
  // Elevate the umbra ratios.
  float farUmbraRatio = _elevateShadowRatioUsingHeightFraction(fFarRatio, fWallRatio, farElevationHeightFraction);
  float nearUmbraRatio = _elevateShadowRatioUsingHeightFraction(fNearRatios[UMBRA], fWallRatio, nearElevationHeightFraction);

  // Determine the near/far penumbra inclusion.
  bool inFarPenumbra = bool(between(farPenumbraRatio, farUmbraRatio, vPenumbra.x));
  bool inNearPenumbra = bool(between(nearPenumbraRatio, nearUmbraRatio, vPenumbra.x));
  float farShadow = 1.0;
  float nearShadow = 1.0;
  if ( inFarPenumbra ) farShadow = linearConversion(vPenumbra.x, farPenumbraRatio, farUmbraRatio, 0.0, 1.0);
  if ( inNearPenumbra ) nearShadow = linearConversion(vPenumbra.x, nearPenumbraRatio, nearUmbraRatio, 0.0, 1.0);

  // Blend the two side penumbras if overlapping by multiplying the light amounts.
  float side0Shadow = barycentricPointInsideTriangle(vSidePenumbra0) ? vSidePenumbra0.z / (vSidePenumbra0.y + vSidePenumbra0.z) : 1.0;
  float side1Shadow = barycentricPointInsideTriangle(vSidePenumbra1) ? vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z) : 1.0;

  float shadow = side0Shadow * side1Shadow * farShadow * nearShadow;
  float totalLight = clamp(0.0, 1.0, 1.0 - shadow);
  fragColor = lightEncoding(totalLight);
`;


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
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

#define UNSIZED_SOURCE   true

in vec4 aWallCorner0;
in vec4 aWallCorner1;
in float aWallSenseType;
in float aThresholdRadius2;

out vec2 vVertexPosition;
out vec2 vTerrainTexCoord;
out vec3 vPenumbra;
out vec3 vSidePenumbra0;
out vec3 vSidePenumbra1;

flat out float fWallSenseType;
flat out float fThresholdRadius2;
flat out vec2 fWallHeights;
flat out float fWallRatio;
flat out vec2 fNearRatios;
flat out float fFarRatio;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec3 uLightPosition;
uniform vec4 uSceneDims;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier

${defineFunction("normalizedDirection")}

${PENUMBRA_VERTEX_FUNCTIONS}

/**
 * The rays from the wall endpoint along the side.
 * All at midpenumbra b/c no side shadow.
 * @param {int} idx  Which wall endpoint corresponds to this shadow
 * @param {Wall} wall
 * @returns {ShadowDirections2d} Direction from the endpoint away from the light for umbra, mid, and penumbra.
 */
ShadowDirections2d calculateSideShadowDirections(in int idx, in Wall wall) {
  vec2 dir = normalizedDirection(uLightPosition.xy, wall.top[idx].xy);
  return ShadowDirections2d(
    dir, // umbra
    dir, // midpenumbra
    dir  // penumbra
  );
}

/**
 * Direction toward the wall middle, used to measure far umbra line.
 * @param {Wall} wall
 * @param {Light} light
 * @returns {ShadowDirections}
 */
ShadowDirections calculateFarShadowDirections(in Wall wall) {
  vec3 wall0 = wall.top[0];
  vec3 wall1 = wall.top[1];
  vec3 wallMid = (wall0 + wall1) * 0.5;
  vec3 dir = normalizedDirection(uLightPosition, wallMid);
  return ShadowDirections(
    dir, // umbra
    dir, // midpenumbra
    dir  // penumbra
  );
}

/**
 * Direction toward the wall middle, used to measure near umbra line.
 * @param {Wall} wall
 * @param {Light} light
 * @returns {ShadowDirections}
 */
ShadowDirections calculateNearShadowDirections(in Wall wall) {
  vec3 wall0 = wall.bottom[0];
  vec3 wall1 = wall.bottom[1];
  vec3 wallMid = (wall0 + wall1) * 0.5;
  vec3 dir = normalizedDirection(uLightPosition, wallMid);
  return ShadowDirections(
    dir, // umbra
    dir, // midpenumbra
    dir  // penumbra
  );
}

/**
 * Calculate the penumbra triangle
 * @param {Wall} wall
 * @param {ShadowDirections2d[2]} sideShadowDirs
 * @param {ShadowDirections} farShadowDirs
 * @returns {vec2[3]}
 */
vec2[3] calculatePenumbraTriangle(in Wall wall, in ShadowDirections2d[2] sideShadowDirs, in ShadowDirections farShadowDirs) {
  // Intersect the penumbra rays with the line parallel to the wall at the canvas intersection.
  Ray2d farRay = shadowNearFarRay(wall, farShadowDirs.penumbra, FAR);
  vec2 ix0;
  vec2 ix1;
  lineLineIntersection(farRay, Ray2d(uLightPosition.xy, sideShadowDirs[0].penumbra), ix0);
  lineLineIntersection(farRay, Ray2d(uLightPosition.xy, sideShadowDirs[1].penumbra), ix1);
  return vec2[3](
    uLightPosition.xy,
    ix0,
    ix1
  );
}

void main() {
  // Shadow is a trapezoid formed from the intersection of the wall with the
  // triangle ABC, where
  // C is the light position.
  // A is the intersection of the line light --> wall endpointA --> canvas plane
  // B is the intersection of the line light --> wall endpointB --> canvas plane
  Wall wall = calculateWallPositions();
  bvec2 hasSideShadows = bvec2(false, false);  // @type bvec2 for endpoint 0, 1
  bvec2 hasUmbraShadows = bvec2(false, false); // @type bvec2 for FAR, NEAR.

  // Side shadows.
  ShadowDirections2d[2] sideShadowDirs = ShadowDirections2d[2](
    calculateSideShadowDirections(0, wall),
    calculateSideShadowDirections(1, wall)
  );

  // Far shadows.
  ShadowDirections farShadowDirs = calculateFarShadowDirections(wall);

  // Near shadows.
  ShadowDirections nearShadowDirs;
  if ( hasNearShadows() ) nearShadowDirs = calculateNearShadowDirections(wall);

  ${PENUMBRA_VERTEX_CALCULATIONS}
}`;

  // NOTE: ShadowWallShader.fragmentShader
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
uniform vec3 uLightPosition;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier

in vec2 vVertexPosition;
in vec2 vTerrainTexCoord;
in vec3 vPenumbra;
in vec3 vSidePenumbra0;
in vec3 vSidePenumbra1;

flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in float fWallRatio;
flat in vec2 fNearRatios;
flat in float fFarRatio;
flat in float fWallSenseType;
flat in float fThresholdRadius2;

out vec4 fragColor;

${PENUMBRA_FRAGMENT_FUNCTIONS}

void main() {
  ${PENUMBRA_FRAGMENT_CALCULATIONS}
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
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec4 aWallCorner0;
in vec4 aWallCorner1;
in float aWallSenseType;
in float aThresholdRadius2; // Note: no thresholds for walls apply for directional lighting.

out vec2 vVertexPosition;
out vec2 vTerrainTexCoord;
out vec3 vPenumbra;
out vec3 vSidePenumbra0;
out vec3 vSidePenumbra1;

flat out float fWallSenseType;
flat out float fThresholdRadius2;
flat out vec2 fWallHeights;
flat out float fWallRatio;
flat out vec2 fNearRatios;
flat out float fFarRatio;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier
uniform vec4 uSceneDims;
uniform float uAzimuth; // radians
uniform float uElevationAngle; // radians
uniform float uSolarAngle; // radians

#define PI_1_2 1.5707963267948966
#define EV_DIRECTIONAL_LIGHT true

${defineFunction("normalizeRay")}
${defineFunction("rayFromPoints")}
${defineFunction("intersectRayPlane")}
${defineFunction("lineLineIntersection")}
${defineFunction("barycentric")}
${defineFunction("orient")}
${defineFunction("fromAngle")}

${PENUMBRA_VERTEX_FUNCTIONS}

float zChangeForElevationAngle(in float elevationAngle) {
  // elevationAngle = clamp(elevationAngle, 0.0, PI_1_2); // 0� to 90�
  vec2 pt = fromAngle(vec2(0.0), elevationAngle, 1.0);

  // How much z (y) change for every change in x?
  float z = pt.x == 0.0 ? 1e06 : pt.y / pt.x;
  return -z;
  // return max(z, 1e-06); // Don't let z go to 0.
}

/**
 * Determine the change in z for the directional rays.
 */
float[3] _calculateZChangeRays() {
  float solarAngle = max(0.1, uSolarAngle); // TODO: Cannot currently go all the way to 0.

  // Calculate the change in z for the light direction based on differing solar angles.
  float[3] zDelta;
  zDelta[UMBRA] = zChangeForElevationAngle(uElevationAngle + solarAngle); // Light top
  zDelta[MIDPENUMBRA] = zChangeForElevationAngle(uElevationAngle); // Light middle
  zDelta[PENUMBRA] = zChangeForElevationAngle(uElevationAngle - solarAngle); // Light bottom
  return zDelta;
}

/**
 * The rays from the wall endpoint along the side.
 */
ShadowDirections2d calculateSideShadowDirections(in int idx, in Wall wall) {
  float solarAngle = max(0.1, uSolarAngle); // TODO: Cannot currently go all the way to 0.

  // Direction from light to endpoint.
  vec2 dirMidPenumbra = normalize(fromAngle(vec2(0.0), uAzimuth, 1.0) * -1.0);

  // Determine which side of the wall the light is on.
  float oWallLight = sign(orient(wall.top[0].xy, wall.top[1].xy, wall.top[0].xy - dirMidPenumbra));

  // Adjust azimuth by the solarAngle.
  // Determine the direction of the outer penumbra rays from light --> wallCorner1 / wallCorner2.
  // The angle for the penumbra is the azimuth � the solarAngle.
  float solarWallAngle = solarAngle * oWallLight;
  float multiplier = idx == 0 ? 1.0 : -1.0;
  vec2 dirPenumbra = normalize(fromAngle(vec2(0.0), uAzimuth + (solarWallAngle * multiplier), 1.0) * -1.0);
  vec2 dirUmbra = normalize(fromAngle(vec2(0.0), uAzimuth - (solarWallAngle * multiplier), 1.0) * -1.0);

  // Normalize based on the mid penumbra for corner 0
  return ShadowDirections2d(
    dirUmbra, // umbra
    dirMidPenumbra, // midpenumbra
    dirPenumbra // penumbra
  );
}

/**
 * The rays from the wall top endpoint away from the light.
 */
ShadowDirections calculateFarShadowDirections() {
  float[3] zDelta = _calculateZChangeRays();
  vec2 dirMid = fromAngle(vec2(0.0), uAzimuth, 1.0) * -1.0;
  return ShadowDirections(
    normalize(vec3(dirMid.xy, zDelta[UMBRA])), // umbra
    normalize(vec3(dirMid.xy, zDelta[MIDPENUMBRA])), // midpenumbra
    normalize(vec3(dirMid.xy, zDelta[PENUMBRA])) // penumbra
  );
}

/**
 * The rays from the wall bottom endpoint away from the light.
 */
ShadowDirections calculateNearShadowDirections() {
  float[3] zDelta = _calculateZChangeRays();
  vec2 dirMid = fromAngle(vec2(0.0), uAzimuth, 1.0) * -1.0;
  return ShadowDirections(
    normalize(vec3(dirMid.xy, zDelta[PENUMBRA])), // umbra
    normalize(vec3(dirMid.xy, zDelta[MIDPENUMBRA])), // midpenumbra
    normalize(vec3(dirMid.xy, zDelta[UMBRA])) // penumbra
  );
}

/**
 * Calculate the penumbra triangle.
 * @param {Wall} wall
 * @param {ShadowDirections2d[2]} sideShadowDirs
 * @returns {vec2[3]}
 */
vec2[3] calculatePenumbraTriangle(in Wall wall, in ShadowDirections2d[2] sideShadowDirs, in ShadowDirections farShadowDirs) {
  // The penumbra 0 vertex is the point at which the penumbra rays cross.
  vec2 v0;
  lineLineIntersection(
    Ray2d(wall.top[0].xy, sideShadowDirs[0].penumbra),
    Ray2d(wall.top[1].xy, sideShadowDirs[1].penumbra),
    v0);

  // Intersect the penumbra rays with the line parallel to the wall at the canvas intersection.
  Ray2d farRay = shadowNearFarRay(wall, farShadowDirs.penumbra, FAR);
  vec2 ix0;
  vec2 ix1;
  lineLineIntersection(farRay, Ray2d(v0, sideShadowDirs[0].penumbra), ix0);
  lineLineIntersection(farRay, Ray2d(v0, sideShadowDirs[1].penumbra), ix1);
  return vec2[3](
    v0,
    ix0,
    ix1
  );
}

/**
 * Calculate the side triangle.
 * @param {int} idx
 * @param {vec2[3]} penumbraTri
 * @param {Wall} wall
 * @param {ShadowDirections2d[2]} sideShadowDirs
 * @param {ShadowDirections} farShadowDirs
 * @returns {vec2[3]}
 */
vec2[3] calculateSideTriangle(in int idx, in vec2[3] penumbraTri, in Wall wall, in ShadowDirections2d[2] sideShadowDirs, in ShadowDirections farShadowDirs) {
  // For directional lights, the 0 vertex is at the wall endpoint.
  vec2 v0 = wall.top[idx].xy;

  // Intersect the umbra ray with the line parallel to the wall at the canvas intersection.
  Ray2d farRay = shadowNearFarRay(wall, farShadowDirs.umbra, FAR);
  vec2 ix;
  lineLineIntersection(farRay, Ray2d(v0, sideShadowDirs[idx].umbra), ix);
  return vec2[3](
    v0,
    ix,
    penumbraTri[idx + 1] // The penumbra canvas intersection for endpoint 0 or 1.
  );
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

  Wall wall = calculateWallPositions();
  bvec2 hasSideShadows = bvec2(true, true); // @type bvec2 for endpoint 0, 1.

  // Side shadows.
  ShadowDirections2d[2] sideShadowDirs = ShadowDirections2d[2](
    calculateSideShadowDirections(0, wall),
    calculateSideShadowDirections(1, wall)
  );

  // Near/far shadows.
  bvec2 hasUmbraShadows = bvec2(true, true); // @type bvec2 for FAR, NEAR.
  ShadowDirections farShadowDirs = calculateFarShadowDirections();
  ShadowDirections nearShadowDirs;
  if ( hasNearShadows() ) nearShadowDirs = calculateNearShadowDirections();

  ${PENUMBRA_VERTEX_CALCULATIONS}
}`;

  // NOTE: DirectionalShadowWallShader.fragmentShader
  /**
   * Shadow shaders use an encoding for the percentage of light present at the fragment.
   * See lightEncoding.
   * This mask shader is binary: encodes either full light or no light.
   */
  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

// #define SHADOW
#define EV_DIRECTIONAL_LIGHT true

uniform sampler2D uTerrainSampler;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier
uniform vec4 uSceneDims;

in vec2 vVertexPosition;
in vec2 vTerrainTexCoord;
in vec3 vPenumbra;
in vec3 vSidePenumbra0;
in vec3 vSidePenumbra1;

flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in float fWallRatio;
flat in vec2 fNearRatios;
flat in float fFarRatio;
flat in float fWallSenseType;
flat in float fThresholdRadius2;

out vec4 fragColor;

${PENUMBRA_FRAGMENT_FUNCTIONS}

void main() {
  ${PENUMBRA_FRAGMENT_CALCULATIONS}
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
 * Draw directional shadow for wall with shading for penumbra and with the outer penumbra.
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
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec4 aWallCorner0;
in vec4 aWallCorner1;
in float aWallSenseType;
in float aThresholdRadius2;

out vec2 vVertexPosition;
out vec2 vTerrainTexCoord;
out vec3 vPenumbra;
out vec3 vSidePenumbra0;
out vec3 vSidePenumbra1;

flat out float fWallSenseType;
flat out float fThresholdRadius2;
flat out vec2 fWallHeights; // r: topZ to canvas bottom; g: bottomZ to canvas bottom
flat out float fWallRatio;
flat out vec2 fNearRatios;
flat out float fFarRatio;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec4 uElevationRes;
uniform vec3 uLightPosition;
uniform float uLightSize;
uniform vec4 uSceneDims;

${defineFunction("normalizedDirection")}
${defineFunction("normalizeRay")}
${defineStruct("Circle")}
${defineFunction("tangentPoints")}

${PENUMBRA_VERTEX_FUNCTIONS}

/** Representation of a Foundry point source, accounting for its size. Forms a cross or "+". */
struct Light {
  vec3 top;
  vec3 center;
  vec3 bottom;
  vec2[2] penumbra; // Tangent furthest from endpoint (crosses center)
  vec2[2] umbra;    // Tangent nearest to endpoint
};

/**
 * Determine the top, bottom, left, right light positions.
 */
Light calculateLightPositions(in Wall wall) {
  // Wall data.
  vec2 wall0 = wall.top[0].xy;
  vec2 wall1 = wall.top[1].xy;
  vec2 wallMid = (wall0 + wall1) * 0.5;
  vec2 wallDir = normalizedDirection(wall0, wall1);

  // Circle data
  Circle lightCir = Circle(
    uLightPosition.xy, // Center.
    uLightSize // Radius.
  );
  vec2 lr0 = lightCir.center - (wallDir * lightCir.radius);
  vec2 lr1 = lightCir.center + (wallDir * lightCir.radius);

  // For each wall endpoint, determine the tangent points to the circle.
  vec2[2] tangents0 = vec2[2](lightCir.center, lightCir.center);
  vec2[2] tangents1 = vec2[2](lightCir.center, lightCir.center);
  tangentPoints(lightCir, wall0, tangents0);
  tangentPoints(lightCir, wall1, tangents1);

  // If any tangent point is on the wrong side of the wall, replace with the lr0 or lr1.
  // Occurs if the light is very close to the wall.
  /*
  float oLight = orient(wall0, wall1, uLightPosition.xy);
  for ( int i = 0; i < 2; i += 1 ) {
    if ( orient(wall0, wall1, tangents0[i]) * oLight < 0.0 ) continue;
    tangents0[i] = distanceSquared(tangents0[i], lr0) < distanceSquared(tangents0[i], lr1) ? lr0 : lr1;
  }
  for ( int i = 0; i < 2; i += 1 ) {
    if ( orient(wall0, wall1, tangents1[i]) * oLight < 0.0 ) continue;
    tangents1[i] = distanceSquared(tangents1[i], lr0) < distanceSquared(tangents1[i], lr1) ? lr0 : lr1;
  }
  */

  // Determine which side the tangents are on. Penumbra: cross; umbra: same.
  // So penumbra should be inset toward the middle of the wall.
  bool flip0 = orient(lightCir.center, wall0, tangents0[PENUMBRA]) * orient(lightCir.center, wall0, wallMid) < 0.0;
  bool flip1 = orient(lightCir.center, wall1, tangents1[PENUMBRA]) * orient(lightCir.center, wall.top[1].xy, wallMid) < 0.0;
  vec2[2] penumbra = vec2[2](tangents0[PENUMBRA], tangents1[PENUMBRA]);
  vec2[2] umbra = vec2[2](tangents0[UMBRA], tangents1[UMBRA]);
  if ( flip0 ) {
    penumbra[0] = tangents0[UMBRA];
    umbra[0] = tangents0[PENUMBRA];
  }
  if ( flip1 ) {
    penumbra[1] = tangents1[UMBRA];
    umbra[1] = tangents1[PENUMBRA];
  }

  // Form a cross based on the light center.
  float top = uLightPosition.z + uLightSize;
  float bottom = uLightPosition.z - uLightSize;
  return Light(
    vec3(lightCir.center, top),     // top
    uLightPosition,                 // center
    vec3(lightCir.center, bottom),  // bottom
    penumbra,   // Tangent furthest from endpoint (crosses center)
    umbra // Tangent nearest to endpoint
  );
}

/**
 * Direction toward the wall middle, used to measure far umbra line.
 * @param {Wall} wall
 * @param {Light} light
 * @returns {ShadowDirections}
 */
ShadowDirections calculateFarShadowDirections(in Wall wall, in Light light) {
  vec3 wallMid = (wall.top[0] + wall.top[1]) * 0.5;
  return ShadowDirections(
    normalizedDirection(light.top, wallMid), // umbra
    normalizedDirection(light.center, wallMid), // midpenumbra
    normalizedDirection(light.bottom, wallMid) // penumbra
  );
}

/**
 * Direction toward the wall middle, used to measure near umbra line.
 * @param {Wall} wall
 * @param {Light} light
 * @returns {ShadowDirections}
 */
ShadowDirections calculateNearShadowDirections(in Wall wall, in Light light) {
  vec3 wallMid = (wall.bottom[0] + wall.bottom[1]) * 0.5;
  return ShadowDirections(
    normalizedDirection(light.bottom, wallMid), // umbra
    normalizedDirection(light.center, wallMid), // midpenumbra
    normalizedDirection(light.top, wallMid) // penumbra
  );
}

/**
 * @param {int} idx     Which wall endpoint corresponds to this shadow
 * @param {Wall} wall
 * @param {Light} light
 * @returns {ShadowDirections} Direction from the endpoint away from the light for umbra, mid, and penumbra.
 */
ShadowDirections2d calculateSideShadowDirections(in int idx, in Wall wall, in Light light) {
  // Direction from light --> wall endpoint.
  vec2 w = wall.top[idx].xy; // Wall endpoint from which a penumbra is cast.
  return ShadowDirections2d(
    normalizedDirection(light.umbra[idx], w), // umbra
    normalizedDirection(light.center.xy, w), // midpenumbra
    normalizedDirection(light.penumbra[idx], w) // penumbra
  );
}

/**
 * Calculate the penumbra triangle.
 * @param {Wall} wall
 * @param {ShadowDirections2d[2]} sideShadowDirs
 * @param {ShadowDirections} farDirs
 * @returns {vec2[3]}
 */
vec2[3] calculatePenumbraTriangle(in Wall wall, in ShadowDirections2d[2] sideShadowDirs, in ShadowDirections farShadowDirs) {
  // The penumbra 0 vertex is the point at which the penumbra rays cross.
  // Between the wall and the light.
  vec2 v0;
  lineLineIntersection(
    Ray2d(wall.top[0].xy, sideShadowDirs[0].penumbra),
    Ray2d(wall.top[1].xy, sideShadowDirs[1].penumbra),
    v0);

  // Intersect the penumbra rays with the line parallel to the wall at the canvas intersection.
  Ray2d farRay = shadowNearFarRay(wall, farShadowDirs.penumbra, FAR);
  vec2 ix0;
  vec2 ix1;
  lineLineIntersection(farRay, normalizeRay(rayFromPoints(v0, wall.top[0].xy)), ix0);
  lineLineIntersection(farRay, normalizeRay(rayFromPoints(v0, wall.top[1].xy)), ix1);
  return vec2[3](
    v0,
    ix0,
    ix1
  );
}

/**
 * Determine where the umbra 0 vertex is (intersection between umbra for sides).
 * @param {int} idx
 * @param {Wall} wall
 * @param {ShadowDirections2d[2]} sideShadowDirs
 * @returns {vec2}
 */
vec2 umbraIntersectionPoint(in int idx, in Wall wall, in ShadowDirections2d[2] sideShadowDirs) {
  // Intersect either light.umbra with light.penumbra or light.umbra[0] with light.umbra[1].
  // Penumbra go from light side to other wall endpoint; umbra go from light side to same wall endpoint.
  // If the wall is nearly collinear with the light, the vertex may be not at the wall endpoint.
  Ray2d rUmbra = Ray2d(wall.top[idx].xy, sideShadowDirs[idx].umbra);
  Ray2d rOtherPenumbra = Ray2d(wall.top[1 - idx].xy, sideShadowDirs[1 - idx].penumbra);
  float t;
  vec2 ix;
  if ( lineLineIntersection(rUmbra, rOtherPenumbra, t) && t > 0.0 ) ix = projectRay(rUmbra, t);
  else ix = wall.top[idx].xy; // By definition, light.umbra[idx] and light.penumbra[idx] intersect at wall.top[idx].
  return ix;
}

/**
 * Calculate the side triangle.
 * @param {int} idx
 * @param {vec2[3]} penumbraTri
 * @param {Wall} wall
 * @param {ShadowDirections2d[2]} sideShadowDirs
 * @param {ShadowDirections} farShadowDirs
 * @returns {vec2[3]}
 */
vec2[3] calculateSideTriangle(in int idx, in vec2[3] penumbraTri, in Wall wall, in ShadowDirections2d[2] sideShadowDirs, in ShadowDirections farShadowDirs) {
  // The side 0 vertex is the point at which either the penumbra[idx] or umbra[idx -1] ray
  // crosses with the umbra[idx] ray. Typically, the wall.top[idx] endpoint.
  vec2 v0 = umbraIntersectionPoint(idx, wall, sideShadowDirs);

  // Intersect the umbra ray with the line parallel to the wall at the canvas intersection.
  Ray2d farRay = shadowNearFarRay(wall, farShadowDirs.penumbra, FAR);
  vec2 ix;
  lineLineIntersection(farRay, Ray2d(v0, sideShadowDirs[idx].umbra), ix);
  return vec2[3](
    v0,
    ix,
    penumbraTri[idx + 1] // The penumbra canvas intersection for endpoint 0 or 1.
  );
}

void main() {
  // Shadow is a trapezoid formed from the intersection of the wall with the
  // triangle ABC, where
  // C is the light position.
  // A is the intersection of the line light --> wall endpointA --> canvas plane
  // B is the intersection of the line light --> wall endpointB --> canvas plane

  Wall wall = calculateWallPositions();
  Light light = calculateLightPositions(wall);

  // Side shadows.
  bvec2 hasSideShadows = bvec2(true, true); // @type bvec2 for endpoint 0, 1.
  ShadowDirections2d[2] sideShadowDirs = ShadowDirections2d[2](
    calculateSideShadowDirections(0, wall, light),
    calculateSideShadowDirections(1, wall, light)
  );

  // Near/far shadows.
  bvec2 hasUmbraShadows = bvec2(true, true); // @type bvec2 for FAR, NEAR.
  ShadowDirections farShadowDirs = calculateFarShadowDirections(wall, light);
  ShadowDirections nearShadowDirs;
  if ( hasNearShadows() ) nearShadowDirs = calculateNearShadowDirections(wall, light);

  ${PENUMBRA_VERTEX_CALCULATIONS}
}`;

  // NOTE: SizedPointSourceShadowWallShader.fragmentShader
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
uniform vec3 uLightPosition;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier

in vec2 vVertexPosition;
in vec2 vTerrainTexCoord;
in vec3 vPenumbra;
in vec3 vSidePenumbra0;
in vec3 vSidePenumbra1;

flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in float fWallRatio;
flat in vec2 fNearRatios;
flat in float fFarRatio;
flat in float fWallSenseType;
flat in float fThresholdRadius2;

out vec4 fragColor;

${PENUMBRA_FRAGMENT_FUNCTIONS}

void main() {
  ${PENUMBRA_FRAGMENT_CALCULATIONS}
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
    uLightPosition: [0, 0, 0],
    uLightSize: 1
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
  }

  updateLightSize(source) { this.uniforms.uLightSize = source.data.lightSize; }
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

