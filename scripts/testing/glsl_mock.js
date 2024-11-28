/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
"use strict";

// Replicate the wall shader to extent possible.
// Can draw shadows, math results, and test simple layouts.
// Replicates many GLSL functions

const ARRAY_CLASS = {
  highp: { int: Int32Array, float: Float32Array },
  mediump: { int: Int16Array, float: Float32Array },
  lowp: { int: Int8Array, float: Float32Array } // No Float 8 or Float 16 available (Float16 only in Firefox)
};

const SWIZZLE = {
  x: 0, r: 0, s: 0,
  y: 1, g: 1, t: 1,
  z: 2, b: 2, p: 2,
  w: 3, a: 3, q: 3
};


/**
 * A factor function that adds swizzle getters and basic math to a set of fake glsl vector classes.
 * @param {object} opts
 * @param {"highp"|"mediump"|"lowp"} precision    Type of array to use: 32, 16, 8, respectively
 * @param {"int"|"float"} type                    Type of array to use
 */
export function glslVectors({ precision = "highp", type = "float" } = {}) {
  const arrCl = ARRAY_CLASS[precision][type];
  const isArr = function(obj) { return ArrayBuffer.isView(obj) || Array.isArray(obj); };

  class vec2Base extends arrCl {
    constructor(...args) {
      super(2);

      if ( args.length === 1 && !isArr(args[0]) ) {
        this.fill(args[0]);
        return;
      }

      // Handle passing things like new vec(oldvec.xy, oldvec.x).
      const values = [];
      for ( let i = 0; i < args.length; i += 1 ) {
        const a = args[i];
        if ( isArr(a) ) values.push(...a);
        else values.push(a);
      }
      this.set(values.slice(0, 2), 0);
    }
  }

  class vec3Base extends arrCl {
    constructor(...args) {
      super(3);

      if ( args.length === 1 && !isArr(args[0]) ) {
        this.fill(args[0]);
        return;
      }

      // Handle passing things like new vec(oldvec.xy, oldvec.x).
      const values = [];
      for ( let i = 0; i < args.length; i += 1 ) {
        const a = args[i];
        if ( isArr(a) ) values.push(...a);
        else values.push(a);
      }
      this.set(values.slice(0, 3), 0);
    }
  }

  class vec4Base extends arrCl {
    constructor(...args) {
      super(4);

      if ( args.length === 1 && !isArr(args[0]) ) {
        this.fill(args[0]);
        return;
      }

      // Handle passing things like new vec(oldvec.xy, oldvec.x).
      const values = [];
      for ( let i = 0; i < args.length; i += 1 ) {
        const a = args[i];
        if ( isArr(a) ) values.push(...a);
        else values.push(a);
      }
      this.set(values.slice(0, 4), 0);
    }
  }

  const vectorMixin = function(Base) {
    return class GLSLVector extends Base {
      static SWIZZLE = SWIZZLE;

      get x() { return this[SWIZZLE.x]; }

      get y() { return this[SWIZZLE.y]; }

      get z() { return this[SWIZZLE.z]; }

      get w() { return this[SWIZZLE.q]; }

      get r() { return this[SWIZZLE.r]; }

      get b() { return this[SWIZZLE.b]; }

      get g() { return this[SWIZZLE.g]; }

      get a() { return this[SWIZZLE.a]; }

      get s() { return this[SWIZZLE.s]; }

      get t() { return this[SWIZZLE.t]; }

      get p() { return this[SWIZZLE.p]; }

      get q() { return this[SWIZZLE.q]; }

      get xy() { return new vec2(this.x, this.y); }

      get xyz() { return new vec3(this.x, this.y, this.z); }

      get zw() { return new vec2(this.z, this.w); }

      set x(value) { this[SWIZZLE.x] = value; }

      set y(value) { this[SWIZZLE.y] = value; }

      set z(value) { this[SWIZZLE.z] = value; }

      set w(value) { this[SWIZZLE.q] = value; }

      set r(value) { this[SWIZZLE.r] = value; }

      set b(value) { this[SWIZZLE.b] = value; }

      set g(value) { this[SWIZZLE.g] = value; }

      set a(value) { this[SWIZZLE.a] = value; }

      set s(value) { this[SWIZZLE.s] = value; }

      set t(value) { this[SWIZZLE.t] = value; }

      set p(value) { this[SWIZZLE.p] = value; }

      set q(value) { this[SWIZZLE.q] = value; }

      add(other) {
        const out = new this.constructor();
        for ( let i = 0; i < this.length; i += 1 ) out[i] = this[i] + other[i];
        return out;
      }

      subtract(other) {
        const out = new this.constructor();
        for ( let i = 0; i < this.length; i += 1 ) out[i] = this[i] - other[i];
        return out;
      }

      multiply(other) {
        const out = new this.constructor();
        for ( let i = 0; i < this.length; i += 1 ) out[i] = this[i] * other[i];
        return out;
      }

      multiplyScalar(scalar) {
        const out = new this.constructor();
        for ( let i = 0; i < this.length; i += 1 ) out[i] = this[i] * scalar;
        return out;
      }

      divide(other) {
        const out = new this.constructor();
        for ( let i = 0; i < this.length; i += 1 ) out[i] = this[i] / other[i];
        return out;
      }

      magnitude() { return Math.hypot(...this); }

      normalize() { return this.multiplyScalar(1 / this.magnitude()); }

      dot(other) {
        let sum = 0;
        for ( let i = 0; i < this.length; i += 1 ) sum += (this[i] * other[i]);
        return sum;
      }

      distance(other) {
        const delta = other.subtract(this);
        return Math.hypot(...delta);
      }

      distanceSquared(other) {
        const delta = other.subtract(this);
        return delta.dot(delta);
      }
    };
  };

  class vec2 extends vectorMixin(vec2Base) {}

  class vec3 extends vectorMixin(vec3Base) {}

  class vec4 extends vectorMixin(vec4Base) {}

  return { vec2, vec3, vec4 };
}

const res = glslVectors({ precision: "highp", type: "float" });
export const vec2 = (...args) => new res.vec2(...args);
export const vec3 = (...args) => new res.vec3(...args);
export const vec4 = (...args) => new res.vec4(...args);

/* Testing
a = new vec2(1, 2);
b = new vec2(3, 4);
a.add(b)
*/

export function almostEqual(a, b, epsilon) {
  return Math.abs(a - b) < epsilon;
}


/**
 * Calculate barycentric position within a given triangle
 * For point p and triangle abc, return the barycentric uvw as a vec3 or vec2.
 * See https://ceng2.ktu.edu.tr/~cakir/files/grafikler/Texture_Mapping.pdf
 * @param {vec3|vec3} p
 * @param {vec3|vec2} a
 * @param {vec3|vec2} b
 * @param {vec3|vec2} c
 * @returns {vec3}
 */
export function barycentric(p, a, b, c) {
  const v0 = b.subtract(a); // Fixed for given triangle
  const v1 = c.subtract(a); // Fixed for given triangle
  const v2 = p.subtract(a);

  const d00 = v0.dot(v0); // Fixed for given triangle
  const d01 = v0.dot(v1); // Fixed for given triangle
  const d11 = v1.dot(v1); // Fixed for given triangle
  const d20 = v2.dot(v0);
  const d21 = v2.dot(v1);

  const denom = ((d00 * d11) - (d01 * d01));
  // TODO: Is this test needed? if ( denom == 0.0 ) return new vec3(-1.0, -1.0, -1.0);

  const denomInv = 1.0 / denom; // Fixed for given triangle
  const v = ((d11 * d20) - (d01 * d21)) * denomInv;
  const w = ((d00 * d21) - (d01 * d20)) * denomInv;
  const u = 1.0 - v - w;

  return vec3(u, v, w);
}

export function invertBarycentric(tri, bary) {
  const [A, B, C] = tri;
  const a = A.multiplyScalar(bary.x);
  const b = B.multiplyScalar(bary.y);
  const c = C.multiplyScalar(bary.z);
  return a.add(b).add(c);
}

/**
 * Test if a barycentric coordinate is within its defined triangle.
 * @param {vec3} bary     Barycentric coordinate; x,y,z => u,v,w
 * @returns {bool} True if inside
 */
export function barycentricPointInsideTriangle(bary) {
  return bary.y >= 0.0 && bary.z >= 0.0 && (bary.y + bary.z) <= 1.0;
}

class BaryTriangleData2dGLSLStruct {

  /** @type {vec2} */
  v0 = vec2();

  /** @type {vec2} */
  v1 = vec2();

  /** @type {float} */
  d00 = 0.0;

  /** @type {float} */
  d01 = 0.0;

  /** @type {float} */
  d11 = 0.0;

  /** @type {float} */
  denomInv = 0.0;

  constructor({ v0, v1, d00, d01, d11, denomInv } = {}) {
    this.v0.set(v0, 0);
    this.v1.set(v1, 0);
    this.d00 = d00;
    this.d01 = d01;
    this.d11 = d11;
    this.denomInv = 1 / ((d00 * d11) - (d01 * d01));
  }
}

/**
 * Calculate fixed barycentric data for a given triangle.
 * @param {vec2} a
 * @param {vec2} b
 * @param {vec2} c
 * @returns {BaryTriangleData2dGLSLStruct}
 */
export function baryTriangleData(a, b, c, v0, v1, d) {
  return new BaryTriangleData2dGLSLStruct({
    v0: b.subtract(a),
    v1: c.subtract(a),
    d00: v0.dot(v0),
    d01: v0.dot(v1),
    d11: v1.dot(v1)
  });
}

/**
 * Calculate barycentric position using fixed triangle data
 * @param {vec3|vec3} p
 * @param {vec3|vec2} a
 * @param {BaryTriangleGLSLStruct} triData
 * @returns {vec3}
 */
export function baryFromTriangleData(p, a, triData) {
  const { v0, v1, d00, d01, d11, denomInv } = triData;
  const v2 = p.subtract(a);
  const d20 = v2.dot(v0);
  const d21 = v2.dot(v1);

  const v = ((d11 * d20) - (d01 * d21)) * denomInv;
  const w = ((d00 * d21) - (d01 * d20)) * denomInv;
  const u = 1.0 - v - w;

  return vec3(u, v, w);
}

/**
 * Interpolate from values at the triangle vertices using a barycentric point.
 * @param {vec3} bary
 * @param {float|vec2|vec3} a
 * @param {float|vec2|vec3} b
 * @param {float|vec2|vec3} c
 * @returns {float|vec2|vec3}
 */
export function interpolateBarycentric(bary, a, b, c) {
  if ( Number.isNumeric(a) ) return bary.dot(vec3(a, b, c));
  a = a.multiplyScalar(bary.x);
  b = b.multiplyScalar(bary.y);
  c = c.multiplyScalar(bary.z);
  return a.add(b).add(c);
}

/**
 * Normalize a barycentric area coordinate.
 * @param {vec3} baryArea
 * @returns {vec3}
 */
export function normalizeBarycentricArea(baryArea) {
  return baryArea.multiplyScalar(1 / (baryArea.x + baryArea.y + baryArea.z));
}

/**
 * Convert a barycentric area to barycentric coordinates of a similar triangle, based on ratio.
 * @param {vec3} baryArea
 * @param {float} ratio      The desired side length as a percentage of the original side length
 *   So if original is 3 and intended is 1, ratio = 1/3
 * @returns {vec3} The barycentric (normalized) values.
 */
export function convertBarycentericAreaSimilarTriangle(baryArea, ratio) {
  if ( ratio === 0.0 || ratio === 1.0 ) return normalizeBarycentricArea(baryArea);

  const total = baryArea.x + baryArea.y + baryArea.z;
  const total2 = total * ratio * ratio;
  const saV2 = baryArea.y * ratio;
  const saW2 = baryArea.z * ratio;
  const v2 = saV2 / total2;
  const w2 = saW2 / total2;
  const u2 = 1 - v2 - w2;
  return vec3(u2, v2, w2);
}

/**
 * Linear conversion from one range to another.
 * @param {float} x
 * @param {float} oldMin
 * @param {float} oldMax
 * @param {float} newMin
 * @param {float} newMax
 * @returns {float}
 */
export function linearConversion(x, oldMin, oldMax, newMin, newMax) {
  return (((x - oldMin) * (newMax - newMin)) / (oldMax - oldMin)) + newMin;
}

/**
 * @param {vec2} origin     Starting point
 * @param {float} radians   Angle to move from the starting point
 * @param {float} distance  Distance to travel from the starting point
 * @returns {vec2}  Coordinates of a point that lies distance away from origin along angle.
 */
export function fromAngle(origin, radians, distance) {
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  return origin.add(vec2(dx, dy).multiplyScalar(distance));
}

/**
 * GLSL normalize function
 * @param {vec2|vec3} v
 * @returns {vec2|vec3}
 */
export function normalize(v) { return v.normalize(); }

/**
 * GLSL distance function
 * @param {vec2|vec3} a
 * @param {vec2|vec3} b
 * @returns {float}
 */
export function distance(a, b) { return a.distance(b); }

export function distanceSquared(a, b) { return a.distanceSquared(b); }

/**
 * Ray defined by a point and a direction from that point.
 */
export class Ray2dGLSLStruct {
  origin = vec2();

  direction = vec2();

  constructor(origin, direction) {
    this.origin.set(origin, 0);
    this.direction.set(direction, 0);
  }

  /**
   * @param {vec3} origin
   * @param {vec3} towardsPoint
   */
  static fromPoints(origin, towardsPoint) {
    return new this(origin, towardsPoint.subtract(origin));
  }

  /**
   * Normalize the ray direction.
   * @returns {RayGLSLStruct} A newly constructed ray.
   */
  normalize() {
    return new this.constructor(this.origin, this.direction.normalize());
  }

  /**
   * Project the ray a given distance multiplier of the ray length.
   * If ray is normalized, this will project the ray the given distance.
   * @param {float} distanceMultiplier
   * @returns {vec2} A newly constructed vector.
   */
  project(distanceMultiplier) {
    return this.origin.add(this.direction.multiplyScalar(distanceMultiplier));
  }

  /**
   * Equivalent to Ray.angle.
   * The normalized angle of the ray in radians on the range (-PI, PI).
   * @returns {float}
   */
  angle2d() { return Math.atan2(this.direction.y, this.direction.x); }

  /**
   * Rotate the vector along the z axis.
   * @param {float} radians
   * @returns {Ray2dGLSLStruct}
   */
  rotate2d(radians) {
    // See https://www.quora.com/How-do-you-rotate-a-vector-by-an-angle
    const cA = Math.cos(radians);
    const sA = Math.sin(radians);
    return new Ray2dGLSLStruct(
      this.origin,
      vec2((this.direction.x * cA) - (this.direction.y * sA),
               (this.direction.x * sA) - (this.direction.y * cA)) // eslint-disable-line indent
    );
  }
}
export const Ray2d = (...args) => new Ray2dGLSLStruct(...args);

/**
 * Construct a ray from two points.
 * @param {vec2}
 * @param {vec2}
 * @returns {Ray2d}
 */
export function rayFromPoints(origin, towardsPoint) {
  return Ray2d(origin, towardsPoint.subtract(origin));
}

/**
 * Construct a ray from two points.
 * @param {vec2}
 * @param {vec2}
 * @returns {Ray2d}
 */
export function normalizedRayFromPoints(origin, towardsPoint) {
  return Ray2d(origin, normalizedDirection(origin, towardsPoint));
}

/**
 * Ray defined by a point and a direction from that point.
 */
export class RayGLSLStruct extends Ray2dGLSLStruct {
  origin = vec3();

  direction = vec3();

  constructor(origin, direction) {
    super(origin.xy, direction.xy);
    this.origin.set(origin, 0);
    this.direction.set(direction, 0);
  }
}
export const Ray = (...args) => new RayGLSLStruct(...args);

/**
 * Mimic the GLSL projectRay function.
 * @param {Ray2dGLSLStruct|RayGLSLStruct} r
 * @param {float} dist
 * @returns {vec2|vec3}
 */
export function projectRay(r, dist) { return r.project(dist); }

/**
 * Plane defined by a point on the plane and its normal.
 * This is the same, structurally, as a Ray, but included here for clarity.
 * Normal must be normalized.
 */
export class PlaneGLSLStruct {
  point = vec3();

  normal = vec3();

  constructor(point, normal) {
    this.point.set(point, 0);
    this.normal.set(normal, 0);
  }
}
export const Plane = (...args) => new PlaneGLSLStruct(...args);

/**
 * @param {Ray2dGLSLStruct|RayGLSLStruct} r
 * @param {Plane} P
 * @param {vec3} ix       Empty vector to use to save the intersection point
 * @returns {bool}
 */
export function intersectRayPlane(r, P, ix) {
  const denom = P.normal.dot(r.direction);

  // Check if line is parallel to the plane; no intersection
  if ( Math.abs(denom) < 0.0001 ) return false;

  const t = (P.normal.dot(P.point.subtract(r.origin))) / denom;
  ix.set(r.origin.add(r.direction.multiplyScalar(t)), 0);
  return true;
}

/**
 * Invert a wall key to get the coordinates.
 * Key = (MAX_TEXTURE_SIZE * x) + y, where x and y are integers.
 * @param {float} key
 * @returns {vec2} coordinates
 */
export function wallKeyCoordinates(key) {
  const EV_MAX_TEXTURE_SIZE = 65536.0;
  const EV_MAX_TEXTURE_SIZE_INV = 1.0 / EV_MAX_TEXTURE_SIZE;

  const x = Math.floor(key * EV_MAX_TEXTURE_SIZE_INV);
  const y = key - (EV_MAX_TEXTURE_SIZE * x);
  return vec2(x, y);
}

/**
 * Cross x and y parameters in a vec2.
 * @param {vec2} a  First vector
 * @param {vec2} b  Second vector
 * @returns {float} The cross product
 */
export function cross2d(a, b) { return (a.x * b.y) - (a.y * b.x); }

/**
 * @param {Ray2dGLSLStruct} a
 * @param {Ray2dGLSLStruct} b
 * @returns {float|null}  The t value or null if no intersection
 */
export function lineLineIntersectionRayT(a, b) {
  const denom = (b.direction.y * a.direction.x) - (b.direction.x * a.direction.y);

  // If lines are parallel, no intersection.
  if ( Math.abs(denom) < 0.0001 ) return null;

  const diff = a.origin.subtract(b.origin);
  return cross2d(b.direction, diff) / denom;
}

/**
 * @param {Ray2dGLSLStruct} a
 * @param {Ray2dGLSLStruct} b
 * @param {vec2} ix       Empty vector to store the intersection
 * @returns {bool}
 */
export function lineLineIntersectionRay(a, b, ix) {
  const t = lineLineIntersectionRayT(a, b);
  const ixFound = t !== null;
  if ( ixFound ) ix.set(a.origin.add(a.direction.multiplyScalar(t)));
  return ixFound;
}

/**
 * @param {vec2} a
 * @param {vec2} b
 * @param {vec2} c
 * @param {vec2} d
 * @param {vec2} ix       Empty vector to store the intersection
 * @returns {bool}
 */
export function lineLineIntersectionVector(a, b, c, d, ix) {
  const rayA = Ray2dGLSLStruct.fromPoints(a, b);
  const rayB = Ray2dGLSLStruct.fromPoints(c, d);
  return lineLineIntersectionRay(rayA, rayB, ix);
}

export function lineLineIntersection(a, b, c, d, ix) {
  if ( typeof c === "undefined" ) return lineLineIntersectionRayT(a, b);
  if ( typeof d === "undefined" ) return lineLineIntersectionRay(a, b, c);
  return lineLineIntersectionVector(a, b, c, d, ix);
}

/**
 * @param {vec2} a
 * @param {vec2} b
 * @param {vec2} c
 * @param {vec2} d
 * @returns {bool}
 */
function lineLineIntersectsVector(a, b, c, d) {
  const rayA = rayFromPoints(a, b);
  const rayB = rayFromPoints(c, d);
  return lineLineIntersects(rayA, rayB);
}

/**
 * @param {Ray2dGLSLStruct} a
 * @param {Ray2dGLSLStruct} b
 * @returns {bool}
 */
function lineLineIntersectsRay(a, b) {
  const denom = cross2d(a.direction, b.direction);

  // If lines are parallel, no intersection.
  return ( Math.abs(denom) >= 0.0001 );
}

export function lineLineIntersects(a, b, c, d) {
  if ( typeof c === "undefined" ) return lineLineIntersectsRay(a, b);
  return lineLineIntersectsVector(a, b, c, d);
}


/**
 * @param {vec2|vec3} a
 * @param {vec2|vec3} b
 * @returns {vec2|vec3}
 */
export function normalizedDirection(a, b) { return b.subtract(a).normalize(); }

/**
 * Returns 0.0 if x < a, otherwise 1.0
 * @param {float} a
 * @param {float} x
 * @returns {float}
 */
export function step(a, x) { return x < a ? 0.0 : 1.0; }

/**
 * Is x in the range of [a, b]?
 * @param {float} a
 * @param {float} b
 * @param {float} x
 * @returns {float} 0.0 if false
 */
export function between(a, b, x) {
  return step(a, x) * step(x, b);
}

/**
 * Shift the front or back border of the shadow, specified as a ratio between 0 and 1.
 * Shadow moves forward---towards the light---as terrain elevation rises.
 * Thus higher fragment elevation means less shadow.
 * @param {float} ratio       Ratio indicating where the shadow border lies between 0 and 1.
 * @param {float} wallHeight  Height of the wall, relative to the canvas elevation.
 * @param {float} wallRatio   Where the wall is relative to the light, where
 *                              0 means at the shadow end;
 *                              1 means at the light.
 * @param {float} elevChange  Percentage elevation change compared to the canvas
 * @returns {float} Modified ratio.
 */
export function elevateShadowRatio(ratio, wallHeight, wallRatio, elevChange) {
  if ( wallHeight === 0.0 ) return ratio;
  const ratioDist = wallRatio - ratio; // Distance between the wall and the canvas intersect as a ratio.
  const heightFraction = elevChange / wallHeight;
  return ratio + (heightFraction * ratioDist);
}

/**
 * Circle defined by center point and radius
 */
export class CircleGLSLStruct {
  center = vec2();

  radius = 0;

  constructor({ center, radius } = {}) {
    this.center.set(center, 0);
    this.radius = radius;
  }
}
export const Circle = (...args) => new CircleGLSLStruct(...args);

/**
 * Locate the tangents to a circle from a point.
 * https://en.wikipedia.org/wiki/Tangent_lines_to_circles
 * @param {Circle} circle
 * @param {vec2} p
 * @param {out vec2[2]} tangents
 * @returns {bool} False if no tangents.
 */
export function tangentPoints(circle, p, tangents) {
  const abs = Math.abs;
  const sqrt = Math.sqrt;
  const pow = Math.pow;

  const r2 = pow(circle.radius, 2.0); // @type {float}

  // Translate so origin is at circle center.
  const p0 = p.subtract(circle.center); // @type {vec2}
  if ( almostEqual(p0.y, 0.0, 1e-08) ) {
    // Translated point is on the x-axis of the circle.
    if ( almostEqual(abs(p0.x), circle.radius, 1e-08) ) { // On circle edge.
      tangents[0] = vec2(p);
      tangents[1] = vec2(p);
      return true;
    }
    if ( abs(p0.x) < circle.radius ) return false; // Inside the circle.

    const root = sqrt(pow(p0.x, 2.0) - r2); // {p0.x, r}.magnitude()
    tangents[0] = vec2(r2 / p0.x, circle.radius / p0.x);
    tangents[1] = vec2(tangents[0]);
    tangents[0].y *= root;
    tangents[1].y *= -root;
  } else {
    const d0 = p0.magnitude();
    if ( almostEqual(d0, circle.radius, 1e-08) ) { // On circle edge.
      tangents[0] = vec2(p);
      tangents[1] = vec2(p);
      return true;
    }
    if ( d0 < circle.radius ) return false; // Inside the circle.
    const d2 = pow(d0, 2.0);
    const root = sqrt(d2 - r2);
    const r2_d2 = r2 / d2;
    const r_d2_root = circle.radius / d2 * root;
    const adder = vec2(-p0.y, p0.x).multiplyScalar(r_d2_root);
    tangents[0] = vec2(r2_d2 * p0.x, r2_d2 * p0.y);
    tangents[1] = vec2(tangents[0]);
    tangents[0].x += adder.x;
    tangents[0].y += adder.y;
    tangents[1].x -= adder.x;
    tangents[1].y -= adder.y;
  }

  // Translate back.
  tangents[0] = tangents[0].add(circle.center);
  tangents[1] = tangents[1].add(circle.center);
  return true;
}

/**
 * GLSL representation of a point light.
 * @prop {vec3} center
 * @prop {vec3} lr0       Point closest to wall endpoint 0
 * @prop {vec3} lr1       Point closest to wall endpoint 1
 * @prop {vec3} top
 * @prop {vec3} bottom
 * @prop {float} size
 */
export class LightGLSLStruct {
  constructor({ center, lr0, lr1, top, bottom, size } = {}) {
    const args = { center, lr0, lr1, top, bottom, size };
    for ( const [key, value] of Object.entries(args) ) this[key] = value;
  }
}
export const Light = (...args) => new LightGLSLStruct(...args);

/**
 * GLSL representation of a Foundry wall.
 * TODO: Represent walls with different endpoint elevations.
 * @prop {vec3[2]} top
 * @prop {vec3[2]} bottom
 * @prop {vec3} direction
 * @prop {float[2]} linkValue
 * @prop {float} type
 * @prop {float} thresholdRadius2
 */
export class WallGLSLStruct {
  constructor({ top, bottom, direction, linkValue, type, thresholdRadius2 } = {}) {
    const args = { top, bottom, direction, linkValue, type, thresholdRadius2 };
    for ( const [key, value] of Object.entries(args) ) this[key] = value;
  }
}
export const Wall = (...args) => new WallGLSLStruct(...args);

/**
 * Represent the three directions of a shadow from a wall endpoint.
 * @prop {vec3} umbra
 * @prop {vec3} midpenumbra
 * @prop {vec3} penumbra
 */
export class ShadowDirectionsGLSLStruct {
  constructor({ umbra, midpenumbra, penumbra } = {}) {
    const args = { umbra, midpenumbra, penumbra };
    for ( const [key, value] of Object.entries(args) ) this[key] = value;
  }
}
export const ShadowDirections = (...args) => new ShadowDirectionsGLSLStruct(...args);

/**
 * Represent the three directions of a shadow from a wall endpoint.
 * @prop {vec2} umbra
 * @prop {vec2} midpenumbra
 * @prop {vec2} penumbra
 */
export class ShadowDirections2dGLSLStruct {
  constructor({ umbra, midpenumbra, penumbra } = {}) {
    const args = { umbra, midpenumbra, penumbra };
    for ( const [key, value] of Object.entries(args) ) this[key] = value;
  }
}
export const ShadowDirections2d = (...args) => new ShadowDirections2dGLSLStruct(...args);

/**
 * Represent three rays of a shadow: umbra, penumbra, midumbra.
 * Each ray goes through a wall endpoint.
 * Each ray type has two rays. Typically one for each endpoint, but sometimes these are mixed up.
 * @prop {Ray2d[2]} umbra
 * @prop {Ray2d[2]} midpenumbra
 * @prop {Ray2d[2]} penumbra
 */
export class ShadowRays2dGLSLStruct {
  constructor({ umbra, midpenumbra, penumbra } = {}) {
    const args = { umbra, midpenumbra, penumbra };
    for ( const [key, value] of Object.entries(args) ) this[key] = value;
  }
}
export const ShadowRays2d = (...args) => new ShadowRays2dGLSLStruct(...args);


/**
 * Represent the three endpoints of a shadow, opposite the wall endpoint.
 * @prop {vec2} umbra
 * @prop {vec2} midpenumbra
 * @prop {vec2} penumbra
 */
export class ShadowPointsGLSLStruct {
  constructor({ umbra, midpenumbra, penumbra } = {}) {
    const args = { umbra, midpenumbra, penumbra };
    for ( const [key, value] of Object.entries(args) ) this[key] = value;
  }
}
export const ShadowPoints = (...args) => new ShadowPointsGLSLStruct(...args);

/**
 * Represent a 2d rectangle.
 * @prop {vec2} tl
 * @prop {vec2} tr
 * @prop {vec2} br
 * @prop {vec2} bl
 */
export class RectGLSLStruct {
  constructor({ tl, tr, br, bl } = {}) {
    const args = { tl, tr, br, bl };
    for ( const [key, value] of Object.entries(args) ) this[key] = value;
  }
}
export const Rect = (...args) => new RectGLSLStruct(...args);

/**
 * Does a rectangle contain a 2d point?
 * @param {RectGLSLStruct} rect
 * @param {vec2} pt
 * @returns {bool}
 */
function rectContains(rect, pt) {
  if ( pt.x >= rect.tl.x && pt.x < rect.tr.x ) {
    if ( pt.y >= rect.tl.y && pt.y < rect.br.y ) {
      return true;
    }
  }
  return false;
}
