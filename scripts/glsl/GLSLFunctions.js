/* globals

*/
"use strict";

// GLSL functions

export let GLSLFunctions = {};
export let GLSLStructs = {};

/**
 * Utility to wrap a function definition in #ifndef.
 * @param {string} method
 * @returns {string}
 */
export const defineFunction = (method, lookup = method) =>
`#ifndef EV_${method.toUpperCase()}
#define EV_${method.toUpperCase()} true
${GLSLFunctions[lookup]}
#endif
`;

/**
 * Utility to wrap a strut definition in #ifndef.
 * @param {string} struct
 * @returns {string}
 */
export const defineStruct = struct =>
`#ifndef EV_${struct.toUpperCase()}
#define EV_${struct.toUpperCase()} true
${GLSLStructs[struct]}
#endif`;


// NOTE: Utility
GLSLFunctions.between =
// See https://stackoverflow.com/questions/52958171/glsl-optimization-check-if-variable-is-within-range
// step is (float, float) or (float, vec) or (vec, vec)
`
/**
 * Is x in the range of [a, b]?
 * @returns {0|1}
 */
float between(in float a, in float b, in float x) { return step(a, x) * step(x, b); }
vec2 between(in float a, in float b, in vec2 x) { return step(a, x) * step(x, vec2(b)); }
vec3 between(in float a, in float b, in vec3 x) { return step(a, x) * step(x, vec3(b)); }
`;

// NOTE: Matrix
GLSLFunctions.matrix =
`
// Translate a given x/y amount.
// [1, 0, x]
// [0, 1, y]
// [0, 0, 1]
mat3 MatrixTranslation(in float x, in float y) {
  mat3 tMat = mat3(1.0);
  tMat[2] = vec3(x, y, 1.0);
  return tMat;
}

// Scale using x/y value.
// [x, 0, 0]
// [0, y, 0]
// [0, 0, 1]
mat3 MatrixScale(in float x, in float y) {
  mat3 scaleMat = mat3(1.0);
  scaleMat[0][0] = x;
  scaleMat[1][1] = y;
  return scaleMat;
}

// Rotation around the z-axis.
// [c, -s, 0],
// [s, c, 0],
// [0, 0, 1]
mat3 MatrixRotationZ(in float angle) {
  float c = cos(angle);
  float s = sin(angle);
  mat3 rotMat = mat3(1.0);
  rotMat[0][0] = c;
  rotMat[1][1] = c;
  rotMat[1][0] = -s;
  rotMat[0][1] = s;
  return rotMat;
}

vec2 multiplyMatrixPoint(mat3 m, vec2 pt) {
  vec3 res = m * vec3(pt, 1.0);
  return vec2(res.xy / res.z);
}

mat3 toLocalRectangle(in vec2[4] rect) {
  // TL is 0, 0.
  // T --> B : y: 0 --> 1
  // L --> R : x: 0 --> 1
  vec2 bl = rect[0];
  vec2 br = rect[1];
  vec2 tr = rect[2];
  vec2 tl = rect[3];

  vec2 delta = tr - tl;
  float angle = atan(delta.y, delta.x);

  mat3 mTranslate = MatrixTranslation(-tl.x, -tl.y);
  mat3 mRotate = MatrixRotationZ(-angle);

  mat3 mShift = mRotate * mTranslate;
  vec2 trShifted = multiplyMatrixPoint(mShift, tr);
  vec2 blShifted = multiplyMatrixPoint(mShift, bl);

  mat3 mScale = MatrixScale(1.0 / trShifted.x, 1.0 / blShifted.y);
  return mScale * mShift;
}
`;


// NOTE: Random
// Pass a value and get a random normalized value between 0 and 1.
// https://github.com/patriciogonzalezvivo/lygia/blob/main/generative/random.glsl
GLSLFunctions.random =
`
#define RANDOM_SCALE vec4(443.897, 441.423, .0973, .1099)

float random(in float x) {
  x = fract(x * RANDOM_SCALE.x);
  x *= x + 33.33;
  x *= x + x;
  return fract(x);
}

vec2 random2(vec3 p3) {
  p3 = fract(p3 * RANDOM_SCALE.xyz);
  p3 += dot(p3, p3.yzx + 19.19);
  return fract((p3.xx + p3.yz) * p3.zy);
}

vec2 random2(vec2 p) { return random2(p.xyx); }
`;

// NOTE: Canvas elevation
GLSLFunctions.decodeElevationChannels =
`
/**
 * Return the normalized elevation value for a given color representation.
 * @param {vec4} pixel    Color representation of elevation value on canvas
 * @returns {float} The normalized elevation value, between 0 and 65,536.
 */
float decodeElevationChannels(in vec4 color) {
  color = color * 255.0;
  return (color.g * 256.0) + color.r;
}`;

GLSLFunctions.scaleNormalizedElevation =
`
/**
 * Return the scaled elevation value for a given normalized value.
 * @param {float} value   The normalized elevation between 0 and 65,536
 * @returns {float} Scaled elevation value based on scene settings, in grid units
 */
float scaleNormalizedElevation(in float value) {
  float elevationMin = uElevationRes.r;
  float elevationStep = uElevationRes.g;
  return elevationMin + (round(value * elevationStep * 10.0) * 0.1);
}`;

GLSLFunctions.gridUnitsToPixels =
`
/**
 * Convert grid to pixel units.
 * @param {float} value     Number, in grid units
 * @returns {float} The equivalent number in pixel units based on grid distance
 */
float gridUnitsToPixels(in float value) {
  float distancePixels = uElevationRes.a;
  return value * distancePixels;
}`;

GLSLFunctions.colorToElevationPixelUnits =
`
${defineFunction("decodeElevationChannels")}
${defineFunction("scaleNormalizedElevation")}
${defineFunction("gridUnitsToPixels")}

/**
 * Convert a color pixel to a scaled elevation value, in pixel units.
 */
float colorToElevationPixelUnits(in vec4 color) {
  float e = decodeElevationChannels(color);
  e = scaleNormalizedElevation(e);
  return gridUnitsToPixels(e);
}`;

// NOTE: Orientation
// Orientation just like foundry.utils.orient2dFast
GLSLFunctions.orient =
`
float orient(in vec2 a, in vec2 b, in vec2 c) {
  return (a.y - c.y) * (b.x - c.x) - (a.x - c.x) * (b.y - c.y);
}
`;

// NOTE: Barycentric
// Calculate barycentric position within a given triangle
GLSLFunctions.barycentric3d =
`
vec3 barycentric(in vec3 p, in vec3 a, in vec3 b, in vec3 c) {
  vec3 v0 = b - a; // Fixed for given triangle
  vec3 v1 = c - a; // Fixed for given triangle
  vec3 v2 = p - a;

  float d00 = dot(v0, v0); // Fixed for given triangle
  float d01 = dot(v0, v1); // Fixed for given triangle
  float d11 = dot(v1, v1); // Fixed for given triangle
  float d20 = dot(v2, v0);
  float d21 = dot(v2, v1);

  float denomInv = 1.0 / ((d00 * d11) - (d01 * d01)); // Fixed for given triangle
  float v = ((d11 * d20) - (d01 * d21)) * denomInv;
  float w = ((d00 * d21) - (d01 * d20)) * denomInv;
  float u = 1.0 - v - w;

  return vec3(u, v, w);
}
`;

GLSLFunctions.barycentric2d =
`
vec3 barycentric(in vec2 p, in vec2 a, in vec2 b, in vec2 c) {
  vec2 v0 = b - a;
  vec2 v1 = c - a;
  vec2 v2 = p - a;

  float d00 = dot(v0, v0); // Fixed for given triangle
  float d01 = dot(v0, v1); // Fixed for given triangle
  float d11 = dot(v1, v1); // Fixed for given triangle
  float d20 = dot(v2, v0);
  float d21 = dot(v2, v1);

  float denomInv = 1.0 / ((d00 * d11) - (d01 * d01)); // Fixed for given triangle
  float v = ((d11 * d20) - (d01 * d21)) * denomInv;
  float w = ((d00 * d21) - (d01 * d20)) * denomInv;
  float u = 1.0 - v - w;

  return vec3(u, v, w);
}
`;


// NOTE: Geometry lines
// Identify closest point on a 2d line to another point, just like foundry.utils.closestPointToSegment.
// Note: will fail if passed a 0-length ab segment.
GLSLFunctions.closest2dPointToLine =
`
vec2 closest2dPointToLine(in vec2 c, in vec2 a, in vec2 dir, out float u) {
  float denom = dot(dir, dir);
  if ( denom == 0.0 ) return a;

  vec2 deltaCA = c - a;
  u = dot(deltaCA, dir) / denom;
  return a + (u * dir);
}
`;

GLSLFunctions.closest2dPointToSegment =
`
${defineFunction("closest2dPointToLine")}

vec2 closest2dPointToSegment(in vec2 c, in vec2 a, in vec2 b) {
  float u;
  vec2 out = closest2dPointToLine(c, a, b - a, u);

  if ( u < 0.0 ) return a;
  if ( u > 1.0 ) return b;
  return out;
}
`;

GLSLFunctions.lineLineIntersection2dT =
`
bool lineLineIntersection2d(in vec2 a, in vec2 dirA, in vec2 b, in vec2 dirB, out float t) {
  float denom = (dirB.y * dirA.x) - (dirB.x * dirA.y);

  // If lines are parallel, no intersection.
  if ( abs(denom) < 0.0001 ) return false;

  vec2 diff = a - b;
  t = ((dirB.x * diff.y) - (dirB.y * diff.x)) / denom;
  return true;
}
`;

GLSLFunctions.lineLineIntersection2d =
`
${defineFunction("lineLineIntersection2dT")}

bool lineLineIntersection2d(in vec2 a, in vec2 dirA, in vec2 b, in vec2 dirB, out vec2 ix) {
  float t = 0.0;
  bool ixFound = lineLineIntersection2d(a, dirA, b, dirB, t);
  ix = a + (dirA * t);
  return ixFound;
}
`;

GLSLFunctions.cross2d =
`
/**
 * Cross x and y parameters in a vec2.
 * @param {vec2} a  First vector
 * @param {vec2} b  Second vector
 * @returns {float} The cross product
 */
float cross(in vec2 a, in vec2 b) { return (a.x * b.y) - (a.y * b.x); }
`;

// NOTE: Ray struct
GLSLStructs.Ray =
`
/**
 * Ray defined by a point and a direction from that point.
 */
struct Ray {
  vec3 origin;
  vec3 direction;
};`;

GLSLFunctions.rayFromPoints =
`
${defineStruct("Ray")}

/**
 * Construct a ray from two points: origin and towards point.
 */
Ray rayFromPoints(in vec3 origin, in vec3 towardsPoint) {
  return Ray(origin, towardsPoint - origin);
}`;

GLSLFunctions.normalizeRay =
`
${defineStruct("Ray")}

/**
 * Normalize the ray direction.
 */
Ray normalizeRay(in Ray r) {
  return Ray(r.origin, normalize(r.direction));
}`;

// NOTE: Plane struct
GLSLStructs.Plane =
`
/**
 * Plane defined by a point on the plane and its normal.
 * This is the same, structurally, as a Ray, but included here for clarity.
 * Normal must be normalized.
 */
struct Plane  {
  vec3 point;
  vec3 normal;
};`;

// NOTE: Quad struct
GLSLStructs.Quad =
`
/**
 * Quad is defined by 4 corner points.
 /*
 * 0--b--3
 * |\
 * a c
 * |  \
 * 1    2
 */
struct Quad {
  vec3 v0;
  vec3 v1;
  vec3 v2;
  vec3 v3;
};`;

GLSLFunctions.quadFromPlane =
`
${defineStruct("Plane")}
${defineStruct("Quad")}

/**
 * Convert a Quad to a Plane by calculating the normal for the surface.
 */
Plane planeFromQuad(in Quad quad) {
  vec3 planePoint = v0;
  vec3 diff01 = v1 - v0;
  vec3 diff02 = v2 - v0;
  vec3 planeNormal = cross(diff01, diff02);
  return Plane(planePoint, normalize(planeNormal));
}`;

// NOTE: Plane/Quad intersections
GLSLFunctions.intersectRayPlane =
`
${defineStruct("Ray")}
${defineStruct("Plane")}

bool intersectRayPlane(in Ray r, in Plane P, out vec3 ix) {
  float denom = dot(P.normal, r.direction);

  // Check if line is parallel to the plane; no intersection
  if (abs(denom) < 0.0001) return false;

  float t = dot(P.normal, P.point - r.origin) / denom;
  ix = r.origin + r.direction * t;
  return true;
}`;

GLSLFunctions.intersectRayQuad =
`
${defineFunction("intersectRayPlane")}
${defineFunction("quadFromPlane")}

/**
 * Intersect a ray with a quad, storing the intersection in the ix out variable if found.
 * @param {Ray}   r      Ray to test. Must have normalized r.direction.
 * @param {Quad}  quad   Quad to test.
 * @param {vec3}  ix     Point variable in which to store the intersection if found.
 * @returns {bool} True if an intersection was found
 */
bool intersectRayQuad(in Ray r, in Quad quad, out vec3 ix) {
  Plane P = planeFromQuad()
  if ( !intersectRayPlane(r, P, ix) ) return false;

  // Check if the intersection point is within the bounds of the quad.
  vec3 quadMin = min(quad.v0, min(quad.v1, min(quad.v2, quad.v3)));
  vec3 quadMax = max(quad.v0, max(quad.v1, max(quad.v2, quad.v3)));
  return all(greaterThan(ix, quadMin)) && all(lessThan(ix, quadMax));
}`;

GLSLFunctions.quadIntersectBary =
`
${defineStruct("Ray")}
${defineStruct("Quad")}
${defineFunction("cross", "cross2d")}

/**
 * Quad intersect
 * https://www.shadertoy.com/view/XtlBDs
 * @param {vec3} ro   Ray origin
 * @param {vec3} rd   Ray direction (Need not be normalized)
 * @param {vec3} v0   Corner #0
 * @param {vec3} v1   Corner #1
 * @param {vec3} v2   Corner #2
 * @param {vec3} v3   Corner #3
 * 0--b--3
 * |\
 * a c
 * |  \
 * 1    2
 * @returns {vec3} Returns barycentric coords or vec3(-1.0) if no intersection.
 */
const int lut[4] = int[](1, 2, 0, 1);

bool baryIntersectRayQuad(in Ray r, in Quad quad, out vec3 ix) {
  // TODO: Use existing functions to intersect the plane.
  // Let's make v0 the origin.
  vec3 a = quad.v1 - quad.v0;
  vec3 b = quad.v3 - quad.v0;
  vec3 c = quad.v2 - quad.v0;
  vec3 p = r.origin - quad.v0;

  // Intersect plane.
  vec3 nor = cross(a, b);
  float t = -dot(p, nor) / dot(r.direction, nor);
  if ( t < 0.0 ) return false; // Parallel to plane

  // Intersection point.
  vec3 pos = p + (t * r.direction);

  // See here: https://www.shadertoy.com/view/lsBSDm.

  // Select projection plane.
  vec3 mor = abs(nor);
  int id = (mor.x > mor.y && mor.x > mor.z ) ? 0 : (mor.y > mor.z) ? 1 : 2;
  int idu = lut[id];
  int idv = lut[id + 1];

  // Project to 2D
  vec2 kp = vec2(pos[idu], pos[idv]);
  vec2 ka = vec2(a[idu], a[idv]);
  vec2 kb = vec2(b[idu], b[idv]);
  vec2 kc = vec2(c[idu], c[idv]);

  // Find barycentric coords of the quad.
  vec2 kg = kc - kb - ka;
  float k0 = cross(kp, kb);
  float k2 = cross(kc - kb, ka);  // Alt: float k2 = cross(kg, ka);
  float k1 = cross(kp, kg) - nor[id]; // Alt: float k1 = cross(kb, ka) + cross(kp, kg);

  float u;
  float v;
  if ( abs(k2) < 0.00001 ) { // TODO: use EPSILON?
    // Edges are parallel; this is a linear equation.
    v = -k0 / k1;
    u = cross(kp, ka) / k1;
  } else {
    // Otherwise, it's a quadratic.
    float w = (k1 * k1) - (4.0 * k0 * k2);
    if ( w < 0.0 ) return false;
    w = sqrt(w);
    float ik2 = 1.0 / (2.0 * k2);
    v = (-k1 - w) * ik2;
    if ( v < 0.0 || v > 1.0 ) v = (-k1 + w) * ik2;
    u = (kp.x - (ka.x * v)) / (kb.x + (kg.x * v));
  }

  ix = vec3(t, u, v);
  // if ( u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0 ) return vec3(-1.0);
  return true;
}
`;

// NOTE: Colors
GLSLFunctions.hsb2rgb =
`
/**
 * Convert a Hue-Saturation-Brightness color to RGB - useful to convert polar coordinates to RGB
 * See BaseShaderMixin.HSB2RGB
 * @type {string}
 */
vec3 hsb2rgb(in vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0), 6.0)-3.0)-1.0, 0.0, 1.0 );
  rgb = rgb*rgb*(3.0-2.0*rgb);
  return c.z * mix(vec3(1.0), rgb, c.y);
}`;

GLSLFunctions.rgb2hsv =
`
/**
 * From https://stackoverflow.com/questions/15095909/from-rgb-to-hsv-in-opengl-glsl
 * @param {vec3} c    RGB color representation (0–1)
 * @returns {vec3} HSV color representation (0–1)
 */
// All components are in the range [0…1], including hue.
vec3 rgb2hsv(in vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}`;

GLSLFunctions.hsv2rgb =
`
/**
 * From https://www.shadertoy.com/view/XljGzV.
 * @param {vec3} c    HSV color representation (0–1)
 * @returns {vec3} RGB color representation (0–1)
 */
// All components are in the range [0…1], including hue.
vec3 hsv2rgb(in vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}`;

// NOTE: Debugging
// For debugging.
GLSLFunctions.stepColor =
`
// 0: Black
// Red is near 0; blue is near 1.
// 0.5: purple
vec3 stepColor(in float ratio) {
  if ( ratio < 0.2 ) return vec3(smoothstep(0.0, 0.2, ratio), 0.0, 0.0);
  if ( ratio < 0.4 ) return vec3(smoothstep(0.2, 0.4, ratio), smoothstep(0.2, 0.4, ratio), 0.0);
  if ( ratio == 0.5 ) return vec3(0.5, 0.0, 0.5);
  if ( ratio < 0.6 ) return vec3(0.0, smoothstep(0.4, 0.6, ratio), 0.0);
  if ( ratio < 0.8 ) return vec3(0.0, smoothstep(0.6, 0.8, ratio), smoothstep(0.6, 0.8, ratio));
  return vec3(0.0, 0.0, smoothstep(0.8, 1.0, ratio));
}`;

