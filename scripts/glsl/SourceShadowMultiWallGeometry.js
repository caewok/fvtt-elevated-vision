/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "../const.js";
import { Draw } from "../geometry/Draw.js";
import { edgeElevationZ } from "../util.js";
import { CombinedGeometry, SubGeometry } from "./CombinedGeometry.js";
import { Ray2d, distanceToLine, normalizedDirection, randomSphereCoordinate } from "./SourceShadowSingleWallGeometry.js";

export class SourceShadowMultiWallGeometry extends CombinedGeometry {
  /**
   * Maximum number of samples.
   * TODO: Move this to a CONFIG.
   * @type {number}
   */
  static MAXIMUM_SAMPLES = 10;

  /** @type {PointSource} */
  source;

  /** @type {Map<string, SubGeometry>} */
  geomEdgeMap = new Map(); // Uses edge.id b/c edge not guaranteed to be the same.

  /** @type {SubGeometry|PIXI.Geometry} */
  subclass = SourceShadowMultiWallSubGeometry;

  // ----- NOTE: Instantiation and initialization ----- //

  /** @type {boolean} */
  #initialized = false;

  get initialized() { return this.#initialized; }

  /**
   * Initialize this geometry with zero values for index and attributes.
   */
  initialize(source, edges) {
    if ( this.#initialized ) return;
    this.source = source;
    this.#initializeEdges(edges);
    this.#initializeIndex();
    this.#initializeAttribute("aVertex", 2, PIXI.TYPES.FLOAT);
    this.#initializeAttribute("aEdgeDist", 1, PIXI.TYPES.FLOAT);
    this.#initializeAttribute("aThresholdRadius2", 1, PIXI.TYPES.FLOAT);
    this.#initializeAttribute("aWallType", 1, PIXI.TYPES.FLOAT); // TODO: Change to UNSIGNED_BYTE?
    this.subgeometries.forEach(sg => sg._updateGeometry());
    this.#initialized = true;
  }

  /**
   * Initialize the edges for this source.
   * Does not create index or attributes.
   * @param {Edge[]} edges
   */
  #initializeEdges(edges) {
    edges ??= canvas.edges.values();
    edges = [...edges].filter(edge => this._includeEdge(edge));
    const nEdges = edges.length;
    this.subgeometries.length = nEdges;
    for ( let i = 0; i < nEdges; i += 1 ) {
      const edge = edges[i];
      const subgeom = new this.subclass(this.source, edge);
      this.geomEdgeMap.set(edge.id, subgeom);
      this.subgeometries[i] = subgeom;
    }
  }

  /**
   * Initialize index and attributes for this source.
   */
  #initializeIndex() {
    const bufferSize = this.subgeometries.length * this.subclassSize;
    this.addIndex(Array.fromRange(bufferSize));
  }

  /**
   * Initialize attributes for this source.
   * @param {string} id         The name of the attribute
   * @param {number} [size=1]   How many values makes up a single entry; e.g., {x, y} would be 2
   * @param {PIXI.TYPES} [type = PIXI.TYPES.FLOAT]  The type of value stored
   */
  #initializeAttribute(id, size = 1, type = PIXI.TYPES.FLOAT) {
    // TODO: Use other buffer types?
    const bufferSize = this.subgeometries.length * this.subclassSize * size;
    const buffer = new Float32Array(bufferSize);
    const normalized = false;
    this.addAttribute(id, buffer, size, normalized, type);
  }

  // ----- NOTE: Updates to geometry ----- //

  /**
   * Update based on indicated changes to the source.
   * @param {Set<string>} changes         Change keys for the source.
   * @returns {boolean} True if the indicated changes resulted in a change to the geometry.
   */
  sourceUpdated(changes) {
    let updated = false;
    this.geomEdgeMap.forEach(geom => {
      const hadUpdate = geom.sourceUpdated(changes);
      updated ||= hadUpdate;
    });
    return updated;
  }

  /**
   * Update based on indicated changes to the edge.
   * @param {Edge} edge                   The edge that was updated.
   * @param {Set<string>} changes         Change keys for the source.
   * @returns {boolean} True if the indicated changes resulted in a change to the geometry.
   */
  edgeUpdated(edge, changes) {
    return this.geomEdgeMap.get(edge)?.edgeUpdated(changes);
  }

  /**
   * Update shadow data based on the added edge, as necessary.
   * @param {Edge} edge     Edge that was added to the scene.
   * @returns {boolean} True if the added edge resulted in a change.
   */
  edgeAdded(edge) {
    if ( this.geomEdgeMap.has(edge.id) ) return false;
    if ( !this._includeEdge(edge) ) return false;
    const subgeom = this.addSubGeometry();
    subgeom.source = this.source;
    subgeom.edge = edge;
    this.geomEdgeMap.set(edge.id, subgeom);
    this.subgeometries.push(subgeom);
    subgeom._updateGeometry();
    return true;
  }

  /**
   * Update shadow data based on the removed edge, as necessary.
   * @param {Edge} edge             Edge that was removed
   * @returns {boolean} True if the added edge resulted in a change.
   */
  edgeRemoved(edge) {
    if ( !this.geomEdgeMap.has(edge.id) ) return false;
    const subgeom = this.geomEdgeMap.get(edge.id);
    this.geomEdgeMap.delete(edge.id);
    const idxToRemove = this.subgeometries.indexOf(subgeom);
    return Boolean(this.removeSubGeometry(idxToRemove));
  }

  // ----- NOTE: Edge testing ----- //

  /**
   * Should this edge be included in the geometry for this source shadow?
   * @param {Edge} edge
   * @returns {boolean}   True if edge should be included
   */
  _includeEdge(edge) {
    if ( edge.type !== "wall" && edge.type !== "regionWall" ) return false;
    return this._testEdgeInclusion(edge, PIXI.Point.fromObject(this.source));
  }

  /**
   * Comparable to PointSourcePolygon.prototype._testWallInclusion
   * Test for whether a given wall interacts with this source.
   * Used to filter walls in the quadtree in _getWalls
   * @param {Edge} edge
   * @param {PIXI.Point} origin
   * @returns {boolean}
   */
  _testEdgeInclusion(edge, origin) {
    const src = this.source;

    // Ignore walls that are non-blocking for this type.
    const type = src.constructor.sourceType;
    if ( !edge[type] || edge.isOpen ) return false;

    // TODO: Handle elevation for ramps where walls are not equal
    const { topZ, bottomZ } = edgeElevationZ(edge);

    // If edge is entirely above the light, do not keep.
    const elevationZ = src.elevationZ;
    if ( bottomZ > elevationZ ) return false;

    // If wall is entirely below the canvas and source is above, do not keep.
    const minCanvasE = canvas.scene[MODULE_ID]?.minElevation ?? canvas.scene.getFlag(MODULE_ID, "elevationmin") ?? 0;
    if ( topZ <= minCanvasE && elevationZ > minCanvasE ) return false;

    // Ignore collinear walls
    const side = edge.orientPoint(origin);
    // Keep collinear. if ( !side ) return false;

    // Ignore one-directional walls facing away from the origin.
    if ( side === edge.dir ) return false;

    // Ignore non-attenuated threshold walls where the threshold applies.
    if ( !edge.threshold?.attenuation && this.thresholdApplies(edge) ) return false;

    return true;
  }

  /**
   * For threshold edges, determine if threshold applies.
   * @param {Edge} edge
   * @returns {boolean} True if the threshold applies.
   */
  thresholdApplies(edge) {
    const src = this.source;
    return edge.applyThreshold(src.constructor.sourceType, src, src.data.externalRadius);
  }
}

export class PointSourceShadowMultiWallGeometry extends SourceShadowMultiWallGeometry {
  /** @type {SubGeometry|PIXI.Geometry} */
  subclass = PointSourceShadowMultiWallSubGeometry;

}


export class DirectionalSourceShadowMultiWallGeometry extends SourceShadowMultiWallGeometry {
  /** @type {SubGeometry|PIXI.Geometry} */
  subclass = DirectionalSourceShadowMultiWallSubGeometry;

}


export class SourceShadowMultiWallSubGeometry extends SubGeometry {

  /** @type {PointSource} */
  source;

  /** @type {Edge} */
  edge;

  /**
   * Edges currently connected to this edge's A endpoint.
   * @type {{ a: Set<Edge>, b: Set<Edge> }}
   */
  linkedEdges = { a: new Set(), b: new Set() };

  /**
   * @type {PointSource}
   * @type {Edge}
   */
  constructor(source, edge) {
    super();
    this.source = source;
    this.edge = edge;
  }

  // ----- NOTE: Getters / Setters ----- //

  /** @type {string} */
  get sourceType() { return this.source.constructor.sourceType; }

  /** @type {Point3d} */
  get sourceOrigin() { return CONFIG.GeometryLib.threeD.Point3d.fromPointSource(this.source); }

  /** @type {number} */
  get canvasElevation() { return 0; } // TODO: Make variable.

  /** @type {Plane} */
  get canvasPlane() {
    const { Point3d, Plane } = CONFIG.GeometryLib.threeD;
    const planeNormal = new Point3d(0, 0, 1.0);
    const planePoint = new Point3d(0, 0, this.canvasElevation);
    return new Plane(planePoint, planeNormal);
  }

  // ----- NOTE: Geometry ----- //

  /**
   * Resample and update the vertices and associated distances from the edge.
   * @param {Point3d[]} samples     The points within the light to use
   * @param {number[]} vertices     Array or buffer array of vertices
   * @param {number[]} edgeDist     Array or buffer array of edge distance
   */
  #updateVertices(samples, vertices, edgeDist) {
    const {a, b} = this.edge;
    const l = Ray2d.normalized(a, b);
    const nSamples = edgeDist.length / 3;
    for ( let i = 0; i < nSamples; i += 1 ) {
      const vIdx = i * 3 * 2;
      const eIdx = i * 3;
      const [A, B, C] = this.shadowTriangle(samples[i]);

      // Determine the ∆ABC vertices
      vertices[vIdx] = A.x;
      vertices[vIdx + 1] = A.y;
      vertices[vIdx + 2] = B.x;
      vertices[vIdx + 3] = B.y;
      vertices[vIdx + 4] = C.x;
      vertices[vIdx + 5] = C.y;

      // Determine distance from the wall for each vertex.
      edgeDist[eIdx] = -distanceToLine(A, l);
      edgeDist[eIdx + 1] = distanceToLine(B, l);
      edgeDist[eIdx + 2] = distanceToLine(C, l);
    }
  }

  /**
   * For a given light center, determine the shadow triangle.
   * @param {Point3d} A     The assumed center point of the light
   * @returns {PIXI.Point[3]}  Triangle, from center through endpoint a and then endpoint b.
   */
  shadowTriangle(A) {
    const A2d = A.to2d();
    const { a, b } = this.edge;
    if ( !foundry.utils.orient2dFast(A2d, a, b) ) return [A2d, a, b]; // No real triangle to use.

    // TODO: Adjust penumbra for linked walls.a
    // Align with the linked edge if it falls between penumbra and umbra of full light.

    // For infinite shadow, extend triangle formed by light point and wall to the edge of the canvas.
    const top = this.edge.elevationLibGeometry.a.top; // Currently, a and b are same.
    const isInfinite = A.z > top;
    if ( isInfinite ) return this.extendTriangleToCanvasEdge([A2d, a, b]);

    // For non-infinite, intersect the canvas plane to determine extension point.
    const canvasPlane = this.canvasPlane;
    const wallMid2d = PIXI.Point._tmp;
    a.add(b, wallMid2d).multiplyScalar(0.5, wallMid2d);
    const wallMid = CONFIG.GeometryLib.threeD.Point3d._tmp.set(wallMid2d.x, wallMid2d.y, top);
    const ix = canvasPlane.rayIntersection(A, wallMid.subtract(A));
    const rWallIx = new Ray2d(ix, b.subtract(a));
    const rAa = new Ray2d(A2d, a);
    const rAb = new Ray2d(A2d, b);
    const B = rWallIx.intersectRay(rAa);
    const C = rWallIx.intersectRay(rAb);
    return [A2d, B, C];
  }

  // ----- NOTE: Updates to geometry ----- //

  /**
   * Update based on indicated changes to the source.
   * @param {Set<string>} changes         Change keys for the source.
   * @returns {boolean} True if the indicated changes resulted in a change to the geometry.
   */
  sourceUpdated(changes) {
    const changedPosition = changes.has("x") || changes.has("y");
    const changedElevation = changes.has("elevation");
    const changedLightSize = changes.has("flags.elevatedvision.lightSize");
    if ( changedPosition || changedElevation || changedLightSize ) this._updateGeometry();
    return changedPosition || changedElevation;
  }

  /**
   * Update based on indicated changes to the edge.
   * @param {Set<string>} changes         Change keys for the source.
   * @returns {boolean} True if the indicated changes resulted in a change to the geometry.
   */
  edgeUpdated(changes) {
    const changedPosition = changes.has("c");
    const changedElevation = [
      "flags.wall-height.top",
      "flags.wall-height.bottom",
      "flags.elevatedvision.elevation.top",
      "flags.elevatedvision.elevation.bottom"].some(prop => changes.has(prop));
    if ( changedPosition || changedElevation ) this._updateGeometry();
    return changedPosition || changedElevation;
  }

  /**
   * Update the geometry for this source-edge relationship.
   * @param {Point3d[]} samples     Points within the light to use for the center point of ∆ABC
   */
  _updateGeometry(samples) {
    samples ??= [this.sourceOrigin];
    const vertices = this.getBuffer("aVertex").data;
    const edgeDist = this.getBuffer("aEdgeDist").data;
    this.#updateVertices(samples, vertices, edgeDist);
  }

  // ----- NOTE: Utility methods ----- //

  /**
   * Given a triangle ∆ABC, construct a similar triangle such that B and C
   * fall on or outside the canvas edge, and BC is entirely on or outside the canvas edge.
   * @param {PIXI.Point[3]} tri     ∆ABC
   * @returns {PIXI.Point[3]} The adjusted triangl
   */
  extendTriangleToCanvasEdge(tri) {
    const [A, B, C] = tri;
    const AB = Ray2d.normalized(A, B);
    const AC = Ray2d.normalized(A, C);
    const canvasRay = this.infiniteShadowCanvasRay([AB, AC]);

    // Use the smaller triangle edge to intersect the canvas edge.
    const dist2AB = PIXI.Point.distanceSquaredBetween(A, B);
    const dist2AC = PIXI.Point.distanceSquaredBetween(A, C);
    const smallerAB = dist2AB < dist2AC;
    const smallerEdge = smallerAB ? AB : AC;
    const largerEdge = smallerAB ? AC : AB;
    const ixSmaller = smallerEdge.intersectRay(canvasRay);

    // Then connect using the B->C (or C->B) direction to the other triangle edge.
    const newBC = new Ray2d(ixSmaller, normalizedDirection(B, C));
    const ixLarger = largerEdge.intersectRay(newBC);
    if ( smallerAB ) return [A, ixSmaller, ixLarger];
    else return [A, ixLarger, ixSmaller];
  }

  /**
   * Determine which canvas edge a ray intersects.
   * Ray origin must be inside the canvas for this to work.
   * @param {Ray2d} r
   * @returns {object}
   * - @param {PIXI.Point} A
   * - @param {PIXI.Point} B
   */
  whichCanvasEdge(r) {
    const quad = this.directionalQuadrant(r.direction);

    // Scene Rect has edges CW from TL. (TL -> TR -> BR -> BL)
    // A ray of a given direction only has two edges that it could conceivably hit.
    const edges = [...canvas.dimensions.rect.iterateEdges()];
    const idx0 = (quad + 4 - 1) % 4; // Quad - 1
    const edge0 = edges[idx0];
    const edge1 = edges[quad];
    const ix0 = r.intersectPoints(edge0.A, edge0.B);
    const ix1 = r.intersectPoints(edge1.A, edge1.B);
    if ( ix0 && (!ix1 || ix0.t0 < ix1.t0) ) return edge0;
    return edge1;
  }

  /**
   * What quadrant does this direction end up in?
   * Assumes the origin is within a rectangle and the vector is moving in direction.
   * @param {PIXI.Point} direction
   * @returns {CORNERS}
   */
  directionalQuadrant(direction) {
    /*
    Treat as centered: tl --> tr --> 0 <-- br <-- bl
    tl: -1 * 2 + -1 * -.5 = -1.5 + 1.5 = 0
    tr: -1 * 1 + -1 * -.5 = -.5 + 1.5 = 1
    br: 1 * 1 + 1 * -.5 = .5 + 1.5 = 2
    bl: 1 * 2 + 1 * -.5 = 1.5 + 1.5 = 3
    t|b * l|r + t|b * -.5
    t = -1
    b = 1
    l = 2
    r = 1
    */

    const tb = ((direction.y < 0.0) * -2) + 1; // Options: t = 1 * -2 + 1; b = 0 * -2 + 1
    const lr = (direction.x < 0.0) + 1; // Options: l = 1 + 1; r = 0 + 1
    return (tb * lr) + (tb * -0.5) + 1.5;

    // Original approach:
    // if ( direction.x > 0.0 ) return direction.y > 0.0 ? BR : TR;
    // Moving left. x <= 0.0.
    // return direction.y > 0.0 ? BL : TL;
  }

  /**
   * For infinite wall shadow, point outside of canvas that can be the fake floor intersection.
   * Either a point on the 45º line at a scene corner or a scene edge point.
   * @param {Ray2d[2]}
   * @returns {Ray2d}
   */
  infiniteShadowCanvasRay(lightRays) {
    // What edge does each ray hit?
    const edge0 = this.whichCanvasEdge(lightRays[0]);
    const edge1 = this.whichCanvasEdge(lightRays[1]);
    if ( edge0.A.equals(edge1.A) ) return new Ray2d(edge0.A, edge0.B.subtract(edge0.A)); // For scene edges, origin is distinct (1 of 4 corners).

    // Rays hit two distinct edges.
    // If the edges intersect:
    // Use an ray that intersects the corner perpendicular to the midpoint of the two rays.
    // (This prevents the connecting ray from hitting the canvas or intersecting at the
    // wrong side of the light rays.)
    const midDir = lightRays[0].direction.add(lightRays[1].direction).multiplyScalar(0.5);
    const ix = foundry.utils.lineLineIntersection(edge0.A, edge0.B, edge1.A, edge1.B);
    if ( ix ) return new Ray2d(ix, PIXI.Point._tmp.set(midDir.y, -midDir.x));

    // The rays are striking parallel edges. Test quadrants to determine edge vs corner.
    const quad0 = this.directionalQuadrant(lightRays[0].direction);
    const quad1 = this.directionalQuadrant(lightRays[1].direction);

    // If adjacent quadrants, use scene edge.
    if ( quad0 === ((quad1 + 1) % 4) // +3 equivalent to -1 + 4
      || quad0 === ((quad1 + 3) % 4) ) {
      const edge = this.whichCanvasEdge(new Ray2d(lightRays[0].origin, midDir));
      return new Ray2d(edge.A, edge.B.subtract(edge.A));
    }

    // Opposing quadrants; must use the corner.
    // if ( quad0 === ((quad1 + 2) % 4) ) corner = (quad0 + 1) % 4;
    const cornerIdx = this.directionalQuadrant(midDir);
    const origin = [...canvas.dimensions.rect.iteratePoints({ close: false })][cornerIdx];
    const direction = new PIXI.Point(midDir.y, -midDir.x);
    return new Ray2d(origin, direction);
  }

  // ----- NOTE: Cleanup ----- //

  /**
   * Remove links to large objects.
   */
  destroy() {
    this.source = null;
    this.edge = null;
    super.destroy();
  }

  // ----- NOTE: Debugging ----- //

  drawEdge() { Draw.segment(this.edge, { width: 2 }); }

  drawShadowTriangles(opts = {}) {
    const nSamples = this.indexBuffer.data.length / 3;
    opts.fillAlpha ??= 1.0 / nSamples;
    for ( let i = 0; i < nSamples; i += 1 ) this.drawShadowTriangle(i, opts);
  }

  drawShadowTriangle(idx, opts = {}) {
    opts.color ??= Draw.COLORS.gray;
    opts.fill ??= Draw.COLORS.gray;
    opts.fillAlpha ??= 0.5;
    const buffer = this.getBuffer("aVertex").data;
    const poly = new PIXI.Polygon(...buffer.slice(idx * 6, (idx * 6) + 6));
    Draw.shape(poly, opts);
  }
}

export class PointSourceShadowMultiWallSubGeometry extends SourceShadowMultiWallSubGeometry {
  /** @type {number} */
  get sourceSize() { return this.source.data.lightSize; }

  // ----- NOTE: Geometry ----- //

  /**
   * Calculate the wall geometry for this source.
   * The base assumes a single shadow from the light center.
   */
  constructWallGeometry() {
    const samples = this.lightSamplePoints();
    super.constructWallGeometry(samples);
  }

  /**
   * Random points on the light sphere used for sampling the shadow triangles.
   * @returns {Point3d[]}
   */
  lightSamplePoints(nSamples = CONFIG[MODULE_ID].webGLShadowSamples) {
    const samples = Array(nSamples);
    for ( let i = 0; i < nSamples; i += 1 ) samples[i] = this.randomPointOnLight();
    return samples;
  }

  /**
   * Sample from the light sphere.
   * @returns {Point3d}
   */
  randomPointOnLight() {
    return randomSphereCoordinate().multiplyScalar(this.sourceSize).add(this.sourceOrigin);
  }

  // ----- NOTE: Updates to geometry ----- //

  /**
   * Update the geometry for this source-edge relationship.
   */
  _updateGeometry() {
    const samples = this.lightSamplePoints();
    super._updateGeometry(samples);
  }

  // ----- NOTE: Debugging ----- //

  /**
   * Draw the light sphere as a 2d circle on the canvas.
   */
  drawLight() {
    const light = new PIXI.Circle(this.sourceOrigin.x, this.sourceOrigin.y, this.sourceSize);
    Draw.shape(light, { color: Draw.COLORS.yellow, fillColor: Draw.COLORS.yellow, fillAlpha: 0.5 });
  }
}

export class DirectionalSourceShadowMultiWallSubGeometry extends SourceShadowMultiWallSubGeometry {

}

/* Testing point light

MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
SourceShadowMultiWallGeometry = api.testing.SourceShadowMultiWallGeometry
SourceShadowMultiWallSubGeometry = api.testing.SourceShadowMultiWallSubGeometry


let [l] = canvas.lighting.placeables;

geom = SourceShadowMultiWallGeometry.create(l.lightSource)
geom.initialize()


*/
