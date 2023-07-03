/* globals
AmbientLight,
canvas,
duplicate,
game,
LightSource,
PIXI
PlaceablesLayer
*/
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { SourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";
import { ShadowWallPointSourceMesh } from "./glsl/ShadowWallShader.js";
import { ShadowVisionLOSTextureRenderer } from "./glsl/ShadowTextureRenderer.js";
import { ShadowVisionMaskTokenLOSShader } from "./glsl/ShadowVisionMaskShader.js";
import { EVQuadMesh } from "./glsl/EVQuadMesh.js";


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
  }

  /**
   * The direction from which the light is coming.
   * Follows Foundry convention that 0 is east, 90º is south.
   * (Normally, azimuth is 0º when sun is to the north.)
   * @type {number} Between 0º and 360º
   */
  get azimuth() { return this.data.azimuth; }

  /**
   * Elevation angle from the horizon.
   * 0º is at the horizon, 90º is directly overhead.
   * @type {number} Between 0º and 90º
   */
  get elevationAngle() { return this.data.elevationAngle; }

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
    const azimuth = Math.normalizeDegrees(Math.toDegrees(angle));

    // Calculate elevation angle based on distance from center.
    // 90º when at the center.
    const maxDist = Math.min(rect.width, rect.height);
    const proportion = 1 - (PIXI.Point.distanceBetween(position, center) / maxDist);
    const elevationAngle = mix(0, 45, proportion);

    return { azimuth, elevationAngle };
  }

  // NOTE: EV Shadows

  /**
   * Use SourceShadowWallGeometry, which does not restrict based on source bounds.
   * While there is a radius, it is pointless to test for it b/c we are including all walls.
   */
  _initializeEVShadowGeometry() {
    const ev = this[MODULE_ID];
    ev.wallGeometry ??= new SourceShadowWallGeometry(this);
  }

  /**
   * Use RenderedPointSource.prototype._initializeEVShadowTexture
   */


  /**
   * Use the RenderedPointSource.prototype._initializeEVShadowMask
   */

}


// Patches for AmbientLight

/**
 * New method: AmbientLight.prototype.convertToDirectionalLight
 */
export function convertToDirectionalLightAmbientLight() {
  if ( this.source instanceof DirectionalLightSource ) return;

  this.updateSource({ deleted: true });
  this.document.setFlag(MODULE_ID, FLAGS.DIRECTIONAL_LIGHT, true);
  this.source = new DirectionalLightSource({object: this});
  this.updateSource();
}

/**
 * New method: AmbientLight.prototype.convertFromDirectionalLight
 */
export function convertFromDirectionalLightAmbientLight() {
  if ( this.source instanceof LightSource ) return;

  this.updateSource({ deleted: true });
  this.document.setFlag(MODULE_ID, FLAGS.DIRECTIONAL_LIGHT, false);
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
 * Linear interpolation of x and y numeric values based on "a" weight. Comparable to GLSL mix function.
 * @param {number} x    Start of range
 * @param {number} y    End of range
 * @param {number} a    Percentage between 0 and 1
 * @returns {number}
 */
function mix(x, y, a) {
  return (x * (1 - a)) + (y * a);
}


function replaceAmbientLightSourceWithDirectional(light) {
  light.updateSource({ deleted: true });
  light.source = new DirectionalLightSource({object: light});
  light.updateSource();


  light.updateSource({ deleted: true });
  light.source = new LightSource({object: light});
  light.updateSource();


  const ds = DirectionalLightSource.fromLightSource(light.source);
  light.updateSource({ deleted: true });
  light.source = ds;
  light.updateSource();
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
