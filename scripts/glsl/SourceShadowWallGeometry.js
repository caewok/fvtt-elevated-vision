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
import { getLinkedWalls, pointVTest } from "../util.js";
import { testWallsForIntersections } from "../ClockwiseSweepPolygon.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { DirectionalLightSource } from "../DirectionalLightSource.js";

export class SourceShadowWallGeometry extends PIXI.Geometry {

  /**
   * Number of pixels to extend walls, to ensure overlapping shadows for connected walls.
   * @type {number}
   */
  static WALL_OFFSET_PIXELS = 2;

  /**
   * Changes to monitor in the wall data that indicate a relevant change.
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
  _triWallMap = new Map();

  /** @type {PointSource} */
  source;

  /** @type {sourceType} */
  sourceType = "light";

  constructor(source, walls) {
    super();
    this.source = source;
    this.sourceType = source.constructor.sourceType;

    walls ??= canvas.walls.placeables;
    this.constructWallGeometry(walls);
  }

  // TODO: Should this be a stored value? Makes it more complicated, but...
  get hasLimitedWalls() {
    const dat = this.getBuffer("aWallSenseType").data;
    return dat.some(x => x);
  }

  /** @type {Point3d} */
  get sourceOrigin() {
    return Point3d.fromPointSource(this.source);
  }

  /**
   * Orientation of a wall to the source.
   * @param {Wall} wall
   * @returns {number}  See foundry.utils.orient2dFast.
   */
  sourceWallOrientation(wall) {
    return foundry.utils.orient2dFast(wall.A, wall.B, this.sourceOrigin);
  }

  constructWallGeometry(walls) {
    this._triWallMap.clear();

    // Default is to draw light --> wallcorner0 --> wallcorner1.
    // Assumed that light is passed as uniform.
    // Attributes used to pass needed wall data to each vertex.
    const indices = [];
    const aWallCorner0 = [];
    const aWallCorner1 = [];
    const aWallSenseType = []; // CONST.WALL_SENSE_TYPES
    const aThresholdRadius2 = []; // If within this radius squared of the light, ignore the wall.

    let triNumber = 0;
    const nWalls = walls.length;
    for ( let i = 0; i < nWalls; i += 1 ) {
      const wall = walls[i];
      if ( !this._includeWall(wall) ) continue;
      const {corner0, corner1 } = this.wallCornerCoordinates(wall);

      // TODO: Instanced attributes.
      // For now, must repeat the vertices three times.
      // Should be possible to use instanced attributes to avoid this. (see PIXI.Attribute)
      // Unclear whether that would be supported using Foundry rendering options.
      aWallCorner0.push(...corner0, ...corner0, ...corner0);
      aWallCorner1.push(...corner1, ...corner1, ...corner1);

      const type = this.senseType(wall);
      aWallSenseType.push(type, type, type);

      const threshold = this.threshold2Attribute(wall);
      aThresholdRadius2.push(threshold, threshold, threshold);

      const idx = triNumber * 3;
      indices.push(idx, idx + 1, idx + 2);

      // Track where this wall is in the attribute arrays for future updates.
      this._triWallMap.set(wall.id, triNumber);
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
   * Sense type for this wall and source combination.
   * @param {Wall} wall
   * @returns {CONST.WALL_SENSE_TYPES}
   */
  senseType(wall) { return wall.document[this.sourceType]; }

  /**
   * Is the wall limited with respect to this light source?
   * @param {Wall} wall
   * @returns {boolean}
   */
  isLimited(wall) { return this.senseType(wall) === CONST.WALL_SENSE_TYPES.LIMITED; }

  /**
   * For threshold walls, get the threshold distance
   * @param {Wall} wall
   * @returns {number}  Distance of the threshold in pixel units, or 0 if none.
   */
  threshold2Attribute(wall) {
    if ( !this.thresholdApplies(wall) ) return 0;
    const { inside, outside } = this.calculateThresholdAttenuation(wall);
    return Math.min(Number.MAX_SAFE_INTEGER, Math.pow(inside + outside, 2)); // Avoid infinity.
  }

  /**
   * Calculate threshold attenuation for a wall.
   * If the wall is not attenuated, inside + outside will be >= source radius.
   * See PointSourcePolygon.prototype.#calculateThresholdAttenuation
   * @param {Wall} wall
   * @returns {{inside: number, outside: number}} The inside and outside portions of the radius
   */
  calculateThresholdAttenuation(wall) {
    const externalRadius = 0;
    const radius = this.source.radius;
    const origin = this.source;
    const document = wall.document;
    const d = document.threshold[this.sourceType];
    if ( !d ) return { inside: radius, outside: radius };
    const proximity = document[this.sourceType] === CONST.WALL_SENSE_TYPES.PROXIMITY;

    // Find the closest point on the threshold wall to the source.
    // Calculate the proportion of the source radius that is "inside" and "outside" the threshold wall.
    const pt = foundry.utils.closestPointToSegment(origin, wall.A, wall.B);
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

  /**
   * For threshold walls, determine if threshold applies.
   * @param {Wall} wall
   * @returns {boolean} True if the threshold applies.
   */
  thresholdApplies(wall) { return wall.applyThreshold(this.sourceType, this.source, this.source.data.externalRadius); }

  /**
   * Should this wall be included in the geometry for this source shadow?
   * @param {Wall} wall
   * @returns {boolean}   True if wall should be included
   */
  _includeWall(wall) {
    return this.source._testWallInclusion(wall, PIXI.Point.fromObject(this.source));
  }

  /**
   * Retrieve wall endpoint data for a corner.
   * A is top, B is bottom
   * @param {Wall} wall
   * @returns { corner0: {PIXI.Point}, corner1: {PIXI.Point}, topZ: {number}, bottomZ: {number} }
   */
  wallCornerCoordinates(wall) {
    const { A, B, topZ, bottomZ } = wall;
    const top = Math.min(topZ, 1e6);
    const bottom = Math.max(bottomZ, -1e6);

    // Note if wall is bound to another.
    // Required to avoid light leakage due to penumbra in the shader.
    // Don't include the link if it is not a valid wall for this source.
    const { linkedA, linkedB } = getLinkedWalls(wall);

    // Find the smallest angle between this wall and a linked wall that covers this light.
    // If less than 180º, the light is inside a "V" and so the point of the V blocks all light.
    // If greater than 180º, the light is outside the "V" and so the point of the V may not block all light.

    let blockingWallA;
    let blockAngleA = 360;
    for ( const linkedWall of linkedA ) {
      const blockAngle = this.endpointBlocks(wall, linkedWall, "A");
      if ( blockAngle === -1 || blockAngle > blockAngleA ) continue;
      blockingWallA = linkedWall;
      blockAngleA = blockAngle;
    }

    let blockingWallB;
    let blockAngleB = 360;
    for ( const linkedWall of linkedB ) {
      const blockAngle = this.endpointBlocks(wall, linkedWall, "B");
      if ( blockAngle === -1 || blockAngle > blockAngleB ) continue;
      blockingWallB = linkedWall;
      blockAngleB = blockAngle;
    }

    // For a given wall, its "w" coordinate is:
    // -2: The two walls are concave w/r/t the light, meaning light is completely blocked.
    // -1: No blocking
    // 0+: wall.key representing location of the opposite endpoint of the linked wall.
    const blockWallAKey = blockAngleA === 360 ? -1
      : blockAngleA <= 180 ? -2
        : blockingWallA.A.key === wall.A.key ? blockingWallA.B.key
          : blockingWallA.A.key;

    const blockWallBKey = blockAngleB === 360 ? -1
      : blockAngleB <= 180 ? -2
        : blockingWallB.A.key === wall.A.key ? blockingWallB.B.key
          : blockingWallB.A.key;

    return {
      corner0: [A.x, A.y, top, blockWallAKey],
      corner1: [B.x, B.y, bottom, blockWallBKey]
    };
  }

  /**
   * Determine if a wall endpoint should be considered "blocking", meaning it blocks all light
   * because it is connected to 2+ walls.
   * Considers whether the wall is blocking for the light source, whether it is limited,
   * and whether it is at an angle that requires blocking.
   * Required to avoid light leakage due to penumbra in the shader.
   * @param {Wall} wall                 Wall whose endpoint is shared with the linked wall
   * @param {Wall} linkedWall           Linked wall to test for this endpoint
   * @param {"A"|"B"} endpointName      Which endpoint to test
   * @returns {boolean} Should this endpoint be considered blocking with respect to the source?
   */
  endpointBlocks(wall, linkedWall, endpointName) {
    if ( !(this._triWallMap.has(linkedWall.id) || this._includeWall(linkedWall)) ) return -1; // Quicker to check the map first.

    const sharedPt = wall[endpointName];
    if ( this.isLimited(linkedWall) ) {
      let topZ = linkedWall.topZ;
      if ( !isFinite(topZ) ) topZ = 1e06;
      const dest = new Point3d(sharedPt.x, sharedPt.y, topZ);
      if ( !this._wallBetween(dest, [wall, linkedWall]) ) return -1;
    }

    // Return the angle between the wall and the linked wall.
    // Clockwise angle from wall other endpoint --> shared --> linked wall other endpoint
    const otherWallPt = wall[endpointName === "A" ? "B" : "A"];
    const otherLinkedPt = linkedWall.A.key === sharedPt.key ? linkedWall.B : linkedWall.A;
    const sourceOrigin = this.sourceOrigin;
    return pointVTest(otherWallPt, sharedPt, otherLinkedPt, sourceOrigin);
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

geom.endpointBlocks(wall, linkedWall, "B")
geom.endpointBlocks(linkedWall, wall, "A")
geom.wallCornerCoordinates(wall)
geom.wallCornerCoordinates(linkedWall)


  */

  /**
   * Test if one or more walls are between the source origin and a destination point.
   * @param {Point3d} dest
   * @param {Wall[]} wallsToExclude   One or more walls to exclude
   * @param {boolean} True if a wall is between source and destination
   */
  _wallBetween(dest, wallsToExclude = []) {
    const origin = this.source instanceof DirectionalLightSource
      ? dest.add(this.source.lightDirection.multiplyScalar(canvas.dimensions.maxR))
      : Point3d.fromPointSource(this.source);
    const xMinMax = Math.minMax(origin.x, dest.x);
    const yMinMax = Math.minMax(origin.y, dest.y);
    const bounds = new PIXI.Rectangle(xMinMax.min, yMinMax.min, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
    const collisionTest = (o, _rect) => this._includeWall(o.t);
    let walls = canvas.walls.quadtree.getObjects(bounds, { collisionTest });
    if ( wallsToExclude.length ) walls = walls.filter(w => !wallsToExclude.some(ex => w === ex));
    return testWallsForIntersections(origin, dest, walls, "any", this.sourceType);
  }

  // ----- Wall updates ----- //
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
   * For the given added wall, determine if it changes the link status of connected walls.
   * If so, update those linked walls.
   * @param {Wall} wall               Wall to update
   * @param {boolean} [update=true]   If false, buffer will not be flagged for update
   * @returns {boolean}  Did the geometry need to be updated?
   */
  _checkAddedWallLinks(addedWall, update = true) {
    const { linkedA, linkedB } = getLinkedWalls(addedWall);
    let linkUpdated = false;
    for ( const linkedWall of linkedA.union(linkedB) ) {
      const res = this._updateWallLinkBuffer(linkedWall, update);
      linkUpdated ||= res;
    }
    return linkUpdated;
  }

  /**
   * For the given updated wall, determine if it changes the link status of connected walls.
   * @param {Wall} wall               Wall to update
   * @param {boolean} [update=true]   If false, buffer will not be flagged for update
   * @returns {boolean} Did the geometry need to be updated based on the wall update?
   */
  _checkUpdatedWallLinks(updatedWall, update = true) {
    // We cannot know what the wall links were previous to the update unless we store all that data.
    // Instead, cycle through each checking for changes.
    let linkUpdated = false;
    for ( const wall of canvas.walls.placeables ) {
      if ( wall === updatedWall ) continue;
      const res = this._updateWallLinkBuffer(wall, update);
      linkUpdated ||= res;
    }
    return linkUpdated;
  }

  /**
   * For the given deleted wall, determine if it changes the link status of connected walls.
   * If so, update those linked walls
   * Because the wall is deleted, `getLinkedWalls` will no longer return the linked value.
   * Process all walls to determine if their link status has changed.
   * @param {Wall} wall               Wall to update
   * @param {boolean} [update=true]   If false, buffer will not be flagged for update
   * @returns {boolean}  Did the geometry need to be updated?
   */
  _checkRemovedWallLinks(removedWallId, update = true) {
    // We cannot know what the wall links were previous to the update unless we store all that data.
    // Instead, cycle through each checking for changes.
    let linkUpdated = false;
    for ( const wall of canvas.walls.placeables ) {
      if ( wall.id === removedWallId ) continue;
      const res = this._updateWallLinkBuffer(wall, update);
      linkUpdated ||= res;
    }
    return linkUpdated;
  }

  /**
   * Update link buffers as necessary for a given wall.
   * Because this updates the coordinates, use this or _updateWallPosition, not both.
   * @param {Wall} wall               Wall to update
   * @param {number} idxToUpdate      Index of the coordinate in the buffer
   * @param {boolean} [update=true]   If false, buffer will not be flagged for update
   * @returns {boolean} Did the geometry need to be updated based on the wall update?
   */
  _updateWallLinkBuffer(wall, update = true) {
    if ( !this._triWallMap.has(wall.id) ) return false;
    const idxToUpdate = this._triWallMap.get(wall.id);

    const { corner0, corner1 } = this.wallCornerCoordinates(wall);
    let changedLink = this.getAttributeAtIndex("aWallCorner0", idxToUpdate)[3] !== corner0[3];
    changedLink ||= this.getAttributeAtIndex("aWallCorner1", idxToUpdate)[3] !== corner1[3];
    if ( changedLink ) {
      this._updateBuffer(corner0, "aWallCorner0", idxToUpdate, update);
      this._updateBuffer(corner1, "aWallCorner1", idxToUpdate, update);
    }
    return changedLink;
  }

  /**
   * Add a wall to this geometry.
   * @param {Wall} wall   Wall to add
   * @param {boolean} [update=true]  If false, buffer will not be flagged for update
   * @returns {boolean} Did the geometry need to be updated based on the wall addition?
   */
  addWall(wall, { update = true } = {}) {
    // Theoretically, could have a link update even for a wall we are not including.
    const linkUpdated = this._checkAddedWallLinks(wall, update);
    if ( this._triWallMap.has(wall.id) ) return linkUpdated;
    if ( !this._includeWall(wall) ) return linkUpdated;

    const idxToAdd = this._triWallMap.size;

    // Wall endpoints
    const { corner0, corner1 } = this.wallCornerCoordinates(wall);
    this._addToBuffer(corner0, "aWallCorner0", update);
    this._addToBuffer(corner1, "aWallCorner1", update);

    // Wall sense type
    this._addToBuffer([this.senseType(wall)], "aWallSenseType", update);

    // Threshold value
    this._addToBuffer([this.threshold2Attribute(wall)], "aThresholdRadius2", update);

    // Index
    const idx = idxToAdd * 3;
    const dataIdx = [idx, idx + 1, idx + 2];
    this.indexBuffer.data = this.constructor.addToBuffer(this.indexBuffer.data, dataIdx);
    if ( update ) this.indexBuffer.update(this.indexBuffer.data);

    // Add the wall id as the next triangle object to the tracker.
    this._triWallMap.set(wall.id, idxToAdd);

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
   * Update a wall in this geometry.
   * May result in a wall being added or removed.
   * @param {Wall} wall   Wall to update
   * @param {object} [opts]               Options that affect how the wall update is treated.
   * @param {boolean} [opts.update]       If false, buffer will not be flagged for update.
   * @returns {boolean} Did the geometry need to be updated based on the wall update?
   */
  updateWall(wall, { update = true } = {}) {
    if ( !this._triWallMap.has(wall.id) ) return this.addWall(wall, { update });
    if ( !this._includeWall(wall) ) return this.removeWall(wall.id, { update });

    // Check for updates to wall link status for walls linked to this one.
    const updatedLinkedWalls = this._checkUpdatedWallLinks(wall, update);

    // Note: includeWall will handle changes to the threshold.attenuation.
    // Check for changes to the given coordinate set and update the buffers.
    // Don't need to update the index
    const idxToUpdate = this._triWallMap.get(wall.id);
    const changedPosition = this._updateWallPosition(wall, idxToUpdate, update);
    const changedSenseType = this._updateWallSenseType(wall, idxToUpdate, update);
    const changedThreshold = this._updateWallThreshold(wall, idxToUpdate, update);
    return updatedLinkedWalls || changedPosition || changedSenseType || changedThreshold;
  }

  /**
   * Check for change in wall endpoints or link status and update buffer accordingly.
   * @param {Wall} wall               Wall to update
   * @param {number} idxToUpdate      Index of the coordinate in the buffer
   * @param {boolean} [update=true]   If false, buffer will not be flagged for update
   * @returns {boolean} Did the geometry need to be updated based on the wall update?
   */
  _updateWallPosition(wall, idxToUpdate, update = true) {
    const { corner0, corner1 } = this.wallCornerCoordinates(wall);
    let changedPosition = this.getAttributeAtIndex("aWallCorner0", idxToUpdate).some((x, i) => x !== corner0[i]);
    changedPosition ||= this.getAttributeAtIndex("aWallCorner1", idxToUpdate).some((x, i) => x !== corner1[i]);
    if ( changedPosition ) {
      this._updateBuffer(corner0, "aWallCorner0", idxToUpdate, update);
      this._updateBuffer(corner1, "aWallCorner1", idxToUpdate, update);
    }
    return changedPosition;
  }

  /**
   * Check for change in the sense type for the wall and update buffer accordingly.
   * @param {Wall} wall               Wall to update
   * @param {number} idxToUpdate      Index of the coordinate in the buffer
   * @param {boolean} [update=true]   If false, buffer will not be flagged for update
   * @returns {boolean} Did the geometry need to be updated based on the wall update?
   */
  _updateWallSenseType(wall, idxToUpdate, update = true) {
    const senseType = this.senseType(wall);
    const changedSenseType = this.getAttributeAtIndex("aWallSenseType")[0] !== senseType;
    if ( changedSenseType ) this._updateBuffer([senseType], "aWallSenseType", idxToUpdate, update);
    return changedSenseType;
  }

  /**
   * Check for change in the relevant threshold attribute and update buffer accordingly.
   * @param {Wall} wall   Wall to update
   * @param {boolean} [update=true]       If false, buffer will not be flagged for update.
   * @returns {boolean} Did the geometry need to be updated based on the wall update?
   */
  _updateWallThreshold(wall, idxToUpdate, update = true) {
    const threshold = this.threshold2Attribute(wall);
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
   * Remove a wall from this geometry.
   * @param {string} id   Wall id (b/c that is what the remove hook uses)
   * @param {boolean} [update=true]   If false, buffer will not be flagged for update.
   * @returns {boolean} Did the geometry need to be updated based on the wall removal?
   */
  removeWall(id, { update = true } = {}) {
    if ( id instanceof Wall ) id = id.id;

    // Theoretically, could have a link update even for a wall we are not including.
    if ( !this._triWallMap.has(id) ) return this._checkRemovedWallLinks(id, update);

    const idxToRemove = this._triWallMap.get(id);
    for ( const attr of Object.keys(this.attributes) ) {
      const size = this.getAttribute(attr).size * 3;
      const buffer = this.getBuffer(attr);
      buffer.data = this.constructor.removeFromBuffer(buffer.data, size, idxToRemove);
    }
    const size = 3;
    this.indexBuffer.data = this.constructor.removeFromBuffer(this.indexBuffer.data, size, idxToRemove);

    // Remove the wall from the tracker and decrement other wall indices accordingly.
    this._triWallMap.delete(id);
    const fn = (value, key, map) => { if ( value > idxToRemove ) map.set(key, value - 1); };
    this._triWallMap.forEach(fn);

    // Currently, the index buffer is consecutive.
    this.indexBuffer.data = this.indexBuffer.data.map((value, index) => index);

    // Remove wall links at the end, so the removed wall is reflected properly.
    this._checkRemovedWallLinks(id, update);

    // Flag the updated buffers for uploading to the GPU.
    if ( update ) this.update();

    return true;
  }

  /**
   * Check all the walls in the scene b/c of some change to an array of walls
   * @param {Wall[]} [walls]    Optional array of walls to consider.
   * @returns {boolean} True if any changes to the geometry buffers resulted from the refresh.
   */
  refreshWalls(walls) {
    walls ??= canvas.walls.placeables;
    const opts = { update: false }; // Avoid repeatedly updating the buffers.
    let changed = false;
    walls.forEach(w => {
      const wallBufferChanged = this.updateWall(w, opts);
      changed ||= wallBufferChanged;
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
    const wallsChecked = new Set();
    for ( const [id, idxToUpdate] of this._triWallMap ) {
      const wall = canvas.walls.documentCollection.get(id).object;
      wallsChecked.add(wall);
      if ( !this._includeWall(wall) ) {
        const wasUpdated = this.removeWall(wall.id, { update: false });
        updated ||= wasUpdated;
      } else {
        const resLink = this._updateWallLinkBuffer(wall, false);
        const resThreshold = this._updateWallThreshold(wall, idxToUpdate, false);
        updated ||= (resLink || resThreshold);
      }
    }

    const wallsToAdd = this.source._getWalls().difference(wallsChecked);
    wallsToAdd.forEach(w => {
      const wasUpdated = this.addWall(w, { update: false });
      updated ||= wasUpdated;
    });

    if ( updated ) this.update();
    return updated;
  }
}


export class PointSourceShadowWallGeometry extends SourceShadowWallGeometry {

  _includeWall(wall) {
    if ( !super._includeWall(wall) ) return false;

    // Wall must be within the light radius.
    if ( !this.source.bounds.lineSegmentIntersects(wall.A, wall.B, { inside: true }) ) return false;

    return true;
  }
}


export class DirectionalSourceShadowWallGeometry extends SourceShadowWallGeometry {

  /** @type {Point3d} */
  get sourceOrigin() {
    const { rect, maxR } = canvas.dimensions;
    const center = rect.center;
    const centerPt = new Point3d(center.x, center.y, canvas.elevation.elevationMin);
    return centerPt.add(this.source.lightDirection.multiplyScalar(maxR));
  }

  /**
   * Orientation of a wall to the source.
   * @param {Wall} wall
   * @returns {number}  See foundry.utils.orient2dFast.
   */
  sourceWallOrientation(wall) {
    // Wall must not be the same (2d) direction as the source
    // TODO: Do we need to add a scalar to the normalized source direction?
    const A = PIXI.Point.fromObject(wall.A);
    return !foundry.utils.orient2dFast(A, wall.B, A.add(this.source.lightDirection)).almostEqual(0, 1);
  }

  /**
   * Threshold walls cannot be triggered by directional sources.
   * @param {Wall} wall
   * @returns {boolean} True if the threshold applies.
   */
  thresholdApplies(_wall) { return false; }
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
    const pt = foundry.utils.closestPointToSegment(origin, wall.A, wall.B);
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
    const pt = foundry.utils.closestPointToSegment(origin, wall.A, wall.B);
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
