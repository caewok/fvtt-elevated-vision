/* globals
canvas,
LightSource,
PIXI
*/
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { DirectionalSourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";
import { ShadowWallDirectionalSourceMesh } from "./glsl/ShadowWallShader.js";
import { ShadowTextureRenderer } from "./glsl/ShadowTextureRenderer.js";
import { Point3d } from "./geometry/3d/Point3d.js";


// Directional Light
// Assumed to be infinitely far, like a sun, and so causes directional shadows only.
// Similar to GlobalLightSource in that it overrides the polygon shape.
export class DirectionalLightSource extends LightSource {

  /** @override */
  _createPolygon() {
    return canvas.dimensions.rect.toPolygon();
  }

  /** @override */
  _initialize(data) {
    super._initialize(data);
    // Force attenuation to 0
    this.data.attenuation = 0;

    // Set radius to the maximum diagonal.
    this.data.radius = canvas.dimensions.maxR;

    const { azimuth, elevationAngle } = this.constructor.directionalParametersFromPosition(this.data);
    this.data.azimuth = azimuth;
    this.data.elevationAngle = elevationAngle;

    this.data.solarAngle = this.object.document.getFlag(MODULE_ID, FLAGS.DIRECTIONAL_LIGHT.SOLAR_ANGLE) ?? Math.toRadians(1);
  }

  /**
   * The direction from which the light is coming.
   * Follows Foundry convention that 0 is east, 90º is south.
   * (Normally, azimuth is 0º when sun is to the north.)
   * @type {number} Between 0º and 360º, in radians
   */
  get azimuth() { return this.data.azimuth; }

  /**
   * Elevation angle from the horizon.
   * 0º is at the horizon, 90º is directly overhead.
   * @type {number} Between 0º and 90º, in radians
   */
  get elevationAngle() { return this.data.elevationAngle; }

  /**
   * Source elevation infinitely high.
   */
  get elevationE() { return Number.POSITIVE_INFINITY; }

  /**
   * Perceived angle of the light on the surface. Used for constructing penumbra.
   * A smaller angle means smaller penumbra.
   * @type {number}
   */
  get solarAngle() { return this.data.solarAngle; }

  /**
   * Calculate azimuth and elevation based on position of the light.
   * elevationAngle decreases proportionally based on distance from the center.
   * Uses the smallest of canvas width or height to determine the full radius.
   * Azimuth set based on angle measured from canvas center.
   * @param {PIXI.Point} position
   * @returns { azimuth: {number}, elevationAngle: {number} }
   */
  static directionalParametersFromPosition(position) {
    position = PIXI.Point.fromObject(position);

    // Calculate azimuth based on the angle of the ray from center --> position.
    const rect = canvas.dimensions.rect;
    const center = rect.center;
    const delta = position.subtract(center);
    const angle = Math.atan2(delta.y, delta.x);
    const azimuth = Math.normalizeRadians(angle);

    // Calculate elevation angle based on distance from center.
    // 90º when at the center.
    // Use grid-based measurements so the elevationAngle stays the same for similar grid locations.
    const maxDist = Math.min(rect.width, rect.height) * 0.5;
    const positionDist = Math.max(Math.abs(delta.x), Math.abs(delta.y));
    const proportion = Math.clamped(1 - (positionDist / maxDist), 0, 1);
    const elevationAngle = mix(0, Math.PI_1_2, proportion);

    return { azimuth, elevationAngle };
  }

  /**
   * Inverse of directionalParametersFromPosition.
   * @param {number} azimuth          In radians
   * @param {number} elevationAngle   In radians
   * @returns {PIXI.Point}
   */
  static positionFromDirectionalParameters(azimuth, elevationAngle) {
    azimuth = Math.normalizeRadians(azimuth);
    elevationAngle = Math.normalizeRadians(elevationAngle);
    elevationAngle = Math.clamped(elevationAngle, 0, Math.PI_1_2);

    // Calculate distance from the center based on elevationAngle.
    const rect = canvas.dimensions.rect;
    const maxDist = Math.min(rect.width, rect.height) * 0.5;
    const proportion = Math.clamped(1 - (elevationAngle / Math.PI_1_2), 0, 1);
    const dist = proportion * maxDist;
    const center = rect.center;
    if ( dist === 0 ) return PIXI.Point.fromObject(center);

    // Project using azimuth angle for the calculated distance from center.
    const projPt = PIXI.Point.fromAngle(center, azimuth, canvas.dimensions.maxR);

    // Intersect the square for this grid distance with this projected line.
    const distRect = new PIXI.Rectangle(center.x - dist, center.y - dist, dist * 2, dist * 2);
    const ixs = distRect.segmentIntersections(center, projPt);
    return PIXI.Point.fromObject(ixs[0]).roundDecimals();
  }

  /**
   * Vector representing the light direction.
   * From a point on the canvas toward the light.
   * @param {number} azimuth          Canvas x/y light angle, in radians, between 0 and 360º
   * @param {number} elevationAngle   Canvas z angle of the light, in radians, between 0 and 90º
   * @returns {Point3d} Direction vector sized to 1 unit. (Not necessarily normalized.)
   */
  static lightDirection(azimuth, elevationAngle) {
    // Round values that are very nearly 0 or very nearly 1
    const fn = (x, e = 1e-10) => x.almostEqual(0, e) ? 0 : x.almostEqual(1, e) ? 1 : x;

    // Determine the increase in z (contained in y)
    const startPt = new PIXI.Point(0, 0);
    const zPt = PIXI.Point.fromAngle(startPt, elevationAngle, 1);
    zPt.x = fn(zPt.x);
    zPt.y = fn(zPt.y);

    // Pointed straight up?
    if ( zPt.x === 0 ) return new Point3d(0, 0, 1);

    // Determine the change in x,y and add on the z
    const pt = Point3d.fromAngle(startPt, azimuth, 1, fn(zPt.y / zPt.x));
    pt.x = fn(pt.x);
    pt.y = fn(pt.y);
    return pt;
  }

  get lightDirection() { return this.constructor.lightDirection(this.azimuth, this.elevationAngle); }

  // NOTE: EV Shadows

  /**
   * Use DirectionalSourceShadowWallGeometry, which does not restrict based on source bounds.
   * While there is a radius, it is pointless to test for it b/c we are including all walls.
   */
  _initializeEVShadowGeometry() {
    const ev = this[MODULE_ID];
    ev.wallGeometry ??= new DirectionalSourceShadowWallGeometry(this);
  }

  /**
   * Construct a directional mesh, using the directional wall shader.
   */
  _initializeEVShadowTexture() {
    const ev = this[MODULE_ID];
    if ( ev.shadowRenderer ) return;

    // Mesh that describes shadows for the given geometry and source origin.
    ev.shadowMesh = new ShadowWallDirectionalSourceMesh(this, ev.wallGeometry);

    // Force a uniform update, to avoid ghosting of placeables in the light radius.
    // TODO: Find the underlying issue and fix this!
    // Must be a new uniform variable (one that is not already in uniforms)
    this.layers.background.shader.uniforms.uEVtmpfix = 0;
    this.layers.coloration.shader.uniforms.uEVtmpfix = 0;
    this.layers.illumination.shader.uniforms.uEVtmpfix = 0;

    // Render texture to store the shadow mesh for use by other shaders.
    ev.shadowRenderer = new ShadowTextureRenderer(this, ev.shadowMesh);
    ev.shadowRenderer.renderShadowMeshToTexture(); // TODO: Is this necessary here?
  }

  /**
   * Use the RenderedPointSource.prototype._initializeEVShadowMask
   */

  /**
   * Update shadow data when the light is moved.
   */
  _updateEVShadowData({ changedPosition }) {
    const ev = this[MODULE_ID];
    if ( !changedPosition || !ev || !ev.wallGeometry ) return;

    // TODO: Need to monitor for change to lightSizeProjected.

    ev.wallGeometry.refreshWalls();
    ev.shadowMesh.updateLightDirection();
    ev.shadowRenderer.update();
  }

}


// Patches for AmbientLight

/**
 * New method: AmbientLight.prototype.convertToDirectionalLight
 */
export function convertToDirectionalLightAmbientLight() {
  if ( this.source instanceof DirectionalLightSource ) return;

  this.updateSource({ deleted: true });
  this.document.setFlag(MODULE_ID, FLAGS.DIRECTIONAL_LIGHT.ENABLED, true);
  this.source = new DirectionalLightSource({object: this});
  this.updateSource();
}

/**
 * New method: AmbientLight.prototype.convertFromDirectionalLight
 */
export function convertFromDirectionalLightAmbientLight() {
  if ( !(this.source instanceof DirectionalLightSource) ) return;

  this.updateSource({ deleted: true });
  this.document.setFlag(MODULE_ID, FLAGS.DIRECTIONAL_LIGHT.ENABLED, false);
  this.source = new LightSource({object: this});
  this.updateSource();
}

/**
 * Wrap AmbientLight.prototype.clone
 * Change the light source if cloning a directional light.
 * Needed to switch out the light source to directional for the clone, when dragging.
 * @returns {PlaceableObject}  A new object with identical data
 */
export function cloneAmbientLight(wrapped) {
  const clone = wrapped();
  if ( this.source instanceof DirectionalLightSource ) clone.convertToDirectionalLight();
  return clone;
}

/**
 * Wrap AmbientLight.prototype._onUpdate
 * If changing to/from directional source, update the source accordingly.
 */
export function _onUpdateAmbientLight(wrap, data, options, userId) {
  const changes = flattenObject(data);
  const keys = new Set(Object.keys(changes))

  const isDirectionalFlag = `flags.${MODULE_ID}.directionalLight`
  if ( keys.has(isDirectionalFlag) ) changes[isDirectionalFlag]
    ? this.convertToDirectionalLight() : this.convertFromDirectionalLight();

  // TODO: Do renderFlags need to be set here?

  return wrap(data, options, userId);
}


/**
 * Linear interpolation of x and y numeric values based on "a" weight. Comparable to GLSL mix function.
 * @param {number} x    Start of range
 * @param {number} y    End of range
 * @param {number} a    Percentage between 0 and 1
 * @returns {number}
 */
function mix(x, y, a) {
  return (x * (1 - a)) + (y * a);
}


/* Testing
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get("elevatedvision").api
PointSourceShadowWallGeometry = api.PointSourceShadowWallGeometry
defineFunction = api.defineFunction;
AbstractEVShader = api.AbstractEVShader
ShadowWallShader = api.ShadowWallShader
ShadowWallPointSourceMesh = api.ShadowWallPointSourceMesh
TestGeometryShader = api.TestGeometryShader
ShadowTextureRenderer = api.ShadowTextureRenderer
DirectionalLightSource = api.DirectionalLightSource

let [light] = canvas.lighting.placeables
*/
