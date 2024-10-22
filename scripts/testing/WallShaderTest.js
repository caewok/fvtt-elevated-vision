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

export class LightGLSLStruct {
  constructor({ center, left, right, top, bottom, size, oWallLight } = {}) {
    const args = { center, left, right, top, bottom, size, oWallLight };
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
      left: new vec3(lr0.x, lr0.y, uLightPosition.z),
      right: new vec3(lr1.x, lr1.y, uLightPosition.z),
      top: new vec3(uLightPosition.x, uLightPosition.y, top),
      bottom: new vec3(uLightPosition.x, uLightPosition.y, bottom),
      size: uLightSize,
      oWallLight: Math.sign(foundry.utils.orient2dFast(
        wall.top[0].xy, wall.top[1].xy, uLightPosition.xy
      ))
    });
  }
}

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
      direction: aWallCorner0.xy.subtract(aWallCorner1.xy).normalize(),
      linkValue: [aWallCorner0.w, aWallCorner1.w],
      type: aWallSenseType,
      thresholdRadius2: aThresholdRadius2
    });
  }
}

/**
 * @prop {vec3} umbra
 * @prop {vec3} mid
 * @prop {vec3} penumbra
 * @prop {vec3} top
 * @prop {vec3} bottom
 */
export class PenumbraDirGLSLStruct {
  static EV_ENDPOINT_LINKED_UNBLOCKED = -10.0;

  constructor({ umbra, mid, penumbra, top, bottom } = {}) {
    const args = { umbra, mid, penumbra, top, bottom };
    for ( const [key, value] of Object.entries(args) ) this[key] = value;
  }

  static calculatePenumbraDirection(wall, light, idx = 0) {
    const w = wall.top[idx]; // Wall endpoint from which a penumbra is cast.
    const lr = idx === 0 ? light.right : light.left;
    const ll = idx === 0 ? light.left : light.right;

    // Direction from light --> wall endpoint.
    const penObj = new this({
      umbra: normalizedDirection(lr, w),
      mid: normalizedDirection(light.center, w),
      penumbra: normalizedDirection(ll, w),
      top: normalizedDirection(light.top, w),
      bottom: normalizedDirection(light.bottom, w)
    });

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
    const midR = new Ray2dGLSLStruct(w.xy, penObj.mid.xy);
    const midPt = midR.project(1);

    // Orientation re mid.
    const other = (wall.top[1 - idx]).xy;
    const orient = foundry.utils.orient2dFast;
    const oMidLink = orient(w.xy, midPt, linkPt);
    const oMidWall = orient(w.xy, midPt, other);

    // 1 & 2: linked wall blocks light.
    const linkOppositeWall = oMidWall * oMidLink <= 0;
    if ( linkOppositeWall ) {
      penObj.umbra.x = penObj.mid.x;
      penObj.umbra.y = penObj.mid.y;
      penObj.umbra.z = penObj.mid.z;
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
    const umbraR = new Ray2dGLSLStruct(w.xy, penObj.umbra.xy);
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
    penObj.umbra.x = linkDir.x;
    penObj.umbra.y = linkDir.y;
    if ( oMidUmbra * oMidLink > 0 ) {   return penObj;

    // Linked wall is after mid; adjust mid as well.
    penObj.mid.x = linkDir.x;
    penObj.mid.y = linkDir.y;
    return penObj;
  }

  static calculatePenumbraDirections(wall, light) {
    return [
      this.calculatePenumbraDirection(wall, light, 0),
      this.calculatePenumbraDirection(wall, light, 1),
    ];
  }
}

export class PenumbraPointsGLSLStruct {
  constructor({ umbra, mid, penumbra } = {}) {
    const args = { umbra, mid, penumbra };
    for ( const [key, value] of Object.entries(args) ) this[key] = value;
  }

  static calculateSidePenumbras(penumbraDir, wall, light, maxR, canvasPlane) {
    const out = [
      new this({ umbra: new vec2(), mid: new vec2(), penumbra: new vec2() }),
      new this({ umbra: new vec2(), mid: new vec2(), penumbra: new vec2() }),
    ];

    // Determine where the light ray hits the canvas when passing through the light bottom to one of the endpoints.
    // This is the furthest point of the shadow, as the top of the light casts a shorter shadow.
    const infiniteShadow = wall.top[0].z >= light.bottom.z;
    if ( infiniteShadow ) {
      // No height change for an infinite shadow.
      const midRay = new Ray2dGLSLStruct(wall.top[0].xy, penumbraDir[0].mid.xy.normalize());
      out[0].mid = midRay.project(maxR);
    } else {
      // Project a 3d ray from wall top endpoint in direction away from light bottom onto the canvas plane
      const ixCanvas = new vec3();
      const midRay = new RayGLSLStruct(wall.top[0], penumbraDir[0].bottom);
      intersectRayPlane(midRay, canvasPlane, ixCanvas);
      out[0].mid = ixCanvas.xy;
    }

    // Draw a line parallel to the wall that goes through the intersection point.
    // The intersection of that with each penumbra ray will define the penumbra points.
    const farParallelRay = new Ray2dGLSLStruct(out.mid[0].xy, wall.direction);
    const Ray2d = Ray2dGLSLStruct;
    lineLineIntersectionRay(farParallelRay, new Ray2d(wall.top[1].xy, penumbraDir[1].mid.xy), out[1].mid);
    lineLineIntersectionRay(farParallelRay, new Ray2d(wall.top[0].xy, penumbraDir[0].penumbra.xy), out[0].penumbra);
    lineLineIntersectionRay(farParallelRay, new Ray2d(wall.top[1].xy, penumbraDir[1].penumbra.xy), out[1].penumbra);
    lineLineIntersectionRay(farParallelRay, new Ray2d(wall.top[0].xy, penumbraDir[0].umbra.xy), out[0].umbra);
    lineLineIntersectionRay(farParallelRay, new Ray2d(wall.top[1].xy, penumbraDir[1].umbra.xy), out[1].umbra);

    return out;
  }
}

/**
 * Based on SizedPointSourceShadowWallShader.
 * Represents a single wall calculation.
 * 3 vertices: light, ix for corner 1, ix for corner 2.
 * Wall shadow with side, near, and far penumbra
 */
export class SizedPointSourceShadowWallVertexShaderTest {

  static EV_ENDPOINT_LINKED_UNBLOCKED = -1.0;

  static EV_ENDPOINT_LINKED_CONCAVE = -2.0;

  // From CONST.WALL_SENSE_TYPES
  static LIMITED_WALL = 10.0;

  static PROXIMATE_WALL = 30.0;

  static DISTANCE_WALL = 40.0;

  // ----- IN variables ----- //
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

  // ----- UNIFORM variables ----- //

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
      const instance = this.fromShader(shader);
      out.push(instance);
      const inVars = {};
      for ( const [key, attribute] of Object.entries(geometry.attributes) ) {
        const { buffer, size } = attribute;
        switch ( size ) {
          case 1: inVars[key] = buffers[buffer][idx]; break;
          default: inVars[key] = buffers[buffer].data.slice(idx, idx + size);
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
        aWallCorner0: [edge.a.x, edge.a.y, top, -1.0],
        aWallCorner1: [edge.b.x, edge.b.y, bottom, -1.0],
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


  /* ----- Defined terms ---- */

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

  get penumbraDirs() {
    return PenumbraDirGLSLStruct.calculatePenumbraDirections(this.wall, this.light);
  }

  get penumbraPoints() {
    return PenumbraPointsGLSLStruct.calculateSidePenumbra(this.penumbraDir, this.wall,
      this.light, this.maxR, this.canvasPlane);
  }

  /* ----- Calculations ----- */

  drawPenumbra(dist = canvas.dimensions.maxR) {
    const { penumbraDirs, wall } = this;

    Draw.segment({ a: wall.top[0], b: wall.top[1] }); // Wall

    const inner0 = wall.top[0].add(penumbraDirs[0].umbra.multiplyScalar(dist));
    const inner1 = wall.top[1].add(penumbraDirs[1].umbra.multiplyScalar(dist));
    Draw.segment({ a: wall.top[0], b: inner0 }, { color: Draw.COLORS.red });
    Draw.segment({ a: wall.top[1], b: inner1 }, { color: Draw.COLORS.red });

    const mid0 = wall.top[0].add(penumbraDirs[0].mid.multiplyScalar(dist));
    const mid1 = wall.top[1].add(penumbraDirs[1].mid.multiplyScalar(dist));
    Draw.segment({ a: wall.top[0], b: mid0 }, { color: Draw.COLORS.orange });
    Draw.segment({ a: wall.top[1], b: mid1 }, { color: Draw.COLORS.orange });

    const outer0 = wall.top[0].add(penumbraDirs[0].penumbra.multiplyScalar(dist));
    const outer1 = wall.top[1].add(penumbraDirs[1].penumbra.multiplyScalar(dist));
    Draw.segment({ a: wall.top[0], b: outer0 }, { color: Draw.COLORS.yellow });
    Draw.segment({ a: wall.top[1], b: outer1 }, { color: Draw.COLORS.yellow });

    return { inner0, inner1, mid0, mid1, outer0, outer1 };
  }

  /**
   * Define distinct intersections (light centers) (2d) based on intersection of the penumbra vectors.
   * Intersection of the middle (sideMidPenumbra) should equal the light center.
   */
  calculatePenumbraIntersections() {
    const { penumbraPoints, wall } = this;
    const penumbra = new vec2();
    const mid= new vec2();
    const umbra = new vec2();
    lineLineIntersectionVector(penumbraPoints[0].penumbra, wall.top[0].xy,
      penumbraPoints[1].penumbra, wall.top[1].xy, penumbra);
    lineLineIntersectionVector(penumbraPoints[0].mid, wall.top[0].xy,
      penumbraPoints[1].mid, wall.top[1].xy, mid);
    lineLineIntersectionVector(penumbraPoints[0].umbra, wall.top[0].xy,
      penumbraPoints[1].umbra, wall.top[1].xy, umbra);
    return { penumbra, mid, umbra };
  }

  drawSidePenumbra() {
    const { penumbraPoints, wall, light } = this;
    const penumbraIx = this.calculatePenumbraIntersections();

    Draw.segment({ a: wall.top[0], b: wall.top[1] }); // Wall

    Draw.segment({ a: wall.top[0], b: penumbraPoints[0].umbra }, { color: Draw.COLORS.red });
    Draw.segment({ a: wall.top[1], b: penumbraPoints[1].umbra }, { color: Draw.COLORS.red });
    Draw.point(penumbraPoints[0].umbra[0], { color: Draw.COLORS.red });
    Draw.point(penumbraPoints[1].umbra[1], { color: Draw.COLORS.red });

    Draw.segment({ a: wall.top[0], b: penumbraPoints[0].mid }, { color: Draw.COLORS.orange });
    Draw.segment({ a: wall.top[1], b: penumbraPoints[1].mid }, { color: Draw.COLORS.orange });
    Draw.point(penumbraPoints[0].mid, { color: Draw.COLORS.orange });
    Draw.point(penumbraPoints[1].mid, { color: Draw.COLORS.orange });

    Draw.segment({ a: wall.top[0], b: penumbraPoints[0].penumbra }, { color: Draw.COLORS.yellow });
    Draw.segment({ a: wall.top[1], b: penumbraPoints[1].penumbra }, { color: Draw.COLORS.yellow });
    Draw.point(penumbraPoints[0].penumbra, { color: Draw.COLORS.yellow });
    Draw.point(penumbraPoints[1].penumbra, { color: Draw.COLORS.yellow });

    // Light centers
    Draw.point(light.center, { color: Draw.COLORS.white, radius: light.size * 0.5 });
    Draw.point(penumbraIx.penumbra, { color: Draw.COLORS.yellow });
    Draw.point(penumbraIx.mid, { color: Draw.COLORS.orange });
    Draw.point(penumbraIx.umbra, { color: Draw.COLORS.red });
  }

  _cleanedPenumbraPoints() {
    const { canvasElevation, canvasPlane, maxR, wall, light } = this;
    const { penumbraDir } = this;
    penumbraDir.umbra = this._cleanDirectionalVector(penumbraDir.umbra);
    penumbraDir.penumbra = this._cleanDirectionalVector(penumbraDir.penumbra);
    return PenumbraPointsGLSLStruct.calculateSidePenumbra(penumbraDir, wall, light, maxR, canvasPlane);
  }

  /**
   * Build the triangle to represent this light's shadow vis-a-vis the wall.
   */
  buildTriangle() {
    const { wall } = this;
    const penumbraPoints = this._cleanedPenumbraPoints();

    // Construct a new light position based on the xy intersection of the outer penumbra points --> wall corner
    const newLightCenter = new vec2();
    lineLineIntersectionVector(penumbraPoints[0].penumbra, wall.top[0].xy,
      penumbraPoints[1].penumbra, wall.top[1].xy, newLightCenter);
    return [newLightCenter, penumbraPoints[0].penumbra, penumbraPoints[1].penumbra];
  }

  drawTriangle() {
    const tri = this.buildTriangle();
    const poly = new PIXI.Polygon(...tri);
    Draw.shape(poly, { color: Draw.COLORS.black, width: 2 });
  }

  /**
   * Barycentric coordinates for the penumbra.
   * @returns {[vec3, vec3]} The bary coordinates for the a and b endpoints.
   */
  calculatePenumbraBaryCoords(vertexNum = 0) {
    const Ray2d = Ray2dGLSLStruct;
    const penumbraPoints = this._cleanedPenumbraPoints();
    const { light, wall } = this;
    const sign = Math.sign;
    const orient = foundry.utils.orient2dFast;
    const vVertexPosition = this.buildTriangle()[vertexNum];
    const vSidePenumbras = [new vec3(1.0, 1.0, 1.0), new vec3(1.0, 1.0, 1.0)];

    for ( let i = 0; i < 2; i += 1 ) {
      const endpoint = wall.top[i];
      const penumbraPoint = penumbraPoints[i];
      const linkValue = wall.linkValue[i];
      let hasSidePenumbra = light.size > 0.0;
      hasSidePenumbra = hasSidePenumbra && linkValue !== this.constructor.EV_ENDPOINT_LINKED_CONCAVE;

      if ( hasSidePenumbra && linkValue !== this.constructor.EV_ENDPOINT_LINKED_UNBLOCKED ) {
        const linkedPt = wallKeyCoordinates(linkValue);
        const oUmbraPenumbra = sign(orient(endpoint.xy, penumbraPoint.umbra, penumbraPoint.penumbra));
        const oUmbraLinked = sign(orient(endpoint.xy, penumbraPoint.umbra, linkedPt));
        const oPenumbraLinked = sign(orient(endpoint.xy, penumbraPoint.penumbra, linkedPt));

        if ( oUmbraPenumbra === oUmbraLinked ) {
          if ( oPenumbraLinked !== oUmbraLinked ) {
            // Linked wall goes through the penumbra.
            // Move the umbra to the linked wall.
            const dirLinked = linkedPt.subtract(endpoint.xy);
            const farParallelRay = new Ray2d(penumbraPoint.mid.xy, wall.direction.xy);
            lineLineIntersectionRay(farParallelRay, new Ray2d(endpoint.xy, dirLinked), penumbraPoint.umbra);
          } else hasSidePenumbra = false; // Linked wall blocks the penumbra.
        }
      }

      if ( hasSidePenumbra ) {
        // Penumbra0 triangle
        const pA = endpoint.xy;
        const pB = penumbraPoint.penumbra;
        const pC = penumbraPoint.umbra;
        vSidePenumbras[i] = barycentric(vVertexPosition, pA, pB, pC);
      }
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
    const { wall, light, canvasPlane, canvasElevation } = this;
    const penumbraPoints = this._cleanedPenumbraPoints();
    const penumbraPoint = penumbraPoints[0];
    const newLightCenter = this.buildTriangle()[0];
    const top = wall.top[0];
    const bottom = wall.bottom[0];

    const fWallCornerLinked = new vec2(wall.linkValue[0], wall.linkValue[1]);
    const fWallHeights = new vec2(top.z, bottom.z);
    const fWallSenseType = wall.type;
    const fThresholdRadius2 = wall.thresholdRadius2;

    // Wall ratio
    const distShadowInv = 1.0 / newLightCenter.distance(penumbraPoint.penumbra);
    const distWallTop = top.xy.distance(penumbraPoint.penumbra.xy);
    const fWallRatio = distWallTop * distShadowInv;

    // Near/far penumbra ratios
    // x: penumbra; y: mid-penumbra; z: umbra
    // Measured along the penumbra (outer) line.
    const fNearRatios = new vec3(fWallRatio, fWallRatio, fWallRatio);
    const fFarRatios = new vec3();

    // Define directions from the new light position to the end of the outer penumbra.
    const newLightCenter3d = new vec3(newLightCenter, light.center.z);
    const newLightTop = newLightCenter3d.add(new vec3(0.0, 0.0, light.size));
    const dirTop = normalizedDirection(newLightTop, top);
    const dirMid = normalizedDirection(newLightCenter3d, top);

    // Light center
    fFarRatios.y = distShadowInv
      * this._calculateRatio(top, dirMid, penumbraPoint.penumbra, canvasPlane, distWallTop);

    // Light top
    fFarRatios.x = distShadowInv
      * this._calculateRatio(top, dirTop, penumbraPoint.penumbra, canvasPlane, distWallTop);

    if ( bottom.z > canvasElevation ) {
      const newLightBottom = newLightCenter3d.subtract(new vec3(0.0, 0.0, light.size));
      const dirBottom = normalizedDirection(newLightBottom, top);

      // Light top
      fNearRatios.x = distShadowInv
        * this._calculateRatio(bottom, dirTop, penumbraPoint.penumbra, canvasPlane, distWallTop);

      // Light center
      fNearRatios.y = distShadowInv
        * this._calculateRatio(bottom, dirMid, penumbraPoint.penumbra, canvasPlane, distWallTop);

      // Light bottom
      fNearRatios.z = distShadowInv
        * this._calculateRatio(bottom, dirBottom, penumbraPoint.penumbra, canvasPlane, distWallTop);
    }

    return { fWallCornerLinked, fWallHeights, fWallSenseType, fThresholdRadius2, fNearRatios, fFarRatios, fWallRatio };
  }

  /**
   * Get the barycentric position for a given 2d canvas point.
   * Used to mimic the vBary coordinates in the fragment shader.
   * @param {Point} pt
   * @returns {vec3}
   */
  baryForPoint(pt) {
    const tri = this.buildTriangle();
    return barycentric(new vec2(pt.x, pt.y), tri[0], tri[1], tri[2]);
  }

  barySidesForPoint(pt) {
    const { wall } = this;
    const penumbraPoints = this._cleanedPenumbraPoints();
    pt = new vec2(pt.x, pt.y);
    return [
      barycentric(pt, wall.top[0].xy, penumbraPoints[0].penumbra, penumbraPoints[0].umbra),
      barycentric(pt, wall.top[1].xy, penumbraPoints[1].penumbra, penumbraPoints[0].umbra)
    ];
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
   * Shift the front or back border of the shadow, specified as a ratio between 0 and 1.
   * Shadow moves forward---towards the light---as terrain elevation rises.
   * Thus higher fragment elevation means less shadow.
   * @param {vec3} ratios       Ratios indicating where the shadow border lies between 0 and 1
   *                            for close/middle/far shadow borders
   * @param {float} wallHeight  Height of the wall, relative to the canvas elevation.
   * @param {float} wallRatio   Where the wall is relative to the light, where
   *                              0 means at the shadow end;
   *                              1 means at the light.
   * @param {float} elevChange  Percentage elevation change compared to the canvas
   * @returns {vec3} Modified ratios.
   */
  _elevateShadowRatios(ratios, wallHeight, wallRatio, elevChange) {
    if ( wallHeight === 0.0 ) return ratios;

    // Distance between the wall and the canvas intersect as a ratio.
    const ratiosDist = new vec3(
      wallRatio - ratios.x,
      wallRatio - ratios.y,
      wallRatio - ratios.z
    );
    const heightFraction = elevChange / wallHeight;
    return ratios.add(ratiosDist.multiplyScalar(heightFraction));
  }

  /**
   * Get the elevated shadow ratios.
   */
  calculateElevatedShadowRatios({ elevationE, elevationZ = this.canvasElevation } = {}) {
    const elevation = (typeof elevationE === "undefined") ? elevationZ : CONFIG.GeometryLib.utils.pixelsToGridUnits(elevationE);
    const { fFarRatios, fNearRatios, fWallHeights, fWallRatio } = this.calculateFlatVariables();
    const { canvasElevation } = this;
    const wallHeights = new vec2(
      Math.max(fWallHeights.x - canvasElevation, 0.0),
      Math.max(fWallHeights.y - canvasElevation, 0.0),
    );
    const elevationChange = elevation - canvasElevation;
    return {
      nearRatios: this._elevateShadowRatios(fNearRatios, wallHeights.y, fWallRatio, elevationChange),
      farRatios: this._elevateShadowRatios(fFarRatios, wallHeights.x, fWallRatio, elevationChange)
    };
  }

  /**
   * Determine if a point is in front of the near/far shadow.
   */
  outsideOfShadow(pt, elevationOpts) {
    const { nearRatios, farRatios } = this.calculateElevatedShadowRatios(elevationOpts);
    const vBary = this.baryForPoint(pt);
    return between(farRatios.z, nearRatios.x, vBary.x) === 0.0;
  }

  /**
   * Determine if a point is in the penumbra.
   * @param {Point} pt
   * @returns {bool}
   */
  inSidePenumbra(pt, elevationOpts) {
    if ( this.thresholdApplies(pt) ) return false;
    if ( this.outsideOfShadow(pt, elevationOpts) ) return false;

    const [vSidePenumbra0, vSidePenumbra1] = this.barySidesForPoint(pt);
    return [
      barycentricPointInsideTriangle(vSidePenumbra0),
      barycentricPointInsideTriangle(vSidePenumbra1),
    ];
  }

  inFarPenumbra(pt, elevationOpts) {
    if ( this.thresholdApplies(pt) ) return false;
    if ( this.outsideOfShadow(pt, elevationOpts) ) return false;

    const { farRatios } = this.calculateElevatedShadowRatios(elevationOpts);
    const vBary = this.baryForPoint(pt);
    return vBary.x < farRatios.x && vBary.x > 0.0;
  }

  inNearPenumbra(pt, elevationOpts) {
    if ( this.thresholdApplies(pt) ) return false;
    if ( this.outsideOfShadow(pt, elevationOpts) ) return false;

    const { nearRatios } = this.calculateElevatedShadowRatios(elevationOpts);
    const vBary = this.baryForPoint(pt);
    return vBary.x > nearRatios.z && vBary.x < nearRatios.x;
  }

  /**
   * What are the near/far coordinates at a given elevation?
   */
  nearFarCoordinates(elevationOpts) {
    const { nearRatios, farRatios } = this.calculateElevatedShadowRatios(elevationOpts);
    const tri = this.buildTriangle().map(pt => PIXI.Point.fromObject(pt));

    return [
      {
        near: [
          tri[1].projectToward(tri[0], nearRatios.x),
          tri[1].projectToward(tri[0], nearRatios.y),
          tri[1].projectToward(tri[0], nearRatios.z),
        ],

        far: [
          tri[1].projectToward(tri[0], farRatios.x),
          tri[1].projectToward(tri[0], farRatios.y),
          tri[1].projectToward(tri[0], farRatios.z),
        ]
      },
      {
        near: [
          tri[2].projectToward(tri[0], nearRatios.x),
          tri[2].projectToward(tri[0], nearRatios.y),
          tri[2].projectToward(tri[0], nearRatios.z),
        ],

        far: [
          tri[2].projectToward(tri[0], farRatios.x),
          tri[2].projectToward(tri[0], farRatios.y),
          tri[2].projectToward(tri[0], farRatios.z),
        ]
      },
    ];
  }

  /**
   * Draw the near/far markers.
   */
  drawNear(elevationOpts) {
    const coords = this.nearFarCoordinates(elevationOpts);

    Draw.segment({ a: coords[0].near[0], b: coords[1].near[0]}, { color: Draw.COLORS.yellow, alpha: 0.5 });
    Draw.segment({ a: coords[0].near[1], b: coords[1].near[1]}, { color: Draw.COLORS.orange, alpha: 0.5 });
    Draw.segment({ a: coords[0].near[2], b: coords[1].near[2]}, { color: Draw.COLORS.red, alpha: 0.5 });
  }

  drawFar(elevationOpts) {
    const coords = this.nearFarCoordinates(elevationOpts);

    Draw.segment({ a: coords[0].far[0], b: coords[1].far[0]}, { color: Draw.COLORS.yellow });
    Draw.segment({ a: coords[0].far[1], b: coords[1].far[1]}, { color: Draw.COLORS.orange });
    Draw.segment({ a: coords[0].far[2], b: coords[1].far[2]}, { color: Draw.COLORS.red });
  }

  /**
   * Return the amount of shadow for a point.
   */
  shadow(pt, elevationOpts) {
    const { nearRatios, farRatios } = this.calculateElevatedShadowRatios(elevationOpts);
    const vBary = this.baryForPoint(pt);
    const [vSidePenumbra0, vSidePenumbra1] = this.barySidesForPoint(pt);
    const [inSidePenumbra0, inSidePenumbra1] = this.inSidePenumbra(pt, elevationOpts);
    const inFarPenumbra = this.inFarPenumbra(pt, elevationOpts);
    const inNearPenumbra = this.inNearPenumbra(pt, elevationOpts);

    // Blend the two side penumbras if overlapping by multiplying the light amounts.
    const side0Shadow = inSidePenumbra0 ? vSidePenumbra0.z / (vSidePenumbra0.y + vSidePenumbra0.z) : 1.0;
    const side1Shadow = inSidePenumbra1 ? vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z) : 1.0;

    let farShadow = 1.0;
    if ( inFarPenumbra ) {
      const inLighterPenumbra = vBary.x < farRatios.y;
      farShadow = inLighterPenumbra
        ? linearConversion(vBary.x, 0.0, farRatios.y, 0.0, 0.5)
        : linearConversion(vBary.x, farRatios.y, farRatios.x, 0.5, 1.0);
    }

    let nearShadow = 1.0;
    if ( inNearPenumbra ) {
      const inLighterPenumbra = vBary.x > nearRatios.y;
      nearShadow = inLighterPenumbra
        ? linearConversion(vBary.x, nearRatios.x, nearRatios.y, 0.0, 0.5)
        : linearConversion(vBary.x, nearRatios.y, nearRatios.z, 0.5, 1.0);
    }

    return side0Shadow * side1Shadow * farShadow * nearShadow;

  }

  /**
  * Make sure the vector does not exceed the wall angle (i.e., does not go the "light" side)
  */
  _cleanDirectionalVector(dir) {
    const { wall, light } = this;
    const orient = foundry.utils.orient2dFast;

    // Duplicate the vector.
    dir = dir.xyz;

    // If the vector would extend into the light side, replace with a vector at the border.
    let oWallPenumbra = Math.sign(orient(wall.top[0].xy, wall.top[1].xy, wall.top[0].xy.add(dir)));
    if ( oWallPenumbra === light.oWallLight ) {
      const dirXY = wall.top[0].xy.subtract(wall.top[1].xy);
      dir.x = dirXY.x;
      dir.y = dirXY.y;
      dir = dir.normalize();
    }
    return dir;
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
  vec2, vec3, vec4,
  PenumbraDirGLSLStruct,
  PenumbraPointsGLSLStruct  } = api.testing

l = canvas.lighting.placeables[0];
edge0 = canvas.walls.placeables[0].edge
edge1 = canvas.walls.placeables[1].edge
ev = l.lightSource.elevatedvision

shader0 = SizedPointSourceShadowWallVertexShaderTest.fromEdgeAndSource(edge0, l.lightSource)
shader1 = SizedPointSourceShadowWallVertexShaderTest.fromEdgeAndSource(edge1, l.lightSource)

// shader0 = SizedPointSourceShadowWallVertexShaderTest.fromShader(ev.shadowMesh.shader)
// shader0 = SizedPointSourceShadowWallVertexShaderTest.fromMesh(ev.shadowMesh)


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

function drawPenumbraDirection(wall, penumbraDir) {
  const dist = canvas.dimensions.maxR;
  const p0 = wall.top[0].add(penumbraDir[0].multiplyScalar(dist));
  const p1 = wall.top[1].add(penumbraDir[1].multiplyScalar(dist));
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
