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
out float vWallRatio;

flat out float fWallSenseType;
flat out float fThresholdRadius2;
flat out vec2 fWallHeights;
flat out float fWallRatio;
flat out vec2 fNearRatios;
flat out float fFarRatio;
flat out vec2 fAmbient;
flat out vec2 fNearRatios;
flat out vec2 fFarRatios;

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
 * Calculate the penumbra triangle.
 * @param {Wall} wall
 * @param {ShadowDirections2d[2]} sideShadowDirs
 * @returns {vec2[3]}
 */
vec2[3] calculatePenumbraTriangle(in Wall wall, in ShadowDirections2d[2] sideShadowDirs, in ShadowDirections farShadowDirs) {
  // The penumbra 0 vertex is the point at which the penumbra rays cross.
  vec2 v0;
  lineLineIntersection(
    Ray2d(wall.top[0].xy, sideShadowDirs[0].penumbra),
    Ray2d(wall.top[1].xy, sideShadowDirs[1].penumbra),
    v0);

  // Intersect the penumbra rays with the line parallel to the wall at the canvas intersection.
  Ray2d farRay = shadowNearFarRay(wall, farShadowDirs.penumbra, FAR);
  vec2 ix0;
  vec2 ix1;
  lineLineIntersection(farRay, Ray2d(v0, sideShadowDirs[0].penumbra), ix0);
  lineLineIntersection(farRay, Ray2d(v0, sideShadowDirs[1].penumbra), ix1);
  return vec2[3](
    v0,
    ix0,
    ix1
  );
}

/**
 * Calculate the side triangle.
 * @param {int} idx
 * @param {vec2[3]} penumbraTri
 * @param {Wall} wall
 * @param {ShadowDirections2d[2]} sideShadowDirs
 * @param {ShadowDirections} farShadowDirs
 * @returns {vec2[3]}
 */
vec2[3] calculateSideTriangle(in int idx, in vec2[3] penumbraTri, in Wall wall, in ShadowDirections2d[2] sideShadowDirs, in ShadowDirections farShadowDirs) {
  // For directional lights, the 0 vertex is at the wall endpoint.
  vec2 v0 = wall.top[idx].xy;

  // Intersect the umbra ray with the line parallel to the wall at the canvas intersection.
  Ray2d farRay = shadowNearFarRay(wall, farShadowDirs.umbra, FAR);
  vec2 ix;
  lineLineIntersection(farRay, Ray2d(v0, sideShadowDirs[idx].umbra), ix);
  return vec2[3](
    v0,
    ix,
    penumbraTri[idx + 1] // The penumbra canvas intersection for endpoint 0 or 1.
  );
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

  Wall wall = calculateWallPositions();
  bvec2 hasSideShadows = bvec2(true, true); // @type bvec2 for endpoint 0, 1.

  // Side shadows.
  ShadowDirections2d[2] sideShadowDirs = ShadowDirections2d[2](
    calculateSideShadowDirections(0, wall),
    calculateSideShadowDirections(1, wall)
  );

  // Near/far shadows.
  bvec2 hasUmbraShadows = bvec2(true, true); // @type bvec2 for FAR, NEAR.
  ShadowDirections farShadowDirs = calculateFarShadowDirections();
  ShadowDirections nearShadowDirs;
  if ( wallIsFloating() ) nearShadowDirs = calculateNearShadowDirections();

  ${PENUMBRA_VERTEX_CALCULATIONS}
}