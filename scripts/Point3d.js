/* globals
PIXI
*/
"use strict";

/**
 * 3-D version of PIXI.Point
 * See https://pixijs.download/dev/docs/packages_math_src_Point.ts.html
 */
export class Point3d extends PIXI.Point {
  /**
   * @param {number} [x=0] - position of the point on the x axis
   * @param {number} [y=0] - position of the point on the y axis
   * @param {number} [z=0] - position of the point on the z axis
   */
  constructor(x = 0, y = 0, z = 0) {
    super(x, y);
    this.z = z;
  }

  /**
   * Creates a clone of this point
   * @returns A clone of this point
   */
  clone() {
    return new this.constructor(this.x, this.y, this.z);
  }

  /**
   * Copies `x` and `y` and `z` from the given point into this point
   * @param {Point} p - The point to copy from
   * @returns {Point3d} The point instance itself
   */
  copyFrom(p) {
    this.set(p.x, p.y, p.z);
    return this;
  }

  /**
   * Copies this point's x and y and z into the given point (`p`).
   * @param p - The point to copy to. Can be any of type that is or extends `IPointData`
   * @returns {Point} The point (`p`) with values updated
   */
  copyTo(p) {
    p.set(this.x, this.y, this.z);
    return p;
  }

  /**
   * Accepts another point (`p`) and returns `true` if the given point is equal to this point
   * @param p - The point to check
   * @returns {boolean} Returns `true` if both `x` and `y` are equal
   */
  equals(p) {
    const z = p.z ?? 0;
    return (p.x === this.x) && (p.y === this.y) && (z === this.z);
  }

  /*
   * Sets the point to a new `x` and `y` position.
   * If `y` is omitted, both `x` and `y` will be set to `x`.
   * If `z` is omitted, it will be set to 0
   * @param {number} [x=0] - position of the point on the `x` axis
   * @param {number} [y=x] - position of the point on the `y` axis
   * @returns {Point3d} The point instance itself
   */
  set(x = 0, y = x, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  /**
   * Add a point to this one.
   * @param {Point3d|PIXI.Point} p
   * @return {Point3d}
   */
  add(p) {
    const z = p.z ?? 0;
    return new this.constructor(this.x + p.x, this.y + p.y, this.z + z);
  }

  /**
   * Subtract a point from this one.
   * @param {Point3d|PIXI.Point} p
   * @return {Point3d}
   */
  sub(p) {
    const z = p.z ?? 0;
    return new this.constructor(this.x - p.x, this.y - p.y, this.z - z);
  }

  /**
   * Dot product of this point with another.
   * @param {Point3d} p
   * @return {number}
   */
  dot(p) {
    const z = p.z ?? 0;
    return (this.x * p.x) + (this.y * p.y) + (this.z * z);
  }

  /**
   * Multiple this point by a scalar
   * @param {number} f
   * @return {Point3d}
   */
  mul(f) {
    return new this.constructor(this.x * f, this.y * f, this.z * f);
  }

  /**
   * Cross product of this point by another
   * @param {Point3d} p
   * @return {number}
   */
}
