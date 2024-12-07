/* ----- NOTE: Penumbra Vertex Functions ----- */

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
${defineFunction("distanceToLine")}

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
 * Either a point on the 45º line at a scene corner or a scene edge point.
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

  // Use an ray that intersects the corner at a 45º angle to the scene rectangle at that corner.
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
 * For infinite shadow, construct the different points of the triangle.
 * @param {ShadowRays2d} sideShadowRays
 * @param {Wall} wall
 * @param {Ray2d} canvasRay     Either the infinite canvas ray or the far penumbra canvas intersection.
 * @param {out vec2} A...I, W0, W1
 * @returns {bool} True if nearly collinear wall to the light.
 */
bool shadowPoints(in ShadowRays2d sideShadowRays, in Wall wall, in Ray2d canvasRay,
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
  out vec2 W1) {

  // Penumbra triangle: ∆ABC
  // Near/far triangle 0: ∆DEF
  // Near/far triangle 1: ∆GHI
  // Side triangle 0: ∆W0CI or ∆W0W1B (near-collinear)
  // Side triangle 1: ∆W1BF or ∆W0W1C (near-collinear)
  // Umbra triangle: ∆W1FI (near-collinear)

  // A found by intersecting the two side penumbra lines.
  lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.penumbra[1], A);

  // Endpoint closest to the light will be associated with ∆DEF; furthest is ∆GHI.
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
    I = projectRay(rEWall, tI); // GLSL: I = projectRay(rEWall, tI)
    lineLineIntersection(rEWall, rG_penumbra, H);
    B = H;
    C = E;
    return false;
  } else {
    Ray2d canvasRay2 = Ray2d(F, canvasRay.direction);
    lineLineIntersection(canvasRay2, rG_penumbra, B);
    lineLineIntersection(canvasRay, rG_umbra, I);
    Ray2d rIWall = Ray2d(I, wallDir);
    lineLineIntersection(rIWall, rG_penumbra, H);
    lineLineIntersection(canvasRay2, rD_penumbra, C);
    return true;
  }
}

/**
 * Given ∆ABC, make it isoceles by extending the shorter edge of AB or AC.
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

/**
 * Define the different shadow triangles.
 * @param {ShadowRays2d} sideShadowRays
 * @param {Wall} wall
 * @param {Ray2d} canvasRay     Either the infinite canvas ray or the far penumbra canvas intersection.
 * @param {out vec2[3]} penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1
 * @returns {bool} True if the wall is nearly collinear.
 */
bool shadowTriangles(in ShadowRays2d sideShadowRays, in Wall wall, in Ray2d canvasRay,
  out vec2[3] penumbraTri,
  out vec2[3] umbraTri,
  out vec2[3] nearFarTri0,
  out vec2[3] nearFarTri1,
  out vec2[3] sideTri0,
  out vec2[3] sideTri1) {

  vec2 A;
  vec2 B;
  vec2 C;
  vec2 D;
  vec2 E;
  vec2 F;
  vec2 G;
  vec2 H;
  vec2 I;
  vec2 J;
  vec2 W0;
  vec2 W1;
  bool nearCollinear = shadowPoints(sideShadowRays, wall, canvasRay,
    A, B, C, D, E, F, G, H, I, W0, W1);

  // Define the triangles.
  penumbraTri = vec2[3](A, B, C);
  nearFarTri0 = vec2[3](D, E, F);
  nearFarTri1 = vec2[3](G, H, I);
  sideTri0 = vec2[3](W0, C, I);
  sideTri1 = vec2[3](W1, B, F);

  // Side triangles used for gradient shading. Vary based on wall location relative to light.
  if ( nearCollinear ) {
    sideTri0 = vec2[3](W0, C, W1);
    sideTri1 = vec2[3](W0, B, W1);

    // Used to shade the portion unblocked by the wall, after the endpoints.
    umbraTri = makeIsoceles(vec2[3](W1, I, F));
  }

  // Change the side triangles to isoceles so gradient shading works.
  sideTri0 = makeIsoceles(sideTri0);
  sideTri1 = makeIsoceles(sideTri1);

  return nearCollinear;
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



// ----- NEW ----- //

/**
 * Calculate varying variables.
 */
void defineBasicVaryings(in Wall wall) {
  int vertexNum = gl_VertexID % 3;

  // Used to determine in front of or behind wall.
  vEdgeDist = distanceToLine(vVertexPosition, wall.top[0].xy,
    normalizedDirection(wall.top[0].xy, wall.top[1].xy));
  if ( vertexNum == 0 ) vEdgeDist *= -1.0;

  // Calculate the terrain texture coordinate at this vertex based on scene dimensions.
  // @type {vec2} vTerrainTexCoord
  vTerrainTexCoord = (vVertexPosition - uSceneDims.xy) / uSceneDims.zw;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(vVertexPosition, 1.0)).xy, 0.0, 1.0);
}

/**
 * Basic flats used by all shaders to limit shadow.
 */
void defineBasicFlats() {
  // @type {float} fWallSenseType
  fWallSenseType = aWallSenseType;

  // @type {float} fThresholdRadius
  fThresholdRadius2 = !(aWallSenseType == DISTANCE_WALL || aWallSenseType == PROXIMATE_WALL)
    ? -1.0 : aThresholdRadius2;
}

