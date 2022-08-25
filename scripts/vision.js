/* globals
canvas,
GlobalLightSource,
FogManager,
game,
PIXI
*/
"use strict";

import { log, drawPolygonWithHoles, perpendicularPoint, distanceBetweenPoints } from "./util.js";

const MAX_NUM_WALLS = 100;

/** To test a token
drawing = game.modules.get("elevatedvision").api.drawing
drawing.clearDrawings()
_token.vision.los._drawShadows()

*/

// AdaptiveVisionShader extends AdaptiveLightingShader, so need not repeat here.

// _updateColorationUniforms basically same as LightSource
// _updateIlluminationUniforms basically same as LightSource
// _updateEVLightUniforms can be reused from LightSource

/**
 * Wrap VisionSource.prototype._updateColorationUniforms.
 * Add uniforms needed for the shadow fragment shader.
 */
export function _updateColorationUniformsVisionSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;

  log(`_updateColorationUniformsVisionSource ${this.object.id}`);
  this._updateEVVisionUniforms(this.coloration);
  this.coloration.shader.uniforms.EV_isVision = true;
}

/**
 * Wrap VisionSource.prototype._updateIlluminationUniforms.
 * Add uniforms needed for the shadow fragment shader.
 */
export function _updateIlluminationUniformsVisionSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;

  log(`_updateIlluminationUniformsVisionSource ${this.object.id}`);
  this._updateEVVisionUniforms(this.illumination);
  this.illumination.shader.uniforms.EV_isVision = true;
}


/**
 * Helper function to add uniforms for the light shaders.
 * Add:
 * - elevation of the light
 * - number of walls that are in the LOS and below the light source elevation
 * For each wall that is below the light source, add
 *   (in the coordinate system used in the shader):
 * - wall coordinates
 * - wall elevations
 * - distance between the wall and the light source center
 * @param {PIXI.Shader} shader
 */
export function _updateEVVisionUniformsVisionSource(mesh) {
  const shader = mesh.shader;
  const { x, y, elevationZ, radius } = this;
  const { width, height } = canvas.dimensions;

  const walls = this.los.wallsBelowSource || new Set();

  const center = {x, y};
  const r_inv = 1 / radius;
  const u = shader.uniforms;

  // Radius is .5 in the shader coordinates; adjust elevation accordingly
  u.EV_lightElevation = elevationZ * 0.5 * r_inv;
  u.EV_numWalls = walls.size;

  const center_shader = {x: 0.5, y: 0.5};
  let wallCoords = [];
  let wallElevations = [];
  let wallDistances = [];

  for ( const w of walls ) {
    const a = pointCircleCoord(w.A, radius, center, r_inv);
    const b = pointCircleCoord(w.B, radius, center, r_inv);

    // Point where line from light, perpendicular to wall, intersects
    const wallIx = perpendicularPoint(a, b, center_shader);
    if ( !wallIx ) continue; // Likely a and b not proper wall
    const wallOriginDist = distanceBetweenPoints(center_shader, wallIx);
    wallDistances.push(wallOriginDist);
    wallElevations.push(w.topZ * 0.5 * r_inv);

    wallCoords.push(a.x, a.y, b.x, b.y);
  }

  if ( !wallCoords.length ) wallCoords = new Float32Array(MAX_NUM_WALLS*4);
  if ( !wallElevations.length ) wallElevations = new Float32Array(MAX_NUM_WALLS);
  if ( !wallDistances.length ) wallDistances = new Float32Array(MAX_NUM_WALLS);

  u.EV_wallCoords = wallCoords;
  u.EV_wallElevations = wallElevations;
  u.EV_wallDistances = wallDistances;
  u.EV_elevationSampler = canvas.elevation?._elevationTexture;
//   u.EV_isVision = true;

  // Screen-space to local coords:
  // https://ptb.discord.com/channels/732325252788387980/734082399453052938/1010914586532261909
  // shader.uniforms.EV_canvasMatrix ??= new PIXI.Matrix();
  // shader.uniforms.EV_canvasMatrix
  //   .copyFrom(canvas.stage.worldTransform)
  //   .invert()
  //   .append(mesh.transform.worldTransform);

  // Alternative version using vUvs, given that light source mesh have no rotation
  // https://ptb.discord.com/channels/732325252788387980/734082399453052938/1010999752030171136
  u.EV_transform = [
    radius * 2 / width,
    radius * 2 / height,
    (x - radius) / width,
    (y - radius) / height];

  /*
  Elevation of a given pixel from the texture value:
  texture value in the shader is between 0 and 1. Represents value / maximumPixelValue where
  maximumPixelValue is currently 255.

  To get to elevation in the light vUvs space:
  elevationCanvasUnits = (((value * maximumPixelValue * elevationStep) - elevationMin) * size) / distance;
  elevationLightUnits = elevationCanvasUnits * 0.5 * r_inv;
  = (((value * maximumPixelValue * elevationStep) - elevationMin) * size) * inv_distance * 0.5 * r_inv;
  */

  // [min, step, maxPixelValue ]
  if ( !u.EV_elevationSampler ) {
    u.EV_elevationSampler = PIXI.Texture.EMPTY;
    u.EV_hasElevationSampler = false;
  } else {
    const { elevationMin, elevationStep, maximumPixelValue} = canvas.elevation;
    const { distance, size } = canvas.scene.grid;
    const elevationMult = size * (1 / distance) * 0.5 * r_inv;
    u.EV_elevationResolution = [elevationMin, elevationStep, maximumPixelValue, elevationMult];
    u.EV_hasElevationSampler = true;
  }
}


/**
 * Transform a point coordinate to be in relation to a circle center and radius.
 * Between 0 and 1 where [0.5, 0.5] is the center
 * [0, .5] is at the edge in the westerly direction.
 * [1, .5] is the edge in the easterly direction
 * @param {Point} point
 * @param {Point} center
 * @param {number} r      Radius
 * @param {number} r_inv  Inverse of the radius. Optional; for repeated calcs.
 * @returns {Point}
 */
function pointCircleCoord(point, r, center, r_inv = 1 / r) {
  return {
    x: circleCoord(point.x, r, center.x, r_inv),
    y: circleCoord(point.y, r, center.y, r_inv)
  };
}

/**
 * Transform a coordinate to be in relation to a circle center and radius.
 * Between 0 and 1 where [0.5, 0.5] is the center.
 * @param {number} a    Coordinate value
 * @param {number} c    Center value, along the axis of interest
 * @param {number} r    Light circle radius
 * @param {number} r_inv  Inverse of the radius. Optional; for repeated calcs.
 * @returns {number}
 */
function circleCoord(a, r, c = 0, r_inv = 1 / r) {
  return ((a - c) * r_inv * 0.5) + 0.5;
}

/**
 * Inverse of circleCoord.
 * @param {number} p    Coordinate value, in the shader coordinate system between 0 and 1.
 * @param {number} c    Center value, along the axis of interest
 * @param {number} r    Radius
 * @returns {number}
 */
function revCircleCoord(p, r, c = 0) { // eslint-disable-line no-unused-vars
  // Calc:
  // ((a - c) / 2r) + 0.5 = p
  //  ((a - c) / 2r) = p +  0.5
  //  a - c = (p + 0.5) * 2r
  //  a = (p + 0.5) * 2r + c
  return ((p + 0.5) * 2 * r) + c;
}

// Currently no VisionSource.prototype._createLOS.
// So must instead wrap initialize

/**
 * Wrap VisionSource.prototype.initialize
 * Trigger an update to the illumination and coloration uniforms, so that
 * the light reflects the current shadow positions when dragged.
 */
export function initializeVisionSource(wrapped) {
  const out = wrapped();

  // TO-DO: Only reset uniforms if:
  // 1. there are shadows
  // 2. there were previously shadows but are now none

  out._resetUniforms.illumination = true;
  out._resetUniforms.coloration = true;

  return out;
}

/**
 * Override CanvasVisibility.prototype.refresh to handle shadows.
 */

export function refreshCanvasVisibility({forceUpdateFog=false}={}) {
  if ( !this.initialized ) return;
  if ( !this.tokenVision ) {
    this.visible = false;
    return this.restrictVisibility();
  }

  // Stage the priorVision vision container to be saved to the FOW texture
  let commitFog = false;
  const priorVision = canvas.masks.vision.detachVision();
  if ( priorVision._explored ) {
    this.pending.addChild(priorVision);
    commitFog = this.pending.children.length >= FogManager.COMMIT_THRESHOLD;
  }
  else priorVision.destroy({children: true});

  // Create a new vision for this frame
  const vision = canvas.masks.vision.createVision();

  // Draw field-of-vision for lighting sources
  for ( let lightSource of canvas.effects.lightSources ) {
    if ( !canvas.effects.visionSources.size || !lightSource.active || lightSource.disabled ) continue;
    const shadows = lightSource.los.combinedShadows || [];
    if ( shadows.length ) {
      drawPolygonWithHoles(shadows, { graphics: vision.fov });
    } else {
      vision.fov.beginFill(0xFFFFFF, 1.0).drawShape(lightSource.los).endFill();
    }

    if ( lightSource.data.vision ) {
      if ( shadows.length ) {
        drawPolygonWithHoles(shadows, { graphics: vision.los });
      } else {
        vision.los.beginFill(0xFFFFFF, 1.0).drawShape(lightSource.los).endFill();
      }
    }
  }

  // Draw sight-based visibility for each vision source
  for ( let visionSource of canvas.effects.visionSources ) {
    visionSource.active = true;
    const shadows = visionSource.los.combinedShadows || [];

    // Draw FOV polygon or provide some baseline visibility of the token's space
    if ( visionSource.radius > 0 ) {
      vision.fov.beginFill(0xFFFFFF, 1.0).drawShape(visionSource.fov).endFill();
    } else {
      const baseR = canvas.dimensions.size / 2;
      vision.base.beginFill(0xFFFFFF, 1.0).drawCircle(visionSource.x, visionSource.y, baseR).endFill();
    }

    // Draw LOS mask
    if ( shadows.length ) {
      drawPolygonWithHoles(shadows, { graphics: vision.los });
    } else {
      vision.los.beginFill(0xFFFFFF, 1.0).drawShape(visionSource.los).endFill();
    }

    // Record Fog of war exploration
    if ( canvas.fog.update(visionSource, forceUpdateFog) ) vision._explored = true;
  }


  // Commit updates to the Fog of War texture
  if ( commitFog ) canvas.fog.commit();

  // Alter visibility of the vision layer
  this.visible = canvas.effects.visionSources.size || !game.user.isGM;

  // Restrict the visibility of other canvas objects
  this.restrictVisibility();
}
