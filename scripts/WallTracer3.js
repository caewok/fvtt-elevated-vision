/* globals
PIXI,
canvas,
Ray,
foundry,
Quadtree
*/
"use strict";

/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// WallTracer3

import { groupBy } from "./util.js";
import { ClipperPaths } from "./geometry/ClipperPaths.js";
import { Draw } from "./geometry/Draw.js";

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

export class WallTracerVertex extends PIXI.Point {

  /** @type {Map<number, WallTracerVertex>} */
  static _cachedVertices = new Map();

  /**
   * Clear cached properties
   */
  static clear() { this._cachedVertices.clear(); }

  /** @type {Set<WallTracerEdge>} */
  _edges = new Set();

  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x, y) {
    super(x, y);
    this.roundDecimals();
    const key = this.key;

    const cache = WallTracerVertex._cachedVertices;
    if ( cache.has(key) ) return cache.get(key);

    WallTracerVertex._cachedVertices.set(key, this);
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
    if ( !this._edges.size ) this._cachedVertices.delete(this.key);
  }
}

export class WallTracerEdge {
  /**
   * Number of places to round the ratio for wall collisions, in order to treat
   * close collisions as equal.
   * @type {number}
   */
  static PLACES = 8;

  /** @type {Map<Wall, WallTracerEdge[]>} */
  static _cachedEdges = new Map();

  /** @type {Quadtree} */
  static quadtree = new Quadtree();

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

    this.delta = new PIXI.Point();
    this.B.subtract(this.A, this.delta);

    // TODO: Should this cache also store a map of intersection keys?
    if ( !WallTracerEdge._cachedEdges.has(wall) ) WallTracerEdge._cachedEdges.set(wall, new Set([this]));
    else WallTracerEdge._cachedEdges.get(wall).add(this);

    WallTracerEdge.quadtree.insert({ r: this.bounds, t: this });
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

  static removeConnectedEdge(edge) {
    this.connectedEdges.delete(edge);

    // The implication is that other edges in the set are now suspect if they connect
    // to this edge. This can quickly cascade.
    for ( const connectedEdge of edge.A._edges ) {
      if ( connectedEdge === edge ) continue;
      this.testAndRemoveConnectedEdge(connectedEdge);
    }
    for ( const connectedEdge of edge.B._edges ) {
      if ( connectedEdge === edge ) continue;
      this.testAndRemoveConnectedEdge(connectedEdge);
    }
  }

  /**
   * Used when something has changed in the connected edge set.
   * Test all edges connected to the one that changed to see if they still belong in the set.
   */
  static testAndRemoveConnectedEdge(edge, startingEdge) {
    if ( !edge.A._edges.size || !edge.B._edges.size ) {
      this.connectedEdges.removeConnectedEdge(edge);
      return false;
    }

    // If we have circled back to the starting edge, then we have a cycle.
    if ( edge === startingEdge ) return true;
    startingEdge = edge;

    let keepA = false;
    for ( const connectedEdge of edge.A._edges ) {
      if ( connectedEdge === edge ) continue;
      keepA ||= this.testAndRemoveConnectedEdge(connectedEdge, startingEdge);
      if ( keepA ) break;
    }

    let keepB = false;
    if ( keepA ) {
      for ( const connectedEdge of edge.B._edges ) {
        if ( connectedEdge === edge ) continue;
        keepB ||= this.testAndRemoveConnectedEdge(connectedEdge, startingEdge);
        if ( keepB ) break;
      }
    }

    if ( keepA && keepB ) return true;
    this.connectedEdges.removeConnectedEdge(edge);
    return false;
  }

  /**
   * Return either a new wall tracer edge or a cached edge, if available.
   * @param {Wall} wall   Wall to convert to wall edge(s)
   * @returns {Set<WallTracerEdge>}
   */
  static forWall(wall) {
    if ( WallTracerEdge._cachedEdges.has(wall) ) return WallTracerEdge._cachedEdges.get(wall);

    // Locate collision points for any edges that collide with this wall.
    // If no collisions, then a single edge can represent this wall.
    const collisions = WallTracerEdge.findWallCollisions(wall);
    if ( !collisions.size ) {
      new WallTracerEdge(wall);
      return WallTracerEdge._cachedEdges.get(wall);
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
      const cObjs = collisions.has(t) ? collisions.get(t) : [];
      for ( const cObj of cObjs ) cObj.edge.splitAtT(cObj.edgeT);

      // Cycle to next.
      priorT = t;
    }

    return WallTracerEdge._cachedEdges.get(wall);
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
   */
  destroy({ removeCachedWall = false } = {}) {
    // Remove cached values
    WallTracerEdge.quadtree.remove(this);
    WallTracerEdge._cachedEdges.delete(this);
    WallTracerEdge.removeConnectedEdge(this);

    // Remove the old edge from the set of edges for this wall.
    const wall = this.wall;
    const s = WallTracerEdge._cachedEdges.get(wall);
    s.delete(this);
    if ( removeCachedWall && !s.size ) WallTracerEdge._cachedEdges.delete(wall);

    // Remove this edge from its vertices.
    this.A.removeEdge(this);
    this.B.removeEdge(this);
  }

  /**
   * Draw this edge on the canvas.
   * Primarily for debugging.
   */
  draw(drawingOptions = {}) {
    Draw.segment(this, drawingOptions);
    Draw.point(this.A, drawingOptions);
    Draw.point(this.B, drawingOptions);
  }
}

/* Algorithm

Goal:
- Given an origin point on the canvas, locate the nearest polygon wall set to enclose that point.
- Identify any holes for that polygon
- Return the polygons and polygon holes

Data structure:
- For each wall encountered, store a WallTracerEdge in a Map keyed by the wall.
- WallTracerEdge stores:
  -

Step 1: Identify starting walls.
Shoot a ray directly west of the origin point. Any polygon that encloses the origin point
will contain at least one wall that intersects this ray.
Sort the intersecting walls based on distance from the origin.

Step 2: Trace the starting edge
From A on the starting edge, move toward B. Whenever an intersection is found, create a
new potential polygon and trace that wall or walls in turn. Same for intersections at B.

Step 3: Trace intersecting edge
Start at the intersection point for the edge. Trace toward B. Also trace toward A.
For each, split again at each intersection.

Step 4: Stopping.
- If an edge previously seen *for this polygon* is encountered again, stop.
  Identify the previous edge in the polygon to close the points; drop any points leading up.

- It should also be possible to stop if encountering an edge seen by another polygon
  or possibly another non-polygon?

- If no more intersections, then stop.


Trace:
edge -->
 ix --> A:
   ix: Trace
   ix2: Trace ...

  ix --> B:
    ix: Trace
    ix2: Trace ...
*/

/**
 * @typedef {object} WallTracerCollision
 * @property {PIXI.Point} pt
 * @property {number} t
 */

export class WallTracerEdge3 {
  /**
   * Number of places to round the ratio for wall collisions, in order to treat
   * close collisions as equal.
   * @type {number}
   */
  static PLACES = 8;

  /** @type {Map<Wall, WallTracerEdge>} */
  static _cachedEdges = new Map();

  /** @type {boolean} */
  collisionsProcessed = false;

  /** @type {Set<WallTracerEdge>} */
  _collidingEdges = new Set();

  /**
   * Map of walls that collide with this edge.
   * The value is the point of collision on this edge, between 0 and 1.
   * @type {Map<WallTracerEdge, WallTracerCollision>}
   */
  _edgeCollisionMap = new Map();

  /** @type {Wall} */
  wall;

  constructor(wall) {
    this.wall = wall;
    WallTracerEdge._cachedEdges.set(wall, this);
  }

  /**
   * Return either a new wall tracer edge or a cached edge, if available.
   * @param {Wall} wall   Wall to convert to a wall edge
   * @returns {WallTracerEdge}
   */
  static forWall(wall) {
    if ( WallTracerEdge._cachedEdges.has(wall) ) return WallTracerEdge._cachedEdges.get(wall);
    return new WallTracerEdge(wall);
  }

  /** @type {string} */
  get id() { return this.wall.id; }

  /** @type {PolygonVertex} */
  get A() { return new PIXI.Point(this.wall.A.x, this.wall.A.y); }

  /** @type {PolygonVertex} */
  get B() { return new PIXI.Point(this.wall.B.x, this.wall.B.y); }


  /** @type {Set<WallTracerEdge>} */
  get collidingEdges() {
    if ( !this.collisionsProcessed ) {
      this._findCollidingEdges();
      this._organizeCollidingEdges();
      this.collisionsProcessed = true;
    }

    return this._collidingEdges;
  }

  /** @type {Map<WallTracerEdge, WallTracerCollision>} */
  get edgeCollisionMap() {
    if ( !this.collisionsProcessed ) this.collidingEdges; // eslint-disable-line no-unused-expressions
    return this._edgeCollisionMap;
  }

  /**
   * Find walls that collide with the given ray
   * @param {Ray} ray   Ray, or other segment with A and B and bounds properties.
   * @returns {Wall[]}
   */
  static collidingWallsForRay(ray) {
    const { A, B } = ray;
    const collisionTest = (o, rect) => segmentsOverlap(A, B, o.t.A, o.t.B); // eslint-disable-line no-unused-vars
    return canvas.walls.quadtree.getObjects(ray.bounds, { collisionTest });
  }

  /**
   * Test if segment intersects boundary walls, and return any that do.
   * @param {Wall} ray   Wall, or other segment with A and B properties with A.key and B.key
   * @returns {Wall[]}
   */
  static segmentBoundaryCollisions(segment) {
    const { A, B } = segment;
    const boundaryWalls = [...canvas.walls.innerBounds, ...canvas.walls.outerBounds];
    const out = new Set();
    for ( const wall of boundaryWalls ) {
      if ( wall.wallKeys.has(A.key)
        || wall.wallKeys.has(B.key)
        || segmentsOverlap(A, B, wall.A, wall.B)) out.add(wall);
    }
    return out;
  }

  /**
   * Get edges that collide with this edge
   * @returns {Set<WallTracerEdges>}
   */
  _findCollidingEdges() {
    const { wall, A, B, id } = this;
    const collisionTest = (o, rect) => o.t.id !== id && segmentsOverlap(A, B, o.t.A, o.t.B); // eslint-disable-line no-unused-vars
    const out = canvas.walls.quadtree.getObjects(wall.bounds, { collisionTest });

    // Add the inner and outer walls if applicable
    const boundaryWalls = WallTracerEdge.segmentBoundaryCollisions(wall);

    // Convert to wall edges and add to set
    for ( const wall of out ) this._collidingEdges.add(WallTracerEdge.forWall(wall));
    for ( const wall of boundaryWalls ) this._collidingEdges.add(WallTracerEdge.forWall(wall));
  }

  /**
   * Determine where colliding walls intersect.
   * Update the edgeCollisionMap for this edge and the intersecting edge.
   */
  _organizeCollidingEdges() {
    const { A, B } = this;
    const collisionMap = this._edgeCollisionMap;
    const edges = this.collidingEdges;
    for ( const edge of edges ) {
      if ( collisionMap.has(edge) ) continue;

      const { A: eA, B: eB } = edge;
      if ( A.key === eA.key ) {
        this._edgeCollisionMap.set(edge, { t: 0, pt: A });
        edge._edgeCollisionMap.set(this, { t: 0, pt: A });

      } else if ( A.key === eB.key ) {
        this._edgeCollisionMap.set(edge, { t: 0, pt: A });
        edge._edgeCollisionMap.set(this, { t: 1, pt: A });

      } else if ( B.key === eA.key ) {
        this._edgeCollisionMap.set(edge, { t: 1, pt: B });
        edge._edgeCollisionMap.set(this, { t: 0, pt: B });

      } else if ( B.key === eB.key ) {
        this._edgeCollisionMap.set(edge, { t: 1, pt: B });
        edge._edgeCollisionMap.set(this, { t: 1, pt: B });

      } else if ( foundry.utils.lineSegmentIntersects(A, B, eA, eB) ) {
        // Intersects the wall or shares an endpoint or endpoint hits the wall
        const ix = CONFIG.GeometryLib.utils.lineLineIntersection(A, B, eA, eB, { t1: true });
        this._edgeCollisionMap.set(edge, { t: ix.t0, pt: ix });
        edge._edgeCollisionMap.set(this, {t: ix.t1, pt: ix });

      } else {
        // Edge is either completely collinear or does not actually intersect
        const ratioA = segmentRatio(A, B, eA);
        const ratioB = segmentRatio(A, B, eB);

        if ( ratioA === null || ratioB === null ) continue; // Not collinear

        if ( ratioA > 1 && ratioB > 1 ) continue; // Edge completely after A|B
        if ( ratioA < 0 && ratioB < 0 ) continue; // Edge completely before A|B

        const aInside = ratioA.between(0, 1);
        const bInside = ratioB.between(0, 1);

        if ( aInside && bInside ) continue; // Edge completely contained within A|B
        if ( !aInside && !bInside ) {
          // Edge contains A|B
          // Replace this wall entirely with edge
          this.wall = edge.wall;
          return this._organizeCollidingEdges();
        }

        // Either eA or eB are inside
        if ( aInside ) {
          if ( ratioB < 0 ) {
            // Segments: eB -- A -- eA -- B
            this._edgeCollisionMap.set(edge, { t: 0, pt: A });
            edge._edgeCollisionMap.set(this, { t: segmentRatio(eA, eB, A), A });

          } else if ( ratioB > 1 ) {
            // Segments: A -- eA -- B -- eB
            this._edgeCollisionMap.set(edge, { t: 1, pt: B });
            edge._edgeCollisionMap.set(this, { t: segmentRatio(eA, eB, B), B });
          }
        } else if ( bInside ) {
          if ( ratioA < 0 ) {
            // Segments: eA -- A -- eB -- B
            this._edgeCollisionMap.set(edge, { t: 0, pt: A });
            edge._edgeCollisionMap.set(this, { t: segmentRatio(eA, eB, A), A });
          } else if ( ratioB > 1 ) {
            this._edgeCollisionMap.set(edge, { t: 1, pt: B });
            edge._edgeCollisionMap.set(this, { t: segmentRatio(eA, eB, B), B });
          }
        }
      }
    }
  }
}

/**
 * Locate the edges that may contain an encompassing polygon by shooting a ray due west.
 * @returns {WallTracerEdge[]}
 */
function findStartingEdges(origin) {
  const westRay = new Ray(origin, new PIXI.Point(0, origin.y));
  let westWalls = WallTracerEdge.collidingWallsForRay(westRay);

  // Add west border walls
  const innerLeft = canvas.walls.innerBounds.find(w => w.id.includes("Left"));
  const outerLeft = canvas.walls.outerBounds.find(w => w.id.includes("Left"));
  westWalls.add(innerLeft);
  westWalls.add(outerLeft);

  // Sort by distance from origin
  // Conver to WallTracerEdge to avoid screwing up the wall object
  const startingEdges = [...westWalls.map(w => WallTracerEdge.forWall(w))];
  startingEdges.forEach(edge => edge._ix = CONFIG.GeometryLib.utils.lineLineIntersection(westRay.A, westRay.B, edge.A, edge.B));
  startingEdges.sort((a, b) => a._ix.t0 - b._ix.t0);
  return startingEdges;
}

/**
 * For a given origin point, locate walls that encompass the origin.
 * Return the polygon shape for those walls, with any holes included.
 * @param {PIXI.Point} origin
 * @returns {PIXI.Polygon[]}
 */
function encompassingShape(origin) {
  const startingEdges = findStartingEdges(origin);

  for ( const startingEdge of startingEdges ) {
    const points = [startingEdge.A];
    const polygons = [];
    const edges = new Set([startingEdge]);
    traceEdge(startingEdge, points, polygons, edges);

    for ( const pts of polygons ) {
      const poly = checkPoints(pts, origin);
      if ( poly ) return poly;
    }
  }

  return null;
}

function traceEdge(edge, points, polygons, edges) {
  const collidingEdges = edge.collidingEdges;
  for ( const [collidingEdge, collision] of collidingEdges ) {
    if ( collidingEdge === edge ) continue;

    if ( edges.has(collidingEdge) ) {
      polygons.push([...points, collision.pt]);
      continue;
    } else edges.add(collidingEdge);

    traceEdge(collidingEdge, [...points, collision.pt], polygons, edges);
  }
}

function checkPoints(points, origin) {
  // Polygon should not be already closed (this is unlikely).
  if ( points.length > 2 && points[0].equals(points[points.length - 1]) ) points.pop();

  // Must be able to at least form a triangle.
  const ln = points.length;
  if ( ln < 3 ) return false;

  // Confirm containment
  const poly = new PIXI.Polygon(points);

  if ( origin && !poly.contains(origin.x, origin.y) ) return false;
  return poly;
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
 * Get ratio indicating where c lies on segment A|B
 * @param {PIXI.Point} a   Endpoint of segment A|B
 * @param {PIXI.Point} b   Endpoint of segment A|B
 * @param {PIXI.Point} c   Point that may or may not be collinear with A|B
 * @returns {number|null}   Null if c is not collinear; ratio otherwise.
 *   Ratio is between 0 and 1 if c lies on A|B.
 *   Ratio is negative if c lies before A.
 *   Ratio is positive if c lies after B.
 */
function segmentRatio(a, b, c) {
  if ( !foundry.utils.orient2dFast(a, b, c).almostEqual(0) ) return null;

  const dAB = b.subtract(a);
  const dAC = c.subtract(a);
  const dot = dAB.dot(dAC);
  const dist2 = dAB.magnitudeSquared();
  return dot / dist2;
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
