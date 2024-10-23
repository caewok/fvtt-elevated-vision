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

// NOTE: PENUMBRA_VERTEX_FUNCTIONS
const PENUMBRA_VERTEX_FUNCTIONS =
`
${defineFunction("projectRay")}
${defineFunction("toRadians")}
${defineFunction("angleBetween")}
${defineFunction("toDegrees")}
${defineFunction("wallKeyCoordinates")}
${defineFunction("terrainElevation")}
${defineFunction("normalizedDirection")}
${defineFunction("barycentric")}

#define EV_ENDPOINT_LINKED_UNBLOCKED  -10.0

// Structs to simplify the data organization.
/** Representation of a Foundry wall */
struct Wall {
  vec3[2] top;
  vec3[2] bottom;
  vec2 direction;   // Normalized.
  float[2] linkValue;
  float type;
  float thresholdRadius2;
};

/** Points where the side penumbra ends. */
struct SidePenumbra {
  vec2 umbra;
  vec2 mid;
  vec2 penumbra;
};

/** Direction of the penumbra, from the light. */
struct PenumbraDir {
  // All normalized.
  vec3 umbra;
  vec3 mid;
  vec3 penumbra;
  vec3 top;
  vec3 bottom;
};

/** Light centers, accounting for its size. Forms a cross or "+". */
struct Light {
  vec3 center;
  vec3 lr0;
  vec3 lr1;
  vec3 top;
  vec3 bottom;
  float size;
};

/**
 * Ratios for the near/far penumbra, used for blending.
 * Measured in relation to the penumbra distance, where 0 is furthest, 1 is at the wall.
 */
struct PenumbraRatios {
  float back;     // From light top --> wall
  float mid;      // From light center --> wall
  float front;    // From light bottom --> wall
};

/**
 * Convert the PenumbraRatio struct into a vec3 for exporting to the frag shader.
 * @param {PenumbraRatios} ratios
 * @returns {vec3}
 */
vec3 penumbraRatioToVec3(in PenumbraRatios ratios) { return vec3(ratios.front, ratios.mid, ratios.back); }

/**
 * Convert the PenumbraRatio struct from a vec3.
 * @param {vec3} v
 * @returns {PenumbraRatios}
 */
PenumbraRatios penumbraRatioFromVec3(in vec3 v) { return PenumbraRatios(v.x, v.y, v.z); }


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
 * Determine the points of the side penumbra.
 */
SidePenumbra[2] calculateSidePenumbra(in PenumbraDir[2] penumbraDirs, in Wall wall, in Light light, in float maxR, in Plane canvasPlane) {
  SidePenumbra[2] sidePenumbras = SidePenumbra[2](
    SidePenumbra(vec2(0.0), vec2(0.0), vec2(0.0)),
    SidePenumbra(vec2(0.0), vec2(0.0), vec2(0.0))
  );

  // Determine where the light ray hits the canvas when passing through the light bottom to one of the endpoints.
  // This is the furthest point of the shadow, as the top of the light casts a shorter shadow.
  bool infiniteShadow = wall.top[0].z >= light.bottom.z;
  if ( infiniteShadow ) {
    // No height change for an infinite shadow.
    Ray2d midRay = Ray2d(wall.top[0].xy, normalize(penumbraDirs[0].mid.xy));
    sidePenumbras[0].mid = projectRay(midRay, maxR);
  } else {
    // Project a 3d ray from wall top endpoint in direction away from light bottom onto the canvas plane.
    vec3 ixCanvas;
    Ray midRay = Ray(wall.top[0], penumbraDirs[0].bottom);
    intersectRayPlane(midRay, canvasPlane, ixCanvas);
    sidePenumbras[0].mid = ixCanvas.xy;
  }

  // Draw a line parallel to the wall that goes through the intersection point.
  // The intersection of that with each penumbra ray will define the penumbra points.
  Ray2d farParallelRay = Ray2d(sidePenumbras[0].mid.xy, wall.direction);
  lineLineIntersection(farParallelRay, Ray2d(wall.top[1].xy, penumbraDirs[1].mid.xy), sidePenumbras[1].mid);
  lineLineIntersection(farParallelRay, Ray2d(wall.top[0].xy, penumbraDirs[0].penumbra.xy), sidePenumbras[0].penumbra);
  lineLineIntersection(farParallelRay, Ray2d(wall.top[1].xy, penumbraDirs[1].penumbra.xy), sidePenumbras[1].penumbra);
  lineLineIntersection(farParallelRay, Ray2d(wall.top[0].xy, penumbraDirs[0].umbra.xy), sidePenumbras[0].umbra);
  lineLineIntersection(farParallelRay, Ray2d(wall.top[1].xy, penumbraDirs[1].umbra.xy), sidePenumbras[1].umbra);

  return sidePenumbras;
}

/**
 * Barycentric coordinates for the penumbra.
 * @returns {[vec3, vec3]} The bary coordinates for the a and b endpoints.
 */
vec3[2] calculatePenumbraBaryCoords(in Light light, in Wall wall, in SidePenumbra[2] sidePenumbras, vec2 vVertexPosition) {
  vec3[2] vSidePenumbras = vec3[2](
    vec3(1.0, 1.0, 1.0),
    vec3(1.0, 1.0, 1.0)
  );

  for ( int i = 0; i < 2; i += 1 ) {
    vec3 endpoint = wall.top[i];
    SidePenumbra sidePenumbra = sidePenumbras[i];
    float linkValue = wall.linkValue[i];

    #ifndef EV_DIRECTIONAL_LIGHT
    bool hasSidePenumbra = light.size > 0.0;
    #endif

    #ifdef EV_DIRECTIONAL_LIGHT
    bool hasSidePenumbra = uSolarAngle > 0.0;
    #endif

    if ( hasSidePenumbra && linkValue != EV_ENDPOINT_LINKED_UNBLOCKED ) {
      vec2 linkedPt = wallKeyCoordinates(linkValue);
      float oUmbraPenumbra = sign(orient(endpoint.xy, sidePenumbra.umbra, sidePenumbra.penumbra));
      float oUmbraLinked = sign(orient(endpoint.xy, sidePenumbra.umbra, linkedPt));
      float oPenumbraLinked = sign(orient(endpoint.xy, sidePenumbra.penumbra, linkedPt));

      if ( oUmbraPenumbra == oUmbraLinked ) {
        if ( oPenumbraLinked != oUmbraLinked ) {
          // Linked wall goes through the penumbra.
          // Move the umbra to the linked wall.
          vec2 dirLinked = linkedPt - endpoint.xy;
          Ray2d farParallelRay = Ray2d(sidePenumbra.mid.xy, wall.direction.xy);
          lineLineIntersection(farParallelRay, Ray2d(endpoint.xy, dirLinked), sidePenumbra.umbra);
        } else hasSidePenumbra = false; // Linked wall blocks the penumbra.
      }
    }

    if ( hasSidePenumbra ) {
      // Penumbra triangle
      vec2 pA = endpoint.xy;
      vec2 pB = sidePenumbra.penumbra;
      vec2 pC = sidePenumbra.umbra;
      vSidePenumbras[i] = barycentric(vVertexPosition, pA, pB, pC);
    }
  }
  return vSidePenumbras;
}

/**
 * Calculate the flat variables, including near/far ratios.
 */
void calculateFlatVariables(in Wall wall, in Light light, in vec2 penumbra, in Plane canvasPlane, in vec2 newLightCenter) {
  vec3 top = wall.top[0];
  vec3 bottom = wall.bottom[0];
  float canvasElevation = canvasPlane.point.z;

  fWallCornerLinked = vec2(wall.linkValue[0], wall.linkValue[1]);
  fWallHeights = vec2(top.z, bottom.z);
  fWallSenseType = wall.type;
  #ifndef EV_DIRECTIONAL_LIGHT
  fThresholdRadius2 = wall.thresholdRadius2;
  #endif

  // Wall ratio
  float distShadowInv = 1.0 / distance(newLightCenter, penumbra);
  float distWallTop = distance(top.xy, penumbra);
  fWallRatio = distWallTop * distShadowInv;

  // Near/far penumbra ratios
  // x: penumbra; y: mid-penumbra; z: umbra
  // Measured along the penumbra (outer) line.
  PenumbraRatios nearRatios = PenumbraRatios(fWallRatio, fWallRatio, fWallRatio);
  PenumbraRatios farRatios = PenumbraRatios(0.0, 0.0, 0.0);

  // Define directions from the new light position to the end of the outer penumbra.
  vec3 newLightCenter3d = vec3(newLightCenter, light.center.z);
  vec3 newLightTop = newLightCenter3d + vec3(0.0, 0.0, light.size);
  vec3 dirTop = normalizedDirection(newLightTop, top);
  vec3 dirMid = normalizedDirection(newLightCenter3d, top);

  // Light bottom
  // Far ratios is always 0.

  // Light center
  farRatios.mid = distShadowInv
    * calculateRatio(top, dirMid, penumbra, canvasPlane, distWallTop);

  // Light top
  farRatios.front = distShadowInv
    * calculateRatio(top, dirTop, penumbra, canvasPlane, distWallTop);

  if ( bottom.z > canvasElevation ) {
    vec3 newLightBottom = newLightCenter3d - vec3(0.0, 0.0, light.size);
    vec3 dirBottom = normalizedDirection(newLightBottom, top);

    // Light top
    nearRatios.front = distShadowInv
      * calculateRatio(bottom, dirTop, penumbra, canvasPlane, distWallTop);

    // Light center
    nearRatios.mid = distShadowInv
      * calculateRatio(bottom, dirMid, penumbra, canvasPlane, distWallTop);

    // Light bottom
    nearRatios.back = distShadowInv
      * calculateRatio(bottom, dirBottom, penumbra, canvasPlane, distWallTop);
  }
  fNearRatios = penumbraRatioToVec3(nearRatios);
  fFarRatios = penumbraRatioToVec3(farRatios);
}


`;

// NOTE: PENUMBRA_VERTEX_CALCULATIONS
const PENUMBRA_VERTEX_CALCULATIONS =
`
// Define some terms for ease-of-reference.
float canvasElevation = uElevationRes.x;
float maxR = sqrt(uSceneDims.z * uSceneDims.z + uSceneDims.w * uSceneDims.w) * 2.0;
int vertexNum = gl_VertexID % 3;

// Set the barymetric coordinates for each corner of the triangle.
vBary = vec3(0.0);
vBary[vertexNum] = 1.0;

// Plane describing the canvas at elevation.
vec3 planeNormal = vec3(0.0, 0.0, 1.0);
vec3 planePoint = vec3(0.0, 0.0, canvasElevation);
Plane canvasPlane = Plane(planePoint, planeNormal);

// Determine the penumbra endpoints.
SidePenumbra[2] sidePenumbras = calculateSidePenumbra(penumbraDirs, wall, light, maxR, canvasPlane);

// Construct a new light position based on the xy intersection of the outer penumbra points --> wall corner
vec2 newLightCenter;
lineLineIntersection(sidePenumbras[0].penumbra, wall.top[0].xy, sidePenumbras[1].penumbra, wall.top[1].xy, newLightCenter);

// Big triangle ABC is the bounds of the potential shadow.
//   A = lightCenter;
//   B = sidePenumbra;
//   C = sidePenumbra;
switch ( vertexNum ) {
  case 0: // Fake light position
    vVertexPosition = newLightCenter;
    break;
  case 1:
    vVertexPosition = sidePenumbras[0].penumbra;
    break;
  case 2:
    vVertexPosition = sidePenumbras[1].penumbra;
    break;
}

gl_Position = vec4((projectionMatrix * translationMatrix * vec3(vVertexPosition, 1.0)).xy, 0.0, 1.0);

vec3[2] vSidePenumbras = calculatePenumbraBaryCoords(light, wall, sidePenumbras, vVertexPosition);
vSidePenumbra0 = vSidePenumbras[0];
vSidePenumbra1 = vSidePenumbras[1];

// Calculate the terrain texture coordinate at this vertex based on scene dimensions.
vTerrainTexCoord = (vVertexPosition - uSceneDims.xy) / uSceneDims.zw;

if ( vertexNum == 2 ) calculateFlatVariables(wall, light, sidePenumbras[0].penumbra, canvasPlane, newLightCenter);
`;

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
 * Ratios for the near/far penumbra, used for blending.
 * Measured in relation to the penumbra distance, where 0 is furthest, 1 is at the wall.
 */
struct PenumbraRatios {
  float front;    // From light bottom --> wall
  float mid;      // From light center --> wall
  float back;     // From light top --> wall
};

/**
 * Convert the PenumbraRatio struct into a vec3 for exporting to the frag shader.
 * @param {PenumbraRatios} ratios
 * @returns {vec3}
 */
vec3 penumbraRatioToVec3(in PenumbraRatios ratios) { return vec3(ratios.front, ratios.mid, ratios.back); }

/**
 * Convert the PenumbraRatio struct from a vec3.
 * @param {vec3} v
 * @returns {PenumbraRatios}
 */
PenumbraRatios penumbraRatioFromVec3(in vec3 v) { return PenumbraRatios(v.x, v.y, v.z); }


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

  // For testing
  // fragColor = vec4(vBary.x, 0.0, 0.0, 0.8);
  // fragColor = vec4(vBary, 0.8);
  // fragColor = vec4(vec3(0.0), 0.8);
  // return;

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
  PenumbraRatios nearRatios = penumbraRatioFromVec3(fNearRatios);
  PenumbraRatios farRatios = penumbraRatioFromVec3(fFarRatios);

  if ( elevation > canvasElevation ) {
    // Elevation change relative the canvas.
    float elevationChange = elevation - canvasElevation;

    // Wall heights relative to the canvas.
    vec2 wallHeights = max(fWallHeights - canvasElevation, 0.0); // top, bottom

    // Adjust the near and far shadow borders based on terrain height for this fragment.
    nearRatios.front = elevateShadowRatio(nearRatios.front, wallHeights.y, fWallRatio, elevationChange);
    nearRatios.mid = elevateShadowRatio(nearRatios.mid, wallHeights.y, fWallRatio, elevationChange);
    nearRatios.back = elevateShadowRatio(nearRatios.back, wallHeights.y, fWallRatio, elevationChange);
    farRatios.front = elevateShadowRatio(farRatios.front, wallHeights.x, fWallRatio, elevationChange);
    farRatios.mid = elevateShadowRatio(farRatios.mid, wallHeights.x, fWallRatio, elevationChange);
    farRatios.back = elevateShadowRatio(farRatios.back, wallHeights.x, fWallRatio, elevationChange);
  }

  // If in front of the near shadow or behind the far shadow, then no shadow.
  if ( between(farRatios.back, nearRatios.front, vBary.x) == 0.0 ) return;

  // ----- Calculate percentage of light ----- //

  // Determine if the fragment is within one or more penumbra.
  // x, y, z ==> u, v, w barycentric
  bool inSidePenumbra0 = barycentricPointInsideTriangle(vSidePenumbra0);
  bool inSidePenumbra1 = barycentricPointInsideTriangle(vSidePenumbra1);
  bool inFarPenumbra = vBary.x < farRatios.front; // And vBary.x > 0.0
  bool inNearPenumbra = vBary.x > nearRatios.back; // && vBary.x < nearRatios.front; // Handled by in front of wall test.

//   For testing
//   if ( !inSidePenumbra0 && !inSidePenumbra1 && !inFarPenumbra && !inNearPenumbra ) fragColor = vec4(1.0, 0.0, 0.0, 1.0);
//   else fragColor = vec4(vec3(0.0), 0.8);
//   return;

//   fragColor = vec4(vec3(0.0), 0.0);
//   if ( inSidePenumbra0 && fWallCornerLinked.x > 0.5 ) fragColor.r = 1.0;
//   if ( inSidePenumbra1 && fWallCornerLinked.y > 0.5 ) fragColor.b = 1.0;
//
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

  // if ( inFarPenumbra ) fragColor = vec4(vec3(0.0), 0.8);
  // if ( inFarPenumbra) fragColor = vec4(vBary, 0.8);
  // if ( inSidePenumbra0) fragColor = vec4(vSidePenumbra0, 0.8);
  // if ( inSidePenumbra1 ) fragColor = vec4(vSidePenumbra1, 0.8);
  // return;

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

  // Testing
//   if ( vBary.x < farRatios.mid ) fragColor = vec4(vBary.x, 0.0, 0.0, 0.8);
//   else if ( inFarPenumbra ) fragColor = vec4(0.0, vBary.x, 0.0, 0.8);
//   return;

  float farShadow = 1.0;
  if ( inFarPenumbra ) {
    bool inLighterPenumbra = vBary.x < farRatios.mid;
    farShadow = inLighterPenumbra
      ? linearConversion(vBary.x, farRatios.back, farRatios.mid, 0.0, 0.5)
      : linearConversion(vBary.x, farRatios.mid, farRatios.front, 0.5, 1.0);
  }

  float nearShadow = 1.0;
  if ( inNearPenumbra ) {
    bool inLighterPenumbra = vBary.x > nearRatios.mid;
    nearShadow = inLighterPenumbra
      ? linearConversion(vBary.x, nearRatios.back, nearRatios.mid, 0.0, 0.5)
      : linearConversion(vBary.x, nearRatios.mid, nearRatios.front, 0.5, 1.0);
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
  vBary = vec3(0.0);
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
${defineFunction("normalizedDirection")}

${PENUMBRA_VERTEX_FUNCTIONS}

float zChangeForElevationAngle(in float elevationAngle) {
  elevationAngle = clamp(elevationAngle, 0.0, PI_1_2); // 0º to 90º
  vec2 pt = fromAngle(vec2(0.0), elevationAngle, 1.0);
  float z = pt.x == 0.0 ? 1.0 : pt.y / pt.x;
  return z;
  // return max(z, 1e-06); // Don't let z go to 0.
}

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
    vec3[2](aBottom, bBottom),
    normalizedDirection(aWallCorner0.xy, aWallCorner1.xy), // Moving from 0 --> 1.
    float[2](aWallCorner0.w, aWallCorner1.w),
    aWallSenseType,
    aThresholdRadius2
  );
}

/**
 * Determine the top, bottom, left, right light positions.
 */
Light calculateLightPositions(in Wall wall) {
  vec2 dir = wall.direction * uLightSize;

  // Form a cross based on the light center.
  vec2 lr0 = uLightPosition.xy - dir;
  vec2 lr1 = uLightPosition.xy + dir;
  float top = uLightPosition.z + uLightSize;
  float bottom = uLightPosition.z - uLightSize;

  return Light(
    uLightPosition,                 // Center
    vec3(lr0.xy, uLightPosition.z), // Closest to endpoint 0
    vec3(lr1.xy, uLightPosition.z), // Closest to endpoint 1
    vec3(uLightPosition.xy, top),   // Top
    vec3(uLightPosition.xy, bottom), // Bottom
    uLightSize // Size
  );
}

/**
 * Determine the side penumbra using the light positions.
 */
PenumbraDir calculatePenumbraDirection(in Wall wall, in Light light, in int idx) {
  vec3 w = wall.top[idx]; // Wall endpoint from which a penumbra is cast.
  vec3 umbraL = idx == 0 ? light.lr0 : light.lr1; // Outer light 0 --> to endpoint 0 is umbra
  vec3 penumbraL = idx == 0 ? light.lr1 : light.lr0; // Inner light 1 --> to endpoint 0 is penumbra

  // Direction from light --> wall endpoint.
  PenumbraDir penObj = PenumbraDir(
    normalizedDirection(umbraL, w), // umbra
    normalizedDirection(light.center, w), // mid
    normalizedDirection(penumbraL, w), // penumbra
    normalizedDirection(light.top, w), // top
    normalizedDirection(light.bottom, w) // bottom
  );

  // Testing
//   penObj.umbra = penObj.mid;
//   penObj.penumbra = penObj.mid;
//   penObj.top = penObj.mid;
//   penObj.bottom = penObj.mid;
//   return penObj;

  // If no linked wall, full penumbra is used.
  float linkAngle = wall.linkValue[idx];
  if ( linkAngle == EV_ENDPOINT_LINKED_UNBLOCKED ) return penObj;

  // Testing:
  // return penObj;


  // Determine orientation relative to the mid-penumbra.
  // 4 quadrants:
  // 1 & 2: linked wall is on opposite side from wall, so it blocks.
  // 3 & 4: linked wall is on same side as light:
  // - 3: Linked wall not between wall and mid: no block (tight "V")
  // - 4: Linked wall between wall and mid
  //     • If umbra - linked - mid-penumbra, adjust umbra direction.
  //     • If umbra - mid - linked - penumbra, umbra set to mid.

  // Point positions.
  vec2 linkPt = fromAngle(w.xy, linkAngle, 1.0);
  Ray2d midR = Ray2d(w.xy, penObj.mid.xy);
  vec2 midPt = projectRay(midR, 1.0);

  // Orientation re mid.
  vec2 other = (wall.top[1 - idx]).xy;
  float oMidLink = orient(w.xy, midPt, linkPt);
  float oMidWall = orient(w.xy, midPt, other);

  // 1 & 2: linked wall blocks light.
  bool linkOppositeWall = (oMidWall * oMidLink) <= 0.0;
  if ( linkOppositeWall ) {
    penObj.umbra.x = penObj.mid.x;
    penObj.umbra.y = penObj.mid.y;
    penObj.umbra.z = penObj.mid.z;

    // penObj.penumbra.x = penObj.mid.x;
//     penObj.penumbra.y = penObj.mid.y;
//     penObj.penumbra.z = penObj.mid.z;
    return penObj;
  }

  // 3 & 4: Linked wall between wall and mid
  float oLinkWall = orient(w.xy, linkPt, other);
  float oLinkMid = orient(w.xy, linkPt, midPt);
  bool linkBetweenWallAndMid = (oLinkWall * oLinkMid) < 0.0;

  // 3: Linked wall in quadrant with light, not blocking.
  if ( !linkBetweenWallAndMid ) return penObj;

  // 4. possible block.
  // What side of umbra is the linked wall on? If not on the mid-side, it doesn't block.
  Ray2d umbraR = Ray2d(w.xy, penObj.umbra.xy);
  vec2 umbraPt = projectRay(umbraR, 1.0);
  float oUmbraLink = orient(w.xy, umbraPt, linkPt);
  float oUmbraMid = orient(w.xy, umbraPt, midPt);
  bool linkAfterUmbra = (oUmbraLink * oUmbraMid) > 0.0;
  if ( !linkAfterUmbra ) return penObj;

  // Linked wall is after umbra, moving toward mid.
  float oMidUmbra = orient(w.xy, midPt, umbraPt);

  // Set umbra to the link direction.
  // TODO: This results in a non-normalized direction. Is there a way to get the normalized direction?
  // - normalizing again could change x/y, so cannot do that ?
  vec2 linkDir = normalizedDirection(w.xy, linkPt);
  penObj.umbra.x = linkDir.x;
  penObj.umbra.y = linkDir.y;
  bool linkBeforeMid = (oMidUmbra * oMidLink) > 0.0;
  if ( linkBeforeMid ) return penObj;

  // Linked wall is after mid; adjust penumbra as well.
  penObj.penumbra.x = penObj.mid.x;
  penObj.penumbra.y = penObj.mid.y;
  return penObj;
}


void main() {
  // Shadow is a trapezoid formed from the intersection of the wall with the
  // triangle ABC, where
  // C is the light position.
  // A is the intersection of the line light --> wall endpointA --> canvas plane
  // B is the intersection of the line light --> wall endpointB --> canvas plane

  Wall wall = calculateWallPositions();
  Light light = calculateLightPositions(wall);
  PenumbraDir[2] penumbraDirs = PenumbraDir[2](
    calculatePenumbraDirection(wall, light, 0),
    calculatePenumbraDirection(wall, light, 1)
  );

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

