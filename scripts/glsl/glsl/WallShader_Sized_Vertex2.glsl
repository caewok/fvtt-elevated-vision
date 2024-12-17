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