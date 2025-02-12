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
import { vec2, vec3, vec4 } from "./glsl_mock.js";
import * as glsl from "./glsl_mock.js";

import { ShaderTest } from "./WallShaderTest3.js";


class BVHNode {
  constructor(aabbMin, aabbMax, leftFirst, isLeaf) {
    this.aabbMin = aabbMin;
    this.aabbMax = aabbMax;
    this.leftFirst = leftFirst;
    this.isLeaf = isLeaf;
  }
}

class Edge {
  constructor(a, b, type) {
    this.a = a;
    this.b = b;
    this.type = type;
  }
}


export class BVHTest extends ShaderTest {

  static VARYINGS = ["vVertexPosition"]; //, "vTerrainTexCoord"];

  static FLATS = [];

  /* ----- NOTE: Constants ---- */

  static TOTAL_COLLISIONS = 50.0;

  static TOTAL_COLLISIONS_INV = 1.0 / this.TOTAL_COLLISIONS;

  static MAX_STACK_SIZE = 100.0;

  static OFFSET = {
    LIGHT: 9,
    SIGHT: 6,
    SOUND: 3,
    MOVE: 0
  };

  static MASK = {
    LIGHT: 7 << this.OFFSET.LIGHT,
    SIGHT: 7 << this.OFFSET.SIGHT,
    SOUND: 7 << this.OFFSET.SOUND,
    MOVE: 7 << this.OFFSET.MOVE
  };

  static SOURCE = {
    LIGHT: 0,
    SIGHT: 1,
    SOUND: 2,
    MOVE: 3
  };

  static WALL = {
    NONE: 0,
    LIMITED: 1,
    NORMAL: 2,
    PROXIMITY: 3,
    DISTANCE: 4
  };

  static EDGE_ELEVATION = {
    MAX: 65535,
    MIN: 0,
    SPLIT: 32768
  };

  canvasElevation = canvas.scene[MODULE_ID].elevationMin;

  config(opts) {
    super.config(opts);
    this.canvasElevation = this.uElevationRes.x;
  }

  /* ----- NOTE: Simple functions ---- */

  texelFetch(sampler, idx) {
    const start = (idx.y * sampler.width * 4) + (idx.x * 4);
    return vec4(...sampler.pixels.slice(start, start + 4));
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
  decodeEdgeTypes(n) {
    const { uSourceType } = this;
    const { SOURCE, MASK, OFFSET } = this.constructor;

    switch ( uSourceType ) {
      case SOURCE.LIGHT: return (n & MASK.LIGHT) >> OFFSET.LIGHT;
      case SOURCE.SIGHT: return (n & MASK.SIGHT) >> OFFSET.SIGHT;
      case SOURCE.SOUND: return (n & MASK.SOUND) >> OFFSET.SOUND;
      case SOURCE.MOVE:  return (n & MASK.MOVE)  >> OFFSET.MOVE; /* eslint-disable-line no-multi-spaces */
    }
    return 0;
  }

  /**
   * Decode the edge top and bottom.
   * Currently, evenly split among the 65,536 values.
   * 0 is negative infinity; 65535 is positive infinity, 65534 / 2 is the ± split.
   */
  decodeEdgeElevation(n) {
    const { EDGE_ELEVATION } = this.constructor;

    if ( n === EDGE_ELEVATION.MAX ) return 1.0e06;
    if ( n === EDGE_ELEVATION.MIN ) return -1.0e06;
    return Number(n - EDGE_ELEVATION.SPLIT);
  }

  /**
   * Pull node data from the texture.
   * @param {uint} idx
   * @returns {BVHNode}
   */
  getNode(idx) {
    const uBVHSampler = this.BVHSampler;

    const dat = this.texelFetch(uBVHSampler, vec2(0, idx), 0);
    const bounds = this.texelFetch(uBVHSampler, vec2(1, idx), 0);
    return new BVHNode(
      vec2(bounds.xy),  // Min
      vec2(bounds.zw),  // Max
      Number(dat[0]),      // LeftFirst
      Number(dat[1]) === 1  // isLeaf
    );
  }

  /**
   * Pull edge data from the texture.
   * @param {int} idx
   * @returns {Edge}
   */
  getEdge(idx) {
    const uEdgeSampler = this.EdgeSampler;

    const dat0 = this.texelFetch(uEdgeSampler, vec2(0, idx), 0);
    const dat1 = this.texelFetch(uEdgeSampler, vec2(1, idx), 0);
    return new Edge(
      vec3(dat0.xy, this.decodeEdgeElevation(Number(dat1[1]))),
      vec3(dat0.zw, this.decodeEdgeElevation(Number(dat1[2]))),
      this.decodeEdgeTypes(Number(dat1[0]))
    );
  }

  /* ----- NOTE: Getters ---- */

  get BVHSampler() { return this.shader.bvh.cache; }

  get EdgeSampler() { return CONFIG[MODULE_ID].edgeCache; }


  /* ----- NOTE: Vertex calculations ----- */

  /**
   * Mimic calculations done in the vertex shader.
   */
  vertexCalculations(id) {
    const { uSceneDims } = this;

    super.vertexCalculations(id);

    // In GLSL:
    // this.vVertexPosition =
    // this.vTerrainTexCoord =

  }

  /* ----- NOTE: Fragment calculations ----- */

  /**
   * Test a node's min/max bounds for a ray intersection.
   * 2d intersection.
   * @param {Ray} ray
   * @param {BVHNode} node
   * @returns {bool}
   */
  nodeHasBoundsIntersection(ray, node) {
    const { min, max } = glsl;

    const minXY = node.aabbMin.subtract(ray.origin.xy).multiply(ray.invDirection.xy);
    const maxXY = node.aabbMax.subtract(ray.origin.xy).multiply(ray.invDirection.xy);
    const minVals = min(minXY, maxXY);
    const maxVals = max(minXY, maxXY);
    const tmax = min(maxVals.x, maxVals.y);
    const tmin = max(minVals.x, minVals.y);

    // tmax > 0.0: to reject ray moving backward.
    // tmin < 1.0: to reject intersection after the light.
    // tmax >= tmin:
    return tmax > 0.0 && tmax >= tmin && tmin < 1.0;
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
  planeRayIntersection(plane, ray, t = {}) {
    const { almostEqual } = glsl;

    const denom = plane.normal.dot(ray.direction);
    if ( almostEqual(denom, 0.0, 1.0e-08) ) return false;
    const delta = plane.point.subtract(ray.origin);
    t.t = delta.dot(plane.normal) / denom;
    return true;
  }

  nodeHasObjectIntersection(ray, node) {
    const { WALL } = this.constructor;
    const { distanceSquared, Plane, cross } = glsl;
    const uEdgeSampler = this.EdgeSampler;

    // TODO: Can this be done with less texel fetches? Maybe fetch one to test horizontal first?
    const dat1 = this.texelFetch(uEdgeSampler, vec2(1, node.leftFirst), 0);
    const wallSenseType = this.decodeEdgeTypes(Number(dat1[0]));
    if ( wallSenseType === WALL.NONE ) return 0.0;

    const dat0 = this.texelFetch(uEdgeSampler, vec2(0, node.leftFirst), 0);

    const a = vec2(dat0.xy);
    const b = vec2(dat0.zw);
    const top = this.decodeEdgeElevation(Number(dat1[1]));
    const bottom = this.decodeEdgeElevation(Number(dat1[2]));
    const a3d = vec3(a, top);
    const edgeNormal = cross(vec3(b, top).subtract(a3d), vec3(a, bottom).subtract(a3d));

    const edgePlane = Plane(a3d, edgeNormal.normalize());
    const tObj = { t: 0 };
    if ( !this.planeRayIntersection(edgePlane, ray, tObj) ) return 0.0;
    const t = tObj.t;
    if ( t < 0.0 || (t * t) > ray.t2 ) return 0.0;
    const ix = ray.project(ray, t);

    // Within vertical extent.
    if ( ix.z > top || ix.z < bottom ) return 0.0;

    // Debugging.
    // return 1.0;

    // Within the 2d endpoints.
    const dist2Endpoints = distanceSquared(a.xy, b.xy);
    const dist2A = distanceSquared(a.xy, ix.xy);
    if ( dist2A > dist2Endpoints ) return 0.0;
    const dist2B = distanceSquared(b.xy, ix.xy);
    if ( dist2B > dist2Endpoints ) return 0.0;

    // TODO: Handle proximate wall types. https://foundryvtt.com/article/walls/
    // - Get distance from intersection to the end of the ray (the source).
    // - Return collision or not based on the threshold calculation.
    return wallSenseType === WALL.LIMITED ? 0.5 : 1.0;
  }

  /**
   * Test for an intersection with a wall.
   * TODO: Add ability to require a second intersection for terrain walls.
   * @param {Ray} ray
   * @return {float} 1.0 if intersection; 0.0 if not.
   */
  hasIntersection(ray) {
    const { isEven } = glsl;

    // Handle the root node and return if no collision or there is only 1 edge.
    let collision = 0.0; // For terrain walls, which return 0.5 for each collision.
    let currLevel = 0;
    let currNode = this.getNode(0);
    if ( !this.nodeHasBoundsIntersection(ray, currNode) ) return 0.0;
    if ( currNode.isLeaf ) return this.nodeHasObjectIntersection(ray, currNode) >= 1.0 ? 1.0 : 0.0;

    // Track the next node for each level of the tree.
    const stack = new Array(this.constructor.MAX_STACK_SIZE);
    stack[0] = 1; // Root left child is 1; root right child is 2.
    while ( currLevel >= 0 ) {
      // Pull the current node.
      currNode = this.getNode(stack[currLevel]);

      // Set the left side for this node.
      stack[currLevel + 1] = Number(currNode.leftFirst);

      // May have the right node remaining. Right is always 1 more than left.
      // Note: left is odd, right is even.
      stack[currLevel] = isEven(stack[currLevel]) ? 0 : stack[currLevel] + 1;

      // Test bounds for this node; if hit, investigate further.
      // If node is leaf, also test object intersection and possibly end early.
      let goDown = this.nodeHasBoundsIntersection(ray, currNode);
      if ( goDown && currNode.isLeaf ) {
        collision += this.nodeHasObjectIntersection(ray, currNode);
        if ( collision >= 1.0 ) return 1.0;
        goDown = false;
      }

      // In next loop, either:
      // 1. Move down to next level.
      // 2. Test the right node.
      // 3. Move up to prior level(s).
      if ( goDown ) currLevel += 1;
      else while ( currLevel >= 0 && stack[currLevel] === 0 ) currLevel -= 1;
    }
    return 0.0;
  }


  /**
   * Select a position on the sphere given vec3 between -1 and 1.
   * 0 would be dead center.
   * @param {vec3} dir
   * @returns {vec3}
   */
  spherePosition(dir) { return this.uLightPosition.add(dir.multiplyScalar(this.uLightSize)); }

  /**
   * Generate a sample ray from fragment to light.
   * Sample the 3d light sphere directly.
   * @param {vec3} fragmentPosition
   * @returns {vec3} Sample position on the light sphere
   */
  samplePositionLightSphere(fragmentPosition, seed) {
    const uTime = this.uTime;
    const { hash, linearConversion } = glsl;
    const { TOTAL_COLLISIONS } = this.constructor;

    const totalCollisions = Number(TOTAL_COLLISIONS);
    const j = seed + 1.0; // Avoid zeroes.
    const x = hash(uTime + j);
    const y = hash(uTime + (j * totalCollisions));
    const z = hash(uTime + (j * totalCollisions * totalCollisions));

    // Pseudo-Gaussian 3d distribution.
    const rndDir = (x * y * z === 0.0) ? vec3(0.0) : vec3(x, y, z).normalize();
    return this.spherePosition(linearConversion(rndDir, 0.0, 1.0, -1.0, 1.0));
  }

  setVaryings(pt) {
    this.vVertexPosition = vec2(pt.x, pt.y);
  }

  /**
   * Mimic the fragment calculation for a given point.
   * @param {Point} pt          Fragment location on the canvas
   * @param {float} elevation   Assumed elevation, in grid units
   * @returns {vec4} For testing only, returns fragColor.
   */
  fragmentCalculations(vVertexPosition, elevation) {
    const uLightPosition = this.uLightPosition;
    const { TOTAL_COLLISIONS, TOTAL_COLLISIONS_INV } = this.constructor;
    const { normalizedRayFromPoints } = glsl;

    super.fragmentCalculations(vVertexPosition);
    const lightPercentage = this.lightPercentage = vec4(1.0);

    if ( elevation > uLightPosition ) {
      lightPercentage.x = 0.0;
      return lightPercentage;
    }

    // Test for intersections along the ray for a sample of light positions.
    // (See WallShader_Sized_Fragment2.glsl for different sampling options.)
    let collisions = 0.0;
    const fragmentPosition = vec3(vVertexPosition, elevation);
    for ( let i = 0; i < TOTAL_COLLISIONS; i += 1 ) {
      const pos = this.samplePositionLightSphere(fragmentPosition, i);
      const lightRay = normalizedRayFromPoints(fragmentPosition, pos);
      collisions += this.hasIntersection(lightRay);
    }
    lightPercentage.x = 1.0 - (collisions * TOTAL_COLLISIONS_INV);
    return lightPercentage;
  }

  /* ----- NOTE: Debug ----- */

  drawEdge(edge, opts = {}) {
    opts.color ??= Draw.COLORS.blue;
    Draw.point(edge.a, opts);
    Draw.point(edge.b, opts);
    Draw.segment({ A: edge.a, B: edge.b }, opts);
  }

  drawNodeBounds(node, opts = {}) {
    opts.color ??= Draw.COLORS.lightorange;
    opts.fill ??= Draw.COLORS.lightorange;
    opts.fillAlpha ??= 0.5;
    const rect = new PIXI.Rectangle(node.aabbMin.x, node.aabbMin.y, node.aabbMax.x - node.aabbMin.x, node.aabbMax.y - node.aabbMin.y);
    Draw.shape(rect, opts);
  }
}


/* Testing
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
let { vec2, vec3, vec4 } = api.testing.glsl_mock
glsl = api.testing.glsl_mock
BVHTest = api.testing.BVHTest

let [l] = canvas.lighting.placeables;
source = l.lightSource;
ev = source.elevatedvision
bvh = ev.bvh
uLightPosition = vec3(...Point3d.fromPointSource(source))
fragmentPosition = vec3(_token.center.x, _token.center.y, 0)
ray = glsl.rayFromPoints(fragmentPosition, uLightPosition)
bvh.hasIntersection(ray)
bvh.hasIntersectionNonRecursive(ray)


bvhTest = BVHTest.fromMesh(ev.shadowMesh)[0]
bvhTest.drawEdge(bvhTest.getEdge(0))
bvhTest.drawNodeBounds(bvhTest.getNode(0))
Draw.segment({ A: ray.origin, B: ray.project(1.0) }, { color: Draw.COLORS.yellow })
lightCir = new PIXI.Circle(bvhTest.uLightPosition.x, bvhTest.uLightPosition.y, bvhTest.uLightSize)
Draw.shape(lightCir, { fillAlpha: 0.5, fill: Draw.COLORS.yellow })


node = bvhTest.getNode(0)
bvhTest.nodeHasBoundsIntersection(ray, node)
bvhTest.nodeHasObjectIntersection(ray, node)
bvhTest.hasIntersection(ray)

bvhTest.fragmentCalculations(fragmentPosition, 0)

*/
