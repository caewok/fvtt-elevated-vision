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
    const uSceneDims = this.uniforms.uSceneDims;
    return Math.sqrt((uSceneDims.z * uSceneDims.z) + (uSceneDims.w * uSceneDims.w)) * 2.0;
  }

  /* ----- NOTE: Vertex calculations ----- */

  /**
   * @returns {Wall}
   */
  calculateWallPositions() {
    const { Wall } = glsl;
    const { aWallCorner0, aWallCorner1 } = this;

    const aTop = vec3(aWallCorner0.x, aWallCorner0.y, aWallCorner0.z);
    const bTop = vec3(aWallCorner1.x, aWallCorner1.y, aWallCorner0.z);
    const aBottom = vec3(aWallCorner0.x, aWallCorner0.y, aWallCorner1.z);
    const bBottom = vec3(aWallCorner1.x, aWallCorner1.y, aWallCorner1.z);
    return Wall({
      top: [aTop, bTop],
      bottom: [aBottom, bBottom]
    });
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
    this.defineVaryings(wall, penumbraTri);
    if ( vertexNum === 2 ) {
      this.defineSharedFlats(wall, penumbraTri);
      this.defineFlats(wall, penumbraTri);
    }
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
    this.vEdgeDist = distanceToLine(this.vVertexPosition, wall.top[0].xy,
      normalizedDirection(wall.top[0].xy, wall.top[1].xy));
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
    // it will also get assigned 0.0. Otherwise, it is some value smaller than 0.
    const furtherIdx = (1 - closerIdx) + 2; // Either 2 or 1.
    const wallDir = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
    const wallMid = wall.top[0].xy.add(wall.top[1].xy).multiplyScalar(0.5);
    const lightRay = Ray2d(penumbraTri[0], normalizedDirection(penumbraTri[0], wallMid));
    const closerIx = vec2();
    lineLineIntersection(lightRay, Ray2d(penumbraTri[closerIdx], wallDir), closerIx);

    // Could use distance(closerIx, wallMid) / distance(closerIx, penumbraTri[0]).
    // That has a square root but is simpler.
    const wallRatioRay = Ray2d(closerIx, penumbraTri[0].subtract(closerIx));
    const furtherT = lineLineIntersection(wallRatioRay, Ray2d(penumbraTri[vertexNum], wallDir));

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
    const wallDir = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
    const wallMid = wall.top[0].xy.add(wall.top[1].xy).multiplyScalar(0.5);
    const lightRay = Ray2d(penumbraTri[0], normalizedDirection(penumbraTri[0], wallMid));
    const closerIx = vec2();
    lineLineIntersection(lightRay, Ray2d(penumbraTri[closerIdx], wallDir), closerIx);

    // Could use distance(closerIx, wallMid) / distance(closerIx, penumbraTri[0]).
    // That has a square root but is simpler.
    const wallRatioRay = Ray2d(closerIx, penumbraTri[0].subtract(closerIx));
    const furtherT = lineLineIntersection(wallRatioRay, Ray2d(wall.top[0].xy, wallDir));
    return furtherT;
  }

  /**
   * For infinite wall shadow, point outside of canvas that can be the fake floor intersection.
   * Either a point on the 45º line at a scene corner or a scene edge point.
   * @param {Ray2d[2]}
   * @returns {Ray2d}
   */
  infiniteShadowCanvasRay(lightRays) {
    const orient = foundry.utils.orient2dFast;
    const { uSceneDims } = this;
    const { Ray2d, normalizedDirection, lineLineIntersection } = glsl;

    const TL = 0;
    const TR = 1;
    const BR = 2;
    const BL = 3;

    // Ensure the shadow extends to the canvas edges.
    // Set the far parallel to intersect a corner.
    const sceneRect = Array(4); // @type vec2[4]
    sceneRect[TL] = vec2(0.0, 0.0);
    sceneRect[TR] = vec2((uSceneDims.x * 2.0) + uSceneDims.z, 0.0);
    sceneRect[BR] = vec2((uSceneDims.x * 2.0) + uSceneDims.z, (uSceneDims.y * 2.0) + uSceneDims.w);
    sceneRect[BL] = vec2(0.0, (uSceneDims.y * 2.0) + uSceneDims.w);

    // Light rays can intersect closest to the same quadrant (1 point), adjacent quadrants (2 points),
    // or opposing quadrants (3 points, middle one counts).
    const quad0 = this.directionalQuadrant(lightRays[0].direction);
    const quad1 = this.directionalQuadrant(lightRays[1].direction);

    // Adjacent quadrants; use scene edge.
    if ( quad0 === ((quad1 + 1) % 4)
      || quad0 === ((quad1 + 3) % 4) ) { // -1 + 4
      return Ray2d(sceneRect[quad0], normalizedDirection(sceneRect[quad0], sceneRect[quad1]));
    }

    // If the same corner, use the corner unless the light rays hit the same edge.
    let corner;
    if ( quad0 === quad1 ) {
      const c = sceneRect[quad0];
      const edges = [
        Ray2d(c, normalizedDirection(c, sceneRect[(quad0 + 3) % 4])), // -1 + 4
        Ray2d(c, normalizedDirection(c, sceneRect[(quad0 + 1) % 4]))
      ];

      // Make sure the first edge each ray hits is the same edge.
      const t00 = lineLineIntersection(lightRays[0], edges[0]);
      const t01 = lineLineIntersection(lightRays[0], edges[1]);
      const t10 = lineLineIntersection(lightRays[1], edges[0]);
      const t11 = lineLineIntersection(lightRays[1], edges[1]);
      const ray0Edge = t00 > 0.0 && t00 < t01 ? 0 : 1;
      const ray1Edge = t10 > 0.0 && t10 < t11 ? 0 : 1;
      if ( ray0Edge === ray1Edge ) return edges[ray0Edge];
      corner = quad0;
    }

    // If in opposing quadrants, must use the corner.
    if ( quad0 === ((quad1 + 2) % 4) ) corner = (quad0 + 1) % 4; // One apart, e.g., 1 and 3.

    // Use an ray that intersects the corner at a 45º angle to the scene rectangle at that corner.
    const corner45Dir = vec2(0.5, 0.5);
    if (corner === TL || corner === BL) corner45Dir.y *= -1.0;
    return Ray2d(sceneRect[corner], corner45Dir);
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
   * Determine the shadow percentage.
   * @returns {float}
   */
  shadowPercentage(pt, elevation) {
    if ( typeof elevation === "undefined" ) elevation = this.canvasElevation;
    else elevation = CONFIG.GeometryLib.utils.gridUnitsToPixels(elevation);
    const { uElevationRes, uLightPosition, uLightSize } = this;
    const { any, notEqual } = glsl;

    // Define the placement of the fragment and calculate varying and flat variables.
    this.setVaryings(pt);

    if ( this.thresholdApplies() ) return 0.0;
    if ( this.inFrontOfWall() ) return 0.0;

    const hasFar = any(notEqual(this.fFarRatios, vec2(-1.0)));
    const hasNear = any(notEqual(this.fNearRatios, vec2(-1.0)));
    if ( hasFar || hasNear ) {
      let farRatios = vec2(0.0);
      let nearRatios = vec2(1.0);
      const canvasElevation = uElevationRes.x;
      if ( elevation !== canvasElevation ) {
        const elevate = this._elevateShadowRatioUsingHeightFraction;
        /* eslint-disable max-len */
        if ( hasFar ) {
          const farF = this._elevationHeightFraction(elevation, this.fWallHeights[TOP]);
          if ( this.fFarRatios[UMBRA] !== -1.0 ) farRatios[UMBRA] = elevate(farRatios[UMBRA], this.fWallRatio, farF);
          if ( this.fFarRatios[PENUMBRA] !== -1.0 ) farRatios[PENUMBRA] = elevate(farRatios[PENUMBRA], this.fWallRatio, farF);
        }
        if ( hasNear ) {
          const nearF = this._elevationHeightFraction(elevation, this.fWallHeights[BOTTOM]);
          if ( this.fNearRatios[UMBRA] !== -1.0 ) nearRatios[UMBRA] = elevate(nearRatios[UMBRA], this.fWallRatio, nearF);
          if ( this.fNearRatios[PENUMBRA] !== -1.0 ) nearRatios[PENUMBRA] = elevate(nearRatios[PENUMBRA], this.fWallRatio, nearF);
        }
        /* eslint-enable max-len */
      }
      if ( this.vWallRatio < this.farRatios[UMBRA] ) return 0.0;
      if ( this.vWallRatio < this.farRatios[PENUMBRA] ) return 0.0;
      if ( this.vWallRatio > this.nearRatios[UMBRA] ) return 0.0;
      if ( this.vWallRatio > this.nearRatios[PENUMBRA] ) return 0.0;
    }

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
   * Elevate given shadow ratios.
   * @param {float} ratio
   * @param {float} elevation
   * @param {float} wallHeight
   * @param {float} wallRatio
   * @returns {float}
   */
  _elevateShadowRatio(ratio, elevation, wallHeight, wallRatio) {
    const heightFraction = this._elevationHeightFraction(elevation, wallHeight);
    return this._elevateShadowRatioUsingHeightFraction(ratio, wallRatio, heightFraction);
  }

  /**
   * @param {float} ratio
   * @param {float} wallRatio
   * @param {float} heightFraction
   * @returns {float}
   */
  _elevateShadowRatioUsingHeightFraction(ratio, wallRatio, heightFraction) {
    return ratio + (heightFraction * (wallRatio - ratio));
  }

  /**
   * @param {float} elevation
   * @param {float} wallHeight
   * @returns {float}
   */
  _elevationHeightFraction(elevation, wallHeight) {
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

  drawWall() { Draw.segment({ a: this.wall.top[0], b: this.wall.top[1] }); }

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
    const wallDir2d = normalizedDirection(wall.top[0].xy, wall.top[1].xy);

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

    const canvasWallRay = Ray2d(B, wallDir2d);
    r1 = Ray2d(uLightPosition.xy, normalizedDirection(uLightPosition.xy, wall.top[1 - closerIdx].xy));
    lineLineIntersection(canvasWallRay, r1, C);
    return [A, B, C];
  }

  /**
   * Define additional varyings specific to this shader.
   * @param {Wall} wall
   * @param {vec2[3]} penumbraTri
   */
  defineVaryings(wall, penumbraTri) { }

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
      // The closer vertex to the wall gets assigned 0.0.
      const dist01 = distanceSquared(penumbraTri[0], penumbraTri[1]);
      const dist02 = distanceSquared(penumbraTri[0], penumbraTri[2]);
      const closerIdx = dist02 < dist01 ? 2 : 1;
      const wallDir2d = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
      const wallMid2d = wall.top[0].xy.add(wall.top[1].xy).multiplyScalar(0.5);
      const lightRay2d = Ray2d(penumbraTri[0], normalizedDirection(penumbraTri[0], wallMid2d));
      const closerIx = vec2();
      lineLineIntersection(lightRay2d, Ray2d(penumbraTri[closerIdx], wallDir2d), closerIx);

      const wallBottomMid = wall.bottom[0].add(wall.bottom[1]).multiplyScalar(0.5);
      const lightRay = Ray(uLightPosition, normalizedDirection(uLightPosition, wallBottomMid));
      const canvasIx = vec3();
      const canvasPlane = this.constructCanvasPlane();
      intersectRayPlane(lightRay, canvasPlane, canvasIx);

      // Could use distance(closerIx, canvasIx.xy) / distance(closerIx, penumbraTri[0]).
      // That has a square root but is simpler. Might need negative distance though.
      const wallRatioRay = Ray2d(closerIx, penumbraTri[0].subtract(closerIx));
      const furtherT = lineLineIntersection(wallRatioRay, Ray2d(canvasIx.xy, wallDir2d));
      this.fNearRatios = vec2(furtherT);
    }
  }
}

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

/* Testing sized light
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
let { vec2, vec3, vec4 } = api.testing.glsl_mock
glsl = api.testing.glsl_mock
lli = glsl.lineLineIntersection
let { distanceSquared, normalizedDirection, Ray2d } = glsl;
let {
  SizedPointSourceShadowWallVertexShaderTest3,
  DirectionalSourceShadowWallVertexShaderTest3 } = api.testing
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
let [shader0] = SizedPointSourceShadowWallVertexShaderTest3.fromMesh(ev.shadowMesh)
shader0.vertexCalculations(2)

shader0.drawWall();
shader0.drawPenumbraTriangle();

shader0.setVaryings(pt)
shader0.shadowPercentage(pt, 0)
shader0.shadowComponents(pt, 0)
shader0.drawCollisionRays(0)

pt = shader0.penumbraTri[1]
for ( const dir of dirs ) {
  const r = Ray2d(pt, dir.xy.normalize());
  drawRay(r)
}

*/
