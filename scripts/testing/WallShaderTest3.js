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

const RIGHT = 0;
const LEFT = 1;

const SAME_SIDE = (o0, o1) => o0 * o1 > 0.0;
const OPP_SIDE = (o0, o1) => o0 * o1 < 0.0;
const COLLINEAR = o => glsl.almostEqual(o, 0.0, 1.0e-06);
const COUNTERCLOCKWISE = o => o > 0.0;
const CLOCKWISE = o => o < 0.0;

const LINKED_IDX = 3;

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
    out.shader = shader;
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
  static VARYINGS = ["vVertexPosition", "vTerrainTexCoord", "vEdgeDist", "vLREdgeDist"];

  static FLATS = [
    "fWallSenseType",
    "fThresholdRadius2",
    "fNearDistances", "fFarDistances",
    "fWallHeights",
    "fFarRLPenumbraDistances", "fFarRLUmbraDistances", "fNearRLPenumbraDistances", "fNearRLUmbraDistances"];

  /* ----- NOTE: Constants ---- */

  /**
   * Signal that a wall endpoint has no linked walls.
   * @type {number}
   */
  static EV_ENDPOINT_LINKED_UNBLOCKED = -10.0;

  /**
   * Signal that a linked wall to the edge will completely block the light.
   */
  static EV_ENDPOINT_LINKED_BLOCKED = -20.0;


  // From CONST.WALL_SENSE_TYPES
  static LIMITED_WALL = 10.0;

  static PROXIMATE_WALL = 30.0;

  static DISTANCE_WALL = 40.0;

  canvasElevation = canvas.scene[MODULE_ID].elevationMin;

  config(opts) {
    super.config(opts);
    this.canvasElevation = this.uElevationRes.x;
  }

  /* ----- NOTE: Simple functions ---- */

  /**
   * @returns {Wall}
   */
  calculateWallPositions() {
    const { Wall, normalizedDirection } = glsl;
    const { aWallCorner0, aWallCorner1 } = this;

    const endpointsXY = [aWallCorner0.xy, aWallCorner1.xy];
    const closerIdx = this.closerEndpoint(endpointsXY);
    const xyCloser = endpointsXY[closerIdx];
    const xyFurther = endpointsXY[1 - closerIdx];
    const direction = normalizedDirection(xyCloser, xyFurther);
    const topZ = aWallCorner0.z;
    const bottomZ = aWallCorner1.z;
    const linkValues = [aWallCorner0.w, aWallCorner1.w];
    return Wall({
      top: [vec3(xyCloser, topZ), vec3(xyFurther, topZ)],
      bottom: [vec3(xyCloser, bottomZ), vec3(xyFurther, bottomZ)],
      mid: xyCloser.add(xyFurther).multiplyScalar(0.5),
      direction,
      linkValues: [linkValues[closerIdx], linkValues[1 - closerIdx]]
    });
  }

  /**
   * Determine the closer and further endpoints.
   * @param {vec2[2]} pts
   * @returns {int} Index for the closer endpoint.
   */
  closerEndpoint(pts) { return 0; }

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
   * What quadrant does this direction end up in?
   * @param {vec2} direction
   * @returns {int 0|1|2|3}
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

    const tb = ((direction.y < 0.0) * -2) + 1; // E.g.: t = 1 * -2 + 1; b = 0 * -2 + 1
    const lr = (direction.x < 0.0) + 1; // E.g.: l = 1 + 1; r = 0 + 1
    return (tb * lr) + (tb * -0.5) + 1.5;

    // Original approach:
    // if ( direction.x > 0.0 ) return direction.y > 0.0 ? BR : TR;
    // Moving left. x <= 0.0.
    // return direction.y > 0.0 ? BL : TL;
  }

  /* ----- NOTE: Getters ---- */

  /** @type {float} */
  // get canvasElevation() { return this.uElevationRes.x; }

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
   * The line that defines the left/right sides of the penumbra in relation to the wall.
   * @param {Wall} wall
   * @param {bool} isCollinear
   * @returns {Ray2d}
   */
  leftRightBisector(wall, isCollinear) {
    const orient = foundry.utils.orient2dFast;
    const { Ray2d, projectRay } = glsl;
    if ( isCollinear ) return Ray2d(wall.mid, wall.direction);
    return Ray2d(wall.mid, vec2(-wall.direction.y, wall.direction.x));
  }

  /**
   * The line that defines the front/back sides of the penumbra in relation to the wall.
   * @param {Wall} wall
   * @param {bool} isCollinear
   * @returns {Ray2d}
   */
  frontBackBisector(wall, isCollinear) {
    const { Ray2d } = glsl;
    if ( !isCollinear ) return Ray2d(wall.mid, wall.direction);
    return Ray2d(wall.top[1].xy, vec2(-wall.direction.y, wall.direction.x));
  }

  /**
   * Calculate varying variables.
   * @param {Wall} wall
   * @param {vec2[3]} penumbraTri
   */
  defineSharedVaryings(wall, penumbraTri) {
    const { distanceToLine, normalizedDirection, distance,
      almostEqual, Ray2d, lineLineIntersection, barycentric, projectRay } = glsl;
    const { uSceneDims } = this;
    const sign = Math.sign;
    const orient = foundry.utils.orient2dFast;

    const vertexNum = this.gl_VertexID % 3;

    /** @type {vec2} vVertexPosition */
    this.vVertexPosition = penumbraTri[vertexNum];

    // Calculate the terrain texture coordinate at this vertex based on scene dimensions.
    // (vVertexPosition - uSceneDims.xy) / uSceneDims.zw
    // @type {vec2} vTerrainTexCoord
    this.vTerrainTexCoord = (this.vVertexPosition.subtract(uSceneDims.xy)).divide(uSceneDims.zw);

    // In shader:
    // gl_Position = vec4((projectionMatrix * translationMatrix * vec3(this.vVertexPosition, 1.0)).xy, 0.0, 1.0);

    // @type {float} vEdgeDist              Distance from the wall line.
    // Used to determine in front of or behind wall.
    const isCollinear = almostEqual(penumbraTri[0], wall.top[0].xy, 1.0e-06);
    const rEdgeWall = this.frontBackBisector(wall, isCollinear);

    this.vEdgeDist = distanceToLine(this.vVertexPosition, rEdgeWall.origin, rEdgeWall.direction);
    if ( vertexNum === 0 ) this.vEdgeDist *= -1.0;

    // @type {vec3} vLREdgeDist    Triangle A --> ix --> C, where
    //   ix is the intersection of the rRLWall with A->B.
    // Left side is 1.0, right side is -1.0.
    this.vLREdgeDist = 0.0;
    if ( (vertexNum !== 0 && isCollinear) || !isCollinear ) {
      const rRLWall = this.leftRightBisector(wall, isCollinear);
      this.vLREdgeDist = glsl.distanceToLine(this.vVertexPosition, rRLWall.origin, rRLWall.direction);
      const projPt = projectRay(rRLWall, 1.0);
      let projDir = 1.0;
      if ( !isCollinear
        && OPP_SIDE(orient(wall.top[0].xy, wall.top[1].xy, penumbraTri[1]),
                    orient(wall.top[0].xy, wall.top[1].xy, projPt)) ) projDir = -1.0; // eslint-disable-line indent
      this.vLREdgeDist *= sign(orient(rRLWall.origin, projectRay(rRLWall, projDir), this.vVertexPosition));
    }
  }

  /**
   * Basic flats used by all shaders to limit shadow.
   */
  defineSharedFlats(wall, penumbraTri) {
    const { aWallSenseType, aThresholdRadius2 } = this;
    const { DISTANCE, PROXIMATE } = CONST.WALL_SENSE_TYPES;
    const { almostEqual, distanceToLine } = glsl;

    // @type {float} fWallSenseType
    this.fWallSenseType = aWallSenseType;

    // @type {float} fThresholdRadius
    this.fThresholdRadius2 = !(aWallSenseType === DISTANCE || aWallSenseType === PROXIMATE)
      ? -1.0 : aThresholdRadius2;

    // @type {vec2} fWallHeights
    this.fWallHeights = vec2(0.0);
    this.fWallHeights[TOP] = wall.top[0].z - this.canvasElevation; // The full height of the top of the wall from lowest elevation.
    this.fWallHeights[BOTTOM] = wall.bottom[0].z - this.canvasElevation; // The full height of the bottom of the wall from lowest elevation.
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
    const quad = this.directionalQuadrant(r.direction);
    // Comparable:
    // Scene Rect has edges CW from TL. (TL -> TR -> BR -> BL)
    // A ray of a given direction only has two edges that it could conceivably hit.
    // const edges = [...canvas.dimensions.rect.iterateEdges()];

    // A ray of a given direction only has two edges that it could conceivably hit.
    // (Assuming it starts inside the rectangle.)
    const TL = 0;
    const TR = 1;
    const BR = 2;
    const BL = 3;
    const sceneRect = this.constructSceneRect(); // @type vec2[4]


    // Scene Rect has edges CW from TL. (TL -> TR -> BR -> BL)
    // - TL quad. edges are left and top. BL->TL; TL->TR
    // - TR quad. edges are right and top. TL->TR; TR->BR
    // - BR quad. edges are right and bottom. TR->BR; BR->BL
    // - BL quad. edges are left and bottom. BR->BL; BL->TL
    const idx0 = (quad + 4 - 1) % 4; // I.e.: quad - 1
    const idx1 = quad;
    const idx2 = (quad + 1) % 4;
    const edge0 = Ray2d(sceneRect[idx0], normalizedDirection(sceneRect[idx0], sceneRect[idx1]));
    const edge1 = Ray2d(sceneRect[idx1], normalizedDirection(sceneRect[idx1], sceneRect[idx2]));
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
    // If the edges intersect:
    // Use an ray that intersects the corner perpendicular to the midpoint of the two rays.
    // (This prevents the connecting ray from hitting the canvas or intersecting at the
    // wrong side of the light rays.)
    const corner = vec2();
    const midDir = lightRays[0].direction.add(lightRays[1].direction).multiplyScalar(0.5);
    if ( lineLineIntersection(edge0, edge1, corner) ) return Ray2d(corner, vec2(midDir.y, -midDir.x));

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

  /**
   * For a given light center, determine the shadow triangle.
   * @param {vec3} O      The assumed center point of the light
   * @param {Wall} wall   The associated wall
   * @returns {vec2[3]}  Triangle, from center through endpoint a and then endpoint b.
   */
  shadowTriangle(O, wall, top = true) {
    const orient = foundry.utils.orient2dFast;
    const {
      lineLineIntersection,
      Ray,
      Ray2d,
      normalizedDirection,
      distanceSquared,
      intersectRayPlane,
      almostEqual } = glsl;
    const a = wall.top[0].xy;
    const b = wall.top[1].xy;
    const wallPt = top ? wall.top[1] : wall.bottom[0];

    if ( COLLINEAR(orient(O.xy, a, b)) ) {
      // The triangle is a line.
      if ( this.isInfiniteTopShadow(O) ) {
        // Where O --> wall intersects the canvas edge.
        const rWall = Ray2d(O.xy, a.subtract(O.xy));
        const edge = this.whichCanvasEdge(rWall);
        const ix = vec2();
        lineLineIntersection(rWall, edge, ix);
        return [O.xy, ix, ix];
      }
      // Where O --> further wall endpoint intersects the canvas plane.
      const ixP = vec3();
      const hasFurthestPoint = this._furthestShadowPoint(O, wallPt, ixP); // Wall 1 is further.
      if ( !hasFurthestPoint ) new Error(`${MODULE_ID}|shadowTriangle|No furthest point found!`);
      return [O.xy, ixP.xy, ixP.xy];
    }

    // For infinite shadow, extend triangle formed by light point and wall to the edge of the canvas.
    if ( this.isInfiniteTopShadow(O) ) return this.extendTriangleToCanvasEdge([O.xy, a, b]);

    // For non-infinite, intersect the canvas plane to determine extension point.
    // Use the furthest wall point.
    const ixP = vec3();
    if ( !this._furthestShadowPoint(O, wallPt, ixP) ) return this.extendTriangleToCanvasEdge([O.xy, a, b]);
    const rWallIx = Ray2d(ixP.xy, b.subtract(a));
    const rOa = Ray2d(O.xy, a.subtract(O.xy));
    const rOb = Ray2d(O.xy, b.subtract(O.xy));
    const B = vec2();
    const C = vec2();
    glsl.lineLineIntersection(rWallIx, rOa, B);
    glsl.lineLineIntersection(rWallIx, rOb, C);
    return [O.xy, B, C];
  }

  /**
   * Does this source cast an infinite shadow?
   * (Ray is rising as it moves from light --> wall.)
   * @param {vec3} samplePt   The sample point or direction
   * @returns {bool}
   */
  isInfiniteTopShadow(samplePt) {
    const { aWallCorner0 } = this;
    const topZ = aWallCorner0.z;
    return samplePt.z <= topZ;
  }

  isInfiniteBottomShadow(samplePt) {
    const { aWallCorner1 } = this;
    const bottomZ = aWallCorner1.z;
    return samplePt.z <= bottomZ;
  }

  /**
   * The furthest point of the shadow when running a ray from the light through the
   * a point on the wall.
   * @param {vec3} samplePt   The sample point or direction
   * @param {vec3} wallPt     Location on the wall to test
   * @param {out vec3} ixP
   * @returns {bool};
   */
  _furthestShadowPoint(samplePt, wallPt, ixP) {
    const { Ray, intersectRayPlane } = glsl;

    const canvasPlane = this.constructCanvasPlane();
    const rAWall = Ray(samplePt, wallPt.subtract(samplePt));
    return intersectRayPlane(rAWall, canvasPlane, ixP);
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
   * What is the elevation needed for this fragment to be out of the far shadow?
   * @returns {float}
   */
  farPenumbraElevation() { return this._nearFarElevation(this.fFarDistances[PENUMBRA], TOP); }

  /**
   * What is the elevation needed for this fragment to be in the far umbra shadow?
   * @returns {float}
   */
  farUmbraElevation() { return this._nearFarElevation(this.fFarDistances[UMBRA], TOP); }

  /**
   * What is the elevation needed for this fragment to be out of the far shadow?
   * @returns {float}
   */
  nearPenumbraElevation() { return this._nearFarElevation(this.fNearDistances[PENUMBRA], BOTTOM); }

  /**
   * What is the elevation needed for this fragment to be in the far umbra shadow?
   * @returns {float}
   */
  nearUmbraElevation() { return this._nearFarElevation(this.fNearDistances[UMBRA], BOTTOM); }

  /**
   * Elevation where the border between shadow and not shadow lies for this fragment.
   * @param {float} d               Distance to the wall for the furthest shadow point at canvas elevation
   * @param {int} wallHeightType    Relevant wall height (TOP or BOTTOM)
   * @returns {float}
   */
  _nearFarElevation(d, wallHeightType) {
    // Calculate using similar triangles.
    // - Elevation <--> wall height.
    // - Distance to max penumbra point <--> max penumbra point to wall.
    if ( d <= 0.0 ) return this.canvasElevation - 1.0;
    const y = d - this.vEdgeDist;
    const wallH = this.fWallHeights[wallHeightType];
    return ((wallH * y) / d) + this.canvasElevation;
  }


  /**
   * What is the far penumbra distance at this elevation?
   * @param {float} elevation
   * @returns {float}
   */
  farPenumbraDistance(elevation) { return this._nearFarDistance(elevation, this.fFarDistances[PENUMBRA], TOP); }

  farLPenumbraDistance(elevation) {
    return this._nearFarDistance(elevation, this.fFarRLPenumbraDistances[LEFT], TOP);
  }

  farRPenumbraDistance(elevation) {
    return this._nearFarDistance(elevation, this.fFarRLPenumbraDistances[RIGHT], TOP);
  }

  /**
   * What is the far penumbra distance at this elevation?
   * @param {float} elevation
   * @returns {float}
   */
  farUmbraDistance(elevation) { return this._nearFarDistance(elevation, this.fFarDistances[UMBRA], TOP); }

  farLUmbraDistance(elevation) {
    return this._nearFarDistance(elevation, this.fFarRLUmbraDistances[LEFT], TOP);
  }

  farRUmbraDistance(elevation) {
    return this._nearFarDistance(elevation, this.fFarRLUmbraDistances[RIGHT], TOP);
  }

  /**
   * What is the far penumbra distance at this elevation?
   * @param {float} elevation
   * @returns {float}
   */
  nearPenumbraDistance(elevation) { return this._nearFarDistance(elevation, this.fNearDistances[PENUMBRA], BOTTOM); }

  nearLPenumbraDistance(elevation) {
    return this._nearFarDistance(elevation, this.fNearRLPenumbraDistances[LEFT], BOTTOM);
  }

  nearRPenumbraDistance(elevation) {
    return this._nearFarDistance(elevation, this.fNearRLPenumbraDistances[RIGHT], BOTTOM);
  }

  /**
   * What is the far penumbra distance at this elevation?
   * @param {float} elevation
   * @returns {float}
   */
  nearUmbraDistance(elevation) { return this._nearFarDistance(elevation, this.fNearDistances[UMBRA], BOTTOM); }

  nearLUmbraDistance(elevation) {
    return this._nearFarDistance(elevation, this.fNearRLUmbraDistances[LEFT], BOTTOM);
  }

  nearRUmbraDistance(elevation) {
    return this._nearFarDistance(elevation, this.fNearRLUmbraDistances[RIGHT], BOTTOM);
  }

  /**
   * Distance where border between shadow and not shadow lies for this fragment at given elevation.
   * @param {float} elevation       Elevation to test
   * @param {float} d               Distance to the wall for the furthest shadow point at canvas elevation
   * @param {int} wallHeightType    Relevant wall height (TOP or BOTTOM)
   * @returns {float}
   */
  _nearFarDistance(elevation, d, wallHeightType) {
    elevation -= this.canvasElevation;
    const wallH = this.fWallHeights[wallHeightType];
    const y = wallH - elevation;
    return (d * y) / wallH;
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
  inFrontOfWall() {
    const { vEdgeDist } = this.varyings;
    const { fAmbient } = this.flats;

    // If collinear, cannot be in front of wall.
    if ( fAmbient[0] * fAmbient[1] !== 0.0 ) return false;
    return vEdgeDist < 0.0;
  }


  // ----- NOTE: Drawings for debuggin ----- //

  drawWall() { Draw.segment({ a: this.wall.top[0], b: this.wall.top[1] }, { width: 2 }); }

  drawPenumbraTriangle() {
    const tri = this.penumbraTri;
    const poly = new PIXI.Polygon(...tri);
    Draw.shape(poly);
  }

  drawSideShadowRays() {
    const drawRay = function(ray, { dist = canvas.dimensions.maxR, color = Draw.COLORS.blue } = {}) {
      Draw.segment({ a: ray.origin, b: ray.origin.add(ray.direction.multiplyScalar(dist))}, { color });
    };
    const sideShadowRays = this.sideShadowRays;
    drawRay(sideShadowRays.penumbra[0]);
    drawRay(sideShadowRays.penumbra[1]);
    drawRay(sideShadowRays.umbra[0], { color: Draw.COLORS.red });
    drawRay(sideShadowRays.umbra[1], { color: Draw.COLORS.red });
  }
}

/**
 * Extends the penumbra shader for unsized point source shadows.
 */
export class UnsizedShadowsTest extends PenumbraBasicTest {
  /* ----- NOTE: Vertex functions ----- */

  /**
   * Determine the closer and further endpoints.
   * @param {vec2[2]} pts
   * @returns {int} Index for the closer endpoint.
   */
  closerEndpoint(pts) {
    const { uLightPosition } = this;
    const { distanceSquared } = glsl;

    // Closer endpoint can be determined with relation to the light center.
    const d0 = distanceSquared(pts[0], uLightPosition.xy);
    const d1 = distanceSquared(pts[1], uLightPosition.xy);
    return Number(d1 < d0);
  }

  /**
   * Define the triangle for the unsized source.
   * Defined as the lines from the source through each endpoint.
   * Either intersecting the canvas or infinite, which is set off at the canvas edge.
   * @param {Wall} wall
   * @returns {vec2[3]}
   */
  definePenumbraTriangle(wall) {
    const { uLightPosition } = this;
    return this.shadowTriangle(uLightPosition, wall, true);
  }

  /**
   * Define additional flats specific to this shader.
   * @param {Wall} wall
   * @param {vec2[3]} penumbraTri
   */
  defineFlats(wall, penumbraTri) {
    const { uLightPosition } = this;
    const { distanceToLine, almostEqual, Ray2d } = glsl;

    // @type {vec2} fFarDistances, fNearDistances, using UMBRA, PENUMBRA.
    // Distance from wall to the far penumbra/umbra and near penumbra/umbra.
    // 0.0 indicates no shadow.
    this.fFarDistances = vec2(0.0);
    this.fNearDistances = vec2(0.0);
    this.fFarLRDistances = vec2(0.0);
    this.fNearLRDistances = vec2(0.0);
    this.fCollinearWallDist = 0.0;

    // Unsized vertex never collinear b/c no shadow at collinear point (straight line).
    const isCollinear = false;
    const rEdgeWall = this.frontBackBisector(wall, isCollinear);
    // const rRLWall = this.leftRightBisector(wall, isCollinear);

    // The far penumbra shadow by definition is at the far penumbraTri edge.
    if ( !this.isInfiniteTopShadow(uLightPosition) ) {
      const ixP = vec3();
      this._furthestShadowPoint(uLightPosition, wall.top[1], ixP);
      // Alt: this.fFarDistances[PENUMBRA] = distanceToLine(penumbraTri[2], wall.top[0].xy, wall.direction);
      this.fFarDistances[PENUMBRA] = distanceToLine(ixP.xy, rEdgeWall.origin, rEdgeWall.direction);
      // this.fFarLRDistances[PENUMBRA] = distanceToLine(ixP.xy, rRLWall.origin, rRLWall.direction);
    }

    // The near penumbra shadow depends on wall floating
    if ( this.wallIsFloating && !this.isInfiniteBottomShadow(uLightPosition) ) {
      // Use closest wall point for the near shadow.
      const ixP = vec3();
      this._furthestShadowPoint(uLightPosition, wall.bottom[0], ixP);
      this.fNearDistances[PENUMBRA] = distanceToLine(ixP.xy, rEdgeWall.origin, rEdgeWall.direction);
      // this.fNearLRDistances[PENUMBRA] = distanceToLine(ixP.xy, rRLWall.origin, rRLWall.direction);
    }
    // For unsized light, no umbra shadow.
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
   * Determine the closer and further endpoints.
   * @param {vec2[2]} pts
   * @returns {int} Index for the closer endpoint.
   */
  closerEndpoint(pts) {
    const { uLightPosition } = this;
    const { distanceSquared } = glsl;

    // Closer endpoint can be determined with relation to the light center.
    const d0 = distanceSquared(pts[0], uLightPosition.xy);
    const d1 = distanceSquared(pts[1], uLightPosition.xy);
    return Number(d1 < d0);
  }

  /**
   * Shrink wall to avoid overlap with light.
   * If a wall endpoint is within the light and the light center is not between the
   * endpoints, shrink the wall so it is just outside the light.
   * This avoids the light failing to display if overlapping the wall to the right/left.
   * If between the endpoints, calculateSideShadowRays will move the light accordingly.
   * @param {Wall} wall
   */
  shrinkOverlappingWall(wall) {
    const { uLightPosition, uLightSize } = this;
    const { quadraticIntersection, projectRay, Ray2d, normalizedDirection } = glsl;

    const ixs = [vec2(), vec2()]; // @type {vec2[2]};
    const numIxs = quadraticIntersection(wall.top[0].xy, wall.top[1].xy, uLightPosition.xy, uLightSize, 1.0e-06, ixs);
    if ( numIxs === 1 ) {
      // Determine where the intersection is on the wall. By definition, it is the closer endpoint.
      // const containedIdx = circleContainsPoint(uLightPosition.xy, uLightSize, endpointsXY[0]) ? 0 : 1;

      // Move pixel away to be outside the circle.
      const newIx = projectRay(Ray2d(ixs[0], normalizedDirection(ixs[0], wall.top[1].xy)), 1.0);

      // Update wall data.
      wall.top[0].xy = newIx.xy;
      wall.bottom[0].xy = newIx.xy;
      wall.mid = wall.top[0].xy.add(wall.top[1].xy).multiplyScalar(0.5);
      wall.direction = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
    }
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
  offsetLightFromWall(wall, d) {
    const { uLightPosition } = this;
    const { projectRay, Ray2d } = glsl;
    return projectRay(Ray2d(uLightPosition.xy, vec2(wall.direction.y, -wall.direction.x)), d);
  }

  /**
   * Calculate the horizontal tangents for the light sphere from a given point.
   * @param {Wall} wall
   * @param {vec2} pt
   * @param {out vec3[2]} tangents
   * @returns {bool} true if tangents
   */
  horizontalTangents(wall, pt, tangents) {
    const max = Math.max;
    const { Circle, tangentPoints, distanceToSegment, almostEqual } = glsl;
    const { uLightPosition, uLightSize } = this;
    const lightCir = Circle({
      center: uLightPosition.xy,
      radius: uLightSize
    });

    // If the light overlaps the wall, the penumbra shoot straight out along the wall.
    // Shrinking the light to be just smaller than distance to wall.
    const distToWall = distanceToSegment(uLightPosition.xy, wall.top[0].xy, wall.top[1].xy);
    if ( distToWall <= uLightSize ) {
      lightCir.radius = max(distToWall - 1.0, 0.0);
      if ( almostEqual(distToWall, 0.0, 1.0e-06) ) lightCir.center = this.offsetLightFromWall(wall, 10.0);
    }
    return tangentPoints(lightCir, pt, tangents);
  }

  /**
   * Calculate the vertical tangents for the light sphere from a given point.
   * @param {vec3} pt
   * @param {out vec3[2]} tangents
   * @returns {bool} true if tangents
   */
  verticalTangents(pt, tangents) {
    const { verticalTangentPoints } = glsl;
    const { uLightPosition, uLightSize } = this;
    return verticalTangentPoints(pt, uLightPosition, uLightSize, tangents);
  }

  /**
   * Direction from light --> wall endpoint. Origin at the wall endpoint.
   * @param {Wall} wall
   * @returns {ShadowRays2d} Rays from the endpoint away from the light for umbra, mid, and penumbra.
   */
  calculateSideShadowRays(wall) {
    const orient = foundry.utils.orient2dFast;
    const {
      Ray2d,
      normalize,
      distanceToSegment,
      almostEqual,
      normalizedDirection,
      projectRay,
      ShadowRays2d,
      fromAngle } = glsl;
    const { uLightPosition } = this;
    const W0 = wall.top[0].xy;
    const W1 = wall.top[1].xy;

    // 4 tangent points: 2 from each wall endpoint.
    // NOTE: Cannot use array of arrays in GLSL ES 3.0. Would need 3.1, which is incompatible.
    const tangents0 = [uLightPosition.xy, uLightPosition.xy];
    const tangents1 = [uLightPosition.xy, uLightPosition.xy];
    this.horizontalTangents(wall, W0, tangents0);
    this.horizontalTangents(wall, W1, tangents1);

    // Each tangent point -> wall endpoint creates one of the 4 side shadow rays.
    // t00: tangent --> W0; t01: tangent --> W0
    // t10: tangent --> W1; t11: tangent --> W1
    // t00 x t01 at W0 by definition.
    // t10 x t11 at W1 by definition.
    const r0 = [
      Ray2d(W0, normalizedDirection(tangents0[0], W0)),
      Ray2d(W0, normalizedDirection(tangents0[1], W0))
    ];
    const r1 = [
      Ray2d(W1, normalizedDirection(tangents1[0], W1)),
      Ray2d(W1, normalizedDirection(tangents1[1], W1))
    ];

    // If near-collinear:
    // t00 and t01 are on opposite sides of the wall line.
    // t10 and t11 are on opposite sides of the wall line.

    // If not near-collinear
    // t00 and t01 are on same sides of the wall line.
    // t00 and t01 are on same sides of the wall line.
    const p00 = projectRay(r0[0], 100.0);
    const p01 = projectRay(r0[1], 100.0);
    const p10 = projectRay(r1[0], 100.0);
    const p11 = projectRay(r1[1], 100.0);

    const o00 = orient(W1, W0, p00);
    const o01 = orient(W1, W0, p01);
    const o10 = orient(W0, W1, p10);
    const o11 = orient(W0, W1, p11);
    const isCollinear = OPP_SIDE(o00, o01) || OPP_SIDE(o10, o11); // Either could be 0.0.
    let penumbra;
    let umbra;
    if ( isCollinear ) {
      // W0 intersection is penumbra; W1 intersection is umbra.
      penumbra = r0;
      umbra = r1;
    } else {
      penumbra = Array(2);
      umbra = Array(2);

      // Umbra for W0 is on same side as W1 for light center --> W0.
      const oW1 = orient(uLightPosition.xy, W0, W1);
      const ol00 = orient(uLightPosition.xy, W0, p00);
      const ol01 = orient(uLightPosition.xy, W0, p01);
      const pIdx0 = Number(SAME_SIDE(ol01, oW1) || OPP_SIDE(ol00, oW1));
      umbra[0] = r0[pIdx0];
      penumbra[0] = r0[1 - pIdx0];

      // Umbra for W1 is on same side as W0 for light center --> W1.
      const oW0 = orient(uLightPosition.xy, W1, W0);
      const ol10 = orient(uLightPosition.xy, W1, p10);
      const ol11 = orient(uLightPosition.xy, W1, p11);
      const pIdx1 = Number(SAME_SIDE(ol11, oW0) || OPP_SIDE(ol10, oW0));
      umbra[1] = r1[pIdx1];
      penumbra[1] = r1[1 - pIdx1];
    }

    // If light center is on the wall, offset.
    // TODO: Does this need to happen elsewhere for umbra and penumbra?
    /*
    const distToWall = distanceToSegment(uLightPosition.xy, W0, W1);
    const lightCenter = almostEqual(distToWall, 0.0, 1.0e-06)
      ? vec3(this.offsetLightFromWall(wall, 10.0), uLightPosition.z) : uLightPosition;
    let midpenumbra = [
      Ray2d(W0, normalizedDirection(lightCenter.xy, W0)),
      Ray2d(W1, normalizedDirection(lightCenter.xy, W1))
    ];
    */

    // If a linked wall is present, use its direction for the penumbra and umbra.
    // If in-between mid and penumbra, change umbra and mid.
    const UNBLOCKED = Number(this.constructor.EV_ENDPOINT_LINKED_UNBLOCKED); // Convert to int in glsl.
    const BLOCKED = Number(this.constructor.EV_ENDPOINT_LINKED_BLOCKED); // Convert to int in glsl.
    const BETWEEN_UP = 1;
    for ( let i = 0; i < 2; i += 1 ) {
      const W = wall.top[i].xy;
      const WO = wall.top[1 - i].xy;
      let linkStatus = Number(wall.linkValues[i]); // GLSL: int
      if ( linkStatus !== UNBLOCKED ) {
        const linkPt = fromAngle(W, wall.linkValues[i], 1.0);
        const umbraPt = projectRay(umbra[i], 1.0);
        const oLight = orient(W, WO, uLightPosition.xy);
        const oLinked = orient(W, WO, linkPt);
        const oUmbra = orient(W, umbraPt, linkPt);

        if ( SAME_SIDE(oLight, oLinked) ) {
          // Negative penumbra and negative umbra are the points on the light side of the wall.
          // Wall <--> negative penumbra <--> negative umbra <--> wall line on other side of W0.
          // If between negative umbra and other side of W0, the linked wall blocks completely.
          // If between negative penumbra and negative umbra, linked wall is collinear and partially blocks.
          //   - Should set fAmbient for this situation, but probably doesn't matter much.
          if ( SAME_SIDE(oLinked, -oUmbra) ) linkStatus = BLOCKED;
          else linkStatus = UNBLOCKED;
        } else {
          // Wall <--> umbra <--> mid <--> penumbra <--> wall line on other side of W0.
          const penumbraPt = projectRay(penumbra[i], 1.0);
          const oPenumbra = orient(W, penumbraPt, linkPt);
          if ( SAME_SIDE(oLinked, oPenumbra) ) linkStatus = BLOCKED;
          else if ( SAME_SIDE(oLinked, oUmbra) ) linkStatus = BETWEEN_UP;
          else linkStatus = UNBLOCKED;
        }

        switch ( linkStatus ) {
          case BLOCKED: {
            umbra[i] = penumbra[i];
            break;
          }
          case BETWEEN_UP: {
            umbra[i] = Ray2d(W, normalizedDirection(W, linkPt));
            break;
          }
        }
      }
    }

    return ShadowRays2d({
      umbra,
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
  shadowPoints(wall, sideShadowRays, farPenumbraTri, A, B, C, D, E, F, G, H, I) {
    // Penumbra triangle: ∆ABC
    // Near/far triangle 0: ∆DEF
    // Near/far triangle 1: ∆GHI
    // Side triangle 0: ∆W0CI or ∆W0W1B (near-collinear)
    // Side triangle 1: ∆W1BF or ∆W0W1C (near-collinear)
    // Umbra triangle: ∆W1FI (near-collinear)
    // Far triangle: ∆JKL
    // Near triangle: ∆MNO
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

    sideShadowRays = shader0.sideShadowRays
    farShadowDirs = shader0.farShadowDirs
    wall = shader0.wall
    orient = foundry.utils.orient2dFast;
    uLightPosition = shader0.uLightPosition
    uLightSize = shader0.uLightSize
    let {
      distanceSquared,
      projectRay,
      Ray2d,
      normalizedDirection,
      almostEqual,
      intersectRayPlane,
      all,
      equal,
      normalize } = glsl;
    */
    const { uLightPosition, uLightSize } = this;
    const {
      lineLineIntersection,
      almostEqual,
      Ray2d,
      distanceSquared,
      distanceSquaredToLine } = glsl;

    // Will use a, d, e, f, g, h, i  below, so cannot use the out vars yet.
    const a = vec2();
    const d = vec2();
    const e = vec2();
    const f = vec2();
    const g = vec2();
    const h = vec2();
    const i = vec2();

    // Already set the closer endpoint when constructing wall properties.
    const W0 = wall.top[0].xy;
    const W1 = wall.top[1].xy;

    // A found by intersecting the two side penumbra lines.
    glsl.lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.penumbra[1], a);

    // If W0 === A, then the wall is nearly collinear with the light (line from wall intersects light circle).
    const nearCollinear = almostEqual(W0, a, 1.0e-08);

    // D and G are set by the intersection of their respective penumbra/umbra lines.
    // Most of the matching work done in sideShadowRays.
    // If no intersection, D and G should be set to W0 (happens if side shadow rays are parallel):
    // - when wall is near-collinear and wall line is tangent to source circle.

    d.set(W0);
    g.set(W0);
    if ( nearCollinear ) {
      glsl.lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.umbra[0], d);
      glsl.lineLineIntersection(sideShadowRays.penumbra[1], sideShadowRays.umbra[1], g);
    } else {
      glsl.lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.umbra[1], d);
      glsl.lineLineIntersection(sideShadowRays.penumbra[1], sideShadowRays.umbra[0], g);
    }

    // ∆DEF and ∆GHI represent the furthest left/right extent of the shadow  because D and G are
    // near-tangent points.
    const DEF = this.shadowTriangle(vec3(d, uLightPosition.z), wall, true);
    const GHI = this.shadowTriangle(vec3(g, uLightPosition.z), wall, true);
    e.set(DEF[1]);
    f.set(DEF[2]);

    const collinearIdx = Number(nearCollinear);
    h.set(GHI[2 - collinearIdx]); // Penumbra line 2 - 1; 2 - 0
    i.set(GHI[1 + collinearIdx]); // Umbra line    1 + 1; 1 + 0

    // Determine B and C by connecting to the penumbra sideShadowRays.
    // Use whichever is greater distance from wall: I, H, farPenumbraTri[1]
    const rEdgeWall = this.frontBackBisector(wall, nearCollinear);
    const dist2F = distanceSquaredToLine(f, rEdgeWall.origin, rEdgeWall.direction);
    const dist2I = distanceSquaredToLine(i, rEdgeWall.origin, rEdgeWall.direction);
    const dist2P = distanceSquaredToLine(farPenumbraTri[2], rEdgeWall.origin, rEdgeWall.direction);
    const furthestPoint = (dist2F > dist2I && dist2F > dist2P) ? f
      : (dist2I > dist2P) ? i : farPenumbraTri[2];

    // F and I
    // Direction to run the ray connect the two penumbra sides.
    let rabDir = wall.direction;
    if ( nearCollinear ) {
      // Perpendicular to the mean ray between the two penumbra sides.
      const meanDir = sideShadowRays.penumbra[0].direction
        .add(sideShadowRays.penumbra[1].direction)
        .multiplyScalar(0.5);
      rabDir = vec2(-meanDir.y, meanDir.x);
    }

    const rab = Ray2d(furthestPoint, rabDir);
    glsl.lineLineIntersection(sideShadowRays.penumbra[0], rab, B);
    glsl.lineLineIntersection(sideShadowRays.penumbra[1], rab, C);

    A.set(a);
    D.set(d);
    E.set(e);
    F.set(f);
    G.set(g);
    H.set(h);
    I.set(i);

    return nearCollinear;
  }

  /**
   * Given a triangle ABC, make it isoceles by extending the shorter edge of AB or AC.
   * @param {vec2[3]} tri
   * @returns {vec2[3]} tri
   */
  makeIsoceles(tri) {
    const { distanceSquared, normalizedDirection, almostEqual, projectRayDistanceSquared, Ray2d } = glsl;

    const a = vec2(tri[0]);
    const b = vec2(tri[1]);
    const c = vec2(tri[2]);
    const dist2AB = distanceSquared(a, b);
    const dist2AC = distanceSquared(a, c);
    if ( almostEqual(dist2AB, dist2AC, 1.0e-08) ) return [a, b, c];
    if ( dist2AB > dist2AC ) {
      const r = Ray2d(a, normalizedDirection(a, c));
      return [
        a,
        b,
        projectRayDistanceSquared(r, dist2AB)
      ];
    } else { // BC distance is larger.
      const r = Ray2d(a, normalizedDirection(a, b));
      return [
        a,
        projectRayDistanceSquared(r, dist2AC),
        c,
      ];
    }
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
   * @param {Wall} wall
   * @param {vec2[3]} penumbraTri
   * @param {vec2} F
   * @param {vec2} I
   * @param {bool} hasSide0
   * @param {bool} hasSide1
   */
  defineVaryings(wall, penumbraTri, F, I, hasSide0, hasSide1) {
    const abs = Math.abs;
    const orient = foundry.utils.orient2dFast;
    const { barycentric, almostEqual, distanceSquared, lineLineIntersection, Ray2d, normalizedDirection } = glsl;
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

    // Define the umbraTri.
    // Define the sideTri used for gradient shading.
    // Use function to mimic setting out values for the triangles.
    const setTri = function(tri, values) { tri.splice(0, 3, ...values); };
    const W0 = wall.top[0].xy;
    const W1 = wall.top[1].xy;
    const A = penumbraTri[0];
    const B = penumbraTri[1];
    const C = penumbraTri[2];
    const nearCollinear = almostEqual(W0, A, 1.0e-08);

    const umbraTri = this.umbraTri = [vec2(0.0), vec2(0.0), vec2(0.0)]; // Non-collinear.
    const sideTri0 = this.sideTri0 = [vec2(), vec2(), vec2()];
    const sideTri1 = this.sideTri1 = [vec2(), vec2(), vec2()];
    if ( nearCollinear ) {
      setTri(sideTri0, [W0, B, W1]);
      setTri(sideTri1, [W0, C, W1]);
      setTri(umbraTri, [W1, I, F]);

      // Used to shade the portion unblocked by the wall, after the endpoints.
      // Lightest along the line of the wall. To replicate, connect the umbra triangle using
      // edge perpendicular to the wall.
      const perpDir = vec2(wall.direction.y, -wall.direction.x);
      if ( distanceSquared(W1, I) < distanceSquared(W1, F) ) {
        lineLineIntersection(Ray2d(W1, normalizedDirection(W1, F)), Ray2d(I, perpDir), umbraTri[2]); // New F.
      } else {
        lineLineIntersection(Ray2d(W1, normalizedDirection(W1, I)), Ray2d(F, perpDir), umbraTri[1]); // New I.
      }
    } else {
      const ixI = vec2();
      const ixF = vec2();
      lineLineIntersection(B, C, W0, I, ixI);
      lineLineIntersection(B, C, W1, F, ixF);
      setTri(sideTri0, [W0, B, ixI]);
      setTri(sideTri1, [W1, C, ixF]);
    }

    // @type {vec3} vUmbra
    if ( nearCollinear ) this.vUmbra = baryForPoint(vVertexPosition, umbraTri);

    // @type {vec3} vSidePenumbra0, vSidePenumbra1
    // Define side triangles in relation to the penumbra triangle.
    // If no real side penumbra, set values to -1 to avoid inclusion.
    // Change the side triangles to isoceles so gradient shading works.
    if ( hasSide0 && abs(orient(...sideTri0)) > 1.0 ) this.vSidePenumbra0 = baryForPoint(vVertexPosition, this.makeIsoceles(sideTri0));
    if ( hasSide1 && abs(orient(...sideTri1)) > 1.0 ) this.vSidePenumbra1 = baryForPoint(vVertexPosition, this.makeIsoceles(sideTri1));

    // For debugging.
    if ( hasSide0 && abs(orient(...sideTri0)) > 1.0 ) setTri(sideTri0, this.makeIsoceles(sideTri0));
    if ( hasSide0 && abs(orient(...sideTri1)) > 1.0 ) setTri(sideTri1, this.makeIsoceles(sideTri1));
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
  defineFlats(wall, penumbraTri, farPenumbraTri, DEF, GHI, lowerTangent, upperTangent) {
    /* Debug
    wall = shader0.wall
    penumbraTri = shader0.penumbraTri
    farPenumbraTri = shader0.farPenumbraTri
    DEF = shader0.DEF
    GHI = shader0.GHI
    vTangents = shader0.vTangents
    idx = Number(vTangents[0].z > vTangents[1].z); // Pick the lower in z direction.
    lowerTangent = vTangents[idx];
    upperTangent = vTangents[idx - 1];
    */

    const orient = foundry.utils.orient2dFast;
    const { sign, max, min, sqrt } = Math;
    const uLightPosition = this.uLightPosition;
    const {
      all,
      equal,
      Ray2d,
      almostEqual,
      projectRay,
      step,
      distanceSquaredToLine,
      distanceToLine,
      distanceSquared } = glsl;

    // @type {vec2} fAmbient
    const W0 = wall.top[0].xy; // Nearer wall endpoint to source.
    const W1 = wall.top[1].xy; // Further wall endpoint from source.
    this.fAmbient = vec2(1.0).subtract(this.ambientLight(W0, W1));
    if ( CLOCKWISE(orient(W0, W1, penumbraTri[1])) ) this.fAmbient = this.fAmbient.yx; // CW

    // @type {vec2} fFarDistances, fNearDistances, using UMBRA, PENUMBRA.
    // Distance from wall to the far penumbra/umbra and near penumbra/umbra.
    const nearCollinear = almostEqual(W0, penumbraTri[0], 1.0e-08);

    // Orient the left and right tri
    const rRLWall = this.leftRightBisector(wall, nearCollinear);
    let projRLPt = projectRay(rRLWall, 1.0);
    if ( !nearCollinear && SAME_SIDE(orient(W0, W1, projRLPt), orient(W0, W1, uLightPosition.xy))) {
      // Ray rRLWall could point either way; turn it so it points away from the light.
      rRLWall.direction = rRLWall.direction.multiply(vec2(-1.0));
      let projRLPt = projectRay(rRLWall, 1.0);
    }

    let rightFarTri;
    let leftFarTri;
    if ( CLOCKWISE(orient(rRLWall.origin, projRLPt, GHI[1])) ) {
      rightFarTri = GHI;
      leftFarTri = DEF;
    } else {
      rightFarTri = DEF;
      leftFarTri = GHI;
    }
    this.rightFarTri = rightFarTri;
    this.leftFarTri = leftFarTri;

    const leftNearTri = this.leftNearTri = this.shadowTriangle(vec3(leftFarTri[0], uLightPosition.z), wall, false);
    const rightNearTri = this.rightNearTri = this.shadowTriangle(vec3(rightFarTri[0], uLightPosition.z), wall, false);

    const farUmbraTri = this.farUmbraTri = this.shadowTriangle(upperTangent, wall, true);
    const nearPenumbraTri = this.nearPenumbraTri = this.shadowTriangle(upperTangent, wall, false);
    const nearUmbraTri = this.nearUmbraTri = this.shadowTriangle(lowerTangent, wall, false);

    const hasFarP = !this.isInfiniteTopShadow(lowerTangent);
    const hasFarU = !this.isInfiniteTopShadow(upperTangent);
    const hasNearP = this.wallIsFloating() && !this.isInfiniteBottomShadow(upperTangent);
    const hasNearU = this.wallIsFloating() && !this.isInfiniteBottomShadow(lowerTangent);

    this.fFarDistances = vec2(0.0);
    this.fNearDistances = vec2(0.0);
    const rEdgeWall = this.frontBackBisector(wall, nearCollinear);

    if ( hasFarP || hasFarU ) {
      const distFarH0 = distanceSquaredToLine(leftFarTri[1], rEdgeWall.origin, rEdgeWall.direction);
      const distFarH1 = distanceSquaredToLine(rightFarTri[1], rEdgeWall.origin, rEdgeWall.direction);

      // Penumbra line.
      // Set by either the lower tangent or the horizontal tangents.
      if ( hasFarP ) {
        const distFarP = distanceSquaredToLine(farPenumbraTri[1], rEdgeWall.origin, rEdgeWall.direction);
        this.fFarDistances[PENUMBRA] = sqrt(max(max(distFarH0, distFarH1), distFarP));
      }

      // Umbra line.
      // Set by either the upper tangent or the horizontal tangents.
      if ( hasFarU ) {
        const distFarU = distanceSquaredToLine(farUmbraTri[1], rEdgeWall.origin, rEdgeWall.direction);
        this.fFarDistances[UMBRA] = sqrt(min(min(distFarH0, distFarH1), distFarU));
      }
    }

    if ( hasNearP || hasNearU ) {
      const distNearH0 = distanceSquaredToLine(leftNearTri[1], rEdgeWall.origin, rEdgeWall.direction);
      const distNearH1 = distanceSquaredToLine(rightNearTri[1], rEdgeWall.origin, rEdgeWall.direction);

      // Penumbra line.
      // Set by either the upper tangent or the horizontal tangents.
      if ( hasNearP ) {
        const distNearP = distanceSquaredToLine(nearPenumbraTri[1], rEdgeWall.origin, rEdgeWall.direction);
        this.fNearDistances[PENUMBRA] = sqrt(min(min(distNearH0, distNearH1), distNearP));
      }
      // Umbra line.
      // Set by either the lower tangent or the horizontal tangents.
      if ( hasNearU ) {
        const distNearU = distanceSquaredToLine(nearUmbraTri[1], rEdgeWall.origin, rEdgeWall.direction);
        this.fNearDistances[UMBRA] = sqrt(max(max(distNearH0, distNearH1), distNearU));
      }
    }

    // Left-right distances for non-collinear scenario
    this.fFarRLPenumbraDistances = vec2(0.0);
    this.fFarRLUmbraDistances = vec2(0.0);
    this.fNearRLPenumbraDistances = vec2(0.0);
    this.fNearRLUmbraDistances = vec2(0.0);

    // Assume infinite distances, set by the penumbra points.
    // Umbra distances are 0 by default.
    /*
    idx = Number(CLOCKWISE(orient(rRLWall.origin, ptLRWall, penumbraTri[2]))); // Right: 1, left 0
    const rPIdx = idx + 1; // If [2] is right: 1 + 1 = 2; otherwise 0 + 1 = 1.
    const lPIdx = 2 - idx; // If [2] is right: 2 - 1 = 1; otherwise 2 - 0 = 2.
    const maxRPt = penumbraTri[rPIdx];
    const maxLPt = penumbraTri[lPIdx];
    const maxRDist = distanceToLine(maxRPt, rRLWall.origin, rRLWall.direction);
    const maxLDist = distanceToLine(maxLPt, rRLWall.origin, rRLWall.direction);
    this.fFarRLPenumbraDistances[RIGHT] = maxRDist;
    this.fFarRLPenumbraDistances[LEFT] = maxLDist;
    this.fNearRLPenumbraDistances[RIGHT] = maxRDist;
    this.fNearRLPenumbraDistances[RIGHT] = maxLDist;
    */

    if ( !nearCollinear && (hasFarP || hasFarU) ) {
      const farLDist = distanceSquaredToLine(leftFarTri[1], rRLWall.origin, rRLWall.direction);
      const farRDist = distanceSquaredToLine(rightFarTri[1], rRLWall.origin, rRLWall.direction);
      if ( hasFarP ) {
        const idx = Number(CLOCKWISE(orient(rRLWall.origin, projRLPt, farPenumbraTri[2]))); // 2 is right: idx 1; 2 is left: idx 0
        const lIdx = 2 - idx; // 2 is right: 2 - 1 = 1; 2 is left: 2 - 0 = 2
        const rIdx = idx + 1; // 2 is right: 1 + 1 = 2; 2 is left: 0 + 1 = 1

        const farPDistL = distanceSquaredToLine(farPenumbraTri[lIdx], rRLWall.origin, rRLWall.direction);
        const farPDistR = distanceSquaredToLine(farPenumbraTri[rIdx], rRLWall.origin, rRLWall.direction);
        this.fFarRLPenumbraDistances[RIGHT] = sqrt(max(farRDist, farPDistR));
        this.fFarRLPenumbraDistances[LEFT] = sqrt(max(farLDist, farPDistL));
      }
      if ( hasFarU ) {
        const idx = Number(COUNTERCLOCKWISE(orient(rRLWall.origin, projRLPt, farUmbraTri[2]))); // 2 is right: idx 1; 2 is left: idx 0
        const lIdx = 2 - idx; // 2 is right: 2 - 1 = 1; 2 is left: 2 - 0 = 2
        const rIdx = idx + 1; // 2 is right: 1 + 1 = 2; 2 is left: 0 + 1 = 1

        const wallDist = distanceSquared(W0, rRLWall.origin);
        const farUDistL = distanceSquaredToLine(farUmbraTri[lIdx], rRLWall.origin, rRLWall.direction);
        const farUDistR = distanceSquaredToLine(farUmbraTri[rIdx], rRLWall.origin, rRLWall.direction);
        this.fFarRLUmbraDistances[RIGHT] = sqrt(min(min(wallDist, farRDist), farUDistR));
        this.fFarRLUmbraDistances[LEFT] = sqrt(min(min(wallDist, farLDist), farUDistL));
      }
    }

    if ( !nearCollinear && (hasNearP || hasNearU) ) {
      const nearLDist = distanceSquaredToLine(leftNearTri[1], rRLWall.origin, rRLWall.direction);
      const nearRDist = distanceSquaredToLine(rightNearTri[1], rRLWall.origin, rRLWall.direction);
      if ( hasNearP ) {
        const idx = Number(CLOCKWISE(orient(rRLWall.origin, projRLPt, nearPenumbraTri[2]))); // 2 is right: idx 1; 2 is left: idx 0
        const lIdx = 2 - idx; // 2 is right: 2 - 1 = 1; 2 is left: 2 - 0 = 2
        const rIdx = idx + 1; // 2 is right: 1 + 1 = 2; 2 is left: 0 + 1 = 1

        const nearPDistL = distanceSquaredToLine(nearPenumbraTri[lIdx], rRLWall.origin, rRLWall.direction);
        const nearPDistR = distanceSquaredToLine(nearPenumbraTri[rIdx], rRLWall.origin, rRLWall.direction);
        this.fNearRLPenumbraDistances[RIGHT] = sqrt(max(nearRDist, nearPDistR));
        this.fNearRLPenumbraDistances[LEFT] = sqrt(max(nearLDist, nearPDistL));
      }
      if ( hasNearU ) {
        const idx = Number(COUNTERCLOCKWISE(orient(rRLWall.origin, projRLPt, nearUmbraTri[2]))); // 2 is right: idx 1; 2 is left: idx 0
        const lIdx = 2 - idx; // 2 is right: 2 - 1 = 1; 2 is left: 2 - 0 = 2
        const rIdx = idx + 1; // 2 is right: 1 + 1 = 2; 2 is left: 0 + 1 = 1

        const wallDist = distanceSquared(W0, rRLWall.origin);
        const nearUDistL = distanceSquaredToLine(nearUmbraTri[lIdx], rRLWall.origin, rRLWall.direction);
        const nearUDistR = distanceSquaredToLine(nearUmbraTri[rIdx], rRLWall.origin, rRLWall.direction);
        this.fNearRLUmbraDistances[RIGHT] = sqrt(min(min(wallDist, nearRDist), nearUDistR));
        this.fNearRLUmbraDistances[LEFT] = sqrt(min(min(wallDist, nearLDist), nearUDistL));
      }
    }

    // Left-right distances for collinear scenario
    // The left/right triangles define the penumbra left/right distance.
    // For the side with the umbra triangle, it defines the umbra left/right distance.
    // Assume the other side has umbra 0.
    // If farPenumbraTri is collinear with the wall, 0 umbra for both sides.
    const oFarP = orient(W0, W1, farPenumbraTri[1]);
    if ( nearCollinear ) {
      if ( hasFarP ) {
        this.fFarRLPenumbraDistances[RIGHT] = distanceToLine(rightFarTri[1], rRLWall.origin, rRLWall.direction);
        this.fFarRLPenumbraDistances[LEFT] = distanceToLine(leftFarTri[1], rRLWall.origin, rRLWall.direction);
      }
      if ( hasFarU && !COLLINEAR(oFarP) ) {
        const side = CLOCKWISE(oFarP) ? RIGHT : LEFT;
        this.fFarRLUmbraDistances[side] = distanceToLine(farUmbraTri[1], rRLWall.origin, rRLWall.direction);
        // Otherwise collinear and umbra is 0 for both sides.
      }

      if ( hasNearP ) {
        this.fNearRLPenumbraDistances[RIGHT] = distanceToLine(rightNearTri[1], rRLWall.origin, rRLWall.direction);
        this.fNearRLPenumbraDistances[LEFT] = distanceToLine(leftNearTri[1], rRLWall.origin, rRLWall.direction);
      }
      if ( hasNearU && !COLLINEAR(oFarP) ) {
        const side = CLOCKWISE(oFarP) ? RIGHT : LEFT;
        this.fNearRLUmbraDistances[side] = distanceToLine(nearUmbraTri[1], rRLWall.origin, rRLWall.direction);
        // Otherwise collinear and umbra is 0 for both sides.
      }
    }
  }

  /**
   * Define the left/right triangles
   * @param {vec2} D, E, F, G, H, I
   * @param {out vec2[3]} rightFarTri
   * @param {out vec2[3]} leftFarTri

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
      normalizedDirection,
      almostEqual } = glsl;
    const { uLightSize } = this;
    const vertexNum = this.gl_VertexID % 3;
    const wall = this.wall = this.calculateWallPositions();
    this.shrinkOverlappingWall(wall);

    // Side shadows.
    const sideShadowRays = this.sideShadowRays = this.calculateSideShadowRays(wall);

    // Lowest and highest point of the sphere that forms a tangent with the wall.
    const wallMid3d = vec3(wall.mid, wall.top[0].z);
    const vTangents = this.vTangents = [vec3(0.0), vec3(0.0)];
    const hasTangents = this.verticalTangents(wallMid3d, vTangents);
    if ( !hasTangents ) new Error(`${MODULE_ID}|shadowPoints|No vertical tangents found!`);

    // Shadow triangle for the lower tangent, representing the furthest distance.
    const idx = Number(vTangents[0].z > vTangents[1].z); // Pick the lower in z direction.
    const lowerTangent = vTangents[idx];
    const upperTangent = vTangents[idx - 1];
    const farPenumbraTri = this.farPenumbraTri = this.shadowTriangle(lowerTangent, wall, true);

    // Triangles defining parts of the shadow.
    const penumbraTri = this.penumbraTri = [vec2(), vec2(), vec2()];
    const DEF = this.DEF = [vec2(), vec2(), vec2()];
    const GHI = this.GHI = [vec2(), vec2(), vec2()];
    const nearCollinear = this.shadowPoints(wall, sideShadowRays, farPenumbraTri,
      penumbraTri[0], penumbraTri[1], penumbraTri[2], DEF[0], DEF[1], DEF[2], GHI[0], GHI[1], GHI[2]);

    // If a linked wall is fully blocking, don't use a side shadow.
    let hasSide0 = true;
    let hasSide1 = true;
    if ( !nearCollinear ) {
      hasSide0 = !almostEqual(sideShadowRays.umbra[0].direction, sideShadowRays.penumbra[0].direction, 1.0e-06);
      hasSide1 = !almostEqual(sideShadowRays.umbra[1].direction, sideShadowRays.penumbra[1].direction, 1.0e-06);
    }

    // Varyings
    this.defineSharedVaryings(wall, penumbraTri);
    this.defineVaryings(wall, penumbraTri, DEF[2], GHI[2], hasSide0, hasSide1);

    // Flats
    if ( vertexNum === 2 ) {
      this.defineSharedFlats(wall, penumbraTri);
      this.defineFlats(wall, penumbraTri, farPenumbraTri, DEF, GHI, lowerTangent, upperTangent);
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
    const {
      fWallHeights,
      fAmbient,
      fFarDistances,
      fNearDistances,
      fFarRLPenumbraDistances,
      fFarRLUmbraDistances,
      fNearRLPenumbraDistances,
      fNearRLUmbraDistances } = this.flats;
    const { vSidePenumbra0, vSidePenumbra1, vUmbra, vEdgeDist, vLREdgeDist } = this.varyings;
    const { uElevationRes } = this;
    const { between, linearConversion, barycentricPointInsideTriangle, mix, any, notEqual, clamp } = glsl;

    // Debugging
    this.setVaryings(pt);

    // Default to 1.0 for parts that are not affecting the shadow.
    let farShadow = 1.0;
    let nearShadow = 1.0;
    let side0Shadow = 1.0;
    let side1Shadow = 1.0;
    let umbraShadow = 1.0;
    let farLShadow = 1.0;
    let farRShadow = 1.0;
    let nearLShadow = 1.0;
    let nearRShadow = 1.0;

    let farPenumbraDist = fFarDistances[PENUMBRA];
    let farUmbraDist = fFarDistances[UMBRA];
    let nearPenumbraDist = fNearDistances[PENUMBRA];
    let nearUmbraDist = fNearDistances[UMBRA];

    let farLPenumbraDist = fFarRLPenumbraDistances[LEFT];
    let farLUmbraDist = fFarRLUmbraDistances[LEFT];
    let nearLPenumbraDist = fNearRLPenumbraDistances[LEFT];
    let nearLUmbraDist = fNearRLUmbraDistances[LEFT];
    let farRPenumbraDist = fFarRLPenumbraDistances[RIGHT];
    let farRUmbraDist = fFarRLUmbraDistances[RIGHT];
    let nearRPenumbraDist = fNearRLPenumbraDistances[RIGHT];
    let nearRUmbraDist = fNearRLUmbraDistances[RIGHT];

    // TODO: Cannot use the normal method to modify the non-collinear LR distances by elevation.
    // Is there another way?
    const isCollinear = fAmbient[0] * fAmbient[1] !== 0.0;
    const isLeft = vLREdgeDist > 0.0;
    const hasFar = any(notEqual(fFarDistances, vec2(0.0)));
    const hasNear = any(notEqual(fNearDistances, vec2(0.0)));
    if ( hasFar || hasNear ) {
      // In GLSL:
      // float canvasElevation = uElevationRes.x;
      // float elevation = terrainElevation(uTerrainSampler, vTerrainTexCoord, uElevationRes);
      farPenumbraDist = this.farPenumbraDistance(elevation);
      if ( hasFar && vEdgeDist > farPenumbraDist ) return { hasShadow: 0.0 }; // Outside the penumbra.

      nearPenumbraDist = this.nearPenumbraDistance(elevation);
      if ( hasNear && !isCollinear && vEdgeDist < nearPenumbraDist ) return { hasShadow: 0.0 }; // In front of the wall shadow.

      farUmbraDist = this.farUmbraDistance(elevation);
      nearUmbraDist = this.nearUmbraDistance(elevation);

      farLPenumbraDist = this.farLPenumbraDistance(elevation);
      if ( isLeft && isCollinear
        && farLPenumbraDist !== 0.0
        && vLREdgeDist > farLPenumbraDist ) return { hasShadow: 0.0 }; // Outside the penumbra.

      farRPenumbraDist = this.farRPenumbraDistance(elevation);
      if ( !isLeft
        && isCollinear
        && farRPenumbraDist !== 0.0
        && -vLREdgeDist > farRPenumbraDist ) return { hasShadow: 0.0 }; // Outside the penumbra.

      nearLPenumbraDist = this.nearLPenumbraDistance(elevation);
      nearRPenumbraDist = this.nearRPenumbraDistance(elevation);
      farLUmbraDist = this.farLUmbraDistance(elevation);
      farRUmbraDist = this.farRUmbraDistance(elevation);
      nearLUmbraDist = this.nearLUmbraDistance(elevation);
      nearRUmbraDist = this.nearRUmbraDistance(elevation);
    }

    // If in the far or near shadow, blend between penumbra (0) and umbra (1).
    // If in the far or near left/right shadow, blend between penumbra (0) and umbra (1).
    if ( hasFar ) {
      farShadow = clamp(linearConversion(vEdgeDist, farPenumbraDist, farUmbraDist, 0.0, 1.0), 0.0, 1.0);
      if ( isCollinear ) {
        farLShadow = (farLPenumbraDist === 0.0 && farLUmbraDist === 0.0)
          ? 1.0 : clamp(linearConversion(vLREdgeDist, farLPenumbraDist, farLUmbraDist, 0.0, 1.0), 0.0, 1.0);
        farRShadow = (farRPenumbraDist === 0.0 && farRUmbraDist === 0.0)
          ? 1.0 : clamp(linearConversion(-vLREdgeDist, farRPenumbraDist, farRUmbraDist, 0.0, 1.0), 0.0, 1.0);
      }
    }

    if ( hasNear ) {
      nearShadow = clamp(linearConversion(vEdgeDist, nearPenumbraDist, nearUmbraDist, 0.0, 1.0), 0.0, 1.0);
      if ( isCollinear ) {
        nearLShadow = (nearLPenumbraDist === 0.0 && nearLPenumbraDist === 0.0)
          ? 1.0 : clamp(linearConversion(vLREdgeDist, nearLPenumbraDist, nearLPenumbraDist, 0.0, 1.0), 0.0, 1.0);
        nearRShadow = (nearRPenumbraDist === 0.0 && nearRPenumbraDist === 0.0)
          ? 1.0 : clamp(linearConversion(-vLREdgeDist, nearRPenumbraDist, nearRPenumbraDist, 0.0, 1.0), 0.0, 1.0);
      }
    }

    // Blend the two side penumbras if overlapping by multiplying the light amounts.
    // Needs to be 1.0 if outside the penumbra.
    // if ( inSidePenumbra0() ) side0Shadow = vSidePenumbra0.z / (vSidePenumbra0.y + vSidePenumbra0.z);
    // if ( inSidePenumbra1() ) side1Shadow = vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z);
    const inSide0 = Number(this.inSidePenumbra0());
    const inSide1 = Number(this.inSidePenumbra1());
    const denom0 = vSidePenumbra0.y + vSidePenumbra0.z;
    const denom1 = vSidePenumbra1.y + vSidePenumbra1.z;
    side0Shadow = denom0 === 0.0 ? 1.0 : (inSide0 * vSidePenumbra0.z / denom0) + (1.0 - inSide0);
    side1Shadow = denom1 === 0.0 ? 1.0 : (inSide1 * vSidePenumbra1.z / denom1) + (1.0 - inSide1);

    /*
    1.0 * 0.0 = 0.0  / 0.25 = 0       (1 - x) = 1.0
    0.9 * 0.1 = 0.09 / 0.25 = 0.0225  (1 - x) = 0.9775
    0.6 * 0.4 = 0.24 / 0.25 = 0.96    (1 - x) = 0.04
    0.5 * 0.5 = 0.25 / 0.25 = 1.0     (1 - x) = 0.0
    0.4 * 0.6 = 0.24 / 0.25 = 0.96    (1 - x) = 0.04
    0.1 * 0.9 = 0.09 / 0.25 = 0.0225  (1 - x) = 0.9775
    0.0 * 1.0 = 0.0  / 0.25 = 0       (1 - x) = 1.0
    */
    if ( isCollinear ) {
      if ( this.inSidePenumbra0() ) side0Shadow *= fAmbient[0];
      if ( this.inSidePenumbra1() ) side1Shadow *= fAmbient[1];

      // Add in umbra shadow if any.
      if ( barycentricPointInsideTriangle(vUmbra) ) {
        const percentL = vUmbra.z / (vUmbra.y + vUmbra.z);
        const percentR = 1.0 - percentL;
        umbraShadow = 1.0 - (percentL * percentR / 0.25); // 0.5 * 0.5 = 0.25; normalize to 1.0.
        const ambient = mix(fAmbient[0], fAmbient[1], percentL); // Blend b/c wall no longer fully blocks at umbra.
        // umbraShadow *= ambient;
      }
    }

    // Debugging.
    return {
      side0Shadow,
      side1Shadow,
      farShadow,
      nearShadow,
      umbraShadow,
      farLShadow,
      nearLShadow,
      farRShadow,
      nearRShadow};
  }

  /* ----- NOTE: Debugging ----- */
  drawLight() {
    Draw.point(this.uLightPosition, {
      radius: this.uLightSize,
      color: Draw.COLORS.yellow,
      fillAlpha: 0.5
    });
  }

  drawUmbraTriangle() {
    const tri = this.umbraTri;
    const poly = new PIXI.Polygon(...tri);
    const color = Draw.COLORS.red;
    Draw.shape(poly, { color });
  }

  drawRLFarTri(idx = 0) {
    const tri = [this.rightFarTri, this.leftFarTri][idx];
    const poly = new PIXI.Polygon(...tri);
    const color = [Draw.COLORS.greenyellow, Draw.COLORS.orange][idx];
    Draw.shape(poly, { color });
  }

  drawRLNearTri(idx = 0) {
    const tri = [this.rightNearTri, this.leftNearTri][idx];
    const poly = new PIXI.Polygon(...tri);
    const color = [Draw.COLORS.greenyellow, Draw.COLORS.orange][idx];
    Draw.shape(poly, { color });
  }

  drawSideTriangle(idx = 0) {
    const tri = [this.sideTri0, this.sideTri1][idx];
    const poly = new PIXI.Polygon(...tri);
    const color = [Draw.COLORS.blue, Draw.COLORS.green][idx];
    Draw.shape(poly, { color });
  }

  drawFarNearPenumbraTri(idx = 0) {
    const tri = [this.farPenumbraTri, this.nearPenumbraTri][idx];
    const poly = new PIXI.Polygon(...tri);
    const color = Draw.COLORS.yellow;
    Draw.shape(poly, { color });
  }

  drawFarNearUmbraTri(idx = 0) {
    const tri = [this.farUmbraTri, this.nearUmbraTri][idx];
    const poly = new PIXI.Polygon(...tri);
    const color = Draw.COLORS.red;
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
   * Determine the closer and further endpoints.
   * @param {vec2[2]} pts
   * @returns {int} Index for the closer endpoint.
   */
  closerEndpoint(pts) {
    const { uAzimuth } = this;
    const { distanceSquared, fromAngle, Ray2d, projectRay } = glsl;
    const orient = foundry.utils.orient2dFast;

    const dirMid = fromAngle(vec2(0.0), uAzimuth, 1.0).multiplyScalar(-1.0);
    const perpDir = vec2(dirMid.y, -dirMid.x);
    const r01 = Ray2d(pts[0], perpDir);
    const b = projectRay(r01, 1.0);
    return Number(COUNTERCLOCKWISE(orient(pts[0], b, pts[1]))); // TODO: Confirm.
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

    return ShadowRays2d({
      umbra,
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

    sideShadowRays = shader0.sideShadowRays
    farShadowDirs = shader0.farShadowDirs
    wall = shader0.wall
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
      equal,
      normalize } = glsl;

    // A found by intersecting the two side penumbra lines.
    lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.penumbra[1], A);

    // Endpoint closest to the light will be associated with ∆DEF; furthest is ∆GHI.
    // Can determine by comparing distance to the penumbra vertex 0 (A).
    let closestIdx = distanceSquared(A, wall.top[1].xy) < distanceSquared(A, wall.top[0].xy) ? 1 : 0;
    W0.set(wall.top[closestIdx].xy);
    W1.set(wall.top[1 - closestIdx].xy);
    const nearCollinear = almostEqual(W0, A, 1.0e-08);

    if ( nearCollinear ) {
      this._shadowPointsNearCollinear(sideShadowRays, farShadowDirs, wall, A, B, C, D, E, F, G, H, I, W0, W1);
    } else this._shadowPoints(sideShadowRays, farShadowDirs, wall, A, B, C, D, E, F, G, H, I, W0, W1);
    return nearCollinear;

  }


  /**
   * For infinite shadow, construct the different points of the triangle.
   * @param {ShadowRays2d} sideShadowRays
   * @param {ShadowDirections} farShadowDirs
   * @param {Wall} wall
   * @param {out vec2} A...I, W0, W1
   * @returns {bool} True if nearly collinear wall to the light.
   */
  _shadowPoints(sideShadowRays, farShadowDirs, wall, A, B, C, D, E, F, G, H, I, W0, W1) {
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
      equal,
      normalize } = glsl;

    const nearCollinear = false;


    // Two sets of penumbra/umbra rays. Each set:
    // - One ray through each endpoint.
    // - For directional, the rays are parallel unless modified by linked wall.
    // - Intersect at the canvas such that a line connects them that is parallel to the wall.
    // These form the ∆DEF / []DEFG and ∆GHI / []GHID shapes.

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

    // For directional, D is the closer endpoint, G is the further.
    D.set(W0);
    G.set(W1);

    // Adjust for infinite shadows and near-collinear walls.
    // E and H are where the penumbra lines intersects the canvas.


    // Determine where the shadow hits the plane.
    // Technically, the penumbra point along the plane is curved for a spherical light.
    // Ignoring that; treating sphere as a cube.
    // No infinite shadows for directional lights.
    // E and H are where the penumbra lines intersects the canvas.
    // Need to intersect D and G separately? Or could this work from wall midpoint?
    const canvasPlane = this.constructCanvasPlane();
    const zDelta = this._calculateZChangeRays();
    const canvasIxD = vec3();
    const canvasIxG = vec3();
    const rD = Ray(vec3(rD_penumbra.origin, wall.top[0].z), normalize(vec3(rD_penumbra.direction, zDelta[PENUMBRA])));
    const rG = Ray(vec3(rG_penumbra.origin, wall.top[0].z), normalize(vec3(rG_penumbra.direction, zDelta[PENUMBRA])));
    intersectRayPlane(rD, canvasPlane, canvasIxD);
    intersectRayPlane(rG, canvasPlane, canvasIxG);
    E.set(canvasIxD.xy);
    H.set(canvasIxG.xy);

    const canvasIxDu = vec3();
    const canvasIxGu = vec3();
    const rDu = Ray(vec3(rD_umbra.origin, wall.top[0].z), normalize(vec3(rD_umbra.direction, zDelta[PENUMBRA])));
    const rGu = Ray(vec3(rG_umbra.origin, wall.top[0].z), normalize(vec3(rG_umbra.direction, zDelta[PENUMBRA])));
    intersectRayPlane(rDu, canvasPlane, canvasIxDu);
    intersectRayPlane(rGu, canvasPlane, canvasIxGu);
    F.set(canvasIxDu.xy);
    I.set(canvasIxGu.xy);

    // E is always further than H?
    // E->F is parallel to the wall
    // H->I is paralle to the wall
    const rCanvasWallE = Ray2d(E, wall.direction);
    lineLineIntersection(rD_penumbra, rCanvasWallE, B);
    lineLineIntersection(rG_penumbra, rCanvasWallE, C);
  }

  /**
   * For infinite shadow, construct the different points of the triangle.
   * @param {ShadowRays2d} sideShadowRays
   * @param {ShadowDirections} farShadowDirs
   * @param {Wall} wall
   * @param {out vec2} A...I, W0, W1
   * @returns {bool} True if nearly collinear wall to the light.
   */
  _shadowPointsNearCollinear(sideShadowRays, farShadowDirs, wall, A, B, C, D, E, F, G, H, I, W0, W1) {
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
      equal,
      normalize } = glsl;

    const nearCollinear = true;

    // Two sets of penumbra/umbra rays. Each set:
    // - One ray through each endpoint.
    // - For directional, the rays are parallel unless modified by linked wall.
    // - Intersect at the canvas such that a line connects them that is parallel to the wall.
    // These form the ∆DEF / []DEFG and ∆GHI / []GHID shapes.

    // A, D, and G are all at W0.
    A.set(W0); // Ensure this is exactly equal.
    D.set(W0);
    G.set(W0);

    // Quads []DEFW1 and []GHIW1
    const rAB = sideShadowRays.penumbra[0];
    const rAC = sideShadowRays.penumbra[1];
    const rD_penumbra = rAB;
    const rG_penumbra = rAC;

    // Umbras must run parallel.
    const umbraIdx = almostEqual(sideShadowRays.umbra[0].direction, sideShadowRays.penumbra[0].direction, 1.0e-08)
      ? 0 : 1;
    const rD_umbra = sideShadowRays.umbra[umbraIdx];
    const rG_umbra = sideShadowRays.umbra[1 - umbraIdx];

    // Determine where the shadow hits the plane.
    // Technically, the penumbra point along the plane is curved for a spherical light.
    // Ignoring that; treating sphere as a cube.
    // No infinite shadows for directional lights.
    // E and H are where the penumbra lines intersects the canvas.
    // Need to intersect D and G separately b/c the midpoint trick does not work for collinear walls.
    // W0 === D === G
    const canvasPlane = this.constructCanvasPlane();
    const zDelta = this._calculateZChangeRays();
    const canvasIxD = vec3();
    const canvasIxG = vec3();
    const rD = Ray(vec3(rD_penumbra.origin, wall.top[0].z), normalize(vec3(rD_penumbra.direction, zDelta[PENUMBRA])));
    const rG = Ray(vec3(rG_penumbra.origin, wall.top[0].z), normalize(vec3(rG_penumbra.direction, zDelta[PENUMBRA])));
    intersectRayPlane(rD, canvasPlane, canvasIxD);
    intersectRayPlane(rG, canvasPlane, canvasIxG);
    E.set(canvasIxD.xy);
    H.set(canvasIxG.xy);

    /* Same result as using the canvas wall, below.
    const canvasIxDu = vec3();
    const canvasIxGu = vec3();
    const rDu = Ray(vec3(rD_umbra.origin, wall.top[0].z), normalize(vec3(rD_umbra.direction, zDelta[PENUMBRA])));
    const rGu = Ray(vec3(rG_umbra.origin, wall.top[0].z), normalize(vec3(rG_umbra.direction, zDelta[PENUMBRA])));
    intersectRayPlane(rDu, canvasPlane, canvasIxDu);
    intersectRayPlane(rGu, canvasPlane, canvasIxGu);
    F.set(canvasIxDu.xy);
    I.set(canvasIxGu.xy);
    */

    // Forms a quad using the canvas wall as the far edge.
    const rCanvasWallE = Ray2d(E, wall.direction);
    const rCanvasWallH = Ray2d(H, wall.direction);
    lineLineIntersection(rCanvasWallE, rD_umbra, F);
    lineLineIntersection(rCanvasWallH, rG_umbra, I);

    // Penumbra intersect the FI line to form ∆ABC.
    const rFI = Ray2d(F, I.subtract(F));
    lineLineIntersection(rD_penumbra, rFI, B);
    lineLineIntersection(rG_penumbra, rFI, C);

    // For debugging, extend B and C.
    /*
    const rAB2 = Ray2d(A, B.subtract(A));
    const rAC2 = Ray2d(A, C.subtract(A));
    B.set(projectRay(rAB2, 2.0));
    C.set(projectRay(rAC2, 2.0));
    */
  }


  /**
   * Define the different shadow triangles.
   * @param {ShadowRays2d} sideShadowRays
   * @param {ShadowDirections} farShadowDirs
   * @param {Wall} wall
   * @param {out vec2[3]} penumbraTri, umbraTri, nearFarTri0, nearFarTri1, sideTri0, sideTri1
   * @returns {bool} True if the wall is nearly collinear.
   */
  shadowTriangles(sideShadowRays, farShadowDirs, wall, penumbraTri, umbraTri, nearFarTri0, nearFarTri1,
    sideTri0, sideTri1) {
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

    // For debugging.
    this._points = { A, B, C, D, E, F, G, H, I, W0, W1 };

    // Use function to mimic setting out values for the triangles.
    const setTri = function(tri, values) { tri.splice(0, values.length, ...values); };

    setTri(penumbraTri, [A, B, C]);

    // Side triangles used for gradient shading.
    setTri(sideTri0, [D, E, I]);
    setTri(sideTri1, [G, H, F]);

    // Umbra triangle used for shading.
    setTri(umbraTri, [D, G, I]);

    if ( nearCollinear ) {
      setTri(sideTri0, [A, B, C]);
      setTri(sideTri1, [A, C, B]);
      setTri(umbraTri, [G, F, I]);
    }

    // For debugging:
    // The polygon that encompasses the wall shadow.
    setTri(nearFarTri0, [D, E, F, G]);
    setTri(nearFarTri1, [G, H, I, D]);
    if ( nearCollinear ) {
      this.nearFarTri0[3] = W1;
      this.nearFarTri1[3] = W1;
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
    this.fAmbient = vec2(1.0, 0.0); // Sized Light: vec2(1.0).subtract(this.ambientLight(W0, W1));
    if ( CLOCKWISE(orient(W0, W1, sideTri0[1])) ) this.fAmbient = this.fAmbient.yx; // CW

    // Similar to unsized defineFlats.
    // For far, if umbra is infinite, penumbra will be infinite.
    const hasFarUmbra = !this.isInfiniteTopShadow(farShadowDirs.umbra);
    const hasFarPenumbra = !(hasFarUmbra || this.isInfiniteTopShadow(farShadowDirs.penumbra));
    const hasNearPenumbra = this.wallIsFloating() && !this.isInfiniteTopShadow(nearShadowDirs.penumbra);
    const hasNearUmbra = this.wallIsFloating() && !this.isInfiniteTopShadow(nearShadowDirs.umbra);
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

    //

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
      if ( this.wallIsFloating() ) this.nearShadowDirs = this.calculateNearShadowDirections(wall);
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
    this.shrinkOverlappingWall(wall);

    // Side shadows.
    const sideShadowRays = this.sideShadowRays = this.calculateSideShadowRays(wall);

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
   * @param {Ray) r
   * @returns {int}
   */
  wallCollision(r) {
    const orient = foundry.utils.orient2dFast;
    const { vVertexPosition, vEdgeDist } = this.varyings;
    const { fWallTop0, fWallTop1, fWallBottom0, fWallBottom1 } = this.flats;
    const { normalizedDirection, distance, projectRay, lineLineIntersection, Ray2d } = glsl;

    const hWall0 = fWallTop0.xy;
    const hWall1 = fWallTop1.xy;
    const vWall0 = vec2(0.0, fWallTop0.z);
    const vWall1 = vec2(0.0, fWallBottom0.z);

    // Move 1 pixel toward the light, to measure orientation w/r/t the light ray.
    const b = projectRay(r, 1.0);

    // Test for horizontal collision. Wall endpoints are opposite sides of the light ray.
    const hCollision = OPP_SIDE(orient(r.origin.xy, b.xy, hWall0), orient(r.origin.xy, b.xy, hWall1));
    if ( !hCollision ) return 0;

    // Test for vertical collision. Transform coordinates based on direction to wall.
    const rWall = Ray2d(hWall0, hWall1.subtract(hWall0));
    const wallIx = vec2();
    lineLineIntersection(Ray2d(r.origin.xy, r.direction.xy), rWall, wallIx);

    const distA = distance(r.origin.xy, wallIx);
    const distB = distance(b.xy, wallIx);
    const vA = vec2(distA, r.origin.z);
    const vB = vec2(distB, b.z);
    const vCollision = OPP_SIDE(orient(vA, vB, vWall0), orient(vA, vB, vWall1));
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
      numCollisions += this.wallCollision(Ray(a, normalizedDirection(a, pts[i])));
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
    const hCollision = OPP_SIDE(orient(vVertexPosition, b3d.xy, hWall0), orient(vVertexPosition, b3d.xy, hWall1));
    if ( !hCollision ) return 0;

    // Test for vertical collision. Transform coordinates based on direction to wall.
    const vA = vec2(vEdgeDist, elevation);
    const distB = distanceToLine(b3d.xy, hWall0, normalizedDirection(hWall0, hWall1));
    const vB = vec2(distB, b3d.z);
    const vCollision = OPP_SIDE(orient(vA, vB, vWall0), orient(vA, vB, vWall1));
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


UMBRA = 0;
MIDPENUMBRA = 2;
PENUMBRA = 1;
TOP = 0
BOTTOM = 1
FAR = 0
NEAR = 1
RIGHT = 0; // RIGHT is 0 or for cw, -1
LEFT = 1
SAME_SIDE = (o0, o1) => o0 * o1 > 0.0;
OPP_SIDE = (o0, o1) => o0 * o1 < 0.0;
COLLINEAR = o => glsl.almostEqual(o, 0.0, 1.0e-06);
COUNTERCLOCKWISE = o => o > 0.0;
CLOCKWISE = o => o < 0.0;

l = canvas.lighting.placeables[0];
edge0 = canvas.walls.placeables[0].edge
ev = l.lightSource.elevatedvision
let [shader0, shader1] = SizedShadowsTest.fromMesh(ev.shadowMesh)

shader0.canvasElevation = 0
shader0.vertexCalculations(2)

shader0.drawWall();
shader0.drawLight();
shader0.drawPenumbraTriangle();
shader0.drawSideShadowRays();
shader0.drawUmbraTriangle()
shader0.drawSideTriangle(0)
shader0.drawSideTriangle(1)
shader0.drawFarNearPenumbraTri(FAR);
shader0.drawFarNearUmbraTri(FAR);
shader0.drawRLFarTri(RIGHT)
shader0.drawRLFarTri(LEFT)
shader0.drawFarNearPenumbraTri(NEAR);
shader0.drawFarNearUmbraTri(NEAR);
shader0.drawRLNearTri(RIGHT)
shader0.drawRLNEarTri(LEFT)

let [A, B, C] = shader0.penumbraTri
let [D, E, F] = shader0.DEF
let [G, H, I] = shader0.GHI
let W0 = shader0.wall.top[0].xy
let W1 = shader0.wall.top[1].xy
let farPenumbraTri = shader0.farPenumbraTri

// Treat as cube
uLightPosition = shader0.uLightPosition
uLightSize = shader0.uLightSize
wall = shader0.wall
cubeTri0 = shader0.shadowTriangle(vec3(D, uLightPosition.z - uLightSize), wall);
cubeTri1 = shader0.shadowTriangle(vec3(G, uLightPosition.z - uLightSize), wall);
Draw.shape(new PIXI.Polygon(...cubeTri0), { color: Draw.COLORS.green })
Draw.shape(new PIXI.Polygon(...cubeTri1), { color: Draw.COLORS.blue })


sideShadowRays = shader0.sideShadowRays
drawRay(sideShadowRays.penumbra[0])
drawRay(sideShadowRays.penumbra[1])
drawRay(sideShadowRays.umbra[0], { color: Draw.COLORS.red })
drawRay(sideShadowRays.umbra[1], { color: Draw.COLORS.red })

W0 = shader0.sideTri0[0]
W1 = shader0.sideTri1[0]
if ( shader0.nearCollinear ) [W0, W1] = [shader0.sideTri0[0], shader0.sideTri0[2]]
shader0.ambientLight(W0, W1)

pt = vec2(_token.center.x, _token.center.y)
shader0.vertexCalculations(2)
shader0.setVaryings(pt)
shader0.shadowComponents(pt, 0)

shader1.vertexCalculations(2)
shader1.setVaryings(pt)
shader1.shadowComponents(pt, 0)

shader0.fragmentCalculations(pt, 0)
shader0.shadowPercentage(pt, 0)
shader0.shadowComponents(pt, 0)

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
