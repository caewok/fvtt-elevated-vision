/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "../const.js";
import { pointVTest, tangentToV } from "../util.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Draw } from "../geometry/Draw.js";

const ENDPOINT_LABELS = ["a", "b"];

const FLIP_ENDPOINT_LABEL = {
  a: "b",
  b: "a"
};

const COLOR_KEYS = {
  umbra: Draw.COLORS.red,
  midpenumbra: Draw.COLORS.orange,
  penumbra: Draw.COLORS.yellow
};


/**
 * Calculate the shadow parameters for a given source and wall.
 * Fed to the shader to create the shadows.
 * UMBRA: 0, MID: 1, PENUMBRA: 2
 * Determines the attributes (geometry) needed for the shader:
 *
 * Variable:
 * - @type {vec2} sidePenumbra (x: side0, y: side1)     Barycentric coordinates for the side penumbra
 * - @type {vec2} vertexPosition                        Canvas positions for the penumbra triangle
 *
 * Flats (distributed among the vertices)
 * - @type {vec3} near (x: fNearUmbra, y: fNearMidPenumbra, z: fNearPenumbra)
 * - @type {vec3} far (x: fFarUmbra, y: fFarMidPenumbra, z: wallHeightBottom1) (bottom1 currently unused)
 * - @type {vec3} heights (x: wallHeightTop0, y: wallHeightBottom0, z: wallHeightTop1) (top1 currently unused)
 * - @tupe {vec3} other (x: fWallRatio, y: fWallSenseType, z: fThresholdRadius)
 */
export class SourceEdgeShadows {

  /** @type {RenderedSource} */
  source;

  /** @type {Edge} */
  edge;

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  sourceType = "light";

  /** @type {number} */
  minCanvasElevation = -1000; // Must match the shader uElevationRes.x.

  constructor(source, edge) {
    this.source = source;
    this.edge = edge;
    this.sourceType = source.constructor.sourceType;
  }

  // ----- NOTE: Basic getters ----- //

  /** @type {Point3d} */
  get sourcePosition() {
    const src = this.source;
    return new CONFIG.GeometryLib.threeD.Point3d(src.x, src.y, src.elevationZ);
  }

  /** @type {CONST.WALL_SENSE_TYPES} */
  get wallSenseType() { return this.edge[this.sourceType]; }

  /** @type {number} */
  get sourceSize() { return this.source.data.lightSize || 0; }

  /** @type {Plane} */
  get canvasPlane() {
    const { Plane, Point3d } = CONFIG.GeometryLib.threeD;
    const normal = Point3d._tmp.set(0, 0, 1);
    const point = Point3d._tmp2.set(0, 0, this.minCanvasElevation);
    return new Plane(point, normal);
  }

  /**
   * @typedef {object} EdgeEndpoint
   * @param {Point3d} top
   * @param {Point3d} bottom
   */

  /** @typedef {EdgeEndpoint[2]} */
  get edgeEndpoints() {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const { top, bottom } = this.wallHeights;
    const { a, b } = this.edge;
    return [
      { top: new Point3d(a.x, a.y, top), bottom: new Point3d(a.x, a.y, bottom) },
      { top: new Point3d(b.x, b.y, top), bottom: new Point3d(b.x, b.y, bottom) },
    ];
  }

  /** @typedef {PIXI.Point} */
  get wallDirection() { return normalizedDirection(this.edge.a, this.edge.b); }

  /**
   * Calculate the wall height values
   * @returns {object}
   */
  get wallHeights() {
    // TODO: Distinguish a from b.
    const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
    const elevations = this.edge.elevationLibGeometry;
    return { top: gridUnitsToPixels(elevations.a.top), bottom: gridUnitsToPixels(elevations.a.bottom) };
  }

  /**
   * @typedef {object} SourcePoints
   * Cross that defines a light/vision source with given size.
   * @param {Point3d} center
   * @param {Point3d} lr0     Closest to the edge 0 endpoint
   * @param {Point3d} lr1     Closest to the edge 1 endpoint
   * @param {Point3d} top
   * @param {Point3d} bottom
   */

  /** @typedef {SourcePoints} */
  get sourcePoints() {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const { wallDirection, sourceSize, sourcePosition } = this;
    const scaledDir = wallDirection.multiplyScalar(sourceSize);
    const lr3d = Point3d._tmp.set(scaledDir.x, scaledDir.y, 0);
    const top3d = Point3d._tmp2.set(0, 0, sourceSize);
    return {
      center: sourcePosition,
      lr0: sourcePosition.subtract(lr3d),
      lr1: sourcePosition.add(lr3d),
      top: sourcePosition.add(top3d),
      bottom: sourcePosition.subtract(top3d)
    };
  }

  // ----- NOTE: Cached getters ----- //

  /** @type {boolean} */
  #dirty = true;

  get dirty() { return this.#dirty; }

  set dirty(value) { this.#dirty ||= value; }

  /**
   * @typedef {object} ShadowStruct<*>
   * Each parameter is the same, but can be a float, PIXI.Point, or Point3d.
   * @param {*} umbra
   * @param {*} midpenumbra
   * @param {*} penumbra
   */

  /**
   * Normalized hange in z value moving from the light to the wall 0 bottom (near shadow).
   * @returns {ShadowStruct<Ray3d>}
   */
  nearRays() {
    const endpoint = this.edgeEndpoints[0].bottom;
    const src = this.sourcePoints;
    return {
      umbra: Ray3d.fromPoints(src.bottom, endpoint),
      midpenumbra: Ray3d.fromPoints(src.center, endpoint),
      penumbra: Ray3d.fromPoints(src.top, endpoint)
    };
  }

  /**
   * Normalized change in z value moving from the light to the wall 0 top (far shadow).
   * @returns {ShadowStruct<Ray3d>}
   */
  farRays() {
    const endpoint = this.edgeEndpoints[0].top;
    const src = this.sourcePoints;
    return {
      umbra: Ray3d.fromPoints(src.top, endpoint),
      midpenumbra: Ray3d.fromPoints(src.center, endpoint),
      penumbra: Ray3d.fromPoints(src.bottom, endpoint)
    };
  }

  /**
   * Normalized 2d direction for the side shadow.
   * @param {number} [idx=0]
   * @returns {ShadowStruct<Ray2d>}
   */
  sideRays(idx = 0, adjust = true) {
    const endpoint = this.edgeEndpoints[idx].top.to2d();
    const src = this.sourcePoints;
    const umbraSrc = idx === 0 ? src.lr0 : src.lr1;
    const penumbraSrc = idx === 0 ? src.lr1 : src.lr0;
    const rays = {
      umbra: Ray2d.fromPoints(umbraSrc, endpoint), // Will implicitly convert source to 2d.
      midpenumbra: Ray2d.fromPoints(src.center, endpoint),
      penumbra: Ray2d.fromPoints(penumbraSrc, endpoint)
    };
    if ( adjust ) this.adjustSideRaysForLinkedEndpoints(rays, idx);
    return rays;
  }

  /**
   * Adjust side penumbra directions to address light leakage, if necessary, from linked endpoints.
   * @param {ShadowStruct<Ray2d>} sideRays
   * @param {0|1} idx
   */
  adjustSideRaysForLinkedEndpoints(sideRays, idx = 0) {
    // If no linked wall, full penumbra is used.
    const linkAngle = this.blockingEdgeAngle(idx);
    if ( linkAngle === this.constructor.EV_ENDPOINT_LINKED_UNBLOCKED ) return;

    // Determine orientation relative to the mid-penumbra.
    // 4 quadrants:
    // 1 & 2: linked wall is on opposite side from wall, so it blocks.
    // 3 & 4: linked wall is on same side as light:
    // - 3: Linked wall not between wall and mid: no block (tight "V")
    // - 4: Linked wall between wall and mid
    //     • If umbra - linked - mid-penumbra, adjust umbra direction.
    //     • If umbra - mid - linked - penumbra, umbra set to mid.
    const orient = foundry.utils.orient2dFast;
    const endpoint = this.edgeEndpoints[idx].top;
    const otherEndpoint = this.edgeEndpoints[1 - idx].top;

    // Point positions.
    const linkPt = PIXI.Point.fromAngle(endpoint, linkAngle, 1.0);
    const midR = new Ray2d(endpoint, sideRays.midpenumbra);
    const midPt = midR.project(1.0);

    // Orientation re mid.
    const oMidLink = orient(endpoint, midPt, linkPt);
    const oMidWall = orient(endpoint, midPt, otherEndpoint);

    // 1 & 2: linked wall blocks light.
    const linkOppositeWall = oMidWall * oMidLink <= 0.0;
    if ( linkOppositeWall ) {
      sideRays.umbra.x = sideRays.midpenumbra.x;
      sideRays.umbra.y = sideRays.midpenumbra.y;

      sideRays.penumbra.x = sideRays.midpenumbra.x;
      sideRays.penumbra.y = sideRays.midpenumbra.y;
      return;
    }

    // 3 & 4: Linked wall between wall and mid
    // 3: Linked wall in quadrant with light, not blocking.
    const oLinkWall = orient(endpoint, linkPt, otherEndpoint);
    const oLinkMid = orient(endpoint, linkPt, midPt);
    const linkBetweenWallAndMid = oLinkWall * oLinkMid < 0.0;
    if ( !linkBetweenWallAndMid ) return;

    // 4. possible block.
    // What side of umbra is the linked wall on? If not on the mid-side, it doesn't block.
    const umbraR = new Ray2d(endpoint, sideRays.umbra);
    const umbraPt = umbraR.project(1);
    const oUmbraLink = orient(endpoint, umbraPt, linkPt);
    const oUmbraMid = orient(endpoint, umbraPt, midPt);
    const linkAfterUmbra = oUmbraLink * oUmbraMid > 0.0;
    if ( !linkAfterUmbra ) return;

    // Linked wall is after umbra, moving toward mid.
    const oMidUmbra = orient(endpoint, midPt, umbraPt);

    // Set umbra to the link direction.
    // TODO: This results in a non-normalized direction. Is there a way to get the normalized direction?
    // - normalizing again could change x/y, so cannot do that ?
    const linkDir = normalizedDirection(endpoint, linkPt);
    sideRays.umbra.x = linkDir.x;
    sideRays.umbra.y = linkDir.y;
    if ( oMidUmbra * oMidLink > 0.0 ) return;

    // Linked wall is after mid; adjust mid as well.
    sideRays.midpenumbra.x = linkDir.x;
    sideRays.midpenumbra.y = linkDir.y;
  }

  /**
   * Calculate the vertex positions (the penumbra triangle).
   * @returns {PIXI.Point[3]}
   */
  vertexPositions() { return this.buildTriangle("far", "penumbra"); }

  /**
   * Calculate the side penumbra for a given side as barycentric coordinates.
   * @param {0|1} idx
   * @returns {BarycentricPoint[3]} The coordinates, for vertices 0, 1, 2
   */
  sidePenumbra(idx = 0) {
    const orient = foundry.utils.orient2dFast;
    const penumbraTri = this.buildTriangle("far", "penumbra");
    const umbraTri = this.buildTriangle("far", "umbra");
    const edgeEndpoints = this.edgeEndpoints;
    const out = Array(3);
    for ( let vertexNum = 0; vertexNum < 2; vertexNum += 1 ) {
      const pt = penumbraTri[vertexNum];
      const a = edgeEndpoints.top[idx];
      const b = penumbraTri[idx + 1];
      const c = umbraTri[idx + 1];
      if ( Math.abs(orient(a, b, c)) < 1 ) out[vertexNum] = new BarycentricPoint(-1, -1, -1);
      else out[vertexNum] = BarycentricPoint.coordinates(pt, a, b, c);
    }
    return out;
  }

  /**
   * Calculate the near/far ratios (Barycentric x values for the given triangle end.)
   * @param {"far"|"near"} type
   * @returns {ShadowStruct<number>}
   */
  nearFarRatios(type = "far") {
    const penumbraTri = this.buildTriangle("far", "penumbra");
    const triData = BarycentricPoint._triangleData(penumbraTri[0], penumbraTri[1], penumbraTri[2]);
    const pts = this.shadowCanvasIntersections(type)[0];
    return {
      umbra: BarycentricPoint._coordinates(pts.umbra, triData).x,
      midpenumbra: BarycentricPoint._coordinates(pts.midpenumbra, triData).x,
      penumbra: type === "far" ? 0 : BarycentricPoint._coordinates(pts.penumbra, triData).x,
    };
  }

  /**
   * Calculate the wall ratio. This is the barycentric x-value on the shader (penumbra) triangle
   * for the location of the wall.
   * @returns {number}
   */
  wallRatio() {
    const penumbraTri = this.buildTriangle("far", "penumbra");
    const endpoint = this.edgeEndpoints[0].top;
    return BarycentricPoint.coordinates(endpoint, penumbraTri[0], penumbraTri[1], penumbraTri[2]).x;
  }

  /**
   * Calculate the threshold radius distance.
   * @returns {number}   Distance of the threshold in pixel units, or 0 if none.
   */
  thresholdRadius2() {
    if ( !this.thresholdApplies(this.edge) ) return 0;
    const { inside, outside } = this.calculateThresholdAttenuation();
    return Math.min(Number.MAX_SAFE_INTEGER, Math.pow(inside + outside, 2)); // Avoid infinity.
  }

  // ----- NOTE: Calculations ----- //

  /**
   * Determine the point where the near/far penumbra intersects the side penumbra, if any
   * @param {0|1} idx          Index of the wall endpoint to intersect
   * @param {"near"|"far"} type   Whether this is the near or far shadow
   * @param {"penumbra"|"midpenumbra"|"umbra"} shadowType
   * @param {PIXI.Point} [outPoint]
   * @returns {PIXI.Point|null}
   */
  _shadowCanvasIntersection(idx = 0, type = "far", shadowType = "penumbra", outPoint) { // eslint-disable-line default-param-last
    const { canvasPlane } = this;
    const nearFarRays = type === "far" ? this.farRays() : this.nearRays();
    const ray3d = nearFarRays[shadowType];
    const infiniteShadow = ray3d.direction.z >= 0;
    if ( infiniteShadow ) return null;
    const canvasIx = ray3d.intersectPlane(canvasPlane);
    if ( !canvasIx ) return null;

    // Draw a line parallel to the wall that goes through the intersection point.
    // The intersection of that with the side penumbra defines the point.
    const farParallelRay = new Ray2d(canvasIx, this.wallDirection);
    return farParallelRay.intersectRay(this.sideRays(0)[shadowType], outPoint);
  }

  /**
   * Get either the point where the penumbra direction intersects the canvas or the point
   * at maximum canvas distance, as measured from wall endpoint 0.
   * Calculates points from both wall endpoints 0 and 1.
   * @param {"near"|"far"} type
   * @param {"penumbra"|"midpenumbra"|"umbra"} shadowType
   * @returns {PIXI.Point[2]}
   */
  _shadowCanvasIntersections(type = "far", shadowType = "penumbra") {
    // If infinite shadow; extend sufficiently far to cover the canvas.
    const keyPoint = new PIXI.Point();
    if ( !this._shadowCanvasIntersection(0, type, shadowType, keyPoint) ) {
      this.#parallelFarCorner(type, shadowType, keyPoint);
    }

    // Get the other endpoint by intersecting the other ray.
    // TODO: If the endpoint heights are different, a more nuanced approach would be required.
    const canvasIxs = [new PIXI.Point(), new PIXI.Point()];
    const farParallelRay = new Ray2d(keyPoint, this.wallDirection);
    farParallelRay.intersectRay(this.sideRays(0)[shadowType], canvasIxs[0]);
    farParallelRay.intersectRay(this.sideRays(1)[shadowType], canvasIxs[1]);
    return canvasIxs;
  }

  /**
   * Get all three intersections of the shadow with the canvas plane for the wall.
   * @param {"near"|"far"} type
   * @returns ShadowStruct<PIXI.Point>[2]
   */
  shadowCanvasIntersections(type = "far") {
    const umbra = this._shadowCanvasIntersections(type, "umbra");
    const midpenumbra = this._shadowCanvasIntersections(type, "midpenumbra");
    const penumbra = this._shadowCanvasIntersections(type, "penumbra");
    return [
      { umbra: umbra[0], midpenumbra: midpenumbra[0], penumbra: penumbra[0] },
      { umbra: umbra[1], midpenumbra: midpenumbra[1], penumbra: penumbra[1] }
    ];
  }

  /**
   * Build the triangle to represent this light's shadow vis-a-vis the wall.
   * @param {"near"|"far"} type
   * @param {"penumbra"|"midpenumbra"|"umbra"} shadowType
   * @returns {PIXI.Point[3]}
   */
  buildTriangle(type = "far", shadowType = "penumbra") {
    // Construct a new light position based on the xy intersection of the penumbra points --> wall corner
    const ixs = this.shadowCanvasIntersections(type);
    const b = ixs[0][shadowType];
    const c = ixs[1][shadowType];
    const edgeEndpoints = this.edgeEndpoints;
    const ix = foundry.utils.lineLineIntersection(b, edgeEndpoints[0].top, c, edgeEndpoints[1].top);
    return [PIXI.Point.fromObject(ix), b, c];
  }

  /**
   * Get the corner that can be used to project a far parallel ray to a wall.
   * Used in penumbraEndpoints to determine the infinite shadow parallel ray.
   * @param {"near"|"far"} type   Whether this is the near or far shadow
   * @param {"penumbra"|"midpenumbra"|"umbra"} shadowType
   * @param {PIXI.Point} [outPoint]
   * @returns {PIXI.Point}
   */
  #parallelFarCorner(type = "far", shadowType = "penumbra", outPoint) { // eslint-disable-line default-param-last
    outPoint ??= new PIXI.Point();
    const orient = foundry.utils.orient2dFast;
    const { edgeEndpoints } = this;
    const e0 = edgeEndpoints[0].to2d();
    const e1 = edgeEndpoints[1].to2d();
    const rays = type === "far" ? this.farRays() : this.nearRays();
    const dir = rays[0][shadowType].direction.to2d().normalize();
    const rect = canvas.dimensions.sceneRect;
    const { left, right, top, bottom } = rect;
    const wallDirection = this.wallDirection;

    // Ensure the shadow extends to the canvas edges.
    // Set the far parallel to intersect a corner.
    const oWallSource = orient(e0, e1, e0.subtract(dir));
    if ( wallDirection.x === 0 ) {
      // Wall parallel to left/right.
      const TL = PIXI.Point._tmp2.set(left, top);
      const TR = PIXI.Point._tmp3.set(right, top);
      const oTL = orient(e0, e1, TL);
      return outPoint.copyFrom((oTL * oWallSource) < 0.0 ? TL : TR);
    }
    if ( wallDirection.y === 0 ) {
      // Wall parallel to top/bottom.
      const TL = PIXI.Point._tmp2.set(left, top);
      const BL = PIXI.Point._tmp3.set(left, bottom);
      const oTL = orient(e0, e1, TL);
      return outPoint.copyFrom((oTL * oWallSource) < 0.0 ? TL : BL);
    }

    // One corner opposite the light can be used; its line will not intersect the canvas rect.
    // Cycle through the 4 corners: TL, TR, BL, BR
    const lr = [left, right];
    const tb = [top, bottom];
    for ( let i = 0; i < 2; i += 1 ) {
      const y = tb[i];
      for ( let j = 0; j < 2; j += 1 ) {
        const x = lr[j];
        const corner = PIXI.Point._tmp3.set(x, y);
        const oCorner = orient(e0, e1, corner);
        if ( (oCorner * oWallSource) < 0 ) {
          const testPt = corner.add(wallDirection, PIXI.Point._tmp); // Project 1 pixel
          if ( !rect.contains(testPt.x, testPt.y) ) return outPoint.copyFrom(corner);
        }
      }
    }
    return new PIXI.Point(left, top); // Should not happen.
  }


  /**
   * For threshold edges, determine if threshold applies.
   * @returns {boolean} True if the threshold applies.
   */
  thresholdApplies() { return this.edge.applyThreshold(this.sourceType, this.source, this.source.data.externalRadius); }

  /**
   * Calculate threshold attenuation for an edge.
   * If the edge is not attenuated, inside + outside will be >= source radius.
   * See PointSourcePolygon.prototype.#calculateThresholdAttenuation
   * @returns {{inside: number, outside: number}} The inside and outside portions of the radius
   */
  calculateThresholdAttenuation() {
    const externalRadius = 0;
    const radius = this.source.radius;
    const origin = this.source;
    const { edge, sourceType } = this;
    const d = edge.threshold?.[sourceType];
    if ( !d ) return { inside: radius, outside: radius };
    const proximity = edge[sourceType] === CONST.WALL_SENSE_TYPES.PROXIMITY;

    // Find the closest point on the threshold wall to the source.
    // Calculate the proportion of the source radius that is "inside" and "outside" the threshold wall.
    const pt = foundry.utils.closestPointToSegment(origin, edge.a, edge.b);
    const inside = Math.hypot(pt.x - origin.x, pt.y - origin.y);
    const outside = radius - inside;
    if ( (outside < 0) || outside.almostEqual(0) ) return { inside, outside: 0 };

    // Attenuate the radius outside the threshold wall based on source proximity to the wall.
    const sourceDistance = proximity ? Math.max(inside - externalRadius, 0) : (inside + externalRadius);
    const thresholdDistance = d * canvas.scene.dimensions.distancePixels;
    const percentDistance = sourceDistance / thresholdDistance;
    const pInv = proximity ? 1 - percentDistance : Math.min(1, percentDistance - 1);
    const a = (pInv / (2 * (1 - pInv))) * CONFIG.Wall.thresholdAttenuationMultiplier;
    return { inside, outside: a * thresholdDistance };
  }

  // ----- NOTE: Linked edges ----- //

  /**
   * Signal that a wall endpoint has no linked walls.
   * @type {number}
   */
  static EV_ENDPOINT_LINKED_UNBLOCKED = -10.0;

  /**
   * Signal that a linked wall to the edge will completely block the light.
   */
  static EV_ENDPOINT_LINK_BLOCKED = -20.0;

  /**
   * Get edges that share an endpoint with this edge.
   * Organize by shared endpoint.
   * See Wall.prototype.getLinkedSegments for recursive version.
   * @param {0|1} idx
   * @returns {Edge[]}
   */
  getLinkedEdges(idx = 0) {
    const edge = this.edge;
    const eIdx = ENDPOINT_LABELS[idx];
    const key = edge[eIdx].key;
    return [...canvas.edges.values()].filter(e => {
      if ( e === edge ) return false;
      const eA = e.a.key;
      const eB = e.b.key;
      return key === eA || key === eB;
    });
  }

  /**
   * Is the line between the source origin and the point of the V tangential to the V?
   * If the source is inside the V, this is false.
   * If the source --> point of the V will end inside the V, it is also false.
   * Source --> point of V must end outside the V.
   * Tangential points do not block the light, but rather cause shadows.
   * @param {Edge} linkedEdge           Linked edge to test for this endpoint
   * @param {0|1} idx                   Which endpoint to test
   * @returns {number}
   *   -2 if not tangential to the V.
   *   -1 if not blocking.
   *   Angle in degrees outside the "V" if the point is tangential.
   */
  sharedEndpointAngle(linkedEdge, idx = 0) {
    const { EV_ENDPOINT_LINKED_UNBLOCKED, EV_ENDPOINT_LINK_BLOCKED } = this.constructor;

    // Quicker to check the map first.
    // TODO: What about !this._triEdgeMap.has(linkedEdge.id) ?
    if ( !this._includeEdge(linkedEdge) ) return EV_ENDPOINT_LINKED_UNBLOCKED;

    const eIdx = ENDPOINT_LABELS[idx];
    const edge = this.edge;
    const sharedPt = edge[eIdx];
    const otherEdgePt = edge[FLIP_ENDPOINT_LABEL[eIdx]]; // Flip: a --> b, b --> a.
    const otherLinkedPt = linkedEdge.a.key === sharedPt.key ? linkedEdge.b : linkedEdge.a;
    const sourceOrigin = this.sourceOrigin;
    if ( !tangentToV(otherEdgePt, sharedPt, otherLinkedPt, sourceOrigin) ) return EV_ENDPOINT_LINK_BLOCKED;
    return pointVTest(otherEdgePt, sharedPt, otherLinkedPt, sourceOrigin);
  }

  /**
   * Should this edge be included in the geometry for this source shadow?
   * @param {Edge} [edge]
   * @returns {boolean}   True if edge should be included
   */
  _includeEdge(edge) {
    edge ??= this.edge;
    if ( edge.type !== "wall" && edge.type !== "regionWall" ) return false;
    return this.source[MODULE_ID]._testEdgeInclusion(edge, PIXI.Point.fromObject(this.source));
  }

  /**
   * Determine the blocking edge angle, if any, for this edge.
   * @param {0|1} idx
   * @returns {number|EV_ENDPOINT_LINKED_UNBLOCKED|EV_ENDPOINT_LINK_BLOCKED} 0 to 360 or special negative values.
   */
  blockingEdgeAngle(idx = 0) {
    const { EV_ENDPOINT_LINKED_UNBLOCKED, EV_ENDPOINT_LINK_BLOCKED } = this.constructor;

    // Note if wall is bound to another.
    // Required to avoid light leakage due to penumbra in the shader.
    // Don't include the link if it is not a valid wall for this source.
    const linkedEdges = this.getLinkedEdges(idx);

    // Find the smallest angle between this wall and a linked wall that covers this light.
    // If less than 180º, the light is inside a "V" and so the point of the V blocks all light.
    // If greater than 180º, the light is outside the "V" and so the point of the V may not block all light.
    let blockingEdge;
    let blockingAngle = 360;
    for ( const linkedEdge of linkedEdges ) {
      const testAngle = this.sharedEndpointAngle(linkedEdge, idx);
      if ( testAngle === EV_ENDPOINT_LINKED_UNBLOCKED || testAngle > blockingAngle ) continue;
      blockingEdge = linkedEdge;
      blockingAngle = testAngle;
      if ( testAngle === EV_ENDPOINT_LINK_BLOCKED ) break;
    }

    // For a given wall, its "w" coordinate is:
    // -2: The two walls are concave w/r/t the light, meaning light is completely blocked.
    // -1: No blocking
    // 0+: wall.key representing location of the opposite endpoint of the linked wall.
    return blockingAngle === 360 ? EV_ENDPOINT_LINKED_UNBLOCKED
      : this.linkedWallAngle(blockingEdge, idx);
  }

  /**
   * Angle of the linked wall, measured from the shared endpoint.
   * @param {Edge} linkedEdge           Linked edge to test for this endpoint
   * @param {0|1} idx                   Which endpoint to use
   * @returns {number}
   *   -10 if not blocking.
   *   Angle in radians between -π and π
   */
  linkedWallAngle(linkedEdge, idx = 0) {
    // TODO: Use !this._triEdgeMap.has(linkedEdge.id) ?
    if ( !this._includeEdge(linkedEdge) ) return this.constructor.EV_ENDPOINT_LINKED_UNBLOCKED;

    const eIdx = ENDPOINT_LABELS[idx];
    const sharedPt = this.edge[eIdx];
    const otherLinkedPt = linkedEdge.a.key === sharedPt.key ? linkedEdge.b : linkedEdge.a;

    // Same as Foundry's Ray.angle.
    return Math.atan2(otherLinkedPt.y - sharedPt.y, otherLinkedPt.x - sharedPt.x);
  }

  // ----- NOTE: Drawings ----- //

  drawEdge() { Draw.segment(this.edge); }

  drawSource() {
    Draw.point(this.sourcePosition, { radius: this.sourceSize || 1, color: Draw.COLORS.yellow });
  }

  drawTriangle(type = "far", shadowType = "penumbra") {
    const tri = this.buildTriangle(type, shadowType);
    const poly = new PIXI.Polygon(...tri);
    const color = COLOR_KEYS[shadowType];
    Draw.shape(poly, { color });
  }

  drawSideRays(adjust = true, dist = canvas.dimensions.maxR) {
    for ( const i of [0, 1] ) {
      const sideRays = this.sideRays(i, adjust);
      for ( const [key, color] of Object.entries(COLOR_KEYS) ) {
        const ray = sideRays[key];
        const penumbraPt = ray.project(dist);
        Draw.segment({ a: ray.origin, b: penumbraPt }, { color });
      }
    }
  }
}


export class PointSourceWallShadows extends SourceEdgeShadows {

}

export class DirectionalSourceWallShadows extends SourceEdgeShadows {

}

export class VisionSourceWallShadows extends SourceEdgeShadows {

}

/**
 * Cross x and y parameters for 2d points.
 * @param {PIXI.Point} a  First vector
 * @param {PIXI.Point} b  Second vector
 * @returns {float} The cross product
 */
function cross2d(a, b) { return (a.x * b.y) - (a.y * b.x); }

/**
 * Calculate the normalized difference between two points.
 * @param {PIXI.Point|Point3d} a
 * @param {PIXI.Point|Point3d} b
 * @param {PIXI.Point|Point3d} [outPoint]
 * @returns {PIXI.Point|Point3d}
 */
function normalizedDirection(a, b, outPoint) {
  outPoint ??= new a.constructor();
  return b.subtract(a, outPoint).normalize(outPoint);
}

export class Ray2d {

  /** @type {PIXI.Point} */
  origin = new PIXI.Point();

  /** @type {PIXI.Point} */
  direction = new PIXI.Point();

  /**
   * @param {PIXI.Point} origin
   * @param {PIXI.Point} dir      In most cases, should be normalized
   */
  constructor(origin, dir) {
    this.origin.copyFrom(origin);
    this.direction.copyFrom(dir);
  }

  /**
   * Construct ray from two points, normalizing the direction.
   * @param {PIXI.Point} a
   * @param {PIXI.Point} b
   * @returns {Ray2d}
   */
  static fromPoints(a, b) { return new this(a, normalizedDirection(a, b, PIXI.Point._tmp3)); }

  /**
  * Intersection of two 2d rays, treating each as a line.
  * @param {Ray2d} other
  * @returns {float|null} The t value or null if no intersection.
  */
  intersectRayT(other) {
    const denom = cross2d(this.direction, other.direction);
    if ( denom.almostEqual(0) ) return null;

    // Calculate the t value of the intersection.
    const diff = this.origin.subtract(other.origin, PIXI.Point._tmp3);
    return cross2d(other.direction, diff) / denom;
  }

  /**
  * Intersection of two 2d rays, treating each as a line.
  * @param {Ray2d} other
  * @param {PIXI.Point} [outPoint]
  * @returns {PIXI.Point|null} The intersection point or null if no intersection.
  */
  intersectRay(other, outPoint) {
    const t = this.intersectRayT(other);
    if ( t == null ) return null;

    // Calculate the intersection point.
    outPoint ??= new PIXI.Point();
    return this.origin.add(this.direction.multiplyScalar(t, outPoint), outPoint);
  }

  /**
   * Project along this ray.
   * @param {number} distanceMultiplier
   * @param {PIXI.Point} [outPoint]
   * @returns {PIXI.Point}
   */
  project(distanceMultiplier, outPoint) {
    outPoint ??= new PIXI.Point();
    return this.origin.add(this.direction.multiplyScalar(distanceMultiplier, outPoint), outPoint);
  }
}

export class Ray3d {

  /** @type {Point3d} */
  origin = new CONFIG.GeometryLib.threeD.Point3d();

  /** @type {Point3d} */
  direction = new CONFIG.GeometryLib.threeD.Point3d();

  /**
   * @param {PIXI.Point} origin
   * @param {PIXI.Point} dir      In most cases, should be normalized
   */
  constructor(origin, dir) {
    this.origin.copyFrom(origin);
    this.direction.copyFrom(dir);
  }

  /**
   * Construct ray from two points, normalizing the direction.
   * @param {PIXI.Point} a
   * @param {PIXI.Point} b
   * @returns {Ray2d}
   */
  static fromPoints(a, b) { return new this(a, normalizedDirection(a, b, CONFIG.GeometryLib.threeD.Point3d._tmp3)); }

  /**
   * Project along this ray.
   * @param {number} distanceMultiplier
   * @param {Point3d} [outPoint]
   * @returns {Point3d}
   */
  project(distanceMultiplier, outPoint) {
    outPoint ??= new CONFIG.GeometryLib.threeD.Point3d();
    return this.origin.add(this.direction.multiplyScalar(distanceMultiplier, outPoint), outPoint);
  }

  /**
   * Intersect a plane with this ray.
   * @param {Plane} plane
   * @returns {Point3d|null}
   */
  intersectPlane(plane) {
    return plane.lineIntersection(this.origin, this.direction);
    // return plane.rayIntersectionEisemann(this.direction, this.origin);
  }
}

export class BarycentricPoint extends Point3d {

  /**
   * Calculate barycentric coordinate within a given triangle.
   * For point p and triangle abc, return the barycentric uvw as a vec3 or vec2.
   * See https://ceng2.ktu.edu.tr/~cakir/files/grafikler/Texture_Mapping.pdf
   * @param {PIXI.Point} p      Point to transform
   * @param {PIXI.Point} a      First triangle vertex
   * @param {PIXI.Point} b      Second triangle vertex
   * @param {PIXI.Point} c      Third triangle vertex
   * @returns {BarycentricPoint}
   */
  static coordinates(p, a, b, c) {
    return this._coordinates(p, this._triangleData(a, b, c));
  }

  /**
   * Calculate barycentric coordinate within a given triangle.
   * Use cached triangle data for the calculation.
   * @param {PIXI.Point} p                          Point to transform
   * @param {BarycentricTriangleData} triData       From this._triangleData
   * @returns {BarycentricPoint}
   */
  static _coordinates(p, triData) {
    const { a, v0, v1, d00, d01, d11, denomInv } = triData;
    const v2 = p.subtract(a);
    const d20 = v2.dot(v0);
    const d21 = v2.dot(v1);

    const v = ((d11 * d20) - (d01 * d21)) * denomInv;
    const w = ((d00 * d21) - (d01 * d20)) * denomInv;
    const u = 1.0 - v - w;

    return new this(u, v, w);
  }

  /**
   * @typedef {object} BarycentricTriangleData
   * @param {PIXI.Point} v0   b - a
   * @param {PIXI.Point} v1   c - a
   * @param {number} d00      v0•v0
   * @param {number} d01      v0•v1
   * @param {number} d11      v1•v1
   * @param {number} denomInv 1 / ((d00 * d11) - (d01 * d01))
   */

  /**
   * Calculate fixed barycentric data for given triangle.
   * @param {PIXI.Point} a      First triangle vertex
   * @param {PIXI.Point} b      Second triangle vertex
   * @param {PIXI.Point} c      Third triangle vertex
   * @returns {BarycentricTriangleData}
   */
  static _triangleData(a, b, c) {
    const v0 = b.subtract(a);
    const v1 = c.subtract(a);
    const d00 = v0.dot(v0);
    const d01 = v0.dot(v1);
    const d11 = v1.dot(v1);
    const denom = ((d00 * d11) - (d01 * d01));
    return { a, v0, v1, d00, d01, d11, denomInv: 1 / denom };
  }

  /**
   * Determine the 2d coordinate for a given barycentric coordinate and triangle.
   * @param {BarycentricPoint} bary
   * @param {PIXI.Point} a      First triangle vertex
   * @param {PIXI.Point} b      Second triangle vertex
   * @param {PIXI.Point} c      Third triangle vertex
   */
  invert(a, b, c) {
    a = a.multiplyScalar(this.x, PIXI.Point._tmp);
    b = b.multiplyScalar(this.y, PIXI.Point._tmp2);
    c = c.multiplyScalar(this.z, PIXI.Point._tmp3);
    return a.add(b, a).add(c);
  }

  /**
   * Is this point inside its triangle?
   * @param {BarycentricPoint} bary
   * @returns {bool}
   */
  insideTriangle() { return this.y >= 0.0 && this.z >= 0.0 && (this.y + this.z) <= 1.0; }

  /**
   * Interpolate from values at three vertices for this barycentric point.
   * @param {float|PIXI.Point|Point3d} a
   * @param {float|PIXI.Point|Point3d} b
   * @param {float|PIXI.Point|Point3d} c
   * @param {PIXI.Point|Point3d} [outPoint] For points, where to store the output. Cannot be tmp.
   * @returns {float|PIXI.Point|Point3d} The blended value combining a,b,c.
   */
  interpolate(a, b, c, outPoint) {
    if ( Number.isNumeric(a) ) return this.dot(CONFIG.GeometryLib.threeD.Point3d._tmp3.set(a, b, c));

    outPoint ??= new a.constructor();
    a = a.multiplyScalar(this.x, CONFIG.GeometryLib.threeD.Point3d._tmp);
    b = b.multiplyScalar(this.y, CONFIG.GeometryLib.threeD.Point3d._tmp2);
    c = c.multiplyScalar(this.z, CONFIG.GeometryLib.threeD.Point3d._tmp3);
    return a.add(b, outPoint).add(c, outPoint);
  }
}



/* Testing
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
SourceEdgeShadows = api.glsl.SourceEdgeShadows
Ray2d = api.glsl.Ray2d
Ray3d = api.glsl.Ray3d
BarycentricPoint = api.glsl.BarycentricPoint

l = canvas.lighting.placeables[0];
edge0 = canvas.walls.placeables[0].edge
edge1 = canvas.walls.placeables[1].edge

ses0 = new SourceEdgeShadows(l.lightSource, edge0)
ses1 = new SourceEdgeShadows(l.lightSource, edge1)

ses0Elev = new SourceEdgeShadows(l.lightSource, edge0)
ses0Elev.minCanvasElevation = 0

ses0.drawSource()
ses0.drawEdge()

ses0.drawTriangle("far", "penumbra")
ses0Elev.drawTriangle("far", "penumbra")

ses0.drawTriangle("far", "midpenumbra")
ses0Elev.drawTriangle("far", "midpenumbra")

ses0.drawTriangle("far", "umbra")
ses0Elev.drawTriangle("far", "umbra")

// Determining the barycentric value of the modified triangle?
pt = _token.center
farPenumbraTriOrig = ses0.buildTriangle("far", "penumbra")
farPenumbraTriElev = ses0Elev.buildTriangle("far", "penumbra")

baryOrig = BarycentricPoint.coordinates(pt, ...farPenumbraTriOrig)
baryElev = BarycentricPoint.coordinates(pt, ...farPenumbraTriElev)


Ratio:
distOrig = PIXI.Point.distanceBetween(farPenumbraTriOrig[0], farPenumbraTriOrig[1])
distElev = PIXI.Point.distanceBetween(farPenumbraTriElev[0], farPenumbraTriElev[1])
ratio = distOrig / distElev


denom = (baryOrig.x + baryOrig.y * ratio + baryOrig.z * ratio)
uElev = baryOrig.x / denom
vElev = (baryOrig.y * ratio) / denom
wElev = (baryOrig.z * ratio) / denom

denom = (baryOrig.x * ratio + baryOrig.y + baryOrig.z * ratio)
uElev = (baryOrig.x * ratio) / denom
vElev = baryOrig.y / denom
wElev = (baryOrig.z * ratio) / denom

denom = (baryOrig.x * ratio + baryOrig.y * ratio + baryOrig.z)
uElev = (baryOrig.x * ratio) / denom
vElev = (baryOrig.y * ratio) / denom
wElev = (baryOrig.z) / denom


A = farPenumbraTriOrig[0]
C = farPenumbraTriOrig[1]
B = farPenumbraTriOrig[2]
P = pt
Pbary = BarycentricPoint.coordinates(pt, ...farPenumbraTriOrig)

// We want to determine Pprime using ratio.
PBaryprime = BarycentricPoint.coordinates(pt, ...farPenumbraTriElev)

E = farPenumbraTriElev[1]
D = farPenumbraTriElev[2]

Aprime = foundry.utils.lineLineIntersection(A, P, B, C)
Bprime = foundry.utils.lineLineIntersection(B, P, A, C)
Cprime = foundry.utils.lineLineIntersection(C, P, A, B)
Dprime = foundry.utils.lineLineIntersection(D, P, A, C)
Eprime = foundry.utils.lineLineIntersection(E, P, A, B)
Aprime2 = foundry.utils.lineLineIntersection(A, P, D, E)

Draw.point(A)
Draw.point(Aprime)
Draw.point(B, { color: Draw.COLORS.blue })
Draw.point(Bprime, { color: Draw.COLORS.blue })
Draw.point(C, { color: Draw.COLORS.green })
Draw.point(Cprime, { color: Draw.COLORS.green })

Draw.point(D, { color: Draw.COLORS.orange })
Draw.point(Dprime, { color: Draw.COLORS.orange })
Draw.point(E, { color: Draw.COLORS.gray })
Draw.point(Eprime, { color: Draw.COLORS.gray })

Draw.point(Aprime2)

// Larger triangle
ACprime = PIXI.Point.distanceBetween(A, Cprime)
BCprime = PIXI.Point.distanceBetween(B, Cprime)
ABprime = PIXI.Point.distanceBetween(A, Bprime)
CBprime = PIXI.Point.distanceBetween(C, Bprime)
BAprime = PIXI.Point.distanceBetween(B, Aprime)
CAprime = PIXI.Point.distanceBetween(C, Aprime)

// Smaller triangle
AEprime = PIXI.Point.distanceBetween(A, Eprime)
DEprime = PIXI.Point.distanceBetween(D, Eprime)
ADprime = PIXI.Point.distanceBetween(A, Dprime)
EDprime = PIXI.Point.distanceBetween(E, Dprime)
DAprime2 = PIXI.Point.distanceBetween(D, Aprime2)
EAprime2 = PIXI.Point.distanceBetween(E, Aprime2)

// Distances Equal
√ ACprime + BCprime
√ PIXI.Point.distanceBetween(A, B)

√ ABprime + CBprime
√ PIXI.Point.distanceBetween(A, C)

√ BAprime + CAprime
√ PIXI.Point.distanceBetween(B, C)

√ ADprime + EDprime
√ PIXI.Point.distanceBetween(A, E)

√ AEprime + DEprime
√ PIXI.Point.distanceBetween(A, D)

√ DAprime2 + EAprime2
√ PIXI.Point.distanceBetween(D, E)

// Ratio between DAprime2 and BAprime, EAprime2 and CAprime
(BAprime / DAprime2).almostEqual(ratio)
(CAprime / EAprime2).almostEqual(ratio)

// Barycentric weighting based on distances
// ∆ABC


A ---D- C' ---- B
\
 \
  E
  B'        A'
   \
    \
      C

Bweight = 1
Aweight = BCprime / ACprime
Cweight = BAprime / CAprime
ABCweight = Aweight + Bweight + Cweight


Aweight / ABCweight
Bweight / ABCweight
Cweight / ABCweight

// ∆ADE
Dweight = 1
Aweight2 = DEprime / AEprime
Eweight = DAprime2 / EAprime2 = BAprime * 1 / ratio / CAprime * 1 / ratio = Cweight
ADEweight = Aweight2 + Dweight + Eweight

Dweight / ADEweight
Aweight2 / ADEweight
Eweight / ADEweight

*/

/*
u = Aweight / ABCweight
v = Bweight / ABCweight
w = Cweight / ABCweight

Bweight = 1
Aweight = BCprime / ACprime
Cweight = BAprime / CAprime
ABCweight = Aweight + Bweight + Cweight

u = Aweight / Aweight + 1 + Cweight
v = 1 / Aweight + 1 + Cweight
w = Cweight / Aweight + 1 + Cweight

u * (Aweight + 1 + Cweight) = Aweight
u*Aweight + u + u*Cweight = Aweight
u(Aweight - 1) = -u - u*Cweight
Aweight - 1 = u(-1 - Cweight) / u = -1 - Cweight
Aweight = 1 - 1 - Cweight = -Cweight

w = Cweight
v = 1
u = -Cweight

-Cweight = BCprime / ACprime
Cweight = BAprime / CAprime
u = BCprime / ACprime
w = BAprime / CAprime

*/


/* https://www.journal-1.eu/2016-2/Grozdev-Dekov-Barycentric-Coordinates-pp.75-82.pdf
3. Change of coordinates
Given point P with barycentric coordinates p,q,r with respect to triangle DEF,
D = (u1,v1,w1), E = (u2,v2,w2), F = (u3,v3,w3). If points D,E,F and P are
normalized, the barycentric coordinates u,v,wof P with respect to triangle ABC
are as follows:
u= u1p+ u2q+ u3r,
v= v1p+ v2q+ v3r,
w= w1p+ w2q+ w3r.

A = new PIXI.Point(2200, 1300)
B = new PIXI.Point(2500, 1300)
C = new PIXI.Point(2200, 1600)
D = new PIXI.Point(2200, 1300) // Same as A
E = new PIXI.Point(2300, 1300) // Corresponds to B
F = new PIXI.Point(2200, 1400) // Corresponds to C

P = new PIXI.Point(2234, 1337)

P_abc = BarycentricPoint.coordinates(P, A, B, C)
P_def = BarycentricPoint.coordinates(P, D, E, F)

dNorm = D.normalize()
eNorm = E.normalize()
fNorm = F.normalize()
P_def.x * dNorm.x + P_def.x * eNorm.x + P_def.x * fNorm.x
P_def.y * eNorm.x + P_def.y * eNorm.y
P_def.z * fNorm.x + P_def.z * fNorm.y


sarea = foundry.utils.orient2dFast


saU = sarea(B, C, P)
saV = sarea(C, A, P)
saW = sarea(A, B, P)
total = saU + saV + saW

tmp = new BarycentricPoint(saU, saV, saW)
tmp = tmp.multiplyScalar(1/total)
P_abc = BarycentricPoint.coordinates(P, A, B, C)

saU2 = sarea(E, F, P)
saV2 = sarea(F, D, P)
saW2 = sarea(D, E, P)
total2 = saU2 + saV2 + saW2
tmp2 = new BarycentricPoint(saU2, saV2, saW2)
tmp2 = tmp2.multiplyScalar(1/total2)
P_def = BarycentricPoint.coordinates(P, D, E, F)

ratio = 3
(total2 * ratio * ratio).almostEqual(total)
(saV2 * ratio).almostEqual(saV)
(saW2 * ratio).almostEqual(saW)


The U value is based on BC and EF, so not a straight ratio to saU2. But can determine anyway, using 1 - v - w.

ratioInv = 1/3
total = saU + saV + saW
u = saU / total
v = saV / total
w = saW / total

total2 = total * ratioInv * ratioInv
saV2 = saV * ratioInv
saW2 = saW * ratioInv
v2 = saV2 / total2
w2 = saW2 / total2
u2 = 1 - v2 - w2

So in practice would need:
vec3 vBary
flat float totalArea    // Total area for ABC. Or use non-normalized vBary?

Calculate the ratioInv in fragment shader based on wall ratio.

function baryInterpolation(bary, a, b, c) {
  if ( Number.isNumeric(a) ) return bary.dot(CONFIG.GeometryLib.threeD.Point3d._tmp3.set(a, b, c));

  a = a.multiplyScalar(bary.x, CONFIG.GeometryLib.threeD.Point3d._tmp);
  b = b.multiplyScalar(bary.y, CONFIG.GeometryLib.threeD.Point3d._tmp2);
  c = c.multiplyScalar(bary.z, CONFIG.GeometryLib.threeD.Point3d._tmp3);
  return a.add(b).add(c);
}

// Vertices, Penumbra triangle
v0_vBary = BarycentricPoint.coordinates(A, A, B, C)
v1_vBary = BarycentricPoint.coordinates(B, A, B, C)
v2_vBary = BarycentricPoint.coordinates(C, A, B, C)

v0_vArea = new Point3d(total, 0, 0)
v1_vArea = new Point3d(0, total, 0)
v2_vArea = new Point3d(0, 0, total)

vBary = baryInterpolation(BarycentricPoint.coordinates(P, A, B, C), v0_vBary, v1_vBary, v2_vBary)
vArea = baryInterpolation(BarycentricPoint.coordinates(P, A, B, C), v0_vArea, v1_vArea, v2_vArea)

total = vArea.x + vArea.y + vArea.z
ratio = 3
ratioInv = 1/ratio
total2 = total * ratioInv * ratioInv
saV2 = vArea.y * ratioInv
saW2 = vArea.z * ratioInv
v2 = saV2 / total2
w2 = saW2 / total2
u2 = 1 - v2 - w2

vNewBary = new BarycentricPoint(u2, v2, w2)

/*

/* From shader triangles
P = _token.center
penumbraTri = ses0.buildTriangle("far", "penumbra")
midPenumbraTri = ses0.buildTriangle("far", "midpenumbra")
umbraTri = ses0.buildTriangle("far", "umbra")

// Penumbra
A = penumbraTri[0]
B = penumbraTri[1]
C = penumbraTri[2]
areaPenumbra = sarea(...penumbraTri)
v0_penumbra_area = new Point3d(areaPenumbra, 0, 0)
v1_penumbra_area = new Point3d(0, areaPenumbra, 0)
v2_penumbra_area = new Point3d(0, 0, areaPenumbra)
vPenumbraArea = BarycentricPoint.coordinates(P, ...penumbraTri).interpolate(v0_penumbra_area, v1_penumbra_area, v2_penumbra_area)

// Confirm
vPenumbraBary = BarycentricPoint.fromObject(vPenumbraArea.multiplyScalar(1 / (vPenumbraArea.x + vPenumbraArea.y + vPenumbraArea.z)))
vPenumbraBary.almostEqual(BarycentricPoint.coordinates(P, ...penumbraTri))

// Midpenumbra
areaMid = sarea(...midPenumbraTri)
mid0 = new Point3d(areaMid, 0, 0)
mid1 = new Point3d(0, areaMid, 0)
mid2 = new Point3d(0, 0, areaMid)
v0_mid_area = BarycentricPoint.coordinates(A, ...midPenumbraTri).interpolate(mid0, mid1, mid2)
v1_mid_area = BarycentricPoint.coordinates(B, ...midPenumbraTri).interpolate(mid0, mid1, mid2)
v2_mid_area = BarycentricPoint.coordinates(C, ...midPenumbraTri).interpolate(mid0, mid1, mid2)
vMidPenumbraArea = BarycentricPoint.coordinates(P, ...penumbraTri).interpolate(v0_mid_area, v1_mid_area, v2_mid_area)

// Confirm
vMidPenumbraBary = BarycentricPoint.fromObject(vMidPenumbraArea.multiplyScalar(1 / (vMidPenumbraArea.x + vMidPenumbraArea.y + vMidPenumbraArea.z)))
vMidPenumbraBary.almostEqual(BarycentricPoint.coordinates(P, ...midPenumbraTri))

// Umbra
areaUmbra = sarea(...umbraTri)
umbra0 = new Point3d(areaUmbra, 0, 0)
umbra1 = new Point3d(0, areaUmbra, 0)
umbra2 = new Point3d(0, 0, areaUmbra)
v0_umbra_area = BarycentricPoint.coordinates(A, ...umbraTri).interpolate(umbra0, umbra1, umbra2)
v1_umbra_area = BarycentricPoint.coordinates(B, ...umbraTri).interpolate(umbra0, umbra1, umbra2)
v2_umbra_area = BarycentricPoint.coordinates(C, ...umbraTri).interpolate(umbra0, umbra1, umbra2)
vUmbraArea = BarycentricPoint.coordinates(P, ...penumbraTri).interpolate(v0_umbra_area, v1_umbra_area, v2_umbra_area)

// Confirm
vUmbraBary = BarycentricPoint.fromObject(vUmbraArea.multiplyScalar(1 / (vUmbraArea.x + vUmbraArea.y + vUmbraArea.z)))
vUmbraBary.almostEqual(BarycentricPoint.coordinates(P, ...umbraTri))


*/


/* Attributes for vertex and frag shaders

vertex attributes:

Measured at each of the three penumbra vertices:
vec2 aVertexPosition
float areaPenumbra <-- Will be set to {area, 0, 0}, {0, area, 0}, {0, 0, area}.
vec3 areaMidPenumbra
vec3 areaUmbra

Flat attributes; must be set in vertex 2 (Provoking Vertex)
float thresholdRadius
vec3 wallRatios
vec3 nearRatios
2 + 1 + 3 + 3 + 1 + 3 + 3 = 16


varying:
vPenumbraArea
vMidPenumbraArea
vUmbraArea

flat:
float fThresholdRadius
vec3 wallRatios
vec3 nearRatios
--> combine fWallSenseType with fThresholdRadius2 to 0 if sense type is not distnace or proximate

If passing positions, would need all points in each:
vec2 penumbraA ... x2 for mid, umbra
vec2 penumbraB ... x2 for mid, umbra
vec2 penumbraC ... x2 for mid, umbra
vec2 wallA
vec2 wallB
vec2 nearPenumbraB ... x2 for mid, umbra
vec2 nearPenumbraC ... x2 for mid, umbra
float thresholdRadius
So 6 + 6 + 6 + 4 + 6 + 6 = 34.

If using only penumbra ratios, would need:
vec2 aVertexPosition
float areaPenumbra
vec3 areaMidPenumbra
vec3 areaUmbra
float thresholdRadius
float wallRatio
float nearRatio
2 + 1 + 3 + 3 + 1 + 1 + 1 = 12

To use same set for each vertex, would need to add the 2x vec3 for areaMid and areaUmbra and 2x vec2 for vertexPosition
12 + 6 + 4 = 22.

Original shader needed:
in vec4 aWallCorner0; (x, y, top, linked)
in vec4 aWallCorner1; (x, y, bottom, linked)
in float aWallSenseType;
in float aThresholdRadius2;
4 + 4 + 1 + 1 = 10. Could be 9 if combining sense type and threshold radius.

For variable wall heights, need:
in vec4 aWallCorner0; (x, y, top, bottom)
in vec4 aWallCorner1; (x, y, top, bottom)
in vec2 linkAngle
in float aWallSenseType
4 + 4 + 2 + 1 = 11
But could use the same set for each vertex.





*/