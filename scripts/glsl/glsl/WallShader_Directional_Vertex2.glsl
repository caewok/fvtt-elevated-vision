#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Directional Vertex ----- */

in vec4 aWallCorner0;
in vec4 aWallCorner1;
in float aWallSenseType;
in float aThresholdRadius2; // Note: no thresholds for walls apply for directional lighting.

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
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier
uniform vec4 uSceneDims;
uniform float uAzimuth; // radians
uniform float uElevationAngle; // radians
uniform float uSolarAngle; // radians

#define PI_1_2 1.5707963267948966
#define EV_DIRECTIONAL_LIGHT true

${defineFunction("normalizeRay")}
${defineFunction("rayFromPoints")}
${defineFunction("intersectRayPlane")}
${defineFunction("lineLineIntersection")}
${defineFunction("barycentric")}
${defineFunction("orient")}
${defineFunction("fromAngle")}

${PENUMBRA_VERTEX_FUNCTIONS}

float zChangeForElevationAngle(in float elevationAngle) {
  // elevationAngle = clamp(elevationAngle, 0.0, PI_1_2); // 0ÔøΩ to 90ÔøΩ
  vec2 pt = fromAngle(vec2(0.0), elevationAngle, 1.0);

  // How much z (y) change for every change in x?
  float z = pt.x == 0.0 ? 1e06 : pt.y / pt.x;
  return -z;
  // return max(z, 1e-06); // Don't let z go to 0.
}

/**
 * Determine the change in z for the directional rays.
 */
float[3] _calculateZChangeRays() {
  float solarAngle = max(0.1, uSolarAngle); // TODO: Cannot currently go all the way to 0.

  // Calculate the change in z for the light direction based on differing solar angles.
  float[3] zDelta;
  zDelta[UMBRA] = zChangeForElevationAngle(uElevationAngle + solarAngle); // Light top
  zDelta[MIDPENUMBRA] = zChangeForElevationAngle(uElevationAngle); // Light middle
  zDelta[PENUMBRA] = zChangeForElevationAngle(uElevationAngle - solarAngle); // Light bottom
  return zDelta;
}

/**
 * The rays from the wall endpoint along the side.
 */
ShadowDirections2d calculateSideShadowDirections(in int idx, in Wall wall) {
  float solarAngle = max(0.1, uSolarAngle); // TODO: Cannot currently go all the way to 0.

  // Direction from light to endpoint.
  vec2 dirMidPenumbra = normalize(fromAngle(vec2(0.0), uAzimuth, 1.0) * -1.0);

  // Determine which side of the wall the light is on.
  float oWallLight = sign(orient(wall.top[0].xy, wall.top[1].xy, wall.top[0].xy - dirMidPenumbra));

  // Adjust azimuth by the solarAngle.
  // Determine the direction of the outer penumbra rays from light --> wallCorner1 / wallCorner2.
  // The angle for the penumbra is the azimuth ÔøΩ the solarAngle.
  float solarWallAngle = solarAngle * oWallLight;
  float multiplier = idx == 0 ? 1.0 : -1.0;
  vec2 dirPenumbra = normalize(fromAngle(vec2(0.0), uAzimuth + (solarWallAngle * multiplier), 1.0) * -1.0);
  vec2 dirUmbra = normalize(fromAngle(vec2(0.0), uAzimuth - (solarWallAngle * multiplier), 1.0) * -1.0);

  // Normalize based on the mid penumbra for corner 0
  return ShadowDirections2d(
    dirUmbra, // umbra
    dirMidPenumbra, // midpenumbra
    dirPenumbra // penumbra
  );
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
 * Calculate the side shadow rays.
 * @param {Wall} wall
 * @param {ShadowRays2d}
 */
ShadowRays2d calculateSideShadowRays(in Wall wall) {
  ShadowDirections2d sideShadowDirs0 = calculateSideShadowDirections(0, wall);
  ShadowDirections2d sideShadowDirs1 = calculateSideShadowDirections(1, wall);
  vec2 wall0 = wall.top[0].xy;
  vec2 wall1 = wall.top[1].xy;

  // Build the rays for each tangent to associate them with the correct wall point.
  Ray2d[4] tangentRays = Ray2d[4](
    Ray2d(wall0, sideShadowDirs0.umbra),
    Ray2d(wall1, sideShadowDirs1.umbra),
    Ray2d(wall0, sideShadowDirs0.penumbra),
    Ray2d(wall1, sideShadowDirs1.penumbra)
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

  Ray2d[2] midpenumbra = Ray2d[2](
    Ray2d(wall0, sideShadowDirs0.midpenumbra),
    Ray2d(wall1, sideShadowDirs1.midpenumbra)
  );

  return ShadowRays2d(
    umbra,
    midpenumbra,
    penumbra
  );
}

/**
 * The rays from the wall top endpoint away from the light.
 */
ShadowDirections calculateFarShadowDirections() {
  float[3] zDelta = _calculateZChangeRays();
  vec2 dirMid = fromAngle(vec2(0.0), uAzimuth, 1.0) * -1.0;
  return ShadowDirections(
    normalize(vec3(dirMid.xy, zDelta[UMBRA])), // umbra
    normalize(vec3(dirMid.xy, zDelta[MIDPENUMBRA])), // midpenumbra
    normalize(vec3(dirMid.xy, zDelta[PENUMBRA])) // penumbra
  );
}

/**
 * The rays from the wall bottom endpoint away from the light.
 */
ShadowDirections calculateNearShadowDirections() {
  float[3] zDelta = _calculateZChangeRays();
  vec2 dirMid = fromAngle(vec2(0.0), uAzimuth, 1.0) * -1.0;
  return ShadowDirections(
    normalize(vec3(dirMid.xy, zDelta[PENUMBRA])), // umbra
    normalize(vec3(dirMid.xy, zDelta[MIDPENUMBRA])), // midpenumbra
    normalize(vec3(dirMid.xy, zDelta[UMBRA])) // penumbra
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
    intersectRayPlane(Ray(vec3(wall.mid, wall.top[0].z), farShadowDirs.penumbra), canvasPlane, canvasIx);
    Ray2d canvasEdge = Ray2d(canvasIx.xy, wall.direction);
    // canvasEdge2 = canvasEdge;

    lineLineIntersection(rD_penumbra, canvasEdge, E);
    lineLineIntersection(rG_umbra, canvasEdge, I); // Mirror for ∆GHI

    // Moving from E along the wall direction, we will intersect rD_umbra at F.
    Ray2d rEWall = Ray2d(E, wall.direction);
    lineLineIntersection(rEWall, rD_umbra, F);

    // Mirror for ∆GHI
    Ray2d rIWall = Ray2d(I, wall.direction);
    lineLineIntersection(rIWall, rG_penumbra, H);
  }

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
  // Shadow is a trapezoid formed from the intersection of the wall with the
  // triangle ABC, where
  // C is the light position.
  // A is the intersection of the line light --> wall endpointA --> canvas plane
  // B is the intersection of the line light --> wall endpointB --> canvas plane
  // Tricky part for directional lights is the light position.
  // Intersect the canvas from A --> -light direction --> canvas; B --> -dir --> canvas.
  // Shift the point along AB out by uLightSize, then use the shiftedIxA --> A and shiftedIxB --> B
  // to locate a fake light position.
  // Why do this instead of building triangles from the shadow?
  // 1. Would require different geometry
  // 2. Much easier to deal with penumbra shading as a triangle.
  // 3. Would require much different approach to the fragment shader.
  int vertexNum = gl_VertexID % 3;
  Wall wall = calculateWallPositions();

  // Side shadows.
  ShadowRays2d sideShadowRays = calculateSideShadowRays(wall);

  // Far direction.
  ShadowDirections farShadowDirs = calculateFarShadowDirections();

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