#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Sized Vertex 2 (LightRay sampling) ----- */

#define SAMPLED_SOURCE   true

in vec4 aWallCorner0;
in vec4 aWallCorner1;
in float aWallSenseType;
in float aThresholdRadius2;

out vec2 vVertexPosition;  // Shared
out vec2 vTerrainTexCoord; // Shared
out float vEdgeDist;       // Shared
out float vLREdgeDist;     // Shared

flat out float fThresholdRadius2;   // Shared
flat out float fWallSenseType;      // Shared
flat out vec2 fWallHeights;         // Shared
flat out vec2 fAmbient;
flat out vec3 fWallTop0;
flat out vec3 fWallTop1;
flat out vec3 fWallBottom0;
flat out vec3 fWallBottom1;
flat out vec2 fLinkValues;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec4 uElevationRes;
uniform vec3 uLightPosition;
uniform float uLightSize;
uniform vec4 uSceneDims;

${defineStruct("Plane")}
${defineFunction("intersectRayPlane")}
${defineFunction("normalizedDirection")}
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
    vec2 newIx = projectRay(rayFromDirection(ixs[0], normalizedDirection(ixs[0], wall.top[1].xy)), 1.0);

    // Update wall data.
    wall.top[0].xy = newIx.xy;
    wall.bottom[0].xy = newIx.xy;
    wall.mid = (wall.top[0].xy * wall.top[1].xy) * 0.5;
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
  return projectRay(rayFromDirection(uLightPosition.xy, vec2(wall.direction.y, -wall.direction.x)), d);
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
    rayFromDirection(W0, normalizedDirection(tangents0[0], W0)),
    rayFromDirection(W0, normalizedDirection(tangents0[1], W0))
  );
  Ray2d[2] r1 = Ray2d[2](
    rayFromDirection(W1, normalizedDirection(tangents1[0], W1)),
    rayFromDirection(W1, normalizedDirection(tangents1[1], W1))
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
  // TODO: Do this for penumbra and umbra?
  /*
  float distToWall = distanceToSegment(uLightPosition.xy, W0, W1);
  vec3 lightCenter = almostEqual(distToWall, 0.0, 1.0e-06)
    ? vec3(offsetLightFromWall(wall, 0.5), uLightPosition.z) : uLightPosition;
  Ray2d[2] midpenumbra = Ray2d[2](
    rayFromDirection(W0, normalizedDirection(lightCenter.xy, W0)),
    rayFromDirection(W1, normalizedDirection(lightCenter.xy, W1))
  );
  */

  return ShadowRays2d(
    umbra,
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
bool shadowPoints(in Wall wall, in ShadowRays2d sideShadowRays, in vec2[3] farPenumbraTri,
  out vec2 A,
  out vec2 B,
  out vec2 C,
  out vec2 D,
  out vec2 E,
  out vec2 F,
  out vec2 G,
  out vec2 H,
  out vec2 I) {

  vec2 a;
  // Unneeded
  // vec2 b;
  // vec2 c;
  vec2 d;
  vec2 e;
  vec2 f;
  vec2 g;
  vec2 h;
  vec2 i;

  // Already set the closer endpoint when constructing wall properties.
  vec2 W0 = wall.top[0].xy;
  vec2 W1 = wall.top[1].xy;

  // A found by intersecting the two side penumbra lines.
  lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.penumbra[1], a);

  // If W0 == A, then the wall is nearly collinear with the light (line from wall intersects light circle).
  bool nearCollinear = almostEqual(W0, a, 1.0e-08);

  // D and G are set by the intersection of their respective penumbra/umbra lines.
  // Most of the matching work done in sideShadowRays.
  // If no intersection, D and G should be set to W0 (happens if side shadow rays are parallel):
  // - when wall is near-collinear and wall line is tangent to source circle.
  // TODO: Is setting D and G in advance sufficient?
  d = W0;
  g = W0;
  if ( nearCollinear ) {
    bool hasIx0 = lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.umbra[0], d);
    bool hasIx1 = lineLineIntersection(sideShadowRays.penumbra[1], sideShadowRays.umbra[1], g);
    if ( !hasIx0 ) d = W0;
    if ( !hasIx1 ) g = W0;
  } else {
    bool hasIx0 = lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.umbra[1], d);
    bool hasIx1 = lineLineIntersection(sideShadowRays.penumbra[1], sideShadowRays.umbra[0], g);
    if ( !hasIx0 ) d = W0;
    if ( !hasIx1 ) g = W0;
  }

  // ∆DEF and ∆GHI represent the furtherest extent of the shadow because D and G are
  // near-tangent points.
  vec2[3] DEF = shadowTriangle(vec3(d, uLightPosition.z), wall, true); // Z axis not used for this.
  vec2[3] GHI = shadowTriangle(vec3(g, uLightPosition.z), wall, true); // Z axis not used for this.
  e = DEF[1]; // Penumbra line
  f = DEF[2]; // Umbra line

  int collinearIdx = int(nearCollinear);
  h = GHI[2 - collinearIdx]; // Penumbra line 2 - 1; 2 - 0
  i = GHI[1 + collinearIdx]; // Umbra line    1 + 1; 1 + 0

  // Determine B and C by connecting to the penumbra sideShadowRays.
  // Use whichever is greater distance from wall: I, H, farPenumbraTri[1]
  Ray2d rEdgeWall = frontBackBisector(wall, nearCollinear);
  float dist2F = distanceSquaredToLine(f, rEdgeWall.origin, rEdgeWall.direction);
  float dist2I = distanceSquaredToLine(i, rEdgeWall.origin, rEdgeWall.direction);
  float dist2P = distanceSquaredToLine(farPenumbraTri[2], rEdgeWall.origin, rEdgeWall.direction);
  vec2 furthestPoint = (dist2F > dist2I && dist2F > dist2P) ? f
    : (dist2I > dist2P) ? i : farPenumbraTri[2];

  // Direction to run the ray connect the two penumbra sides.
  vec2 rabDir = wall.direction;
  if ( nearCollinear ) {
    // Perpendicular to the mean ray between the two penumbra sides.
    vec2 meanDir = (sideShadowRays.penumbra[0].direction + sideShadowRays.penumbra[1].direction) * 0.5;
    rabDir = vec2(-meanDir.y, meanDir.x);
  }
  Ray2d rab = rayFromDirection(furthestPoint, rabDir);
  lineLineIntersection(sideShadowRays.penumbra[0], rab, B);
  lineLineIntersection(sideShadowRays.penumbra[1], rab, C);

  A = a;
  D = d;
  E = e;
  F = f;
  G = g;
  H = h;
  I = i;

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
  B = projectRay(rayFromDirection(A, normalize(B - A)), 2000.0);
  C = projectRay(rayFromDirection(A, normalize(C - A)), 2000.0);
  */

  return nearCollinear;
}

/**
 * Calculate the flat variables
 * @param {Wall} wall
 */
void defineFlats(in Wall wall, in vec2 vertex0) {
  // @type {vec3} Wall data
  fWallTop0 = wall.top[0];
  fWallTop1 = wall.top[1];
  fWallBottom0 = wall.bottom[0];
  fWallBottom1 = wall.bottom[1];

  // To signal collinear (fAmbient.x * fAmbient.y !== 0.0).
  float collinear = float(almostEqual(wall.top[0].xy, vertex0, 1.0e-08));
  fAmbient.x = collinear;
  fAmbient.y = collinear;

  fLinkValues = vec2(wall.linkValues[0], wall.linkValues[1]);
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

  // Shadow triangle for the lower tangent, representing the furthest distance.
  int idx = int(vTangents[0].z > vTangents[1].z); // Pick the lower in z direction.
  vec3 lowerTangent = vTangents[idx];
  vec3 upperTangent = vTangents[idx - 1];
  vec2[3] farPenumbraTri = shadowTriangle(lowerTangent, wall, true);

  // Triangles defining parts of the shadow.
  // Triangles defining parts of the shadow.
  vec2[3] penumbraTri;
  vec2[3] DEF;
  vec2[3] GHI;
  shadowPoints(wall, sideShadowRays, farPenumbraTri,
    penumbraTri[0], penumbraTri[1], penumbraTri[2], DEF[0], DEF[1], DEF[2], GHI[0], GHI[1], GHI[2]);

  // Varyings
  defineSharedVaryings(wall, penumbraTri);

  // Flats
  if ( vertexNum == 2) {
    defineSharedFlats(wall, penumbraTri);
    defineFlats(wall, penumbraTri[0]);
  }
}