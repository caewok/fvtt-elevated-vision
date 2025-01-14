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

${defineStruct("Plane")}
${defineFunction("intersectRayPlane")}
${defineFunction("normalizedDirection")}
${defineFunction("normalizeRay")}
${defineStruct("Circle")}
${defineFunction("tangentPoints")}
${defineFunction("sameSide")}
${defineFunction("distanceSquared")}
${defineFunction("quadraticIntersection")}


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
 * Determine the far penumbra point.
 * @param {Wall} wall
 * @param {out vec2} ix2d
 * @returns {bool} True if the point exists
 */
bool farCanvasPoint(in Wall wall, out vec2 ix2d) {
  // Locate the canvas intersection.
  // No perfect approach.
  // Depending on light size:
  // - Front and back of the light at light elevation --> mid wall do not extend far enough.
  // - Center light --> mid wall may extend further but not enough. Pretty close though.
  // - Measuring using light cube is better, but goes too far. But only approach that is far enough.
  // - Vertical tangents for middle of wall. Very accurate, a bit calc intensive.
  // TODO: Umbra point seems slightly further from wall than it should.
  // Could be error in random shadow shader.
  float wallTopZ = wall.top[0].z;
  vec3 mid3d = vec3(wall.mid, wallTopZ);
  vec3[2] tangents3d;
  Ray rP;
  if ( verticalTangents(mid3d, tangents3d) ) {
    // Should always have tangents.
    int idx = int(tangents3d[0].z > tangents3d[1].z);
    vec3 penumbraTangent = tangents3d[idx]; // Lower point
    // vec3 umbraTangent = tangents3d[int(1 - idx)]; // Higher point.
    rP = Ray(penumbraTangent, mid3d - penumbraTangent);
    // Ray rU = Ray(umbraTangent, mid3d - umbraTangent);
  } else {

    // Just in case; use the light mid point --> wall mid.
    rP = Ray(uLightPosition, mid3d - uLightPosition);
  }
  vec3 ixP;
  // vec3 ixU;
  Plane canvasPlane = constructCanvasPlane();
  if ( !intersectRayPlane(rP, canvasPlane, ixP) ) return false;
  ix2d = ixP.xy;
  return true;
}

/**
 * Direction from light --> wall endpoint. Origin at the wall endpoint.
 * @param {Wall} wall
 * @returns {ShadowRays2d} Rays from the endpoint away from the light for umbra, mid, and penumbra.
 */
ShadowRays2d calculateSideShadowRays(in Wall wall) {
  vec2[2] W = vec2[2](wall.top[0].xy, wall.top[1].xy);

  // 4 tangent points: 2 from each wall endpoint.
  vec2[2] tangents0 = vec2[2](uLightPosition.xy, uLightPosition.xy);
  vec2[2] tangents1 = vec2[2](uLightPosition.xy, uLightPosition.xy);
  horizontalTangents(wall, W[0], tangents0);
  horizontalTangents(wall, W[1], tangents1);

  // ∆DEF and ∆GHI both have D->E / G->H penumbra and D->F / G->I umbra
  // The DE penumbra ray runs through the closer endpoint.
  // The GH penumbra ray runs through either endpoint (further normally; closer if near-collinear).
  // Treat D as 0, G as 1
  Ray2d[2] penumbra;
  Ray2d[2] umbra;
  float[2] o0;
  float[2] o1;
  Ray2d[2] r0;
  Ray2d[2] r1;

  // i = 0
  for ( int j = 0; j < 2; j += 1 ) {
    vec2 tangent = tangents0[j];
    o0[j] = orient(W[1], W[0], tangent);
    r0[j] = Ray2d(tangent, normalizedDirection(tangent, W[0]));
  }

  // i = 1
  for ( int j = 0; j < 2; j += 1 ) {
    vec2 tangent = tangents1[j];
    o1[j] = orient(W[1], W[0], tangent);
    r1[j] = Ray2d(tangent, normalizedDirection(tangent, W[1]));
  }

  // Examine W0->W1->tangent to determine which tangent is which.
  bool sameSide = o0[0] * o0[1] > 0.0;
  if ( sameSide ) {
    // Determine the further point from W1 --> W0.
    // Could be the larger orientation but not necessarily.
    float o01 = orient(W[1], tangents0[0], tangents0[1]);
    int idxP = int(o0[0] * o01 > 0.0);
    penumbra[0] = r0[idxP]; // D is defined as the closer penumbra here.
    umbra[1] = r0[1 - idxP];

    // Flipped for W1: setting the umbra first (e.g., penumbra is ~ smaller orientation).
    float o11 = orient(W[1], tangents1[0], tangents1[1]);
    int idxU = int(o1[0] * o11 > 0.0);
    umbra[0] = r1[idxU];
    penumbra[1] = r1[1 - idxU];

  } else {
    // Pick ccw as D.
    int idxP = int(o0[1] > 0.0);
    int idxU = int(o1[1] > 0.0);
    penumbra[0] = r0[idxP];
    penumbra[1] = r0[1 - idxP];
    umbra[0] = r1[idxU];
    umbra[1] = r1[1 - idxU];
  }

  // If light center is on the wall, offset.
  float distToWall = distanceToSegment(uLightPosition.xy, W[0], W[1]);
  vec3 lightCenter = almostEqual(distToWall, 0.0, 1.0e-06) ? vec3(offsetLightFromWall(wall, 0.5), uLightPosition.z) : uLightPosition;
  Ray2d[2] midpenumbra = Ray2d[2](
    Ray2d(W[0], normalizedDirection(lightCenter.xy, W[0])),
    Ray2d(W[1], normalizedDirection(lightCenter.xy, W[1]))
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
bool shadowPoints(in ShadowRays2d sideShadowRays, in ShadowDirections farShadowDirs, in Wall wall,
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

  // D and G are set by the intersection of their respective penumbra/umbra lines.
  // Most of the matching work done in sideShadowRays.
  lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.umbra[0], D);
  lineLineIntersection(sideShadowRays.penumbra[1], sideShadowRays.umbra[1], G);

  // ∆DEF and ∆GHI represent the furtherest extent of the shadow because D and G are
  // near-tangent points.
  vec2[3] DEF = shadowTriangle(vec3(D, uLightPosition.z), wall); // Z axis not used for this.
  vec2[3] GHI = shadowTriangle(vec3(G, uLightPosition.z), wall); // Z axis not used for this.
  E = DEF[1];
  F = DEF[2];
  H = GHI[1];
  I = GHI[2];

  // Use the lower tangent to determine the furthest extent of the shadow from the wall.
  vec3 wallMid3d = vec3(wall.mid, wall.top[0].z);
  vec3[2] vTangents;
  verticalTangents(wallMid3d, vTangents);
  int idx = int(vTangents[0].z > vTangents[1].z); // Pick the lower in z direction.
  vec2[3] triVerticalTangent = shadowTriangle(vTangents[idx], wall);

  // Determine B and C by connecting to the penumbra lines.
  // Connect using the F and I points, but from the further triVerticalTangent line.
  vec2 furthestPoint = triVerticalTangent[2];
  Ray2d rFurthest = Ray2d(furthestPoint, I - F);
  lineLineIntersection(sideShadowRays.penumbra[0], rFurthest, B);
  lineLineIntersection(sideShadowRays.penumbra[1], rFurthest, C);

  // If W0 == A, then the wall is nearly collinear with the light (line from wall intersects light circle).
  bool nearCollinear = almostEqual(W0, A, 1.0e-08);

  // For debugging, test side shadows
  /*
  Ray2d r0 = sideShadowRays.umbra[0];
  Ray2d r1 = sideShadowRays.umbra[1];
  lineLineIntersection(r0, r1, A);
  B = projectRay(r0, 2000.0);
  C = projectRay(r1, 2000.0);
  */

  /*
  A = G;
  B = H;
  C = I;
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
  shrinkOverlappingWall(wall);

  // Side shadows.
  ShadowRays2d sideShadowRays = calculateSideShadowRays(wall);

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

  // Flats
  if ( vertexNum == 2) {
    defineSharedFlats(wall, penumbraTri);
    defineFlats(wall);
  }
}