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
out float vLREdgeDist;

flat out float fThresholdRadius2;
flat out float fWallSenseType;
flat out vec2 fWallHeights;
flat out vec2 fNearDistances;
flat out vec2 fFarDistances;
flat out vec3 fWallTop0;
flat out vec3 fWallTop1;
flat out vec3 fWallBottom0;
flat out vec3 fWallBottom1;
flat out vec2 fFarRLPenumbraDistances;
flat out vec2 fFarRLUmbraDistances;
flat out vec2 fNearRLPenumbraDistances;
flat out vec2 fNearRLUmbraDistances;
flat out vec2 fAmbient;

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
${defineFunction("distanceSquared")}
${defineFunction("quadraticIntersection")}
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
 * Calculate the vertical tangents for the light sphere from a given point.
 * @param {vec3} pt
 * @param {out vec3[2]} tangents
 * @returns {bool} true if tangents
 */
bool verticalTangents(in vec3 pt, out vec3[2] tangents) {
  return verticalTangentPoints(pt, uLightPosition, uLightSize, tangents);
}

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
    wall.mid = (wall.top[0].xy * wall.top[1].xy) * 0.5;
    wall.direction = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
  }
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
  sideTri0 = sTri0;
  sideTri1 = sTri1;
  // sideTri0 = makeIsoceles(sTri0);
  // sideTri1 = makeIsoceles(sTri1);
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

  // Flats
  if ( vertexNum == 2) {
    defineSharedFlats(wall, penumbraTri);
    defineFlats(wall);
  }
}