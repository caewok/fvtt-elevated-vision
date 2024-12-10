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
  vec2 wallDir2d = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
  vec2 wallMid2d = (wall.top[0].xy + wall.top[1].xy) * 0.5;
  Ray2d lightRay2d = Ray2d(penumbraTri[0], normalizedDirection(penumbraTri[0], wallMid2d));
  vec2 closerIx;
  lineLineIntersection(lightRay2d, Ray2d(penumbraTri[closerIdx], wallDir2d), closerIx);
  return Ray2d(closerIx, penumbraTri[0] - closerIx);
}

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

/**
 * Define the varying wall ratio.
 * How far the vertex is along the line running from vertex 0 through mid-wall.
 * @param {Wall} wall
 * @param {vec2[3]} penumbraTri
 * @returns {float}
 */
float varyingWallRatio(in Wall wall, in vec2[3] penumbraTri) {
  int vertexNum = gl_VertexID % 3;

  // Define the wall ratio as 1 at the first vertex and 0 at the shorter of the two edges.
  // For the third, it is the value at the wall direction intersection with the line
  // from first vertex through the wall midpoint.
  if ( vertexNum == 0 ) return 1.0;

  // The closer vertex to the wall gets assigned 0.0.
  float dist01 = distanceSquared(penumbraTri[0], penumbraTri[1]);
  float dist02 = distanceSquared(penumbraTri[0], penumbraTri[2]);
  int closerIdx = dist02 < dist01 ? 2 : 1;
  if ( vertexNum == closerIdx ) return 0.0;

  // If the ray from further index along the wall direction intersects the nearer index,
  // it will also get assigned 0.0. Otherwise, it is some value smaller than 0.
  int furtherIdx = (1 - closerIdx) + 2; // Either 2 or 1.
  vec2 wallDir = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
  vec2 wallMid = (wall.top[0].xy + wall.top[1].xy) * 0.5;
  Ray2d lightRay = Ray2d(penumbraTri[0], normalizedDirection(penumbraTri[0], wallMid));
  vec2 closerIx;
  lineLineIntersection(lightRay, Ray2d(penumbraTri[closerIdx], wallDir), closerIx);

  // Could use distance(closerIx, wallMid) / distance(closerIx, penumbraTri[0]).
  // That has a square root but is simpler.
  Ray2d wallRatioRay = Ray2d(closerIx, penumbraTri[0] - closerIx);
  float furtherT;
  lineLineIntersection(wallRatioRay, Ray2d(penumbraTri[vertexNum], wallDir), furtherT);

  // Often will be near zero (if penumbra triangle uses wall direction); round to zero.
  return almostEqual(furtherT, 0.0, 1.0e-06) ? 0.0 : furtherT;
}

/**
 * Define the flat wall ratio.
 * How far the wall along the line running from vertex 0 through mid-wall,
 * where 1.0 would be at vertex 0 and 0.0 would be at the closer of vertices 2 or 3.
 * @param {Wall} wall
 * @param {vec2[3]} penumbraTri
 * @returns {float}
 */
float flatWallRatio(in Wall wall, in vec2[3] penumbraTri) {
  float dist01 = distanceSquared(penumbraTri[0], penumbraTri[1]);
  float dist02 = distanceSquared(penumbraTri[0], penumbraTri[2]);
  int closerIdx = dist02 < dist01 ? 2 : 1;
  vec2 wallDir = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
  vec2 wallMid = (wall.top[0].xy + wall.top[1].xy) * 0.5;
  Ray2d lightRay = Ray2d(penumbraTri[0], normalizedDirection(penumbraTri[0], wallMid));
  vec2 closerIx;
  lineLineIntersection(lightRay, Ray2d(penumbraTri[closerIdx], wallDir), closerIx);

  // Could use distance(closerIx, wallMid) / distance(closerIx, penumbraTri[0]).
  // That has a square root but is simpler.
  Ray2d wallRatioRay = Ray2d(closerIx, penumbraTri[0] - closerIx);
  float furtherT;
  lineLineIntersection(wallRatioRay, Ray2d(wall.top[0].xy, wallDir), furtherT);
  return furtherT;
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

  // @type {float} vEdgeDist
  // Used to determine in front of or behind wall.
  // Simpler than wall ratio, but may want to use that instead.
  vEdgeDist = distanceToLine(vVertexPosition, wall.top[0].xy,
    normalizedDirection(wall.top[0].xy, wall.top[1].xy));
  if ( vertexNum == 0 ) vEdgeDist *= -1.0;

  // @type {float} vWallRatio
  vWallRatio = varyingWallRatio(wall, penumbraTri);
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

  // @type {float} fWallRatio
  fWallRatio = flatWallRatio(wall, penumbraTri);

  // @type {vec2} fWallHeights
  fWallHeights[TOP] = wall.top[0].z;
  fWallHeights[BOTTOM] = wall.bottom[0].z;

  // @type {vec2} fFarRatio, fNearRatio, using UMBRA, PENUMBRA.
  // Uses -1.0 to indicate no shadow.
  fFarRatios = vec2(-1.0, -1.0);
  fNearRatios = vec2(-1.0, -1.0);
}
