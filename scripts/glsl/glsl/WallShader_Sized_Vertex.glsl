#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Sized Vertex ----- */

in vec4 aWallCorner0;
in vec4 aWallCorner1;
in float aWallSenseType;
in float aThresholdRadius2;

out vec2 vVertexPosition;
out vec2 vTerrainTexCoord;
out vec3 vPenumbra;
out vec3 vSidePenumbra0;
out vec3 vSidePenumbra1;
out vec3 vUmbra;
out float vEdgeDist;
out float vWallRatio;

flat out float fWallSenseType;
flat out float fThresholdRadius2;
flat out vec2 fWallHeights; // r: topZ to canvas bottom; g: bottomZ to canvas bottom
flat out vec2 fWallRatios;
flat out vec2 fFarRatios0;
flat out vec2 fFarRatios1;
flat out vec2 fNearRatios0;
flat out vec2 fNearRatios1;
flat out vec2 fAmbient;
flat out float fWallRatio;
flat out vec2 fNearRatios;
flat out vec2 fFarRatios;

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
${defineFunction("closest2dPointToSegment")}
${defineFunction("circleContainsPoint")}
${defineFunction("quadraticIntersection")}

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
 * Offset the circle center from the wall by some distance.
 * If collinear with the wall, move in the direction of the wall but keep collinearity.
 * If non-collinear with the wall, move away from wall.
 * @param {Light} light
 * @param {Wall} wall
 * @param {float} d
 * @returns {vec2} New circle center
 */
vec2 offsetLightFromWall(in Light light, in Wall wall, in float d) {
  vec2 wallDir = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
  return projectRay(Ray2d(light.center.xy, vec2(wallDir.y, -wallDir.x)), d);
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
  vec2 wallMid = (wall0 + wall1) * 0.5;
  vec2 wallDir = normalizedDirection(wall0, wall1);

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
    float distToWall2_00 = distanceSquaredToLine(tangents0sm[0], wall0, wallDir);
    float distToWall2_01 = distanceSquaredToLine(tangents0sm[1], wall0, wallDir);
    float distToWall2_10 = distanceSquaredToLine(tangents1sm[0], wall0, wallDir);
    float distToWall2_11 = distanceSquaredToLine(tangents1sm[1], wall0, wallDir);
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
  Ray2d[2] umbra = Ray2d[2](tangentRays[1], tangentRays[2]);
  Ray2d[2] penumbra = Ray2d[2](tangentRays[0], tangentRays[3]);
  return ShadowRays2d(
    umbra,
    midpenumbra,
    penumbra
  );
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
 * For infinite shadow, construct the different points of the triangle.
 * @param {ShadowRays2d} sideShadowRays
 * @param {ShadowDirections} farShadowDirs
 * @param {Wall} wall
 * @param {out vec2} A...I, W0, W1
 * @returns {bool} True if nearly collinear wall to the light.
 */
bool shadowPoints(in ShadowRays2d sideShadowRays, in ShadowDirections farShadowDirs, in Wall wall,
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
  vec2 wallMid = (W0 + W1) * 0.5;

  // If W0 == A, then the wall is nearly collinear with the light (line from wall intersects light circle).
  bool nearCollinear = almostEqual(W0, A, 1.0e-08);
  if ( nearCollinear ) A = W0;

  // The DE penumbra ray runs through the closer endpoint.
  int closerIdx = sideShadowRays.penumbra[0].origin.x == W0.x && sideShadowRays.penumbra[0].origin.y == W0.y ? 0 : 1;
  Ray2d rAB = sideShadowRays.penumbra[closerIdx];
  Ray2d rAC = sideShadowRays.penumbra[1 - closerIdx];
  Ray2d rD_penumbra = rAB;
  Ray2d rG_penumbra = rAC;

  // The DF umbra ray runs through the further endpoint.
  int furtherIdx = sideShadowRays.umbra[0].origin.x == W1.x && sideShadowRays.umbra[0].origin.y == W1.y ? 0 : 1;
  Ray2d rD_umbra = sideShadowRays.umbra[furtherIdx];
  Ray2d rG_umbra = sideShadowRays.umbra[1 - furtherIdx];

  // D and G are the intersections of the penumbra with opposite umbra.
  bool hasIxD = lineLineIntersection(rD_penumbra, rD_umbra, D);
  bool hasIxG = lineLineIntersection(rG_penumbra, rG_umbra, G);

  // No intersections if the penumbra and umbra are collinear.
  // Can happen if the circle edge lines up with the wall.
  if ( !hasIxD ) D = W0;
  else if ( !hasIxG ) G = W0;

  // E intersects the D penumbra ray with the canvas line.
  //Ray2d canvasEdge;
  //Ray2d canvasEdge2;
  bool infiniteShadow = isInfiniteShadow(farShadowDirs.penumbra);
  if ( infiniteShadow ) {
    // Set E and H such that it is outside the canvas.
    // Construct ∆DW0W1, ∆GW1W0 and then extend
    if ( hasIxD ) {
      vec2[3] newDW0W1 = extendTriangleToCanvasEdge(vec2[3](D, W0, W1));
      E = newDW0W1[1];
      F = newDW0W1[2];
    } else {
      vec2 ix = canvasEdgeIntersection(rD_penumbra);
      E = ix;
      F = ix;
    }

    if ( hasIxG ) {
      vec2[3] newGW0W1 = extendTriangleToCanvasEdge(vec2[3](G, W0, W1));
      int idxH = nearCollinear ? 1 : 2;
      H = newGW0W1[idxH]; // Collinear ? 1 : 2
      I = newGW0W1[3 - idxH]; // Collinear ? 2 : 1
    } else {
      vec2 ix = canvasEdgeIntersection(rG_penumbra);
      H = ix;
      I = ix;
    }
   } else {
    // Locate the canvas intersection.
    Plane canvasPlane = constructCanvasPlane();
    vec3 canvasIx;
    intersectRayPlane(Ray(vec3(wallMid, wall.top[0].z), farShadowDirs.penumbra), canvasPlane, canvasIx);
    Ray2d canvasEdge = Ray2d(canvasIx.xy, wallDir);
    // canvasEdge2 = canvasEdge;

    lineLineIntersection(rD_penumbra, canvasEdge, E);
    lineLineIntersection(rG_umbra, canvasEdge, I); // Mirror for ∆GHI

    // Moving from E along the wall direction, we will intersect rD_umbra at F.
    Ray2d rEWall = Ray2d(E, wallDir);
    lineLineIntersection(rEWall, rD_umbra, F);

    // Mirror for ∆GHI
    Ray2d rIWall = Ray2d(I, wallDir);
    lineLineIntersection(rIWall, rG_penumbra, H);
  }
  /*
  lineLineIntersection(rD_penumbra, canvasEdge, E);
  lineLineIntersection(rG_umbra, canvasEdge2, I); // Mirror for ∆GHI

  // Moving from E along the wall direction, we will intersect rD_umbra at F.
  Ray2d rEWall = Ray2d(E, wallDir);
  lineLineIntersection(rEWall, rD_umbra, F);

  // Mirror for ∆GHI
  Ray2d rIWall = Ray2d(I, wallDir);
  lineLineIntersection(rIWall, rG_penumbra, H);
  */

  if ( nearCollinear && !infiniteShadow ) {
    // B and C are on the I and F line.
    Ray2d rIF = Ray2d(I, normalizedDirection(I, F));
    lineLineIntersection(rD_penumbra, rIF, B);
    lineLineIntersection(rG_penumbra, rIF, C);
  } else {
    // For not near-collinear, B and C will equal E and H, respectively.
    // For near-collinear for infinite shadow, E and H will already be at the canvas edge.
    // B = E;
    // C = H;
    vec2[3] newABC = extendTriangleToCanvasEdge(vec2[3](A, E, H));
    B = newABC[1];
    C = newABC[2];
  }
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
bool shadowTriangles(in ShadowRays2d sideShadowRays, in ShadowDirections farShadowDirs, in Wall wall,
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
  bool nearCollinear = shadowPoints(sideShadowRays, farShadowDirs, wall,
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
    vec2 wallDir = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
    vec2 perpDir = vec2(wallDir.y, -wallDir.x);
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
  sideTri0 = makeIsoceles(sideTri0);
  sideTri1 = makeIsoceles(sideTri1);
  return nearCollinear;
}

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
  float distToWall = distanceToSegment(uLightPosition.xy, w0, w1);
  if ( distToWall <= uLightSize ) return vec2(1.0, 0.0);
  return circleBisectorPercentArea(w0, w1, uLightPosition.xy, uLightSize);
}

/**
 * Define varyings for this shader.
 */
void defineVaryings(bool nearCollinear,
  in vec2[3] penumbraTri, in vec2[3] umbraTri,
  in vec2[3] nearFarTri0, in vec2[3] nearFarTri1,
  in vec2[3] sideTri0, in vec2[3] sideTri1) {

  int vertexNum = gl_VertexID % 3;

  // Presets for varyings.
  vPenumbra = vec3(0.0);
  vUmbra = vec3(-1.0);
  vSidePenumbra0 = vec3(-1.0);
  vSidePenumbra1 = vec3(-1.0);

  // @type {vec3} vPenumbra
  vPenumbra[vertexNum] = 1.0;

  // @type {vec3} vUmbra
  if ( nearCollinear ) vUmbra = baryForPoint(vVertexPosition, umbraTri);

  // @type {vec3} vSidePenumbra0, vSidePenumbra1
  // Define side triangles in relation to the penumbra triangle.
  // If no real side penumbra, set values to -1 to avoid inclusion.
  if ( abs(orient(sideTri0[0], sideTri0[1], sideTri0[2])) > 1.0 ) vSidePenumbra0 = baryForPoint(vVertexPosition, sideTri0);
  if ( abs(orient(sideTri1[0], sideTri1[1], sideTri1[2])) > 1.0 ) vSidePenumbra1 = baryForPoint(vVertexPosition, sideTri1);
}

/**
 * Calculate the flat variables, including near/far ratios.
 * @param {Wall} wall
 * @param {vec2} W0
 * @param {vec2} W1
 * @param {vec2[3]} sideTri0
 * @param {vec2[3]} nearFarTri0
 * @param {vec2[3]} nearFarTri1
 * @param {ShadowRays[2]} sideShadowRays
 */
void defineFlats(in Wall wall,
  in vec2[3] penumbraTri,
  in vec2[3] sideTri0,
  in ShadowDirections farShadowDirs,
  in ShadowDirections nearShadowDirs) {

  // @type {vec2} fAmbient
  int closestIdx = distanceSquared(penumbraTri[0], wall.top[1].xy) < distanceSquared(penumbraTri[0], wall.top[0].xy) ? 1 : 0;
  vec2 W0 = wall.top[closestIdx].xy;
  vec2 W1 = wall.top[1 - closestIdx].xy;

  // vec2 W0 = sideTri0[0];
  // vec2 W1 = all(equal(wall.top[0].xy, W0)) ? wall.top[0].xy : wall.top[1].xy;
  fAmbient = vec2(1.0) - ambientLight(W0, W1);
  if ( orient(W0, W1, sideTri0[1]) < 0.0 ) fAmbient = fAmbient.yx; // CW

  // Similar to unsized defineFlats.
  // For far, if umbra is infinite, penumbra will be infinite.
  bool hasFarUmbra = !isInfiniteShadow(farShadowDirs.umbra);
  bool hasFarPenumbra = !(hasFarUmbra || isInfiniteShadow(farShadowDirs.penumbra));
  bool hasNearPenumbra = wallIsFloating() && !isInfiniteShadow(nearShadowDirs.penumbra);
  bool hasNearUmbra = wallIsFloating() && !isInfiniteShadow(nearShadowDirs.umbra);
  if ( hasFarUmbra || hasFarPenumbra || hasNearPenumbra || hasNearUmbra ) {
    Ray2d wallRatioRay = nearFarMidRay(wall, penumbraTri);
    Light light = calculateLightPositions();
    Plane canvasPlane = constructCanvasPlane();
    vec2 wallDir2d = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
    if ( hasFarUmbra ) {
      if ( hasFarPenumbra ) fFarRatios[PENUMBRA] = 0.0;

      // TODO: Can we either make the far/near directions into rays or calculate them here?
      // Determine canvas intersection of the light ray running through wall midpoint. See varyingWallRatio.
      Ray lightRay = Ray(light.top, farShadowDirs.umbra);
      vec3 canvasIx;
      intersectRayPlane(lightRay, canvasPlane, canvasIx);
      lineLineIntersection(wallRatioRay, Ray2d(canvasIx.xy, wallDir2d), fFarRatios[UMBRA]);
    }

    if ( hasNearPenumbra ) {
      Ray lightRay = Ray(light.top, nearShadowDirs.penumbra);
      vec3 canvasIx;
      intersectRayPlane(lightRay, canvasPlane, canvasIx);
      lineLineIntersection(wallRatioRay, Ray2d(canvasIx.xy, wallDir2d), fNearRatios[PENUMBRA]);
    }

    if ( hasNearUmbra ) {
      Ray lightRay = Ray(light.bottom, nearShadowDirs.umbra);
      vec3 canvasIx;
      intersectRayPlane(lightRay, canvasPlane, canvasIx);
      lineLineIntersection(wallRatioRay, Ray2d(canvasIx.xy, wallDir2d), fNearRatios[UMBRA]);
    }
  }
}

/**
 * Test if the point is within the wall endpoints, meaning drawing lines perpendicular
 * to the wall would contain the point.
 * @param {Wall} wall
 * @param {vec2} pt
 * @returns {bool}
 */
bool pointBetweenWallEndpoints(in Wall wall, in vec2 pt) {
  vec2 wallDir = (wall.top[0].xy - wall.top[1].xy) * 0.5;
  vec2 perpDir = vec2(wallDir.y, -wallDir.x);
  vec2 p0 = projectRay(Ray2d(wall.top[0].xy, perpDir), 1.0);
  vec2 p1 = projectRay(Ray2d(wall.top[1].xy, perpDir), 1.0);
  return orient(wall.top[0].xy, p0, pt) * orient(wall.top[1].xy, p1, pt) < 0.0;
}

void main() {
  // Defined constants.
  int vertexNum = gl_VertexID % 3;
  Wall wall = calculateWallPositions();
  Light light = calculateLightPositions();

  // If a wall endpoint is within the light and the light center is not between the
  // endpoints, shrink the wall so it is just outside the light.
  // This avoids the light failing to display if overlapping the wall to the right/left.
  // If between the endpoints, calculateSideShadowRays will move the light accordingly.
  vec2[2] ixs;
  int numIxs = quadraticIntersection(wall.top[0].xy, wall.top[1].xy, light.center.xy, uLightSize, 1.0e-06, ixs);
  if ( numIxs == 1 ) {
    // If 1 intersection, one endpoint is in the middle of the circle. Shrink wall accordingly.
    // Determine where the intersection is on the wall.
    int containedIdx = circleContainsPoint(light.center.xy, uLightSize, wall.top[0].xy) ? 0 : 1;

    // Move pixel away to be outside the circle.
    vec2 newIx = projectRay(Ray2d(ixs[0], normalizedDirection(ixs[0], wall.top[1 - containedIdx].xy)), 1.0);

    // Update wall data.
    wall.top[containedIdx].xy = newIx.xy;
    wall.bottom[containedIdx].xy = newIx.xy;
    // wall.mid = wall.top[0].xy.add(wall.top[1].xy).multiplyScalar(0.5);
  }

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
  bool nearCollinear = shadowTriangles(sideShadowRays, farShadowDirs, wall,
    penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1);

  // Varyings
  defineSharedVaryings(wall, penumbraTri);
  defineVaryings(nearCollinear, penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1);

  // Flats
  if ( vertexNum == 2) {
    defineSharedFlats(wall, penumbraTri);
    ShadowDirections nearShadowDirs;
    if ( wallIsFloating() ) nearShadowDirs = calculateNearShadowDirections(wall, light);
    defineFlats(wall, penumbraTri, sideTri0, farShadowDirs, nearShadowDirs);
  }
}