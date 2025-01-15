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
 * Direction toward the wall middle, used to measure far umbra line.
 * @param {Wall} wall
 * @param {Light} light
 * @returns {ShadowDirections}
 */
ShadowDirections calculateFarShadowDirections(in Wall wall, in Light light) {
  vec3 wallMid = vec3(wall.mid, wall.top[0].z);
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
  vec3 wallMid = vec3(wall.mid, wall.bottom[0].z);
  return ShadowDirections(
    normalizedDirection(light.bottom, wallMid), // umbra
    normalizedDirection(light.center, wallMid), // midpenumbra
    normalizedDirection(light.top, wallMid) // penumbra
  );
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

  // If W0 == A, then the wall is nearly collinear with the light (line from wall intersects light circle).
  bool nearCollinear = almostEqual(W0, A, 1.0e-08);


  // D and G are set by the intersection of their respective penumbra/umbra lines.
  // Most of the matching work done in sideShadowRays.
  lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.umbra[0], D);
  lineLineIntersection(sideShadowRays.penumbra[1], sideShadowRays.umbra[1], G);

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
  vec3 wallMid3d = vec3(wall.mid, wall.top[0].z);
  vec3[2] vTangents;
  verticalTangents(wallMid3d, vTangents);
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
  vec2 a = vec2[2](E, F)[collinearIdx];
  vec2 b = vec2[2](F, I)[collinearIdx];
  Ray2d rab = Ray2d(furthestPoint, b - a);
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
    if ( hasFarUmbra ) {
      if ( hasFarPenumbra ) fFarRatios[PENUMBRA] = 0.0;

      // TODO: Can we either make the far/near directions into rays or calculate them here?
      // Determine canvas intersection of the light ray running through wall midpoint. See varyingWallRatio.
      Ray lightRay = Ray(light.top, farShadowDirs.umbra);
      vec3 canvasIx;
      intersectRayPlane(lightRay, canvasPlane, canvasIx);
      lineLineIntersection(wallRatioRay, Ray2d(canvasIx.xy, wall.direction), fFarRatios[UMBRA]);
    }

    if ( hasNearPenumbra ) {
      Ray lightRay = Ray(light.top, nearShadowDirs.penumbra);
      vec3 canvasIx;
      intersectRayPlane(lightRay, canvasPlane, canvasIx);
      lineLineIntersection(wallRatioRay, Ray2d(canvasIx.xy, wall.direction), fNearRatios[PENUMBRA]);
    }

    if ( hasNearUmbra ) {
      Ray lightRay = Ray(light.bottom, nearShadowDirs.umbra);
      vec3 canvasIx;
      intersectRayPlane(lightRay, canvasPlane, canvasIx);
      lineLineIntersection(wallRatioRay, Ray2d(canvasIx.xy, wall.direction), fNearRatios[UMBRA]);
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
  vec2 perpDir = vec2(wall.direction.y, -wall.direction.x);
  vec2 p0 = projectRay(Ray2d(wall.top[0].xy, perpDir), 1.0);
  vec2 p1 = projectRay(Ray2d(wall.top[1].xy, perpDir), 1.0);
  return orient(wall.top[0].xy, p0, pt) * orient(wall.top[1].xy, p1, pt) < 0.0;
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
  defineVaryings(nearCollinear, penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1);

  // Flats
  if ( vertexNum == 2) {
    defineSharedFlats(wall, penumbraTri);
    ShadowDirections nearShadowDirs;
    if ( wallIsFloating() ) nearShadowDirs = calculateNearShadowDirections(wall, light);
    defineFlats(wall, penumbraTri, sideTri0, farShadowDirs, nearShadowDirs);
  }
}