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

#define EV_ENDPOINT_LINKED_UNBLOCKED  -10.0

// Enumerated parts of the shadow.
#define UMBRA                             0
#define MIDPENUMBRA                       2
#define PENUMBRA                          1
#define TOP                               0
#define BOTTOM                            1

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
 * @returns True if not blocked.
 */
bool adjustSideShadowDirectionsForLinkedEndpoints(inout ShadowDirections2d shadowDirs, in Wall wall, in int idx) {
  #ifdef VISION_SHADER
  return false;
  #endif

  vec2 wXY = wall.top[idx].xy; // Wall endpoint from which a penumbra is cast.

  // If no linked wall, full penumbra is used.
  float linkAngle = wall.linkValue[idx];
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

    shadowDirs.penumbra.x = shadowDirs.midpenumbra.x;
    shadowDirs.penumbra.y = shadowDirs.midpenumbra.y;
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
  // TODO: This results in a non-normalized direction. Is there a way to get the normalized direction?
  // - normalizing again could change x/y, so cannot do that ?
  vec2 linkDir = normalizedDirection(wXY, linkPt);
  shadowDirs.umbra.x = linkDir.x;
  shadowDirs.umbra.y = linkDir.y;
  if ( oMidUmbra * oMidLink > 0.0 ) return true;

  // Linked wall is after mid; adjust mid as well.
  shadowDirs.midpenumbra.x = linkDir.x;
  shadowDirs.midpenumbra.y = linkDir.y;
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
      // Use a reasonably large projection value b/c using 1.0 risks still being w/in the rect.
      if ( !(_rectContains(sceneRect, projectRay(r, 100.0))
          || _rectContains(sceneRect, projectRay(r, -100.0))) ) return corner;
    }
  }
  return sceneRect[0]; // Should not happen.
}

/**
 * For a given point (canvas corner or canvas intersection), determine where the side directions
 * intersect the line that parallels the wall and goes through that point.
 */
vec2[2] _intersectFarParallelLine(in vec2 keyPoint, in ShadowDirections2d[2] sideDirs, in vec3[2] wallEndpoints, in vec2 wallDirection) {
   Ray2d farParallelRay = Ray2d(keyPoint, wallDirection);
   vec2[2] ixs;
   lineLineIntersection(farParallelRay, Ray2d(wallEndpoints[0].xy, sideDirs[0].penumbra), ixs[0]);
   lineLineIntersection(farParallelRay, Ray2d(wallEndpoints[1].xy, sideDirs[1].penumbra), ixs[1]);
   return ixs;
}

/**
 * Determine the point where the near/far penumbra intersects the side penumbra, if any.
 * sideDir: sidePenumbraDirs[idx][shadowType]
 * nearFarDir: farPenumbraDirs[idx][shadowType] or nearPenumbraDirs[idx][shadowType]
 */
vec2[2] penumbraCanvasIntersections(in vec3 nearFarDir, in ShadowDirections2d[2] sideDirs, in vec3[2] wallEndpoints) {
  // Plane at the minimum canvas elevation.
  float canvasElevation = uElevationRes.x;
  const vec3 planeNormal = vec3(0.0, 0.0, 1.0);
  vec3 planePoint = vec3(0.0, 0.0, canvasElevation);
  Plane canvasPlane = Plane(planePoint, planeNormal);

  // Wall direction and middle point.
  vec2 wall0 = wallEndpoints[0].xy;
  vec2 wall1 = wallEndpoints[1].xy;
  vec2 wallDir = normalizedDirection(wall0, wall1);
  vec3 wallMid = (wallEndpoints[0] + wallEndpoints[1]) * 0.5;

  // Determine either the canvas intersection or the point at which to cut off an infinite shadow.
  // Measured from midpoint of the wall.
  vec3 canvasIx;
  vec2 keyPoint;
  bool infiniteShadow = nearFarDir.z >= 0.0; // Ray is rising as it moves from light --> wall.
  if ( infiniteShadow || !intersectRayPlane(Ray(wallMid, nearFarDir), canvasPlane, canvasIx) ) {
   keyPoint = _parallelFarCorner(wallEndpoints, wallDir, nearFarDir);
  } else keyPoint = canvasIx.xy;

  // Intersect the penumbra sides with line parallel to the wall that runs through canvas ix.
  // TODO: If the endpoint heights are different, a more nuanced approach would be required.
  vec2[2] ixs = _intersectFarParallelLine(keyPoint, sideDirs, wallEndpoints, wallDir);

  // In rare instances, such as when a directional light is nearly parallel to the wall,
  // the intersections may be on the wrong side of the wall. Treat as infinite wall then.
  if ( !infiniteShadow ) {
    float oLight = orient(wall0, wall1, wall1 - normalize(nearFarDir.xy));
    if ( ((orient(wall0, wall1, ixs[0]) * oLight) < 0.0)
      || ((orient(wall0, wall1, ixs[1]) * oLight) < 0.0) ) {
      keyPoint = _parallelFarCorner(wallEndpoints, wallDir, nearFarDir);
      ixs = _intersectFarParallelLine(keyPoint, sideDirs, wallEndpoints, wallDir);
    }
  }
  return ixs;
}

/**
 * Determine the far intersection points for the penumbra edges.
 */
vec2[2] farPenumbraCanvasIntersections(in ShadowDirections farDirs, in ShadowDirections2d[2] sideDirs, in Wall wall) {
  return penumbraCanvasIntersections(farDirs.penumbra, sideDirs, wall.top);
}

/**
 * Determine the near intersection points for the penumbra edges.
 */
vec2[2] nearPenumbraCanvasIntersections(in ShadowDirections nearDirs, in ShadowDirections2d[2] sideDirs, in Wall wall) {
  return penumbraCanvasIntersections(nearDirs.penumbra, sideDirs, wall.bottom);
}

/**
 * Determine the far intersection points for the umbra edges.
 */
vec2[2] farUmbraCanvasIntersections(in ShadowDirections farDirs, in ShadowDirections2d[2] sideDirs, in Wall wall) {
  return penumbraCanvasIntersections(farDirs.umbra, sideDirs, wall.top);
}

/**
 * Determine the near intersection points for the umbra edges.
 */
vec2[2] nearUmbraCanvasIntersections(in ShadowDirections nearDirs, in ShadowDirections2d[2] sideDirs, in Wall wall) {
  return penumbraCanvasIntersections(nearDirs.umbra, sideDirs, wall.bottom);
}

/**
 * Penumbra triangle.
 * Either the light and the two far intersections or the two endpoints and the single intersection
 * of the penumbra edges.
 */
vec2[3] penumbraTriangle(in ShadowDirections farDirs, in ShadowDirections2d[2] sideDirs, in Wall wall) {
  vec2[2] canvasIxs = farPenumbraCanvasIntersections(farDirs, sideDirs, wall);
  vec2 ix;
  lineLineIntersection(canvasIxs[0], wall.top[0].xy, canvasIxs[1], wall.top[1].xy, ix);
  return vec2[3](ix, canvasIxs[0], canvasIxs[1]);
}

/**
 * Side triangles.
 * Following the umbra line, where does it intersect line parallel to the wall that intersects
 * the far penumbra point(s)? wallendpoint --> ix --> penumbra point
 */
vec2[3] sideTriangle(in int idx, vec2[3] penumbraTri, in ShadowDirections2d[2] sideDirs, in Wall wall) {
  Ray2d farParallelRay = Ray2d(penumbraTri[1], wall.direction);
  vec2 umbraDir = sideDirs[idx].umbra;
  Ray2d umbraRay = Ray2d(wall.top[idx].xy, umbraDir);
  vec2 ix;
  lineLineIntersection(farParallelRay, umbraRay, ix);
  return vec2[3](wall.top[idx].xy, penumbraTri[idx + 1], ix);
}

/**
 * Determine the barymetric coordinates of a point for a given triangle.
 */
vec3 baryForPoint(vec2 pt, vec2[3] tri) {
  return barycentric(pt, tri[0], tri[1], tri[2]);
}

/**
 * Calculate the flat variables, including near/far ratios.
 */
void calculateFlatVariables(
  in vec2[3] penumbraTri,
  in Wall wall,
  in ShadowDirections nearShadowDirs,
  in ShadowDirections farShadowDirs,
  in ShadowDirections2d[2] sideShadowDirs) {

  vec3 wTop = wall.top[0];
  vec3 wBottom = wall.bottom[0];

  // Wall top and bottom in the z direction.
  fWallHeights[TOP] = wTop.z;
  fWallHeights[BOTTOM] = wBottom.z;

  // Threshold radius and sense type.
  fWallSenseType = wall.type;
  #ifndef EV_DIRECTIONAL_LIGHT
  fThresholdRadius2 = wall.thresholdRadius2;
  #endif

  // Location of the wall along the x axis of the barycentric penumbra triangle
  fWallRatio = baryForPoint(wTop.xy, penumbraTri).x;

  // Location of the far umbra intersection. Penumbra intersection is 0.0 by definition.
  vec2 umbraFarIx = farUmbraCanvasIntersections(farShadowDirs, sideShadowDirs, wall)[0];
  fFarRatio = baryForPoint(umbraFarIx, penumbraTri).x;

  // Location of the near shadow along the x axis of the barycentric penumbra triangle.
  fNearRatios = vec2(fWallRatio); // Near shadow starts at wall unless the wall is "floating."
  float canvasElevation = uElevationRes.x;
  if ( wBottom.z > canvasElevation ) {
    vec2 umbraNearIx = nearUmbraCanvasIntersections(nearShadowDirs, sideShadowDirs, wall)[0];
    vec2 penumbraNearIx = nearPenumbraCanvasIntersections(nearShadowDirs, sideShadowDirs, wall)[0];
    fNearRatios[UMBRA] = baryForPoint(umbraNearIx, penumbraTri).x;
    fNearRatios[PENUMBRA] = baryForPoint(penumbraNearIx, penumbraTri).x;
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
// - @type {Light} light
// - @type {ShadowDirections2d[2]} sideShadowDirs
// - @type {ShadowDirections} nearShadowDirs
// - @type {ShadowDirections} farShadowDirs

bool hasSide0 = adjustSideShadowDirectionsForLinkedEndpoints(sideShadowDirs[0], wall, 0);
bool hasSide1 = adjustSideShadowDirectionsForLinkedEndpoints(sideShadowDirs[1], wall, 1);

// Vertex Calculations
// Big triangle ABC is the bounds of the potential shadow.
//   A = lightCenter;
//   B = sidePenumbra;
//   C = sidePenumbra;
vec2[3] penumbraTri = penumbraTriangle(farShadowDirs, sideShadowDirs, wall);
vec2[3] side0Tri = sideTriangle(0, penumbraTri, sideShadowDirs, wall);
vec2[3] side1Tri = sideTriangle(1, penumbraTri, sideShadowDirs, wall);

// Location of this vertex.
vVertexPosition = penumbraTri[vertexNum];

// Set barymetric coordinates for each corner of the triangle.
vPenumbra[vertexNum] = 1.0;

// Define side triangles in relation to the penumbra triangle.
vSidePenumbra0 = vec3(-1.0);
vSidePenumbra1 = vec3(-1.0);

// If no real side penumbra, set values to -1 to avoid inclusion.
// Otherwise baryForPoint may return NaN if set to the midpenumbra for linked walls.
if ( hasSide0 && abs(orient(side0Tri[0], side0Tri[1], side0Tri[2])) > 1.0 ) vSidePenumbra0 = baryForPoint(vVertexPosition, side0Tri);
if ( hasSide1 && abs(orient(side1Tri[0], side1Tri[1], side1Tri[2])) > 1.0 ) vSidePenumbra1 = baryForPoint(vVertexPosition, side1Tri);

// Calculate the terrain texture coordinate at this vertex based on scene dimensions.
vTerrainTexCoord = (vVertexPosition - uSceneDims.xy) / uSceneDims.zw;

gl_Position = vec4((projectionMatrix * translationMatrix * vec3(vVertexPosition, 1.0)).xy, 0.0, 1.0);

// Finally, set the flat variables when we hit the last vertex for this triangle.
if ( vertexNum == 2 ) calculateFlatVariables(penumbraTri, wall, nearShadowDirs, farShadowDirs, sideShadowDirs);
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

#define VISION_SHADER   true

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
 * Determine the top, bottom, left, right light positions.
 * For vision, light size is assumed to be 0, so this is just the light position.
 */
Light calculateLightPositions() {
  return Light(
    uLightPosition, // Center
    uLightPosition, // Closest to endpoint 0
    uLightPosition, // Closest to endpoint 1
    uLightPosition, // Top
    uLightPosition, // Bottom
    0.0 // Size
  );
}

/**
 * Calculate the umbra, mid, and penumbra direction side rays from a given wall endpoint.
 * For vision, this is simply the mid-penumbra (cast from light center).
 */
ShadowDirections2d calculateSideShadowDirections(in Light light, in Wall wall, in int idx) {
  // Direction from light --> wall endpoint.
  vec2 midPenumbra = normalizedDirection(light.center.xy, wall.top[idx].xy);
  return ShadowDirections2d(
    midPenumbra,
    midPenumbra,
    midPenumbra
  );
}

/**
 * Calculate the umbra, mid, and penumbra direction near or far rays from a given wall endpoint.a.
 * For vision, this is simply the mid-penumbra (cast from light center).
 */
ShadowDirections calculateNearFarShadowDirection(in Light light, in Wall wall, in bool far) {
  vec3[2] wallEndpoints;
  if ( far ) wallEndpoints = wall.top; // Ternery operator not allowed for arrays.
  else wallEndpoints = wall.bottom;
  vec3 midWall = (wallEndpoints[0] + wallEndpoints[1]) * 0.5;
  vec3 midPenumbra = normalizedDirection(light.center, midWall);
  return ShadowDirections(
    midPenumbra,
    midPenumbra,
    midPenumbra
  );
}

void main() {
  // Shadow is a trapezoid formed from the intersection of the wall with the
  // triangle ABC, where
  // C is the light position.
  // A is the intersection of the line light --> wall endpointA --> canvas plane
  // B is the intersection of the line light --> wall endpointB --> canvas plane
  Wall wall = calculateWallPositions();
  Light light = calculateLightPositions();
  ShadowDirections2d[2] sideShadowDirs = ShadowDirections2d[2](
    calculateSideShadowDirections(light, wall, 0),
    calculateSideShadowDirections(light, wall, 1)
  );
  ShadowDirections farShadowDirs = calculateNearFarShadowDirection(light, wall, true);
  ShadowDirections nearShadowDirs = calculateNearFarShadowDirection(light, wall, false);

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
ShadowDirections2d calculateSideShadowDirections(in Wall wall, in int idx) {
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
  ShadowDirections2d[2] sideShadowDirs = ShadowDirections2d[2](
    calculateSideShadowDirections(wall, 0),
    calculateSideShadowDirections(wall, 1)
  );
  ShadowDirections farShadowDirs = calculateFarShadowDirections();
  ShadowDirections nearShadowDirs = calculateNearShadowDirections();

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
ShadowDirections2d calculateSideShadowDirections(in Light light, in Wall wall, in int idx) {
  vec2 w = wall.top[idx].xy; // Wall endpoint from which a penumbra is cast.
  vec2 umbraL = idx == 0 ? light.lr0.xy : light.lr1.xy; // Outer light 0 --> to endpoint 0 is umbra
  vec2 penumbraL = idx == 0 ? light.lr1.xy : light.lr0.xy; // Inner light 1 --> to endpoint 0 is penumbra

  // Direction from light --> wall endpoint.
  ShadowDirections2d dirs;
  dirs.umbra = normalizedDirection(umbraL, w);
  dirs.midpenumbra = normalizedDirection(light.center.xy, w);
  dirs.penumbra = normalizedDirection(penumbraL, w);
  return dirs;
}

/**
 * Calculate the umbra, mid, and penumbra direction near or far rays from a given wall endpoint.a
 */
ShadowDirections calculateNearFarShadowDirection(in Light light, in Wall wall, in bool far) {
  vec3[2] wallEndpoints;
  vec3 umbraLight;
  vec3 penumbraLight;
  if ( far ) {
    wallEndpoints = wall.top;
    umbraLight = light.top;
    penumbraLight = light.bottom;
  } else {
    wallEndpoints = wall.bottom;
    umbraLight = light.bottom;
    penumbraLight = light.top;
  }
  vec3 midWall = (wallEndpoints[0] + wallEndpoints[1]) * 0.5;
  ShadowDirections dirs;
  dirs.umbra = normalizedDirection(umbraLight, midWall);
  dirs.midpenumbra = normalizedDirection(light.center, midWall);
  dirs.penumbra = normalizedDirection(penumbraLight, midWall);
  return dirs;
}

void main() {
  // Shadow is a trapezoid formed from the intersection of the wall with the
  // triangle ABC, where
  // C is the light position.
  // A is the intersection of the line light --> wall endpointA --> canvas plane
  // B is the intersection of the line light --> wall endpointB --> canvas plane

  Wall wall = calculateWallPositions();
  Light light = calculateLightPositions(wall);
  ShadowDirections2d[2] sideShadowDirs = ShadowDirections2d[2](
    calculateSideShadowDirections(light, wall, 0),
    calculateSideShadowDirections(light, wall, 1)
  );
  ShadowDirections farShadowDirs = calculateNearFarShadowDirection(light, wall, true);
  ShadowDirections nearShadowDirs = calculateNearFarShadowDirection(light, wall, false);

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

