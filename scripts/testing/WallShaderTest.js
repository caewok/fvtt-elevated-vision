/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
"use strict";
/* eslint-disable eqeqeq */

import { MODULE_ID } from "../const.js";
import { Matrix } from "../geometry/Matrix.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Draw } from "../geometry/Draw.js";
import { Plane} from "../geometry/3d/Plane.js";

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
export const vec2 = res.vec2;
export const vec3 = res.vec3;
export const vec4 = res.vec4;

/* Testing
a = new vec2(1, 2);
b = new vec2(3, 4);
a.add(b)
*/


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
  // if ( denom == 0.0 ) return new vec3(-1.0, -1.0, -1.0);

  const denomInv = 1.0 / denom; // Fixed for given triangle
  const v = ((d11 * d20) - (d01 * d21)) * denomInv;
  const w = ((d00 * d21) - (d01 * d20)) * denomInv;
  const u = 1.0 - v - w;

  return new vec3(u, v, w);
}

/**
 * Test if a barycentric coordinate is within its defined triangle.
 * @param {vec3} bary     Barycentric coordinate; x,y,z => u,v,w
 * @returns {bool} True if inside
 */
export function barycentricPointInsideTriangle(bary) {
  return bary.y >= 0.0 && bary.z >= 0.0 && (bary.y + bary.z) <= 1.0;
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
  return origin.add(new vec2(dx, dy).multiplyScalar(distance));
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
function distance(a, b) { return a.distance(b); }

function distanceSquared(a, b) { return a.distanceSquared(b); }

/**
 * Ray defined by a point and a direction from that point.
 */
export class Ray2dGLSLStruct {
  origin = new vec2();

  direction = new vec2();

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
      new vec2((this.direction.x * cA) - (this.direction.y * sA),
               (this.direction.x * sA) - (this.direction.y * cA)) // eslint-disable-line indent
    );
  }
}

/**
 * Ray defined by a point and a direction from that point.
 */
export class RayGLSLStruct extends Ray2dGLSLStruct {
  origin = new vec3();

  direction = new vec3();

  constructor(origin, direction) {
    super(origin.xy, direction.xy);
    this.origin.set(origin, 0);
    this.direction.set(direction, 0);
  }
}

/**
 * Mimic the GLSL projectRay function.
 * @param {Ray2dGLSLStruct|RayGLSLStruct} r
 * @param {float} dist
 * @returns {vec2|vec3}
 */
function projectRay(r, dist) { return r.project(dist); }

/**
 * Plane defined by a point on the plane and its normal.
 * This is the same, structurally, as a Ray, but included here for clarity.
 * Normal must be normalized.
 */
export class PlaneGLSLStruct {
  point = new vec3();

  normal = new vec3();

  constructor(point, normal) {
    this.point.set(point, 0);
    this.normal.set(normal, 0);
  }
}

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
  return new vec2(x, y);
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

const UMBRA = 0;
const MIDPENUMBRA = 1;
const PENUMBRA = 2;

/**
 * Based on SizedPointSourceShadowWallShader.
 * Represents a single wall calculation.
 * 3 vertices: light, ix for corner 1, ix for corner 2.
 * Wall shadow with side, near, and far penumbra
 * General version extended by SizedPointSource and DirectionalSource
 */
class ShadowWallVertexShaderTest {

  static EV_ENDPOINT_LINKED_UNBLOCKED = -10.0;

  // From CONST.WALL_SENSE_TYPES
  static LIMITED_WALL = 10.0;

  static PROXIMATE_WALL = 30.0;

  static DISTANCE_WALL = 40.0;


  // ----- NOTE: IN variables ----- //
  attributes = {};

  // ----- NOTE: UNIFORM variables ----- //

  uniforms = {};

  // ----- NOTE: Configuration ----- //
  config({ attributes = {}, uniforms = {} } = {}) {
    const iV = this.attributes;
    const uV = this.uniforms;
    for ( let [key, value] of Object.entries(attributes) ) {
      // Duplicate simple arrays to avoid inadvertently changing them.
      if ( Array.isArray(value) ) value = foundry.utils.duplicate(value);
      iV[key] = value;
    }
    for ( let [key, value] of Object.entries(uniforms) ) {
      // Duplicate simple arrays to avoid inadvertently changing them.
      if ( Array.isArray(value) ) value = foundry.utils.duplicate(value);
      uV[key] = value;
    }
  }

  // ----- NOTE: Factory methods ----- //

  duplicate() {
    const out = new this.constructor();
    out.config(this);
    return out;
  }

  static fromShader(shader) {
    const out = new this();
    out.config({ uniforms: shader.uniforms });
    return out;
  }

  static fromMesh(mesh) {
    // Handles only basic geometry.
    const out = [];
    const { geometry, shader } = mesh;
    const buffers = geometry.buffers;
    for ( const idx of geometry.indexBuffer.data ) {
      // Indices are repeated, so use every third.
      if ( idx % 3 !== 0 ) continue;

      const instance = this.fromShader(shader);
      out.push(instance);
      const attributes = {};
      for ( const [key, attribute] of Object.entries(geometry.attributes) ) {
        const { buffer, size } = attribute;
        switch ( size ) {
          case 1: attributes[key] = buffers[buffer].data[idx]; break;
          default: attributes[key] = buffers[buffer].data.slice(idx * size, (idx * size) + size);
        }
      }
      instance.config({ attributes });
    }
    return out;
  }

  /* ----- NOTE: Attributes ----- */
  // Use getters so they cannot be changed inadvertently.
  // Convert arrays to vecs

  /** @type {vec4} */
  get aWallCorner0() { return new vec4(...this.attributes.aWallCorner0); }

  /** @type {vec4} */
  get aWallCorner1() { return new vec4(...this.attributes.aWallCorner1); }

  /** @type {float} */
  get aWallSenseType() { return this.attributes.aWallSenseType; }

  /** @type {float} */
  get aThresholdRadius2() { return this.attributes.aWallSenseType; }

  /* ----- NOTE: Uniforms ----- */

  /** @type {vec4} */
  get uElevationRes() { return new vec4(...this.uniforms.uElevationRes); }

  /** @type {vec4} */
  get uSceneDims() { return new vec4(...this.uniforms.uSceneDims); }

  /* ----- NOTE: Defined terms ---- */

  /** @type {WallGLSLStruct} */
  get wall() { return this.calculateWallPositions(); }

  /** @type {float} */
  get canvasElevation() { return this.uElevationRes.x; }

  /** @type {float} */
  get maxR() {
    const uSceneDims = this.uniforms.uSceneDims;
    return Math.sqrt((uSceneDims.z * uSceneDims.z) + (uSceneDims.w * uSceneDims.w)) * 2.0;
  }

  /** @type {Plane} */
  get canvasPlane() {
    const planeNormal = new vec3(0.0, 0.0, 1.0);
    const planePoint = new vec3(0.0, 0.0, this.canvasElevation);
    return new PlaneGLSLStruct(planePoint, planeNormal);
  }

  /** @type {vec3[2][3]} */
  get sidePenumbraDirs() {
    return [
      this.calculateSidePenumbraDirection(0),
      this.calculateSidePenumbraDirection(1)
    ];
  }

  get adjSidePenumbraDirs() {
    const sidePenumbraDirs = this.sidePenumbraDirs;
    this.adjustSidePenumbraForLinkedEndpoints(sidePenumbraDirs[0], this.wall, 0);
    this.adjustSidePenumbraForLinkedEndpoints(sidePenumbraDirs[1], this.wall, 1);
    return sidePenumbraDirs;
  }

  /** @type {vec3[2][3]} */
  get nearPenumbraDirs() {
    return [
      this.calculateNearPenumbraDirection(0),
      this.calculateNearPenumbraDirection(1)
    ];
  }

  /** @type {vec3[2][3]} */
  get farPenumbraDirs() {
    return [
      this.calculateFarPenumbraDirection(0),
      this.calculateFarPenumbraDirection(1)
    ];
  }

  /** @type {object} */
  get varyings() {
    const {
      vVertexPosition,
      vTerrainTexCoord,
      vPenumbra,
      vMidPenumbra,
      vUmbra,
      vSidePenumbra0,
      vSidePenumbra1,
      vWall,
      vNearPenumbra,
      vNearMidPenumbra } = this;
    return { vVertexPosition, vTerrainTexCoord, vPenumbra, vUmbra, vSidePenumbra0, vSidePenumbra1, vWall, vNearPenumbra, vNearMidPenumbra };
  }

  get flats() {
    const {
      fWallSenseType,
      fThresholdRadius2,
      fWallHeights,
      fWallRatio,
      fNearRatios,
      fFarRatios,
      fWallCornerLinked } = this;
    return { fWallSenseType, fThresholdRadius2, fWallHeights, fWallRatio, fNearRatios, fFarRatios, fWallCornerLinked };
  }

  // ----- NOTE: Penumbras ----- //

  /**
   * For side penumbra directions, determine if they must be moved to address light leakage
   * from linked endpoints.
   * @param {inout ShadowDirections} penObj
   * @param {Wall} wall
   * @param {int} idx
   */
  adjustSidePenumbraForLinkedEndpoints(penObj, wall, idx) {
    const orient = foundry.utils.orient2dFast;
    const Ray2d = Ray2dGLSLStruct;

    const wXY = wall.top[idx].xy; // Wall endpoint from which a penumbra is cast.

    // If no linked wall, full penumbra is used.
    const linkAngle = wall.linkValue[idx];
    if ( linkAngle === this.constructor.EV_ENDPOINT_LINKED_UNBLOCKED ) {
      console.log(`adjustSidePenumbraForLinkedEndpoints|idx ${idx} is unblocked.`);
      return;
    }

    // Determine orientation relative to the mid-penumbra.
    // 4 quadrants:
    // 1 & 2: linked wall is on opposite side from wall, so it blocks.
    // 3 & 4: linked wall is on same side as light:
    // - 3: Linked wall not between wall and mid: no block (tight "V")
    // - 4: Linked wall between wall and mid
    //     • If umbra - linked - mid-penumbra, adjust umbra direction.
    //     • If umbra - mid - linked - penumbra, umbra set to mid.

    // Point positions.
    const linkPt = fromAngle(wXY, linkAngle, 1.0);
    const midR = new Ray2d(wXY, penObj.midpenumbra.xy);
    const midPt = midR.project(1.0);

    // Orientation re mid.
    const other = (wall.top[1 - idx]).xy;
    const oMidLink = orient(wXY, midPt, linkPt);
    const oMidWall = orient(wXY, midPt, other);

    // 1 & 2: linked wall blocks light.
    const linkOppositeWall = oMidWall * oMidLink <= 0.0;
    if ( linkOppositeWall ) {
      penObj.umbra.x = penObj.midpenumbra.x;
      penObj.umbra.y = penObj.midpenumbra.y;
      penObj.umbra.z = penObj.midpenumbra.z;

      penObj.penumbra.x = penObj.midpenumbra.x;
      penObj.penumbra.y = penObj.midpenumbra.y;
      penObj.penumbra.z = penObj.midpenumbra.z;
      console.log(`adjustSidePenumbraForLinkedEndpoints|idx ${idx} linked wall blocks light fully.`);
      return;
    }

    // 3 & 4: Linked wall between wall and mid
    // 3: Linked wall in quadrant with light, not blocking.
    const oLinkWall = orient(wXY, linkPt, other);
    const oLinkMid = orient(wXY, linkPt, midPt);
    const linkBetweenWallAndMid = oLinkWall * oLinkMid < 0.0;
    if ( !linkBetweenWallAndMid ) {
      console.log(`adjustSidePenumbraForLinkedEndpoints|idx ${idx} not blocking (#3).`);
      return;
    }

    // 4. possible block.
    // What side of umbra is the linked wall on? If not on the mid-side, it doesn't block.
    const umbraR = new Ray2d(wXY, penObj.umbra.xy);
    const umbraPt = umbraR.project(1);
    const oUmbraLink = orient(wXY, umbraPt, linkPt);
    const oUmbraMid = orient(wXY, umbraPt, midPt);
    const linkAfterUmbra = oUmbraLink * oUmbraMid > 0.0;
    if ( !linkAfterUmbra ) {
      console.log(`adjustSidePenumbraForLinkedEndpoints|idx ${idx} is unblocked.`);
      return;
    }

    // Linked wall is after umbra, moving toward mid.
    const oMidUmbra = orient(wXY, midPt, umbraPt);

    // Set umbra to the link direction.
    // TODO: This results in a non-normalized direction. Is there a way to get the normalized direction?
    // - normalizing again could change x/y, so cannot do that ?
    const linkDir = normalizedDirection(wXY, linkPt);
    penObj.umbra.x = linkDir.x;
    penObj.umbra.y = linkDir.y;
    console.log(`adjustSidePenumbraForLinkedEndpoints|idx ${idx} partially blocked. Adjusting umbra.`);
    if ( oMidUmbra * oMidLink > 0.0 ) return;

    // Linked wall is after mid; adjust mid as well.
    penObj.midpenumbra.x = linkDir.x;
    penObj.midpenumbra.y = linkDir.y;
    console.log(`adjustSidePenumbraForLinkedEndpoints|idx ${idx} partially blocked. Adjusting mid.`);

  }


  /**
   * Determine the point where the near/far penumbra intersects the side penumbra, if any
   * sideDir: sidePenumbraDirs[idx][shadowType]
   * nearFarDir: farPenumbraDirs[idx][shadowType] or nearPenumbraDirs[idx][shadowType]
   * @param {Plane} canvasPlane
   * @param {vec3} wallEndpoint
   * @param {vec2} wallDirection
   * @param {vec3} sideDir
   * @param {vec3} nearFarDir
   * @param {vec2} ix                 Placeholder to store the intersection point.
   * @returns {bool}
   */
  penumbraCanvasIntersection(canvasPlane, wallEndpoint, wallDirection, sideDir, nearFarDir, ix) {
    const Ray2d = Ray2dGLSLStruct;
    const Ray = RayGLSLStruct;
    const lineLineIntersection = lineLineIntersectionRay;

    const canvasIx = new vec3();
    const infiniteShadow = nearFarDir.z >= 0.0;
    if ( infiniteShadow
      || !intersectRayPlane(new Ray(wallEndpoint, nearFarDir), canvasPlane, canvasIx)) return false;

    // Draw a line parallel to the wall that goes through the intersection point.
    // The intersection of that with the side penumbra defines the point.
    const farParallelRay = new Ray2d(canvasIx.xy, wallDirection);
    if ( !lineLineIntersection(farParallelRay, new Ray2d(wallEndpoint.xy, sideDir.xy), ix) ) return false;
    return true;
  }

  /**
   * Get either the point where the penumbra direction intersects the canvas or the point
   * at maximum canvas distance, as measured from wall endpoint 0.
   * Calculates points from both wall endpoints 0 and 1.
   * @param {vec3[2]} wallEndpoints
   * @param {vec2} wallDirection
   * @param {vec3} sideDir0
   * @param {vec3} sideDir1
   * @param {vec3} nearFarDir
   * @param {Wall} wall
   * @param {int} idx                 The wall endpoint associated with this penumbra
   *
   * @returns {vec2[2]} Canvas intersection or the maximum distance.
   */
  penumbraEndpoints(wallEndpoints, wallDir, sideDir0, sideDir1, nearFarDir) {
    const Ray2d = Ray2dGLSLStruct;
    const Plane = PlaneGLSLStruct;
    const lineLineIntersection = lineLineIntersectionRay;
    const { uElevationRes, uSceneDims } = this;

    const canvasElevation = uElevationRes.x;

    // Plane describing the canvas at elevation.
    const planeNormal = new vec3(0.0, 0.0, 1.0);
    const planePoint = new vec3(0.0, 0.0, canvasElevation);
    const canvasPlane = new Plane(planePoint, planeNormal);

    const infiniteShadow = nearFarDir.z >= 0.0; // Ray is rising as it moves from light --> wall.
    let keyPoint = new vec2(0.0);
    if ( infiniteShadow
      || !this.penumbraCanvasIntersection(canvasPlane, wallEndpoints[0], wallDir,
        sideDir0, nearFarDir, keyPoint) ) {

      keyPoint = this._parallelFarCorner(wallEndpoints, wallDir, nearFarDir);
    }

    // Get the other endpoint by intersecting the other ray.
    // TODO: If the endpoint heights are different, a more nuanced approach would be required.
    const farParallelRay = new Ray2d(keyPoint, wallDir);
    const canvasIx = [new vec2(), new vec2()];
    lineLineIntersection(farParallelRay, new Ray2d(wallEndpoints[0].xy, sideDir0.xy.normalize()), canvasIx[0]);
    lineLineIntersection(farParallelRay, new Ray2d(wallEndpoints[1].xy, sideDir1.xy.normalize()), canvasIx[1]);
    return canvasIx;
  }

  /**
   * Get the corner that can be used to project a far parallel ray to a wall.
   * Used in penumbraEndpoints to determine the infinite shadow parallel ray.
   * @param {vec3[2]} wallEndpoints,
   * @param {vec2} wallDir,
   * @param {vec3} nearFardir
   * @returns {vec2}
   */
  _parallelFarCorner(wallEndpoints, wallDir, nearFarDir) {
    const orient = foundry.utils.orient2dFast;
    const Ray2d = Ray2dGLSLStruct;
    const { uSceneDims } = this;

    const TL = 0;
    const TR = 1;
    const BR = 2;
    const BL = 3;

    // Ensure the shadow extends to the canvas edges.
    // Set the far parallel to intersect a corner.
    const sceneRect = Array(4);
    sceneRect[TL] = new vec2(0.0, 0.0);
    sceneRect[TR] = new vec2((uSceneDims.x * 2.0) + uSceneDims.z, 0.0);
    sceneRect[BR] = new vec2((uSceneDims.x * 2.0) + uSceneDims.z, (uSceneDims.y * 2.0) + uSceneDims.w);
    sceneRect[BL] = new vec2(0.0, (uSceneDims.y * 2.0) + uSceneDims.w);

    const oWallLight = orient(wallEndpoints[0].xy, wallEndpoints[1].xy,
      wallEndpoints[0].xy.subtract(nearFarDir.xy.normalize()));
    if ( wallDir.x === 0.0 ) {
      // Wall parallel to left/right.
      const oTL = orient(wallEndpoints[0].xy, wallEndpoints[1].xy, sceneRect[TL]);
      return (oTL * oWallLight) < 0.0 ? sceneRect[TL] : sceneRect[TR];
    }

    if ( wallDir.y === 0.0 ) {
      // Wall parallel to top/bottom.
      const oTL = orient(wallEndpoints[0].xy, wallEndpoints[1].xy, sceneRect[TL]);
      return (oTL * oWallLight) < 0.0 ? sceneRect[TL] : sceneRect[BL];
    }

    // One corner opposite the light can be used; its line will not intersect the canvas rect.
    for ( let i = 0; i < 4; i += 1 ) {
      const corner = sceneRect[i];
      const oCorner = orient(wallEndpoints[0].xy, wallEndpoints[1].xy, corner);
      if ( (oCorner * oWallLight) < 0.0 ) {
        const r = new Ray2d(corner, wallDir);
        const testPt = r.project(1.0);
        if ( !this._rectContains(sceneRect, testPt) ) return corner;
      }
    }
    return sceneRect[0]; // Should not happen.
  }

  /**
   * Test if a rect, represented as an array of 4 clockwise points from top left, contains point.
   * @param {vec2[4]} rect
   * @param {vec2} pt
   * @returns {bool}
   */
  _rectContains(rect, pt) {
    const TL = 0;
    const TR = 1;
    const BR = 2;
    const BL = 3;
    return pt.x >= rect[TL].x
      && pt.x < rect[TR].x
      && pt.y >= rect[TL].y
      && pt.y < rect[BR].y;
  }

  /**
   * Get all shadow-canvas intersections for a given wall endpoint.
   * @param {ShadowDirections[2]} sidePenumbraDirs
   * @param {ShadowDirections[2]} nearFarPenumbraDirs   Far or near directions
   * @param {vec3[2]} wallEndpoints                     Top for far, bottom for near
   * @param {vec3} wallDirection
   * @returns {ShadowPoints[2]}
   */
  endpointsForPenumbras(sidePenumbraDirs, nearFarPenumbraDirs, wallEndpoints, wallDir) {
    const umbra = this.penumbraEndpoints(wallEndpoints, wallDir,
      sidePenumbraDirs[0].umbra, sidePenumbraDirs[1].umbra, nearFarPenumbraDirs[0].umbra);
    const midpenumbra = this.penumbraEndpoints(wallEndpoints, wallDir,
      sidePenumbraDirs[0].midpenumbra, sidePenumbraDirs[1].midpenumbra, nearFarPenumbraDirs[0].midpenumbra);
    const penumbra = this.penumbraEndpoints(wallEndpoints, wallDir,
      sidePenumbraDirs[0].penumbra, sidePenumbraDirs[1].penumbra, nearFarPenumbraDirs[0].penumbra);
    return [
      new ShadowPointsGLSLStruct({
        umbra: umbra[0],
        midpenumbra: midpenumbra[0],
        penumbra: penumbra[0]}),
      new ShadowPointsGLSLStruct({
        umbra: umbra[1],
        midpenumbra: midpenumbra[1],
        penumbra: penumbra[1]})
    ];

  }

  // ----- NOTE: Vertex shader calculations ----- //

  /**
   * For a given shadow vectors structure, get the corresponding vector.
   * @param {ShadowPoints} shadowPoints
   * @param {int} shadowType
   * @returns {vec2}
   */
  pointForShadowType(shadowPoints, shadowType) {
    switch ( shadowType ) {
      case UMBRA: return shadowPoints.umbra;
      case MIDPENUMBRA: return shadowPoints.midpenumbra;
      case PENUMBRA: return shadowPoints.penumbra;
    }
    return new vec2(0.0);
  }

  /**
   * Build the triangle to represent this light's shadow vis-a-vis the wall.
   * @param {ShadowPoints[2]} farPenumbraPoints
   * @param {Wall} wall
   * @param {int} shadowType
   * @returns {vec2[3]}
   */
  buildTriangle(farPenumbraPoints, wall, shadowType) {
    const lineLineIntersection = lineLineIntersectionVector;

    // Construct a new light position based on the xy intersection of the penumbra points --> wall corner
    const a = new vec2(); // Will be the new light center.
    const b = this.pointForShadowType(farPenumbraPoints[0], shadowType).xy;
    const c = this.pointForShadowType(farPenumbraPoints[1], shadowType).xy;
    lineLineIntersection(b, wall.top[0].xy, c, wall.top[1].xy, a);
    return [a, b, c];
  }

  calculateWallPositions() {
    const { aWallCorner0, aWallCorner1, aWallSenseType, aThresholdRadius2 } = this;

    const aTop = new vec3(aWallCorner0.x, aWallCorner0.y, aWallCorner0.z);
    const bTop = new vec3(aWallCorner1.x, aWallCorner1.y, aWallCorner0.z);
    const aBottom = new vec3(aWallCorner0.x, aWallCorner0.y, aWallCorner1.z);
    const bBottom = new vec3(aWallCorner1.x, aWallCorner1.y, aWallCorner1.z);
    return new WallGLSLStruct({
      top: [aTop, bTop],
      bottom: [aBottom, bBottom],
      direction: normalizedDirection(aWallCorner0.xy, aWallCorner1.xy), // Moving from 0 --> 1.
      linkValue: [aWallCorner0.w, aWallCorner1.w],
      type: aWallSenseType,
      thresholdRadius2: aThresholdRadius2
    });
  }

  /**
   * Set the side penumbra variables for the vertex position.
   * @param {vec2} pt
   * @param {Wall} wall
   * @param {vec2[3]} penumbraTri
   * @param {vec2[3]} umbraTri
   * @returns {object} For testing only, returns the varyings. Returns void in shader.
   */
  setSidePenumbraVars(pt, wall, penumbraTri, umbraTri) {
    const orient = foundry.utils.orient2dFast;
    const abs = Math.abs;

    const vSidePenumbras = [
      new vec3(),
      new vec3()
    ];
    for ( let i = 0; i < 2; i += 1 ) {
      const a = wall.top[i].xy;
      const b = penumbraTri[i + 1];
      const c = umbraTri[i + 1];

      // If b and c are equal, there is no side penumbra;
      // If a/b/c line up, there is no side penumbra.
      // Set so all points are outside by making the triangle a fixed -1.
      if ( abs(orient(a, b, c)) < 1.0 ) vSidePenumbras[i] = new vec3(-1.0);
      else vSidePenumbras[i] = barycentric(pt, a, b, c);
      // vSidePenumbras[i] = barycentric(pt, a, b, c);
    }
    this.vSidePenumbra0 = vSidePenumbras[0];
    this.vSidePenumbra1 = vSidePenumbras[1];
  }

  /**
   * Calculate the flat variables, including near/far ratios.
   * @param {Wall} wall
   * @param {ShadowPoints[2]} farPenumbraPoints
   * @param {ShadowPoints[2]} nearPenumbraPoints
   * @param {vec2[3]} penumbraTri
   * @returns {object} For testing only, the flat variables.
   */
  calculateFlatVariables(wall, sidePenumbraDirs, farPenumbraPoints0, nearPenumbraDirs, penumbraTri) {
    const { uElevationRes } = this;

    const wTop = wall.top[0];
    const wBottom = wall.bottom[0];
    const canvasElevation = uElevationRes.x;

    this.fWallCornerLinked = new vec2(wall.linkValue[0], wall.linkValue[1]);
    this.fWallHeights = new vec2(wTop.z, wBottom.z);
    this.fWallSenseType = wall.type;
    this.fThresholdRadius2 = wall.thresholdRadius2;

    // Location of the wall along the x axis of the barycentric penumbra triangle.
    this.fWallRatio = this.baryForPoint(wTop.xy, penumbraTri).x;

    // Location of the far shadow along the x axis of the barycentric penumbra triangle.
    // Stored as vec3: UMBRA (x), MID (y), PENUMBRA (z)
    const farPts = farPenumbraPoints0;
    this.fFarRatios = new vec3(0.0);
    this.fFarRatios[UMBRA] = this.baryForPoint(farPts.umbra, penumbraTri).x;
    this.fFarRatios[MIDPENUMBRA] = this.baryForPoint(farPts.midpenumbra, penumbraTri).x;
    // PENUMBRA is 0.0 by definition, b/c it is at end of triangle.

    // Location of the near shadow along the x axis of the barycentric penumbra triangle.
    // Stored as vec3: UMBRA (x), MID (y), PENUMBRA (z)
    this.fNearRatios = new vec3(this.fWallRatio); // Near shadow starts at wall unless the wall is "floating."
    if ( wBottom.z > canvasElevation ) {
      const nearPenumbraPoints = this.nearPenumbraPoints = this.endpointsForPenumbras(
        sidePenumbraDirs, nearPenumbraDirs, wall.bottom, wall.direction);
      const nearPts = nearPenumbraPoints[0];
      this.fNearRatios[UMBRA] = this.baryForPoint(nearPts.umbra, penumbraTri).x;
      this.fNearRatios[MIDPENUMBRA] = this.baryForPoint(nearPts.midpenumbra, penumbraTri).x;
      this.fNearRatios[PENUMBRA] = this.baryForPoint(nearPts.penumbra, penumbraTri).x;
    } else {
      // Debugging only.
      this.nearPenumbraPoints = [
        new ShadowPointsGLSLStruct({
          umbra: wall.bottom[0].xy,
          midpenumbra: wall.bottom[0].xy,
          penumbra: wall.bottom[0].xy
        }),
        new ShadowPointsGLSLStruct({
          umbra: wall.bottom[1].xy,
          midpenumbra: wall.bottom[1].xy,
          penumbra: wall.bottom[1].xy
        })
      ];
    }

    // For debugging.
    return this.flats;
  }

  /**
    * Mimic calculations done in the vertex shader.
    * @param {int} vertexNum     The vertex being "processed."
    * @returns {object} Object containing all out variables.
    */
  vertexCalculations(gl_VertexID = 0) {
    const { farPenumbraDirs, nearPenumbraDirs, wall } = this;
    const { uSceneDims, uElevationRes } = this;

    const vertexNum = gl_VertexID % 3;
    // Penumbra structures.
    // this.adjustSidePenumbraForLinkedEndpoints(sidePenumbraDirs[0], wall, 0);
    // this.adjustSidePenumbraForLinkedEndpoints(sidePenumbraDirs[1], wall, 1);
    const adjSidePenumbraDirs = this.adjSidePenumbraDirs;
    const farPenumbraPoints = this.farPenumbraPoints = this.endpointsForPenumbras(
      adjSidePenumbraDirs, farPenumbraDirs, wall.top, wall.direction);

    // Vertex Calculations
    // Big triangle ABC is the bounds of the potential shadow.
    //   A = lightCenter;
    //   B = sidePenumbra;
    //   C = sidePenumbra;
    const penumbraTri = this.buildTriangle(farPenumbraPoints, wall, PENUMBRA);
    const vVertexPosition = this.vVertexPosition = penumbraTri[vertexNum];

    // Set barymetric coordinates for each corner of the triangle.
    const midPenumbraTri = this.buildTriangle(farPenumbraPoints, wall, MIDPENUMBRA);
    const umbraTri = this.buildTriangle(farPenumbraPoints, wall, UMBRA);
    this.vPenumbra = new vec3(0.0);
    this.vPenumbra[vertexNum] = 1.0;
    this.vMidPenumbra = this.baryForPoint(vVertexPosition, midPenumbraTri);
    this.vUmbra = this.baryForPoint(vVertexPosition, umbraTri);
    this.setSidePenumbraVars(vVertexPosition, wall, penumbraTri, umbraTri);

    // Calculate the terrain texture coordinate at this vertex based on scene dimensions.
    // (vVertexPosition - uSceneDims.xy) / uSceneDims.zw
    this.vTerrainTexCoord = (vVertexPosition.subtract(uSceneDims.xy)).divide(uSceneDims.zw);

    // Test using the light --> endpoints triangle for testing in front of wall.
    // Looking for better resolution on the wall shading for infinite shadows.
    const wallTri = [
      penumbraTri[0],
      wall.top[0].xy,
      wall.top[1].xy
    ];
    this.vWall = this.baryForPoint(vVertexPosition, wallTri);

    // Same for the near umbra and midpenumbra near triangles.
    // Lessen number of flat variables and attempt to address resolution issue with
    // infinite wall vision shadows.
    const canvasElevation = uElevationRes.x;
    if ( wall.bottom[0].z > canvasElevation ) {
      const nearPenumbraPoints = this.endpointsForPenumbras(
        adjSidePenumbraDirs, nearPenumbraDirs, wall.bottom, wall.direction);
      const nearPenumbraTri = [
        penumbraTri[0],
        nearPenumbraPoints[0].penumbra,
        nearPenumbraPoints[1].penumbra
      ];
      const nearMidPenumbraTri = [
        penumbraTri[0],
        nearPenumbraPoints[0].midpenumbra,
        nearPenumbraPoints[1].midpenumbra
      ];
      this.vNearPenumbra = this.baryForPoint(vVertexPosition, nearPenumbraTri);
      this.vNearMidPenumbra = this.baryForPoint(vVertexPosition, nearMidPenumbraTri);

    } else {
      this.vNearPenumbra = this.vWall;
      this.vNearMidPenumbra = this.vWall;
    }

    // In shader:
    // gl_Position = vec4((projectionMatrix * translationMatrix * vec3(this.vVertexPosition, 1.0)).xy, 0.0, 1.0);

    // Finally, set the flat variables when we hit the last vertex for this triangle.
    if ( vertexNum === 2 ) {
      this.calculateFlatVariables(wall, adjSidePenumbraDirs, farPenumbraPoints[0], nearPenumbraDirs, penumbraTri);
    }

    // For debugging.
    return { varyings: this.varyings, flats: this.flats };
  }


  // ----- NOTE: Fragment shader testing ----- //

  /**
   * @param {bool} SHADOW   The #define SHADOW parameter
   * @returns {vec4}
   */
  noShadow(SHADOW = true) { return SHADOW ? new vec4(0.0) : new vec4(1.0); }

  /**
   * @param {float} light
   * @param {bool} SHADOW   The #define SHADOW parameter
   * @returns {vec4}
   */
  lightEncoding(light, SHADOW = true) {
    if ( light === 1.0 ) return this.noShadow(SHADOW);

    const ltd = this.fWallSenseType === this.constructor.LIMITED_WALL ? 1.0 : 0.0;
    const ltdInv = 1.0 - ltd;
    let c = new vec4((light * ltdInv) + ltd, 1.0 - (0.5 * ltd), (light * ltd) + ltdInv, 1.0);

    // For testing, return the amount of shadow, which can be directly rendered to the canvas.
    // if ( light < 1.0 && light > 0.0 ) return vec4(0.0, 1.0, 0.0, 1.0);
    if ( SHADOW ) c = new vec4(new vec3(0.0), (1.0 - light) * 0.7);
    return c;
  }

  /**
   * Get the barycentric position for a given 2d canvas point.
   * Used to mimic the vBary coordinates in the fragment shader.
   * @param {vec2} pt
   * @param {vec2[3]} tri
   * @returns {vec3}
   */
  baryForPoint(pt, tri) {
    return barycentric(pt, tri[0], tri[1], tri[2]);
  }

  /**
   * Elevate given shadow ratios.
   * @param {float} elevation
   * @param {float} wallHeight
   * @param {vec3} ratios
   * @returns {vec3}
   */
  _elevateShadowRatios(elevation, wallHeight, ratios) {
    const { uElevationRes, fWallRatio } = this;

    const canvasElevation = uElevationRes.x;
    if ( elevation <= canvasElevation ) return ratios;

    wallHeight = Math.max(wallHeight - canvasElevation, 0.0);
    if ( wallHeight === 0.0 ) return ratios;

    const elevationChange = elevation - canvasElevation;
    const heightFraction = elevationChange / wallHeight;

    // For JS only.
    // GLSL: return ratios + (heightFraction * fWallRatio) - (heightFraction * ratios);
    const tmpV = new vec3(heightFraction * fWallRatio);
    return ratios.add(tmpV).subtract(ratios.multiplyScalar(heightFraction));
  }

  /**
   * Elevate the far shadow ratios.
   * @param {float} elevation
   * @returns {vec3}
   */
  elevateFarShadowRatios(elevation) {
    const { fWallHeights, fFarRatios } = this;
    return this._elevateShadowRatios(elevation, fWallHeights.x, fFarRatios);
  }

  /**
   * Elevate the near shadow ratios.
   * @param {float} elevation
   * @returns {vec3}
   */
  elevateNearShadowRatios(elevation) {
    const { fWallHeights, fNearRatios } = this;
    return this._elevateShadowRatios(elevation, fWallHeights.y, fNearRatios);
  }

  /**
   * Is the fragment location in front of the wall?
   * @returns {bool}
   */
  inFrontOfWall() {
    const { vPenumbra, fWallRatio } = this;
    return vPenumbra.x > fWallRatio;
  }

  /**
   * Determine if a threshold applies to this point.
   */
  thresholdApplies() {
    const { DISTANCE_WALL, PROXIMATE_WALL } = this.constructor;
    const { vVertexPosition, fWallSenseType, fThresholdRadius2, uLightPosition } = this;
    return (fWallSenseType == DISTANCE_WALL || fWallSenseType == PROXIMATE_WALL)
      && fThresholdRadius2 != 0.0
      && distanceSquared(vVertexPosition, uLightPosition.xy) < fThresholdRadius2;
  }

  /**
   * Is the fragment in the umbra triangle, accounting for near/far?
   * Does not test for in front of wall.
   * @param {vec3} farRatios
   * @param {vec3} nearRatios
   * @returns {bool}
   */
  inUmbra(farRatios, nearRatios) {
    const { vUmbra, vPenumbra } = this;
    if ( !barycentricPointInsideTriangle(vUmbra) ) return false;
    return between(farRatios[UMBRA], nearRatios[UMBRA], vPenumbra.x) == 1.0;
  }

  /**
   * Is the fragment in the mid-penumbra triangle, accounting for near/far?
   * Does not test for in front of wall.
   * @param {vec3} farRatios
   * @param {vec3} nearRatios
   * @returns {bool}
   */
  inMidPenumbra(farRatios, nearRatios) {
    const { vMidPenumbra, vPenumbra } = this;
    if ( !barycentricPointInsideTriangle(vMidPenumbra) ) return false;
    return between(farRatios[MIDPENUMBRA], nearRatios[MIDPENUMBRA], vPenumbra.x) == 1.0;
  }

  /**
   * Is the fragment in the penumbra triangle, accounting for near/far?
   * Does not test for in front of wall.
   * @param {vec3} farRatios
   * @param {vec3} nearRatios
   * @returns {bool}
   */
  inPenumbra(farRatios, nearRatios) {
    const { vPenumbra } = this;
    // Always in the penumbra triangle b/c it defines the vertices.
    return between(farRatios[PENUMBRA], nearRatios[PENUMBRA], vPenumbra.x) == 1.0;
  }

  /**
   * Is the fragment in the far penumbra area?
   * Does not test for in front of wall.
   * @param {vec3} farRatios
   * @param {vec3} nearRatios
   * @returns {bool}
   */
  inFarPenumbra(farRatios, nearRatios) {
    const { vPenumbra } = this;
    if ( this.inUmbra(farRatios, nearRatios) ) return false;
    // Worse for shadow blending: if ( this.inMidPenumbra(farRatios, nearRatios) ) return false;
    return between(farRatios[PENUMBRA], farRatios[MIDPENUMBRA], vPenumbra.x) == 1.0;
  }

  /**
   * Is the fragment in the far mid-penumbra area?
   * Does not test for in front of wall.
   * @param {vec3} farRatios
   * @param {vec3} nearRatios
   * @returns {bool}
   */
  inFarMidPenumbra(farRatios, nearRatios) {
    const { vPenumbra } = this;
    if ( this.inUmbra(farRatios, nearRatios) ) return false;
    // Worse for shadow blending: if ( !this.inMidPenumbra(farRatios, nearRatios) ) return false;
    return between(farRatios[MIDPENUMBRA], farRatios[UMBRA], vPenumbra.x) == 1.0;
  }

  /**
   * Is the fragment in the near penumbra area?
   * Does not test for in front of wall.
   * @param {vec3} farRatios
   * @param {vec3} nearRatios
   * @returns {bool}
   */
  inNearPenumbra(farRatios, nearRatios) {
    const { vPenumbra } = this;
    if ( this.inUmbra(farRatios, nearRatios) ) return false;
    // Worse for shadow blending: if ( this.inMidPenumbra(farRatios, nearRatios) ) return false;
    return between(nearRatios[MIDPENUMBRA], nearRatios[PENUMBRA], vPenumbra.x) == 1.0;
  }

  /**
   * Is the fragment in the near mid-penumbra area?
   * Does not test for in front of wall.
   * @param {vec3} farRatios
   * @param {vec3} nearRatios
   * @returns {bool}
   */
  inNearMidPenumbra(farRatios, nearRatios) {
    const { vPenumbra } = this;
    if ( this.inUmbra(farRatios, nearRatios) ) return false;
    // Worse for shadow blending: if ( !this.inMidPenumbra(farRatios, nearRatios) ) return false;
    return between(nearRatios[UMBRA], nearRatios[MIDPENUMBRA], vPenumbra.x) == 1.0;
  }

  /**
   * Calculate the varying variables based on a vVertexPosition value.
   */
  setVaryings(pt) {
    pt ??= this.vVertexPosition;

    // Set the flat variables
    this.vertexCalculations(2);

    // Construct three versions of the shader, one for each vertex.
    const shaders = Array(3);
    for ( let i = 0; i < 3; i += 1 ) {
      shaders[i] = this.duplicate();
      shaders[i].vertexCalculations(i);
    }

    // Use barycentric coordinates to get the value of the vVertexPosition for each varying.
    const varyingKeys = [
      "vTerrainTexCoord",
      "vPenumbra",
      "vMidPenumbra",
      "vUmbra",
      "vSidePenumbra0",
      "vSidePenumbra1",
      "vWall",
      "vNearPenumbra",
      "vNearMidPenumbra"
    ];

    // The penumbra triangle that defines this shader.
    const vVertexPosition = new vec2(pt.x, pt.y);
    const bary = barycentric(vVertexPosition,
      shaders[0].vVertexPosition,
      shaders[1].vVertexPosition,
      shaders[2].vVertexPosition);
    const varying = {};
    for ( const varyingKey of varyingKeys ) {
      const a = shaders[0][varyingKey];
      const b = shaders[1][varyingKey];
      const c = shaders[2][varyingKey];
      this[varyingKey] = varying[varyingKey] = this._baryInterpolation(bary, a, b, c);
    }
    return varying;
  }

  /**
   * @param {vec3} bary   The barycentric coordinates to use for interpolation
   * @param {float|vec} a
   * @param {float|vec} b
   * @param {float|vec} c
   * @returns {float|vec}
   */
  _baryInterpolation(bary, a, b, c) {
    // Formula: a * bary.x + b * bary.y + c * bary.z
    if ( Number.isNumeric(a) ) {
      const abc = new vec3(a, b, c);
      return bary.dot(abc);
    }

    // Assumes a, b, c are vectors
    a = a.multiplyScalar(bary.x);
    b = b.multiplyScalar(bary.y);
    c = c.multiplyScalar(bary.z);
    return a.add(b).add(c);
  }

  /**
   * Get the barycentric position for a given 2d canvas point.
   * Used to mimic the vBary coordinates in the fragment shader.
   */
  _varyingBaryForPoint(pt, shadowType = PENUMBRA) {
    const tri = this._varyingBuildTriangle(shadowType);
    return barycentric(new vec2(pt.x, pt.y), tri[0], tri[1], tri[2]);
  }

  _varyingBuildTriangle(shadowType = PENUMBRA) {
    const { wall, farPenumbraPoints } = this;
    const a = new vec2();
    const b = farPenumbraPoints[0][shadowType].xy;
    const c = farPenumbraPoints[1][shadowType].xy;
    lineLineIntersectionVector(b, wall.top[0].xy, c, wall.top[1].xy, a);
    return [a, b, c];
  }

  /**
   * Mimic the fragment calculation for a given point.
   * @param {Point} pt          Fragment location on the canvas
   * @param {float} elevation   Assumed elevation, in grid units
   * @returns {vec4} For testing only, returns fragColor.
   */
  fragmentCalculations(pt, elevation = 0) {
    const { side0Shadow, side1Shadow, farShadow, nearShadow, hasShadow } = this.shadowComponents(pt, elevation);

    let fragColor = this.noShadow();
    if ( !hasShadow ) return fragColor;
    const shadow = side0Shadow * side1Shadow * farShadow * nearShadow;
    const totalLight = Math.clamp(0.0, 1.0, 1.0 - shadow);

    fragColor = this.lightEncoding(totalLight);
    return fragColor;
  }

  /**
   * For debugging
   * Determine the shadow components.
   */
  shadowComponents(pt, elevation = 0) {
    const { uElevationRes } = this;
    elevation = CONFIG.GeometryLib.utils.gridUnitsToPixels(elevation);

    // Set the flat variables
    this.vertexCalculations(2);

    // Define the placement of the fragment and calculate varying variables.
    this.vVertexPosition = new vec2(pt.x, pt.y);
    this.setVaryings();
    const { vPenumbra, vSidePenumbra0, vSidePenumbra1 } = this;

    // GLSL only: let fragColor = this.noShadow();
    if ( this.thresholdApplies() ) return { hasShadow: false }; // GLSL only: return fragColor;
    if ( this.inFrontOfWall() ) return { hasShadow: false }; // GLSL only: return fragColor;

    // Get the elevation at this fragment.
    const canvasElevation = uElevationRes;

    // Determine the start and end of the shadow, relative to the light.
    const farRatios = this.elevateFarShadowRatios(elevation);
    const nearRatios = this.elevateNearShadowRatios(elevation);

    // If in front of the near shadow or behind the far shadow, then no shadow.
    if ( between(farRatios[PENUMBRA], nearRatios[PENUMBRA], vPenumbra.x) === 0.0 ) return { hasShadow: false }; // GLSL only: return fragColor;

    // Determine if the fragment is within one or more penumbra.
    const inSidePenumbra0 = barycentricPointInsideTriangle(vSidePenumbra0);
    const inSidePenumbra1 = barycentricPointInsideTriangle(vSidePenumbra1);
    const inFarPenumbra = this.inFarPenumbra(farRatios, nearRatios);
    const inNearPenumbra = this.inNearPenumbra(farRatios, nearRatios);
    const inFarMidPenumbra = this.inFarMidPenumbra(farRatios, nearRatios);
    const inNearMidPenumbra = this.inNearMidPenumbra(farRatios, nearRatios);

    // Blend the two side penumbras if overlapping by multiplying the light amounts.
    const side0Shadow = inSidePenumbra0 ? vSidePenumbra0.z / (vSidePenumbra0.y + vSidePenumbra0.z) : 1.0;
    const side1Shadow = inSidePenumbra1 ? vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z) : 1.0;

    // UMBRA is nearer to 1; PENUMBRA is nearer to 0.
    const farShadow = inFarPenumbra
      ? linearConversion(vPenumbra.x, farRatios[PENUMBRA], farRatios[MIDPENUMBRA], 0.0, 0.5)
      : inFarMidPenumbra ? linearConversion(vPenumbra.x, farRatios[MIDPENUMBRA], farRatios[UMBRA], 0.5, 1.0)
        : 1.0;

    // Near shadow is reversed, so UMBRA is nearer 0 and PENUMBRA is nearer to 1.
    const nearShadow = inNearPenumbra
      ? linearConversion(vPenumbra.x, nearRatios[PENUMBRA], nearRatios[MIDPENUMBRA], 0.0, 0.5)
      : inNearMidPenumbra ? linearConversion(vPenumbra.x, nearRatios[MIDPENUMBRA], nearRatios[UMBRA], 0.5, 1.0)
        : 1.0;

    return { side0Shadow, side1Shadow, farShadow, nearShadow, hasShadow: true };
  }

  /**
   * For debugging only.
   * Calculate whether fragment point is in certain areas.
   */
  testPoint(pt, elevation = 0) {
    const { uElevationRes } = this;
    elevation = CONFIG.GeometryLib.utils.gridUnitsToPixels(elevation);

    // Set the flat variables
    this.vertexCalculations(2);

    // Define the placement of the fragment and calculate varying variables.
    this.vVertexPosition = new vec2(pt.x, pt.y);
    this.setVaryings();
    const { vSidePenumbra0, vSidePenumbra1 } = this;

    // Determine the start and end of the shadow, relative to the light.
    const farRatios = this.elevateFarShadowRatios(elevation);
    const nearRatios = this.elevateNearShadowRatios(elevation);

    return {
      thresholdApplies: this.thresholdApplies(),
      inFrontOfWall: this.inFrontOfWall(),

      inPenumbra: this.inPenumbra(farRatios, nearRatios),
      inMidPenumbra: this.inMidPenumbra(farRatios, nearRatios),
      inUmbra: this.inUmbra(farRatios, nearRatios),

      inSidePenumbra0: barycentricPointInsideTriangle(vSidePenumbra0),
      inSidePenumbra1: barycentricPointInsideTriangle(vSidePenumbra1),
      inFarPenumbra: this.inFarPenumbra(farRatios, nearRatios),
      inNearPenumbra: this.inNearPenumbra(farRatios, nearRatios),
      inFarMidPenumbra: this.inFarMidPenumbra(farRatios, nearRatios),
      inNearMidPenumbra: this.inNearMidPenumbra(farRatios, nearRatios)
    };
  }

  // ----- NOTE: Drawing ----- //

  drawWall() { Draw.segment({ a: this.wall.top[0], b: this.wall.top[1] }); }

  drawLight() { Draw.point(this.light.center, { radius: this.light.size, color: Draw.COLORS.yellow }); }

  drawSidePenumbraDirections(dist = canvas.dimensions.maxR) {
    const { sidePenumbraDirs, wall } = this;
    const COLOR_KEYS = {
      umbra: Draw.COLORS.red,
      midpenumbra: Draw.COLORS.orange,
      penumbra: Draw.COLORS.yellow
    };
    for ( const [key, color] of Object.entries(COLOR_KEYS) ) {
      for ( let i = 0; i < 2; i += 1 ) {
        const endpoint = wall.top[i].xy;
        const penumbraPt = endpoint.add(sidePenumbraDirs[i][key].xy.normalize().multiplyScalar(dist));
        Draw.segment({ a: endpoint, b: penumbraPt }, { color });
      }
    }
  }

  drawAdjustedSidePenumbraDirections(dist = canvas.dimensions.maxR) {
    const { adjSidePenumbraDirs, wall } = this;
    const COLOR_KEYS = {
      umbra: Draw.COLORS.red,
      midpenumbra: Draw.COLORS.orange,
      penumbra: Draw.COLORS.yellow
    };
    for ( const [key, color] of Object.entries(COLOR_KEYS) ) {
      for ( let i = 0; i < 2; i += 1 ) {
        const endpoint = wall.top[i].xy;
        const penumbraPt = endpoint.add(adjSidePenumbraDirs[i][key].xy.normalize().multiplyScalar(dist));
        Draw.segment({ a: endpoint, b: penumbraPt }, { color });
      }
    }
  }

  drawTriangle(shadowType = PENUMBRA) {
    const COLOR_KEYS = {
      [UMBRA]: Draw.COLORS.red,
      [MIDPENUMBRA]: Draw.COLORS.orange,
      [PENUMBRA]: Draw.COLORS.yellow
    };

    const tri = this.buildTriangle(this.farPenumbraPoints, this.wall, shadowType);
    const poly = new PIXI.Polygon(...tri);
    Draw.shape(poly, { color: COLOR_KEYS[shadowType], width: 2 });
  }

  /**
   * Draw the near/far markers.
   */
  drawNear() { this._drawNearFar(false); }

  drawFar() { this._drawNearFar(true); }

  _drawNearFar(far = true) {
    const { wall } = this;
    const COLOR_KEYS = {
      umbra: Draw.COLORS.red,
      midpenumbra: Draw.COLORS.orange,
      penumbra: Draw.COLORS.yellow
    };
    const penumbraPoints = far ? this.farPenumbraPoints : this.nearPenumbraPoints;

    for ( const [key, color] of Object.entries(COLOR_KEYS) ) {
      for ( let i = 0; i < 2; i += 1 ) {
        const a = wall.top[i];
        const b = penumbraPoints[i][key];
        Draw.segment({ a, b }, { color });
        Draw.point(b, { color });
      }
    }
  }
}

/**
 * Based on SizedPointSourceShadowWallShader.
 * Represents a single wall calculation.
 * 3 vertices: light, ix for corner 1, ix for corner 2.
 * Wall shadow with side, near, and far penumbra
 */
export class SizedPointSourceShadowWallVertexShaderTest extends ShadowWallVertexShaderTest {

  /* ----- NOTE: Uniforms ----- */

  /** @type {vec3} */
  get uLightPosition() { return new vec3(...this.uniforms.uLightPosition); }

  /** @type {float} */
  get uLightSize() { return this.uniforms.uLightSize ?? 0; }

  /* ----- NOTE: Getters ----- */

  /** @type {LightGLSLStruct} */
  get light() { return this.calculateLightPositions(this.wall); }

  /** @type {ShadowDirections[2]} */
  get sidePenumbraDirs() {
    const { light, wall } = this;
    return [
      this.calculateSidePenumbraDirection(light, wall, 0),
      this.calculateSidePenumbraDirection(light, wall, 1)
    ];
  }

  /** @type {ShadowDirections[2]} */
  get farPenumbraDirs() {
    const { light, wall } = this;
    return [
      this.calculateNearFarPenumbraDirection(light, wall, true, 0),
      this.calculateNearFarPenumbraDirection(light, wall, true, 1)
    ];
  }

  /** @type {ShadowDirections[2]} */
  get nearPenumbraDirs() {
    const { light, wall } = this;
    return [
      this.calculateNearFarPenumbraDirection(light, wall, false, 0),
      this.calculateNearFarPenumbraDirection(light, wall, false, 1)
    ];
  }

  // ----- NOTE: UNIFORM variables ----- //

  static fromEdgeAndSource(edge, source) {
    const MAX_ELEV = 1e6;

    // TODO: Handle different a/b elevations.
    const { topZ, bottomZ } = edgeElevationZ(edge);
    const top = Math.min(MAX_ELEV, topZ);
    const bottom = Math.max(-MAX_ELEV, bottomZ);

    const { sceneRect, distancePixels } = canvas.dimensions;
    const ev = canvas.scene[MODULE_ID];
    const lightPosition = CONFIG.GeometryLib.threeD.Point3d.fromPointSource(source);

    const out = new this();
    out.config({
      attributes: {
        aWallCorner0: [edge.a.x, edge.a.y, top, -10.0],
        aWallCorner1: [edge.b.x, edge.b.y, bottom, -10.0],
        aWallSenseType: edge[source.constructor.sourceType],
        aThresholdRadius2: 0.0
      },
      uniforms: {
        uElevationRes: [ev.elevationMin, ev.elevationStep, ev.elevationMax, distancePixels],
        uLightPosition: [lightPosition.x, lightPosition.y, lightPosition.z],
        uLightSize: source.data.lightSize,
        uSceneDims: [sceneRect.x, sceneRect.y, sceneRect.width, sceneRect.height]
      }
    });
    return out;
  }

  calculateLightPositions(wall) {
    const { uLightSize, uLightPosition} = this;
    const dir = wall.direction.multiplyScalar(uLightSize);

    // Form a cross based on the light center.
    const lr0 = uLightPosition.xy.subtract(dir);
    const lr1 = uLightPosition.xy.add(dir);
    const top = uLightPosition.z + uLightSize;
    const bottom = uLightPosition.z - uLightSize;
    return new LightGLSLStruct({
      center: uLightPosition,
      lr0: new vec3(lr0.x, lr0.y, uLightPosition.z), // Closest to wall 0 endpoint.
      lr1: new vec3(lr1.x, lr1.y, uLightPosition.z), // Closest to wall 1 endpoint.
      top: new vec3(uLightPosition.x, uLightPosition.y, top),
      bottom: new vec3(uLightPosition.x, uLightPosition.y, bottom),
      size: uLightSize
    });
  }

  /* ----- NOTE: Penumbras ----- */

  /**
   * @param {Light} light
   * @param {Wall} wall
   * @param {int} idx     Which wall endpoint corresponds to this penumbra
   * @returns {ShadowDirectionsGLSLStruct} Direction from the endpoint away from the light for umbra, mid, and penumbra.
   */
  calculateSidePenumbraDirection(light, wall, idx) {
    const Ray2d = Ray2dGLSLStruct;

    const w = wall.top[idx]; // Wall endpoint from which a penumbra is cast.
    const umbraL = idx === 0 ? light.lr0 : light.lr1; // Outer light 0 --> to endpoint 0 is umbra
    const penumbraL = idx === 0 ? light.lr1 : light.lr0; // Inner light 1 --> to endpoint 0 is penumbra

    // Direction from light --> wall endpoint.
    return new ShadowDirectionsGLSLStruct({
      umbra: normalizedDirection(umbraL, w),
      midpenumbra: normalizedDirection(light.center, w),
      penumbra: normalizedDirection(penumbraL, w)
    });
  }

  /**
   * Calculate the umbra, mid, and penumbra direction near or far rays from a given wall endpoint.a
   * @param {Light} light
   * @param {Wall} wall
   * @param {bool} far
   * @param {int} idx
   * @returns {ShadowDirections}
   */
  calculateNearFarPenumbraDirection(light, wall, far, idx) {
    let w; // Wall endpoint from which a penumbra is cast.
    let umbraLight;
    let penumbraLight;
    if ( far ) {
      w = wall.top[idx];
      umbraLight = light.top;
      penumbraLight = light.bottom;
    } else {
      w = wall.bottom[idx];
      umbraLight = light.bottom;
      penumbraLight = light.top;
    }
    return new ShadowDirectionsGLSLStruct({
      umbra: normalizedDirection(umbraLight, w), // Umbra
      midpenumbra: normalizedDirection(light.center, w), // Mid
      penumbra: normalizedDirection(penumbraLight, w) // Penumbra
    });
  }

  /**
   * Mimic calculations done in the vertex shader.
   */
  vertexCalculations(gl_VertexID = 0) {
    const wall = this.wall;
    const light = this.light;
    const sidePenumbraDirs = this.sidePenumbraDirs;
    const farPenumbraDirs = this.farPenumbraDirs;
    const nearPenumbraDirs = this.nearPenumbraDirs;
    return super.vertexCalculations(gl_VertexID);
  }

  /**
   * Mimic the fragment calculations at a specific point.
   * @param {Point} pt
   */
  fragmentCalculations(pt) {
    return super.fragmentCalculations(pt);
  }

}

/**
 * Based on SizedPointSourceShadowWallShader.
 * Represents a single wall calculation.
 * 3 vertices: light, ix for corner 1, ix for corner 2.
 * Wall shadow with side, near, and far penumbra
 */
export class DirectionalSourceShadowWallVertexShaderTest extends ShadowWallVertexShaderTest {

  // ----- NOTE: UNIFORM variables ----- //

  static fromEdgeAndSource(edge, source) {
    const MAX_ELEV = 1e6;

    // TODO: Handle different a/b elevations.
    const { topZ, bottomZ } = edgeElevationZ(edge);
    const top = Math.min(MAX_ELEV, topZ);
    const bottom = Math.max(-MAX_ELEV, bottomZ);

    const { sceneRect, distancePixels } = canvas.dimensions;
    const ev = canvas.scene[MODULE_ID];
    const lightPosition = CONFIG.GeometryLib.threeD.Point3d.fromPointSource(source);

    const out = new this();
    out.config({
      attributes: {
        aWallCorner0: [edge.a.x, edge.a.y, top, -10.0],
        aWallCorner1: [edge.b.x, edge.b.y, bottom, -10.0],
        aWallSenseType: edge[source.constructor.sourceType],
        aThresholdRadius2: 0.0
      },
      uniforms: {
        uElevationRes: [ev.elevationMin, ev.elevationStep, ev.elevationMax, distancePixels],
        uSceneDims: [sceneRect.x, sceneRect.y, sceneRect.width, sceneRect.height],
        uLightPosition: [lightPosition.x, lightPosition.y, lightPosition.z],
        uAzimuth: source.data.azimuth,
        uElevationAngle: source.data.elevationAngle,
        uSolarAngle: source.data.solarAngle
      }
    });
    return out;
  }


  /* ----- NOTE: Uniforms ----- */

  /** @type {float<radians>} */
  get uAzimuth() { return this.uniforms.uAzimuth ?? 0; }

  /** @type {float<radians>} */
  get uSolarAngle() { return this.uniforms.uSolarAngle ?? 0; }

  // ----- NOTE: Getters ----- //

  /** @type {float} */
  // TODO: Cannot currently go all the way to 0.
  get solarAngle() { return Math.max(0.1, this.uSolarAngle); }

  /** @type {ShadowDirections[2]} */
  get sidePenumbraDirs() {
    const { wall } = this;
    return [
      this.calculateSidePenumbraDirection(wall, 0),
      this.calculateSidePenumbraDirection(wall, 1)
    ];
  }

  /** @type {ShadowDirections[2]} */
  get farPenumbraDirs() {
    const { sidePenumbraDirs } = this;
    return [
      this.calculateFarPenumbraDirection(sidePenumbraDirs[0].midpenumbra, 0),
      this.calculateFarPenumbraDirection(sidePenumbraDirs[1].midpenumbra, 1)
    ];
  }

  /** @type {ShadowDirections[2]} */
  get nearPenumbraDirs() {
    const { sidePenumbraDirs } = this;
    return [
      this.calculateNearPenumbraDirection(sidePenumbraDirs[0].midpenumbra, 0),
      this.calculateNearPenumbraDirection(sidePenumbraDirs[1].midpenumbra, 1)
    ];
  }

  /* ----- NOTE: Penumbras ----- */

  /**
   * The rays from the wall endpoint along the side.
   * @param {int} idx     Which wall endpoint corresponds to this penumbra
   * @returns {ShadowDirectionsGLSLStruct} Direction from the endpoint away from the light for umbra, mid, and penumbra.
   */
  calculateSidePenumbraDirection(wall, idx = 0) {
    const orient = foundry.utils.orient2dFast;
    const sign = Math.sign;
    const { uAzimuth, uElevationAngle } = this.uniforms;
    const { solarAngle } = this;

    // Direction from endpoint toward the light
    const lightDirection2d = fromAngle(new vec2(0.0), uAzimuth, 1.0).normalize();

    // Reverse for determining penumbra
    const dirMidPenumbra = lightDirection2d.multiplyScalar(-1.0);

    // Determine which side of the wall the light is on.
    const oWallLight = sign(orient(wall.top[0].xy, wall.top[1].xy, wall.top[0].xy.add(lightDirection2d)));

    // Adjust azimuth by the solarAngle.
    // Determine the direction of the outer penumbra rays from light --> wallCorner1 / wallCorner2.
    // The angle for the penumbra is the azimuth ± the solarAngle.
    const solarWallAngle = solarAngle * oWallLight;
    const multiplier = idx === 0 ? 1.0 : -1.0;
    const dirPenumbra = fromAngle(new vec2(0.0), uAzimuth + (solarWallAngle * multiplier), 1.0).multiplyScalar(-1.0);
    const dirUmbra = fromAngle(new vec2(0.0), uAzimuth - (solarWallAngle * multiplier), 1.0).multiplyScalar(-1.0);
    // const dirMidPenumbra = fromAngle(new vec2(0.0), uAzimuth, 1.0).multiplyScalar(-1.0);

    // Calculate the change in z for the light direction based on differing solar angles.
    const zFar = new Array(3);
    zFar[UMBRA] = this.zChangeForElevationAngle(uElevationAngle + solarAngle); // Light top
    zFar[MIDPENUMBRA] = this.zChangeForElevationAngle(uElevationAngle); // Light middle
    zFar[PENUMBRA] = this.zChangeForElevationAngle(uElevationAngle - solarAngle); // Light bottom

    // Normalize based on the mid penumbra for corner 0
    return new ShadowDirectionsGLSLStruct({
      umbra: (new vec3(dirUmbra, zFar[UMBRA])).normalize(),
      midpenumbra: (new vec3(dirMidPenumbra, zFar[MIDPENUMBRA])).normalize(),
      penumbra: (new vec3(dirPenumbra, zFar[PENUMBRA])).normalize()
    });
  }

  /**
   * The rays from the wall top endpoint away from the light.
   * @param {int} idx     The wall endpoint associated with this penumbra
   * @returns {ShadowDirectionsGLSLStruct}
   */
  calculateFarPenumbraDirection(dirMidSidePenumbra, idx = 0) {
    const zDelta = this._calculateZChangeRays();
    return new ShadowDirectionsGLSLStruct({
      umbra: new vec3(dirMidSidePenumbra.xy, zDelta[UMBRA]),
      midpenumbra: new vec3(dirMidSidePenumbra.xy, zDelta[MIDPENUMBRA]),
      penumbra: new vec3(dirMidSidePenumbra.xy, zDelta[PENUMBRA])
    });
  }

  /**
   * The rays from the wall bottom endpoint away from the light.
   * @param {int} idx     The wall endpoint associated with this penumbra
   * @returns {ShadowDirectionsGLSLStruct}
   */
  calculateNearPenumbraDirection(dirMidSidePenumbra, idx = 0) {
    const zDelta = this._calculateZChangeRays();
    return new ShadowDirectionsGLSLStruct({
      umbra: new vec3(dirMidSidePenumbra.x, dirMidSidePenumbra.y, zDelta[PENUMBRA]),
      midpenumbra: new vec3(dirMidSidePenumbra.x, dirMidSidePenumbra.y, zDelta[MIDPENUMBRA]),
      penumbra: new vec3(dirMidSidePenumbra.x, dirMidSidePenumbra.y, zDelta[UMBRA])
    });
  }

  /**
   * Determine the change in z for the directional rays.
   * @returns {float[3]}
   */
  _calculateZChangeRays() {
    const { uAzimuth, uElevationAngle } = this.uniforms;
    const { solarAngle } = this;

    // Calculate the change in z for the light direction based on differing solar angles.
    const zDelta = new Array(3);
    zDelta[UMBRA] = this.zChangeForElevationAngle(uElevationAngle + solarAngle); // Light top
    zDelta[MIDPENUMBRA] = this.zChangeForElevationAngle(uElevationAngle); // Light middle
    zDelta[PENUMBRA] = this.zChangeForElevationAngle(uElevationAngle - solarAngle); // Light bottom
    return zDelta;
  }

  /**
   * Amount of z (y) change for every change in x.
   * @param {float} elevationAngle
   * @returns {float}
   */
  zChangeForElevationAngle(elevationAngle) {
    const pt = fromAngle(new vec2(0.0), elevationAngle, 1.0);

    // How much z (y) change for every change in x?
    const z = pt.x === 0.0 ? 1e06 : pt.y / pt.x;
    return -z;
    // Don't let z go to 0?
    // return max(z, 1e-06);
  }

  /**
   * Mimic calculations done in the vertex shader.
   */
  vertexCalculations(gl_VertexID = 0) {
    const wall = this.wall;
    const sidePenumbraDirs = this.sidePenumbraDirs;
    const farPenumbraDirs = this.farPenumbraDirs;
    const nearPenumbraDirs = this.nearPenumbraDirs;
    return super.vertexCalculations(gl_VertexID);
  }

  /**
   * Mimic the fragment calculations at a specific point.
   * @param {Point} pt
   */
  fragmentCalculations(pt) {
    return super.fragmentCalculations(pt);
  }
}

/**
 * Return the top and bottom elevation for an edge.
 * @param {Edge} edge
 * @returns {object}
 *   - @prop {number} topE      Elevation in grid units
 *   - @prop {number} bottomE   Elevation in grid units
 */
function edgeElevationE(edge) {
  // TODO: Handle elevation for ramps where walls are not equal
  const { a, b } = edge.elevationLibGeometry;
  const topE = Math.max(
    a.top ?? Number.POSITIVE_INFINITY,
    b.top ?? Number.POSITIVE_INFINITY);
  const bottomE = Math.min(
    a.bottom ?? Number.NEGATIVE_INFINITY,
    b.bottom ?? Number.NEGATIVE_INFINITY);
  return { topE, bottomE };
}

/**
 * Return the top and bottom elevation for an edge.
 * @param {Edge} edge
 * @returns {object}
 *   - @prop {number} topZ      Elevation in base units
 *   - @prop {number} bottomZ   Elevation in base units
 */
function edgeElevationZ(edge) {
  const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
  const { topE, bottomE } = edgeElevationE(edge);
  return { topZ: gridUnitsToPixels(topE), bottomZ: gridUnitsToPixels(bottomE) };
}

/* Testing
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
let {
  SizedPointSourceShadowWallVertexShaderTest,
  DirectionalSourceShadowWallVertexShaderTest,
  vec2, vec3, vec4 } = api.testing

l = canvas.lighting.placeables[0];
edge0 = canvas.walls.placeables[0].edge
edge1 = canvas.walls.placeables[1].edge
ev = l.lightSource.elevatedvision
UMBRA = 0;
MIDPENUMBRA = 1;
PENUMBRA = 2;

// shader0 = SizedPointSourceShadowWallVertexShaderTest.fromEdgeAndSource(edge0, l.lightSource)
// shader1 = SizedPointSourceShadowWallVertexShaderTest.fromEdgeAndSource(edge1, l.lightSource)

let [shader0, shader1] = SizedPointSourceShadowWallVertexShaderTest.fromMesh(ev.shadowMesh)
let [shader2, shader3] = SizedPointSourceShadowWallVertexShaderTest.fromMesh(ev.shadowMesh)

let [shader0, shader1] = DirectionalSourceShadowWallVertexShaderTest.fromMesh(ev.shadowMesh)
let [shader2, shader3] = DirectionalSourceShadowWallVertexShaderTest.fromMesh(ev.shadowMesh)

// Set alt shaders to elevation 0 to compare with changing ratios
shader2.uniforms.uElevationRes[0] = 0
shader3.uniforms.uElevationRes[0] = 0

shader0.vertexCalculations(2)
shader0.drawTriangle(0)
shader0.drawTriangle(1)
shader0.drawTriangle(2)
shader0.drawFar()
shader0.drawNear()

shader2.vertexCalculations(2)
shader2.drawTriangle(0)
shader2.drawTriangle(1)
shader2.drawTriangle(2)
shader2.drawFar()
shader2.drawNear()

shader1.vertexCalculations(2)
shader1.drawTriangle(0)
shader1.drawTriangle(1)
shader1.drawTriangle(2)
shader1.drawFar()
shader1.drawNear()

shader3.vertexCalculations(2)
shader3.drawTriangle(0)
shader3.drawTriangle(1)
shader3.drawTriangle(2)
shader3.drawFar()
shader3.drawNear()

shader0.

// shader0 = SizedPointSourceShadowWallVertexShaderTest.fromShader(ev.shadowMesh.shader)
// [shader0, shader1] = SizedPointSourceShadowWallVertexShaderTest.fromMesh(ev.shadowMesh)


// Change to canvas surface elevation
shader0.uniforms.uElevationRes[0] = 0
shader1.uniforms.uElevationRes[0] = 0


canvas.stage.addChild(ev.shadowMesh)

// Calculate angle between the two edges.
// Angle first --> linked endpoint --> other, on side away from light
function linkedEndpoints(edge0, edge1) {
  return edge0.a.key === edge1.a.key ? [edge0.a, edge0.b, edge1.b]
    : edge0.a.key === edge1.b.key ? [edge0.a, edge0.b, edge1.a]
    : edge0.b.key === edge1.a.key ? [edge0.b, edge0.a, edge1.b]
    : edge0.a.key === edge0.b.key ? [edge0.a, edge0.b, edge1.a]
    : null;
}


function angleBetweenLinkedEdges(edge0, edge1, lightPosition) {
  const [linkedEndpoint, unlinked0, unlinked1] = linkedEndpoints(edge0, edge1);
  let angle = PIXI.Point.angleBetween(unlinked0, linkedEndpoint, unlinked1, { clockwiseAngle: true });

  const orient = foundry.utils.orient2dFast;
  if ( orient(unlinked0, linkedEndpoint, lightPosition) < 0 ) angle = (Math.PI * 2) - angle;
  return angle;
}

function drawPenumbraDirection(wall, penumbraDirs) {
  const dist = canvas.dimensions.maxR;
  const p0 = wall.top[0].add(penumbraDirs[0].multiplyScalar(dist));
  const p1 = wall.top[1].add(penumbraDirs[1].multiplyScalar(dist));
  Draw.segment({ a: wall.top[0], b: p0 });
  Draw.segment({ a: wall.top[1], b: p1 }, { color: Draw.COLORS.lightblue });
}

edge0 = canvas.walls.controlled[0].edge
edge1 = canvas.walls.controlled[1].edge
let [linkedEndpoint, unlinked0, unlinked1] = linkedEndpoints(edge0, edge1)

Math.toDegrees(angleBetweenLinkedEdges(edge0, edge1, l.lightSource.data))
angle = angleBetweenLinkedEdges(edge0, edge1, l.lightSource.data)


// Angle of the linked wall, measured from the shared endpoint.
function linkedAngle(edge0, edge1, endpoint = "a") {
  const res = linkedSegment(edge0, edge1, endpoint);
  if ( !res ) return -10;

  // Same as Ray.angle
  return Math.atan2(res.b.y - res.a.y, res.b.x - res.a.x);
}

// Arrange edge1 so that a is the linked endpoint.
function linkedSegment(edge0, edge1, endpoint = "a") {
  const sharedKey = edge0[endpoint].key
  return sharedKey === edge1.a.key ? edge1
    : sharedKey === edge1.b.key ? { a: edge1.b, b: edge1.a }
    : null
}

// Correct the linked edges
shader0.attributes.aWallCorner0.w = linkedAngle(edge0, edge1, "a")
shader0.attributes.aWallCorner1.w = linkedAngle(edge0, edge1, "b")
shader1.attributes.aWallCorner0.w = linkedAngle(edge1, edge0, "a")
shader1.attributes.aWallCorner1.w = linkedAngle(edge1, edge0, "b")


shader0.drawPenumbra()
shader1.drawPenumbra()

shader0.drawSidePenumbra()
shader1.drawSidePenumbra()

shader0.drawTriangle()
shader1.drawTriangle()

shader0.calculatePenumbraBaryCoords()
shader1.calculatePenumbraBaryCoords()

shader0.calculateFlatVariables()
shader1.calculateFlatVariables()

shader0.calculateElevatedShadowRatios()
shader0.calculateElevatedShadowRatios({ elevationE: 0 })

shader0.nearFarCoordinates()
shader0.nearFarCoordinates({ elevationE: 0 })

shader0.drawFar()
shader0.drawFar({ elevationE: 0 })

shader1.drawFar()
shader1.drawFar({ elevationE: 0 })

shader0.drawNear({ elevationE: 0 })
shader1.drawNear({ elevationE: 0 })

*/

/* Calculate penumbra endpoint based on elevation

ixBase = new vec3()
ix500 = new vec3()
ix0 = new vec3()
shader0._penumbraCanvasIntersection(ixBase, PENUMBRA, true, 0, shader0.canvasElevation)
shader0._penumbraCanvasIntersection(ix500, PENUMBRA, true, 0, -500)
shader0._penumbraCanvasIntersection(ix0, PENUMBRA, true, 0, 0)

-1000: { x: 5100, y: 952 }    dist: 2342
-500:  { x: 4350, y: 1322 }   dist: 1506
0:     { x: 3600, y: 1692 }   dist: 669

Full distance = 2342, for -1000 to 400

UMBRA = 0;
MIDPENUMBRA = 1;
PENUMBRA = 2;

wallEndpoint = PIXI.Point.fromObject(shader0.wall.top[0])
penumbraEndpoint = PIXI.Point.fromObject(shader0.farPenumbraPoints[0][PENUMBRA])
otherWallEndpoint = PIXI.Point.fromObject(shader0.wall.top[1])
otherPenumbraEndpoint = PIXI.Point.fromObject(shader0.farPenumbraPoints[1][PENUMBRA])
lightIx = PIXI.Point.fromObject(
  foundry.utils.lineLineIntersection(wallEndpoint, penumbraEndpoint, otherWallEndpoint, otherPenumbraEndpoint))
elevChange = 0 - shader0.canvasElevation
wallHeight = shader0.wall.top[0].z - shader0.canvasElevation
ratio = 0
wallRatio = PIXI.Point.distanceBetween(penumbraEndpoint, wallEndpoint)
  / PIXI.Point.distanceBetween(penumbraEndpoint, lightIx)
ratioDist = wallRatio - ratio
heightFraction = elevChange / wallHeight;
newRatio = ratio + (heightFraction * ratioDist);
newIx = penumbraEndpoint.projectToward(lightIx, newRatio)


// Using only the outer penumbra, can we still determine a ratio that applies to inner?
ixBase = new vec3()
ix500 = new vec3()
ix0 = new vec3()
shader0._penumbraCanvasIntersection(ixBase, UMBRA, true, 0, shader0.canvasElevation)
shader0._penumbraCanvasIntersection(ix500, UMBRA, true, 0, -500)
shader0._penumbraCanvasIntersection(ix0, UMBRA, true, 0, 0)

elevationZ = 0;
wallEndpoint = PIXI.Point.fromObject(shader0.wall.top[0])
penumbraEndpoint = PIXI.Point.fromObject(shader0.farPenumbraPoints[0][PENUMBRA])
otherWallEndpoint = PIXI.Point.fromObject(shader0.wall.top[1])
otherPenumbraEndpoint = PIXI.Point.fromObject(shader0.farPenumbraPoints[1][PENUMBRA])
lightIx = PIXI.Point.fromObject(
  foundry.utils.lineLineIntersection(wallEndpoint, penumbraEndpoint, otherWallEndpoint, otherPenumbraEndpoint))
elevChange = elevationZ - shader0.canvasElevation
wallHeight = shader0.wall.top[0].z - shader0.canvasElevation
wallRatio = PIXI.Point.distanceBetween(penumbraEndpoint, wallEndpoint)
  / PIXI.Point.distanceBetween(penumbraEndpoint, lightIx)
ratioDist = wallRatio
heightFraction = elevChange / wallHeight;
newRatio = heightFraction * wallRatio;

umbraEndpoint =  PIXI.Point.fromObject(shader0.farPenumbraPoints[0][UMBRA])
otherUmbraEndpoint = PIXI.Point.fromObject(shader0.farPenumbraPoints[1][UMBRA])
umbraLightIx = PIXI.Point.fromObject(
  foundry.utils.lineLineIntersection(wallEndpoint, umbraEndpoint, otherWallEndpoint, otherUmbraEndpoint))
newIx = umbraEndpoint.projectToward(umbraLightIx, newRatio)

*/


/* Fragment variables
vec2 vVertexPosition => from 3 vertices
vec3 vBary => from 3 vertices
vec2 vTerrainTexCoord
vec3 vSidePenumbra0
vec3 vSidePenumbra1

float fWallRatio
float fWallSenseType
float fThresholdRadius2
vec3 fNearRatios
vec3 fFarRatios
vec2 fWallHeights
vec2 fWallCornerLinked?

uLightPosition
uElevationRes
uTerrainSampler

barycentric:
vec3 vPenumbra
vec3 vSidePenumbra0
vec3 vSidePenumbra1

interpolated:
vec2 vVertexPosition

flats:
vec2 fWallRatio — for elevation
vec2 fFarRatios -- technically a vec2 b/c penumbra is 0.0
vec3 fNearRatios
float fWallSenseType
float fThresholdRadius2

Currently, per vertex:
float aThresholdRadius2
vec4 aWallCorner0
vec4 aWallCorner1
float aWallSenseType
10 total floats.

Could do per vertex:
bary coords:
// vPenumbra based on vertexNum
float vSidePenumbra0 (baryForPoint)
float vSidePenumbra1 (baryForPoint)

if useful:
float vMidPenumbra
float vUmbra

Other:
vec2 vVertexPosition

Flats:
vec2 fWallRatio
vec2 fFarRatios
vec3 fNearRatios
float fWallSenseType
float fThresholdRadius2
Likely 13–15 total floats
Need to cut back on flats.

Alt:
float vSidePenumbra0 (baryForPoint)
float vSidePenumbra1 (baryForPoint)
float vMidPenumbra
float vUmbra
vec2 vVertexPosition
float vWall
float vNearMidPenumbra
float vNearPenumbra

Flats:
float fWallSenseType
float fThresholdRadius2

11 total. So only 1 more but a lot less webGPU calcs.


*/

