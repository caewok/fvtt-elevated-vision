/* globals
canvas,
PIXI
*/
"use strict";

import { MODULE_ID } from "../const.js";
import { sourceAtCanvasElevation } from "../util.js";
import { AbstractEVShader } from "./AbstractEVShader.js";
import { defineFunction } from "./GLSLFunctions.js";


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

/*
Variables needed:

#define EV_DIRECTIONAL_LIGHT // Defined if this is a directional light.

// Wall elevation
float wallTopZ;
float wallBottomZ;

// Wall endpoints
vec2 wall2d[2];

// Wall xy direction
vec2 wallDir = normalize(wallTop[0].xy - wallTop[1].xy);


float canvasElevation; // Elevation of the canvas plane.
float maxR; // Maximum distance to consider for a shadow.
int vertexNum; // Which vertex index are we currently processing?


// Directional vectors: light --> wall endpoints

// Z change: light top / middle / bottom
vec3 zChangeLightWallTop;
vec3 zChangeLightWallBottom;

// Light direction that forms outer edges of the side penumbra (left/right light --> endpoint)
vec2 dirOuterSidePenumbra[2];

// Light direction that forms the middle of the side penumbra (center of light --> endpoint)
// Start of the shadow when no penumbra present (light is point source)
vec2 dirMidSidePenumbra[2];

// Light direction that forms inner edges of the shadow (left/right light --> endpoint)
vec2 dirInnerSidePenumbra[2];

*/

/* Testing
function fromAngle(origin, radians, distance) {
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const pt = new PIXI.Point(dx, dy);
  return origin.add(pt.multiplyScalar(distance));
}

function zChangeForElevationAngle(elevationAngle) {
  pt = fromAngle(new PIXI.Point(0, 0), elevationAngle, 1);
  z = pt.x === 0 ? 1.0 : pt.y / pt.x;
  return z;
}


*/

// NOTE: PENUMBRA_VERTEX_FUNCTIONS
const PENUMBRA_VERTEX_FUNCTIONS =
`
${defineFunction("projectRay")}
${defineFunction("toRadians")}
${defineFunction("angleBetween")}
${defineFunction("toDegrees")}
${defineFunction("wallKeyCoordinates")}
${defineFunction("terrainElevation")}

#define EV_ENDPOINT_LINKED_UNBLOCKED  -1.0
#define EV_ENDPOINT_LINKED_CONCAVE    -2.0

float calculateRatio(in vec3 wallEndpoint, in vec3 dir, in vec2 furthestPoint, in Plane canvasPlane, in float maxDist) {
  if ( dir.z >= 0.0 ) return 0.0;
  vec3 ix;
  intersectRayPlane(Ray(wallEndpoint, dir), canvasPlane, ix);

  // If the intersection lies beyond the furthestPoint, that likely means maxR was exceeded.
  // 2d b/c maxDist is the x/y distance from wall endpoint to the furthest point.
  if ( maxDist < distance(ix.xy, wallEndpoint.xy) ) return 0.0;

  return distance(furthestPoint, ix.xy);
}

/**
 * Make sure the vector does not exceed the wall angle (i.e., does not go the "light" side)
 */
void cleanDirectionalVector(inout vec2[2] dirArr, in vec2[2] wall2d, float oWallLight) {
  float oWallPenumbra = sign(orient(wall2d[0], wall2d[1], wall2d[0] + dirArr[0]));
  if ( oWallPenumbra == oWallLight ) dirArr[0] = wall2d[0] - wall2d[1];

  oWallPenumbra = sign(orient(wall2d[0], wall2d[1], wall2d[1] + dirArr[1]));
  if ( oWallPenumbra == oWallLight ) dirArr[1] = wall2d[1] - wall2d[0];

  dirArr[0] = normalize(dirArr[0]);
  dirArr[1] = normalize(dirArr[1]);
}`;

// NOTE: PENUMBRA_VERTEX_CALCULATIONS
const PENUMBRA_VERTEX_CALCULATIONS =
`
// Normalize the directional vectors and ensure they point to the shadow side.
cleanDirectionalVector(dirInnerSidePenumbra, wall2d, oWallLight);
cleanDirectionalVector(dirMidSidePenumbra, wall2d, oWallLight);
cleanDirectionalVector(dirOuterSidePenumbra, wall2d, oWallLight);

// Define some terms for ease-of-reference.
float canvasElevation = uElevationRes.x;
float maxR = sqrt(uSceneDims.z * uSceneDims.z + uSceneDims.w * uSceneDims.w) * 2.0;
int vertexNum = gl_VertexID % 3;

// Set the barymetric coordinates for each corner of the triangle.
vBary = vec3(0.0, 0.0, 0.0);
vBary[vertexNum] = 1.0;

// Plane describing the canvas at elevation.
vec3 planeNormal = vec3(0.0, 0.0, 1.0);
vec3 planePoint = vec3(0.0, 0.0, canvasElevation);
Plane canvasPlane = Plane(planePoint, planeNormal);

vec2 sideUmbra[2];
vec2 sideMidPenumbra[2];
vec2 sidePenumbra[2];

// Determine where the light ray hits the canvas when passing through one of the endpoints.
// This marks the furthest extension of the shadow from the wall.
int closerIdx = 0;
int furtherIdx = 1;
float farLightRayZChange = zChangeLightWallTop.b;
vec3 wall0Top3d = vec3(wall2d[0], wallTopZ);
if ( farLightRayZChange < 0.0 ) {
  vec3 dir = normalize(vec3(dirMidSidePenumbra[0], farLightRayZChange));
  vec3 ixCanvas;
  intersectRayPlane(Ray(wall0Top3d, dir), canvasPlane, ixCanvas);
  sideMidPenumbra[0] = ixCanvas.xy;
} else {
  // Infinite shadow.
  // Use the closer wall endpoint to project the ray from the endpoint a given distance.
  #ifndef EV_DIRECTIONAL_LIGHT
  closerIdx = distanceSquared(uLightPosition.xy, wall2d[0]) < distanceSquared(uLightPosition.xy, wall2d[1]) ? 0 : 1;
  furtherIdx = closerIdx % 2;
  #endif
  Ray2d penumbraCloser = normalizeRay(Ray2d(wall2d[closerIdx], dirMidSidePenumbra[closerIdx]));
  sideMidPenumbra[closerIdx] = projectRay(penumbraCloser, maxR);
}

// Construct a parallel ray to the wall and use that to intersect the further penumbra ray.
Ray2d farParallelRay = Ray2d(sideMidPenumbra[closerIdx], wallDir);
lineLineIntersection(farParallelRay, Ray2d(wall2d[furtherIdx], dirMidSidePenumbra[furtherIdx]), sideMidPenumbra[furtherIdx]);

// Use the parallel ray to intersect the other side penumbra rays.
lineLineIntersection(farParallelRay, Ray2d(wall2d[0], dirOuterSidePenumbra[0]), sidePenumbra[0]);
lineLineIntersection(farParallelRay, Ray2d(wall2d[1], dirOuterSidePenumbra[1]), sidePenumbra[1]);
lineLineIntersection(farParallelRay, Ray2d(wall2d[0], dirInnerSidePenumbra[0]), sideUmbra[0]);
lineLineIntersection(farParallelRay, Ray2d(wall2d[1], dirInnerSidePenumbra[1]), sideUmbra[1]);

// Construct a new light position based on the xy intersection of the outer penumbra points --> wall corner
vec2 newLightCenter;
lineLineIntersection(sidePenumbra[0], wall2d[0], sidePenumbra[1], wall2d[1], newLightCenter);


// Big triangle ABC is the bounds of the potential shadow.
//   A = lightCenter;
//   B = sidePenumbra;
//   C = sidePenumbra;

switch ( vertexNum ) {
  case 0: // Fake light position
    vVertexPosition = newLightCenter;
    break;
  case 1:
    vVertexPosition = sidePenumbra[0];
    break;
  case 2:
    vVertexPosition = sidePenumbra[1];
    break;
}

gl_Position = vec4((projectionMatrix * translationMatrix * vec3(vVertexPosition, 1.0)).xy, 0.0, 1.0);

// If the endpoint is blocking, move the sideUmbra to match the blocking line.
// If the sideUmbra moves past the sidePenumbra, then there will be no penumbra.
// Must orient against the wall and light to get the correct direction
float wallKey0 = aWallCorner0.w;
float wallKey1 = aWallCorner1.w;

#ifndef EV_DIRECTIONAL_LIGHT
bool hasSidePenumbra0 = uLightSize > 0.0;
bool hasSidePenumbra1 = hasSidePenumbra0;
#endif

#ifdef EV_DIRECTIONAL_LIGHT
bool hasSidePenumbra0 = uSolarAngle > 0.0;
bool hasSidePenumbra1 = hasSidePenumbra0;
#endif

hasSidePenumbra0 = hasSidePenumbra0 && wallKey0 != EV_ENDPOINT_LINKED_CONCAVE;
hasSidePenumbra1 = hasSidePenumbra1 && wallKey1 != EV_ENDPOINT_LINKED_CONCAVE;

if ( hasSidePenumbra0 && wallKey0 != EV_ENDPOINT_LINKED_UNBLOCKED ) {
  vec2 linkedPt = wallKeyCoordinates(wallKey0);

  float oUmbraPenumbra = sign(orient(aWallCorner0.xy, sideUmbra[0], sidePenumbra[0]));
  float oUmbraLinked = sign(orient(aWallCorner0.xy, sideUmbra[0], linkedPt));
  float oPenumbraLinked = sign(orient(aWallCorner0.xy, sidePenumbra[0], linkedPt));

  if ( oUmbraPenumbra == oUmbraLinked ) {
    if ( oPenumbraLinked != oUmbraLinked ) {
      // Linked wall goes through the penumbra.
      // Move the umbra to the linked wall.
      vec2 dirLinked = linkedPt - wall2d[0];
      lineLineIntersection(farParallelRay, Ray2d(wall2d[0], dirLinked), sideUmbra[0]);
    } else hasSidePenumbra0 = false; // Linked wall blocks the penumbra.
  }
}

if ( hasSidePenumbra1 && wallKey1 != EV_ENDPOINT_LINKED_UNBLOCKED ) {
  vec2 linkedPt = wallKeyCoordinates(wallKey1);

  float oUmbraPenumbra = sign(orient(aWallCorner1.xy, sideUmbra[1], sidePenumbra[1]));
  float oUmbraLinked = sign(orient(aWallCorner1.xy, sideUmbra[1], linkedPt));
  float oPenumbraLinked = sign(orient(aWallCorner1.xy, sidePenumbra[1], linkedPt));

  if ( oUmbraPenumbra == oUmbraLinked ) {
    if ( oPenumbraLinked != oUmbraLinked ) {
      // Linked wall goes through the penumbra.
      // Move the umbra to the linked wall.
      vec2 dirLinked = linkedPt - wall2d[1];
      lineLineIntersection(farParallelRay, Ray2d(wall2d[1], dirLinked), sideUmbra[1]);
    } else hasSidePenumbra1 = false; // Linked wall blocks the penumbra.
  }
}

vSidePenumbra0 = vec3(1.0, 1.0, 1.0);
if ( hasSidePenumbra0 ) {
  // Penumbra0 triangle
  vec2 p0A = wall2d[0];
  vec2 p0B = sidePenumbra[0];
  vec2 p0C = sideUmbra[0];
  vSidePenumbra0 = barycentric(vVertexPosition, p0A, p0B, p0C);
}

vSidePenumbra1 = vec3(1.0, 1.0, 1.0);
if ( hasSidePenumbra1 ) {
  // Penumbra1 triangle
  vec2 p1A = wall2d[1];
  vec2 p1C = sideUmbra[1];
  vec2 p1B = sidePenumbra[1];
  vSidePenumbra1 = barycentric(vVertexPosition, p1A, p1B, p1C);
}

// Calculate the terrain texture coordinate at this vertex based on scene dimensions.
vTerrainTexCoord = (vVertexPosition.xy - uSceneDims.xy) / uSceneDims.zw;

if ( vertexNum == 2 ) {
  // Calculate flat variables
  fWallCornerLinked = vec2(aWallCorner0.a, aWallCorner1.a);
  fWallHeights = vec2(wallTopZ, wallBottomZ);
  fWallSenseType = aWallSenseType;
  #ifndef EV_DIRECTIONAL_LIGHT
  fThresholdRadius2 = aThresholdRadius2;
  #endif

  // Wall ratio
  float distShadowInv = 1.0 / distance(newLightCenter, sidePenumbra[0]);
  float distWallTop = distance(wall2d[0], sidePenumbra[0]);
  fWallRatio = distWallTop * distShadowInv;

  // Near/far penumbra ratios
  // x: penumbra; y: mid-penumbra; z: umbra
  fNearRatios = vec3(fWallRatio);
  fFarRatios = vec3(0.0);

  // Light center
  vec3 dirTmp = normalize(vec3(dirOuterSidePenumbra[0], zChangeLightWallTop.g));
  fFarRatios.y = distShadowInv * calculateRatio(wall0Top3d, dirTmp, sidePenumbra[0], canvasPlane, distWallTop);

  // Light top
  dirTmp = normalize(vec3(dirOuterSidePenumbra[0], zChangeLightWallTop.r));
  fFarRatios.x = distShadowInv * calculateRatio(wall0Top3d, dirTmp, sidePenumbra[0], canvasPlane, distWallTop);

  if ( wallBottomZ > canvasElevation ) {
    vec3 wall0Bottom3d = vec3(wall2d[0], wallTopZ);

    // Light top
    dirTmp = normalize(vec3(dirOuterSidePenumbra[0], zChangeLightWallBottom.r));
    fNearRatios.x = distShadowInv * calculateRatio(wall0Bottom3d, dirTmp, sidePenumbra[0], canvasPlane, distWallTop);

    // Light center
    dirTmp = normalize(vec3(dirOuterSidePenumbra[0], zChangeLightWallBottom.g));
    fNearRatios.y = distShadowInv * calculateRatio(wall0Bottom3d, dirTmp, sidePenumbra[0], canvasPlane, distWallTop);

    // Light bottom
    dirTmp = normalize(vec3(dirOuterSidePenumbra[0], zChangeLightWallBottom.b));
    fNearRatios.z = distShadowInv * calculateRatio(wall0Bottom3d, dirTmp, sidePenumbra[0], canvasPlane, distWallTop);
  }

}`;

// NOTE: PENUMBRA_FRAGMENT_FUNCTIONS
const PENUMBRA_FRAGMENT_FUNCTIONS =
`
// From CONST.WALL_SENSE_TYPES
#define LIMITED_WALL      10.0
#define PROXIMATE_WALL    30.0
#define DISTANCE_WALL     40.0

${defineFunction("terrainElevation")}
${defineFunction("between")}
${defineFunction("distanceSquared")}
${defineFunction("elevateShadowRatios")}
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

  vec4 c = vec4((light * ltdInv) + ltd, 1.0 - (0.5 * ltd), (light * ltd) + ltdInv, 1.0);

  #ifdef SHADOW
  // For testing, return the amount of shadow, which can be directly rendered to the canvas.
  // if ( light < 1.0 && light > 0.0 ) return vec4(0.0, 1.0, 0.0, 1.0);

  c = vec4(vec3(0.0), (1.0 - light) * 0.7);
  #endif

  return c;
}`;

// NOTE: PENUMBRA_FRAGMENT_CALCULATIONS
const PENUMBRA_FRAGMENT_CALCULATIONS =
// eslint-disable-next-line indent
`
  // Assume no shadow as the default
  fragColor = noShadow();

  // If in front of the wall, no shadow.
  if ( vBary.x > fWallRatio ) return;

//   fragColor = vec4(vBary, 0.8);
//   return;

  #ifndef EV_DIRECTIONAL_LIGHT
  // If a threshold applies, we may be able to ignore the wall.
  if ( (fWallSenseType == DISTANCE_WALL || fWallSenseType == PROXIMATE_WALL)
    && fThresholdRadius2 != 0.0
    && distanceSquared(vVertexPosition, uLightPosition.xy) < fThresholdRadius2 ) return;
  #endif

  // The light position is artificially set to the intersection of the outer two penumbra
  // lines. So all fragment points must be either in a penumbra or in the umbra.
  // (I.e., not possible to be outside the side penumbras.)

  // Get the elevation at this fragment.
  float canvasElevation = uElevationRes.x;
  float elevation = terrainElevation(uTerrainSampler, vTerrainTexCoord, uElevationRes);

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
  bool inSidePenumbra0 = barycentricPointInsideTriangle(vSidePenumbra0);
  bool inSidePenumbra1 = barycentricPointInsideTriangle(vSidePenumbra1);
  bool inFarPenumbra = vBary.x < farRatios.x; // And vBary.x > 0.0
  bool inNearPenumbra = vBary.x > nearRatios.z; // && vBary.x < nearRatios.x; // handled by in front of wall test.

//   For testing
//   if ( !inSidePenumbra0 && !inSidePenumbra1 && !inFarPenumbra && !inNearPenumbra ) fragColor = vec4(1.0, 0.0, 0.0, 1.0);
//   else fragColor = vec4(vec3(0.0), 0.8);
//   return;

  // fragColor = vec4(vec3(0.0), 0.0);
//   if ( inSidePenumbra0 && fWallCornerLinked.x > 0.5 ) fragColor.r = 1.0;
//   if ( inSidePenumbra1 && fWallCornerLinked.y > 0.5 ) fragColor.b = 1.0;

//   if ( inSidePenumbra0 || inSidePenumbra1 ) fragColor.r = 1.0;
//   if ( inFarPenumbra ) fragColor.b = 1.0;
//   if ( inNearPenumbra ) fragColor.g = 1.0;
//   return;

//   if ( inSidePenumbra0 && vSidePenumbra0.z < 0.5 ) fragColor = vec4(1.0, 0.0, 0.0, 0.8);
//   if ( inSidePenumbra1 && vSidePenumbra1.z < 0.5 ) fragColor = vec4(0.0, 0.0, 1.0, 0.8);
//   return;
//
//   // If a corner is linked to another wall, block penumbra light from "leaking" through the linked endpoint.
//   if ( (inSidePenumbra0 && (fWallCornerLinked.x > 0.5)) || (inSidePenumbra1 && (fWallCornerLinked.y > 0.5)) ) {
//     fragColor = lightEncoding(0.0);
//     return;
//   }

//   if ( inSidePenumbra0) fragColor = vec4(vSidePenumbra0, 0.8);
//   if ( inSidePenumbra1 ) fragColor = vec4(vSidePenumbra1, 0.8);
//   return;

  // Blend the two side penumbras if overlapping by multiplying the light amounts.
  float side0Shadow = inSidePenumbra0 ? vSidePenumbra0.z / (vSidePenumbra0.y + vSidePenumbra0.z) : 1.0;
  float side1Shadow = inSidePenumbra1 ? vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z) : 1.0;

  // If a corner is linked to another wall, block penumbra light from "leaking" through the linked endpoint.
  // Directional lights have bigger risk of leakage b/c the direction is the same for each endpoint.
//   #ifdef EV_DIRECTIONAL_LIGHT
//   if ( fWallCornerLinked.x > 0.0 && side0Shadow > (1.0 - fWallCornerLinked.x - 0.1) ) side0Shadow = 1.0;
//   if ( fWallCornerLinked.y > 0.0 && side1Shadow > (1.0 - fWallCornerLinked.y - 0.1) ) side1Shadow = 1.0;
//   #endif
//
//   #ifndef EV_DIRECTIONAL_LIGHT
//   if ( fWallCornerLinked.x > 0.5 && side0Shadow > 0.49 ) side0Shadow = 1.0;
//   if ( fWallCornerLinked.y > 0.5 && side1Shadow > 0.49 ) side1Shadow = 1.0;
//   #endif

//   fragColor = vec4(vec3(0.0), 0.0);
//   if ( inSidePenumbra0 && side0Shadow < 0.5 ) fragColor = vec4(side0Shadow, 0.0, 0.0, 0.8);
//   if ( inSidePenumbra1 && side1Shadow < 0.5 ) fragColor = vec4(0.0, 0.0, side1Shadow, 0.8);
//   return;

  float farShadow = 1.0;
  if ( inFarPenumbra ) {
    bool inLighterPenumbra = vBary.x < farRatios.y;
    farShadow = inLighterPenumbra
      ? linearConversion(vBary.x, 0.0, farRatios.y, 0.0, 0.5)
      : linearConversion(vBary.x, farRatios.y, farRatios.x, 0.5, 1.0);
  }

  float nearShadow = 1.0;
  if ( inNearPenumbra ) {
    bool inLighterPenumbra = vBary.x > nearRatios.y;
    nearShadow = inLighterPenumbra
      ? linearConversion(vBary.x, nearRatios.x, nearRatios.y, 0.0, 0.5)
      : linearConversion(vBary.x, nearRatios.y, nearRatios.z, 0.5, 1.0);
  }

//   fragColor = vec4(vec3(0.0), 0.8);
//   if ( inSidePenumbra0 || inSidePenumbra1 ) fragColor.r = side0Shadow * side1Shadow;
//   if ( inFarPenumbra ) fragColor.b = farShadow;
//   if ( inNearPenumbra ) fragColor.g = nearShadow;
//   return;

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

in vec4 aWallCorner0;
in vec4 aWallCorner1;
in float aWallSenseType;
in float aThresholdRadius2;

out vec2 vVertexPosition;
out vec2 vTerrainTexCoord;
out vec3 vBary;
flat out float fWallSenseType;
flat out float fThresholdRadius2;
flat out vec2 fWallHeights; // r: topZ to canvas bottom; g: bottomZ to canvas bottom
flat out float fWallRatio;
flat out float fNearRatio;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec3 uLightPosition;
uniform vec4 uSceneDims;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier

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
    vTerrainTexCoord = (vVertexPosition.xy - uSceneDims.xy) / uSceneDims.zw;
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(vVertexPosition.xy, 1.0)).xy, 0.0, 1.0);
    return;
  }

  // Plane describing the canvas surface at minimum elevation for the scene.
  float canvasElevation = uElevationRes.x;
  vec3 planeNormal = vec3(0.0, 0.0, 1.0);
  vec3 planePoint = vec3(0.0, 0.0, canvasElevation);
  Plane canvasPlane = Plane(planePoint, planeNormal);

  // Determine top and bottom wall coordinates at this vertex
  vec2 vertex2d = vertexNum == 1 ? aWallCorner0.xy : aWallCorner1.xy;
  vec3 wallTop = vec3(vertex2d, aWallCorner0.z);
  vec3 wallBottom = vec3(vertex2d, aWallCorner1.z);

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

  // Calculate the terrain texture coordinate at this vertex based on scene dimensions.
  vTerrainTexCoord = (vVertexPosition.xy - uSceneDims.xy) / uSceneDims.zw;

  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(vVertexPosition, 1.0)).xy, 0.0, 1.0);
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

// From CONST.WALL_SENSE_TYPES
#define LIMITED_WALL      10.0
#define PROXIMATE_WALL    30.0
#define DISTANCE_WALL     40.0

uniform sampler2D uTerrainSampler;
uniform vec3 uLightPosition;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier

in vec2 vVertexPosition;
in vec2 vTerrainTexCoord;
in vec3 vBary;

flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in float fWallRatio;
flat in float fNearRatio;
flat in float fWallSenseType;
flat in float fThresholdRadius2;

out vec4 fragColor;

${defineFunction("terrainElevation")}
${defineFunction("between")}
${defineFunction("distanceSquared")}

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


  // Assume no shadow as the default
  fragColor = noShadow();

  // If elevation is above the light, then shadow.
  // Equal to light elevation should cause shadow, but foundry defaults to lights at elevation 0.
//   if ( elevation > uLightPosition.z ) {
//     fragColor = lightEncoding(0.0);
//     return;
//   }

  // If in front of the wall, can return early.
  if ( vBary.x > fWallRatio ) return;

  // If a threshold applies, we may be able to ignore the wall.
  if ( (fWallSenseType == DISTANCE_WALL || fWallSenseType == PROXIMATE_WALL)
    && fThresholdRadius2 != 0.0
    && distanceSquared(vVertexPosition, uLightPosition.xy) < fThresholdRadius2 ) return;

  // Get the elevation at this fragment.
  float canvasElevation = uElevationRes.x;
  float elevation = terrainElevation(uTerrainSampler, vTerrainTexCoord, uElevationRes);

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
// Note: no thresholds for walls apply for directional lighting.

out vec2 vVertexPosition;
out vec2 vTerrainTexCoord;
out vec3 vBary;
out vec3 vSidePenumbra0;
out vec3 vSidePenumbra1;

flat out float fWallSenseType;
flat out vec2 fWallHeights; // r: topZ to canvas bottom; g: bottomZ to canvas bottom
flat out float fWallRatio;
flat out vec3 fNearRatios; // x: penumbra, y: mid-penumbra, z: umbra
flat out vec3 fFarRatios;  // x: penumbra, y: mid-penumbra, z: umbra
flat out vec2 fWallCornerLinked;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier
uniform vec4 uSceneDims;
uniform float uAzimuth; // radians
uniform float uElevationAngle; // radians
uniform float uSolarAngle; // radians

#define PI_1_2 1.5707963267948966
#define EV_DIRECTIONAL_LIGHT

${defineFunction("normalizeRay")}
${defineFunction("rayFromPoints")}
${defineFunction("intersectRayPlane")}
${defineFunction("lineLineIntersection")}
${defineFunction("barycentric")}
${defineFunction("orient")}
${defineFunction("fromAngle")}

${PENUMBRA_VERTEX_FUNCTIONS}

float zChangeForElevationAngle(in float elevationAngle) {
  // elevationAngle = clamp(elevationAngle, 0.0, PI_1_2); // 0º to 90º
  vec2 pt = fromAngle(vec2(0.0), elevationAngle, 1.0);

  // How much z (y) change for every change in x?
  float z = pt.x == 0.0 ? 1e06 : pt.y / pt.x;
  return -z;
  // return max(z, 1e-06); // Don't let z go to 0.
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


  // TODO: Some dots can appear along the edge of the directional shadows.

  // Define some terms for ease-of-reference.
  float solarAngle = max(0.1, uSolarAngle); // TODO: Cannot currently go all the way to 0.
  // float solarAngle = uSolarAngle;

  // Define wall dimensions.
  float wallTopZ = aWallCorner0.z;
  float wallBottomZ = aWallCorner1.z;
  vec2 wall2d[2] = vec2[2](aWallCorner0.xy, aWallCorner1.xy);
  vec2 wallDir = normalize(aWallCorner0.xy - aWallCorner1.xy);

  // Direction from endpoint toward the light
  vec2 lightDirection2d = normalize(fromAngle(vec2(0.0), uAzimuth, 1.0));

  // Reverse for determining penumbra
  vec2 dirMidSidePenumbra[2] = vec2[2](lightDirection2d * -1.0, lightDirection2d * -1.0);

  // Calculate the change in z for the light direction based on differing solar angles.
  float zFarUmbra = zChangeForElevationAngle(uElevationAngle + solarAngle); // light top
  float zFarMidPenumbra = zChangeForElevationAngle(uElevationAngle); // light middle
  float zFarPenumbra = zChangeForElevationAngle(uElevationAngle - solarAngle); // light bottom

  // Normalize based on the mid penumbra for corner 0
  vec3 zChangeLightWallTop = vec3(
    zFarUmbra, zFarMidPenumbra, zFarPenumbra

//     normalize(vec3(dirMidSidePenumbra[0], zFarUmbra)).z,
//     normalize(vec3(dirMidSidePenumbra[0], zFarMidPenumbra)).z,
//     normalize(vec3(dirMidSidePenumbra[0], zFarPenumbra)).z
  );
  vec3 zChangeLightWallBottom = zChangeLightWallTop;

  // Determine which side of the wall the light is on.
  float oWallLight = sign(orient(wall2d[0], wall2d[1], wall2d[0] + lightDirection2d));

  // Adjust azimuth by the solarAngle.
  // Determine the direction of the outer penumbra rays from light --> wallCorner1 / wallCorner2.
  // The angle for the penumbra is the azimuth ± the solarAngle.
  float solarWallAngle = solarAngle * oWallLight;
  vec2 dirOuterSidePenumbra[2] = vec2[2](
    fromAngle(vec2(0.0), uAzimuth + solarWallAngle, 1.0) * -1.0,
    fromAngle(vec2(0.0), uAzimuth - solarWallAngle, 1.0) * -1.0
  );
  vec2 dirInnerSidePenumbra[2] = vec2[2](dirOuterSidePenumbra[1], dirOuterSidePenumbra[0]);

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
#define EV_DIRECTIONAL_LIGHT

uniform sampler2D uTerrainSampler;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier
uniform vec4 uSceneDims;

in vec2 vVertexPosition;
in vec2 vTerrainTexCoord;
in vec3 vBary;
in vec3 vSidePenumbra0;
in vec3 vSidePenumbra1;

flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in float fWallRatio;
flat in vec3 fNearRatios;
flat in vec3 fFarRatios;
flat in float fWallSenseType;
flat in vec2 fWallCornerLinked;

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
out vec3 vBary;
out vec3 vSidePenumbra0;
out vec3 vSidePenumbra1;

flat out float fWallSenseType;
flat out float fThresholdRadius2;
flat out vec2 fWallHeights; // r: topZ to canvas bottom; g: bottomZ to canvas bottom
flat out float fWallRatio;
flat out vec3 fNearRatios; // x: penumbra, y: mid-penumbra, z: umbra
flat out vec3 fFarRatios;  // x: penumbra, y: mid-penumbra, z: umbra
flat out vec2 fWallCornerLinked;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec4 uElevationRes;
uniform vec3 uLightPosition;
uniform float uLightSize;
uniform vec4 uSceneDims;

#define PI_1_2 1.5707963267948966

${defineFunction("normalizeRay")}
${defineFunction("rayFromPoints")}
${defineFunction("intersectRayPlane")}
${defineFunction("lineLineIntersection")}
${defineFunction("barycentric")}
${defineFunction("orient")}
${defineFunction("fromAngle")}
${defineFunction("distanceSquared")}
${defineFunction("projectRay")}

${PENUMBRA_VERTEX_FUNCTIONS}

float zChangeForElevationAngle(in float elevationAngle) {
  elevationAngle = clamp(elevationAngle, 0.0, PI_1_2); // 0º to 90º
  vec2 pt = fromAngle(vec2(0.0), elevationAngle, 1.0);
  float z = pt.x == 0.0 ? 1.0 : pt.y / pt.x;
  return z;
  // return max(z, 1e-06); // Don't let z go to 0.
}

/**
 * Determine the top, bottom, left, right light positions.
 */
void calculateLightPositions(out vec3 lightLR0, out vec3 lightLR1, out vec3 lightTop, out vec3 lightBottom) {
  vec2 wallDir = normalize(aWallCorner0.xy - aWallCorner1.xy);
  vec2 dir = wallDir * uLightSize;

  // Form a cross based on the light center.
  vec2 lr0 = uLightPosition.xy - dir;
  vec2 lr1 = uLightPosition.xy + dir;
  float top = uLightPosition.z + uLightSize;
  float bottom = uLightPosition.z - uLightSize;
  lightLR0 = vec3(lr0.xy, uLightPosition.z);
  lightLR1 = vec3(lr1.xy, uLightPosition.z);
  lightTop = vec3(uLightPosition.xy, top);
  lightBottom = vec3(uLightPosition.xy, bottom);
}

/**
 * Determine the side penumbra using the light positions.
 */
void calculateSidePenumbraDirections(in vec2 lightLR0, in vec2 lightLR1, out vec2[2] dirInnerSidePenumbra, out vec2[2] dirMidSidePenumbra, out vec2[2] dirOuterSidePenumbra) {
  vec2 wall2d[2] = vec2[2](aWallCorner0.xy, aWallCorner1.xy);

  // Direction from light center --> wall endpoints.
  vec2[2] baseDirection = vec2[2](
    wall2d[0] - uLightPosition.xy,
    wall2d[1] - uLightPosition.xy
  );
  dirMidSidePenumbra = baseDirection;
  dirOuterSidePenumbra = baseDirection;
  dirInnerSidePenumbra = baseDirection;

  // Direction from light LR --> wall endpoints
  // If the endpoint is blocked, don't use the light size. See issue #95.
  // TODO: Can we use additive shading to handle this instead?
  //   i.e., umbra shadow + penumbra shadow near 1 when added together.
  if ( aWallCorner0.w != EV_ENDPOINT_LINKED_CONCAVE ) {
    dirOuterSidePenumbra = vec2[2](
      wall2d[0] - lightLR0,
      wall2d[1] - lightLR1
    );
  }
  if ( aWallCorner1.w != EV_ENDPOINT_LINKED_CONCAVE ) {
    dirInnerSidePenumbra = vec2[2](
      wall2d[0] - lightLR1,
      wall2d[1] - lightLR0
    );
  }
}


void main() {
  // Shadow is a trapezoid formed from the intersection of the wall with the
  // triangle ABC, where
  // C is the light position.
  // A is the intersection of the line light --> wall endpointA --> canvas plane
  // B is the intersection of the line light --> wall endpointB --> canvas plane

  // Define some terms for ease-of-reference.
  //float lightSize = max(1.0, uLightSize); // TODO: Cannot currently go to 0.
  float lightSize = uLightSize;

  // Define wall dimensions.
  float wallTopZ = aWallCorner0.z;
  float wallBottomZ = aWallCorner1.z;
  vec2 wall2d[2] = vec2[2](aWallCorner0.xy, aWallCorner1.xy);
  vec2 wallDir = normalize(aWallCorner0.xy - aWallCorner1.xy);
  vec3 wallBottom0 = vec3(aWallCorner0.xy, wallBottomZ);

  // Determine which side of the wall the light is on.
  float oWallLight = sign(orient(wall2d[0], wall2d[1], uLightPosition.xy));

  // Determine the z change between the light and the wall. light top / middle / bottom
  // Must be the z portion of the normalized vector between the light and the first endpoint.
  vec3 lightSizeVec = vec3(0.0, 0.0, lightSize);
  vec3 dirLightWallTop = aWallCorner0.xyz - uLightPosition;
  vec3 dirLightWallBottom = wallBottom0 - uLightPosition;
  vec3 zChangeLightWallTop = vec3(
    normalize(dirLightWallTop + lightSizeVec).z,
    normalize(dirLightWallTop).z,
    normalize(dirLightWallTop - lightSizeVec).z
  );
  vec3 zChangeLightWallBottom = vec3(
    normalize(dirLightWallBottom + lightSizeVec).z,
    normalize(dirLightWallBottom).z,
    normalize(dirLightWallBottom - lightSizeVec).z
  );

  vec3 lightLR0;
  vec3 lightLR1;
  vec3 lightTop;
  vec3 lightBottom;
  calculateLightPositions(lightLR0, lightLR1, lightTop, lightBottom);

  vec2[2] dirInnerSidePenumbra; // Direction from light LR --> wall endpoints
  vec2[2] dirMidSidePenumbra; // Direction from light center --> wall endpoints
  vec2[2] dirOuterSidePenumbra; // Direction from light LR --> wall endpoints
  calculateSidePenumbraDirections(lightLR0.xy, lightLR1.xy, dirInnerSidePenumbra, dirMidSidePenumbra, dirOuterSidePenumbra);

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
in vec3 vBary;
in vec3 vSidePenumbra0;
in vec3 vSidePenumbra1;

flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in float fWallRatio;
flat in vec3 fNearRatios;
flat in vec3 fFarRatios;
flat in float fWallSenseType;
flat in float fThresholdRadius2;
flat in vec2 fWallCornerLinked;

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

function zChangeForElevationAngle(elevationAngle) {
  // elevationAngle = Math.clamp(elevationAngle, 0, Math.PI_1_2);
  const pt = PIXI.Point.fromAngle(new PIXI.Point(0, 0), elevationAngle, 1.0);

  // How much z (y) change for every change in x?
  const z = pt.x == 0.0 ? 1e06 : pt.y / pt.x;
  return -z;
  // return Math.max(z, 1e-06); // Don't let z go to 0.
}

*/

/* Checking the directional math

// Wall uniforms
wallCoords = Point3d.fromWall(wall)
wallCoords.A.top.z = Math.min(wallCoords.A.top.z, 1e06)
wallCoords.B.top.z = Math.min(wallCoords.B.top.z, 1e06)
wallCoords.A.bottom.z = Math.max(wallCoords.A.bottom.z, -1e06)
wallCoords.B.bottom.z = Math.max(wallCoords.B.bottom.z, -1e06)
aWallCorner0 = wallCoords.A.top
aWallCorner1 = wallCoords.B.bottom

// Other uniforms
let { uSceneDims, uElevationRes, uSolarAngle, uAzimuth, uElevationAngle } = mesh.shader.uniforms
uSceneDims = { x: uSceneDims[0], y: uSceneDims[1], z: uSceneDims[2], w: uSceneDims[3] }
uElevationRes = { x: uElevationRes[0], y: uElevationRes[1], z: uElevationRes[2], w: uElevationRes[3]}

// Define some terms for ease-of-reference.
solarAngle = Math.max(0, uSolarAngle);

// Define wall dimensions.
wallTopZ = aWallCorner0.z;
wallBottomZ = aWallCorner1.z;
wall2d = [aWallCorner0.to2d(), aWallCorner1.to2d()]
wallDir = aWallCorner0.to2d().subtract(aWallCorner1.to2d()).normalize()

// Direction from endpoint toward the light
lightDirection2d = PIXI.Point.fromAngle(new PIXI.Point(0.0), uAzimuth, 1).normalize()

// Reverse for determining penumbra
dirMidSidePenumbra = [lightDirection2d.multiplyScalar(-1), lightDirection2d.multiplyScalar(-1)];

// Testing: draw a ray for this penumbra
Draw.segment({ A: wall2d[0], B: wall2d[0].add(dirMidSidePenumbra[0].multiplyScalar(500))})
Draw.segment({ A: wall2d[1], B: wall2d[1].add(dirMidSidePenumbra[1].multiplyScalar(500))})

// Calculate the change in z for the light direction based on differing solar angles.
zFarUmbra = zChangeForElevationAngle(uElevationAngle + solarAngle); // light top
zFarMidPenumbra = zChangeForElevationAngle(uElevationAngle); // light middle
zFarPenumbra = zChangeForElevationAngle(uElevationAngle - solarAngle); // light bottom

// Normalize based on the mid penumbra for corner 0
zChangeLightWallTop = new Point3d(
  zFarUmbra, zFarMidPenumbra, zFarPenumbra

//   (new Point3d(dirMidSidePenumbra[0].x, dirMidSidePenumbra[0].y, zFarUmbra)).normalize().z,
//   (new Point3d(dirMidSidePenumbra[0].x, dirMidSidePenumbra[0].y, zFarMidPenumbra)).normalize().z,
//   (new Point3d(dirMidSidePenumbra[0].x, dirMidSidePenumbra[0].y, zFarPenumbra)).normalize().z,

);
zChangeLightWallBottom = Point3d.fromObject(zChangeLightWallTop)

// Determine which side of the wall the light is on.
oWallLight = Math.sign(foundry.utils.orient2dFast(wall2d[0], wall2d[1], wall2d[0].add(lightDirection2d)));

// Adjust azimuth by the solarAngle.
// Determine the direction of the outer penumbra rays from light --> wallCorner1 / wallCorner2.
// The angle for the penumbra is the azimuth ± the solarAngle.
solarWallAngle = solarAngle * oWallLight;
dirOuterSidePenumbra = [
  PIXI.Point.fromAngle(new PIXI.Point(0.0), uAzimuth + solarWallAngle, 1.0).multiplyScalar(-1),
  PIXI.Point.fromAngle(new PIXI.Point(0.0), uAzimuth - solarWallAngle, 1.0).multiplyScalar(-1.0)
];

dirInnerSidePenumbra = [
  PIXI.Point.fromObject(dirOuterSidePenumbra[1]),
  PIXI.Point.fromObject(dirOuterSidePenumbra[0])
];


// Test: Draw from endpoint toward canvas for each direction
Draw.segment({ A: wall2d[0], B: wall2d[0].add(dirOuterSidePenumbra[0].multiplyScalar(500))}, { color: Draw.COLORS.orange })
Draw.segment({ A: wall2d[0], B: wall2d[0].add(dirMidSidePenumbra[0].multiplyScalar(500))}, { color: Draw.COLORS.blue })
Draw.segment({ A: wall2d[0], B: wall2d[0].add(dirInnerSidePenumbra[0].multiplyScalar(500))}, { color: Draw.COLORS.red })

Draw.segment({ A: wall2d[1], B: wall2d[1].add(dirOuterSidePenumbra[1].multiplyScalar(500))}, { color: Draw.COLORS.orange })
Draw.segment({ A: wall2d[1], B: wall2d[1].add(dirMidSidePenumbra[1].multiplyScalar(500))}, { color: Draw.COLORS.blue })
Draw.segment({ A: wall2d[1], B: wall2d[1].add(dirInnerSidePenumbra[1].multiplyScalar(500))}, { color: Draw.COLORS.red })
*/


/* Checking the sized math

// Wall uniforms
wallCoords = Point3d.fromWall(wall)
wallCoords.A.top.z = Math.min(wallCoords.A.top.z, 1e06)
wallCoords.B.top.z = Math.min(wallCoords.B.top.z, 1e06)
wallCoords.A.bottom.z = Math.max(wallCoords.A.bottom.z, -1e06)
wallCoords.B.bottom.z = Math.max(wallCoords.B.bottom.z, -1e06)
aWallCorner0 = wallCoords.A.top
aWallCorner1 = wallCoords.B.bottom

// Other uniforms
let { uSceneDims, uElevationRes, uLightSize, uLightPosition } = mesh.shader.uniforms
uSceneDims = { x: uSceneDims[0], y: uSceneDims[1], z: uSceneDims[2], w: uSceneDims[3] }
uElevationRes = { x: uElevationRes[0], y: uElevationRes[1], z: uElevationRes[2], w: uElevationRes[3]}
uLightPosition = new Point3d(uLightPosition[0], uLightPosition[1], uLightPosition[2])

// Define some terms for ease-of-reference.
lightSize = Math.max(0, uLightSize);

// Define wall dimensions.
wallTopZ = aWallCorner0.z;
wallBottomZ = aWallCorner1.z;
wall2d = [aWallCorner0.to2d(), aWallCorner1.to2d()]
wallDir = aWallCorner0.to2d().subtract(aWallCorner1.to2d()).normalize()
wallBottom0 = new Point3d(aWallCorner0.x, aWallCorner0.y, wallBottomZ);

// Determine the z change between the light and the wall. light top / middle / bottom
// Must be the z portion of the normalized vector between the light and the first endpoint.
lightSizeVec = new Point3d(0, 0, lightSize)
dirLightWallTop = aWallCorner0.subtract(uLightPosition);
dirLightWallBottom = wallBottom0.subtract(uLightPosition);
zChangeLightWallTop = {
  x: dirLightWallTop.add(lightSizeVec).normalize().z,
  y: dirLightWallTop.normalize().z,
  z: dirLightWallTop.subtract(lightSizeVec).normalize().z
}

zChangeLightWallBottom = {
  x: dirLightWallBottom.add(lightSizeVec).normalize().z,
  y: dirLightWallBottom.normalize().z,
  z: dirLightWallBottom.subtract(lightSizeVec).normalize().z
}

// Direction from light center --> wall endpoints
dirMidSidePenumbra = [wall2d[0].subtract(uLightPosition.to2d()), wall2d[1].subtract(uLightPosition.to2d())];

// Use wall direction to determine the left/right light points
lightLR0 = uLightPosition.to2d().subtract(wallDir.multiplyScalar(lightSize));
lightLR1 = uLightPosition.to2d().add(wallDir.multiplyScalar(lightSize));

// Test: Draw the light position
Draw.point(uLightPosition, { color: Draw.COLORS.yellow, radius: 3 })
Draw.point(lightLR0, { color: Draw.COLORS.yellow, radius: 2 })
Draw.point(lightLR1, { color: Draw.COLORS.yellow, radius: 2 })

// Direction from light LR --> wall endpoints
dirOuterSidePenumbra = [wall2d[0].subtract(lightLR0), wall2d[1].subtract(lightLR1)];
dirInnerSidePenumbra = [wall2d[0].subtract(lightLR1), wall2d[1].subtract(lightLR0)];

// Normalize directionals
dirMidSidePenumbra = dirMidSidePenumbra.map(dir => dir.normalize())
dirOuterSidePenumbra = dirOuterSidePenumbra.map(dir => dir.normalize())
dirInnerSidePenumbra = dirInnerSidePenumbra.map(dir => dir.normalize())

// Test: Draw from endpoint toward canvas for each direction
Draw.segment({ A: wall2d[0], B: wall2d[0].add(dirOuterSidePenumbra[0].multiplyScalar(500))}, { color: Draw.COLORS.orange })
Draw.segment({ A: wall2d[0], B: wall2d[0].add(dirMidSidePenumbra[0].multiplyScalar(500))}, { color: Draw.COLORS.blue })
Draw.segment({ A: wall2d[0], B: wall2d[0].add(dirInnerSidePenumbra[0].multiplyScalar(500))}, { color: Draw.COLORS.red })

Draw.segment({ A: wall2d[1], B: wall2d[1].add(dirOuterSidePenumbra[1].multiplyScalar(500))}, { color: Draw.COLORS.orange })
Draw.segment({ A: wall2d[1], B: wall2d[1].add(dirMidSidePenumbra[1].multiplyScalar(500))}, { color: Draw.COLORS.blue })
Draw.segment({ A: wall2d[1], B: wall2d[1].add(dirInnerSidePenumbra[1].multiplyScalar(500))}, { color: Draw.COLORS.red })

*/

/* Penumbra geometry
function calculateRatio(wallEndpoint, dir, furthestPoint, canvasPlane, maxDist) {
  if ( dir.z >= 0.0 ) return 0.0;
  const t = canvasPlane.rayIntersection(wallEndpoint, dir)
  const ix = wall0Top3d.projectToward(wall0Top3d.add(dir), t)

  // If the intersection lies beyond the furthestPoint, that likely means maxR was exceeded.
  if ( maxDist < PIXI.Point.distanceBetween(ix, wallEndpoint) ) return 0.0;

  return PIXI.Point.distanceBetween(furthestPoint, ix);
}


function cleanDirectionalVector(dirArr, wall2d, oWallLight) {
  let oWallPenumbra = Math.sign(foundry.utils.orient2dFast(wall2d[0], wall2d[1], wall2d[0].add(dirArr[0])));
  if ( oWallPenumbra === oWallLight ) dirMidSidePenumbra[0] = wall2d[0].subtract(wall2d[1])

  oWallPenumbra = Math.sign(foundry.utils.orient2dFast(wall2d[0], wall2d[1], wall2d[1].add(dirArr[1])));
  if ( oWallPenumbra === oWallLight ) dirMidSidePenumbra[1] = wall2d[1].subtract(wall2d[0])

  dirArr[0] = dirArr[0].normalize();
  dirArr[1] = dirArr[1].normalize();

  return dirArr;
}


// Confirm the directional vectors point to the side of the wall opposite the light.
// If not, replace with a vector parallel to the wall.
oWallLight = Math.sign(foundry.utils.orient2dFast(wall2d[0], wall2d[1], wall2d[0].add(lightDirection2d)));


oWallPenumbra = Math.sign(foundry.utils.orient2dFast(wall2d[0], wall2d[1], wall2d[0].add(dirMidSidePenumbra[0])));
if ( oWallPenumbra === oWallLight ) dirMidSidePenumbra[0] = wall2d[0].subtract(wall2d[1])

oWallPenumbra = Math.sign(foundry.utils.orient2dFast(wall2d[0], wall2d[1], wall2d[1].add(dirMidSidePenumbra[1])));
if ( oWallPenumbra === oWallLight ) dirMidSidePenumbra[1] = wall2d[1].subtract(wall2d[0])

// Normalize the vectors
dirMidSidePenumbra[0] = dirMidSidePenumbra[0].normalize()
dirMidSidePenumbra[1] = dirMidSidePenumbra[1].normalize()
dirInnerSidePenumbra[0] = dirInnerSidePenumbra[0].normalize()
dirInnerSidePenumbra[1] = dirInnerSidePenumbra[1].normalize()
dirOuterSidePenumbra[0] = dirOuterSidePenumbra[0].normalize()
dirOuterSidePenumbra[1] = dirOuterSidePenumbra[1].normalize()


canvasElevation = uElevationRes.x;
maxR = Math.sqrt(uSceneDims.z * uSceneDims.z + uSceneDims.w * uSceneDims.w) * 2
vertexNum = 0

planePoint = new Point3d(0, 0, canvasElevation)
planeNormal = new Point3d(0, 0, 1)
canvasPlane = new Plane(planePoint, planeNormal)

// Determine where the light ray hits the canvas when passing through one of the endpoints.
sideMidPenumbra = Array(2)
closerIdx = 0;
furtherIdx = 1
farLightRayZChange = zChangeLightWallTop.z;
wall0Top3d = new Point3d(wall2d[0].x, wall2d[0].y, wallTopZ);
if ( farLightRayZChange < 0 ) {
  dir = (new Point3d(dirMidSidePenumbra[0].x, dirMidSidePenumbra[0].y, farLightRayZChange)).normalize()
  t = canvasPlane.rayIntersection(wall0Top3d, dir)
  ixCanvas = wall0Top3d.projectToward(wall0Top3d.add(dir), t)
  sideMidPenumbra[0] = ixCanvas.to2d()
  Draw.segment({ A: wall0Top3d, B: ixCanvas}, { color: Draw.COLORS.green })

}

if ( farLightRayZChange >= 0 || PIXI.Point.distanceBetween(sideMidPenumbra[0], wall2d[0]) > maxR ){
  // if point source light
  closerIdx = PIXI.Point.distanceSquaredBetween(uLightPosition, wall2d[0]) < PIXI.Point.distanceSquaredBetween(uLightPosition, wall2d[1]) ? 0 : 1;
  furtherIdx = closerIdx % 2;
  // end if
  penumbraCloser = { origin: wall2d[closerIdx], direction: dirMidSidePenumbra[closerIdx] }
  penumbraCloser.direction = penumbraCloser.direction.normalize();
  sideMidPenumbra[closerIdx] = penumbraCloser.origin.projectToward(penumbraCloser.origin.add(penumbraCloser.direction), maxR)
}

// Construct a parallel ray to the wall and use that to intersect the further penumbra ray.
Draw.segment({A: wall2d[closerIdx], B: wall2d[closerIdx].add(dirMidSidePenumbra[closerIdx].multiplyScalar(maxR))})
Draw.segment({A: wall2d[furtherIdx], B: wall2d[furtherIdx].add(dirMidSidePenumbra[furtherIdx].multiplyScalar(maxR))})


farParallelRay = { origin: sideMidPenumbra[closerIdx], direction: wallDir };
sideMidPenumbra[furtherIdx] = foundry.utils.lineLineIntersection(
  farParallelRay.origin,
  farParallelRay.origin.add(farParallelRay.direction),
  wall2d[furtherIdx],
  wall2d[furtherIdx].add(dirMidSidePenumbra[furtherIdx]))
sideMidPenumbra[furtherIdx] = PIXI.Point.fromObject(sideMidPenumbra[furtherIdx])
Draw.segment({ A: sideMidPenumbra[0], B: sideMidPenumbra[1] }, { color: Draw.COLORS.blue })

Draw.segment({ A: wall2d[0], B: wall2d[0].add(dirOuterSidePenumbra[0].multiplyScalar(maxR))}, { color: Draw.COLORS.red })
Draw.segment({ A: wall2d[1], B: wall2d[0].add(dirOuterSidePenumbra[1].multiplyScalar(maxR))}, { color: Draw.COLORS.green })

sidePenumbra = Array(2);
sidePenumbra[0] = foundry.utils.lineLineIntersection(
  farParallelRay.origin,
  farParallelRay.origin.add(farParallelRay.direction),
  wall2d[0],
  wall2d[0].add(dirOuterSidePenumbra[0]));
sidePenumbra[1] = foundry.utils.lineLineIntersection(
  farParallelRay.origin,
  farParallelRay.origin.add(farParallelRay.direction),
  wall2d[1],
  wall2d[1].add(dirOuterSidePenumbra[1]));

sideUmbra = Array(2)
sideUmbra[0] = foundry.utils.lineLineIntersection(
  farParallelRay.origin,
  farParallelRay.origin.add(farParallelRay.direction),
  wall2d[0],
  wall2d[0].add(dirInnerSidePenumbra[0]));
sideUmbra[1] = foundry.utils.lineLineIntersection(
  farParallelRay.origin,
  farParallelRay.origin.add(farParallelRay.direction),
  wall2d[1],
  wall2d[1].add(dirInnerSidePenumbra[1]));

newLightCenter = foundry.utils.lineLineIntersection(sidePenumbra[0], wall2d[0], sidePenumbra[1], wall2d[1]);

Draw.segment({A: wall2d[0], B: sidePenumbra[0]}, { color: Draw.COLORS.lightred })
Draw.segment({A: wall2d[1], B: sidePenumbra[1]}, { color: Draw.COLORS.lightgreen })

Draw.point(sidePenumbra[0])
Draw.point(sidePenumbra[1])
Draw.point(sideUmbra[0])
Draw.point(sideUmbra[1])

Draw.point(newLightCenter, { color: Draw.COLORS.yellow })
Draw.segment({A: newLightCenter, B: sidePenumbra[0]})
Draw.segment({A: newLightCenter, B: sidePenumbra[1]})

fWallHeights = new PIXI.Point(wallTopZ, wallBottomZ);
distShadowInv = 1.0 / PIXI.Point.distanceBetween(newLightCenter, sidePenumbra[0]);
distWallTop = PIXI.Point.distanceBetween(wall2d[0], sidePenumbra[0]);
fWallRatio = distWallTop * distShadowInv;
fNearRatios = new Point3d(fWallRatio, fWallRatio, fWallRatio);
fFarRatios = new Point3d(0, 0, 0);

// Light center
dirTmp = new Point3d(dirOuterSidePenumbra[0].x, dirOuterSidePenumbra[0].y, zChangeLightWallTop.y);
dirTmp = dirTmp.normalize()
fFarRatios.y = distShadowInv * calculateRatio(wall0Top3d, dirTmp, sidePenumbra[0], canvasPlane, distWallTop);

// Light top
dirTmp = new Point3d(dirOuterSidePenumbra[0].x, dirOuterSidePenumbra[0].y, zChangeLightWallTop.x);
dirTmp = dirTmp.normalize()
fFarRatios.x = distShadowInv * calculateRatio(wall0Top3d, dirTmp, sidePenumbra[0], canvasPlane, distWallTop);

if ( wallBottomZ > canvasElevation ) {
  vec3 wall0Bottom3d = vec3(wall2d[0], wallTopZ);

  // Light top
  dirTmp = new Point3d(dirOuterSidePenumbra[0], zChangeLightWallBottom.x);
  dirTmp = dirTmp.normalize()
  fNearRatios.x = distShadowInv * calculateRatio(wall0Bottom3d, dirTmp, sidePenumbra[0], canvasPlane);

  // Light center
  dirTmp = new Point3d(dirOuterSidePenumbra[0], zChangeLightWallBottom.y);
  dirTmp = dirTmp.normalize()
  fNearRatios.y = distShadowInv * calculateRatio(wall0Bottom3d, dirTmp, sidePenumbra[0], canvasPlane);

  // Light bottom
  dirTmp = new Point3d(dirOuterSidePenumbra[0], zChangeLightWallBottom.z);
  dirTmp = dirTmp.normalize()
  fNearRatios.z = distShadowInv * calculateRatio(wall0Bottom3d, dirTmp, sidePenumbra[0], canvasPlane);
}

*/


/* Checking the directional math
[wall] = canvas.walls.controlled

Plane = CONFIG.GeometryLib.threeD.Plane
Matrix = CONFIG.GeometryLib.Matrix

mesh = ev.shadowMesh
uAzimuth = mesh.shader.uniforms.uAzimuth
uElevationAngle = mesh.shader.uniforms.uElevationAngle
uSolarAngle = mesh.shader.uniforms.uSolarAngle
uSceneDims = mesh.shader.uniforms.uSceneDims
uElevationRes = mesh.shader.uniforms.uElevationRes
uElevationRes = { x: uElevationRes[0], y: uElevationRes[1], z: uElevationRes[2], w: uElevationRes[3]}
uSceneDims = mesh.shader.uniforms.uSceneDims
uSceneDims = { x: uSceneDims[0], y: uSceneDims[1], z: uSceneDims[2], w: uSceneDims[3] }

wallCoords = Point3d.fromWall(wall)
wallCoords.A.top.z = Math.min(wallCoords.A.top.z, 1e06)
wallCoords.B.top.z = Math.min(wallCoords.B.top.z, 1e06)
wallCoords.A.bottom.z = Math.max(wallCoords.A.bottom.z, -1e06)
wallCoords.B.bottom.z = Math.max(wallCoords.B.bottom.z, -1e06)
aWallCorner0 = wallCoords.A.top;
aWallCorner1 = wallCoords.B.bottom
wallTopZ = aWallCorner0.z
wallTop1 = new Point3d(aWallCorner0.x, aWallCorner0.y, wallTopZ);
wallTop2 =  new Point3d(aWallCorner1.x, aWallCorner1.y, wallTopZ);

canvasElevation = uElevationRes.x;
maxR = Math.sqrt(uSceneDims.z * uSceneDims.z + uSceneDims.w * uSceneDims.w) * 2

// Determine which side of the wall the light is on.
vec2_0 = new PIXI.Point(0, 0)
lightDirection2d = PIXI.Point.fromAngle(vec2_0, uAzimuth, 1.0);
oWallLight = Math.sign(foundry.utils.orient2dFast(aWallCorner0, aWallCorner1, aWallCorner0.add(lightDirection2d)));

// Adjust azimuth by the solarAngle.
// Determine the direction of the outer penumbra rays from light --> wallCorner1 / wallCorner2.
// The angle for the penumbra is the azimuth ± the solarAngle.
solarWallAngle = Math.max(uSolarAngle, 0.0001) * oWallLight
sidePenumbra1_2d = PIXI.Point.fromAngle(vec2_0, uAzimuth + solarWallAngle, 1.0);
sidePenumbra2_2d = PIXI.Point.fromAngle(vec2_0, uAzimuth - solarWallAngle, 1.0);

// Adjust elevationAngle by the solarAngle. Use the lower elevation angle to find the far penumbra.
zFarPenumbra = zChangeForElevationAngle(uElevationAngle - uSolarAngle);

// Find the direction for each endpoint penumbra and reverse it for intersecting the canvas.
lightPenumbraDirRev1 = new Point3d(sidePenumbra1_2d.x, sidePenumbra1_2d.y, zFarPenumbra).multiplyScalar(-1.0);
lightPenumbraDirRev2 = new Point3d(sidePenumbra2_2d.x, sidePenumbra2_2d.y, zFarPenumbra).multiplyScalar(-1.0);

// Determine the light direction for the endpoint to light and reverse it.
zMidPenumbra = zChangeForElevationAngle(uElevationAngle);
lightDirectionRev = new Point3d(lightDirection2d.x, lightDirection2d.y, zMidPenumbra).multiplyScalar(-1.0);

// Normalize all the directions.
lightPenumbraDirRev1 = lightPenumbraDirRev1.normalize();
lightPenumbraDirRev2 = lightPenumbraDirRev2.normalize();
lightDirectionRev = lightDirectionRev.normalize();

// If the canvas intersection point would be too far away, find an intermediate point to use instead.
// Shift the canvas plane up accordingly.
planePoint = new Point3d(0, 0, canvasElevation)
planeNormal = new Point3d(0, 0, 1)
maxIx = wallTop1.add(lightPenumbraDirRev1.multiplyScalar(maxR));
shadowLengthExceedsCanvas = maxIx.z > 0.0;
// if ( shadowLengthExceedsCanvas = maxIx.z > 0.0 ) planePoint = maxIx
canvasPlane = new Plane(planePoint, planeNormal)


// The different ray intersections with the canvas from wall endpoint --> canvas form an arc around the wall endpoint.
// Intersect the mid-penumbra with the canvas, then find the intersection of those two with
// the other angled rays. This preserves the trapezoidal shape.
rayTopMid1 = { origin: wallTop1, direction: lightDirectionRev }
t = canvasPlane.rayIntersection(rayTopMid1.origin, rayTopMid1.direction)
midPenumbra1 = rayTopMid1.origin.projectToward(rayTopMid1.origin.add(rayTopMid1.direction), t)

rayTopMid2 = { origin: wallTop2, direction: lightDirectionRev }
t = canvasPlane.rayIntersection(rayTopMid2.origin, rayTopMid2.direction)
midPenumbra2 = rayTopMid2.origin.projectToward(rayTopMid2.origin.add(rayTopMid2.direction), t)

outerPenumbra1 = foundry.utils.lineLineIntersection(midPenumbra1, midPenumbra2, wallTop1, wallTop1.add(lightPenumbraDirRev1))
outerPenumbra2 = foundry.utils.lineLineIntersection(midPenumbra1, midPenumbra2, wallTop2, wallTop2.add(lightPenumbraDirRev2))

innerPenumbra1 = foundry.utils.lineLineIntersection(midPenumbra1, midPenumbra2, wallTop1, wallTop1.add(lightPenumbraDirRev2))
innerPenumbra2 = foundry.utils.lineLineIntersection(midPenumbra1, midPenumbra2, wallTop2, wallTop2.add(lightPenumbraDirRev1))


Draw.segment({ A: wallTop1, B: outerPenumbra1 }, { color: Draw.COLORS.red })
Draw.segment({ A: wallTop1, B: innerPenumbra1 }, { color: Draw.COLORS.orange })
Draw.segment({ A: wallTop1, B: midPenumbra1 }, { color: Draw.COLORS.blue })

Draw.segment({ A: wallTop2, B: outerPenumbra2 }, { color: Draw.COLORS.red })
Draw.segment({ A: wallTop2, B: innerPenumbra2 }, { color: Draw.COLORS.orange })
Draw.segment({ A: wallTop2, B: midPenumbra2 }, { color: Draw.COLORS.blue })

// endpoints --> midPenumbra should be parallel
r1P = new Ray(wallTop1, midPenumbra1)
r2P = new Ray(wallTop2, midPenumbra2)
r1P.angle === r2P.angle

// midPenumbra endpoints should have same angle as wall
rPP = new Ray(midPenumbra1, midPenumbra2)
rWall = new Ray(wall.A, wall.B)
rPP.angle === rWall.angle


lightCenter = foundry.utils.lineLineIntersection(outerPenumbra1, wallTop1, outerPenumbra2, wallTop2)
Draw.point(lightCenter, { color: Draw.COLORS.yellow, radius: 10 })


// Calculate flats
outerPenumbra = outerPenumbra1
lightPenumbraDir = lightPenumbraDir1

canvasElevation = mesh.shader.uniforms.uElevationRes[0]
wallBottomZ = Math.max(aWallCorner1.z, canvasElevation);
wallTopZ = aWallCorner0.z;
distShadow = PIXI.Point.distanceBetween(lightCenter, outerPenumbra1)
distShadowInv = 1.0 / distShadow;

// Intersect the canvas plane after adjusting for z
wallTop1 = new Point3d(aWallCorner0.x, aWallCorner0.y, wallTopZ)
lightMidPenumbraDir = new Point3d();
lightMidPenumbraDir.copyFrom(lightPenumbraDir);
lightMidPenumbraDir.z += zAdjust;
lightUmbraDir = new Point3d();
lightUmbraDir.copyFrom(lightPenumbraDir);
lightUmbraDir.z += (zAdjust * 2);

rayMidFarPenumbra = { origin: wallTop1, direction: lightMidPenumbraDir }
t = canvasPlane.rayIntersection(rayMidFarPenumbra.origin, rayMidFarPenumbra.direction)
midFarPenumbra = rayMidFarPenumbra.origin.projectToward(rayMidFarPenumbra.origin.add(rayMidFarPenumbra.direction), t)

rayUmbra = { origin: wallTop1, direction: lightUmbraDir }
t = canvasPlane.rayIntersection(rayUmbra.origin, rayUmbra.direction)
farUmbra = rayUmbra.origin.projectToward(rayUmbra.origin.add(rayUmbra.direction), t)

Draw.point(midFarPenumbra, { color: Draw.COLORS.blue })
Draw.point(farUmbra, { color: Draw.COLORS.gray })

distMidFarPenumbra = PIXI.Point.distanceBetween(outerPenumbra, midFarPenumbra);
distFarUmbra = PIXI.Point.distanceBetween(outerPenumbra, farUmbra);

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

/* Rotate directional vector along z axis
Matrix = CONFIG.GeometryLib.Matrix
mat = Matrix.rotationZ(Math.toRadians(10))
dir = l.source.lightDirection
newDir = mat.multiplyPoint3d(dir)

center = Point3d.fromObject(canvas.dimensions.rect.center)
Draw.segment({A: center , B: center.add(dir.multiplyScalar(500))})
Draw.segment({A: center , B: center.add(newDir.multiplyScalar(500))}, { color: Draw.COLORS.green })
*/
