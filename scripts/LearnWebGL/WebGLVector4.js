/* globals

*/
"use strict";

// http://learnwebgl.brown37.net/08_projections/ortho_example/ortho_example.html
// Modified from original to comport with 2023 JS standards.
// Also modified to name "Vector" instead of "Point" b/c point is equivalent to a vector
// in code and WebGL has no concept of a point outside of a vector.

/**
 * Learn_webgl_point4.js, By Wayne Brown, Fall 2015
 *
 * Learn_webgl_point3 is a set of functions that perform standard
 * operations on a 4-component point - (x, y, z, w), which are stored as
 * 4-element arrays. The data type, Float32Array, was added to JavaScript
 * specifically for GPU programming. It stores 32 bit, floating-
 * point numbers in the format required by the GPU.
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

export class WebGLVector4 {
  /**
   * Construct a new 4-component vector.
   * @param {number} [x]
   * @param {number} [y]
   * @param {number} [z]
   * @param {number} [w]
   * @returns {Float32Array[4]}
   */
  static create(x, y, z, w) {
    const p = new Float32Array(4);
    p[0] = x ?? 0;
    p[1] = y ?? 0;
    p[2] = z ?? 0;
    p[3] = w ?? 0;
    return p;
  }

  /**
   * Construct a new 4-component vector from some array.
   * @param {Array} from
   * @returns {Float32Array[4]}
   */
  static createFrom(from) {
    const p = new Float32Array(4);
    p[0] = from[0];
    p[1] = from[1];
    p[2] = from[2];
    p[3] = from[3];
    return p;
  }

  /**
   * Copy the "from" point to the "to" point.
   * @param {Float32Array[4]} to
   * @param {Float32Array[4]} from
   * @returns {Float32Array[4]} The "to" point, internally modified.
   */
  static copy(to, from) {
    to[0] = from[0];
    to[1] = from[1];
    to[2] = from[2];
    to[3] = from[3];
    return to;
  }

  /**
   * Distance between two points.
   * @param {Float32Array[4]} p1
   * @param {Float32Array[4]} p2
   * @returns {number}
   */
  static distanceBetween(p1, p2) {
    const dx = p1[0] - p2[0];
    const dy = p1[1] - p2[1];
    const dz = p1[2] - p2[2];
    return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
  }

  /**
   * Perspective divide (normalize) a point by dividing by its homogenous coordinate w.
   * @param {Float32Array[4]} p
   * @returns {Float32Array[4]} The point p, internally modified.
   */
  static perspectiveDivide(p) {
    if (p[3] === 0) return p;
    const div = 1 / p[3];
    p[0] = p[0] * div;
    p[1] = p[1] * div;
    p[2] = p[2] * div;
    p[3] = 1;
    return p;
  }

  /**
   * Return string for debugging (console printing).
   * @param {Float32Array[4]}
   * @returns {string}
   */
  static toString(p) {
    const maximum = Math.max(...p);
    const order = Math.floor((Math.log(maximum) / Math.LN10) + 0.000000001);
    const digits = (order <= 0) ? 5 : (order > 5) ? 0 : (5 - order);
    return `{${p[0].toFixed(digits)},${p[1].toFixed(digits)},${p[2].toFixed(digits)},${p[3].toFixed(digits)}}`;
  }
}
