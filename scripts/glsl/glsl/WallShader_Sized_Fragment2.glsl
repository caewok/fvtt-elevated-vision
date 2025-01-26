#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Sized Fragment 2 (LightRay sampling) ----- */

// #define SHADOW true

#define TOTAL_COLLISIONS      52
#define TOTAL_MID_COLLISIONS  ((TOTAL_COLLISIONS / 2) - 2)

// Type of algorithm to use to generate collision test points.
// 0: random 3d, 1: random 2d, 2: fixed spacing 2d
#define ALG_TYPE              1

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
flat in vec2 fFarRLPenumbraDistances;
flat in vec2 fFarRLUmbraDistances;
flat in vec2 fNearRLPenumbraDistances;
flat in vec2 fNearRLUmbraDistances;
flat in vec2 fAmbient;

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
${defineFunction("planePointTo3d")}

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
float wallCollision(in Ray r) {
  vec2 hWall0 = fWallTop0.xy;
  vec2 hWall1 = fWallTop1.xy;
  vec2 vWall0 = vec2(0.0, fWallTop0.z);
  vec2 vWall1 = vec2(0.0, fWallBottom0.z);

  // Move 1 pixel toward the light, to measure orientation w/r/t the light ray.
  vec3 b = projectRay(r, 1.0);

  // Test for horizontal collision. Wall endpoints are opposite sides of the light ray.
  bool hCollision = OPP_SIDE(orient(r.origin.xy, b.xy, hWall0), orient(r.origin.xy, b.xy, hWall1));
  if ( !hCollision ) return 0.0;

  // Test for vertical collision. Transform coordinates based on direction to wall.
  Ray2d rWall = Ray2d(hWall0, hWall1 - hWall0);
  vec2 wallIx;
  lineLineIntersection(Ray2d(r.origin.xy, r.direction.xy), rWall, wallIx);

  float distA = distance(r.origin.xy, wallIx);
  float distB = distance(b.xy, wallIx);
  vec2 vA = vec2(distA, r.origin.z);
  vec2 vB = vec2(distB, b.z);
  bool vCollision = OPP_SIDE(orient(vA, vB, vWall0), orient(vA, vB, vWall1));
  if ( !vCollision ) return 0.0;
  return 1.0;
}

/**
 * Axis vectors for a plane.
 * https://math.stackexchange.com/questions/64430/find-extra-arbitrary-two-points-for-a-plane-given-the-normal-and-a-point-that-l
 * @param {Plane} plane
 * @returns {vec3[2]} Two orthogonal vectors on the plane, normalized
 */
vec3[2] planeAxisVectors(in Plane plane) {
  vec3 w = plane.normal.x == 0.0 ? vec3(1.0, 0.0, 0.0)
    : plane.normal.y == 0.0 ? vec3(0.0, 1.0, 0.0)
      : plane.normal.z == 0.0 ? vec3(0.0, 0.0, 1.0)
        : (plane.normal.x < plane.normal.y) && (plane.normal.x < plane.normal.z) ? vec3(1.0, 0.0, 0.0)
          : plane.normal.y < plane.normal.z ? vec3(0.0, 1.0, 0.0)
            : vec3(0.0, 0.0, 1.0);
  vec3 u = normalize(cross(w, plane.normal));
  vec3 n = normalize(cross(plane.normal, u));
  return vec3[2](u, n);
}

/**
 * 2d conversion matrix.
 * Matrix should take points on the plane and shift to 2d: {x,y,z} * M = {x, y, 0}
 * Inverse of matrix should reverse the operation: {x, y, 0} * Minv = {x, y, z}
 * https://stackoverflow.com/questions/49769459/convert-points-on-a-3d-plane-to-2d-coordinates
 * @returns {Matrix} 4x4 matrix
 */
void plane2dConversionMatrix(in Plane plane, out mat4 M, inout mat4 Minv) {
  vec3[2] vs = planeAxisVectors(plane);
  vec3 u = plane.point + vs[0];
  vec3 v = plane.point - vs[1];
  vec3 n = plane.point + plane.normal;

  // column major, left-hand coordinate system
  Minv = mat4(
    plane.point.x, u.x, v.x, n.x,
    plane.point.y, u.y, v.y, n.y,
    plane.point.z, u.z, v.z, n.z,
    1.0, 1.0, 1.0, 1.0
  );

  mat4 D = mat4(
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    0.0, 0.0, 0.0, 1.0,
    1.0, 1.0, 1.0, 1.0
  );
  M = D * inverse(Minv);
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

  float elevation = terrainElevation(uTerrainSampler, vTerrainTexCoord, uElevationRes);
  vec3 a = vec3(vVertexPosition, elevation);

  #if (ALG_TYPE == 0)

  float numCollisions = 0.0;
  float totalCollisions = float(TOTAL_COLLISIONS);
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
  return numCollisions / totalCollisions;

  #elif (ALG_TYPE == 1)
  /**
   * Slice the light sphere such that is creates a 2d circle orthogonal to the
   * line from the fragment to the center of the sphere.
   * If the light and fragment are at the same elevation, this would be a vertical circle.
   * Use this circle to generate random test points along the horizontal and vertical lines.
   */
  // Use cross product to find the horizontal and vertical vectors.
  /*
  vec3 viewV = normalizedDirection(a, uLightPosition);
  vec3 hCross = normalize(vec3(-viewV.y, viewV.x, 0.0)); // Always align along horizontal plane.
  vec3 vCross = cross(viewV, hCross); // Tilt vertical plane to keep perpendicular with the view ray.

  // Add up the collisions for random points within the 2d circle.
  float numCollisions = 0.0;
  float totalCollisions = float(TOTAL_COLLISIONS);
  for ( int i = 0; i < TOTAL_COLLISIONS; i += 1 ) {
    float j = float(i) + 1.0;
    float x = (hash(uTime + j) * 2.0) - 1.0;
    float y = (hash(uTime + (j * totalCollisions)) * 2.0) - 1.0;
    float d = hash(uTime + (j * totalCollisions * totalCollisions)) * uLightSize;

    // Pseudo-Gaussian 2d distribution. (maybe?)
    vec3 sqPt = (hCross * x) + (vCross * y);
    vec3 dir = normalize(sqPt);
    vec3 pos = dir * d;
    numCollisions += wallCollision(Ray(a, normalizedDirection(a, pos)));
  }
  return numCollisions / totalCollisions;
  */

  Plane lightCircle = Plane(uLightPosition, normalizedDirection(a, uLightPosition));
  mat4 M2d;
  mat4 M3d;
  plane2dConversionMatrix(lightCircle, M2d, M3d);

  // Add up the collisions for random points within the 2d circle.
  float numCollisions = 0.0;
  float totalCollisions = float(TOTAL_COLLISIONS);
  for ( int i = 0; i < TOTAL_COLLISIONS; i += 1 ) {
    float j = float(i) + 1.0;
    float x = hash(uTime + j);
    float y = hash(uTime + (j * totalCollisions));
    vec2 rndDir = (x * y == 0.0) ? vec2(0.0) : normalize(vec2(x, y));
    vec2 pos2d = rndDir * uLightSize;
    vec4 pos = vec4(pos2d, 0.0, 1.0) * M3d;
    numCollisions += wallCollision(Ray(a, normalizedDirection(a, vec3(pos.xyz / pos.w))));
  }
  return numCollisions / totalCollisions;

  #elif (ALG_TYPE == 2)

  /**
   * Slice the light sphere such that is creates a 2d circle orthogonal to the
   * line from the fragment to the center of the sphere.
   * If the light and fragment are at the same elevation, this would be a vertical circle.
   * Use this circle to generate test points.
   */
  // Use cross product to find the horizontal and vertical vectors.
  vec3 viewV = normalizedDirection(a, uLightPosition);
  vec3 hCross = normalize(vec3(-viewV.y, viewV.x, 0.0)); // Always align along horizontal plane.
  vec3 vCross = cross(viewV, hCross); // Tilt vertical plane to keep perpendicular with the view ray.

  // Add up the collisions along the horizontal axis of the light circle
  // e.g. 5 collisions.
  // • • • • •
  // 2 are at the edges.
  // 3 points, 25% step each time. If uLightSize = 50, nStep is (50 * 2) / (3 + 1) = 100 / 4 = 25
  float stepSize = (uLightSize * 2.0) / float(TOTAL_MID_COLLISIONS + 1);
  float hCollisions = 0.0;
  for ( int i = 0; i < TOTAL_MID_COLLISIONS; i += 1 ) {
    float s = (stepSize * float(i + 1)) - uLightSize;
    vec3 pt3d = uLightPosition + (hCross * s);
    hCollisions += wallCollision(Ray(a, normalizedDirection(a, pt3d)));
  }

  // Each edge counts as half.
  vec3 h0 = uLightPosition + (hCross * -uLightSize);
  vec3 h1 = uLightPosition + (hCross * uLightSize);
  hCollisions += (wallCollision(Ray(a, normalizedDirection(a, h0))) * 0.5);
  hCollisions += (wallCollision(Ray(a, normalizedDirection(a, h1))) * 0.5);

  // Add up the collisions along the vertical axis of the light circle
  float vCollisions = 0.0;
  for ( int i = 0; i < TOTAL_MID_COLLISIONS; i += 1 ) {
    float s = (stepSize * float(i + 1)) - uLightSize;
    vec3 pt3d = uLightPosition + (vCross * s);
    vCollisions += wallCollision(Ray(a, normalizedDirection(a, pt3d)));
  }

  // Each edge counts as half.
  vec3 v0 = uLightPosition + (vCross * -uLightSize);
  vec3 v1 = uLightPosition + (vCross * uLightSize);
  vCollisions += (wallCollision(Ray(a, normalizedDirection(a, v0))) * 0.5);
  vCollisions += (wallCollision(Ray(a, normalizedDirection(a, v1))) * 0.5);

  // Multiply the amount of horizontal shadow times the amount of vertical shadow.
  // return hCollisions / float(TOTAL_MID_COLLISIONS + 1);
  // return vCollisions / float(TOTAL_MID_COLLISIONS + 1);

  return (hCollisions / float(TOTAL_MID_COLLISIONS + 1))
       * (vCollisions / float(TOTAL_MID_COLLISIONS + 1));

  #endif
}


void main() {
  ${PENUMBRA_FRAGMENT_CALCULATIONS}
}