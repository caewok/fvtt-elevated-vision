/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

/* Wall Geometry version 2
Track relationship between a single edge and a light source.
Also tracks connected edges used to determine shape of the penumbra.
Creates geometry used by the shader.
- Vertices of the penumbra triangle.
- Wall ratio to determine if fragment is in front of wall.
- Wall threshold information to determine if fragment is shaded.

Randomly samples points in the light sphere to create the shadow.
*/

import { MODULE_ID } from "../const.js";
import { Draw } from "../geometry/Draw.js";

/** @type {enum} CORNERS */
// const TL = 0;
// const TR = 1;
// const BR = 2;
// const BL = 3;

export class SourceShadowSingleWallGeometry extends PIXI.Geometry {

  /** @type {PointSource} */
  source;

  /** @type {Edge} */
  edge;

  /**
   * Edges currently connected to this edge's A endpoint.
   * @type {{ a: Set<Edge>, b: Set<Edge> }}
   */
  linkedEdges = { a: new Set(), b: new Set() };

  // ----- NOTE: Instantiation ----- //

  /** @type {boolean} */
  #initialized = false;

  get initialized() { return this.#initialized; }

  /**
   * Initialize the shadow properties for this source.
   */
  initialize(source, edge) {
    if ( this.#initialized ) return;
    this.source = source;
    this.edge = edge;
    this.constructWallGeometry();
    this.#initialized = true;
  }

  // ----- NOTE: Getters / Setters ----- //

  /** @type {string} */
  get sourceType() { return this.source.constructor.sourceType; }

  /** @type {Point3d} */
  get sourceOrigin() { return CONFIG.GeometryLib.threeD.Point3d.fromPointSource(this.source); }

  /** @type {number} */
  get canvasElevation() { return 0; } // TODO: Make variable.

  /** @type {Plane} */
  get canvasPlane() {
    const { Point3d, Plane } = CONFIG.GeometryLib.threeD;
    const planeNormal = new Point3d(0, 0, 1.0);
    const planePoint = new Point3d(0, 0, this.canvasElevation);
    return new Plane(planePoint, planeNormal);
  }

  /** @type {number} */
  get edgeTopZ() { return CONFIG.GeometryLib.utils.gridUnitsToPixels(this.edge.elevationLibGeometry.a.top ?? 1e08); }

  /** @type {number} */
  get edgeBottomZ() { return CONFIG.GeometryLib.utils.gridUnitsToPixels(this.edge.elevationLibGeometry.a.bottom ?? 1e08); }

  /** @type {PIXI.Point} */
  get edgeMid() { this.edge.a.add(this.edge.b).multiplyScalar(0.5); }

  /** @type {WallStruct} */
  get wall() {
    const endpointsXY = [this.edge.a, this.edge.b];
    const closerIdx = this.closerEndpoint(endpointsXY);
    const xyCloser = endpointsXY[closerIdx];
    const xyFurther = endpointsXY[1 - closerIdx];
    const direction = normalizedDirection(xyCloser, xyFurther);
    const topZ = this.edgeTopZ;
    const bottomZ = this.edgeBottomZ;
    return {
      top: [new Point3d(xyCloser.x, xyCloser.y, topZ), new Point3d(xyFurther.x, xyFurther.y, topZ)],
      bottom: [new Point3d(xyCloser.x, xyCloser.y, bottomZ), new Point3d(xyFurther.x, xyFurther.y, bottomZ)],
      mid: xyCloser.add(xyFurther).multiplyScalar(0.5),
      direction
    };
  }

  /**
   * Determine the closer and further endpoints.
   * @param {PIXI.Point[2]} pts
   * @returns {number} Index for the closer endpoint.
   */
  closerEndpoint(pts) {
    // Closer endpoint can be determined with relation to the light center.
    const d0 = PIXI.Point.distanceSquared(pts[0], this.source);
    const d1 = PIXI.Point.distanceSquared(pts[1], this.source);
    return Number(d1 < d0);
  }


  // ----- NOTE: Geometry ----- //

  /**
   * Calculate the wall geometry for this source.
   * The base assumes a single shadow from the light center.
   * @param {Point3d[]} [samples = this.sourceOrigin]     The points within the light to use
   */
  constructWallGeometry(samples = [this.sourceOrigin]) {
    const nSamples = samples.length;

    // Add index.
    this.addIndex(Array.fromRange(nSamples * 3)); // Number of sample triangles; 3 vertices each.

    // Build a shadow triangle using sampled points within the light sphere.
    const vertices = Array(nSamples * 3 * 2); // For each vertex: x,y
    const edgeDist = Array(nSamples * 3);
    this.#updateVertices(samples, vertices, edgeDist);

    // Add the data to the buffer.
    this.addAttribute("aVertex", vertices, 2);
    this.addAttribute("aEdgeDist", edgeDist, 1);
  }

  /**
   * Resample and update the vertices and associated distances from the edge.
   * @param {Point3d[]} samples     The points within the light to use
   * @param {number[]} vertices     Array or buffer array of vertices
   * @param {number[]} edgeDist     Array or buffer array of edge distance
   */
  #updateVertices(samples, vertices, edgeDist) {
    const {a, b} = this.edge;
    const l = Ray2d.normalized(a, b);
    const nSamples = edgeDist.length / 3;
    for ( let i = 0; i < nSamples; i += 1 ) {
      const vIdx = i * 3 * 2;
      const eIdx = i * 3;
      const [A, B, C] = this.shadowTriangle(samples[i]);

      // Determine the ∆ABC vertices
      vertices[vIdx] = A.x;
      vertices[vIdx + 1] = A.y;
      vertices[vIdx + 2] = B.x;
      vertices[vIdx + 3] = B.y;
      vertices[vIdx + 4] = C.x;
      vertices[vIdx + 5] = C.y;

      // Determine distance from the wall for each vertex.
      edgeDist[eIdx] = -distanceToLine(A, l);
      edgeDist[eIdx + 1] = distanceToLine(B, l);
      edgeDist[eIdx + 2] = distanceToLine(C, l);
    }
  }

  /**
   * For a given light center, determine the shadow triangle.
   * @param {Point3d} A     The assumed center point of the light
   * @returns {PIXI.Point[3]}  Triangle, from center through endpoint a and then endpoint b.
   */
  shadowTriangle(A) {
    const { a, b } = this.edge;
    const topZ = CONFIG.GeometryLib.utils.gridUnitsToPixels(this.edge.elevationLibGeometry.a.top ?? 1e08);
    const A2d = A.to2d();
    if ( !foundry.utils.orient2dFast(A2d, a, b).almostEqual(0) ) {
      // The triangle is a line.
      if ( this.isInfiniteShadow(A) ) {
        // Where A --> wall intersects the canvas edge.
        const rWall = Ray2d(A2d, a.subtract(A2d));
        const edge = this.whichCanvasEdge(rWall);
        const ix = new PIXI.Point();
        rWall.intersectPoints(edge.A, edge.B, ix);
        return [A2d, ix, ix];
      }
      // Where A --> further wall endpoint intersects the canvas plane.
      const furthestPoint = this.closerEndpoint([a, b]);
      const furthestPoint3d = new Point3d(furthestPoint.x, furthestPoint.y, this.edgeTopZ);
      const ixP = new Point3d();
      const hasFurthestPoint = this._furthestShadowPoint(A, furthestPoint3d, ixP); // Wall 1 is further.
      if ( !hasFurthestPoint ) new Error(`${MODULE_ID}|shadowTriangle|No furthest point found!`);
      return [A.xy, ixP.xy, ixP.xy];
    }

    // For infinite shadow, extend triangle formed by light point and wall to the edge of the canvas.
    if ( this.isInfiniteShadow(A) ) return this.extendTriangleToCanvasEdge([A2d, a, b]);

    // For non-infinite, intersect the canvas plane to determine extension point.
    const ixP = new CONFIG.GeometryLib.threeD.Point3d();
    const edgeMid = this.edgeMid;
    if ( !this._furthestShadowPoint(A, new Point3d(edgeMid.x, edgeMid.y, this.edgeTopZ), ixP) ) {
      return this.extendTriangleToCanvasEdge([A, a, b]);
    }
    const rWallIx = new Ray2d(ixP, b.subtract(a));
    const rAa = new Ray2d(A, a.subtract(A));
    const rAb = new Ray2d(A, b.subtract(A));
    const B = rWallIx.intersectRay(rAa);
    const C = rWallIx.intersectRay(rAb);
    return [A, B, C];
  }

  /**
   * Does this source cast an infinite shadow?
   * (Ray is rising as it moves from light --> wall.)
   * @param {vec3} samplePt   The sample point or direction
   * @returns {bool}
   */
  isInfiniteShadow(samplePt) { return samplePt.z <= this.edgeTopZ; }

  /**
   * The furthest point of the shadow when running a ray from the light through the
   * top midpoint of the wall.
   * @param {Point3d} samplePt      The sample point or direction
   * @param {Point3d} wallPt        Location on the wall to test
   * @param {out Point3d} ixP
   * @returns {bool};
   */
  _furthestShadowPoint(samplePt, wallPt, ixP) {
    const canvasPlane = this.canvasPlane;
    const ix = canvasPlane.rayIntersection(samplePt, wallPt.subtract(samplePt));
    if ( ix == null ) return false;
    ixP.copyFrom(ix);
    return true;
  }

  // ----- NOTE: Updates to geometry ----- //

  /**
   * Update based on indicated changes to the source.
   * @param {Set<string>} changes         Change keys for the source.
   * @returns {boolean} True if the indicated changes resulted in a change to the geometry.
   */
  sourceUpdated(changes) {
    const changed2dPosition = changes.has("x") || changes.has("y");
    const changedElevation = changes.has("elevation");
    const changedLightSize = changes.has("flags.elevatedvision.lightSize");
    if ( changed2dPosition || changedElevation || changedLightSize ) this._updateGeometry();
    return changed2dPosition || changedElevation;
  }

  /**
   * Update based on indicated changes to the edge.
   * @param {Set<string>} changes         Change keys for the source.
   * @returns {boolean} True if the indicated changes resulted in a change to the geometry.
   */
  edgeUpdated(changes) {
    const changedPosition = changes.has("c");
    const changedElevation = [
      "flags.wall-height.top",
      "flags.wall-height.bottom",
      "flags.elevatedvision.elevation.top",
      "flags.elevatedvision.elevation.bottom"].some(prop => changes.has(prop));
    if ( changedPosition || changedElevation ) this._updateGeometry();
    return changedPosition || changedElevation;
  }

  /**
   * Update the geometry for this source-edge relationship.
   * @param {Point3d[]} samples     Points within the light to use for the center point of ∆ABC
   */
  _updateGeometry(samples = [this.sourceOrigin]) {
    const vertices = this.getBuffer("aVertex").data;
    const edgeDist = this.getBuffer("aEdgeDist").data;
    this.#updateVertices(samples, vertices, edgeDist);
  }

  // ----- NOTE: Utility methods ----- //

  /**
   * Given a triangle ∆ABC, construct a similar triangle such that B and C
   * fall on or outside the canvas edge, and BC is entirely on or outside the canvas edge.
   * @param {PIXI.Point[3]} tri     ∆ABC
   * @returns {PIXI.Point[3]} The adjusted triangl
   */
  extendTriangleToCanvasEdge(tri) {
    const [A, B, C] = tri;
    const AB = Ray2d.normalized(A, B);
    const AC = Ray2d.normalized(A, C);
    const canvasRay = this.infiniteShadowCanvasRay([AB, AC]);

    // Use the smaller triangle edge to intersect the canvas edge.
    const dist2AB = PIXI.Point.distanceSquaredBetween(A, B);
    const dist2AC = PIXI.Point.distanceSquaredBetween(A, C);
    const smallerAB = dist2AB < dist2AC;
    const smallerEdge = smallerAB ? AB : AC;
    const largerEdge = smallerAB ? AC : AB;
    const ixSmaller = smallerEdge.intersectRay(canvasRay);

    // Then connect using the B->C (or C->B) direction to the other triangle edge.
    const newBC = new Ray2d(ixSmaller, normalizedDirection(B, C));
    const ixLarger = largerEdge.intersectRay(newBC);
    if ( smallerAB ) return [A, ixSmaller, ixLarger];
    else return [A, ixLarger, ixSmaller];
  }

  /**
   * Determine which canvas edge a ray intersects.
   * Ray origin must be inside the canvas for this to work.
   * @param {Ray2d} r
   * @returns {object}
   * - @param {PIXI.Point} A
   * - @param {PIXI.Point} B
   */
  whichCanvasEdge(r) {
    const quad = this.directionalQuadrant(r.direction);

    // Scene Rect has edges CW from TL. (TL -> TR -> BR -> BL)
    // A ray of a given direction only has two edges that it could conceivably hit.
    const edges = [...canvas.dimensions.rect.iterateEdges()];
    const idx0 = (quad + 4 - 1) % 4; // Quad - 1
    const edge0 = edges[idx0];
    const edge1 = edges[quad];
    const ix0 = r.intersectPoints(edge0.A, edge0.B);
    const ix1 = r.intersectPoints(edge1.A, edge1.B);
    if ( ix0 && (!ix1 || ix0.t0 < ix1.t0) ) return edge0;
    return edge1;
  }

  /**
   * What quadrant does this direction end up in?
   * Assumes the origin is within a rectangle and the vector is moving in direction.
   * @param {PIXI.Point} direction
   * @returns {CORNERS}
   */
  directionalQuadrant(direction) {
    /*
    Treat as centered: tl --> tr --> 0 <-- br <-- bl
    tl: -1 * 2 + -1 * -.5 = -1.5 + 1.5 = 0
    tr: -1 * 1 + -1 * -.5 = -.5 + 1.5 = 1
    br: 1 * 1 + 1 * -.5 = .5 + 1.5 = 2
    bl: 1 * 2 + 1 * -.5 = 1.5 + 1.5 = 3
    t|b * l|r + t|b * -.5
    t = -1
    b = 1
    l = 2
    r = 1
    */

    const tb = ((direction.y < 0.0) * -2) + 1; // Options: t = 1 * -2 + 1; b = 0 * -2 + 1
    const lr = (direction.x < 0.0) + 1; // Options: l = 1 + 1; r = 0 + 1
    return (tb * lr) + (tb * -0.5) + 1.5;

    // Original approach:
    // if ( direction.x > 0.0 ) return direction.y > 0.0 ? BR : TR;
    // Moving left. x <= 0.0.
    // return direction.y > 0.0 ? BL : TL;
  }

  /**
   * For infinite wall shadow, point outside of canvas that can be the fake floor intersection.
   * Either a point on the 45º line at a scene corner or a scene edge point.
   * @param {Ray2d[2]}
   * @returns {Ray2d}
   */
  infiniteShadowCanvasRay(lightRays) {
    // What edge does each ray hit?
    const edge0 = this.whichCanvasEdge(lightRays[0]);
    const edge1 = this.whichCanvasEdge(lightRays[1]);
    if ( edge0.A.equals(edge1.A) ) return new Ray2d(edge0.A, edge0.B.subtract(edge0.A)); // For scene edges, origin is distinct (1 of 4 corners).

    // Rays hit two distinct edges.
    // If the edges intersect:
    // Use an ray that intersects the corner perpendicular to the midpoint of the two rays.
    // (This prevents the connecting ray from hitting the canvas or intersecting at the
    // wrong side of the light rays.)
    const midDir = lightRays[0].direction.add(lightRays[1].direction).multiplyScalar(0.5);
    const ix = foundry.utils.lineLineIntersection(edge0.A, edge0.B, edge1.A, edge1.B);
    if ( ix ) return new Ray2d(ix, PIXI.Point._tmp.set(midDir.y, -midDir.x));

    // The rays are striking parallel edges. Test quadrants to determine edge vs corner.
    const quad0 = this.directionalQuadrant(lightRays[0].direction);
    const quad1 = this.directionalQuadrant(lightRays[1].direction);

    // If adjacent quadrants, use scene edge.
    if ( quad0 === ((quad1 + 1) % 4) // +3 equivalent to -1 + 4
      || quad0 === ((quad1 + 3) % 4) ) {
      const edge = this.whichCanvasEdge(new Ray2d(lightRays[0].origin, midDir));
      return new Ray2d(edge.A, edge.B.subtract(edge.A));
    }

    // Opposing quadrants; must use the corner.
    // if ( quad0 === ((quad1 + 2) % 4) ) corner = (quad0 + 1) % 4;
    const cornerIdx = this.directionalQuadrant(midDir);
    const origin = [...canvas.dimensions.rect.iteratePoints({ close: false })][cornerIdx];
    const direction = new PIXI.Point(midDir.y, -midDir.x);
    return new Ray2d(origin, direction);
  }

  // ----- NOTE: Cleanup ----- //

  /**
   * Remove links to large objects.
   */
  destroy() {
    this.source = null;
    this.edge = null;
    super.destroy();
  }

  // ----- NOTE: Debugging ----- //

  drawEdge() { Draw.segment(this.edge, { width: 2 }); }

  drawShadowTriangles(opts = {}) {
    const nSamples = this.indexBuffer.data.length / 3;
    opts.fillAlpha ??= 1.0 / nSamples;
    for ( let i = 0; i < nSamples; i += 1 ) this.drawShadowTriangle(i, opts);
  }

  drawShadowTriangle(idx, opts = {}) {
    opts.color ??= Draw.COLORS.gray;
    opts.fill ??= Draw.COLORS.gray;
    opts.fillAlpha ??= 0.5;
    const buffer = this.getBuffer("aVertex").data;
    const poly = new PIXI.Polygon(...buffer.slice(idx * 6, (idx * 6) + 6));
    Draw.shape(poly, opts);
  }

}
export class PointSourceShadowSingleWallGeometry extends SourceShadowSingleWallGeometry {
  // ----- NOTE: Getters / Setters ----- //

  /** @type {number} */
  get sourceSize() { return this.source.data.lightSize; }

  /** @type {WallStruct} */
  get wall() {
    const wall = super.wall;
    // TODO: Implement shrinking overlapping wall.
    // return this.#shrinkOverlappingWall(wall);
  }

  /**
   * Shrink wall to avoid overlap with light.
   * If a wall endpoint is within the light and the light center is not between the
   * endpoints, shrink the wall so it is just outside the light.
   * This avoids the light failing to display if overlapping the wall to the right/left.
   * If between the endpoints, calculateSideShadowRays will move the light accordingly.
   * @param {Wall} wall
   * @returns {Wall}
   */
//   #shrinkOverlappingWall(wall) {
//     const ixs = [vec2(), vec2()]; // @type {vec2[2]};
//     const numIxs = quadraticIntersection(wall.top[0].xy, wall.top[1].xy, uLightPosition.xy, uLightSize, 1.0e-06, ixs);
//     if ( numIxs === 1 ) {
//       // Determine where the intersection is on the wall. By definition, it is the closer endpoint.
//       // const containedIdx = circleContainsPoint(uLightPosition.xy, uLightSize, endpointsXY[0]) ? 0 : 1;
//
//       // Move pixel away to be outside the circle.
//       const newIx = projectRay(Ray2d(ixs[0], normalizedDirection(ixs[0], xyFurther)), 1.0);
//
//       // Update wall data.
//       wall.top[0].xy = newIx.xy;
//       wall.bottom[0].xy = newIx.xy;
//       wall.mid = wall.top[0].xy.add(wall.top[1].xy).multiplyScalar(0.5),
//       // wall.direction = normalizedDirection(wall.top[0].xy, wall.top[1].xy); // Should not change.
//     }
//     return wall;
//   }

  // ----- NOTE: Geometry ----- //

  /**
   * Calculate the wall geometry for this source.
   * The base assumes a single shadow from the light center.
   */
  constructWallGeometry() {
    const samples = this.lightSamplePoints();
    super.constructWallGeometry(samples);
  }

  /**
   * Random points on the light sphere used for sampling the shadow triangles.
   * @returns {Point3d[]}
   */
  lightSamplePoints(nSamples = CONFIG[MODULE_ID].webGLShadowSamples) {
    const samples = Array(nSamples);
    for ( let i = 0; i < nSamples; i += 1 ) samples[i] = this.randomPointOnLight();
    return samples;
  }

  /**
   * Sample from the light sphere.
   * @returns {Point3d}
   */
  randomPointOnLight() {
    return randomSphereCoordinate().multiplyScalar(this.sourceSize).add(this.sourceOrigin);
  }

  // ----- NOTE: Updates to geometry ----- //

  /**
   * Update the geometry for this source-edge relationship.
   */
  _updateGeometry() {
    const samples = this.lightSamplePoints();
    super._updateGeometry(samples);
  }

  // ----- NOTE: Debugging ----- //

  /**
   * Draw the light sphere as a 2d circle on the canvas.
   */
  drawLight() {
    const light = new PIXI.Circle(this.sourceOrigin.x, this.sourceOrigin.y, this.sourceSize);
    Draw.shape(light, { color: Draw.COLORS.yellow, fillColor: Draw.COLORS.yellow, fillAlpha: 0.5 });
  }

}

export class DirectionalSourceShadowSingleWallGeometry extends SourceShadowSingleWallGeometry {

}

// ----- NOTE: Helper functions ----- //

/**
 * Volume of a sphere
 * @param {number} radius
 * @returns {number}
 */
function sphereVolume(radius) { return (4/3) * Math.PI * Math.pow(radius, 3); }

/**
 * Normal distribution with mean 0 and standard deviation 1.
 * See https://stackoverflow.com/questions/25582882/javascript-math-random-normal-distribution-gaussian-bell-curve
 * Use Box-Muller transform with resampling of values outside 0/1.
 * @returns {number[2]} Number between ~ -4 to 4, concentrated in -3 to 3.
 */
function randNormal() {
  // Use cartesian coordinate version.
  // https://en.wikipedia.org/wiki/Box–Muller_transform
  const u1 = 1 - Math.random(); // Converting [0,1) to (0,1]
  const u2 = 1 - Math.random();
  const mult = Math.sqrt(-2 * Math.log(u1));
  const u2Pi = Math.PI * 2 * u2;
  return mult * Math.cos(u2Pi);
}

function randNormalDual() {
  // Use cartesian coordinate version.
  // https://en.wikipedia.org/wiki/Box–Muller_transform
  const u1 = 1 - Math.random(); // Converting [0,1) to (0,1]
  const u2 = 1 - Math.random();
  const mult = Math.sqrt(-2 * Math.log(u1));
  const u2Pi = Math.PI * 2 * u2;
  return [
    mult * Math.cos(u2Pi),
    mult * Math.sin(u2Pi)
  ];
}

function randNormalPolarDual() {
  // Use polar coordinate version.
  // https://en.wikipedia.org/wiki/Box–Muller_transform
  let s;
  let u;
  let v;
  do {
    u = (Math.random() * 2) - 1; // Change to [-1, 1]
    v = (Math.random() * 2) - 1;
    s = Math.pow(u, 2) + Math.pow(v, 2);
  } while ( s > 1 );

  const mult = Math.sqrt((-2 * Math.log(s)) / s);
  return [u * mult, v * mult];
}


/* Nearly equivalent in speed, surprisingly.
N = 100000
await foundry.utils.benchmark(randNormal, N)
await foundry.utils.benchmark(randNormalDual, N)
await foundry.utils.benchmark(randNormalPolarDual, N)
await foundry.utils.benchmark(randNormal, N)
await foundry.utils.benchmark(randNormalDual, N)
await foundry.utils.benchmark(randNormalPolarDual, N)
await foundry.utils.benchmark(randNormal, N)
await foundry.utils.benchmark(randNormalDual, N)
await foundry.utils.benchmark(randNormalPolarDual, N)
*/

/**
 * Random point on the unit sphere.
 * See https://karthikkaranth.me/blog/generating-random-points-in-a-sphere/
 * @returns {Point3d}
 */
export function randomSphereCoordinate() {
  // Pick three normally distributed numbers and normalize the vector resulting from these numbers.
  // Then scale by the cube root of a uniformly chosen random number for the radius.
  const radius = Math.random();
  let [x1, x2] = randNormalDual();
  let x3 = randNormal();
  const mag = Math.hypot(x1, x2, x3); // Equals Math.sqrt((x1 * x1) + (x2 * x2)+ (x3 * x3));
  x1 /= mag;
  x2 /= mag;
  x3 /= mag;
  const c = Math.cbrt(radius);
  return new CONFIG.GeometryLib.threeD.Point3d(x1 * c, x2 * c, x3 * c);
}

/**
 * Normalized direction for points A->B
 * @param {PIXI.Point|Point3d} a
 * @param {PIXI.Point|Point3d} b
 * @param {PIXI.Point|Point3d} outPoint
 * @returns {PIXI.Point|Point3d} The outPoint, modified to be the normalized direction.
 */
export function normalizedDirection(a, b, outPoint) {
  outPoint ??= new a.constructor();
  b.subtract(a, outPoint).normalize(outPoint);
  return outPoint;
}

/**
 * Cross x and y parameters.
 * @param {PIXI.Point} a  First vector
 * @param {PIXI.Point} b  Second vector
 * @returns {float} The cross product
 */
function cross2d(a, b) { return (a.x * b.y) - (a.y * b.x); }

/**
 * Calculate barycentric position within a given triangle
 * For point p and triangle abc, return the barycentric point.
 * @param {Point3d|PIXI.Point} p
 * @param {Point3d|PIXI.Point} a
 * @param {Point3d|PIXI.Point} b
 * @param {Point3d|PIXI.Point} c
 * @returns {Point3d}
 */
function barycentric(p, a, b, c) {
  const v0 = b.subtract(a); // Fixed for given triangle.
  const v1 = c.subtract(a); // Fixed for given triangle.
  const v2 = p.subtract(a);

  const d00 = v0.dot(v0); // Fixed for given triangle
  const d01 = v0.dot(v1); // Fixed for given triangle
  const d11 = v1.dot(v1); // Fixed for given triangle
  const d20 = v2.dot(v0);
  const d21 = v2.dot(v1);

  const denom = ((d00 * d11) - (d01 * d01));
  if ( !denom ) return new CONFIG.GeometryLib.threeD.Point3d(-1.0, -1.0, -1.0);

  const denomInv = 1.0 / denom; // Fixed for given triangle
  const v = ((d11 * d20) - (d01 * d21)) * denomInv;
  const w = ((d00 * d21) - (d01 * d20)) * denomInv;
  const u = 1.0 - v - w;
  return new CONFIG.GeometryLib.threeD.Point3d(u, v, w);
}

/**
 * Closest point to a line.
 * @param {PIXI.Point} c
 * @param {Ray2d} l
 * @returns {PIXI.Point}
 */
function closest2dPointToLine(c, l) {
  const denom = l.direction.dot(l.direction);
  if ( denom === 0.0 ) return c;

  const deltaCA = c.subtract(l.origin);
  const u = deltaCA.dot(l.direction) / denom;
  return l.origin.add(l.direction.multiplyScalar(u));
}

/**
 * Distance to the closest point to a line.
 * @param {PIXI.Point} c
 * @param {Ray2d} l
 * @returns {number}
 */
export function distanceToLine(c, l) {
  const ix = closest2dPointToLine(c, l);
  return PIXI.Point.distanceBetween(c, ix);
}

/**
 * Represent a two-dimensional ray.
 */
export class Ray2d {
  /** @type {PIXI.Point} */
  origin = new PIXI.Point();

  /** @type {PIXI.Point} */
  direction = new PIXI.Point();

  /**
   * @param {Point} origin
   * @param {Point} direction
   */
  constructor(origin, direction) {
    this.origin.copyFrom(origin);
    this.direction.copyFrom(direction);
  }

  /**
   * @param {PIXI.Point} a
   * @param {PIXI.Point} b
   * @returns {Ray2d}
   */
  static normalized(a, b) {
    const dir = PIXI.Point._tmp3;
    normalizedDirection(a, b, dir);
    return new this(a, dir);
  }

  /**
   * Intersect this ray with another.
   * @param {Ray2d} other
   * @returns {number|null} T value along this ray or null if no intersection.
   */
  intersectRayT(other) {
    const denom = cross2d(this.direction, other.direction);

    // If lines are parallel, no intersection.
    if ( denom.almostEqual(0) ) return null;
    const diff = this.origin.subtract(other.origin);
    return cross2d(other.direction, diff) / denom;
  }

  /**
   * Intersect this ray with another.
   * @param {Ray2d} other
   * @param {PIXI.Point} [ix]     Where to store the intersection
   * @returns {PIXI.Point|null}     The intersection t or null if none.
   */
  intersectRay(other, ix) {
    ix ??= new PIXI.Point();
    const t = this.intersectRayT(other);
    if ( t !== null ) return this.origin.add(this.direction.multiplyScalar(t, ix), ix);
    return null;
  }

  /**
   * Intersect this ray with a line represented by two points.
   * @param {PIXI.Point} a
   * @param {PIXI.Point} b
   * @param {PIXI.Point} [ix]     Where to store the intersection
   * @returns {PIXI.Point|null}
   */
  intersectPoints(a, b, ix) {
    const rAB = new this.constructor(a, b.subtract(a, PIXI.Point._tmp3));
    return this.intersectRay(rAB, ix);
  }

  /**
   * Project the ray.
   * @param {number} t
   * @param {PIXI.Point} outPoint
   * @returns {PIXI.Point} outPoint, for convenience
   */
  project(t, outPoint) {
    outPoint ??= new PIXI.Point();
    return this.origin.add(this.direction.multiplyScalar(t, outPoint), outPoint);
  }
}

/** Testing single shadow
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
SourceShadowWallGeometry2 = api.testing.SourceShadowWallGeometry2
l = canvas.lighting.placeables[0];
edge0 = canvas.walls.placeables[0].edge
geom = new SourceShadowWallGeometry2(l.lightSource, edge0)
*/

/** Testing sized shadow
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
SizedSourceShadowWallGeometry2 = api.testing.SizedSourceShadowWallGeometry2
l = canvas.lighting.placeables[0];
edge0 = canvas.walls.placeables[0].edge
geom = new SizedSourceShadowWallGeometry2(l.lightSource, edge0)
geom.drawLight()
geom.drawShadowTriangles({ width: 0})
geom.drawEdge()

*/
