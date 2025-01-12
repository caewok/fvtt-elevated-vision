/* globals
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";


/**
 * Stores a Geometry and facilitates breaking up the geometry into distinct
 * sub-geometries. Uses views (typed arrays) linked to distinct Geometry instances,
 * which can be modified in place.
 * Facilitates adding and removing sub-geometries.
 */
export class CombinedGeometry extends PIXI.Geometry {

  /** @type {SubGeometry|PIXI.Geometry} */
  subclass = SubGeometry;

  /** @type {number} */
  subclassSize = 3;

  /** @type {SubGeometry|PIXI.Geometry[]} */
  subgeometries = [];

  /**
   * Add single element (chunk) of data to a buffer and return a new buffer.
   * @param {TypedArray} buffer   Typed array to copy and modify
   * @param {number[]} data       New data chunk to add
   * @returns {TypedArray} New typed array with one additional element at end
   */
  static addToBuffer(buffer, data) {
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
    const newLn = Math.max(buffer.length - size, 0);
    const newBufferData = new buffer.constructor(newLn);
    if ( !newLn ) return newBufferData;

    newBufferData.set(buffer.slice(0, idxToRemove * size), 0);
    newBufferData.set(buffer.slice((idxToRemove * size) + size), idxToRemove * size);
    return newBufferData;
  }


  /**
   * Add an attribute to the combined geometry.
   * This modifies each sub-geometry accordingly.
   * Sub-geometries will be created as needed based on subclassSize.
   * If the buffer does not include sufficient data for all subgeometries, it will be
   * supplemented with 0 values.
   * @param {string} id
   * @param {Array|TypedArray} buffer   The buffer data, which is copied to new UInt16.
   */
  addAttribute(id, buffer, size, ...args) {
    const subclassSize = this.subclassSize;
    const numSubs = buffer.length / subclassSize / size;
    if ( numSubs !== Math.floor(numSubs) ) throw new Error(`${MODULE_ID}|Incorrect buffer length to add attribute.`);
    super.addAttribute(id, buffer, size, ...args);

    // Add to existing sub-geometries.
    const numSubGeoms = this.subgeometries.length;
    const attrData = this.getBuffer(id).data;
    for ( let i = 0; i < numSubGeoms; i += 1 ) {
      const attribute = this.attributes[id];
      const newData = new attrData.constructor(
        attrData.buffer,
        attrData.BYTES_PER_ELEMENT * subclassSize * i,
        subclassSize);
      this.subgeometries[i].addAttribute(id, newData, attribute.size, attribute.normalized, attribute.type);
    }

    // Add new sub-geometries.
    if ( numSubs > numSubGeoms ) return this._addSubGeometries(numSubs - numSubGeoms);
    return [];
  }

  /**
   * Add an index to the combined geometry.
   * This modifies each sub-geometry accordingly.
   * Sub-geometries will be created as needed based on subclassSize.
   */
  addIndex(buffer, ...args) {
    const subclassSize = this.subclassSize;
    const numSubs = buffer.length / subclassSize;
    if ( numSubs !== Math.floor(numSubs) ) throw new Error(`${MODULE_ID}|Incorrect buffer length to add index.`);
    super.addIndex(buffer, ...args);

    // Add to existing sub-geometries.
    const numSubGeoms = this.subgeometries.length;
    const indexData = this.indexBuffer.data;
    for ( let i = 0; i < numSubGeoms; i += 1 ) {
      const newIndex = new indexData.constructor(
        indexData.buffer,
        indexData.BYTES_PER_ELEMENT * subclassSize * i,
        subclassSize);
      this.subgeometries[i].addIndex(newIndex);
    }

    // Add new sub-geometries.
    if ( numSubs > numSubGeoms ) return this._addSubGeometries(numSubs - numSubGeoms);
    return [];
  }

  /**
   * Add one or more blank subgeometries.
   * @param {number} numSubs      Number of geometries to add
   * @returns {SubGeometry[]}
   */
  _addSubGeometries(subsToAdd = 0) {
    const newGeoms = [];
    for ( let i = 0; i < subsToAdd; i += 1 ) newGeoms.push(this.addSubGeometry());
    return newGeoms;
  }

  /**
   * Construct a new sub-geometry.
   * The attributes will be linked to the combined geometry buffers.
   */
  addSubGeometry(attributeData = {}) {
    const subclassSize = this.subclassSize;
    if ( this.indexBuffer ) {
      // Guess that the new indices will be same as previous, just incrementing.
      attributeData.index ??= this.indexBuffer.data.slice(-subclassSize).map(elem => elem + subclassSize);

      // Increase the size of the buffer to hold the new data.
      this.indexBuffer.data = this.constructor.addToBuffer(this.indexBuffer.data, attributeData.index);

      // Replace each of the underlying buffers.
      this.#replaceIndexBuffer();
    }

    for ( const id of Object.keys(this.attributes) ) {
      const attributeBuffer = this.getBuffer(id);
      attributeData.id ??= new attributeBuffer.data.constructor(subclassSize); // All zeros.

      // Increase the size of the buffer to hold the new data.
      attributeBuffer.data = this.constructor.addToBuffer(attributeBuffer.data, attributeData.id);

      // Replace each of the underlying buffers.
      this.#replaceAttributeBuffer(id);
    }

    return this.#addSubGeometryWithoutResize();

    /*
    TODO: Use resizable buffers with chunks, e.g. 10 elements max?
    indexB = new Uint16Array([0,1,2,3,4,5])
    index0 = new Uint16Array(indexB.buffer, 0, 3)
    index1 = new Uint16Array(indexB.buffer, indexB.BYTES_PER_ELEMENT * 3, 3)

    geom = new PIXI.Geometry()
    geom0 = new PIXI.Geometry()
    geom1 = new PIXI.Geometry()

    geom.addIndex(indexB)
    geom0.addIndex(index0)
    geom1.addIndex(index1)
    */


    /*
    indexBuffer = new ArrayBuffer(Uint16Array.BYTES_PER_ELEMENT*3, { maxByteLength: Uint16Array.BYTES_PER_ELEMENT*3*3})
    index0 = new Uint16Array(indexBuffer, 0, 3)
    indexBuffer.resize(indexBuffer.byteLength + Uint16Array.BYTES_PER_ELEMENT*3)
    index1 = new Uint16Array(indexBuffer, Uint16Array.BYTES_PER_ELEMENT*3, 3)
    geom = new PIXI.Geometry()
    geom.addIndex(indexBuffer)
    */

  }

  /**
   * Construct a new sub-geometry. Assumes attributes and index are sufficiently long
   * to add the geometry.
   */
  #addSubGeometryWithoutResize() {
    const subclassSize = this.subclassSize;
    const geom = new this.subclass();
    if ( this.indexBuffer ) {
      // Add new index to the new sub-geometry.
      const newIndex = new this.indexBuffer.data.constructor(
        this.indexBuffer.data.buffer,
        this.indexBuffer.data.BYTES_PER_ELEMENT * subclassSize,
        subclassSize);
      geom.addIndex(newIndex);
    }
    for ( const [id, attribute] of Object.entries(this.attributes) ) {
      // Add a new attribute to the new sub-geometry.
      const attributeBuffer = this.getBuffer(id);
      const newData = new attributeBuffer.data.constructor(
        attributeBuffer.data.buffer,
        attributeBuffer.data.BYTES_PER_ELEMENT * subclassSize,
        subclassSize);
      geom.addAttribute(id, newData, attribute.size, attribute.normalized, attribute.type);
    }
    this.subgeometries.push(geom);
    return geom;
  }

  /**
   * Remove a specific sub-geometry.
   * Combined geometry buffers will be shrunk and sub-geometries may be re-ordered.
   * TODO: Can the geometry buffers contain empty entries? Can the index be modified
   * without modifying the attribute buffers? Maybe modify attribute buffers every X
   * removals? Or track empties and use them with `addSubGeometry`?
   * @param {number} [idxToRemove]    Which subgeometry to remove? If not provided, will be the last
   * @returns {SubGeometry|null} The removed geometry, which may need to be destroyed.
   */
  removeSubGeometry(idxToRemove = this.subgeometries.length - 1) {
    if ( idxToRemove < this.subgeometries.length ) return null;
    const subclassSize = this.subclassSize;
    if ( this.indexBuffer ) {
      // Decrease the size of the buffer.
      this.indexBuffer.data = this.constructor.removeFromBuffer(this.indexBuffer.data, subclassSize, idxToRemove);

      // Replace each of the underlying buffers.
      this.#replaceIndexBuffer();

      // Renumber the buffers
      const ln = this.subgeometries.length;
      for ( let i = idxToRemove; i < ln; i += 1 ) {
        const bufferData = this.subgeometries[i].indexBuffer.data;
        bufferData.byteOffset -= bufferData.byteLength;
      }
    }

    for ( const [id, attribute] of Object.entries(this.attributes) ) {
      const attributeBuffer = this.getBuffer(id);

      // Decrease the size of the buffer.
      const size = subclassSize * attribute.size;
      attributeBuffer.data = this.constructor.removeFromBuffer(attributeBuffer.data, size, idxToRemove);

      // Replace each of the underlying buffers.
      this.#replaceAttributeBuffer(id);

      // Renumber the buffers
      const ln = this.subgeometries.length;
      for ( let i = idxToRemove; i < ln; i += 1 ) {
        const bufferData = this.subgeometries[i].getBuffer(id).data;
        bufferData.byteOffset -= bufferData.byteLength;
      }
    }
    return this.subgeometries.splice(idxToRemove, 1)[0];
  }

  /**
   * Replace the index buffer of each sub-geometry with the current buffer from the combined.
   */
  #replaceIndexBuffer() {
    // This fails: sg.indexBuffer.data.buffer = this.indexBuffer.data.buffer
    const newD = this.indexBuffer.data;
    this.subgeometries.forEach(sg => {
      const d = sg.indexBuffer.data;
      sg.indexBuffer.data = new newD.constructor(newD.buffer, d.byteOffset, d.length);
    });
  }


  /**
   * Replace the attribute buffer of each sub-geometry with the current buffer from the combined.
   * @param {string} id     Which attribute to replace
   */
  #replaceAttributeBuffer(id) {
    // This fails: sg.getBuffer(id).data.buffer = this.getBuffer(id).data.buffer
    const newD = this.getBuffer(id).data;
    this.subgeometries.forEach(sg => {
      const attrBuffer = sg.getBuffer(id);
      const d = attrBuffer.data;
      attrBuffer.data = new newD.constructor(newD.buffer, d.byteOffset, d.length);
    });
  }

  /**
   * Destroy all subgeometries.
   */
  destroy() {
    this.subgeometries.forEach(sg => sg.destroy());
    this.subgeometries.length = 0;
    super.destroy();
  }
}

/**
 * Used in conjunction with CombinedGeometry.
 * Lighter than PIXI.Geometry; simply stores attributes and index in similar way to Geometry.
 */
export class SubGeometry {
  /** @type {object} */
  attributes = {};

  /** @type {object{ data: TypedArray }[]} */
  buffers = [];

  /** @type {object{ data: TypedArray }} */
  indexBuffer;

  /**
   * Adds an index buffer to the geometry. The index buffer contains integers, three for
   * each triangle in the geometry, which reference the various attribute buffers
   * (position, colour, UV coordinates, other UV coordinates, normal, …).
   * There is only ONE index buffer.
   * @param {TypedArray}
   * @returns {this} Self, for chaining
   */
  addIndex(buffer) {
    this.indexBuffer = { data: buffer };
    this.buffers.push(this.indexBuffer);
    return this;
  }

  /**
   * Adds an attribute to the geometry.
   * @param {string} id             The name of the attribute
   * @param {TypedArray} buffer     The buffer that holds the data of the attribute
   * @param {number} [size=0]         The size of the attribute
   * @param {boolean} [normalized=false]  Should the data be normalized
   * @param {PIXI.Types} [type=PIXI.TYPES.FLOAT]     What type of number is the attribute
   * @param {number} [stride]       How far apart, in bytes, the start of each value is
   * @param {number} [start]        How far into the array to start reading values
   * @param {boolean} [instance=false]    Instancing flag
   */
  addAttribute(id, buffer, size = 0, normalized = false, type = PIXI.TYPES.FLOAT, stride, start, instance = false) { // eslint-disable-line default-param-last
    this.buffers.push({ data: buffer });
    const bufferIndex = this.buffers.length - 1;
    this.attributes[id] = { buffer: bufferIndex, size, type, normalized, start, stride, instance };
    return this;
  }

  /**
   * Returns the requested attribute.
   * @param {string} id     The name of the attribute required
   * @returns {PIXI.Attribute}
   */
  getAttribute(id) { return this.attributes[id]; }

  /**
   * Returns the requested buffer.
   * @param {string} id The name of the buffer required.
   * @returns {PIXI.Buffer}
   */
  getBuffer(id) { return this.buffers[this.getAttribute(id).buffer]; }

  /**
   * Get the size of the geometries, in vertices.
   * @returns {number}
   */
  getSize() {
    const e = Object.values(this.attributes)[0];
    if ( !e ) return 0;
    return this.buffers[e.buffer].data.length / (e.stride / 4 || e.size);
  }

  destroy() {
    this.buffers.length = 0;
    this.indexBuffer = null;
    for (const prop of Object.getOwnPropertyNames(this.attributes)) delete this.attributes[prop];
  }
}
