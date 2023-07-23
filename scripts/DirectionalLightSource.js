/* globals
AmbientLight,
canvas,
LightSource,
PIXI
PreciseText
*/
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { DirectionalSourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";
import { DirectionalShadowWallShader, ShadowMesh } from "./glsl/ShadowWallShader.js";
import { ShadowVisionMaskTokenLOSShader } from "./glsl/ShadowVisionMaskShader.js";
import { EVQuadMesh } from "./glsl/EVQuadMesh.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { Draw } from "./geometry/Draw.js";
import { pointCircleCoord } from "./util.js";


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

  /** @type {object} */
  _originalGeometryBuffers = {
    background: undefined,
    coloration: undefined,
    illumination: undefined
  };

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

  /** @override */
  _configure(changes) {
    Object.entries(this.layers).forEach(([layerId, layer]) => this._restoreGeometryBuffers(layerId, layer));
    super._configure(changes);

    // Store the buffers, replace the geometry buffers and update.
    Object.entries(this.layers).forEach(([layerId, layer]) => this._storeGeometryBuffers(layerId, layer));

    const geomBuffers = this._geometryBuffers();
    Object.entries(this.layers).forEach(([layerId, layer]) =>
      this._replaceGeometryBuffers(layerId, layer, geomBuffers));
  }

  /**
   * Store a copy of the original geometry buffers
   */
  _storeGeometryBuffers(layerId, layer) {
    const g = layer.mesh?.geometry;
    if ( !g ) {
      this._originalGeometryBuffers[layerId] = undefined;
      return;
    }

    const storedObj = this._originalGeometryBuffers[layerId] = {};
    for ( const attrName of Object.keys(g.attributes) ) {
      const buffer = g.getBuffer(attrName);
      storedObj[attrName] = buffer.data;
    }

    storedObj.indexBuffer = g.indexBuffer.data;
  }

  /**
   * Copy the stored geometry buffers to the mesh geometry (temporarily).
   */
  _restoreGeometryBuffers(layerId, layer) {
    const storedObj = this._originalGeometryBuffers[layerId];
    if ( !storedObj ) return;

    const g = layer.mesh?.geometry;
    if ( !g ) return;

    for ( const attrName of Object.keys(g.attributes) ) {
      const buffer = g.getBuffer(attrName);
      buffer.data = storedObj[attrName];
    }

    const buffer = g.indexBuffer;
    buffer.data = storedObj.indexBuffer;
  }

  /**
   * Replace the buffers with the stored version. Signal a buffer update.
   */
  _replaceGeometryBuffers(layerId, layer, newBuffers = this._geometryBuffers()) {
    const g = layer.mesh?.geometry;
    if ( !g ) return;

    for ( const attrName of Object.keys(g.attributes) ) {
      const buffer = g.getBuffer(attrName);
      // Force not static?
      buffer.static = false;
      buffer.data = newBuffers[attrName];
      buffer.update();
    }

    // Force not static?
    g.indexBuffer.static = false;
    g.indexBuffer.data = newBuffers.indexBuffer;
    g.indexBuffer.update();
  }

  /**
   * Construct geometry buffers for the directional light.
   * Quad shape with the light assumed to be on the border.
   * Normalized values from that point.
   */
  _geometryBuffers() {
    const rect = canvas.dimensions.rect;
    const { left, right, top, bottom, center } = rect;
    const aTextureCoord = [
      0, 0, // TL
      1, 0, // TR
      1, 1, // BR
      0, 1 // BL
    ];
    const aDepthValue = Array(8).fill(1);
    const indexBuffer = [0, 1, 2, 0, 2, 3];

    // Determine the position of the light on the edge of the canvas rectangle.
    const projPt = PIXI.Point.fromAngle(center, this.azimuth, canvas.dimensions.maxR);
    const ixs = rect.segmentIntersections(center, projPt);
    const ix = PIXI.Point.fromObject(ixs[0]).roundDecimals();

    // Normalize the rectangle coordinates inside the light circle, where 0,0 is the light center.
    const radius = this.radius;
    const invRadius = 1 / this.radius;
    const TL = pointCircleCoord(new PIXI.Point(left, top), ix, radius, invRadius);
    const TR = pointCircleCoord(new PIXI.Point(right, top), ix, radius, invRadius);
    const BR = pointCircleCoord(new PIXI.Point(right, bottom), ix, radius, invRadius);
    const BL = pointCircleCoord(new PIXI.Point(left, bottom), ix, radius, invRadius);
    const aVertexPosition = [
      TL.x, TL.y,      // TL
      TR.x, TR.y,   // TR
      BR.x, BR.y, // BR
      BL.x, BL.y  // BL
    ];

    return {
      aVertexPosition: new Float32Array(aVertexPosition),
      aTextureCoord: new Float32Array(aTextureCoord),
      aDepthValue: new Float32Array(aDepthValue),
      indexBuffer: new Uint16Array(indexBuffer)
    };
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
   * @returns {Point3d} Normalized direction vector.
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
    return pt.normalize();
  }

  get lightDirection() { return this.constructor.lightDirection(this.azimuth, this.elevationAngle); }

  // NOTE: EV Shadows

  /**
   * Use DirectionalSourceShadowWallGeometry, which does not restrict based on source bounds.
   * While there is a radius, it is pointless to test for it b/c we are including all walls.
   */
  _initializeEVShadowGeometry() {
    const ev = this[MODULE_ID];
    if ( ev.wallGeometry ) console.debug("Directional Source Wall geometry already defined.");
    ev.wallGeometry = new DirectionalSourceShadowWallGeometry(this);
  }

  /**
   * Construct a directional mesh, using the directional wall shader.
   */
  _initializeEVShadowMesh() {
    const ev = this[MODULE_ID];
    if ( ev.shadowMesh ) console.debug("Directional Source shadowMesh already defined.");

    // Mesh that describes shadows for the given geometry and source origin.
    const shader = DirectionalShadowWallShader.create(this);
    ev.shadowMesh = new ShadowMesh(ev.wallGeometry, shader);
  }

  // TODO: Probably need distinct terrain shadow mesh for directional.

  /**
   * Mask the entire canvas at once.
   */
  _initializeEVShadowMask() {
    const ev = this[MODULE_ID];
    const shader = ShadowVisionMaskTokenLOSShader.create(this);
    ev.shadowVisionMask = new EVQuadMesh(canvas.dimensions.rect, shader);
  }

  /**
   * Use the RenderedPointSource.prototype._initializeEVShadowMask
   */

  /**
   * Update shadow data when the light is moved or solarAngle is updated.
   */
  _updateEVShadowData(changes, changeObj = {}) {
    if ( Object.hasOwn(changes, "x") || Object.hasOwn(changes, "y") ) {
      changeObj.changedAzimuth = true;
      changeObj.changedElevationAngle = true;
    }
    changeObj.changedSolarAngle = Object.hasOwn(changes, "solarAngle");
    super._updateEVShadowData(changes, changeObj);
  }

  /**
   * Note: hook on destroy already removes the EV objects.
   */
  _destroy() {
    // Prevent the grid from getting stuck "on".
    canvas.lighting.removeChild(DirectionalLightSource._elevationAngleGrid);
    super._destroy();
  }

  /**
   * Detect whether a point is in partial or full shadow based on testing wall collisions.
   * @param {Point3d|object} {x, y, z}    Object with x, y, and z properties. Z optional.
   * @returns {number} Approximate shadow value between 0 (no shadow) and 1 (full shadow).
   */
  pointInShadowRenderedPointSource({x, y, z} = {}) {
    /* Testing
    Point3d = CONFIG.GeometryLib.threeD.Point3d
    Plane = CONFIG.GeometryLib.threeD.Plane
    Draw = CONFIG.GeometryLib.Draw
    let [l] = canvas.lighting.placeables
    source = l.source
    x = _token.center.x
    y = _token.center.y
    z = _token.elevationZ

    // Or
    pt = Point3d.fromToken(_token).bottom
    let { x, y, z } = pt
    */

    z ??= canvas.elevation.elevationAt({x, y});
    const testPt = new Point3d(x, y, z);

    // Project a point out beyond the canvas to stand in for the light position.
    const { azimuth, elevationAngle, solarAngle } = this;
    const midCollision = directionalCollision(this, testPt, azimuth, elevationAngle);

    this.hasWallCollision(origin, testPt);

    /* Draw.point(origin, { color: Draw.COLORS.yellow }) */
    if ( !solarAngle ) return Number(midCollision);

    // Test the top/bottom/left/right points of the light for penumbra shadow.
    const topCollision = directionalCollision(this, testPt, azimuth, elevationAngle + solarAngle);
    const bottomCollision = directionalCollision(this, testPt, azimuth, elevationAngle - solarAngle);
    const side0Collision = directionalCollision(this, testPt, azimuth + solarAngle, elevationAngle);
    const side1Collision = directionalCollision(this, testPt, azimuth - solarAngle, elevationAngle);

    // Shadows: side0/mid/side1 = 100%; side0/mid = 50%; mid/side1 = 50%; any one = 25%
    const sideSum = side0Collision + side1Collision + midCollision;
    let sideShadowPercentage;
    switch ( sideSum ) {
      case 0: sideShadowPercentage = 0; break;
      case 1: sideShadowPercentage = 0.25; break;
      case 2: sideShadowPercentage = 0.50; break;
      case 3: sideShadowPercentage = 1; break;
    }

    const heightSum = topCollision + bottomCollision + midCollision;
    let heightShadowPercentage;
    switch ( heightSum ) {
      case 0: heightShadowPercentage = 0; break;
      case 1: heightShadowPercentage = 0.25; break;
      case 2: heightShadowPercentage = 0.50; break;
      case 3: heightShadowPercentage = 1; break;
    }

    return heightShadowPercentage * sideShadowPercentage;
  }
}

function directionalCollision(source, testPt, azimuth, elevationAngle) {
  const dir = DirectionalLightSource.lightDirection(azimuth, elevationAngle);
  const origin = testPt.add(dir.multiplyScalar(canvas.dimensions.maxR));
  return source.hasWallCollision(origin, testPt);
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
