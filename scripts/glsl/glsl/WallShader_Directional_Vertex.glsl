#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Directional Vertex ----- */

in vec4 aWallCorner0;
in vec4 aWallCorner1;
in float aWallSenseType;
in float aThresholdRadius2; // Note: no thresholds for walls apply for directional lighting.

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
flat out vec2 fWallHeights;
flat out vec2 fAmbient;
flat out vec2 fNearDistances;
flat out vec2 fFarDistances;
flat out vec2 fFarRLPenumbraDistances;
flat out vec2 fFarRLUmbraDistances;
flat out vec2 fNearRLPenumbraDistances;
flat out vec2 fNearRLUmbraDistances;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier
uniform vec4 uSceneDims;
uniform float uAzimuth; // radians
uniform float uElevationAngle; // radians
uniform float uSolarAngle; // radians

#define PI_1_2 1.5707963267948966
#define EV_DIRECTIONAL_LIGHT true

${defineStruct("Plane")}
${defineFunction("intersectRayPlane")}
${defineFunction("rayFromPoints")}
${defineFunction("intersectRayPlane")}
${defineFunction("lineLineIntersection")}
${defineFunction("barycentric")}
${defineFunction("orient")}
${defineFunction("fromAngle")}

/* ----- NOTE: Functions used by Penumbra Vertex Functions ----- */

/**
 * Determine the closer and further endpoints.
 * @param {vec2[2]} pts
 * @returns {int} Index for the closer endpoint.
 */
int closerEndpoint(vec2[2] pts) {
  vec2 dirMid = fromAngle(vec2(0.0), uAzimuth, 1.0) * -1.0;
  vec2 perpDir = vec2(dirMid.y, -dirMid.x);
  Ray2d r01 = rayFromDirection(pts[0], perpDir);
  vec2 b = projectRay(r01, 1.0);
  return int(COUNTERCLOCKWISE(orient(pts[0], b, pts[1])));
}

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
  if ( COUNTERCLOCKWISE(orient(tangentRays[idx0].origin, projectedPoints[idx0], projectedPoints[idx1])) ) {
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
    rayFromDirection(wall0, sideShadowDirs0.umbra),
    rayFromDirection(wall1, sideShadowDirs1.umbra),
    rayFromDirection(wall0, sideShadowDirs0.penumbra),
    rayFromDirection(wall1, sideShadowDirs1.penumbra)
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

  // Two sets of penumbra/umbra rays. Each set:
  // - One ray through each endpoint.
  // - For directional, the rays are parallel unless modified by linked wall.
  // - Intersect at the canvas such that a line connects them that is parallel to the wall.
  // These form the ∆DEF / []DEFG and ∆GHI / []GHID shapes.

  // The DE penumbra ray runs through the closer endpoint.
  int closerIdx = sideShadowRays.penumbra[0].origin.x == W0.x
    && sideShadowRays.penumbra[0].origin.y == W0.y ? 0 : 1;
  Ray2d rAB = sideShadowRays.penumbra[closerIdx];
  Ray2d rAC = sideShadowRays.penumbra[1 - closerIdx];
  Ray2d rD_penumbra = rAB;
  Ray2d rG_penumbra = rAC;

  // The DF umbra ray runs through the further endpoint.
  int furtherIdx = sideShadowRays.umbra[0].origin.x == W1.x && sideShadowRays.umbra[0].origin.y == W1.y ? 0 : 1;
  Ray2d rD_umbra = sideShadowRays.umbra[furtherIdx];
  Ray2d rG_umbra = sideShadowRays.umbra[1 - furtherIdx];

  // For directional, D is the closer endpoint, G is the further.
  D = W0;
  G = W1;

  // Adjust for infinite shadows and near-collinear walls.
  bool infiniteShadow = isInfiniteTopShadow(farShadowDirs.penumbra);
  bool nearCollinear = almostEqual(W0, A, 1.0e-08);
  if ( nearCollinear ) {
    A = W0; // Ensure this is exactly equal.
    G = D;  // D and G are both at W0.
  }

  // E and H are where the penumbra lines intersects the canvas.
  Ray2d canvasEdgeD;
  Ray2d canvasEdgeG;
  if ( infiniteShadow ) {
    canvasEdgeD = infiniteShadowCanvasRay(Ray2d[2](rD_penumbra, rD_umbra));
    canvasEdgeG = infiniteShadowCanvasRay(Ray2d[2](rG_penumbra, rG_umbra));
  } else {
    // Determine where the shadow hits the plane by examining the wall midpoint.
    Plane canvasPlane = constructCanvasPlane();
    vec3 canvasIx;
    // (Could use D and G but requires intersecting the plane twice.)
    // intersectRayPlane(rayFromDirection(vec3(D, wall.top[0].z), farShadowDirs.penumbra), canvasPlane, canvasIx);
    // intersectRayPlane(rayFromDirection(vec3(G, wall.top[0].z), farShadowDirs.penumbra), canvasPlane, canvasIx);
    intersectRayPlane(rayFromDirection(vec3(wall.mid, wall.top[0].z), farShadowDirs.penumbra), canvasPlane, canvasIx);
    Ray2d rCanvasWall = rayFromDirection(canvasIx.xy, wall.direction);
    canvasEdgeD = rCanvasWall;
    canvasEdgeG = rCanvasWall;
  }
  lineLineIntersection(canvasEdgeD, rD_penumbra, E);
  lineLineIntersection(canvasEdgeG, rG_penumbra, H);

  // F and I are on the line parallel to the wall that intersects E and H, accordingly.
  Ray2d rEWall = rayFromDirection(E, wall.direction);
  Ray2d rHWall = rayFromDirection(H, wall.direction);
  lineLineIntersection(rEWall, rD_umbra, F);
  lineLineIntersection(rHWall, rG_umbra, I);

  // Penumbra intersect the FI line to form ∆ABC.
  Ray2d rFI = rayFromPoints(F, I);
  lineLineIntersection(rD_penumbra, rFI, B);
  lineLineIntersection(rG_penumbra, rFI, C);

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

  // Side triangles used for gradient shading. Vary based on wall location relative to light.
  sideTri0 = vec2[3](D, E, I);
  sideTri1 = vec2[3](G, H, F);

  // Umbra triangle used for shading.
  umbraTri = vec2[3](D, G, I);
  if ( nearCollinear ) {
    sideTri0 = vec2[3](A, B, C);
    sideTri1 = vec2[3](A, C, B);
    umbraTri = vec2[3](G, F, I);
  }
  return nearCollinear;
}

/**
 * Define varyings for this shader.
 */
void defineVaryings(bool nearCollinear,
  in vec2[3] penumbraTri, in vec2[3] umbraTri,
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
  fAmbient = vec2(1.0, 0.0); // vec2(1.0) - ambientLight(W0, W1);
  if ( CLOCKWISE(orient(W0, W1, sideTri0[1])) ) fAmbient = fAmbient.yx; // CW

  // Similar to unsized defineFlats.
  // For far, if umbra is infinite, penumbra will be infinite.
  bool hasFarUmbra = !isInfiniteTopShadow(farShadowDirs.umbra);
  bool hasFarPenumbra = !(hasFarUmbra || isInfiniteTopShadow(farShadowDirs.penumbra));
  bool hasNearPenumbra = wallIsFloating() && !isInfiniteTopShadow(nearShadowDirs.penumbra);
  bool hasNearUmbra = wallIsFloating() && !isInfiniteTopShadow(nearShadowDirs.umbra);
  if ( hasFarUmbra || hasFarPenumbra || hasNearPenumbra || hasNearUmbra ) {
    Ray2d wallRatioRay = nearFarMidRay(wall, penumbraTri);
    Plane canvasPlane = constructCanvasPlane();
    if ( hasFarUmbra ) {
      if ( hasFarPenumbra ) fFarRatios[PENUMBRA] = 0.0;

      // TODO: Can we either make the far/near directions into rays or calculate them here?
      // Determine canvas intersection of the light ray running through wall midpoint. See varyingWallRatio.
      Ray lightRay = rayFromDirection(vec3(wall.mid, wall.top[0].z), farShadowDirs.umbra);
      vec3 canvasIx;
      intersectRayPlane(lightRay, canvasPlane, canvasIx);
      lineLineIntersection(wallRatioRay, rayFromDirection(canvasIx.xy, wall.direction), fFarRatios[UMBRA]);
    }

    if ( hasNearPenumbra ) {
      Ray lightRay = rayFromDirection(vec3(wall.mid, wall.bottom[0].z), nearShadowDirs.penumbra);
      vec3 canvasIx;
      intersectRayPlane(lightRay, canvasPlane, canvasIx);
      lineLineIntersection(wallRatioRay, rayFromDirection(canvasIx.xy, wall.direction), fNearRatios[PENUMBRA]);
    }

    if ( hasNearUmbra ) {
      Ray lightRay = rayFromDirection(vec3(wall.mid, wall.bottom[0].z), nearShadowDirs.umbra);
      vec3 canvasIx;
      intersectRayPlane(lightRay, canvasPlane, canvasIx);
      lineLineIntersection(wallRatioRay, rayFromDirection(canvasIx.xy, wall.direction), fNearRatios[UMBRA]);
    }
  }
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
  vec2[3] sideTri0; // Gradient shading.
  vec2[3] sideTri1; // Gradient shading.
  bool nearCollinear = shadowTriangles(sideShadowRays, farShadowDirs, wall,
    penumbraTri, umbraTri, sideTri0, sideTri1);

  // Varyings
  defineSharedVaryings(wall, penumbraTri);
  defineVaryings(nearCollinear, penumbraTri, umbraTri, sideTri0, sideTri1);

  // Flats
  if ( vertexNum == 2) {
    defineSharedFlats(wall, penumbraTri);
    ShadowDirections nearShadowDirs;
    if ( wallIsFloating() ) nearShadowDirs = calculateNearShadowDirections();
    defineFlats(wall, penumbraTri, sideTri0, farShadowDirs, nearShadowDirs);
  }
}