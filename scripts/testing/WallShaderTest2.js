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
  Circle,
  ShadowDirections,
  ShadowDirections2d,
  ShadowPoints,
  ShadowRays2d,
  Wall,
  Light,
  tangentPoints,
  fromAngle,
  normalizedDirection,
  lineLineIntersectionRay,
  lineLineIntersects,
  intersectRayPlane,
  barycentric,
  barycentricPointInsideTriangle,
  lineLineIntersection,
  distanceSquared,
  linearConversion,
  interpolateBarycentric,
  between,
  normalizeBarycentricArea,
  convertBarycentericAreaSimilarTriangle,
  almostEqual,
  rayFromPoints,
  projectRay,
  normalizedRayFromPoints
} from "./glsl_mock.js";

const UMBRA = 0;
const PENUMBRA = 1;
const MIDPENUMBRA = 2; // So that vec2 can hold UMBRA/PENUMBRA

const TOP = 0;
const BOTTOM = 1;

const FAR = 0;
const NEAR = 1;

/* Mock shader calculations based on new approach of using only umbra and penumbra.
 * Use barycentric area values as varyings.
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
 * Framework to represent a single wall-light shadow calculation.
 * Each child class defines the outer penumbra triangle and optionally two side triangles
 * (one for each endpoint) describing the shift from penumbra --> umbra.
 * Locations inside the outer penumbra but not in the side penumbra are fully shaded.
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
  get aThresholdRadius2() { return this.attributes.aThresholdRadius2; }

  /* ----- NOTE: Uniforms ----- */

  /** @type {vec4} */
  get uElevationRes() { return vec4(...this.uniforms.uElevationRes); }

  /** @type {vec4} */
  get uSceneDims() { return vec4(...this.uniforms.uSceneDims); }

  /* ----- NOTE: Defined terms ---- */

  /** @type {bool} */
  get wallIsFloating() {
    const { aWallCorner1, canvasElevation } = this;
    const wallBottomZ = aWallCorner1.z;
    return wallBottomZ > canvasElevation;
  }

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

  /** @type {float[2]} */
  get wallLinkAngles() { return [this.aWallCorner0.w, this.aWallCorner1.w]; }

  /* ----- NOTE: Getters for vertex calculations ----- */

  /** @type {object} */
  get varyings() {
    const {
      vVertexPosition,
      vTerrainTexCoord,
      vPenumbra,
      vSidePenumbra0,
      vSidePenumbra1,
      vNearFarPenumbra0,
      vNearFarPenumbra1 } = this;
    return {
      vVertexPosition,
      vTerrainTexCoord,
      vPenumbra,
      vSidePenumbra0,
      vSidePenumbra1,
      vNearFarPenumbra0,
      vNearFarPenumbra1
    };
  }

  get flats() {
    const {
      fThresholdRadius2,
      fWallSenseType,
      fWallHeights,
      fWallRatios,
      fFarRatios0,
      fFarRatios1,
      fNearRatios0,
      fNearRatios1 } = this;
    return {
      fThresholdRadius2,
      fWallSenseType,
      fWallHeights,
      fWallRatios,
      fFarRatios0,
      fFarRatios1,
      fNearRatios0,
      fNearRatios1
    };
  }
  // ----- NOTE: Vertex shader calculations ----- //

  /**
   * @returns {Wall}
   */
  calculateWallPositions() {
    const { aWallCorner0, aWallCorner1, aWallSenseType, aThresholdRadius2 } = this;

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
   * For side penumbra directions, determine if they must be moved to address light leakage
   * from linked endpoints.
   * @param {inout ShadowDirections} shadowDirs
   * @param {Wall} wall
   * @param {int} idx
   * @returns {bool} True if not blocked.
   */
  adjustSideShadowForLinkedEndpoints(shadowDirs, wall, idx) {
    const orient = foundry.utils.orient2dFast;
    const { aWallCorner0, aWallCorner1 } = this;

    const wXY = wall.top[idx].xy; // Wall endpoint from which a penumbra is cast.

    // If no linked wall, full penumbra is used.
    const linkValue = vec2(aWallCorner0.w, aWallCorner1.w);
    const linkAngle = linkValue[idx];
    if ( linkAngle === this.constructor.EV_ENDPOINT_LINKED_UNBLOCKED ) {
      console.log(`adjustSideShadowForLinkedEndpoints|idx ${idx} is unblocked.`);
      return true;
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
      console.log(`adjustSideShadowForLinkedEndpoints|idx ${idx} linked wall blocks light fully.`);
      return false;
    }

    // 3 & 4: Linked wall between wall and mid
    // 3: Linked wall in quadrant with light, not blocking.
    const oLinkWall = orient(wXY, linkPt, other);
    const oLinkMid = orient(wXY, linkPt, midPt);
    const linkBetweenWallAndMid = oLinkWall * oLinkMid < 0.0;
    if ( !linkBetweenWallAndMid ) {
      console.log(`adjustSideShadowForLinkedEndpoints|idx ${idx} not blocking (#3).`);
      return true;
    }

    // 4. possible block.
    // What side of umbra is the linked wall on? If not on the mid-side, it doesn't block.
    const umbraR = Ray2d(wXY, shadowDirs.umbra);
    const umbraPt = umbraR.project(1);
    const oUmbraLink = orient(wXY, umbraPt, linkPt);
    const oUmbraMid = orient(wXY, umbraPt, midPt);
    const linkAfterUmbra = oUmbraLink * oUmbraMid > 0.0;
    if ( !linkAfterUmbra ) {
      console.log(`adjustSideShadowForLinkedEndpoints|idx ${idx} is unblocked.`);
      return true;
    }

    // Linked wall is after umbra, moving toward mid.
    const oMidUmbra = orient(wXY, midPt, umbraPt);

    // Set umbra to the link direction.
    const linkDir = normalizedDirection(wXY, linkPt);
    shadowDirs.umbra.x = linkDir.x;
    shadowDirs.umbra.y = linkDir.y;
    console.log(`adjustSideShadowForLinkedEndpoints|idx ${idx} partially blocked. Adjusting umbra.`);
    // Unneeded? if ( oMidUmbra * oMidLink > 0.0 ) return true;

    // Linked wall is after mid.
    console.log(`adjustSideShadowForLinkedEndpoints|idx ${idx} partially blocked. Adjusting mid.`);
    return true;
  }

  /**
   * Get the corner that can be used to project a far parallel ray to a wall.
   * Used in penumbraEndpoints to determine the infinite shadow parallel ray.
   * @param {vec2} direction
   * @returns {vec2}
   */
  directionalCorner(direction) {
    const orient = foundry.utils.orient2dFast;
    const { uSceneDims } = this;

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

    // Direction is moving into one of 4 quadrants.
    if ( direction.x > 0.0 ) return direction.y > 0.0 ? sceneRect[BR] : sceneRect[TR];

    // Moving left. x <= 0.
    return direction.y > 0.0 ? sceneRect[BL] : sceneRect[TL];
  }

  /**
   * Does this directional ray cast an infinite shadow?
   * (Ray is rising as it moves from light --> wall.)
   * @param {vec3} lightDir
   * @returns {bool}
   */
  isInfiniteShadow(lightDir) { return lightDir.z >= 0.0 || almostEqual(lightDir.z, 0.0, 1e-06); }

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

  /**
   * For a given two side directions (e.g., penumbra0 and penumbra1),
   * determine where to place an ending line parallel to the wall that intersects both
   * but does not intersect the scene rectangle.
   * Used to create faux triangles for infinite shadows.
   * Far triangle must always parallel the wall.
   * @param {Ray2d[2]} lightRays
   * @returns {vec2[2]}
   */
  infiniteShadowEndpoints(lightRays, wall) {
    const orient = foundry.utils.orient2dFast;
    const { uSceneDims } = this;

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

    // Wall data
    let wallDir = normalizedDirection(wall.top[0].xy, wall.top[1].xy);

    // Light rays can intersect closest to the same quadrant (1 point), adjacent quadrants (2 points),
    // or opposing quadrants (3 points, middle one counts).
    const quad0 = this.directionalQuadrant(lightRays[0].direction);
    const quad1 = this.directionalQuadrant(lightRays[1].direction);
    const quadWall = this.directionalQuadrant(wallDir);

    let corner = quadWall;
    if ( quad0 === quad1 ) corner = quad0;
    if ( quad0 === ((quad1 + 2) % 4) ) corner = (quad0 + 1) % 4; // One apart, e.g., 1 and 3.

    // Either:
    // (1) intersect line in wall direction through corner without hitting the scene rect.
    // (2) Use 45º line through corner to intersect directions.
    //     Line in wall direction through one of those should work.
    // (1) If the wall direction is going to the same or directly opposite quadrant, then it will hit the scene.
    if ( corner !== quadWall && ((corner + 2) % 4) !== quadWall ) {
      const ixs = [vec2(), vec2()];
      const wallRay = Ray2d(sceneRect[corner], wallDir);
      lineLineIntersection(wallRay, lightRays[0], ixs[0]);
      lineLineIntersection(wallRay, lightRays[1], ixs[1]);
      return ixs;
    }

    // Wall direction must be headed toward one of the corners.
    // If two apart, heading toward the corner.

    // If quad0 and quad1 are adjacent, the line they form can be used to get test points
    // like in (2) below. Test line in wall direction through each.
    let cornerRay;
    if ( quad0 === ((quad1 + 1) % 4)) { // Adjacent
      cornerRay = Ray2d(sceneRect[quad0], normalizedDirection(sceneRect[quad0], sceneRect[quad1]));
      if ( quadWall !== quad0 && quadWall !== quad1 ) wallDir = wallDir.multiplyScalar(-1); // Flip wall direction.
    } else {
      let corner45Dir;
      switch ( corner ) {
        case TL:
        case BL: corner45Dir = vec2(.5, -.5); break;
        case TR:
        case BR: corner45Dir = vec2(.5, .5); break;
      }
      if ( quadWall !== quad0 && quadWall !== quad1 && quadWall !== corner ) wallDir = wallDir.multiplyScalar(-1); // Flip wall direction.
      cornerRay = Ray2d(sceneRect[corner], corner45Dir);
    }

    // (2) Intersect the directional rays.
    const rayIxs = [vec2(), vec2()];
    lineLineIntersection(cornerRay, lightRays[0], rayIxs[0]);
    lineLineIntersection(cornerRay, lightRays[1], rayIxs[1]);

    // The wall direction from the ray ix must head toward the other ray.
    const outIxs = [vec2(), vec2()];
    const cornerRay1 = Ray2d(rayIxs[1], lightRays[1].direction);
    const wallRay0 = Ray2d(rayIxs[0], wallDir);
    const t0 = lineLineIntersection(cornerRay1, wallRay0);
    if ( t0 > 0.0 ) {
      outIxs[1] = cornerRay1.project(t0);
      outIxs[0] = rayIxs[0];
    } else {
      const wallRay1 = Ray2d(rayIxs[1], wallDir);
      lineLineIntersection(lightRays[0], wallRay1, outIxs[0]);
      outIxs[1] = rayIxs[1];
    }
    return outIxs;
  }

  /**
   * Ray either parallel to the wall or, for infinite shadow, ray through a scene corner
   * perpendicular to the light direction.
   * @param {Wall} wall
   * @param {vec3} lightDir
   * @param {int} nearFar
   * @returns {Ray2d}
   */
  shadowNearFarRay(wall, lightDir, nearFar) {
    // Wall position.
    const wall0 = nearFar === FAR ? wall.top[0] : wall.bottom[0];
    const wall1 = nearFar === FAR ? wall.top[1] : wall.bottom[1];
    const wallMid = wall0.add(wall1).multiplyScalar(0.5); // @type {vec3}

    // Construct a ray from light --> wall and get the canvas intersection.
    // If this is an infinite light, use the perpendicular to the light ray as the direction.
    const lightRay = Ray(wallMid, lightDir);
    const ix = vec2();
    let dir = normalizedDirection(wall0.xy, wall1.xy);
    if ( !this.canvasIntersection(lightRay, ix) ) dir = vec2(lightDir.y, -lightDir.x).normalize();
    return Ray2d(ix, dir);
  }

  /**
   * Intersect a 3d vector on the canvas.
   * @param {Ray} lightRay
   * @param {out vec2} ix   Intersection or the canvas edge point to use instead.
   * @returns {bool} True if there was an actual canvas intersection.
   */
  canvasIntersection(lightRay, ix) {
    const { uElevationRes } = this;

    let infiniteShadow = lightRay.direction.z >= 0.0 || almostEqual(lightRay.direction.z, 0.0, 1e-06); // Ray is rising as it moves from light --> wall.
    if ( infiniteShadow ) {
      const corner = this.directionalCorner(lightRay.direction.xy);
      ix.x = corner.x;
      ix.y = corner.y;
      return false;
    }

    // Plane at the minimum canvas elevation.
    const canvasPlane = this.canvasPlane;
    const canvasIx = vec3();
    if ( !intersectRayPlane(lightRay, canvasPlane, canvasIx) ) {
      const corner = this.directionalCorner(lightRay.direction.xy);
      ix.x = corner.x;
      ix.y = corner.y;
      return false;
    }
    ix.x = canvasIx.x;
    ix.y = canvasIx.y;
    return true;
  }

  /**
   * Calculate a near or far shadow ratio.
   * @param {Wall} wall
   * @param {vec2[3]} penumbraTri
   * @param {ShadowDirections} shadowDirs
   * @param {int} nearFar
   * @param {int} shadowType
   * @returns {float}
   */
  calculateNearFarRatio(wall, penumbraTri, shadowDirs, nearFar, shadowType) {
    const baryForPoint = barycentric;

    const nfDir = shadowType === PENUMBRA ? shadowDirs.penumbra : shadowDirs.umbra;
    const nfRay = this.shadowNearFarRay(wall, nfDir, nearFar);
    const ix = vec2();
    lineLineIntersection(nfRay, rayFromPoints(penumbraTri[0], penumbraTri[1]).normalize(), ix);
    return baryForPoint(ix, ...penumbraTri).x;
  }

  /* ----- NOTE: Alternative calculations ----- */

  /**
   * For infinite wall shadow, point outside of canvas that can be the fake floor intersection.
   * Either a point on the 45º line at a scene corner or a scene edge point.
   * @param {Ray2d[2]}
   * @returns {Ray2d}
   */
  infiniteShadowCanvasRay(lightRays) {
    const orient = foundry.utils.orient2dFast;
    const { uSceneDims } = this;

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
    if ( quad0 === ((quad1 + 1) % 4) || quad0 === ((quad1 + 3) % 4) ) { // -1 + 4
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
    let corner45Dir;
    switch ( corner ) {
      case TL:
      case BL: corner45Dir = vec2(.5, -.5); break;
      case TR:
      case BR: corner45Dir = vec2(.5, .5); break;
    }
    return Ray2d(sceneRect[corner], corner45Dir);
  }

  /**
   * Determine the key vertices and rays for the shadow triangles.
   * A, D, G, representing the points of the penumbra and two nearFar triangles.
   * rAB, rAC, rD_umbra, rG_umbra
   * @param {ShadowRays2d} sideShadowRays
   * @param {Wall} wall
   * @param {inout vec2} A
   * @param {inout vec2} D
   * @param {inout vec2} G
   * @param {inout Ray2d} rAB
   * @param {inout Ray2d} rAC
   * @param {inout Ray2d} rD_umbra
   * @param {inout Ray2d} rG_umbra
   */
  shadowTriangleKeyValues(sideShadowRays, wall, A, D, G, rAB, rAC, rD_umbra, rG_umbra) {
    // For debugging.
    sideShadowRays ??= this.sideShadowRays;
    wall ??= this.wall;
    A ??= vec2();
    D ??= vec2();
    G ??= vec2();
    rAB ??= Ray2d(vec2(), vec2());
    rAC ??= Ray2d(vec2(), vec2());
    rD_umbra ??= Ray2d(vec2(), vec2());
    rG_umbra ??= Ray2d(vec2(), vec2());

    // Wall data.
    let w0 = wall.top[0].xy;
    let w1 = wall.top[1].xy;

    // A found by intersecting the two side penumbra lines.
    lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.penumbra[1], A);

    // Endpoint closest to the light will be associated with ∆DEF; furthest is ∆GHI.
    // Can determine by comparing distance to the penumbra vertex 0 (A).
    let closestIdx = A.distanceSquared(wall.top[1].xy) < A.distanceSquared(wall.top[0].xy) ? 1 : 0;
    w0 = wall.top[closestIdx].xy;
    w1 = wall.top[1 - closestIdx].xy;

    // The AB penumbra ray runs through the closer endpoint.
    closestIdx = sideShadowRays.penumbra[0].origin.x === w0.x && sideShadowRays.penumbra[0].origin.y === w0.y ? 0 : 1;
    rAB = sideShadowRays.penumbra[closestIdx];
    rAC = sideShadowRays.penumbra[1 - closestIdx];

    // D and G are the intersections of the penumbra with opposite umbra.
    // E intersects the D penumbra ray with the canvas line.
    const rD_penumbra = rAB;
    const rG_penumbra = rAC;
    rD_umbra = sideShadowRays.umbra[closestIdx];
    rG_umbra = sideShadowRays.umbra[1 - closestIdx];
    lineLineIntersection(rD_penumbra, rD_umbra, D);
    lineLineIntersection(rG_penumbra, rG_umbra, G);

    // For debugging.
    return { A, D, G, rAB, rAC, rD_umbra, rG_umbra };
  }

  /**
   * For infinite shadow, construct the different triangles.
   * @param {ShadowRays2d} sideShadowRays
   * @param {Wall} wall
   * @param {Ray2d} canvasRay     Either the infinite canvas ray or the far penumbra canvas intersection.
   * @returns {object}
   */
  shadowTriangles(sideShadowRays, wall, canvasRay) {
    sideShadowRays ??= this.sideShadowRays;
    wall ??= this.wall;
    canvasRay ??= this.infiniteShadowCanvasRay(sideShadowRays.penumbra);

    // Penumbra triangle: ∆ABC
    // Side triangle 0: ∆DEF
    // Side triangle 1: ∆GHI
    let A = vec2();
    let D = vec2();
    let G = vec2();
    let rAB = Ray2d(vec2(), vec2());
    let rAC = Ray2d(vec2(), vec2());
    let rD_umbra = Ray2d(vec2(), vec2());
    let rG_umbra = Ray2d(vec2(), vec2());

    let B = vec2();
    let C = vec2();
    let E = vec2();
    let F = vec2();
    let H = vec2();
    let I = vec2();
    let ABC = [A, B, C];
    let DEF = [D, E, F];
    let GHI = [G, H, I];


    const res = this.shadowTriangleKeyValues(sideShadowRays, wall, A, D, G, rAB, rAC, rD_umbra, rG_umbra);
    A = res.A;
    D = res.D;
    G = res.G;
    rAB = res.rAB;
    rAC = res.rAC;
    rD_umbra = res.rD_umbra;
    rG_umbra = res.rG_umbra;

    // Endpoint closest to the light will be associated with ∆DEF; furthest is ∆GHI.
    // Can determine by comparing distance to the penumbra vertex 0 (A).
    let closestIdx = A.distanceSquared(wall.top[1].xy) < A.distanceSquared(wall.top[0].xy) ? 1 : 0;
    const w0 = wall.top[closestIdx].xy;
    const w1 = wall.top[1 - closestIdx].xy;
    const wallDir = normalizedDirection(w0, w1);

    const rD_penumbra = rAB;
    const rG_penumbra = rAC;
    lineLineIntersection(rD_penumbra, canvasRay, E);

    // Moving from E along the wall direction, we will intersect rD_umbra at F.
    const rEWall = Ray2d(E, wallDir);
    lineLineIntersection(rEWall, rD_umbra, F);

    // May intersect rG_umbra (I) and rG_penumbra (H, B).
    let sideTri0;
    let sideTri1;
    const tI = lineLineIntersection(rEWall, rG_umbra);
    if ( tI !== null && tI > 0.0 ) {
      I.set(projectRay(rEWall, tI), 0); // GLSL: I = projectRay(rEWall, tI)
      lineLineIntersection(rEWall, rG_penumbra, H);
      B.set(H, 0);
      C.set(E, 0);
      sideTri0 = [w0, C, I]; // Wall endpoint, penumbra point, umbra point.
      sideTri1 = [w1, B, F];
    } else {
      console.log("infiniteShadowTriangles|Near-collinear wall.");
      const canvasRay2 = Ray2d(F, canvasRay.direction);
      lineLineIntersection(canvasRay2, rG_penumbra, B);
      lineLineIntersection(canvasRay, rG_umbra, I);
      const rIWall = Ray2d(I, wallDir);
      lineLineIntersection(rIWall, rG_penumbra, H);
      lineLineIntersection(canvasRay2, rD_penumbra, C);
      sideTri0 = [w0, C, I]; // Wall endpoint, penumbra point, umbra point.
      sideTri1 = [w0, B, F]; // Same as non-collinear but for the endpoint w0.
    }
    return { ABC, DEF, GHI, sideTri0, sideTri1,
      rAB,
      rAC,
      rD_penumbra, rG_penumbra, rD_umbra, rG_umbra, canvasRay
    };
  }

  /**
   * Locate the canvas intersection for a given direction.
   * If none, determine the infinite shadow canvas ray.
   * @param {vec3} nearFarDir           Typically farShadowDirs.penumbra
   * @param {vec3[2]} sidePenumbra      Typically sideShadowRays.penumbra
   * @param {Wall} wall
   * @param {out Ray2d} canvasRay
   * @returns {bool}
   */
  canvasIntersectionRay(nearFarDir, sidePenumbra, wall, canvasRay) {
    const canvasPlane = this.canvasPlane;
    const wallTopMid = wall.top[0].add(wall.top[1]).multiplyScalar(0.5);
    const wallDir2d = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
    const canvasIx = vec3();
    if ( !this.isInfiniteShadow(nearFarDir)
      && intersectRayPlane(Ray2d(wallTopMid, nearFarDir), canvasPlane, canvasIx) ) {
      canvasRay.origin = canvasIx.xy;
      canvasRay.direction = wallDir2d;
      return true;
    } else {
      const infCanvasRay = this.infiniteShadowCanvasRay(sidePenumbra);
      canvasRay.origin = infCanvasRay.origin;
      canvasRay.direction = infCanvasRay.direction;
      return false;
    }
  }

  // ----- NOTE: Primary vertex functions ----- //

  /**
   * Calculate the flat variables, including near/far ratios.
   * @param {vec2[3]} penumbraTri
   * @param {Wall} wall
   */
  calculateFlatVariables(penumbraTri, nearFarTri0, nearFarTri1,
    wall, farShadowDirs, nearShadowDirs, hasUmbraShadows, hasNearShadows, sideShadowRays) {

    wall ??= this.wall;
    penumbraTri ??= this.penumbraTri;
    farShadowDirs ??= this.farShadowDirs;
    nearShadowDirs ??= this.nearShadowDirs;
    hasUmbraShadows ??= this.hasUmbraShadows;
    hasNearShadows ??= this.hasNearShadows();
    nearFarTri0 ??= this.nearFarTri0;
    nearFarTri1 ??= this.nearFarTri1;

    const { uElevationRes, aWallSenseType, aThresholdRadius2 } = this;
    const { DISTANCE, PROXIMATE } = CONST.WALL_SENSE_TYPES;
    const baryForPoint = barycentric;

    const wTop = wall.top[0];
    const wBottom = wall.bottom[0];
    const wallDir = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
    const wallTopMid = wall.top[0].xy.add(wall.top[1].xy).multiplyScalar(0.5);

    // @type {vec2} fWallHeights
    this.fWallHeights = vec2();
    this.fWallHeights[TOP] = wTop.z;
    this.fWallHeights[BOTTOM] = wBottom.z;

    // @type {float} fWallSenseType
    this.fWallSenseType = aWallSenseType;

    // @type {float} fThresholdRadius
    this.fThresholdRadius2 = !(aWallSenseType === DISTANCE || aWallSenseType === PROXIMATE)
      ? -1.0 : aThresholdRadius2;

    // @type {vec2} fWallRatios
    // Location of the wall along the x axis of the two near/far triangles.
    // The intersect of the wall with DE and GH determine the ratio.
    this.fWallRatios = vec2(0.0);
    const wallRay = Ray2d(wallTopMid, wallDir);
    const rayED = Ray2d(nearFarTri0[1], normalizedDirection(nearFarTri0[1], nearFarTri0[0]));
    const rayHG = Ray2d(nearFarTri1[1], normalizedDirection(nearFarTri1[1], nearFarTri1[0]));
    this.fWallRatios[0] = lineLineIntersection(rayED, wallRay); // T value
    this.fWallRatios[1] = lineLineIntersection(rayHG, wallRay);

    // @type {vec2} fFarRatios0   UMBRA and PENUMBRA
    // @type {vec2} fFarRatios1   UMBRA and PENUMBRA
    // For far shadows, if infinite, use, the infiniteShadowCanvasRay as the ending point.
    // Otherwise, use the penumbra canvas intersection based on the far direction (through midpoint).
    this.fFarRatios0 = vec2(-1.0);
    this.fFarRatios1 = vec2(-1.0);
    const canvasIx = vec3();
    if ( hasUmbraShadows[FAR] && !this.isInfiniteShadow(farShadowDirs.penumbra)
      && intersectRayPlane(Ray2d(wallTopMid, farShadowDirs.penumbra), this.canvasPlane, canvasIx) ) {
      this.fFarRatios0[PENUMBRA] = 0.0;
      this.fFarRatios1[PENUMBRA] = 0.0;
    }

    // For far umbra shadow, redo the shadow triangle to get the new E and H locations.
    const canvasFarUmbraIx = vec3();
    if ( !this.isInfiniteShadow(farShadowDirs.umbra)
      && intersectRayPlane(Ray(wallTopMid, farShadowDirs.umbra), this.canvasPlane, canvasFarUmbraIx) ) {
      const distDE = nearFarTri0[0].distance(nearFarTri0[1]);
      const distGH = nearFarTri1[0].distance(nearFarTri1[1]);
      const canvasFarUmbraRay = Ray2d(canvasFarUmbraIx, wallDir);
      const { DEF: umbraDEF, GHI: umbraGHI } = this.shadowTriangles(sideShadowRays, wall, canvasFarUmbraRay);
      this.fFarRatios0[UMBRA] = (distDE - umbraDEF[0].distance(umbraDEF[1])) / distDE;
      this.fFarRatios1[UMBRA] = (distGH - umbraGHI[0].distance(umbraGHI[1])) / distGH;
    }

    // @type {vec2} fNearRatios0   UMBRA and PENUMBRA
    // @type {vec2} fNearRatios1   UMBRA and PENUMBRA
    // For near shadows, move the wall at the midpoint.
    // The intersect of the wall with DE and GH determine the ratio.
    this.fNearRatios0 = vec2(-1.0);
    this.fNearRatios1 = vec2(-1.0);
    const canvasElevation = uElevationRes.x;
    if ( hasNearShadows ) {
      const wallBottomMid = wall.bottom[0].add(wall.bottom[1]).multiplyScalar(0.5);
      const canvasNearUmbraIx = vec3();
      const canvasNearPenumbraIx = vec3();
      if ( !this.isInfiniteShadow(nearShadowDirs.umbra)
        && intersectRayPlane(Ray(wallBottomMid, nearShadowDirs.penumbra), this.canvasPlane, canvasNearUmbraIx) ) {
        const umbraWallRay = Ray2d(canvasNearUmbraIx, wallDir);
        this.fNearRatios0[PENUMBRA] = lineLineIntersection(rayED, umbraWallRay);
        this.fNearRatios1[PENUMBRA] = lineLineIntersection(rayHG, umbraWallRay);
      }
      if ( !this.isInfiniteShadow(nearShadowDirs.penumbra)
        && intersectRayPlane(Ray(wallBottomMid, nearShadowDirs.umbra), this.canvasPlane, canvasNearPenumbraIx) ) {
        const penumbraWallRay = Ray2d(canvasNearPenumbraIx, wallDir);
        this.fNearRatios0[UMBRA] = lineLineIntersection(rayED, penumbraWallRay);
        this.fNearRatios1[UMBRA] = lineLineIntersection(rayHG, penumbraWallRay);
      }
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
    const orient = foundry.utils.orient2dFast;
    const abs = Math.abs;
    const baryForPoint = barycentric;

    // Defined constants.
    const vertexNum = gl_VertexID % 3;

    // Penumbra structures.
    // Defined by the subclass (Point or DirectionalLight):
    // - @type {Wall} wall
    // - @type {bvec2} hasSideShadows
    // - @type {vec2[3]} penumbraTri
    // - @type {bool} hasNearShadows
    // - @type {bvec2} hasUmbraShadows
    // If has respective side:
    // - @type {vec2[3]} sideTri0
    // - @type {vec2[3]} sideTri1
    const {
      wall,
      hasSideShadows,
      hasNearShadows,
      hasUmbraShadows,
      hasPenumbraShadows,
      sideShadowRays,
      farShadowDirs,
      nearShadowDirs } = this;

    const farPenumbraCanvasRay = Ray2d(vec2(), vec2());
    const hasFarPenumbra = this.canvasIntersectionRay(farShadowDirs.penumbra, sideShadowRays.penumbra,
      wall, farPenumbraCanvasRay);
    if ( !hasFarPenumbra ) this.hasPenumbraShadows[FAR] = false;

    const { ABC, DEF, GHI, sideTri0, sideTri1 } = this.shadowTriangles(sideShadowRays, wall, farPenumbraCanvasRay);
    const penumbraTri = this.penumbraTri = ABC;
    const nearFarTri0 = this.nearFarTri0 = DEF;
    const nearFarTri1 = this.nearFarTri1 = GHI;
    this.sideTri0 = sideTri0;
    this.sideTri1 = sideTri1;

    // Location of this vertex.
    // @type {vec2} vVertexPosition
    const vVertexPosition = this.vVertexPosition = penumbraTri[vertexNum];

    // Set barymetric coordinates for each corner of the triangle.
    // @type {vec3} vPenumbra
    this.vPenumbra = vec3(0.0);
    this.vPenumbra[vertexNum] = 1.0;

    // Define side triangles in relation to the penumbra triangle.
    // If no real side penumbra, set values to -1 to avoid inclusion.
    // Otherwise baryForPoint may return NaN if set to the midpenumbra for linked walls.
    // @type {vec3} vSidePenumbra0, vSidePenumbra1
    this.vSidePenumbra0 = vec3(-1.0);
    this.vSidePenumbra1 = vec3(-1.0);
    if ( this.hasSideShadows[0]
      && abs(orient(...this.sideTri0)) > 1.0 ) this.vSidePenumbra0 = baryForPoint(vVertexPosition, ...sideTri0);
    if ( this.hasSideShadows[1]
      && abs(orient(...this.sideTri1)) > 1.0 ) this.vSidePenumbra1 = baryForPoint(vVertexPosition, ...sideTri1);

    // Define the near/far triangles used to adjust the shadow for elevation.
    this.vNearFarPenumbra0 = vec3(-1.0);
    this.vNearFarPenumbra1 = vec3(-1.0);
    if ( abs(orient(...nearFarTri0)) > 1.0 ) this.vNearFarPenumbra0 = baryForPoint(vVertexPosition, ...nearFarTri0);
    if ( abs(orient(...nearFarTri1)) > 1.0 ) this.vNearFarPenumbra1 = baryForPoint(vVertexPosition, ...nearFarTri1);


    // Calculate the terrain texture coordinate at this vertex based on scene dimensions.
    // (vVertexPosition - uSceneDims.xy) / uSceneDims.zw
    // @type {vec2} vTerrainTexCoord
    this.vTerrainTexCoord = (vVertexPosition.subtract(uSceneDims.xy)).divide(uSceneDims.zw);

    // In shader:
    // gl_Position = vec4((projectionMatrix * translationMatrix * vec3(this.vVertexPosition, 1.0)).xy, 0.0, 1.0);

    // Finally, set the flat variables when we hit the last vertex for this triangle.
    if ( vertexNum === 2 ) {
      if ( hasUmbraShadows[FAR] ) hasUmbraShadows[FAR] = farShadowDirs.umbra.z < 0.0;
      if ( hasNearShadows && hasUmbraShadows[NEAR] ) hasUmbraShadows[NEAR] = nearShadowDirs.umbra.z < 0.0;
      this.calculateFlatVariables(penumbraTri, nearFarTri0, nearFarTri1, wall,
        farShadowDirs, nearShadowDirs, hasUmbraShadows, hasNearShadows, sideShadowRays);
    }

    // For debugging.
    return { varyings: this.varyings, flats: this.flats };
  }
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
    const { vNearFarPenumbra0, vNearFarPenumbra1, fWallRatios } = this;
    return (barycentricPointInsideTriangle(vNearFarPenumbra0) && vNearFarPenumbra0.x > fWallRatios[0])
      || (barycentricPointInsideTriangle(vNearFarPenumbra1) && vNearFarPenumbra1.x > fWallRatios[1]);
  }

  /**
   * Is the fragment location outside of a defined shadow?
   * @returns {bool}
   */
  outsideOfShadow() {
    const { vNearFarPenumbra0, vNearFarPenumbra1 } = this.varyings;
    return !(barycentricPointInsideTriangle(vNearFarPenumbra0)
          || barycentricPointInsideTriangle(vNearFarPenumbra1));
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
  inSidePenumbra1() { return barycentricPointInsideTriangle(this.vSidePenumbra1); }

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
    const { side0Shadow, side1Shadow,
      far0Shadow, far1Shadow,
      near0Shadow, near1Shadow,
      hasShadow } = this.shadowComponents(pt, elevation);

    let fragColor = this.noShadow();
    if ( !hasShadow ) return fragColor;
    const shadow = side0Shadow * side1Shadow * far0Shadow * far1Shadow * near0Shadow * near1Shadow;
    const totalLight = Math.clamp(0.0, 1.0, 1.0 - shadow);

    fragColor = this.lightEncoding(totalLight);
    return fragColor;
  }

  /**
   * For debugging
   * Determine the shadow components.
   */
  shadowComponents(pt, elevation = this.canvasElevation) {
    elevation = CONFIG.GeometryLib.utils.gridUnitsToPixels(elevation);
    const { uElevationRes } = this;

    // Set the flat variables
    this.vertexCalculations(2);

    // Define the placement of the fragment and calculate varying variables.
    this.vVertexPosition = vec2(pt.x, pt.y);
    this.setVaryings();

    // Retrieve the flat and varying variables.
    const { fWallHeights, fWallRatios, fFarRatios0, fFarRatios1, fNearRatios0, fNearRatios1 } = this.flats;
    const { vPenumbra, vSidePenumbra0, vSidePenumbra1, vNearFarPenumbra0, vNearFarPenumbra1 } = this.varyings;

    // GLSL only: let fragColor = this.noShadow();
    if ( this.thresholdApplies() ) return { hasShadow: false }; // GLSL only: return fragColor;
    if ( this.outsideOfShadow() ) return { hasShadow: false };  // GLSL only: return fragColor;
    if ( this.inFrontOfWall() ) return { hasShadow: false }; // GLSL only: return fragColor;

    // Determine whether in near, far, side0, or side1.
    let far0Shadow = 1.0;
    let far1Shadow = 1.0;
    let near0Shadow = 1.0;
    let near1Shadow = 1.0;
    let side0Shadow = 1.0;
    let side1Shadow = 1.0;

    const inNF0 = barycentricPointInsideTriangle(vNearFarPenumbra0);
    const inNF1 = barycentricPointInsideTriangle(vNearFarPenumbra1);
    const needsElevation = fFarRatios0[PENUMBRA] !== -1.0 || fFarRatios0[UMBRA] !== -1.0
                        || fFarRatios1[PENUMBRA] !== -1.0 || fFarRatios1[UMBRA] !== -1.0
                        || fNearRatios0[PENUMBRA] !== -1.0 || fNearRatios0[UMBRA] !== -1.0
                        || fNearRatios1[PENUMBRA] !== -1.0 || fNearRatios1[UMBRA] !== -1.0;

    const farRatios0 = vec2(fFarRatios0);
    const farRatios1 = vec2(fFarRatios1);
    const nearRatios0 = vec2(fNearRatios0);
    const nearRatios1 = vec2(fNearRatios1);

    if ( needsElevation ) {
      // Get the elevation at this fragment.
      const canvasElevation = uElevationRes.x;
      if ( elevation !== canvasElevation ) {
        const elevate = this._elevateShadowRatioUsingHeightFraction;
        const farF = this._elevationHeightFraction(elevation, fWallHeights[TOP]);
        const nearF= this._elevationHeightFraction(elevation, fWallHeights[BOTTOM]);
        if ( farRatios0[UMBRA] !== -1.0 ) farRatios0[UMBRA] = elevate(farRatios0[UMBRA], fWallRatios[0], farF);
        if ( farRatios1[UMBRA] !== -1.0 ) farRatios1[UMBRA] = elevate(farRatios1[UMBRA], fWallRatios[1], farF);
        if ( farRatios0[PENUMBRA] !== -1.0 ) farRatios0[PENUMBRA] = elevate(farRatios0[PENUMBRA], fWallRatios[0], farF);
        if ( farRatios1[PENUMBRA] !== -1.0 ) farRatios1[PENUMBRA] = elevate(farRatios1[PENUMBRA], fWallRatios[1], farF);
        if ( nearRatios0[UMBRA] !== -1.0 ) nearRatios0[UMBRA] = elevate(nearRatios0[UMBRA], fWallRatios[0], nearF);
        if ( nearRatios1[UMBRA] !== -1.0 ) nearRatios1[UMBRA] = elevate(nearRatios1[UMBRA], fWallRatios[1], nearF);
        if ( nearRatios0[PENUMBRA] !== -1.0 ) nearRatios0[PENUMBRA] = elevate(nearRatios0[PENUMBRA], fWallRatios[0], nearF);
        if ( nearRatios1[PENUMBRA] !== -1.0 ) nearRatios1[PENUMBRA] = elevate(nearRatios1[PENUMBRA], fWallRatios[1], nearF);
      }
    }

    // Determine the near/far penumbra inclusion.
    const inFarPenumbra0 = inNF0 && between(farRatios0[PENUMBRA], farRatios0[UMBRA], vNearFarPenumbra0.x);
    const inFarPenumbra1 = inNF1 && between(farRatios1[PENUMBRA], farRatios1[UMBRA], vNearFarPenumbra1.x);
    const inNearPenumbra0 = inNF0 && between(nearRatios0[PENUMBRA], nearRatios0[UMBRA], vNearFarPenumbra0.x);
    const inNearPenumbra1 = inNF1 && between(nearRatios1[PENUMBRA], nearRatios1[UMBRA], vNearFarPenumbra1.x);

    if ( inFarPenumbra0 ) far0Shadow = linearConversion(vNearFarPenumbra0.x, farRatios0[PENUMBRA], farRatios0[UMBRA], 0.0, 1.0);
    if ( inFarPenumbra0 ) far1Shadow = linearConversion(vNearFarPenumbra1.x, farRatios1[PENUMBRA], farRatios1[UMBRA], 0.0, 1.0);
    if ( inNearPenumbra1 ) near0Shadow = linearConversion(vNearFarPenumbra0.x, nearRatios0[PENUMBRA], nearRatios0[UMBRA], 0.0, 1.0);
    if ( inNearPenumbra1 ) near1Shadow = linearConversion(vNearFarPenumbra1.x, nearRatios1[PENUMBRA], nearRatios1[UMBRA], 0.0, 1.0);

    // Blend the two side penumbras if overlapping by multiplying the light amounts.
    if ( this.inSidePenumbra0() ) side0Shadow = vSidePenumbra0.z / (vSidePenumbra0.y + vSidePenumbra0.z);
    if ( this.inSidePenumbra1() ) side1Shadow = vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z);

    return { side0Shadow, side1Shadow, far0Shadow, far1Shadow, near0Shadow, near1Shadow, hasShadow: true };
  }

  // ----- NOTE: Drawing ----- //

  drawWall() { Draw.segment({ a: this.wall.top[0], b: this.wall.top[1] }); }

  drawLight() { Draw.point(this.light.center, { radius: this.uLightSize, color: Draw.COLORS.yellow }); }

  drawSidePenumbraDirections(dist = canvas.dimensions.maxR) {
    const { sideShadowDirs, wall } = this;
    const COLOR_KEYS = {
      umbra: Draw.COLORS.red,
      midpenumbra: Draw.COLORS.orange,
      penumbra: Draw.COLORS.yellow
    };

    // Draw all the way to the light.
    if ( this.light ) {
      for ( const [key, color] of Object.entries(COLOR_KEYS) ) {
        for ( let i = 0; i < 2; i += 1 ) {
          const endpoint = this.light[key] ? this.light[key][i] : this.light.center;
          const penumbraPt = endpoint.add(sideShadowDirs[i][key].xy.normalize().multiplyScalar(dist));
          Draw.segment({ a: endpoint, b: penumbraPt }, { color, alpha: 0.5 });
        }
      }
    }

    for ( const [key, color] of Object.entries(COLOR_KEYS) ) {
      for ( let i = 0; i < 2; i += 1 ) {
        const endpoint = wall.top[i].xy;
        const penumbraPt = endpoint.add(sideShadowDirs[i][key].xy.normalize().multiplyScalar(dist));
        Draw.segment({ a: endpoint, b: penumbraPt }, { color });
      }
    }
  }

  drawPenumbraTriangle() {
    const tri = this.penumbraTri;
    const poly = new PIXI.Polygon(...tri);
    Draw.shape(poly);
  }

  drawSideTriangle(idx = 0) {
    const tri = [this.sideTri0, this.sideTri1][idx];
    const poly = new PIXI.Polygon(...tri);
    const color = [Draw.COLORS.blue, Draw.COLORS.green][idx];
    Draw.shape(poly, { color });
  }
}

/**
 * Based on ShadowWallShader.
 * Represents a single wall calculation.
 * 3 vertices: light, ix for corner 1, ix for corner 2.
 * Light size is 0; no penumbra.
 */
export class UnsizedPointSourceShadowWallVertexShaderTest2 extends ShadowWallVertexShaderTest2 {

  /* ----- NOTE: Uniforms ----- */

  /** @type {vec3} */
  get uLightPosition() { return vec3(...this.uniforms.uLightPosition); }

  /** @type {float} */
  get uLightSize() { return 0; }

  /* ----- NOTE: Vertex calculations ----- */

  /**
   * The rays from the wall endpoint along the side.
   * All at midpenumbra b/c no side shadow.
   * @param {int} idx  Which wall endpoint corresponds to this shadow
   * @param {Wall} wall
   * @returns {ShadowDirections2d} Direction from the endpoint away from the light for umbra, mid, and penumbra.
   */
  calculateSideShadowRays(wall) {
    const { uLightPosition } = this;
    const wall0 = wall.top[0].xy;
    const wall1 = wall.top[1].xy;
    const midpenumbra = [
      Ray2d(wall0, normalizedDirection(uLightPosition.xy, wall0)),
      Ray2d(wall1, normalizedDirection(uLightPosition.xy, wall1))
    ];
    return ShadowRays2d({
      umbra: midpenumbra,
      midpenumbra,
      penumbra: midpenumbra
    });
  }

  /**
   * Direction toward the wall middle, used to measure far umbra line.
   * @param {Wall} wall
   * @param {Light} light
   * @returns {ShadowDirection}
   */
  calculateFarShadowDirections(wall) {
    const { uLightPosition } = this;

    const wall0 = wall.top[0];
    const wall1 = wall.top[1];
    const wallMid = wall0.add(wall1).multiplyScalar(0.5);
    const dir = normalizedDirection(uLightPosition, wallMid);
    return ShadowDirections({
      umbra: dir,
      midpenumbra: dir,
      penumbra: dir
    });
  }

  /**
   * Direction toward the wall middle, used to measure near umbra line.
   * @param {Wall} wall
   * @param {Light} light
   * @returns {ShadowDirections}
   */
  calculateNearShadowDirections(wall) {
    const { uLightPosition } = this;

    const wall0 = wall.bottom[0];
    const wall1 = wall.bottom[1];
    const wallMid = wall0.add(wall1).multiplyScalar(0.5);
    const dir = normalizedDirection(uLightPosition, wallMid);
    return ShadowDirections({
      umbra: dir,
      midpenumbra: dir,
      penumbra: dir
    });
  }

  /**
   * Calculate the penumbra triangle
   * @param {Wall} wall
   * @param {ShadowDirections2d[2]} sideShadowDirs
   * @param {ShadowDirections} farShadowDirs
   * @returns {vec2[3]}
   */
  calculatePenumbraTriangle(wall, sideShadowDirs, farShadowDirs) {
    const { uLightPosition } = this;

    // Intersect the penumbra rays with the line parallel to the wall at the canvas intersection.
    const farRay = this.shadowNearFarRay(wall, farShadowDirs.penumbra, FAR);
    const ix0 = vec2();
    const ix1 = vec2();
    lineLineIntersection(farRay, Ray2d(uLightPosition.xy, sideShadowDirs[0].penumbra), ix0);
    lineLineIntersection(farRay, Ray2d(uLightPosition.xy, sideShadowDirs[1].penumbra), ix1);
    return [
      uLightPosition.xy,
      ix0,
      ix1
    ];
  }

  /**
   * Mimic calculations done in the vertex shader.
   */
  vertexCalculations(gl_VertexID = 0) {
    const wall = this.wall = this.calculateWallPositions();

    // Near/far shadows.
    this.hasUmbraShadows = vec2(false, false); // @type bvec2 for FAR, NEAR.
    this.hasPenumbraShadows = vec2(false, false); // @type bvec2 for FAR, NEAR.
    const farShadowDirs = this.farShadowDirs = this.calculateFarShadowDirections(wall);
    this.nearShadowDirs = ShadowDirections();
    this.hasNearShadows = this.wallIsFloating;
    if ( this.hasNearShadows ) this.nearShadowDirs = this.calculateNearShadowDirections(wall);


    // Side shadows.
    this.hasSideShadows = vec2(false, false); // @type bvec2 for 0, 1.
    const sideShadowRays = this.sideShadowRays = this.calculateSideShadowRays(wall);

    return super.vertexCalculations(gl_VertexID, wall);
  }

}

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
  get uLightSize() { return this.uniforms.uLightSize ?? 1; }

  /* ----- NOTE: Getters ----- */


  // ----- NOTE: Uniform variables ----- //

  calculateLightPositions(wall) {
    const orient = foundry.utils.orient2dFast;
    const { uLightSize, uLightPosition} = this;

    // Wall data.
    const wall0 = wall.top[0].xy;
    const wall1 = wall.top[1].xy;
    const wallMid = wall0.add(wall1).multiplyScalar(0.5);
    const wallDir = normalizedDirection(wall0, wall1);

    // For each wall endpoint, determine the left and right tangents to the light circle (sphere).
    const lightCir = Circle({
      center: uLightPosition.xy,
      radius: uLightSize
    });
    const lr0 = lightCir.center.subtract(wallDir.multiplyScalar(lightCir.radius));
    const lr1 = lightCir.center.subtract(wallDir.multiplyScalar(lightCir.radius));

    const tangents0 = [lightCir.center, lightCir.center];
    const tangents1 = [lightCir.center, lightCir.center];
    tangentPoints(lightCir, wall0, tangents0);
    tangentPoints(lightCir, wall1, tangents1);

    // If any tangent point is on the wrong side of the wall, replace with the lr0 or lr1.
    // Occurs if the light is very close to the wall.
    //     const oLight = orient(wall0, wall1, uLightPosition.xy);
    //     for ( let i = 0; i < 2; i += 1 ) {
    //       if ( orient(wall0, wall1, tangents0[i]) * oLight < 0.0 ) continue;
    //       tangents0[i] = distanceSquared(tangents0[i], lr0) < distanceSquared(tangents0[i], lr1)
    //         ? lr0 : lr1;
    //     }
    //     for ( let i = 0; i < 2; i += 1 ) {
    //       if ( orient(wall0, wall1, tangents1[i]) * oLight < 0.0 ) continue;
    //       tangents1[i] = distanceSquared(tangents1[i], lr0) < distanceSquared(tangents1[i], lr1)
    //         ? lr0 : lr1;
    //     }

    // Tangents0 are the points on either side of the circle that are tangent to wall0.
    // Tangents1 are the points on either side of the circle that are tangent to wall1.
    // Need the tangents on the same side of the circle. These are close to each other.
    const dist00 = tangents0[0].distanceSquared(tangents1[0]);
    const dist01 = tangents0[0].distanceSquared(tangents1[1]);
    const tangentGroup0 = [tangents0[0], tangents1[0]];
    const tangentGroup1 = [tangents0[1], tangents1[1]];
    if ( dist00 > dist01 ) {
      tangentGroup0[1] = tangents1[1];
      tangentGroup1[1] = tangents1[0];
    }

    // Determine which side the tangents are on. Penumbra: cross; umbra: same.
    // Penumbra and umbra switch when the wall is nearly vertical.
    // The penumbra is on the same side as the light when compared to the umbra.
    const penumbra = Array(2);
    const umbra = Array(2);
    for ( let i = 0; i < 2; i += 1 ) {
      // Get the tangents on the same side of the circle
      const t = i === 1 ? tangentGroup1 : tangentGroup0;
      const w = i === 1 ? wall1 : wall0;
      const dir0 = normalizedDirection(t[0], w);
      const dir1 = normalizedDirection(t[1], w);
      const pt0 = t[0].add(dir0);
      const pt1 = t[1].add(dir1);
      const oLight = orient(t[0], pt0, lightCir.center);
      const o1 = orient(t[0], pt0, pt1);
      const j = oLight * o1 > 0 ? 0 : 1;


      penumbra[i] = t[j]; // Normal: penumbra is 0, umbra is 1. Reversed: penumbra is 1, umbra is 0.
      umbra[i] = t[1 - j];
    }

    // Form a cross based on the light center.
    const top = uLightPosition.z + uLightSize;
    const bottom = uLightPosition.z - uLightSize;
    return Light({
      top: vec3(lightCir.center, top),
      center: uLightPosition,
      bottom: vec3(lightCir.center, bottom),
      penumbra,   // Tangent furthest from endpoint (crosses center)
      umbra // Tangent nearest to endpoint
    });
  }

  /* ----- NOTE: Vertex calculations ----- */

  /**
   * Direction toward the wall middle, used to measure far umbra line.
   * @param {Wall} wall
   * @param {Light} light
   * @returns {ShadowDirections}
   */
  calculateFarShadowDirections(wall, light) {
    const wallMid = wall.top[0].add(wall.top[1]).multiplyScalar(0.5);
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
  calculateNearShadowDirections(wall, light) {
    const wallMid = wall.bottom[0].add(wall.bottom[1]).multiplyScalar(0.5);
    return ShadowDirections({
      umbra: normalizedDirection(light.bottom, wallMid),
      midpenumbra: normalizedDirection(light.center, wallMid),
      penumbra: normalizedDirection(light.top, wallMid)
    });
  }

  /**
   * Direction from light --> wall endpoint. Origin at the wall endpoint.
   * @param {int} idx     Which wall endpoint corresponds to this shadow
   * @param {Wall} wall
   * @param {Light} light
   * @returns {ShadowRays2d} Rays from the endpoint away from the light for umbra, mid, and penumbra.
   */
  calculateSideShadowRays(wall, light) {
    const { uLightSize } = this;

    // Wall data.
    const wall0 = wall.top[0].xy;
    const wall1 = wall.top[1].xy;
    const wallMid = wall0.add(wall1).multiplyScalar(0.5);
    const wallDir = normalizedDirection(wall0, wall1);

    // First determine the tangent points of the circle.
    const lightCir = Circle({
      center: light.center.xy,
      radius: uLightSize
    });
    const tangents0 = [lightCir.center, lightCir.center];
    const tangents1 = [lightCir.center, lightCir.center];
    tangentPoints(lightCir, wall0, tangents0);
    tangentPoints(lightCir, wall1, tangents1);

    // Build the rays for each tangent to associate them with the correct wall point.
    const tangentRays0 = [
      Ray2d(wall0, normalizedDirection(tangents0[0], wall0)),
      Ray2d(wall0, normalizedDirection(tangents0[1], wall0)),
    ];
    const tangentRays1 = [
      Ray2d(wall1, normalizedDirection(tangents1[0], wall1)),
      Ray2d(wall1, normalizedDirection(tangents1[1], wall1)),
    ];

    // Tangents0 are the points on either side of the circle that are tangent to wall0.
    // Tangents1 are the points on either side of the circle that are tangent to wall1.
    // Need the tangents on the same side of the circle. These are close to each other.
    const dist00 = tangents0[0].distanceSquared(tangents1[0]);
    const dist01 = tangents0[0].distanceSquared(tangents1[1]);
    const tangentGroupA = [tangentRays0[0], tangentRays1[0]]; // A[0] is wall0, A[1] is wall1.
    const tangentGroupB = [tangentRays0[1], tangentRays1[1]];
    if ( dist00 > dist01 ) {
      tangentGroupA[1] = tangentRays1[1];
      tangentGroupB[1] = tangentRays1[0];
    }

    // Determine which side the tangents are on. Penumbra: cross; umbra: same.
    // Penumbra and umbra switch when the wall is nearly vertical.
    // Penumbra form the intersection closest to the light
    const penumbra = Array(2);
    const umbra = Array(2);
    let minD = Math.max(wall0.distanceSquared(light.center.xy), wall1.distanceSquared(light.center.xy));
    for ( let i = 0; i < 2; i += 1 ) {
      for ( let j = 0; j < 2; j += 1 ) {
        const ix = vec2();
        if ( lineLineIntersection(tangentGroupA[i], tangentGroupB[j], ix) ) {
          const d = ix.distanceSquared(light.center.xy);
          if ( d > minD ) continue;
          minD = d;
          penumbra[0] = tangentGroupA[i];
          penumbra[1] = tangentGroupB[j];
          umbra[0] = tangentGroupA[1 - i];
          umbra[1] = tangentGroupB[1 - j];
        }
      }
    }

    const midpenumbra = [
      Ray2d(wall0, normalizedDirection(light.center.xy, wall0)),
      Ray2d(wall1, normalizedDirection(light.center.xy, wall1)),
    ];
    return ShadowRays2d({
      umbra,
      midpenumbra,
      penumbra
    });
  }

  /**
   * Mimic calculations done in the vertex shader.
   */
  vertexCalculations(gl_VertexID = 0) {
    const wall = this.wall = this.calculateWallPositions();
    const light = this.light = this.calculateLightPositions(wall);

    // Near/far shadows.
    this.hasUmbraShadows = vec2(true, true); // @type bvec2 for FAR, NEAR.
    this.hasPenumbraShadows = vec2(true, true); // @type bvec2 for FAR, NEAR.
    if ( !this.wallIsFloating ) {
      this.hasUmbraShadows[NEAR] = false;
      this.hasPenumbraShadows[NEAR] = false;
    }
    const farShadowDirs = this.farShadowDirs = this.calculateFarShadowDirections(wall, light);
    this.nearShadowDirs = ShadowDirections();
    this.hasNearShadows = this.wallIsFloating;
    if ( this.hasNearShadows ) this.nearShadowDirs = this.calculateNearShadowDirections(wall, light);

    // Side shadows.
    this.hasSideShadows = vec2(true, true); // @type bvec2 for 0, 1.
    const sideShadowRays = this.sideShadowRays = this.calculateSideShadowRays(wall, light);

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

  /* ----- NOTE: Uniforms ----- */

  /** @type {float<radians>} */
  get uAzimuth() { return this.uniforms.uAzimuth ?? 0; }

  /** @type {float<radians>} */
  get uSolarAngle() { return this.uniforms.uSolarAngle ?? 0; }

  // ----- NOTE: Getters ----- //

  /** @type {float} */
  // TODO: Cannot currently go all the way to 0.
  get solarAngle() { return Math.max(0.1, this.uSolarAngle); }

  /* ----- NOTE: Vertex calculations ----- */

  /**
   * Calculate the penumbra triangle.
   * @param {Wall} wall
   * @param {sideShadowRays} sideShadowRays
   * @param {ShadowDirections} farShadowDirs
   * @returns {vec2[3]}
   */
  calculatePenumbraTriangle(wall, sideShadowRays, farShadowDirs) {
    // The penumbra 0 vertex is the point at which the penumbra rays cross.
    const v0 = vec2();
    lineLineIntersection(
      Ray2d(wall.top[0].xy, sideShadowRays.penumbra[0]),
      Ray2d(wall.top[1].xy, sideShadowRays.penumbra[1]),
      v0);

    // Intersect the penumbra rays with the line parallel to the wall at the canvas intersection.
    const farRay = this.shadowNearFarRay(wall, farShadowDirs.penumbra, FAR);
    const ix0 = vec2();
    const ix1 = vec2();
    lineLineIntersection(farRay, Ray2d(v0, sideShadowRays.penumbra[0]), ix0);
    lineLineIntersection(farRay, Ray2d(v0, sideShadowRays.penumbra[1]), ix1);
    return [
      v0,
      ix0,
      ix1
    ];
  }

  /**
   * Calculate the side triangle.
   * @param {int} idx
   * @param {vec2[3]} penumbraTri
   * @param {Wall} wall
   * @param {ShadowDirections2d[2]} sideShadowDirs
   * @param {ShadowDirections} farShadowDirs
   * @returns {vec2[3]}
   */
  calculateSideTriangle(idx, penumbraTri, wall, sideShadowDirs, farShadowDirs) {
    // For directional lights, the 0 vertex is at the wall endpoint.
    const v0 = wall.top[idx].xy;

    // Intersect the umbra ray with the line parallel to the wall at the canvas intersection.
    const farRay = this.shadowNearFarRay(wall, farShadowDirs.umbra, FAR);
    const ix = vec2();
    lineLineIntersection(farRay, Ray2d(v0, sideShadowDirs[idx].umbra), ix);
    return [
      v0,
      ix,
      penumbraTri[idx + 1] // The penumbra canvas intersection for endpoint 0 or 1.
    ];
  }

  /* ----- NOTE: Penumbras ----- */

  /**
   * The rays from the wall endpoint along the side.
   * @param {int} idx     Which wall endpoint corresponds to this shadow
   * @param {Wall} wall
   * @returns {ShadowDirections2d} Direction from the endpoint away from the light for umbra, mid, and penumbra.
   */
  calculateSideShadowDirections(idx, wall) {
    const orient = foundry.utils.orient2dFast;
    const sign = Math.sign;
    const { uAzimuth, uElevationAngle } = this.uniforms;
    const { solarAngle } = this;

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
   * Direction toward the wall middle, used to measure far umbra line.
   * @returns {ShadowDirections}
   */
  calculateFarShadowDirections() {
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

    const zDelta = this._calculateZChangeRays();
    const dirMid = fromAngle(vec2(0.0), uAzimuth, 1.0).multiplyScalar(-1.0);
    return ShadowDirections({
      umbra: vec3(dirMid, zDelta[PENUMBRA]).normalize(),
      midpenumbra: vec3(dirMid, zDelta[MIDPENUMBRA]).normalize(),
      penumbra: vec3(dirMid, zDelta[UMBRA]).normalize()
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
    const wall = this.wall = this.calculateWallPositions();
    const wall0 = wall.top[0].xy;
    const wall1 = wall.top[1].xy;

    // Near/far shadows.
    this.hasUmbraShadows = vec2(true, true); // @type bvec2 for FAR, NEAR.
    this.hasPenumbraShadows = vec2(true, true); // @type bvec2 for FAR, NEAR.
    if ( !this.wallIsFloating ) {
      this.hasUmbraShadows[NEAR] = false;
      this.hasPenumbraShadows[NEAR] = false;
    }
    const farShadowDirs = this.farShadowDirs = this.calculateFarShadowDirections(wall);
    this.nearShadowDirs = ShadowDirections();
    this.hasNearShadows = this.wallIsFloating;
    if ( this.hasNearShadows ) this.nearShadowDirs = this.calculateNearShadowDirections(wall);

    // Side shadows.
    this.hasSideShadows = vec2(true, true); // @type bvec2 for 0, 1.
    const sideShadowDirs0 = this.calculateSideShadowDirections(0, wall);
    const sideShadowDirs1 = this.calculateSideShadowDirections(1, wall);
    const sideShadowRays = this.sideShadowRays = ShadowRays2d({
      umbra: [
        Ray2d(wall0, sideShadowDirs0.umbra),
        Ray2d(wall1, sideShadowDirs1.umbra)
      ],
      midpenumbra: [
        Ray2d(wall0, sideShadowDirs0.midpenumbra),
        Ray2d(wall1, sideShadowDirs1.midpenumbra)
      ],
      penumbra: [
        Ray2d(wall0, sideShadowDirs0.penumbra),
        Ray2d(wall1, sideShadowDirs1.penumbra)
      ]
    });

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

/* Testing sized light
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
let { vec2, vec3, vec4 } = api.testing.glsl_mock
Ray2d = api.testing.glsl_mock.Ray2d
normalizedDirection = api.testing.glsl_mock.normalizedDirection
lli = api.testing.glsl_mock.lineLineIntersection
let {
  SizedPointSourceShadowWallVertexShaderTest2,
  DirectionalSourceShadowWallVertexShaderTest2 } = api.testing
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
let [shader0] = SizedPointSourceShadowWallVertexShaderTest2.fromMesh(ev.shadowMesh)
shader0.vertexCalculations(2)

shader0.drawWall()
shader0.drawLight()

res = shader0.shadowTriangles()

shader0.drawLight()
wall = shader0.wall
w0 = wall.top[0].xy;
Draw.segment({a: wall.top[0], b: wall.top[1]}, { width: 3 })

Draw.shape(new PIXI.Polygon(...res.ABC))
Draw.shape(new PIXI.Polygon(...res.DEF), { color: Draw.COLORS.orange })
Draw.shape(new PIXI.Polygon(...res.GHI), { color: Draw.COLORS.red })
Draw.shape(new PIXI.Polygon(...res.sideTri0), { color: Draw.COLORS.lightorange, width: 2 })
Draw.shape(new PIXI.Polygon(...res.sideTri1), { color: Draw.COLORS.lightred, width: 2 })



*/

/* Testing
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
let { vec2, vec3, vec4 } = api.testing.glsl_mock
Ray2d = api.testing.glsl_mock.Ray2d
normalizedDirection = api.testing.glsl_mock.normalizedDirection
lli = api.testing.glsl_mock.lineLineIntersection
function drawRay(ray, { dist = canvas.dimensions.maxR, color = Draw.COLORS.blue } = {}) {
  Draw.segment({ a: ray.origin, b: ray.origin.add(ray.direction.multiplyScalar(dist))}, { color })
}

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
FAR = 0
NEAR = 1

let [shader0, shader1] = SizedPointSourceShadowWallVertexShaderTest2.fromMesh(ev.shadowMesh)
let [shader2, shader3] = SizedPointSourceShadowWallVertexShaderTest2.fromMesh(ev.shadowMesh)
let [shader4, shader5] = SizedPointSourceShadowWallVertexShaderTest2.fromMesh(ev.shadowMesh)

// Set alt shaders to elevation 0 to compare with changing ratios
shader2.uniforms.uElevationRes[0] = 0
shader3.uniforms.uElevationRes[0] = 0

shader2.uniforms.uElevationRes[0] = -999
shader4.uniforms.uElevationRes[0] = -998

// See multiple tangents
for ( const s in [25, 50, 75, 100] ) {
  shader0.uniforms.uLightSize = s;
  shader0.vertexCalculations(2)
  shader0.drawWall()
  Draw.point(shader0.wall.top[0])
  Draw.point(shader0.light.umbra[0], { color: Draw.COLORS.lightred, radius: 2 })
  Draw.point(shader0.light.penumbra[0], { color: Draw.COLORS.lightgreen, radius: 2 })
  Draw.point(shader0.light.umbra[1], { color: Draw.COLORS.red, radius: 2 })
  Draw.point(shader0.light.penumbra[1], { color: Draw.COLORS.green, radius: 2 })
  shader0.drawSidePenumbraDirections()
}
// Tangents connected to center by a curve. Define a circle by the 3 points.


shader0.vertexCalculations(2)
shader0.drawWall()
shader0.drawLight()
Draw.point(shader0.wall.top[0])
Draw.point(shader0.light.umbra[0], { color: Draw.COLORS.lightred, radius: 2 })
Draw.point(shader0.light.penumbra[0], { color: Draw.COLORS.lightgreen, radius: 2 })
Draw.point(shader0.light.umbra[1], { color: Draw.COLORS.red, radius: 2 })
Draw.point(shader0.light.penumbra[1], { color: Draw.COLORS.green, radius: 2 })
shader0.drawSidePenumbraDirections()

wall = shader0.wall
penumbraLightRays = [
  Ray2d(wall.top[0].xy, shader0.sideShadowDirs[0].penumbra),
  Ray2d(wall.top[1].xy, shader0.sideShadowDirs[1].penumbra)
]
umbraLightRays = [
  Ray2d(wall.top[0].xy, shader0.sideShadowDirs[0].umbra),
  Ray2d(wall.top[1].xy, shader0.sideShadowDirs[1].umbra)
]

ixs = shader0.infiniteShadowEndpoints(penumbraLightRays, shader0.wall)
Draw.segment({a: ixs[0], b: ixs[1]}, { color: Draw.COLORS.red, width: 2 })

function drawRay(ray, { dist = canvas.dimensions.maxR, color = Draw.COLORS.blue } = {}) {
  Draw.segment({ a: ray.origin, b: ray.origin.add(ray.direction.multiplyScalar(dist))}, { color })
}
res = shader0.infiniteShadowTriangles()

shader0.drawLight()
wall = shader0.wall
w0 = wall.top[0].xy;
Draw.segment({a: wall.top[0], b: wall.top[1]}, { width: 3 })

Draw.shape(new PIXI.Polygon(...res.ABC))
Draw.shape(new PIXI.Polygon(...res.DEF), { color: Draw.COLORS.orange })
Draw.shape(new PIXI.Polygon(...res.GHI), { color: Draw.COLORS.red })
Draw.shape(new PIXI.Polygon(...res.sideTri0), { color: Draw.COLORS.lightorange, width: 2 })
Draw.shape(new PIXI.Polygon(...res.sideTri1), { color: Draw.COLORS.lightred, width: 2 })

drawRay(res.rAB)
drawRay(res.rAC)
Draw.point(res.ABC[0], { color: Draw.COLORS.blue });

// drawRay(res.rD_penumbra, { color: Draw.COLORS.yellow})
drawRay(res.rD_umbra, { color: Draw.COLORS.orange})
// drawRay(res.rG_penumbra, { color: Draw.COLORS.white})
drawRay(res.rG_umbra, { color: Draw.COLORS.red})

Draw.point(res.ABC[0], { color: Draw.COLORS.blue})
Draw.point(res.ABC[1], { color: Draw.COLORS.blue})
Draw.point(res.ABC[2], { color: Draw.COLORS.blue})
Draw.point(res.DEF[0], { color: Draw.COLORS.orange})
Draw.point(res.DEF[1], { color: Draw.COLORS.orange})
Draw.point(res.DEF[2], { color: Draw.COLORS.orange})
Draw.point(res.GHI[0], { color: Draw.COLORS.red})
Draw.point(res.GHI[1], { color: Draw.COLORS.red})
Draw.point(res.GHI[2], { color: Draw.COLORS.red})

Draw.segment({a: res.D, b: res.E}, { color: Draw.COLORS.orange })
Draw.segment({a: res.D, b: res.F}, { color: Draw.COLORS.orange })
Draw.segment({a: res.E, b: res.F}, { color: Draw.COLORS.orange })

drawRay(Ray2d(res.D, res.rDW0.direction), { color: Draw.COLORS.orange })
drawRay(Ray2d(res.D, res.rDW1.direction), { color: Draw.COLORS.orange })
drawRay(Ray2d(res.G, res.rGW0.direction), { color: Draw.COLORS.green })
drawRay(Ray2d(res.G, res.rGW1.direction), { color: Draw.COLORS.green })

Draw.segment({})

shader0.drawPenumbraTriangle()
shader0.drawSideTriangle(0)
shader0.drawSideTriangle(1)

shader1.vertexCalculations(2)
shader1.drawWall()
shader1.drawLight()

shader1.drawPenumbraTriangle()
shader1.drawSideTriangle(0)
shader1.drawSideTriangle(1)
shader1.drawAdjustedSidePenumbraDirections()
*/

/* Directional light
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
FAR = 0
NEAR = 1

let [shader0, shader1] = DirectionalSourceShadowWallVertexShaderTest2.fromMesh(ev.shadowMesh)
let [shader2, shader3] = DirectionalSourceShadowWallVertexShaderTest2.fromMesh(ev.shadowMesh)

// Set alt shaders to elevation 0 to compare with changing ratios
shader2.uniforms.uElevationRes[0] = 0
shader3.uniforms.uElevationRes[0] = 0

shader2.uniforms.uElevationRes[0] = -999
shader4.uniforms.uElevationRes[0] = -998

shader0.vertexCalculations(2)
shader0.drawWall()

shader0.drawSidePenumbraDirections()
shader0.drawPenumbraTriangle()
shader0.drawSideTriangle(0)
shader0.drawSideTriangle(1)


shader1.vertexCalculations(2)
shader1.drawWall()
shader1.drawLight()

shader1.drawPenumbraTriangle()
shader1.drawSideTriangle(0)
shader1.drawSideTriangle(1)
shader1.drawAdjustedSidePenumbraDirection(0)
shader1.drawAdjustedSidePenumbraDirection(1)
*/

/* Token vision
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
let { vec2, vec3, vec4 } = api.testing.glsl_mock
let {
  UnsizedPointSourceShadowWallVertexShaderTest2,
  SizedPointSourceShadowWallVertexShaderTest2,
  DirectionalSourceShadowWallVertexShaderTest2 } = api.testing

edge0 = canvas.walls.placeables[0].edge
edge1 = canvas.walls.placeables[1].edge
ev = _token.vision.elevatedvision
UMBRA = 0;
MIDPENUMBRA = 2;
PENUMBRA = 1;
TOP = 0
BOTTOM = 1
FAR = 0
NEAR = 1

let [shader0, shader1] = UnsizedPointSourceShadowWallVertexShaderTest2.fromMesh(ev.shadowMesh)
let [shader2, shader3] = UnsizedPointSourceShadowWallVertexShaderTest2.fromMesh(ev.shadowMesh)

// Set alt shaders to elevation 0 to compare with changing ratios
shader2.uniforms.uElevationRes[0] = 0
shader3.uniforms.uElevationRes[0] = 0

shader0.vertexCalculations(2)
shader0.drawWall()
shader0.drawPenumbraTriangle()


shader1.vertexCalculations(2)
shader1.drawWall()
shader1.drawLight()

shader1.drawPenumbraTriangle()
shader1.drawSideTriangle(0)
shader1.drawSideTriangle(1)
shader1.drawAdjustedSidePenumbraDirections()


*/


/*
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

/* Geometry
Point3d = CONFIG.GeometryLib.threeD.Point3d;
Draw = CONFIG.GeometryLib.Draw
Plane = CONFIG.GeometryLib.threeD.Plane
canvasPlane = new Plane()

// https://en.wikipedia.org/wiki/Tangent_lines_to_circles
function tangentPoints(circle, p) {
  const r = circle.radius;
  const r2 = Math.pow(r, 2);

  // Translate so origin is at circle center.
  const p0 = PIXI.Point._tmp.copyFrom(p.subtract(circle));
  let out = Array(2);
  if ( !p0.y ) {
    // Translated point is on the x-axis of the circle.
    if ( abs(p0.x).almostEqual(r) ) return [p, p]; // On circle edge.
    if ( abs(p0.x) < r ) return null; // Inside the circle.

    const root = Math.sqrt(Math.pow(p0.x, 2) - r2); // {p0.x, r}.magnitude()
    out[0] = new PIXI.Point(r2 / p0.x, r/p0.x);
    out[1] = new PIXI.Point(out[0].x, out[0].y);
    out[0].y *= root;
    out[1].y *= -root;
  } else {
    const d0 = p0.magnitude();
    if ( d0.almostEqual(r) ) return [p, p]; // On circle edge.
    if ( d0 < r ) return null; // Inside the circle.
    const d2 = p0.magnitudeSquared(); // Same as Math.pow(d0, 2).
    const root = Math.sqrt(d2 - r2);
    const r2_d2 = r2/d2;
    const r_d2_root = r/d2 * root;
    out[0] = new PIXI.Point(r2_d2 * p0.x, r2_d2 * p0.y);
    out[1] = new PIXI.Point(out[0].x, out[0].y);

    const xAdder = r_d2_root * -p0.y;
    const yAdder = r_d2_root * p0.x;
    out[0].x += r_d2_root * -p0.y;
    out[0].y += r_d2_root * p0.x;
    out[1].x -= r_d2_root * -p0.y;
    out[1].y -= r_d2_root * p0.x;
  }

  // Translate back.
  return out.map(pt => pt.add(circle, pt));
}

function normalizedDirection(p0, p1) { return p1.subtract(p0).normalize(); }

lightCenter = new Point3d(1000, 2000, 800)
lightRadius = 50
light = new PIXI.Circle(lightCenter.x, lightCenter.y, lightRadius)

wall = {
  top: [new Point3d(800, 2000, 400), new Point3d(900, 2100, 400)],
  bottom: [new Point3d(800, 2000, 100), new Point3d(900, 2100, 100)],
}

wall = {
  top: [new Point3d(700, 1990, 400), new Point3d(800, 2010, 400)],
  bottom: [new Point3d(700, 1990, 100), new Point3d(800, 2010, 100)],
}

wall = {
  top: [new Point3d(700, 1999, 400), new Point3d(800, 2001, 400)],
  bottom: [new Point3d(700, 1999, 100), new Point3d(800, 2001, 100)],
}

tangents0 = tangentPoints(light, wall.top[0])
tangents1 = tangentPoints(light, wall.top[1])

Draw.shape(circle)
Draw.segment({ a: wall.top[0], b: wall.top[1] }, { width: 2})

Draw.point(tangents0[0], { color: Draw.COLORS.lightgreen, radius: 1 })
Draw.point(tangents0[1], { color: Draw.COLORS.green, radius: 1 })
Draw.point(tangents1[0], { color: Draw.COLORS.lightred, radius: 1 })
Draw.point(tangents1[1], { color: Draw.COLORS.red, radius: 1 })

Draw.segment({ a: wall.top[0], b: tangents0[0]}, { color: Draw.COLORS.lightgreen })
Draw.segment({ a: wall.top[0], b: tangents0[1]}, { color: Draw.COLORS.green })
Draw.segment({ a: wall.top[1], b: tangents1[0]}, { color: Draw.COLORS.lightred })
Draw.segment({ a: wall.top[1], b: tangents1[1]}, { color: Draw.COLORS.red })

// Intersect the canvas plane at elevation 0.
tangents0 = tangents0.map(pt => new Point3d(pt.x, pt.y, lightCenter.z))
tangents1 = tangents1.map(pt => new Point3d(pt.x, pt.y, lightCenter.z))

ix00 = foundry.utils.lineLineIntersection(tangents0[0], wall.top[0], tangents0[1], wall.top[0]);
ix01 = foundry.utils.lineLineIntersection(tangents0[0], wall.top[0], tangents1[1], wall.top[1]);
ix10 = foundry.utils.lineLineIntersection(tangents1[0], wall.top[1], tangents0[1], wall.top[0]);
ix11 = foundry.utils.lineLineIntersection(tangents1[0], wall.top[1], tangents1[1], wall.top[1]);


dir00 = normalizedDirection(tangents0[0], wall.top[0])
dir01 = normalizedDirection(tangents1[0], wall.top[1])
dir10 = normalizedDirection(tangents0[1], wall.top[0])
dir11 = normalizedDirection(tangents1[1], wall.top[1])

canvasIx00 = canvasPlane.lineIntersection(tangents0[0], dir00);
canvasIx01 = canvasPlane.lineIntersection(tangents1[0], dir01);
canvasIx10 = canvasPlane.lineIntersection(tangents0[1], dir10);
canvasIx11 = canvasPlane.lineIntersection(tangents1[1], dir11);

Draw.segment({a: tangents0[0], b: canvasIx00 }, { color: Draw.COLORS.lightgreen })
Draw.segment({a: tangents1[0], b: canvasIx01 }, { color: Draw.COLORS.green })
Draw.segment({a: tangents0[1], b: canvasIx10 }, { color: Draw.COLORS.lightred })
Draw.segment({a: tangents1[1], b: canvasIx11 }, { color: Draw.COLORS.red })

// middle
dirMid0 = normalizedDirection(lightCenter, wall.top[0])
dirMid1 = normalizedDirection(lightCenter, wall.top[1])
canvasIxMid0 = canvasPlane.lineIntersection(lightCenter, dirMid0);
canvasIxMid1 = canvasPlane.lineIntersection(lightCenter, dirMid1);
Draw.segment({a: lightCenter, b: canvasIxMid0})
Draw.segment({a: lightCenter, b: canvasIxMid1})
Draw.segment({a: canvasIxMid0, b: canvasIxMid1 }, { alpha: 0.5})

*/
