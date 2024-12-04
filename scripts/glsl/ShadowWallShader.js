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
${defineStruct("Ray2d")}
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
${defineFunction("distanceSquared")}

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

/** Represent the three rays of a shadow from the two wall endpoints in 2d. */
struct ShadowRays2d {
  Ray2d[2] umbra;
  Ray2d[2] midpenumbra;
  Ray2d[2] penumbra;
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
bool wallIsFloating() {
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
 * Does this directional ray cast an infinite shadow?
 * (Ray is rising as it moves from light --> wall.)
 * @param {vec3} lightDir
 * @returns {bool}
 */
bool isInfiniteShadow(in vec3 lightDir) { return lightDir.z >= 0.0 || almostEqual(lightDir.z, 0.0, 1.0e-06); }

/**
 * What quadrant does this direction end up in?
 * @param {vec2} direction
 * @returns {int 0|1|2|3}
 */
int directionalQuadrant(in vec2 direction) {
  const int TL = 0;
  const int TR = 1;
  const int BR = 2;
  const int BL = 3;

  // Direction is moving into one of 4 quadrants.
  if ( direction.x > 0.0 ) return direction.y > 0.0 ? BR : TR;

  // Moving left. x <= 0.
  return direction.y > 0.0 ? BL : TL;
}

/**
 * For infinite wall shadow, point outside of canvas that can be the fake floor intersection.
 * Either a point on the 45¼ line at a scene corner or a scene edge point.
 * @param {Ray2d[2]} lightRays
 * @returns {Ray2d}
 */
Ray2d infiniteShadowCanvasRay(in Ray2d[2] lightRays) {
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

  // Light rays can intersect closest to the same quadrant (1 point), adjacent quadrants (2 points),
  // or opposing quadrants (3 points, middle one counts).
  int quad0 = directionalQuadrant(lightRays[0].direction);
  int quad1 = directionalQuadrant(lightRays[1].direction);

  // Adjacent quadrants; use scene edge.
  if ( quad0 == ((quad1 + 1) % 4)
    || quad0 == ((quad1 + 3) % 4) ) { // -1 + 4
    return Ray2d(sceneRect[quad0], normalizedDirection(sceneRect[quad0], sceneRect[quad1]));
  }

  // If the same corner, use the corner unless the light rays hit the same edge.
  int corner;
  if ( quad0 == quad1 ) {
    vec2 c = sceneRect[quad0];
    Ray2d[2] edges = Ray2d[2](
      Ray2d(c, normalizedDirection(c, sceneRect[(quad0 + 3) % 4])), // -1 + 4
      Ray2d(c, normalizedDirection(c, sceneRect[(quad0 + 1) % 4]))
    );

    // Make sure the first edge each ray hits is the same edge.
    float t00;
    float t01;
    float t10;
    float t11;
    lineLineIntersection(lightRays[0], edges[0], t00);
    lineLineIntersection(lightRays[0], edges[1], t01);
    lineLineIntersection(lightRays[1], edges[0], t10);
    lineLineIntersection(lightRays[1], edges[1], t11);
    int ray0Edge = t00 > 0.0 && t00 < t01 ? 0 : 1;
    int ray1Edge = t10 > 0.0 && t10 < t11 ? 0 : 1;
    if ( ray0Edge == ray1Edge ) return edges[ray0Edge];
    corner = quad0;
  }

  // If in opposing quadrants, must use the corner.
  if ( quad0 == ((quad1 + 2) % 4) ) corner = (quad0 + 1) % 4; // One apart, e.g., 1 and 3.

  // Use an ray that intersects the corner at a 45¼ angle to the scene rectangle at that corner.
  vec2 corner45Dir = vec2(0.5, 0.5);
  if (corner == TL || corner == BL) corner45Dir.y *= -1.0;
  return Ray2d(sceneRect[corner], corner45Dir);
}

/**
 * Locate the canvas intersection for a given direction.
 * If none, determine the infinite shadow canvas ray.
 * @param {vec3} nearFarDir           Typically farShadowDirs.penumbra
 * @param {Ray2d[2]} sidePenumbra      Typically sideShadowRays.penumbra
 * @param {Wall} wall
 * @param {out Ray2d} canvasRay
 * @returns {bool}
 */
bool canvasIntersectionRay(in vec3 nearFarDir, in Ray2d[2] sidePenumbra, in Wall wall, out Ray2d canvasRay) {
  Plane canvasPlane = constructCanvasPlane();
  vec3 wallTopMid = (wall.top[0] + wall.top[1]) * 0.5;
  vec2 wallDir2d = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
  vec3 canvasIx;
  if ( !isInfiniteShadow(nearFarDir)
    && intersectRayPlane(Ray(wallTopMid, nearFarDir), canvasPlane, canvasIx) ) {
    canvasRay.origin = canvasIx.xy;
    canvasRay.direction = wallDir2d;
    return true;
  } else {
    canvasRay = infiniteShadowCanvasRay(sidePenumbra);
    return false;
  }
}

/**
 * For infinite shadow, construct the different triangles.
 * @param {ShadowRays2d} sideShadowRays
 * @param {Wall} wall
 * @param {Ray2d} canvasRay     Either the infinite canvas ray or the far penumbra canvas intersection.
 * @param {out vec2[3]} ABC
 * @param {out vec2[3]} DEF
 * @param {out vec2[3]} GHI
 * @param {out vec2[3]} sideTri0
 * @param {out vec2[3]} sideTri1
 * @returns {bool} True if near-collinear wall, false otherwise.
 */
bool shadowTriangles(in ShadowRays2d sideShadowRays, in Wall wall, in Ray2d canvasRay,
  out vec2 A,
  out vec2 B,
  out vec2 C,
  out vec2 D,
  out vec2 E,
  out vec2 F,
  out vec2 G,
  out vec2 H,
  out vec2 I,
  out vec2 W0,
  out vec2 W1
  ) {
  // Penumbra triangle: ÆABC
  // near/far triangle 0: ÆDEF
  // near/far triangle 1: ÆGHI
  // side triangle 0: ÆwallEndpoint, C, I
  // side triangle 1: ÆwallEndpoint, B, F

  // A found by intersecting the two side penumbra lines.
  lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.penumbra[1], A);

  // Endpoint closest to the light will be associated with ÆDEF; furthest is ÆGHI.
  // Can determine by comparing distance to the penumbra vertex 0 (A).
  int closestIdx = distanceSquared(A, wall.top[1].xy) < distanceSquared(A, wall.top[0].xy) ? 1 : 0;
  W0 = wall.top[closestIdx].xy;
  W1 = wall.top[1 - closestIdx].xy;
  vec2 wallDir = normalizedDirection(W0, W1);

   // The AB penumbra ray runs through the closer endpoint.
  closestIdx = sideShadowRays.penumbra[0].origin.x == W0.x && sideShadowRays.penumbra[0].origin.y == W0.y ? 0 : 1;
  Ray2d rAB = sideShadowRays.penumbra[closestIdx];
  Ray2d rAC = sideShadowRays.penumbra[1 - closestIdx];

  // D and G are the intersections of the penumbra with opposite umbra.
  // E intersects the D penumbra ray with the canvas line.
  Ray2d rD_penumbra = rAB;
  Ray2d rG_penumbra = rAC;
  Ray2d rD_umbra = sideShadowRays.umbra[closestIdx];
  Ray2d rG_umbra = sideShadowRays.umbra[1 - closestIdx];
  lineLineIntersection(rD_penumbra, rD_umbra, D);
  lineLineIntersection(rG_penumbra, rG_umbra, G);
  lineLineIntersection(rD_penumbra, canvasRay, E);

  // Moving from E along the wall direction, we will intersect rD_umbra at F.
  Ray2d rEWall = Ray2d(E, wallDir);
  lineLineIntersection(rEWall, rD_umbra, F);

  // May intersect rG_umbra (I) and rG_penumbra (H, B).
  float tI;
  if ( lineLineIntersection(rEWall, rG_umbra, tI) && tI > 0.0 ) {
    I = projectRay(rEWall, tI);
    lineLineIntersection(rEWall, rG_penumbra, H);
    B = H;
    C = E;
    return false;
    // Wall endpoint, penumbra point, umbra point.
    // sideTri0 = [w0, C, I];
    // sideTri1 = [w1, B, F];

  } else {
    Ray2d canvasRay2 = Ray2d(F, canvasRay.direction);
    lineLineIntersection(canvasRay2, rG_penumbra, B);
    lineLineIntersection(canvasRay, rG_umbra, I);
    Ray2d rIWall = Ray2d(I, wallDir);
    lineLineIntersection(rIWall, rG_penumbra, H);
    lineLineIntersection(canvasRay2, rD_penumbra, C);
    return true;

    // sideTri0 = [w0, C, w1];
    // sideTri1 = [w1, B, F];
  }
}

/**
 * Given ÆABC, make it isoceles by extending the shorter edge of AB or AC.
 * @param {vec2[3]} tri
 * @returns {vec2[3]} tri
 */
vec2[3] makeIsoceles(in vec2[3] tri) {
  vec2 a = tri[0];
  vec2 b = tri[1];
  vec2 c = tri[2];
  float distAB = distance(a, b);
  float distBC = distance(a, c);
  if ( almostEqual(distAB, distBC, 1.0e-08) ) return tri;
  if ( distAB > distBC ) {
    return vec2[3](
      a,
      b,
      a + (normalizedDirection(a, c) * distAB)
    );
  } else { // BC distance is larger.
    return vec2[3](
      a,
      a + (normalizedDirection(a, b) * distBC),
      c
    );
  }
}

#ifndef UNSIZED_SOURCE

/**
 * For a line that intersects a circle, determine the percent area of the circle
 * on each side of the line.
 * @param {vec2} a
 * @param {vec2} b
 * @param {vec2} center
 * @param {float} radius
 * @returns {vec2} The percentage CCW(0) and CW (1), oriented a --> b.
 */
vec2 circleBisectorPercentArea(in vec2 a, in vec2 b, in vec2 center, in float radius) {
  // Use a line perpendicular to AB that goes through center.
  vec2 dir = normalizedDirection(a, b);
  vec2 perpDir = vec2(dir.y, -dir.x); // Moves CCW to a --> b
  Ray2d perpRay = Ray2d(center, perpDir);
  vec2 edgeCCW = projectRay(perpRay, radius);
  vec2 edgeCW = projectRay(perpRay, -radius);
  vec2 ix;
  lineLineIntersection(perpRay, Ray2d(a, normalizedDirection(a, b)), ix);
  float totalDist = radius * 2.0;
  float ccwDist = distance(ix, edgeCCW);
  float cwDist = distance(ix, edgeCW);
  if ( ccwDist < totalDist
    && cwDist < totalDist ) return vec2(ccwDist, cwDist) * (1.0 / totalDist);
  if ( ccwDist > cwDist ) return vec2(1.0, 0.0);
  return vec2(0.0, 1.0);
}

/**
 * Calculate the ambient light used when the wall is collinear.
 * @param {vec2} w0   Closest wall endpoint to the light
 * @param {vec2} w1   Other wall endpoint
 * @returns {vec2}
 */
vec2 ambientLight(vec2 w0, vec2 w1) {
  return circleBisectorPercentArea(w0, w1, uLightPosition.xy, uLightSize);
}

#endif

/**
 * Calculate the flat variables, including near/far ratios.
 */
void calculateFlatVariables(
  in vec2[3] nearFarTri0,
  in vec2[3] nearFarTri1,
  in Wall wall,
  in ShadowDirections farShadowDirs,
  in ShadowDirections nearShadowDirs,
  in bvec2 hasUmbraShadows,
  in ShadowRays2d sideShadowRays
  ) {

  vec3 wTop = wall.top[0];
  vec3 wBottom = wall.bottom[0];
  vec2 wallDir = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
  vec3 wallTopMid = (wall.top[0] + wall.top[1]) * 0.5;
  Plane canvasPlane = constructCanvasPlane();

  // @type {vec2} fWallHeights
  // Wall top and bottom in the z direction.
  fWallHeights[TOP] = wTop.z;
  fWallHeights[BOTTOM] = wBottom.z;

  // @type {float} fThresholdRadius
  // Threshold radius and sense type.
  fWallSenseType = aWallSenseType;
  #ifndef EV_DIRECTIONAL_LIGHT
  fThresholdRadius2 = !(aWallSenseType == DISTANCE_WALL || aWallSenseType == PROXIMATE_WALL)
    ? -1.0 : aThresholdRadius2;
  #endif

  // @type {vec2} fWallRatios
  // Location of the wall along the x axis of the two near/far triangles.
  // The intersect of the wall with DE and GH determine the ratio.
  Ray2d wallRay = Ray2d(wallTopMid.xy, wallDir);
  Ray2d rayED = Ray2d(nearFarTri0[1], normalizedDirection(nearFarTri0[1], nearFarTri0[0]));
  Ray2d rayHG = Ray2d(nearFarTri1[1], normalizedDirection(nearFarTri1[1], nearFarTri1[0]));
  float distDE = distance(nearFarTri0[0], nearFarTri0[1]);
  float distGH = distance(nearFarTri1[0], nearFarTri1[1]);
  lineLineIntersection(rayED, wallRay, fWallRatios[0]); // T value
  lineLineIntersection(rayHG, wallRay, fWallRatios[1]); // T value
  fWallRatios[0] /= distDE;
  fWallRatios[1] /= distGH;


  // @type {vec2} fFarRatios0   UMBRA and PENUMBRA
  // @type {vec2} fFarRatios1   UMBRA and PENUMBRA
  // For far shadows, if infinite, use, the infiniteShadowCanvasRay as the ending point.
  // Otherwise, use the penumbra canvas intersection based on the far direction (through midpoint).
  fFarRatios0 = vec2(-1.0);
  fFarRatios1 = vec2(-1.0);
  vec3 canvasIx;
  if ( hasUmbraShadows[FAR] && !isInfiniteShadow(farShadowDirs.penumbra)
    && intersectRayPlane(Ray(wallTopMid, farShadowDirs.penumbra), canvasPlane, canvasIx) ) {
    fFarRatios0[PENUMBRA] = 0.0;
    fFarRatios1[PENUMBRA] = 0.0;
  }

  // For far umbra shadow, redo the shadow triangle to get the new E and H locations.
  vec3 canvasFarUmbraIx;
  if ( !isInfiniteShadow(farShadowDirs.umbra)
    && intersectRayPlane(Ray(wallTopMid, farShadowDirs.umbra), canvasPlane, canvasFarUmbraIx) ) {
    Ray2d canvasFarUmbraRay = Ray2d(canvasFarUmbraIx.xy, wallDir);
    vec2 A;
    vec2 B;
    vec2 C;
    vec2 D;
    vec2 E;
    vec2 F;
    vec2 G;
    vec2 H;
    vec2 I;
    vec2 W0;
    vec2 W1;
    shadowTriangles(sideShadowRays, wall, canvasFarUmbraRay, A, B, C, D, E, F, G, H, I, W0, W1);
    fFarRatios0[UMBRA] = (distDE - distance(D, E)) / distDE;
    fFarRatios1[UMBRA] = (distGH - distance(G, H)) / distGH;
  }

  // @type {vec2} fNearRatios0   UMBRA and PENUMBRA
  // @type {vec2} fNearRatios1   UMBRA and PENUMBRA
  // For near shadows, move the wall at the midpoint.
  // The intersect of the wall with DE and GH determine the ratio.
  fNearRatios0 = vec2(-1.0);
  fNearRatios1 = vec2(-1.0);
  float canvasElevation = uElevationRes.x;
  if ( wallIsFloating() ) {
    vec3 wallBottomMid = (wall.bottom[0] + wall.bottom[1]) * 0.5;
    vec3 canvasNearUmbraIx;
    vec3 canvasNearPenumbraIx;
    if ( !isInfiniteShadow(nearShadowDirs.umbra)
      && intersectRayPlane(Ray(wallBottomMid, nearShadowDirs.penumbra), canvasPlane, canvasNearUmbraIx) ) {
      Ray2d umbraWallRay = Ray2d(canvasNearUmbraIx.xy, wallDir);
      lineLineIntersection(rayED, umbraWallRay, fNearRatios0[PENUMBRA]);
      lineLineIntersection(rayHG, umbraWallRay, fNearRatios1[PENUMBRA]);
    }
    if ( !isInfiniteShadow(nearShadowDirs.penumbra)
      && intersectRayPlane(Ray(wallBottomMid, nearShadowDirs.umbra), canvasPlane, canvasNearPenumbraIx) ) {
      Ray2d penumbraWallRay = Ray2d(canvasNearPenumbraIx.xy, wallDir);
      lineLineIntersection(rayED, penumbraWallRay, fNearRatios0[UMBRA]);
      lineLineIntersection(rayHG, penumbraWallRay, fNearRatios1[UMBRA]);
    }
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
// #ifndef UNSIZED_SOURCE
// if ( hasSideShadows[0] ) hasSideShadows[0] = adjustSideShadowForLinkedEndpoints(sideShadowDirs[0], wall, 0);
// if ( hasSideShadows[1] ) hasSideShadows[1] = adjustSideShadowForLinkedEndpoints(sideShadowDirs[1], wall, 1);
// #endif

// #ifndef UNSIZED_SOURCE
// vec2[3] sideTri0;
// vec2[3] sideTri1;
// if ( hasSideShadows[0] ) sideTri0 = calculateSideTriangle(0, penumbraTri, wall, sideShadowDirs, farShadowDirs);
// if ( hasSideShadows[1] ) sideTri1 = calculateSideTriangle(1, penumbraTri, wall, sideShadowDirs, farShadowDirs);
// #endif

vec2 A;
vec2 B;
vec2 C;
vec2 D;
vec2 E;
vec2 F;
vec2 G;
vec2 H;
vec2 I;
vec2 W0;
vec2 W1;
Ray2d farPenumbraCanvasRay;
bool hasFarPenumbra = canvasIntersectionRay(farShadowDirs.penumbra, sideShadowRays.penumbra, wall, farPenumbraCanvasRay);
if ( !hasFarPenumbra ) hasPenumbraShadows[FAR] = false;
bool nearCollinear = shadowTriangles(sideShadowRays, wall, farPenumbraCanvasRay, A, B, C, D, E, F, G, H, I, W0, W1);
vec2[3] penumbraTri = vec2[3](A, B, C);
vec2[3] nearFarTri0 = vec2[3](D, E, F);
vec2[3] nearFarTri1 = vec2[3](G, H, I);
vec2[3] sideTri0 = vec2[3](W0, C, I);
vec2[3] sideTri1 = vec2[3](W1, B, F);
if ( nearCollinear ) {
  sideTri0 = vec2[3](W0, C, W1);
  sideTri1 = vec2[3](W0, B, W1);
}
sideTri0 = makeIsoceles(sideTri0);
sideTri1 = makeIsoceles(sideTri1);

// Umbra triangle for near-collinear.
vUmbra = vec3(-1.0);
if ( nearCollinear ) {
  vec2[3] umbraTri = makeIsoceles(vec2[3](W1, I, F));
  vUmbra = baryForPoint(vVertexPosition, umbraTri);
}

// Location of this vertex.
vVertexPosition = penumbraTri[vertexNum];

// Set barymetric coordinates for each corner of the triangle.
vPenumbra[vertexNum] = 1.0;

// Define side triangles in relation to the penumbra triangle.
// If no real side penumbra, set values to -1 to avoid inclusion.
// Otherwise baryForPoint may return NaN if set to the midpenumbra for linked walls.
vSidePenumbra0 = vec3(-1.0);
vSidePenumbra1 = vec3(-1.0);
#ifndef UNSIZED_SOURCE
if ( hasSideShadows[0] && abs(orient(sideTri0[0], sideTri0[1], sideTri0[2])) > 1.0 ) vSidePenumbra0 = baryForPoint(vVertexPosition, sideTri0);
if ( hasSideShadows[1] && abs(orient(sideTri1[0], sideTri1[1], sideTri1[2])) > 1.0 ) vSidePenumbra1 = baryForPoint(vVertexPosition, sideTri1);
#endif

// Define the near/far triangles used to adjust the shadow for elevation.
vNearFarPenumbra0 = vec3(-1.0);
vNearFarPenumbra1 = vec3(-1.0);
if ( abs(orient(nearFarTri0[0], nearFarTri0[1], nearFarTri0[2])) > 1.0 ) vNearFarPenumbra0 = baryForPoint(vVertexPosition, nearFarTri0);
if ( abs(orient(nearFarTri1[0], nearFarTri1[1], nearFarTri1[2])) > 1.0 ) vNearFarPenumbra1 = baryForPoint(vVertexPosition, nearFarTri1);

// Calculate the terrain texture coordinate at this vertex based on scene dimensions.
vTerrainTexCoord = (vVertexPosition - uSceneDims.xy) / uSceneDims.zw;

gl_Position = vec4((projectionMatrix * translationMatrix * vec3(vVertexPosition, 1.0)).xy, 0.0, 1.0);

// Finally, set the flat variables when we hit the last vertex for this triangle.
if ( vertexNum == 2 ) {
  #ifndef UNSIZED_SOURCE
  fAmbient = 1.0 - ambientLight(W0, W1);
  if ( orient(W0, W1, sideTri0[1]) < 0.0 ) fAmbient = fAmbient.yx; // CW
  #endif
  if ( hasUmbraShadows[FAR] ) hasUmbraShadows[FAR] = farShadowDirs.umbra.z < 0.0;
  if ( wallIsFloating() && hasUmbraShadows[NEAR] ) hasUmbraShadows[NEAR] = nearShadowDirs.umbra.z < 0.0;
  calculateFlatVariables(nearFarTri0, nearFarTri1, wall, farShadowDirs, nearShadowDirs, hasUmbraShadows, sideShadowRays);
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
bool inFrontOfWall() {
  // If in both triangles, must be in front of wall for both.
  // If in one triangle, test only one.
  bool in0 = barycentricPointInsideTriangle(vNearFarPenumbra0);
  bool in1 = barycentricPointInsideTriangle(vNearFarPenumbra1);
  bool front0 = vNearFarPenumbra0.x > fWallRatios[0];
  bool front1 = vNearFarPenumbra1.x > fWallRatios[1];
  if ( in0 && in1 ) return front0 && front1;
  return (in0 && front0) || (in1 && front1) || false;
}

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

/**
 * Is the fragment location outside of a defined shadow?
 * Does not test for in front of wall.
 * @returns {bool}
 */
bool outsideOfShadow() {
  if ( barycentricPointInsideTriangle(vNearFarPenumbra0)
    || barycentricPointInsideTriangle(vNearFarPenumbra1) ) return false;

  // If in-between the two near/far triangles, that also counts (umbra).
  // I.e., y is negative but others are positive.
  if ( vNearFarPenumbra0.y < 0.0 && vNearFarPenumbra1.y < 0.0
    && vNearFarPenumbra0.z > 0.0 && vNearFarPenumbra1.z > 0.0
    && vNearFarPenumbra0.x > 0.0 && vNearFarPenumbra1.x > 0.0 ) return false;

  // Must be outside the penumbras or umbra.
  return true;
}

/**
 * Is fragment inside the side penumbra, without regard to near/far limits.
 * @returns {bool}
 */
bool inSidePenumbra0() { return barycentricPointInsideTriangle(vSidePenumbra0); }

/**
 * Is fragment inside the side penumbra, without regard to near/far limits.
 * @returns {bool}
 */
bool inSidePenumbra1() { return barycentricPointInsideTriangle(vSidePenumbra1); }

`;

// NOTE: PENUMBRA_FRAGMENT_CALCULATIONS
const PENUMBRA_FRAGMENT_CALCULATIONS =
`
  // Assume no shadow as the default
  fragColor = noShadow();

  // Tests for within relevant bounds.
  if ( outsideOfShadow() ) return;
  if ( inFrontOfWall() ) return;

  #ifndef EV_DIRECTIONAL_LIGHT
  // If a threshold applies, we may be able to ignore the wall.
  if ( thresholdApplies() ) return;
  #endif

  // For debugging:
  // fragColor = vec4(1.0, 0.0, 0.0, 0.8);
  // return;

  // Determine whether in near, far, side0, or side1.
  float far0Shadow = 1.0;
  float far1Shadow = 1.0;
  float near0Shadow = 1.0;
  float near1Shadow = 1.0;
  float side0Shadow = 1.0;
  float side1Shadow = 1.0;
  bool needsElevation = fFarRatios0[PENUMBRA] != -1.0 || fFarRatios0[UMBRA] != -1.0
                      || fFarRatios1[PENUMBRA] != -1.0 || fFarRatios1[UMBRA] != -1.0
                      || fNearRatios0[PENUMBRA] != -1.0 || fNearRatios0[UMBRA] != -1.0
                      || fNearRatios1[PENUMBRA] != -1.0 || fNearRatios1[UMBRA] != -1.0;

  vec2 farRatios0 = vec2(fFarRatios0);
  vec2 farRatios1 = vec2(fFarRatios1);
  vec2 nearRatios0 = vec2(fNearRatios0);
  vec2 nearRatios1 = vec2(fNearRatios1);
  if ( needsElevation ) {
    // Get the elevation at this fragment.
    float canvasElevation = uElevationRes.x;
    float elevation = terrainElevation(uTerrainSampler, vTerrainTexCoord, uElevationRes);

    if ( elevation != canvasElevation ) {
      float farF =  _elevationHeightFraction(elevation, fWallHeights[TOP]);
      float nearF = _elevationHeightFraction(elevation, fWallHeights[BOTTOM]);
      if ( fFarRatios0[UMBRA] != -1.0 ) farRatios0[UMBRA] = _elevateShadowRatioUsingHeightFraction(fFarRatios0[UMBRA], fWallRatios[0], farF);
      if ( fFarRatios1[UMBRA] != -1.0 ) farRatios1[UMBRA] = _elevateShadowRatioUsingHeightFraction(fFarRatios1[UMBRA], fWallRatios[1], farF);
      if ( fFarRatios0[PENUMBRA] != -1.0 ) farRatios0[PENUMBRA] = _elevateShadowRatioUsingHeightFraction(fFarRatios0[PENUMBRA], fWallRatios[0], farF);
      if ( fFarRatios1[PENUMBRA] != -1.0 ) farRatios1[PENUMBRA] = _elevateShadowRatioUsingHeightFraction(fFarRatios1[PENUMBRA], fWallRatios[1], farF);
      if ( fNearRatios0[UMBRA] != -1.0 ) nearRatios0[UMBRA] = _elevateShadowRatioUsingHeightFraction(fNearRatios0[UMBRA], fWallRatios[0], nearF);
      if ( fNearRatios1[UMBRA] != -1.0 ) nearRatios1[UMBRA] = _elevateShadowRatioUsingHeightFraction(fNearRatios1[UMBRA], fWallRatios[1], nearF);
      if ( fNearRatios0[PENUMBRA] != -1.0 ) nearRatios0[PENUMBRA] = _elevateShadowRatioUsingHeightFraction(fNearRatios0[PENUMBRA], fWallRatios[0], nearF);
      if ( fNearRatios1[PENUMBRA] != -1.0 ) nearRatios1[PENUMBRA] = _elevateShadowRatioUsingHeightFraction(fNearRatios1[PENUMBRA], fWallRatios[1], nearF);
    }
  }

  // Determine the near/far penumbra inclusion.
  bool inNF0 = barycentricPointInsideTriangle(vNearFarPenumbra0);
  bool inNF1 = barycentricPointInsideTriangle(vNearFarPenumbra1);
  bool inFarPenumbra0 = inNF0 && between(farRatios0[PENUMBRA], farRatios0[UMBRA], vNearFarPenumbra0.x) == 1.0;
  bool inFarPenumbra1 = inNF1 && between(farRatios1[PENUMBRA], farRatios1[UMBRA], vNearFarPenumbra1.x) == 1.0;
  bool inNearPenumbra0 = inNF0 && between(nearRatios0[PENUMBRA], nearRatios0[UMBRA], vNearFarPenumbra0.x) == 1.0;
  bool inNearPenumbra1 = inNF1 && between(nearRatios1[PENUMBRA], nearRatios1[UMBRA], vNearFarPenumbra1.x) == 1.0;

  if ( inFarPenumbra0 ) far0Shadow = linearConversion(vNearFarPenumbra0.x, farRatios0[PENUMBRA], farRatios0[UMBRA], 0.0, 1.0);
  if ( inFarPenumbra0 ) far1Shadow = linearConversion(vNearFarPenumbra1.x, farRatios1[PENUMBRA], farRatios1[UMBRA], 0.0, 1.0);
  if ( inNearPenumbra1 ) near0Shadow = linearConversion(vNearFarPenumbra0.x, nearRatios0[PENUMBRA], nearRatios0[UMBRA], 0.0, 1.0);
  if ( inNearPenumbra1 ) near1Shadow = linearConversion(vNearFarPenumbra1.x, nearRatios1[PENUMBRA], nearRatios1[UMBRA], 0.0, 1.0);

  // Blend the two side penumbras if overlapping by multiplying the light amounts.
  if ( inSidePenumbra0() ) side0Shadow = vSidePenumbra0.z / (vSidePenumbra0.y + vSidePenumbra0.z);
  if ( inSidePenumbra1() ) side1Shadow = vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z);

  float percentUmbra = 1.0;
  #ifndef UNSIZED_SOURCE
  if ( fAmbient[0] != 1.0 && fAmbient[1] != 1.0 ) {
    if ( inSidePenumbra0() ) side0Shadow *= fAmbient[0];
    if ( inSidePenumbra1() ) side1Shadow *= fAmbient[1];

    // Add in umbra shadow if any.
    if ( barycentricPointInsideTriangle(vUmbra) ) {
      float percentL = vUmbra.z / (vUmbra.y + vUmbra.z);
      percentUmbra = (percentL * (1.0 - percentL)) / 0.25; // 0.5 * 0.5 = 0.25; normalize to 1.0.
      float ambient = mix(fAmbient[0], fAmbient[1], percentL); // Blend b/c wall no longer fully blocks.
      percentUmbra *= ambient;
    }
  }
  #endif

  float shadow = side0Shadow * side1Shadow * far0Shadow * far1Shadow * near0Shadow * near1Shadow * percentUmbra;
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
out vec3 vNearFarPenumbra0;
out vec3 vNearFarPenumbra1;
out vec3 vUmbra;

flat out float fWallSenseType;
flat out float fThresholdRadius2;
flat out vec2 fWallHeights;
flat out vec2 fWallRatios;
flat out vec2 fFarRatios0;
flat out vec2 fFarRatios1;
flat out vec2 fNearRatios0;
flat out vec2 fNearRatios1;

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
 * @param {Wall} wall
 * @returns {ShadowRays2d} Direction from the endpoint away from the light for umbra, mid, and penumbra.
 */
ShadowRays2d calculateSideShadowRays(in Wall wall) {
  vec2 wall0 = wall.top[0].xy;
  vec2 wall1 = wall.top[1].xy;
  Ray2d[2] midpenumbra = Ray2d[2](
    Ray2d(wall0, normalizedDirection(uLightPosition.xy, wall0)),
    Ray2d(wall1, normalizedDirection(uLightPosition.xy, wall1)));
  return ShadowRays2d(
    midpenumbra,
    midpenumbra,
    midpenumbra
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

void main() {
  Wall wall = calculateWallPositions();

  // Near/far shadows.
  bvec2 hasUmbraShadows = bvec2(false, false); // @type bvec2 for FAR, NEAR.
  bvec2 hasPenumbraShadows = bvec2(false, false); // @type bvec2 for FAR, NEAR.
  ShadowDirections farShadowDirs = calculateFarShadowDirections(wall);
  ShadowDirections nearShadowDirs;
  if ( wallIsFloating() ) nearShadowDirs = calculateNearShadowDirections(wall);

  // Side shadows.
  bvec2 hasSideShadows = bvec2(false, false);
  ShadowRays2d sideShadowRays = calculateSideShadowRays(wall);

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

#define UNSIZED_SOURCE   true
// #define SHADOW true

uniform sampler2D uTerrainSampler;
uniform vec3 uLightPosition;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier

in vec2 vVertexPosition;
in vec2 vTerrainTexCoord;
in vec3 vPenumbra;
in vec3 vSidePenumbra0;
in vec3 vSidePenumbra1;
in vec3 vNearFarPenumbra0;
in vec3 vNearFarPenumbra1;
in vec3 vUmbra;

flat in float fThresholdRadius2;
flat in float fWallSenseType;
flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in vec2 fWallRatios;
flat in vec2 fFarRatios0;
flat in vec2 fFarRatios1;
flat in vec2 fNearRatios0;
flat in vec2 fNearRatios1;

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
out vec3 vUmbra;

flat out float fWallSenseType;
flat out float fThresholdRadius2;
flat out vec2 fWallHeights;
flat out float fWallRatio;
flat out vec2 fNearRatios;
flat out float fFarRatio;
flat out vec2 fAmbient;

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
  // elevationAngle = clamp(elevationAngle, 0.0, PI_1_2); // 0ï¿½ to 90ï¿½
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
  // The angle for the penumbra is the azimuth ï¿½ the solarAngle.
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
  if ( wallIsFloating() ) nearShadowDirs = calculateNearShadowDirections();

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
in vec3 vUmbra;

flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in float fWallRatio;
flat in vec2 fNearRatios;
flat in float fFarRatio;
flat in float fWallSenseType;
flat in float fThresholdRadius2;
flat in vec2 fAmbient;

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
out vec3 vNearFarPenumbra0;
out vec3 vNearFarPenumbra1;
out vec3 vUmbra;

flat out float fWallSenseType;
flat out float fThresholdRadius2;
flat out vec2 fWallHeights; // r: topZ to canvas bottom; g: bottomZ to canvas bottom
flat out vec2 fWallRatios;
flat out vec2 fFarRatios0;
flat out vec2 fFarRatios1;
flat out vec2 fNearRatios0;
flat out vec2 fNearRatios1;
flat out vec2 fAmbient;

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
};

/**
 * Determine the top, bottom, left, right light positions.
 */
Light calculateLightPositions(in Wall wall) {
  // Form a cross based on the light center.
  float top = uLightPosition.z + uLightSize;
  float bottom = uLightPosition.z - uLightSize;
  return Light(
    vec3(uLightPosition.xy, top),     // top
    uLightPosition,                 // center
    vec3(uLightPosition.xy, bottom)  // bottom
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
 * Direction from light --> wall endpoint. Origin at the wall endpoint.
 * @param {Wall} wall
 * @param {Light} light
 * @returns {ShadowRays2d} Rays from the endpoint away from the light for umbra, mid, and penumbra.
 */
ShadowRays2d calculateSideShadowRays(in Wall wall, in Light light) {
  // Wall data.
  vec2 wall0 = wall.top[0].xy;
  vec2 wall1 = wall.top[1].xy;
  vec2 wallMid = (wall0 + wall1) * 0.5;
  vec2 wallDir = normalizedDirection(wall0, wall1);

  // First determine the tangent points of the circle.
  Circle lightCir = Circle(
    light.center.xy, // Center
    uLightSize       // Radius
  );
  vec2[2] tangents0 = vec2[2](lightCir.center, lightCir.center);
  vec2[2] tangents1 = vec2[2](lightCir.center, lightCir.center);
  tangentPoints(lightCir, wall0, tangents0);
  tangentPoints(lightCir, wall1, tangents1);

  // Build the rays for each tangent to associate them with the correct wall point.
  Ray2d[2] tangentRays0 = Ray2d[2](
    Ray2d(wall0, normalizedDirection(tangents0[0], wall0)),
    Ray2d(wall0, normalizedDirection(tangents0[1], wall0)));
  Ray2d[2] tangentRays1 = Ray2d[2](
    Ray2d(wall1, normalizedDirection(tangents1[0], wall1)),
    Ray2d(wall1, normalizedDirection(tangents1[1], wall1)));

  // Tangents0 are the points on either side of the circle that are tangent to wall0.
  // Tangents1 are the points on either side of the circle that are tangent to wall1.
  // Need the tangents on the same side of the circle. These are close to each other.
  float dist00 = distanceSquared(tangents0[0], tangents1[0]);
  float dist01 = distanceSquared(tangents0[0], tangents1[1]);
  Ray2d[2] tangentGroupA = Ray2d[2](tangentRays0[0], tangentRays1[0]); // A[0] is wall0, A[1] is wall1.
  Ray2d[2] tangentGroupB = Ray2d[2](tangentRays0[1], tangentRays1[1]);
  if ( dist00 > dist01 ) {
    tangentGroupA[1] = tangentRays1[1];
    tangentGroupB[1] = tangentRays1[0];
  }

  // Determine which side the tangents are on. Penumbra: cross; umbra: same.
  // Penumbra and umbra switch when the wall is nearly vertical.
  // Penumbra form the intersection closest to the light
  Ray2d[2] penumbra;
  Ray2d[2] umbra;
  float minD = max(distanceSquared(wall0, light.center.xy), distanceSquared(wall1, light.center.xy));
  for ( int i = 0; i < 2; i += 1 ) {
    for ( int j = 0; j < 2; j += 1 ) {
      vec2 ix;
      if ( lineLineIntersection(tangentGroupA[i], tangentGroupB[j], ix) ) {
        float d = distanceSquared(ix, light.center.xy);
        if ( d > minD ) continue;
        minD = d;
        penumbra[0] = tangentGroupA[i];
        penumbra[1] = tangentGroupB[j];
        umbra[0] = tangentGroupA[1 - i];
        umbra[1] = tangentGroupB[1 - j];
      }
    }
  }
  Ray2d[2] midpenumbra = Ray2d[2](
    Ray2d(wall0, normalizedDirection(light.center.xy, wall0)),
    Ray2d(wall1, normalizedDirection(light.center.xy, wall1)));
  return ShadowRays2d(
    umbra,
    midpenumbra,
    penumbra
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

  // Near/far shadows.
  ShadowDirections nearShadowDirs;
  bvec2 hasUmbraShadows = bvec2(true, true); // @type bvec2 for FAR, NEAR.
  bvec2 hasPenumbraShadows = bvec2(true, true);
  if ( !wallIsFloating() ) {
    hasUmbraShadows[NEAR] = false;
    hasPenumbraShadows[NEAR] = false;
  } else nearShadowDirs = calculateNearShadowDirections(wall, light);
  ShadowDirections farShadowDirs = calculateFarShadowDirections(wall, light);


  // Side shadows.
  bvec2 hasSideShadows = bvec2(true, true); // @type bvec2 for endpoint 0, 1.
  ShadowRays2d sideShadowRays = calculateSideShadowRays(wall, light);

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
uniform float uLightSize;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier

in vec2 vVertexPosition;
in vec2 vTerrainTexCoord;
in vec3 vPenumbra;
in vec3 vSidePenumbra0;
in vec3 vSidePenumbra1;
in vec3 vNearFarPenumbra0;
in vec3 vNearFarPenumbra1;
in vec3 vUmbra;

flat in float fWallSenseType;
flat in float fThresholdRadius2;
flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in vec2 fWallRatios;
flat in vec2 fFarRatios0;
flat in vec2 fFarRatios1;
flat in vec2 fNearRatios0;
flat in vec2 fNearRatios1;
flat in vec2 fAmbient;

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

