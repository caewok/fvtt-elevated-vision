/* globals
PIXI,
foundry,
canvas,
Ray
*/
"use strict";

/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// WallTracer2


import { groupBy } from "./util.js";
import { ClipperPaths } from "./geometry/ClipperPaths.js";
import { Draw } from "./geometry/Draw.js";

export class WallTracerEdge {

  /**
   * Number of places to round the ratio for wall collisions, in order to treat
   * close collisions as equal.
   * @type {number}
   */
  static PLACES = 8;

  // TODO: Use WeakMap to cache walls with edges.

  /**
   * @typedef {object} WallTracerEdgeEndpoints
   * @property {Set<WallTracerEdge>} A
   * @property {Set<WallTracerEdge>} B
   */

  /**
   * Internal intersections with this wall, sorted from distance from A.
   * Each has a t0 property, where 0 is at A and 1 is at B.
   * @type {WallTracerEdge[]}
   */
  _collisions;

  /**
   * Map of walls that collide with this edge.
   * The value is the point of collision on this edge, between 0 and 1.
   */
  _wallCollisionMap = new Map();

  /**
   * Map of grouped collisions by the rounded t0 property.
   * @type {Map<WallTracerEdge[]>}
   */
  _collisionsMap;

  /**
   * Same as _collisionsMap, but the map is reversed.
   * @type {Map<WallTracerEdge[]>}
   */
  _reverseCollisionsMap;

  /** @type {Wall} */
  wall;

  constructor(wall) {
    this.wall = wall;
  }

  /**
   * Helper function used to group collisions into the collision map.
   * @param {WallTracerEdge} item   WallTracerEdge with a t0 property.
   * @returns {number} The t0 property, rounded.
   */
  static _keyGetter(item) { return Math.roundDecimals(item.t0, WallTracerEdge.PLACES); }

  /** @type {string} */
  get id() { return this.wall.id; }

  /** @type {PolygonVertex} */
  get A() { return new PIXI.Point(this.wall.A.x, this.wall.A.y); }

  /** @type {PolygonVertex} */
  get B() { return new PIXI.Point(this.wall.B.x, this.wall.B.y); }

  /** @type {WallTracerEdge} */
  get collisions() {
    return this._collisions || (this._collisions = this._organizeCollidingWalls());
  }

  /** @type {Map<WallTracerEdge[]>} */
  get collisionsMap() {
    if ( this._collisionsMap ) return this._collisionsMap;
    const collisions = this.collisions;
    this._collisionsMap = groupBy(collisions, WallTracerEdge._keyGetter);
    return this._collisionsMap;
  }

  /** @type {Map<WallTracerEdge[]>} */
  get reverseCollisionsMap() {
    if ( this._reverseCollisionsMap ) return this._reverseCollisionsMap;
    const collisions = this.collisions;
    const revCollisions = [...collisions].reverse(); // Don't modify the original array.
    this._reverseCollisionsMap = groupBy(revCollisions, WallTracerEdge._keyGetter);
    return this._reverseCollisionsMap;
  }

  /**
   * Calculate the point at a ratio t0
   * @param {number} t
   * @returns {Point}
   */
  pointAtRatio(t) {
    if ( t.almostEqual(0) ) return this.A;
    if ( t.almostEqual(1) ) return this.B;

    const outPoint = new PIXI.Point();
    this.A.projectToward(this.B, t, outPoint);
    return outPoint;
  }

  /**
   * Move along this wall, starting at ratio t0. Find the next colliding wall that is cw (or ccw).
   * If the endpoint is reached, return the most cw wall that connects at the endpoint.
   * @param {number} t         Ratio between 0 and 1, indicating position on A|B. 0 mean A; 1 means B.
   * @param {object} [options]  Options affecting how the wall is traced.
   * @param {boolean} [options.AtoB]    If true, move A --> B. If false, move B --> A.
   * @param {boolean} [options.cw]      If true, search for cw edges; if false, ccw.
   * @returns {WallTracerEdge|null}
   */
  nextEdgeFromIx(t = 0, { AtoB = true, cw = true } = {}) {
    t = Math.clamped(t, 0, 1);
    const { A, B } = this;

    const defaultAngle = cw ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    const collisionsMap = AtoB ? this.collisionsMap : this.reverseCollisionsMap;
    const iter = collisionsMap.entries();
    for ( const [t0, cArr] of iter ) {
      if ( t0.almostEqual(t) ) continue;
      if ( AtoB && t0 < t ) continue;
      if ( !AtoB && t0 > t ) continue;

      // Characterize the angles
      // A --> B --> endpoint
      // If endpoint is inside A|B or before A, angle is 0.
      // If endpoint is after B, angle is π
      // CW angles are between 0 and π
      // Tighter CW angles are closer to 0
      // Tighter CCW angles are closer to 2*π
      const chosen = cArr.reduce((acc, curr) => {
        curr.angleA ??= PIXI.Point.angleBetween(A, B, curr.A, { clockwiseAngle: true });
        curr.angleB ??= PIXI.Point.angleBetween(A, B, curr.B, { clockwiseAngle: true });

        const angleA = Number.isNaN(curr.angleA) ? defaultAngle
          : AtoB ? curr.angleA
            : curr.angleA > Math.PI ? curr.angleA - Math.PI
              : curr.angleA + Math.PI;
        const angleB = Number.isNaN(curr.angleA) ? defaultAngle
          : AtoB ? curr.angleB
            : curr.angleB - Math.PI ? curr.angleB - Math.PI
              : curr.angleB + Math.PI;

        if ( cw ) {
          acc.angle = Math.min(acc.angle, angleA, angleB);
          acc.edge = acc.angle < angleA && acc.angle < angleB ? acc.edge : curr;
        } else {
          acc.angle = Math.max(acc.angle, angleA, angleB);
          acc.edge = acc.angle > angleA && acc.angle > angleB ? acc.edge : curr;
        }
        return acc;
      }, { angle: defaultAngle });

      if ( AtoB && t0 === 1 ) return chosen.edge;
      if ( !AtoB && t0 === 0 ) return chosen.edge;
      if ( cw && chosen.angle < Math.PI ) return chosen.edge;
      if ( !cw && chosen.angle > Math.PI ) return chosen.edge;
    }
    return null;
  }

  /** @returns {PolygonVertex} */
  otherEndpoint(vertex) { return vertex.equals(this.A) ? this.B : this.A; }

  /** @returns {PolygonVertex} */
  matchingEndpoint(vertex) { return vertex.equals(this.A) ? this.A : this.B; }

  /**
   * Get walls that collide with this wall
   * @returns {Set<Wall>}
   */
  collidingWalls() {
    const { wall, A, B, id } = this;
    const collisionTest = (o, rect) => o.t.id !== id && segmentsOverlap(A, B, o.t.A, o.t.B); // eslint-disable-line no-unused-vars
    const out = canvas.walls.quadtree.getObjects(wall.bounds, { collisionTest });

    // Add the inner and outer walls if applicable
    const boundaryWalls = WallTracerEdge.segmentBoundaryCollisions(wall);
    return new Set([...out, ...boundaryWalls]);

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
   * Organize colliding walls into shared endpoints or intersections
   */
  _organizeCollidingWalls() {
    const { wall, A, B } = this;
    const collisions = [];
    const walls = this.collidingWalls();
    for ( const w of walls ) {
      const edge = new WallTracerEdge(w);
      const { A: eA, B: eB } = edge;
      edge.prev = this; // Currently just for debugging

      // Identify:
      // t0: location of the intersection on A|B
      // t1: location of the intersection on eA|eB
      if ( wall.wallKeys.has(eA.key) || wall.wallKeys.has(eB.key) ) {
        // Edges share an endpoint.
        const sharesA = A.almostEqual(eA);
        this._wallCollisionMap.set(w, { t: sharesA || A.almostEqual(eB) ? 0 : 1, pt: sharesA ? A : B });
        edge._wallCollisionMap.set(wall, {t: sharesA || eA.almostEqual(B) ? 0 : 1, pt: sharesA ? A : B });

      } else if ( foundry.utils.lineSegmentIntersects(A, B, eA, eB) ) {
        // Intersects the wall or shares an endpoint or endpoint hits the wall
        const ix = foundry.utils.lineLineIntersection(A, B, eA, eB, { t1: true });

        this._wallCollisionMap.set(w, { t: ix.t0, pt: ix });
        edge._wallCollisionMap.set(wall, {t: ix.t1, pt: ix });


        edge.t0 = ix.t0;
        edge.t1 = ix.t1;
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
          this.wall = w;
          return this._organizeCollidingWalls();
        }

        // Either eA or eB are inside
        if ( aInside ) {
          if ( ratioB < 0 ) {
            // Segments: eB -- A -- eA -- B
            this._wallCollisionMap.set(w, { t: 0, pt: A });
            edge._wallCollisionMap.set(wall, { t: segmentRatio(eA, eB, A), A });

            edge.t0 = 0;
            edge.t1 = segmentRatio(eA, eB, A);
          } else if ( ratioB > 1 ) {
            // Segments: A -- eA -- B -- eB
            edge.t0 = 1;
            edge.t1 = segmentRatio(eA, eB, B);
          }
        } else if ( bInside ) {
          if ( ratioA < 0 ) {
            // Segments: eA -- A -- eB -- B
            edge.t0 = 0;
            edge.t1 = segmentRatio(eA, eB, A);
          } else if ( ratioB > 1 ) {
            edge.t0 = 1;
            edge.t1 = segmentRatio(eA, eB, B);
          }
        }
      }

      collisions.push(edge);
    }

    collisions.sort((a, b) => a.t0 - b.t0);
    return collisions;
  }

  draw(drawingOptions = {}) {
    Draw.segment(this, drawingOptions);
    const ixIndices = this.collisionsMap.keys();
    for ( const idx of ixIndices ) {
      const ix = this.pointAtRatio(idx);
      Draw.point(ix, { color: Draw.COLORS.red, radius: 2 });
    }
  }
}

// ----- Utility Functions ----- //

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

export class WallTracer {

  /** @type {PIXI.Point} */
  origin = new PIXI.Point();

  /** @type {WallTracerEdge[]} */
  _startingEdges;

  /** @type {Set<Wall>} */
  _encompassingWalls;

  /** @type {PIXI.Polygon} */
  _encompassingPolygon;

  /** @type {PIXI.Polygon[]} */
  _encompassingHoles;

  constructor(origin) {
    if ( !(origin instanceof PIXI.Point) ) origin = new PIXI.Point(origin.x, origin.y);
    this.origin = origin;
  }

  /** @type {WallTracerEdge[]} */
  get startingEdges() {
    return this._startingEdges || (this._startingEdges = this.findStartingEdges());
  }

  /** @type {Set<Wall>} */
  get encompassingWalls() {
    if ( typeof this._encompassingWalls === "undefined" ) this.findEncompassingPolygon();
    return this._encompassingWalls;
  }

  /** @type {PIXI.Polygon} */
  get encompassingPolygon() {
    if ( typeof this._encompassingPolygon === "undefined" ) this.findEncompassingPolygon();
    return this._encompassingPolygon;
  }

  /** @type {PIXI.Polygon[]} */
  get encompassingHoles() {
    return this._encompassingHoles || (this._encompassingHoles = this.findEncompassingHoles());
  }

  /**
   * Locate the edges that may contain an encompassing polygon by shooting a ray due west.
   * @returns {WallTracerEdge[]}
   */
  findStartingEdges() {
    const westRay = new Ray(this.origin, new PIXI.Point(0, this.origin.y));
    let westWalls = WallTracerEdge.collidingWallsForRay(westRay);

    // Add west border walls
    const innerLeft = canvas.walls.innerBounds.find(w => w.id.includes("Left"));
    const outerLeft = canvas.walls.outerBounds.find(w => w.id.includes("Left"))
    westWalls.add(innerLeft);
    westWalls.add(outerLeft);

    // Sort by distance from origin
    // Conver to WallTracerEdge to avoid screwing up the wall object
    const startingEdges = [...westWalls.map(w => new WallTracerEdge(w))];
    startingEdges.forEach(edge => edge._ix = foundry.utils.lineLineIntersection(westRay.A, westRay.B, edge.A, edge.B));
    startingEdges.sort((a, b) => a._ix.t0 - b._ix.t0);
    return startingEdges;
  }

  /**
   * For a given origin point, locate walls that encompass the origin.
   * Return the polygon shape for those walls, with any holes included.
   * @param {PIXI.Point} origin
   * @returns {PIXI.Polygon[]}
   */
  static encompassingShapeWithHoles(origin) {
    const wt = new WallTracer(origin);
    const encompassingPolygon = wt.encompassingPolygon;
    if ( !encompassingPolygon ) return [];
    if ( !wt.encompassingHoles.length ) return [encompassingPolygon];

    // Union the "holes"
    const paths = ClipperPaths.fromPolygons(wt.encompassingHoles);
    const combined = paths.combine();

    // Diff the encompassing polygon against the "holes"
    const diffPath = combined.diffPolygon(encompassingPolygon);
    return diffPath.toPolygons();
  }

  // TODO: Make more generic, so it can get a set of holes for any polygon,
  // not just ones from walls.

  /**
   * Test each starting edge until we find an encompassing polygon for the origin.
   * @returns {PIXI.Polygon|null}
   */
  findEncompassingPolygon() {
    const { origin, startingEdges } = this;
    let res;
    for ( const startingEdge of startingEdges ) {
      res = WallTracer.traceWall(startingEdge, origin);
      if ( res ) break;
    }
    if ( !res ) return null;

    this._encompassingPolygon = res.poly;
    this._encompassingWalls = res.polyWalls;
    return res.poly;
  }

  /**
   * Locate all walls within the encompassing polygon.
   * If tracing the wall forms a polygon, add to array of potential holes for the
   * encompassing polygon.
   * @returns {PIXI.Polygon[]} Array of all polygons that form potential holes for the
   *   encompassing polygon.
   */
  findEncompassingHoles() {
    const encompassingPolygon = this.encompassingPolygon;
    if ( !encompassingPolygon ) return [];
    const encompassingWalls = this.encompassingWalls;

    // Find walls contained by the encompassingPolygon.
    // Drop any walls used by the encompassing polygon.
    const collisionTest = (o, _rect) => encompassingPolygon.lineSegmentIntersects(o.t.A, o.t.B, { inside: true });
    const holeWalls = canvas.walls.quadtree.getObjects(encompassingPolygon.getBounds(), { collisionTest })
      .difference(encompassingWalls);
    if ( !holeWalls.size ) return [];

    // For each potential hole wall, see if tracing will form a polygon. Keep the hole if it does.
    const holePolys = [];
    let seenHoleWalls = new Set();
    for ( const holeWall of holeWalls ) {
      if ( seenHoleWalls.has(holeWall) ) continue; // If we traced this wall previously, skip.
      const holeEdge = new WallTracerEdge(holeWall);
      const holeRes = WallTracer.traceWall(holeEdge);
      if ( holeRes ) {
        holePolys.push(holeRes.poly);
        seenHoleWalls = new Set([...seenHoleWalls, ...holeRes.polyWalls]);
      }
      seenHoleWalls.add(holeWall);
    }

    return holePolys;
  }

  /**
   * Determine whether walls connected to a starting wall contain an origin.
   * Four possible directions:
   * 1. A --> B clockwise
   * 2. A --> B counterclockwise
   * 3. B --> A clockwise
   * 4. B --> A counterclockwise
   *
   * For each direction, looking to close a polygon around origin.
   * Polygon formed if we intersect the starting wall or if we run out of edges
   * and the shape can be closed without intersecting intervening edges.
   * If the formed polygon contains the origin, we are done.
   *
   * @param {Wall} startingWall     Wall to start tracing from.
   * @param {Point} origin          Optional. If provided, the polygon must contain this point.
   * @returns {PIXI.Polygon|null}
   */
  static traceWall(startingEdge, origin) {
    const AtoB = true;
    let poly;
    let allPoints;
    for ( const cw of [true, false] ) {
      const points = WallTracer.traceWallInDirection(startingEdge, { AtoB, cw });
      allPoints = points;
      poly = WallTracer.checkPoints(points, startingEdge, origin);
      if ( poly ) break;

      // Try adding in the points moving the opposite direction
      // const points2 = traceWallInDirection(startingEdge, { AtoB: !AtoB, cw: !cw });
      // allPoints = [...points2, points];
      // poly = checkPoints(allPoints, startingEdge, origin);
      // if ( poly ) break;
    }
    if ( !poly ) return null;

    // Need the walls that make up the poly later.
    const polyWalls = new Set();
    allPoints.forEach(pt => polyWalls.add(pt.edge.wall));
    return { poly, polyWalls };
  }

  /**
   * From a starting edge, walk along the edge and any intersecting or connecting edges.
   * Start in the indicated direction, such as A --> B, and turn in the indicated direction,
   * i.e., clockwise, at each intersecting wall.
   * Stop when no walls remain or repeating a wall previously encountered.
   * @param {WallTracerEdge} startingEdge
   * @param {object} [options]    Options that affect the choice of next edge.
   * @param {boolean} [options.AtoB]    If true, start by moving A --> B along the edge.
   *                                    If false, move B --> A.
   * @param {boolean} [options.cw]      Turn clockwise if true; counterclockwise if false.
   * @returns {Point[]}
   */
  static traceWallInDirection(startingEdge, { AtoB = true, cw = true } = {}) {
    const seenWalls = new Set([startingEdge.wall]);
    const MAX_ITER = 1000; // Avoid endless loop due to errors.
    const points = [];

    // Beginning with starting edge, trace a path of colliding walls for the given direction.
    // E.g. A -- ix --> B. First point is ix.
    //             \---> A --> ix --> ix1/B. Second point is ix1/B. Etc.
    let currEdge = startingEdge;
    let currIx = 0;
    let currIter = 0;
    let nextEdge = currEdge.nextEdgeFromIx(currIx, { AtoB, cw });
    while ( nextEdge ) {
      if ( currIter > MAX_ITER ) {
        console.log("traceWallInDirection exceeded MAX_ITER");
        break;
      }
      currIter += 1;

      currIx = nextEdge.t1;
      const pt = nextEdge.pointAtRatio(currIx);
      pt.edge = currEdge;
      points.push(pt);

      if ( seenWalls.has(nextEdge.wall) ) {
        console.log("traceWallInDirection already saw this wall.");
        break;
      }
      seenWalls.add(nextEdge.wall);

      // We need to determine which way along the next edge we are tracing: ix --> B or ix --> A
      const [currA, currB] = AtoB ? [currEdge.A, currEdge.B] : [currEdge.B, currEdge.A];
      AtoB = currIx === 0 ? true
        : currIx === 1 ? false
          : (foundry.utils.orient2dFast(currA, currB, nextEdge.A) < 0 ) ^ cw;
      currEdge = nextEdge;
      nextEdge = currEdge.nextEdgeFromIx(currIx, { AtoB, cw });
    }

    // We only want closed polygons. If there is no next edge, we have hit a dead-end.
    if ( !nextEdge ) return [];

    // We may have looped back to the starting wall or we have hit an intervening wall.
    // E.g, created a "6".
    // Drop any points before the last edge.
    const sliceIdx = points.findIndex(pt => pt.edge.wall === nextEdge.wall);
    points.splice(0, sliceIdx);
    return points;
  }

  /**
   * Confirm the starting points create an acceptable polygon.
   * 1. There are sufficient points to form a polygon.
   * 2. The end point to starting point forms a line that does not intersect other polygon edges.
   * 3. The polygon contains the origin.
   * @param {Point[]} points                Array of {x, y} points that will make up the polygon.
   * @param {WallTracerEdge} startingEdge   Used to shortcut the first test.
   * @param {Point} origin                  Optional. If provided, the polygon must contain this point.
   * @returns {PIXI.Polygon|boolean}  False if not an acceptable polygon.
   */
  static checkPoints(points, startingEdge, origin) {
    // Polygon should not be already closed (this is unlikely).
    if ( points.length > 2 && points[0].equals(points[points.length - 1]) ) points.pop();

    // Must be able to at least form a triangle.
    const ln = points.length;
    if ( ln < 3 ) return false;

    // Confirm the polygon is not self intersecting
    const poly = new PIXI.Polygon(points);

    // If the connecting edge is the starting edge, then we know it will not intersect itself.
    //     const testSelfIntersection = !(startingEdge.wall.wallKeys.has(points[0])
    //       && startingEdge.wall.wallKeys.has(points[ln - 1]));

    // Otherwise, test each edge
    //     if ( testSelfIntersection ) {
    const connectingEdge = { A: points[ln - 1], B: points[0] };
    const keys = new Set([connectingEdge.A.key, connectingEdge.B.key]);
    const edges = poly.iterateEdges({close: false});
    // TODO: Could test contains in this same loop.
    for ( const edge of edges ) {
      if ( keys.has(edge.A.key) || keys.has(edge.B.key) ) continue;
      if ( foundry.utils.lineSegmentIntersects(connectingEdge.A, connectingEdge.B, edge.A, edge.B) ) {
        console.log("checkPoints found self-intersecting polygon");
        return false;
      }
    }
    //     }

    // Confirm containment
    if ( origin && !poly.contains(origin.x, origin.y) ) return false;
    return poly;
  }
}
