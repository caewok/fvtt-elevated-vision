/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
"use strict";

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

  const denomInv = 1.0 / ((d00 * d11) - (d01 * d01)); // Fixed for given triangle
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

  static calculateLightPositions(wall, { uLightSize, uLightPosition} = {}) {
    const dir = wall.direction.multiplyScalar(uLightSize);

    // Form a cross based on the light center.
    const lr0 = uLightPosition.xy.subtract(dir);
    const lr1 = uLightPosition.xy.add(dir);
    const top = uLightPosition.z + uLightSize;
    const bottom = uLightPosition.z - uLightSize;
    return new this({
      center: uLightPosition,
      lr0: new vec3(lr0.x, lr0.y, uLightPosition.z), // Closest to wall 0 endpoint.
      lr1: new vec3(lr1.x, lr1.y, uLightPosition.z), // Closest to wall 1 endpoint.
      top: new vec3(uLightPosition.x, uLightPosition.y, top),
      bottom: new vec3(uLightPosition.x, uLightPosition.y, bottom),
      size: uLightSize
    });
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

  static calculateWallPositions({ aWallCorner0, aWallCorner1, aWallSenseType, aThresholdRadius2 } = {}) {
    const aTop = new vec3(aWallCorner0.x, aWallCorner0.y, aWallCorner0.z);
    const bTop = new vec3(aWallCorner1.x, aWallCorner1.y, aWallCorner0.z);
    const aBottom = new vec3(aWallCorner0.x, aWallCorner0.y, aWallCorner1.z);
    const bBottom = new vec3(aWallCorner1.x, aWallCorner1.y, aWallCorner1.z);
    return new this({
      top: [aTop, bTop],
      bottom: [aBottom, bBottom],
      direction: normalizedDirection(aWallCorner0.xy, aWallCorner1.xy), // Moving from 0 --> 1.
      linkValue: [aWallCorner0.w, aWallCorner1.w],
      type: aWallSenseType,
      thresholdRadius2: aThresholdRadius2
    });
  }
}

const UMBRA = 0;
const MIDPENUMBRA = 1;
const PENUMBRA = 2;


/**
 * Based on SizedPointSourceShadowWallShader.
 * Represents a single wall calculation.
 * 3 vertices: light, ix for corner 1, ix for corner 2.
 * Wall shadow with side, near, and far penumbra
 */
export class SizedPointSourceShadowWallVertexShaderTest {

  static EV_ENDPOINT_LINKED_UNBLOCKED = -10.0;

  // From CONST.WALL_SENSE_TYPES
  static LIMITED_WALL = 10.0;

  static PROXIMATE_WALL = 30.0;

  static DISTANCE_WALL = 40.0;

  // ----- NOTE: IN variables ----- //
  _inVars = {
    /** @type {in vec4} */
    aWallCorner0: new vec4(),

    /** @type {in vec4} */
    aWallCorner1: new vec4(),

    /** @type {in float} */
    aWallSenseType: 0,

    /** @type {in float} */
    aThresholdRadius2: 0
  };

  // ----- NOTE: UNIFORM variables ----- //

  _uniforms = {
    /** @type {uniform vec4} */
    uElevationRes: new vec4(),

    /** @type {uniform vec3} */
    uLightPosition: new vec3(),

    /** @type {uniform float} */
    uLightSize: 0,

    /** @type {uniform vec4} */
    uSceneDims: new vec4()
  };

  config({ inVars = {}, uniforms = {} } = {}) {
    const iV = this._inVars;
    const uV = this._uniforms;
    for ( const [key, value] of Object.entries(inVars) ) {
      switch ( key ) {
        case "aWallSenseType": iV[key] = value; break;
        case "aThresholdRadius2": iV[key] = value; break;
        default: iV[key]?.set(value, 0);
      }
    }
    for ( const [key, value] of Object.entries(uniforms) ) {
      switch ( key ) {
        case "uLightSize": uV[key] = value; break;
        default: uV[key]?.set(value, 0);
      }
    }
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
      const inVars = {};
      for ( const [key, attribute] of Object.entries(geometry.attributes) ) {
        const { buffer, size } = attribute;
        switch ( size ) {
          case 1: inVars[key] = buffers[buffer].data[idx]; break;
          default: inVars[key] = buffers[buffer].data.slice(idx * size, (idx * size) + size);
        }
      }
      instance.config({ inVars });
    }
    return out;
  }

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
      inVars: {
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


  /* ----- NOTE: Defined terms ---- */

  /** @type {float} */
  get canvasElevation() { return this._uniforms.uElevationRes.x; }

  /** @type {float} */
  get maxR() {
    const uSceneDims = this._uniforms.uSceneDims;
    return Math.sqrt((uSceneDims.z * uSceneDims.z) + (uSceneDims.w * uSceneDims.w)) * 2.0;
  }

  /** @type {Plane} */
  get canvasPlane() {
    const planeNormal = new vec3(0.0, 0.0, 1.0);
    const planePoint = new vec3(0.0, 0.0, this.canvasElevation);
    return new PlaneGLSLStruct(planePoint, planeNormal);
  }

  /** @type {WallGLSLStruct} */
  get wall() {
    return WallGLSLStruct.calculateWallPositions(this._inVars);
  }

  /** @type {LightGLSLStruct} */
  get light() {
    return LightGLSLStruct.calculateLightPositions(this.wall, this._uniforms);
  }

  /** @type {vec3[2][3]} */
  get sidePenumbraDirs() {
    return [
      this.calculateSidePenumbraDirection(0),
      this.calculateSidePenumbraDirection(1)
    ];
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

  /** @type {vec3[2][3]} */
  get farPenumbraPoints() {
    return [
      this.penumbraEndpoints(true, 0),
      this.penumbraEndpoints(true, 1)
    ];
  }

  /** @type {vec3[2][3]} */
  get nearPenumbraPoints() {
    return [
      this.penumbraEndpoints(false, 0),
      this.penumbraEndpoints(false, 1)
    ];
  }

  /** @type {float[3]} */
  get wallRatios() {
    const arr = new Array(3);
    const { fWallRatio } = this.calculateFlatVariables();
    arr[UMBRA] = fWallRatio.x;
    arr[MIDPENUMBRA] = fWallRatio.x;
    arr[PENUMBRA] = fWallRatio.x;
    return arr;
  }

  /** @type {vec2[2]} */
  get wallHeights() {
    const { fWallHeights } = this.calculateFlatVariables();
    return new vec2(
      Math.max(fWallHeights.x - this.canvasElevation, 0.0),
      Math.max(fWallHeights.y - this.canvasElevation, 0.0),
    );
  }

  /* ----- NOTE: Penumbras ----- */

  /**
   * @param {int} idx     Which wall endpoint corresponds to this penumbra
   * @returns {vec3[3]} Direction from the endpoint away from the light for umbra, mid, and penumbra.
   */
  calculateSidePenumbraDirection(idx = 0) {
    const { light, wall } = this;
    const Ray2d = Ray2dGLSLStruct;

    const w = wall.top[idx]; // Wall endpoint from which a penumbra is cast.
    const umbraL = idx === 0 ? light.lr0 : light.lr1; // Outer light 0 --> to endpoint 0 is umbra
    const penumbraL = idx === 0 ? light.lr1 : light.lr0; // Inner light 1 --> to endpoint 0 is penumbra

    // Direction from light --> wall endpoint.
    const penObj = Array(3);
    penObj[UMBRA] = normalizedDirection(umbraL, w);
    penObj[MIDPENUMBRA] = normalizedDirection(light.center, w);
    penObj[PENUMBRA] = normalizedDirection(penumbraL, w);

    // If no linked wall, full penumbra is used.
    const linkAngle = wall.linkValue[idx];
    if ( linkAngle === this.constructor.EV_ENDPOINT_LINKED_UNBLOCKED ) return penObj;

    // Determine orientation relative to the mid-penumbra.
    // 4 quadrants:
    // 1 & 2: linked wall is on opposite side from wall, so it blocks.
    // 3 & 4: linked wall is on same side as light:
    // - 3: Linked wall not between wall and mid: no block (tight "V")
    // - 4: Linked wall between wall and mid
    //     • If umbra - linked - mid-penumbra, adjust umbra direction.
    //     • If umbra - mid - linked - penumbra, umbra set to mid.

    // Point positions.
    const linkPt = fromAngle(w.xy, linkAngle, 1);
    const midR = new Ray2d(w.xy, penObj[MIDPENUMBRA].xy);
    const midPt = midR.project(1);

    // Orientation re mid.
    const other = (wall.top[1 - idx]).xy;
    const orient = foundry.utils.orient2dFast;
    const oMidLink = orient(w.xy, midPt, linkPt);
    const oMidWall = orient(w.xy, midPt, other);

    // 1 & 2: linked wall blocks light.
    const linkOppositeWall = oMidWall * oMidLink <= 0;
    if ( linkOppositeWall ) {
      penObj[UMBRA].x = penObj[MIDPENUMBRA].x;
      penObj[UMBRA].y = penObj[MIDPENUMBRA].y;
      penObj[UMBRA].z = penObj[MIDPENUMBRA].z;

      penObj[PENUMBRA].x = penObj[MIDPENUMBRA].x;
      penObj[PENUMBRA].y = penObj[MIDPENUMBRA].y;
      penObj[PENUMBRA].z = penObj[MIDPENUMBRA].z;
      return penObj;
    }

    // 3 & 4: Linked wall between wall and mid
    const oLinkWall = orient(w.xy, linkPt, other);
    const oLinkMid = orient(w.xy, linkPt, midPt);
    const linkBetweenWallAndMid = oLinkWall * oLinkMid < 0;

    // 3: Linked wall in quadrant with light, not blocking.
    if ( !linkBetweenWallAndMid ) return penObj;

    // 4. possible block.
    // What side of umbra is the linked wall on? If not on the mid-side, it doesn't block.
    const umbraR = new Ray2dGLSLStruct(w.xy, penObj[UMBRA].xy);
    const umbraPt = umbraR.project(1);
    const oUmbraLink = orient(w.xy, umbraPt, linkPt);
    const oUmbraMid = orient(w.xy, umbraPt, midPt);
    const linkAfterUmbra = oUmbraLink * oUmbraMid > 0;
    if ( !linkAfterUmbra ) return penObj;

    // Linked wall is after umbra, moving toward mid.
    const oMidUmbra = orient(w.xy, midPt, umbraPt);

    // Set umbra to the link direction.
    // TODO: This results in a non-normalized direction. Is there a way to get the normalized direction?
    // - normalizing again could change x/y, so cannot do that ?
    const linkDir = normalizedDirection(w.xy, linkPt);
    penObj[UMBRA].x = linkDir.x;
    penObj[UMBRA].y = linkDir.y;
    if ( oMidUmbra * oMidLink > 0 ) return penObj;

    // Linked wall is after mid; adjust mid as well.
    penObj[MIDPENUMBRA].x = linkDir.x;
    penObj[MIDPENUMBRA].y = linkDir.y;
    return penObj;
  }

  /**
   * @param {int} idx     The wall endpoint associated with this penumbra
   * @returns {vec3[3]}
   */
  calculateFarPenumbraDirection(idx = 0) {
    return this._calculateNearFarPenumbraDirection(true, idx);
  }

  /**
   * @param {int} idx     The wall endpoint associated with this penumbra
   * @returns {vec3[3]}
   */
  calculateNearPenumbraDirection(idx = 0) {
    return this._calculateNearFarPenumbraDirection(false, idx);
  }

  /**
   * @param {bool} far    Far if true, near if false
   * @param {int} idx     The wall endpoint associated with this penumbra
   * @returns {vec3[3]}
   */
  _calculateNearFarPenumbraDirection(far = true, idx = 0) {
    const { wall, light } = this;
    const w = far ? wall.top[idx] : wall.bottom[idx]; // Wall endpoint from which a penumbra is cast.
    const dirs = new Array(3);
    dirs[UMBRA] = normalizedDirection(light.top, w);
    dirs[MIDPENUMBRA] = normalizedDirection(light.center, w);
    dirs[PENUMBRA] = normalizedDirection(light.bottom, w);
    return dirs;
  }

  /**
   * Determine the point where the near/far penumbra intersects the side penumbra, if any
   * @param {vec2} ix                 Placeholder to store the intersection point.
   * @param {UMBRA|MIDPENUMBRA|PENUMBRA} shadowType
   * @param {bool} far                Far if true, near if false
   * @param {int} idx                 The wall endpoint associated with this penumbra
   * @returns {bool}
   */
  _penumbraCanvasIntersection(ix, shadowType = PENUMBRA, far = true, idx = 0, canvasElevation = this.canvasElevation) {
    // For testing.
    const planeNormal = new vec3(0.0, 0.0, 1.0);
    const planePoint = new vec3(0.0, 0.0, canvasElevation);
    const canvasPlane = new PlaneGLSLStruct(planePoint, planeNormal);

    const { wall, sidePenumbraDirs } = this;
    const Ray2d = Ray2dGLSLStruct;
    const Ray = RayGLSLStruct;
    const nfDirs = far ? this.farPenumbraDirs : this.nearPenumbraDirs;
    const wallEndpoint = wall.top[idx];
    const canvasIx = new vec3();
    const infiniteShadow = nfDirs[idx][shadowType].z >= 0.0;
    if ( infiniteShadow
      || !intersectRayPlane(new Ray(wallEndpoint, nfDirs[idx][shadowType]), canvasPlane, canvasIx)) return false;

    // Draw a line parallel to the wall that goes through the intersection point.
    // The intersection of that with the side penumbra defines the point.
    const farParallelRay = new Ray2d(canvasIx.xy, wall.direction);
    const sideDir = sidePenumbraDirs[idx][shadowType];
    if ( !lineLineIntersectionRay(farParallelRay, new Ray2d(wallEndpoint.xy, sideDir.xy), ix) ) return false;
    return true;
  }

  /**
   * Get either the point where the penumbra direction intersects the canvas or the point
   * at maximum canvas distance, as measured from wall endpoint 0.
   * @param {UMBRA|MIDPENUMBRA|PENUMBRA} shadowType
   * @param {bool} far                Far if true, near if false
   * @param {int} idx                 The wall endpoint associated with this penumbra
   */
  penumbraEndpoint(shadowType = PENUMBRA, far = true, idx = 0) {
    const { wall, sidePenumbraDirs, maxR } = this;
    const Ray2d = Ray2dGLSLStruct;
    const canvasIx = new vec3();
    if ( !this._penumbraCanvasIntersection(canvasIx, shadowType, far, idx) ) {
      // Use max distance from wall endpoint 0 to fake infinite shadow.
      const wallEndpoint = wall.top[idx];
      const dirRay = new Ray2d(wallEndpoint.xy, sidePenumbraDirs[idx][shadowType].xy.normalize());
      return dirRay.project(maxR);
    }
    return canvasIx;
  }

  /**
   * Get all shadow-canvas intersections for a given wall endpoint.
   * @param {bool} far                Far if true, near if false
   * @param {int} idx                 The wall endpoint associated with this penumbra
   * @returns {vec3[3]}
   */
  penumbraEndpoints(far = true, idx = 0) {
    const arr = new Array(3);
    arr[UMBRA] = this.penumbraEndpoint(UMBRA, far, idx);
    arr[MIDPENUMBRA] = this.penumbraEndpoint(MIDPENUMBRA, far, idx);
    arr[PENUMBRA] = this.penumbraEndpoint(PENUMBRA, far, idx);
    return arr;
  }

  /**
   * Get the intersections of the side shadows that form the V near the light.
   * @returns {vec3[3]}
   */
  penumbraIntersections() {
    const Ray2d = Ray2dGLSLStruct;
    const { wall, sidePenumbraDirs } = this;

    const rays = new Array(2);
    rays[0] = new Array(3);
    rays[1] = new Array(3);
    rays[0][UMBRA] = new Ray2d(wall.top[0].xy, sidePenumbraDirs[0][UMBRA].xy);
    rays[1][UMBRA] = new Ray2d(wall.top[1].xy, sidePenumbraDirs[1][UMBRA].xy);
    rays[0][MIDPENUMBRA] = new Ray2d(wall.top[0].xy, sidePenumbraDirs[0][MIDPENUMBRA].xy);
    rays[1][MIDPENUMBRA] = new Ray2d(wall.top[1].xy, sidePenumbraDirs[1][MIDPENUMBRA].xy);
    rays[0][PENUMBRA] = new Ray2d(wall.top[0].xy, sidePenumbraDirs[0][PENUMBRA].xy);
    rays[1][PENUMBRA] = new Ray2d(wall.top[1].xy, sidePenumbraDirs[1][PENUMBRA].xy);

    const arr = new Array(3);
    arr[UMBRA] = new vec3();
    arr[MIDPENUMBRA] = new vec3();
    arr[PENUMBRA] = new vec3();

    lineLineIntersectionRay(rays[0][UMBRA], rays[1][UMBRA], arr[UMBRA]);
    lineLineIntersectionRay(rays[0][MIDPENUMBRA], rays[1][MIDPENUMBRA], arr[MIDPENUMBRA]);
    lineLineIntersectionRay(rays[0][PENUMBRA], rays[1][PENUMBRA], arr[PENUMBRA]);

    return arr;
  }

  /* ----- NOTE: Vertex shader calculations ----- */

  /**
   * Build the triangle to represent this light's shadow vis-a-vis the wall.
   * @param {UMBRA|MIDPENUMBRA|PENUMBRA} shadowType
   * @returns {vec3[3]}
   */
  buildTriangle(shadowType = PENUMBRA) {
    const { wall, farPenumbraPoints } = this;

    // Construct a new light position based on the xy intersection of the penumbra points --> wall corner
    const a = new vec2(); // Will be the new light center.
    const b = farPenumbraPoints[0][shadowType].xy;
    const c = farPenumbraPoints[1][shadowType].xy;
    lineLineIntersectionVector(b, wall.top[0].xy, c, wall.top[1].xy, a);
    return [a, b, c];
  }

  /**
   * Barycentric coordinates for a given vertex and shadow type.
   * For the penumbra, this is set to 1.0 at the vertex number.
   * @param {UMBRA|MIDPENUMBRA|PENUMBRA} shadowType
   * @param {int} vertexNum
   * @returns {vec3}
   */
  calculateBaryCoords(shadowType = PENUMBRA, vertexNum = 0) {
    const outerTri = this.buildTriangle(PENUMBRA);
    const vVertexPosition = outerTri[vertexNum];
    const tri = this.buildTriangle(shadowType);
    return barycentric(vVertexPosition, tri[0], tri[1], tri[2]);
  }

  /**
   * Barycentric coordinates of the side penumbra for a given vertex.
   * @param {int} vertexNum
   * @returns {vec3[2]}
   */
  calculateSidePenumbraBaryCoords(vertexNum = 0) {
    const penumbraTri = this.buildTriangle(PENUMBRA);
    const vVertexPosition = penumbraTri[vertexNum];
    return this._vSidePenumbrasBaryCoords(vVertexPosition);
  }

  _vSidePenumbrasBaryCoords(pt) {
    const endpoints = this.wall.top;
    const penumbraTri = this.buildTriangle(PENUMBRA);
    const umbraTri = this.buildTriangle(UMBRA);
    const vSidePenumbras = new Array(2);
    for ( let i = 0; i < 2; i += 1 ) {
      const a = endpoints[i].xy;
      const b = penumbraTri[i + 1]; // Add 1 b/c 0 is the light center
      const c = umbraTri[i + 1];
      vSidePenumbras[i] = barycentric(pt, a, b, c);
    }
    return vSidePenumbras;
  }

  /**
   * Distance between a defined furthest point and the intersection of a ray with the plane.
   * @param {vec3} wallEndpoint
   * @param {vec3} dir
   * @param {vec2} furthestPoint
   * @param {PlaneGLSLStruct} canvasPlane
   * @param {float} maxDist
   * @returns {float}
   */
  _calculateRatio(wallEndpoint, dir, furthestPoint, canvasPlane, maxDist) {
    if ( dir.z >= 0.0 ) return 0.0;
    const ix = new vec3();
    intersectRayPlane(new RayGLSLStruct(wallEndpoint, dir), canvasPlane, ix);

    // If the intersection lies beyond the furthestPoint, that likely means maxR was exceeded.
    // 2d b/c maxDist is the x/y distance from wall endpoint to the furthest point.
    if ( maxDist < ix.xy.distance(wallEndpoint.xy) ) return 0.0;

    return furthestPoint.distance(ix.xy);
  }

  /**
   * Calculate the flat variables, including near/far ratios.
   */
  calculateFlatVariables() {
    const { wall, farPenumbraPoints, nearPenumbraPoints } = this;
    const wTop = wall.top[0];
    const wBottom = wall.bottom[0];

    const fWallCornerLinked = new vec2(wall.linkValue[0], wall.linkValue[1]);
    const fWallHeights = new vec2(wTop.z, wBottom.z);
    const fWallSenseType = wall.type;
    const fThresholdRadius2 = wall.thresholdRadius2;

    // Location of the wall along the x axis of the barycentric penumbra triangle.
    const fWallRatio = this.baryForPoint(wTop, PENUMBRA).x;

    // Location of the near shadow along the x axis of the barycentric penumbra triangle.
    // Stored as vec3: UMBRA (x), MID (y), PENUMBRA (z)
    const nearPts = nearPenumbraPoints[0];
    const fNearRatios = new vec3(
      this.baryForPoint(nearPts[UMBRA], PENUMBRA).x,
      this.baryForPoint(nearPts[MIDPENUMBRA], PENUMBRA).x,
      this.baryForPoint(nearPts[PENUMBRA], PENUMBRA).x
    );

    // Location of the far shadow along the x axis of the barycentric penumbra triangle.
    const farPts = farPenumbraPoints[0];
    const fFarRatios = new vec3(
      this.baryForPoint(farPts[UMBRA], PENUMBRA).x,
      this.baryForPoint(farPts[MIDPENUMBRA], PENUMBRA).x,
      this.baryForPoint(farPts[PENUMBRA], PENUMBRA).x
    );

    return { fWallCornerLinked, fWallHeights, fWallSenseType, fThresholdRadius2,
      fWallRatio, fNearRatios, fFarRatios };
  }

  // ----- NOTE: Fragment shader testing ----- //

  /**
   * Value of varyings at a given point.
   * @param {Point} pt
   * @returns {object} Object with varying variables:
   *    - vPenumbra (formerly vBary)
   *    - vMidPenumbra
   *    - vUmbra
   *    - vSidePenumbra0
   *    - vSidePenumbra1
   */
  calculateVaryings(pt) {
    const vPenumbra = this.baryForPoint(pt, PENUMBRA);
    const vMidPenumbra = this.baryForPoint(pt, MIDPENUMBRA);
    const vUmbra = this.baryForPoint(pt, UMBRA);
    const [vSidePenumbra0, vSidePenumbra1] = this._vSidePenumbrasBaryCoords(pt);
    return { vPenumbra, vMidPenumbra, vUmbra, vSidePenumbra0, vSidePenumbra1 };
  }


  /**
   * Get the barycentric position for a given 2d canvas point.
   * Used to mimic the vBary coordinates in the fragment shader.
   * @param {Point} pt
   * @returns {vec3}
   */
  baryForPoint(pt, shadowType = PENUMBRA) {
    const tri = this.buildTriangle(shadowType);
    return barycentric(new vec2(pt.x, pt.y), tri[0], tri[1], tri[2]);
  }

  /**
   * Determine if a threshold applies to this point.
   * @param {Point} pt
   */
  thresholdApplies(pt) {
    const { fWallSenseType, fThresholdRadius2 } = this.calculateFlatVariables();
    const { uLightPosition } = this._uniforms;
    pt = new vec2(pt.x, pt.y);
    return (fWallSenseType === this.constructor.DISTANCE_WALL
         || fWallSenseType === this.constructor.PROXIMATE_WALL)
      && fThresholdRadius2 !== 0.0
      && pt.distanceSquared(uLightPosition.xy) < fThresholdRadius2;
  }

  /**
   * Get the elevated shadow ratios.
   */
  calculateElevatedShadowRatios({ elevationE, elevationZ = this.canvasElevation } = {}) {
    const elevation = (typeof elevationE === "undefined") ? elevationZ : CONFIG.GeometryLib.utils.pixelsToGridUnits(elevationE);
    const { fFarRatios, fNearRatios } = this.calculateFlatVariables();
    const nearRatios = [
      fNearRatios.x,
      fNearRatios.y,
      fNearRatios.z
    ];
    const farRatios = [
      fFarRatios.x,
      fFarRatios.y,
      fFarRatios.z
    ];
    const elevationFarFn = this.elevateShadowRatioFn(elevation, true);
    const elevationNearFn = this.elevateShadowRatioFn(elevation, false);
    for ( const shadowType of [UMBRA, MIDPENUMBRA, PENUMBRA] ) {
      nearRatios[shadowType] = elevationNearFn(nearRatios[shadowType]);
      farRatios[shadowType] = elevationFarFn(farRatios[shadowType]);
    }
    return { nearRatios, farRatios };
  }

  /**
   * @param {float} elevationZ    Desired elevation
   * @param {bool} top            Use top or bottom wall height?
   * @returns {function}
   */
  elevateShadowRatioFn(elevationZ = 0, top = true) {
    const { canvasElevation } = this;
    const { fWallRatio, fWallHeights } = this.calculateFlatVariables();
    const fWallHeight = top ? fWallHeights.x : fWallHeights.y;
    const wallHeight = Math.max(fWallHeight - canvasElevation, 0.0);
    if ( wallHeight === 0.0 ) return ratio => ratio;

    const elevationChange = elevationZ - canvasElevation;
    const heightFraction = elevationChange / wallHeight;
    return ratio => ratio + (heightFraction * fWallRatio) - (heightFraction * ratio);
  }

  /**
   * Is this point in front of the wall (side of the light)?
   * @param {Point} pt
   * @returns {bool}
   */
  inFrontOfWall(pt) {
    const { vPenumbra } = this.calculateVaryings(pt);
    const { fWallRatio } = this.calculateFlatVariables();
    return vPenumbra.x > fWallRatio;
  }

  /**
   * Is the point in the original umbra triangle?
   * Does not check for other containment nor does it do a wall test.
   * @param {Point} pt
   * @returns {bool}
   */
  _inUmbra(pt) {
    const { vUmbra } = this.calculateVaryings(pt);
    return barycentricPointInsideTriangle(vUmbra);
  }

  /**
   * Is the point in the original midpenumbra triangle?
   * Does not check for other containment nor does it do a wall test.
   * @param {Point} pt
   * @returns {bool}
   */
  _inMidPenumbra(pt) {
    const { vMidPenumbra } = this.calculateVaryings(pt);
    return barycentricPointInsideTriangle(vMidPenumbra);
  }

  // No check for _inPenumbra b/c that is always true b/c penumbra triangle defines the vertices.

  /**
   * Is the point in the umbra triangle, accounting for near/far?
   * @param {Point} pt
   * @param {float} elevationE
   * @returns {bool}
   */
  inUmbra(pt, elevationE) {
    if ( !this._inUmbra(pt) || this.inFrontOfWall(pt) ) return false;
    const { nearRatios, farRatios } = this.calculateElevatedShadowRatios({ elevationE });
    const { vPenumbra } = this.calculateVaryings(pt);
    return between(farRatios[UMBRA], nearRatios[UMBRA], vPenumbra.x);
  }

  /**
   * Is the point in the midPenumbra triangle, accounting for near/far?
   * Overlapping umbra triangle counts.
   * @param {Point} pt
   * @param {float} elevationE
   * @returns {bool}
   */
  inMidPenumbra(pt, elevationE) {
    if ( !this._inMidPenumbra(pt) || this.inFrontOfWall(pt) ) return false;
    const { nearRatios, farRatios } = this.calculateElevatedShadowRatios({ elevationE });
    const { vPenumbra } = this.calculateVaryings(pt);
    return between(farRatios[MIDPENUMBRA], nearRatios[MIDPENUMBRA], vPenumbra.x);
  }

  inPenumbra(pt, elevationE) {
    // Always in the penumbra triangle.
    if ( this.inFrontOfWall(pt) ) return false;
    const { nearRatios, farRatios } = this.calculateElevatedShadowRatios({ elevationE });
    const { vPenumbra } = this.calculateVaryings(pt);
    return between(farRatios[PENUMBRA], nearRatios[PENUMBRA], vPenumbra.x);
  }

  inFarPenumbra(pt, elevationE) {
    if ( this.inFrontOfWall(pt) ) return false;

    // TODO: Omit these to change what counts as mid-penumbra?
    if ( this.inMidPenumbra(pt, elevationE) ) return false;

    const { vPenumbra } = this.calculateVaryings(pt);
    const { farRatios } = this.calculateElevatedShadowRatios({ elevationE });
    return between(farRatios[PENUMBRA], farRatios[MIDPENUMBRA], vPenumbra.x);
  }

  inFarMidPenumbra(pt, elevationE) {
    if ( this.inFrontOfWall(pt) ) return false;

    // TODO: Omit these to change what counts as mid-penumbra?
    if ( this.inUmbra(pt, elevationE) ) return false;
    if ( !this.inMidPenumbra(pt, elevationE) ) return false;

    // In the mid-penumbra but is it in the far strip?
    const { vPenumbra } = this.calculateVaryings(pt);
    const { farRatios } = this.calculateElevatedShadowRatios({ elevationE });
    return between(farRatios[MIDPENUMBRA], farRatios[UMBRA], vPenumbra.x);
  }

  inNearPenumbra(pt, elevationE) {
    if ( this.inFrontOfWall(pt) ) return false;

    // TODO: Omit these to change what counts as mid-penumbra?
    if ( this.inMidPenumbra(pt, elevationE)  ) return false;

    // In the penumbra but is it in the near strip?
    const { vPenumbra } = this.calculateVaryings(pt);
    const { nearRatios } = this.calculateElevatedShadowRatios({ elevationE });
    return between(nearRatios[PENUMBRA], nearRatios[MIDPENUMBRA], vPenumbra.x);
  }

  inNearMidPenumbra(pt, elevationE) {
    if ( this.inFrontOfWall(pt) ) return false;

    // TODO: Omit these to change what counts as mid-penumbra?
    if ( this.inUmbra(pt, elevationE) ) return false;
    if ( !this.inMidPenumbra(pt, elevationE) ) return false;

    // In the penumbra but is it in the near strip?
    const { vPenumbra } = this.calculateVaryings(pt);
    const { nearRatios } = this.calculateElevatedShadowRatios({ elevationE });
    return between(nearRatios[MIDPENUMBRA], nearRatios[UMBRA], vPenumbra.x);
  }

  /**
   * Determine if a point is in either of the side penumbras.
   * @param {Point} pt
   * @param {float} elevationE
   * @returns {bool}
   */
  inSidePenumbras(pt, elevationE) {
    const { vSidePenumbra0, vSidePenumbra1 } = this.calculateVaryings(pt);
    return [
      barycentricPointInsideTriangle(vSidePenumbra0),
      barycentricPointInsideTriangle(vSidePenumbra1),
    ];
  }

  /**
   * Determine if a point is in one or more of the shadow areas.
   * @param {Point} pt
   * @param {float} elevationE
   * @returns {bool}
   */
  inShadows(pt, elevationE) {
    const out = {
      inSidePenumbra0: false,
      inSidePenumbra1: false,
      inPenumbra: false,
      inMidPenumbra: false,
      inUmbra: false,
      inFarPenumbra: false,
      inNearPenumbra: false,
      inFarMidPenumbra: false,
      inNearMidPenumbra: false
    };
    if ( this.inFrontOfWall(pt) ) return out;
    if ( this.thresholdApplies(pt) ) return out;

    const [inSidePenumbra0, inSidePenumbra1] = this.inSidePenumbras(pt, elevationE);
    out.inSidePenumbra0 = inSidePenumbra0;
    out.inSidePenumbra1 = inSidePenumbra1;
    out.inPenumbra = this.inPenumbra(pt, elevationE);
    out.inMidPenumbra = this.inMidPenumbra(pt, elevationE);
    out.inUmbra = this.inUmbra(pt, elevationE);

    out.inFarPenumbra = this.inFarPenumbra(pt, elevationE);
    out.inNearPenumbra = this.inNearPenumbra(pt, elevationE);
    out.inFarMidPenumbra = this.inFarMidPenumbra(pt, elevationE);
    out.inNearMidPenumbra = this.inNearMidPenumbra(pt, elevationE);

    return out;
  }

  /**
   * Return the amount of shadow for a point.
   */
  shadow(pt, elevationE) {
    const {
      inSidePenumbra0,
      inSidePenumbra1,
      inFarPenumbra,
      inNearPenumbra,
      inFarMidPenumbra,
      inNearMidPenumbra } = this.inShadows(pt, elevationE);

    const { vPenumbra, vSidePenumbra0, vSidePenumbra1 } = this.calculateVaryings(pt);
    const { farRatios, nearRatios } = this.calculateElevatedShadowRatios({ elevationE });

    // Blend the two side penumbras if overlapping by multiplying the light amounts.
    const side0Shadow = inSidePenumbra0 ? vSidePenumbra0.z / (vSidePenumbra0.y + vSidePenumbra0.z) : 1.0;
    const side1Shadow = inSidePenumbra1 ? vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z) : 1.0;

    const farShadow = inFarPenumbra ? linearConversion(vPenumbra.x, 0.0, farRatios.mid, 0.0, 0.5)
      : inFarMidPenumbra ? linearConversion(vPenumbra.x, farRatios.mid, farRatios.umbra, 0.5, 1.0)
        : 1.0;

    const nearShadow = inNearPenumbra ? linearConversion(vPenumbra.x, nearRatios.penumbra, nearRatios.mid, 0.0, 0.5)
      : inNearMidPenumbra ? linearConversion(vPenumbra.x, nearRatios.mid, nearRatios.umbra, 0.5, 1.0)
        : 1.0;

    return side0Shadow * side1Shadow * farShadow * nearShadow;
  }

  // ----- NOTE: Drawing ----- //

  drawWall() { Draw.segment({ a: this.wall.top[0], b: this.wall.top[1] }); }

  drawLight() { Draw.point(this.light.center, { radius: this.light.size, color: Draw.COLORS.yellow }); }

  drawSidePenumbraDirections(dist = canvas.dimensions.maxR) {
    const { sidePenumbraDirs, wall } = this;
    const COLOR_KEYS = {
      [UMBRA]: Draw.COLORS.red,
      [MIDPENUMBRA]: Draw.COLORS.orange,
      [PENUMBRA]: Draw.COLORS.yellow
    };
    for ( const [key, color] of Object.entries(COLOR_KEYS) ) {
      for ( let i = 0; i < 2; i += 1 ) {
        const endpoint = wall.top[i];
        const penumbraPt = endpoint.add(sidePenumbraDirs[i][key].multiplyScalar(dist));
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
    const tri = this.buildTriangle(shadowType);
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
      [UMBRA]: Draw.COLORS.red,
      [MIDPENUMBRA]: Draw.COLORS.orange,
      [PENUMBRA]: Draw.COLORS.yellow
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


// shader0 = SizedPointSourceShadowWallVertexShaderTest.fromShader(ev.shadowMesh.shader)
// [shader0, shader1] = SizedPointSourceShadowWallVertexShaderTest.fromMesh(ev.shadowMesh)


// Change to canvas surface elevation
shader0._uniforms.uElevationRes[0] = 0
shader1._uniforms.uElevationRes[0] = 0


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
shader0._inVars.aWallCorner0.w = linkedAngle(edge0, edge1, "a")
shader0._inVars.aWallCorner1.w = linkedAngle(edge0, edge1, "b")
shader1._inVars.aWallCorner0.w = linkedAngle(edge1, edge0, "a")
shader1._inVars.aWallCorner1.w = linkedAngle(edge1, edge0, "b")


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

*/

