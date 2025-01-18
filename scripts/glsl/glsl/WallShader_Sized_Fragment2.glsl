#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Sized Fragment 2 (LightRay sampling) ----- */

// #define SHADOW true

#define TOTAL_COLLISIONS    50

uniform sampler2D uTerrainSampler;
uniform vec3 uLightPosition;
uniform float uLightSize;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier
uniform float uTime;
uniform vec4 uSceneDims;

in vec2 vVertexPosition;
in vec2 vTerrainTexCoord;
in float vEdgeDist;
in float vLREdgeDist;

flat in float fThresholdRadius2;
flat in float fWallSenseType;
flat in vec2 fWallHeights;
flat in vec2 fNearDistances;
flat in vec2 fFarDistances;
flat in vec3 fWallTop0;
flat in vec3 fWallTop1;
flat in vec3 fWallBottom0;
flat in vec3 fWallBottom1;
flat in vec2 fFarLDistances;
flat in vec2 fNearLDistances;
flat in vec2 fFarRDistances;
flat in vec2 fNearRDistances;

out vec4 fragColor;

${PENUMBRA_FRAGMENT_FUNCTIONS}

${defineStruct("Ray")}
${defineFunction("projectRay")}
${defineFunction("orient")}
${defineFunction("linearConversion")}
${defineFunction("hash")}
${defineFunction("distanceToLine")}
${defineFunction("normalizedDirection")}
${defineFunction("noise")}
${defineFunction("lineLineIntersection")}

/**
 * Select a position on the sphere given vec3 between -1 and 1.
 * 0 would be dead center.
 * @param {vec3} dir
 * @returns {vec3}
 */
vec3 spherePosition(in vec3 dir) { return uLightPosition + (dir * uLightSize); }

/**
 * Determine whether there is a collision with the wall at a given direction from the fragment.
 * @param {Ray2d} r     Ray to test for intersection
 * @param {vec3} dir
 * @param {float} elevation
 * @returns {int} 0 if no collision, 1 if collision
 */
int wallCollision(in Ray r) {
  vec2 hWall0 = fWallTop0.xy;
  vec2 hWall1 = fWallTop1.xy;
  vec2 vWall0 = vec2(0.0, fWallTop0.z);
  vec2 vWall1 = vec2(0.0, fWallBottom0.z);

  // Move 1 pixel toward the light, to measure orientation w/r/t the light ray.
  vec3 b = projectRay(r, 1.0);

  // Test for horizontal collision. Wall endpoints are opposite sides of the light ray.
  bool hCollision = orient(r.origin.xy, b.xy, hWall0) * orient(r.origin.xy, b.xy, hWall1) < 0.0;
  if ( !hCollision ) return 0;

  // Test for vertical collision. Transform coordinates based on direction to wall.
  Ray2d rWall = Ray2d(hWall0, hWall1 - hWall0);
  vec2 wallIx;
  lineLineIntersection(Ray2d(r.origin.xy, r.direction.xy), rWall, wallIx);

  float distA = distance(r.origin.xy, wallIx);
  float distB = distance(b.xy, wallIx);
  vec2 vA = vec2(distA, r.origin.z);
  vec2 vB = vec2(distB, b.z);
  bool vCollision = orient(vA, vB, vWall0) * orient(vA, vB, vWall1) < 0.0;
  if ( !vCollision ) return 0;
  return 1;
}

/**
 * Determine the shadow percentage.
 */
float shadowPercentage() {
  // Debugging: return 1.0;

  // For each direction, test intersection with the wall.
  // TODO: If the wall has different heights for each endpoint, adjust to match the point
  // at which the light ray intersects the wall.
  // TODO: skip tests if certain horizontals or verticals are blocked?
  //       skip tests based on inclusion in umbra triangle?
  // TODO: Use tangents?
  int numCollisions = 0;
  float totalCollisions = float(TOTAL_COLLISIONS);
  float elevation = terrainElevation(uTerrainSampler, vTerrainTexCoord, uElevationRes);
  vec3 a = vec3(vVertexPosition, elevation);
  /*
  for ( int i = 0; i < TOTAL_COLLISIONS; i += 1 ) {
    vec3 pos = randomSpherePosition(float(i) + elevation);
    vec3 dir = normalizedDirection(a, pos);
    numCollisions += wallCollision(dir, elevation);
  }
  */
  /*
  vec3[7] pts = vec3[7](
    vec3(0.0),
    vec3(1.0, 0.0, 0.0),
    vec3(-1.0, 0.0, 0.0),
    vec3(0.0, 1.0, 0.0),
    vec3(0.0, -1.0, 0.0),
    vec3(0.0, 0.0, 1.0),
    vec3(0.0, 0.0, -1.0)
  );

  totalCollisions = 7.0;
  for ( int i = 0; i < 7; i += 1 ) {
    vec3 pos = spherePosition(pts[i]);
    vec3 dir = normalizedDirection(a, pos);
    numCollisions += wallCollision(dir, elevation);
  }

  totalCollisions += 6.0;
  for ( int i = 1; i < 7; i += 1 ) {
    vec3 pos = spherePosition(pts[i] * vec3(0.5));
    vec3 dir = normalizedDirection(a, pos);
    numCollisions += wallCollision(dir, elevation);
  }

  totalCollisions += 6.0;
  for ( int i = 1; i < 7; i += 1 ) {
    vec3 pos = spherePosition(pts[i] * vec3(0.75));
    vec3 dir = normalizedDirection(a, pos);
    numCollisions += wallCollision(dir, elevation);
  }

  totalCollisions += 6.0;
  for ( int i = 1; i < 7; i += 1 ) {
    vec3 pos = spherePosition(pts[i] * vec3(0.25));
    vec3 dir = normalizedDirection(a, pos);
    numCollisions += wallCollision(dir, elevation);
  }
  */


  /*
  vec2 uv = vVertexPosition / uSceneDims.zw;
  for ( int i = 0; i < TOTAL_COLLISIONS; i += 1 ) {
    vec2 seed1 = uv + fract(uTime * (float(i) / totalCollisions));
    vec2 seed2 = uv - fract(uTime * (float(i) / totalCollisions));
    vec2 seed3 = uv;
    float rand1 = noise(seed1);
    float rand2 = noise(seed2);
    float rand3 = noise(seed3);

    vec3 diff = uLightSize * linearConversion(vec3(rand1, rand2, rand3), 0.0, 1.0, -1.0, 1.0);

    // Forms a cube.
    vec3 pos = uLightPosition + diff;
    vec3 dir = normalizedDirection(a, pos);
    numCollisions += wallCollision(dir, elevation);
  }
  */
  /*
  vec2 uv = vVertexPosition / uSceneDims.zw;
  for ( int i = 0; i < TOTAL_COLLISIONS; i += 1 ) {
    vec2 seed1 = uv + fract(uTime * (float(i) / totalCollisions));
    vec2 seed2 = uv - fract(uTime * (float(i) / totalCollisions));
    vec2 rand1 = noiseV2(seed1);
    float rand2 = noise(seed2);
    vec3 diff = uLightSize * linearConversion(vec3(rand1.x, rand1.y, rand2), 0.0, 1.0, -1.0, 1.0);

    // Forms a cube.
    vec3 pos = uLightPosition + diff;
    vec3 dir = normalizedDirection(a, pos);
    numCollisions += wallCollision(dir, elevation);
  }
  */
  // float vx = vVertexPosition.x / uElevationRes.z;
  // float vy = vVertexPosition.y / uElevationRes.w;
  // float vv = dot(vVertexPosition, vVertexPosition) / dot(uElevationRes.zw, uElevationRes.zw);

  /*
  totalCollisions += 20.0;
  for ( int i = 0; i < 20; i += 1 ) {
    float j = float(i) + 1.0;
    float rand0 = hash(uTime + j);
    float rand1 = hash(uTime + (j * totalCollisions));
    float rand2 = hash(uTime + (j * totalCollisions * totalCollisions));

    float x = linearConversion(rand0, 0.0, 1.0, -1.0, 1.0);
    float y = linearConversion(rand1, 0.0, 1.0, -1.0, 1.0);
    float z = linearConversion(rand2, 0.0, 1.0, -1.0, 1.0);

    vec3 pos = spherePosition(vec3(x, y, z));
    vec3 dir = normalizedDirection(a, pos);
    numCollisions += wallCollision(dir, elevation);
  }
  */

  for ( int i = 0; i < TOTAL_COLLISIONS; i += 1 ) {
    float j = float(i) + 1.0;
    float x = hash(uTime + j);
    float y = hash(uTime + (j * totalCollisions));
    float z = hash(uTime + (j * totalCollisions * totalCollisions));

    // Pseudo-Gaussian 3d distribution.
    vec3 rndDir = (x * y * z == 0.0) ? vec3(0.0) : normalize(vec3(x, y, z));
    vec3 pos = spherePosition(linearConversion(rndDir, 0.0, 1.0, -1.0, 1.0));
    numCollisions += wallCollision(Ray(a, normalizedDirection(a, pos)));
  }


  // TODO: Add in adjacent pixel values as part of the average here.
  return float(numCollisions) / totalCollisions;
}






void main() {
  ${PENUMBRA_FRAGMENT_CALCULATIONS}
}