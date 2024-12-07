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
out vec3 vNearFarPenumbra0;
out vec3 vNearFarPenumbra1;
out vec3 vUmbra;
out float vEdgeDist;

flat out float fWallSenseType;
flat out float fThresholdRadius2;
flat out vec2 fWallHeights; // r: topZ to canvas bottom; g: bottomZ to canvas bottom
flat out vec2 fWallRatios;
flat out vec2 fFarRatios0;
flat out vec2 fFarRatios1;
flat out vec2 fNearRatios0;
flat out vec2 fNearRatios1;
flat out vec2 fAmbient;

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
Light calculateLightPositions(in Wall wall) {
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
  in vec2[3] sideTri0,
  in vec2[3] nearFarTri0, in vec2[3] nearFarTri1,
  in ShadowRays2d sideShadowRays,
  in ShadowDirections farShadowDirs, in ShadowDirections nearShadowDirs,
  in bool hasFarPenumbra) {

  bvec2 hasUmbraShadows = bvec2(true, true); // @type bvec2 for FAR, NEAR.
  bvec2 hasPenumbraShadows = bvec2(true, true); // @type bvec2 for FAR, NEAR.
  hasPenumbraShadows[FAR] = hasFarPenumbra;
  hasUmbraShadows[FAR] = farShadowDirs.umbra.z < 0.0;
  if ( !wallIsFloating() ) {
    hasUmbraShadows[NEAR] = false;
    hasPenumbraShadows[NEAR] = false;
  } else {
    hasUmbraShadows[NEAR] = nearShadowDirs.umbra.z < 0.0;
  }

  vec3 wTop = wall.top[0];
  vec3 wBottom = wall.bottom[0];
  vec2 wallDir = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
  vec3 wallTopMid = (wall.top[0] + wall.top[1]) * 0.5;
  // @type {vec2} fAmbient
  vec2 W0 = sideTri0[0];
  vec2 W1 = all(equal(wall.top[0].xy, W0)) ? wall.top[0].xy : wall.top[1].xy;
  fAmbient = vec2(1.0) - ambientLight(W0, W1);
  if ( orient(W0, W1, sideTri0[1]) < 0.0 ) fAmbient = fAmbient.yx; // CW

  // @type {vec2} fWallHeights
  fWallHeights[TOP] = wTop.z;
  fWallHeights[BOTTOM] = wBottom.z;

  // @type {vec2} fWallRatios
  // Location of the wall along the x axis of the two near/far triangles.
  // The intersect of the wall with DE and GH determine the ratio.
  Ray2d wallRay = Ray2d(wallTopMid.xy, wallDir);
  Ray2d rayED = Ray2d(nearFarTri0[1], normalizedDirection(nearFarTri0[1], nearFarTri0[0]));
  Ray2d rayHG = Ray2d(nearFarTri1[1], normalizedDirection(nearFarTri1[1], nearFarTri1[0]));
  float distDE = distance(nearFarTri0[0], nearFarTri0[1]);
  float distGH = distance(nearFarTri1[0], nearFarTri1[1]);
  vec2 wallRatios;
  lineLineIntersection(rayED, wallRay, wallRatios[0]); // T value
  lineLineIntersection(rayHG, wallRay, wallRatios[1]); // T value
  wallRatios[0] /= distDE;
  wallRatios[1] /= distGH;
  fWallRatios = wallRatios;

  // @type {vec2} fFarRatios0   UMBRA and PENUMBRA
  // @type {vec2} fFarRatios1   UMBRA and PENUMBRA
  // For far shadows, if infinite, use, the infiniteShadowCanvasRay as the ending point.
  // Otherwise, use the penumbra canvas intersection based on the far direction (through midpoint).
  fFarRatios0 = vec2(-1.0);
  fFarRatios1 = vec2(-1.0);
  vec3 canvasIx;
  Plane canvasPlane = constructCanvasPlane();
  if ( hasUmbraShadows[FAR] && !isInfiniteShadow(farShadowDirs.penumbra)
    && intersectRayPlane(Ray(wallTopMid, farShadowDirs.penumbra), canvasPlane, canvasIx) ) {
    fFarRatios0[PENUMBRA] = 0.0;
    fFarRatios1[PENUMBRA] = 0.0;
  }

  // For far umbra shadow, redo the shadow triangle to get the new E and H locations.
  vec3 canvasFarUmbraIx;
  if ( !isInfiniteShadow(farShadowDirs.umbra)
    && intersectRayPlane(Ray(wallTopMid, farShadowDirs.umbra), canvasPlane, canvasFarUmbraIx) ) {
    Ray2d canvasFarUmbraRay = Ray2d(canvasFarUmbraIx.xy, wallDir);
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
    shadowPoints(sideShadowRays, wall, canvasFarUmbraRay,
      A, B, C, D, E, F, G, H, I, W0, W1);
    fFarRatios0[UMBRA] = (distDE - distance(D, E)) / distDE;
    fFarRatios1[UMBRA] = (distGH - distance(G, H)) / distGH;
  }

  // @type {vec2} fNearRatios0   UMBRA and PENUMBRA
  // @type {vec2} fNearRatios1   UMBRA and PENUMBRA
  // For near shadows, move the wall at the midpoint.
  // The intersect of the wall with DE and GH determine the ratio.
  fNearRatios0 = vec2(-1.0);
  fNearRatios1 = vec2(-1.0);
  float canvasElevation = uElevationRes.x;
  if ( wallIsFloating() ) {
    vec3 wallBottomMid = (wall.bottom[0] + wall.bottom[1]) * 0.5;
    vec3 canvasNearUmbraIx;
    vec3 canvasNearPenumbraIx;
    if ( !isInfiniteShadow(nearShadowDirs.umbra)
      && intersectRayPlane(Ray(wallBottomMid, nearShadowDirs.penumbra), canvasPlane, canvasNearUmbraIx) ) {
      Ray2d umbraWallRay = Ray2d(canvasNearUmbraIx.xy, wallDir);
      lineLineIntersection(rayED, umbraWallRay, fNearRatios0[PENUMBRA]);
      lineLineIntersection(rayHG, umbraWallRay, fNearRatios1[PENUMBRA]);
    }
    if ( !isInfiniteShadow(nearShadowDirs.penumbra)
      && intersectRayPlane(Ray(wallBottomMid, nearShadowDirs.umbra), canvasPlane, canvasNearPenumbraIx) ) {
      Ray2d penumbraWallRay = Ray2d(canvasNearPenumbraIx.xy, wallDir);
      lineLineIntersection(rayED, penumbraWallRay, fNearRatios0[UMBRA]);
      lineLineIntersection(rayHG, penumbraWallRay, fNearRatios1[UMBRA]);
    }
  }
}

/**
 * Define varyings for this shader.
 */
void defineVaryings(in Wall wall, in ShadowRays2d sideShadowRays, in Ray2d farPenumbraCanvasRay,
  in vec2[3] penumbraTri, in vec2[3] umbraTri,
  in vec2[3] nearFarTri0, in vec2[3] nearFarTri1,
  in vec2[3] sideTri0, in vec2[3] sideTri1) {

  int vertexNum = gl_VertexID % 3;

  // Presets for varyings.
  vPenumbra = vec3(0.0);
  vUmbra = vec3(-1.0);
  vSidePenumbra0 = vec3(-1.0);
  vSidePenumbra1 = vec3(-1.0);
  vNearFarPenumbra0 = vec3(-1.0);
  vNearFarPenumbra1 = vec3(-1.0);

  // Triangles defining parts of the shadow.
  bool nearCollinear = shadowTriangles(sideShadowRays, wall, farPenumbraCanvasRay,
    penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1);

  // Location of this vertex.
  // @type {vec2} vVertexPosition
  vVertexPosition = penumbraTri[vertexNum];

  // @type {vec3} vUmbra
  if ( nearCollinear ) vUmbra = baryForPoint(vVertexPosition, umbraTri);

  // @type {vec3} vSidePenumbra0, vSidePenumbra1
  // Define side triangles in relation to the penumbra triangle.
  // If no real side penumbra, set values to -1 to avoid inclusion.
  if ( abs(orient(sideTri0[0], sideTri0[1], sideTri0[2])) > 1.0 ) vSidePenumbra0 = baryForPoint(vVertexPosition, sideTri0);
  if ( abs(orient(sideTri1[0], sideTri1[1], sideTri1[2])) > 1.0 ) vSidePenumbra1 = baryForPoint(vVertexPosition, sideTri1);

  // @type {vec3} vNearFarPenumbra0, vNearFarPenumbra1
  // Define the near/far triangles used to adjust the shadow for elevation.
  if ( abs(orient(nearFarTri0[0], nearFarTri0[1], nearFarTri0[2])) > 1.0 ) vNearFarPenumbra0 = baryForPoint(vVertexPosition, nearFarTri0);
  if ( abs(orient(nearFarTri1[0], nearFarTri1[1], nearFarTri1[2])) > 1.0 ) vNearFarPenumbra1 = baryForPoint(vVertexPosition, nearFarTri1);
}

void main() {
  // Defined constants.
  int vertexNum = gl_VertexID % 3;

  Wall wall = calculateWallPositions();
  Light light = calculateLightPositions(wall);

  // @type {vec3} vPenumbra
  vPenumbra = vec3(0.0);
  vPenumbra[vertexNum] = 1.0;

  // Side shadows.
  ShadowRays2d sideShadowRays = calculateSideShadowRays(wall, light);

  // Far direction.
  ShadowDirections farShadowDirs = calculateFarShadowDirections(wall, light);

  // Far canvas ray, representing the canvas intersection.
  Ray2d farPenumbraCanvasRay;
  bool hasFarPenumbra = canvasIntersectionRay(farShadowDirs.penumbra, sideShadowRays.penumbra,
    wall, farPenumbraCanvasRay);

  // Triangles defining parts of the shadow.
  vec2[3] penumbraTri;
  vec2[3] umbraTri; // Gradient shading.
  vec2[3] nearFarTri0; // Defining near and far shadows.
  vec2[3] nearFarTri1; // Defining near and far shadows.
  vec2[3] sideTri0; // Gradient shading.
  vec2[3] sideTri1; // Gradient shading.

  // Varyings
  defineBasicVaryings();
  defineVaryings(wall, sideShadowRays, farPenumbraCanvasRay,
    penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1);

  // Flats
  if ( vertexNum == 2) {
    defineBasicFlats();
    ShadowDirections nearShadowDirs;
    if ( wallIsFloating() ) nearShadowDirs = calculateNearShadowDirections(wall, light);
    defineFlats(wall, sideTri0, nearFarTri0, nearFarTri1,
      sideShadowRays, farShadowDirs, nearShadowDirs, hasFarPenumbra);
  }
}