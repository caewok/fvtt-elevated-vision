/* globals

*/
"use strict";

import { WebGLVector3 } from "./WebGLVector3.js";
import { WebGLVector4 } from "./WebGLVector4.js";

// http://learnwebgl.brown37.net/08_projections/ortho_example/ortho_example.html
// Modified from original to comport with 2023 JS standards.

/**
 * Learn_webgl_matrix.js, By Wayne Brown, Spring 2015
 *
 * Learn_webgl_matrix is a set of functions that perform standard operations
 * on 4x4 transformation matrices.
 *
 * The 4x4 matrices are stored in column-major order using an array of 32-bit
 * floating point numbers, which is the format required by WebGL programs.
 *
 * The functions do not create new objects because in real-time graphics,
 * creating new objects slows things down.
 *
 * Function parameters are ordered in the same order an equivalent
 * assignment statements. For example, R = A*B, has parameters (R, A, B).
 * All matrix parameters use capital letters.
 *
 * The functions are defined inside an object to prevent pollution of
 * JavaScript's global address space. The functions contain no validation
 * of parameters, which makes them more efficient at run-time.
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


const PI_180 = Math.PI / 180;
const PI_180_INV = 180 / Math.PI;


/**
 * 4x4 matrix stored in column-major format using 32-bit floating point
 * @constructor Create an instance of the Learn_webgl_matrix class
 */

export class WebGLMatrix {
  // Temporary matrices and vectors for calculations. They are reused to
  // prevent new objects from being constantly re-created and then garbage
  // collected.

  // @type {Float32Array(16)}
  static #T1 = WebGLMatrix.create();

  static #T2 = WebGLMatrix.create();

  // @type {Float32Array[4]}
  static #p4 = WebGLVector4.create();

  // @type {Float32Array[3]}
  static #v3 = WebGLVector3.create();

  static #axisOfRotation = WebGLVector3.create();

  static #u = WebGLVector3.create();

  static #v = WebGLVector3.create();

  static #n = WebGLVector3.create();

  static #center = WebGLVector3.create();

  static #eye = WebGLVector3.create();

  static #up = WebGLVector3.create();

  /**
   * Create a new "matrix" represented as an array.
   * Column-major arrangement.
   * @returns {Float32Array[16]}
   */
  static create() {
    return new Float32Array(16);
  }

  /**
   * Construct an identity matrix.
   * @param {Float32Array[16]} M
   * @returns {Float32Array[16]}
   */
  static setIdentity(M) {
    /* eslint-disable no-multi-spaces */
    M[0] = 1;  M[4] = 0;  M[8] = 0;  M[12] = 0;
    M[1] = 0;  M[5] = 1;  M[9] = 0;  M[13] = 0;
    M[2] = 0;  M[6] = 0;  M[10] = 1; M[14] = 0;
    M[3] = 0;  M[7] = 0;  M[11] = 0; M[15] = 1;
    /* eslint-enable no-multi-spaces */

    return M;
  }

  /**
   * Convert input angle from degrees to radians.
   * @param {number} angleInDegrees
   * @returns {number}
   */
  static toRadians(angleInDegrees) { return angleInDegrees * PI_180; }

  /**
   * Convert input angle from radians to degrees
   * @param {number} angleInRadians
   * @returns {number}
   */
  static toDegrees(angleInRadians) { return angleInRadians * PI_180_INV; }

  /**
   * Copy all elements of one matrix to another.
   * @param {Float32Array[16]} To
   * @param {Float32Array[16]} From
   * @returns {Float32Array[16]}
   */
  static copy(to, from) {
    for ( let j = 0; j < 16; j += 1 ) to[j] = from[j];
    return to;
  }

  /**
   * Matrix Multiplication. R = A * B. Order matters!
   * @param {Float32Array[16]} R    Where to store the result
   * @param {Float32Array[16]} A    First matrix to multiply
   * @param {Float32Array[16]} B    Second matrix to multiply
   * @returns {Float32Array[16]}
   */
  static multiply(R, A, B) {
    // A and B can't change during the operation.
    // If R is the same as A and/or B, Make copies of A and B
    // The comparison must use ==, not ===. We are comparing for identical
    // objects, not if two objects might have the same values.
    if (A == R) A = this.copy(this.#T1, A); // eslint-disable-line eqeqeq
    if (B == R) B = this.copy(this.#T2, B); // eslint-disable-line eqeqeq

    /* eslint-disable no-multi-spaces, no-mixed-operators */
    R[0]  = A[0] * B[0]  + A[4] * B[1]  + A[8]  * B[2]  + A[12] * B[3];
    R[1]  = A[1] * B[0]  + A[5] * B[1]  + A[9]  * B[2]  + A[13] * B[3];
    R[2]  = A[2] * B[0]  + A[6] * B[1]  + A[10] * B[2]  + A[14] * B[3];
    R[3]  = A[3] * B[0]  + A[7] * B[1]  + A[11] * B[2]  + A[15] * B[3];

    R[4]  = A[0] * B[4]  + A[4] * B[5]  + A[8]  * B[6]  + A[12] * B[7];
    R[5]  = A[1] * B[4]  + A[5] * B[5]  + A[9]  * B[6]  + A[13] * B[7];
    R[6]  = A[2] * B[4]  + A[6] * B[5]  + A[10] * B[6]  + A[14] * B[7];
    R[7]  = A[3] * B[4]  + A[7] * B[5]  + A[11] * B[6]  + A[15] * B[7];

    R[8]  = A[0] * B[8]  + A[4] * B[9]  + A[8]  * B[10] + A[12] * B[11];
    R[9]  = A[1] * B[8]  + A[5] * B[9]  + A[9]  * B[10] + A[13] * B[11];
    R[10] = A[2] * B[8]  + A[6] * B[9]  + A[10] * B[10] + A[14] * B[11];
    R[11] = A[3] * B[8]  + A[7] * B[9]  + A[11] * B[10] + A[15] * B[11];

    R[12] = A[0] * B[12] + A[4] * B[13] + A[8]  * B[14] + A[12] * B[15];
    R[13] = A[1] * B[12] + A[5] * B[13] + A[9]  * B[14] + A[13] * B[15];
    R[14] = A[2] * B[12] + A[6] * B[13] + A[10] * B[14] + A[14] * B[15];
    R[15] = A[3] * B[12] + A[7] * B[13] + A[11] * B[14] + A[15] * B[15];
    /* eslint-enable no-multi-spaces, no-mixed-operators */

    return R;
  }

  /**
   * Matrix multiplication of a series of matrices.
   * R = A * B * C * D ... (Order matters!)
   * @param {Float32Array[16]} args
   * @returns {Float32Array[16]}
   */
  static multiplySeries(R, A, ...matrices) {
    if ( !matrices.length ) return R;
    this.multiply(R, A, matrices[0]);

    const ln = matrices.length;
    for ( let j = 1; j < ln; j += 1 ) this.multiply(R, R, matrices[j]);
    return R;
  }

  /**
   * Multiply matrix by a vector.
   * r = M * v, where M is 4x4 matrix and v is a 3-component vector
   * @param {Float32Array[3]} r
   * @param {Float32Array[16]} M
   * @param {Float32Array[16]} v
   * @returns {Float32Array[3]}
   */
  static multiplyV3(r, M, v) {
    // Vector v can't change during the operation. If r and v are the same, make a copy of v
    if (r == v) v = WebGLVector3.copy(this.#v3, v); // eslint-disable-line eqeqeq

    /* eslint-disable no-multi-spaces, no-mixed-operators */
    r[0] = M[0] * v[0] + M[4] * v[1] + M[8]  * v[2];
    r[1] = M[1] * v[0] + M[5] * v[1] + M[9]  * v[2];
    r[2] = M[2] * v[0] + M[6] * v[1] + M[10] * v[2];
    /* eslint-enable no-multi-spaces, no-mixed-operators */

    return r;
  }

  /**
   * Multiply matrix by a point (vector).
   * r = M * p, where M is a 4x4 matrix and v is a 4-component point
   * @param {Float32Array[4]} r
   * @param {Float32Array[16]} M
   * @param {Float32Array[4]} p
   * @returns {Float32Array[4]}
   */
  static multiplyP4(r, M, p) {
    // Point p can't change during the operation, so make a copy of p.
    WebGLVector4.copy(this.#p4, p);

    /* eslint-disable no-multi-spaces, no-mixed-operators */
    r[0] = M[0] * this.#p4[0] + M[4] * this.#p4[1] + M[8]  * this.#p4[2] + M[12] * this.#p4[3];
    r[1] = M[1] * this.#p4[0] + M[5] * this.#p4[1] + M[9]  * this.#p4[2] + M[13] * this.#p4[3];
    r[2] = M[2] * this.#p4[0] + M[6] * this.#p4[1] + M[10] * this.#p4[2] + M[14] * this.#p4[3];
    r[3] = M[3] * this.#p4[0] + M[7] * this.#p4[1] + M[11] * this.#p4[2] + M[15] * this.#p4[3];
    /* eslint-enable no-multi-spaces, no-mixed-operators */

    return r;
  }

  /**
   * Transform matrix to string for debugging.
   * @param {Float32Array[16]} M
   * @returns {string}
   */
  static toString(M) {
    const fieldSize = 11;
    let text = "";
    for ( let row = 0; row < 4; row += 1 ) {
      let rowText = "";
      for ( let offset = 0; offset < 16; offset += 4 ) {
        const number = Number(M[row + offset]);
        const numText = number.toFixed(4);
        rowText += new Array(fieldSize - numText.length).join(" ") + numText;
      }

      text += `${rowText}\n`;
    }
    return text;
  }

  /**
   * Transpose the matrix. M' = M.
   * @param {Float32Array[16]} M
   * @returns {Float32Array[16]}
   */
  static transpose(M) {
    // The diagonal values don't move; 6 non-diagonal elements are swapped.
    [M[1], M[4]] = [M[4], M[1]];
    [M[2], M[8]] = [M[8], M[2]];
    [M[3], M[12]] = [M[12], M[3]];
    [M[6], M[9]] = [M[9], M[6]];
    [M[7], M[13]] = [M[13], M[7]];
    [M[11], M[14]] = [M[14], M[11]];

    return M;
  }

  /**
   * Invert the matrix. M^-1
   * @param {Float32Array[16]} M
   * @returns {Float32Array[16]}
   */
  static inverse(Inv, M) {
    /* Structure of matrix

         0   1   2   3
        ______________
     0 | 0   4   8  12
     1 | 1   5   9  13
     2 | 2   6  10  14
     3 | 3   7  11  15
    */
    // Factored out common terms
    /* eslint-disable no-multi-spaces, no-mixed-operators */
    const t9_14_13_10 = M[9] * M[14] - M[13] * M[10];
    const t13_6_5_14  = M[13] * M[6] - M[5] * M[14];
    const t5_10_9_6   = M[5] * M[10] - M[9] * M[6];
    const t12_10_8_14 = M[12] * M[10] - M[8] * M[14];
    const t4_14_12_6  = M[4] * M[14] - M[12] * M[6];
    const t8_6_4_10   = M[8] * M[6] - M[4] * M[10];
    const t8_13_12_9  = M[8] * M[13] - M[12] * M[9];
    const t12_5_4_13  = M[12] * M[5] - M[4] * M[13];
    const t4_9_8_5    = M[4] * M[9] - M[8] * M[5];
    const t1_14_13_2  = M[1] * M[14] - M[13] * M[2];
    const t9_2_1_10   = M[9] * M[2] - M[1] * M[10];
    const t12_2_0_14  = M[12] * M[2] - M[0] * M[14];
    const t0_10_8_2   = M[0] * M[10] - M[8] * M[2];
    const t0_13_12_1  = M[0] * M[13] - M[12] * M[1];
    const t8_1_0_9    = M[8] * M[1] - M[0] * M[9];
    const t1_6_5_2    = M[1] * M[6] - M[5] * M[2];
    const t4_2_0_6    = M[4] * M[2] - M[0] * M[6];
    const t0_5_4_1    = M[0] * M[5] - M[4] * M[1];

    Inv[0] = M[7] * t9_14_13_10 + M[11] * t13_6_5_14 + M[15] * t5_10_9_6;
    Inv[4] = M[7] * t12_10_8_14 + M[11] * t4_14_12_6 + M[15] * t8_6_4_10;
    Inv[8] = M[7] * t8_13_12_9 + M[11] * t12_5_4_13 + M[15] * t4_9_8_5;
    Inv[12] = M[6] * -t8_13_12_9 + M[10] * -t12_5_4_13 + M[14] * -t4_9_8_5;
    Inv[1] = M[3] * -t9_14_13_10 + M[11] * t1_14_13_2 + M[15] * t9_2_1_10;
    Inv[5] = M[3] * -t12_10_8_14 + M[11] * t12_2_0_14 + M[15] * t0_10_8_2;
    Inv[9] = M[3] * -t8_13_12_9 + M[11] * t0_13_12_1 + M[15] * t8_1_0_9;
    Inv[13] = M[2] * t8_13_12_9 + M[10] * -t0_13_12_1 + M[14] * -t8_1_0_9;
    Inv[2] = M[3] * -t13_6_5_14 + M[7] * -t1_14_13_2 + M[15] * t1_6_5_2;
    Inv[6] = M[3] * -t4_14_12_6 + M[7] * -t12_2_0_14 + M[15] * t4_2_0_6;
    Inv[10] = M[3] * -t12_5_4_13 + M[7] * -t0_13_12_1 + M[15] * t0_5_4_1;
    Inv[14] = M[2] * t12_5_4_13 + M[6] * t0_13_12_1 + M[14] * -t0_5_4_1;
    Inv[3] = M[3] * -t5_10_9_6 + M[7] * -t9_2_1_10 + M[11] * -t1_6_5_2;
    Inv[7] = M[3] * -t8_6_4_10 + M[7] * -t0_10_8_2 + M[11] * -t4_2_0_6;
    Inv[11] = M[3] * -t4_9_8_5 + M[7] * -t8_1_0_9 + M[11] * -t0_5_4_1;
    Inv[15] = M[2] * t4_9_8_5 + M[6] * t8_1_0_9 + M[10] * t0_5_4_1;

    const det =
        M[3]  * (M[6] * -t8_13_12_9 + M[10] * -t12_5_4_13 + M[14] * -t4_9_8_5)
      + M[7]  * (M[2] * t8_13_12_9  + M[10] * -t0_13_12_1 + M[14] * -t8_1_0_9)
      + M[11] * (M[2] * t12_5_4_13  + M[6] * t0_13_12_1   + M[14] * -t0_5_4_1)
      + M[15] * (M[2] * t4_9_8_5    + M[6] * t8_1_0_9     + M[10] * t0_5_4_1);
    /* eslint-enable no-multi-spaces, no-mixed-operators */

    if (det !== 0) {
      const scale = 1 / det;
      for (let j = 0; j < 16; j += 1) Inv[j] = Inv[j] * scale;
    }

    return Inv;
  }

  /**
   * Create an orthographic projection matrix.
   * @param {number} left   Farthest left on the x-axis
   * @param {number} right  Farthest right on the x-axis
   * @param {number} bottom Farthest down on the y-axis
   * @param {number} top    Farthest up on the y-axis
   * @param {number} near   Distance to the near clipping plane along the -Z axis
   * @param {number} far    Distance to the far clipping plane along the -Z axis
   * @returnss {Float32Array[16]} The orthographic transformation matrix
   */
  static createOrthographic(left, right, bottom, top, near, far) {
    const M = this.create();

    // Ensure no division by zero.
    if ( left === right || bottom === top || near === far ) {
      console.error("Invalid createOrthographic parameters.");
      this.setIdentity(M);
      return M;
    }

    /* eslint-disable no-multi-spaces, no-mixed-operators */
    const widthRatio  = 1.0 / (right - left);
    const heightRatio = 1.0 / (top - bottom);
    const depthRatio  = 1.0 / (far - near);

    const sx =  2 * widthRatio;
    const sy =  2 * heightRatio;
    const sz = -2 * depthRatio;

    const tx = -(right + left) * widthRatio;
    const ty = -(top + bottom) * heightRatio;
    const tz = -(far + near) * depthRatio;

    M[0] = sx;  M[4] = 0;   M[8] = 0;   M[12] = tx;
    M[1] = 0;   M[5] = sy;  M[9] = 0;   M[13] = ty;
    M[2] = 0;   M[6] = 0;   M[10] = sz; M[14] = tz;
    M[3] = 0;   M[7] = 0;   M[11] = 0;  M[15] = 1;
    /* eslint-enable no-multi-spaces, no-mixed-operators */

    return M;
  }

  /**
   * Set a perspective projection matrix based on limits of a frustum.
   * @param {number} left   Farthest left on the x-axis
   * @param {number} right  Farthest right on the x-axis
   * @param {number} bottom Farthest down on the y-axis
   * @param {number} top    Farthest up on the y-axis
   * @param {number} near   Distance to the near clipping plane along the -Z axis
   * @param {number} far    Distance to the far clipping plane along the -Z axis
   * @returns {Float32Array[16]} A perspective transformation matrix
   */
  static createFrustum(left, right, bottom, top, near, far) {
    const M = this.create();

    // Ensure no division by zero.
    if ( left === right || bottom === top || near === far ) {
      console.error("Invalid createOrthographic parameters.");
      this.setIdentity(M);
      return M;
    }

    // Ensure correct near/far distances.
    if (near <= 0 || far <= 0) {
      console.log("For a perspective projection, the near and far distances must be positive.");
      this.setIdentity(M);
      return M;
    }

    const sx = 2 * near / (right - left);
    const sy = 2 * near / (top - bottom);

    const c2 = -(far + near) / (far - near);
    const c1 = 2 * near * far / (near - far);

    const tx = -near * (left + right) / (right - left);
    const ty = -near * (bottom + top) / (top - bottom);

    /* eslint-disable no-multi-spaces, no-mixed-operators */
    M[0] = sx; M[4] = 0;  M[8] = 0;    M[12] = tx;
    M[1] = 0;  M[5] = sy; M[9] = 0;    M[13] = ty;
    M[2] = 0;  M[6] = 0;  M[10] = c2;  M[14] = c1;
    M[3] = 0;  M[7] = 0;  M[11] = -1;  M[15] = 0;
    /* eslint-enable no-multi-spaces, no-mixed-operators */

    return M;
  }

  /**
   * Set a perspective projection matrix based on limits of a frustum.
   * @param {number} left   Farthest left on the x-axis
   * @param {number} right  Farthest right on the x-axis
   * @param {number} bottom Farthest down on the y-axis
   * @param {number} top    Farthest up on the y-axis
   * @param {number} near   Distance to the near clipping plane along the -Z axis
   * @param {number} far    Distance to the far clipping plane along the -Z axis
   * @returns {Float32Array[16]} A perspective transformation matrix
   */
  static createFrustumTextbook(left, right, bottom, top, near, far) {
    const M = this.create();

    // Ensure no division by zero.
    if ( left === right || bottom === top || near === far ) {
      console.error("Invalid createOrthographic parameters.");
      this.setIdentity(M);
      return M;
    }

    // Ensure correct near/far distances.
    if (near <= 0 || far <= 0) {
      console.log("For a perspective projection, the near and far distances must be positive");
      this.setIdentity(M);
      return M;
    }

    const sx = 2 * near / (right - left);
    const sy = 2 * near / (top - bottom);

    const A = (right + left) / (right - left);
    const B = (top + bottom) / (top - bottom);

    const c1 = -2 * near * far / (far - near);
    const c2 = -(far + near) / (far - near);

    /* eslint-disable no-multi-spaces, no-mixed-operators */
    M[0] = sx; M[4] = 0;  M[8] = A;    M[12] = 0;
    M[1] = 0;  M[5] = sy; M[9] = B;    M[13] = 0;
    M[2] = 0;  M[6] = 0;  M[10] = c2;  M[14] = c1;
    M[3] = 0;  M[7] = 0;  M[11] = -1;  M[15] = 0;
    /* eslint-enable no-multi-spaces, no-mixed-operators */

    return M;
  }

  /**
   * Create a perspective projection matrix using a field-of-view and an aspect ratio.
   * @param {number} fovy   The angle between the upper and lower sides of the viewing frustum.
   * @param {number} aspect The aspect ratio of the view window. (width/height).
   * @param {number} near   Distance to the near clipping plane along the -Z axis.
   * @param {number} far    Distance to the far clipping plane along the -Z axis.
   * @return {Float32Array[16]} The perspective transformation matrix.
   */
  static createPerspective(fovy, aspect, near, far) {
    if ( fovy <= 0 || fovy >= 180 || aspect <= 0 || near >= far || near <= 0 ) {
      console.error("Invalid parameters to createPerspective.");
      const M = this.create();
      return this.setIdentity(M);
    }

    const half_fovy = self.toRadians(fovy) / 2;
    const top = near * Math.tan(half_fovy);
    const bottom = -top;
    const right = top * aspect;
    const left = -right;
    return this.createFrustum(left, right, bottom, top, near, far);
  }

  /**
   * Set the matrix for scaling.
   * @param {Float32Array[16]} The matrix to set to a scaling matrix
   * @param {number} sx The scale factor along the x-axis
   * @param {number} sy The scale factor along the y-axis
   * @param {number} sz The scale factor along the z-axis
   * @returns {Float32Array[16]}
   */
  static scale(M, sx, sy, sz) {
    /* eslint-disable no-multi-spaces, no-mixed-operators */
    M[0] = sx;  M[4] = 0;   M[8] = 0;   M[12] = 0;
    M[1] = 0;   M[5] = sy;  M[9] = 0;   M[13] = 0;
    M[2] = 0;   M[6] = 0;   M[10] = sz; M[14] = 0;
    M[3] = 0;   M[7] = 0;   M[11] = 0;  M[15] = 1;
    /* eslint-enable no-multi-spaces, no-mixed-operators */

    return M;
  }

  /**
   * Set the matrix for translation.
   * @param {Float32Array[16]}  M   The matrix to set to a translation matrix.
   * @param {number} dx             The X value of a translation.
   * @param {number} dy             The Y value of a translation.
   * @param {number} dz             The Z value of a translation.
   */
  static translate(M, dx, dy, dz) {
    /* eslint-disable no-multi-spaces, no-mixed-operators */
    M[0] = 1;  M[4] = 0;  M[8]  = 0;  M[12] = dx;
    M[1] = 0;  M[5] = 1;  M[9]  = 0;  M[13] = dy;
    M[2] = 0;  M[6] = 0;  M[10] = 1;  M[14] = dz;
    M[3] = 0;  M[7] = 0;  M[11] = 0;  M[15] = 1;
    /* eslint-enable no-multi-spaces, no-mixed-operators */

    return M;
  }

  /**
   * Set the matrix to a rotation matrix. The axis of rotation axis may not be normalized.
   * @param {Float32Array[16]} M    Matrix to use
   * @param {number} angle          The angle of rotation (degrees)
   * @param {x_axis The X coordinate of axis vector for rotation.
   * @param y_axis The Y coordinate of axis vector for rotation.
   * @param z_axis The Z coordinate of axis vector for rotation.
   */
  static rotate(M, angle, x_axis, y_axis, z_axis) {
    angle = this.toRadians(angle);

    let s = Math.sin(angle);
    const c = Math.cos(angle);

    if (x_axis !== 0 && y_axis === 0 && z_axis === 0) {
      // Rotation around the X axis
      if (x_axis < 0) s = -s;

      /* eslint-disable no-multi-spaces, no-mixed-operators */
      M[0] = 1;  M[4] = 0;  M[8]  = 0;  M[12] = 0;
      M[1] = 0;  M[5] = c;  M[9]  = -s; M[13] = 0;
      M[2] = 0;  M[6] = s;  M[10] = c;  M[14] = 0;
      M[3] = 0;  M[7] = 0;  M[11] = 0;  M[15] = 1;
      /* eslint-enable no-multi-spaces, no-mixed-operators */

    } else if (x_axis === 0 && y_axis !== 0 && z_axis === 0) {
      // Rotation around Y axis
      if (y_axis < 0) s = -s;

      /* eslint-disable no-multi-spaces, no-mixed-operators */
      M[0] = c;  M[4] = 0;  M[8]  = s;  M[12] = 0;
      M[1] = 0;  M[5] = 1;  M[9]  = 0;  M[13] = 0;
      M[2] = -s; M[6] = 0;  M[10] = c;  M[14] = 0;
      M[3] = 0;  M[7] = 0;  M[11] = 0;  M[15] = 1;
      /* eslint-enable no-multi-spaces, no-mixed-operators */

    } else if (x_axis === 0 && y_axis === 0 && z_axis !== 0) {
      // Rotation around Z axis
      if (z_axis < 0) s = -s;

      /* eslint-disable no-multi-spaces, no-mixed-operators */
      M[0] = c;  M[4] = -s;  M[8]  = 0;  M[12] = 0;
      M[1] = s;  M[5] = c;   M[9]  = 0;  M[13] = 0;
      M[2] = 0;  M[6] = 0;   M[10] = 1;  M[14] = 0;
      M[3] = 0;  M[7] = 0;   M[11] = 0;  M[15] = 1;
      /* eslint-enable no-multi-spaces, no-mixed-operators */

    } else {
      // Rotation around any arbitrary axis
      this.#axisOfRotation[0] = x_axis;
      this.#axisOfRotation[1] = y_axis;
      this.#axisOfRotation[2] = z_axis;
      WebGLVector3.normalize(this.#axisOfRotation);
      const ux = this.#axisOfRotation[0];
      const uy = this.#axisOfRotation[1];
      const uz = this.#axisOfRotation[2];
      const c1 = 1 - c;

      /* eslint-disable no-multi-spaces, no-mixed-operators */
      M[0] = c + ux * ux * c1;
      M[1] = uy * ux * c1 + uz * s;
      M[2] = uz * ux * c1 - uy * s;
      M[3] = 0;

      M[4] = ux * uy * c1 - uz * s;
      M[5] = c + uy * uy * c1;
      M[6] = uz * uy * c1 + ux * s;
      M[7] = 0;

      M[8] = ux * uz * c1 + uy * s;
      M[9] = uy * uz * c1 - ux * s;
      M[10] = c + uz * uz * c1;
      M[11] = 0;

      M[12] = 0;
      M[13] = 0;
      M[14] = 0;
      M[15] = 1;
      /* eslint-enable no-multi-spaces, no-mixed-operators */
    }

    return M;
  }

  /**
   * Set a camera matrix.
   * @param {Float32Array[16]} M  The matrix to contain the camera transformation.
   * @param {number} eye_x        The x component of the eye point.
   * @param {number} eye_y        The y component of the eye point.
   * @param {number} eye_z        The z component of the eye point.
   * @param {number} center_x     The x component of a point being looked at.
   * @param {number} center_y     The y component of a point being looked at.
   * @param {number} center_z     The z component of a point being looked at.
   * @param {number} up_dx        The x component of a vector in the up direction.
   * @param {number} up_dy        The y component of a vector in the up direction.
   * @param {number} up_dz        The z component of a vector in the up direction.
   */
  static lookAt(M, eye_x, eye_y, eye_z, center_x, center_y, center_z, up_dx, up_dy, up_dz) {

    // Local coordinate system for the camera:
    //   u maps to the x-axis
    //   v maps to the y-axis
    //   n maps to the z-axis

    const u = this.#u;
    const v = this.#v;
    const n = this.#n;
    const eye = this.#eye;
    const center = this.#center;
    const up = this.#up;

    WebGLVector3.setValues(center, center_x, center_y, center_z);
    WebGLVector3.setValues(eye, eye_x, eye_y, eye_z);
    WebGLVector3.setValues(up, up_dx, up_dy, up_dz);

    WebGLVector3.subtract(n, eye, center);  // Note: n = eye - center
    WebGLVector3.normalize(n);

    WebGLVector3.crossProduct(u, up, n);
    WebGLVector3.normalize(u);

    WebGLVector3.crossProduct(v, n, u);
    WebGLVector3.normalize(v);

    const tx = -WebGLVector3.dotProduct(u, eye);
    const ty = -WebGLVector3.dotProduct(v, eye);
    const tz = -WebGLVector3.dotProduct(n, eye);

    // Set the camera matrix
    /* eslint-disable no-multi-spaces, no-mixed-operators */
    M[0] = u[0];  M[4] = u[1];  M[8]  = u[2];  M[12] = tx;
    M[1] = v[0];  M[5] = v[1];  M[9]  = v[2];  M[13] = ty;
    M[2] = n[0];  M[6] = n[1];  M[10] = n[2];  M[14] = tz;
    M[3] = 0;     M[7] = 0;     M[11] = 0;     M[15] = 1;
    /* eslint-enable no-multi-spaces, no-mixed-operators */

    return M;
  }
}
