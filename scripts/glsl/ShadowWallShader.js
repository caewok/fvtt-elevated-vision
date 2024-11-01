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
${defineFunction("fromAngle")}

#define EV_ENDPOINT_LINKED_UNBLOCKED  -10.0

// Enumerated parts of the shadow.
#define UMBRA                             0
#define MIDPENUMBRA                       1
#define PENUMBRA                          2

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

/** Representation of a Foundry point source, accounting for its size. Forms a cross or "+". */
struct Light {
  vec3 center;
  vec3 lr0;
  vec3 lr1;
  vec3 top;
  vec3 bottom;
  float size;
};

/** Represent the three directions of a shadow from a wall endpoint. */
struct ShadowDirections {
  vec3 umbra;
  vec3 midpenumbra;
  vec3 penumbra;
};

/** Represent the three endpoints of a shadow, opposite the wall endpoint. */
struct ShadowPoints {
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
    vec3[2](aBottom, bBottom),
    normalizedDirection(aWallCorner0.xy, aWallCorner1.xy), // Moving from 0 --> 1.
    float[2](aWallCorner0.w, aWallCorner1.w),
    aWallSenseType,
    aThresholdRadius2
  );
}

/**
 * For side penumbra directions, determine if they must be moved to address light leakage
 * from linked endpoints.
 */
void adjustSidePenumbraForLinkedEndpoints(inout ShadowDirections penObj, in Wall wall, in int idx) {
  vec2 wXY = wall.top[idx].xy; // Wall endpoint from which a penumbra is cast.

  // If no linked wall, full penumbra is used.
  float linkAngle = wall.linkValue[idx];
  if ( linkAngle == EV_ENDPOINT_LINKED_UNBLOCKED ) return;
  // return;

  // Determine orientation relative to the mid-penumbra.
  // 4 quadrants:
  // 1 & 2: linked wall is on opposite side from wall, so it blocks.
  // 3 & 4: linked wall is on same side as light:
  // - 3: Linked wall not between wall and mid: no block (tight "V")
  // - 4: Linked wall between wall and mid
  //     ¥ If umbra - linked - mid-penumbra, adjust umbra direction.
  //     ¥ If umbra - mid - linked - penumbra, umbra set to mid.

  // Point positions.
  vec2 linkPt = fromAngle(wXY, linkAngle, 1.0);
  Ray2d midR = Ray2d(wXY, penObj.midpenumbra.xy);
  vec2 midPt = projectRay(midR, 1.0);

  // Orientation re mid.
  vec2 other = (wall.top[1 - idx]).xy;
  float oMidLink = orient(wXY, midPt, linkPt);
  float oMidWall = orient(wXY, midPt, other);

  // 1 & 2: linked wall blocks light.
  bool linkOppositeWall = oMidWall * oMidLink <= 0.0;
  if ( linkOppositeWall ) {
    penObj.umbra.x = penObj.midpenumbra.x;
    penObj.umbra.y = penObj.midpenumbra.y;
    penObj.umbra.z = penObj.midpenumbra.z;

    penObj.penumbra.x = penObj.midpenumbra.x;
    penObj.penumbra.y = penObj.midpenumbra.y;
    penObj.penumbra.z = penObj.midpenumbra.z;
    return;
  }

  // 3 & 4: Linked wall between wall and mid
  // 3: Linked wall in quadrant with light, not blocking.
  float oLinkWall = orient(wXY, linkPt, other);
  float oLinkMid = orient(wXY, linkPt, midPt);
  bool linkBetweenWallAndMid = oLinkWall * oLinkMid < 0.0;
  if ( !linkBetweenWallAndMid ) return;

  // 4. possible block.
  // What side of umbra is the linked wall on? If not on the mid-side, it doesn't block.
  Ray2d umbraR = Ray2d(wXY, penObj.umbra.xy);
  vec2 umbraPt = projectRay(umbraR, 1.0);
  float oUmbraLink = orient(wXY, umbraPt, linkPt);
  float oUmbraMid = orient(wXY, umbraPt, midPt);
  bool linkAfterUmbra = oUmbraLink * oUmbraMid > 0.0;
  if ( !linkAfterUmbra ) return;

  // Linked wall is after umbra, moving toward mid.
  float oMidUmbra = orient(wXY, midPt, umbraPt);

  // Set umbra to the link direction.
  // TODO: This results in a non-normalized direction. Is there a way to get the normalized direction?
  // - normalizing again could change x/y, so cannot do that ?
  vec2 linkDir = normalizedDirection(wXY, linkPt);
  penObj.umbra.x = linkDir.x;
  penObj.umbra.y = linkDir.y;
  if ( oMidUmbra * oMidLink > 0.0 ) return;

  // Linked wall is after mid; adjust mid as well.
  penObj.midpenumbra.x = linkDir.x;
  penObj.midpenumbra.y = linkDir.y;
}

/**
 * Determine the point where the near/far penumbra intersects the side penumbra, if any.
 * sideDir: sidePenumbraDirs[idx][shadowType]
 * nearFarDir: farPenumbraDirs[idx][shadowType] or nearPenumbraDirs[idx][shadowType]
 */
bool penumbraCanvasIntersection(in Plane canvasPlane, in vec3 wallEndpoint, in vec2 wallDirection, in vec3 sideDir, in vec3 nearFarDir, out vec2 ix) {
  vec3 canvasIx;
  bool infiniteShadow = nearFarDir.z >= 0.0;
  if ( infiniteShadow
    || !intersectRayPlane(Ray(wallEndpoint, nearFarDir), canvasPlane, canvasIx)) return false;

  // Draw a line parallel to the wall that goes through the intersection point.
  // The intersection of that with the side penumbra defines the point.
  Ray2d farParallelRay = Ray2d(canvasIx.xy, wallDirection);
  if ( !lineLineIntersection(farParallelRay, Ray2d(wallEndpoint.xy, sideDir.xy), ix) ) return false;
  return true;
}

/**
 * Test if a rect, represented as an array of 4 clockwise points from top left, contains point.
 */
bool _rectContains(vec2[4] rect, vec2 pt) {
  const int TL = 0;
  const int TR = 1;
  const int BR = 2;
  const int BL = 3;
  return pt.x >= rect[TL].x
    && pt.x < rect[TR].x
    && pt.y >= rect[TL].y
    && pt.y < rect[BR].y;
}

/**
 * Get the corner that can be used to project a far parallel ray to a wall.
 * Used in penumbraEndpoints to determine the infinite shadow parallel ray.
 */
vec2 _parallelFarCorner(vec3[2] wallEndpoints, vec2 wallDir, vec3 nearFarDir) {
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

  float oWallLight = orient((wallEndpoints[0]).xy, wallEndpoints[1].xy, wallEndpoints[0].xy - normalize(nearFarDir.xy));
  if ( wallDir.x == 0.0 ) {
    // Wall parallel to left/right.
    float oTL = orient(wallEndpoints[0].xy, wallEndpoints[1].xy, sceneRect[TL]);
    return (oTL * oWallLight) < 0.0 ? sceneRect[TL] : sceneRect[TR];
  }

  if ( wallDir.y == 0.0 ) {
    // Wall parallel to top/bottom.
    float oTL = orient(wallEndpoints[0].xy, wallEndpoints[1].xy, sceneRect[TL]);
    return (oTL * oWallLight) < 0.0 ? sceneRect[TL] : sceneRect[BL];
  }

  // One corner opposite the light can be used; its line will not intersect the canvas rect.
  for ( int i = 0; i < 4; i += 1 ) {
    vec2 corner = sceneRect[i];
    float oCorner = orient(wallEndpoints[0].xy, wallEndpoints[1].xy, corner);
    if ( (oCorner * oWallLight) < 0.0 ) {
      Ray2d r = Ray2d(corner, wallDir);
      vec2 testPt = projectRay(r, 1.0);
      if ( !_rectContains(sceneRect, testPt) ) return corner;
    }
  }
  return sceneRect[0]; // Should not happen.
}


/**
 * Get either the point where the penumbra direction intersects the canvas or the point
 * at maximum canvas distance, as measured from wall endpoint 0.
 * Calculates points from both wall endpoints 0 and 1.
 */
vec2[2] penumbraEndpoints(in vec3[2] wallEndpoints, in vec2 wallDir, in vec3 sideDir0, in vec3 sideDir1, in vec3 nearFarDir) {
  float canvasElevation = uElevationRes.x;

  // Plane describing the canvas at elevation.
  const vec3 planeNormal = vec3(0.0, 0.0, 1.0);
  vec3 planePoint = vec3(0.0, 0.0, canvasElevation);
  Plane canvasPlane = Plane(planePoint, planeNormal);

  bool infiniteShadow = nearFarDir.z >= 0.0; // Ray is rising as it moves from light --> wall.
  vec2 keyPoint;
  if ( infiniteShadow ||
    !penumbraCanvasIntersection(canvasPlane, wallEndpoints[0], wallDir, sideDir0, nearFarDir, keyPoint) ) {

    keyPoint = _parallelFarCorner(wallEndpoints, wallDir, nearFarDir);
  }

  // Get the other endpoint by intersecting the other ray.
  // TODO: If the endpoint heights are different, a more nuanced approach would be required.
  Ray2d farParallelRay = Ray2d(keyPoint, wallDir);
  vec2[2] canvasIx = vec2[2](vec2(0.0), vec2(0.0));
  lineLineIntersection(farParallelRay, Ray2d(wallEndpoints[0].xy, normalize(sideDir0.xy)), canvasIx[0]);
  lineLineIntersection(farParallelRay, Ray2d(wallEndpoints[1].xy, normalize(sideDir1.xy)), canvasIx[1]);
  return canvasIx;
}


/**
 * Get all shadow-canvas intersections for a given wall endpoint.
 */
ShadowPoints[2] endpointsForPenumbras(in ShadowDirections[2] sidePenumbraDirs, in ShadowDirections[2] nearFarPenumbraDirs, in vec3[2] wallEndpoints, in vec2 wallDir) {
  vec2[2] umbra = penumbraEndpoints(wallEndpoints, wallDir,
      sidePenumbraDirs[0].umbra, sidePenumbraDirs[1].umbra, nearFarPenumbraDirs[0].umbra);
  vec2[2] midpenumbra = penumbraEndpoints(wallEndpoints, wallDir,
      sidePenumbraDirs[0].midpenumbra, sidePenumbraDirs[1].midpenumbra, nearFarPenumbraDirs[0].midpenumbra);
  vec2[2] penumbra = penumbraEndpoints(wallEndpoints, wallDir,
      sidePenumbraDirs[0].penumbra, sidePenumbraDirs[1].penumbra, nearFarPenumbraDirs[0].penumbra);
  return ShadowPoints[2](
    ShadowPoints(umbra[0], midpenumbra[0], penumbra[0]),
    ShadowPoints(umbra[1], midpenumbra[1], penumbra[1]));
}

/**
 * For a given shadow vectors structure, get the corresponding vector.
 */
vec2 pointForShadowType(in ShadowPoints shadowPoints, in int shadowType) {
  switch ( shadowType ) {
    case UMBRA: return shadowPoints.umbra;
    case MIDPENUMBRA: return shadowPoints.midpenumbra;
    case PENUMBRA: return shadowPoints.penumbra;
  }
  return vec2(0.0);
}

/**
 * Build the triangle to represent this light's shadow vis-a-vis the wall.
 */
vec2[3] buildTriangle(in ShadowPoints[2] farPenumbraPoints, in Wall wall, in int shadowType) {
  // Construct a new light position based on the xy intersection of the penumbra points --> wall corner
  vec2 a; // Will be the new light center.
  vec2 b = pointForShadowType(farPenumbraPoints[0], shadowType).xy;
  vec2 c = pointForShadowType(farPenumbraPoints[1], shadowType).xy;
  lineLineIntersection(b, wall.top[0].xy, c, wall.top[1].xy, a);
  return vec2[3](a, b, c);
}

/**
 * Determine the barymetric coordinates of a point for a given triangle.
 */
vec3 baryForPoint(vec2 pt, vec2[3] tri) {
  return barycentric(pt, tri[0], tri[1], tri[2]);
}

/**
 * Set the side penumbra variables for the vertex position.
 */
void setSidePenumbraVars(in vec2 pt, in Wall wall, in vec2[3] penumbraTri, in vec2[3] umbraTri) {
  vec3[2] vSidePenumbras;
  for ( int i = 0; i < 2; i += 1 ) {
    vec2 a = wall.top[i].xy;
    vec2 b = penumbraTri[i + 1];
    vec2 c = umbraTri[i + 1];

    // If b and c are equal, there is no side penumbra;
    // If a/b/c line up, there is no side penumbra.
    // Set so all points are outside by making the triangle a fixed -1.
    if ( abs(orient(a, b, c)) < 1.0 )  vSidePenumbras[i] = vec3(-1.0);
    else vSidePenumbras[i] = barycentric(pt, a, b, c);
    // vSidePenumbras[i] = barycentric(pt, a, b, c);
  }
  vSidePenumbra0 = vSidePenumbras[0];
  vSidePenumbra1 = vSidePenumbras[1];
}

/**
 * Calculate the flat variables, including near/far ratios.
 */
void calculateFlatVariables(
  in Wall wall,
  in ShadowDirections[2] sidePenumbraDirs,
  in ShadowPoints farPenumbraPoints0,
  in ShadowDirections[2] nearPenumbraDirs,
  in vec2[3] penumbraTri) {

  vec3 wTop = wall.top[0];
  vec3 wBottom = wall.bottom[0];
  float canvasElevation = uElevationRes.x;

  fWallCornerLinked = vec2(wall.linkValue[0], wall.linkValue[1]);
  fWallHeights = vec2(wTop.z, wBottom.z);
  fWallSenseType = wall.type;
  #ifndef EV_DIRECTIONAL_LIGHT
  fThresholdRadius2 = wall.thresholdRadius2;
  #endif

  // Wall ratio
  fWallRatio = baryForPoint(wTop.xy, penumbraTri).x;

  // Location of the near shadow along the x axis of the barycentric penumbra triangle.
  // Stored as vec3: UMBRA (x), MID (y), PENUMBRA (z)
  ShadowPoints farPts = farPenumbraPoints0;
  fFarRatios = vec3(0.0);
  fFarRatios[UMBRA] = baryForPoint(farPts.umbra, penumbraTri).x;
  fFarRatios[MIDPENUMBRA] = baryForPoint(farPts.midpenumbra, penumbraTri).x;
  // PENUMBRA is 0.0 by definition, b/c it is at end of triangle.

  // Location of the near shadow along the x axis of the barycentric penumbra triangle.
  // Stored as vec3: UMBRA (x), MID (y), PENUMBRA (z)
  fNearRatios = vec3(fWallRatio); // Near shadow starts at wall unless the wall is "floating."
  if ( wBottom.z > canvasElevation ) {
    ShadowPoints[2] nearPenumbraPoints = endpointsForPenumbras(
      sidePenumbraDirs, nearPenumbraDirs, wall.bottom, wall.direction);
    ShadowPoints nearPts = nearPenumbraPoints[0];
    fNearRatios[UMBRA] = baryForPoint(nearPts.umbra, penumbraTri).x;
    fNearRatios[MIDPENUMBRA] = baryForPoint(nearPts.midpenumbra, penumbraTri).x;
    fNearRatios[PENUMBRA] = baryForPoint(nearPts.penumbra, penumbraTri).x;
  }
}


/**
 * Distance between the furthest point (end of the penumbra) and the intersection of the penumbra with the plane.
 */
float calculateRatio(in vec3 wallEndpoint, in vec3 dir, in vec2 furthestPoint, in Plane canvasPlane, in float maxDist) {
  if ( dir.z >= 0.0 ) return 0.0;
  vec3 ix;
  intersectRayPlane(Ray(wallEndpoint, dir), canvasPlane, ix);

  // If the intersection lies beyond the furthestPoint, that likely means maxR was exceeded.
  // 2d b/c maxDist is the x/y distance from wall endpoint to the furthest point.
  if ( maxDist < distance(ix.xy, wallEndpoint.xy) ) return 0.0;

  return distance(furthestPoint, ix.xy);
}
`;

// NOTE: PENUMBRA_VERTEX_CALCULATIONS
const PENUMBRA_VERTEX_CALCULATIONS =
`
// Defined constants.
int vertexNum = gl_VertexID % 3;

// Penumbra structures.
adjustSidePenumbraForLinkedEndpoints(sidePenumbraDirs[0], wall, 0);
adjustSidePenumbraForLinkedEndpoints(sidePenumbraDirs[1], wall, 1);
ShadowPoints[2] farPenumbraPoints = endpointsForPenumbras(sidePenumbraDirs, farPenumbraDirs, wall.top, wall.direction);

// Vertex Calculations
// Big triangle ABC is the bounds of the potential shadow.
//   A = lightCenter;
//   B = sidePenumbra;
//   C = sidePenumbra;
vec2[3] penumbraTri = buildTriangle(farPenumbraPoints, wall, PENUMBRA);
vVertexPosition = penumbraTri[vertexNum];

// Set barymetric coordinates for each corner of the triangle.
vec2[3] midPenumbraTri = buildTriangle(farPenumbraPoints, wall, MIDPENUMBRA);
vec2[3] umbraTri = buildTriangle(farPenumbraPoints, wall, UMBRA);
vPenumbra = vec3(0.0);
vPenumbra[vertexNum] = 1.0;
vMidPenumbra = baryForPoint(vVertexPosition, midPenumbraTri);
vUmbra = baryForPoint(vVertexPosition, umbraTri);
setSidePenumbraVars(vVertexPosition, wall, penumbraTri, umbraTri);

// Calculate the terrain texture coordinate at this vertex based on scene dimensions.
vTerrainTexCoord = (vVertexPosition - uSceneDims.xy) / uSceneDims.zw;

gl_Position = vec4((projectionMatrix * translationMatrix * vec3(vVertexPosition, 1.0)).xy, 0.0, 1.0);

// Finally, set the flat variables when we hit the last vertex for this triangle.
if ( vertexNum == 2 ) {
  calculateFlatVariables(wall, sidePenumbraDirs, farPenumbraPoints[0], nearPenumbraDirs, penumbraTri);
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
#define MIDPENUMBRA                       1
#define PENUMBRA                          2

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
 * Elevate given shadow ratios.
 */
vec3 _elevateShadowRatios(in float elevation, in float wallHeight, in vec3 ratios) {
  float canvasElevation = uElevationRes.x;
  if ( elevation <= canvasElevation ) return ratios;

  wallHeight = max(wallHeight - canvasElevation, 0.0);
  if ( wallHeight == 0.0 ) return ratios;

  float elevationChange = elevation - canvasElevation;
  float heightFraction = elevationChange / wallHeight;
  return ratios + (heightFraction * fWallRatio) - (heightFraction * ratios);
}

/**
 * Elevate the far shadow ratios.
 */
vec3 elevateFarShadowRatios(in float elevation) {
  return _elevateShadowRatios(elevation, fWallHeights.x, fFarRatios);
}

/**
 * Elevate the near shadow ratios.
 */
vec3 elevateNearShadowRatios(in float elevation) {
  return _elevateShadowRatios(elevation, fWallHeights.y, fNearRatios);
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
  return (fWallSenseType == DISTANCE_WALL || fWallSenseType == PROXIMATE_WALL)
    && fThresholdRadius2 != 0.0
    && distanceSquared(vVertexPosition, uLightPosition.xy) < fThresholdRadius2;
  #endif
}

/**
 * Is the fragment in the umbra triangle, accounting for near/far?
 * Does not test for in front of wall.
 */
bool inUmbra(in vec3 farRatios, in vec3 nearRatios) {
  if ( !barycentricPointInsideTriangle(vUmbra) ) return false;
  return between(farRatios[UMBRA], nearRatios[UMBRA], vPenumbra.x) == 1.0;
}

/**
 * Is the fragment in the mid-penumbra triangle, accounting for near/far?
 * Does not test for in front of wall.
 */
bool inMidPenumbra(in vec3 farRatios, in vec3 nearRatios) {
  if ( !barycentricPointInsideTriangle(vMidPenumbra) ) return false;
  return between(farRatios[MIDPENUMBRA], nearRatios[MIDPENUMBRA], vPenumbra.x) == 1.0;
}

/**
 * Is the fragment in the penumbra triangle, accounting for near/far?
 * Does not test for in front of wall.
 */
bool inPenumbra(in vec3 farRatios, in vec3 nearRatios) {
  // Always in the penumbra triangle b/c it defines the vertices.
  return between(farRatios[PENUMBRA], nearRatios[PENUMBRA], vPenumbra.x) == 1.0;
}

/**
 * Is the fragment in the far penumbra area?
 * Does not test for in front of wall.
 */
bool inFarPenumbra(in vec3 farRatios, in vec3 nearRatios) {
  if ( inUmbra(farRatios, nearRatios) ) return false;
  // if ( inMidPenumbra(farRatios, nearRatios) ) return false;
  return between(farRatios[PENUMBRA], farRatios[MIDPENUMBRA], vPenumbra.x) == 1.0;
}

/**
 * Is the fragment in the far mid-penumbra area?
 * Does not test for in front of wall.
 */
bool inFarMidPenumbra(in vec3 farRatios, in vec3 nearRatios) {
  if ( inUmbra(farRatios, nearRatios) ) return false;
  // if ( !inMidPenumbra(farRatios, nearRatios) ) return false;
  return between(farRatios[MIDPENUMBRA], farRatios[UMBRA], vPenumbra.x) == 1.0;
}

/**
 * Is the fragment in the near penumbra area?
 * Does not test for in front of wall.
 */
bool inNearPenumbra(in vec3 farRatios, in vec3 nearRatios) {
  if ( inUmbra(farRatios, nearRatios) ) return false;
  // if ( inMidPenumbra(farRatios, nearRatios) ) return false;
  return between(nearRatios[MIDPENUMBRA], nearRatios[PENUMBRA], vPenumbra.x) == 1.0;
}

/**
 * Is the fragment in the near mid-penumbra area?
 * Does not test for in front of wall.
 */
bool inNearMidPenumbra(in vec3 farRatios, in vec3 nearRatios) {
  if ( inUmbra(farRatios, nearRatios) ) return false;
  // if ( !inMidPenumbra(farRatios, nearRatios) ) return false;
  return between(nearRatios[UMBRA], nearRatios[MIDPENUMBRA], vPenumbra.x) == 1.0;
}
`;

// NOTE: PENUMBRA_FRAGMENT_CALCULATIONS
const PENUMBRA_FRAGMENT_CALCULATIONS =
// eslint-disable-next-line indent
`
  // Assume no shadow as the default
  fragColor = noShadow();

  // If in front of the wall, no shadow.
  if ( inFrontOfWall() ) return;

  // For testing
  // fragColor = vec4(vPenumbra.x, 0.0, 0.0, 0.8);
  // fragColor = vec4(vPenumbra, 0.8);
  // fragColor = vec4(vec3(0.0), 0.8);
  // return;

  #ifndef EV_DIRECTIONAL_LIGHT
  // If a threshold applies, we may be able to ignore the wall.
  if ( thresholdApplies() ) return;
  #endif

  // The light position is artificially set to the intersection of the outer two penumbra
  // lines. So all fragment points must be either in a penumbra or in the umbra.
  // (I.e., not possible to be outside the side penumbras.)

  // Get the elevation at this fragment.
  float canvasElevation = uElevationRes.x;
  float elevation = terrainElevation(uTerrainSampler, vTerrainTexCoord, uElevationRes);

  // Determine the start and end of the shadow, relative to the light.
  vec3 farRatios = elevateFarShadowRatios(elevation);
  vec3 nearRatios = elevateNearShadowRatios(elevation);

  // If in front of the near shadow or behind the far shadow, then no shadow.
  if ( between(farRatios[PENUMBRA], nearRatios[PENUMBRA], vPenumbra.x) == 0.0 ) return;

  // ----- Calculate percentage of light ----- //

  // Determine if the fragment is within one or more penumbra.
  // x, y, z ==> u, v, w barycentric
  bool inSidePenumbra0 = barycentricPointInsideTriangle(vSidePenumbra0);
  bool inSidePenumbra1 = barycentricPointInsideTriangle(vSidePenumbra1);
  bool inFarPenumbra = inFarPenumbra(farRatios, nearRatios);
  bool inNearPenumbra = inNearPenumbra(farRatios, nearRatios);
  bool inFarMidPenumbra = inFarMidPenumbra(farRatios, nearRatios);
  bool inNearMidPenumbra = inNearMidPenumbra(farRatios, nearRatios);

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
  //fragColor = vec4(vSidePenumbra0, 0.8);
//   if ( inFarPenumbra ) fragColor = vec4(vec3(0.0), 0.8);
//   if ( inFarPenumbra) fragColor = vec4(vPenumbra, 0.8);
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
//   if ( vPenumbra.x < farRatios.mid ) fragColor = vec4(vPenumbra.x, 0.0, 0.0, 0.8);
//   else if ( inFarPenumbra ) fragColor = vec4(0.0, vPenumbra.x, 0.0, 0.8);
//   return;

  // UMBRA is nearer to 1; PENUMBRA is nearer to 0.
  float farShadow = inFarPenumbra ? linearConversion(vPenumbra.x, farRatios[PENUMBRA], farRatios[MIDPENUMBRA], 0.0, 0.5)
      : inFarMidPenumbra ? linearConversion(vPenumbra.x, farRatios[MIDPENUMBRA], farRatios[UMBRA], 0.5, 1.0)
        : 1.0;

  // Near shadow is reversed, so UMBRA is nearer 0 and PENUMBRA is nearer to 1.
  float nearShadow = inNearPenumbra ? linearConversion(vPenumbra.x, nearRatios[PENUMBRA], nearRatios[MIDPENUMBRA], 0.0, 0.5)
      : inNearMidPenumbra ? linearConversion(vPenumbra.x, nearRatios[MIDPENUMBRA], nearRatios[UMBRA], 0.5, 1.0)
        : 1.0;

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
in float aThresholdRadius2; // Note: no thresholds for walls apply for directional lighting.

out vec2 vVertexPosition;
out vec2 vTerrainTexCoord;
out vec3 vPenumbra;
out vec3 vMidPenumbra;
out vec3 vUmbra;
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
  // elevationAngle = clamp(elevationAngle, 0.0, PI_1_2); // 0¼ to 90¼
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
ShadowDirections calculateSidePenumbraDirection(in Wall wall, in int idx) {
  float solarAngle = max(0.1, uSolarAngle); // TODO: Cannot currently go all the way to 0.

  // Direction from endpoint toward the light
  vec2 lightDirection2d = normalize(fromAngle(vec2(0.0), uAzimuth, 1.0));

  // Reverse for determining penumbra
  vec2 dirMidPenumbra = lightDirection2d * -1.0;

  // Determine which side of the wall the light is on.
  float oWallLight = sign(orient(wall.top[0].xy, wall.top[1].xy, wall.top[0].xy + lightDirection2d));

  // Adjust azimuth by the solarAngle.
  // Determine the direction of the outer penumbra rays from light --> wallCorner1 / wallCorner2.
  // The angle for the penumbra is the azimuth ± the solarAngle.
  float solarWallAngle = solarAngle * oWallLight;
  float multiplier = idx == 0 ? 1.0 : -1.0;
  vec2 dirPenumbra = fromAngle(vec2(0.0), uAzimuth + (solarWallAngle * multiplier), 1.0) * -1.0;

  // Calculate the change in z for the light direction based on differing solar angles.
  float[3] zFar;
  zFar[UMBRA] = zChangeForElevationAngle(uElevationAngle + solarAngle); // Light top
  zFar[MIDPENUMBRA] = zChangeForElevationAngle(uElevationAngle); // Light middle
  zFar[PENUMBRA] = zChangeForElevationAngle(uElevationAngle - solarAngle); // Light bottom

  // Normalize based on the mid penumbra for corner 0
  return ShadowDirections(
    normalize(vec3(dirPenumbra, zFar[UMBRA])), // umbra
    normalize(vec3(dirPenumbra, zFar[MIDPENUMBRA])), // midpenumbra
    normalize(vec3(dirPenumbra, zFar[PENUMBRA])) // penumbra
  );
}

/**
 * The rays from the wall top endpoint away from the light.
 */
ShadowDirections calculateFarPenumbraDirection(in vec3 dirMidSidePenumbra, int idx) {
  float[3] zDelta = _calculateZChangeRays();
  return ShadowDirections(
    vec3(dirMidSidePenumbra.xy, zDelta[UMBRA]), // umbra
    vec3(dirMidSidePenumbra.xy, zDelta[MIDPENUMBRA]), // midpenumbra
    vec3(dirMidSidePenumbra.xy, zDelta[PENUMBRA]) // penumbra
  );
}

/**
 * The rays from the wall bottom endpoint away from the light.
 */
ShadowDirections calculateNearPenumbraDirection(in vec3 dirMidSidePenumbra, int idx) {
  float[3] zDelta = _calculateZChangeRays();
  return ShadowDirections(
    vec3(dirMidSidePenumbra.xy, zDelta[PENUMBRA]), // umbra
    vec3(dirMidSidePenumbra.xy, zDelta[MIDPENUMBRA]), // midpenumbra
    vec3(dirMidSidePenumbra.xy, zDelta[UMBRA]) // penumbra
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
  ShadowDirections[2] sidePenumbraDirs = ShadowDirections[2](
    calculateSidePenumbraDirection(wall, 0),
    calculateSidePenumbraDirection(wall, 1)
  );
  ShadowDirections[2] farPenumbraDirs = ShadowDirections[2](
    calculateFarPenumbraDirection(sidePenumbraDirs[0].midpenumbra, 0),
    calculateFarPenumbraDirection(sidePenumbraDirs[1].midpenumbra, 1)
  );
  ShadowDirections[2] nearPenumbraDirs = ShadowDirections[2](
    calculateNearPenumbraDirection(sidePenumbraDirs[0].midpenumbra, 0),
    calculateNearPenumbraDirection(sidePenumbraDirs[1].midpenumbra, 1)
  );

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
in vec3 vMidPenumbra;
in vec3 vUmbra;
in vec3 vSidePenumbra0;
in vec3 vSidePenumbra1;

flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in float fWallRatio;
flat in vec3 fNearRatios;
flat in vec3 fFarRatios;
flat in float fWallSenseType;
flat in vec2 fWallCornerLinked;
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
out vec3 vMidPenumbra;
out vec3 vUmbra;
out vec3 vSidePenumbra0;
out vec3 vSidePenumbra1;

flat out float fWallSenseType;
flat out float fThresholdRadius2;
flat out vec2 fWallHeights; // r: topZ to canvas bottom; g: bottomZ to canvas bottom
flat out float fWallRatio;
flat out vec3 fNearRatios;
flat out vec3 fFarRatios;
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
 * Calculate the umbra, mid, and penumbra direction side rays from a given wall endpoint.
 */
ShadowDirections calculateSidePenumbraDirection(in Light light, in Wall wall, in int idx) {
  vec3 w = wall.top[idx]; // Wall endpoint from which a penumbra is cast.
  vec3 umbraL = idx == 0 ? light.lr0 : light.lr1; // Outer light 0 --> to endpoint 0 is umbra
  vec3 penumbraL = idx == 0 ? light.lr1 : light.lr0; // Inner light 1 --> to endpoint 0 is penumbra

  // Direction from light --> wall endpoint.
  return ShadowDirections(
    normalizedDirection(umbraL, w), // Umbra
    normalizedDirection(light.center, w), // Mid
    normalizedDirection(penumbraL, w) // Penumbra
  );
}

/**
 * Calculate the umbra, mid, and penumbra direction near or far rays from a given wall endpoint.a
 */
ShadowDirections calculateNearFarPenumbraDirection(in Light light, in Wall wall, in bool far, in int idx) {
  vec3 w; // Wall endpoint from which a penumbra is cast.
  vec3 umbraLight;
  vec3 penumbraLight;
  if ( far ) {
    w = wall.top[idx];
    umbraLight = light.top;
    penumbraLight = light.bottom;
  } else {
    w = wall.bottom[idx];
    umbraLight = light.bottom;
    penumbraLight = light.top;
  }
  return ShadowDirections(
    normalizedDirection(umbraLight, w), // Umbra
    normalizedDirection(light.center, w), // Mid
    normalizedDirection(penumbraLight, w) // Penumbra
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
  ShadowDirections[2] sidePenumbraDirs = ShadowDirections[2](
    calculateSidePenumbraDirection(light, wall, 0),
    calculateSidePenumbraDirection(light, wall, 1)
  );
  ShadowDirections[2] farPenumbraDirs = ShadowDirections[2](
    calculateNearFarPenumbraDirection(light, wall, true, 0),
    calculateNearFarPenumbraDirection(light, wall, true, 1)
  );
  ShadowDirections[2] nearPenumbraDirs = ShadowDirections[2](
    calculateNearFarPenumbraDirection(light, wall, false, 0),
    calculateNearFarPenumbraDirection(light, wall, false, 1)
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
in vec3 vPenumbra;
in vec3 vMidPenumbra;
in vec3 vUmbra;
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

