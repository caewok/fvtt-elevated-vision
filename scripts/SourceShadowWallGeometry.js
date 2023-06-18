/* globals
canvas,
CONST,
PIXI

*/
"use strict";


export class SourceShadowWallGeometry extends PIXI.Geometry {

  /**
   * Number of pixels to extend walls, to ensure overlapping shadows for connected walls.
   * @type {number}
   */
  static WALL_OFFSET_PIXELS = 2;

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
    const dat = this.getBuffer("aLimitedWall").data;
    return dat.some(x => x);
  }

  constructWallGeometry(walls) {
    this._triWallMap.clear();

    // Default is to draw light --> wallCorner1 --> wallCorner2.
    // Assumed that light is passed as uniform.
    // Attributes used to pass needed wall data to each vertex.
    const indices = [];
    const aWallCorner1 = [];
    const aWallCorner2 = [];
    const aLimitedWall = [];

    let triNumber = 0;
    const nWalls = walls.length;
    for ( let i = 0; i < nWalls; i += 1 ) {
      const wall = walls[i];
      if ( !this._includeWall(wall) ) return;
      const wallCoords = this._wallCornerCoordinates(wall);
      aWallCorner1.push(wallCoords.corner1.x, wallCoords.corner1.y, wallCoords.topZ);
      aWallCorner2.push(wallCoords.corner2.x, wallCoords.corner2.y, wallCoords.bottomZ);

      const ltd = this.isLimited(wall);
      this.#hasLimitedWalls ||= ltd;
      aLimitedWall.push(this.isLimited(wall));
      indices.push(triNumber, triNumber, triNumber);

      // Track where this wall is in the attribute arrays for future updates.
      this._triWallMap.set(wall.id, triNumber);
      triNumber += 1;
    }

    // TODO: Should this or a subclass set interleave to true?
    this.addIndex(indices);
    this.addAttribute("aWallCorner1", aWallCorner1, 3);
    this.addAttribute("aWallCorner2", aWallCorner2, 3);
    this.addAttribute("aLimitedWall", aLimitedWall, 1); // TODO: Make this something other than PIXI.TYPES.FLOAT
  }

  /**
   * Is the wall limited with respect to this light source?
   * @param {Wall} wall
   * @returns {boolean}
   */
  isLimited(wall) {
    return wall.document[this.type] === CONST.WALL_SENSE_TYPES.LIMITED;
  }

  /**
   * Should this wall be included in the geometry for this source shadow?
   * @param {Wall} wall
   * @returns {boolean}   True if wall should be included
   */
  _includeWall(wall) {
    const topZ = Math.min(wall.topZ, this.source.elevationZ - 1);
    const bottomZ = Math.max(wall.bottomZ, canvas.elevation.minElevation);
    if ( topZ <= bottomZ ) return false; // Wall is above or below the viewing box.
    return true;
  }

  /**
   * Retrieve wall endpoint data for a corner.
   * A is top, B is bottom
   * @param {Wall} wall
   * @returns { corner1: {PIXI.Point}, corner2: {PIXI.Point}, topZ: {number}, bottomZ: {number} }
   */
  _wallCornerCoordinates(wall) {
    const A = new PIXI.Point(wall.A.x, wall.A.y);
    const B = new PIXI.Point(wall.B.x, wall.B.y);
    const ABDist = PIXI.Point.distanceBetween(A, B);

    // Slightly extend wall to ensure connected walls do not have gaps in shadows.
    const adjA = B.towardsPoint(A, ABDist + this.constructor.WALL_OFFSET_PIXELS);
    const adjB = A.towardsPoint(B, ABDist + this.constructor.WALL_OFFSET_PIXELS);
    const topZ = Math.min(wall.topZ + this.constructor.WALL_OFFSET_PIXELS, Number.MAX_SAFE_INTEGER);
    const bottomZ = Math.max(wall.bottomZ - this.constructor.WALL_OFFSET_PIXELS, Number.MIN_SAFE_INTEGER);

    const out = {
      corner1: adjA,
      corner2: adjB,
      topZ,
      bottomZ
    };

    // Round b/c points may be adjusted.
    out.corner1.roundDecimals();
    out.corner2.roundDecimals();

    return out;
  }

  // ----- Wall updates ----- //
  /**
   * Add single element of a given size to a buffer and return a new buffer.
   * @param {TypedArray} buffer   Typed array to copy and modify
   * @param {number} size         Number of units an object takes in the buffer
   * @param {number[]} data         New data to add
   * @returns {TypedArray} New typed array with one additional element at end
   */
  static addToBuffer(buffer, size, data) {
    const newBufferData = new buffer.constructor(buffer.length + size);
    newBufferData.set(buffer, 0);
    newBufferData.set(data, buffer.length);
    return newBufferData;
  }

  /**
   * Add single element of a given size to a buffer and return a new buffer.
   * @param {TypedArray} buffer   Typed array to copy and modify
   * @param {number} size         Number of units an object takes in the buffer
   * @param {number[]} data         New data to add
   * @returns {TypedArray} New typed array with one additional element at end
   */
  static overwriteBufferAt(buffer, size, data, idxToOverwrite) {
    buffer.set(data, size * idxToOverwrite);
    return buffer;
  }

  /**
   * Remove single element of a given size from a buffer and return a new buffer of the remainder.
   * @param {TypedArray} buffer   Typed array to copy and modify
   * @param {number} size         Number of units an object takes in the buffer
   * @param {number} idxToRemove  Element index to remove. Will be adjusted by size
   * @returns {TypedArray} New typed array with one less element
   */
  static removeFromBuffer(buffer, size, idxToRemove) {
    const newLn = Math.max(buffer.length - size, 0);
    const newBufferData = new buffer.constructor(newLn);
    if ( !newLn ) return newBufferData;

    newBufferData.set(buffer.slice(0, idxToRemove * size), 0);
    newBufferData.set(buffer.slice((idxToRemove * size) + size), idxToRemove * size);
    return newBufferData;
  }

  /**
   * Add a wall to this geometry.
   * @param {Wall} wall   Wall to add
   * @param {boolean} [update=true]  If false, buffer will not be flagged for update
   */
  addWall(wall, update = true) {
    if ( this._triWallMap.has(wall.id) ) return;
    if ( !this._includeWall(wall) ) return;

    const wallCoords = this._wallCornerCoordinates(wall);
    const idxToAdd = this._triWallMap.size;

    // First wall corner
    const data1 = [wallCoords.corner1.x, wallCoords.corner1.y, wallCoords.topZ];
    const size1 = this.getAttribute("aWallCorner1").size;
    const buffer1 = this.getBuffer("aWallCorner1");
    buffer1.data = this.constructor.addToBuffer(buffer1.data, size1, data1);

    // Second wall corner
    const data2 = [wallCoords.corner2.x, wallCoords.corner2.y, wallCoords.bottomZ];
    const size2 = this.getAttribute("aWallCorner2").size;
    const buffer2 = this.getBuffer("aWallCorner2");
    buffer2.data = this.constructor.addToBuffer(buffer2.data, size2, data2);

    // Limited wall indicator
    const data3 = [this.isLimited(wall)];
    const size3 = this.getAttribute("aLimitedWall").size;
    const buffer3 = this.getBuffer("aLimitedWall");
    buffer3.data = this.constructor.addToBuffer(buffer3.data, size3, data3);

    // Index
    const dataIdx = [idxToAdd, idxToAdd, idxToAdd];
    const sizeIdx = 3;
    this.indexBuffer.data = this.constructor.addToBuffer(this.indexBuffer.data, sizeIdx, dataIdx);

    // Add the wall id as the next triangle object to the tracker.
    this._triWallMap.set(wall.id, idxToAdd);

    // Flag the updated buffers for uploading to the GPU.
    if ( update ) this.update();
  }

  updateWall(wall, { update = true, changes = new Set(["A", "B", "isLimited"]) } = {}) {
    if ( !this._triWallMap.has(wall.id) ) return this.addWall(wall, update);
    if ( !this._includeWall(wall) ) return this.removeWall(wall.id, update);

    const idxToUpdate = this._triWallMap.get(wall.id);
    let wallCoords;
    if ( changes.has("A") || changes.has("B") ) wallCoords = this._wallCornerCoordinates(wall);

    // First wall corner
    if ( changes.has("A") ) {
      const data1 = [wallCoords.corner1.x, wallCoords.corner1.y, wallCoords.topZ];
      const size1 = this.getAttribute("aWallCorner1").size;
      const buffer1 = this.getBuffer("aWallCorner1");
      buffer1.data = this.constructor.overwriteBufferAt(buffer1.data, size1, data1, idxToUpdate);
      if ( update ) buffer1.update(buffer1.data);
    }

    // Second wall corner
    if ( changes.has("B") ) {
      const data2 = [wallCoords.corner2.x, wallCoords.corner2.y, wallCoords.bottomZ];
      const size2 = this.getAttribute("aWallCorner2").size;
      const buffer2 = this.getBuffer("aWallCorner2");
      buffer2.data = this.constructor.overwriteBufferAt(buffer2.data, size2, data2, idxToUpdate);
      if ( update ) buffer2.update(buffer2.data);
    }

    // Limited wall indicator
    if ( changes.has("isLimited") ) {
      const data3 = [this.isLimited(wall)];
      const size3 = this.getAttribute("aLimitedWall").size;
      const buffer3 = this.getBuffer("aLimitedWall");
      buffer3.data = this.constructor.overwriteBufferAt(buffer3.data, size3, data3, idxToUpdate);
      if ( update ) buffer3.update(buffer3.data);
    }

    // Don't need to update the index
  }

  /**
   * Remove a wall from this geometry.
   * @param {string} id   Wall id (b/c that is what the remove hook uses)
   */
  removeWall(id, update = true) {
    if ( id instanceof Wall ) id = id.id;
    if ( !this._triWallMap.has(id) ) return;

    const idxToRemove = this._triWallMap.get(id);
    for ( const attr of ["aWallCorner1", "aWallCorner2", "aLimitedWall"] ) {
      const size = this.getAttribute(attr).size;
      const buffer = this.getBuffer(attr);
      buffer.data = this.constructor.removeFromBuffer(buffer.data, size, idxToRemove);
    }
    const sizeIdx = 3;
    this.indexBuffer.data = this.constructor.removeFromBuffer(this.indexBuffer.data, sizeIdx, idxToRemove);

    // Remove the wall from the tracker and decrement other wall indices accordingly.
    this._triWallMap.delete(id);
    const fn = value => { if ( value > idxToRemove ) value -= 1; }
    this._triWallMap.forEach(fn);
    this.indexBuffer.data = this.indexBuffer.data.map(fn);

    // Flag the updated buffers for uploading to the GPU.
    if ( update ) this.update();
  }

  update() {
    // Flag each buffer for updating.
    // Assumes that addWall, updateWall, or removeWall updated the local buffer previously.
    for ( const attr of ["aWallCorner1", "aWallCorner2", "aLimitedWall"] ) {
      const buffer = this.getBuffer(attr);
      buffer.update(buffer.data);
    }
    this.indexBuffer.update(this.indexBuffer.data);
  }
}


class PointSourceWallGeometry extends SourceWallGeometry {


  _includeWall(wall) {
    if ( !super._includeWall(wall) ) return false;

    // Wall cannot be collinear to the light.
    const orientWall = foundry.utils.orient2dFast(wall.A, wall.B, this.source);
    if ( orientWall.almostEqual(0) ) return false;

    // Wall must be within the light radius.
    if ( this.source.bounds.lineSegmentIntersects(wall.A, wall.B, { inside: true }) ) return false;

    return true;
  }

}

class SizedSourceWallGeometry extends PointSourceWallGeometry {
  // Light has defined size.

}

class DirectionalSourceWallGeometry extends SourceWallGeometry {

  /**
   * Direction of the light is from center of the canvas toward the light position and elevation.
   * @type {Point3d}
   */
  get sourceDirection() {
    const center = canvas.dimensions.sceneRect.center;
    const srcPosition = new Point3d(this.source.x, this.source.y, this.source.elevationZ);
    return srcPosition.subtract(center).normalize()
  }


  _includeWall(wall) {
    // Wall must not be the same (2d) direction as the source
    const A = new PIXI.Point(wall.A.x, wall.A.y);
    const orientWall = foundry.utils.orient2dFast(wall.A, wall.B, A.add(this.sourceDirection));
    if ( orientWall.almostEqual(0) ) return false;

    return true;
  }
}