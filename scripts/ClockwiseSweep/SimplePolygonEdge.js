/* globals
foundry,
PolygonEdge,
PolygonVertex,
CONST,
Wall
*/

"use strict";

import { compareXY, compareXYSortKeysInt } from "./utilities.js"; // eslint-disable-line no-unused-vars

const MAX_TEXTURE_SIZE = 16384;

/*
Version of PolygonEdge that can handle temporary walls.

For ClockwiseSweep, we want the ability to add temporary walls to the sweep algorithm.
To do so, we need to add (temporarily) intersections between the temporary walls and
walls on the canvas. Adding the intersections to wall.intersectsWith would be easy, but
removing them after the sweep, not so much.

Thus, we have three options to combine the temp edges with existing walls for the
intersectsWith map:
1. Always use the wall.intersectsWith map.
   Create wall.intersectsWith if wall is undefined.
   Track and remove temp edges from intersectsWith
     by replicating Wall.prototype._removeIntersections.
   Tracking and deletion could be slow.

2. Copy the wall.intersectsWith map to edge.intersectsWith.
   Copy such that the original map is not disturbed; i.e., new Map(wall.intersectsWith).
   Likely slower but faster than 1.
   e.g. this.intersectsWith = wall ? new Map(wall.intersectsWith) : new Map();

3. Create another intersectsWith map at edge.intersectsWith.
   Check both in code.
   A bit complicated; possibly faster than 1 or 2.
   e.g., this.intersectsWith = new Map();

(1) seems problematic b/c deletion means looping through all the intersectsWith entries.
Going with (3) for speed plus the intersectsAt is useful for processing polygon intersections.

*/

export class SimplePolygonEdge extends PolygonEdge {
  constructor(a, b, type=CONST.WALL_SENSE_TYPES.NORMAL, wall=undefined) {
    super(a, b, type, wall);

    // Track wall ids if this edge corresponds to existing wall
    // This replaces wallEdgeMap in ClockwiseSweep.
    this._id = undefined;

    // Following used in finding intersections
    this._wallKeys = undefined;

    this.intersectsWith = new Map();  // Map just as with wall.intersectsWith
  }

  /**
   * Get the id for this edge (needed for ClockwiseSweep)
   * @type {string}
   */
  get id() {
    return this._id || (this._id = this.wall?.id || foundry.utils.randomID());
  }

  /**
   * Identify which endpoint is further west, or if vertical, further north.
   * Required for quick intersection processing.
   * @type {PolygonVertex}
   */
  /*
Use this or the below sort key version
  get nw() {
    if (!this._nw) {
       const is_nw = compareXY(this.A, this.B) < 0;
       this._nw = is_nw ? this.A : this.B;
       this._se = is_nw ? this.B : this.A;
    }
    return this._nw;
  }
*/

  get nw() {
    if (!this._nw) {
      const is_nw = compareXYSortKeysInt(this.A, this.B) < 0;
      this._nw = is_nw ? this.A : this.B;
      this._se = is_nw ? this.B : this.A;
    }
    return this._nw;
  }

  get nwByKey() {
    if (!this._nw) {
      const is_nw = compareXYSortKeysInt(this.A, this.B) < 0;
      this._nw = is_nw ? this.A : this.B;
      this._se = is_nw ? this.B : this.A;
    }
    return this._nw;
  }

  /**
   * Identify which endpoint is further east, or if vertical, further south.
   * @type {PolygonVertex}
   */
  /*
Use this or the below sort key version
  get se() {
    if (!this._se) {
      const is_nw = compareXY(this.A, this.B) < 0;
      this._nw = is_nw ? this.A : this.B;
      this._se = is_nw ? this.B : this.A;
    }
    return this._se;
  }
*/

  get se() {
    if (!this._se) {
      const is_nw = compareXYSortKeysInt(this.A, this.B) < 0;
      this._nw = is_nw ? this.A : this.B;
      this._se = is_nw ? this.B : this.A;
    }
    return this._se;
  }

  get seByKey() {
    if (!this._se) {
      const is_nw = compareXYSortKeysInt(this.A, this.B) < 0;
      this._nw = is_nw ? this.A : this.B;
      this._se = is_nw ? this.B : this.A;
    }
    return this._se;
  }


  // Comparable to Wall class methods
  get vertices() {
    return { a: this.A, b: this.B };
  }

  get wallKeys() {
    return this._wallKeys || (this._wallKeys = new Set([this.A.key, this.B.key]));
  }

  fromWall(wall, type) {
    const out = new this(wall.nw, wall.se, wall.data[type], wall);
    out._nw = out.A;
    out._se = out.B;
    return out;
  }
}

/**
 * Record the intersection points between this edge and another, if any.
 */
Object.defineProperty(SimplePolygonEdge.prototype, "_identifyIntersectionsWith", {
  value: Wall.prototype._identifyIntersectionsWith,
  writable: true,
  configurable: true
});

/**
 * Calculate a numeric key that scores a point lower if it is more nw, higher if more se.
 * Formula: xN + y = key
 * @return {Number} Numeric key. Note: could be rather large depending on texture size.
 */
function sortKey() { return this._sortKey || (this._sortKey = (MAX_TEXTURE_SIZE * this.x) + this.y); }

export function registerPolygonVertexMethods() {
  if(!PolygonVertex.prototype.hasOwnProperty("sortKey")) {
    Object.defineProperty(PolygonVertex.prototype, "sortKey", {
      get: sortKey
    });
  }
}

