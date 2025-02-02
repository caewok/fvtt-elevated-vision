/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI
*/
"use strict";

import { MODULE_ID } from "../const.js";
import { Draw } from "../geometry/Draw.js";
import { vec2, vec3, vec4 } from "../testing/glsl_mock.js";
import * as glsl from "../testing/glsl_mock.js";
import { extractPixelsAdvanced } from "../geometry/extract-pixels.js";


/* Bounded Volume Hierarchy (BVH)
See:
https://alister-chowdhury.github.io/posts/20230620-raytracing-in-2d/
https://www.scratchapixel.com/lessons/3d-basic-rendering/introduction-acceleration-structure/what-else.html
https://jacco.ompf2.com/2022/04/13/how-to-build-a-bvh-part-1-basics/

Store a BVH of the edges. Used to test edges in the frag shader for collisions.
1 BVH per light. (1 per vision but not necessary as vision works well using geometry approach.)
*/

/* GLSL
struct BVHNode {
  vec2 aabbMin; // 2d version.
  vec2 aabbMax; // 2d version.
  uint leftFirst;
  uint triCount;
}
// triCount == 0, leftFirst is index of left child node.
// triCount == 1; leftFirst is index of triangle or wall

struct WallData {
  vec3
}

struct Segment3d {
  vec3 origin;
  vec3 destination;
  vec3 direction;
  vec3 invDirection;
  float t;
}

*/

function isEven(n) { return n % 2 === 0; }

function isOdd(n) { return n % 2 !== 0; }

/**
 * Intersect ray with plane
 * https://www.scratchapixel.com/lessons/3d-basic-rendering/minimal-ray-tracer-rendering-simple-shapes/ray-plane-and-ray-disk-intersection.html
 * https://tavianator.com/2011/ray_box.html
 * @param {Plane} plane
 * @param {Ray} ray
 * @returns {float|null} T-value or null if no intersection.
 * In GLSL, t is an out variable.
 */
function planeRayIntersection(plane, ray) {
  const denom = glsl.dot(plane.normal, ray.direction);
  if ( denom.almostEqual(0) ) return null;
  const delta = plane.point.subtract(ray.origin);
  return glsl.dot(delta, plane.normal) / denom;
}

/**
 * Intersect ray with 2d vertical rectangle.
 * @param {Plane} plane
 * @param {Ray} ray
 * @param {vec3} a      Where z is the top elevation
 * @param {vec3} b      Where z is the bottom elevation
 * @returns {float|null} T-value or null if no intersection.
 * In GLSL, t is an out variable.
 */
function intersectVerticalRectangleRay(plane, ray, a, b) {
  const t = planeRayIntersection(plane, ray);
  if ( t == null ) return null;
  if ( t < 0.0 || (t*t) > ray.t2 ) return null;
  const ix = glsl.projectRay(ray, t);

  // Within vertical extent.
  if ( ix.z > a.z || ix.z < b.z ) return null;

  // Within the 2d endpoints.
  const dist2Endpoints = glsl.distanceSquared(a.xy, b.xy);
  const dist2A = glsl.distanceSquared(a.xy, ix.xy);
  if ( dist2A > dist2Endpoints ) return null;
  const dist2B = glsl.distanceSquared(b.xy, ix.xy);
  if ( dist2B > dist2Endpoints ) return null;
  return t;
}

/**
 * Intersect a 2d bounding box.
 * @param {Ray|Ray2d} ray
 * @param {vec2} bmin
 * @param {vec2} bmax
 */
function intersect2dBounds(ray, bmin, bmax) {
  const { origin, invDirection, t2 } = ray;
  const minXY = bmin.subtract(origin.xy).multiply(invDirection.xy);
  const maxXY = bmax.subtract(origin.xy).multiply(invDirection.xy);

  const minVals = glsl.min(minXY, maxXY);
  const maxVals = glsl.max(minXY, maxXY);
  const tmax = Math.min(maxVals.x, maxVals.y);
  const tmin = Math.max(minVals.x, minVals.y);
  return tmax > 0.0 && tmax >= tmin && t2 > (tmin * tmin);
}

/** Track all edges in the scene in a data texture.
Each row is an edge.
Properties:
- a.x. Integer. 0 to maximum canvas size, which is unlikely to exceed 32768.
- a.y. Integer. 0 to maximum canvas size.
- b.x. Integer. 0 to maximum canvas size.
- b.y. Integer. 0 to maximum canvas size.
- top. Float. No clear max/min although it would be rare to see negatives or large positive elevations.
- bottom. Float. Same restrictions as top.
  - Could use max/min values to signify infinity.
- type. Integer. CONST.WALL_SENSE_TYPES: 0–40 at the moment, although only 5 values total.
- threshold. Positive float. 0 if none. Distance to wall otherwise. Max distance is canvas diameter.
  - Likely cannot exceed sqrt(32768^2 + 32768^2) ~ 46340.

Ideally, use texture with small bits?
- type: needs 3 bits (8)
- a.x, a.y, b.x, b.y: needs 15 bits (32,768)
- top, bottom:
  - 2^15: store 32,768. For tenth of decimal, could store -1100 to 2100. (0 to 32000)
  - 2^16: store 65,536. For tenth of decimal, could store -3000 to 3500 (0 to 65000)
  - Alt: store decimals; divide by 10. 0 to 2000 would be 0 to 20,000.
    -> 2^15 to store 32768
- threshold: 0 to 46340.
  -> 2^16: 65,536 (integer)
  -> 2^19: 524,288 (tenth of decimal)
  -> 2^32: 4.29 million (nearly one hundreth of decimal; would drop the largest thresholds)
- type: 0 to 3. (normal, limited, proximity, distance)
  -> 2^2

(Storing squared values is too large:
  Assume squared distances between -1000 and 1000. 0 to 2000 is 0 to 4 million.
    -> 2^32 to store 4.29 million)

Store in RBGA8. 8 bits * 4 * 4 = 128 bits; 16 bytes.
4 pulls; maybe could get down to 3.
a.x | a.x | a.y | a.y || b.x | b.x | b.y | b.y || top | top | bottom | bottom || type | threshold | threshold | ? |

--> Store in RGBA16UI. 16 bits * 4 * 2 = 128 bits; 16 bytes.
a.x | a.y | b.x | b.y || type | top | bottom | threshold ||

Store in RGB10_A2. 32 bits * 4 = 128 bits; 16 bytes.
Could use other alpha channels to signify positive/negative for top, bottom.
 - 0: infinite, 1 positive, 2 negative, 3 ? multiply by 10? divide by 10?
 - Top/bottom then could use a single channel, 2^10 = 1024?
 - Threshold single channel would store 1024; 2 channel would be 2^20.
- Three pulls for most data.
a.x | a.x | a.y | type || b.x | b.x | a.y | topSwitch ||
b.y | b.y | threshold | bottomSwitch || threshold | top | bottom | ? ||


Store in RGBA16F. 16 bits * 4 * 2 = 128 bits
a.x | a.x | a.y | a.y || b.x | b.x | b.y | b.y ||
top | top | bottom | bottom || type | threshold | threshold | ? |

threshold: 2^16. 65,536 max. 0 means none.
- light
- sight
- sound

senseType: 2^16. {NONE: 0, LIMITED: 10, NORMAL: 20, PROXIMITY: 30, DISTANCE: 40}. Binary encode.
- light
- sight
- sound
- move

--> Store in RGBA16UI.
a.x | a.y | b.x | b.y || senseType | top | bottom | ? || thresholdLight | thresholdSight | thresholdSound | ? ||
--> Could use alpha channels to increase resolution of top, bottom, thresholds.

Remap as bit operators.
light sight sound move
000 000 000 000  => 2^12

000 is 0 (NONE)
001 is 1 (LIMITED)
010 is 2 (NORMAL)
011 is 3 (PROXIMITY)
100 is 4 (DISTANCE)

See https://bitwisecmd.com

binLight = num => Math.floor(num * 0.1) << 9;
binSight = num => Math.floor(num * 0.1) << 6;
binSound = num => Math.floor(num * 0.1) << 3;
binMove = num => Math.floor(num * 0.1);

encodeEdgeTypes = function({ light = 0, sight = 0, sound = 0, move = 0} = {}) {
  // light xxx 000 000 000
  // sight 000 xxx 000 000
  // sound 000 000 xxx 000
  // move  000 000 000 xxx
  return binLight(light) | binSight(sight) | binSound(sound) | binMove(move)
}

decodeEdgeTypes = function(n) {
  const sightMask = 7 << 6; // 000 111 000 000
  const soundMask = 7 << 3; // 000 000 111 000
  const moveMask = 7;       // 000 000 000 111

  return {
    light: (n >> 9) * 10,
    sight: ((n & sightMask) >>> 6) * 10,
    sound: ((n & soundMask) >>> 3) * 10,
    move: ((n & moveMask) >>> 0) * 10
  }
}

function binLight(num) {
  const n = num / 10;
  return n << 9
}
function binSight(num) {}
binLight(LIMITED)

*/

/* Track BVH data in a data texture.
Each row is a node.
- leftFirst. Integer. References a wall number or a node number. 2^10 (1024) or 2^16 (65536)
- type. Integer. 0 if node, 1 if leaf (wall).
- aabbMin. ivec2. 0 to maximum canvas size, which is unlikely to exceed 32768. (2^14 to 2^16)
- aabbMax. ivec2. Same as aabbMin.


Uniform variable to track the objIdx?
--> Store in RGBA16UI. 16 bits * 4 * 1 = 64 bits; 8 bytes
leftFirst | type | ? | ? || aabbMin.x | aabbMin.y | aabbMax.x | aabbMax.y ||

Store in RGB10_A2.
aabbMin.x | aabbMin.x | leftFirst | type || aabbMin.y | aabbMin.y | leftFirst | ? ||
aabbMax.x | aabbMax.x | ? | ? || aabbMax.y | aabbMax.y | ? | ? ||

*/

export class EdgeData {
  /** @type {Edge} */
  edge;

  /** @type {string} */
  id = "";

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  sourceType = "light";

  constructor(edge, sourceType = "light") {
    this.edge = edge;
    this.id = edge.id;
    this.sourceType = sourceType;
  }

  // ---- NOTE: Property getters ----- //

  /** @type {vec2} */
  get a() { return vec2(this.edge.a.x, this.edge.a.y); }

  /** @type {vec2} */
  get b() { return vec2(this.edge.b.x, this.edge.b.y); }

  /** @type {float} */
  get top() { return this.edge.elevationLibGeometry.a.top ?? 1.0e06; }

  /** @type {float} */
  get bottom() { return this.edge.elevationLibGeometry.a.bottom ?? -1.0e06; }

  /** @type {CONST.WALL_SENSE_TYPES} */
  get senseType() { return this.edge[this.sourceType]; }

  /** @type {bool} */
  get thresholdIsAttenuated() { return this.edge.threshold.attenuation; }

  /** @type {CONST.WALL_SENSE_TYPES} */
  get thresholdAttenuation() { return this.edge.threshold[this.sourceType]; }

  /** @type {vec3} */
  get normal() {
    const { a, b, top, bottom } = this;
    const pt0 = vec3(a, top);
    const pt1 = vec3(b, top);
    const pt2 = vec3(a, bottom);
    return glsl.cross(pt1.subtract(pt0), pt2.subtract(pt0));
  }

  /** @type {Plane} */
  get plane() { return glsl.Plane(vec3(this.a, this.top), this.normal); }

  // ----- NOTE: Simple getter calculations ----- //

  /**
   * @type {object}
   * - @prop {vec2} min
   * - @prop {vec2} max
   */
  get aabb() {
    const { a, b } = this;
    const xMinMax = Math.minMax(a.x, b.x);
    const yMinMax = Math.minMax(a.y, b.y);
    return {
      min: vec2(xMinMax.min, yMinMax.min),
      max: vec2(xMinMax.max, yMinMax.max)
    };
  }

  /** @type {vec2} */
  get centroid() { return this.a.add(this.b).multiplyScalar(0.5); }

  /** @type {PIXI.Rectangle} */
  get boundsRect() {
    const aabb = this.aabb;
    return new PIXI.Rectangle(
      aabb.min.x,
      aabb.min.y,
      aabb.max.x - aabb.min.x,
      aabb.max.y - aabb.min.y
    );
  }

  // ----- NOTE: Texture storage ----- //


  /**
   * Encode the edge top and bottom.
   * Currently, evenly split among the 65,536 values.
   * 0 is negative infinity; 65535 is positive infinity, 65534 / 2 is the ± split.
   */
  static encodeEdgeElevation(edge) {
    const elevation = edge.elevationLibGeometry;
    const max = 65535;
    const split = 32768; // 2^16 / 2
    const maxTop = max - split;

    // If null, treat as infinite. If outside the range, treat as infinite.
    // TODO: Could add more sophisticated resolution given another pixel channel to use.
    const edgeTop = glsl.clamp(edge.a.top ?? maxTop, -split, maxTop);
    const edgeBottom = glsl.clamp(edge.a.bottom ?? -split, -split, maxTop);
    return {
      top: edgeTop + split,
      bottom: edgeBottom + split
    };
  }

  static decodeEdgeElevation(n) {
    const max = 65535;
    const split = 32768;
    if ( n === max ) return Number.POSITIVE_INFINITY;
    if ( n === 0 ) return Number.NEGATIVE_INFINITY;
    return (n - 32768);
  }

  static EDGE_TYPE_OFFSET = {
    light: 9,
    sight: 6,
    sound: 3,
    move: 0
  };

  /**
   * Encode the edge types.
   * @param {object} opts
   * @param {CONST.WALL_SENSE_TYPES} [opts.light = 0]
   * @param {CONST.WALL_SENSE_TYPES} [opts.sight = 0]
   * @param {CONST.WALL_SENSE_TYPES} [opts.sound = 0]
   * @param {CONST.WALL_SENSE_TYPES} [opts.move = 0]
   * @returns {int}
   */
  static encodeEdgeTypes({ light = 0, sight = 0, sound = 0, move = 0} = {}) {
    // Light xxx 000 000 000
    // Sight 000 xxx 000 000
    // Sound 000 000 xxx 000
    // Move  000 000 000 xxx

    /* Equivalent given move offset of 0:
    binMove = num => Math.floor(num * 0.1);
    */

    const offset = this.EDGE_TYPE_OFFSET;
    const binLight = num => Math.floor(num * 0.1) << offset.light;
    const binSight = num => Math.floor(num * 0.1) << offset.sight;
    const binSound = num => Math.floor(num * 0.1) << offset.sound;
    const binMove = num => Math.floor(num * 0.1) << offset.move;
    return binLight(light) | binSight(sight) | binSound(sound) | binMove(move);
  }

  /**
   * Decode the edge types.
   * @param {int} n         The value provided by encodeEdgeTypes
   * @returns {object}
   *   - @prop {CONST.WALL_SENSE_TYPES} light
   *   - @prop {CONST.WALL_SENSE_TYPES} sight
   *   - @prop {CONST.WALL_SENSE_TYPES} sound
   *   - @prop {CONST.WALL_SENSE_TYPES} move
   */
  static decodeEdgeTypes(n) {
    const offset = this.EDGE_TYPE_OFFSET;
    const lightMask = 7 << offset.light;  // 111 000 000 000
    const sightMask = 7 << offset.sight;  // 000 111 000 000
    const soundMask = 7 << offset.sound;  // 000 000 111 000
    const moveMask = 7 << offset.move;    // 000 000 000 111

    /* Equivalent given light offset of 9 and move offset of 0:
    moveMask = 7;
    light: (n >> 9) * 10
    */

    return {
      light: ((n & lightMask) >> offset.light) * 10,
      sight: ((n & sightMask) >> offset.sight) * 10,
      sound: ((n & soundMask) >> offset.sound) * 10,
      move:  ((n & moveMask)  >> offset.move)  * 10 /* eslint-disable-line no-multi-spaces,key-spacing */
    };
  }

  /** @type {Edge} */
  // TODO: Add region edges from Terrain Mapper.
  static get edges() { return [...canvas.edges.values()].filter(edge => edge.type === "wall"); }

  /**
   * Copy the relevant bvh data to an array.
   */
  static copyEdgesToArray(arr) {
    const edges = this.edges;
    const height = edges.length;
    const width = 3;
    const channels = 4;
    arr ??= new Uint16Array(width * height * channels);
    if ( arr.length !== width * height * channels ) console.error(`${MODULE_ID}|copyToArray|Array is wrong length. Should be ${width * height * channels} but is actually ${arr.length}`);

    // || a.x | a.y | b.x | b.y || senseType | top | bottom | ? || threshLight | threshSight | threshSound | ? ||
    // TODO: Use alpha channels to increase resolution of top, bottom, thresholds.
    // Could encode ± for top,bottom, along with multiplier or divider by 10 or 100 for both.
    // May eventually need separate top.a, bottom.a, top.b, bottom.b values.
    const maxValue = 65535; // 2^16 - 1.
    for ( let i = 0; i < height; i += 1 ) {
      const edge = edges[i];
      const r = i * width * channels;
      const elevation = this.encodeEdgeElevation(edge);
      const t = edge.threshold;

      arr[r + 0] = edge.a.x;
      arr[r + 1] = edge.a.y;
      arr[r + 2] = edge.b.x;
      arr[r + 3] = edge.b.y;

      arr[r + 4] = this.encodeEdgeTypes(edge);
      arr[r + 5] = elevation.top;
      arr[r + 6] = elevation.bottom;
      // Unused arr[r + 7] =

      arr[r + 8] = glsl.clamp(t.attenuation ? t.light : 0, 0, maxValue);
      arr[r + 9] = glsl.clamp(t.attenuation ? t.sight : 0, 0, maxValue);
      arr[r + 10] = glsl.clamp(t.attenuation ? t.sound : 0, 0, maxValue);
      // Unused arr[r + 11] =
    }
    return arr;
  }

  static textureConfiguration() {
    // See https://webgl2fundamentals.org/webgl/lessons/webgl-data-textures.html
    // RGBA16UI.
    // || a.x | a.y | b.x | b.y || senseType | top | bottom | ? || threshLight | threshSight | threshSound | ? ||
    const edges = this.edges;
    const height = edges.length;
    const width = 3;
    return {
      resolution: 1,
      width,
      height,
      mipmap: PIXI.MIPMAP_MODES.OFF,
      scaleMode: PIXI.SCALE_MODES.NEAREST,
      multisample: PIXI.MSAA_QUALITY.NONE,
      format: PIXI.FORMATS.RGBA_INTEGER,
      type: PIXI.TYPES.UNSIGNED_SHORT
    };
  }

  /**
   * Create a texture that can store the edge data.
   * @param {object} [config={}]    Changes from textureConfiguration.
   * @returns {PIXI.RenderTexture}
   */
  static createTexture(config = {}) {
    config = foundry.utils.mergeObject(this.textureConfiguration(), config);
    return PIXI.RenderTexture.create(config);
  }

  /**
   * Create a pixel cache from the texture.
   * @param {PIXI.RenderTexture}
   * @returns {object}
   * - @prop {Uint16Array} pixels
   * - @prop {number} x
   * - @prop {number} y
   * - @prop {number} width
   * - @prop {number} height
   */
  static createPixelCache(texture) {
    texture ??= this.createTexture();
    const gl = canvas.app.renderer.gl;
    const edgeCache = extractPixelsAdvanced(canvas.app.renderer, texture,
      { format: gl.RGBA_INTEGER, type: gl.UNSIGNED_SHORT });
    this.copyEdgesToArray(edgeCache.pixels);
    return edgeCache;
  }

  // ----- NOTE: Debugging ----- //

  /**
   * Intersect the edge representing a vertical wall.
   * @param {Segment3d} ray
   * @returns {bool}
   */
  hasBoundsIntersection(ray) {
    const aabb = this.aabb;
    return intersect2dBounds(ray, aabb.min, aabb.max);
  }

  hasObjectIntersection(ray) {
    if ( intersectVerticalRectangleRay(this.plane, ray, this.a, this.b) == null ) return false;
    return true;
  }

  /**
   * Draw this edge.
   */
  drawEdge(opts = {}) { Draw.segment(this.edge, opts); }

  drawCentroid(opts = {}) { Draw.point(this.centroid, opts); }

  drawBounds(opts = {}) { Draw.shape(this.boundsRect, opts); }
}

class BVHNode {
  /** @type {object} */
  aabb = {
    min: vec2(0.0),
    max: vec2(canvas.dimensions.width, canvas.dimensions.height)
  };

  /** @type {uint} */
  leftFirst = 0;

  /** @type {uint} */
  objCount = 0;

  /** @type {bool} */
  get isLeaf() { return this.objCount > 0.0; }

  /** @type {object[]} */
  objData = [];

  /** @type {int[]} */
  objIdx = [];

  /**
   * @param {object[]} objData    Array holding the data objects referenced by nodes
   * @param {int[]} objIdx        Array holding indices referencing the data objects
   */
  constructor(objData = [], objIdx = []) {
    this.objData = objData;
    this.objIdx = objIdx;
  }

  /**
   * Update the bounds for this node based on the walls.
   */
  updateBounds() {
    // Reset bounds.
    const aabb = this.aabb;
    aabb.min = vec2(Number.POSITIVE_INFINITY);
    aabb.max = vec2(Number.NEGATIVE_INFINITY);

    // Cycle through each data object in the node.
    for ( let i = 0; i < this.objCount; i += 1 ) {
      // Pull the associated triangle data.
      const leafObjIdx = this.objIdx[this.leftFirst + i];
      const leafObj = this.objData[leafObjIdx];

      // Check the minimums/maximums of each vertex.
      const objBounds = leafObj.aabb;
      aabb.min = glsl.min(aabb.min, objBounds.min);
      aabb.max = glsl.max(aabb.max, objBounds.max);
    }
  }

  /** @type {PIXI.Rectangle} */
  get boundsRect() {
    const aabb = this.aabb;
    return new PIXI.Rectangle(
      aabb.min.x,
      aabb.min.y,
      aabb.max.x - aabb.min.x,
      aabb.max.y - aabb.min.y
    );
  }

  /**
   * Intersect the bounding box.
   * 2d version.
   * TODO: See https://tavianator.com/2022/ray_box_boundary.html
   * @param {Segment3d} ray
   * @returns {bool}
   */
  hasBoundsIntersection(ray) {
    const { min: bmin, max: bmax } = this.aabb;
    return intersect2dBounds(ray, bmin, bmax);
  }

  hasObjectIntersection(ray) {
    // If more than one object, retest the bounds.
    switch ( this.objCount ) {
      case 0: return false;
      case 1: return this.objData[this.objIdx[this.leftFirst]].hasObjectIntersection(ray);
      default: {
        for ( let i = 0; i < this.objCount; i += 1 ) {
          const obj = this.objData[this.objIdx[this.leftFirst + i]];
          if ( !obj.hasBoundsIntersection(ray) ) continue;
          if ( obj.hasObjectIntersection(ray) ) return true;
        }
      }
    }
    return false;
  }

  sah() {
    const { min: bmin, max: bmax } = this.aabb;
    return this.objCount * glsl.distance(bmax, bmin);
  }

  // ----- NOTE: Debugging ----- //

  /**
   * Draw the rectangle for this node.
   */
  drawBounds(opts = {}) { Draw.shape(this.boundsRect, opts); }

  /**
   * String object describing this node.
   */
  description(idx = 0) {
    return {
      node: `node ${idx.toString().padStart(5)}`,
      leftFirst: `lf ${this.leftFirst.toString().padStart(7)}`,
      objCount: `objs ${this.objCount.toString().padStart(5)}`,
      sah: `SAH ${Math.round(this.sah()).toString().padStart(6)}`
    };
  }
}

/**
 * See https://jacco.ompf2.com/2022/04/13/how-to-build-a-bvh-part-1-basics/
 * https://alister-chowdhury.github.io/posts/20230620-raytracing-in-2d/
 * https://github.com/alister-chowdhury/alister-chowdhury.github.io/blob/master/_source/res/bvh_v1/generate_bvh_v1.cpp
 * To facilitate use with webGL, use a b-tree approach where each end node refers to a single
 * edge. Thus, the end node's bbox is the same as the edge's bbox.
 */
export class BVH {
  /** @type {BVHNode} */
  get root() { return this.nodes[0]; }

  /** @type {BVHNode[]} */
  nodes = [];

  /** @type {object[]} */
  objData = [];

  /** @type {int[]} */
  objIdx = [];

  /** @type {int} */
  nodesUsed = 0;

  /** @type {PIXI.RenderTexture} */
  texture; // Store the bvh data for use in shader.

  /** @type {Uint16Array} */
  cache; // Pixel cache for the bvh texture.

  constructor(objData, objIdx) {
    this.objData = objData;
    this.objIdx = objIdx;
    const N = objIdx.length;
    this.nodes.length = (N * 2 ) - 1;
    this.nodes[0] = new BVHNode(this.objData, this.objIdx);
    this.nodesUsed += 1;
    this.root.objCount = N;
  }

  static build(objData, objIdx) {
    const bvh = new this(objData, objIdx);
    bvh.root.leftFirst = 0;
    bvh.root.updateBounds();

    // Subdivide recursively
    bvh.subdivide(0);
    return bvh;
  }

  /**
   * Subdivide the BVH tree.
   * @param {int} nodeIdx
   */
  subdivide(nodeIdx) {
    // Terminate recursion.
    const node = this.nodes[nodeIdx];
    const N = node.objCount;
    // console.log(`nodeIdx ${nodeIdx} objCount ${N} leftFirst ${node.leftFirst}`);

    if ( N <= 1 ) return;
    if ( N === 2 ) return this._split(node, 1);
    if ( N === 3 ) {
      this._split(node, 1);
      const rightChildIdx = this.nodesUsed - 1;
      this.subdivide(rightChildIdx);
      return;
    }

    // Use SAH to calculate the cost of splitting, and attempt to minimize.
    // Force an even number of entries by pulling out the largest edge at the root node
    // if not even.
    if ( nodeIdx === 0 && isOdd(N) ) {
      let largestIdx = 0;
      let largestDiameter = 0;
      for ( let i = 0; i < N; i += 1 ) {
        const obj = this.objData[this.objIdx[i]];
        const aabb = obj.aabb;
        const diam2 = glsl.distanceSquared(obj.aabb.max, obj.aabb.min);
        if ( diam2 > largestDiameter ) {
          largestDiameter = diam2;
          largestIdx = i;
        }
      }
      // Split out the largest.
      this._swap(0, largestIdx);
      this._split(node, 1); // Pull out the largest
    } else {
      if ( isOdd(N) ) return console.error(`N is ${N}! at nodeIdx ${nodeIdx}`, node);

      const cost0 = this._evaluateSAH(node, 0);
      const cost1 = this._evaluateSAH(node, 1);

      // Redo the sort for the split b/c it was changed by cost calculation.
      const best = cost0.sah < cost1.sah ? cost0 : cost1;
      this._swapAtPosition(node, best.splitPosition, best.axis);
      this._split(node, best.leftCount);
    }

    // Recurse. See setting of leftChildIdx and rightChildIdx in #split.
    const leftChildIdx = this.nodesUsed - 2;
    const rightChildIdx = this.nodesUsed - 1;
    this.subdivide(leftChildIdx);
    this.subdivide(rightChildIdx);
  }

  _evaluateSAH(node, axis = 0) {
    // Sort the object centroids from low to high; pick numLeft as the test position.
    const n = node.objCount;
    const splitOptions = Array(node.objCount);
    for ( let i = 0; i < n; i += 1 ) splitOptions[i] = this.objData[this.objIdx[node.leftFirst + i]].centroid[axis];
    splitOptions.sort((a, b) => a - b);

    // Test different even splits. E.g. for n = 6: 2, 4 and 4, 2.
    // Assumes n >= 4.
    const out = {
      splitPosition: splitOptions[0],
      sah: Number.POSITIVE_INFINITY,
      leftCount: 0,
      axis
    };
    for ( let leftCount = 2; leftCount < n; leftCount += 2 ) {
      const splitPosition = splitOptions[leftCount];

      // Per above, the chosen position will split the centroids into exactly two groups
      // unless the chosen position has multiple equal centroids.
      // Sort along the chosen split position.
      this._swapAtPosition(node, splitPosition, axis);

      // Calculate the bboxes for each half.
      // Because we are lazy, create new BVHNodes based on the split. See #split.
      const leftNode = new BVHNode(this.objData, this.objIdx);
      const rightNode = new BVHNode(this.objData, this.objIdx);
      leftNode.leftFirst = node.leftFirst;
      leftNode.objCount = leftCount;
      rightNode.leftFirst = node.leftFirst + leftCount;
      rightNode.objCount = node.objCount - leftCount;
      const leftDist = glsl.distance(leftNode.aabb.max, leftNode.aabb.min);
      const rightDist = glsl.distance(rightNode.aabb.max, rightNode.aabb.min);
      const sah = leftNode.sah() + rightNode.sah();
      if ( sah < out.sah ) {
        out.sah = sah;
        out.splitPosition = splitPosition;
        out.leftCount = leftCount;
      }
    }
    return out;
  }

  _swapAtPosition(node, splitPosition, axis) {
    // Sort along the chosen split position.
    let i = node.leftFirst;
    let j = i + node.objCount - 1;
    while ( i <= j ) {
      if ( this.objData[this.objIdx[i]].centroid[axis] < splitPosition ) i += 1;
      else this._swap(i, j--);
    }
  }

  _split(node, leftCount) {
    const leftChildIdx = this.nodesUsed++;
    const rightChildIdx = this.nodesUsed++;
    this.nodes[leftChildIdx] = new BVHNode(this.objData, this.objIdx);
    this.nodes[rightChildIdx] = new BVHNode(this.objData, this.objIdx);
    this.nodes[leftChildIdx].leftFirst = node.leftFirst;
    this.nodes[leftChildIdx].objCount = leftCount;
    this.nodes[rightChildIdx].leftFirst = node.leftFirst + leftCount;
    this.nodes[rightChildIdx].objCount = node.objCount - leftCount;
    node.leftFirst = leftChildIdx;
    node.objCount = 0;
    this.nodes[leftChildIdx].updateBounds();
    this.nodes[rightChildIdx].updateBounds();
  }

  /**
   * Swap two data indices in the object index
   * @param {int} idx0
   * @param {int} idx1
   */
  _swap(idx0, idx1) { [this.objIdx[idx1], this.objIdx[idx0]] = [this.objIdx[idx0], this.objIdx[idx1]]; }

  // ----- NOTE: Intersection ----- //

  /**
   * Intersect the bounding boxes with a ray.
   * TODO: Add variable to return the intersecting node to test as a caching mechanism.
   * @param {Ray|Ray2d} ray
   * @param {int} nodeIdx
   * @returns {bool}
   */
  hasIntersection(ray, nodeIdx = 0) {
    const node = this.nodes[nodeIdx];
    if ( !node.hasBoundsIntersection(ray) ) return false;
    if ( node.isLeaf ) {
      if ( node.hasObjectIntersection(ray) ) return true;
    } else {
      // Recurse.
      if ( this.hasIntersection(ray, node.leftFirst) ) return true;
      if ( this.hasIntersection(ray, node.leftFirst + 1) ) return true;
    }
    return false;
  }

  /**
   * TODO: For GLSL, could use a stack version that prioritizes closer bbox distances first.
   * See https://alister-chowdhury.github.io/posts/20230620-raytracing-in-2d/
   * @param {Ray}
   */
  hasIntersectionNonRecursive(ray) {
    // For now, don't bother with fake pulling values from the texture arrays.
    // Handle the root node and return if no collision or there is only 1 edge.
    let currLevel = 0;
    let currNode = this.nodes[0];
    if ( !currNode.hasBoundsIntersection(ray) ) return false;
    if ( currNode.isLeaf ) return currNode.hasObjectIntersection(ray);

    // Track the next node for each level of the tree.
    const stack = new Uint16Array(Math.floor(this.nodes.length * 0.5) + 2); // Plus 1 for root.
    stack[0] = 1;  // Root left child is 1; root right child is 2.
    while ( currLevel >= 0 ) {
      // console.log(`hasIntersectionNonRecursive|currLevel ${currLevel}`, [...stack])

      // Pull the current node.
      currNode = this.nodes[stack[currLevel]];

      // Set the left side for this node.
      stack[currLevel + 1] = currNode.leftFirst;

      // May have the right node remaining. Right is always 1 more than left.
      // Note: left is odd, right is even.
      stack[currLevel] = isEven(stack[currLevel]) ? 0 : stack[currLevel] + 1;

      // Test bounds for this node; if hit, investigate further.
      // If node is leaf, also test object intersection and possibly end early.
      let goDown = currNode.hasBoundsIntersection(ray);
      if ( goDown && currNode.isLeaf ) {
        if ( currNode.hasObjectIntersection(ray) ) return true;
        goDown = false;
      }

      // In next loop, either:
      // 1. Move down to next level.
      // 2. Test the right node.
      // 3. Move up to prior level(s).
      if ( goDown ) currLevel += 1;
      else while ( currLevel >= 0 && stack[currLevel] === 0 ) currLevel -= 1;
    }
    return false;
  }

  // ----- NOTE: Texture storage ----- //

  /**
   * Copy the relevant bvh data to an array.
   */
  copyToArray(arr) {
    const width = 2;
    const height = this.nodes.length;
    const channels = 4;
    arr ??= new Uint16Array(width * height * channels);
    if ( arr.length !== width * height * channels ) console.error(`${MODULE_ID}|copyToArray|Array is wrong length. Should be ${width * height * channels} but is actually ${arr.length}`);

    // || leftFirst | type | ? | ? || aabbMin.x | aabbMin.y | aabbMax.x | aabbMax.y ||
    for ( let n = 0; n < height; n += 1 ) {
      const node = this.nodes[n];
      const aabb = node.aabb;
      const r = n * width * channels;

      // For leftFirst, store the actual edge index, not the objIdx.
      // This avoids having to pass through the objIdx array,
      // which is highly problematic b/c of its variable (and large) size.
      arr[r] = node.isLeaf ? node.objIdx[node.leftFirst] : node.leftFirst;
      arr[r + 1] = node.objCount;
      // Unused: arr[r + 2]
      // Unused: arr[r + 3]
      arr[r + 4] = aabb.min.x;
      arr[r + 5] = aabb.min.y;
      arr[r + 6] = aabb.max.x;
      arr[r + 7] = aabb.max.y;
    }
    return arr;
  }

  textureConfiguration() {
    // See https://webgl2fundamentals.org/webgl/lessons/webgl-data-textures.html
    // RGBA16UI.
    // || leftFirst | type | ? | ? || aabbMin.x | aabbMin.y | aabbMax.x | aabbMax.y ||
    const width = 2;
    const height = this.nodes.length;
    return {
      resolution: 1,
      width,
      height,
      mipmap: PIXI.MIPMAP_MODES.OFF,
      scaleMode: PIXI.SCALE_MODES.NEAREST,
      multisample: PIXI.MSAA_QUALITY.NONE,
      format: PIXI.FORMATS.RGBA_INTEGER,
      type: PIXI.TYPES.UNSIGNED_SHORT
    };
  }


  /**
   * Construct a texture to store this bvh data.
   * @returns {PIXI.RenderTexture}
   */
  createTexture() {
    this.texture = PIXI.RenderTexture.create(this.textureConfiguration());
    return this.texture;
  }

  /**
   * Construct a pixel cache from the bvh texture.
   * @param {PIXI.RenderTexture} [texture]    The texture for this bvh
   * @returns {object}
   * - @prop {Uint16Array} pixels
   * - @prop {number} x
   * - @prop {number} y
   * - @prop {number} width
   * - @prop {number} height
   */
  createTextureCache() {
    this.texture ??= this.createTexture();
    const gl = canvas.app.renderer.gl;
    const bvhCache = extractPixelsAdvanced(canvas.app.renderer, this.texture,
      { format: gl.RGBA_INTEGER, type: gl.UNSIGNED_SHORT });
    this.copyToArray(bvhCache.pixels);
    this.cache = bvhCache;
    return bvhCache;
  }

  // ----- NOTE: Debugging ----- //
  static COLORS = [
    Draw.COLORS.lightblue,
    Draw.COLORS.lightgreen,
    Draw.COLORS.lightorange,
    Draw.COLORS.lightred,
    Draw.COLORS.lightyellow,
  ];

  /**
   * Draw the bounds of each node.
   */
  drawBounds() {
    for ( let i = 0; i < this.nodesUsed; i += 1 ) {
      const color = this.constructor.COLORS[i % this.constructor.COLORS.length];
      this.nodes[i].drawBounds({ color });
    }
  }

  /**
   * Display in the console a node hierarchy.
   */
  displayHierarchy() {
    /*    (width: 10 chars)
          node XXXXX
          objs XXXXX
          SAH XXXXXX
         /          \


    */


    const addLeft = (oldStr, newStr) => {
      const out = {};
      for ( const key of Object.keys(newStr) ) newStr[key] = newStr[key].concat("\t\t", oldStr[key]);
      return newStr;
    };
    const addRight = (oldStr, newStr) => {
      const out = {};
      for ( const key of Object.keys(newStr) ) newStr[key] = oldStr[key].concat("\t\t", newStr[key]);
      return newStr;
    };

    // Run left --> right.
    const addSubNode = function(bvh, node, nodeStr, level = 1) {
      if ( node.objCount ) return;

      // Shift the prev node string by 1 tab so we can add the left here. Propagates upward.
      let currStr = nodeStr;
      while ( currStr ) {
        currStr.tabs += 1;
        currStr = currStr.prev;
      }

      const leftNode = bvh.nodes[node.leftFirst];
      const leftNodeStr = leftNode.description(node.leftFirst);
      leftNodeStr.tabs = nodeStr.tabs - 1;
      leftNodeStr.prev = nodeStr;
      const levelArr = levels[level] ??= [];
      levelArr.push(leftNodeStr);
      addSubNode(bvh, leftNode, leftNodeStr, level + 1);

      const rightNode = bvh.nodes[node.leftFirst + 1];
      const rightNodeStr = rightNode.description(node.leftFirst + 1);
      rightNodeStr.tabs = 2;
      rightNodeStr.prev = nodeStr;
      levelArr.push(rightNodeStr);
      addSubNode(bvh, rightNode, rightNodeStr, level + 1);
    };

    const levels = [[this.root.description(0)]];
    levels[0][0].tabs = 0;
    addSubNode(this, this.root, levels[0][0], 1);

    let finalStr = "";
    levels.forEach(level => {
      let levelObj = {};
      for ( let i = 0; i < level.length; i += 1 ) {
        const tabs = Array.fromRange(level[i].tabs).fill("\t").join("");
        Object.keys(level[i]).forEach(key => {
          if ( key === "tabs" || key === "prev" ) return;
          levelObj[key] ??= "";
          levelObj[key] += `${tabs}${level[i][key]}`;
        });
      }
      let levelStr = "";
      Object.keys(levelObj).forEach(key => levelStr = levelStr.concat(levelObj[key], "\n"));
      finalStr += levelStr;
    });

    console.log(finalStr);
    return levels;
  }
}

/* Testing
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
let { vec2, vec3, vec4 } = api.testing.glsl_mock
glsl = api.testing.glsl_mock

// Get wall edges.
edges = [...canvas.edges.values()].filter(edge => edge.type === "wall")

// Convert to edge data
edgeData = edges.map(edge => new EdgeData(edge));
edgeData.forEach(e => e.drawEdge());
edgeData.forEach(e => e.drawCentroid({ color: Draw.COLORS.red }));
edgeData.forEach(e => e.drawBounds());

edgeIdx = Array.fromRange(edgeData.length)
bvh = BVH.build(edgeData, edgeIdx)
bvh.drawBounds()


a = vec3(canvas.tokens.controlled[0].center.x, canvas.tokens.controlled[0].center.y, 0)
b = vec3(canvas.tokens.controlled[1].center.x, canvas.tokens.controlled[1].center.y, 0)
Draw.segment({ a, b})
r = glsl.RayGLSLStruct.bvhRay(a, b);
bvh.hasIntersection(r)
bvh.hasIntersectionNonRecursive(r)

fn1 = function(r) { return bvh.hasIntersection(r); }
fn2 = function(r) { return bvh.hasIntersectionNonRecursive(r); }

N = 1000
await foundry.utils.benchmark(fn1, N, r)
await foundry.utils.benchmark(fn2, N, r)

edgeData.map(elem => elem.hasBoundsIntersection(r))
edgeData.map(elem => elem.hasObjectIntersection(r))

bvh.nodes.map(node => node.objCount)
bvh.nodes.map(node => node.hasBoundsIntersection(r))
bvh.nodes.map(node => node.hasObjectIntersection(r))
bvh.nodes.map(node => node.sah())
bvh.nodes.map(node => node.description())
bvh.displayHierarchy()

bvh.textureConfiguration()
bvh.copyToArray()

EdgeData.textureConfiguration()
EdgeData.copyEdgesToArray()
*/


