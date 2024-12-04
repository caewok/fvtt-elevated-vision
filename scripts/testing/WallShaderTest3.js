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
  distance,
  distanceSquared,
  linearConversion,
  interpolateBarycentric,
  between,
  normalizeBarycentricArea,
  convertBarycentericAreaSimilarTriangle,
  almostEqual,
  rayFromPoints,
  projectRay,
  normalizedRayFromPoints,
  closestPointToLine,
  distanceToLine,
  clamp,
  mix,
  hash
} from "./glsl_mock.js";

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
 * Framework to represent a single wall-light shadow calculation.
 * Each child class defines the outer penumbra triangle and optionally two side triangles
 * (one for each endpoint) describing the shift from penumbra --> umbra.
 * Locations inside the outer penumbra but not in the side penumbra are fully shaded.
 */
class ShadowWallVertexShaderTest3 {
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

  /* ----- NOTE: Getters for vertex calculations ----- */

  /** @type {object} */
  get varyings() {
    const {
      vVertexPosition,
      vTerrainTexCoord,
      vPenumbra,
      vEdgeDist,
      vTangentDir0,
      vTangentDir1,
      vTangentDir2,
      vTangentDir3,
      vTangentDir4,
      vTangentDir5,
      vTangentDir6,
      vTangentDir7,
      vTangentDir8 } = this;
    return {
      vVertexPosition,
      vTerrainTexCoord,
      vPenumbra,
      vEdgeDist,
      vTangentDir0,
      vTangentDir1,
      vTangentDir2,
      vTangentDir3,
      vTangentDir4,
      vTangentDir5,
      vTangentDir6,
      vTangentDir7,
      vTangentDir8
    };
  }

  get flats() {
    const {
      fThresholdRadius2,
      fWallSenseType,
      fWallRatio,
      fWallTop0,
      fWallTop1,
      fWallBottom0,
      fWallBottom1 } = this;
    return {
      fThresholdRadius2,
      fWallSenseType,
      fWallRatio,
      fWallTop0,
      fWallTop1,
      fWallBottom0,
      fWallBottom1
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
   * Does this directional ray cast an infinite shadow?
   * (Ray is rising as it moves from light --> wall.)
   * @param {vec3} lightDir
   * @returns {bool}
   */
  isInfiniteShadow(lightDir) { return lightDir.z >= 0.0 || almostEqual(lightDir.z, 0.0, 1.0e-06); }

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
    const canvasPlane = this.canvasPlane;
    const wallTopMid = wall.top[0].add(wall.top[1]).multiplyScalar(0.5);
    const wallDir2d = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
    const canvasIx = vec3();
    if ( !this.isInfiniteShadow(nearFarDir)
      && intersectRayPlane(Ray(wallTopMid, nearFarDir), canvasPlane, canvasIx) ) {
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

  /**
   * For infinite shadow, construct the different triangles.
   * @param {ShadowRays2d} sideShadowRays
   * @param {Wall} wall
   * @param {Ray2d} canvasRay     Either the infinite canvas ray or the far penumbra canvas intersection.
   * @returns {object}
   */
  shadowTriangles(sideShadowRays, wall, canvasRay, A, B, C, D, E, F, G, H, I, W0, W1) {
    // Penumbra triangle: ∆ABC
    // Near/far triangle 0: ∆DEF
    // Near/far triangle 1: ∆GHI
    // Side triangle 0: ∆W0CI or ∆W0W1B (near-collinear)
    // Side triangle 1: ∆W1BF or ∆W0W1C (near-collinear)
    // Umbra triangle: ∆W1FI (near-collinear)

    // A found by intersecting the two side penumbra lines.
    lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.penumbra[1], A);

    // Endpoint closest to the light will be associated with ∆DEF; furthest is ∆GHI.
    // Can determine by comparing distance to the penumbra vertex 0 (A).
    let closestIdx = distanceSquared(A, wall.top[1].xy) < distanceSquared(A, wall.top[0].xy) ? 1 : 0;
    W0.set(wall.top[closestIdx].xy);
    W1.set(wall.top[1 - closestIdx].xy);
    const wallDir = normalizedDirection(W0, W1);

    // The AB penumbra ray runs through the closer endpoint.
    closestIdx = sideShadowRays.penumbra[0].origin.x === W0.x && sideShadowRays.penumbra[0].origin.y === W0.y ? 0 : 1;
    const rAB = sideShadowRays.penumbra[closestIdx];
    const rAC = sideShadowRays.penumbra[1 - closestIdx];

    // D and G are the intersections of the penumbra with opposite umbra.
    // E intersects the D penumbra ray with the canvas line.
    const rD_penumbra = rAB;
    const rG_penumbra = rAC;
    const rD_umbra = sideShadowRays.umbra[closestIdx];
    const rG_umbra = sideShadowRays.umbra[1 - closestIdx];
    lineLineIntersection(rD_penumbra, rD_umbra, D);
    lineLineIntersection(rG_penumbra, rG_umbra, G);
    lineLineIntersection(rD_penumbra, canvasRay, E);

    // Moving from E along the wall direction, we will intersect rD_umbra at F.
    const rEWall = Ray2d(E, wallDir);
    lineLineIntersection(rEWall, rD_umbra, F);

    // May intersect rG_umbra (I) and rG_penumbra (H, B).
    const tI = lineLineIntersection(rEWall, rG_umbra);
    if ( tI !== null && tI > 0.0 ) {
      I.set(projectRay(rEWall, tI), 0); // GLSL: I = projectRay(rEWall, tI)
      lineLineIntersection(rEWall, rG_penumbra, H);
      B.set(H, 0);
      C.set(E, 0);
      return false;
    } else {
      console.log("infiniteShadowTriangles|Near-collinear wall.");
      const canvasRay2 = Ray2d(F, canvasRay.direction);
      lineLineIntersection(canvasRay2, rG_penumbra, B);
      lineLineIntersection(canvasRay, rG_umbra, I);
      const rIWall = Ray2d(I, wallDir);
      lineLineIntersection(rIWall, rG_penumbra, H);
      lineLineIntersection(canvasRay2, rD_penumbra, C);
      return true;
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
    return this.circleBisectorPercentArea(w0, w1, uLightPosition.xy, uLightSize);
  }


  // ----- NOTE: Primary vertex functions ----- //

  /**
   * Calculate the flat variables, including near/far ratios.
   * @param {vec2[3]} penumbraTri
   * @param {Wall} wall
   */
  calculateFlatVariables(penumbraTri, wall) {
    const baryForPoint = (pt, tri) => barycentric(pt, ...tri);
    wall ??= this.wall;

    const { uElevationRes, aWallSenseType, aThresholdRadius2 } = this;
    const { DISTANCE, PROXIMATE } = CONST.WALL_SENSE_TYPES;

    // @type {float} fWallSenseType
    this.fWallSenseType = aWallSenseType;

    // @type {float} fThresholdRadius
    this.fThresholdRadius2 = !(aWallSenseType === DISTANCE || aWallSenseType === PROXIMATE)
      ? -1.0 : aThresholdRadius2;

    // TODO: Drop this and vPenumbra and use orientation to calculate front/behind wall instead?
    // @type {float} fWallRatio
    this.fWallRatio = baryForPoint(wall.top[0].xy, penumbraTri).x;

    // @type {vec3} Wall data
    this.fWallTop0 = wall.top[0];
    this.fWallTop1 = wall.top[1];
    this.fWallBottom0 = wall.bottom[0];
    this.fWallBottom1 = wall.bottom[1];

    // Can retrieve for debugging using this.flats.
  }

  /**
   * Given a triangle ABC, make it isoceles by extending the shorter edge of AB or AC.
   * @param {vec2[3]} tri
   * @returns {vec2[3]} tri
   */
  makeIsoceles(tri) {
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
    * Mimic calculations done in the vertex shader.
    * @param {int} vertexNum     The vertex being "processed."
    * @returns {object} Object containing all out variables.
    */
  vertexCalculations(gl_VertexID = 0) {
    const { uSceneDims, uElevationRes } = this;
    const orient = foundry.utils.orient2dFast;
    const abs = Math.abs;
    const baryForPoint = (pt, tri) => barycentric(pt, ...tri);

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
      hasUmbraShadows,
      hasPenumbraShadows,
      sideShadowRays,
      farShadowDirs,
      nearShadowDirs } = this;

    const A = vec2();
    const B = vec2();
    const C = vec2();
    const D = vec2();
    const E = vec2();
    const F = vec2();
    const G = vec2();
    const H = vec2();
    const I = vec2();
    const J = vec2();
    const W0 = vec2();
    const W1 = vec2();
    const farPenumbraCanvasRay = Ray2d(vec2(), vec2());
    const hasFarPenumbra = this.canvasIntersectionRay(farShadowDirs.penumbra, sideShadowRays.penumbra,
      wall, farPenumbraCanvasRay);
    if ( !hasFarPenumbra ) this.hasPenumbraShadows[FAR] = false;

    const nearCollinear = this.shadowTriangles(sideShadowRays, wall, farPenumbraCanvasRay,
      A, B, C, D, E, F, G, H, I, W0, W1);
    const penumbraTri = this.penumbraTri = [A, B, C];

    // Location of this vertex.
    // @type {vec2} vVertexPosition
    const vVertexPosition = this.vVertexPosition = penumbraTri[vertexNum];

    // Set barymetric coordinates for each corner of the triangle.
    // @type {vec3} vPenumbra
    this.vPenumbra = vec3(0.0);
    this.vPenumbra[vertexNum] = 1.0;

    // Calculate distance to the edge; later used to test vertical intersections with wall.
    // Set to negative if on light side to distinguish distance on either side of wall.
    this.vEdgeDist = distanceToLine(vVertexPosition, W0, normalizedDirection(W0, W1));
    if ( vertexNum === 0 ) this.vEdgeDist *= -1.0;
    const vertex3d = vec3(vVertexPosition, this.canvasElevation);

    if ( this.constructor.isDirectional ) {
      this.vTangentDir0 = this.horizontalTangentDirections.midpenumbra; // Light center.
      this.vTangentDir1 = this.horizontalTangentDirections.umbra;
      this.vTangentDir2 = this.horizontalTangentDirections.penumbra;
      this.vTangentDir3 = this.verticalTangentDirections.umbra;
      this.vTangentDir4 = this.verticalTangentDirections.penumbra;
    } else if ( this.constructor.isSized ) {
      this.vTangentDir0 = normalizedDirection(vertex3d, this.light.center);
      this.vTangentDir1 = normalizedDirection(vertex3d, this.hTangents[0]);
      this.vTangentDir2 = normalizedDirection(vertex3d, this.hTangents[1]);
      this.vTangentDir3 = normalizedDirection(vertex3d, this.hTangents[2]);
      this.vTangentDir4 = normalizedDirection(vertex3d, this.hTangents[3]);
      this.vTangentDir5 = normalizedDirection(vertex3d, this.vTangents[0]);
      this.vTangentDir6 = normalizedDirection(vertex3d, this.vTangents[1]);
      this.vTangentDir7 = normalizedDirection(vertex3d, this.vTangents[2]);
      this.vTangentDir8 = normalizedDirection(vertex3d, this.vTangents[3]);
    }

    // Calculate the terrain texture coordinate at this vertex based on scene dimensions.
    // (vVertexPosition - uSceneDims.xy) / uSceneDims.zw
    // @type {vec2} vTerrainTexCoord
    this.vTerrainTexCoord = (vVertexPosition.subtract(uSceneDims.xy)).divide(uSceneDims.zw);

    // In shader:
    // gl_Position = vec4((projectionMatrix * translationMatrix * vec3(this.vVertexPosition, 1.0)).xy, 0.0, 1.0);

    // Finally, set the flat variables when we hit the last vertex for this triangle.
    if ( vertexNum === 2 ) this.calculateFlatVariables(penumbraTri, wall);

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
   * Determine whether there is a collision with the wall at a given direction from the fragment.
   * @param {vec3} dir
   * @param {vec2} hWall0
   * @param {vec2} hWall1
   * @param {vec2} vWall0
   * @param {vec2} vWall1
   * @returns {int}
   */
  wallCollision(dir, elevation, hWall0, hWall1, vWall0, vWall1) {
    const orient = foundry.utils.orient2dFast;
    const { vVertexPosition, vEdgeDist } = this.varyings;

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
    const { percentShadow, hasShadow } = this.shadowComponents(pt, elevation);

    let fragColor = this.noShadow();
    if ( !hasShadow ) return fragColor;
    const shadow = percentShadow;
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
    const orient = foundry.utils.orient2dFast;
    const { uElevationRes, uLightPosition, uLightSize, wall } = this;

    // Set the flat variables
    this.vertexCalculations(2);

    // Define the placement of the fragment and calculate varying variables.
    this.vVertexPosition = vec2(pt.x, pt.y);
    this.setVaryings();

    // Retrieve the flat and varying variables.
    let { fWallHeight, fWallRatios } = this.flats;
    const { vVertexPosition } = this.varyings;

    // GLSL only: let fragColor = this.noShadow();
    if ( this.thresholdApplies() ) return { hasShadow: false }; // GLSL only: return;
    if ( this.inFrontOfWall() ) return { hasShadow: false }; // GLSL only: return;

    // For each direction, test intersection with the wall.
    // TODO: If the wall has different heights for each endpoint, adjust to match the point
    // at which the light ray intersects the wall.
    // TODO: skip tests if certain horizontals or verticals are blocked?
    //       skip tests based on inclusion in umbra triangle?
    // TODO: Use tangents?
    let numCollisions = 0;
    const TOTAL_COLLISIONS = 10;
    this.collisionRays = [];
    const a = vec3(vVertexPosition, elevation);
    if ( this.constructor.isSized ) {
      const hWall0 = wall.top[0].xy;
      const hWall1 = wall.top[1].xy;
      const vWall0 = vec2(0.0, wall.top[0].z);
      const vWall1 = vec2(0.0, wall.bottom[0].z);
      for ( let i = 0; i < TOTAL_COLLISIONS; i += 1 ) {
        const pos = this.randomSpherePosition(i + elevation);
        const dir = normalizedDirection(a, pos);
        this.collisionRays.push(Ray(a, dir));
        numCollisions += this.wallCollision(dir, elevation, hWall0, hWall1, vWall0, vWall1);
      }
    } else if ( this.constructor.isDirectional ) {

    } else numCollisions = TOTAL_COLLISIONS;


    // TODO: Add in adjacent pixel values as part of the average here.
    let percentShadow = numCollisions / TOTAL_COLLISIONS;
    // In GLSL:
    // float dx = dFdx(percentShadow);
    // float dy = dFdy(percentShadow);
    // percentShadow = (percentShadow + percentShadow + (percentShadow + dx) + (percentShadow + dy)) / 4.0;

    // Debugging.
    return {
      numCollisions,
      percentShadow,
      hasShadow: true };
  }

  // ----- NOTE: Drawing ----- //

  drawWall() { Draw.segment({ a: this.wall.top[0], b: this.wall.top[1] }); }

  drawLight() { Draw.point(this.light.center, { radius: this.uLightSize, color: Draw.COLORS.yellow }); }

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
export class UnsizedPointSourceShadowWallVertexShaderTest3 extends ShadowWallVertexShaderTest3 {

  /* ----- NOTE: Uniforms ----- */

  /** @type {vec3} */
  get uLightPosition() { return vec3(...this.uniforms.uLightPosition); }

  /** @type {float} */
  get uLightSize() { return 0; }

  /* ----- NOTE: Vertex calculations ----- */

  /**
   * The rays from the wall endpoint along the side.
   * All at midpenumbra b/c no side shadow.
   * @param {Wall} wall
   * @returns {ShadowRays2d} Direction from the endpoint away from the light for umbra, mid, and penumbra.
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
   * Mimic calculations done in the vertex shader.
   */
  vertexCalculations(gl_VertexID = 0) {
    const wall = this.wall = this.calculateWallPositions();

    // Near/far shadows.
    this.hasUmbraShadows = vec2(false, false); // @type bvec2 for FAR, NEAR.
    this.hasPenumbraShadows = vec2(false, false); // @type bvec2 for FAR, NEAR.
    const farShadowDirs = this.farShadowDirs = this.calculateFarShadowDirections(wall);
    this.nearShadowDirs = ShadowDirections();
    if ( this.wallIsFloating ) this.nearShadowDirs = this.calculateNearShadowDirections(wall);


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
export class SizedPointSourceShadowWallVertexShaderTest3 extends ShadowWallVertexShaderTest3 {

  static isSized = true;

  /* ----- NOTE: Uniforms ----- */

  /** @type {vec3} */
  get uLightPosition() { return vec3(...this.uniforms.uLightPosition); }

  /** @type {float} */
  get uLightSize() { return this.uniforms.uLightSize ?? 1; }

  /** @type {float} */
  get uTime() { return this.uniforms.uTime; }

  /* ----- NOTE: Getters ----- */


  // ----- NOTE: Uniform variables ----- //

  calculateLightPositions(wall) {
    const { uLightSize, uLightPosition} = this;

    // Form a cross based on the light center.
    const top = uLightPosition.z + uLightSize;
    const bottom = uLightPosition.z - uLightSize;
    return Light({
      top: vec3(uLightPosition.xy, top),
      center: uLightPosition,
      bottom: vec3(uLightPosition.xy, bottom)
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
   * @param {Wall} wall
   * @param {Light} light
   * @returns {ShadowRays2d} Rays from the endpoint away from the light for umbra, mid, and penumbra.
   */
  calculateSideShadowRays(wall, light, tangents0, tangents1) {
    const max = Math.max;
    const { uLightSize } = this;

    // Wall data.
    const wall0 = wall.top[0].xy;
    const wall1 = wall.top[1].xy;
    const wallMid = wall0.add(wall1).multiplyScalar(0.5);
    const wallDir = normalizedDirection(wall0, wall1);

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
    const dist00 = distanceSquared(tangents0[0], tangents1[0]);
    const dist01 = distanceSquared(tangents0[0], tangents1[1]);
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
    let minD = max(distanceSquared(wall0, light.center.xy), distanceSquared(wall1, light.center.xy));
    for ( let i = 0; i < 2; i += 1 ) {
      for ( let j = 0; j < 2; j += 1 ) {
        const ix = vec2();
        if ( lineLineIntersection(tangentGroupA[i], tangentGroupB[j], ix) ) {
          const d = distanceSquared(ix, light.center.xy);
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
    const { uLightSize } = this;
    const wall = this.wall = this.calculateWallPositions();
    const light = this.light = this.calculateLightPositions(wall);

    // Tangent points.
    const lightCir = Circle({
      center: light.center.xy,
      radius: uLightSize
    });
    const hTangents0 = [lightCir.center, lightCir.center];
    const hTangents1 = [lightCir.center, lightCir.center];
    tangentPoints(lightCir, wall.top[0].xy, hTangents0);
    tangentPoints(lightCir, wall.top[1].xy, hTangents1);

    // Vertical tangent points
    const wallMid2d = wall.top[0].xy.add(wall.top[1].xy).multiplyScalar(0.5);
    const centerRay2d = Ray2d(light.center.xy, normalizedDirection(light.center.xy, wallMid2d));
    const dist = distance(wallMid2d, lightCir.center);
    lightCir.center = vec2(0.0);
    const txW0 = vec2(dist, wall.top[0].z);
    const txW1 = vec2(dist, wall.bottom[0].z);
    const vTangents0 = [lightCir.center, lightCir.center];
    const vTangents1 = [lightCir.center, lightCir.center];
    tangentPoints(lightCir, txW0, vTangents0);
    tangentPoints(lightCir, txW1, vTangents1);
    this.vTangents = [
      vec3(projectRay(centerRay2d, vTangents0[0].x), vTangents0[0].y),
      vec3(projectRay(centerRay2d, vTangents0[1].x), vTangents0[1].y),
      vec3(projectRay(centerRay2d, vTangents1[0].x), vTangents1[0].y),
      vec3(projectRay(centerRay2d, vTangents1[1].x), vTangents1[1].y)
    ];
    this.hTangents = [
      vec3(hTangents0[0], light.center.z),
      vec3(hTangents0[1], light.center.z),
      vec3(hTangents1[0], light.center.z),
      vec3(hTangents1[1], light.center.z)
    ];

    // Near/far shadows.
    this.hasUmbraShadows = vec2(true, true); // @type bvec2 for FAR, NEAR.
    this.hasPenumbraShadows = vec2(true, true); // @type bvec2 for FAR, NEAR.
    if ( !this.wallIsFloating ) {
      this.hasUmbraShadows[NEAR] = false;
      this.hasPenumbraShadows[NEAR] = false;
    }
    const farShadowDirs = this.farShadowDirs = this.calculateFarShadowDirections(wall, light);
    this.nearShadowDirs = ShadowDirections();
    if ( this.wallIsFloating ) this.nearShadowDirs = this.calculateNearShadowDirections(wall, light);

    // Side shadows.
    this.hasSideShadows = vec2(true, true); // @type bvec2 for 0, 1.
    const sideShadowRays = this.sideShadowRays = this.calculateSideShadowRays(wall, light, hTangents0, hTangents1);

    return super.vertexCalculations(gl_VertexID);
  }

  /* ----- NOTE: Fragment calculations ----- */

  /**
   * Create a random position within the 3d light sphere.
   * @param {float} seed    Number used to vary the pseudo-random value.
   * @param {}
   */
  randomSpherePosition(seed = 0) {
    const { uLightPosition, uLightSize, uTime, vVertexPosition } = this;

    // Get a 3d direction in which to move from the center.
    // uTime is much too large for hash.
    const t = (uTime * 1.0e-8) + seed;
    const rnd = hash(vec3(t).subtract(vec3(vVertexPosition, seed)));
    const rndDir = linearConversion(rnd, 0.0, 1.0, -1.0, 1.0);
    return uLightPosition.add(rndDir.multiplyScalar(uLightSize));
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
export class DirectionalSourceShadowWallVertexShaderTest3 extends ShadowWallVertexShaderTest3 {

  static isDirectional = true;


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
    if ( this.wallIsFloating ) this.nearShadowDirs = this.calculateNearShadowDirections(wall);

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

    // Tangent directions.
    const zDelta = this._calculateZChangeRays();
    this.horizontalTangentDirections = ShadowDirections({
      umbra: vec3(sideShadowDirs0.umbra, zDelta[MIDPENUMBRA]),
      midpenumbra: vec3(sideShadowDirs0.midpenumbra, zDelta[MIDPENUMBRA]),
      penumbra: vec3(sideShadowDirs0.penumbra, zDelta[MIDPENUMBRA])
    });
    this.verticalTangentDirections = farShadowDirs;

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

shader0.drawLight()
wall = shader0.wall
w0 = wall.top[0].xy;
Draw.segment({a: wall.top[0], b: wall.top[1]}, { width: 3 })

Draw.shape(new PIXI.Polygon(...shader0.penumbraTri))

shader0.shadowComponents(pt, 0)
shader0.drawCollisionRays(0)

let { vTangentDir0, vTangentDir1, vTangentDir2, vTangentDir3, vTangentDir4, vTangentDir5, vTangentDir6, vTangentDir7, vTangentDir8 } = shader0
dirs = [vTangentDir0, vTangentDir1, vTangentDir2, vTangentDir3, vTangentDir4, vTangentDir5, vTangentDir6, vTangentDir7, vTangentDir8]

pt = shader0.penumbraTri[1]
for ( const dir of dirs ) {
  const r = Ray2d(pt, dir.xy.normalize());
  drawRay(r)
}

*/
