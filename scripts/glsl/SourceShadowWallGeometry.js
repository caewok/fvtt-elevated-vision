/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI,
Wall
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "../const.js";
import { pointVTest, tangentToV } from "../util.js";
import { edgeElevationZ } from "./WebGLShadows.js";

const flipEdgeLabel = {
  a: "b",
  b: "a"
};

export class SourceShadowWallGeometry extends PIXI.Geometry {

  /**
   * Number of pixels to extend edges, to ensure overlapping shadows for connected edges.
   * @type {number}
   */
  static WALL_OFFSET_PIXELS = 2;

  /**
   * Changes to monitor in the edge data that indicate a relevant change.
   */
  static CHANGE_FLAGS = [
    // Wall location
    "c",
    "flags.wall-height.top",
    "flags.wall-height.bottom",
    "flags.elevatedvision.elevation.top",
    "flags.elevatedvision.elevation.bottom",

    // Wall direction and door state
    "dir",
    "ds",

    // Wall sense types
    "sight",
    "light",

    // Wall threshold data
    "threshold.sight",
    "threshold.light",
    "threshold.attenuation"
  ];

  /**
   * Track the triangle index for each wall used by this source.
   * @type {Map<string, number>} Wall id and the index
   */
  _triEdgeMap = new Map();

  /** @type {PointSource} */
  source;

  /** @type {sourceType} */
  sourceType = "light";

  constructor(source, edges) {
    super();
    this.source = source;
    this.sourceType = source.constructor.sourceType;

    edges ??= canvas.edges;
    this.constructWallGeometry(edges);
  }

  // TODO: Should this be a stored value? Makes it more complicated, but...
  get hasLimitedWalls() {
    const dat = this.getBuffer("aWallSenseType").data;
    return dat.some(x => x);
  }

  /** @type {Point3d} */
  get sourceOrigin() {
    return CONFIG.GeometryLib.threeD.Point3d.fromPointSource(this.source);
  }

  /**
   * Orientation of a edge to the source.
   * @param {Edge} edge
   * @returns {number}  See foundry.utils.orient2dFast.
   */
  sourceEdgeOrientation(edge) {
    return foundry.utils.orient2dFast(edge.a, edge.b, this.sourceOrigin);
  }

  /**
   * Represent an array of edges as attributes in a webgl geometry.
   * Attributes:
   * - edge endpoint a (aWallCorner0)
   * - edge endpoint b (aWallCorner1)
   * - sense type (CONST.WALL_SENSE_TYPES)
   * - threshold radius
   * @param {Edge[]|Map<id,Edge>|Set<Edge} edges
   */
  constructWallGeometry(edges) {
    this._triEdgeMap.clear();

    // Default is to draw light --> wallcorner0 --> wallcorner1.
    // Assumed that light is passed as uniform.
    // Attributes used to pass needed wall data to each vertex.
    const indices = [];
    const aWallCorner0 = [];
    const aWallCorner1 = [];
    const aWallSenseType = []; // CONST.WALL_SENSE_TYPES
    const aThresholdRadius2 = []; // If within this radius squared of the light, ignore the wall.

    let triNumber = 0;
    for ( const edge of edges.values() ) {
      if ( !this._includeEdge(edge) ) continue;
      const {corner0, corner1 } = this.edgeCornerCoordinates(edge);

      // TODO: Instanced attributes.
      // For now, must repeat the vertices three times.
      // Should be possible to use instanced attributes to avoid this. (see PIXI.Attribute)
      // Unclear whether that would be supported using Foundry rendering options.
      aWallCorner0.push(...corner0, ...corner0, ...corner0);
      aWallCorner1.push(...corner1, ...corner1, ...corner1);

      const type = this.senseType(edge);
      aWallSenseType.push(type, type, type);

      const threshold = this.threshold2Attribute(edge);
      aThresholdRadius2.push(threshold, threshold, threshold);

      const idx = triNumber * 3;
      indices.push(idx, idx + 1, idx + 2);

      // Track where this edge is in the attribute arrays for future updates.
      this._triEdgeMap.set(edge.id, triNumber);
      triNumber += 1;
    }

    // TODO: Should this or a subclass set interleave to true?
    this.addIndex(indices);
    this.addAttribute("aWallCorner0", aWallCorner0, 4);
    this.addAttribute("aWallCorner1", aWallCorner1, 4);
    this.addAttribute("aWallSenseType", aWallSenseType, 1);
    this.addAttribute("aThresholdRadius2", aThresholdRadius2, 1);
  }

  /**
   * Sense type for this edge and source combination.
   * @param {Edge} edge
   * @returns {CONST.WALL_SENSE_TYPES}
   */
  senseType(edge) { return edge[this.sourceType]; }

  /**
   * Is the wall limited with respect to this light source?
   * @param {Edge} edge
   * @returns {boolean}
   */
  isLimited(edge) { return this.senseType(edge) === CONST.WALL_SENSE_TYPES.LIMITED; }

  /**
   * For threshold edge, get the threshold distance
   * @param {Edge} edge
   * @returns {number}  Distance of the threshold in pixel units, or 0 if none.
   */
  threshold2Attribute(edge) {
    if ( !this.thresholdApplies(edge) ) return 0;
    const { inside, outside } = this.calculateThresholdAttenuation(edge);
    return Math.min(Number.MAX_SAFE_INTEGER, Math.pow(inside + outside, 2)); // Avoid infinity.
  }

  /**
   * Calculate threshold attenuation for an edge.
   * If the edge is not attenuated, inside + outside will be >= source radius.
   * See PointSourcePolygon.prototype.#calculateThresholdAttenuation
   * @param {Edge} edge
   * @returns {{inside: number, outside: number}} The inside and outside portions of the radius
   */
  calculateThresholdAttenuation(edge) {
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

  /**
   * For threshold edges, determine if threshold applies.
   * @param {Edge} edge
   * @returns {boolean} True if the threshold applies.
   */
  thresholdApplies(edge) { return edge.applyThreshold(this.sourceType, this.source, this.source.data.externalRadius); }

  /**
   * Should this edge be included in the geometry for this source shadow?
   * @param {Edge} edge
   * @returns {boolean}   True if edge should be included
   */
  _includeEdge(edge) {
    return this.source[MODULE_ID]._testEdgeInclusion(edge, PIXI.Point.fromObject(this.source));
  }

  /**
   * Retrieve edge endpoint data for a corner.
   * A is top, B is bottom
   * @param {Edge} edge
   * @returns { corner0: {PIXI.Point}, corner1: {PIXI.Point}, topZ: {number}, bottomZ: {number} }
   */
  edgeCornerCoordinates(edge) {
    const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
    const MAX_ELEV = 1e6;

    // TODO: Handle different a/b elevations.
    const { topZ, bottomZ } = edgeElevationZ(edge);
    const top = Math.min(MAX_ELEV, topZ);
    const bottom = Math.max(-MAX_ELEV, bottomZ);

    // Note if wall is bound to another.
    // Required to avoid light leakage due to penumbra in the shader.
    // Don't include the link if it is not a valid wall for this source.
    const { linkedA, linkedB } = this.constructor.getLinkedEdges(edge);

    // Find the smallest angle between this wall and a linked wall that covers this light.
    // If less than 180º, the light is inside a "V" and so the point of the V blocks all light.
    // If greater than 180º, the light is outside the "V" and so the point of the V may not block all light.

    let blockingEdgeA;
    let blockAngleA = 360;
    for ( const linkedEdge of linkedA ) {
      const blockAngle = this.sharedEndpointAngle(edge, linkedEdge, "a");
      if ( blockAngle === -1 || blockAngle > blockAngleA ) continue;
      blockingEdgeA = linkedEdge;
      blockAngleA = blockAngle;
      if ( blockAngle === -2 ) break;
    }

    let blockingEdgeB;
    let blockAngleB = 360;
    for ( const linkedEdge of linkedB ) {
      const blockAngle = this.sharedEndpointAngle(edge, linkedEdge, "b");
      if ( blockAngle === -1 || blockAngle > blockAngleB ) continue;
      blockingEdgeB = linkedEdge;
      blockAngleB = blockAngle;
      if ( blockAngle === -2 ) break;
    }

    // For a given wall, its "w" coordinate is:
    // -2: The two walls are concave w/r/t the light, meaning light is completely blocked.
    // -1: No blocking
    // 0+: wall.key representing location of the opposite endpoint of the linked wall.
    const blockWallAKey = blockAngleA === 360 ? -1
      : blockAngleA === -2 ? -2
        : blockAngleA <= 180 ? -2 // Should not happen.
          : blockingEdgeA.a.key === edge.a.key ? blockingEdgeA.b.key
            : blockingEdgeA.a.key;

    const blockWallBKey = blockAngleB === 360 ? -1
      : blockAngleB === -2 ? -2
        : blockAngleB <= 180 ? -2 // Should not happen.
          : blockingEdgeB.a.key === edge.a.key ? blockingEdgeB.b.key
            : blockingEdgeB.a.key;

    return {
      corner0: [edge.a.x, edge.a.y, top, blockWallAKey],
      corner1: [edge.b.x, edge.b.y, bottom, blockWallBKey]
    };
  }

  /**
   * Get edges that share an endpoint with this edge.
   * Organize by shared endpoint.
   * See Wall.prototype.getLinkedSegments for recursive version.
   * @param {Edge} edge
   * @returns {object}
   */
  static getLinkedEdges(edge) {
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

  /**
   * Is the line between the source origin and the point of the V tangential to the V?
   * If the source is inside the V, this is false.
   * If the source --> point of the V will end inside the V, it is also false.
   * Source --> point of V must end outside the V.
   * Tangential points do not block the light, but rather cause shadows.
   * @param {Edge} edge                 Edge whose endpoint is shared with the linked edge
   * @param {Edge} linkedEdge           Linked edge to test for this endpoint
   * @param {"A"|"B"} endpointName      Which endpoint to test
   * @returns {number}
   *   -2 if not tangential to the V.
   *   -1 if not blocking.
   *   Angle in degrees outside the "V" if the point is tangential.
   */
  sharedEndpointAngle(edge, linkedEdge, sharedEndpointName) {
    if ( !(this._triEdgeMap.has(linkedEdge.id) || this._includeEdge(linkedEdge)) ) return -1; // Quicker to check the map first.

    const sharedPt = edge[sharedEndpointName];
    const otherEdgePt = edge[flipEdgeLabel[sharedEndpointName]]; // Flip: a --> b, b --> a.
    const otherLinkedPt = linkedEdge.a.key === sharedPt.key ? linkedEdge.b : linkedEdge.a;
    const sourceOrigin = this.sourceOrigin;
    if ( !tangentToV(otherEdgePt, sharedPt, otherLinkedPt, sourceOrigin) ) return -2;
    return pointVTest(otherEdgePt, sharedPt, otherLinkedPt, sourceOrigin);
  }


  /** Testing endpoint blocks
[wall] = canvas.walls.controlled
[linkedWall] = canvas.walls.controlled
let [wall, linkedWall] = canvas.walls.controlled

let [l] = canvas.lighting.placeables
geom = l.source.elevatedvision.wallGeometry
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get("elevatedvision").api
DirectionalLightSource = api.DirectionalLightSource

geom.wallCornerCoordinates(wall)
geom.wallCornerCoordinates(linkedWall)

geom.sharedEndpointAngle(wall, linkedWall, "B")
geom.sharedEndpointAngle(wall, linkedWall, "A")

sharedPt = wall[endpointName];
otherWallPt = wall[endpointName === "A" ? "B" : "A"];
otherLinkedPt = linkedWall.A.key === sharedPt.key ? linkedWall.B : linkedWall.A;
sourceOrigin = geom.sourceOrigin;

  */

  // ----- Edge updates ----- //
  /**
   * Add single element (chunk) of data to a buffer and return a new buffer.
   *
   * @param {TypedArray} buffer   Typed array to copy and modify
   * @param {number[]} data       New data chunk to add
   * @returns {TypedArray} New typed array with one additional element at end
   */
  static addToBuffer(buffer, data) {
    // TODO: Remove when done testing for speed.
    if ( (buffer.length % data.length) !== 0 ) {
      console.error(`${MODULE_ID}|overwriteBufferAt has incorrect data length.`);
      return buffer;
    }

    const newBufferData = new buffer.constructor(buffer.length + data.length);
    newBufferData.set(buffer, 0);
    newBufferData.set(data, buffer.length);
    return newBufferData;
  }

  /**
   * Add single element of a given size to a buffer and return a new buffer.
   * @param {TypedArray} buffer       Typed array to copy and modify
   * @param {number[]} data           New data to add
   * @param {number} idxToOverwrite   Index of the element.
   *   If there are 10 elements, and data is length 3, then buffer should be length 30.
   * @returns {TypedArray} New typed array with one additional element at end
   */
  static overwriteBufferAt(buffer, data, idxToOverwrite) {
    // TODO: Remove when done testing for speed.
    if ( (buffer.length % data.length) !== 0 || (idxToOverwrite * data.length) > buffer.length ) {
      console.error(`${MODULE_ID}|overwriteBufferAt has incorrect data length.`);
      return buffer;
    }

    buffer.set(data, data.length * idxToOverwrite);
    return buffer;
  }

  /**
   * Remove single element of a given size from a buffer and return a new buffer of the remainder.
   * @param {TypedArray} buffer   Typed array to copy and modify
   * @param {number} size         Size of a given element.
   * @param {number} idxToRemove  Element index to remove. Will be adjusted by size.
   *    If there are 10 elements, and siz is length 3, then buffer should be length 30.
   * @returns {TypedArray} New typed array with one less element
   */
  static removeFromBuffer(buffer, size, idxToRemove) {
    // TODO: Remove when done testing for speed.
    if ( (buffer.length % size) !== 0 || (idxToRemove * size) > buffer.length ) {
      console.error(`${MODULE_ID}|overwriteBufferAt has incorrect data length.`);
      return buffer;
    }

    const newLn = Math.max(buffer.length - size, 0);
    const newBufferData = new buffer.constructor(newLn);
    if ( !newLn ) return newBufferData;

    newBufferData.set(buffer.slice(0, idxToRemove * size), 0);
    newBufferData.set(buffer.slice((idxToRemove * size) + size), idxToRemove * size);
    return newBufferData;
  }

  /**
   * For the given added edge, determine if it changes the link status of connected edges.
   * If so, update those linked edges.
   * @param {Edge} edge               Edge to update
   * @param {boolean} [update=true]   If false, buffer will not be flagged for update
   * @returns {boolean}  Did the geometry need to be updated?
   */
  _checkAddedEdgeLinks(addedEdge, update = true) {
    const { linkedA, linkedB } = this.constructor.getLinkedEdges(addedEdge);
    let linkUpdated = false;
    for ( const linkedEdge of linkedA.union(linkedB) ) {
      const res = this._updateEdgeLinkBuffer(linkedEdge, update);
      linkUpdated ||= res;
    }
    return linkUpdated;
  }

  /**
   * For the given updated or removed edge, determine if it changes the link status of connected walls.
   * @param {string} updatedEdgeId    ID of updated or removed edge
   * @param {boolean} [update=true]   If false, buffer will not be flagged for update
   * @returns {boolean} Did the geometry need to be updated based on the edge update?
   */
  _checkEdgeLinks(updatedEdgeId, update = true) {
    // We cannot know what the edge links were previous to the update unless we store all that data.
    // Instead, cycle through each checking for changes.
    let linkUpdated = false;
    for ( const edgeId of this._triEdgeMap.keys() ) {
      if ( edgeId === updatedEdgeId ) continue;
      const edge = canvas.edges.get(edgeId);
      if ( !edge ) continue;
      const res = this._updateEdgeLinkBuffer(edge, update);
      linkUpdated ||= res;
    }
    return linkUpdated;
  }

  /**
   * Update link buffers as necessary for a given edge.
   * Because this updates the coordinates, use this or _updateWallPosition, not both.
   * @param {Edge} edge               Edge to update
   * @param {number} idxToUpdate      Index of the coordinate in the buffer
   * @param {boolean} [update=true]   If false, buffer will not be flagged for update
   * @returns {boolean} Did the geometry need to be updated based on the wall update?
   */
  _updateEdgeLinkBuffer(edge, update = true) {
    if ( !this._triEdgeMap.has(edge.id) ) return false;
    const idxToUpdate = this._triEdgeMap.get(edge.id);

    const { corner0, corner1 } = this.edgeCornerCoordinates(edge);
    let changedLink = this.getAttributeAtIndex("aWallCorner0", idxToUpdate)[3] !== corner0[3];
    changedLink ||= this.getAttributeAtIndex("aWallCorner1", idxToUpdate)[3] !== corner1[3];
    if ( changedLink ) {
      this._updateBuffer(corner0, "aWallCorner0", idxToUpdate, update);
      this._updateBuffer(corner1, "aWallCorner1", idxToUpdate, update);
    }
    return changedLink;
  }

  /**
   * Add an edge to this geometry.
   * @param {Edge} edge   Edge to add
   * @param {boolean} [update=true]  If false, buffer will not be flagged for update
   * @returns {boolean} Did the geometry need to be updated based on the edge addition?
   */
  addEdge(edge, { update = true } = {}) {
    // Theoretically, could have a link update even for a wall we are not including.
    const linkUpdated = this._checkAddedEdgeLinks(edge, update);
    if ( this._triEdgeMap.has(edge.id) ) return linkUpdated;
    if ( !this._includeEdge(edge) ) return linkUpdated;

    const idxToAdd = this._triEdgeMap.size;

    // Edge endpoints
    const { corner0, corner1 } = this.edgeCornerCoordinates(edge);
    this._addToBuffer(corner0, "aWallCorner0", update);
    this._addToBuffer(corner1, "aWallCorner1", update);

    // Edge sense type
    this._addToBuffer([this.senseType(edge)], "aWallSenseType", update);

    // Threshold value
    this._addToBuffer([this.threshold2Attribute(edge)], "aThresholdRadius2", update);

    // Index
    const idx = idxToAdd * 3;
    const dataIdx = [idx, idx + 1, idx + 2];
    this.indexBuffer.data = this.constructor.addToBuffer(this.indexBuffer.data, dataIdx);
    if ( update ) this.indexBuffer.update(this.indexBuffer.data);

    // Add the edge id as the next triangle object to the tracker.
    this._triEdgeMap.set(edge.id, idxToAdd);

    return true;
  }

  _addToBuffer(newValues, attributeName, update = true) {
    // Currently, every buffer is repeated three times.
    const data = [...newValues, ...newValues, ...newValues];
    const buffer = this.getBuffer(attributeName);
    buffer.data = this.constructor.addToBuffer(buffer.data, data);
    if ( update ) buffer.update(buffer.data);
  }

  /**
   * Update an edge in this geometry.
   * May result in an edge being added or removed.
   * @param {Edge} edge   Edge to update
   * @param {object} [opts]               Options that affect how the edge update is treated.
   * @param {boolean} [opts.update]       If false, buffer will not be flagged for update.
   * @returns {boolean} Did the geometry need to be updated based on the wall update?
   */
  updateEdge(edge, { update = true } = {}) {
    if ( !this._triEdgeMap.has(edge.id) ) return this.addEdge(edge, { update });
    if ( !this._includeEdge(edge) ) return this.removeEdge(edge.id, { update });

    // Check for updates to wall link status for edges linked to this one.
    const updatedLinkedEdges = this._checkEdgeLinks(edge.id, update);

    // Note: includeEdge will handle changes to the threshold.attenuation.
    // Check for changes to the given coordinate set and update the buffers.
    // Don't need to update the index
    const idxToUpdate = this._triEdgeMap.get(edge.id);
    const changedPosition = this._updateEdgePosition(edge, idxToUpdate, update);
    const changedSenseType = this._updateEdgeSenseType(edge, idxToUpdate, update);
    const changedThreshold = this._updateEdgeThreshold(edge, idxToUpdate, update);
    return updatedLinkedEdges || changedPosition || changedSenseType || changedThreshold;
  }

  /**
   * Check for change in edge endpoints or link status and update buffer accordingly.
   * @param {Edge} edge               Edge to update
   * @param {number} idxToUpdate      Index of the coordinate in the buffer
   * @param {boolean} [update=true]   If false, buffer will not be flagged for update
   * @returns {boolean} Did the geometry need to be updated based on the wall update?
   */
  _updateEdgePosition(edge, idxToUpdate, update = true) {
    const { corner0, corner1 } = this.edgeCornerCoordinates(edge);
    let changedPosition = this.getAttributeAtIndex("aWallCorner0", idxToUpdate).some((x, i) => x !== corner0[i]);
    changedPosition ||= this.getAttributeAtIndex("aWallCorner1", idxToUpdate).some((x, i) => x !== corner1[i]);
    if ( changedPosition ) {
      this._updateBuffer(corner0, "aWallCorner0", idxToUpdate, update);
      this._updateBuffer(corner1, "aWallCorner1", idxToUpdate, update);
    }
    return changedPosition;
  }

  /**
   * Check for change in the sense type for the edge and update buffer accordingly.
   * @param {Edge} edge               Edge to update
   * @param {number} idxToUpdate      Index of the coordinate in the buffer
   * @param {boolean} [update=true]   If false, buffer will not be flagged for update
   * @returns {boolean} Did the geometry need to be updated based on the wall update?
   */
  _updateEdgeSenseType(edge, idxToUpdate, update = true) {
    const senseType = this.senseType(edge);
    const changedSenseType = this.getAttributeAtIndex("aWallSenseType")[0] !== senseType;
    if ( changedSenseType ) this._updateBuffer([senseType], "aWallSenseType", idxToUpdate, update);
    return changedSenseType;
  }

  /**
   * Check for change in the relevant threshold attribute and update buffer accordingly.
   * @param {Edge} edge                   Edge to update
   * @param {boolean} [update=true]       If false, buffer will not be flagged for update.
   * @returns {boolean} Did the geometry need to be updated based on the wall update?
   */
  _updateEdgeThreshold(edge, idxToUpdate, update = true) {
    const threshold = this.threshold2Attribute(edge);
    const changedThreshold = this.getAttributeAtIndex("aThresholdRadius2")[0] !== threshold;
    if ( changedThreshold ) this._updateBuffer([threshold], "aThresholdRadius2", idxToUpdate, update);
    return changedThreshold;
  }

  getAttributeAtIndex(attributeName, index) {
    const buffer = this.getBuffer(attributeName);
    const size = this.getAttribute(attributeName).size;
    const numDuplicates = 3;
    const start = index * size * numDuplicates;
    return buffer.data.subarray(start, start + size);
  }

  _updateBuffer(newValues, attributeName, idxToUpdate, update = true) {
    // Currently, every buffer is repeated three times.
    const data = [...newValues, ...newValues, ...newValues];
    const buffer = this.getBuffer(attributeName);
    buffer.data = this.constructor.overwriteBufferAt(buffer.data, data, idxToUpdate);
    if ( update ) buffer.update(buffer.data);
  }

  /**
   * Remove a edge from this geometry.
   * @param {string} id   Edge id (b/c that is what the remove hook uses)
   * @param {boolean} [update=true]   If false, buffer will not be flagged for update.
   * @returns {boolean} Did the geometry need to be updated based on the wall removal?
   */
  removeEdge(id, { update = true } = {}) {
    if ( id instanceof foundry.canvas.edges.Edge ) id = id.id;

    // Theoretically, could have a link update even for a wall we are not including.
    if ( !this._triEdgeMap.has(id) ) return this._checkEdgeLinks(id, update);

    const idxToRemove = this._triEdgeMap.get(id);
    for ( const attr of Object.keys(this.attributes) ) {
      const size = this.getAttribute(attr).size * 3;
      const buffer = this.getBuffer(attr);
      buffer.data = this.constructor.removeFromBuffer(buffer.data, size, idxToRemove);
    }
    const size = 3;
    this.indexBuffer.data = this.constructor.removeFromBuffer(this.indexBuffer.data, size, idxToRemove);

    // Remove the wall from the tracker and decrement other wall indices accordingly.
    this._triEdgeMap.delete(id);
    const fn = (value, key, map) => { if ( value > idxToRemove ) map.set(key, value - 1); };
    this._triEdgeMap.forEach(fn);

    // Currently, the index buffer is consecutive.
    this.indexBuffer.data = this.indexBuffer.data.map((value, index) => index);

    // Remove wall links at the end, so the removed wall is reflected properly.
    this._checkEdgeLinks(id, update);

    // Flag the updated buffers for uploading to the GPU.
    if ( update ) this.update();

    return true;
  }

  /**
   * Check all the walls in the scene b/c of some change to an array of walls
   * @param {Edges[]|Map<string,Edge>|Set<Edge>} [edges]    Optional array of walls to consider.
   * @returns {boolean} True if any changes to the geometry buffers resulted from the refresh.
   */
  refreshEdges(edges) {
    edges ??= canvas.edges;
    const opts = { update: false }; // Avoid repeatedly updating the buffers.
    let changed = false;
    edges.forEach(e => {
      const edgeBufferChanged = this.updateEdge(e, opts);
      changed ||= edgeBufferChanged;
    });
    if ( changed ) this.update();
    return changed;
  }

  update() {
    // Flag each buffer for updating.
    // Assumes that addWall, updateWall, or removeWall updated the local buffer previously.
    for ( const attr of Object.keys(this.attributes) ) {
      const buffer = this.getBuffer(attr);
      buffer.update(buffer.data);
    }
    this.indexBuffer.update(this.indexBuffer.data);
  }

  /**
   * On source movement, check:
   * - wall links. If the source changes orientation w/r/t 2+ linked walls, the link status would update.
   * - whether the wall is included. If the source changes position, the wall may not be included
   * @returns {boolean} True if an update was needed.
   */
  updateSourcePosition() {
    let updated = false;
    const edgesChecked = new Set();
    for ( const [id, idxToUpdate] of this._triEdgeMap ) {
      const edge = canvas.edges.get(id);
      edgesChecked.add(edge);
      if ( !this._includeEdge(edge) ) {
        const wasUpdated = this.removeEdge(edge.id, { update: false });
        updated ||= wasUpdated;
      } else {
        const resLink = this._updateEdgeLinkBuffer(edge, false);
        const resThreshold = this._updateEdgeThreshold(edge, idxToUpdate, false);
        updated ||= (resLink || resThreshold);
      }
    }

    const edgesToAdd = this.source[MODULE_ID]._getEdges().difference(edgesChecked);
    edgesToAdd.forEach(edge => {
      const wasUpdated = this.addEdge(edge, { update: false });
      updated ||= wasUpdated;
    });

    if ( updated ) this.update();
    return updated;
  }
}


export class PointSourceShadowWallGeometry extends SourceShadowWallGeometry {

  _includeEdge(edge) {
    if ( !super._includeEdge(edge) ) return false;

    // Wall must be within the light radius.
    if ( !this.source[MODULE_ID].bounds.lineSegmentIntersects(edge.a, edge.b, { inside: true }) ) return false;

    return true;
  }
}


export class DirectionalSourceShadowWallGeometry extends SourceShadowWallGeometry {

  /** @type {Point3d} */
  get sourceOrigin() {
    const { rect, maxR } = canvas.dimensions;
    const center = rect.center;
    const centerPt = new CONFIG.GeometryLib.threeD.Point3d(center.x, center.y, canvas.scene[MODULE_ID].elevationMin);
    return centerPt.add(this.source.lightDirection.multiplyScalar(maxR));
  }

  /**
   * Orientation of a edge to the source.
   * @param {Edge} edge
   * @returns {number}  See foundry.utils.orient2dFast.
   */
  sourceEdgeOrientation(edge) {
    // Edge must not be the same (2d) direction as the source
    // TODO: Do we need to add a scalar to the normalized source direction?
    const A = PIXI.Point.fromObject(edge.a);
    return !foundry.utils.orient2dFast(A, edge.b, A.add(this.source.lightDirection)).almostEqual(0, 1);
  }

  /**
   * Threshold walls cannot be triggered by directional sources.
   * @param {Edge} edge
   * @returns {boolean} True if the threshold applies.
   */
  thresholdApplies(_edge) { return false; }
}


/* Testing
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
AbstractEVShader = api.AbstractEVShader
EVQuadMesh = api.EVQuadMesh
ShadowTextureRenderer = api.ShadowTextureRenderer
TestShadowShader = api.TestShadowShader
SourceShadowWallGeometry = api.SourceShadowWallGeometry
DirectionalSourceShadowWallGeometry = api.DirectionalSourceShadowWallGeometry
PointSourceShadowWallGeometry = api.PointSourceShadowWallGeometry

let [l] = canvas.lighting.placeables;
source = l.source;

source = _token.vision


// Timing for constructing geometry
function buildPointGeometry(source) {
  return new PointSourceShadowWallGeometry(source);
}

function buildUnboundedGeometry(source) {
  return new SourceShadowWallGeometry(source);
}

function buildDirectionalGeometry(source) {
  return new DirectionalSourceShadowWallGeometry(source);
}

function updateLOSGeometry(source) {
  source.updateLOSGeometry()
}

function renderShadow(source) {
  return source.elevatedvision.shadowRenderer.renderShadowMeshToTexture();
}

function renderLOS(source) {
  return source.elevatedvision.shadowVisionLOSRenderer.renderShadowMeshToTexture();
}

renderTexture = PIXI.RenderTexture.create({
  width: canvas.dimensions.width,
  height: canvas.dimensions.height,
  resolution: 1,
  scaleMode: PIXI.SCALE_MODES.NEAREST
})

function renderMask(source) {
  const mask = source.elevatedvision.shadowVisionMask;
  canvas.app.renderer.render(mask, { renderTexture, clear: true });
  return renderTexture;
}

function renderLOSMask(source) {
  const mask = source.elevatedvision.shadowVisionLOSMask;
  canvas.app.renderer.render(mask, { renderTexture, clear: true });
  return renderTexture;
}


N = 1e04
await foundry.utils.benchmark(buildUnboundedGeometry, N, source)
await foundry.utils.benchmark(buildPointGeometry, N, source)
await foundry.utils.benchmark(buildDirectionalGeometry, N, source)

// Big difference between 1e04 and 1e05. Must hit some caching wall
N = 1e04
await foundry.utils.benchmark(renderShadow, N, source)
await foundry.utils.benchmark(renderMask, N, source)

// For vision
N = 1e04
await foundry.utils.benchmark(renderLOS, N, source)
await foundry.utils.benchmark(renderLOSMask, N, source)

await foundry.utils.benchmark(updateLOSGeometry, N, source)

*/

/*
[wall] = canvas.walls.controlled
source = _token.vision
origin = source
radius = source.radius
externalRadius = 0
type = "sight"

calculateThresholdAttenuation(wall, origin, radius, externalRadius, type)

function calculateThresholdAttenuation(wall, origin, radius, externalRadius, type) {
    const document = wall.document;
    const d = document.threshold[type];
    if ( !d ) return { inside: radius, outside: radius };
    const proximity = document[type] === CONST.WALL_SENSE_TYPES.PROXIMITY;

    // Find the closest point on the threshold wall to the source.
    // Calculate the proportion of the source radius that is "inside" and "outside" the threshold wall.
    const pt = foundry.utils.closestPointToSegment(origin, wall.edge.a, wall.edge.b);
    const inside = Math.hypot(pt.x - origin.x, pt.y - origin.y);
    const outside = radius - inside;
    if ( (outside < 0) || outside.almostEqual(0) ) return { inside, outside: 0 };

    // Attenuate the radius outside the threshold wall based on source proximity to the wall.
    const sourceDistance = proximity ? Math.max(inside - externalRadius, 0) : (inside + externalRadius);
    const thresholdDistance = d * document.parent.dimensions.distancePixels;
    const percentDistance = sourceDistance / thresholdDistance;
    const pInv = proximity ? 1 - percentDistance : Math.min(1, percentDistance - 1);
    const a = (pInv / (2 * (1 - pInv))) * CONFIG.Wall.thresholdAttenuationMultiplier;
    return { inside, outside: Math.min(a * thresholdDistance, outside) };
  }

function calculateThresholdAttenuation2(wall, origin, radius, externalRadius, type) {
    const document = wall.document;
    const d = document.threshold[type];
    if ( !d ) return { inside: radius, outside: radius };
    const proximity = document[type] === CONST.WALL_SENSE_TYPES.PROXIMITY;

    // Find the closest point on the threshold wall to the source.
    // Calculate the proportion of the source radius that is "inside" and "outside" the threshold wall.
    const pt = foundry.utils.closestPointToSegment(origin, wall.edge.a, wall.edge.b);
    const inside = Math.hypot(pt.x - origin.x, pt.y - origin.y);
    const outside = radius - inside;
    if ( (outside < 0) || outside.almostEqual(0) ) return { inside, outside: 0 };

    // Attenuate the radius outside the threshold wall based on source proximity to the wall.
    const sourceDistance = proximity ? Math.max(inside - externalRadius, 0) : (inside + externalRadius);
    const thresholdDistance = d * document.parent.dimensions.distancePixels;
    const percentDistance = sourceDistance / thresholdDistance;
    const pInv = proximity ? 1 - percentDistance : Math.min(1, percentDistance - 1);
    const a = (pInv / (2 * (1 - pInv))) * CONFIG.Wall.thresholdAttenuationMultiplier;
    return { inside, outside: a * thresholdDistance };
  }
*/
