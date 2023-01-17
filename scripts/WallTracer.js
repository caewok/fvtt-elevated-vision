/* globals
PIXI,
canvas,
Ray,
foundry,
CanvasQuadtree,
CONFIG,
Hooks,
game,
Wall
*/
"use strict";

/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// WallTracer3

import { groupBy, log } from "./util.js";
import { ClipperPaths } from "./geometry/ClipperPaths.js";
import { Draw } from "./geometry/Draw.js";
import { MODULE_ID } from "./const.js";

/* WallTracerVertex

Represents the endpoint of a WallTracerEdge.
Like with Walls, these vertices use integer values and keys.

The vertex provides links to connected WallTracerEdges.

*/

/* WallTracerEdge

Represents a portion of a Wall between two collisions:
- endpoint -- endpoint
- endpoint -- intersection
- intersection -- intersection

Properties include:
- wall
- A and B, where each store the t ratio corresponding to a point on the wall
- Array? of WallTracerEdge that share an endpoint, organized from cw --> ccw angle

If the wall overlaps a collinear wall?
- single edge should represent both

Wall type: currently ignored

*/

/* Connected WallTracerEdge identification

A closed polygon formed from WallTracerEdge can only be formed from edges that have
connecting edges at both A and B endpoints.

Store the set of connected WallTracerEdges. For a given set of edges, one can find the
set of connected edges by repeatedly removing edges with zero or 1 connected endpoints,
then updating the remainder and repeating until no more edges are removed.

The connected edges remaining must form 1+ closed polygons. All dangling lines will have
been removed.

*/

/* Wall updating

1. Wall creation
- Locate collision walls (edges) using QuadTree.
- Split wall into edges.
- Split colliding edges.
- Update the set of connected edges.

2. Wall update
- A changed: redo as in wall creation (1)
- B changed: change B endpoint. Possibly drop edges if shrinking (use t values).

3. Wall deletion
- remove from set of edges
- remove from set of connected edges
- remove from shared endpoint edges
- redo set of connected edges

*/

/* Angles
Foundry canvas angles using Ray:
--> e: 0
--> se: π / 4
--> s: π / 2
--> sw: π * 3/4
--> w: π
--> nw: -π * 3/4
--> n: -π / 2
--> ne: -π / 4

So northern hemisphere is negative, southern is positive.
0 --> π moves from east to west clockwise.
0 --> -π moves from east to west counterclockwise.
*/

// Track wall creation, update, and deletion, constructing WallTracerEdges as we go.
Hooks.on("createWall", function(document, _options, _userId) {
  const debug = game.modules.get("_dev-mode")?.api?.getPackageDebugValue(MODULE_ID);
  log(`createWall ${document.id}`);

  // Build the edges for this wall.
  WallTracerEdge.addWall(document.object);
  if ( debug ) WallTracerEdge.verifyConnectedEdges();
});

Hooks.on("updateWall", function(document, changes, _options, _userId) {
  const debug = game.modules.get("_dev-mode")?.api?.getPackageDebugValue(MODULE_ID);
  log("updateWall");

  // Only update the edges if the coordinates have changed.
  if ( !Object.hasOwn(changes, "c") ) return;

  // Easiest approach is to trash the edges for the wall and re-create them.
  WallTracerEdge.removeWall(document.id);
  WallTracerEdge.addWall(document.object);
  if ( debug ) WallTracerEdge.verifyConnectedEdges();
});

Hooks.on("deleteWall", function(document, _options, _userId) {
  const debug = game.modules.get("_dev-mode")?.api?.getPackageDebugValue(MODULE_ID);
  log(`deleteWall ${document.id}`);

  // The document.object is now null; use the id to remove the wall.
  WallTracerEdge.removeWall(document.id);
  if ( debug ) WallTracerEdge.verifyConnectedEdges();
  return true;
});

Hooks.on("canvasReady", async function() {
  const debug = game.modules.get("_dev-mode")?.api?.getPackageDebugValue(MODULE_ID);
  log("canvasReady");

  const t0 = performance.now();

  // When canvas is ready, the existing walls are not created, so must re-do here.
  // Also clear any existing data that may have been saved when switching scenes.
  WallTracerVertex.clear();
  WallTracerEdge.clear();

  const walls = [...canvas.walls.placeables] ?? [];
  walls.push(...canvas.walls.outerBounds);
  walls.push(...canvas.walls.innerBounds);
  for ( const wall of walls ) WallTracerEdge.addWall(wall);
  const t1 = performance.now();
  if ( debug ) {
    WallTracerEdge.verifyConnectedEdges();
    const t2 = performance.now();
    log(`Tracked ${walls.length} walls in ${t1 - t0} ms. Verified in ${t2 - t1} ms.`);
  }
});

export class WallTracerVertex {

  /** @type {Map<number, WallTracerVertex>} */
  static _cachedVertices = new Map();

  /**
   * Clear cached properties
   */
  static clear() { this._cachedVertices.clear(); }

  /** @type {PIXI.Point} */
  #vertex = new PIXI.Point();

  /** @type {number} */
  key = 0;

  /** @type {Set<WallTracerEdge>} */
  _edges = new Set();

  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x, y) {
    this.#vertex = new PIXI.Point(x, y);
    this.#vertex.roundDecimals();
    const key = this.key = this.#vertex.key;

    // Return either a new vertex object or the cached object for this key.
    const cache = WallTracerVertex._cachedVertices;
    if ( cache.has(key) ) return cache.get(key); // eslint-disable-line no-constructor-return
    cache.set(this.key, this);
  }

  /** @type {number} */
  get x() { return this.#vertex.x; }

  /** @type {number} */
  get y() { return this.#vertex.y; }

  /** @type {PIXI.Point} */
  get point() { return this.#vertex.clone(); } // Clone to avoid internal modification.

  /**
   * Test for equality against another vertex
   */
  equals(other) {
    return this.#vertex.equals(other);
  }

  /**
   * Test for near equality against another vertex
   */
  almostEqual(other, epsilon = 1e-08) {
    return this.#vertex.almostEqual(other, epsilon);
  }

  /**
   * Add an edge, only if it shares this vertex.
   * @param {WallTracerEdge}
   */
  addEdge(edge) {
    const key = this.key;
    if ( edge.A.key !== key && edge.B.key !== key ) return;
    this._edges.add(edge);
  }

  /**
   * Remove the edge and if possible, the associated vertices.
   * @param {WallTracerEdge}
   */
  removeEdge(edge) {
    const key = this.key;
    if ( edge.A.key !== key && edge.B.key !== key ) return;
    this._edges.delete(edge);
    this.removeFromCache();
  }

  /**
   * Remove the vertex from the cache if it has no associated edges.
   */
  removeFromCache() {
    if ( !this._edges.size ) WallTracerVertex._cachedVertices.delete(this.key);
  }
}

export class WallTracerEdge {
  /**
   * Number of places to round the ratio for wall collisions, in order to treat
   * close collisions as equal.
   * @type {number}
   */
  static PLACES = 8;

  /** @type {Map<string, WallTracerEdge[]>} */
  static _cachedEdges = new Map();

  /** @type {Quadtree} */
  static quadtree = new CanvasQuadtree();

  /** @type {Set<WallTracerEdge>} */
  static connectedEdges = new Set();

  /**
   * Helper function used to group collisions into the collision map.
   * @param {WallTracerCollision} c   Collision to group
   * @returns {number} The t0 property, rounded.
   */
  static _keyGetter(c) { return Math.roundDecimals(c.wallT, WallTracerEdge.PLACES); }

  /**
   * Wall represented by this edge.
   * The edge may represent the entire wall or just a portion (see tA and tB).
   * @type {Wall}
   */
  wall;

  /** @type {number} */
  tA = 0;

  /** @type {number} */
  tB = 1;

  /** @type {WallTracerVertex} */
  A;

  /** @type {WallTracerVertex} */
  B;

  /** @type {number} */
  _angle = undefined;

  /**
   * Constructor method to be used by internal methods, because
   * it does not return a cached value for the wall and does not attempt to subdivide the wall.
   * @param {Wall} wall   Wall represented by this edge
   * @param {number} tA   Where the A endpoint of this edge falls on the wall
   * @param {number} tB   Where the B endpoint of this edge falls on the wall
   */
  constructor(wall, tA = 0, tB = 1 ) {
    this.wall = wall;
    this.tA = Math.clamped(tA, 0, 1);
    this.tB = Math.clamped(tB, 0, 1);

    if ( tB < tA ) {
      console.warn("WallTracerEdge constructor: tA must be less than tB");
      [tA, tB] = [tB, tA];
    }

    const eA = this.pointAtWallRatio(this.tA);
    const eB = this.pointAtWallRatio(this.tB);

    this.A = new WallTracerVertex(eA.x, eA.y);
    this.B = new WallTracerVertex(eB.x, eB.y);

    this.A.addEdge(this);
    this.B.addEdge(this);

    this.delta = this.B.point.subtract(this.A.point);

    if ( !WallTracerEdge._cachedEdges.has(wall.id) ) WallTracerEdge._cachedEdges.set(wall.id, new Set([this]));
    else WallTracerEdge._cachedEdges.get(wall.id).add(this);

    const bounds = this.bounds;
    WallTracerEdge.quadtree.insert({ r: bounds, t: this });
    WallTracerEdge.addConnectedEdge(this);
  }

  static clear() {
    this._cachedEdges.clear();
    this.quadtree.clear();
    this.connectedEdges.clear();
  }

  static allEdges() {
    // Could also use quadtree.all to get this
    // Each edge in the wall cache is a set with multiple entries.
    const s = new Set();
    const edgeSets = this._cachedEdges.values();
    for ( const edgeSet of edgeSets ) {
      for ( const edge of edgeSet ) s.add(edge);
    }
    return s;
  }

  /**
   * Key for segment given two vertices
   * @param {PIXI.Point} A    Point with key property
   * @param {PIXI.Point} B    Point with key property
   * @returns {string} Returns string b/c that is the fastest without using BigInt or angles.
   *   BigInt saves very little time, so probably not worth it.
   *   Key is unique such that key(A, B) ≠ key(B, A)
   */
  static key(A, B) {
    return `${A.key},${B.key}`;
  }

  /** @type {string} */
  get key() { return WallTracerEdge.key(this.A, this.B); }

  /**
   * Add an edge to the set of connected edges.
   * The edge will be added if one of its connected edges can be added.
   * An edge that has no A or B connections cannot be added.
   * @param {WallTracerEdge}
   * @returns {boolean}   True if this edge can be added.
   */
  static addConnectedEdge(edge) {
    if ( this.connectedEdges.has(edge) ) return true;
    if ( !edge.A._edges.size || !edge.B._edges.size ) return false;

    // Temporarily add the edge to avoid infinite recursion.
    // If we return back to this edge, then we have formed a loop and so it can be added.
    this.connectedEdges.add(edge);

    // Only added if one of its connected edges at each end can be added
    let canAddA = false;
    for ( const connectedEdge of edge.A._edges ) {
      if ( connectedEdge === edge ) continue;
      canAddA ||= this.addConnectedEdge(connectedEdge);
      if ( canAddA ) break;
    }

    let canAddB = false;
    if ( canAddA ) {
      for ( const connectedEdge of edge.B._edges ) {
        if ( connectedEdge === edge ) continue;
        canAddB ||= this.addConnectedEdge(connectedEdge);
        if ( canAddB ) break;
      }
    }

    if ( canAddA && canAddB ) return true; // Already added above
    this.connectedEdges.delete(edge);
    return false;
  }

  static removeConnectedEdges(edges) {
    // If not in the connected edges set, nothing need be removed.
    edges = edges.filter(e => this.connectedEdges.has(e));
    for ( const edge of edges ) this.connectedEdges.delete(edge);

    // The implication is that other edges in the set are now suspect if they connect
    // to this edge. This can quickly cascade.
    for ( const edge of edges ) {
      for ( const connectedEdge of edge.A._edges ) {
        if ( connectedEdge === edge ) continue;
        this.testConnectedEdge(connectedEdge, { remove: true });
      }

      for ( const connectedEdge of edge.B._edges ) {
        if ( connectedEdge === edge ) continue;
        this.testConnectedEdge(connectedEdge, { remove: true });
      }
    }
  }

  /**
   * For debugging. Verify the connected edges
   */
  static verifyConnectedEdges() {
    // First, are the edges in the connected set in the edge cache?
    const cachedEdges = this.allEdges();
    const connectedEdges = this.connectedEdges;
    const diffConnected = connectedEdges.difference(cachedEdges);
    if ( diffConnected.size ) {
      console.warn(`Connected set has ${diffConnected.size} edges not in cached set.`);
      return false;
    }

    // Second, should the edges in the connected set be there?
    for ( const connectedEdge of connectedEdges) {
      if ( !this.testConnectedEdge(connectedEdge) ) {
        console.warn(`Connected edge ${connectedEdge.id} should not be in the connected set.`);
        return false;
      }
    }

    // Third, should other edges in the cached set be there?
    for ( const cachedEdge of cachedEdges ) {
      if ( connectedEdges.has(cachedEdge) ) continue;
      if ( this.testConnectedEdge(cachedEdge) ) {
        console.warn(`Cached edge ${cachedEdge.id} should be in the connected set.`);
        return false;
      }
    }

    return true;
  }

  /**
   * Used when something has changed in the connected edge set.
   * Test all edges connected to the one that changed to see if they still belong in the set.
   */
  static testConnectedEdge(edge, { seenEdges = new Set(), remove = false } = {}) {
    if ( !edge.A._edges.size || !edge.B._edges.size ) {
      if ( remove ) this.removeConnectedEdges([edge]);
      return false;
    }

    // If we have circled back to an already-seen edge, then we have a cycle.
    if ( seenEdges.has(edge) ) return true;
    seenEdges.add(edge);

    let keepA = false;
    for ( const connectedEdge of edge.A._edges ) {
      if ( connectedEdge === edge ) continue;
      keepA ||= this.testConnectedEdge(connectedEdge, { seenEdges, remove });
      if ( keepA ) break;
    }

    let keepB = false;
    if ( keepA ) {
      for ( const connectedEdge of edge.B._edges ) {
        if ( connectedEdge === edge ) continue;
        keepB ||= this.testConnectedEdge(connectedEdge, { seenEdges, remove });
        if ( keepB ) break;
      }
    }

    if ( keepA && keepB ) return true;
    if ( remove ) this.removeConnectedEdges([edge]);
    return false;
  }

  /**
   * Return either a new wall tracer edge or a cached edge, if available.
   * @param {Wall} wall   Wall to convert to wall edge(s)
   * @returns {Set<WallTracerEdge>}
   */
  static addWall(wall) {
    if ( WallTracerEdge._cachedEdges.has(wall.id) ) return WallTracerEdge._cachedEdges.get(wall.id);

    // Locate collision points for any edges that collide with this wall.
    // If no collisions, then a single edge can represent this wall.
    const collisions = WallTracerEdge.findWallCollisions(wall);
    if ( !collisions.size ) {
      new WallTracerEdge(wall);
      return WallTracerEdge._cachedEdges.get(wall.id);
    }

    // Sort the keys so we can progress from A --> B along the wall.
    const tArr = [...collisions.keys()];
    tArr.sort((a, b) => a - b);

    // For each collision, ordered along this wall from A --> B
    // - construct a new edge for this wall portion
    // - update the collision links for the colliding edge and this new edge
    if ( !collisions.has(1) ) tArr.push(1);
    let priorT = 0;
    for ( const t of tArr ) {
      // Build edge for portion of wall between priorT and t, skipping when t === 0
      if ( t ) new WallTracerEdge(wall, priorT, t);

      // One or more edges may be split at this collision point.
      const cObjs = collisions.get(t) ?? [];
      for ( const cObj of cObjs ) cObj.edge.splitAtT(cObj.edgeT);

      // Cycle to next.
      priorT = t;
    }

    return WallTracerEdge._cachedEdges.get(wall.id);
  }

  /**
   * Get edges for a wall, if available. Use addWall to actually define the edges.
   * @param {Wall} wall   Wall to check for an edge set.
   * @returns {Set<WallTracerEdge>}
   */
  static edgeSetForWall(wall) {
    return WallTracerEdge._cachedEdges.get(wall.id);
  }

  /**
   * Remove all associated edges with this wall.
   * @param {string|Wall} wallId    Id of the wall to remove, or the wall itself.
   */
  static removeWall(wallId) {
    if ( wallId instanceof Wall ) wallId = wallId.id;

    const edges = this._cachedEdges.get(wallId);
    if ( !edges || !edges.size ) return;

    // Shallow copy the edges b/c they will be removed from the set with destroy.
    const edgesArr = [...edges];
    for ( const edge of edgesArr ) edge.destroy({ removeCachedWall: true, removeConnected: false });
    this.removeConnectedEdges(edgesArr);
  }

  /**
   * Locate collision points for any edges that collide with this wall.
   * @param {Wall} wall
   * @returns {Map<number, WallTracerCollision[]>} Map of locations of the collisions
   */
  static findWallCollisions(wall) {
    const { A, B } = wall;
    const collisions = [];
    const collisionTest = (o, _rect) => segmentsOverlap(A, B, o.t.A, o.t.B);
    const collidingEdges = WallTracerEdge.quadtree.getObjects(wall.bounds, { collisionTest });
    for ( const edge of collidingEdges ) {
      const collision = WallTracerEdge._findWallEdgeCollision(wall, edge);
      if ( collision ) collisions.push(collision);
    }
    return groupBy(collisions, WallTracerEdge._keyGetter);
  }

  /**
   * @typedef {object} WallTracerCollision
   * @property {number} wallT   Location of collision on the wall, where A = 0 and B = 1
   * @property {number} edgeT   Location of collision on the edge, where A = 0 and B = 1
   * @property {Point} pt       Intersection point.
   * @property {WallTracerEdge} edge    Edge associated with this collision
   * @property {Wall} wall              Wall associated with this collision
   */

  /**
   * Find the collision, if any, between a wall and an edge.
   * @param {Wall} wall               Foundry wall object to test
   * @param {WallTracerEdge}  edge    Edge to test
   * @returns {WallTracerCollision}
   */
  static _findWallEdgeCollision(wall, edge) {
    const { A, B } = wall;
    const { A: eA, B: eB } = edge;

    let out;
    if ( A.key === eA.key || eA.almostEqual(A) ) out = { wallT: 0, edgeT: 0, pt: A };
    else if ( A.key === eB.key || eB.almostEqual(A) ) out = { wallT: 0, edgeT: 1, pt: A };
    else if ( B.key === eA.key || eA.almostEqual(B) ) out = { wallT: 1, edgeT: 0, pt: B };
    else if ( B.key === eB.key || eB.almostEqual(B) ) out = { wallT: 1, edgeT: 1, pt: B };
    else if ( foundry.utils.lineSegmentIntersects(A, B, eA, eB) ) {
      const ix = CONFIG.GeometryLib.utils.lineLineIntersection(A, B, eA, eB, { t1: true });
      out = {
        wallT: Math.roundDecimals(ix.t0, WallTracerEdge.PLACES),
        edgeT: Math.roundDecimals(ix.t1, WallTracerEdge.PLACES),
        pt: ix };

    } else {
      // Edge is either completely collinear or does not intersect.
      return null;
    }

    out.pt = new PIXI.Point(out.pt.x, out.pt.y);
    out.edge = edge;
    out.wall = wall;
    return out;
  }

  /** @type {string} */
  get id() { return this.wall.id; }

  /**
   * Determine angle of this edge using same method as Ray
   * @returns { number }
   */
  get angle() {
    if ( typeof this._angle === "undefined" ) this._angle = Math.atan2(this.delta.y, this.delta.x);
    return this._angle;
  }

  set angle(value) {
    this._angle = Number(value);
  }

  /**
   * Find the angle starting at the given vertex and moving to the opposite vertex.
   * A --> B is the default angle; B --> A would be that angle turned 180º
   * @param {WallTracerVertex} vertex
   * @returns {number}    Angle or its mirror opposite
   */
  angleFromEndpoint(vertex) {
    return this.A === vertex ? this.angle : Math.normalizeRadians(this.angle + Math.PI);
  }

  /**
   * Boundary rectangle that encompasses this edge.
   * @type {PIXI.Rectangle}
   */
  get bounds() {
    const { A, delta } = this;
    return new PIXI.Rectangle(A.x, A.y, delta.x, delta.y).normalize();
  }

  /**
   * @param {Point} vertex
   * @returns {PIXI.Point}
   */
  otherEndpoint(vertex) { return this.A.almostEqual(vertex) ? this.B : this.A; }

  /**
   * @param {Point} vertex
   * @returns {PIXI.Point}
   */
  matchingEndpoint(vertex) { return this.A.almostEqual(vertex) ? this.A : this.B; }

  /**
   * Calculate the point given a ratio representing distance from Wall endpoint A
   * @param {number} wallT
   * @returns {Point}
   */
  pointAtWallRatio(wallT) {
    const wall = this.wall;
    const A = new PIXI.Point(wall.A.x, wall.A.y);
    if ( wallT.almostEqual(0) ) return A;

    const B = new PIXI.Point(wall.B.x, wall.B.y);
    if ( wallT.almostEqual(1) ) return B;

    wallT = Math.roundDecimals(wallT, WallTracerEdge.PLACES);
    const outPoint = new PIXI.Point();
    A.projectToward(B, wallT, outPoint);
    return outPoint;
  }

  /**
   * Calculate the point given a ratio representing distance from edge endpointA
   * @param {number} edgeT
   * @returns {PIXI.Point}
   */
  pointAtEdgeRatio(edgeT) {
    if ( edgeT.almostEqual(0) ) return this.A;
    if ( edgeT.almostEqual(1) ) return this.B;

    edgeT = Math.roundDecimals(edgeT, WallTracerEdge.PLACES);
    const outPoint = new PIXI.Point();
    this.A.projectToward(this.B, edgeT, outPoint);
    return outPoint;
  }

  /**
   * For a given t ratio for this edge, what is the equivalent wall ratio?
   * @param {number} t
   * @returns {number}
   */
  _tRatioToWallRatio(t) {
    if ( t.almostEqual(0) ) return this.tA;
    if ( t.almostEqual(1) ) return this.tB;

    // Linear mapping where wallT === 0 --> tA, wallT === 1 --> tB
    const dT = this.tB - this.tA;
    return this.tA + (dT * t);
  }

  /**
   * Split this edge at some t value.
   * @param {number} edgeT  The portion on this *edge* that designates a point.
   * @returns {WallTracerEdge[]} Array of two wall tracer edges that share t endpoint.
   */
  splitAtT(edgeT) {
    edgeT = Math.clamped(edgeT, 0, 1);
    if ( edgeT.almostEqual(0) || edgeT.almostEqual(1) ) return [this];

    // Dispose of this old edge, to be replaced by a pair of edges.
    // Do not remove the wall b/c it will be re-used for the edges, below.
    this.destroy({ removeCachedWall: false });

    // Construct two new edges, divided at the edgeT location.
    const wall = this.wall;
    const wallT = this._tRatioToWallRatio(edgeT);
    const edge1 = new WallTracerEdge(wall, this.tA, wallT);
    const edge2 = new WallTracerEdge(wall, wallT, this.tB);

    return [edge1, edge2];
  }

  /**
   * Destroy all connections to this edge.
   * @param {object} [options]  Optional arguments that affect what is destroyed
   * @param {boolean} [options.removeCachedWall]  If true, remove this edge's wall from
   *   the cache if the wall is not associated with any other edges.
   * @param {boolean} [options.removeConnected]   If true, remove this edge from the connected set.
   *   Set to false if destroying several edges; call removeConnectedEdges manually after.
   */
  destroy({ removeCachedWall = true, removeConnected = true } = {}) {
    // Remove cached values
    WallTracerEdge.quadtree.remove(this);

    // Remove the old edge from the set of edges for this wall.
    const wallId = this.wall.id;
    const s = WallTracerEdge._cachedEdges.get(wallId);
    s.delete(this);
    if ( removeCachedWall && !s.size ) WallTracerEdge._cachedEdges.delete(wallId);

    // Remove this edge from its vertices.
    this.A.removeEdge(this);
    this.B.removeEdge(this);

    // Remove from connected set
    if ( removeConnected ) WallTracerEdge.removeConnectedEdges([this]);
  }

  /**
   * Draw this edge on the canvas.
   * Primarily for debugging.
   */
  draw(drawingOptions = {}) {
    Draw.segment(this, drawingOptions);

    drawingOptions.color = Draw.COLORS.red;
    Draw.point(this.A, drawingOptions);

    drawingOptions.color = Draw.COLORS.blue;
    Draw.point(this.B, drawingOptions);
  }

  /**
   * Draw all edges from the cache.
   * Primarily for debugging.
   */
  static drawAllEdges(drawingOptions = {}) {
    WallTracerEdge.allEdges().forEach(e => e.draw(drawingOptions));
  }
}

export class WallTracer {
  origin;

  constructor(origin) {
    this.origin = new PIXI.Point(origin.x, origin.y);

    // If not dynamically tracking walls, this is where to do the initial tracking.
    // Clear any old data.

  }

  clear() {
    // If not dynamically tracking walls, can reset here.
  }

  /**
   * For a given origin point, locate walls that encompass the origin.
   * Return the polygon shape for those walls, with any holes included.
   * @param {PIXI.Point} origin
   * @returns {PIXI.Polygon[]}
   */
  encompassingPolygonWithHoles() {
    const encompassingPoly = this.encompassingPolygon();
    if ( !encompassingPoly ) return [];

    const encompassingHoles = this.encompassingHoles(encompassingPoly);
    if ( !encompassingHoles.length ) return [encompassingPoly];

    // Union the "holes"
    const paths = ClipperPaths.fromPolygons(encompassingHoles);
    const combined = paths.combine();

    // Diff the encompassing polygon against the "holes"
    const diffPath = combined.diffPolygon(encompassingPoly);
    return diffPath.toPolygons();
  }

  /**
   * From an origin point, locate vertices and edges that encompass the origin.
   * Return the resulting polygon.
   * If tracing A-->B and B-->A resulted in two polygons, return the smaller in area.
   * @returns {WallTracerPolygon|null}
   */
  encompassingPolygon() {
    const startingEdges = this.locateStartingEdges();
    for ( const startingEdge of startingEdges ) {
      const { polyAB, polyBA } = WallTracer.traceClosedCWPath(startingEdge, this.origin);
      if ( polyAB && polyBA ) return polyBA.area < polyAB.area ? polyBA : polyAB;
      else if ( polyAB ) return polyAB;
      else if ( polyBA ) return polyBA;
    }
    return null;
  }

  /**
   * Given an encompassing shape, locate all edges within that shape.
   * Excluding edges used in that shape, locate any edges that form a closed loop.
   * These form potential holes to the encompassing shape.
   * @param {WallTracerPolygon} encompassingShape
   */
  encompassingHoles(encompassingPoly) {

    const encompassingPolyEdges = encompassingPoly._wallTracer.edges;
    if ( !encompassingPolyEdges || encompassingPolyEdges.size < 3 ) {
      console.warn("encompassingPolyEdges not valid.");
      return [];
    }

    // Looking for edges that are:
    // 1. connected (b/c only connected edges can form polygons)
    // 2. not part of the encompassing polygon
    // 3. has an endpoint within the polygon or spans the polygon.
    //    Because we are using edges, an edge that crosses a polygon edge necessarily terminates
    //    at the edge. Therefore, the midpoint of an edge contained by the polygon must be w/in the polygon.
    const collisionTest = (o, _rect) => {
      if ( !WallTracerEdge.connectedEdges.has(o.t) || encompassingPolyEdges.has(o.t) ) return false;
      const mid = PIXI.Point.midPoint(o.t.A.point, o.t.B.point);
      return encompassingPoly.contains(mid.x, mid.y);
    };
    const potentialHoleEdges = WallTracerEdge.quadtree.getObjects(encompassingPoly.getBounds(), { collisionTest });
    if ( !potentialHoleEdges.size ) return [];

    // Each hole edge can be traced in the A-->B and B--A directions.
    // Add any polygons generated from the trace.
    const holes = [];
    const seenEdges = new Set();
    const seenPolys = new Set([encompassingPoly.key]);
    const origin = this.origin;
    for ( const potentialHoleEdge of potentialHoleEdges ) {
      if ( seenEdges.has(potentialHoleEdge) ) continue;

      // Find closed shapes that are within, or share edge with, the encompassing polygon.
      // In some situations, a shared edge results in the hole being the encompassing polygon. Reject.
      // Reject all duplicate polygons

      let { polyAB, polyBA } = WallTracer.traceClosedCWPath(potentialHoleEdge);
      /*
      // In some situations (crossing polygons) it is possible for one of the holes
      // to enclose the origin area.
      // Either use contains to test or take the smaller area
        if ( !origin && polyAB && polyBA ) {
          polyAB = polyBA.area < polyAB.area ? polyBA : polyAB;
          polyBA = null;
        }
      */

      if ( polyAB ) {
        const key = polyAB.key;
        if ( !seenPolys.has(key) && (!origin || !polyAB.contains(origin.x, origin.y)) ) {
          holes.push(polyAB);
          polyAB._wallTracer.edges.forEach(e => seenEdges.add(e));
          seenPolys.add(key);
        }
      }

      if ( polyBA ) {
        const key = polyBA.key;
        if ( !seenPolys.has(key) && (!origin || !polyBA.contains(origin.x, origin.y)) ) {
          holes.push(polyBA);
          polyBA._wallTracer.edges.forEach(e => seenEdges.add(e));
          seenPolys.add(key);
        }
      }
    }
    return holes;
  }

  /**
   * @typedef {PIXI.Polygon} WallTracerPolygon
   * @property {object} [_wallTracer]
   * @property {WallTracerVertex[]} [_wallTracer.vertices]
   * @property {Set<WallTracerEdge>} [_wallTracer.edges]
   */

  /**
   * @typedef {object} TracedPolygonResults
   * @property {WallTracerPolygon|null} polyAB
   * @property {WallTracerPolygon|null} polyBA
   */

  /**
   * Trace an edge CW, first attempting A --> B and then B --> A.
   * @returns {TracedPolygonResults}  The resulting polygons in both directions, if any found.
   */
  static traceClosedCWPath(edge, origin) {
    const resAB = WallTracer._turnCW(edge, edge.A);
    const polyAB = resAB ? this._buildPolygonFromTracedVertices(resAB.vertices, resAB.edges, origin) : null;

    const resBA = WallTracer._turnCW(edge, edge.B);
    const polyBA = resBA ? this._buildPolygonFromTracedVertices(resBA.vertices, resBA.edges, origin) : null;

    return { polyAB, polyBA };
  }

  /**
   * Build polygon from set of vertices
   * @param {WallTracerVertex[]} vertices   Vertices to test and use to build the polygon
   * @param {Point} origin                  Optional origin to test for containment
   * @returns {WallTracerPolygon|null}
   */
  static _buildPolygonFromTracedVertices(vertices, edges, origin) {
    if ( !vertices ) return null;
    const nVertices = vertices.length;
    if ( nVertices < 3 ) return null;

    // It is possible for the trace to create a shape like a "6", where it starts
    // in the top part of the 6.
    // The vertices are in reverse, so the circle of the "6" would come first.
    // Remove the "tail" by checking if the vertices start to repeat.
    // (This will also remove closing vertex.)
    const seenVertices = new Set();
    let i = 0;
    for ( ; i < nVertices; i += 1 ) {
      const v = vertices[i];
      if ( seenVertices.has(v) ) break;
      seenVertices.add(v);
    }
    vertices.splice(i);
    if ( vertices.length < 3 ) return null;

    // Build the polygon
    const poly = new PIXI.Polygon(vertices);
    poly.clean();

    // For testing, check for self-intersecting polygons.
    const polyEdges = [...poly.iterateEdges({closed: true})];
    const nEdges = polyEdges.length;
    for ( let i = 0; i < nEdges; i += 1 ) {
      const edgeI = polyEdges[i];
      const keySet = new Set([edgeI.A.key, edgeI.B.key]);

      for ( let j = i + 1; j < nEdges; j += 1 ) {
        const edgeJ = polyEdges[j];
        if ( keySet.has(edgeJ.A.key) || keySet.has(edgeJ.B.key) ) continue;

        if ( foundry.utils.lineSegmentIntersects(edgeI.A, edgeI.B, edgeJ.A, edgeJ.B) ) {
          console.warn("_buildPolygonFromTracedVertices found a self-intersecting polygon.");
        }
      }
    }

    // Confirm containment of the origin
    if ( origin && !poly.contains(origin.x, origin.y) ) return null;

    // Add in links to the original vertices and edges set
    poly._wallTracer = { vertices, edges };

    return poly;
  }

  /**
   * @typedef {object} TracedEdgeResults
   * @property {Set<WallTracerEdge>} edges    All edges encountered for this trace
   * @property {WallTracerVertex[]} vertices  All vertices encountered, in order
   */

  /*
   * Trace a set of linked edges recursively, turning clockwise at each vertex.
   * Given edge, follow A --> B or B --> A. Turn cw by examining angles of endpoint edges. Trace that edge.
   * If that edge returns false, try the next-most cw option.
   * Ignore any edges that are not in the connecting set.
   * If we revisit an edge, we have a closed cycle.
   * @param {WallTracerEdge} edge             Current edge
   * @param {WallTracerVertex} vertex         Optional current (starting) vertex of this edge.
   *                                          The opposite vertex will be used to find the next edge.
   * @param {Set<WallTracerEdge>} seenEdges   Set of all edges visited by this recursion.
   *                                          Keys are WallTracerEdge.key()
   * @returns {TracedEdgeResults|null}
   */
  static _turnCW(edge, vertex = edge.A, seenEdges = new Set()) {
    // Direction matters.
    // If we encountered this edge going the opposite direction, we should reject.
    // Otherwise, we would walk along the back of the polygon, creating a self-intersecting polygon.
    // Self-intersecting polygons may or may not contain points, but they are too complex and cause issues.
    const nextVertex = edge.otherEndpoint(vertex);
    const oppositeKey = WallTracerEdge.key(nextVertex, vertex); // Use instead of edge.key to account for directionality.
    if ( seenEdges.has(oppositeKey) ) return null;

    // If we have encountered this edge before, we have a cycle.
    const key = WallTracerEdge.key(vertex, nextVertex);
    if ( seenEdges.has(key) ) return { edges: new Set([edge]), edgesArr: [edge], vertices: [vertex] }; // TODO: Drop Set or Array edges?
    seenEdges.add(key);

    // Find the edges connected to this next endpoint. If no more edges, then we are at a dead-end.
    const potentialEdgesSet = nextVertex._edges.filter(e => e !== edge && WallTracerEdge.connectedEdges.has(e));
    if ( !potentialEdgesSet.size ) return null;

    // If only one choice, that is easy! No angle math required.
    if ( potentialEdgesSet.size === 1 ) {
      const [potentialEdge] = potentialEdgesSet;
      const res = WallTracer._turnCW(potentialEdge, nextVertex, seenEdges);
      if ( !res ) return null;
      res.vertices.push(vertex);
      res.edges.add(edge);
      res.edgesArr.push(edge);
      return res;
    }

    // Add this edge to the seen set and attempt to follow to next edge.
    // Prioritize the CW-most edge.
    // If edge.angle === 0, then the potential edge angles go from highest (most CW turn) to lowest (least CW turn)
    // To ensure edge.angle === 0 when calculating angles:
    // 1. Make sure edge.angle represents A --> B. If we are moving B --> A, flip 180º.
    // 2. Subtract the edge.angle to rotate it (and other angles) CCW. This zeroes out the edge.angle, and
    //    rotates other angles accordingly.
    // 3. b - a will sort highest first.
    const angle = edge.angleFromEndpoint(vertex);
    const potentialEdges = [...potentialEdgesSet].sort((a, b) =>
      Math.normalizeRadians(b.angleFromEndpoint(nextVertex) - angle)
      - Math.normalizeRadians(a.angleFromEndpoint(nextVertex) - angle));
    for ( const potentialEdge of potentialEdges ) {
      const res = WallTracer._turnCW(potentialEdge, nextVertex, seenEdges);
      if ( !res ) continue;
      res.vertices.push(vertex);
      res.edges.add(edge);
      res.edgesArr.push(edge);
      return res;
    }
    return null;
  }

  /**
   * Locate the edges that may contain an encompassing polygon by shooting a ray due west.
   * @returns {WallTracerEdge[]}
   */
  locateStartingEdges() {
    const westRay = new Ray(this.origin, new PIXI.Point(0, this.origin.y));
    const westWalls = [...WallTracer.connectingWallsForRay(westRay)];

    // Calculate and sort by distance from the origin
    westWalls.forEach(edge => {
      edge._ix = CONFIG.GeometryLib.utils.lineLineIntersection(westRay.A, westRay.B, edge.A, edge.B);
    });
    westWalls.sort((a, b) => a._ix.t0 - b._ix.t0);
    return westWalls;
  }

  /**
   * Find walls that collide with the given ray
   * @param {Ray} ray   Ray, or other segment with A and B and bounds properties.
   * @returns {Wall[]}
   */
  static connectingWallsForRay(ray) {
    const { A, B } = ray;
    const collisionTest = (o, _rect) => WallTracerEdge.connectedEdges.has(o.t) && segmentsOverlap(A, B, o.t.A, o.t.B);
    return WallTracerEdge.quadtree.getObjects(ray.bounds, { collisionTest });
  }
}

/**
 * Do two segments overlap?
 * Overlap means they intersect or they are collinear and overlap
 * @param {PIXI.Point} a   Endpoint of segment A|B
 * @param {PIXI.Point} b   Endpoint of segment A|B
 * @param {PIXI.Point} c   Endpoint of segment C|D
 * @param {PIXI.Point} d   Endpoint of segment C|D
 * @returns {boolean}
 */
function segmentsOverlap(a, b, c, d) {
  if ( foundry.utils.lineSegmentIntersects(a, b, c, d) ) return true;

  // If collinear, B is within A|B or D is within A|B
  const pts = findOverlappingPoints(a, b, c, d);
  return pts.length;
}

/**
 * Find the points of overlap between two segments A|B and C|D.
 * @param {PIXI.Point} a   Endpoint of segment A|B
 * @param {PIXI.Point} b   Endpoint of segment A|B
 * @param {PIXI.Point} c   Endpoint of segment C|D
 * @param {PIXI.Point} d   Endpoint of segment C|D
 * @returns {PIXI.Point[]} Array with 0, 1, or 2 points.
 *   The points returned will be a, b, c, and/or d, whichever are contained by the others.
 *   No points are returned if A|B and C|D are not collinear, or if they do not overlap.
 *   A single point is returned if a single endpoint is shared.
 */
function findOverlappingPoints(a, b, c, d) {
  if ( !foundry.utils.orient2dFast(a, b, c).almostEqual(0)
    || !foundry.utils.orient2dFast(a, b, d).almostEqual(0) ) return [];

  // B is within A|B or D is within A|B
  const abx = Math.minMax(a.x, b.x);
  const aby = Math.minMax(a.y, b.y);
  const cdx = Math.minMax(c.x, d.x);
  const cdy = Math.minMax(c.y, d.y);

  const p0 = new PIXI.Point(
    Math.max(abx.min, cdx.min),
    Math.max(aby.min, cdy.min)
  );

  const p1 = new PIXI.Point(
    Math.min(abx.max, cdx.max),
    Math.min(aby.max, cdy.max)
  );

  const xEqual = p0.x.almostEqual(p1.x);
  const yEqual = p1.y.almostEqual(p1.y);
  if ( xEqual && yEqual ) return [p0];
  if ( xEqual ^ yEqual
  || (p0.x < p1.x && p0.y < p1.y)) return [p0, p1];

  return [];
}
