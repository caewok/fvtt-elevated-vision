/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

/* Wall Geometry version 2
Track relationship between a single edge and a light source.
Also tracks connected edges used to determine shape of the penumbra.
Creates geometry used by the shader.
- Vertices of the penumbra triangle.
- Wall ratio to determine if fragment is in front of wall.
- Wall threshold information to determine if fragment is shaded.

Randomly samples points in the light sphere to create the shadow.
*/

import { MODULE_ID } from "../const.js";
import { Draw } from "../geometry/Draw.js";
import { pointVTest, tangentToV } from "../util.js";

const flipEdgeLabel = {
  a: "b",
  b: "a"
};

const SAME_SIDE = (o0, o1) => o0 * o1 > 0.0;
const OPP_SIDE = (o0, o1) => o0 * o1 < 0.0;
const COLLINEAR = o => o.almostEqual(0.0, 1.0e-06);
const COUNTERCLOCKWISE = o => o > 0.0;
const CLOCKWISE = o => o < 0.0;

// TODO: Handle linked edge updates.


export class SourceShadowSingleWallGeometry extends PIXI.Geometry {
  /**
   * Number of pixels to extend edges, to ensure overlapping shadows for connected edges.
   * @type {number}
   */
  static WALL_OFFSET_PIXELS = 2;

  /**
   * Signal that a wall endpoint has no linked walls.
   * @type {number}
   */
  static EV_ENDPOINT_LINKED_UNBLOCKED = -10.0;

  /**
   * Signal that a linked wall to the edge will completely block the light.
   */
  static EV_ENDPOINT_LINK_BLOCKED = -20.0;

  /** @type {PointSource} */
  source;

  /** @type {Edge} */
  edge;

  /**
   * Edges currently connected to this edge's A endpoint.
   * @type {{ a: Set<Edge>, b: Set<Edge> }}
   */
  linkedEdges = { a: new Set(), b: new Set() };

  // ----- NOTE: Instantiation ----- //

  /** @type {boolean} */
  #initialized = false;

  get initialized() { return this.#initialized; }

  /**
   * Initialize the shadow properties for this source.
   */
  initialize(source, edge) {
    if ( this.#initialized ) return;
    this.source = source;
    this.edge = edge;
    this.constructWallGeometry();
    this.#initialized = true;
  }

  // ----- NOTE: Getters / Setters ----- //

  /** @type {string} */
  get sourceType() { return this.source.constructor.sourceType; }

  /** @type {Point3d} */
  get sourceOrigin() { return CONFIG.GeometryLib.threeD.Point3d.fromPointSource(this.source); }

  /** @type {number} */
  get edgeTopZ() {
    return CONFIG.GeometryLib.utils.gridUnitsToPixels(this.edge.elevationLibGeometry.a.top ?? 1e08);
  }

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
   * Calculate the wall geometry for this source.
   * The base assumes a single shadow from the light center.
   * @param {Point3d[]} [samples = this.sourceOrigin]     The points within the light to use
   */
  constructWallGeometry() {
    // Add index.
    this.addIndex(Array.fromRange(3)); // 3 vertices each.

    // Set the wall values.
    // Must repeat the wall data for each vertex. (x3)
    const aWallCorner0 = Array(4 * 3);
    const aWallCorner1 = Array(4 * 3);
    this.#updateCorners(aWallCorner0, aWallCorner1);

    const aWallSenseType = Array(1 * 3);
    this.#updateSenseType(aWallSenseType);

    const aThresholdRadius2 = Array(1 * 3);
    this.#updateThresholdRadius2(aThresholdRadius2);

    // Add the data to the buffer.
    this.addAttribute("aWallCorner0", aWallCorner0, 4);
    this.addAttribute("aWallCorner1", aWallCorner1, 4);
    this.addAttribute("aWallSenseType", aWallSenseType, 1);
    this.addAttribute("aThresholdRadius2", aThresholdRadius2, 1);
  }

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

  /**
   * Should this edge be included in the geometry for this source shadow?
   * @param {Edge} edge
   * @returns {boolean}   True if edge should be included
   */
  _includeEdge(edge) {
    if ( edge.type !== "wall" && edge.type !== "regionWall" ) return false;
    return this.source[MODULE_ID]._testEdgeInclusion(edge, PIXI.Point.fromObject(this.source));
  }

  // ----- NOTE: Updates to geometry ----- //

  /**
   * Update based on indicated changes to the source.
   * @param {Set<string>} changes         Change keys for the source.
   * @returns {boolean} True if the indicated changes resulted in a change to the geometry.
   */
  sourceUpdated(_changes) { return false; }

  /**
   * Update based on indicated changes to the edge.
   * @param {Set<string>} changes         Change keys for the source.
   * @param {boolean} [update=true]   If false, buffer will not be flagged for update.
   * @returns {boolean} True if the indicated changes resulted in a change to the geometry.
   */
  edgeUpdated(changes, { update = true } = {}) {
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
    const anyChanges = changedPosition || changedElevation || changedThreshold || changedSenseType;
    if ( anyChanges && update ) this.update();
    return anyChanges;
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
   * Flag each buffer for updating.
   * Assumes buffers were in fact changed. See _updateGeometry.
   */
  update() {
    // Flag each buffer for updating.
    // Assumes that addWall, updateWall, or removeWall updated the local buffer previously.
    for ( const attr of Object.keys(this.attributes) ) {
      const buffer = this.getBuffer(attr);
      buffer.update(buffer.data);
    }
    this.indexBuffer.update(this.indexBuffer.data);
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

export class PointSourceShadowSingleWallGeometry extends SourceShadowSingleWallGeometry {
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

export class DirectionalSourceShadowSingleWallGeometry extends SourceShadowSingleWallGeometry {

}

// ----- NOTE: Helper functions ----- //


/** Testing single shadow
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
SourceShadowWallGeometry2 = api.testing.SourceShadowWallGeometry2
l = canvas.lighting.placeables[0];
edge0 = canvas.walls.placeables[0].edge
geom = new SourceShadowWallGeometry2(l.lightSource, edge0)
*/

/** Testing sized shadow
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
SizedSourceShadowWallGeometry2 = api.testing.SizedSourceShadowWallGeometry2
l = canvas.lighting.placeables[0];
edge0 = canvas.walls.placeables[0].edge
geom = new SizedSourceShadowWallGeometry2(l.lightSource, edge0)
geom.drawLight()
geom.drawShadowTriangles({ width: 0})
geom.drawEdge()

*/
