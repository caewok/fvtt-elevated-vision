

/*

Class with methods to link and trace walls
-- Find the cw and ccw endpoints to an origin point
-- Find and track walls that share endpoints
-- Organize walls that share intersections
-- Given a starting endpoint for the wall, get the point found by turning right either
   at an intersection or the endpoint.
*/

import { groupBy } from "./utils.js";

class WallTracer {
  static #oppositeEndpoint = { A: "B", B: "A" }

  _endpointWalls = { A: new Set(), B: new Set() };

  _intersectionMap = new Map();

  // Intersections are sorted from distance from A
  // Each element is a set of walls along with ix and distance
  _intersections = [];

  constructor(wall, origin) {
    this.origin = origin;
    this.wall = wall;
    this._setOrderedEndpoints();

    this._next = { A: undefined, B: undefined }
  }


  get wallKeys() { return this.wall.wallKeys; }

  get A() { return this.wall.A; }

  get B() { return this.wall.B; }

  get numIntersections() { return this.wall.intersectsWith.size; }


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
    const wtArray = [...walls];
    canvas.walls.placeables.forEach(w => {
      const wt = new WallTracer(w, origin);
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

    return WallTracerMap;
  }

  orderedEndpoints() {
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

    return { cw, ccw };
  }

  addEndpointConnections(other) {
    if ( this.wallKeys.has(other.A.key) ) other._endpointWalls.A.add(this);
    if ( this.wallKeys.has(other.B.key) ) other._endpointWalls.B.add(this);
    if ( other.wallKeys.has(this.A.key) ) this._endpointWalls.A.add(other);
    if ( other.wallKeys.has(this.B.key) ) this._endpointWalls.B.add(other);
  }

  get next(start = "A") {
    return this._next[start]
      || { this._next[start] = this._findNext(start) };
  }

  _findNext(start) {
    if ( !this.intersectsWith.size ) return this._findNextFromEndpoint(start);
    return this._findNextFromIntersection(start);

  }

  processIntersections(wallTracerMap) {
    if ( !this.numIntersections || this._intersectionMap.size ) return;

    // Create a map of intersections
    // Key: intersection distance, rounded
    // Each intersection has a set of walls
    // Assume few intersections, so can sort keys on the fly
    const intersectingWallData = [...wall.intersectsWith.entries()]
      .map(([wall, ix]) => {
        return { wallTracerMap.get(wall), ix, dist: Math.round(distanceSquaredBetweenPoints(origin, ix)) };
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
    const firstWall = endpointWalls.first;

    const firstEndpoint = endEndpoint.equals(firstWall[start]) ? firstWall[start] : firstWall[end];
    let angle = angleBetweenPoints(startEndpoint, endEndpoint, firstEndpoint);
    return endpointWalls.reduce((prev, curr) => {
      const currEndpoint = endEndpoint.equals(curr[start]) ? curr[start] : curr[end];
      const currAngle = angleBetweenPoints(startEndpoint, endEndpoint, currEndpoint);
      if ( currAngle < angle ) {
        angle = currAngle;
        return curr;
      };
      return prev;
    });
  }

  _findNextFromIntersection(start) {
    if ( !this.intersectsWith.size ) return null;
  }

}