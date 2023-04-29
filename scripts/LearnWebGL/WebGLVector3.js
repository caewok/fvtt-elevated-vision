/* globals

*/
"use strict";

// http://learnwebgl.brown37.net/08_projections/ortho_example/ortho_example.html
// Modified from original to comport with 2023 JS standards.

/**
 * Learn_webgl_vector3.js, By Wayne Brown, Spring 2015
 *
 * Learn_webgl_vector3 is a set of functions that perform standard
 * operations on 3-component vectors - (dx, dy, dz), which are stored as
 * 3-element arrays. The data type, Float32Array, was added to JavaScript
 * specifically for GPU programming. It stores 32 bit, floating-
 * point numbers in the format required by the GPU.
 *
 * The functions do not create new objects because in real-time graphics,
 * creating new objects slows things down.
 *
 * The functions are defined inside an object to prevent pollution of
 * JavaScript's global address space.
 */

/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 C. Wayne Brown
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.

 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * Class to organize methods to be applied to a 3-component array.
 */
export class WebGLVector3 {
  /**
   * Construct a new 3-component vector.
   * @param {number} [x]
   * @param {number} [y]
   * @param {number} [z]
   * @returns {Float32Array[3]}
   */
  static create(x, y, z) {
    const p = new Float32Array(3);
    p[0] = x ?? 0;
    p[1] = y ?? 0;
    p[2] = z ?? 0;
    return p;
  }

  /**
   * Construct a new 4-component vector from some array.
   * @param {Array} from
   * @returns {Float32Array[3]}
   */
  static createFrom(from) {
    const p = new Float32Array(3);
    p[0] = from[0];
    p[1] = from[1];
    p[2] = from[2];
    return p;
  }

  /**
   * Create a vector from two existing opints.
   * @param {Float32Array[3]} tail
   * @param {Float32Array[3]} head
   * @returns {Float32Array[3]}
   */
  static createFrom2Points(tail, head) {
    const v = new Float32Array(3);
    this.subtract(v, head, tail);
    return v;
  }

  /**
   * Copy the "from" point to the "to" point.
   * @param {Float32Array[3]} to
   * @param {Float32Array[3]} from
   * @returns {Float32Array[3]} The "to" point, internally modified.
   */
  static copy(to, from) {
    to[0] = from[0];
    to[1] = from[1];
    to[2] = from[2];
    return to;
  }

  /**
   * Set the components of the vector.
   * @param {Float32Array[3]} v
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  static setValues(v, x, y, z) {
    v[0] = x;
    v[1] = y;
    v[2] = z;
  }

  /**
   * Calculate the length of the vector.
   * @param {Float32Array[3]} v
   * @returns {number}
   */
  static length(v) {
    return Math.sqrt((v[0] * v[0]) + (v[1] * v[1]) + (v[2] * v[2]));
  }

  /**
   * Normalize a point by dividing by its homogenous coordinate w.
   * @param {Float32Array[3]} p
   * @returns {Float32Array[3]} The point p, internally modified.
   */
  static normalize(v) {
    const length = this.length(v);
    if ( Math.abs(length) < 1e-06 ) return null; // Invalid vector

    const percent = 1 / length;
    v[0] = v[0] * percent;
    v[1] = v[1] * percent;
    v[2] = v[2] * percent;
    return v;
  }

  /**
   * Add two vectors: v0 + v1 = result
   * @param {Float32Array[3]} result
   * @param {Float32Array[3]} v0
   * @param {Float32Array[3]} v1
   * @returns {Float32Array[3]}
   */
  static add(result, v0, v1) {
    result[0] = v0[0] + v1[0];
    result[1] = v0[1] + v1[1];
    result[2] = v0[2] + v1[2];
    return result;
  }

  /**
   * Subtract two vectors: v0 - v1 = result
   * @param {Float32Array[3]} result
   * @param {Float32Array[3]} v0
   * @param {Float32Array[3]} v1
   * @returns {Float32Array[3]}
   */
  static subtract(result, v0, v1) {
    result[0] = v0[0] - v1[0];
    result[1] = v0[1] - v1[1];
    result[2] = v0[2] - v1[2];
    return result;
  }

  /**
   * Scale a vector: v0 * s = result
   * @param {Float32Array[3]} result
   * @param {Float32Array[3]} v0
   * @param {number} s
   * @returns {Float32Array[3]}
   */
  static scale(result, v0, s) {
    result[0] = v0[0] * s;
    result[1] = v0[1] * s;
    result[2] = v0[2] * s;
    return result;
  }

  /**
   * Calculate the cross-product of two vectors: v0 x v1 = result. (order matters)
   * @param {Float32Array[3]} result
   * @param {Float32Array[3]} v0
   * @param {Float32Array[3]} v1
   * @returns {Float32Array[3]}
   */
  static crossProduct(result, v0, v1) {
    result[0] = (v0[1] * v1[2]) - (v0[2] * v1[1]);
    result[1] = (v0[2] * v1[0]) - (v0[0] * v1[2]);
    result[2] = (v0[0] * v1[1]) - (v0[1] * v1[0]);
    return result;
  }

  /**
   * Calculate the dot product of two vectors: v0 • v1 = result.
   * @param {Float32Array[3]} v0
   * @param {Float32Array[3]} v1
   * @returns {number}
   */
  static dotProduct(v0, v1) {
    return (v0[0] * v1[0]) + (v0[1] * v1[1]) + (v0[2] * v1[2]);
  }

  /**
   * Return string for debugging (console printing).
   * @param {Float32Array[3]}
   * @returns {string}
   */
  static toString(p) {
    const maximum = Math.max(...p);
    const order = Math.floor((Math.log(maximum) / Math.LN10) + 0.000000001);
    const digits = (order <= 0) ? 5 : (order > 5) ? 0 : (5 - order);
    return `{${p[0].toFixed(digits)},${p[1].toFixed(digits)},${p[2].toFixed(digits)}}`;
  }
}
