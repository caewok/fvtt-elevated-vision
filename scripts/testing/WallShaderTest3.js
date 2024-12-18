/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI
*/
"use strict";

import { MODULE_ID } from "../const.js";
import { Draw } from "../geometry/Draw.js";
import { vec2, vec3, vec4 } from "./glsl_mock.js";
import * as glsl from "./glsl_mock.js";

const UMBRA = 0;
const PENUMBRA = 1;
const MIDPENUMBRA = 2; // So that vec2 can hold UMBRA/PENUMBRA

const TOP = 0;
const BOTTOM = 1;

const FAR = 0;
const NEAR = 1;

/* Mock shader calculations.
Use the fragment shader to test different rays back to the light for intersection with the wall

In vertex shader, prepare:
- vVertexPosition (fragment canvas location)
- vDistance (distance to the wall, negative if in front of wall)
- vTestDir (direction to test, starting with tangents)
- vUmbra (Triangle defining the umbra, so some tests can be skipped)
- vUmbra1 (for when umbra is a rectangle)

Flats:
- fTangentX, where X is 0 to ?. (Tangent point to the light)

In the fragment shader, test whether various rays from fragment location to light intersect wall.
- Test center
- Test tangents using the directional varyings
- Test random points within light sphere? Or stepped points around the sphere?

To check for intersection:
- Use orient to check the x/y location.
- Set x to distance and y to the elevation.
  (I.e., rotate so wall is vertical and rotate wall 90º so the z value becomes y)
- Use orient to check the dist/z location
- Average results.

- For linked walls, test quad for given shape. Need top, bottom, angle.
- Possibly use umbra triangle(s) to exclude x/y tests?
- Possibly test edge points first to exclude other tests?
*/

/*

Light 0/1: Two tangents to the light from endpoint 0 and endpoint 1.

Four intersections:
light0 --> endpoint0 x light0 --> endpoint1
light0 --> endpoint0 x light1 --> endpoint0
light1 --> endpoint0 x light1 --> endpoint1
light0 --> endpoint1 x light1 --> endpoint1

3 of 4 will definitely intersect. 4th may not intersect, may intersect, or may intersect on wrong side.
Closest to light is penumbra. Next two are side penumbra. 4th is umbra.

To determine near and far:
Using penumbra lines, measure from height of light center. Get two intersection points with plane.
(This avoids weird angles and shapes when wall is near-vertical to light.)
The midpenumbra-canvas ixs define direction.
Measure near far distance from mid-light through mid-wall. Intersect with umbra and penumbra
lines using the midpenumbra-canvas direction.
*/

/* Light-wall layouts:
3 vertices: light, ix for corner 1, ix for corner 2.

#1: Light size is smaller than wall.
light --> wall creates a large triangle with the point at the light.
Primary point is close to the light.
Side triangle from each endpoint extend out to form penumbra on either side.
Umbra is rest in middle (triangle from light, or trapezoid from wall).

#2: Light size equals wall.
light --> wall creates a rectangle.
Primary point of the penumbra triangle now halfway between light and wall.
But the further light point from each endpoint still creates a wide penumbra.
Side triangle from each endpoint forms penumbra (but triangle is a right triangle now).
Umbra is the middle.

#3: Light size larger than wall.
light --> wall creates inverted triangle for the umbra.
Primary point is now close to the wall.
Umbra still the middle but forms inverted triangle.
Side penumbra triangles now overlap.

For each scenario:
- Side penumbra outer triangle formed by far light point from endpoint 0 --> endpoint 0 --> canvas ix (penumbra line).
  Along with near light point from endpoint 0 --> endpoint 0 --> canvas ix (umbra line).
- Same for other side penumbra.
- Umbra is simply the part not contained in either side penumbra.

*/

/**
 * Framework shader class
 */
export class ShaderTest {

  // ----- NOTE: IN variables ----- //
  attributes = {};

  // ----- NOTE: UNIFORM variables ----- //

  uniforms = {};

  // ----- NOTE: Configuration ----- //
  config({ attributes = {}, uniforms = {} } = {}) {
    const iV = this.attributes;
    const uV = this.uniforms;
    for ( let [key, value] of Object.entries(attributes) ) {
      // Duplicate simple arrays to avoid inadvertently changing them.
      if ( Array.isArray(value) ) value = foundry.utils.duplicate(value);
      iV[key] = value;
    }
    for ( let [key, value] of Object.entries(uniforms) ) {
      // Duplicate simple arrays to avoid inadvertently changing them.
      if ( Array.isArray(value) ) value = foundry.utils.duplicate(value);
      uV[key] = value;
    }

    // For each uniform and attribute, create a getter to mimic the read-only nature of it.
    // Convert to a vector or float accordingly.
    const convertToVec = function(arr) {
      if ( !Array.isArray(arr) && !ArrayBuffer.isView(arr) ) return arr;
      switch ( arr.length ) {
        case 2: return vec2(...arr);
        case 3: return vec3(...arr);
        case 4: return vec4(...arr);
      }
    };
    for ( let [key, value] of Object.entries(attributes) ) {
      Object.defineProperty(this, key, { get: () => convertToVec(value) });
    }
    for ( let [key, value] of Object.entries(uniforms) ) {
      Object.defineProperty(this, key, { get: () => convertToVec(value) });
    }
  }

  // ----- NOTE: Factory methods ----- //

  duplicate() {
    const out = new this.constructor();
    out.config(this);
    return out;
  }

  static fromShader(shader) {
    const out = new this();
    out.config({ uniforms: shader.uniforms });
    return out;
  }

  static fromMesh(mesh) {
    // Handles only basic geometry.
    const out = [];
    const { geometry, shader } = mesh;
    const buffers = geometry.buffers;
    for ( const idx of geometry.indexBuffer.data ) {
      // Indices are repeated, so use every third.
      if ( idx % 3 !== 0 ) continue;

      const instance = this.fromShader(shader);
      out.push(instance);
      const attributes = {};
      for ( const [key, attribute] of Object.entries(geometry.attributes) ) {
        const { buffer, size } = attribute;
        switch ( size ) {
          case 1: attributes[key] = buffers[buffer].data[idx]; break;
          default: attributes[key] = buffers[buffer].data.slice(idx * size, (idx * size) + size);
        }
      }
      instance.config({ attributes });
    }
    return out;
  }

  /* ----- NOTE: Getters for vertex and fragment calculations ----- */

  static VARYINGS = [];

  static FLATS = [];

  /** @type {object} */
  get varyings() {
    const out = {};
    for ( const varying of this.constructor.VARYINGS ) out[varying] = this[varying];
    return out;
  }

  get flats() {
    const out = {};
    for ( const flat of this.constructor.FLATS ) out[flat] = this[flat];
    return out;
  }

  /* ----- NOTE: Vertex calculations ----- */
  gl_VertexID = 0;

  /**
   * Mimic calculations done in the vertex shader.
   */
  vertexCalculations(id) {
    if ( typeof id !== "undefined" ) this.gl_VertexID = id;
  }

  /* ----- NOTE: Fragment calculations ----- */
  vVertexPosition = vec2();

  /**
   * Calculate the varying variables based on a vVertexPosition value.
   */
  setVaryings(pt) {
    const { barycentric, interpolateBarycentric } = glsl;

    // Set the flat variables
    this.vertexCalculations(2);

    // Set location for the "fragment" shader.
    if ( typeof pt !== "undefined" ) this.vVertexPosition = vec2(pt.x, pt.y);

    // Construct three versions of the shader, one for each vertex.
    const shaders = Array(3);
    for ( let i = 0; i < 3; i += 1 ) {
      shaders[i] = this.duplicate();
      shaders[i].vertexCalculations(i);
    }

    // The penumbra triangle that defines this shader.
    const bary = barycentric(this.vVertexPosition,
      shaders[0].vVertexPosition,
      shaders[1].vVertexPosition,
      shaders[2].vVertexPosition);

    // Use barycentric coordinates to get the value of the vVertexPosition for each varying.
    const varying = {};
    for ( const varyingKey of this.constructor.VARYINGS ) {
      const a = shaders[0][varyingKey];
      const b = shaders[1][varyingKey];
      const c = shaders[2][varyingKey];
      this[varyingKey] = varying[varyingKey] = interpolateBarycentric(bary, a, b, c);
    }
    return varying;
  }

  /**
   * Mimic the fragment calculation for a given point.
   * @param {Point} pt          Fragment location on the canvas
   * @param {float} elevation   Assumed elevation, in grid units
   * @returns {vec4} For testing only, returns fragColor.
   */
  fragmentCalculations(pt) {
    this.setVaryings(pt);
    return vec4();
  }
}

/**
 * Extends the test shader with vertex and fragment functions shared among all the shaders.
 * In GLSL, these are in Shadow Vertex Functions, Shadow Vertex, Shadow Fragment Functions
 * and Shadow Fragment.
 */
export class PenumbraBasicTest extends ShaderTest {
  static VARYINGS = ["vVertexPosition", "vTerrainTexCoord", "vEdgeDist", "vWallRatio"];

  static FLATS = ["fWallSenseType", "fThresholdRadius2", "fWallRatio", "fWallHeights", "fNearRatios", "fFarRatios"];

  /* ----- NOTE: Constants ---- */

  static EV_ENDPOINT_LINKED_UNBLOCKED = -10.0;

  // From CONST.WALL_SENSE_TYPES
  static LIMITED_WALL = 10.0;

  static PROXIMATE_WALL = 30.0;

  static DISTANCE_WALL = 40.0;

  /* ----- NOTE: Simple functions ---- */

  /** @type {bool} */
  wallIsFloating() {
    const { aWallCorner1 } = this;
    const { canvasElevation } = this;
    const wallBottomZ = aWallCorner1.z;
    return wallBottomZ > canvasElevation;
  }

  /** @type {Plane} */
  constructCanvasPlane() {
    const { Plane } = glsl;
    const planeNormal = vec3(0.0, 0.0, 1.0);
    const planePoint = vec3(0.0, 0.0, this.canvasElevation);
    return Plane(planePoint, planeNormal);
  }

  /**
   * Does this directional vector cast an infinite shadow?
   * (Ray is rising as it moves from light --> wall.)
   * @param {vec3} lightDir
   * @returns {bool}
   */
  isInfiniteShadow(lightDir) { return lightDir.z >= 0.0 || glsl.almostEqual(lightDir.z, 0.0, 1.0e-06); }

  /**
   * What quadrant does this direction end up in?
   * @param {vec2} direction
   * @returns {int 0|1|2|3}
   */
  directionalQuadrant(direction) {
    const TL = 0;
    const TR = 1;
    const BR = 2;
    const BL = 3;

    // Direction is moving into one of 4 quadrants.
    if ( direction.x > 0.0 ) return direction.y > 0.0 ? BR : TR;

    // Moving left. x <= 0.
    return direction.y > 0.0 ? BL : TL;
  }

  /* ----- NOTE: Getters ---- */

  /** @type {float} */
  get canvasElevation() { return this.uElevationRes.x; }

  /** @type {float} */
  get maxR() {
    const uSceneDims = this.uSceneDims;
    return Math.sqrt((uSceneDims.z * uSceneDims.z) + (uSceneDims.w * uSceneDims.w));
  }

  maxR2() {
    const uSceneDims = this.uSceneDims;
    return (uSceneDims.z * uSceneDims.z) + (uSceneDims.w * uSceneDims.w);
  }

  /* @type {vec2[4]} */
  constructSceneRect() {
    const uSceneDims = this.uSceneDims;
    const TL = 0;
    const TR = 1;
    const BR = 2;
    const BL = 3;

    const sceneRect = Array(4); // @type vec2[4]
    sceneRect[TL] = vec2(0.0, 0.0);
    sceneRect[TR] = vec2((uSceneDims.x * 2.0) + uSceneDims.z, 0.0);
    sceneRect[BR] = vec2((uSceneDims.x * 2.0) + uSceneDims.z, (uSceneDims.y * 2.0) + uSceneDims.w);
    sceneRect[BL] = vec2(0.0, (uSceneDims.y * 2.0) + uSceneDims.w);
    return sceneRect;
  }

  /* ----- NOTE: Vertex calculations ----- */

  /**
   * @returns {Wall}
   */
  calculateWallPositions() {
    const { Wall, normalizedDirection } = glsl;
    const { aWallCorner0, aWallCorner1 } = this;

    const aTop = vec3(aWallCorner0.x, aWallCorner0.y, aWallCorner0.z);
    const bTop = vec3(aWallCorner1.x, aWallCorner1.y, aWallCorner0.z);
    const aBottom = vec3(aWallCorner0.x, aWallCorner0.y, aWallCorner1.z);
    const bBottom = vec3(aWallCorner1.x, aWallCorner1.y, aWallCorner1.z);
    const direction = normalizedDirection(aTop.xy, bTop.xy);

    return Wall({
      top: [aTop, bTop],
      bottom: [aBottom, bBottom],
      mid: aTop.xy.add(bTop.xy).multiplyScalar(0.5),
      direction
    });
  }

  /**
   * Line A-->wallMid, reversed such that it starts at the closest point on that line
   * to B of penumbra ∆ABC.
   * Used to calculate near/far shadows based on elevation (and in front/behind wall).
   * @param {Wall} wall
   * @param {vec2[3]} penumbraTri
   * @returns {Ray2d}
   */
  nearFarMidRay(wall, penumbraTri) {
    const { distanceSquared, normalizedDirection, Ray2d, lineLineIntersection } = glsl;

    const dist01 = distanceSquared(penumbraTri[0], penumbraTri[1]);
    const dist02 = distanceSquared(penumbraTri[0], penumbraTri[2]);
    const closerIdx = dist02 < dist01 ? 2 : 1;
    const lightRay2d = Ray2d(penumbraTri[0], normalizedDirection(penumbraTri[0], wall.mid));
    const closerIx = vec2();
    lineLineIntersection(lightRay2d, Ray2d(penumbraTri[closerIdx], wall.direction), closerIx);
    return Ray2d(closerIx, penumbraTri[0].subtract(closerIx));
  }

  /**
   * Calculate varying variables.
   * @param {Wall} wall
   * @param {vec2[3]} penumbraTri
   */
  defineSharedVaryings(wall, penumbraTri) {
    const { distanceToLine, normalizedDirection } = glsl;
    const { uSceneDims } = this;

    const vertexNum = this.gl_VertexID % 3;

    /** @type {vec2} vVertexPosition */
    this.vVertexPosition = penumbraTri[vertexNum];

    // Calculate the terrain texture coordinate at this vertex based on scene dimensions.
    // (vVertexPosition - uSceneDims.xy) / uSceneDims.zw
    // @type {vec2} vTerrainTexCoord
    this.vTerrainTexCoord = (this.vVertexPosition.subtract(uSceneDims.xy)).divide(uSceneDims.zw);

    // In shader:
    // gl_Position = vec4((projectionMatrix * translationMatrix * vec3(this.vVertexPosition, 1.0)).xy, 0.0, 1.0);

    // Used to determine in front of or behind wall.
    // Simpler than wall ratio, but may want to use that instead.
    this.vEdgeDist = distanceToLine(this.vVertexPosition, wall.top[0].xy, wall.direction);
    if ( vertexNum === 0 ) this.vEdgeDist *= -1.0;

    this.vWallRatio = this.varyingWallRatio(wall, penumbraTri);
  }

  /**
   * Basic flats used by all shaders to limit shadow.
   */
  defineSharedFlats(wall, penumbraTri) {
    const { aWallSenseType, aThresholdRadius2 } = this;
    const { DISTANCE, PROXIMATE } = CONST.WALL_SENSE_TYPES;

    // @type {float} fWallSenseType
    this.fWallSenseType = aWallSenseType;

    // @type {float} fThresholdRadius
    this.fThresholdRadius2 = !(aWallSenseType === DISTANCE || aWallSenseType === PROXIMATE)
      ? -1.0 : aThresholdRadius2;

    // @type {float} fWallRatio
    this.fWallRatio = this.flatWallRatio(wall, penumbraTri);

    // @type {vec2} fWallHeights
    this.fWallHeights = vec2();
    this.fWallHeights[TOP] = wall.top[0].z;
    this.fWallHeights[BOTTOM] = wall.bottom[0].z;

    // @type {vec2} fFarRatio, fNearRatio, using UMBRA, PENUMBRA.
    // Uses -1.0 to indicate no shadow.
    this.fFarRatios = vec2(-1.0, -1.0);
    this.fNearRatios = vec2(-1.0, -1.0);
  }

  /**
   * Define the varying wall ratio.
   * How far the vertex is along the line running from vertex 0 through mid-wall.
   * @param {Wall} wall
   * @param {vec2[3]} penumbraTri
   * @returns {float}
   */
  varyingWallRatio(wall, penumbraTri) {
    const { distanceSquared, normalizedDirection, Ray2d, lineLineIntersection, almostEqual } = glsl;
    const vertexNum = this.gl_VertexID % 3;

    // Define the wall ratio as 1 at the first vertex and 0 at the shorter of the two edges.
    // For the third, it is the value at the wall direction intersection with the line
    // from first vertex through the wall midpoint.
    if ( vertexNum === 0 ) return 1.0;

    // The closer vertex to the wall gets assigned 0.0.
    const dist01 = distanceSquared(penumbraTri[0], penumbraTri[1]);
    const dist02 = distanceSquared(penumbraTri[0], penumbraTri[2]);
    const closerIdx = dist02 < dist01 ? 2 : 1;
    if ( vertexNum === closerIdx ) return 0.0;

    // If the ray from further index along the wall direction intersects the nearer index,
    // it will also get assigned 0.0. Otherwise, it is some value smaller than 0,
    const wallRatioRay = this.nearFarMidRay(wall, penumbraTri);

    // Could use distance(closerIx, wallMid) / distance(closerIx, penumbraTri[0]).
    // That has 2 square root calcs but is otherwise simpler.
    const furtherT = lineLineIntersection(wallRatioRay, Ray2d(penumbraTri[vertexNum], wall.direction));

    // Often will be near zero (if penumbra triangle uses wall direction); round to zero.
    return almostEqual(furtherT, 0.0, 1.0e-06) ? 0.0 : furtherT;
  }

  /**
   * Define the flat wall ratio.
   * How far the wall along the line running from vertex 0 through mid-wall,
   * where 1.0 would be at vertex 0 and 0.0 would be at the closer of vertices 2 or 3.
   * @param {Wall} wall
   * @param {vec2[3]} penumbraTri
   * @returns {float}
   */
  flatWallRatio(wall, penumbraTri) {
    const { distanceSquared, normalizedDirection, Ray2d, lineLineIntersection } = glsl;

    const dist01 = distanceSquared(penumbraTri[0], penumbraTri[1]);
    const dist02 = distanceSquared(penumbraTri[0], penumbraTri[2]);
    const closerIdx = dist02 < dist01 ? 2 : 1;
    const lightRay = Ray2d(penumbraTri[0], normalizedDirection(penumbraTri[0], wall.mid));
    const closerIx = vec2();
    lineLineIntersection(lightRay, Ray2d(penumbraTri[closerIdx], wall.direction), closerIx);

    // Could use distance(closerIx, wallMid) / distance(closerIx, penumbraTri[0]).
    // That has a square root but is simpler.
    const wallRatioRay = Ray2d(closerIx, penumbraTri[0].subtract(closerIx));
    const furtherT = lineLineIntersection(wallRatioRay, Ray2d(wall.top[0].xy, wall.direction));
    return furtherT;
  }

  /**
   * Determine where a ray intersects the canvas edge.
   * @param {Ray2d} r
   * @returns {vec2}
   */
  canvasEdgeIntersection(r) {
    const { Ray2d, lineLineIntersection, projectRay, normalizedDirection } = glsl;

    // A ray of a given direction only has two edges that it could conceivably hit.
    // (Assuming it starts inside the rectangle.)
    const TL = 0;
    const TR = 1;
    const BR = 2;
    const BL = 3;
    const sceneRect = this.constructSceneRect(); // @type vec2[4]
    const quad = this.directionalQuadrant(r.direction);
    const idx0 = (quad === TL || quad === TR) ? TL : BR;
    const idx1 = (quad === TL || quad === BL) ? TL : TR;
    const edge0 = Ray2d(sceneRect[idx0], normalizedDirection(sceneRect[idx0], sceneRect[idx0 + 1]));
    const edge1 = Ray2d(sceneRect[idx1], normalizedDirection(sceneRect[idx1], sceneRect[idx1 + 1]));

    const t0 = lineLineIntersection(r, edge0);
    const t1 = lineLineIntersection(r, edge1);
    if ( t0 !== null && (t1 === null || t0 < t1) ) return projectRay(r, t0);
    return projectRay(r, t1);
  }

  /**
   * Determine what canvas edge a ray intersects.
   * @param {Ray2d} r
   * @returns {Ray2d}
   */
  whichCanvasEdge(r) {
    const { Ray2d, lineLineIntersection, projectRay, normalizedDirection } = glsl;

    // A ray of a given direction only has two edges that it could conceivably hit.
    // (Assuming it starts inside the rectangle.)
    const TL = 0;
    const TR = 1;
    const BR = 2;
    const BL = 3;
    const sceneRect = this.constructSceneRect(); // @type vec2[4]
    const quad = this.directionalQuadrant(r.direction);
    const idx0 = (quad === TL || quad === TR) ? TL : BR;
    const idx1 = (quad === TL || quad === BL) ? TL : TR;
    const edge0 = Ray2d(sceneRect[idx0], normalizedDirection(sceneRect[idx0], sceneRect[idx0 + 1]));
    const edge1 = Ray2d(sceneRect[idx1], normalizedDirection(sceneRect[idx1], sceneRect[idx1 + 1]));

    const t0 = lineLineIntersection(r, edge0);
    const t1 = lineLineIntersection(r, edge1);
    if ( t0 !== null && (t1 === null || t0 < t1) ) return edge0;
    return edge1;
  }

  /**
   * For infinite wall shadow, point outside of canvas that can be the fake floor intersection.
   * Either a point on the 45º line at a scene corner or a scene edge point.
   * @param {Ray2d[2]}
   * @returns {Ray2d}
   */
  infiniteShadowCanvasRay(lightRays) {
    const { Ray2d, lineLineIntersection, all, equal } = glsl;

    // What edge does each ray hit?
    const edge0 = this.whichCanvasEdge(lightRays[0]);
    const edge1 = this.whichCanvasEdge(lightRays[1]);
    if ( all(equal(edge0.origin, edge1.origin)) ) return edge0; // For scene edges, origin is distinct (1 of 4 corners).

    // Rays hit two distinct edges.
    const corner = vec2();
    const hasIx = lineLineIntersection(edge0, edge1, corner);
    const midDir = lightRays[0].direction.add(lightRays[1].direction).multiplyScalar(0.5);
    if ( hasIx ) {
      // Use an ray that intersects the corner perpendicular to the midpoint of the two rays.
      // (This prevents the connecting ray from hitting the canvas or intersecting at the
      // wrong side of the light rays.)
      const cornerDir = vec2(midDir.y, -midDir.x);
      return Ray2d(corner, cornerDir);
    }

    // The rays are striking parallel edges. Test quadrants to determine edge vs corner.
    const quad0 = this.directionalQuadrant(lightRays[0].direction);
    const quad1 = this.directionalQuadrant(lightRays[1].direction);

    // If adjacent quadrants, use scene edge.
    if ( quad0 === ((quad1 + 1) % 4) // +3 equivalent to -1 + 4
     || quad0 === ((quad1 + 3) % 4) ) return this.whichCanvasEdge(Ray2d(lightRays[0].origin, midDir));

    // Opposing quadrants; must use the corner.
    // if ( quad0 === ((quad1 + 2) % 4) ) corner = (quad0 + 1) % 4;
    const cornerIdx = this.directionalQuadrant(midDir);
    const cornerDir = vec2(midDir.y, -midDir.x);
    return Ray2d(this.constructSceneRect()[cornerIdx], cornerDir);
  }

  /**
   * Given a triangle ∆ABC, construct a similar triangle such that B and C
   * fall on or outside the canvas edge, and BC is entirely on or outside the canvas edge.
   * @param {vec2[3]} tri
   * @returns {vec2[3]} tri
   */
  extendTriangleToCanvasEdge(tri) {
    const { Ray2d, normalizedDirection, distanceSquared, lineLineIntersection } = glsl;

    // Edges A->B and A->C can intersect closest to the:
    // • same quadrant (1 point),
    // • adjacent quadrants (2 points), or
    // • opposing quadrants (3 points, middle one counts).
    const [A, B, C] = tri;
    const AB = Ray2d(A, normalizedDirection(A, B));
    const AC = Ray2d(A, normalizedDirection(A, C));
    const canvasEdge = this.infiniteShadowCanvasRay([AB, AC]);

    // Use the smaller triangle edge to intersect the canvas edge.
    const dist2AB = distanceSquared(A, B);
    const dist2AC = distanceSquared(A, C);
    const smallerAB = dist2AB < dist2AC;
    const smallerEdge = smallerAB ? AB : AC;
    const largerEdge = smallerAB ? AC : AB;
    const ixSmaller = vec2();
    lineLineIntersection(smallerEdge, canvasEdge, ixSmaller);

    // Then connect using the B->C (or C->B) direction to the other triangle edge.
    const newBC = Ray2d(ixSmaller, normalizedDirection(B, C));
    const ixLarger = vec2();
    lineLineIntersection(largerEdge, newBC, ixLarger);

    if ( smallerAB ) return [A, ixSmaller, ixLarger];
    else return [A, ixLarger, ixSmaller];
  }

  // ----- NOTE: Fragment calculations ----- //

  /**
   * Mimic the fragment calculation for a given point.
   * @param {Point} pt          Fragment location on the canvas
   * @param {float} elevation   Assumed elevation, in grid units
   * @returns {vec4} For testing only, returns fragColor.
   */
  fragmentCalculations(pt, elevation) {
    super.fragmentCalculations(pt);

    let fragColor = this.noShadow();
    if ( this.thresholdApplies() ) return 0.0;
    if ( this.inFrontOfWall() ) return 0.0;

    const shadow = this.shadowPercentage(pt, elevation);

    if ( shadow === 0.0 ) return fragColor;
    const totalLight = Math.clamp(0.0, 1.0, 1.0 - shadow);

    fragColor = this.lightEncoding(totalLight);
    return fragColor;
  }

  /**
   * For debugging
   * Determine the shadow components.
   */
  shadowComponents(pt, elevation) {
    // Define the placement of the fragment and calculate varying variables.
    this.setVaryings(pt);

    return { hasShadow: 1.0 };
  }

  /**
   * Elevate the near ratios.
   * @param {float} elevation     For debugging
   * @returns {vec2[2]}
   */
  elevateNearFarRatios(elevation) {
    const { any, notEqual } = glsl;
    const { uElevationRes } = this;

    let farRatios = vec2(this.fFarRatios);
    let nearRatios = vec2(this.fNearRatios);

    const hasFar = any(notEqual(this.fFarRatios, vec2(-1.0)));
    const hasNear = any(notEqual(this.fNearRatios, vec2(-1.0)));
    if ( hasFar || hasNear ) {
      farRatios = vec2(0.0);
      nearRatios = vec2(1.0);
      const canvasElevation = uElevationRes.x;
      if ( elevation !== canvasElevation ) {
        /* eslint-disable max-len */
        if ( hasFar ) {
          const farF = this.elevationHeightFraction(elevation, this.fWallHeights[TOP]);
          if ( this.fFarRatios[UMBRA] !== -1.0 ) farRatios[UMBRA] = this.elevateShadowRatio(farRatios[UMBRA], this.fWallRatio, farF);
          if ( this.fFarRatios[PENUMBRA] !== -1.0 ) farRatios[PENUMBRA] = this.elevateShadowRatio(farRatios[PENUMBRA], this.fWallRatio, farF);
        }
        if ( hasNear ) {
          const nearF = this.elevationHeightFraction(elevation, this.fWallHeights[BOTTOM]);
          if ( this.fNearRatios[UMBRA] !== -1.0 ) nearRatios[UMBRA] = this.elevateShadowRatio(nearRatios[UMBRA], this.fWallRatio, nearF);
          if ( this.fNearRatios[PENUMBRA] !== -1.0 ) nearRatios[PENUMBRA] = this.elevateShadowRatio(nearRatios[PENUMBRA], this.fWallRatio, nearF);
        }
        /* eslint-enable max-len */
      }
    }
    const res = [];
    res[NEAR] = nearRatios;
    res[FAR] = farRatios;
    return res;
  }

  /**
   * Determine the shadow percentage.
   * @returns {float}
   */
  shadowPercentage(pt, elevation) {
    if ( typeof elevation === "undefined" ) elevation = this.canvasElevation;
    else elevation = CONFIG.GeometryLib.utils.gridUnitsToPixels(elevation);
    const { uElevationRes, uLightPosition, uLightSize } = this;
    const { any, notEqual } = glsl;

    // Debugging
    this.setVaryings(pt);
    if ( this.thresholdApplies() ) return 0.0;
    if ( this.inFrontOfWall() ) return 0.0;

    const nfRatios = this.elevateNearFarRatios(); // @type vec2[2]
    const farRatios = nfRatios[FAR];
    const nearRatios = nfRatios[NEAR];
    if ( farRatios[PENUMBRA] !== -1.0 && this.vWallRatio < farRatios[PENUMBRA] ) return 0.0;
    if ( nearRatios[PENUMBRA] !== -1.0 && this.vWallRatio > nearRatios[PENUMBRA] ) return 0.0;

    // Debugging: Calculate the shadow components individually. In GLSL, multiply in this function.
    const components = this.shadowComponents(pt, elevation);
    return Object.values(components).reduce((acc, curr) => acc * curr);
  }

  /**
   * @param {bool} SHADOW   The #define SHADOW parameter
   * @returns {vec4}
   */
  noShadow(SHADOW = true) { return SHADOW ? vec4(0.0) : vec4(1.0); }

  /**
   * @param {float} light
   * @param {bool} SHADOW   The #define SHADOW parameter
   * @returns {vec4}
   */
  lightEncoding(light, SHADOW = true) {
    if ( light === 1.0 ) return this.noShadow(SHADOW);

    const ltd = this.fWallSenseType === this.constructor.LIMITED_WALL ? 1.0 : 0.0;
    const ltdInv = 1.0 - ltd;
    let c = vec4((light * ltdInv) + ltd, 1.0 - (0.5 * ltd), (light * ltd) + ltdInv, 1.0);

    // For testing, return the amount of shadow, which can be directly rendered to the canvas.
    // if ( light < 1.0 && light > 0.0 ) return vec4(0.0, 1.0, 0.0, 1.0);
    if ( SHADOW ) c = vec4(vec3(0.0), (1.0 - light) * 0.7);
    return c;
  }

  /**
   * @param {float} ratio
   * @param {float} wallRatio
   * @param {float} heightFraction
   * @returns {float}
   */
  elevateShadowRatio(ratio, wallRatio, heightFraction) {
    return ratio + (heightFraction * (wallRatio - ratio));
  }

  /**
   * @param {float} elevation
   * @param {float} wallHeight
   * @returns {float}
   */
  elevationHeightFraction(elevation, wallHeight) {
    const { uElevationRes } = this;
    const canvasElevation = uElevationRes.x;
    if ( elevation <= canvasElevation ) return 0.0;

    wallHeight = Math.max(wallHeight - canvasElevation, 0.0);
    if ( wallHeight === 0.0 ) return 0.0;

    const elevationChange = elevation - canvasElevation;
    return elevationChange / wallHeight;
  }


  /**
   * Determine if a threshold applies to this point.
   */
  thresholdApplies() {
    const { distanceSquared } = glsl;
    const { vVertexPosition } = this.varyings;
    const { fThresholdRadius2 } = this.flats;
    const { uLightPosition } = this;

    return fThresholdRadius2 > 0.0
      && distanceSquared(vVertexPosition, uLightPosition.xy) < fThresholdRadius2;
  }

  /**
   * Is the fragment location in front of the wall?
   * @returns {bool}
   */
  inFrontOfWall() { return this.varyings.vEdgeDist < 0.0; }

  inFrontOfWall2() { return this.flats.fWallRatio < this.varyings.vWallRatio; }

  // ----- NOTE: Drawings for debuggin ----- //

  drawWall() { Draw.segment({ a: this.wall.top[0], b: this.wall.top[1] }, { width: 2 }); }

  drawPenumbraTriangle() {
    const tri = this.penumbraTri;
    const poly = new PIXI.Polygon(...tri);
    Draw.shape(poly);
  }
}

/**
 * Extends the penumbra shader for unsized point source shadows.
 */
export class UnsizedShadowsTest extends PenumbraBasicTest {
  /* ----- NOTE: Vertex functions ----- */

  /**
   * Define the triangle for the unsized source.
   * Defined as the lines from the source through each endpoint.
   * Either intersecting the canvas or infinite, which is set off at the canvas edge.
   * @param {Wall} wall
   * @returns {vec2[3]}
   */
  definePenumbraTriangle(wall) {
    const { distanceSquared, normalizedDirection, Ray, Ray2d, lineLineIntersection, intersectRayPlane } = glsl;
    const { uLightPosition } = this;

    const A = uLightPosition.xy;
    const B = vec2();
    const C = vec2();
    const lightRay = Ray(uLightPosition, normalizedDirection(uLightPosition, wall.top[0]));

    // TODO: If ramp, could be infinite only from one endpoint.
    let closerIdx = 0;
    let r1 = Ray2d(vec2(), vec2());
    if ( this.isInfiniteShadow(lightRay.direction) ) {
      const lightRays2d = [
        Ray2d(uLightPosition.xy, normalizedDirection(uLightPosition.xy, wall.top[0].xy)),
        Ray2d(uLightPosition.xy, normalizedDirection(uLightPosition.xy, wall.top[1].xy))
      ];

      const canvasRay = this.infiniteShadowCanvasRay(lightRays2d); // @type Ray2d.

      // Go from closest endpoint to further endpoint.
      const dist0 = distanceSquared(wall.top[0].xy, uLightPosition.xy);
      const dist1 = distanceSquared(wall.top[1].xy, uLightPosition.xy);
      closerIdx = dist0 < dist1 ? 0 : 1;
      lineLineIntersection(
        canvasRay,
        Ray2d(uLightPosition.xy, normalizedDirection(uLightPosition.xy, wall.top[closerIdx].xy)),
        B);

    } else {
      // Use the canvas intersection.
      const canvasIx = vec3();
      const canvasPlane = this.constructCanvasPlane();
      intersectRayPlane(lightRay, canvasPlane, canvasIx);
      // Could do r1 = lightRays[1].to2d() which would do Ray2d(r1.origin, r1.direction.xy.normalize());
      // or could retrieve closest endpoint every time. Maybe even when defining the wall.

      r1 = Ray2d(uLightPosition.xy, normalizedDirection(uLightPosition.xy, wall.top[1].xy));
      B.set(canvasIx.xy, 0);
    }

    const canvasWallRay = Ray2d(B, wall.direction);
    r1 = Ray2d(uLightPosition.xy, normalizedDirection(uLightPosition.xy, wall.top[1 - closerIdx].xy));
    lineLineIntersection(canvasWallRay, r1, C);
    return [A, B, C];
  }

  /**
   * Define additional flats specific to this shader.
   * @param {Wall} wall
   * @param {vec2[3]} penumbraTri
   */
  defineFlats(wall, penumbraTri) {
    const { uLightPosition } = this;
    const { distanceSquared, normalizedDirection, Ray2d, Ray, lineLineIntersection, intersectRayPlane } = glsl;

    const dirFar = wall.top[0].subtract(uLightPosition);
    const dirNear = wall.bottom[0].subtract(uLightPosition);

    // Near/far ratios are same for PENUMBRA and UMBRA for unsized.
    if ( !this.isInfiniteShadow(dirFar) ) this.fFarRatios = vec2(0.0);
    if ( this.wallIsFloating() && !this.isInfiniteShadow(dirNear) ) {
      // Determine canvas intersection of the light ray running through wall midpoint.
      // See varyingWallRatio
      const lightRay = Ray(uLightPosition, normalizedDirection(uLightPosition, vec3(wall.mid, wall.bottom[0].z)));
      const canvasIx = vec3();
      const canvasPlane = this.constructCanvasPlane();
      intersectRayPlane(lightRay, canvasPlane, canvasIx);

      // Could use distance(closerIx, canvasIx.xy) / distance(closerIx, penumbraTri[0]).
      // That has a square root but is simpler. Might need negative distance though.
      const wallRatioRay = this.nearFarMidRay(wall, penumbraTri);
      const furtherT = lineLineIntersection(wallRatioRay, Ray2d(canvasIx.xy, wall.direction));
      this.fNearRatios = vec2(furtherT);
    }
  }

  /**
   * Mimic calculations done in the vertex shader.
   */
  vertexCalculations(id) {
    super.vertexCalculations(id);
    const vertexNum = this.gl_VertexID % 3;
    const wall = this.wall = this.calculateWallPositions();
    const penumbraTri = this.penumbraTri = this.definePenumbraTriangle(wall);
    this.defineSharedVaryings(wall, penumbraTri);
    if ( vertexNum === 2 ) {
      this.defineSharedFlats(wall, penumbraTri);
      this.defineFlats(wall, penumbraTri);
    }
  }
}

/**
 * Extends the penumbra shader for unsized point source shadows.
 */
export class SizedShadowsTest extends PenumbraBasicTest {
  /* ----- NOTE: Vertex functions ----- */

  /**
   * Build a light struct defining the key points of the light.
   * @returns {Light}
   */
  calculateLightPositions() {
    const { uLightSize, uLightPosition} = this;

    // Form a cross based on the light center.
    const top = uLightPosition.z + uLightSize;
    const bottom = uLightPosition.z - uLightSize;
    return glsl.Light({
      top: vec3(uLightPosition.xy, top),
      center: uLightPosition,
      bottom: vec3(uLightPosition.xy, bottom)
    });
  }

  /**
   * Locate the canvas intersection for a given direction.
   * If none, determine the infinite shadow canvas ray.
   * @param {vec3} nearFarDir           Typically farShadowDirs.penumbra
   * @param {Ray2d[2]} sidePenumbra      Typically sideShadowRays.penumbra
   * @param {Wall} wall
   * @param {out Ray2d} canvasRay
   * @returns {bool}
   */
  canvasIntersectionRay(nearFarDir, sidePenumbra, wall, canvasRay) {
    const { normalizedDirection, intersectRayPlane, Ray } = glsl;

    const canvasPlane = this.constructCanvasPlane();
    const canvasIx = vec3();
    if ( !this.isInfiniteShadow(nearFarDir)
      && intersectRayPlane(Ray(vec3(wall.mid, wall.top[0].z), nearFarDir), canvasPlane, canvasIx) ) {
      canvasRay.origin = canvasIx.xy;
      canvasRay.direction = wall.direction;
      return true;
    } else {
      const infCanvasRay = this.infiniteShadowCanvasRay(sidePenumbra);
      canvasRay.origin = infCanvasRay.origin;
      canvasRay.direction = infCanvasRay.direction;
      return false;
    }
  }


  /**
   * Direction toward the wall middle, used to measure far umbra line.
   * @param {Wall} wall
   * @param {Light} light
   * @returns {ShadowDirections}
   */
  calculateFarShadowDirections(wall) {
    const { normalizedDirection, ShadowDirections } = glsl;

    const light = this.light = this.calculateLightPositions();
    const wallMid = vec3(wall.mid, wall.top[0].z);
    return ShadowDirections({
      umbra: normalizedDirection(light.top, wallMid),
      midpenumbra: normalizedDirection(light.center, wallMid),
      penumbra: normalizedDirection(light.bottom, wallMid)
    });
  }

  /**
   * Direction toward the wall middle, used to measure near umbra line.
   * @param {Wall} wall
   * @param {Light} light
   * @returns {ShadowDirections}
   */
  calculateNearShadowDirections(wall) {
    const { normalizedDirection, ShadowDirections } = glsl;

    const light = this.light = this.calculateLightPositions();
    const wallMid = vec3(wall.mid, wall.top[0].z);
    return ShadowDirections({
      umbra: normalizedDirection(light.bottom, wallMid),
      midpenumbra: normalizedDirection(light.center, wallMid),
      penumbra: normalizedDirection(light.top, wallMid)
    });
  }

  /**
   * Offset the circle center from the wall by some distance.
   * If collinear with the wall, move in the direction of the wall but keep collinearity.
   * If non-collinear with the wall, move away from wall.
   * @param {Light} light
   * @param {Wall} wall
   * @param {float} d
   * @returns {vec2} New circle center
   */
  offsetLightFromWall(light, wall, d) {
    const { projectRay, Ray2d } = glsl;
    return projectRay(Ray2d(light.center.xy, vec2(wall.direction.y, -wall.direction.x)), d);
  }

  /**
   * Swap two indices in the tangent array.
   * @param {inout Ray2d[4]} tangentRays
   * @param {inout vec2[4]} projectedPoints
   * @param {int} idx0
   * @param {int} idx1
   */
  _cmpSwapTangentRays(tangentRays, projectedPoints, idx0, idx1) {
    const orient = foundry.utils.orient2dFast;

    if ( orient(tangentRays[idx0].origin, projectedPoints[idx0], projectedPoints[idx1]) > 0.0 ) {
      const tmpRay = tangentRays[idx0];
      tangentRays[idx0] = tangentRays[idx1];
      tangentRays[idx1] = tmpRay;
      const tmpVec = projectedPoints[idx0];
      projectedPoints[idx0] = projectedPoints[idx1];
      projectedPoints[idx1] = tmpVec;
    }
  }

  /**
   * Direction from light --> wall endpoint. Origin at the wall endpoint.
   * @param {Wall} wall
   * @param {Light} light
   * @returns {ShadowRays2d} Rays from the endpoint away from the light for umbra, mid, and penumbra.
   */
  calculateSideShadowRays(wall) {
    const orient = foundry.utils.orient2dFast;
    const max = Math.max;
    const { uLightSize } = this;
    const {
      almostEqual,
      normalizedDirection,
      tangentPoints,
      Ray2d,
      sameSide,
      closest2dPointToSegment,
      distanceToSegment,
      distanceSquared,
      lineLineIntersection,
      ShadowRays2d,
      Circle,
      distanceToLine,
      distanceSquaredToLine,
      projectRay,
      all,
      equal } = glsl;

    const light = this.light = this.calculateLightPositions();

    // Wall data.
    const wall0 = wall.top[0].xy;
    const wall1 = wall.top[1].xy;

    const midpenumbra = [
      Ray2d(wall0, normalizedDirection(light.center.xy, wall0)),
      Ray2d(wall1, normalizedDirection(light.center.xy, wall1)),
    ];

    // First determine the tangent points of the circle.
    const lightCir = Circle({
      center: light.center.xy,
      radius: uLightSize
    });
    const tangents0 = [lightCir.center, lightCir.center];
    const tangents1 = [lightCir.center, lightCir.center];
    tangentPoints(lightCir, wall0, tangents0);
    tangentPoints(lightCir, wall1, tangents1);

    // If the light overlaps the wall, the penumbra shoot straight out along the wall.
    // Redo the penumbra tangents by shrinking the light to be just smaller than distance to wall.
    const distToWall = distanceToSegment(light.center.xy, wall0, wall1);
    if ( distToWall <= uLightSize ) {
      const lightCirSmall = Circle({
        center: light.center.xy,
        radius: max(distToWall - 1.0, 0.0)
      });

      // If light center is on the wall, offset.
      if ( almostEqual(distToWall, 0.0, 1.0e-06) ) {
        lightCirSmall.center = this.offsetLightFromWall(light, wall, 0.5);
        midpenumbra[0].direction = normalizedDirection(lightCirSmall.center, wall0);
        midpenumbra[1].direction = normalizedDirection(lightCirSmall.center, wall1);
      }

      const tangents0sm = [lightCir.center, lightCir.center];
      const tangents1sm = [lightCir.center, lightCir.center];
      tangentPoints(lightCirSmall, wall0, tangents0sm);
      tangentPoints(lightCirSmall, wall1, tangents1sm);

      // Umbra are on the light center side.
      const oLight = orient(wall.top[0].xy, wall.top[1].xy, light.center.xy);
      const idxU0 = sameSide(wall.top[0].xy, wall.top[1].xy, oLight, tangents0[0]) ? 0 : 1;
      const idxU1 = sameSide(wall.top[0].xy, wall.top[1].xy, oLight, tangents1[0]) ? 0 : 1;

      // Penumbra are closest to the wall.
      const distToWall2_00 = distanceSquaredToLine(tangents0sm[0], wall0, wall.direction);
      const distToWall2_01 = distanceSquaredToLine(tangents0sm[1], wall0, wall.direction);
      const distToWall2_10 = distanceSquaredToLine(tangents1sm[0], wall0, wall.direction);
      const distToWall2_11 = distanceSquaredToLine(tangents1sm[1], wall0, wall.direction);
      const idxP0 = distToWall2_00 < distToWall2_01 ? 0 : 1;
      const idxP1 = distToWall2_10 < distToWall2_11 ? 0 : 1;
      tangents0[1] = tangents0[idxU0];
      tangents1[1] = tangents1[idxU1];
      tangents0[0] = tangents0sm[idxP0];
      tangents1[0] = tangents1sm[idxP1];
    }

    // Build the rays for each tangent to associate them with the correct wall point.
    const tangentRays = [
      Ray2d(wall0, normalizedDirection(tangents0[0], wall0)),
      Ray2d(wall0, normalizedDirection(tangents0[1], wall0)),
      Ray2d(wall1, normalizedDirection(tangents1[0], wall1)),
      Ray2d(wall1, normalizedDirection(tangents1[1], wall1))
    ];

    // Penumbra are on the outside, umbra are on the inside.
    // Sort so the rays are oriented accordingly.
    // Rays may cross near wall so extend accordingly.
    const maxR2 = this.maxR2();
    const projectedPoints = [
      projectRay(tangentRays[0], maxR2),
      projectRay(tangentRays[1], maxR2),
      projectRay(tangentRays[2], maxR2),
      projectRay(tangentRays[3], maxR2)
    ];

    // Bubble sort
    this._cmpSwapTangentRays(tangentRays, projectedPoints, 0, 1);
    this._cmpSwapTangentRays(tangentRays, projectedPoints, 0, 2);
    this._cmpSwapTangentRays(tangentRays, projectedPoints, 0, 3);
    this._cmpSwapTangentRays(tangentRays, projectedPoints, 1, 2);
    this._cmpSwapTangentRays(tangentRays, projectedPoints, 1, 3);
    this._cmpSwapTangentRays(tangentRays, projectedPoints, 2, 3);

    /* Example scenario
    [4, 2, 1, 3]

    [2, 4, 1, 3] 0, 1
    [1, 4, 2, 3] 0, 2
    [1, 4, 2, 3] 0, 3

    [1, 2, 4, 3] 1, 2
    [1, 2, 4, 3] 1, 3

    [1, 2, 3, 4] 2, 3
    */

    // Penumbra are 0, 3; umbra are 1, 2.
    let idx0 = all(equal(tangentRays[0].origin, wall0)) ? 0 : 1;
    const penumbra = Array(2);
    penumbra[idx0] = tangentRays[0];
    penumbra[1 - idx0] = tangentRays[3];

    idx0 = all(equal(tangentRays[1].origin, wall0)) ? 0 : 1;
    const umbra = Array(2);
    umbra[idx0] = tangentRays[1];
    umbra[1 - idx0] = tangentRays[2];

    return ShadowRays2d({
      umbra,
      midpenumbra,
      penumbra
    });
  }

  /**
   * For infinite shadow, construct the different points of the triangle.
   * @param {ShadowRays2d} sideShadowRays
   * @param {ShadowDirections} farShadowDirs
   * @param {Wall} wall
   * @param {out vec2} A...I, W0, W1
   * @returns {bool} True if nearly collinear wall to the light.
   */
  shadowPoints(sideShadowRays, farShadowDirs, wall, A, B, C, D, E, F, G, H, I, W0, W1) {
    // Penumbra triangle: ∆ABC
    // Near/far triangle 0: ∆DEF
    // Near/far triangle 1: ∆GHI
    // Side triangle 0: ∆W0CI or ∆W0W1B (near-collinear)
    // Side triangle 1: ∆W1BF or ∆W0W1C (near-collinear)
    // Umbra triangle: ∆W1FI (near-collinear)
    /* Point Construction
    Formed using directional rays from the light.
    A->B, A->C: penumbra dirs
    D->E, G->H: umbra dirs

    A: Intersection of the two penumbra lines (furthest extent of shadow on either side of wall).
       - A->B (penumbra dir) intersect A->C (penumbra dir)
    W0: Closest endpoint to A.
    W1: Furthest endpoint from A.
    D: The point of intersection for the penumbra and umbra formed from the closest endpoint.
    G: The point of intersection for the penumbra and umbra formed from the furthest endpoint.
    E: Intersection of the closer penumbra line with the canvas ray.
    F: Intersection of the closer umbra line with the canvas ray.
    H: Intersection of the further penumbra line with the canvas ray.
    I: Intersection of the further umbra line with the canvas ray.
    B: Intersection of penumbra line with canvas ray.
    C: Intersection of penumbra line with canvas ray.
    */

    /*
    A = vec2();
    B = vec2();
    C = vec2();
    D = vec2();
    E = vec2();
    F = vec2();
    G = vec2();
    H = vec2();
    I = vec2();
    W0 = vec2();
    W1 = vec2();
    */
    const orient = foundry.utils.orient2dFast;
    const {
      lineLineIntersection,
      Ray,
      distanceSquared,
      projectRay,
      Ray2d,
      normalizedDirection,
      almostEqual,
      intersectRayPlane,
      all,
      equal } = glsl;

    // A found by intersecting the two side penumbra lines.
    lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.penumbra[1], A);

    // Endpoint closest to the light will be associated with ∆DEF; furthest is ∆GHI.
    // Can determine by comparing distance to the penumbra vertex 0 (A).
    let closestIdx = distanceSquared(A, wall.top[1].xy) < distanceSquared(A, wall.top[0].xy) ? 1 : 0;
    W0.set(wall.top[closestIdx].xy);
    W1.set(wall.top[1 - closestIdx].xy);

    // If W0 === A, then the wall is nearly collinear with the light (line from wall intersects light circle).
    const nearCollinear = almostEqual(W0, A, 1.0e-08);
    if ( nearCollinear ) {
      A.x = W0.x;
      A.y = W0.y;
    }

    // The DE penumbra ray runs through the closer endpoint.
    const closerIdx = sideShadowRays.penumbra[0].origin.x === W0.x
      && sideShadowRays.penumbra[0].origin.y === W0.y ? 0 : 1;
    const rAB = sideShadowRays.penumbra[closerIdx];
    const rAC = sideShadowRays.penumbra[1 - closerIdx];
    const rD_penumbra = rAB;
    const rG_penumbra = rAC;

    // The DF umbra ray runs through the further endpoint.
    const furtherIdx = sideShadowRays.umbra[0].origin.x === W1.x
      && sideShadowRays.umbra[0].origin.y === W1.y ? 0 : 1;
    const rD_umbra = sideShadowRays.umbra[furtherIdx];
    const rG_umbra = sideShadowRays.umbra[1 - furtherIdx];

    // D and G are the intersections of the penumbra with opposite umbra.
    const hasIxD = lineLineIntersection(rD_penumbra, rD_umbra, D);
    const hasIxG = lineLineIntersection(rG_penumbra, rG_umbra, G);

    // E intersects the D penumbra ray with the canvas line.
    // let canvasEdge;
    // let canvasEdge2;
    const infiniteShadow = this.isInfiniteShadow(farShadowDirs.penumbra);
    if ( infiniteShadow ) {
      // Set E and H such that it is outside the canvas.
      // Construct ∆DW0W1, ∆GW1W0 and then extend
      if ( hasIxD ) {
        const newDW0W1 = this.extendTriangleToCanvasEdge([D, W0, W1]);
        E.set(newDW0W1[1]);
        F.set(newDW0W1[2]);
      } else {
        const canvasIx = this.canvasEdgeIntersection(rD_penumbra);
        E.set(canvasIx);
        F.set(canvasIx);
      }

      if ( hasIxG ) {
        const newGW0W1 = this.extendTriangleToCanvasEdge([G, W0, W1]);
        const idxH = nearCollinear ? 1 : 2;
        H.set(newGW0W1[idxH]);  // Collinear ? 1 : 2
        I.set(newGW0W1[3 - idxH]); // Collinear ? 2 : 1
      } else {
        const canvasIx = this.canvasEdgeIntersection(rG_penumbra);
        H.set(canvasIx);
        I.set(canvasIx);
      }

    } else {
      // Locate the canvas intersection.
      const canvasPlane = this.constructCanvasPlane();
      const canvasIx = vec3();
      intersectRayPlane(Ray(vec3(wall.mid, wall.top[0].z), farShadowDirs.penumbra), canvasPlane, canvasIx);
      const canvasEdge = Ray2d(canvasIx.xy, wall.direction);
      lineLineIntersection(rD_penumbra, canvasEdge, E);
      lineLineIntersection(rG_umbra, canvasEdge, I);  // Mirror for ∆GHI

      // Moving from E along the wall direction, we will intersect rD_umbra at F.
      const rEWall = Ray2d(E, wall.direction);
      const hasIxF = lineLineIntersection(rEWall, rD_umbra, F);
      if ( !hasIxF ) F.set(this.canvasEdgeIntersection(rD_umbra));

      // Mirror for ∆GHI. Use I b/c it is on the W0 line.
      const rIWall = Ray2d(I, wall.direction);
      const hasIxH = lineLineIntersection(rIWall, rG_penumbra, H);
      if ( !hasIxH ) H.set(this.canvasEdgeIntersection(rG_penumbra));
    }

    if ( nearCollinear && !infiniteShadow ) {
      // B and C are on the I and F line.
      const rIF = Ray2d(I, normalizedDirection(I, F));
      lineLineIntersection(rD_penumbra, rIF, B);
      lineLineIntersection(rG_penumbra, rIF, C);
    } else {
      const newABC = this.extendTriangleToCanvasEdge([A, E, H]);
      B.set(newABC[1], 0);
      C.set(newABC[2], 0);
    }
    return nearCollinear;
  }

  /**
   * Given a triangle ABC, make it isoceles by extending the shorter edge of AB or AC.
   * @param {vec2[3]} tri
   * @returns {vec2[3]} tri
   */
  makeIsoceles(tri) {
    const { distance, normalizedDirection, almostEqual } = glsl;

    const a = vec2(tri[0]);
    const b = vec2(tri[1]);
    const c = vec2(tri[2]);
    const distAB = distance(a, b);
    const distBC = distance(b, c);
    if ( almostEqual(distAB, distBC, 1.0e-08) ) return [a, b, c];
    if ( distAB > distBC ) {
      return [
        a,
        b,
        a.add(normalizedDirection(a, c).multiplyScalar(distAB))
      ];
    } else { // BC distance is larger.
      return [
        a,
        a.add(normalizedDirection(a, b).multiplyScalar(distBC)),
        c,
      ];
    }
  }

  /**
   * Define the different shadow triangles.
   * @param {ShadowRays2d} sideShadowRays
   * @param {ShadowDirections} farShadowDirs
   * @param {Wall} wall
   * @param {out vec2[3]} penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1
   * @returns {bool} True if the wall is nearly collinear.
   */
  shadowTriangles(sideShadowRays, farShadowDirs, wall, penumbraTri, umbraTri,
    nearFarTri0, nearFarTri1, sideTri0, sideTri1) {
    const { distanceSquared, lineLineIntersection, Ray2d, normalizedDirection } = glsl;

    /* For debugging.
    let penumbraTri = [vec2(), vec2(), vec2()];
    let umbraTri = [vec2(), vec2(), vec2()]; // Gradient shading.
    let nearFarTri0 = [vec2(), vec2(), vec2()]; // Defining near and far shadows.
    let nearFarTri1 = [vec2(), vec2(), vec2()]; // Defining near and far shadows.
    let sideTri0 = [vec2(), vec2(), vec2()]; // Gradient shading.
    let sideTri1 = [vec2(), vec2(), vec2()]; // Triangles defining parts of the shadow.
    */

    let A = vec2();
    let B = vec2();
    let C = vec2();
    let D = vec2();
    let E = vec2();
    let F = vec2();
    let G = vec2();
    let H = vec2();
    let I = vec2();
    let J = vec2();
    let W0 = vec2();
    let W1 = vec2();
    const nearCollinear = this.shadowPoints(sideShadowRays, farShadowDirs, wall,
      A, B, C, D, E, F, G, H, I, W0, W1);

    // Use function to mimic setting out values for the triangles.
    const setTri = function(tri, values) { tri.splice(0, 3, ...values); };

    setTri(penumbraTri, [A, B, C]);
    setTri(nearFarTri0, [D, E, F]);
    setTri(nearFarTri1, [G, H, I]);

    // Side triangles used for gradient shading.
    setTri(sideTri0, [W0, B, I]);
    setTri(sideTri1, [W1, C, F]);
    if ( nearCollinear ) {
      setTri(sideTri0, [W0, B, W1]);
      setTri(sideTri1, [W0, C, W1]);

      // Used to shade the portion unblocked by the wall, after the endpoints.
      // Lightest along the line of the wall. To replicate, connect the umbra triangle using
      // edge perpendicular to the wall.
      const perpDir = vec2(wall.direction.y, -wall.direction.x);
      if ( distanceSquared(W1, I) < distanceSquared(W1, F) ) {
        const newF = vec2();
        lineLineIntersection(Ray2d(W1, normalizedDirection(W1, F)), Ray2d(I, perpDir), newF);
        setTri(umbraTri, [W1, I, newF]);
      } else {
        const newI = vec2();
        lineLineIntersection(Ray2d(W1, normalizedDirection(W1, I)), Ray2d(F, perpDir), newI);
        setTri(umbraTri, [W1, newI, F]);
      }
    }

    // Change the side triangles to isoceles so gradient shading works.
    setTri(sideTri0, this.makeIsoceles(sideTri0));
    setTri(sideTri1, this.makeIsoceles(sideTri1));
    return nearCollinear;
  }

  /**
   * For a line that intersects a circle, determine the percent area of the circle
   * on each side of the line.
   * @param {vec2} a
   * @param {vec2} b
   * @param {vec2} center
   * @param {float} radius
   * @returns {vec2} The percentage CCW(0) and CW (1), oriented a --> b.
   */
  circleBisectorPercentArea(a, b, center, radius) {
    const abs = Math.abs;
    const { normalizedDirection, Ray2d, projectRay, distance, lineLineIntersection } = glsl;

    // Use a line perpendicular to AB that goes through center.
    const dir = normalizedDirection(a, b);
    const perpDir = vec2(dir.y, -dir.x); // Moves CCW to a --> b
    const perpRay = Ray2d(center, perpDir);
    const edgeCCW = projectRay(perpRay, radius);
    const edgeCW = projectRay(perpRay, -radius);
    const ix = vec2();
    lineLineIntersection(perpRay, Ray2d(a, normalizedDirection(a, b)), ix);
    const totalDist = radius * 2.0;
    const ccwDist = distance(ix, edgeCCW);
    const cwDist = distance(ix, edgeCW);
    if ( ccwDist < totalDist
      && cwDist < totalDist ) return vec2(ccwDist, cwDist).multiplyScalar(1.0 / totalDist);
    if ( ccwDist > cwDist ) return vec2(1.0, 0.0);
    return vec2(0.0, 1.0);
  }

  /**
   * Calculate the ambient light used when the wall is collinear.
   * @param {vec2} w0   Closest wall endpoint to the light
   * @param {vec2} w1   Other wall endpoint
   * @returns {vec2}
   */
  ambientLight(w0, w1) {
    const { uLightSize, uLightPosition } = this;
    const distToWall = glsl.distanceToSegment(uLightPosition.xy, w0, w1);
    if ( distToWall <= uLightSize ) return vec2(1.0, 0.0);
    return this.circleBisectorPercentArea(w0, w1, uLightPosition.xy, uLightSize);
  }

  /**
   * Define varyings for this shader.
   * @param {bool} nearCollinear
   * @param {vec2[3]} penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1
   */
  defineVaryings(nearCollinear, penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1) {
    const abs = Math.abs;
    const orient = foundry.utils.orient2dFast;
    const { barycentric } = glsl;
    const vVertexPosition = this.vVertexPosition;
    const baryForPoint = (pt, tri) => barycentric(pt, ...tri);
    const vertexNum = this.gl_VertexID % 3;

    // Presets for varyings. Keep -1 if no valid triangle.
    this.vPenumbra = vec3(0.0);
    this.vUmbra = vec3(-1.0);
    this.vSidePenumbra0 = vec3(-1.0);
    this.vSidePenumbra1 = vec3(-1.0);

    // @type {vec3} vPenumbra
    this.vPenumbra[vertexNum] = 1.0;

    // @type {vec3} vUmbra
    if ( nearCollinear ) this.vUmbra = baryForPoint(vVertexPosition, umbraTri);

    // @type {vec3} vSidePenumbra0, vSidePenumbra1
    // Define side triangles in relation to the penumbra triangle.
    // If no real side penumbra, set values to -1 to avoid inclusion.
    if ( abs(orient(...sideTri0)) > 1.0 ) this.vSidePenumbra0 = baryForPoint(vVertexPosition, sideTri0);
    if ( abs(orient(...sideTri1)) > 1.0 ) this.vSidePenumbra1 = baryForPoint(vVertexPosition, sideTri1);
  }

  /**
   * Calculate the flat variables, including near/far ratios.
   * @param {Light} light
   * @param {Wall} wall
   * @param {vec2[3]} sideTri0
   * @param {vec2[3]} nearFarTri0
   * @param {vec2[3]} nearFarTri1
   * @param {ShadowRays2d} sideShadowRays
   * @param {ShadowDirections} farShadowDirs
   * @param {ShadowDirections} nearShadowDirs
   * @param {bool} hasFarPenumbra
   */
  defineFlats(wall, penumbraTri, sideTri0, farShadowDirs, nearShadowDirs) {
    const orient = foundry.utils.orient2dFast;
    const { all, equal, normalizedDirection, intersectRayPlane, lineLineIntersection, Ray, Ray2d } = glsl;

    // @type {vec2} fAmbient
    const W0 = sideTri0[0];
    const W1 = all(equal(wall.top[0].xy, W0)) ? wall.top[0].xy : wall.top[1].xy;
    this.fAmbient = vec2(1.0).subtract(this.ambientLight(W0, W1));
    if ( orient(W0, W1, sideTri0[1]) < 0.0 ) this.fAmbient = this.fAmbient.yx; // CW

    // Similar to unsized defineFlats.
    // For far, if umbra is infinite, penumbra will be infinite.
    const hasFarUmbra = !this.isInfiniteShadow(farShadowDirs.umbra);
    const hasFarPenumbra = !(hasFarUmbra || this.isInfiniteShadow(farShadowDirs.penumbra));
    const hasNearPenumbra = this.wallIsFloating() && !this.isInfiniteShadow(nearShadowDirs.penumbra);
    const hasNearUmbra = this.wallIsFloating() && !this.isInfiniteShadow(nearShadowDirs.umbra);
    if ( hasFarUmbra || hasFarPenumbra || hasNearPenumbra || hasNearUmbra ) {
      const wallRatioRay = this.nearFarMidRay(wall, penumbraTri);
      const light = this.light = this.calculateLightPositions();
      const canvasPlane = this.constructCanvasPlane();
      if ( hasFarUmbra ) {
        if ( hasFarPenumbra ) this.fFarRatios[PENUMBRA] = 0.0;

        // TODO: Can we either make the far/near directions into rays or calculate them here?
        // Determine canvas intersection of the light ray running through wall midpoint. See varyingWallRatio.
        const lightRay = Ray(light.top, farShadowDirs.umbra);
        const canvasIx = vec3();
        intersectRayPlane(lightRay, canvasPlane, canvasIx);
        this.fFarRatios[UMBRA] = lineLineIntersection(wallRatioRay, Ray2d(canvasIx.xy, wall.direction));
      }

      if ( hasNearPenumbra ) {
        const lightRay = Ray(light.top, nearShadowDirs.penumbra);
        const canvasIx = vec3();
        intersectRayPlane(lightRay, canvasPlane, canvasIx);
        this.fNearRatios[PENUMBRA] = lineLineIntersection(wallRatioRay, Ray2d(canvasIx.xy, wall.direction));
      }

      if ( hasNearUmbra ) {
        const lightRay = Ray(light.bottom, nearShadowDirs.umbra);
        const canvasIx = vec3();
        intersectRayPlane(lightRay, canvasPlane, canvasIx);
        this.fNearRatios[UMBRA] = lineLineIntersection(wallRatioRay, Ray2d(canvasIx.xy, wall.direction));
      }
    }
  }

  /**
   * Test if the point is within the wall endpoints, meaning drawing lines perpendicular
   * to the wall would contain the point.
   * @param {Wall} wall
   * @param {vec2} pt
   * @returns {bool}
   */
  pointBetweenWallEndpoints(wall, pt) {
    const orient = foundry.utils.orient2dFast;
    const { projectRay, Ray2d } = glsl;

    const perpDir = vec2(wall.direction.y, -wall.direction.x);
    const p0 = projectRay(Ray2d(wall.top[0].xy, perpDir), 1.0);
    const p1 = projectRay(Ray2d(wall.top[1].xy, perpDir), 1.0);
    return orient(wall.top[0].xy, p0, pt) * orient(wall.top[1].xy, p1, pt) < 0.0;
  }

  /**
   * Mimic calculations done in the vertex shader.
   */
  vertexCalculations(id) {
    super.vertexCalculations(id);
    const {
      Ray2d,
      ShadowDirections,
      lineLineIntersection,
      quadraticIntersection,
      distanceToSegment,
      circleContainsPoint,
      projectRay,
      normalizedDirection } = glsl;
    const { uLightSize } = this;
    const vertexNum = this.gl_VertexID % 3;
    const wall = this.wall = this.calculateWallPositions();
    const light = this.light = this.calculateLightPositions();

    // If a wall endpoint is within the light and the light center is not between the
    // endpoints, shrink the wall so it is just outside the light.
    // This avoids the light failing to display if overlapping the wall to the right/left.
    // If between the endpoints, calculateSideShadowRays will move the light accordingly.
    const ixs = [vec2(), vec2()]; // GLSL: vec2[2] ixs;
    const numIxs = quadraticIntersection(wall.top[0].xy, wall.top[1].xy, light.center.xy, uLightSize, 1.0e-06, ixs);
    if ( numIxs === 1 ) {
      // Determine where the intersection is on the wall.
      const containedIdx = circleContainsPoint(light.center.xy, uLightSize, wall.top[0].xy) ? 0 : 1;

      // Move pixel away to be outside the circle.
      const newIx = projectRay(Ray2d(ixs[0], normalizedDirection(ixs[0], wall.top[1 - containedIdx].xy)), 1.0);

      // Update wall data.
      wall.top[containedIdx].xy = newIx.xy;
      wall.bottom[containedIdx].xy = newIx.xy;
      wall.mid = wall.top[0].xy.add(wall.top[1].xy).multiplyScalar(0.5);
    }

    // Side shadows.
    const sideShadowRays = this.sideShadowRays = this.calculateSideShadowRays(wall, light);

    // Far direction.
    const farShadowDirs = this.farShadowDirs = this.calculateFarShadowDirections(wall, light);

    // Triangles defining parts of the shadow.
    const penumbraTri = this.penumbraTri = [vec2(), vec2(), vec2()];
    const umbraTri = this.umbraTri = [vec2(), vec2(), vec2()]; // Gradient shading.
    const nearFarTri0 = this.nearFarTri0 = [vec2(), vec2(), vec2()]; // Defining near and far shadows.
    const nearFarTri1 = this.nearFarTri1 = [vec2(), vec2(), vec2()]; // Defining near and far shadows.
    const sideTri0 = this.sideTri0 = [vec2(), vec2(), vec2()]; // Gradient shading.
    const sideTri1 = this.sideTri1 = [vec2(), vec2(), vec2()]; // Triangles defining parts of the shadow.
    const nearCollinear = this.nearCollinear = this.shadowTriangles(sideShadowRays, farShadowDirs, wall,
      penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1);

    this.defineSharedVaryings(wall, penumbraTri);
    this.defineVaryings(nearCollinear, penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1);
    if ( vertexNum === 2 ) {
      this.defineSharedFlats(wall, penumbraTri);
      this.nearShadowDirs = ShadowDirections();
      if ( this.wallIsFloating ) this.nearShadowDirs = this.calculateNearShadowDirections(wall, light);
      this.defineFlats(wall, penumbraTri, sideTri0, farShadowDirs, this.nearShadowDirs);
    }
  }

  /* ----- NOTE: Fragment calculations ----- */
  /**
   * Is fragment inside the side penumbra, without regard to near/far limits.
   * @returns {bool}
   */
  inSidePenumbra0() { return glsl.barycentricPointInsideTriangle(this.vSidePenumbra0); }

  /**
   * Is fragment inside the side penumbra, without regard to near/far limits.
   * @returns {bool}
   */
  inSidePenumbra1() { return glsl.barycentricPointInsideTriangle(this.vSidePenumbra1); }

  /**
   * Mimic the fragment calculations at a specific point.
   * @param {Point} pt
   */
  shadowComponents(pt, elevation = this.canvasElevation) {
    const { fFarRatios0, fFarRatios1, fNearRatios0, fNearRatios1, fWallHeights, fWallRatios, fAmbient } = this.flats;
    const { vSidePenumbra0, vSidePenumbra1, vUmbra, v } = this.varyings;
    const { uElevationRes } = this;
    const { between, linearConversion, barycentricPointInsideTriangle, mix } = glsl;

    // Debugging
    this.setVaryings(pt);

    // Default to 1.0 for parts that are not affecting the shadow.
    let farShadow = 1.0;
    let nearShadow = 1.0;
    let side0Shadow = 1.0;
    let side1Shadow = 1.0;

    // If in the far or near shadow, blend between 0 (penumbra) and 1 (umbra).
    const nfRatios = this.elevateNearFarRatios(); // @type vec2[2]
    const farRatios = nfRatios[FAR];
    const nearRatios = nfRatios[NEAR];
    if ( between(farRatios[PENUMBRA], farRatios[UMBRA], this.vWallRatio) === 1.0 ) {
      farShadow = linearConversion(this.vWallRatio, farRatios[PENUMBRA], farRatios[UMBRA], 0.0, 1.0);
    }
    if ( between(nearRatios[PENUMBRA], nearRatios[UMBRA], this.vWallRatio) === 1.0 ) {
      nearShadow = linearConversion(this.vWallRatio, nearRatios[PENUMBRA], nearRatios[UMBRA], 0.0, 1.0);
    }

    // Blend the two side penumbras if overlapping by multiplying the light amounts.
    if ( this.inSidePenumbra0() ) side0Shadow = vSidePenumbra0.z / (vSidePenumbra0.y + vSidePenumbra0.z);
    if ( this.inSidePenumbra1() ) side1Shadow = vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z);

    const side0ShadowOrig = side0Shadow; // Debugging.
    const side1ShadowOrig = side1Shadow; // Debugging.
    let percentUmbra = 1.0;
    if ( fAmbient[0] !== 1.0 && fAmbient[1] !== 1.0 ) {
      if ( this.inSidePenumbra0() ) side0Shadow *= fAmbient[0];
      if ( this.inSidePenumbra1() ) side1Shadow *= fAmbient[1];

      // Add in umbra shadow if any.
      if ( barycentricPointInsideTriangle(vUmbra) ) {
        const percentL = vUmbra.z / (vUmbra.y + vUmbra.z);
        percentUmbra = (percentL * (1.0 - percentL)) / 0.25; // 0.5 * 0.5 = 0.25; normalize to 1.0.
        const ambient = mix(fAmbient[0], fAmbient[1], percentL); // Blend b/c wall no longer fully blocks.
        percentUmbra *= ambient;
      }
    }

    // Debugging.
    return {
      side0Shadow,
      side1Shadow,
      farShadow,
      nearShadow,
      percentUmbra };
  }

  /* ----- NOTE: Debugging ----- */
  drawLight() { Draw.point(this.light.center, { radius: this.uLightSize, color: Draw.COLORS.yellow, fillAlpha: 0.5 }); }

  drawUmbraTriangle() {
    const tri = this.umbraTri;
    const poly = new PIXI.Polygon(...tri);
    const color = Draw.COLORS.red;
    Draw.shape(poly, { color });
  }

  drawNearFarTri(idx = 0) {
    const tri = [this.nearFarTri0, this.nearFarTri1][idx];
    const poly = new PIXI.Polygon(...tri);
    const color = [Draw.COLORS.lightorange, Draw.COLORS.orange][idx];
    Draw.shape(poly, { color });
  }

  drawSideTriangle(idx = 0) {
    const tri = [this.sideTri0, this.sideTri1][idx];
    const poly = new PIXI.Polygon(...tri);
    const color = [Draw.COLORS.blue, Draw.COLORS.green][idx];
    Draw.shape(poly, { color });
  }
}

SizedShadowsTest.VARYINGS.push(
  "vPenumbra",
  "vUmbra",
  "vSidePenumbra0",
  "vSidePenumbra1"
);

SizedShadowsTest.FLATS.push(
  "fAmbient"
);

export class DirectionalShadowsTest extends SizedShadowsTest {
  /* ----- NOTE: Uniforms ----- */

  /** @type {float<radians>} */
  get uAzimuth() { return this.uniforms.uAzimuth ?? 0; }

  /** @type {float<radians>} */
  get uSolarAngle() { return this.uniforms.uSolarAngle ?? 0; }

  // ----- NOTE: Getters ----- //

  /** @type {float} */
  // TODO: Cannot currently go all the way to 0.
  get solarAngle() { return Math.max(0.1, this.uSolarAngle); }


  calculateLightPositions() {
    console.error("No calculateLightPositions for Directional shadows.");
    return null;
  }

  /**
   * The rays from the wall endpoint along the side.
   * @param {int} idx     Which wall endpoint corresponds to this shadow
   * @param {Wall} wall
   * @returns {ShadowDirections2d} Direction from the endpoint away from the light for umbra, mid, and penumbra.
   */
  calculateSideShadowDirections(idx, wall) {
    const orient = foundry.utils.orient2dFast;
    const sign = Math.sign;
    const { uAzimuth, uElevationAngle } = this;
    const { solarAngle } = this;
    const { fromAngle, ShadowDirections2d, normalizedDirection, distanceSquared } = glsl;

    // Direction from light to endpoint.
    const dirMidPenumbra = fromAngle(vec2(0.0), uAzimuth, 1.0).multiplyScalar(-1.0).normalize();

    // Determine which side of the wall the light is on.
    const oWallLight = sign(orient(wall.top[0].xy, wall.top[1].xy, wall.top[0].xy.subtract(dirMidPenumbra)));

    // Adjust azimuth by the solarAngle.
    // Determine the direction of the outer penumbra rays from light --> wallCorner1 / wallCorner2.
    // The angle for the penumbra is the azimuth ± the solarAngle.
    const solarWallAngle = solarAngle * oWallLight;
    const multiplier = idx === 0 ? 1.0 : -1.0;
    let dirPenumbra = fromAngle(vec2(0.0), uAzimuth + (solarWallAngle * multiplier), 1.0)
      .multiplyScalar(-1.0).normalize();
    const dirUmbra = fromAngle(vec2(0.0), uAzimuth - (solarWallAngle * multiplier), 1.0)
      .multiplyScalar(-1.0).normalize();

    // If the penumbra is on the opposite side from the mid penumbra, change the penumbra to be at the wall.
//     const oWallPenumbra = orient(wall.top[0].xy, wall.top[1].xy, wall.top[0].xy.subtract(dirPenumbra));
//     if ( oWallPenumbra * oWallLight < 0.0 ) {
//       // Which endpoint is closest to the light?
//       const distWall = distanceSquared(wall.top[0].xy, wall.top[1].xy);
//       const distLight = distanceSquared(wall.top[0].xy, wall.top[0].xy.add(dirMidPenumbra));
//       const closestIdx = distWall < distLight ? 1 : 0;
//       dirPenumbra = normalizedDirection(wall.top[closestIdx].xy, wall.top[1 - closestIdx].xy);
//     }

    return ShadowDirections2d({
      umbra: dirUmbra,
      midpenumbra: dirMidPenumbra,
      penumbra: dirPenumbra
    });
  }

  /**
   * Calculate the side shadow rays.
   * @param {Wall} wall
   * @param {ShadowRays2d}
   */
  calculateSideShadowRays(wall) {
    const { ShadowRays2d, Ray2d, all, equal, projectRay } = glsl;

    const sideShadowDirs0 = this.calculateSideShadowDirections(0, wall);
    const sideShadowDirs1 = this.calculateSideShadowDirections(1, wall);
    const wall0 = wall.top[0].xy;
    const wall1 = wall.top[1].xy;

    // Penumbra are on the outside, umbra are on the inside.
    // Sort so the rays are oriented accordingly.
    const tangentRays = [
      Ray2d(wall0, sideShadowDirs0.umbra),
      Ray2d(wall1, sideShadowDirs1.umbra),
      Ray2d(wall0, sideShadowDirs0.penumbra),
      Ray2d(wall1, sideShadowDirs1.penumbra)
    ];
    const maxR2 = this.maxR2();
    const projectedPoints = [
      projectRay(tangentRays[0], maxR2),
      projectRay(tangentRays[1], maxR2),
      projectRay(tangentRays[2], maxR2),
      projectRay(tangentRays[3], maxR2)
    ];

//     const projectedPoints = [
//       this.canvasEdgeIntersection(tangentRays[0]),
//       this.canvasEdgeIntersection(tangentRays[1]),
//       this.canvasEdgeIntersection(tangentRays[2]),
//       this.canvasEdgeIntersection(tangentRays[3])
//     ];

    // Bubble sort
    this._cmpSwapTangentRays(tangentRays, projectedPoints, 0, 1);
    this._cmpSwapTangentRays(tangentRays, projectedPoints, 0, 2);
    this._cmpSwapTangentRays(tangentRays, projectedPoints, 0, 3);
    this._cmpSwapTangentRays(tangentRays, projectedPoints, 1, 2);
    this._cmpSwapTangentRays(tangentRays, projectedPoints, 1, 3);
    this._cmpSwapTangentRays(tangentRays, projectedPoints, 2, 3);

    // Penumbra are 0, 3; umbra are 1, 2.
    let idx0 = all(equal(tangentRays[0].origin, wall0)) ? 0 : 1;
    const penumbra = Array(2);
    penumbra[idx0] = tangentRays[0];
    penumbra[1 - idx0] = tangentRays[3];

    idx0 = all(equal(tangentRays[1].origin, wall0)) ? 0 : 1;
    const umbra = Array(2);
    umbra[idx0] = tangentRays[1];
    umbra[1 - idx0] = tangentRays[2];

    const midpenumbra = [
      Ray2d(wall0, sideShadowDirs0.midpenumbra),
      Ray2d(wall1, sideShadowDirs1.midpenumbra)
    ];

    return ShadowRays2d({
      umbra,
      midpenumbra,
      penumbra
    });
  }

  /**
   * Direction toward the wall middle, used to measure far umbra line.
   * @param {Wall} wall
   * @param {Light} light
   * @returns {ShadowDirections}
   */
  calculateFarShadowDirections(wall) {
    const { ShadowDirections, fromAngle } = glsl;
    const { uAzimuth } = this;

    const zDelta = this._calculateZChangeRays();
    const dirMid = fromAngle(vec2(0.0), uAzimuth, 1.0).multiplyScalar(-1.0);
    return ShadowDirections({
      umbra: vec3(dirMid, zDelta[UMBRA]).normalize(),
      midpenumbra: vec3(dirMid, zDelta[MIDPENUMBRA]).normalize(),
      penumbra: vec3(dirMid, zDelta[PENUMBRA]).normalize()
    });
  }

  /**
   * Direction toward the wall middle, used to measure near umbra line.
   * @returns {ShadowDirections}
   */
  calculateNearShadowDirections() {
    const { uAzimuth } = this;
    const { ShadowDirections, fromAngle } = glsl;

    const zDelta = this._calculateZChangeRays();
    const dirMid = fromAngle(vec2(0.0), uAzimuth, 1.0).multiplyScalar(-1.0);
    return ShadowDirections({
      umbra: vec3(dirMid, zDelta[PENUMBRA]).normalize(),
      midpenumbra: vec3(dirMid, zDelta[MIDPENUMBRA]).normalize(),
      penumbra: vec3(dirMid, zDelta[UMBRA]).normalize()
    });
  }

  /**
   * For infinite shadow, construct the different points of the triangle.
   * @param {ShadowRays2d} sideShadowRays
   * @param {ShadowDirections} farShadowDirs
   * @param {Wall} wall
   * @param {out vec2} A...I, W0, W1
   * @returns {bool} True if nearly collinear wall to the light.
   */
  shadowPoints(sideShadowRays, farShadowDirs, wall, A, B, C, D, E, F, G, H, I, W0, W1) {
    // Penumbra triangle: ∆ABC
    // Near/far triangle 0: ∆DEF
    // Near/far triangle 1: ∆GHI
    // Side triangle 0: ∆W0CI or ∆W0W1B (near-collinear)
    // Side triangle 1: ∆W1BF or ∆W0W1C (near-collinear)
    // Umbra triangle: ∆W1FI (near-collinear)
    /* Point Construction
    Formed using directional rays from the light.
    A->B, A->C: penumbra dirs
    D->E, G->H: umbra dirs

    A: Intersection of the two penumbra lines (furthest extent of shadow on either side of wall).
       - A->B (penumbra dir) intersect A->C (penumbra dir)
    W0: Closest endpoint to A.
    W1: Furthest endpoint from A.
    D: The point of intersection for the penumbra and umbra formed from the closest endpoint.
    G: The point of intersection for the penumbra and umbra formed from the furthest endpoint.
    E: Intersection of the closer penumbra line with the canvas ray.
    F: Intersection of the closer umbra line with the canvas ray.
    H: Intersection of the further penumbra line with the canvas ray.
    I: Intersection of the further umbra line with the canvas ray.
    B: Intersection of penumbra line with canvas ray.
    C: Intersection of penumbra line with canvas ray.
    */

    /*
    A = vec2();
    B = vec2();
    C = vec2();
    D = vec2();
    E = vec2();
    F = vec2();
    G = vec2();
    H = vec2();
    I = vec2();
    W0 = vec2();
    W1 = vec2();
    */
    const orient = foundry.utils.orient2dFast;
    const {
      lineLineIntersection,
      Ray,
      distanceSquared,
      projectRay,
      Ray2d,
      normalizedDirection,
      almostEqual,
      intersectRayPlane,
      all,
      equal } = glsl;

    // A found by intersecting the two side penumbra lines.
    lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.penumbra[1], A);

    // Endpoint closest to the light will be associated with ∆DEF; furthest is ∆GHI.
    // Can determine by comparing distance to the penumbra vertex 0 (A).
    let closestIdx = distanceSquared(A, wall.top[1].xy) < distanceSquared(A, wall.top[0].xy) ? 1 : 0;
    W0.set(wall.top[closestIdx].xy);
    W1.set(wall.top[1 - closestIdx].xy);

    // If W0 === A, then the wall is nearly collinear with the light (line from wall intersects light circle).
    const nearCollinear = almostEqual(W0, A, 1.0e-08);
    if ( nearCollinear ) {
      A.x = W0.x;
      A.y = W0.y;
    }

    // The DE penumbra ray runs through the closer endpoint.
    const closerIdx = sideShadowRays.penumbra[0].origin.x === W0.x
      && sideShadowRays.penumbra[0].origin.y === W0.y ? 0 : 1;
    const rAB = sideShadowRays.penumbra[closerIdx];
    const rAC = sideShadowRays.penumbra[1 - closerIdx];
    const rD_penumbra = rAB;
    const rG_penumbra = rAC;

    // The DF umbra ray runs through the further endpoint.
    const furtherIdx = sideShadowRays.umbra[0].origin.x === W1.x
      && sideShadowRays.umbra[0].origin.y === W1.y ? 0 : 1;
    const rD_umbra = sideShadowRays.umbra[furtherIdx];
    const rG_umbra = sideShadowRays.umbra[1 - furtherIdx];

    // D and G are the intersections of the penumbra with opposite umbra.
    const hasIxD = lineLineIntersection(rD_penumbra, rD_umbra, D);
    const hasIxG = lineLineIntersection(rG_penumbra, rG_umbra, G);

    // E intersects the D penumbra ray with the canvas line.
    // let canvasEdge;
    // let canvasEdge2;
    const infiniteShadow = this.isInfiniteShadow(farShadowDirs.penumbra);
    if ( infiniteShadow ) {
      // Set E and H such that it is outside the canvas.
      // Construct ∆DW0W1, ∆GW1W0 and then extend
      if ( hasIxD ) {
        const newDW0W1 = this.extendTriangleToCanvasEdge([D, W0, W1]);
        E.set(newDW0W1[1]);
        F.set(newDW0W1[2]);
      } else {
        const canvasIx = this.canvasEdgeIntersection(rD_penumbra);
        E.set(canvasIx);
        F.set(canvasIx);
      }

      if ( hasIxG ) {
        const newGW0W1 = this.extendTriangleToCanvasEdge([G, W0, W1]);
        const idxH = nearCollinear ? 1 : 2;
        H.set(newGW0W1[idxH]);  // Collinear ? 1 : 2
        I.set(newGW0W1[3 - idxH]); // Collinear ? 2 : 1
      } else {
        const canvasIx = this.canvasEdgeIntersection(rG_penumbra);
        H.set(canvasIx);
        I.set(canvasIx);
      }

    } else {
      // Locate the canvas intersection.
      const canvasPlane = this.constructCanvasPlane();
      const canvasIx = vec3();
      intersectRayPlane(Ray(vec3(wall.mid, wall.top[0].z), farShadowDirs.penumbra), canvasPlane, canvasIx);
      const canvasEdge = Ray2d(canvasIx.xy, wall.direction);
      lineLineIntersection(rD_penumbra, canvasEdge, E);
      lineLineIntersection(rG_umbra, canvasEdge, I);  // Mirror for ∆GHI

      // Moving from E along the wall direction, we will intersect rD_umbra at F.
      const rEWall = Ray2d(E, wall.direction);
      const hasIxF = lineLineIntersection(rEWall, rD_umbra, F);
      if ( !hasIxF ) F.set(this.canvasEdgeIntersection(rD_umbra));

      // Mirror for ∆GHI. Use I b/c it is on the W0 line.
      const rIWall = Ray2d(I, wall.direction);
      const hasIxH = lineLineIntersection(rIWall, rG_penumbra, H);
      if ( !hasIxH ) H.set(this.canvasEdgeIntersection(rG_penumbra));
    }

    if ( nearCollinear && !infiniteShadow ) {
      // B and C are on the I and F line.
      const rIF = Ray2d(I, normalizedDirection(I, F));
      lineLineIntersection(rD_penumbra, rIF, B);
      lineLineIntersection(rG_penumbra, rIF, C);
    } else {
      const newABC = this.extendTriangleToCanvasEdge([A, E, H]);
      B.set(newABC[1], 0);
      C.set(newABC[2], 0);
    }
    return nearCollinear;
  }


  /**
   * Determine the change in z for the directional rays.
   * @returns {float[3]}
   */
  _calculateZChangeRays() {
    const { uElevationAngle } = this;
    const { solarAngle } = this;

    // Calculate the change in z for the light direction based on differing solar angles.
    const zDelta = new Array(3);
    zDelta[UMBRA] = this.zChangeForElevationAngle(uElevationAngle + solarAngle); // Light top
    zDelta[MIDPENUMBRA] = this.zChangeForElevationAngle(uElevationAngle); // Light middle
    zDelta[PENUMBRA] = this.zChangeForElevationAngle(uElevationAngle - solarAngle); // Light bottom
    return zDelta;
  }

  /**
   * Amount of z (y) change for every change in x.
   * @param {float} elevationAngle
   * @returns {float}
   */
  zChangeForElevationAngle(elevationAngle) {
    const { fromAngle } = glsl;

    const pt = fromAngle(vec2(0.0), elevationAngle, 1.0);

    // How much z (y) change for every change in x?
    const z = pt.x === 0.0 ? 1e06 : pt.y / pt.x;
    return -z;
    // Don't let z go to 0?
    // return max(z, 1e-06);
  }



  /**
   * Calculate the flat variables, including near/far ratios.
   * @param {Light} light
   * @param {Wall} wall
   * @param {vec2[3]} sideTri0
   * @param {vec2[3]} nearFarTri0
   * @param {vec2[3]} nearFarTri1
   * @param {ShadowRays2d} sideShadowRays
   * @param {ShadowDirections} farShadowDirs
   * @param {ShadowDirections} nearShadowDirs
   * @param {bool} hasFarPenumbra
   */
  defineFlats(wall, penumbraTri, sideTri0, farShadowDirs, nearShadowDirs) {
    const orient = foundry.utils.orient2dFast;
    const { all, equal, normalizedDirection, intersectRayPlane, lineLineIntersection, Ray, Ray2d } = glsl;

    // @type {vec2} fAmbient
    const W0 = sideTri0[0];
    const W1 = all(equal(wall.top[0].xy, W0)) ? wall.top[0].xy : wall.top[1].xy;
    this.fAmbient = vec2(1.0, 0.0); // vec2(1.0).subtract(this.ambientLight(W0, W1));
    if ( orient(W0, W1, sideTri0[1]) < 0.0 ) this.fAmbient = this.fAmbient.yx; // CW

    // Similar to unsized defineFlats.
    // For far, if umbra is infinite, penumbra will be infinite.
    const hasFarUmbra = !this.isInfiniteShadow(farShadowDirs.umbra);
    const hasFarPenumbra = !(hasFarUmbra || this.isInfiniteShadow(farShadowDirs.penumbra));
    const hasNearPenumbra = this.wallIsFloating() && !this.isInfiniteShadow(nearShadowDirs.penumbra);
    const hasNearUmbra = this.wallIsFloating() && !this.isInfiniteShadow(nearShadowDirs.umbra);
    if ( hasFarUmbra || hasFarPenumbra || hasNearPenumbra || hasNearUmbra ) {
      const wallRatioRay = this.nearFarMidRay(wall, penumbraTri);
      const canvasPlane = this.constructCanvasPlane();
      if ( hasFarUmbra ) {
        if ( hasFarPenumbra ) this.fFarRatios[PENUMBRA] = 0.0;

        // TODO: Can we either make the far/near directions into rays or calculate them here?
        // Determine canvas intersection of the light ray running through wall midpoint. See varyingWallRatio.
        const lightRay = Ray(vec3(wall.mid, wall.top[0].z), farShadowDirs.umbra);
        const canvasIx = vec3();
        intersectRayPlane(lightRay, canvasPlane, canvasIx);
        this.fFarRatios[UMBRA] = lineLineIntersection(wallRatioRay, Ray2d(canvasIx.xy, wall.direction));
      }

      if ( hasNearPenumbra ) {
        const lightRay = Ray(vec3(wall.mid, wall.bottom[0].z), nearShadowDirs.penumbra);
        const canvasIx = vec3();
        intersectRayPlane(lightRay, canvasPlane, canvasIx);
        this.fNearRatios[PENUMBRA] = lineLineIntersection(wallRatioRay, Ray2d(canvasIx.xy, wall.direction));
      }

      if ( hasNearUmbra ) {
        const lightRay = Ray(vec3(wall.mid, wall.bottom[0].z), nearShadowDirs.umbra);
        const canvasIx = vec3();
        intersectRayPlane(lightRay, canvasPlane, canvasIx);
        this.fNearRatios[UMBRA] = lineLineIntersection(wallRatioRay, Ray2d(canvasIx.xy, wall.direction));
      }
    }
  }

  /**
   * Mimic calculations done in the vertex shader.
   */
  vertexCalculations(id) {
    if ( typeof id !== "undefined" ) this.gl_VertexID = id;
    const {
      Ray2d,
      ShadowDirections,
      lineLineIntersection,
      quadraticIntersection,
      distanceToSegment,
      circleContainsPoint,
      projectRay,
      normalizedDirection } = glsl;
    const vertexNum = this.gl_VertexID % 3;
    const wall = this.wall = this.calculateWallPositions();

    // Side shadows.
    const sideShadowRays = this.sideShadowRays = this.calculateSideShadowRays(wall);

    // Far direction.
    const farShadowDirs = this.farShadowDirs = this.calculateFarShadowDirections(wall);

    // Triangles defining parts of the shadow.
    const penumbraTri = this.penumbraTri = [vec2(), vec2(), vec2()];
    const umbraTri = this.umbraTri = [vec2(), vec2(), vec2()]; // Gradient shading.
    const nearFarTri0 = this.nearFarTri0 = [vec2(), vec2(), vec2()]; // Defining near and far shadows.
    const nearFarTri1 = this.nearFarTri1 = [vec2(), vec2(), vec2()]; // Defining near and far shadows.
    const sideTri0 = this.sideTri0 = [vec2(), vec2(), vec2()]; // Gradient shading.
    const sideTri1 = this.sideTri1 = [vec2(), vec2(), vec2()]; // Triangles defining parts of the shadow.
    const nearCollinear = this.nearCollinear = this.shadowTriangles(sideShadowRays, farShadowDirs, wall,
      penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1);

    this.defineSharedVaryings(wall, penumbraTri);
    this.defineVaryings(nearCollinear, penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1);
    if ( vertexNum === 2 ) {
      this.defineSharedFlats(wall, penumbraTri);
      this.nearShadowDirs = ShadowDirections();
      if ( this.wallIsFloating ) this.nearShadowDirs = this.calculateNearShadowDirections(wall);
      this.defineFlats(wall, penumbraTri, sideTri0, farShadowDirs, this.nearShadowDirs);
    }
  }


}


/**
 * Extends the penumbra shader for unsized point source shadows.
 */
export class SizedRandomShadowsTest extends SizedShadowsTest {
  /* ----- NOTE: Vertex functions ----- */

  static TOTAL_COLLISIONS = 10;

  /**
   * Calculate the flat variables
   * @param {Wall} wall
   */
  defineFlats(wall) {
    const { barycentric } = glsl;
    const baryForPoint = (pt, tri) => barycentric(pt, ...tri);
    wall ??= this.wall;

    // @type {vec3} Wall data
    this.fWallTop0 = wall.top[0];
    this.fWallTop1 = wall.top[1];
    this.fWallBottom0 = wall.bottom[0];
    this.fWallBottom1 = wall.bottom[1];

    // Can retrieve for debugging using this.flats.
  }

  /**
   * Mimic calculations done in the vertex shader.
   */
  vertexCalculations(id) {
    const { Ray2d, ShadowDirections } = glsl;
    const vertexNum = this.gl_VertexID % 3;
    const wall = this.wall = this.calculateWallPositions();
    const light = this.light = this.calculateLightPositions();

    // Side shadows.
    const sideShadowRays = this.sideShadowRays = this.calculateSideShadowRays(wall, light);

    // Far direction.
    const farShadowDirs = this.farShadowDirs = this.calculateFarShadowDirections(wall, light);

    // Triangles defining parts of the shadow.
    const penumbraTri = this.penumbraTri = [vec2(), vec2(), vec2()];
    const umbraTri = this.umbraTri = [vec2(), vec2(), vec2()]; // Gradient shading.
    const nearFarTri0 = this.nearFarTri0 = [vec2(), vec2(), vec2()]; // Defining near and far shadows.
    const nearFarTri1 = this.nearFarTri1 = [vec2(), vec2(), vec2()]; // Defining near and far shadows.
    const sideTri0 = this.sideTri0 = [vec2(), vec2(), vec2()]; // Gradient shading.
    const sideTri1 = this.sideTri1 = [vec2(), vec2(), vec2()]; // Triangles defining parts of the shadow.
    const nearCollinear = this.shadowTriangles(sideShadowRays, farShadowDirs, wall,
      penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1);

    this.defineSharedVaryings(wall, penumbraTri);
    if ( vertexNum === 2 ) {
      this.defineSharedFlats(wall, penumbraTri);
      this.defineFlats(wall);
    }
  }

  /* ----- NOTE: Fragment calculations ----- */

  /**
   * Create a random position within the 3d light sphere.
   * @param {float} seed    Number used to vary the pseudo-random value.
   * @returns {vec3}
   */
  randomSpherePosition(seed = 0) {
    const { uLightPosition, uLightSize, uTime, vVertexPosition } = this;
    const { hash, linearConversion } = glsl;

    // Get a 3d direction in which to move from the center.
    // uTime is much too large for hash.
    const t = (uTime * 1.0e-8) + seed;
    const rnd = hash(vec3(t).subtract(vec3(vVertexPosition, seed)));
    const rndDir = linearConversion(rnd, 0.0, 1.0, -1.0, 1.0);
    return uLightPosition.add(rndDir.multiplyScalar(uLightSize));
  }

  /**
   * Determine whether there is a collision with the wall at a given direction from the fragment.
   * @param {vec3} dir
   * @param {vec2} hWall0
   * @param {vec2} hWall1
   * @param {vec2} vWall0
   * @param {vec2} vWall1
   * @returns {int}
   */
  wallCollision(dir, elevation) {
    const orient = foundry.utils.orient2dFast;
    const { vVertexPosition, vEdgeDist } = this.varyings;
    const { fWallTop0, fWallTop1, fWallBottom0, fWallBottom1 } = this.flats;
    const { normalizedDirection, distanceToLine } = glsl;

    const hWall0 = fWallTop0.xy;
    const hWall1 = fWallTop1.xy;
    const vWall0 = vec2(0.0, fWallTop0.z);
    const vWall1 = vec2(0.0, fWallBottom0.z);

    // Move 1 pixel toward the light, to measure orientation w/r/t the light ray.
    const b3d = vec3(vVertexPosition, elevation).add(dir);

    // Test for horizontal collision. Wall endpoints are opposite sides of the light ray.
    const hCollision = orient(vVertexPosition, b3d.xy, hWall0) * orient(vVertexPosition, b3d.xy, hWall1) < 0.0;
    if ( !hCollision ) return 0;

    // Test for vertical collision. Transform coordinates based on direction to wall.
    const vA = vec2(vEdgeDist, elevation);
    const distB = distanceToLine(b3d.xy, hWall0, normalizedDirection(hWall0, hWall1));
    const vB = vec2(distB, b3d.z);
    const vCollision = orient(vA, vB, vWall0) * orient(vA, vB, vWall1) < 0.0;
    if ( !vCollision ) return 0;
    return 1;
  }

  shadowPercentage(pt, elevation = this.canvasElevation) {
    elevation = CONFIG.GeometryLib.utils.gridUnitsToPixels(elevation);
    const orient = foundry.utils.orient2dFast;
    const { uElevationRes, uLightPosition, uLightSize } = this;
    const { normalizedDirection, Ray } = glsl;

    // Debugging: ensure the flats and varyings are set up.
    this.setVaryings(pt);
    if ( this.thresholdApplies() ) return 0.0;
    if ( this.inFrontOfWall() ) return 0.0;

    // Retrieve the flat and varying variables.
    const { vVertexPosition } = this.varyings;
    const { fWallTop0, fWallTop1, fWallBottom0, fWallBottom1 } = this.flats;

    // For each direction, test intersection with the wall.
    // TODO: If the wall has different heights for each endpoint, adjust to match the point
    // at which the light ray intersects the wall.
    // TODO: skip tests if certain horizontals or verticals are blocked?
    //       skip tests based on inclusion in umbra triangle?
    // TODO: Use tangents?
    let numCollisions = 0;
    this.collisionRays = [];
    const a = vec3(vVertexPosition, elevation);
    const pts = [
      uLightPosition,
      uLightPosition + vec3(uLightSize, 0.0, 0.0),
      uLightPosition - vec3(uLightSize, 0.0, 0.0),
      uLightPosition + vec3(0.0, uLightSize, 0.0),
      uLightPosition - vec3(0.0, uLightSize, 0.0),
      uLightPosition + vec3(0.0, 0.0, uLightSize),
      uLightPosition - vec3(0.0, 0.0, uLightSize)
    ];
    for ( let i = 0; i < 7; i += 1 ) {
      const pos = pts[i];
      const dir = normalizedDirection(a, pos);
      numCollisions += this.wallCollision(dir, elevation);
    }

    // TODO: Add in adjacent pixel values as part of the average here.
    const percentShadow = numCollisions / this.constructor.TOTAL_COLLISIONS;
    console.log(`shadowComponents|${numCollisions} collisions, ${percentShadow * 100}% shadow.`);
    return percentShadow;
  }

  /* ----- NOTE: Debugging ----- */
  drawCollisionRays() {
    for ( let i = 0; i < this.collisionRays.length; i += 1 ) this.drawCollisionRay(i);
  }

  drawCollisionRay(idx = 0) {
    const wall = this.wall;
    const hWall0 = wall.top[0].xy;
    const hWall1 = wall.top[1].xy;
    const vWall0 = vec2(0.0, wall.top[0].z);
    const vWall1 = vec2(0.0, wall.bottom[0].z);
    const r = this.collisionRays[idx];
    const hasCollision = this.wallCollision(r.direction, r.origin.z, hWall0, hWall1, vWall0, vWall1);
    const color = hasCollision ? Draw.COLORS.lightred : Draw.COLORS.yellow;
    Draw.segment({
      a: r.origin,
      b: r.origin.add(r.direction.xy.normalize().multiplyScalar(1000))
    }, { color });
  }
}

SizedRandomShadowsTest.FLATS.push(
  "fWallTop0",
  "fWallTop1",
  "fWallBottom0",
  "fWallBottom1"
);

/**
 * Extends the penumbra shader for unsized point source shadows.
 */
export class DirectionalRandomShadowsTest extends DirectionalShadowsTest {
  /* ----- NOTE: Vertex functions ----- */

  static TOTAL_COLLISIONS = 10;

  /**
   * Calculate the flat variables
   * @param {Wall} wall
   */
  defineFlats(wall) {
    const { barycentric } = glsl;
    const baryForPoint = (pt, tri) => barycentric(pt, ...tri);
    wall ??= this.wall;

    // @type {vec3} Wall data
    this.fWallTop0 = wall.top[0];
    this.fWallTop1 = wall.top[1];
    this.fWallBottom0 = wall.bottom[0];
    this.fWallBottom1 = wall.bottom[1];

    // Can retrieve for debugging using this.flats.
  }

  /**
   * Mimic calculations done in the vertex shader.
   */
  vertexCalculations(id) {
    super.vertexCalculations(id);
    const { Ray2d, ShadowDirections } = glsl;
    const vertexNum = this.gl_VertexID % 3;
    const wall = this.wall = this.calculateWallPositions();

    // Side shadows.
    const sideShadowRays = this.sideShadowRays = this.calculateSideShadowRays(wall);

    // Far direction.
    const farShadowDirs = this.farShadowDirs = this.calculateFarShadowDirections(wall);

    // Triangles defining parts of the shadow.
    const penumbraTri = this.penumbraTri = [vec2(), vec2(), vec2()];
    const umbraTri = this.umbraTri = [vec2(), vec2(), vec2()]; // Gradient shading.
    const nearFarTri0 = this.nearFarTri0 = [vec2(), vec2(), vec2()]; // Defining near and far shadows.
    const nearFarTri1 = this.nearFarTri1 = [vec2(), vec2(), vec2()]; // Defining near and far shadows.
    const sideTri0 = this.sideTri0 = [vec2(), vec2(), vec2()]; // Gradient shading.
    const sideTri1 = this.sideTri1 = [vec2(), vec2(), vec2()]; // Triangles defining parts of the shadow.
    const nearCollinear = this.shadowTriangles(sideShadowRays, farShadowDirs, wall,
      penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1);

    this.defineSharedVaryings(wall, penumbraTri);
    if ( vertexNum === 2 ) {
      this.defineSharedFlats(wall, penumbraTri);
      this.defineFlats(wall);
    }
  }

  /* ----- NOTE: Fragment calculations ----- */

  /**
   * Create a random position within the 3d light sphere.
   * @param {float} seed    Number used to vary the pseudo-random value.
   * @returns {vec3}
   */
  randomSpherePosition(seed = 0) {
    const { uLightPosition, uLightSize, uTime, vVertexPosition } = this;
    const { hash, linearConversion } = glsl;

    // Get a 3d direction in which to move from the center.
    // uTime is much too large for hash.
    const t = (uTime * 1.0e-8) + seed;
    const rnd = hash(vec3(t).subtract(vec3(vVertexPosition, seed)));
    const rndDir = linearConversion(rnd, 0.0, 1.0, -1.0, 1.0);
    return uLightPosition.add(rndDir.multiplyScalar(uLightSize));
  }

  /**
   * Determine whether there is a collision with the wall at a given direction from the fragment.
   * @param {vec3} dir
   * @param {vec2} hWall0
   * @param {vec2} hWall1
   * @param {vec2} vWall0
   * @param {vec2} vWall1
   * @returns {int}
   */
  wallCollision(dir, elevation) {
    const orient = foundry.utils.orient2dFast;
    const { vVertexPosition, vEdgeDist } = this.varyings;
    const { fWallTop0, fWallTop1, fWallBottom0, fWallBottom1 } = this.flats;
    const { normalizedDirection, distanceToLine } = glsl;

    const hWall0 = fWallTop0.xy;
    const hWall1 = fWallTop1.xy;
    const vWall0 = vec2(0.0, fWallTop0.z);
    const vWall1 = vec2(0.0, fWallBottom0.z);

    // Move 1 pixel toward the light, to measure orientation w/r/t the light ray.
    const b3d = vec3(vVertexPosition, elevation).add(dir);

    // Test for horizontal collision. Wall endpoints are opposite sides of the light ray.
    const hCollision = orient(vVertexPosition, b3d.xy, hWall0) * orient(vVertexPosition, b3d.xy, hWall1) < 0.0;
    if ( !hCollision ) return 0;

    // Test for vertical collision. Transform coordinates based on direction to wall.
    const vA = vec2(vEdgeDist, elevation);
    const distB = distanceToLine(b3d.xy, hWall0, normalizedDirection(hWall0, hWall1));
    const vB = vec2(distB, b3d.z);
    const vCollision = orient(vA, vB, vWall0) * orient(vA, vB, vWall1) < 0.0;
    if ( !vCollision ) return 0;
    return 1;
  }

  shadowPercentage(pt, elevation = this.canvasElevation) {
    elevation = CONFIG.GeometryLib.utils.gridUnitsToPixels(elevation);
    const orient = foundry.utils.orient2dFast;
    const sign = Math.sign;
    const { uElevationRes, uAzimuth, uElevationAngle } = this;
    const { normalizedDirection, Ray, fromAngle } = glsl;
    const solarAngle = this.solarAngle;

    // Debugging: ensure the flats and varyings are set up.
    this.setVaryings(pt);
    if ( this.thresholdApplies() ) return 0.0;
    if ( this.inFrontOfWall() ) return 0.0;

    // Retrieve the flat and varying variables.
    const { vVertexPosition } = this.varyings;
    const { fWallTop0, fWallTop1, fWallBottom0, fWallBottom1 } = this.flats;

    // Direction from light to endpoint.
    const dirMidPenumbra = fromAngle(vec2(0.0), uAzimuth, 1.0).multiplyScalar(-1.0).normalize();

    // Determine which side of the wall the light is on.
    const oWallLight = sign(orient(fWallTop0.xy, fWallTop1.xy, fWallTop0.xy.subtract(dirMidPenumbra)));

    // Sample from range of solar angle and azimuth.
    // The angle for the penumbra is the azimuth ± the solarAngle.
    const solarWallAngle = solarAngle * oWallLight;
    const hMinDir = fromAngle(vec2(0.0, 0.0), uAzimuth - solarWallAngle);
    const hMaxDir = fromAngle(vec2(0.0, 0.0), uAzimuth + solarWallAngle);
    const hMidDir = hMinDir.add(hMaxDir).multiplyScalar(0.5);

    // Vertical angle is elevation angle ± solar angle.
    let vMinZ = fromAngle(vec2(0.0, 0.0), uElevationAngle - solarAngle);
    let vMaxZ = fromAngle(vec2(0.0, 0.0), uElevationAngle + solarAngle);
    const zMin = vMinZ.x === 0.0 ? 1e06 : vMinZ.y / vMinZ.x;
    const zMax = vMaxZ.x === 0.0 ? 1e06 : vMaxZ.y / vMaxZ.x;
    const zMid = (zMin + zMax) * 0.5;

    const dirs = Array(13);
    dirs[0] = vec3(hMidDir, zMid).normalize();

    dirs[1] = vec3(hMinDir, zMid).normalize();
    dirs[2] = vec3(hMaxDir, zMid).normalize();

    dirs[3] = vec3(hMidDir, zMin).normalize();
    dirs[4] = vec3(hMidDir, zMax).normalize();

    dirs[5] = vec3(hMaxDir, zMin).normalize();
    dirs[6] = vec3(hMaxDir, zMin).normalize();

    dirs[7] = vec3(hMaxDir, zMax).normalize();
    dirs[8] = vec3(hMaxDir, zMax).normalize();

    dirs[9] = dirs[0].add(dirs[1]).multiplyScalar(0.5);
    dirs[10] = dirs[0].add(dirs[2]).multiplyScalar(0.5);
    dirs[11] = dirs[0].add(dirs[3]).multiplyScalar(0.5);
    dirs[12] = dirs[0].add(dirs[4]).multiplyScalar(0.5);

    // For each direction, test intersection with the wall.
    // TODO: If the wall has different heights for each endpoint, adjust to match the point
    // at which the light ray intersects the wall.
    // TODO: skip tests if certain horizontals or verticals are blocked?
    //       skip tests based on inclusion in umbra triangle?
    // TODO: Use tangents?
    let numCollisions = 0;
    this.collisionRays = [];
    const a = vec3(vVertexPosition, elevation);
    for ( let i = 0; i < dirs.length; i += 1 ) {
      const dir = dirs[i];
      numCollisions += this.wallCollision(dir, elevation);
    }

    // TODO: Add in adjacent pixel values as part of the average here.
    const percentShadow = numCollisions / this.constructor.TOTAL_COLLISIONS;
    console.log(`shadowComponents|${numCollisions} collisions, ${percentShadow * 100}% shadow.`);
    return percentShadow;
  }

  /* ----- NOTE: Debugging ----- */
  drawCollisionRays() {
    for ( let i = 0; i < this.collisionRays.length; i += 1 ) this.drawCollisionRay(i);
  }

  drawCollisionRay(idx = 0) {
    const wall = this.wall;
    const hWall0 = wall.top[0].xy;
    const hWall1 = wall.top[1].xy;
    const vWall0 = vec2(0.0, wall.top[0].z);
    const vWall1 = vec2(0.0, wall.bottom[0].z);
    const r = this.collisionRays[idx];
    const hasCollision = this.wallCollision(r.direction, r.origin.z, hWall0, hWall1, vWall0, vWall1);
    const color = hasCollision ? Draw.COLORS.lightred : Draw.COLORS.yellow;
    Draw.segment({
      a: r.origin,
      b: r.origin.add(r.direction.xy.normalize().multiplyScalar(1000))
    }, { color });
  }
}

SizedRandomShadowsTest.FLATS.push(
  "fWallTop0",
  "fWallTop1",
  "fWallBottom0",
  "fWallBottom1"
);


/* Testing unsized light
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
let { vec2, vec3, vec4 } = api.testing.glsl_mock
glsl = api.testing.glsl_mock

let {
  UnsizedShadowsTest } = api.testing
function drawRay(ray, { dist = canvas.dimensions.maxR, color = Draw.COLORS.blue } = {}) {
  Draw.segment({ a: ray.origin, b: ray.origin.add(ray.direction.multiplyScalar(dist))}, { color })
}
l = canvas.lighting.placeables[0];
edge0 = canvas.walls.placeables[0].edge
// ev = l.lightSource.elevatedvision
ev = _token.vision.elevatedvision

UMBRA = 0;
MIDPENUMBRA = 2;
PENUMBRA = 1;
TOP = 0
BOTTOM = 1
FAR = 0
NEAR = 1
let [shader0] = UnsizedShadowsTest.fromMesh(ev.shadowMesh)
shader0.vertexCalculations(2)

shader0.drawWall();
shader0.drawPenumbraTriangle();

shader0.setVaryings(pt)
shader0.fragmentCalculations(pt, 0)
shader0.shadowPercentage(pt, 0)
shader0.shadowComponents(pt, 0)

*/

/* Testing sized random sampling light
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
let { vec2, vec3, vec4 } = api.testing.glsl_mock
glsl = api.testing.glsl_mock

let {
  SizedRandomShadowsTest } = api.testing
function drawRay(ray, { dist = canvas.dimensions.maxR, color = Draw.COLORS.blue } = {}) {
  Draw.segment({ a: ray.origin, b: ray.origin.add(ray.direction.multiplyScalar(dist))}, { color })
}
l = canvas.lighting.placeables[0];
edge0 = canvas.walls.placeables[0].edge
ev = l.lightSource.elevatedvision

UMBRA = 0;
MIDPENUMBRA = 2;
PENUMBRA = 1;
TOP = 0
BOTTOM = 1
FAR = 0
NEAR = 1
let [shader0] = SizedRandomShadowsTest.fromMesh(ev.shadowMesh)
shader0.vertexCalculations(2)

shader0.drawWall();
shader0.drawLight();
shader0.drawPenumbraTriangle();


shader0.setVaryings(pt)
shader0.fragmentCalculations(pt, 0)
shader0.shadowPercentage(pt, 0)

shader0.drawCollisionRays()
shader0.drawCollisionRay(0)

*/

/* Testing sized light
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
let { vec2, vec3, vec4 } = api.testing.glsl_mock
glsl = api.testing.glsl_mock

let {
  SizedShadowsTest } = api.testing
function drawRay(ray, { dist = canvas.dimensions.maxR, color = Draw.COLORS.blue } = {}) {
  Draw.segment({ a: ray.origin, b: ray.origin.add(ray.direction.multiplyScalar(dist))}, { color })
}
l = canvas.lighting.placeables[0];
edge0 = canvas.walls.placeables[0].edge
ev = l.lightSource.elevatedvision

UMBRA = 0;
MIDPENUMBRA = 2;
PENUMBRA = 1;
TOP = 0
BOTTOM = 1
FAR = 0
NEAR = 1
let [shader0] = SizedShadowsTest.fromMesh(ev.shadowMesh)
shader0.vertexCalculations(2)

shader0.drawWall();
shader0.drawLight();
shader0.drawPenumbraTriangle();
shader0.drawUmbraTriangle()
shader0.drawSideTriangle(0)
shader0.drawSideTriangle(1)
shader0.drawNearFarTri(0)
shader0.drawNearFarTri(1)

sideShadowRays = shader0.sideShadowRays
drawRay(sideShadowRays.penumbra[0])
drawRay(sideShadowRays.penumbra[1])
drawRay(sideShadowRays.umbra[0], { color: Draw.COLORS.red })
drawRay(sideShadowRays.umbra[1], { color: Draw.COLORS.red })

W0 = shader0.sideTri0[0]
W1 = shader0.sideTri1[0]
if ( shader0.nearCollinear ) [W0, W1] = [shader0.sideTri0[0], shader0.sideTri0[2]]
shader0.ambientLight(W0, W1)

shader0.setVaryings(pt)
shader0.fragmentCalculations(pt, 0)
shader0.shadowPercentage(pt, 0)


*/

/* Testing directional light
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
let { vec2, vec3, vec4 } = api.testing.glsl_mock
glsl = api.testing.glsl_mock

let {
  DirectionalShadowsTest } = api.testing
function drawRay(ray, { dist = canvas.dimensions.maxR, color = Draw.COLORS.blue } = {}) {
  Draw.segment({ a: ray.origin, b: ray.origin.add(ray.direction.multiplyScalar(dist))}, { color })
}
l = canvas.lighting.placeables[0];
edge0 = canvas.walls.placeables[0].edge
ev = l.lightSource.elevatedvision

UMBRA = 0;
MIDPENUMBRA = 2;
PENUMBRA = 1;
TOP = 0
BOTTOM = 1
FAR = 0
NEAR = 1
let [shader0] = DirectionalShadowsTest.fromMesh(ev.shadowMesh)
shader0.vertexCalculations(2)

shader0.drawWall();
shader0.drawPenumbraTriangle();
shader0.drawUmbraTriangle()
shader0.drawSideTriangle(0)
shader0.drawSideTriangle(1)
shader0.drawNearFarTri(0)
shader0.drawNearFarTri(1)

sideShadowRays = shader0.sideShadowRays
drawRay(sideShadowRays.penumbra[0])
drawRay(sideShadowRays.penumbra[1])
drawRay(sideShadowRays.umbra[0], { color: Draw.COLORS.red })
drawRay(sideShadowRays.umbra[1], { color: Draw.COLORS.red })

W0 = shader0.sideTri0[0]
W1 = shader0.sideTri1[0]
if ( shader0.nearCollinear ) [W0, W1] = [shader0.sideTri0[0], shader0.sideTri0[2]]
shader0.ambientLight(W0, W1)

shader0.setVaryings(pt)
shader0.fragmentCalculations(pt, 0)
shader0.shadowPercentage(pt, 0)


*/
