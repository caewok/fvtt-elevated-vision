/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
"use strict";
/* eslint-disable eqeqeq */

import { MODULE_ID } from "../const.js";
import { Matrix } from "../geometry/Matrix.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Draw } from "../geometry/Draw.js";
import { Plane} from "../geometry/3d/Plane.js";
import {
  vec2,
  vec3,
  vec4,
  PlaneGLSLStruct,
  RayGLSLStruct,
  Ray2dGLSLStruct,
  ShadowPointsGLSLStruct,
  ShadowDirectionsGLSLStruct,
  WallGLSLStruct,
  LightGLSLStruct,
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
} from "./glsl_mock.js";

const UMBRA = 0;
const PENUMBRA = 1;
const MIDPENUMBRA = 2;

const TOP = 0;
const BOTTOM = 1;

/**
 * Based on SizedPointSourceShadowWallShader.
 * Represents a single wall calculation.
 * 3 vertices: light, ix for corner 1, ix for corner 2.
 * Wall shadow with side, near, and far penumbra
 * General version extended by SizedPointSource and DirectionalSource
 */
class ShadowWallVertexShaderTest {

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
  get aWallCorner0() { return new vec4(...this.attributes.aWallCorner0); }

  /** @type {vec4} */
  get aWallCorner1() { return new vec4(...this.attributes.aWallCorner1); }

  /** @type {float} */
  get aWallSenseType() { return this.attributes.aWallSenseType; }

  /** @type {float} */
  get aThresholdRadius2() { return this.attributes.aWallSenseType; }

  /* ----- NOTE: Uniforms ----- */

  /** @type {vec4} */
  get uElevationRes() { return new vec4(...this.uniforms.uElevationRes); }

  /** @type {vec4} */
  get uSceneDims() { return new vec4(...this.uniforms.uSceneDims); }

  /* ----- NOTE: Defined terms ---- */

  /** @type {WallGLSLStruct} */
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
    const planeNormal = new vec3(0.0, 0.0, 1.0);
    const planePoint = new vec3(0.0, 0.0, this.canvasElevation);
    return new PlaneGLSLStruct(planePoint, planeNormal);
  }

  /** @type {vec3[2][3]} */
  get sidePenumbraDirs() {
    return [
      this.calculateSidePenumbraDirection(0),
      this.calculateSidePenumbraDirection(1)
    ];
  }

  get adjSidePenumbraDirs() {
    const sidePenumbraDirs = this.sidePenumbraDirs;
    this.adjustSidePenumbraForLinkedEndpoints(sidePenumbraDirs[0], this.wall, 0);
    this.adjustSidePenumbraForLinkedEndpoints(sidePenumbraDirs[1], this.wall, 1);
    return sidePenumbraDirs;
  }

  /** @type {vec3[2][3]} */
  get nearPenumbraDirs() {
    return [
      this.calculateNearPenumbraDirection(0),
      this.calculateNearPenumbraDirection(1)
    ];
  }

  /** @type {vec3[2][3]} */
  get farPenumbraDirs() {
    return [
      this.calculateFarPenumbraDirection(0),
      this.calculateFarPenumbraDirection(1)
    ];
  }

  /** @type {object} */
  get varyings() {
    const {
      vVertexPosition,
      vTerrainTexCoord,
      vPenumbra,
      vMidPenumbra,
      vUmbra,
      vSidePenumbra0,
      vSidePenumbra1,
      vWall,
      vNearPenumbra,
      vNearMidPenumbra,
      vNearUmbra } = this;
    return {
      vVertexPosition,
      vTerrainTexCoord,
      vPenumbra,
      vMidPenumbra,
      vUmbra,
      vSidePenumbra0,
      vSidePenumbra1,
      vWall,
      vNearPenumbra,
      vNearMidPenumbra,
      vNearUmbra };
  }

  get flats() {
    const {
      fWallSenseType,
      fThresholdRadius2,
      fWallHeights,
      fWallRatio,
      fNearRatios,
      fFarRatios,
      fWallCornerLinked } = this;
    return { fWallSenseType, fThresholdRadius2, fWallHeights, fWallRatio, fNearRatios, fFarRatios, fWallCornerLinked };
  }

  // ----- NOTE: Penumbras ----- //

  /**
   * For side penumbra directions, determine if they must be moved to address light leakage
   * from linked endpoints.
   * @param {inout ShadowDirections} penObj
   * @param {Wall} wall
   * @param {int} idx
   */
  adjustSidePenumbraForLinkedEndpoints(penObj, wall, idx) {
    const orient = foundry.utils.orient2dFast;
    const Ray2d = Ray2dGLSLStruct;

    const wXY = wall.top[idx].xy; // Wall endpoint from which a penumbra is cast.

    // If no linked wall, full penumbra is used.
    const linkAngle = wall.linkValue[idx];
    if ( linkAngle === this.constructor.EV_ENDPOINT_LINKED_UNBLOCKED ) {
      console.log(`adjustSidePenumbraForLinkedEndpoints|idx ${idx} is unblocked.`);
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
    const midR = new Ray2d(wXY, penObj.midpenumbra.xy);
    const midPt = midR.project(1.0);

    // Orientation re mid.
    const other = (wall.top[1 - idx]).xy;
    const oMidLink = orient(wXY, midPt, linkPt);
    const oMidWall = orient(wXY, midPt, other);

    // 1 & 2: linked wall blocks light.
    const linkOppositeWall = oMidWall * oMidLink <= 0.0;
    if ( linkOppositeWall ) {
      penObj.umbra.x = penObj.midpenumbra.x;
      penObj.umbra.y = penObj.midpenumbra.y;
      penObj.umbra.z = penObj.midpenumbra.z;

      penObj.penumbra.x = penObj.midpenumbra.x;
      penObj.penumbra.y = penObj.midpenumbra.y;
      penObj.penumbra.z = penObj.midpenumbra.z;
      console.log(`adjustSidePenumbraForLinkedEndpoints|idx ${idx} linked wall blocks light fully.`);
      return;
    }

    // 3 & 4: Linked wall between wall and mid
    // 3: Linked wall in quadrant with light, not blocking.
    const oLinkWall = orient(wXY, linkPt, other);
    const oLinkMid = orient(wXY, linkPt, midPt);
    const linkBetweenWallAndMid = oLinkWall * oLinkMid < 0.0;
    if ( !linkBetweenWallAndMid ) {
      console.log(`adjustSidePenumbraForLinkedEndpoints|idx ${idx} not blocking (#3).`);
      return;
    }

    // 4. possible block.
    // What side of umbra is the linked wall on? If not on the mid-side, it doesn't block.
    const umbraR = new Ray2d(wXY, penObj.umbra.xy);
    const umbraPt = umbraR.project(1);
    const oUmbraLink = orient(wXY, umbraPt, linkPt);
    const oUmbraMid = orient(wXY, umbraPt, midPt);
    const linkAfterUmbra = oUmbraLink * oUmbraMid > 0.0;
    if ( !linkAfterUmbra ) {
      console.log(`adjustSidePenumbraForLinkedEndpoints|idx ${idx} is unblocked.`);
      return;
    }

    // Linked wall is after umbra, moving toward mid.
    const oMidUmbra = orient(wXY, midPt, umbraPt);

    // Set umbra to the link direction.
    // TODO: This results in a non-normalized direction. Is there a way to get the normalized direction?
    // - normalizing again could change x/y, so cannot do that ?
    const linkDir = normalizedDirection(wXY, linkPt);
    penObj.umbra.x = linkDir.x;
    penObj.umbra.y = linkDir.y;
    console.log(`adjustSidePenumbraForLinkedEndpoints|idx ${idx} partially blocked. Adjusting umbra.`);
    if ( oMidUmbra * oMidLink > 0.0 ) return;

    // Linked wall is after mid; adjust mid as well.
    penObj.midpenumbra.x = linkDir.x;
    penObj.midpenumbra.y = linkDir.y;
    console.log(`adjustSidePenumbraForLinkedEndpoints|idx ${idx} partially blocked. Adjusting mid.`);

  }


  /**
   * Determine the point where the near/far penumbra intersects the side penumbra, if any
   * sideDir: sidePenumbraDirs[idx][shadowType]
   * nearFarDir: farPenumbraDirs[idx][shadowType] or nearPenumbraDirs[idx][shadowType]
   * @param {Plane} canvasPlane
   * @param {vec3} wallEndpoint
   * @param {vec2} wallDirection
   * @param {vec3} sideDir
   * @param {vec3} nearFarDir
   * @param {vec2} ix                 Placeholder to store the intersection point.
   * @returns {bool}
   */
  penumbraCanvasIntersection(canvasPlane, wallEndpoint, wallDirection, sideDir, nearFarDir, ix) {
    const Ray2d = Ray2dGLSLStruct;
    const Ray = RayGLSLStruct;
    const lineLineIntersection = lineLineIntersectionRay;

    const canvasIx = new vec3();
    const infiniteShadow = nearFarDir.z >= 0.0;
    if ( infiniteShadow
      || !intersectRayPlane(new Ray(wallEndpoint, nearFarDir), canvasPlane, canvasIx)) return false;

    // Draw a line parallel to the wall that goes through the intersection point.
    // The intersection of that with the side penumbra defines the point.
    const farParallelRay = new Ray2d(canvasIx.xy, wallDirection);
    if ( !lineLineIntersection(farParallelRay, new Ray2d(wallEndpoint.xy, sideDir.xy), ix) ) return false;
    return true;
  }

  /**
   * Get either the point where the penumbra direction intersects the canvas or the point
   * at maximum canvas distance, as measured from wall endpoint 0.
   * Calculates points from both wall endpoints 0 and 1.
   * @param {vec3[2]} wallEndpoints
   * @param {vec2} wallDirection
   * @param {vec3} sideDir0
   * @param {vec3} sideDir1
   * @param {vec3} nearFarDir
   * @param {Wall} wall
   * @param {int} idx                 The wall endpoint associated with this penumbra
   *
   * @returns {vec2[2]} Canvas intersection or the maximum distance.
   */
  penumbraEndpoints(wallEndpoints, wallDir, sideDir0, sideDir1, nearFarDir) {
    const Ray2d = Ray2dGLSLStruct;
    const Plane = PlaneGLSLStruct;
    const lineLineIntersection = lineLineIntersectionRay;
    const { uElevationRes, uSceneDims } = this;

    const canvasElevation = uElevationRes.x;

    // Plane describing the canvas at elevation.
    const planeNormal = new vec3(0.0, 0.0, 1.0);
    const planePoint = new vec3(0.0, 0.0, canvasElevation);
    const canvasPlane = new Plane(planePoint, planeNormal);

    const infiniteShadow = nearFarDir.z >= 0.0; // Ray is rising as it moves from light --> wall.
    let keyPoint = new vec2(0.0);
    if ( infiniteShadow
      || !this.penumbraCanvasIntersection(canvasPlane, wallEndpoints[0], wallDir,
        sideDir0, nearFarDir, keyPoint) ) {

      keyPoint = this._parallelFarCorner(wallEndpoints, wallDir, nearFarDir);
    }

    // Get the other endpoint by intersecting the other ray.
    // TODO: If the endpoint heights are different, a more nuanced approach would be required.
    const farParallelRay = new Ray2d(keyPoint, wallDir);
    const canvasIx = [new vec2(), new vec2()];
    lineLineIntersection(farParallelRay, new Ray2d(wallEndpoints[0].xy, sideDir0.xy.normalize()), canvasIx[0]);
    lineLineIntersection(farParallelRay, new Ray2d(wallEndpoints[1].xy, sideDir1.xy.normalize()), canvasIx[1]);
    return canvasIx;
  }

  /**
   * Get the corner that can be used to project a far parallel ray to a wall.
   * Used in penumbraEndpoints to determine the infinite shadow parallel ray.
   * @param {vec3[2]} wallEndpoints,
   * @param {vec2} wallDir,
   * @param {vec3} nearFardir
   * @returns {vec2}
   */
  _parallelFarCorner(wallEndpoints, wallDir, nearFarDir) {
    const orient = foundry.utils.orient2dFast;
    const Ray2d = Ray2dGLSLStruct;
    const { uSceneDims } = this;

    const TL = 0;
    const TR = 1;
    const BR = 2;
    const BL = 3;

    // Ensure the shadow extends to the canvas edges.
    // Set the far parallel to intersect a corner.
    const sceneRect = Array(4);
    sceneRect[TL] = new vec2(0.0, 0.0);
    sceneRect[TR] = new vec2((uSceneDims.x * 2.0) + uSceneDims.z, 0.0);
    sceneRect[BR] = new vec2((uSceneDims.x * 2.0) + uSceneDims.z, (uSceneDims.y * 2.0) + uSceneDims.w);
    sceneRect[BL] = new vec2(0.0, (uSceneDims.y * 2.0) + uSceneDims.w);

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
        const r = new Ray2d(corner, wallDir);
        const testPt = r.project(1.0);
        if ( !this._rectContains(sceneRect, testPt) ) return corner;
      }
    }
    return sceneRect[0]; // Should not happen.
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
   * Get all shadow-canvas intersections for a given wall endpoint.
   * @param {ShadowDirections[2]} sidePenumbraDirs
   * @param {ShadowDirections[2]} nearFarPenumbraDirs   Far or near directions
   * @param {vec3[2]} wallEndpoints                     Top for far, bottom for near
   * @param {vec3} wallDirection
   * @returns {ShadowPoints[2]}
   */
  endpointsForPenumbras(sidePenumbraDirs, nearFarPenumbraDirs, wallEndpoints, wallDir) {
    const umbra = this.penumbraEndpoints(wallEndpoints, wallDir,
      sidePenumbraDirs[0].umbra, sidePenumbraDirs[1].umbra, nearFarPenumbraDirs[0].umbra);
    const midpenumbra = this.penumbraEndpoints(wallEndpoints, wallDir,
      sidePenumbraDirs[0].midpenumbra, sidePenumbraDirs[1].midpenumbra, nearFarPenumbraDirs[0].midpenumbra);
    const penumbra = this.penumbraEndpoints(wallEndpoints, wallDir,
      sidePenumbraDirs[0].penumbra, sidePenumbraDirs[1].penumbra, nearFarPenumbraDirs[0].penumbra);
    return [
      new ShadowPointsGLSLStruct({
        umbra: umbra[0],
        midpenumbra: midpenumbra[0],
        penumbra: penumbra[0]}),
      new ShadowPointsGLSLStruct({
        umbra: umbra[1],
        midpenumbra: midpenumbra[1],
        penumbra: penumbra[1]})
    ];

  }

  // ----- NOTE: Vertex shader calculations ----- //

  /**
   * For a given shadow vectors structure, get the corresponding vector.
   * @param {ShadowPoints} shadowPoints
   * @param {int} shadowType
   * @returns {vec2}
   */
  pointForShadowType(shadowPoints, shadowType) {
    switch ( shadowType ) {
      case UMBRA: return shadowPoints.umbra;
      case MIDPENUMBRA: return shadowPoints.midpenumbra;
      case PENUMBRA: return shadowPoints.penumbra;
    }
    return new vec2(0.0);
  }

  /**
   * Build the triangle to represent this light's shadow vis-a-vis the wall.
   * @param {ShadowPoints[2]} farPenumbraPoints
   * @param {Wall} wall
   * @param {int} shadowType
   * @returns {vec2[3]}
   */
  buildTriangle(farPenumbraPoints, wall, shadowType) {
    // Construct a new light position based on the xy intersection of the penumbra points --> wall corner
    const a = new vec2(); // Will be the new light center.
    const b = this.pointForShadowType(farPenumbraPoints[0], shadowType).xy;
    const c = this.pointForShadowType(farPenumbraPoints[1], shadowType).xy;
    lineLineIntersection(b, wall.top[0].xy, c, wall.top[1].xy, a);
    return [a, b, c];
  }

  calculateWallPositions() {
    const { aWallCorner0, aWallCorner1, aWallSenseType, aThresholdRadius2 } = this;

    const aTop = new vec3(aWallCorner0.x, aWallCorner0.y, aWallCorner0.z);
    const bTop = new vec3(aWallCorner1.x, aWallCorner1.y, aWallCorner0.z);
    const aBottom = new vec3(aWallCorner0.x, aWallCorner0.y, aWallCorner1.z);
    const bBottom = new vec3(aWallCorner1.x, aWallCorner1.y, aWallCorner1.z);
    return new WallGLSLStruct({
      top: [aTop, bTop],
      bottom: [aBottom, bBottom],
      direction: normalizedDirection(aWallCorner0.xy, aWallCorner1.xy), // Moving from 0 --> 1.
      linkValue: [aWallCorner0.w, aWallCorner1.w],
      type: aWallSenseType,
      thresholdRadius2: aThresholdRadius2
    });
  }

  /**
   * Set the side penumbra variables for the vertex position.
   * @param {vec2} pt
   * @param {Wall} wall
   * @param {vec2[3]} penumbraTri
   * @param {vec2[3]} umbraTri
   * @returns {object} For testing only, returns the varyings. Returns void in shader.
   */
  setSidePenumbraVars(pt, wall, penumbraTri, umbraTri) {
    const orient = foundry.utils.orient2dFast;
    const abs = Math.abs;

    const vSidePenumbras = [
      new vec3(),
      new vec3()
    ];
    for ( let i = 0; i < 2; i += 1 ) {
      const a = wall.top[i].xy;
      const b = penumbraTri[i + 1];
      const c = umbraTri[i + 1];

      // If b and c are equal, there is no side penumbra;
      // If a/b/c line up, there is no side penumbra.
      // Set so all points are outside by making the triangle a fixed -1.
      if ( abs(orient(a, b, c)) < 1.0 ) vSidePenumbras[i] = new vec3(-1.0);
      else vSidePenumbras[i] = barycentric(pt, a, b, c);
    }
    this.vSidePenumbra0 = vSidePenumbras[0];
    this.vSidePenumbra1 = vSidePenumbras[1];
  }

  /**
   * Calculate the flat variables, including near/far ratios.
   * @param {Wall} wall
   * @param {ShadowPoints[2]} farPenumbraPoints
   * @param {ShadowPoints[2]} nearPenumbraPoints
   * @param {vec2[3]} penumbraTri
   * @returns {object} For testing only, the flat variables.
   */
  calculateFlatVariables(wall, sidePenumbraDirs, farPenumbraPoints0, nearPenumbraDirs, penumbraTri) {
    const { uElevationRes } = this;

    const wTop = wall.top[0];
    const wBottom = wall.bottom[0];
    const canvasElevation = uElevationRes.x;

    this.fWallCornerLinked = new vec2(wall.linkValue[0], wall.linkValue[1]);
    this.fWallHeights = new vec2();
    this.fWallHeights[TOP] = wTop.z
    this.fWallHeights[BOTTOM] = wBottom.z;
    this.fWallSenseType = wall.type;
    this.fThresholdRadius2 = wall.thresholdRadius2;

    // Location of the wall along the x axis of the barycentric penumbra triangle.
    this.fWallRatio = this.baryForPoint(wTop.xy, penumbraTri).x;

    // Location of the far shadow along the x axis of the barycentric penumbra triangle.
    // Stored as vec3: UMBRA (x), MID (y), PENUMBRA (z)
    const farPts = farPenumbraPoints0;
    this.fFarRatios = new vec3(0.0);
    this.fFarRatios[UMBRA] = this.baryForPoint(farPts.umbra, penumbraTri).x;
    this.fFarRatios[MIDPENUMBRA] = this.baryForPoint(farPts.midpenumbra, penumbraTri).x;
    // PENUMBRA is 0.0 by definition, b/c it is at end of triangle.

    // Location of the near shadow along the x axis of the barycentric penumbra triangle.
    // Stored as vec3: UMBRA (x), MID (y), PENUMBRA (z)
    this.fNearRatios = new vec3(this.fWallRatio); // Near shadow starts at wall unless the wall is "floating."
    if ( wBottom.z > canvasElevation ) {
      const nearPenumbraPoints = this.nearPenumbraPoints = this.endpointsForPenumbras(
        sidePenumbraDirs, nearPenumbraDirs, wall.bottom, wall.direction);
      const nearPts = nearPenumbraPoints[0];
      this.fNearRatios[UMBRA] = this.baryForPoint(nearPts.umbra, penumbraTri).x;
      this.fNearRatios[MIDPENUMBRA] = this.baryForPoint(nearPts.midpenumbra, penumbraTri).x;
      this.fNearRatios[PENUMBRA] = this.baryForPoint(nearPts.penumbra, penumbraTri).x;
    } else {
      // Debugging only.
      this.nearPenumbraPoints = [
        new ShadowPointsGLSLStruct({
          umbra: wall.bottom[0].xy,
          midpenumbra: wall.bottom[0].xy,
          penumbra: wall.bottom[0].xy
        }),
        new ShadowPointsGLSLStruct({
          umbra: wall.bottom[1].xy,
          midpenumbra: wall.bottom[1].xy,
          penumbra: wall.bottom[1].xy
        })
      ];
    }

    // For debugging.
    return this.flats;
  }

  /**
    * Mimic calculations done in the vertex shader.
    * @param {int} vertexNum     The vertex being "processed."
    * @returns {object} Object containing all out variables.
    */
  vertexCalculations(gl_VertexID = 0) {
    const { farPenumbraDirs, nearPenumbraDirs, wall } = this;
    const { uSceneDims, uElevationRes } = this;

    const vertexNum = gl_VertexID % 3;
    // Penumbra structures.
    // this.adjustSidePenumbraForLinkedEndpoints(sidePenumbraDirs[0], wall, 0);
    // this.adjustSidePenumbraForLinkedEndpoints(sidePenumbraDirs[1], wall, 1);
    const adjSidePenumbraDirs = this.adjSidePenumbraDirs;
    const farPenumbraPoints = this.farPenumbraPoints = this.endpointsForPenumbras(
      adjSidePenumbraDirs, farPenumbraDirs, wall.top, wall.direction);

    // Vertex Calculations
    // Big triangle ABC is the bounds of the potential shadow.
    //   A = lightCenter;
    //   B = sidePenumbra;
    //   C = sidePenumbra;
    const penumbraTri = this.buildTriangle(farPenumbraPoints, wall, PENUMBRA);
    const vVertexPosition = this.vVertexPosition = penumbraTri[vertexNum];

    // Set barymetric coordinates for each corner of the triangle.
    const midPenumbraTri = this.buildTriangle(farPenumbraPoints, wall, MIDPENUMBRA);
    const umbraTri = this.buildTriangle(farPenumbraPoints, wall, UMBRA);
    this.vPenumbra = new vec3(0.0);
    this.vPenumbra[vertexNum] = 1.0;
    this.vMidPenumbra = this.baryForPoint(vVertexPosition, midPenumbraTri);
    this.vUmbra = this.baryForPoint(vVertexPosition, umbraTri);
    this.setSidePenumbraVars(vVertexPosition, wall, penumbraTri, umbraTri);

    // Calculate the terrain texture coordinate at this vertex based on scene dimensions.
    // (vVertexPosition - uSceneDims.xy) / uSceneDims.zw
    this.vTerrainTexCoord = (vVertexPosition.subtract(uSceneDims.xy)).divide(uSceneDims.zw);

    // Test using the light --> endpoints triangle for testing in front of wall.
    // Looking for better resolution on the wall shading for infinite shadows.
    const wallTri = [
      penumbraTri[0],
      wall.top[0].xy,
      wall.top[1].xy
    ];
    this.vWall = this.baryForPoint(vVertexPosition, wallTri);

    // Same for the near umbra and midpenumbra near triangles.
    // Lessen number of flat variables and attempt to address resolution issue with
    // infinite wall vision shadows.
    const canvasElevation = uElevationRes.x;
    if ( wall.bottom[0].z > canvasElevation ) {
      const nearPenumbraPoints = this.endpointsForPenumbras(
        adjSidePenumbraDirs, nearPenumbraDirs, wall.bottom, wall.direction);
      const nearPenumbraTri = [
        penumbraTri[0],
        nearPenumbraPoints[0].penumbra,
        nearPenumbraPoints[1].penumbra
      ];
      const nearMidPenumbraTri = [
        penumbraTri[0],
        nearPenumbraPoints[0].midpenumbra,
        nearPenumbraPoints[1].midpenumbra
      ];
      const nearUmbraTri = [
        penumbraTri[0],
        nearPenumbraPoints[0].umbra,
        nearPenumbraPoints[1].umbra
      ];
      this.vNearPenumbra = this.baryForPoint(vVertexPosition, nearPenumbraTri);
      this.vNearMidPenumbra = this.baryForPoint(vVertexPosition, nearMidPenumbraTri);
      this.vNearUmbra = this.baryForPoint(vVertexPosition, nearUmbraTri);

    } else {
      this.vNearPenumbra = this.vWall;
      this.vNearMidPenumbra = this.vWall;
      this.vNearUmbra = this.vWall;
    }

    // In shader:
    // gl_Position = vec4((projectionMatrix * translationMatrix * vec3(this.vVertexPosition, 1.0)).xy, 0.0, 1.0);

    // Finally, set the flat variables when we hit the last vertex for this triangle.
    if ( vertexNum === 2 ) {
      this.calculateFlatVariables(wall, adjSidePenumbraDirs, farPenumbraPoints[0], nearPenumbraDirs, penumbraTri);
    }

    // For debugging.
    return { varyings: this.varyings, flats: this.flats };
  }


  // ----- NOTE: Fragment shader testing ----- //

  /**
   * @param {bool} SHADOW   The #define SHADOW parameter
   * @returns {vec4}
   */
  noShadow(SHADOW = true) { return SHADOW ? new vec4(0.0) : new vec4(1.0); }

  /**
   * @param {float} light
   * @param {bool} SHADOW   The #define SHADOW parameter
   * @returns {vec4}
   */
  lightEncoding(light, SHADOW = true) {
    if ( light === 1.0 ) return this.noShadow(SHADOW);

    const ltd = this.fWallSenseType === this.constructor.LIMITED_WALL ? 1.0 : 0.0;
    const ltdInv = 1.0 - ltd;
    let c = new vec4((light * ltdInv) + ltd, 1.0 - (0.5 * ltd), (light * ltd) + ltdInv, 1.0);

    // For testing, return the amount of shadow, which can be directly rendered to the canvas.
    // if ( light < 1.0 && light > 0.0 ) return vec4(0.0, 1.0, 0.0, 1.0);
    if ( SHADOW ) c = new vec4(new vec3(0.0), (1.0 - light) * 0.7);
    return c;
  }

  /**
   * Get the barycentric position for a given 2d canvas point.
   * Used to mimic the vBary coordinates in the fragment shader.
   * @param {vec2} pt
   * @param {vec2[3]} tri
   * @returns {vec3}
   */
  baryForPoint(pt, tri) {
    return barycentric(pt, tri[0], tri[1], tri[2]);
  }

  /**
   * Determine the ratio by which to modify the near/far barycentric x values of shadow triangles.
   * @param {float} elevationZ
   * @param {float} wallHeight
   * @returns {float}
   */
  elevationNearFarRatio(elevationZ, wallHeight) {
    const canvasElevation = this.canvasElevation;
    if ( elevationZ <= canvasElevation ) return 0.0;
    wallHeight = Math.max(wallHeight - canvasElevation, 0.0);
    if ( wallHeight === 0.0 ) return 0.0;
    const elevationChange = elevationZ - canvasElevation;
    return elevationChange / wallHeight;
  }

  /**
   * Elevate given shadow ratios.
   * @param {float} elevation
   * @param {float} wallHeight
   * @param {vec3} ratios
   * @returns {vec3}
   */
  _elevateShadowRatios(elevation, wallHeight, ratios) {
    const { uElevationRes, fWallRatio } = this;

    const canvasElevation = uElevationRes.x;
    if ( elevation <= canvasElevation ) return ratios;

    wallHeight = Math.max(wallHeight - canvasElevation, 0.0);
    if ( wallHeight === 0.0 ) return ratios;

    const elevationChange = elevation - canvasElevation;
    const heightFraction = elevationChange / wallHeight;

    // For JS only.
    // GLSL: return ratios + (heightFraction * fWallRatio) - (heightFraction * ratios);
    const tmpV = new vec3(heightFraction * fWallRatio);
    return ratios.add(tmpV).subtract(ratios.multiplyScalar(heightFraction));
  }

  // Other ways to calculate this:
  //   ratio + ((elevationChange / wallHeight) * fWallRatio) - ((elevationChange / wallHeight) * ratio) = X
  //   ratio + elevationChange * fWallRatio + invWallHeight * fWallRatio - elevationChange * ratio - invWallHeight * ratio = X
  //   ratio + elevationChange * fWallRatio - elevationChange * ratio + invWallHeight * fWallRatio  - invWallHeight * ratio = X
  //   ratio + elevationChange * (fWallRatio - ratio) + invWallHeight * (fWallRatio  - ratio) = X
  //   ratio + ((fWallRatio  - ratio) * (elevationChange + invWallHeight)) = X

  /*
  elevation = 0
  wallHeight = shader0.fWallHeights.x
  ratios = shader0.fFarRatios
  canvasElevation = shader0.uElevationRes.x;
  wallHeight = Math.max(wallHeight - canvasElevation, 0.0);
  fWallRatio = shader0.fWallRatio

  invWallHeight = 1/wallHeight
  tmpA = (elevationChange * invWallHeight) * fWallRatio
  tmpB = ratios.multiplyScalar(elevationChange * invWallHeight)
  ratios.add(new vec3(tmpA)).subtract(tmpB)

  tmpA = new vec3(fWallRatio  - ratios.x, fWallRatio  - ratios.y, fWallRatio  - ratios.z)
  tmpB = elevationChange + (1 / wallHeight)
  ratios.add(tmpA.multiplyScalar(tmpB))
  */

  /**
   * Elevate the far shadow ratios.
   * @param {float} elevation
   * @returns {vec3}
   */
  elevateFarShadowRatios(elevation = this.canvasElevation) {
    const { fWallHeights, fFarRatios } = this;
    return this._elevateShadowRatios(elevation, fWallHeights[TOP], fFarRatios);
  }

  /**
   * Elevate the near shadow ratios.
   * @param {float} elevation
   * @returns {vec3}
   */
  elevateNearShadowRatios(elevation = this.canvasElevation) {
    const { fWallHeights, fNearRatios } = this;
    return this._elevateShadowRatios(elevation, fWallHeights[BOTTOM], fNearRatios);
  }


  /**
   * Determine if a threshold applies to this point.
   */
  thresholdApplies() {
    const { DISTANCE_WALL, PROXIMATE_WALL } = this.constructor;
    const { vVertexPosition, fWallSenseType, fThresholdRadius2, uLightPosition } = this;
    return (fWallSenseType == DISTANCE_WALL || fWallSenseType == PROXIMATE_WALL)
      && fThresholdRadius2 != 0.0
      && distanceSquared(vVertexPosition, uLightPosition.xy) < fThresholdRadius2;
  }

  /**
   * Is the fragment location in front of the wall?
   * @returns {bool}
   */
  inFrontOfWall() {
    const { vWall } = this;
    return barycentricPointInsideTriangle(vWall);
  }

  /**
   * Is the barycentric coordinate within a modified triangle?
   * The x value is shifted based on elevation.
   * @param {vec3} bary     Barycentric coordinate; x,y,z => u,v,w
   * @param {float} elevationZ
   * @returns {bool}
   */
  barycentricPointInsideElevatedTriangle(bary, elevationZ, wallHeight) {
    elevationZ ??= this.canvasElevation;

    if ( bary.y < 0.0 || bary.z < 0.0 || bary.x < 0.0 ) return false;
    if ( bary.y > 1.0 || bary.z > 1.0 ) return false;
    const elevRatio = this.elevationNearFarRatio(elevationZ, wallHeight);
    if ( bary.x > (1 - elevRatio) ) return false;
    return true;
  }

  /* NOTE: Basic triangle tests
    Fixed: vWall, vSidePenumbra0, vSidePenumbra1
    Moves with elevation: vPenumbra, vMidPenumbra, vUmbra, vNearPenumbra, vNearMidPenumbra, vNearUmbra
  */

  /**
   * @returns {bool}
   */
  inSidePenumbra0() {
    const { vSidePenumbra0 } = this;
    return barycentricPointInsideTriangle(vSidePenumbra0);
  }

  /**
   * @returns {bool}
   */
  inSidePenumbra1() {
    const { vSidePenumbra1 } = this;
    return barycentricPointInsideTriangle(vSidePenumbra1);
  }

  /**
   * @param {float} elevationZ
   * @returns {bool}
   */
  inFarPenumbra(elevationZ) {
    const { vPenumbra, wall } = this;
    return this.barycentricPointInsideElevatedTriangle(vPenumbra, elevationZ, wall.top[0].z);
  }

  /**
   * @param {float} elevationZ
   * @returns {bool}
   */
  inFarMidPenumbra(elevationZ) {
    const { vMidPenumbra, wall } = this;
    return this.barycentricPointInsideElevatedTriangle(vMidPenumbra, elevationZ, wall.top[0].z);
  }

  /**
   * @param {float} elevationZ
   * @returns {bool}
   */
  inFarUmbra(elevationZ) {
    const { vUmbra, wall } = this;
    return this.barycentricPointInsideElevatedTriangle(vUmbra, elevationZ, wall.top[0].z);
  }

  /**
   * @param {float} elevationZ
   * @returns {bool}
   */
  inNearPenumbra(elevationZ) {
    const { vNearPenumbra, wall } = this;
    return this.barycentricPointInsideElevatedTriangle(vNearPenumbra, elevationZ, wall.bottom[0].z);
  }

  /**
   * @param {float} elevationZ
   * @returns {bool}
   */
  inNearMidPenumbra(elevationZ) {
    const { vNearMidPenumbra, wall } = this;
    return this.barycentricPointInsideElevatedTriangle(vNearMidPenumbra, elevationZ, wall.bottom[0].z);
  }

  /**
   * @param {float} elevationZ
   * @returns {bool}
   */
  inNearUmbra(elevationZ) {
    const { vNearUmbra, wall } = this;
    return this.barycentricPointInsideElevatedTriangle(vNearUmbra, elevationZ, wall.bottom[0].z);
  }

  /**
   * Is the fragment in the far penumbra shadow?
   * Does not explicitly test for in front of wall.
   * @param {float} elevationZ
   * @returns {bool}
   */
  inFarPenumbraShadow(elevationZ) {
    return this.inFarPenumbra(elevationZ) && !this.inFarMidPenumbra(elevationZ);
  }

  /**
   * Is the fragment in the far midpenumbra shadow?
   * Does not explicitly test for in front of wall.
   * @param {float} elevationZ
   * @returns {bool}
   */
  inFarMidPenumbraShadow(elevationZ) {
    return this.inFarMidPenumbra(elevationZ) && !this.inFarUmbra(elevationZ);
  }

  /**
   * Is the fragment in the near penumbra shadow?
   * Does not explicitly test for in front of wall.
   * @param {float} elevationZ
   * @returns {bool}
   */
  inNearPenumbraShadow(elevationZ) {
    return this.inNearMidPenumbra(elevationZ) && !this.inFarPenumbra(elevationZ);
  }

  /**
   * Is the fragment in the near midpenumbra shadow?
   * Does not explicitly test for in front of wall.
   * @param {float} elevationZ
   * @returns {bool}
   */
  inNearMidPenumbraShadow(elevationZ) {
    return this.inNearUmbra(elevationZ) && !this.inNearMidPenumbra(elevationZ);
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

    // Use barycentric coordinates to get the value of the vVertexPosition for each varying.
    const varyingKeys = [
      "vTerrainTexCoord",
      "vPenumbra",
      "vMidPenumbra",
      "vUmbra",
      "vSidePenumbra0",
      "vSidePenumbra1",
      "vWall",
      "vNearPenumbra",
      "vNearMidPenumbra",
      "vNearUmbra"
    ];

    // The penumbra triangle that defines this shader.
    const vVertexPosition = this.vVertexPosition = new vec2(pt.x, pt.y);
    const bary = barycentric(vVertexPosition,
      shaders[0].vVertexPosition,
      shaders[1].vVertexPosition,
      shaders[2].vVertexPosition);
    const varying = {};
    for ( const varyingKey of varyingKeys ) {
      const a = shaders[0][varyingKey];
      const b = shaders[1][varyingKey];
      const c = shaders[2][varyingKey];
      this[varyingKey] = varying[varyingKey] = interpolateBarycentric(bary, a, b, c);
    }
    return varying;
  }

  /**
   * Get the barycentric position for a given 2d canvas point.
   * Used to mimic the vBary coordinates in the fragment shader.
   */
  _varyingBaryForPoint(pt, shadowType = PENUMBRA) {
    const tri = this._varyingBuildTriangle(shadowType);
    return barycentric(new vec2(pt.x, pt.y), tri[0], tri[1], tri[2]);
  }

  _varyingBuildTriangle(shadowType = PENUMBRA) {
    const { wall, farPenumbraPoints } = this;
    const a = new vec2();
    const b = farPenumbraPoints[0][shadowType].xy;
    const c = farPenumbraPoints[1][shadowType].xy;
    lineLineIntersection(b, wall.top[0].xy, c, wall.top[1].xy, a);
    return [a, b, c];
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
  shadowComponents(pt, elevation = 0) {
    const { uElevationRes } = this;
    elevation = CONFIG.GeometryLib.utils.gridUnitsToPixels(elevation);

    // Set the flat variables
    this.vertexCalculations(2);

    // Define the placement of the fragment and calculate varying variables.
    this.vVertexPosition = new vec2(pt.x, pt.y);
    this.setVaryings();
    const { vPenumbra, vSidePenumbra0, vSidePenumbra1 } = this;

    // GLSL only: let fragColor = this.noShadow();
    if ( this.thresholdApplies() ) return { hasShadow: false }; // GLSL only: return fragColor;
    if ( this.inFrontOfWall() ) return { hasShadow: false }; // GLSL only: return fragColor;

    // Get the elevation at this fragment.
    const canvasElevation = uElevationRes;

    // Determine the start and end of the shadow, relative to the light.
    const farRatios = this.elevateFarShadowRatios(elevation);
    const nearRatios = this.elevateNearShadowRatios(elevation);

    // If in front of the near shadow or behind the far shadow, then no shadow.
    if ( this.inNearPenumbra(canvasElevation) ) return { nearShadow: false, hasShadow: false }; // GLSL only: return fragColor;


    // Determine if the fragment is within one or more penumbra.
    const inSidePenumbra0 = this.inSidePenumbra0();
    const inSidePenumbra1 = this.inSidePenumbra1();
    const inFarPenumbra = this.inFarPenumbraShadow(canvasElevation);
    const inNearPenumbra = this.inNearPenumbraShadow(canvasElevation);
    const inFarMidPenumbra = this.inFarMidPenumbraShadow(canvasElevation);
    const inNearMidPenumbra = this.inNearMidPenumbraShadow(canvasElevation);

    // Blend the two side penumbras if overlapping by multiplying the light amounts.
    const side0Shadow = inSidePenumbra0 ? vSidePenumbra0.z / (vSidePenumbra0.y + vSidePenumbra0.z) : 1.0;
    const side1Shadow = inSidePenumbra1 ? vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z) : 1.0;

    // UMBRA is nearer to 1; PENUMBRA is nearer to 0.
    const farShadow = inFarPenumbra
      ? linearConversion(vPenumbra.x, farRatios[PENUMBRA], farRatios[MIDPENUMBRA], 0.0, 0.5)
      : inFarMidPenumbra ? linearConversion(vPenumbra.x, farRatios[MIDPENUMBRA], farRatios[UMBRA], 0.5, 1.0)
        : 1.0;

    // Near shadow is reversed, so UMBRA is nearer 0 and PENUMBRA is nearer to 1.
    const nearShadow = inNearPenumbra
      ? linearConversion(vPenumbra.x, nearRatios[PENUMBRA], nearRatios[MIDPENUMBRA], 0.0, 0.5)
      : inNearMidPenumbra ? linearConversion(vPenumbra.x, nearRatios[MIDPENUMBRA], nearRatios[UMBRA], 0.5, 1.0)
        : 1.0;

    return { side0Shadow, side1Shadow, farShadow, nearShadow, hasShadow: true };
  }

  /**
   * For debugging only.
   * Calculate whether fragment point is in certain areas.
   */
  testPoint(pt, elevation = 0) {
    const { uElevationRes } = this;
    elevation = CONFIG.GeometryLib.utils.gridUnitsToPixels(elevation);

    // Set the flat variables
    this.vertexCalculations(2);

    // Define the placement of the fragment and calculate varying variables.
    this.vVertexPosition = new vec2(pt.x, pt.y);
    this.setVaryings();
    const { vSidePenumbra0, vSidePenumbra1 } = this;

    // Determine the start and end of the shadow, relative to the light.
    const farRatios = this.elevateFarShadowRatios(elevation);
    const nearRatios = this.elevateNearShadowRatios(elevation);

    return {
      farRatios,
      nearRatios,
      thresholdApplies: this.thresholdApplies(),
      inFrontOfWall: this.inFrontOfWall(),

      inSidePenumbra0: this.inSidePenumbra0(),
      inSidePenumbra1: this.inSidePenumbra1(),
      inFarPenumbra: this.inFarPenumbra(elevation),
      inFarMidPenumbra: this.inFarMidPenumbra(elevation),
      inFarUmbra: this.inFarUmbra(elevation),
      inNearUmbra: this.inNearUmbra(elevation),
      inNearMidPenumbra: this.inNearMidPenumbra(elevation),
      inNearPenumbra: this.inNearPenumbra(elevation),

      inFarPenumbraShadow: this.inFarPenumbraShadow(elevation),
      inFarMidPenumbraShadow: this.inFarMidPenumbraShadow(elevation),
      inNearPenumbraShadow: this.inNearPenumbraShadow(elevation),
      inNearMidPenumbraShadow: this.inNearMidPenumbraShadow(elevation)

    };
  }

  // ----- NOTE: Drawing ----- //

  drawWall() { Draw.segment({ a: this.wall.top[0], b: this.wall.top[1] }); }

  drawLight() { Draw.point(this.light.center, { radius: this.light.size, color: Draw.COLORS.yellow }); }

  drawSidePenumbraDirections(dist = canvas.dimensions.maxR) {
    const { sidePenumbraDirs, wall } = this;
    const COLOR_KEYS = {
      umbra: Draw.COLORS.red,
      midpenumbra: Draw.COLORS.orange,
      penumbra: Draw.COLORS.yellow
    };
    for ( const [key, color] of Object.entries(COLOR_KEYS) ) {
      for ( let i = 0; i < 2; i += 1 ) {
        const endpoint = wall.top[i].xy;
        const penumbraPt = endpoint.add(sidePenumbraDirs[i][key].xy.normalize().multiplyScalar(dist));
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

  drawTriangle(shadowType = PENUMBRA) {
    const COLOR_KEYS = {
      [UMBRA]: Draw.COLORS.red,
      [MIDPENUMBRA]: Draw.COLORS.orange,
      [PENUMBRA]: Draw.COLORS.yellow
    };

    const tri = this.buildTriangle(this.farPenumbraPoints, this.wall, shadowType);
    const poly = new PIXI.Polygon(...tri);
    Draw.shape(poly, { color: COLOR_KEYS[shadowType], width: 2 });
  }

  drawNearLines(elevation = this.canvasElevation) { this._drawNearFarLines(elevation, false); }

  drawFarLines(elevation = this.canvasElevation) { this._drawNearFarLines(elevation, true); }

  _drawNearFarLines(elevation = this.canvasElevation, far = true ) {
    const COLOR_KEYS = {
      umbra: Draw.COLORS.red,
      midpenumbra: Draw.COLORS.orange,
      penumbra: Draw.COLORS.yellow
    };
    const penumbraTri = this.buildTriangle(this.farPenumbraPoints, this.wall, PENUMBRA);
    const [A, B, C] = penumbraTri.map(pt => PIXI.Point.fromObject(pt));

    const ratios = far ? this.elevateFarShadowRatios(elevation) : this.elevateNearShadowRatios(elevation)
    for ( const [key, color] of Object.entries(COLOR_KEYS) ) {
      const idx = key === "umbra" ? UMBRA : key === "penumbra" ? PENUMBRA : MIDPENUMBRA;
      const p0 = B.projectToward(A, ratios[idx]);
      const p1 = foundry.utils.lineLineIntersection(A, C, p0, p0.add(this.wall.direction.multiplyScalar(1)));
      Draw.point(p0, { color });
      Draw.point(p1, { color });
      Draw.segment({ a: p0, b: p1 }, { color });
    }
  }

  /**
   * Draw the near/far markers.
   */
  drawNear() { this._drawNearFar(false); }

  drawFar() { this._drawNearFar(true); }

  _drawNearFar(far = true) {
    const { wall } = this;
    const COLOR_KEYS = {
      umbra: Draw.COLORS.red,
      midpenumbra: Draw.COLORS.orange,
      penumbra: Draw.COLORS.yellow
    };
    const penumbraPoints = far ? this.farPenumbraPoints : this.nearPenumbraPoints;
    const tri = this.buildTriangle(this.farPenumbraPoints, this.wall, PENUMBRA);
    const v0 = tri[0];
    for ( const [key, color] of Object.entries(COLOR_KEYS) ) {
      const v1 = penumbraPoints[0][key];
      const v2 = penumbraPoints[1][key];
      Draw.segment({ a: v0, b: v1 }, { color });
      Draw.segment({ a: v1, b: v2 }, { color });
      Draw.segment({ a: v2, b: v0 }, { color });
      Draw.point(v1, { color });
      Draw.point(v2, { color });
    }
  }
}

/**
 * Based on SizedPointSourceShadowWallShader.
 * Represents a single wall calculation.
 * 3 vertices: light, ix for corner 1, ix for corner 2.
 * Wall shadow with side, near, and far penumbra
 */
export class SizedPointSourceShadowWallVertexShaderTest extends ShadowWallVertexShaderTest {

  /* ----- NOTE: Uniforms ----- */

  /** @type {vec3} */
  get uLightPosition() { return new vec3(...this.uniforms.uLightPosition); }

  /** @type {float} */
  get uLightSize() { return this.uniforms.uLightSize ?? 0; }

  /* ----- NOTE: Getters ----- */

  /** @type {LightGLSLStruct} */
  get light() { return this.calculateLightPositions(this.wall); }

  /** @type {ShadowDirections[2]} */
  get sidePenumbraDirs() {
    const { light, wall } = this;
    return [
      this.calculateSidePenumbraDirection(light, wall, 0),
      this.calculateSidePenumbraDirection(light, wall, 1)
    ];
  }

  /** @type {ShadowDirections[2]} */
  get farPenumbraDirs() {
    const { light, wall } = this;
    return [
      this.calculateNearFarPenumbraDirection(light, wall, true, 0),
      this.calculateNearFarPenumbraDirection(light, wall, true, 1)
    ];
  }

  /** @type {ShadowDirections[2]} */
  get nearPenumbraDirs() {
    const { light, wall } = this;
    return [
      this.calculateNearFarPenumbraDirection(light, wall, false, 0),
      this.calculateNearFarPenumbraDirection(light, wall, false, 1)
    ];
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
    return new LightGLSLStruct({
      center: uLightPosition,
      lr0: new vec3(lr0.x, lr0.y, uLightPosition.z), // Closest to wall 0 endpoint.
      lr1: new vec3(lr1.x, lr1.y, uLightPosition.z), // Closest to wall 1 endpoint.
      top: new vec3(uLightPosition.x, uLightPosition.y, top),
      bottom: new vec3(uLightPosition.x, uLightPosition.y, bottom),
      size: uLightSize
    });
  }

  /* ----- NOTE: Penumbras ----- */

  /**
   * @param {Light} light
   * @param {Wall} wall
   * @param {int} idx     Which wall endpoint corresponds to this penumbra
   * @returns {ShadowDirectionsGLSLStruct} Direction from the endpoint away from the light for umbra, mid, and penumbra.
   */
  calculateSidePenumbraDirection(light, wall, idx) {
    const Ray2d = Ray2dGLSLStruct;

    const w = wall.top[idx]; // Wall endpoint from which a penumbra is cast.
    const umbraL = idx === 0 ? light.lr0 : light.lr1; // Outer light 0 --> to endpoint 0 is umbra
    const penumbraL = idx === 0 ? light.lr1 : light.lr0; // Inner light 1 --> to endpoint 0 is penumbra

    // Direction from light --> wall endpoint.
    return new ShadowDirectionsGLSLStruct({
      umbra: normalizedDirection(umbraL, w),
      midpenumbra: normalizedDirection(light.center, w),
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
  calculateNearFarPenumbraDirection(light, wall, far, idx) {
    let w; // Wall endpoint from which a penumbra is cast.
    let umbraLight;
    let penumbraLight;
    if ( far ) {
      w = wall.top[idx];
      umbraLight = light.top;
      penumbraLight = light.bottom;
    } else {
      w = wall.bottom[idx];
      umbraLight = light.bottom;
      penumbraLight = light.top;
    }
    return new ShadowDirectionsGLSLStruct({
      umbra: normalizedDirection(umbraLight, w), // Umbra
      midpenumbra: normalizedDirection(light.center, w), // Mid
      penumbra: normalizedDirection(penumbraLight, w) // Penumbra
    });
  }

  /**
   * Mimic calculations done in the vertex shader.
   */
  vertexCalculations(gl_VertexID = 0) {
    const wall = this.wall;
    const light = this.light;
    const sidePenumbraDirs = this.sidePenumbraDirs;
    const farPenumbraDirs = this.farPenumbraDirs;
    const nearPenumbraDirs = this.nearPenumbraDirs;
    return super.vertexCalculations(gl_VertexID);
  }

  /**
   * Mimic the fragment calculations at a specific point.
   * @param {Point} pt
   */
  fragmentCalculations(pt) {
    return super.fragmentCalculations(pt);
  }

}

/**
 * Based on SizedPointSourceShadowWallShader.
 * Represents a single wall calculation.
 * 3 vertices: light, ix for corner 1, ix for corner 2.
 * Wall shadow with side, near, and far penumbra
 */
export class DirectionalSourceShadowWallVertexShaderTest extends ShadowWallVertexShaderTest {

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
  get sidePenumbraDirs() {
    const { wall } = this;
    return [
      this.calculateSidePenumbraDirection(wall, 0),
      this.calculateSidePenumbraDirection(wall, 1)
    ];
  }

  /** @type {ShadowDirections[2]} */
  get farPenumbraDirs() {
    const { sidePenumbraDirs } = this;
    return [
      this.calculateFarPenumbraDirection(sidePenumbraDirs[0].midpenumbra, 0),
      this.calculateFarPenumbraDirection(sidePenumbraDirs[1].midpenumbra, 1)
    ];
  }

  /** @type {ShadowDirections[2]} */
  get nearPenumbraDirs() {
    const { sidePenumbraDirs } = this;
    return [
      this.calculateNearPenumbraDirection(sidePenumbraDirs[0].midpenumbra, 0),
      this.calculateNearPenumbraDirection(sidePenumbraDirs[1].midpenumbra, 1)
    ];
  }

  /* ----- NOTE: Penumbras ----- */

  /**
   * The rays from the wall endpoint along the side.
   * @param {int} idx     Which wall endpoint corresponds to this penumbra
   * @returns {ShadowDirectionsGLSLStruct} Direction from the endpoint away from the light for umbra, mid, and penumbra.
   */
  calculateSidePenumbraDirection(wall, idx = 0) {
    const orient = foundry.utils.orient2dFast;
    const sign = Math.sign;
    const { uAzimuth, uElevationAngle } = this.uniforms;
    const { solarAngle } = this;

    // Direction from endpoint toward the light
    const lightDirection2d = fromAngle(new vec2(0.0), uAzimuth, 1.0).normalize();

    // Reverse for determining penumbra
    const dirMidPenumbra = lightDirection2d.multiplyScalar(-1.0);

    // Determine which side of the wall the light is on.
    const oWallLight = sign(orient(wall.top[0].xy, wall.top[1].xy, wall.top[0].xy.add(lightDirection2d)));

    // Adjust azimuth by the solarAngle.
    // Determine the direction of the outer penumbra rays from light --> wallCorner1 / wallCorner2.
    // The angle for the penumbra is the azimuth ± the solarAngle.
    const solarWallAngle = solarAngle * oWallLight;
    const multiplier = idx === 0 ? 1.0 : -1.0;
    const dirPenumbra = fromAngle(new vec2(0.0), uAzimuth + (solarWallAngle * multiplier), 1.0).multiplyScalar(-1.0);
    const dirUmbra = fromAngle(new vec2(0.0), uAzimuth - (solarWallAngle * multiplier), 1.0).multiplyScalar(-1.0);
    // Unneeded? const dirMidPenumbra = fromAngle(new vec2(0.0), uAzimuth, 1.0).multiplyScalar(-1.0);

    // Calculate the change in z for the light direction based on differing solar angles.
    const zFar = new Array(3);
    zFar[UMBRA] = this.zChangeForElevationAngle(uElevationAngle + solarAngle); // Light top
    zFar[MIDPENUMBRA] = this.zChangeForElevationAngle(uElevationAngle); // Light middle
    zFar[PENUMBRA] = this.zChangeForElevationAngle(uElevationAngle - solarAngle); // Light bottom

    // Normalize based on the mid penumbra for corner 0
    return new ShadowDirectionsGLSLStruct({
      umbra: (new vec3(dirUmbra, zFar[UMBRA])).normalize(),
      midpenumbra: (new vec3(dirMidPenumbra, zFar[MIDPENUMBRA])).normalize(),
      penumbra: (new vec3(dirPenumbra, zFar[PENUMBRA])).normalize()
    });
  }

  /**
   * The rays from the wall top endpoint away from the light.
   * @param {int} idx     The wall endpoint associated with this penumbra
   * @returns {ShadowDirectionsGLSLStruct}
   */
  calculateFarPenumbraDirection(dirMidSidePenumbra, idx = 0) {
    const zDelta = this._calculateZChangeRays();
    return new ShadowDirectionsGLSLStruct({
      umbra: new vec3(dirMidSidePenumbra.xy, zDelta[UMBRA]),
      midpenumbra: new vec3(dirMidSidePenumbra.xy, zDelta[MIDPENUMBRA]),
      penumbra: new vec3(dirMidSidePenumbra.xy, zDelta[PENUMBRA])
    });
  }

  /**
   * The rays from the wall bottom endpoint away from the light.
   * @param {int} idx     The wall endpoint associated with this penumbra
   * @returns {ShadowDirectionsGLSLStruct}
   */
  calculateNearPenumbraDirection(dirMidSidePenumbra, idx = 0) {
    const zDelta = this._calculateZChangeRays();
    return new ShadowDirectionsGLSLStruct({
      umbra: new vec3(dirMidSidePenumbra.x, dirMidSidePenumbra.y, zDelta[PENUMBRA]),
      midpenumbra: new vec3(dirMidSidePenumbra.x, dirMidSidePenumbra.y, zDelta[MIDPENUMBRA]),
      penumbra: new vec3(dirMidSidePenumbra.x, dirMidSidePenumbra.y, zDelta[UMBRA])
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
    const pt = fromAngle(new vec2(0.0), elevationAngle, 1.0);

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
    const sidePenumbraDirs = this.sidePenumbraDirs;
    const farPenumbraDirs = this.farPenumbraDirs;
    const nearPenumbraDirs = this.nearPenumbraDirs;
    return super.vertexCalculations(gl_VertexID);
  }

  /**
   * Mimic the fragment calculations at a specific point.
   * @param {Point} pt
   */
  fragmentCalculations(pt) {
    return super.fragmentCalculations(pt);
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
  SizedPointSourceShadowWallVertexShaderTest,
  DirectionalSourceShadowWallVertexShaderTest } = api.testing

l = canvas.lighting.placeables[0];
edge0 = canvas.walls.placeables[0].edge
edge1 = canvas.walls.placeables[1].edge
ev = l.lightSource.elevatedvision
UMBRA = 0;
PENUMBRA = 1;
MIDPENUMBRA = 2;

// shader0 = SizedPointSourceShadowWallVertexShaderTest.fromEdgeAndSource(edge0, l.lightSource)
// shader1 = SizedPointSourceShadowWallVertexShaderTest.fromEdgeAndSource(edge1, l.lightSource)

let [shader0, shader1] = SizedPointSourceShadowWallVertexShaderTest.fromMesh(ev.shadowMesh)
let [shader2, shader3] = SizedPointSourceShadowWallVertexShaderTest.fromMesh(ev.shadowMesh)
let [shader4, shader5] = SizedPointSourceShadowWallVertexShaderTest.fromMesh(ev.shadowMesh)

let [shader0, shader1] = DirectionalSourceShadowWallVertexShaderTest.fromMesh(ev.shadowMesh)
let [shader2, shader3] = DirectionalSourceShadowWallVertexShaderTest.fromMesh(ev.shadowMesh)

// Set alt shaders to elevation 0 to compare with changing ratios
shader2.uniforms.uElevationRes[0] = 0
shader3.uniforms.uElevationRes[0] = 0

shader2.uniforms.uElevationRes[0] = -999
shader4.uniforms.uElevationRes[0] = -998

shader0.vertexCalculations(2)
shader0.drawTriangle(0)
shader0.drawTriangle(1)
shader0.drawTriangle(2)
shader0.drawFarLines()
shader0.drawNearLines()

shader0.drawFarLines(0)
shader0.drawNearLines(0)

shader0.drawFar()
shader0.drawNear()

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

shader0.

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

ixBase = new vec3()
ix500 = new vec3()
ix0 = new vec3()
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
ixBase = new vec3()
ix500 = new vec3()
ix0 = new vec3()
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
P = new vec2(pt.x, pt.y)
baryABC = barycentric(P, A, B, C)
baryDEF = barycentric(P, D, E, F)

ratio = Math.pow(PIXI.Point.distanceBetween(A, B) / PIXI.Point.distanceBetween(D, E), 2)
ratio = Math.pow(PIXI.Point.distanceBetween(D, E) / PIXI.Point.distanceBetween(A, B), 2)

PIXI.Point.distanceBetween(D, E) = Math.sqrt(ratio) * PIXI.Point.distanceBetween(A, B)

P_DEF = invertBarycentric(umbraTri2, baryABC)

baryABC.multiplyScalar(ratio)

bary.x === 1 at the light center; 0 at the far penumbra edge


ratio = Math.pow(PIXI.Point.distanceBetween(D, E) / PIXI.Point.distanceBetween(A, B), 2)
tmp = a.towardsPoint(b, Math.sqrt(ratio) * PIXI.Point.distanceBetween(A, B)); // this is just a.towardsPoint(b, PIXI.Point.distanceBetween(D, E))
barycentric(tmp, A, B, C); // Gives the x value for which the line is crossed for A, B, C at elevation


wallRatio = shader0.fWallRatio
baryABC.x + (heightFraction * wallRatio) - (heightFraction * baryABC.x)


*/
