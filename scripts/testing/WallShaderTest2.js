/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI
*/
"use strict";

import { MODULE_ID } from "../const.js";
import { Matrix } from "../geometry/Matrix.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Draw } from "../geometry/Draw.js";
import {
  vec2,
  vec3,
  vec4,
  Plane,
  Ray,
  Ray2d,
  ShadowDirections,
  ShadowDirections2d,
  Wall,
  Light,
  fromAngle,
  normalizedDirection,
  lineLineIntersectionRay,
  intersectRayPlane,
  barycentric,
  barycentricPointInsideTriangle,
  lineLineIntersection,
  distanceSquared,
  linearConversion,
  interpolateBarycentric,
  between
} from "./glsl_mock.js";

const UMBRA = 0;
const PENUMBRA = 1;
const MIDPENUMBRA = 2; // So that vec2 can hold UMBRA/PENUMBRA

const TOP = 0;
const BOTTOM = 1;

/* Mock shader calculations based on new approach of using only umbra and penumbra.
 * Use barycentric area values as varyings.
 */

/**
 * Normalize a barycentric area coordinate.
 * @param {vec3} baryArea
 * @returns {vec3}
 */
function normalizeBarycentricArea(baryArea) {
  return baryArea.multiplyScalar(1 / (baryArea.x + baryArea.y + baryArea.z));
}

/**
 * Convert a barycentric area to barycentric coordinates of a similar triangle, based on ratio.
 * @param {vec3} baryArea
 * @param {float} ratio      The desired side length as a percentage of the original side length
 *   So if original is 3 and intended is 1, ratio = 1/3
 * @returns {vec3} The barycentric (normalized) values.
 */
function convertBarycentericAreaSimilarTriangle(baryArea, ratio) {
  if ( ratio === 0.0 || ratio === 1.0 ) return normalizeBarycentricArea(baryArea);

  const total = baryArea.x + baryArea.y + baryArea.z;
  const total2 = total * ratio * ratio;
  const saV2 = baryArea.y * ratio;
  const saW2 = baryArea.z * ratio;
  const v2 = saV2 / total2;
  const w2 = saW2 / total2;
  const u2 = 1 - v2 - w2;
  return vec3(u2, v2, w2);
}

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
 * Represents a single wall-light shadow calculation.
 * 3 vertices: light, ix for corner 1, ix for corner 2.
 * Wall shadow with side, near, and far penumbra
 * General version extended by SizedPointSource and DirectionalSource
 */
class ShadowWallVertexShaderTest2 {

  static EV_ENDPOINT_LINKED_UNBLOCKED = -10.0;

  // From CONST.WALL_SENSE_TYPES
  static LIMITED_WALL = 10.0;

  static PROXIMATE_WALL = 30.0;

  static DISTANCE_WALL = 40.0;


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

  /* ----- NOTE: Attributes ----- */
  // Use getters so they cannot be changed inadvertently.
  // Convert arrays to vecs

  /** @type {vec4} */
  get aWallCorner0() { return vec4(...this.attributes.aWallCorner0); }

  /** @type {vec4} */
  get aWallCorner1() { return vec4(...this.attributes.aWallCorner1); }

  /** @type {float} */
  get aWallSenseType() { return this.attributes.aWallSenseType; }

  /** @type {float} */
  get aThresholdRadius2() { return this.attributes.aWallSenseType; }

  /* ----- NOTE: Uniforms ----- */

  /** @type {vec4} */
  get uElevationRes() { return vec4(...this.uniforms.uElevationRes); }

  /** @type {vec4} */
  get uSceneDims() { return vec4(...this.uniforms.uSceneDims); }

  /* ----- NOTE: Defined terms ---- */

  /** @type {Wall} */
  get wall() { return this.calculateWallPositions(); }

  /** @type {float} */
  get canvasElevation() { return this.uElevationRes.x; }

  /** @type {float} */
  get maxR() {
    const uSceneDims = this.uniforms.uSceneDims;
    return Math.sqrt((uSceneDims.z * uSceneDims.z) + (uSceneDims.w * uSceneDims.w)) * 2.0;
  }

  /** @type {Plane} */
  get canvasPlane() {
    const planeNormal = vec3(0.0, 0.0, 1.0);
    const planePoint = vec3(0.0, 0.0, this.canvasElevation);
    return Plane(planePoint, planeNormal);
  }

  /** @type {ShadowDirections2d[2]} */
  get sideShadowDirs() {
    return [
      this.calculateSideShadowDirections(0),
      this.calculateSideShadowDirections(1)
    ];
  }

  /** @type {ShadowDirections2d[2]} */
  get adjSidePenumbraDirs() {
    const sideShadowDirs = this.sideShadowDirs;
    this.adjustSideShadowDirectionsForLinkedEndpoints(sideShadowDirs[0], this.wall, 0);
    this.adjustSideShadowDirectionsForLinkedEndpoints(sideShadowDirs[1], this.wall, 1);
    return sideShadowDirs;
  }

  /** @type {ShadowDirections} */
  get nearShadowDirs() { return this.calculateNearShadowDirections(); }

  /** @type {ShadowDirections} */
  get farShadowDirs() { return this.calculateFarShadowDirections(); }

  /** @type {object} */
  get varyings() {
    const {
      vVertexPosition,
      vTerrainTexCoord,
      vPenumbra,
      vSidePenumbra0,
      vSidePenumbra1 } = this;
    return {
      vVertexPosition,
      vTerrainTexCoord,
      vPenumbra,
      vSidePenumbra0,
      vSidePenumbra1
    };
  }

  get flats() {
    const {
      fThresholdRadius2,
      fWallSenseType,
      fWallHeights,
      fFarRatio,
      fWallRatio,
      fNearRatios } = this;
    return {
      fThresholdRadius2,
      fWallSenseType,
      fWallHeights,
      fFarRatio,
      fWallRatio,
      fNearRatios
    };
  }

  // ----- NOTE: Penumbras ----- //


  /**
   * For side penumbra directions, determine if they must be moved to address light leakage
   * from linked endpoints.
   * @param {inout ShadowDirections} shadowDirs
   * @param {Wall} wall
   * @param {int} idx
   */
  adjustSideShadowDirectionsForLinkedEndpoints(shadowDirs, wall, idx) {
    const orient = foundry.utils.orient2dFast;

    const wXY = wall.top[idx].xy; // Wall endpoint from which a penumbra is cast.

    // If no linked wall, full penumbra is used.
    const linkAngle = wall.linkValue[idx];
    if ( linkAngle === this.constructor.EV_ENDPOINT_LINKED_UNBLOCKED ) {
      console.log(`adjustSideShadowDirectionsForLinkedEndpoints|idx ${idx} is unblocked.`);
      return;
    }

    // Determine orientation relative to the mid-penumbra.
    // 4 quadrants:
    // 1 & 2: linked wall is on opposite side from wall, so it blocks.
    // 3 & 4: linked wall is on same side as light:
    // - 3: Linked wall not between wall and mid: no block (tight "V")
    // - 4: Linked wall between wall and mid
    //     • If umbra - linked - mid-penumbra, adjust umbra direction.
    //     • If umbra - mid - linked - penumbra, umbra set to mid.

    // Point positions.
    const linkPt = fromAngle(wXY, linkAngle, 1.0);
    const midR = Ray2d(wXY, shadowDirs.midpenumbra);
    const midPt = midR.project(1.0);

    // Orientation re mid.
    const other = (wall.top[1 - idx]).xy;
    const oMidLink = orient(wXY, midPt, linkPt);
    const oMidWall = orient(wXY, midPt, other);

    // 1 & 2: linked wall blocks light.
    const linkOppositeWall = oMidWall * oMidLink <= 0.0;
    if ( linkOppositeWall ) {
      shadowDirs.umbra.x = shadowDirs.midpenumbra.x;
      shadowDirs.umbra.y = shadowDirs.midpenumbra.y;

      shadowDirs.penumbra.x = shadowDirs.midpenumbra.x;
      shadowDirs.penumbra.y = shadowDirs.midpenumbra.y;
      console.log(`adjustSideShadowDirectionsForLinkedEndpoints|idx ${idx} linked wall blocks light fully.`);
      return;
    }

    // 3 & 4: Linked wall between wall and mid
    // 3: Linked wall in quadrant with light, not blocking.
    const oLinkWall = orient(wXY, linkPt, other);
    const oLinkMid = orient(wXY, linkPt, midPt);
    const linkBetweenWallAndMid = oLinkWall * oLinkMid < 0.0;
    if ( !linkBetweenWallAndMid ) {
      console.log(`adjustSideShadowDirectionsForLinkedEndpoints|idx ${idx} not blocking (#3).`);
      return;
    }

    // 4. possible block.
    // What side of umbra is the linked wall on? If not on the mid-side, it doesn't block.
    const umbraR = Ray2d(wXY, shadowDirs.umbra);
    const umbraPt = umbraR.project(1);
    const oUmbraLink = orient(wXY, umbraPt, linkPt);
    const oUmbraMid = orient(wXY, umbraPt, midPt);
    const linkAfterUmbra = oUmbraLink * oUmbraMid > 0.0;
    if ( !linkAfterUmbra ) {
      console.log(`adjustSideShadowDirectionsForLinkedEndpoints|idx ${idx} is unblocked.`);
      return;
    }

    // Linked wall is after umbra, moving toward mid.
    const oMidUmbra = orient(wXY, midPt, umbraPt);

    // Set umbra to the link direction.
    const linkDir = normalizedDirection(wXY, linkPt);
    shadowDirs.umbra.x = linkDir.x;
    shadowDirs.umbra.y = linkDir.y;
    console.log(`adjustSideShadowDirectionsForLinkedEndpoints|idx ${idx} partially blocked. Adjusting umbra.`);
    if ( oMidUmbra * oMidLink > 0.0 ) return;

    // Linked wall is after mid; adjust mid as well.
    shadowDirs.midpenumbra.x = linkDir.x;
    shadowDirs.midpenumbra.y = linkDir.y;
    console.log(`adjustSideShadowDirectionsForLinkedEndpoints|idx ${idx} partially blocked. Adjusting mid.`);

  }

  /**
   * Test if a rect, represented as an array of 4 clockwise points from top left, contains point.
   * @param {vec2[4]} rect
   * @param {vec2} pt
   * @returns {bool}
   */
  _rectContains(rect, pt) {
    const TL = 0;
    const TR = 1;
    const BR = 2;
    const BL = 3;
    return pt.x >= rect[TL].x
      && pt.x < rect[TR].x
      && pt.y >= rect[TL].y
      && pt.y < rect[BR].y;
  }

  /**
   * Get the corner that can be used to project a far parallel ray to a wall.
   * Used in penumbraEndpoints to determine the infinite shadow parallel ray.
   * @param {vec3[2]} wallEndpoints,
   * @param {vec2} wallDir,
   * @param {vec3} nearFarDir
   * @returns {vec2}
   */
  _parallelFarCorner(wallEndpoints, wallDir, nearFarDir) {
    const orient = foundry.utils.orient2dFast;
    const { uSceneDims } = this;

    const TL = 0;
    const TR = 1;
    const BR = 2;
    const BL = 3;

    // Ensure the shadow extends to the canvas edges.
    // Set the far parallel to intersect a corner.
    const sceneRect = Array(4); // vec2[4]
    sceneRect[TL] = vec2(0.0, 0.0);
    sceneRect[TR] = vec2((uSceneDims.x * 2.0) + uSceneDims.z, 0.0);
    sceneRect[BR] = vec2((uSceneDims.x * 2.0) + uSceneDims.z, (uSceneDims.y * 2.0) + uSceneDims.w);
    sceneRect[BL] = vec2(0.0, (uSceneDims.y * 2.0) + uSceneDims.w);

    const oWallLight = orient(wallEndpoints[0].xy, wallEndpoints[1].xy,
      wallEndpoints[0].xy.subtract(nearFarDir.xy.normalize()));
    if ( wallDir.x === 0.0 ) {
      // Wall parallel to left/right.
      const oTL = orient(wallEndpoints[0].xy, wallEndpoints[1].xy, sceneRect[TL]);
      return (oTL * oWallLight) < 0.0 ? sceneRect[TL] : sceneRect[TR];
    }

    if ( wallDir.y === 0.0 ) {
      // Wall parallel to top/bottom.
      const oTL = orient(wallEndpoints[0].xy, wallEndpoints[1].xy, sceneRect[TL]);
      return (oTL * oWallLight) < 0.0 ? sceneRect[TL] : sceneRect[BL];
    }

    // One corner opposite the light can be used; its line will not intersect the canvas rect.
    for ( let i = 0; i < 4; i += 1 ) {
      const corner = sceneRect[i];
      const oCorner = orient(wallEndpoints[0].xy, wallEndpoints[1].xy, corner);
      if ( (oCorner * oWallLight) < 0.0 ) {
        const r = Ray2d(corner, wallDir);
        const testPt = r.project(1.0);
        if ( !this._rectContains(sceneRect, testPt) ) return corner;
      }
    }
    return sceneRect[0]; // Should not happen.
  }

  /**
   * Intersection points of the side penumbra with the canvas.
   * @param {vec3} nearFarDir
   * @param {ShadowDirections2d[2]} sideDirs
   * @param {vec3[2]} wallEndpoints
   * @returns {vec2[2]}
   */
  penumbraCanvasIntersections(nearFarDir, sideDirs, wallEndpoints) {
    const { uElevationRes } = this;
    const _parallelFarCorner = this._parallelFarCorner.bind(this);

    // Plane at the minimum canvas elevation.
    const canvasElevation = uElevationRes.x;
    const planeNormal = vec3(0.0, 0.0, 1.0);
    const planePoint = vec3(0.0, 0.0, canvasElevation);
    const canvasPlane = Plane(planePoint, planeNormal);

    // Wall direction and middle point.
    const wallDir = normalizedDirection(wallEndpoints[0].xy, wallEndpoints[1].xy);
    const wallMid = wallEndpoints[0].add(wallEndpoints[1]).multiplyScalar(0.5);

    // Determine either the canvas intersection or the point at which to cut off an infinite shadow.
    // Measured from midpoint of the wall.
    let canvasIx = vec3();
    let keyPoint = vec2();
    const infiniteShadow = nearFarDir.z >= 0.0; // Ray is rising as it moves from light --> wall.
    if ( infiniteShadow || !intersectRayPlane(Ray(wallMid, nearFarDir), canvasPlane, canvasIx) ) {
      keyPoint = _parallelFarCorner(wallEndpoints, wallDir, nearFarDir);
    } else keyPoint = canvasIx.xy;

    // Intersect the penumbra sides with line parallel to the wall that runs through canvas ix.
    // TODO: If the endpoint heights are different, a more nuanced approach would be required.
    const farParallelRay = Ray2d(keyPoint, wallDir);
    const ixs = [vec2(), vec2()]; // vec2[2]
    lineLineIntersection(farParallelRay, Ray2d(wallEndpoints[0].xy, sideDirs[0].penumbra), ixs[0]);
    lineLineIntersection(farParallelRay, Ray2d(wallEndpoints[1].xy, sideDirs[1].penumbra), ixs[1]);
    return ixs;
  }

  /**
   * Determine the far intersection points for the penumbra edges.
   * @param {ShadowDirections} farDirs
   * @param {ShadowDirections2d[2]} sideDirs
   * @param {Wall} wall
   * @returns {vec2[2]}
   */
  farPenumbraCanvasIntersections(farDirs, sideDirs, wall) {
    return this.penumbraCanvasIntersections(farDirs.penumbra, sideDirs, wall.top);
  }

  /**
   * Determine the near intersection points for the penumbra edges.
   * @param {ShadowDirections} nearDirs
   * @param {ShadowDirections2d[2]} sideDirs
   * @param {Wall} wall
   * @returns {vec2[2]}
   */
  nearPenumbraCanvasIntersections(nearDirs, sideDirs, wall) {
    return this.penumbraCanvasIntersections(nearDirs.penumbra, sideDirs, wall.bottom);
  }

  /**
   * Determine the far intersection points for the umbra edges.
   * @param {ShadowDirections} farDirs
   * @param {ShadowDirections2d[2]} sideDirs
   * @param {Wall} wall
   * @returns {vec2[2]}
   */
  farUmbraCanvasIntersections(farDirs, sideDirs, wall) {
    return this.penumbraCanvasIntersections(farDirs.umbra, sideDirs, wall.top);
  }

  /**
   * Determine the near intersection points for the umbra edges.
   * @param {ShadowDirections} nearDirs
   * @param {ShadowDirections2d[2]} sideDirs
   * @param {Wall} wall
   * @returns {vec2[2]}
   */
  nearUmbraCanvasIntersections(nearDirs, sideDirs, wall) {
    return this.penumbraCanvasIntersections(nearDirs.umbra, sideDirs, wall.bottom);
  }

  /**
   * Penumbra triangle.
   * Either the light and the two far intersections or the two endpoints and the single intersection
   * of the penumbra edges.
   * @param {ShadowDirections} farDirs
   * @param {ShadowDirections2d} sideDirs
   * @param {Wall} wall
   * @returns {vec2[3]}
   */
  penumbraTriangle(farDirs, sideDirs, wall) {
    farDirs ??= this.farShadowDirs;
    sideDirs ??= this.adjSidePenumbraDirs;
    wall ??= this.wall;
    const farPenumbraCanvasIntersections = this.farPenumbraCanvasIntersections.bind(this);

    const canvasIxs = farPenumbraCanvasIntersections(farDirs, sideDirs, wall); // vec2[2]
    const ix = vec2();
    lineLineIntersection(canvasIxs[0], wall.top[0].xy, canvasIxs[1], wall.top[1].xy, ix);
    return [ix, canvasIxs[0], canvasIxs[1]];
  }

  /**
   * Side triangles.
   * Following the umbra line, where does it intersect line parallel to the wall that intersects
   * the far penumbra point(s)? wallendpoint --> ix --> penumbra point
   * @param {integer} idx
   * @param {vec2[3]} penumbraTri
   * @param {ShadowDirections2d} sideDirs
   * @param {Wall} wall
   * @returns {vec2[3]}
   */
  sideTriangle(idx = 0, penumbraTri, sideDirs, wall) {
    sideDirs ??= this.adjSidePenumbraDirs;
    wall ??= this.wall;
    penumbraTri ??= this.penumbraTriangle(this.farShadowDirs, sideDirs, wall);

    const farParallelRay = Ray2d(penumbraTri[1], wall.direction);
    const umbraDir = sideDirs[idx].umbra;
    const umbraRay = Ray2d(wall.top[idx].xy, umbraDir);
    const ix = vec2();
    lineLineIntersection(farParallelRay, umbraRay, ix);
    return [
      wall.top[idx].xy,
      penumbraTri[idx + 1],
      ix
    ];
  }

  // ----- NOTE: Vertex shader calculations ----- //
  calculateWallPositions() {
    const { aWallCorner0, aWallCorner1, aWallSenseType, aThresholdRadius2 } = this;

    const aTop = vec3(aWallCorner0.x, aWallCorner0.y, aWallCorner0.z);
    const bTop = vec3(aWallCorner1.x, aWallCorner1.y, aWallCorner0.z);
    const aBottom = vec3(aWallCorner0.x, aWallCorner0.y, aWallCorner1.z);
    const bBottom = vec3(aWallCorner1.x, aWallCorner1.y, aWallCorner1.z);
    return Wall({
      top: [aTop, bTop],
      bottom: [aBottom, bBottom],
      direction: normalizedDirection(aWallCorner0.xy, aWallCorner1.xy), // Moving from 0 --> 1.
      linkValue: [aWallCorner0.w, aWallCorner1.w],
      type: aWallSenseType,
      thresholdRadius2: aThresholdRadius2
    });
  }

  /**
   * Calculate the flat variables, including near/far ratios.
   * @param {vec2[3]} penumbraTri
   * @param {Wall} wall
   * @param {ShadowDirections} nearShadowDirs
   * @param {ShadowDirections} farShadowDirs
   * @param {ShadowDirections2d[2]} sideShadowDirs
   */
  calculateFlatVariables(penumbraTri, wall, nearShadowDirs, farShadowDirs, sideShadowDirs) {
    penumbraTri ??= this.penumbraTriangle();
    nearShadowDirs ??= this.nearShadowDirs;
    farShadowDirs ??= this.farShadowDirs;
    sideShadowDirs ??= this.sideShadowDirs;

    const { uElevationRes } = this;
    const { DISTANCE, PROXIMATE } = CONST.WALL_SENSE_TYPES;
    const baryForPoint = barycentric;
    const farUmbraCanvasIntersections = this.farUmbraCanvasIntersections.bind(this);
    const nearUmbraCanvasIntersections = this.nearUmbraCanvasIntersections.bind(this);
    const nearPenumbraCanvasIntersections = this.nearPenumbraCanvasIntersections.bind(this);

    const wTop = wall.top[0];
    const wBottom = wall.bottom[0];

    // @type {vec2} fWallHeights
    this.fWallHeights = vec2();
    this.fWallHeights[TOP] = wTop.z;
    this.fWallHeights[BOTTOM] = wBottom.z;

    // @type {float} fWallSenseType
    this.fWallSenseType = wall.type;

    // @type {float} fThresholdRadius
    this.fThresholdRadius2 = !(this.fWallSenseType === DISTANCE || this.fWallSenseType === PROXIMATE)
      ? -1.0 : wall.thresholdRadius2;

    // @type {float} fWallRatio
    // Location of the wall along the x axis of the barycentric penumbra triangle
    this.fWallRatio = baryForPoint(wTop.xy, ...penumbraTri).x;

    // @type {float} fFarRatio
    // Location of the far umbra intersection. Penumbra intersection is 0.0 by definition.
    const umbraFarIx = farUmbraCanvasIntersections(farShadowDirs, sideShadowDirs, wall)[0];
    this.fFarRatio = baryForPoint(umbraFarIx, ...penumbraTri).x;

    // @type {vec2} fNearRatios
    // Location of the near shadow along the x axis of the barycentric penumbra triangle.
    this.fNearRatios = vec2(this.fWallRatio); // Near shadow starts at wall unless the wall is "floating."
    const canvasElevation = uElevationRes.x;
    if ( wBottom.z > canvasElevation ) {
      const umbraNearIx = nearUmbraCanvasIntersections(nearShadowDirs, sideShadowDirs, wall)[0];
      const penumbraNearIx = nearPenumbraCanvasIntersections(nearShadowDirs, sideShadowDirs, wall)[0];
      this.fNearRatios[UMBRA] = barycentric(umbraNearIx, ...penumbraTri).x;
      this.fNearRatios[PENUMBRA] = barycentric(penumbraNearIx, ...penumbraTri).x;
    }
    // Can retrieve for debugging using this.flats.
  }

  /**
    * Mimic calculations done in the vertex shader.
    * @param {int} vertexNum     The vertex being "processed."
    * @returns {object} Object containing all out variables.
    */
  vertexCalculations(gl_VertexID = 0) {
    const { uSceneDims, uElevationRes } = this;
    const sarea = foundry.utils.orient2dFast;
    const adjustSideShadowDirectionsForLinkedEndpoints = this.adjustSideShadowDirectionsForLinkedEndpoints.bind(this);
    const calculateFlatVariables = this.calculateFlatVariables.bind(this);
    const penumbraTriangle = this.penumbraTriangle.bind(this);
    const sideTriangle = this.sideTriangle.bind(this);
    const baryForPoint = barycentric;

    // Defined constants.
    const vertexNum = gl_VertexID % 3;

    // Penumbra structures.
    // Defined by the subclass (Point or DirectionalLight):
    // - @type {Wall} wall
    // - @type {Light} light
    // - @type {ShadowDirections2d[2]} sideShadowDirs
    // - @type {ShadowDirections} nearShadowDirs
    // - @type {ShadowDirections} farShadowDirs
    const { wall, light, sideShadowDirs, farShadowDirs, nearShadowDirs } = this;
    adjustSideShadowDirectionsForLinkedEndpoints(sideShadowDirs[0], wall, 0);
    adjustSideShadowDirectionsForLinkedEndpoints(sideShadowDirs[1], wall, 1);


    // Vertex Calculations
    // Big triangle ABC is the bounds of the potential shadow.
    //   A = lightCenter;
    //   B = sidePenumbra;
    //   C = sidePenumbra;
    const penumbraTri = penumbraTriangle(farShadowDirs, sideShadowDirs, wall);
    const side0Tri = sideTriangle(0, penumbraTri, sideShadowDirs, wall);
    const side1Tri = sideTriangle(1, penumbraTri, sideShadowDirs, wall);

    // Location of this vertex.
    // @type {vec2} vVertexPosition
    const vVertexPosition = this.vVertexPosition = penumbraTri[vertexNum];

    // Set barymetric coordinates for each corner of the triangle.
    // @type {vec3} vPenumbra
    this.vPenumbra = vec3(0.0);
    this.vPenumbra[vertexNum] = 1.0;

    // Define side triangles in relation to the penumbra triangle.
    // @type {vec3} vSidePenumbra0, vSidePenumbra1
    this.vSidePenumbra0 = baryForPoint(vVertexPosition, ...side0Tri);
    this.vSidePenumbra1 = baryForPoint(vVertexPosition, ...side1Tri);

    // Calculate the terrain texture coordinate at this vertex based on scene dimensions.
    // (vVertexPosition - uSceneDims.xy) / uSceneDims.zw
    // @type {vec2} vTerrainTexCoord
    this.vTerrainTexCoord = (vVertexPosition.subtract(uSceneDims.xy)).divide(uSceneDims.zw);

    // In shader:
    // gl_Position = vec4((projectionMatrix * translationMatrix * vec3(this.vVertexPosition, 1.0)).xy, 0.0, 1.0);

    // Finally, set the flat variables when we hit the last vertex for this triangle.
    if ( vertexNum === 2 ) calculateFlatVariables(penumbraTri, wall, nearShadowDirs, farShadowDirs, sideShadowDirs);

    // For debugging.
    return { varyings: this.varyings, flats: this.flats };
  }


  // ----- NOTE: Fragment shader testing ----- //

  // ----- NOTE: Fragment variables ----- //

  // ----- NOTE: Fragment calculations ----- //

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

  elevateNearShadowRatios(elevation = this.canvasElevation) {
    const { fWallHeights, fWallRatio, fNearRatios } = this;
    const out = vec2();
    out[PENUMBRA] = this._elevateShadowRatio(fNearRatios[PENUMBRA], elevation, fWallHeights[BOTTOM], fWallRatio);
    out[UMBRA] = this._elevateShadowRatio(fNearRatios[UMBRA], elevation, fWallHeights[BOTTOM], fWallRatio);
    return out;
  }

  elevateFarShadowRatios(elevation = this.canvasElevation) {
    const { fWallHeights, fWallRatio, fFarRatio } = this;
    const out = vec2();
    out[PENUMBRA] = this._elevateShadowRatio(0.0, elevation, fWallHeights[TOP], fWallRatio);
    out[UMBRA] = this._elevateShadowRatio(fFarRatio, elevation, fWallHeights[TOP], fWallRatio);
    return out;
  }

  /**
   * Determine if a threshold applies to this point.
   */
  thresholdApplies() {
    const { vVertexPosition, fThresholdRadius2, uLightPosition } = this;
    return fThresholdRadius2 > 0.0
      && distanceSquared(vVertexPosition, uLightPosition.xy) < fThresholdRadius2;
  }

  /**
   * Is the fragment location in front of the wall?
   * @returns {bool}
   */
  inFrontOfWall() {
    const { vPenumbra, fWallRatio } = this;
    return vPenumbra.x > fWallRatio;
  }

  /**
   * Is fragment inside the side penumbra, without regard to near/far limits.
   * @returns {bool}
   */
  inSidePenumbra0() { return barycentricPointInsideTriangle(this.vSidePenumbra0); }

  /**
   * Is fragment inside the side penumbra, without regard to near/far limits.
   * @returns {bool}
   */
  inSidePenumbra1() { return barycentricPointInsideTriangle(this.vSidePenumbra0); }

  /**
   * Is the fragment inside the umbra? By definition, means it is not in the penumbra.
   * @returns {bool}
   */
  inUmbra() { return !(this.inSidePenumbra0() || this.inSidePenumbra1()); }


  /* NOTE: Basic triangle tests
    Fixed: vWall, vSidePenumbra0, vSidePenumbra1
    Moves with elevation: vPenumbra, vMidPenumbra, vUmbra, vNearPenumbra, vNearMidPenumbra, vNearUmbra
  */

  /**
   * Calculate the varying variables based on a vVertexPosition value.
   */
  setVaryings(pt) {
    pt ??= this.vVertexPosition;

    // Set the flat variables
    this.vertexCalculations(2);

    // Construct three versions of the shader, one for each vertex.
    const shaders = Array(3);
    for ( let i = 0; i < 3; i += 1 ) {
      shaders[i] = this.duplicate();
      shaders[i].vertexCalculations(i);
    }

    // The penumbra triangle that defines this shader.
    const vVertexPosition = this.vVertexPosition = vec2(pt.x, pt.y);
    const bary = barycentric(vVertexPosition,
      shaders[0].vVertexPosition,
      shaders[1].vVertexPosition,
      shaders[2].vVertexPosition);

    // Use barycentric coordinates to get the value of the vVertexPosition for each varying.
    const varying = {};
    for ( const varyingKey of Object.keys(this.varyings) ) {
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
  fragmentCalculations(pt, elevation = 0) {
    const { side0Shadow, side1Shadow, farShadow, nearShadow, hasShadow } = this.shadowComponents(pt, elevation);

    let fragColor = this.noShadow();
    if ( !hasShadow ) return fragColor;
    const shadow = side0Shadow * side1Shadow * farShadow * nearShadow;
    const totalLight = Math.clamp(0.0, 1.0, 1.0 - shadow);

    fragColor = this.lightEncoding(totalLight);
    return fragColor;
  }

  /**
   * For debugging
   * Determine the shadow components.
   */
  shadowComponents(pt, elevation = this.canvasElevation) {
    const { uElevationRes, fWallHeights, fWallRatio, fFarRatio, fNearRatios,
      vPenumbra, vSidePenumbra0, vSidePenumbra1 } = this;
    elevation = CONFIG.GeometryLib.utils.gridUnitsToPixels(elevation);

    // Set the flat variables
    this.vertexCalculations(2);

    // Define the placement of the fragment and calculate varying variables.
    this.vVertexPosition = vec2(pt.x, pt.y);
    this.setVaryings();

    // GLSL only: let fragColor = this.noShadow();
    if ( this.thresholdApplies() ) return { hasShadow: false }; // GLSL only: return fragColor;
    if ( this.inFrontOfWall() ) return { hasShadow: false }; // GLSL only: return fragColor;

    // Get the elevation at this fragment.
    const canvasElevation = uElevationRes.x;

    // Elevate the far penumbra ratio and confirm inclusion.
    const farElevationHeightFraction = this._elevationHeightFraction(elevation, fWallHeights[TOP]);
    const farPenumbraRatio = this._elevateShadowRatioUsingHeightFraction(0.0, fWallRatio, farElevationHeightFraction);
    if ( vPenumbra.x < farPenumbraRatio ) return { hasShadow: false };

    // Elevate the near penumbra ratio and confirm inclusion.
    const nearElevationHeightFraction = this._elevationHeightFraction(elevation, fWallHeights[BOTTOM]);
    const nearPenumbraRatio = this._elevateShadowRatioUsingHeightFraction(
      fNearRatios[PENUMBRA], fWallRatio, nearElevationHeightFraction);
    if ( vPenumbra.x > nearPenumbraRatio ) return { hasShadow: false };

    // The point is either in the umbra or in a penumbra.
    // Elevate the umbra ratios.
    const farUmbraRatio = this._elevateShadowRatioUsingHeightFraction(
      fFarRatio, fWallRatio, farElevationHeightFraction);
    const nearUmbraRatio = this._elevateShadowRatioUsingHeightFraction(
      fNearRatios[UMBRA], fWallRatio, nearElevationHeightFraction);

    // Determine the near/far penumbra inclusion.
    const inFarPenumbra = between(farPenumbraRatio, farUmbraRatio, vPenumbra.x);
    const inNearPenumbra = between(nearPenumbraRatio, nearUmbraRatio, vPenumbra.x);
    let farShadow = 1.0;
    let nearShadow = 1.0;
    if ( inFarPenumbra ) farShadow = linearConversion(vPenumbra.x, farPenumbraRatio, farUmbraRatio, 0.0, 1.0);
    if ( inNearPenumbra ) nearShadow = linearConversion(vPenumbra.x, nearPenumbraRatio, nearUmbraRatio, 0.0, 1.0);

    // Blend the two side penumbras if overlapping by multiplying the light amounts.
    const side0Shadow = this.inSidePenumbra0() ? vSidePenumbra0.z / (vSidePenumbra0.y + vSidePenumbra0.z) : 1.0;
    const side1Shadow = this.inSidePenumbra1() ? vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z) : 1.0;

    return { side0Shadow, side1Shadow, farShadow, nearShadow, hasShadow: true };
  }

  // ----- NOTE: Drawing ----- //

  drawWall() { Draw.segment({ a: this.wall.top[0], b: this.wall.top[1] }); }

  drawLight() { Draw.point(this.light.center, { radius: this.light.size, color: Draw.COLORS.yellow }); }

  drawSidePenumbraDirections(dist = canvas.dimensions.maxR) {
    const { sideShadowDirs, wall } = this;
    const COLOR_KEYS = {
      umbra: Draw.COLORS.red,
      midpenumbra: Draw.COLORS.orange,
      penumbra: Draw.COLORS.yellow
    };
    for ( const [key, color] of Object.entries(COLOR_KEYS) ) {
      for ( let i = 0; i < 2; i += 1 ) {
        const endpoint = wall.top[i].xy;
        const penumbraPt = endpoint.add(sideShadowDirs[i][key].xy.normalize().multiplyScalar(dist));
        Draw.segment({ a: endpoint, b: penumbraPt }, { color });
      }
    }
  }

  drawAdjustedSidePenumbraDirections(dist = canvas.dimensions.maxR) {
    const { adjSidePenumbraDirs, wall } = this;
    const COLOR_KEYS = {
      umbra: Draw.COLORS.red,
      midpenumbra: Draw.COLORS.orange,
      penumbra: Draw.COLORS.yellow
    };
    for ( const [key, color] of Object.entries(COLOR_KEYS) ) {
      for ( let i = 0; i < 2; i += 1 ) {
        const endpoint = wall.top[i].xy;
        const penumbraPt = endpoint.add(adjSidePenumbraDirs[i][key].xy.normalize().multiplyScalar(dist));
        Draw.segment({ a: endpoint, b: penumbraPt }, { color });
      }
    }
  }

  drawPenumbraTriangle() {
    const tri = this.penumbraTriangle();
    const poly = new PIXI.Polygon(...tri);
    Draw.shape(poly);
  }

  drawSideTriangle(idx = 0) {
    const tri = this.sideTriangle(idx);
    const poly = new PIXI.Polygon(...tri);
    Draw.shape(poly);
  }


  drawNearLines(elevation = this.canvasElevation) { this._drawNearFarLines(elevation, false); }

  drawFarLines(elevation = this.canvasElevation) { this._drawNearFarLines(elevation, true); }

  _drawNearFarLines(elevation = this.canvasElevation, far = true ) {
    const COLOR_KEYS = {
      umbra: Draw.COLORS.red,
      penumbra: Draw.COLORS.yellow
    };
    const penumbraTri = this.buildTriangle(this.farPenumbraPoints, this.wall, PENUMBRA);
    const [A, B, C] = penumbraTri.map(pt => PIXI.Point.fromObject(pt));

    const ratios = far ? this.elevateFarShadowRatios(elevation) : this.elevateNearShadowRatios(elevation);
    for ( const [key, color] of Object.entries(COLOR_KEYS) ) {
      const idx = key === "umbra" ? UMBRA : PENUMBRA;
      const p0 = B.projectToward(A, ratios[idx]);
      const p1 = foundry.utils.lineLineIntersection(A, C, p0, p0.add(this.wall.direction.multiplyScalar(1)));
      Draw.point(p0, { color });
      Draw.point(p1, { color });
      Draw.segment({ a: p0, b: p1 }, { color });
    }
  }
}
//
//     const penumbraTri = this.buildTriangle(this.farPenumbraPoints, this.wall, PENUMBRA);
//     const [A, B, C] = penumbraTri.map(pt => PIXI.Point.fromObject(pt));
//
//     const ratios = far ? this.elevateFarShadowRatios(elevation) : this.elevateNearShadowRatios(elevation)
//     for ( const [key, color] of Object.entries(COLOR_KEYS) ) {
//       const idx = key === "umbra" ? UMBRA : key === "penumbra" ? PENUMBRA : MIDPENUMBRA;
//       const p0 = B.projectToward(A, ratios[idx]);
//       const p1 = foundry.utils.lineLineIntersection(A, C, p0, p0.add(this.wall.direction.multiplyScalar(1)));
//       Draw.point(p0, { color });
//       Draw.point(p1, { color });
//       Draw.segment({ a: p0, b: p1 }, { color });
//     }

/**
 * Based on SizedPointSourceShadowWallShader.
 * Represents a single wall calculation.
 * 3 vertices: light, ix for corner 1, ix for corner 2.
 * Wall shadow with side, near, and far penumbra
 */
export class SizedPointSourceShadowWallVertexShaderTest2 extends ShadowWallVertexShaderTest2 {

  /* ----- NOTE: Uniforms ----- */

  /** @type {vec3} */
  get uLightPosition() { return vec3(...this.uniforms.uLightPosition); }

  /** @type {float} */
  get uLightSize() { return this.uniforms.uLightSize ?? 0; }

  /* ----- NOTE: Getters ----- */

  /** @type {Light} */
  get light() { return this.calculateLightPositions(this.wall); }

  /** @type {ShadowDirections2d[2]} */
  get sideShadowDirs() {
    const { light, wall } = this;
    return [
      this.calculateSideShadowDirections(0),
      this.calculateSideShadowDirections(1)
    ];
  }

  /** @type {ShadowDirections} */
  get farShadowDirs() {
    return this.calculateNearFarShadowDirection(true);
  }

  /** @type {ShadowDirections} */
  get nearShadowDirs() {
    return this.calculateNearFarShadowDirection(false);
  }

  // ----- NOTE: UNIFORM variables ----- //

  static fromEdgeAndSource(edge, source) {
    const MAX_ELEV = 1e6;

    // TODO: Handle different a/b elevations.
    const { topZ, bottomZ } = edgeElevationZ(edge);
    const top = Math.min(MAX_ELEV, topZ);
    const bottom = Math.max(-MAX_ELEV, bottomZ);

    const { sceneRect, distancePixels } = canvas.dimensions;
    const ev = canvas.scene[MODULE_ID];
    const lightPosition = CONFIG.GeometryLib.threeD.Point3d.fromPointSource(source);

    const out = new this();
    out.config({
      attributes: {
        aWallCorner0: [edge.a.x, edge.a.y, top, -10.0],
        aWallCorner1: [edge.b.x, edge.b.y, bottom, -10.0],
        aWallSenseType: edge[source.constructor.sourceType],
        aThresholdRadius2: 0.0
      },
      uniforms: {
        uElevationRes: [ev.elevationMin, ev.elevationStep, ev.elevationMax, distancePixels],
        uLightPosition: [lightPosition.x, lightPosition.y, lightPosition.z],
        uLightSize: source.data.lightSize,
        uSceneDims: [sceneRect.x, sceneRect.y, sceneRect.width, sceneRect.height]
      }
    });
    return out;
  }

  calculateLightPositions(wall) {
    const { uLightSize, uLightPosition} = this;
    const dir = wall.direction.multiplyScalar(uLightSize);

    // Form a cross based on the light center.
    const lr0 = uLightPosition.xy.subtract(dir);
    const lr1 = uLightPosition.xy.add(dir);
    const top = uLightPosition.z + uLightSize;
    const bottom = uLightPosition.z - uLightSize;
    return Light({
      center: uLightPosition,
      lr0: vec3(lr0.x, lr0.y, uLightPosition.z), // Closest to wall 0 endpoint.
      lr1: vec3(lr1.x, lr1.y, uLightPosition.z), // Closest to wall 1 endpoint.
      top: vec3(uLightPosition.x, uLightPosition.y, top),
      bottom: vec3(uLightPosition.x, uLightPosition.y, bottom),
      size: uLightSize
    });
  }

  /* ----- NOTE: Penumbras ----- */

  /**
   * @param {Light} light
   * @param {Wall} wall
   * @param {int} idx     Which wall endpoint corresponds to this penumbra
   * @returns {ShadowDirections} Direction from the endpoint away from the light for umbra, mid, and penumbra.
   */
  calculateSideShadowDirections(idx) {
    const { light, wall } = this;

    const w = wall.top[idx].xy; // Wall endpoint from which a penumbra is cast.
    const umbraL = idx === 0 ? light.lr0.xy : light.lr1.xy; // Outer light 0 --> to endpoint 0 is umbra
    const penumbraL = idx === 0 ? light.lr1.xy : light.lr0.xy; // Inner light 1 --> to endpoint 0 is penumbra

    // Direction from light --> wall endpoint.
    return ShadowDirections2d({
      umbra: normalizedDirection(umbraL, w),
      midpenumbra: normalizedDirection(light.center.xy, w),
      penumbra: normalizedDirection(penumbraL, w)
    });
  }

  /**
   * Calculate the umbra, mid, and penumbra direction near or far rays from a given wall endpoint.a
   * @param {Light} light
   * @param {Wall} wall
   * @param {bool} far
   * @param {int} idx
   * @returns {ShadowDirections}
   */
  calculateNearFarShadowDirection(far) {
    const { light, wall } = this;

    let wallEndpoints; // Wall endpoint from which a penumbra is cast. vec3[2]
    let umbraLight; // vec3
    let penumbraLight; // vec3
    if ( far ) {
      wallEndpoints = wall.top;
      umbraLight = light.top;
      penumbraLight = light.bottom;
    } else {
      wallEndpoints = wall.bottom;
      umbraLight = light.bottom;
      penumbraLight = light.top;
    }
    const midWall = wallEndpoints[0].add(wallEndpoints[1]).multiplyScalar(0.5);

    return ShadowDirections({
      umbra: normalizedDirection(umbraLight, midWall), // Umbra
      midpenumbra: normalizedDirection(light.center, midWall), // Mid
      penumbra: normalizedDirection(penumbraLight, midWall) // Penumbra
    });
  }

  /**
   * Mimic calculations done in the vertex shader.
   */
  vertexCalculations(gl_VertexID = 0) {
    const wall = this.wall;
    const light = this.light;
    const sideShadowDirs = this.sideShadowDirs;
    const farShadowDirs = this.farShadowDirs;
    const nearShadowDirs = this.nearShadowDirs;
    return super.vertexCalculations(gl_VertexID);
  }

  /**
   * Mimic the fragment calculations at a specific point.
   * @param {Point} pt
   */
  fragmentCalculations(pt, elevation) {
    return super.fragmentCalculations(pt, elevation);
  }

}

/**
 * Based on SizedPointSourceShadowWallShader.
 * Represents a single wall calculation.
 * 3 vertices: light, ix for corner 1, ix for corner 2.
 * Wall shadow with side, near, and far penumbra
 */
export class DirectionalSourceShadowWallVertexShaderTest2 extends ShadowWallVertexShaderTest2 {

  // ----- NOTE: UNIFORM variables ----- //

  static fromEdgeAndSource(edge, source) {
    const MAX_ELEV = 1e6;

    // TODO: Handle different a/b elevations.
    const { topZ, bottomZ } = edgeElevationZ(edge);
    const top = Math.min(MAX_ELEV, topZ);
    const bottom = Math.max(-MAX_ELEV, bottomZ);

    const { sceneRect, distancePixels } = canvas.dimensions;
    const ev = canvas.scene[MODULE_ID];
    const lightPosition = CONFIG.GeometryLib.threeD.Point3d.fromPointSource(source);

    const out = new this();
    out.config({
      attributes: {
        aWallCorner0: [edge.a.x, edge.a.y, top, -10.0],
        aWallCorner1: [edge.b.x, edge.b.y, bottom, -10.0],
        aWallSenseType: edge[source.constructor.sourceType],
        aThresholdRadius2: 0.0
      },
      uniforms: {
        uElevationRes: [ev.elevationMin, ev.elevationStep, ev.elevationMax, distancePixels],
        uSceneDims: [sceneRect.x, sceneRect.y, sceneRect.width, sceneRect.height],
        uLightPosition: [lightPosition.x, lightPosition.y, lightPosition.z],
        uAzimuth: source.data.azimuth,
        uElevationAngle: source.data.elevationAngle,
        uSolarAngle: source.data.solarAngle
      }
    });
    return out;
  }


  /* ----- NOTE: Uniforms ----- */

  /** @type {float<radians>} */
  get uAzimuth() { return this.uniforms.uAzimuth ?? 0; }

  /** @type {float<radians>} */
  get uSolarAngle() { return this.uniforms.uSolarAngle ?? 0; }

  // ----- NOTE: Getters ----- //

  /** @type {float} */
  // TODO: Cannot currently go all the way to 0.
  get solarAngle() { return Math.max(0.1, this.uSolarAngle); }

  /** @type {ShadowDirections[2]} */
  get sideShadowDirs() {
    const { wall } = this;
    return [
      this.calculateSideShadowDirections(0),
      this.calculateSideShadowDirections(1)
    ];
  }

  /** @type {ShadowDirections} */
  get farShadowDirs() { this.calculateFarShadowDirections(0); }

  /** @type {ShadowDirections} */
  get nearShadowDirs() { return this.calculateNearShadowDirections(); }

  /* ----- NOTE: Penumbras ----- */

  /**
   * The rays from the wall endpoint along the side.
   * @param {int} idx     Which wall endpoint corresponds to this penumbra
   * @returns {ShadowDirections2d} Direction from the endpoint away from the light for umbra, mid, and penumbra.
   */
  calculateSideShadowDirections(idx = 0) {
    const orient = foundry.utils.orient2dFast;
    const sign = Math.sign;
    const { uAzimuth, uElevationAngle } = this.uniforms;
    const { solarAngle, wall } = this;

    // Direction from light to endpoint.
    const dirMidPenumbra = fromAngle(vec2(0.0), uAzimuth, 1.0).multiplyScalar(-1.0).normalize();

    // Determine which side of the wall the light is on.
    const oWallLight = sign(orient(wall.top[0].xy, wall.top[1].xy, wall.top[0].xy.subtract(dirMidPenumbra)));

    // Adjust azimuth by the solarAngle.
    // Determine the direction of the outer penumbra rays from light --> wallCorner1 / wallCorner2.
    // The angle for the penumbra is the azimuth ± the solarAngle.
    const solarWallAngle = solarAngle * oWallLight;
    const multiplier = idx === 0 ? 1.0 : -1.0;
    const dirPenumbra = fromAngle(vec2(0.0), uAzimuth + (solarWallAngle * multiplier), 1.0)
      .multiplyScalar(-1.0).normalize();
    const dirUmbra = fromAngle(vec2(0.0), uAzimuth - (solarWallAngle * multiplier), 1.0)
      .multiplyScalar(-1.0).normalize();

    // Normalize based on the mid penumbra for corner 0
    return ShadowDirections2d({
      umbra: dirUmbra,
      midpenumbra: dirMidPenumbra,
      penumbra: dirPenumbra
    });
  }

  /**
   * Ray from light --> top wall middle
   * @param {int} idx     The wall endpoint associated with this penumbra
   * @returns {ShadowDirections}
   *   - umbra: from light top
   *   - midpenumbra: from light middle
   *   - penumbra: from light bottom
   */
  calculateFarShadowDirections(idx = 0) {
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
   * Ray from light --> bottom wall middle
   * @param {int} idx     The wall endpoint associated with this penumbra
   * @returns {ShadowDirections}
   *   - umbra: from light bottom
   *   - midpenumbra: from light middle
   *   - penumbra: from light top
   */
  calculateNearShadowDirections(idx = 0) {
    const { uAzimuth } = this;
    const zDelta = this._calculateZChangeRays();
    const dirMid = fromAngle(vec2(0.0), uAzimuth, 1.0).multiplyScalar(-1.0);
    return ShadowDirections({
      umbra: vec3(dirMid, zDelta[PENUMBRA]),
      midpenumbra: vec3(dirMid, zDelta[MIDPENUMBRA]),
      penumbra: vec3(dirMid, zDelta[UMBRA])
    });
  }

  /**
   * Determine the change in z for the directional rays.
   * @returns {float[3]}
   */
  _calculateZChangeRays() {
    const { uAzimuth, uElevationAngle } = this.uniforms;
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
    const pt = fromAngle(vec2(0.0), elevationAngle, 1.0);

    // How much z (y) change for every change in x?
    const z = pt.x === 0.0 ? 1e06 : pt.y / pt.x;
    return -z;
    // Don't let z go to 0?
    // return max(z, 1e-06);
  }

  /**
   * Mimic calculations done in the vertex shader.
   */
  vertexCalculations(gl_VertexID = 0) {
    const wall = this.wall;
    const sideShadowDirs = this.sideShadowDirs;
    const farShadowDirs = this.farShadowDirs;
    const nearShadowDirs = this.nearShadowDirs;
    return super.vertexCalculations(gl_VertexID);
  }

  /**
   * Mimic the fragment calculations at a specific point.
   * @param {Point} pt
   */
  fragmentCalculations(pt, elevation) {
    return super.fragmentCalculations(pt, elevation);
  }
}

/**
 * Return the top and bottom elevation for an edge.
 * @param {Edge} edge
 * @returns {object}
 *   - @prop {number} topE      Elevation in grid units
 *   - @prop {number} bottomE   Elevation in grid units
 */
function edgeElevationE(edge) {
  // TODO: Handle elevation for ramps where walls are not equal
  const { a, b } = edge.elevationLibGeometry;
  const topE = Math.max(
    a.top ?? Number.POSITIVE_INFINITY,
    b.top ?? Number.POSITIVE_INFINITY);
  const bottomE = Math.min(
    a.bottom ?? Number.NEGATIVE_INFINITY,
    b.bottom ?? Number.NEGATIVE_INFINITY);
  return { topE, bottomE };
}

/**
 * Return the top and bottom elevation for an edge.
 * @param {Edge} edge
 * @returns {object}
 *   - @prop {number} topZ      Elevation in base units
 *   - @prop {number} bottomZ   Elevation in base units
 */
function edgeElevationZ(edge) {
  const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
  const { topE, bottomE } = edgeElevationE(edge);
  return { topZ: gridUnitsToPixels(topE), bottomZ: gridUnitsToPixels(bottomE) };
}

/* Testing
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
let { vec2, vec3, vec4 } = api.testing.glsl_mock
let {
  SizedPointSourceShadowWallVertexShaderTest2,
  DirectionalSourceShadowWallVertexShaderTest2 } = api.testing

l = canvas.lighting.placeables[0];
edge0 = canvas.walls.placeables[0].edge
edge1 = canvas.walls.placeables[1].edge
ev = l.lightSource.elevatedvision
UMBRA = 0;
MIDPENUMBRA = 2;
PENUMBRA = 1;
TOP = 0
BOTTOM = 1

// shader0 = SizedPointSourceShadowWallVertexShaderTest2.fromEdgeAndSource(edge0, l.lightSource)
// shader1 = SizedPointSourceShadowWallVertexShaderTest2.fromEdgeAndSource(edge1, l.lightSource)

let [shader0, shader1] = SizedPointSourceShadowWallVertexShaderTest2.fromMesh(ev.shadowMesh)
let [shader2, shader3] = SizedPointSourceShadowWallVertexShaderTest2.fromMesh(ev.shadowMesh)
let [shader4, shader5] = SizedPointSourceShadowWallVertexShaderTest2.fromMesh(ev.shadowMesh)

let [shader0, shader1] = DirectionalSourceShadowWallVertexShaderTest2.fromMesh(ev.shadowMesh)
let [shader2, shader3] = DirectionalSourceShadowWallVertexShaderTest2.fromMesh(ev.shadowMesh)

// Set alt shaders to elevation 0 to compare with changing ratios
shader2.uniforms.uElevationRes[0] = 0
shader3.uniforms.uElevationRes[0] = 0

shader2.uniforms.uElevationRes[0] = -999
shader4.uniforms.uElevationRes[0] = -998

shader0.vertexCalculations(2)
shader0.drawWall()
shader0.drawLight()

shader0.drawPenumbraTriangle()
shader0.drawSideTriangle(0)
shader0.drawSideTriangle(1)
shader0.drawAdjustedSidePenumbraDirections()

shader0.drawTriangle(UMBRA)
shader0.drawTriangle(PENUMBRA)

shader0.drawFarLines()
shader0.drawNearLines()

shader0.drawFarLines(0)
shader0.drawNearLines(0)


shader2.vertexCalculations(2)
shader2.drawTriangle(0)
shader2.drawTriangle(1)
shader2.drawTriangle(2)
shader2.drawFar()
shader2.drawNear()

shader1.vertexCalculations(2)
shader1.drawTriangle(0)
shader1.drawTriangle(1)
shader1.drawTriangle(2)
shader1.drawFar()
shader1.drawNear()

shader3.vertexCalculations(2)
shader3.drawTriangle(0)
shader3.drawTriangle(1)
shader3.drawTriangle(2)
shader3.drawFar()
shader3.drawNear()

pt = _token.center
elevation = -1000
shader0.vertexCalculations(2);
shader0.vVertexPosition = vec2(pt.x, pt.y);
shader0.setVaryings();
vPenumbra = normalizeBarycentricArea(shader0.vPenumbraArea)
vUmbra = normalizeBarycentricArea(shader0.vUmbraArea)
shader0.percentSideShadow(vPenumbra, vUmbra)
percentSideShadow(vPenumbra, vUmbra)

// shader0 = SizedPointSourceShadowWallVertexShaderTest.fromShader(ev.shadowMesh.shader)
// [shader0, shader1] = SizedPointSourceShadowWallVertexShaderTest.fromMesh(ev.shadowMesh)


// Change to canvas surface elevation
shader0.uniforms.uElevationRes[0] = 0
shader1.uniforms.uElevationRes[0] = 0


canvas.stage.addChild(ev.shadowMesh)

// Calculate angle between the two edges.
// Angle first --> linked endpoint --> other, on side away from light
function linkedEndpoints(edge0, edge1) {
  return edge0.a.key === edge1.a.key ? [edge0.a, edge0.b, edge1.b]
    : edge0.a.key === edge1.b.key ? [edge0.a, edge0.b, edge1.a]
    : edge0.b.key === edge1.a.key ? [edge0.b, edge0.a, edge1.b]
    : edge0.a.key === edge0.b.key ? [edge0.a, edge0.b, edge1.a]
    : null;
}


function angleBetweenLinkedEdges(edge0, edge1, lightPosition) {
  const [linkedEndpoint, unlinked0, unlinked1] = linkedEndpoints(edge0, edge1);
  let angle = PIXI.Point.angleBetween(unlinked0, linkedEndpoint, unlinked1, { clockwiseAngle: true });

  const orient = foundry.utils.orient2dFast;
  if ( orient(unlinked0, linkedEndpoint, lightPosition) < 0 ) angle = (Math.PI * 2) - angle;
  return angle;
}

function drawPenumbraDirection(wall, penumbraDirs) {
  const dist = canvas.dimensions.maxR;
  const p0 = wall.top[0].add(penumbraDirs[0].multiplyScalar(dist));
  const p1 = wall.top[1].add(penumbraDirs[1].multiplyScalar(dist));
  Draw.segment({ a: wall.top[0], b: p0 });
  Draw.segment({ a: wall.top[1], b: p1 }, { color: Draw.COLORS.lightblue });
}

edge0 = canvas.walls.controlled[0].edge
edge1 = canvas.walls.controlled[1].edge
let [linkedEndpoint, unlinked0, unlinked1] = linkedEndpoints(edge0, edge1)

Math.toDegrees(angleBetweenLinkedEdges(edge0, edge1, l.lightSource.data))
angle = angleBetweenLinkedEdges(edge0, edge1, l.lightSource.data)


// Angle of the linked wall, measured from the shared endpoint.
function linkedAngle(edge0, edge1, endpoint = "a") {
  const res = linkedSegment(edge0, edge1, endpoint);
  if ( !res ) return -10;

  // Same as Ray.angle
  return Math.atan2(res.b.y - res.a.y, res.b.x - res.a.x);
}

// Arrange edge1 so that a is the linked endpoint.
function linkedSegment(edge0, edge1, endpoint = "a") {
  const sharedKey = edge0[endpoint].key
  return sharedKey === edge1.a.key ? edge1
    : sharedKey === edge1.b.key ? { a: edge1.b, b: edge1.a }
    : null
}

// Correct the linked edges
shader0.attributes.aWallCorner0.w = linkedAngle(edge0, edge1, "a")
shader0.attributes.aWallCorner1.w = linkedAngle(edge0, edge1, "b")
shader1.attributes.aWallCorner0.w = linkedAngle(edge1, edge0, "a")
shader1.attributes.aWallCorner1.w = linkedAngle(edge1, edge0, "b")


shader0.drawPenumbra()
shader1.drawPenumbra()

shader0.drawSidePenumbra()
shader1.drawSidePenumbra()

shader0.drawTriangle()
shader1.drawTriangle()

shader0.calculatePenumbraBaryCoords()
shader1.calculatePenumbraBaryCoords()

shader0.calculateFlatVariables()
shader1.calculateFlatVariables()

shader0.calculateElevatedShadowRatios()
shader0.calculateElevatedShadowRatios({ elevationE: 0 })

shader0.nearFarCoordinates()
shader0.nearFarCoordinates({ elevationE: 0 })

shader0.drawFar()
shader0.drawFar({ elevationE: 0 })

shader1.drawFar()
shader1.drawFar({ elevationE: 0 })

shader0.drawNear({ elevationE: 0 })
shader1.drawNear({ elevationE: 0 })

*/

/* Calculate penumbra endpoint based on elevation

ixBase = vec3()
ix500 = vec3()
ix0 = vec3()
shader0._penumbraCanvasIntersection(ixBase, PENUMBRA, true, 0, shader0.canvasElevation)
shader0._penumbraCanvasIntersection(ix500, PENUMBRA, true, 0, -500)
shader0._penumbraCanvasIntersection(ix0, PENUMBRA, true, 0, 0)

-1000: { x: 5100, y: 952 }    dist: 2342
-500:  { x: 4350, y: 1322 }   dist: 1506
0:     { x: 3600, y: 1692 }   dist: 669

Full distance = 2342, for -1000 to 400

UMBRA = 0;
MIDPENUMBRA = 1;
PENUMBRA = 2;

wallEndpoint = PIXI.Point.fromObject(shader0.wall.top[0])
penumbraEndpoint = PIXI.Point.fromObject(shader0.farPenumbraPoints[0][PENUMBRA])
otherWallEndpoint = PIXI.Point.fromObject(shader0.wall.top[1])
otherPenumbraEndpoint = PIXI.Point.fromObject(shader0.farPenumbraPoints[1][PENUMBRA])
lightIx = PIXI.Point.fromObject(
  foundry.utils.lineLineIntersection(wallEndpoint, penumbraEndpoint, otherWallEndpoint, otherPenumbraEndpoint))
elevChange = 0 - shader0.canvasElevation
wallHeight = shader0.wall.top[0].z - shader0.canvasElevation
ratio = 0
wallRatio = PIXI.Point.distanceBetween(penumbraEndpoint, wallEndpoint)
  / PIXI.Point.distanceBetween(penumbraEndpoint, lightIx)
ratioDist = wallRatio - ratio
heightFraction = elevChange / wallHeight;
newRatio = ratio + (heightFraction * ratioDist);
newIx = penumbraEndpoint.projectToward(lightIx, newRatio)


// Using only the outer penumbra, can we still determine a ratio that applies to inner?
ixBase = vec3()
ix500 = vec3()
ix0 = vec3()
shader0._penumbraCanvasIntersection(ixBase, UMBRA, true, 0, shader0.canvasElevation)
shader0._penumbraCanvasIntersection(ix500, UMBRA, true, 0, -500)
shader0._penumbraCanvasIntersection(ix0, UMBRA, true, 0, 0)

elevationZ = 0;
wallEndpoint = PIXI.Point.fromObject(shader0.wall.top[0])
penumbraEndpoint = PIXI.Point.fromObject(shader0.farPenumbraPoints[0][PENUMBRA])
otherWallEndpoint = PIXI.Point.fromObject(shader0.wall.top[1])
otherPenumbraEndpoint = PIXI.Point.fromObject(shader0.farPenumbraPoints[1][PENUMBRA])
lightIx = PIXI.Point.fromObject(
  foundry.utils.lineLineIntersection(wallEndpoint, penumbraEndpoint, otherWallEndpoint, otherPenumbraEndpoint))
elevChange = elevationZ - shader0.canvasElevation
wallHeight = shader0.wall.top[0].z - shader0.canvasElevation
wallRatio = PIXI.Point.distanceBetween(penumbraEndpoint, wallEndpoint)
  / PIXI.Point.distanceBetween(penumbraEndpoint, lightIx)
ratioDist = wallRatio
heightFraction = elevChange / wallHeight;
newRatio = heightFraction * wallRatio;

umbraEndpoint =  PIXI.Point.fromObject(shader0.farPenumbraPoints[0][UMBRA])
otherUmbraEndpoint = PIXI.Point.fromObject(shader0.farPenumbraPoints[1][UMBRA])
umbraLightIx = PIXI.Point.fromObject(
  foundry.utils.lineLineIntersection(wallEndpoint, umbraEndpoint, otherWallEndpoint, otherUmbraEndpoint))
newIx = umbraEndpoint.projectToward(umbraLightIx, newRatio)

*/


/* Fragment variables
vec2 vVertexPosition => from 3 vertices
vec3 vBary => from 3 vertices
vec2 vTerrainTexCoord
vec3 vSidePenumbra0
vec3 vSidePenumbra1

float fWallRatio
float fWallSenseType
float fThresholdRadius2
vec3 fNearRatios
vec3 fFarRatios
vec2 fWallHeights
vec2 fWallCornerLinked?

uLightPosition
uElevationRes
uTerrainSampler

barycentric:
vec3 vPenumbra
vec3 vSidePenumbra0
vec3 vSidePenumbra1

interpolated:
vec2 vVertexPosition

flats:
vec2 fWallRatio — for elevation
vec2 fFarRatios -- technically a vec2 b/c penumbra is 0.0
vec3 fNearRatios
float fWallSenseType
float fThresholdRadius2

Currently, per vertex:
float aThresholdRadius2
vec4 aWallCorner0
vec4 aWallCorner1
float aWallSenseType
10 total floats.

Could do per vertex:
bary coords:
// vPenumbra based on vertexNum
float vSidePenumbra0 (baryForPoint)
float vSidePenumbra1 (baryForPoint)

if useful:
float vMidPenumbra
float vUmbra

Other:
vec2 vVertexPosition

Flats:
vec2 fWallRatio
vec2 fFarRatios
vec3 fNearRatios
float fWallSenseType
float fThresholdRadius2
Likely 13–15 total floats
Need to cut back on flats.

Alt:
float vSidePenumbra0 (baryForPoint)
float vSidePenumbra1 (baryForPoint)
float vMidPenumbra
float vUmbra
vec2 vVertexPosition
float vWall
float vNearMidPenumbra
float vNearPenumbra

Flats:
float fWallSenseType
float fThresholdRadius2

11 total. So only 1 more but a lot less webGPU calcs.


// Alternative using flats:
Pass vertex points; set vPenumbra for each vertex.
Test x values of the vPenumbra against flat variables.
Set fFarPenumbra to 0.0.
- fWallRatio: Needed to calculate elevation ratios.
- fNearUmbra
- fNearMidPenumbra
- fNearPenumbra
- fFarUmbra
- fFarMidPenumbra
- fWallHeights (vec2<top, bottom>)
- fWallSenseType
- fThresholdRadius
- vec2 vertexPosition
(10 fixed floats plus vec2)
Save 2 spaces for other wall top, bottom
Also need the side penumbra:
- vSidePenumbra0
- vSidePenumbra1

So attributes could be:
vec2 vertexPosition
vec2 vSidePenumbra (0, 1)
vec3 near (flats)
- vertex 0: fNearUmbra, fNearMidPenumbra, fNearPenumbra
vec2 far (flats)
- vertex 1: fFarUmbra, fFarMidPenumbra, wallHeightBottom1 (currently unused)
vec3 other (flats)
- fWallRatio, fWallSenseType, fThresholdRadius, wallHeight0Bottom
vec3 wallHeights
- top0, bottom0, top1 (top1 current unused)

*/

/*
tri0 = shader0.buildTriangle(shader0.farPenumbraPoints, shader0.wall, PENUMBRA)
tri2 = shader2.buildTriangle(shader2.farPenumbraPoints, shader2.wall, PENUMBRA)
tri4 = shader4.buildTriangle(shader4.farPenumbraPoints, shader4.wall, PENUMBRA)

dist0 = PIXI.Point.distanceBetween(tri0[0], tri0[1])
dist2 = PIXI.Point.distanceBetween(tri2[0], tri2[1])
dist4 = PIXI.Point.distanceBetween(tri4[0], tri4[1])
ratio20 = dist2 / dist0
ratio40 = dist4 / dist0

wallHeight = 400
canvasElevation = -1000
wallHeight = Math.max(wallHeight - canvasElevation, 0.0);
elevationChange = elevation - canvasElevation;
heightFraction = elevationChange / wallHeight

elevationChange2 = -999 - canvasElevation;
heightFraction2 = elevationChange2 / wallHeight;

elevationChange4 = -998 - canvasElevation;
heightFraction4 = elevationChange4 / wallHeight;

// heightFraction is very close to, but not quite same as, ratio
// difference between the ratios are nearly the same, but not quite:
1 - ratio20       = 0.0006393632550071304
ratio20 - ratio40 = 0.0006389565670743558

// heightFraction are multiples:
heightFraction4 / 2 = 0.0007142857142857143
heightFraction2 = 0.0007142857142857143

// Instead of 0–1, the barycentric x value must be between 0 and ratio? or 0 and 1 - height fraction?
Triangles ABC and DEF, where DEF is similar with side length ratio of 2:1.
P is (0.2, 0.5, 0.3) in ABC. Has same bary in DEF but actual position scaled up by factor of 2.
Multiply each coordinate by scaling factor between two triangles to find coordinates in other.

umbraTri0 = shader0.buildTriangle(shader0.farPenumbraPoints, shader0.wall, UMBRA)
umbraTri2 = shader2.buildTriangle(shader2.farPenumbraPoints, shader2.wall, UMBRA)
Draw.connectPoints(umbraTri0, { color: Draw.COLORS.blue })
Draw.connectPoints(umbraTri2, { color: Draw.COLORS.green })

let [A, B, C] = umbraTri0
let [D, E, F] = umbraTri2
P = vec2(pt.x, pt.y)
baryABC = barycentric(P, A, B, C)
baryDEF = barycentric(P, D, E, F)

ratio = Math.pow(PIXI.Point.distanceBetween(A, B) / PIXI.Point.distanceBetween(D, E), 2)
ratio = Math.pow(PIXI.Point.distanceBetween(D, E) / PIXI.Point.distanceBetween(A, B), 2)

PIXI.Point.distanceBetween(D, E) = Math.sqrt(ratio) * PIXI.Point.distanceBetween(A, B)

P_DEF = invertBarycentric(umbraTri2, baryABC)

baryABC.multiplyScalar(ratio)

bary.x === 1 at the light center; 0 at the far penumbra edge


ratio = Math.pow(PIXI.Point.distanceBetween(D, E) / PIXI.Point.distanceBetween(A, B), 2)
// this is just a.towardsPoint(b, PIXI.Point.distanceBetween(D, E))
tmp = a.towardsPoint(b, Math.sqrt(ratio) * PIXI.Point.distanceBetween(A, B));
barycentric(tmp, A, B, C); // Gives the x value for which the line is crossed for A, B, C at elevation


wallRatio = shader0.fWallRatio
baryABC.x + (heightFraction * wallRatio) - (heightFraction * baryABC.x)


*/

/*

Varying:
vec2 vVertexPosition
vec3 vUmbra


Flat:
vec2 fWallHeights
float fThresholdRadius2
float fWallRatio
float fFarRatio
vec2 fNearRatios

Calculated:
vec2 VTerrainTexCoord
vec3 vPenumbra          Based on vertexNum

Per vertex:
2 + 3 + 2 + 1 + 1 + 1 + 2 = 12


vs:
Flat:
vec4 edge0 {x, y, top, bottom}
vec4 edge1 {x, y, top, bottom}
float fThresholdRadius
vec2 linkedAngle
4 + 4 + 1 + 2 = 11
*/
