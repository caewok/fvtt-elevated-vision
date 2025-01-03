#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Sized Vertex 2 (LightRay sampling) ----- */

in vec4 aWallCorner0;
in vec4 aWallCorner1;
in float aWallSenseType;
in float aThresholdRadius2;

out vec2 vVertexPosition;
out vec2 vTerrainTexCoord;
out float vEdgeDist;
out float vWallRatio;

flat out float fThresholdRadius2;
flat out float fWallSenseType;
flat out vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat out float fWallRatio;
flat out vec2 fNearRatios;
flat out vec2 fFarRatios;
flat out vec3 fWallTop0;
flat out vec3 fWallTop1;
flat out vec3 fWallBottom0;
flat out vec3 fWallBottom1;


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
${defineFunction("sameSide")}

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
Light calculateLightPositions() {
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
 * Offset the circle center from the wall by some distance.
 * If collinear with the wall, move in the direction of the wall but keep collinearity.
 * If non-collinear with the wall, move away from wall.
 * @param {Light} light
 * @param {Wall} wall
 * @param {float} d
 * @returns {vec2} New circle center
 */
vec2 offsetLightFromWall(in Light light, in Wall wall, in float d) {
  return projectRay(Ray2d(light.center.xy, vec2(wall.direction.y, -wall.direction.x)), d);
}

/**
 * Swap two indices in the tangent array.
 * @param {inout Ray2d[4]} tangentRays
 * @param {inout vec2[4]} projectedPoints
 * @param {int} idx0
 * @param {int} idx1
 */
void _cmpSwapTangentRays(inout Ray2d[4] tangentRays, inout vec2[4] projectedPoints, int idx0, int idx1) {
  if ( orient(tangentRays[idx0].origin, projectedPoints[idx0], projectedPoints[idx1]) > 0.0 ) {
    Ray2d tmpRay = tangentRays[idx0];
    tangentRays[idx0] = tangentRays[idx1];
    tangentRays[idx1] = tmpRay;
    vec2 tmpVec = projectedPoints[idx0];
    projectedPoints[idx0] = projectedPoints[idx1];
    projectedPoints[idx1] = tmpVec;
  }
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

  // Determine which side the tangents are on. Penumbra: cross; umbra: same.
  // Penumbra and umbra switch when the wall is nearly vertical.
  // Penumbra form the intersection closest to the light
  Ray2d[2] midpenumbra = Ray2d[2](
    Ray2d(wall0, normalizedDirection(light.center.xy, wall0)),
    Ray2d(wall1, normalizedDirection(light.center.xy, wall1))
  );

  // First determine the tangent points of the circle.
  Circle lightCir = Circle(
    light.center.xy, // Center
    uLightSize       // Radius
  );
  vec2[2] tangents0 = vec2[2](lightCir.center, lightCir.center);
  vec2[2] tangents1 = vec2[2](lightCir.center, lightCir.center);
  tangentPoints(lightCir, wall0, tangents0);
  tangentPoints(lightCir, wall1, tangents1);

  // If the light overlaps the wall, the penumbra shoot straight out along the wall.
  // Redo the penumbra tangents by shrinking the light to be just smaller than distance to wall.
  float distToWall = distanceToSegment(light.center.xy, wall0, wall1);
  if ( distToWall <= uLightSize ) {
    Circle lightCirSmall = Circle(
      light.center.xy,              // Center
      max(distToWall - 1.0, 0.0)    // Radius
    );

    // If light center is on the wall, offset.
    if ( almostEqual(distToWall, 0.0, 1.0e-06) ) {
      lightCirSmall.center = offsetLightFromWall(light, wall, 0.5);
      midpenumbra[0].direction = normalizedDirection(lightCirSmall.center, wall0);
      midpenumbra[1].direction = normalizedDirection(lightCirSmall.center, wall1);
    }

    vec2[2] tangents0sm = vec2[2](lightCir.center, lightCir.center);
    vec2[2] tangents1sm = vec2[2](lightCir.center, lightCir.center);
    tangentPoints(lightCirSmall, wall0, tangents0sm);
    tangentPoints(lightCirSmall, wall1, tangents1sm);

    // Umbra are on the light center side.
    float oLight = orient(wall.top[0].xy, wall.top[1].xy, light.center.xy);
    int idxU0 = sameSide(wall.top[0].xy, wall.top[1].xy, oLight, tangents0[0]) ? 0 : 1;
    int idxU1 = sameSide(wall.top[0].xy, wall.top[1].xy, oLight, tangents1[0]) ? 0 : 1;

    // Penumbra are closest to the wall.
    float distToWall2_00 = distanceSquaredToLine(tangents0sm[0], wall0, wall.direction);
    float distToWall2_01 = distanceSquaredToLine(tangents0sm[1], wall0, wall.direction);
    float distToWall2_10 = distanceSquaredToLine(tangents1sm[0], wall0, wall.direction);
    float distToWall2_11 = distanceSquaredToLine(tangents1sm[1], wall0, wall.direction);
    int idxP0 = distToWall2_00 < distToWall2_01 ? 0 : 1;
    int idxP1 = distToWall2_10 < distToWall2_11 ? 0 : 1;

    // Use the original umbra tangents and the new penumbra tangents from the smaller circle.
    tangents0[1] = tangents0[idxU0];
    tangents1[1] = tangents1[idxU1];
    tangents0[0] = tangents0sm[idxP0];
    tangents1[0] = tangents1sm[idxP1];
  }

  // Build the rays for each tangent to associate them with the correct wall point.
  Ray2d[4] tangentRays = Ray2d[4](
    Ray2d(wall0, normalizedDirection(tangents0[0], wall0)),
    Ray2d(wall0, normalizedDirection(tangents0[1], wall0)),
    Ray2d(wall1, normalizedDirection(tangents1[0], wall1)),
    Ray2d(wall1, normalizedDirection(tangents1[1], wall1))
  );

  // Penumbra are on the outside, umbra are on the inside.
  // Sort so the rays are oriented accordingly.
  // Rays may cross near wall so extend accordingly.
  float maxR2 = maxR2();
  vec2[4] projectedPoints = vec2[4](
    projectRay(tangentRays[0], maxR2),
    projectRay(tangentRays[1], maxR2),
    projectRay(tangentRays[2], maxR2),
    projectRay(tangentRays[3], maxR2)
  );

  // Bubble sort
  _cmpSwapTangentRays(tangentRays, projectedPoints, 0, 1);
  _cmpSwapTangentRays(tangentRays, projectedPoints, 0, 2);
  _cmpSwapTangentRays(tangentRays, projectedPoints, 0, 3);
  _cmpSwapTangentRays(tangentRays, projectedPoints, 1, 2);
  _cmpSwapTangentRays(tangentRays, projectedPoints, 1, 3);
  _cmpSwapTangentRays(tangentRays, projectedPoints, 2, 3);

  /* Example scenario
  [4, 2, 1, 3]

  [2, 4, 1, 3] 0, 1
  [1, 4, 2, 3] 0, 2
  [1, 4, 2, 3] 0, 3

  [1, 2, 4, 3] 1, 2
  [1, 2, 4, 3] 1, 3

  [1, 2, 3, 4] 2, 3
  */
  // Penumbra are 0, 3; umbra are 1, 2.
  int idx0 = all(equal(tangentRays[0].origin, wall0)) ? 0 : 1;
  Ray2d[2] penumbra;
  penumbra[idx0] = tangentRays[0];
  penumbra[1 - idx0] = tangentRays[3];

  idx0 = all(equal(tangentRays[1].origin, wall0)) ? 0 : 1;
  Ray2d[2] umbra;
  umbra[idx0] = tangentRays[1];
  umbra[1 - idx0] = tangentRays[2];

  return ShadowRays2d(
    umbra,
    midpenumbra,
    penumbra
  );
}

/**
 * For non-infinite shadow, non-collinear.
 * @param {ShadowRays2d} sideShadowRays
 * @param {ShadowDirections} farShadowDirs
 * @param {Wall} wall
 * @param {out vec2} A...I, W0, W1
 * @returns {bool} True if nearly collinear wall to the light.
 */
void _shadowPoints(in ShadowRays2d sideShadowRays, in Light light, in Wall wall,
  inout vec2 A,
  inout vec2 B,
  inout vec2 C,
  inout vec2 D,
  inout vec2 E,
  inout vec2 F,
  inout vec2 G,
  inout vec2 H,
  inout vec2 I,
  inout vec2 W0,
  inout vec2 W1) {
  // The DE penumbra ray runs through the closer endpoint.
  int closerIdx = sideShadowRays.penumbra[0].origin.x == W0.x
    && sideShadowRays.penumbra[0].origin.y == W0.y ? 0 : 1;
  Ray2d rAB = sideShadowRays.penumbra[closerIdx];
  Ray2d rAC = sideShadowRays.penumbra[1 - closerIdx];
  Ray2d rD_penumbra = rAB;
  Ray2d rG_penumbra = rAC;

  // The DF umbra ray runs through the further endpoint.
  int furtherIdx = sideShadowRays.umbra[0].origin.x == W1.x
    && sideShadowRays.umbra[0].origin.y == W1.y ? 0 : 1;
  Ray2d rD_umbra = sideShadowRays.umbra[furtherIdx];
  Ray2d rG_umbra = sideShadowRays.umbra[1 - furtherIdx];

  // D and G are the intersections of the penumbra with opposite umbra.
  lineLineIntersection(rD_penumbra, rD_umbra, D);
  lineLineIntersection(rG_penumbra, rG_umbra, G);

  // Locate the canvas intersection.
  // Intersection with the canvas gives us the furthest and nearest penumbra/umbra points.
  Plane canvasPlane = constructCanvasPlane();
  float wallTopZ = wall.top[0].z;
  vec3 mid3d = vec3(wall.mid, wallTopZ);
  vec3[2] tangents3d;
  Ray rP;
  if ( verticalTangentPoints(mid3d, light.center, uLightSize, tangents3d) ) {
    // Should always have tangents.
    int idx = int(tangents3d[0].z > tangents3d[1].z);
    vec3 penumbraTangent = tangents3d[idx]; // Lower point
    rP = Ray(penumbraTangent, mid3d - penumbraTangent);
  } else {
    // Just in case; use the light mid point --> wall mid.
    rP = Ray(light.center, vec3(wall.mid, wall.top[0].z) - light.center);
  }

  vec3 ixP;
  intersectRayPlane(rP, canvasPlane, ixP);

  // Can determine F and I (furthest points) using wall direction.
  Ray2d rPWallDir = Ray2d(ixP.xy, wall.direction);
  lineLineIntersection(rPWallDir, rD_umbra, F);
  lineLineIntersection(rPWallDir, rG_umbra, I);

  // For non-collinear, same wall direction applies for determining E and H.
  lineLineIntersection(rPWallDir, rD_penumbra, E);
  lineLineIntersection(rPWallDir, rG_penumbra, H);

  // Intersect penumbra with F->I line to get B and C.
  // For non-collinear, this will equal E and H
  // Ray2d rEF = Ray2d(E, F - E);
  // lineLineIntersection(rPWallDir, rD_penumbra, rEF, B);
  // lineLineIntersection(rPWallDir, rG_umbra, rEF, C);
  B = E;
  C = H;
}

/**
 * For non-infinite shadow, non-collinear.
 * @param {ShadowRays2d} sideShadowRays
 * @param {ShadowDirections} farShadowDirs
 * @param {Wall} wall
 * @param {out vec2} A...I, W0, W1
 * @returns {bool} True if nearly collinear wall to the light.
 */
void _shadowPointsCollinear(in ShadowRays2d sideShadowRays, in Light light, in Wall wall,
  inout vec2 A,
  inout vec2 B,
  inout vec2 C,
  inout vec2 D,
  inout vec2 E,
  inout vec2 F,
  inout vec2 G,
  inout vec2 H,
  inout vec2 I,
  inout vec2 W0,
  inout vec2 W1) {
  A = W0;

  // The DE penumbra ray runs through the closer endpoint.
  int closerIdx = sideShadowRays.penumbra[0].origin.x == W0.x
    && sideShadowRays.penumbra[0].origin.y == W0.y ? 0 : 1;
  Ray2d rAB = sideShadowRays.penumbra[closerIdx];
  Ray2d rAC = sideShadowRays.penumbra[1 - closerIdx];
  Ray2d rD_penumbra = rAB;
  Ray2d rG_penumbra = rAC;

  // The DF umbra ray runs through the further endpoint.
  int furtherIdx = sideShadowRays.umbra[0].origin.x == W1.x
    && sideShadowRays.umbra[0].origin.y == W1.y ? 0 : 1;
  Ray2d rD_umbra = sideShadowRays.umbra[furtherIdx];
  Ray2d rG_umbra = sideShadowRays.umbra[1 - furtherIdx];

  // D and G are intersections of penumbra and umbra.
  // Different than non-collienar
  lineLineIntersection(rD_penumbra, rG_umbra, D);
  lineLineIntersection(rG_penumbra, rD_umbra, G);

  // Locate the canvas intersection.
  // Intersection with the canvas gives us the furthest and nearest penumbra/umbra points.
  Plane canvasPlane = constructCanvasPlane();
  float wallTopZ = wall.top[0].z;
  vec3 mid3d = vec3(wall.mid, wallTopZ);
  vec3[2] tangents3d;
  Ray rP;

  if ( verticalTangentPoints(mid3d, light.center, uLightSize, tangents3d) ) {
    // Should always have tangents.
    int idx = int(tangents3d[0].z > tangents3d[1].z);
    vec3 penumbraTangent = tangents3d[idx]; // Lower point
    rP = Ray(penumbraTangent, mid3d - penumbraTangent);
  } else {

    // Just in case; use the light mid point --> wall mid.
    rP = Ray(light.center, vec3(wall.mid, wall.top[0].z) - light.center);
  }

  vec3 ixP;
  intersectRayPlane(rP, canvasPlane, ixP);

  // Can determine F and I using wall direction.
  vec2 wDirPerp = vec2(-wall.direction.y, wall.direction.x);
  Ray2d rW1Perp = Ray2d(ixP.xy, wDirPerp);
  lineLineIntersection(rW1Perp, rG_umbra, F);
  lineLineIntersection(rW1Perp, rD_umbra, I);

  // Can determine E and H using wall direction.
  lineLineIntersection(Ray2d(F, wall.direction), rD_penumbra, E);
  lineLineIntersection(Ray2d(I, wall.direction), rG_penumbra, H);

  // Intersect the penumbra with F->I line.
  Ray2d rFI = Ray2d(F, I - F);
  lineLineIntersection(rD_penumbra, rFI, B);
  lineLineIntersection(rG_penumbra, rFI, C);
}

/**
 * For non-infinite shadow, non-collinear.
 * @param {ShadowRays2d} sideShadowRays
 * @param {ShadowDirections} farShadowDirs
 * @param {Wall} wall
 * @param {out vec2} A...I, W0, W1
 * @returns {bool} True if nearly collinear wall to the light.
 */
void _shadowPointsInfinite(in ShadowRays2d sideShadowRays,
  inout vec2 A,
  inout vec2 B,
  inout vec2 C,
  inout vec2 D,
  inout vec2 E,
  inout vec2 F,
  inout vec2 G,
  inout vec2 H,
  inout vec2 I,
  inout vec2 W0,
  inout vec2 W1) {
  // The DE penumbra ray runs through the closer endpoint.
  int closerIdx = sideShadowRays.penumbra[0].origin.x == W0.x
    && sideShadowRays.penumbra[0].origin.y == W0.y ? 0 : 1;
  Ray2d rAB = sideShadowRays.penumbra[closerIdx];
  Ray2d rAC = sideShadowRays.penumbra[1 - closerIdx];
  Ray2d rD_penumbra = rAB;
  Ray2d rG_penumbra = rAC;

  // The DF umbra ray runs through the further endpoint.
  int furtherIdx = sideShadowRays.umbra[0].origin.x == W1.x
    && sideShadowRays.umbra[0].origin.y == W1.y ? 0 : 1;
  Ray2d rD_umbra = sideShadowRays.umbra[furtherIdx];
  Ray2d rG_umbra = sideShadowRays.umbra[1 - furtherIdx];

  // D and G are intersections of penumbra and umbra.
  // Different than non-collinear.
  lineLineIntersection(rD_penumbra, rG_umbra, D);
  lineLineIntersection(rG_penumbra, rD_umbra, G);

  // Extend ∆DEF outside the canvas.
  // Construct ∆DW0W1, ∆GW1W0 and then extend
  vec2[3] triDW0W1 = extendTriangleToCanvasEdge(vec2[3](D, W0, W1));
  E = triDW0W1[1];
  F = triDW0W1[2];

  // Intersect H and I with the E->F line.
  Ray2d rEF = Ray2d(E, F - E);
  lineLineIntersection(rG_penumbra, rEF, H);
  lineLineIntersection(rG_umbra, rEF, I);

  B = E;
  C = H;
}

/**
 * For non-infinite shadow, non-collinear.
 * @param {ShadowRays2d} sideShadowRays
 * @param {ShadowDirections} farShadowDirs
 * @param {Wall} wall
 * @param {out vec2} A...I, W0, W1
 * @returns {bool} True if nearly collinear wall to the light.
 */
void _shadowPointsInfiniteCollinear(in ShadowRays2d sideShadowRays,
  inout vec2 A,
  inout vec2 B,
  inout vec2 C,
  inout vec2 D,
  inout vec2 E,
  inout vec2 F,
  inout vec2 G,
  inout vec2 H,
  inout vec2 I,
  inout vec2 W0,
  inout vec2 W1) {
  A = W0;

  // The DE penumbra ray runs through the closer endpoint.
  int closerIdx = sideShadowRays.penumbra[0].origin.x == W0.x
    && sideShadowRays.penumbra[0].origin.y == W0.y ? 0 : 1;
  Ray2d rAB = sideShadowRays.penumbra[closerIdx];
  Ray2d rAC = sideShadowRays.penumbra[1 - closerIdx];
  Ray2d rD_penumbra = rAB;
  Ray2d rG_penumbra = rAC;

  // The DF umbra ray runs through the further endpoint.
  int furtherIdx = sideShadowRays.umbra[0].origin.x == W1.x
    && sideShadowRays.umbra[0].origin.y == W1.y ? 0 : 1;
  Ray2d rD_umbra = sideShadowRays.umbra[furtherIdx];
  Ray2d rG_umbra = sideShadowRays.umbra[1 - furtherIdx];

  // D and G are the intersections of the penumbra with opposite umbra.
  lineLineIntersection(rD_penumbra, rD_umbra, D);
  lineLineIntersection(rG_penumbra, rG_umbra, G);

  // Extend ∆DEF outside the canvas.
  // Construct ∆DW0W1, ∆GW1W0 and then extend
  vec2[3] triDW0W1 = extendTriangleToCanvasEdge(vec2[3](D, W0, W1));
  E = triDW0W1[1];
  F = triDW0W1[2];

  // Extend ∆GHI outside the canvas.
  vec2[3] triGW0W1 = extendTriangleToCanvasEdge(vec2[3](G, W0, W1));
  H = triGW0W1[1];
  I = triGW0W1[2];

  // Intersect the penumbra with F->I line.
  Ray2d rFI = Ray2d(F, I - F);
  lineLineIntersection(rD_penumbra, rFI, B);
  lineLineIntersection(rG_penumbra, rFI, C);
}

/**
 * For infinite shadow, construct the different points of the triangle.
 * @param {ShadowRays2d} sideShadowRays
 * @param {ShadowDirections} farShadowDirs
 * @param {Wall} wall
 * @param {out vec2} A...I, W0, W1
 * @returns {bool} True if nearly collinear wall to the light.
 */
bool shadowPoints(in ShadowRays2d sideShadowRays, in ShadowDirections farShadowDirs, in Light light, in Wall wall,
  inout vec2 A,
  inout vec2 B,
  inout vec2 C,
  inout vec2 D,
  inout vec2 E,
  inout vec2 F,
  inout vec2 G,
  inout vec2 H,
  inout vec2 I,
  inout vec2 W0,
  inout vec2 W1) {

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

  // If W0 == A, then the wall is nearly collinear with the light (line from wall intersects light circle).
  bool nearCollinear = almostEqual(W0, A, 1.0e-08);
  bool infiniteShadow = isInfiniteShadow(farShadowDirs.penumbra);
  /*
  if ( nearCollinear && infiniteShadow ) {
    _shadowPointsInfiniteCollinear(sideShadowRays, A, B, C, D, E, F, G, H, I, W0, W1);
  } else if ( nearCollinear ) {
    _shadowPointsCollinear(sideShadowRays, light, wall, A, B, C, D, E, F, G, H, I, W0, W1);
  } else if ( infiniteShadow ) {
    _shadowPointsInfinite(sideShadowRays, A, B, C, D, E, F, G, H, I, W0, W1);
  } else {
    _shadowPoints(sideShadowRays, light, wall, A, B, C, D, E, F, G, H, I, W0, W1);
  }
  */
  _shadowPoints(sideShadowRays, light, wall, A, B, C, D, E, F, G, H, I, W0, W1);

  /*
  switch ( (int(infiniteShadow) * 2) + int(nearCollinear) ) {
    case 0: _shadowPoints(sideShadowRays, light, wall, A, B, C, D, E, F, G, H, I, W0, W1); break;
    case 1: _shadowPointsCollinear(sideShadowRays, light, wall, A, B, C, D, E, F, G, H, I, W0, W1); break;
    case 2: _shadowPointsInfinite(sideShadowRays, A, B, C, D, E, F, G, H, I, W0, W1); break;
    case 3: _shadowPointsInfiniteCollinear(sideShadowRays, A, B, C, D, E, F, G, H, I, W0, W1); break;
  }
  */

  // For debugging, test side shadows
  /*
  Ray2d r0 = sideShadowRays.penumbra[0];
  Ray2d r1 = sideShadowRays.penumbra[1];
  lineLineIntersection(r0, r1, A);
  B = projectRay(r0, 2000.0);
  C = projectRay(r1, 2000.0);
  */
  A = G;
  B = H;
  C = I;


  /* Debugging
  B = projectRay(Ray2d(A, normalize(B - A)), 2000.0);
  C = projectRay(Ray2d(A, normalize(C - A)), 2000.0);
  */


  return nearCollinear;
}



/**
 * Define the different shadow triangles.
 * @param {ShadowRays2d} sideShadowRays
 * @param {ShadowDirections} farShadowDirs
 * @param {Wall} wall
 * @param {out vec2[3]} penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1
 * @returns {bool} True if the wall is nearly collinear.
 */
bool shadowTriangles(in ShadowRays2d sideShadowRays, in ShadowDirections farShadowDirs, in Light light, in Wall wall,
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
  bool nearCollinear = shadowPoints(sideShadowRays, farShadowDirs, light, wall,
    A, B, C, D, E, F, G, H, I, W0, W1);

  // Define the triangles.
  penumbraTri = vec2[3](A, B, C);
  nearFarTri0 = vec2[3](D, E, F);
  nearFarTri1 = vec2[3](G, H, I);

  // Side triangles used for gradient shading. Vary based on wall location relative to light.
  sideTri0 = vec2[3](W0, B, I);
  sideTri1 = vec2[3](W1, C, F);
  if ( nearCollinear ) {
    sideTri0 = vec2[3](W0, B, W1);
    sideTri1 = vec2[3](W0, C, W1);

    // Used to shade the portion unblocked by the wall, after the endpoints.
    // Lightest along the line of the wall. To replicate, connect the umbra triangle using
    // edge perpendicular to the wall.
    vec2 perpDir = vec2(wall.direction.y, -wall.direction.x);
    if ( distanceSquared(W1, I) < distanceSquared(W1, F) ) {
      vec2 newF;
      lineLineIntersection(Ray2d(W1, normalizedDirection(W1, F)), Ray2d(I, perpDir), newF);
      umbraTri = vec2[3](W1, I, newF);
    } else {
      vec2 newI;
      lineLineIntersection(Ray2d(W1, normalizedDirection(W1, I)), Ray2d(F, perpDir), newI);
      umbraTri = vec2[3](W1, newI, F);
    }
  }

  // Change the side triangles to isoceles so gradient shading works.
  // sideTri0 = makeIsoceles(sideTri0); // Need to set sideTri to inout if using
  // sideTri1 = makeIsoceles(sideTri1); // Need to set sideTri to inout if using
  return nearCollinear;
}

/**
 * Calculate the flat variables
 * @param {Wall} wall
 */
void defineFlats(in Wall wall) {
  // @type {vec3} Wall data
  fWallTop0 = wall.top[0];
  fWallTop1 = wall.top[1];
  fWallBottom0 = wall.bottom[0];
  fWallBottom1 = wall.bottom[1];
}

void main() {
  // Defined constants.
  int vertexNum = gl_VertexID % 3;
  Wall wall = calculateWallPositions();
  Light light = calculateLightPositions();

  // Side shadows.
  ShadowRays2d sideShadowRays = calculateSideShadowRays(wall, light);

  // Far direction.
  ShadowDirections farShadowDirs = calculateFarShadowDirections(wall, light);

  // Triangles defining parts of the shadow.
  vec2[3] penumbraTri;
  vec2[3] umbraTri; // Gradient shading.
  vec2[3] nearFarTri0; // Defining near and far shadows.
  vec2[3] nearFarTri1; // Defining near and far shadows.
  vec2[3] sideTri0; // Gradient shading.
  vec2[3] sideTri1; // Gradient shading.
  bool nearCollinear = shadowTriangles(sideShadowRays, farShadowDirs, light, wall,
    penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1);

  // Varyings
  defineSharedVaryings(wall, penumbraTri);

  // Flats
  if ( vertexNum == 2) {
    defineSharedFlats(wall, penumbraTri);
    defineFlats(wall);
  }
}