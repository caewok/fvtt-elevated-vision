/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
"use strict";

import { Point3d } from "./geometry/3d/Point3d.js";


// Uniforms used by the lighting and shadow shaders.
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

export function shadowUniforms(source, useRadius = true, u = {}) {
  const { sceneX, sceneY, sceneWidth, sceneHeight } = canvas.dimensions;
  const dimFn = useRadius ? dimensionUniformsRadius : dimensionUniformsNoRadius;

  u.EV_elevationSampler = canvas.elevation?._elevationTexture || PIXI.Texture.EMPTY;
  u.EV_sceneDims = [sceneX, sceneY, sceneWidth, sceneHeight];
  const r_inv = dimFn(source, u);
  addUniformsForWalls(source, r_inv, u);
}

function dimensionUniformsRadius(source, u = {}) {
  const { elevationMin, elevationStep, maximumPixelValue } = canvas.elevation;
  const { size, distance, width, height } = canvas.dimensions;

  // To avoid a bug in PolygonMesher and because ShadowShader assumes normalized geometry
  // based on radius, set radius to 1 if radius is 0.
  const radius = source.radius || 1;
  const r_inv = 1 / radius;
  const elevationMult = size * (1 / distance) * 0.5 * r_inv;
  u.EV_elevationResolution = [elevationMin, elevationStep, maximumPixelValue, elevationMult];

  // Uniforms based on source
  const { x, y, elevationZ} = source;
  u.EV_sourceLocation = [0.5, 0.5, elevationZ * 0.5 * r_inv];

  // Alternative version using vUvs, given that light source mesh have no rotation
  // https://ptb.discord.com/channels/732325252788387980/734082399453052938/1010999752030171136

  u.EV_transform = [
    radius * 2 / width,
    radius * 2 / height,
    (x - radius) / width,
    (y - radius) / height
  ];
  return r_inv;
}

function dimensionUniformsNoRadius(source, u = {}) {
  const { elevationMin, elevationStep, maximumPixelValue } = canvas.elevation;
  const { size, distance } = canvas.dimensions;

  // [min, step, maxPixValue, canvasMult]
  const elevationMult = size * (1 / distance);
  u.EV_elevationResolution = [elevationMin, elevationStep, maximumPixelValue, elevationMult];

  // Uniforms based on source
  const { x, y, elevationZ } = source;
  u.EV_sourceLocation = [x, y, elevationZ];

  return 0; // For r_inv
}


function addUniformsForWalls(source, r_inv, u = {}) {
  const originPt = PIXI.Point.fromObject(source);
  const terrainWalls = [...(source.shape._elevatedvision?.terrainWalls || [])];
  const heightWalls = [...(source.shape._elevatedvision?.heightWalls || [])];

  const { coords: cT, distances: dT } = wallUniforms(terrainWalls, originPt, source, r_inv);
  const { coords: cH, distances: dH } = wallUniforms(heightWalls, originPt, source, r_inv);
  u.EV_terrainWallCoords = cT;
  u.EV_terrainWallDistances = dT;
  u.EV_numTerrainWalls = dT.length;
  u.EV_wallCoords = cH;
  u.EV_wallDistances = dH;
  u.EV_numWalls = dH.length;
}

/**
 * @param {Wall[]} walls
 * @param {Point} origin
 * @returns {object}
 *   - {number[]} coords: Array of wall coordinates to be used for the uniform
 *   - {number[]} distances: Array of wall distances from origin
 */
function wallUniforms(walls, originPt, source, r_inv) {
  // Sort walls from distance to origin point.
  walls.forEach(w => {
    const pt = foundry.utils.closestPointToSegment(originPt, w.A, w.B);
    w._distance2 = PIXI.Point.distanceSquaredBetween(originPt, pt);
  });
  walls.sort((a, b) => a._distance2 - b._distance2);

  let coords = [];
  let distances = [];
  walls.forEach(w => addWallDataToShaderArrays(w, distances, coords, source, r_inv));

  if ( !coords.length ) coords = [0, 0, 0, 0, 0, 0];
  if ( !distances.length ) distances = [0];

  return { coords, distances };
}

/**
 * Calculate distances and coordinates (in shader-space) for a given wall.
 * Adds those values to the arrays passed as parameters.
 * @param {Wall} w                        Wall to calculate
 * @param {number[]} distances            Array to add distance for this wall
 * @param {number[]} coords               Array to add coordinates for this wall
 * @param {RenderedPointSource} source    Source for the shader
 * @param {number} r_inv                  Radius inverse, used for getting circle coordinates.
 */
function addWallDataToShaderArrays(w, distances, coords, source, r_inv) {
  // Because walls are rectangular, we can pass the top-left and bottom-right corners
  const center = PIXI.Point.fromObject(source);

  const wallPoints = Point3d.fromWall(w, { finite: true });
  let a;
  let b;
  let centerShader;

  if ( r_inv ) {
    // Get the coordinates in shader space, which is based on a circle.
    a = pointCircleCoord(wallPoints.A.top, source.radius, center, r_inv);
    b = pointCircleCoord(wallPoints.B.bottom, source.radius, center, r_inv);
    centerShader = new PIXI.Point(0.5, 0.5);
  } else {
    a = wallPoints.A.top;
    b = wallPoints.B.bottom;
    centerShader = center;
  }

  // Point where line from light, perpendicular to wall, intersects
  const wallIx = CONFIG.GeometryLib.utils.perpendicularPoint(a, b, centerShader);
  if ( !wallIx ) return; // Likely a and b not proper wall
  const wallOriginDist = PIXI.Point.distanceBetween(centerShader, wallIx);
  distances.push(wallOriginDist);
  coords.push(a.x, a.y, a.z, b.x, b.y, b.z);
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
export function pointCircleCoord(point, r, center, r_inv = 1 / r) {
  return {
    x: circleCoord(point.x, r, center.x, r_inv),
    y: circleCoord(point.y, r, center.y, r_inv),
    z: point.z * 0.5 * r_inv
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
  // ((a - c) * 1/r * 0.5) + 0.5 = p
  // (a - c) * 1/r = (p - 0.5) / 0.5
  // a - c = 2 * (p - 0.5) / 1/r = 2 * (p - 0.5) * r
  // a = 2 * (p - 0.5) * r + c
  return ((p - 0.5) * r * 2) + c;
}
