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

  class vec2Base extends arrCl {
    constructor(...args) {
      super(2);
      this.set(args.slice(0, 2), 0);
    }
  }

  class vec3Base extends arrCl {
    constructor(...args) {
      super(3);
      this.set(args.slice(0, 3), 0);
    }
  }

  class vec4Base extends arrCl {
    constructor(...args) {
      super(4);
      this.set(args.slice(0, 4), 0);
    }
  }

  const vectorMixin = function(Base) {
    return class GLSLVector extends Base {
      static SWIZZLE = SWIZZLE;

      get x() { return this[SWIZZLE.x]; }

      get y() { return this[SWIZZLE.y]; }

      get r() { return this[SWIZZLE.r]; }

      get b() { return this[SWIZZLE.b]; }

      get s() { return this[SWIZZLE.s]; }

      get t() { return this[SWIZZLE.t]; }

      get z() { return this[SWIZZLE.z]; }

      get b() { return this[SWIZZLE.b]; }

      get p() { return this[SWIZZLE.p]; }

      get w() { return this[SWIZZLE.q]; }

      get a() { return this[SWIZZLE.a]; }

      get q() { return this[SWIZZLE.q]; }

      get xy() { return new vec2(this.x, this.y); }

      get xyz() { return new vec3(this.x, this.y, this.z); }

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

      distanceSquared(other) {
        const delta = other.subtract(this);
        return delta.dot(delta);
      }
    }
  }

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
 * Ray defined by a point and a direction from that point.
 */
export class GLSLRay2d {
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
   * @returns {GLSLRay} A newly constructed ray.
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
  projectRay(distanceMultiplier) {
    return this.origin.add(this.direction.multiplyScalar(distanceMultiplier));
  }
}

/**
 * Ray defined by a point and a direction from that point.
 */
export class GLSLRay extends GLSLRay2d {
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
export class GLSLPlane {
  point = new vec3();

  normal = new vec3();

  constructor(point, normal) {
    this.point.set(point, 0);
    this.normal.set(normal, 0);
  }
}

/**
 * @param {GLSLRay2d|GLSLRay} r
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
 * Cross x and y parameters in a vec2.
 * @param {vec2} a  First vector
 * @param {vec2} b  Second vector
 * @returns {float} The cross product
 */
export function cross2d(a, b) { return (a.x * b.y) - (a.y * b.x); }

/**
 * @param {GLSLRay2d} a
 * @param {GLSLRay2d} b
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
 * @param {GLSLRay2d} a
 * @param {GLSLRay2d} b
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
  const rayA = GLSLRay2d.fromPoints(a, b);
  const rayB = GLSLRay2d.fromPoints(c, d);
  return lineLineIntersectionRay(rayA, rayB, ix);
}



/**
 * Based on SizedPointSourceShadowWallShader.
 * Represents a single wall calculation.
 * 3 vertices: light, ix for corner 1, ix for corner 2.
 * Wall shadow with side, near, and far penumbra
 */
export class SizedPointSourceShadowWallVertexShaderTest {

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
    this.config({ uniforms: shader.uniforms });
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
          default: inVars[key] = buffers[buffer].slice(idx, idx + size);
        }
      }
      instance.config({ inVars });
    }

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

  static EV_ENDPOINT_LINKED_UNBLOCKED = -1.0;

  static EV_ENDPOINT_LINKED_CONCAVE = -2.0;

  /* ----- Defined terms ---- */
  /** @type {float} */
  get lightSize() { return this._uniforms.uLightSize; }

  /** @type {float} */
  get wallTopZ() { return this._inVars.aWallCorner0.z; }

  /** @type {float} */
  get wallBottomZ() { return this._inVars.aWallCorner1.z; }

  /** @type {vec2[]} */
  get wall2d() {
    const { aWallCorner0, aWallCorner1 } = this._inVars;
    return [aWallCorner0.xy, aWallCorner1.xy];
  }

  /** @type {vec2} */
  get wallDir() { return this.wall2d[0].subtract(this.wall2d[1]).normalize(); }

  /** @type {vec3} */
  get wallBottom0() {
    const aWallCorner0 = this._inVars.aWallCorner0;
    return new vec3(aWallCorner0.x, aWallCorner0.y, this.wallBottomZ);
  }

  /** @type {float} */
  get oWallLight() {
    return Math.sign(foundry.utils.orient2dFast(this.wall2d[0], this.wall2d[1], this._uniforms.uLightPosition.xy));
  }

  /** @type {float} */
  get canvasElevation() { return this._uniforms.uElevationRes.x; }

  /** @type {float} */
  get maxR() {
    const uSceneDims = this._uniforms.uSceneDims;
    return Math.sqrt(uSceneDims.z * uSceneDims.z + uSceneDims.w * uSceneDims.w) * 2.0;
  }

  /** @type {Plane} */
  get canvasPlane() {
    const planeNormal = new vec3(0.0, 0.0, 1.0);
    const planePoint = new vec3(0.0, 0.0, this.canvasElevation);
    return new GLSLPlane(planePoint, planeNormal);
  }

  /* ----- Calculations ----- */

  calculatePenumbra() {
    // Use wall direction to determine the left/right light points
    const uLightPosition = this._uniforms.uLightPosition;
    const { aWallCorner0, aWallCorner1 } = this._inVars;
    const { wallDir, lightSize, wall2d } = this;

    // Direction from light center --> wall endpoints
    const dirMidSidePenumbra = [
      wall2d[0].subtract(uLightPosition.xy),
      wall2d[1].subtract(uLightPosition.xy)
    ];

    // Use wall direction to determine the left/right light points
    const lightLR0 = uLightPosition.xy.subtract(wallDir.multiplyScalar(lightSize));
    const lightLR1 = uLightPosition.xy.add(wallDir.multiplyScalar(lightSize));

    // Direction from light LR --> wall endpoints
    let dirOuterSidePenumbra = [
      wall2d[0].subtract(lightLR0),
      wall2d[1].subtract(lightLR1)
    ];
    let dirInnerSidePenumbra = [
      wall2d[0].subtract(lightLR1),
      wall2d[1].subtract(lightLR0)
    ];

    // If the endpoint is blocked, don't use the light size. See issue #95.
    if ( aWallCorner0.w == this.constructor.EV_ENDPOINT_LINKED_CONCAVE ) {
      dirOuterSidePenumbra[0] = wall2d[0].subtract(uLightPosition.xy);
      dirInnerSidePenumbra[0] = wall2d[0].subtract(uLightPosition.xy);
    }
    if ( aWallCorner1.w == this.constructor.EV_ENDPOINT_LINKED_CONCAVE ) {
      dirOuterSidePenumbra[1] = wall2d[1].subtract(uLightPosition.xy);
      dirInnerSidePenumbra[1] = wall2d[1].subtract(uLightPosition.xy);
    }
    return { dirInnerSidePenumbra, dirMidSidePenumbra, dirOuterSidePenumbra };
  }

  normalizedPenumbraVectors() {
    let { dirInnerSidePenumbra, dirMidSidePenumbra, dirOuterSidePenumbra } = this.calculatePenumbra();
    dirInnerSidePenumbra = this._cleanDirectionalVector(dirInnerSidePenumbra);
    dirMidSidePenumbra = this._cleanDirectionalVector(dirMidSidePenumbra);
    dirOuterSidePenumbra = this._cleanDirectionalVector(dirOuterSidePenumbra);
    return { dirInnerSidePenumbra, dirMidSidePenumbra, dirOuterSidePenumbra };
  }

  drawPenumbra(dist = canvas.dimensions.maxR) {
    const { dirInnerSidePenumbra, dirMidSidePenumbra, dirOuterSidePenumbra } = this.normalizedPenumbraVectors();
    const { wall2d } = this;

    Draw.segment({ a: wall2d[0], b: wall2d[1] }); // Wall

    const inner0 = wall2d[0].add(dirInnerSidePenumbra[0].multiplyScalar(dist));
    const inner1 = wall2d[1].add(dirInnerSidePenumbra[1].multiplyScalar(dist));
    Draw.segment({ a: wall2d[0], b: inner0 }, { color: Draw.COLORS.red });
    Draw.segment({ a: wall2d[1], b: inner1 }, { color: Draw.COLORS.red });

    const mid0 = wall2d[0].add(dirMidSidePenumbra[0].multiplyScalar(dist));
    const mid1 = wall2d[1].add(dirMidSidePenumbra[1].multiplyScalar(dist));
    Draw.segment({ a: wall2d[0], b: mid0 }, { color: Draw.COLORS.orange });
    Draw.segment({ a: wall2d[1], b: mid1 }, { color: Draw.COLORS.orange });

    const outer0 = wall2d[0].add(dirOuterSidePenumbra[0].multiplyScalar(dist));
    const outer1 = wall2d[1].add(dirOuterSidePenumbra[1].multiplyScalar(dist));
    Draw.segment({ a: wall2d[0], b: outer0 }, { color: Draw.COLORS.yellow });
    Draw.segment({ a: wall2d[1], b: outer1 }, { color: Draw.COLORS.yellow });

    return { inner0, inner1, mid0, mid1, outer0, outer1 };
  }

  calculateZChange() {
    const uLightPosition = this._uniforms.uLightPosition;
    const aWallCorner0 = this._inVars.aWallCorner0;

    const lightSizeVec = new vec3(0.0, 0.0, this.lightSize);
    const dirLightWallTop = aWallCorner0.xyz.subtract(uLightPosition);
    const dirLightWallBottom = this.wallBottom0.subtract(uLightPosition);
    const zChangeLightWallTop = new vec3(
      dirLightWallTop.add(lightSizeVec).normalize().z,
      dirLightWallTop.normalize().z,
      dirLightWallTop.subtract(lightSizeVec).normalize().z
    );
    const zChangeLightWallBottom = new vec3(
      dirLightWallBottom.add(lightSizeVec).normalize().z,
      dirLightWallBottom.normalize().z,
      dirLightWallBottom.subtract(lightSizeVec).normalize().z
    )
    return { zChangeLightWallTop, zChangeLightWallBottom };
  }

  calculateSidePenumbra() {
    const { zChangeLightWallTop, zChangeLightWallBottom } = this.calculateZChange();
    const { dirInnerSidePenumbra, dirMidSidePenumbra, dirOuterSidePenumbra } = this.normalizedPenumbraVectors();
    const { wall2d, wallTopZ, maxR } = this;

    const sideUmbra = [new vec2(), new vec2()];
    const sideMidPenumbra = [new vec2(), new vec2()];
    const sidePenumbra = [new vec2(), new vec2()];

    // Determine where the light ray hits the canvas when passing through one of the endpoints.
    // This marks the furthest extension of the shadow from the wall.
    const closerIdx = 0;
    const furtherIdx = 1;
    const farLightRayZChange = zChangeLightWallTop.b;
    const wall0Top3d = new vec3(wall2d[0].x, wall2d[0].y, wallTopZ);
    if ( farLightRayZChange < 0.0 ) {
      const dir = (new vec3(dirMidSidePenumbra[0].x, dirMidSidePenumbra[0].y, farLightRayZChange)).normalize();
      const ixCanvas = new vec3();
      intersectRayPlane(new GLSLRay(wall0Top3d, dir), this.canvasPlane, ixCanvas);
      sideMidPenumbra[0] = ixCanvas.xy;

    } else {
     // Infinite shadow.
     // Use the closer wall endpoint to project the ray from the endpoint a given distance
     const closerIdx = uLightPosition.xy.distanceSquared(wall2d[0]) < uLightPosition.xy.distanceSquared(wall2d[1]) ? 0 : 1;
     furtherIdx = closerIdx % 2;
     const penumbraCloser = (new GLSLRay2d(wall2d[closerIdx], dirMidSidePenumbra[closerIdx])).normalize();
     sideMidPenumbra[closerIdx] = penumbraCloser.project(maxR);
    }

    // Construct a parallel ray to the wall and use that to intersect the further penumbra ray.
    const farParallelRay = new GLSLRay2d(sideMidPenumbra[closerIdx], this.wallDir);
    lineLineIntersectionRay(farParallelRay, new GLSLRay2d(wall2d[furtherIdx], dirMidSidePenumbra[furtherIdx]), sideMidPenumbra[furtherIdx]);

    // Use the parallel ray to intersect the other side penumbra rays.
    lineLineIntersectionRay(farParallelRay, new GLSLRay2d(wall2d[0], dirOuterSidePenumbra[0]), sidePenumbra[0]);
    lineLineIntersectionRay(farParallelRay, new GLSLRay2d(wall2d[1], dirOuterSidePenumbra[1]), sidePenumbra[1]);
    lineLineIntersectionRay(farParallelRay, new GLSLRay2d(wall2d[0], dirInnerSidePenumbra[0]), sideUmbra[0]);
    lineLineIntersectionRay(farParallelRay, new GLSLRay2d(wall2d[1], dirInnerSidePenumbra[1]), sideUmbra[1]);

    // Construct a new light position based on the xy intersection of the outer penumbra points --> wall corner
    const newLightCenter = new vec2();
    lineLineIntersectionVector(sidePenumbra[0], wall2d[0], sidePenumbra[1], wall2d[1], newLightCenter);

    // For testing.
    const sideLightCenter = newLightCenter;
    const midLightCenter = new vec2();
    const umbraLightCenter = new vec2();
    lineLineIntersectionVector(sideMidPenumbra[0], wall2d[0], sideMidPenumbra[1], wall2d[1], midLightCenter);
    lineLineIntersectionVector(sideUmbra[0], wall2d[0], sideUmbra[1], wall2d[1], umbraLightCenter);

    return { sideUmbra, sideMidPenumbra, sidePenumbra, newLightCenter, sideLightCenter, midLightCenter, umbraLightCenter};
  }

  /**
   * Draw the points of the side penumbra and segments to each.
   */
  drawSidePenumbra() {
    const { sideUmbra, sideMidPenumbra, sidePenumbra, sideLightCenter, midLightCenter, umbraLightCenter } = this.calculateSidePenumbra();
    const { wall2d } = this;

    Draw.segment({ a: wall2d[0], b: wall2d[1] }); // Wall

    Draw.segment({ a: wall2d[0], b: sideUmbra[0] }, { color: Draw.COLORS.red });
    Draw.segment({ a: wall2d[1], b: sideUmbra[1] }, { color: Draw.COLORS.red });
    Draw.point(sideUmbra[0], { color: Draw.COLORS.red })
    Draw.point(sideUmbra[1], { color: Draw.COLORS.red })

    Draw.segment({ a: wall2d[0], b: sideMidPenumbra[0] }, { color: Draw.COLORS.orange });
    Draw.segment({ a: wall2d[1], b: sideMidPenumbra[1] }, { color: Draw.COLORS.orange });
    Draw.point(sideMidPenumbra[0], { color: Draw.COLORS.orange })
    Draw.point(sideMidPenumbra[1], { color: Draw.COLORS.orange })

    Draw.segment({ a: wall2d[0], b: sidePenumbra[0] }, { color: Draw.COLORS.yellow });
    Draw.segment({ a: wall2d[1], b: sidePenumbra[1] }, { color: Draw.COLORS.yellow });
    Draw.point(sidePenumbra[0], { color: Draw.COLORS.yellow })
    Draw.point(sidePenumbra[1], { color: Draw.COLORS.yellow })

    // Light centers
    Draw.point(this._uniforms.uLightPosition, { color: Draw.COLORS.white, radius: this.lightSize * 0.5 });
    Draw.point(sideLightCenter, { color: Draw.COLORS.yellow });
    Draw.point(midLightCenter, { color: Draw.COLORS.orange });
    Draw.point(umbraLightCenter, { color: Draw.COLORS.red });
  }

  /**
   * Raise the shadow coordinates to a given elevation plane.
   */
  raiseToElevation(elevationZ) {

  }

 /**
  * Make sure the vector does not exceed the wall angle (i.e., does not go the "light" side)
  */
 _cleanDirectionalVector(dirArr, wall2d, oWallLight) {
    // Duplicate the vector for testing purposes.
    dirArr = [dirArr[0].xy, dirArr[1].xy];

    wall2d ??= this.wall2d;
    oWallLight ??= this.oWallLight;
    let oWallPenumbra = Math.sign(foundry.utils.orient2dFast(wall2d[0], wall2d[1], wall2d[0].add(dirArr[0])));
    if ( oWallPenumbra == oWallLight ) dirArr[0] = wall2d[0].subtract(wall2d[1]);

    oWallPenumbra = Math.sign(foundry.utils.orient2dFast(wall2d[0], wall2d[1], wall2d[1].add(dirArr[1])));
    if ( oWallPenumbra == oWallLight ) dirArr[1] = wall2d[1].subtract(wall2d[0]);

    dirArr[0] = dirArr[0].normalize();
    dirArr[1] = dirArr[1].normalize();
    return dirArr;
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
let { SizedPointSourceShadowWallVertexShaderTest, vec2, vec3, vec4 } = api.testing

l = canvas.lighting.placeables[0];
edge0 = canvas.walls.placeables[0].edge
edge1 = canvas.walls.placeables[1].edge
ev = l.lightSource.elevatedvision


shader0 = SizedPointSourceShadowWallVertexShaderTest.fromEdgeAndSource(edge0, l.lightSource)
shader1 = SizedPointSourceShadowWallVertexShaderTest.fromEdgeAndSource(edge1, l.lightSource)

// Change to canvas surface elevation
// shader0._uniforms.uElevationRes[0] = 0
// shader1._uniforms.uElevationRes[0] = 0

shader0.drawPenumbra()
shader1.drawPenumbra()

resPenumbra = shader0.calculatePenumbra();
resZChange = shader0.calculateZChange()
resSidePenumbra = shader0.calculateSidePenumbra();

resPenumbra = shader0.calculatePenumbra();
resZChange = shader0.calculateZChange();
resSidePenumbra = shader0.calculateSidePenumbra();

shader0.drawSidePenumbra()
shader1.drawSidePenumbra()


*/

