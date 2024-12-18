#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Directional Fragment ----- */

// #define SHADOW
#define EV_DIRECTIONAL_LIGHT true
#define TOTAL_COLLISIONS    13

uniform sampler2D uTerrainSampler;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier
uniform vec4 uSceneDims;
uniform float uTime;
uniform float uAzimuth; // radians
uniform float uElevationAngle; // radians
uniform float uSolarAngle; // radians

in vec2 vVertexPosition;
in vec2 vTerrainTexCoord;
in float vEdgeDist;
in float vWallRatio;

flat in float fThresholdRadius2;
flat in float fWallSenseType;
flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in float fWallRatio;
flat in vec2 fNearRatios;
flat in vec2 fFarRatios;
flat in vec3 fWallTop0;
flat in vec3 fWallTop1;
flat in vec3 fWallBottom0;
flat in vec3 fWallBottom1;

out vec4 fragColor;

${PENUMBRA_FRAGMENT_FUNCTIONS}

${defineFunction("orient")}
${defineFunction("linearConversion")}
${defineFunction("hash")}
${defineFunction("distanceToLine")}
${defineFunction("normalizedDirection")}
${defineFunction("noise")}
${defineFunction("fromAngle")}

/**
 * Determine whether there is a collision with the wall at a given direction from the fragment.
 * @param {vec3} dir
 * @param {float} elevation
 * @returns {int}
 */
int wallCollision(in vec3 dir, in float elevation) {
  vec2 hWall0 = fWallTop0.xy;
  vec2 hWall1 = fWallTop1.xy;
  vec2 vWall0 = vec2(0.0, fWallTop0.z);
  vec2 vWall1 = vec2(0.0, fWallBottom0.z);

  // Move 1 pixel toward the light, to measure orientation w/r/t the light ray.
  vec3 b3d = vec3(vVertexPosition, elevation) + dir;

  // Test for horizontal collision. Wall endpoints are opposite sides of the light ray.
  bool hCollision = orient(vVertexPosition, b3d.xy, hWall0) * orient(vVertexPosition, b3d.xy, hWall1) < 0.0;
  if ( !hCollision ) return 0;

  // Test for vertical collision. Transform coordinates based on direction to wall.
  vec2 vA = vec2(vEdgeDist, elevation);
  float distB = distanceToLine(b3d.xy, hWall0, normalizedDirection(hWall0, hWall1));
  vec2 vB = vec2(distB, b3d.z);
  bool vCollision = orient(vA, vB, vWall0) * orient(vA, vB, vWall1) < 0.0;
  if ( !vCollision ) return 0;
  return 1;
}

/**
 * Determine the shadow percentage.
 */
float shadowPercentage() {
  // For each direction, test intersection with the wall.
  // TODO: If the wall has different heights for each endpoint, adjust to match the point
  // at which the light ray intersects the wall.
  // TODO: skip tests if certain horizontals or verticals are blocked?
  //       skip tests based on inclusion in umbra triangle?
  // TODO: Use tangents?
  // Direction from light to endpoint.
  vec2 dirMidPenumbra = normalize(fromAngle(vec2(0.0), uAzimuth, 1.0) * -1.0);

  // Determine which side of the wall the light is on.
  float oWallLight = sign(orient(fWallTop0.xy, fWallTop1.xy, fWallTop0.xy - dirMidPenumbra));

  // Sample from range of solar angle and azimuth.
  // The angle for the penumbra is the azimuth ± the solarAngle.
  float solarAngle = max(0.1, uSolarAngle); // TODO: Cannot currently go all the way to 0.
  float solarWallAngle = solarAngle * oWallLight;
  vec2 hMinDir = fromAngle(vec2(0.0, 0.0), uAzimuth - solarWallAngle, 1.0);
  vec2 hMaxDir = fromAngle(vec2(0.0, 0.0), uAzimuth + solarWallAngle, 1.0);
  vec2 hMidDir = (hMinDir + hMaxDir) * 0.5;

  // Vertical angle is elevation angle ± solar angle.
  vec2 vMinZ = fromAngle(vec2(0.0, 0.0), uElevationAngle - solarAngle, 1.0);
  vec2 vMaxZ = fromAngle(vec2(0.0, 0.0), uElevationAngle + solarAngle, 1.0);
  float zMin = vMinZ.x == 0.0 ? 1e06 : vMinZ.y / vMinZ.x;
  float zMax = vMaxZ.x == 0.0 ? 1e06 : vMaxZ.y / vMaxZ.x;
  float zMid = (zMin + zMax) * 0.5;

  vec3[TOTAL_COLLISIONS] dirs;
  dirs[0] = normalize(vec3(hMidDir, zMid));

  dirs[1] = normalize(vec3(hMinDir, zMid));
  dirs[2] = normalize(vec3(hMaxDir, zMid));

  dirs[3] = normalize(vec3(hMidDir, zMin));
  dirs[4] = normalize(vec3(hMidDir, zMax));

  dirs[5] = normalize(vec3(hMaxDir, zMin));
  dirs[6] = normalize(vec3(hMaxDir, zMin));

  dirs[7] = normalize(vec3(hMaxDir, zMax));
  dirs[8] = normalize(vec3(hMaxDir, zMax));

  dirs[9] = (dirs[0]+ dirs[1]) * 0.5;
  dirs[10] = (dirs[0] + dirs[2]) * 0.5;
  dirs[11] = (dirs[0] + dirs[3]) * 0.5;
  dirs[12] = (dirs[0] + dirs[4]) * 0.5;

  int numCollisions = 0;
  float totalCollisions = float(TOTAL_COLLISIONS);
  float elevation = terrainElevation(uTerrainSampler, vTerrainTexCoord, uElevationRes);
  vec3 a = vec3(vVertexPosition, elevation);
  for ( int i = 0; i < TOTAL_COLLISIONS; i += 1 ) {
    vec3 dir = dirs[i];
    numCollisions += wallCollision(dir, elevation);
  }

  // TODO: Add in adjacent pixel values as part of the average here.
  return float(numCollisions) / totalCollisions;
}


void main() {
  ${PENUMBRA_FRAGMENT_CALCULATIONS}
}