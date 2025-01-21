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
import { Draw } from "../geometry/Draw.js";
import { CombinedGeometry, SubGeometry } from "./CombinedGeometry.js";
import { pointVTest, tangentToV, edgeElevationZ } from "../util.js";

const flipEdgeLabel = {
  a: "b",
  b: "a"
};

// TODO: Handle linked edge updates.

export class SourceShadowMultiWallGeometry extends CombinedGeometry {
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
    this.#initializeAttribute("aWallCorner0", 4, PIXI.TYPES.FLOAT);
    this.#initializeAttribute("aWallCorner1", 4, PIXI.TYPES.FLOAT);
    this.#initializeAttribute("aWallSenseType", 1, PIXI.TYPES.FLOAT);
    this.#initializeAttribute("aThresholdRadius2", 1, PIXI.TYPES.FLOAT); // TODO: Change to UNSIGNED_BYTE?
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

  // TODO: Handle linked edge updates.

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

  /** @type {number} */
  subclassSize = 3;
}


export class DirectionalSourceShadowMultiWallGeometry extends SourceShadowMultiWallGeometry {
  /** @type {SubGeometry|PIXI.Geometry} */
  subclass = DirectionalSourceShadowMultiWallSubGeometry;

  /** @type {number} */
  subclassSize = 3;
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
  get edgeTopZ() { return CONFIG.GeometryLib.utils.gridUnitsToPixels(this.edge.elevationLibGeometry.a.top ?? 1e08); }

  /** @type {number} */
  get edgeBottomZ() {
    return CONFIG.GeometryLib.utils.gridUnitsToPixels(this.edge.elevationLibGeometry.a.bottom ?? -1e08);
  }

  /**
   * Sense type for this edge and source combination.
   * @param {Edge} edge
   * @type {CONST.WALL_SENSE_TYPES}
   */
  get senseType() { return this.edge[this.sourceType]; }

  /**
   * For threshold edges, determine if threshold applies.
   * @type {boolean} True if the threshold applies.
   */
  get thresholdApplies() {
    return this.edge.applyThreshold(this.sourceType, this.source, this.source.data.externalRadius);
  }

  // ----- NOTE: Threshold calculation ----- //

  /**
   * For threshold edge, get the threshold distance
   * @returns {number}  Distance of the threshold in pixel units, or 0 if none.
   */
  threshold2Attribute() {
    if ( !this.thresholdApplies ) return 0;
    const { inside, outside } = this.calculateThresholdAttenuation();
    return Math.min(Number.MAX_SAFE_INTEGER, Math.pow(inside + outside, 2)); // Avoid infinity.
  }

  /**
   * Calculate threshold attenuation for an edge.
   * If the edge is not attenuated, inside + outside will be >= source radius.
   * See PointSourcePolygon.prototype.#calculateThresholdAttenuation
   * @returns {{inside: number, outside: number}} The inside and outside portions of the radius
   */
  calculateThresholdAttenuation() {
    const edge = this.edge;
    const externalRadius = 0;
    const radius = this.source.radius;
    const origin = this.source;
    const d = edge.threshold?.[this.sourceType];
    if ( !d ) return { inside: radius, outside: radius };
    const proximity = edge[this.sourceType] === CONST.WALL_SENSE_TYPES.PROXIMITY;

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
   * Is the line between the source origin and the point of the V tangential to the V?
   * If the source is inside the V, this is false.
   * If the source --> point of the V will end inside the V, it is also false.
   * Source --> point of V must end outside the V.
   * Tangential points do not block the light, but rather cause shadows.
   * @param {Edge} linkedEdge           Linked edge to test for this endpoint
   * @param {"A"|"B"} endpointName      Which endpoint to test
   * @returns {number}
   *   -2 if not tangential to the V.
   *   -1 if not blocking.
   *   Angle in degrees outside the "V" if the point is tangential.
   */
  sharedEndpointAngle(linkedEdge, sharedEndpointName) {
    const { EV_ENDPOINT_LINK_BLOCKED } = this.constructor;
    const edge = this.edge;
    const sharedPt = edge[sharedEndpointName];
    const otherEdgePt = edge[flipEdgeLabel[sharedEndpointName]]; // Flip: a --> b, b --> a.
    const otherLinkedPt = linkedEdge.a.key === sharedPt.key ? linkedEdge.b : linkedEdge.a;
    const sourceOrigin = this.sourceOrigin;
    if ( !tangentToV(otherEdgePt, sharedPt, otherLinkedPt, sourceOrigin) ) return EV_ENDPOINT_LINK_BLOCKED;
    return pointVTest(otherEdgePt, sharedPt, otherLinkedPt, sourceOrigin);
  }

  /**
   * Angle of the linked wall, measured from the shared endpoint.
   * @param {Edge} linkedEdge           Linked edge to test for this endpoint
   * @param {"A"|"B"} endpointName      Which endpoint to use
   * @returns {number}
   *   -10 if not blocking.
   *   Angle in radians between -π and π
   */
  linkedWallAngle(linkedEdge, sharedEndpointName) {
    const sharedPt = this.edge[sharedEndpointName];
    const otherLinkedPt = linkedEdge.a.key === sharedPt.key ? linkedEdge.b : linkedEdge.a;

    // Same as Foundry's Ray.angle.
    return Math.atan2(otherLinkedPt.y - sharedPt.y, otherLinkedPt.x - sharedPt.x);
  }

  /**
   * Get edges that share an endpoint with this edge.
   * Organize by shared endpoint.
   * See Wall.prototype.getLinkedSegments for recursive version.
   * @param {Edge} edge
   * @returns {object}
   */
  getLinkedEdges() {
    const edge = this.edge;
    const linkedA = new Set();
    const linkedB = new Set();
    const keyA = edge.a.key;
    const keyB = edge.b.key;
    canvas.edges.forEach(e => {
      if ( e === edge ) return;
      const eA = e.a.key;
      const eB = e.b.key;
      if ( keyA === eA || keyA === eB ) linkedA.add(e);
      else if ( keyB === eA || keyB === eB ) linkedB.add(e);
    });
    return { linkedA, linkedB };
  }

  // ----- NOTE: Geometry ----- //

  /**
   * Update the edge corner data.
   * @param {number[12]} aWallCorner0     Array or buffer array of vertices to update in place
   * @param {number[12]} aWallCorner1     Array or buffer array of vertices to update in place
   */
  #updateCorners(aWallCorner0, aWallCorner1) {
    // Must repeat the wall data for each vertex. (x3)
    const { corner0, corner1 } = this.edgeCornerCoordinates();
    for ( let i = 0; i < 3; i += 1 ) {
      const j = i * 4;
      aWallCorner0[j+0] = corner0[0];
      aWallCorner0[j+1] = corner0[1];
      aWallCorner0[j+2] = corner0[2];
      aWallCorner0[j+3] = corner0[3];

      aWallCorner1[j+0] = corner1[0];
      aWallCorner1[j+1] = corner1[1];
      aWallCorner1[j+2] = corner1[2];
      aWallCorner1[j+3] = corner1[3];
    }
  }

  /**
   * Update the edge sense type data.
   * @param {number[3]} aWallSenseType    Array or buffer array of vertices to update in place
   */
  #updateSenseType(aWallSenseType) {
    const type = this.senseType;
    for ( let i = 0; i < 3; i += 1 ) aWallSenseType[i] = type;
  }

  /**
   * Update the edge sense type data.
   * @param {number[3]} aWallSenseType    Array or buffer array of vertices to update in place
   */
  #updateThresholdRadius2(aThresholdRadius2) {
    const threshold = this.threshold2Attribute();
    for ( let i = 0; i < 3; i += 1 ) aThresholdRadius2[i] = threshold;
  }

  /**
   * Retrieve edge endpoint data for a corner.
   * A is top, B is bottom
   * @param {Edge} edge
   * @returns { corner0: {PIXI.Point}, corner1: {PIXI.Point}, topZ: {number}, bottomZ: {number} }
   */
  edgeCornerCoordinates() {
    // Note if wall is bound to another.
    // Required to avoid light leakage due to penumbra in the shader.
    // Don't include the link if it is not a valid wall for this source.
    const { linkedA, linkedB } = this.getLinkedEdges();

    // Find the smallest angle between this wall and a linked wall that covers this light.
    // If less than 180º, the light is inside a "V" and so the point of the V blocks all light.
    // If greater than 180º, the light is outside the "V" and so the point of the V may not block all light.
    const { EV_ENDPOINT_LINKED_UNBLOCKED, EV_ENDPOINT_LINK_BLOCKED } = this.constructor;

    let blockingEdgeA;
    let blockAngleA = 360;
    for ( const linkedEdge of linkedA ) {
      if ( !this._includeEdge(linkedEdge) ) continue;
      const blockAngle = this.sharedEndpointAngle(linkedEdge, "a");
      if ( blockAngle === EV_ENDPOINT_LINKED_UNBLOCKED || blockAngle > blockAngleA ) continue;
      blockingEdgeA = linkedEdge;
      blockAngleA = blockAngle;
      if ( blockAngle === EV_ENDPOINT_LINK_BLOCKED ) break;
    }

    let blockingEdgeB;
    let blockAngleB = 360;
    for ( const linkedEdge of linkedB ) {
      if ( !this._includeEdge(linkedEdge) ) continue;
      const blockAngle = this.sharedEndpointAngle(linkedEdge, "b");
      if ( blockAngle > blockAngleB ) continue;
      blockingEdgeB = linkedEdge;
      blockAngleB = blockAngle;
      if ( blockAngle === EV_ENDPOINT_LINK_BLOCKED ) break;
    }

    // For a given wall, its "w" coordinate is:
    // -2: The two walls are concave w/r/t the light, meaning light is completely blocked.
    // -1: No blocking
    // 0+: wall.key representing location of the opposite endpoint of the linked wall.
    const blockWallAKey = blockAngleA === 360 ? EV_ENDPOINT_LINKED_UNBLOCKED
      : this.linkedWallAngle(blockingEdgeA, "a");

    const blockWallBKey = blockAngleB === 360 ? EV_ENDPOINT_LINKED_UNBLOCKED
      : this.linkedWallAngle(blockingEdgeB, "b");

    return {
      corner0: [this.edge.a.x, this.edge.a.y, this.edgeTopZ, blockWallAKey],
      corner1: [this.edge.b.x, this.edge.b.y, this.edgeBottomZ, blockWallBKey]
    };
  }

  // ----- NOTE: Updates to geometry ----- //

  /**
   * Update based on indicated changes to the source.
   * @param {Set<string>} changes         Change keys for the source.
   * @returns {boolean} True if the indicated changes resulted in a change to the geometry.
   */
  sourceUpdated(_changes) {
    return false;
  }

  /**
   * Update based on indicated changes to the edge.
   * @param {Set<string>} changes         Change keys for the source.
   * @returns {boolean} True if the indicated changes resulted in a change to the geometry.
   */
  edgeUpdated(changes) {
    // Determine relevant changes in the changes set.
    const changedPosition = changes.has("c");
    const changedElevation = [
      "flags.wall-height.top",
      "flags.wall-height.bottom",
      "flags.elevatedvision.elevation.top",
      "flags.elevatedvision.elevation.bottom"].some(prop => changes.has(prop));
    const changedThreshold = changes.has(`threshold.${this.sourceType}`) || changes.has("threshold.attenuation");
    const changedSenseType = changes.has(`${this.sourceType}`);

    // Update geometry accordingly.
    if ( changedPosition || changedElevation ) this._updateCorners();
    if ( changedThreshold ) this._updateThresholdRadius2();
    if ( changedSenseType ) this._updateSenseType();

    // If anything was updated, return true.
    return changedPosition || changedElevation || changedThreshold || changedSenseType;
  }

  /**
   * Update the entire geometry.
   */
  _updateGeometry() {
    this._updateCorners();
    this._updateThresholdRadius2();
    this._updateSenseType();
  }

  /**
   * Update the edge geometry for this source-edge relationship.
   */
  _updateCorners() {
    const aWallCorner0 = this.getBuffer("aWallCorner0").data;
    const aWallCorner1 = this.getBuffer("aWallCorner1").data;
    this.#updateCorners(aWallCorner0, aWallCorner1);
  }

  /**
   * Update the edge type attribute for this source-edge relationship.
   */
  _updateSenseType() {
    const aWallSenseType = this.getBuffer("aWallSenseType").data;
    this.#updateSenseType(aWallSenseType);
  }

  /**
   * Update the edge threshold attribute for this source-edge relationship.
   */
  _updateThresholdRadius2() {
    const aThresholdRadius2 = this.getBuffer("aThresholdRadius2").data;
    this.#updateThresholdRadius2(aThresholdRadius2);
  }


  /**
   * Should this edge be included in the geometry for this source shadow?
   * @param {Edge} edge
   * @returns {boolean}   True if edge should be included
   */
  _includeEdge(edge) {
    if ( edge.type !== "wall" && edge.type !== "regionWall" ) return false;
    return this.source[MODULE_ID]._testEdgeInclusion(edge, PIXI.Point.fromObject(this.source));
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
}

export class PointSourceShadowMultiWallSubGeometry extends SourceShadowMultiWallSubGeometry {
  // ----- NOTE: Getters / Setters ----- //

  /** @type {number} */
  get sourceSize() { return this.source.data.lightSize; }

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
