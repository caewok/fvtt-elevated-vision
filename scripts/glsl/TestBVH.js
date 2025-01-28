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

*/

class EdgeData {
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
  get top() { return this.edge.elevationLibGeometry.a ?? 1.0e06; }

  /** @type {float} */
  get bottom() { return this.edge.elevationLibGeometry.a ?? -1.0e06; }

  /** @type {CONST.WALL_SENSE_TYPES} */
  get senseType() { return this.edge[this.sourceType]; }

  /** @type {bool} */
  get thresholdIsAttenuated() { return this.edge.threshold.attenuation; }

  /** @type {CONST.WALL_SENSE_TYPES} */
  get thresholdAttenuation() { return this.edge.threshold[this.sourceType]; }

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

  // ----- NOTE: Debugging ----- //

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

  // ----- NOTE: Debugging ----- //

  /**
   * Draw the rectangle for this node.
   */
  drawBounds(opts = {}) { Draw.shape(this.boundsRect, opts); }
}

class BVH {
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

  constructor(objData) {
    this.objData = objData;
    this.objIdx = Array.fromRange(objData.length);
    this.nodes.length = objData.length;
    this.nodes[0] = new BVHNode(this.objData, this.objIdx);
    this.nodesUsed += 1;
    this.root.objCount = objData.length;
  }

  static build(objData = []) {
    const bvh = new this(objData);
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
    if ( node.objCount <= 2 ) return;

    // Determine split axis and position.
    const extent = node.aabb.max.subtract(node.aabb.min);
    const axis = Number(extent.y > extent.x); // If y > x, then 1; otherwise 0.
    const splitPosition = node.aabb.min[axis] + (extent[axis] * 0.5);

    /* Debug
    splitTop = vec2(node.aabb.min)
    splitBottom = vec2(node.aabb.max)
    splitTop[axis] = splitPosition
    splitBottom[axis] = splitPosition
    Draw.segment({a: splitTop, b: splitBottom }, { color: Draw.COLORS.orange })
    */

    // In-place partition.
    let i = node.leftFirst;
    let j = i + node.objCount - 1;
    while ( i <= j ) {
      if ( this.objData[this.objIdx[i]].centroid[axis] < splitPosition ) i += 1;
      else this._swap(i, j--);
    }

    /* Debug
    bvh.objIdx.map(idx => bvh.objData[idx].centroid)
    */

    // Abort split if one of the sides is empty.
    const leftCount = i - node.leftFirst;
    if ( !leftCount || leftCount === node.objCount ) return;

    // Create child nodes.
    const leftChildIdx = this.nodesUsed++;
    const rightChildIdx = this.nodesUsed++;
    this.nodes[leftChildIdx] = new BVHNode(this.objData, this.objIdx);
    this.nodes[rightChildIdx] = new BVHNode(this.objData, this.objIdx);
    this.nodes[leftChildIdx].leftFirst = node.leftFirst;
    this.nodes[leftChildIdx].objCount = leftCount;
    this.nodes[rightChildIdx].leftFirst = i;
    this.nodes[rightChildIdx].objCount = node.objCount - leftCount;
    node.leftFirst = leftChildIdx;
    node.objCount = 0;
    this.nodes[leftChildIdx].updateBounds();
    this.nodes[rightChildIdx].updateBounds();

    // Recurse
    this.subdivide(leftChildIdx);
    this.subdivide(rightChildIdx);
  }

  /**
   * Swap two data indices in the object index
   * @param {int} idx0
   * @param {int} idx1
   */
   // TODO: Make private once done debugging
  _swap(idx0, idx1) { [this.objIdx[idx1], this.objIdx[idx0]] = [this.objIdx[idx0], this.objIdx[idx1]]; }


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

bvh = BVH.build(edgeData)
bvh.drawBounds()

bvh = new BVH(edgeData);
bvh.root.leftFirst = 0;
bvh.root.updateBounds();
bvh.root.drawBounds();


node = bvh.nodes[nodeIdx];
if ( node.objCount <= 2 ) return;

// Determine split axis and position.
extent = node.aabb.max.subtract(node.aabb.min);
axis = Number(extent.y > extent.x); // If y > x, then 1; otherwise 0.
splitPosition = node.aabb.min[axis] + (extent[axis] * 0.5);

// Debug
splitTop = vec2(node.aabb.min)
splitBottom = vec2(node.aabb.max)
splitTop[axis] = splitPosition
splitBottom[axis] = splitPosition
Draw.segment({a: splitTop, b: splitBottom }, { color: Draw.COLORS.orange })

// In-place partition.
let i = node.leftFirst;
let j = i + node.objCount - 1;
while ( i <= j ) {
  if ( bvh.objData[bvh.objIdx[i]].centroid[axis] < splitPosition ) i += 1;
  else bvh._swap(i, j--);
}

// Debug
bvh.objIdx.map(idx => bvh.objData[idx].centroid)

// Abort split if one of the sides is empty.
leftCount = i - node.leftFirst;
if ( !leftCount || leftCount === node.objCount ) return;

// Create child nodes.
leftChildIdx = bvh.nodesUsed++;
rightChildIdx = bvh.nodesUsed++;
bvh.nodes[leftChildIdx] = new BVHNode(bvh.objData, bvh.objIdx);
bvh.nodes[rightChildIdx] = new BVHNode(bvh.objData, bvh.objIdx);
bvh.nodes[leftChildIdx].leftFirst = node.leftFirst;
bvh.nodes[leftChildIdx].objCount = leftCount;
bvh.nodes[rightChildIdx].leftFirst = i;
bvh.nodes[rightChildIdx].objCount = node.objCount - leftCount;
node.leftFirst = leftChildIdx;
node.objCount = 0;
bvh.nodes[leftChildIdx].updateBounds();
bvh.nodes[rightChildIdx].updateBounds();



*/



