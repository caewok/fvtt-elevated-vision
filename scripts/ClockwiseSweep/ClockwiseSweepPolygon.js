/* globals
CONST,
foundry,
canvas,
ClockwiseSweepPolygon,
Ray,
NormalizedRectangle,
CollisionResult,
PIXI,
CONFIG,
PolygonVertex
*/

"use strict";

import { log } from "../util.js";
import { SimplePolygonEdge } from "./SimplePolygonEdge.js";
import { identifyIntersectionsWithNoEndpoint, lineBlocksPoint } from "./utilities.js";
import { findIntersectionsBruteRedBlack } from "./IntersectionsBrute.js";
import { findIntersectionsSortSingle } from "./IntersectionsSort.js";
import { LimitedAngleSweepPolygon } from "./LimitedAngle.js";
import { ClipperLib } from "./clipper_unminified.js";


/*
Basic concept:
1. Custom shapes for light/sight/sound can be represented using temporary walls added
   to the sweep.
2. Limited angle is one application, where two temporary walls can be added.
3. Custom boundary polygons can be defined and also added as temporary walls.
4. Limited radius circle can be determined after the sweep, by intersecting the sweep
   polygon with a circle.
5. To speed up the sweep, a bounding box for boundary polygon/limited angle/limited radius
   can be used to select walls.

Changes to ClockwiseSweep:
- Walls are trimmed only by an encompassing bbox.
- All limited radius or limited angle calculations are removed.
- A bbox is always constructed to trim vertices prior to sweep.
  - unlimited vision: bbox is the edge of the canvas
  - limited angle: bbox is the rectangle that encompasses the limited angle
  - limited radius: bbox is the rectangle bounds of the vision circle
  - angle + radius: intersect bboxes
  - custom poly boundary: bbox around poly; intersect with other bboxes as necessary

Changes to PolygonEdge:
- Need to handle edges that are not associated with a wall
- Need to be able to quickly identify intersections for a given edge
  (Use the left/right endpoint sort algorithm comparable to walls intersection)


getBoundaryEdges: Return edges for a boundary, with intersections processed
edgeOutsideBoundary: True if the edge does not cross and is not contained by the boundary
vertexOutsideBoundary: True if the vertex does not cross and is not contained by the boundary

- Intersect the limitedAngle polygon instead of adding temp walls
- use limitedAngle.edgeIsOutside to drop edges not needed for the sweep
- Simplified executeSweep, with ray now constructed in determineRayResult only when needed.

*/


export class EVClockwiseSweepPolygon extends ClockwiseSweepPolygon {
  // Constructor same as ClockwiseSweep

  /* -------------------------------------------- */

  /**
   * @override
   * @param {Point} origin                        The provided polygon origin
   * @param {ClockwiseSweepPolygonConfig} config  The provided configuration object
   */
  initialize(origin, config) {
    super.initialize(origin, {...config}); // For benchmark & debugging, it can be problematic if the original config object is modified
    const cfg = this.config;

    // Edges and collisions originally in constructor, but moved here so as not to
    // interfere with default ClockwiseSweep.
    /**
     * A mapping of PolygonEdges which define potential boundaries of the polygon.
     * Keyed by edge.id, which may be equivalent to wall.id.
     * PolygonEdge represents both existing walls and temporary edges added in this
     * sweep class. To be able to link existing wall intersections with these edges,
     * this.edges must be a Map, not a Set.
     * @type {EdgeMap}
     */
    this.edges = new Map(); // ** NEW ** //
    this.collisions = []; // ** NEW ** Collisions formatted as [{x, y}, ...]

    log(`Elevated Vision initialize ${cfg.source?.id} with radius ${cfg.radius}, rotation ${cfg.rotation}, and origin ${this.origin.x}, ${this.origin.y}`, cfg.source);

    // Testing method of intersection
    cfg.findIntersectionsSingle ||= findIntersectionsSortSingle;
    cfg.findIntersectionsRedBlack ||= findIntersectionsBruteRedBlack;

    // *** NEW ***: Round origin b/c:
    // Origin can be non-integer in certain situations (like when dragging lights)
    // - we want a consistent angle when calculating the limited angle polygon
    // - we want a consistent straight ray from origin to the bounding box edges.
    // (Could be handled by drawing rays to floating point vertices, but this is the
    //  simpler option.)
    // TO-DO: Rounding origin implies that ClockwiseSweep should only be called when the
    // origin has moved 1+ pixels in either x or y direction.

    // Don't overwrite the origin object in case other modules, like wall height or levels,
    // have added properties to the origin.
    this.origin.x = Math.round(this.origin.x);
    this.origin.y = Math.round(this.origin.y);

    // If the source has the boundaryPolygon or customEdges method, set config accordingly.
    cfg.boundaryPolygon ||= (cfg.source?.boundaryPolygon
      && cfg.source.boundaryPolygon(this.origin, cfg.radius, cfg.rotation));
    cfg.tempEdges ||= (cfg.source?.customEdges
      && cfg.source.customEdges(this.origin));

    // If boundaryPolygon is "none", then drop any limited circle boundary
    // This will cause the boundary to be the canvas edges.
    if (cfg.boundaryPolygon === "none") {
      cfg.boundaryPolygon = undefined;
      cfg.hasLimitedRadius = false;
    }


    // Reset certain configuration values from what ClockwiseSweep did.

    // Configure limited radius same as ClockwiseSweep.
    // Limited radius configuration used to create the circle that will
    // be intersected against the resulting sweep polygon.
    // Limited radius configuration also used to construct the bounding box
    // to trim edges/vertices.

    // Need to use maximum rays throughout to ensure we always hit the bounding box.
    cfg.radiusMax = canvas.dimensions.maxR;
    cfg.radiusMax2 = Math.pow(cfg.radiusMax, 2);


    // Configure starting ray
    // (Always due west; limited angle now handled by _limitedAnglePolygon)
    // Ensure rounded endpoints; origin already rounded above
    cfg.rStart = new Ray(origin, { x: this.origin.x - Math.round(cfg.radiusMax), y: this.origin.y });

    // Configure artificial boundary
    // Can be:
    // - canvas edge
    // - bbox for the limited angle
    // - bbox for the limited radius circle
    // - bbox for user-provided alternative Polygon to radius circle

    // Ensure any user-provided boundaryPolygon is valid
    // - must contain the origin
    // - must be closed
    if (cfg.boundaryPolygon && !this.validateBoundaryPolygon()) {
      console.warn("ClockwiseSweep: boundaryPolygon not valid.");
      cfg.boundaryPolygon = undefined;
    }

    // Limited Radius boundary represented by PIXI.Circle b/c it is much faster to
    // intersect a circle with a polygon than two equivalent polygons.
    // Only need a limited radius boundary if no custom boundary was provided.
    if (cfg.hasLimitedRadius && !cfg.boundaryPolygon) {
      cfg.boundaryPolygon = new PIXI.Circle(this.origin.x, this.origin.y, cfg.radius);
    }

    // BoundaryPolygon is user-provided. It overrides use of the circle radius.
    // Otherwise, if a boundary is required (beyond canvas edges)
    // the limited radius and/or limited circle provide it.
    // BoundaryPolygon can be combined with limitedAngle.

    // Conceptually, it might make sense to require the boundaryPolygon to be
    // centered at 0,0 and scalable, such that radius 1 gives the boundaryPolygon
    // as-is, and this configuration would then scale and shift it according to
    // provided origin and radius.

    // Store flag to indicate if the boundary is anything other than canvas walls.
    // Unlike original, limitedAngle here does not use walls, so cannot ignore vertices based on its borders.
    cfg.hasCustomBoundary = Boolean(cfg.boundaryPolygon);


    // Object representing the limited angle:
    // 1 pixel behind the actual origin along rMin to the canvas border, then
    // along the canvas border to rMax, then back to 1 pixel behind the actual origin.
    if (cfg.hasLimitedAngle) {
      cfg.limitedAngle = LimitedAngleSweepPolygon.build(this.origin, cfg.angle, cfg.rotation, { contain_origin: true });

      // Needed for visualization only: reset aMin, aMax, rMin, rMax
      // based on slightly moving the origin in limitedAngle
      // (Otherwise unused in the sweep)
      cfg.aMin = cfg.limitedAngle.aMin;
      cfg.aMax = cfg.limitedAngle.aMax;
      cfg.rMin = cfg.limitedAngle.rMin;
      cfg.rMax = cfg.limitedAngle.rMax;
    }

    // Build a bounding box (PIXI.Rectangle)
    // Edge and vertex removal done by testing against bounding box.
    // (Limited angle treated as special case; vertices also rejected if not within the
    //  limited angle, for speed.)
    cfg.bbox = this._constructBoundingBox();

    // Add edges for boundaryPolygon or limitedAnglePolygon
    // User can also provide data to add temporary edges to the sweep algorithm, by
    // passing an array of SimplePolygonEdge in config.tempEdges.
    cfg.tempEdges = this._constructTemporaryEdges();
  }

  /** @inheritdoc */
  _compute() {

    // Step 1 - Identify candidate edges
    this._identifyEdges();


    // Step 2 - Construct vertex mapping
    this._identifyVertices();

    // Step 3 - Radial sweep over endpoints
    this._executeSweep();

    // Step 4 - Build polygon points
    // *** NEW *** Skip b/c dealt with in executeSweep

    // *** NEW *** //
    // Step 5 - Intersect boundary
    this._intersectBoundary();
  }

  /* -------------------------------------------- */
  /*  Edge Configuration                          */
  /* -------------------------------------------- */

  /**
   * Changes to _identifyEdges:
   * - Use SimplePolygonEdge
   * - Test for whether the edge is within the bounding box
   * - Add boundary edges, intersecting as necessary
   * - Add custom edges, intersecting as necessary
   * - Do not otherwise restrict by angle
   * - Do not otherwise constrain by radius
   * (_getWalls will have already restricted by this.config.bbox)
   * Translate walls and other obstacles into edges which limit visibility
   * @private
   */
  _identifyEdges() {
    const { type, limitedAngle } = this.config;

    // Add edges for placed Wall objects
    const walls = this._getWalls();
    for ( const wall of walls ) {
      // Ignore edges that are of a type that should be ignored
      if ( !this.constructor.testWallInclusion(wall, this.origin, type) ) continue;

      // *** NEW *** //
      if (limitedAngle && limitedAngle.edgeIsOutside(wall)) continue;

      const edge = SimplePolygonEdge.fromWall(wall, type);
      this.edges.set(edge.id, edge);
      // *** END NEW *** //
    }

    // Add edges for the canvas boundary
    // Necessary even when there is a bounding box from limitedRadius, limitedAngle,
    // or custom boundaryPolygon, because the bbox could overlap a canvas wall.
    // Also, canvas boundaries are already intersected and defined, so easier to
    // add rather than try to figure out if we need them or not.
    // (If outside the bbox, could drop them)
    for ( const boundary of canvas.walls.boundaries ) {
      const edge = SimplePolygonEdge.fromWall(boundary, type);
      this.edges.set(edge.id, edge);
    }

    // *** NEW *** //
    // Add all custom/temporary edges
    if (this.config.tempEdges.length) {
      // For all temporary edges, add after identifying intersections with existing walls.
      // Temporary edges here include edges from a bounding polygon, such as limited angle

      // drop edges outside the bbox
      if ( this.config.bbox ) {
        this.config.tempEdges = this.config.tempEdges.filter(e => this.config.bbox.encountersSegment(e));
      }

      // Temporary edges checked for intersections with each other already, so just
      // need to compare to existing walls.
      // Existing walls array is likely longer than tempEdges; thus it is second param
      // here b/c findIntersectionsDouble might be faster when the inner loop is the
      // longer one (more edges --> more chances for the inner loop to skip some)
      this.config.findIntersectionsRedBlack(this.config.tempEdges,
        Array.from(this.edges.values()),
        identifyIntersectionsWithNoEndpoint);

      // Add the temporary edges to the set of edges for the sweep.
      this.config.tempEdges.forEach(e => this.edges.set(e.id, e));
    }

    this._testEdgesForElevation();

    // *** END NEW *** //
  }

  _testEdgesForElevation() {
    // By convention, treat the Wall Height module rangeTop as the elevation
    // Remove edges that will not block the source when viewed straight-on
    // But store for later processing
    this.edgesBelowSource = new Set(); // Top of edge below source top
    this.edgesAboveSource = new Set(); // Bottom of edge above the source top
    const sourceZ = this._sourceElevation();
    this.edges.forEach((e, key) => {
      if ( sourceZ > e.top ) {
        this.edgesBelowSource.add(e);
        this.edges.delete(key);
      } else if ( sourceZ < e.botom ) {
        this.edgesAboveSource.add(e);
        this.edges.delete(key);
      }
    });
  }



  _sourceElevation() {
    if (!this.config.source) return 0;
    return this.config.source?.elevation ?? 0;
  }

  /* -------------------------------------------- */

  /**
   * Changes to _getWalls:
   * - Checks for hasBoundary instead of hasLimitedRadius.
   * - Uses the configured boundary box to limit walls.
   * Get the super-set of walls which could potentially apply to this polygon.
   * @returns {Wall[]}
   * @private
   */
  _getWalls() {
    // *** NEW *** //
    if ( !this.config.hasCustomBoundary ) return canvas.walls.placeables;
    return Array.from(canvas.walls.quadtree.getObjects(this.config.bbox).values());
  }

  /* -------------------------------------------- */
  /*  Vertex Identification                       */
  /* -------------------------------------------- */

  /**
   * Changes to _identifyVertices:
   * - Remove wallEdgeMap (rely on SimplePolygonEdge to track by id instead)
   * - Replace limited angle restriction with more generic outside boundary test
   * Consolidate all vertices from identified edges and register them as part of the vertex mapping.
   * @private
   */
  _identifyVertices() {

    // Register vertices for all edges
    for ( const edge of this.edges.values() ) {

      // Get unique vertices A and B
      const ak = edge.A.key;
      if ( this.vertices.has(ak) ) edge.A = this.vertices.get(ak);
      else this.vertices.set(ak, edge.A);
      const bk = edge.B.key;
      if ( this.vertices.has(bk) ) edge.B = this.vertices.get(bk);
      else this.vertices.set(bk, edge.B);

      // Learn edge orientation with respect to the origin
      const o = foundry.utils.orient2dFast(this.origin, edge.A, edge.B);

      // Ensure B is clockwise of A
      if ( o > 0 ) {
        const a = edge.A;
        edge.A = edge.B;
        edge.B = a;
      }

      // Attach edges to each vertex
      edge.A.attachEdge(edge, -1);
      edge.B.attachEdge(edge, 1);

      // *** NEW ***: no wallEdgeMAP

    }

    // Add edge intersections
    this._identifyIntersections();

    // *** NEW ***
    // Do not remove vertices outside the boundary.
    // Handle on a per-edge basis in _identifyEdges.
    // Removing vertices here will fail if there is not actual boundary, as is the case
    // for limitedCircle. (The circle is later intersected against the sweep polygon,
    // which will be an incorrect polygon if walls that intersect that boundary are
    // excluded by having one of their endpoints removed here.)
  }

  /* -------------------------------------------- */

  /**
   * Changes to _identifyIntersections:
   * - No longer rely on wallEdgeMap (use SimplePolygonEdge.id instead)
   * - No limited angle checks
   * - Move registering the intersection to a separate method
   * - Check first for exiting wall intersections and second for
   *   temporary edge intersections
   * Add additional vertices for intersections between edges.
   * @param {Map<string,SimplePolygonEdge>} wallEdgeMap    A mapping of wall IDs to SimplePolygonEdge instances
   * @private
   */
  _identifyIntersections() {
    const processed = new Set();
    for ( const edge of this.edges.values() ) {

      // Check each intersecting wall
      if (edge.wall && edge.wall.intersectsWith.size) {
        for ( const [wall, i] of edge.wall.intersectsWith.entries() ) {

          // Some other walls may not be included in this polygon
          const other = this.edges.get(wall.id);
          if ( !other || processed.has(other) ) continue;

          // TO-DO: test intersection point  against bbox.contains?

          this._registerIntersection(edge, other, i);
        }
      }

      if (edge.intersectsWith.size) {
        for ( const [wall, i] of edge.intersectsWith.entries() ) {
          const other = this.edges.get(wall.id);
          if ( !other || processed.has(other) ) continue;

          // TO-DO: test intersection point  against bbox.contains?

          this._registerIntersection(edge, other, i);
        }
      }
      processed.add(edge);
    }
  }

  /* -------------------------------------------- */
  /*  Radial Sweep                                */
  /* -------------------------------------------- */

  /**
   * Changes to _executeSweep:
   * - radiusMax2 sets the distance of the ray
   * - isRequired property removed from CollisionResult
   * Execute the sweep over wall vertices
   * @private
   */
  _executeSweep() {
    // Initialize the set of active walls
    const activeEdges = this._initializeActiveEdges();

    // Sort vertices from clockwise to counter-clockwise and begin the sweep
    const vertices = this._sortVertices();
    for ( const [i, vertex] of vertices.entries() ) {
      // *** NEW ***
      vertex._index = i+1;

      // *** NEW ***: construct basic collision result
      const result = new CollisionResult({
        target: vertex,
        cwEdges: vertex.cwEdges,
        ccwEdges: vertex.ccwEdges,
        isLimited: vertex.isLimited
        // *** NEW ***: Don't need to set isRequired
      });

      // Delegate to determine the result of the ray
      this._determineRayResult(vertex, result, activeEdges);

      // Update active edges for the next iteration
      this._updateActiveEdges(result, activeEdges);
    }
  }

  /* -------------------------------------------- */

  /**
   * Changes to _initializeActiveEdges:
   * - Use rStart (always due west) instead of rMin
   * Determine the initial set of active edges as those which intersect with the initial ray
   * @returns {EdgeSet}             A set of initially active edges
   * @private
   */
  _initializeActiveEdges() {
    const rStart = this.config.rStart; // *** NEW ***
    const edges = new Set();
    for ( const edge of this.edges.values() ) {
      // *** NEW ***: rStart
      const x = foundry.utils.lineSegmentIntersects(rStart.A, rStart.B, edge.A, edge.B);
      if ( x ) edges.add(edge);
    }
    return edges;
  }

  /* -------------------------------------------- */

  /**
   * Changes to _sortVertices:
   * - No need to sort around a reference (start is always due west)
   * Sort vertices clockwise from the initial ray (due west).
   * @returns {PolygonVertex[]}             The array of sorted vertices
   * @private
   */
  _sortVertices() {
    if ( !this.vertices.size ) return [];
    const vertices = Array.from(this.vertices.values());
    const o = this.origin;

    // *** NEW ***: No reference point

    // Sort vertices
    vertices.sort((a, b) => {

      // Sort by hemisphere
      const ya = a.y > o.y ? 1 : -1;
      const yb = b.y > o.y ? 1 : -1;
      if ( ya !== yb ) return ya;       // Sort N, S

      // Sort by quadrant
      const qa = a.x < o.x ? -1 : 1;
      const qb = b.x < o.x ? -1 : 1;
      if ( qa !== qb ) {                // Sort NW, NE, SE, SW
        if ( ya === -1 ) return qa;
        else return -qa;
      }

      // Sort clockwise within quadrant
      const orientation = foundry.utils.orient2dFast(o, a, b);
      if ( orientation !== 0 ) return orientation;

      // *** NEW ***: No reference point

      // If points are collinear, first prioritize ones which have no CCW edges over ones that do
      if ( !a.ccwEdges.size && b.ccwEdges.size ) return -1;
      if ( !b.ccwEdges.size && a.ccwEdges.size ) return 1;

      // Otherwise, sort closer points first
      if ( !a._d2 ) a._d2 = Math.pow(a.x - o.x, 2) + Math.pow(a.y - o.y, 2);
      if ( !b._d2 ) b._d2 = Math.pow(b.x - o.x, 2) + Math.pow(b.y - o.y, 2);
      return a._d2 - b._d2;
    });

    // *** NEW ***: No reference point

    return vertices;
  }

  /**
   * Changes to _isVertexBehindActiveEdges:
   * - Use faster lineBlocksPoint test.
   * - Don't need the ray parameter
   * Test whether a target vertex is behind some closer active edge
   * @param {Ray} ray                   The ray being evaluated
   * @param {PolygonVertex} vertex      The target vertex
   * @param {EdgeSet} activeEdges       The set of active edges
   * @returns {{isBehind: boolean, wasLimited: boolean}} Is the target vertex behind some closer edge?
   * @private
   */
  _isVertexBehindActiveEdges(vertex, activeEdges) {
    let wasLimited = false;
    for ( const edge of activeEdges ) {
      if ( vertex.edges.has(edge) ) continue;

      // *** NEW *** //
      if (lineBlocksPoint(edge.A, edge.B, vertex, this.origin)) {
      // *** END NEW *** //
        if ( ( edge.isLimited ) && !wasLimited ) wasLimited = true;
        else return {isBehind: true, wasLimited};
      }
    }
    return {isBehind: false, wasLimited};
  }

  /* -------------------------------------------- */

  /**
   * Changes in _determineRayResult:
   * - No Case 1 (Boundary rays strictly required)
   * - No ray parameter (constructed within)
   * Determine the final result of a candidate ray.
   * @param {PolygonVertex} vertex      The target vertex
   * @param {CollisionResult} result    The result being prepared
   * @param {EdgeSet} activeEdges       The set of active edges
   * @private
   */
  _determineRayResult(vertex, result, activeEdges) {
    // *** NEW ***: No Case 1

    // *** NEW ***
    // No test for vertex.is_outside. See removal of is_outside test from _identifyVertices.
    //  Otherwise, would have: if (vertex.is_outside) { return; }

    const {isBehind, wasLimited} = this._isVertexBehindActiveEdges(vertex, activeEdges);
    result.isBehind = isBehind;
    result.wasLimited = wasLimited;


    // Case 2 - Some vertices can be ignored because they are behind other active edges
    if ( result.isBehind ) return;

    // Determine whether this vertex is a binding point
    const nccw = vertex.ccwEdges.size;
    const ncw = vertex.cwEdges.size;
    let isBinding = true;
    if ( result.isLimited ) {
      // Limited points can still be binding if there are two or more connected edges on the same side.
      if ( !result.wasLimited && (ncw < 2) && (nccw < 2) ) isBinding = false;
    }

    // Case 4 - Limited edges in both directions
    // limited -> limited
    const ccwLimited = !result.wasLimited && (nccw === 1) && vertex.ccwEdges.first().isLimited;
    const cwLimited = !result.wasLimited && (ncw === 1) && vertex.cwEdges.first().isLimited;
    if ( activeEdges.size && cwLimited && ccwLimited ) return;

    // Case 5 - Non-limited edges in both directions
    // edge -> edge
    if ( activeEdges.size && !ccwLimited && !cwLimited && ncw && nccw ) {
      this.points.push(result.target.x, result.target.y); // Probably better off adding the collisions to this.points directly, if also adding points directly from _beginNewEdge
      return;
    }

    // *** NEW ***: Construct ray here, instead of in _executeSweep
    const ray = Ray.towardsPointSquared(this.origin, vertex, this.config.radiusMax2);
    ray.result = result;
    this.rays.push(ray);

    // Case 3 - If there are no counter-clockwise edges we must be beginning traversal down a new edge
    // empty -> edge
    // empty -> limited
    if ( !activeEdges.size || !nccw ) {
      this._beginNewEdge(ray, result, activeEdges, isBinding);
      result.collisions.forEach(pt => this.points.push(pt.x, pt.y));
      return;
    }


    // Case 6 - Complete edges which do not extend in both directions
    // edge -> limited
    // edge -> empty
    // limited -> empty
    if ( !ncw || (nccw && !ccwLimited) ) {
      this._completeCurrentEdge(ray, result, activeEdges, isBinding);
      result.collisions.forEach(pt => this.points.push(pt.x, pt.y));
      return;
    }

    // Case 7 - Otherwise we must be jumping to a new closest edge
    // limited -> edge

    this._beginNewEdge(ray, result, activeEdges, isBinding);
    result.collisions.forEach(pt => this.points.push(pt.x, pt.y));
  }

  /* -------------------------------------------- */

  /**
   * Changes to _getRayCollisions:
   * - Do not add a ray termination.
   * - Not needed because our canvas is always bound; not using limited radius rays.
   * Identify the collision points between an emitted Ray and a set of active edges.
   * @param {Ray} ray                   The candidate ray to test
   * @param {EdgeSet} activeEdges       The set of active edges
   * @param {number} [minimumDistance]  Require collisions to exceed some minimum distance
   * @returns {PolygonVertex[]}         A sorted array of collision points
   * @private
   */
  _getRayCollisions(ray, activeEdges, {minimumDistance=0}={}) {
    const collisions = [];
    const points = new Map();

    // Identify unique collision points
    for ( const edge of activeEdges ) {
      const x = foundry.utils.lineLineIntersection(ray.A, ray.B, edge.A, edge.B);
      if ( !x || (x.t0 <= minimumDistance) ) continue; // Require minimum distance

      // Get a unique collision point
      let c = PolygonVertex.fromPoint(x, {distance: x.t0});
      if ( points.has(c.key) ) c = points.get(c.key);
      else {
        points.set(c.key, c);
        collisions.push(c);
      }

      // Determine the orientation of the edge if the collision strikes a vertex
      let o = 0;
      if ( c.equals(edge.A) ) o = foundry.utils.orient2dFast(this.origin, edge.A, edge.B);
      else if ( c.equals(edge.B) ) o = foundry.utils.orient2dFast(this.origin, edge.B, edge.A);

      // Attach the edge to the collision point
      c.attachEdge(edge, o);
    }

    // Sort collisions on proximity to the origin
    collisions.sort((a, b) => a._distance - b._distance);

    // *** NEW ***: No additional ray termination

    return collisions;
  }

  /* -------------------------------------------- */
  /*  Polygon Construction                        */
  /* -------------------------------------------- */

  /**
   * Changes to _constructPolygonPoints:
   * - No padding for limited radius shapes (handled by intersecting circle shape after)
   * - No closing a limited shape
   * Construct the polygon from ray collision points
   * @private
   */
  _constructPolygonPoints() {
    console.warn("MyClockwiseSweepPolygon does not use _constructPolygonPoints.");
    super._constructPolygonPoints();
  }

  /* -------------------------------------------- */

  // Changes to visualize:
  // Handle change from Set to Map for this.edges
  /** @override */
  visualize() {
    const {radius, hasLimitedAngle, hasLimitedRadius, rMin, rMax} = this.config;

    let dg = canvas.controls.debug;
    dg.clear();

    // Text debugging
    if ( !canvas.controls.debug.debugText ) {
      canvas.controls.debug.debugText = canvas.controls.addChild(new PIXI.Container());
    }
    const text = canvas.controls.debug.debugText;
    text.removeChildren();

    // Define limitation colors
    const limitColors = {
      [CONST.WALL_SENSE_TYPES.NONE]: 0x77E7E8,
      [CONST.WALL_SENSE_TYPES.NORMAL]: 0xFFFFBB,
      [CONST.WALL_SENSE_TYPES.LIMITED]: 0x81B90C
    };

    // Draw the final polygon shape
    dg.beginFill(0x00AAFF, 0.25).drawShape(this).endFill();

    // Draw limiting radius
    if ( hasLimitedRadius ) {
      dg.lineStyle(8, 0xAACCFF, 0.5).drawCircle(this.origin.x, this.origin.y, radius);
    }

    // Draw limiting angles
    if ( hasLimitedAngle ) {
      dg.lineStyle(8, 0xAACCFF, 0.5).moveTo(rMin.A.x, rMin.A.y).lineTo(rMin.B.x, rMin.B.y);
      dg.lineStyle(8, 0xAACCFF, 0.5).moveTo(rMax.A.x, rMax.A.y).lineTo(rMax.B.x, rMax.B.y);
    }

    // Draw candidate edges
    // *** NEW ***: this.edges.values() b/c this.edges is a Map.
    for ( const edge of this.edges.values() ) {
      dg.lineStyle(4, limitColors[edge.type]).moveTo(edge.A.x, edge.A.y).lineTo(edge.B.x, edge.B.y);
    }

    // Draw vertices
    for ( const vertex of this.vertices.values() ) {
      dg.lineStyle(1, 0x000000).beginFill(limitColors[vertex.type]).drawCircle(vertex.x, vertex.y, 8).endFill();
      if ( vertex._index ) {
        const t = text.addChild(new PIXI.Text(String(vertex._index), CONFIG.canvasTextStyle));
        t.position.set(vertex.x, vertex.y);
      }
    }

    // *** NEW *** Draw bounding box, if any
    this.config.bbox && dg.lineStyle(1, 0x808080).drawShape(this.config.bbox.toPolygon()); // eslint-disable-line no-unused-expressions

    // Draw emitted rays
    for ( const ray of this.rays ) {
      const r = ray.result;
      if ( !r ) continue;
      dg.lineStyle(2, 0x00FF00, r.collisions.length ? 1.0 : 0.33).moveTo(ray.A.x, ray.A.y).lineTo(ray.B.x, ray.B.y);

      for ( const c of r.collisions ) {
        dg.lineStyle(1, 0x000000).beginFill(0xFF0000).drawCircle(c.x, c.y, 6).endFill();
      }
    }
  }


  // ---------------- DEPRECATED METHODS ---------------------------------------------------

  /**
   * Restrict the set of candidate edges to those which appear within the limited angle of emission.
   * @private
   */
  _restrictEdgesByAngle() {
    console.warn("MyClockwiseSweepPolygon does not use _restrictEdgesByAngle.");
    super._restrictEdgesByAngle();
  }

  /**
   * Process the candidate edges to further constrain them using a circular radius of effect.
   * @private
   */
  _constrainEdgesByRadius() {
    console.warn("MyClockwiseSweepPolygon does not use _constrainEdgesByRadius.");
    super._constrainEdgesByRadius();
  }

  /**
   * Identify collision points for a required terminal ray.
   * @private
   *
   * @param {Ray} ray                   The ray being emitted
   * @param {CollisionResult} result    The pending collision result
   * @param {EdgeSet} activeEdges       The set of currently active edges
   */
  _findRequiredCollision(ray, result, activeEdges) {
    console.warn("MyClockwiseSweepPolygon does not use _findRequiredCollision.");
    super._findRequiredCollision(ray, result, activeEdges);

  }

  /**
   * Add additional points to limited-radius polygons to approximate the curvature of a circle
   * @param {Ray} r0        The prior ray that collided with some vertex
   * @param {Ray} r1        The next ray that collides with some vertex
   * @private
   */
  _getPaddingPoints(r0, r1) {
    console.warn("MyClockwiseSweepPolygon does not use _getPaddingPoints.");
    super._getPaddingPoints(r0, r1);
  }

  // ---------------- NEW METHODS ----------------------------------------------------------

  /* -------------------------------------------- */
  /*  Configuration                               */
  /* -------------------------------------------- */

  /**
   * Test whether a user-supplied boundary polygon is valid.
   * @boundaryPolygon { PIXI.Polygon|PIXI.Circle|PIXI.Rectangle }
   * @return {boolean} True if closed and contains the origin point.
   */
  validateBoundaryPolygon() {
    // Any PIXI.Polygon, PIXI.Rectangle or PIXI.Circle should work.
    // Objects that are not polygons must either:
    // - have intersectPolygon method that takes a PIXI.Polygon or
    // - have a toPolygon method
    let boundaryPolygon = this.config.boundaryPolygon;

    if (!boundaryPolygon) {
      // Should not happen, b/c validate is only called when there is a boundaryPolygon
      log("ClockwiseSweep: boundaryPolygon undefined.");
      return false;
    }

    // Need to ensure the boundary encompasses the origin; otherwise intersect can fail
    // or may create holes.
    if (!boundaryPolygon?.contains(this.origin.x, this.origin.y)) {
      log(`ClockwiseSweep: boundaryPolygon does not contain origin ${this.origin.x},${this.origin.y}.`, boundaryPolygon);
      return false;
    }

    // Bounds required to create bbox.
    if (!("getBounds" in boundaryPolygon)) {
      log("ClockwiseSweep: boundaryPolygon has no 'getBounds' method.", boundaryPolygon);
      return false;
    }

    if (boundaryPolygon instanceof PIXI.Polygon) {
      // Assumed that polygon creates a closed shape
      boundaryPolygon.close();
    } else if (!("intersectPolygon" in boundaryPolygon)) {
      this.config.boundaryPolygon = boundaryPolygon?.toPolygon();
      if (!this.config.boundaryPolygon) {
        log("ClockwiseSweep: boundaryPolygon has no 'toPolygon' or 'intersect' method.", boundaryPolygon);
        return false;
      }
    }

    return true;
  }

  /**
   * Get bounding box for the boundary polygon but
   * expanded so that it definitely includes origin.
   * Does not explicitly check for this.config.hasBoundary but will return undefined if
   * no bounding box is present.
   * Will intersect limited angle and limited radius bounding boxes if both present.
   * @return {NormalizedRectangle|undefined}  Bounding box, if any
   * @private
   */
  _constructBoundingBox() {
    /* eslint-disable indent */
    const { boundaryPolygon,
            limitedAngle,
            hasCustomBoundary } = this.config;
    /* eslint-enable indent */

    // Use undefined so we can skip quadtree (as opposed to using canvas.dimensions.rect)
    if ( !hasCustomBoundary ) return undefined;

    // Start with the canvas bbox
    let bbox = canvas.dimensions.rect;

    boundaryPolygon && (bbox = bbox.intersection(boundaryPolygon.getBounds())); // eslint-disable-line no-unused-expressions
    limitedAngle && (bbox = bbox.intersection(limitedAngle.getBounds())); // eslint-disable-line no-unused-expressions

    // Convert to NormalizedRectangle, which is expected by _getWalls.
    // Should probably be handled by the respective getBounds methods above.
    bbox = new NormalizedRectangle(bbox.x, bbox.y, bbox.width, bbox.height);

    bbox.ceil(); // Force the box to integer coordinates.

    // Expand to definitely include origin (otherwise, sweep algorithm could fail)
    // (Probably shouldn't happen, as boundaryPolygon is previously validated)
    bbox.padToPoint(this.origin);

    // Expand out by 1 to ensure origin is contained
    // (Necessary if origin falls on a boundary edge)
    bbox.pad(1);

    return bbox;
  }

  /**
   * Add temporary edges if any provided; make sure intersections between such edges
   * are identified, if any overlap.
   */
  _constructTemporaryEdges() {
    const tempEdges = this.config.tempEdges ?? [];

    if (tempEdges.length) {
      // Cannot guarantee the customEdges have intersections set up,
      // so process that set here before combining with edges that we know do not intersect.
      this.config.findIntersectionsSingle(tempEdges, identifyIntersectionsWithNoEndpoint);
    }

    return tempEdges;
  }


  /* -------------------------------------------- */
  /*  Edge Configuration                          */
  /* -------------------------------------------- */

  /**
   * Add walls identified by the user.
   * Optional, but used by Light Mask module to allow arbitrary cached walls.
   * May be useful in default Foundry for caching walls that outline, for example,
   * river borders where you want to play river sounds but not otherwise have
   * the river walled off on the canvas.
   *
   * In config.customEdges, my proposal is that the user provide an array
   * of objects that have:
   * - A and B points, as in Walls, Rays, etc.
   * - Optional type names as used in wall.data.
   * @private
   */
  _addCustomEdges() {
    const { customEdges, type } = this.config;

    if (!customEdges || customEdges.length === 0) return;

    // Need to track intersections for each edge.
    // Cannot guarantee the customEdges have intersections set up, so
    // process each in turn.
    // Thus, cannot sort edges_array in advance; must let identifyIntersections
    // re-sort at each addition.
    const edges_array = Array.from(this.edges.values());
    for ( const data of customEdges ) {
      const edge = new SimplePolygonEdge(data.A, data.B, data[type]);
      edge._identifyIntersections(edges_array);
      this.edges.set(edge.id, edge);
      edges_array.push(edge);
    }
  }


  /* -------------------------------------------- */
  /*  Vertex Identification                       */
  /* -------------------------------------------- */

  /**
   * Moved from _identifyIntersections to allow easy processing of
   * temporary edge intersections using separate loop.
   * @param {SimplePolygonEdge} edge
   * @param {SimplePolygonEdge} other
   * @param {Point} intersection     Intersection point between edge and other.
   * @private
   */
  _registerIntersection(edge, other, intersection) {
    // Register the intersection point as a vertex
    let v = PolygonVertex.fromPoint(intersection);
    if ( this.vertices.has(v.key) ) v = this.vertices.get(v.key);
    else {
      // Ensure the intersection is still inside our limited angle

      this.vertices.set(v.key, v);
    }

    // Attach edges to the intersection vertex
    if ( !v.edges.has(edge) ) v.attachEdge(edge, 0);
    if ( !v.edges.has(other) ) v.attachEdge(other, 0);
  }

  /**
   * Test if vertex is outside the boundary
   */
  _vertexOutsideBoundary(v) {
    const { bbox, limitedAngle } = this.config;

    if (limitedAngle) {
      // Could just use the bbox but better to eliminate as many as possible.
      // So check against the limited angle as well
      return !(bbox.containsPoint(v) || limitedAngle.containsPoint(v));
    }

    return !bbox.containsPoint(v);
  }

  /* -------------------------------------------- */
  /* Compute Step 5: Intersect Boundary           */
  /* -------------------------------------------- */

  /**
   * Given the computed sweep points, intersect the sweep polygon
   * against a boundary, if any.
   * Two possibilities:
   * 1. Intersect the limited radius circle; or
   * 2. Intersect a provided polygon boundary
   * (limited angle handled in the sweep using temp walls)
   */
  _intersectBoundary() {
    const { boundaryPolygon, limitedAngle } = this.config;
    const pts = this.points;

    // Store a copy for debugging
    this.config.debug && (this._sweepPoints = [...pts]); // eslint-disable-line no-unused-expressions

    // Jump early if nothing to intersect
    // need three points (6 coords) to form a polygon to intersect
    if (pts.length < 6) return;

    // May be relevant for intersecting that the sweep points form a closed, clockwise polygon
    // Clockwise is a difficult calculation, but can set the underlying property b/c
    // we know the sweep here forms a clockwise polygon.
    this._isClockwise = true;

    let poly = this;

    // Must construct the boundary polygon first.
    // Otherwise, the limited angle may be incorrect because all edges outside the
    // boundary have been trimmed.
    // (This should be tested more; not clear this is definitely true or could not be fixed in other ways.
    //  But was definitely a problem in the past.)

    // If there is a boundaryPolygon, use its intersectPolygon method if available.
    // Fall back on passing the boundary to clipper to intersect.
    // This allows us to pass things other than polygons as boundaries, such as circles
    // or rectangles.
    if (boundaryPolygon) {
      const res = (typeof boundaryPolygon.intersectPolygon === "function")
        && boundaryPolygon.intersectPolygon(poly);
      poly = res || poly.clipperClip(boundaryPolygon, { cliptype: ClipperLib.ClipType.ctIntersection });
    }

    limitedAngle && (poly = limitedAngle.intersectPolygon(poly)); // eslint-disable-line no-unused-expressions

    // If poly is null, length less than 6, or undefined, something has gone wrong: no intersection found.
    if (!poly || poly.length < 6) {
      console.warn(`MyClockwiseSweep2|intersectBoundary failed. Origin ${this.origin.x},${this.origin.y}. ${this._sweepPoints.length} sweep points.`, poly);
      return;
    }

    this.points = poly.points;
  }

}

