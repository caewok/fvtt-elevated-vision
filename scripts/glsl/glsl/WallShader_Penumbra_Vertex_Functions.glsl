/* ----- NOTE: Shadow Vertex Functions ----- */

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
#define RIGHT                             0
#define LEFT                              1

// Structs to simplify the data organization.

/** Representation of a Foundry wall */
struct Wall {
  vec3[2] top;
  vec3[2] bottom;
  vec2 mid;
  vec2 direction;
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
 * @returns {Wall}
 */
Wall calculateWallPositions() {
  vec2[2] endpointsXY = vec2[2](aWallCorner0.xy, aWallCorner1.xy);
  // int closerIdx = closerEndpoint(endpointsXY);
  int closerIdx = closerEndpoint(endpointsXY);
  vec2 xyCloser = endpointsXY[closerIdx];
  vec2 xyFurther = endpointsXY[1 - closerIdx];
  vec2 direction = normalizedDirection(xyCloser, xyFurther);
  float topZ = aWallCorner0.z;
  float bottomZ = aWallCorner1.z;
  return Wall(
    vec3[2](vec3(xyCloser, topZ), vec3(xyFurther, topZ)),
    vec3[2](vec3(xyCloser, bottomZ), vec3(xyFurther, bottomZ)),
    (xyCloser + xyFurther) * 0.5,
    direction
  );
}

/**
 * Maximum diagonal of the canvas, squared.
 */
float maxR2() {
  return (uSceneDims.z * uSceneDims.z) + (uSceneDims.w * uSceneDims.w);
}

/* @type {vec2[4]} */
vec2[4] constructSceneRect() {
  const int TL = 0;
  const int TR = 1;
  const int BR = 2;
  const int BL = 3;

  vec2[4] sceneRect; // @type vec2[4]
  sceneRect[TL] = vec2(0.0, 0.0);
  sceneRect[TR] = vec2((uSceneDims.x * 2.0) + uSceneDims.z, 0.0);
  sceneRect[BR] = vec2((uSceneDims.x * 2.0) + uSceneDims.z, (uSceneDims.y * 2.0) + uSceneDims.w);
  sceneRect[BL] = vec2(0.0, (uSceneDims.y * 2.0) + uSceneDims.w);
  return sceneRect;
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
 * What quadrant does this direction end up in?
 * @param {vec2} direction
 * @returns {int 0|1|2|3}
 */
int directionalQuadrant(in vec2 direction) {
  /*
  const int TL = 0;
  const int TR = 1;
  const int BR = 2;
  const int BL = 3;
  */

  /*
  Treat as centered: tl --> tr --> 0 <-- br <-- bl
  tl: -1 * 2 + -1 * -.5 = -1.5 + 1.5 = 0
  tr: -1 * 1 + -1 * -.5 = -.5 + 1.5 = 1
  br: 1 * 1 + 1 * -.5 = .5 + 1.5 = 2
  bl: 1 * 2 + 1 * -.5 = 1.5 + 1.5 = 3
  t|b * l|r + t|b * -.5
  t = -1
  b = 1
  l = 2
  r = 1
  */

  float tb = float(direction.y < 0.0) * -2.0 + 1.0; // t = 1 * -2 + 1; b = 0 * -2 + 1
  float lr = float(direction.x < 0.0) + 1.0; // l = 1 + 1; r = 0 + 1
  return int((tb * lr) + (tb * -0.5) + 1.5);

  // Original approach:
  // if ( direction.x > 0.0 ) return direction.y > 0.0 ? BR : TR;
  // Moving left. x <= 0.0.
  // return direction.y > 0.0 ? BL : TL;
}

/**
 * Determine where a ray intersects the canvas edge.
 * @param {Ray2d} r
 * @returns {vec2}
 */
vec2 canvasEdgeIntersection(in Ray2d r) {
  // A ray of a given direction only has two edges that it could conceivably hit.
  // (Assuming it starts inside the rectangle.)
  const int TL = 0;
  const int TR = 1;
  const int BR = 2;
  const int BL = 3;
  vec2[4] sceneRect = constructSceneRect();
  int quad = directionalQuadrant(r.direction);
  int idx0 = (quad == TL || quad == TR) ? TL : BR;
  int idx1 = (quad == TL || quad == BL) ? TL : TR;
  Ray2d edge0 = Ray2d(sceneRect[idx0], normalizedDirection(sceneRect[idx0], sceneRect[idx0 + 1]));
  Ray2d edge1 = Ray2d(sceneRect[idx1], normalizedDirection(sceneRect[idx1], sceneRect[idx1 + 1]));

  float t0;
  float t1;
  bool hasIx0 = lineLineIntersection(r, edge0, t0);
  bool hasIx1 = lineLineIntersection(r, edge1, t1);
  if ( hasIx0 && (!hasIx1 || t0 < t1) ) return projectRay(r, t0);
  return projectRay(r, t1);
}

/**
 * Determine what canvas edge a ray intersects.
 * @param {Ray2d} r
 * @returns {Ray2d}
 */
Ray2d whichCanvasEdge(in Ray2d r) {
  // A ray of a given direction only has two edges that it could conceivably hit.
  // (Assuming it starts inside the rectangle.)
  const int TL = 0;
  const int TR = 1;
  const int BR = 2;
  const int BL = 3;
  vec2[4] sceneRect = constructSceneRect();
  int quad = directionalQuadrant(r.direction);
  int idx0 = (quad + 4 - 1) % 4;
  int idx1 = quad;
  int idx2 = (quad + 1) % 4;
  Ray2d edge0 = Ray2d(sceneRect[idx0], normalizedDirection(sceneRect[idx0], sceneRect[idx1]));
  Ray2d edge1 = Ray2d(sceneRect[idx1], normalizedDirection(sceneRect[idx1], sceneRect[idx2]));

  float t0;
  float t1;
  bool hasIx0 = lineLineIntersection(r, edge0, t0);
  bool hasIx1 = lineLineIntersection(r, edge1, t1);
  if ( hasIx0 && (!hasIx1 || t0 < t1) ) return edge0;
  return edge1;
}

/**
 * For infinite wall shadow, point outside of canvas that can be the fake floor intersection.
 * Either a point on the 45º line at a scene corner or a scene edge point.
 * @param {Ray2d[2]} lightRays
 * @returns {Ray2d}
 */
Ray2d infiniteShadowCanvasRay(in Ray2d[2] lightRays) {
  // What edge does each ray hit?
  Ray2d edge0 = whichCanvasEdge(lightRays[0]);
  Ray2d edge1 = whichCanvasEdge(lightRays[1]);
  if ( all(equal(edge0.origin, edge1.origin)) ) return edge0; // For scene edges, origin is distinct (1 of 4 corners).

  // Rays hit two distinct edges.
  // If the edges intersect:
  // Use an ray that intersects the corner perpendicular to the midpoint of the two rays.
  // (This prevents the connecting ray from hitting the canvas or intersecting at the
  // wrong side of the light rays.)
  vec2 corner;
  vec2 midDir = (lightRays[0].direction + lightRays[1].direction) * 0.5;
  if ( lineLineIntersection(edge0, edge1, corner) ) return Ray2d(corner, vec2(midDir.y, -midDir.x));

   // The rays are striking parallel edges. Test quadrants to determine edge vs corner.
   int quad0 = directionalQuadrant(lightRays[0].direction);
   int quad1 = directionalQuadrant(lightRays[1].direction);

   // If adjacent quadrants, use scene edge.
   if ( quad0 == ((quad1 + 1) % 4) // +3 equivalent to -1 + 4
     || quad0 == ((quad1 + 3) % 4) ) return whichCanvasEdge(Ray2d(lightRays[0].origin, midDir));

   // Opposing quadrants; must use the corner.
   // if ( quad0 == ((quad1 + 2) % 4) ) corner = (quad0 + 1) % 4;
   int cornerIdx = directionalQuadrant(midDir);
   return Ray2d(constructSceneRect()[cornerIdx], vec2(midDir.y, -midDir.x));
}

/**
 * Given a triangle ∆ABC, construct a similar triangle such that B and C
 * fall on or outside the canvas edge, and BC is entirely on or outside the canvas edge.
 * @param {vec2[3]} tri
 * @returns {vec2[3]} tri
 */
vec2[3] extendTriangleToCanvasEdge(in vec2[3] tri) {
  // Edges A->B and A->C can intersect closest to the:
  // • same quadrant (1 point),
  // • adjacent quadrants (2 points), or
  // • opposing quadrants (3 points, middle one counts).
  vec2 A = tri[0];
  vec2 B = tri[1];
  vec2 C = tri[2];
  Ray2d AB = Ray2d(A, normalizedDirection(A, B));
  Ray2d AC = Ray2d(A, normalizedDirection(A, C));
  Ray2d canvasEdge = infiniteShadowCanvasRay(Ray2d[2](AB, AC));

  // Use the smaller triangle edge to intersect the canvas edge.
  float dist2AB = distanceSquared(A, B);
  float dist2AC = distanceSquared(A, C);

  // Cannot use ternary with structs.
  Ray2d smallerEdge;
  Ray2d largerEdge;
  bool smallerAB = dist2AB < dist2AC;
  if ( smallerAB ) {
    smallerEdge = AB;
    largerEdge = AC;
  } else {
    smallerEdge = AC;
    largerEdge = AB;
  }

  vec2 ixSmaller;
  lineLineIntersection(smallerEdge, canvasEdge, ixSmaller);

  // Then connect using the B->C (or C->B) direction to the other triangle edge.
  Ray2d newBC = Ray2d(ixSmaller, normalizedDirection(B, C));
  vec2 ixLarger;
  lineLineIntersection(largerEdge, newBC, ixLarger);

  if ( smallerAB ) return vec2[3](A, ixSmaller, ixLarger);
  else return vec2[3](A, ixLarger, ixSmaller);
}

/**
 * Does this source cast an infinite shadow?
 * (Ray is rising as it moves from light --> wall.)
 * @param {vec3} samplePt   The sample point or direction
 * @returns {bool}
 */
bool isInfiniteTopShadow(in vec3 samplePt) {
  float topZ = aWallCorner0.z;
  return samplePt.z <= topZ;
}

bool isInfiniteBottomShadow(in vec3 samplePt) {
  float bottomZ = aWallCorner1.z;
  return samplePt.z <= bottomZ;
}

/**
 * The furthest point of the shadow when running a ray from the light through the
 * top midpoint of the wall.
 * @param {vec3} samplePt   The sample point or direction
 * @param {vec3} wallPt
 * @param {out vec3} ixP
 * @returns {bool};
 */
bool furthestShadowPoint(in vec3 samplePt, in vec3 wallPt, out vec3 ixP) {
  // For basic version, assume an unsized light: use the centerpoint.
  Plane canvasPlane = constructCanvasPlane();
  Ray rAWall = Ray(samplePt, wallPt - samplePt);
  return intersectRayPlane(rAWall, canvasPlane, ixP);
}

/**
 * For a given light center, determine the shadow triangle.
 * @param {vec3} O      The assumed center point of the light
 * @param {Wall} wall   The associated wall
 * @returns {vec2[3]}  Triangle, from center through endpoint a and then endpoint b.
 */
vec2[3] shadowTriangle(in vec3 O, in Wall wall) {
  vec2 a = wall.top[0].xy;
  vec2 b = wall.top[1].xy;
  if ( almostEqual(orient(O.xy, a, b), 0.0, 1e-06) ) {
    // The triangle is a line.
    if ( isInfiniteTopShadow(O) ) {
      // Where O --> wall intersects the canvas edge.
      Ray2d rWall = Ray2d(O.xy, a - O.xy);
      Ray2d edge = whichCanvasEdge(rWall);
      vec2 ix;
      lineLineIntersection(rWall, edge, ix);
      return vec2[3](O.xy, ix, ix);
    }
    // Where O --> further wall endpoint intersects the canvas plane.
    vec3 ixP;
    furthestShadowPoint(O, wall.top[1], ixP); // Wall 1 is further.
    return vec2[3](O.xy, ixP.xy, ixP.xy);
  }

  // For infinite shadow, extend triangle formed by light point and wall to the edge of the canvas.
  if ( isInfiniteTopShadow(O) ) return extendTriangleToCanvasEdge(vec2[3](O.xy, a, b));

  // For non-infinite, intersect the canvas plane to determine extension point.
  Plane canvasPlane = constructCanvasPlane();
  vec3 ixP;
  if ( !furthestShadowPoint(O, wall.top[1], ixP) ) return extendTriangleToCanvasEdge(vec2[3](O.xy, a, b));
  Ray2d rWallIx = Ray2d(ixP.xy, b - a);
  Ray2d rOa = Ray2d(O.xy, a - O.xy);
  Ray2d rOb = Ray2d(O.xy, b - O.xy);
  vec2 B;
  vec2 C;
  lineLineIntersection(rWallIx, rOa, B);
  lineLineIntersection(rWallIx, rOb, C);
  return vec2[3](O.xy, B, C);
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
  vec3 wallTopMid = vec3(wall.mid, wall.top[0].z);
  vec3 canvasIx;
  if ( !isInfiniteTopShadow(nearFarDir)
    && intersectRayPlane(Ray(wallTopMid, nearFarDir), canvasPlane, canvasIx) ) {
    canvasRay.origin = canvasIx.xy;
    canvasRay.direction = wall.direction;
    return true;
  } else {
    canvasRay = infiniteShadowCanvasRay(sidePenumbra);
    return false;
  }
}

/**
 * Line A-->wallMid, reversed such that it starts at the closest point on that line
 * to B of penumbra ∆ABC.
 * Used to calculate near/far shadows based on elevation (and in front/behind wall).
 * @param {Wall} wall
 * @param {vec2[3]} penumbraTri
 * @returns {Ray2d}
 */
Ray2d nearFarMidRay(in Wall wall, in vec2[3] penumbraTri) {
  float dist01 = distanceSquared(penumbraTri[0], penumbraTri[1]);
  float dist02 = distanceSquared(penumbraTri[0], penumbraTri[2]);
  int closerIdx = dist02 < dist01 ? 2 : 1;
  Ray2d lightRay2d = Ray2d(penumbraTri[0], normalizedDirection(penumbraTri[0], wall.mid));
  vec2 closerIx;
  lineLineIntersection(lightRay2d, Ray2d(penumbraTri[closerIdx], wall.direction), closerIx);
  return Ray2d(closerIx, penumbraTri[0] - closerIx);
}

/**
 * The line that defines the left/right sides of the penumbra in relation to the wall.
 * @param {Wall} wall
 * @param {bool} isCollinear
 * @returns {Ray2d}
 */
Ray2d leftRightBisector(in Wall wall, in bool isCollinear) {
  if ( isCollinear ) return Ray2d(wall.mid, wall.direction);
  return Ray2d(wall.mid, vec2(-wall.direction.y, wall.direction.x));
}

/**
 * The line that defines the front/back sides of the penumbra in relation to the wall.
 * @param {Wall} wall
 * @param {bool} isCollinear
 * @returns {Ray2d}
 */
Ray2d frontBackBisector(in Wall wall, in bool isCollinear) {
  if ( isCollinear ) return Ray2d(wall.top[0].xy, vec2(-wall.direction.y, wall.direction.x));
  return Ray2d(wall.mid, wall.direction);
}

/**
 * Calculate varying variables.
 * @param {Wall} wall
 * @param {vec2[3]} penumbraTri
 */
void defineSharedVaryings(Wall wall, vec2[3] penumbraTri) {
  int vertexNum = gl_VertexID % 3;

  /** @type {vec2} vVertexPosition */
  vVertexPosition = penumbraTri[vertexNum];

  // Calculate the terrain texture coordinate at this vertex based on scene dimensions.
  // (vVertexPosition - uSceneDims.xy) / uSceneDims.zw
  // @type {vec2} vTerrainTexCoord
  vTerrainTexCoord = (vVertexPosition - uSceneDims.xy) / uSceneDims.zw;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(vVertexPosition, 1.0)).xy, 0.0, 1.0);

  // @type {float} vEdgeDist              Distance from the wall line.
  // @type {vec3} vLREdgeDist     Distance left/right from wall line
  // Used to determine in front of or behind wall.
  bool isCollinear = almostEqual(penumbraTri[0], wall.top[0].xy, 1.0e-06);
  Ray2d rEdgeWall = frontBackBisector(wall, isCollinear);
  vEdgeDist = distanceToLine(vVertexPosition, rEdgeWall.origin, rEdgeWall.direction);
  if ( vertexNum == 0 ) vEdgeDist *= -1.0;

  // @type {vec3} vLREdgeDist    Triangle A --> ix --> C, where
  //   ix is the intersection of the rCollinearWall with A->B.
  vLREdgeDist = 0.0;
  if ( isCollinear && vertexNum != 0 ) {
    Ray2d rLRWall = leftRightBisector(wall, isCollinear);
    vLREdgeDist = distanceToLine(vVertexPosition, rLRWall.origin, rLRWall.direction);
    vLREdgeDist *= sign(orient(rLRWall.origin, projectRay(rLRWall, 1.0), vVertexPosition));
    // Left side is 1.0, right side is -1.0.

  }
}

/**
 * Basic flats used by all shaders to limit shadow.
 * @param {Wall} wall
 * @param {vec2[3]} penumbraTri
 */
void defineSharedFlats(Wall wall, vec2[3] penumbraTri) {
  // @type {float} fWallSenseType
  fWallSenseType = aWallSenseType;

  // @type {float} fThresholdRadius
  fThresholdRadius2 = !(aWallSenseType == DISTANCE_WALL || aWallSenseType == PROXIMATE_WALL)
    ? -1.0 : aThresholdRadius2;

  // @type {vec2} fWallHeights
  float canvasElevation = uElevationRes.x;
  fWallHeights[TOP] = wall.top[0].z - canvasElevation; // The full height of the top of the wall from lowest elevation.
  fWallHeights[BOTTOM] = wall.bottom[0].z - canvasElevation; // The full height of the bottom of the wall from lowest elevation.
}
