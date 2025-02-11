#version 300 es
precision ${PRECISION_VERTEX} float;

/* ----- NOTE: Unsized Fragment ----- */

#define TOTAL_COLLISIONS        50
#define TOTAL_COLLISIONS_INV    1.0 / float(TOTAL_COLLISIONS)

#define MAX_STACK_SIZE      100 // Need to set this somehow? Could use a defineConstant function
#define OFFSET_LIGHT        9
#define OFFSET_SIGHT        6
#define OFFSET_SOUND        3
#define OFFSET_MOVE         0

#define MASK_LIGHT          7 << OFFSET_LIGHT
#define MASK_SIGHT          7 << OFFSET_SIGHT
#define MASK_SOUND          7 << OFFSET_SOUND
#define MASK_MOVE           7 << OFFSET_MOVE

#define SOURCE_LIGHT        0
#define SOURCE_SIGHT        1
#define SOURCE_SOUND        2
#define SOURCE_MOVE         3

#define WALL_NONE           0
#define WALL_LIMITED        1
#define WALL_NORMAL         2
#define WALL_PROXIMITY      3
#define WALL_DISTANCE       4

#define EDGE_ELEVATION_MAX    65535
#define EDGE_ELEVATION_MIN    0
#define EDGE_ELEVATION_SPLIT  32768

/* ----- NOTE: In Variables ----- */
in vec2 vVertexPosition;
in vec2 vTerrainTexCoord;

/* ----- NOTE: Uniform Variables ----- */
uniform sampler2D uTerrainSampler;
uniform highp sampler2D uBVHSampler;
uniform highp sampler2D uEdgeSampler;

uniform vec4 uElevationRes; // min, step, maxpixel, multiplier
uniform vec3 uLightPosition;
uniform float uLightSize;
uniform int uSourceType;
uniform float uTime;


/* ----- NOTE: Out Variable ----- */
out vec4 lightPercentage;

/* ----- NOTE: Common structs ----- */
${defineStruct("Ray")}
${defineStruct("Plane")}

/* ------ NOTE: Common functions ----- */
${defineFunction("distanceSquared")}
${defineFunction("isEven")}
${defineFunction("projectRay")}
${defineFunction("terrainElevation")}
${defineFunction("hash")}
${defineFunction("almostEqual")}
${defineFunction("linearConversion")}
${defineFunction("rayFromPoints")}
${defineFunction("distanceToLine")}

/** Represent node data in the BVH */
struct BVHNode {
  vec2 aabbMin;
  vec2 aabbMax;
  uint leftFirst;
  bool isLeaf;
};

struct Edge {
  vec3 a;
  vec3 b;
  int type;
};

/**
 * Decode the edge types.
 * @param {int} n         The value provided by encodeEdgeTypes
 * @returns {object}
 *   - @prop {CONST.WALL_SENSE_TYPES} light
 *   - @prop {CONST.WALL_SENSE_TYPES} sight
 *   - @prop {CONST.WALL_SENSE_TYPES} sound
 *   - @prop {CONST.WALL_SENSE_TYPES} move
 */
int decodeEdgeTypes(in int n) {
  switch ( uSourceType ) {
    case SOURCE_LIGHT: return (n & MASK_LIGHT) >> OFFSET_LIGHT;
    case SOURCE_SIGHT: return (n & MASK_SIGHT) >> OFFSET_SIGHT;
    case SOURCE_SOUND: return (n & MASK_SOUND) >> OFFSET_SOUND;
    case SOURCE_MOVE:  return (n & MASK_MOVE)  >> OFFSET_MOVE;
  }
  return 0;
}

/**
 * Decode the edge top and bottom.
 * Currently, evenly split among the 65,536 values.
 * 0 is negative infinity; 65535 is positive infinity, 65534 / 2 is the ± split.
 */
float decodeEdgeElevation(in int n) {
  if ( n == EDGE_ELEVATION_MAX ) return 1.0e06;
  if ( n == EDGE_ELEVATION_MIN ) return -1.0e06;
  return float(n - EDGE_ELEVATION_SPLIT);
}

/**
 * Pull node data from the texture.
 * @param {uint} idx
 * @returns {BVHNode}
 */
BVHNode getNode(in int idx) {
  // TODO: is this row, column or column, row?
  vec4 dat = texelFetch(uBVHSampler, ivec2(0, idx), 0);
  vec4 bounds = texelFetch(uBVHSampler, ivec2(1, idx), 0);
  return BVHNode(
    vec2(bounds.xy),  // Min
    vec2(bounds.zw),  // Max
    uint(dat[0]),      // leftFirst
    int(dat[1]) == 1  // isLeaf
  );
}

Edge getEdge(in int idx) {
  vec4 dat0 = texelFetch(uEdgeSampler, ivec2(0, idx), 0);
  vec4 dat1 = texelFetch(uEdgeSampler, ivec2(1, idx), 0);
  return Edge(
    vec3(dat0.xy, decodeEdgeElevation(int(dat1[1]))),
    vec3(dat0.zw, decodeEdgeElevation(int(dat1[2]))),
    decodeEdgeTypes(int(dat1[0]))
  );
}

void drawEdge(in Edge edge) {
  if ( distanceSquaredToSegment(vVertexPosition, edge.a.xy, edge.b.xy) < 2.0 ) lightPercentage = vec4(1.0);
}

void drawNodeBounds(in BVHNode node) {
  // if ( node.aabbMin.x == 2450.0 ) lightPercentage = vec4(1.0);
  // if ( node.aabbMin.x > -1.0 && node.aabbMin.x < 1.0 ) lightPercentage = vec4(1.0);
  // if ( vVertexPosition.x > node.aabbMin.x ) lightPercentage = vec4(1.0);
  if ( all(greaterThanEqual(vVertexPosition, node.aabbMin)) && all(lessThan(vVertexPosition, node.aabbMax)) ) lightPercentage = vec4(0.5, 1.0, 1.0, 1.0);
}


/**
 * Test a node's min/max bounds for a ray intersection.
 * 2d intersection.
 * @param {Ray} ray
 * @param {BVHNode} node
 * @returns {bool}
 */
bool nodeHasBoundsIntersection(in Ray ray, in BVHNode node) {
  vec2 minXY = (node.aabbMin - ray.origin.xy) * ray.invDirection.xy;
  vec2 maxXY = (node.aabbMax - ray.origin.xy) * ray.invDirection.xy;
  vec2 minVals = min(minXY, maxXY);
  vec2 maxVals = max(minXY, maxXY);
  float tmax = min(maxVals.x, maxVals.y);
  float tmin = max(minVals.x, minVals.y);
  return tmax > 0.0 && tmax >= tmin && ray.t2 > (tmin * tmin);
}

/**
 * Intersect ray with plane
 * https://www.scratchapixel.com/lessons/3d-basic-rendering/minimal-ray-tracer-rendering-simple-shapes/ray-plane-and-ray-disk-intersection.html
 * https://tavianator.com/2011/ray_box.html
 * @param {Plane} plane
 * @param {Ray} ray
 * @returns {float|null} T-value or null if no intersection.
 * In GLSL, t is an out variable.
 */
bool planeRayIntersection(in Plane plane, in Ray ray, out float t) {
  float denom = dot(plane.normal, ray.direction);
  if ( almostEqual(denom, 0.0, 1.0e-08) ) return false;
  vec3 delta = plane.point - ray.origin;
  t = dot(delta, plane.normal) / denom;
  return true;
}

float nodeHasObjectIntersection(in Ray ray, in BVHNode node) {
  // TODO: Can this be done with less texel fetches? Maybe fetch one to test horizontal first?
  vec4 dat1 = texelFetch(uEdgeSampler, ivec2(1, node.leftFirst), 0);
  int wallSenseType = decodeEdgeTypes(int(dat1[0]));
  if ( wallSenseType == WALL_NONE ) return 0.0;

  vec4 dat0 = texelFetch(uEdgeSampler, ivec2(0, node.leftFirst), 0);

  vec2 a = vec2(dat0.xy);
  vec2 b = vec2(dat0.zw);
  float top = decodeEdgeElevation(int(dat1[1]));
  float bottom = decodeEdgeElevation(int(dat1[2]));
  vec3 a3d = vec3(a, top);
  vec3 edgeNormal = cross(vec3(b, top) - a3d, vec3(a, bottom) - a3d);

  Plane edgePlane = Plane(a3d, edgeNormal);
  float t;
  if ( !planeRayIntersection(edgePlane, ray, t) ) return 0.0;
  if ( t < 0.0 || (t * t) > ray.t2 ) return 0.0;
  vec3 ix = projectRay(ray, t);

  // Within vertical extent.
  if ( ix.z > top || ix.z < bottom ) return 0.0;

  // return 1.0; // Debugging.

  // Within the 2d endpoints.
  float dist2Endpoints = distanceSquared(a.xy, b.xy);
  float dist2A = distanceSquared(a.xy, ix.xy);
  if ( dist2A > dist2Endpoints ) return 0.0;
  float dist2B = distanceSquared(b.xy, ix.xy);
  if ( dist2B > dist2Endpoints ) return 0.0;

  // TODO: Handle proximate wall types. https://foundryvtt.com/article/walls/
  // - Get distance from intersection to the end of the ray (the source).
  // - Return collision or not based on the threshold calculation.
  return wallSenseType == WALL_LIMITED ? 0.5 : 1.0;
}

/**
 * Test for an intersection with a wall.
 * TODO: Add ability to require a second intersection for terrain walls.
 * @param {Ray} ray
 * @return {float} 1.0 if intersection; 0.0 if not.
 */
float hasIntersection(in Ray ray) {
  // Handle the root node and return if no collision or there is only 1 edge.
  float collision = 0.0; // For terrain walls, which return 0.5 for each collision.
  int currLevel = 0;
  BVHNode currNode = getNode(0);
  if ( nodeHasBoundsIntersection(ray, currNode) ) return 1.0;
  if ( currNode.isLeaf ) {
    collision += nodeHasObjectIntersection(ray, currNode);
    if ( collision >= 1.0 ) return 1.0;
  };

  // Track the next node for each level of the tree.
  int[MAX_STACK_SIZE] stack;
  stack[0] = 1; // Root left child is 1; root right child is 2.
  while ( currLevel >= 0 ) {
    // Pull the current node.
    currNode = getNode(stack[currLevel]);

    // Set the left side for this node.
    stack[currLevel + 1] = int(currNode.leftFirst);

    // May have the right node remaining. Right is always 1 more than left.
    // Note: left is odd, right is even.
    stack[currLevel] = isEven(stack[currLevel]) ? 0 : stack[currLevel] + 1;

    // Test bounds for this node; if hit, investigate further.
    // If node is leaf, also test object intersection and possibly end early.
    bool goDown = nodeHasBoundsIntersection(ray, currNode);
    if ( goDown && currNode.isLeaf ) {
      collision += nodeHasObjectIntersection(ray, currNode);
      if ( collision >= 1.0 ) return 1.0;
      goDown = false;
    }

    // In next loop, either:
    // 1. Move down to next level.
    // 2. Test the right node.
    // 3. Move up to prior level(s).
    if ( goDown ) currLevel += 1;
    else while ( currLevel >= 0 && stack[currLevel] == 0 ) currLevel -= 1;
  }
  return 0.0;
}

/**
 * Select a position on the sphere given vec3 between -1 and 1.
 * 0 would be dead center.
 * @param {vec3} dir
 * @returns {vec3}
 */
vec3 spherePosition(in vec3 dir) { return uLightPosition + (dir * uLightSize); }

/**
 * Generate a sample ray from fragment to light.
 * Sample the 3d light sphere directly.
 * @param {vec3} fragmentPosition
 * @returns {vec3} Sample position on the light sphere
 */
vec3 samplePositionLightSphere(in vec3 fragmentPosition, in float seed) {
  float totalCollisions = float(TOTAL_COLLISIONS);
  float j = seed + 1.0; // Avoid zeroes.
  float x = hash(uTime + j);
  float y = hash(uTime + (j * totalCollisions));
  float z = hash(uTime + (j * totalCollisions * totalCollisions));

  // Pseudo-Gaussian 3d distribution.
  vec3 rndDir = (x * y * z == 0.0) ? vec3(0.0) : normalize(vec3(x, y, z));
  return spherePosition(linearConversion(rndDir, 0.0, 1.0, -1.0, 1.0));
}

/* ------ NOTE: Fragment Main ----- */
void main() {
  // Debug.
  lightPercentage = vec4(0.0, 1.0, 1.0, 1.0);


  // BVHNode node = getNode(1);
  // drawNodeBounds(node);
  // return;

  /*
  int bvhSize = textureSize(uBVHSampler, 0).y;
  for ( int i = 0; i < MAX_STACK_SIZE; i += 1 ) {
    if ( i >= bvhSize ) break;
    BVHNode node = getNode(i);
    drawNodeBounds(node);
  }

  int nEdges = textureSize(uEdgeSampler, 0).y;
  for ( int i = 0; i < MAX_STACK_SIZE; i += 1 ) {
    if ( i >= nEdges ) break;
    Edge edge = getEdge(i);
    drawEdge(edge);
  }
  return;
  */

  lightPercentage = vec4(1.0); // Fully lit.
  // return;

  // If the terrain is above the light, the terrain is not lit.
  float elevation = terrainElevation(uTerrainSampler, vTerrainTexCoord, uElevationRes);
  if ( elevation >= uLightPosition.z ) {
    lightPercentage.x = 0.0;
    return;
  }
  // return;

  // Test for intersections along the ray for a sample of light positions.
  // (See WallShader_Sized_Fragment2.glsl for different sampling options.)
  float collisions = 0.0;
  vec3 fragmentPosition = vec3(vVertexPosition, elevation);
  for ( int i = 0; i < TOTAL_COLLISIONS; i += 1 ) {
    vec3 pos = samplePositionLightSphere(fragmentPosition, float(i));
    Ray lightRay = rayFromPoints(fragmentPosition, pos);
    collisions += hasIntersection(lightRay);
  }
  lightPercentage.x = 1.0 - (collisions * TOTAL_COLLISIONS_INV);

  // if ( collisions > 0.0 ) lightPercentage.x = 0.0;
  // else lightPercentage.x = 1.0;
}

