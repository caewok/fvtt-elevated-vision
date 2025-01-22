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
out float vLREdgeDist;

flat out float fWallSenseType;
flat out float fThresholdRadius2;
flat out vec2 fWallHeights; // r: topZ to canvas bottom; g: bottomZ to canvas bottom
flat out vec2 fAmbient;
flat out vec2 fNearDistances;
flat out vec2 fFarDistances;
flat out vec2 fFarRLPenumbraDistances;
flat out vec2 fFarRLUmbraDistances;
flat out vec2 fNearRLPenumbraDistances;
flat out vec2 fNearRLUmbraDistances;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec4 uElevationRes;
uniform vec3 uLightPosition;
uniform float uLightSize;
uniform vec4 uSceneDims;

${defineStruct("Plane")}
${defineFunction("intersectRayPlane")}
${defineFunction("normalizedDirection")}
${defineFunction("normalizeRay")}
${defineStruct("Circle")}
${defineFunction("tangentPoints")}
${defineFunction("sameSide")}
${defineFunction("closest2dPointToSegment")}
${defineFunction("circleContainsPoint")}
${defineFunction("quadraticIntersection")}
${defineFunction("distanceSquared")}
${defineFunction("projectRayDistanceSquared")}
${defineFunction("distanceToLine")}

/* ----- NOTE: Functions used by Penumbra Vertex Functions ----- */

/**
 * Determine the closer and further endpoints.
 * @param {vec2[2]} pts
 * @returns {int} Index for the closer endpoint.
 */
int closerEndpoint(vec2[2] pts) {
  // Closer endpoint can be determined with relation to the light center.
  float d0 = distanceSquared(pts[0], uLightPosition.xy);
  float d1 = distanceSquared(pts[1], uLightPosition.xy);
  return int(d1 < d0);
}

${PENUMBRA_VERTEX_FUNCTIONS}

/**
 * Shrink wall to avoid overlap with light.
 * If a wall endpoint is within the light and the light center is not between the
 * endpoints, shrink the wall so it is just outside the light.
 * This avoids the light failing to display if overlapping the wall to the right/left.
 * If between the endpoints, calculateSideShadowRays will move the light accordingly.
 * @param {inout Wall} wall
 */
void shrinkOverlappingWall(inout Wall wall) {
  vec2[2] ixs;
  int numIxs = quadraticIntersection(wall.top[0].xy, wall.top[1].xy, uLightPosition.xy, uLightSize, 1.0e-06, ixs);
  if ( numIxs == 1 ) {
    // Determine where the intersection is on the wall. By definition, it is the closer endpoint.
    // const containedIdx = circleContainsPoint(uLightPosition.xy, uLightSize, endpointsXY[0]) ? 0 : 1;

    // Move pixel away to be outside the circle.
    vec2 newIx = projectRay(Ray2d(ixs[0], normalizedDirection(ixs[0], wall.top[1].xy)), 1.0);

    // Update wall data.
    wall.top[0].xy = newIx.xy;
    wall.bottom[0].xy = newIx.xy;
    wall.mid = (wall.top[0].xy + wall.top[1].xy) * 0.5;
    wall.direction = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
  }
}

/**
 * Calculate the vertical tangents for the light sphere from a given point.
 * @param {vec3} pt
 * @param {out vec3[2]} tangents
 * @returns {bool} true if tangents
 */
bool verticalTangents(in vec3 pt, out vec3[2] tangents) {
  return verticalTangentPoints(pt, uLightPosition, uLightSize, tangents);
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
vec2 offsetLightFromWall(in Wall wall, in float d) {
  return projectRay(Ray2d(uLightPosition.xy, vec2(wall.direction.y, -wall.direction.x)), d);
}

/**
 * Calculate the horizontal tangents for the light sphere from a given point.
 * @param {vec2} pt
 * @param {out vec3[2]} tangents
 * @returns {bool} true if tangents
 */
bool horizontalTangents(in Wall wall, in vec2 pt, out vec2[2] tangents) {
  Circle lightCir = Circle(
    uLightPosition.xy,  // Center
    uLightSize          // Radius
  );

  // If the light overlaps the wall, the penumbra shoot straight out along the wall.
  // Shrinking the light to be just smaller than distance to wall.
  float distToWall = distanceToSegment(uLightPosition.xy, wall.top[0].xy, wall.top[1].xy);
  if ( distToWall <= uLightSize ) {
    lightCir.radius = max(distToWall - 1.0, 0.0);
    if ( almostEqual(distToWall, 0.0, 1.0e-06) ) lightCir.center = offsetLightFromWall(wall, 0.5);
  }
  return tangentPoints(lightCir, pt, tangents);
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
  float dist2AB = distanceSquared(a, b);
  float dist2AC = distanceSquared(a, c);
  if ( almostEqual(dist2AB, dist2AC, 1.0e-08) ) return tri;
  if ( dist2AB > dist2AC ) {
    Ray2d r = Ray2d(a, normalizedDirection(a, c));
    return vec2[3](
      a,
      b,
      projectRayDistanceSquared(r, dist2AB)
    );
  } else { // BC distance is larger.
    Ray2d r = Ray2d(a, normalizedDirection(a, b));
    return vec2[3](
      a,
      projectRayDistanceSquared(r, dist2AC),
      c
    );
  }
}

/**
 * Direction from light --> wall endpoint. Origin at the wall endpoint.
 * @param {Wall} wall
 * @returns {ShadowRays2d} Rays from the endpoint away from the light for umbra, mid, and penumbra.
 */
ShadowRays2d calculateSideShadowRays(in Wall wall) {
  vec2 W0 = wall.top[0].xy;
  vec2 W1 = wall.top[1].xy;

  // 4 tangent points: 2 from each wall endpoint.
  vec2[2] tangents0 = vec2[2](uLightPosition.xy, uLightPosition.xy);
  vec2[2] tangents1 = vec2[2](uLightPosition.xy, uLightPosition.xy);
  horizontalTangents(wall, W0, tangents0);
  horizontalTangents(wall, W1, tangents1);

  // Each tangent point -> wall endpoint creates one of the 4 side shadow rays.
  // t00: tangent --> W0; t01: tangent --> W0
  // t10: tangent --> W1; t11: tangent --> W1
  // t00 x t01 at W0 by definition.
  // t10 x t11 at W1 by definition.
  Ray2d[2] r0 = Ray2d[2](
    Ray2d(W0, normalizedDirection(tangents0[0], W0)),
    Ray2d(W0, normalizedDirection(tangents0[1], W0))
  );
  Ray2d[2] r1 = Ray2d[2](
    Ray2d(W1, normalizedDirection(tangents1[0], W1)),
    Ray2d(W1, normalizedDirection(tangents1[1], W1))
  );

  // If near-collinear:
  // t00 and t01 are on opposite sides of the wall line.
  // t10 and t11 are on opposite sides of the wall line.

  // If not near-collinear
  // t00 and t01 are on same sides of the wall line.
  // t00 and t01 are on same sides of the wall line.
  vec2 p00 = projectRay(r0[0], 100.0);
  vec2 p01 = projectRay(r0[1], 100.0);
  vec2 p10 = projectRay(r1[0], 100.0);
  vec2 p11 = projectRay(r1[1], 100.0);

  float o00 = orient(W1, W0, p00);
  float o01 = orient(W1, W0, p01);
  float o10 = orient(W0, W1, p10);
  float o11 = orient(W0, W1, p11);
  bool isCollinear = OPP_SIDE(o00, o01) || OPP_SIDE(o10, o11); // Either could be 0.0.
  Ray2d[2] penumbra;
  Ray2d[2] umbra;
  if ( isCollinear ) {
    // W0 intersection is penumbra; W1 intersection is umbra.
    penumbra = r0;
    umbra = r1;
  } else {
    // Umbra for W0 is on same side as W1 for light center --> W0.
    float oW1 = orient(uLightPosition.xy, W0, W1);
    float ol00 = orient(uLightPosition.xy, W0, p00);
    float ol01 = orient(uLightPosition.xy, W0, p01);
    int pIdx0 = int(SAME_SIDE(ol01, oW1) || OPP_SIDE(ol00, oW1));
    umbra[0] = r0[pIdx0];
    penumbra[0] = r0[1 - pIdx0];

    // Umbra for W1 is on same side as W0 for light center --> W1.
    float oW0 = orient(uLightPosition.xy, W1, W0);
    float ol10 = orient(uLightPosition.xy, W1, p10);
    float ol11 = orient(uLightPosition.xy, W1, p11);
    int pIdx1 = int(SAME_SIDE(ol11, oW0) || OPP_SIDE(ol10, oW0));
    umbra[1] = r1[pIdx1];
    penumbra[1] = r1[1 - pIdx1];
  }

  // If light center is on the wall, offset.
  float distToWall = distanceToSegment(uLightPosition.xy, W0, W1);
  vec3 lightCenter = almostEqual(distToWall, 0.0, 1.0e-06)
    ? vec3(offsetLightFromWall(wall, 0.5), uLightPosition.z) : uLightPosition;
  Ray2d[2] midpenumbra = Ray2d[2](
    Ray2d(W0, normalizedDirection(lightCenter.xy, W0)),
    Ray2d(W1, normalizedDirection(lightCenter.xy, W1))
  );

  return ShadowRays2d(
    umbra,
    midpenumbra,
    penumbra
  );
}

/**
 * For infinite shadow, construct the different points of the triangle.
 * @param {ShadowRays2d} sideShadowRays
 * @param {ShadowDirections} farShadowDirs
 * @param {Wall} wall
 * @param {out vec2} A...I, W0, W1
 * @returns {bool} True if nearly collinear wall to the light.
 */
bool shadowPoints(in ShadowRays2d sideShadowRays, in Wall wall, in vec3[2] vTangents,
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

  // Already set the closer endpoint when constructing wall properties.
  W0 = wall.top[0].xy;
  W1 = wall.top[1].xy;

  // A found by intersecting the two side penumbra lines.
  lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.penumbra[1], A);

  // If W0 == A, then the wall is nearly collinear with the light (line from wall intersects light circle).
  bool nearCollinear = almostEqual(W0, A, 1.0e-08);

  // D and G are set by the intersection of their respective penumbra/umbra lines.
  // Most of the matching work done in sideShadowRays.
  // If no intersection, D and G should be set to W0 (happens if side shadow rays are parallel):
  // - when wall is near-collinear and wall line is tangent to source circle.
  // TODO: Is setting D and G in advance sufficient?
  D = W0;
  G = W0;
  if ( nearCollinear ) {
    bool hasIx0 = lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.umbra[0], D);
    bool hasIx1 = lineLineIntersection(sideShadowRays.penumbra[1], sideShadowRays.umbra[1], G);
    if ( !hasIx0 ) D = W0;
    if ( !hasIx1 ) G = W0;
  } else {
    bool hasIx0 = lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.umbra[1], D);
    bool hasIx1 = lineLineIntersection(sideShadowRays.penumbra[1], sideShadowRays.umbra[0], G);
    if ( !hasIx0 ) D = W0;
    if ( !hasIx1 ) G = W0;
  }

  // ∆DEF and ∆GHI represent the furtherest extent of the shadow because D and G are
  // near-tangent points.
  vec2[3] DEF = shadowTriangle(vec3(D, uLightPosition.z), wall); // Z axis not used for this.
  vec2[3] GHI = shadowTriangle(vec3(G, uLightPosition.z), wall); // Z axis not used for this.
  E = DEF[1]; // Penumbra line
  F = DEF[2]; // Umbra line

  int collinearIdx = int(nearCollinear);
  H = GHI[2 - collinearIdx]; // Penumbra line 2 - 1; 2 - 0
  I = GHI[1 + collinearIdx]; // Umbra line    1 + 1; 1 + 0

  // Use the lower tangent to determine the furthest extent of the shadow from the wall.
  int idx = int(vTangents[0].z > vTangents[1].z); // Pick the lower in z direction.
  vec2[3] JKL = shadowTriangle(vTangents[idx], wall);

  // Determine B and C by connecting to the penumbra lines.
  // If collinear, it is unclear which one is further.
  float dist2K = distanceSquared(JKL[0], JKL[1]);
  float dist2L = distanceSquared(JKL[0], JKL[2]);
  int idxL = int(dist2L > dist2K); // Want the further one.
  vec2 furthestPoint = JKL[idxL + 1];

  // Collinear: F->I or E->H form the line.
  // Noncollinear: Wall direction or E->F or H->I
  // But E, F, I could be malformed if the side shadow ray runs parallel to and through the wall.
  // So use perpendicular to the median direction.
  vec2 rabDir = wall.direction;
  if ( nearCollinear ) {
    vec2 meanDir = (sideShadowRays.penumbra[0].direction + sideShadowRays.penumbra[1].direction) * 0.5;
    rabDir = vec2(-meanDir.y, meanDir.x);
  } else {
    // Furthest point could be based on the JKL triangle or on the distance to E or H(?).
    float distJKL = distanceSquaredToLine(furthestPoint, W0, wall.direction);
    float distE = distanceSquaredToLine(E, W0, wall.direction);
    float distH = distanceSquaredToLine(H, W0, wall.direction);
    if ( distE > distJKL && distE > distJKL ) furthestPoint = E;
    else if ( distH > distJKL ) furthestPoint = H;
  }
  Ray2d rab = Ray2d(furthestPoint, rabDir);
  lineLineIntersection(sideShadowRays.penumbra[0], rab, B);
  lineLineIntersection(sideShadowRays.penumbra[1], rab, C);

  // For debugging, test side shadows
  /*
  Ray2d r0 = sideShadowRays.umbra[0];
  Ray2d r1 = sideShadowRays.umbra[1];
  lineLineIntersection(r0, r1, A);
  B = projectRay(r0, 2000.0);
  C = projectRay(r1, 2000.0);
  */
  /*
  A = D;
  B = E;
  C = F;
  */

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
bool shadowTriangles(in ShadowRays2d sideShadowRays, in Wall wall, in vec3[2] vTangents,
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
  bool nearCollinear = shadowPoints(sideShadowRays, wall, vTangents,
    A, B, C, D, E, F, G, H, I, W0, W1);

  // Define the triangles.
  penumbraTri = vec2[3](A, B, C);
  nearFarTri0 = vec2[3](D, E, F);
  nearFarTri1 = vec2[3](G, H, I);

  // Side triangles used for gradient shading. Vary based on wall location relative to light.
  vec2[3] sTri0;
  vec2[3] sTri1;
  if ( nearCollinear ) {
    sTri0 = vec2[3](W0, B, W1);
    sTri1 = vec2[3](W0, C, W1);

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
  } else {
    // Extend the wall -> inside range to penumbra triangle edge.
    vec2 ixI;
    vec2 ixF;
    Ray2d rBC = Ray2d(B, C - B);
    lineLineIntersection(rBC, Ray2d(W0, I - W0), ixI);
    lineLineIntersection(rBC, Ray2d(W1, F - W1), ixF);
    sTri0 = vec2[3](W0, B, ixI);
    sTri1 = vec2[3](W1, C, ixF);
  }

  // Change the side triangles to isoceles so gradient shading works.
  sideTri0 = makeIsoceles(sTri0);
  sideTri1 = makeIsoceles(sTri1);
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
 * Determine the furthest canvas point from a given line.
 * Three options: from a vertical tangent or from one of the two horizontal tangents.
 * @param {vec3} vPt        Vertical tangent point to test
 * @param {vec3} hPt0       Horizontal tangent point to test
 * @param {vec3} hPt1       Horizontal tangent point to test
 * @param {vec3} wallPt     Point along the wall that is intersected
 * @param {Ray2d} distR     The ray representing the line for which distance is measured
 * @returns {number} Furthest distance
 */
float furthestShadowDistance(in vec3 vPt, in vec3 hPt0, in vec3 hPt1, in vec3 wallPt, in Ray2d distR) {
  vec3 ixV;
  vec3 ixH0;
  vec3 ixH1;
  furthestShadowPoint(vPt, wallPt, ixV);
  furthestShadowPoint(hPt0, wallPt, ixH0);
  furthestShadowPoint(hPt1, wallPt, ixH1);
  float dist2V = distanceSquaredToLine(ixV.xy, distR.origin, distR.direction);
  float dist2H0 = distanceSquaredToLine(ixH0.xy, distR.origin, distR.direction);
  float dist2H1 = distanceSquaredToLine(ixH1.xy, distR.origin, distR.direction);
  return sqrt(max(max(dist2V, dist2H0), dist2H1));
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
  in vec2[3] nearFarTri0,
  in vec2[3] nearFarTri1,
  in vec3[2] vTangents) {

  // @type {vec2} fAmbient
  vec2 W0 = wall.top[0].xy; // Nearer wall endpoint to source.
  vec2 W1 = wall.top[1].xy; // Further wall endpoint from source.
  fAmbient = vec2(1.0) - ambientLight(W0, W1);
  if ( CLOCKWISE(orient(W0, W1, penumbraTri[1])) ) fAmbient = fAmbient.yx; // CW

  bool isCollinear = almostEqual(penumbraTri[0], wall.top[0].xy, 1.0e-06);
  Ray2d rEdgeWall = frontBackBisector(wall, isCollinear);
  Ray2d rLRWall = leftRightBisector(wall, isCollinear);

  int idxLower = int(vTangents[0].z > vTangents[1].z); // Pick the lower in z direction.
  vec3 lowerTangent = vTangents[idxLower];
  vec3 upperTangent = vTangents[1 - idxLower];

  int rlIdx = RIGHT;
  vec2 sameSideOrigin;
  vec2 otherSideOrigin;
  if ( isCollinear ) {
    // Which side will the far/near points fall?
    // Measure from the light; the points will be on the opposite side.
    // If light center is collinear with the wall, ixP will be collinear and can just pick a side.
    // ccw/left is positive; cw/right is negative
    // TODO: Why not negate orient like in WallShaderTest3?
    if ( CLOCKWISE(orient(W0, W1, uLightPosition.xy)) ) rlIdx = LEFT;

    // Which nearFarTri is on that side?
    // sides[RIGHT, LEFT]
    // nearFarTri0 and nearFarTri1 are on opposite sides.
    // Either (only nearFarTri1?) could collinear with  the wall line.
    vec2[2] sides;
    float o = orient(W0, W1, nearFarTri0[2]);
    if ( COUNTERCLOCKWISE(o)
      || (COLLINEAR(o) && CLOCKWISE(orient(W0, W1, nearFarTri1[2]))) ) sides = vec2[2](nearFarTri1[0], nearFarTri0[0]);
    else sides = vec2[2](nearFarTri0[0], nearFarTri1[0]);
    sameSideOrigin = sides[rlIdx];
    otherSideOrigin = sides[1 - rlIdx];
  }

  // Distinguish left and right.
  // vLREdgeDist defined as positive if to left of (ccw to) the wall; negative if right (cw)
  // The far penumbra shadow by definition is at the far penumbraTri edge.
  vec3[2] hTangents = vec3[2](vec3(nearFarTri0[0], uLightPosition.z), vec3(nearFarTri1[0], uLightPosition.z));
  vec3 ixP;
  if ( !isInfiniteTopShadow(lowerTangent) ) {
    fFarDistances[PENUMBRA] = furthestShadowDistance(lowerTangent,
      hTangents[0], hTangents[1], wall.top[1], rEdgeWall);
    if ( isCollinear ) {
      // First the rlIdx side.
      furthestShadowPoint(vec3(sameSideOrigin, uLightPosition.z), wall.top[1], ixP);
      fFarRLPenumbraDistances[rlIdx] = distanceToLine(ixP.xy, rLRWall.origin, rLRWall.direction);

      // Then the other side.
      furthestShadowPoint(vec3(otherSideOrigin, uLightPosition.z), wall.top[1], ixP);
      fFarRLPenumbraDistances[1 - rlIdx] = distanceToLine(ixP.xy, rLRWall.origin, rLRWall.direction);
    }
  }

  // The far umbra shadow is controlled by the upper tangent.
  if ( !isInfiniteTopShadow(upperTangent) ) {
    // Use closest wall point for the far umbra shadow.
    furthestShadowPoint(upperTangent, wall.top[1], ixP);
    fFarDistances[UMBRA] = distanceToLine(ixP.xy, rEdgeWall.origin, rEdgeWall.direction);
    if ( isCollinear ) {
      // First the rlIdx side. Use the above umbra point.
      fFarRLUmbraDistances[rlIdx] = distanceToLine(ixP.xy, rLRWall.origin, rLRWall.direction);

      // Approximate the other side's umbra by taking the ratio of the PENUMBRA distances.
      float ratio = fFarRLPenumbraDistances[rlIdx] != 0.0
        ? fFarRLPenumbraDistances[1 - rlIdx] / fFarRLPenumbraDistances[rlIdx] : 0.0;
      fFarRLUmbraDistances[1 - rlIdx] = ratio * fFarRLUmbraDistances[rlIdx];
    }
  }

  // The near shadow depends on wall floating
  if ( wallIsFloating() ) {
    if ( !isInfiniteBottomShadow(upperTangent) ) {
      // Use closest wall point for the near penumbra shadow.
      fNearDistances[PENUMBRA] = furthestShadowDistance(upperTangent,
          hTangents[0], hTangents[1], wall.bottom[0], rEdgeWall);
      if ( isCollinear ) {
        // First the rlIdx side.
        furthestShadowPoint(vec3(sameSideOrigin, uLightPosition.z), wall.bottom[1], ixP);
        fNearRLPenumbraDistances[rlIdx] = distanceToLine(ixP.xy, rLRWall.origin, rLRWall.direction);

        // Then the other side.
        furthestShadowPoint(vec3(otherSideOrigin, uLightPosition.z), wall.bottom[1], ixP);
        fNearRLPenumbraDistances[1 - rlIdx] = distanceToLine(ixP.xy, rLRWall.origin, rLRWall.direction);
      }
    }
    if ( !isInfiniteBottomShadow(lowerTangent) ) {
      furthestShadowPoint(lowerTangent, wall.bottom[0], ixP);
      fNearDistances[UMBRA] = distanceToLine(ixP.xy, rEdgeWall.origin, rEdgeWall.direction);
      if ( isCollinear ) {
        // First the rlIdx side. Use the above umbra point.
        fNearRLUmbraDistances[rlIdx] = distanceToLine(ixP.xy, rLRWall.origin, rLRWall.direction);

        // Approximate the other side's umbra by taking the ratio of the PENUMBRA distances.
        float ratio = fNearRLPenumbraDistances[rlIdx] != 0.0
          ? fNearRLPenumbraDistances[1 - rlIdx] / fNearRLPenumbraDistances[rlIdx] : 0.0;
        fNearRLUmbraDistances[1 - rlIdx] = ratio * fNearRLUmbraDistances[rlIdx];
      }
    }
  }
}

void main() {
  // Defined constants.
  int vertexNum = gl_VertexID % 3;
  Wall wall = calculateWallPositions();
  shrinkOverlappingWall(wall);

  // Side shadows.
  ShadowRays2d sideShadowRays = calculateSideShadowRays(wall);

  // Lowest and highest point of the sphere that forms a tangent with the wall.
  vec3 wallMid3d = vec3(wall.mid, wall.top[0].z);
  vec3[2] vTangents;
  verticalTangents(wallMid3d, vTangents);

  // Triangles defining parts of the shadow.
  vec2[3] penumbraTri;
  vec2[3] umbraTri; // Gradient shading.
  vec2[3] nearFarTri0; // Defining near and far shadows.
  vec2[3] nearFarTri1; // Defining near and far shadows.
  vec2[3] sideTri0; // Gradient shading.
  vec2[3] sideTri1; // Gradient shading.
  bool nearCollinear = shadowTriangles(sideShadowRays, wall, vTangents,
    penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1);

  // Varyings
  defineSharedVaryings(wall, penumbraTri);
  defineVaryings(nearCollinear, penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1);

  // Flats
  if ( vertexNum == 2) {
    defineSharedFlats(wall, penumbraTri);
    defineFlats(wall, penumbraTri, nearFarTri0, nearFarTri1, vTangents);
  }
}