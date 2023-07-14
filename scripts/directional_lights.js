/* globals
AmbientLight,
canvas,
flattenObject,
LightSource,
PIXI
PreciseText
*/
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { DirectionalSourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";
import { ShadowWallDirectionalSourceMesh } from "./glsl/ShadowWallShader.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { Draw } from "./geometry/Draw.js";


/* RenderedPointSource mesh geometry workflow

drawMeshes
 --> For each layer, #drawMesh

_configure
 --> initalizeShader = this.#initializeMeshes
 --> if initalizeShaders || change --> this.#initalizeShaders

#initializeShaders
  --> Hooks.callAll(`initialize${this.constructor.name}Shaders`, this)

#initializeMeshes
  --> #updateGeometry
  --> this.#createMeshes

#updateGeometry
  --> this.#geometry = new PolygonMesher().triangulate(this.#geometry)

#createMeshes
  --> _configureShaders
  --> For each layer, #createMesh

#createMesh
  --> mesh = new PointSourceMesh(this.#geometry)

*/


// Directional Light
// Assumed to be infinitely far, like a sun, and so causes directional shadows only.
// Similar to GlobalLightSource in that it overrides the polygon shape.
export class DirectionalLightSource extends LightSource {

  /** @type {boolean} */
  isDirectional = true;

  /** @override */
  _createPolygon() {
    return canvas.dimensions.rect.toPolygon();
  }

  /**
   * Holds a grid delineating elevation angle breaks that can be displayed when hovering over or
   * dragging the source.
   * @type {PIXI.Graphics}
   */
  static _elevationAngleGrid = new PIXI.Graphics();

  static #guideAngles = [0, 10, 20, 30, 40, 50, 60, 70, 80].map(d => Math.toRadians(d));

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
    this.data.solarAngle = Math.toRadians(this.object.document.getFlag(MODULE_ID, FLAGS.DIRECTIONAL_LIGHT.SOLAR_ANGLE)
      ?? 1);

    // Set the x,y position to an edge of canvas based on the azimuth.
    const { rect, maxR } = canvas.dimensions;
    const center = rect.center;
    const projPt = PIXI.Point.fromAngle(center, azimuth, maxR);
    const ix = rect.segmentIntersections(center, projPt)[0];
    this.data.x = ix.x;
    this.data.y = ix.y;
  }

  /**
   * Draw a set of rectangles displaying the elevation angles at 10º spaces along the canvas.
   */
  static _refreshElevationAngleGuidelines() {
    this._elevationAngleGrid.removeChildren();

    const draw = new Draw(this._elevationAngleGrid);
    draw.clearDrawings();
    const center = canvas.dimensions.rect.center;
    const color = Draw.COLORS.white;
    const width = 2;
    const azimuth = {
      north: Math.PI * 1.5,
      south: Math.PI_1_2,
      east: 0,
      west: Math.PI
    };

    const guideTextContainer = this._elevationAngleGrid.addChild(new PIXI.Container());

    for ( const elevationAngle of this.#guideAngles ) {
      // Find the point due east.
      const east = this.positionFromDirectionalParameters(azimuth.east, elevationAngle);
      const width1_2 = east.x - center.x;
      const r = new PIXI.Rectangle(center.x - width1_2, center.y - width1_2, width1_2 * 2, width1_2 * 2);
      draw.shape(r, { color, width });

      // Add text
      // (For mysterious reasons, adding the text to 4 containers at different positions fails.)
      // (It draws the text only in the last container added.)


      // Add text in all 4 directions by adding the text to 4 distinct containers.
      for ( const compassDirection of Object.keys(azimuth) ) {
        const text = this._drawGuideText(`${Math.round(Math.toDegrees(elevationAngle))}º⦞`);
        const c = guideTextContainer.addChild(new PIXI.Container());
        c.addChild(text);

        const position = this.positionFromDirectionalParameters(azimuth[compassDirection], elevationAngle);
        c.position.copyFrom(position);

        // TODO: Move to align better with the grid
      }
    }
  }

  /**
   * Draw the text used when displaying the elevation angle guide
   */
  static _drawGuideText(text) {
    const style = AmbientLight._getTextStyle();
    const tip = new PreciseText(text, style);
    tip.anchor.set(0.5, 0.5);

  // From #drawControlIcon
  //     const size = Math.max(Math.round((canvas.dimensions.size * 0.5) / 20) * 20, 40);
  //     tip.position.set(0, 0);
    return tip;
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
   * When shaders are initialized, swap out the lighting geometry for a quad.
   * Trick the light shader into thinking its center point is at the edge of the canvas.
   */
  _initializeEVShadows() {
    super._initializeEVShadows();
    // console.log("DirectionalLight _initializeEVShadows.");
  }

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
  _initializeEVShadowMesh() {
    const ev = this[MODULE_ID];
    if ( ev.shadowRenderer ) return;

    // Mesh that describes shadows for the given geometry and source origin.
    ev.shadowMesh = new ShadowWallDirectionalSourceMesh(this, ev.wallGeometry);
  }

  /**
   * Use the RenderedPointSource.prototype._initializeEVShadowMask
   */

  /**
   * Update shadow data when the light is moved or solarAngle is updated.
   */
  _updateEVShadowData(changes) {
    const ev = this[MODULE_ID];

    if ( Object.hasOwn(changes, "x") || Object.hasOwn(changes, "y") ) {
      ev.wallGeometry.refreshWalls();
      ev.shadowMesh.updateAzimuth();
      ev.shadowMesh.updateElevationAngle();
      ev.shadowRenderer.update();
    }

    if ( Object.hasOwn(changes, "solarAngle") ) {
      ev.shadowMesh.updateSolarAngle();
      ev.shadowRenderer.update();
    }
  }
}


// Patches for AmbientLight


/**
 * Hook AmbientLight hover in and hover out
 * Display the elevation angle grid when hovering over a directional light.
 * @param {AmbientLight} light  The light object for which the hover applies.
 * @param {boolean} hover       True if hover started.
 */
export function hoverAmbientLightHook(light, hover) {
  if ( !light.source.isDirectional ) return;
  if ( hover ) canvas.lighting.addChild(DirectionalLightSource._elevationAngleGrid);
  else canvas.lighting.removeChild(DirectionalLightSource._elevationAngleGrid);
}

/**
 * New method: AmbientLight.prototype.convertToDirectionalLight
 */
export function convertToDirectionalLightAmbientLight() {
  if ( this.source.isDirectional ) return;

  this.updateSource({ deleted: true });
  this.document.setFlag(MODULE_ID, FLAGS.DIRECTIONAL_LIGHT.ENABLED, true);
  this.source = new DirectionalLightSource({object: this});
  this.updateSource();
}

/**
 * New method: AmbientLight.prototype.convertFromDirectionalLight
 */
export function convertFromDirectionalLightAmbientLight() {
  if ( !this.source.isDirectional ) return;

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
  const keys = new Set(Object.keys(changes));

  const isDirectionalFlag = `flags.${MODULE_ID}.directionalLight`;
  if ( keys.has(isDirectionalFlag) ) changes[isDirectionalFlag] // eslint-disable-line no-unused-expressions
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
