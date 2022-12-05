/* globals
canvas,
foundry
*/
"use strict";

/*

Class with methods to link and trace walls
-- Find the cw and ccw endpoints to an origin point
-- Find and track walls that share endpoints
-- Organize walls that share intersections
-- Given a starting endpoint for the wall, get the point found by turning right either
   at an intersection or the endpoint.
*/

import {
  angleBetweenPoints,
  groupBy,
  points2dAlmostEqual } from "./util.js";

export class WallTracer {
  static #oppositeEndpoint = { A: "B", B: "A" };

  _endpointWalls = { A: new Set(), B: new Set() };

  _orderedEndpoints = { cw: undefined, ccw: undefined };

  _intersectionMap = new Map();

  _next = { A: new Map(), B: new Map() };

  // Intersections are sorted from distance from A
  // Each element is a set of walls along with ix and distance
  _intersections = [];

  constructor(wall, origin) {
    this.origin = origin;
    this.wall = wall;
  }


  get wallKeys() { return this.wall.wallKeys; }

  get A() { return this.wall.A; }

  get B() { return this.wall.B; }

  get numIntersections() { return this.wall.intersectsWith.size; }

  otherEndpoint(endpoint) { return endpoint.equals(this.A) ? this.B : this.A; }

  matchingEndpoint(vertex) { return vertex.equals(this.A) ? this.A : this.B; }

  /**
   * Build a map of wall tracers from walls in the scene.
   * Add endpoint connections between the wall tracers.
   * @param {Point} origin    Origin point for tracing walls
   * @returns {Map<Wall, WallTracer>}
   */
  static constructWallTracerMap(origin) {
    const useInnerBounds = canvas.dimensions.sceneRect.contains(origin.x, origin.y);
    const boundaries = useInnerBounds
      ? canvas.walls.innerBounds : canvas.walls.outerBounds;
    const wallTracerMap = new Map();
    const wtArray = [];
    canvas.walls.placeables.forEach(wall => {
      const wt = new WallTracer(wall, origin);
      wallTracerMap.set(wall, wt);
      wtArray.push(wt);
    });

    boundaries.forEach(wall => {
      const wt = new WallTracer(wall, origin);
      wallTracerMap.set(wall, wt);
      wtArray.push(wt);
    });

    // Add the endpoint connections
    const ln = wtArray.length;
    for ( let i = 0; i < ln; i += 1 ) {
      for ( let j = i + 1; j < ln; j += 1 ) {
        const wi = wtArray[i];
        const wj = wtArray[j];
        wi.addEndpointConnections(wj);
      }
    }

    return wallTracerMap;
  }

  get orderedEndpoints() {
    if ( this._orderedEndpoints.cw ) return this._orderedEndpoints;

    const { A, B, origin } = this;
    const o = foundry.utils.orient2dFast(origin, A, B);
    let cw;
    let ccw;
    if ( !o ) {
      const distA = Math.pow(A.x - origin.x, 2) + Math.pow(A.y - origin.y, 2);
      const distB = Math.pow(B.x - origin.x, 2) + Math.pow(B.y - origin.y, 2);
      [cw, ccw] = distA < distB ? [A, B] : [B, A];
    } else {
      [cw, ccw] = o > 0 ? [A, B] : [B, A];
    }

    return (this._orderedEndpoints = { cw, ccw });
  }

  addEndpointConnections(other) {
    if ( this.wallKeys.has(other.A.key) ) other._endpointWalls.A.add(this);
    if ( this.wallKeys.has(other.B.key) ) other._endpointWalls.B.add(this);
    if ( other.wallKeys.has(this.A.key) ) this._endpointWalls.A.add(other);
    if ( other.wallKeys.has(this.B.key) ) this._endpointWalls.B.add(other);
  }

  nextFromStartingEndpoint(startEndpoint, startDistance2 = 0) {
    const start = startEndpoint.equals(this.A) ? "A" : "B";
    return this.next(start, startDistance2);
  }

  next(start = "A", startDistance2 = 0) {
    startDistance2 = Math.round(startDistance2);

    const m = this._next[start];
    if ( m.has(startDistance2) ) return m.get(startDistance2);

    const next = this._findNext(start, startDistance2);
    m.set(startDistance2, next);
    return next;
  }

  _findNext(start, startDistance2 = 0) {
    if ( !this.numIntersections ) return this._findNextFromEndpoint(start);
    return this._findNextFromIntersection(start, startDistance2);
  }

  processIntersections(wallTracerMap) {
    if ( !this.numIntersections || this._intersectionMap.size ) return;

    // Create a map of intersections
    // Key: intersection distance, rounded
    // Each intersection has a set of walls
    // Assume few intersections, so can sort keys on the fly
    const A = this.wall.A;
    const intersectingWallData = [...this.wall.intersectsWith.entries()].map(entry => {
      const [wall, ix] = entry;
      return {
        wall: wallTracerMap.get(wall),
        ix,
        dist: Math.round(PIXI.Point.distanceSquaredBetween(A, ix)) };
    });

    this._intersectionMap = groupBy(intersectingWallData, obj => obj.dist);
  }

  /**
   * Find the next wall in the clockwise direction from the endpoint.
   * @returns {WallTracer|null}
   */
  _findNextFromEndpoint(start) {
    const end = WallTracer.#oppositeEndpoint[start];
    const endpointWalls = this._endpointWalls[end];
    if ( !endpointWalls.size ) return null;

    const startEndpoint = this[start];
    const endEndpoint = this[end];
    const firstWall = endpointWalls.first();
    const firstEndpoint = endEndpoint.equals(firstWall.A) ? firstWall.B : firstWall.A;
    if ( endpointWalls.size === 1 ) {
      return { wall: firstWall, startingEndpoint: firstWall.otherEndpoint(firstEndpoint) }
    }

    let angle = angleBetweenPoints(startEndpoint, endEndpoint, firstEndpoint, { clockwiseAngle: true })
    const nextWall = endpointWalls.reduce((prev, curr) => {
      const currEndpoint = endEndpoint.equals(curr.A) ? curr.B : curr.A;
      const currAngle = angleBetweenPoints(startEndpoint, endEndpoint, currEndpoint, { clockwiseAngle: true });
      if ( currAngle < angle ) {
        angle = currAngle;
        return curr;
      }
      return prev;
    }, firstWall);

    return { wall: nextWall, startingEndpoint: nextWall.matchingEndpoint(endEndpoint) };
  }

  _findNextFromIntersection(start, startDistance2 = 0) {
    if ( !this.numIntersections ) return null;
    if ( !this._intersectionMap.size ) {
      console.warn("Need to construct intersection map first.");
      return null;
    }

    const keys = [...this._intersectionMap.keys()];
    let flipKeys = start === "B";
    if ( flipKeys ) {
      keys.sort((a, b) => b - a);
      startDistance2 = Math.pow(PIXI.Point.distanceBetween(this.A, this.B) - Math.sqrt(startDistance2), 2);
    } else keys.sort((a, b) => a - b);



    const startEndpoint = this[start];

    for ( const key of keys ) {
      const ignoreKey = flipKeys ? key >= startDistance2 : key <= startDistance2;
      if ( ignoreKey ) continue;
      const intersectingWalls = this._intersectionMap.get(key);
      const clockwise = intersectingWalls.reduce((prev, curr) => {
        let startingEndpoint = curr.wall.A;
        let angle = angleBetweenPoints(startEndpoint, curr.ix, curr.wall.B, { clockwiseAngle: true });

        if ( points2dAlmostEqual(curr.wall.A, curr.ix) ) {
          // Aready set above; do nothing

        } else if ( points2dAlmostEqual(curr.wall.B, curr.ix) ) {
          angle = angleBetweenPoints(startEndpoint, curr.ix, curr.wall.A, { clockwiseAngle: true });
          startingEndpoint = curr.wall.B;
        } else {
          const angleA = angleBetweenPoints(startEndpoint, curr.ix, curr.wall.A, { clockwiseAngle: true });
          const angleB = angle;
          angle = Math.min(angleA, angleB);
          startingEndpoint = angleA < angleB ? curr.wall.B : curr.wall.A;
        }

        if ( prev.angle < angle ) return prev;
        return { wall: curr.wall, angle, ix: curr.ix, startingEndpoint };
      }, { wall: this, angle: Math.PI});

      if ( clockwise.wall !== this ) return clockwise;
    }

    // None of the intersections work, so the next wall must be from the endpoint.
    // This should only happen if the intersection(s) are at an endpoint for the
    // other intersecting wall(s).
    return this._findNextFromEndpoint(start);
  }

}
