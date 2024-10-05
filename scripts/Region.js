/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS, OTHER_MODULES } from "./const.js";
import { drawPolygonWithHoles } from "./util.js";
import { getSceneSetting, Settings } from "./settings.js";

// Patches for the Region class
export const PATCHES = {};
PATCHES.REGIONS = {};

/**
 * Hook canvasReady
 * Add any blocking regions to the canvas edges.
 */
function canvasReady() {
  canvas.regions.placeables.forEach(region => {
    if ( !region.document.getFlag(MODULE_ID, FLAGS.BLOCKS_VISION) ) return;
    addRegionElevation(region);
    addRegionWalls(region);
  });

  canvas.scene[MODULE_ID] ??= {};
  canvas.scene[MODULE_ID].sceneBackgroundRegion = sceneBackgroundRegion();

  const useWebGL = getSceneSetting(Settings.KEYS.SHADING.ALGORITHM) === Settings.KEYS.SHADING.TYPES.WEBGL;
  const sources = useWebGL ? [
    ...canvas.effects.lightSources,
    ...canvas.tokens.placeables.map(t => t.vision).filter(v => Boolean(v))
  ] : [];
  sources.forEach(src => src.refreshEdges?.());
}

/**
 * Hook updateRegion
 * If the block vision flag changes, update the scene accordingly.
 */
function updateRegion(regionD, changed, _options, _userId) {
  const region = regionD.object;
  const flag = `flags.${MODULE_ID}.${FLAGS.BLOCKS_VISION}`;
  const flagChange = foundry.utils.getProperty(changed, flag);
  let add = flagChange === true;
  let remove = flagChange === false; // Equality to avoid undefined.
  if ( regionD.getFlag(MODULE_ID, FLAGS.BLOCKS_VISION)
    && (foundry.utils.hasProperty(changed, "elevation")
     || foundry.utils.hasProperty(changed, "shapes")) ) add = remove = true;
  if ( remove ) {
    removeRegionElevation(region);
    removeRegionWalls(region);
  }
  if ( add ) {
    addRegionElevation(region);
    addRegionWalls(region);
  }
  if ( remove || add ) canvas.scene[MODULE_ID].sceneBackgroundRegion = sceneBackgroundRegion();
}

/**
 * Hook deleteRegion
 * If the region blocks vision, update the scene accordingly.
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyRegion(region) {
  if ( !region.document.getFlag(MODULE_ID, FLAGS.BLOCKS_VISION) ) return;
  removeRegionElevation(region);
  removeRegionWalls(region);
  canvas.scene[MODULE_ID].sceneBackgroundRegion = sceneBackgroundRegion();
}

PATCHES.REGIONS.HOOKS = { updateRegion, destroyRegion, canvasReady };

/**
 * Fill in the shape of a region and add to the elevation set.
 * @param {Region} region
 */
function addRegionElevation(region) {
  const polys = region.polygons;
  const graphics = new PIXI.Graphics();
  const ev = canvas.scene[MODULE_ID];
  graphics._region = region;
  const elevation = region.document.elevation.top ?? ev.elevationMax;
  drawPolygonWithHoles(polys, { graphics, fillColor: ev.elevationColor(elevation) });
  ev._setElevationForGraphics(graphics, elevation);
}

/**
 * Remove the region's graphics from the elevation set.
 * @param {Region} region
 */
function removeRegionElevation(region) {
  const ev = canvas.scene[MODULE_ID];
  let idx = ev._graphicsContainer.children.findIndex(c => c._region === region);
  if ( ~idx ) ev._graphicsContainer.removeChildAt(idx);
}

/**
 * Add the region's walls to the wall geometry.
 * @param {Region} region
 */
function addRegionWalls(region) {
  const regionD = region.document;
  let top = regionD.elevation?.top;
  let bottom = regionD.elevation?.bottom;
  const TM = OTHER_MODULES.TERRAIN_MAPPER;
  if ( TM.ACTIVE && region[TM.KEY].isElevated ) top = region[TM.KEY].plateauElevation;
  top ??= canvas.scene[MODULE_ID].elevationMax;
  bottom ??= canvas.scene[MODULE_ID].elevationMin;
  const useWebGL = getSceneSetting(Settings.KEYS.SHADING.ALGORITHM) === Settings.KEYS.SHADING.TYPES.WEBGL;
  const sources = useWebGL ? [
    ...canvas.effects.lightSources,
    ...canvas.tokens.placeables.map(t => t.vision).filter(v => Boolean(v))
  ] : [];

  // TODO: Handle wall options for the region in region config.
  const opts = {
    type: "regionWall",
    direction: CONST.WALL_DIRECTIONS.BOTH,
    light: CONST.WALL_SENSE_TYPES.NORMAL,
    move: CONST.WALL_SENSE_TYPES.NONE,
    sight: CONST.WALL_SENSE_TYPES.NORMAL,
    sound: CONST.WALL_SENSE_TYPES.NORMAL,
    threshold: undefined,
    object: region,
    id: region.id
  };
  const addedEdges = [];

  region.polygons.forEach((poly, idx) => {
    // TODO: For holes, flip direction option.
    opts.id = `${region.id}_poly${idx}`;
    const edges = polygonToEdges(poly, opts);
    edges.forEach(edge => {
      canvas.edges.set(edge.id, edge);
      sources.forEach(src => src[MODULE_ID].edgeAdded(edge));
    });
    addedEdges.push(...edges);
  });

  // TODO: Handle ramp walls where endpoint a elevation will differ from endpoint b.
  // ptA = region[TM.KEY].elevationUponEntry(a);
  // ptB = region[TM.KEY].elevationUponEntry(b);


  // const top = OTHER_MODULES.TERRAIN_MAPPER.ACTIVE ?

  // TODO: Use render flags system instead.
  // Following doesn't work b/c that method does not exist.
  // sources.forEach(src => src.refreshEdges(addedEdges));
}

/**
 * Remove the region's walls from the wall geometry.
 * @param {Region} region
 */
function removeRegionWalls(region) {
  const useWebGL = getSceneSetting(Settings.KEYS.SHADING.ALGORITHM) === Settings.KEYS.SHADING.TYPES.WEBGL;
  const sources = useWebGL ? [
    ...canvas.effects.lightSources,
    ...canvas.tokens.placeables.map(t => t.vision).filter(v => Boolean(v))
  ] : [];
  const removedEdges = canvas.edges.filter(edge => edge.object === region);
  removedEdges.forEach(edge => {
    canvas.edges.delete(edge.id);
    sources.forEach(src => src[MODULE_ID].edgeRemoved(edge.id));
  });

  // TODO: Use render flags system instead.
  // Following doesn't work b/c that method does not exist.
  // sources.forEach(src => src.refreshEdges(removedEdges));
}

/**
 * For a given polygon, return an array of edges.
 * @param {PIXI.Polygon} poly
 * @param {object} opts
 * @returns {Edge[]}
 */
function polygonToEdges(poly, opts = {}) {
  const baseID = opts.id ?? foundry.utils.randomID();
  const Edge = foundry.canvas.edges.Edge;
  return [...poly.iterateEdges({ closed: true })].map((e, idx) => {
    opts.id = `${baseID}_${idx}`;
    return new Edge(e.A, e.B, opts);
  });
}

/**
 * Any regions whose top elevation is below the scene elevation are "pits."
 * @returns {Region[]}
 */
function regionPits() {
  const TM = OTHER_MODULES.TERRAIN_MAPPER;
  const sceneGroundE = TM.ACTIVE ? (canvas.scene.getFlag(TM.KEY, TM.BACKGROUND_ELEVATION) || 0) : 0;
  return canvas.regions.placeables.filter(r => {
    const regionTopE = ( TM.ACTIVE && r[TM.KEY].isElevated ) ? r[TM.KEY].plateauElevation : r.document.elevation.top;
    if ( regionTopE == null ) return false;
    return regionTopE < sceneGroundE;
  });
}

/**
 * Any regions whose top elevation is below the scene elevation are "pits."
 * Construct edges for these region polygons that extend upward to the scene elevation.
 * @param {Region[]} [pits]
 * @returns {Edge[]}
 */
function sceneBackgroundEdges(pits) {
  pits ??= regionPits();
  if ( !pits.length ) return [];
  const pitEdges = [];
  for ( const pit of pits ) {
    // TODO: Handle wall options for the region in region config.
    const opts = {
      type: "regionWall",
      direction: CONST.WALL_DIRECTIONS.BOTH,
      light: CONST.WALL_SENSE_TYPES.NORMAL,
      move: CONST.WALL_SENSE_TYPES.NONE,
      sight: CONST.WALL_SENSE_TYPES.NORMAL,
      sound: CONST.WALL_SENSE_TYPES.NORMAL,
      threshold: undefined,
      object: pit,
      id: pit.id
    };
    pit.polygons.forEach((poly, idx) => {
      // TODO: For holes, flip direction option.
      opts.id = `${pit.id}_poly${idx}`;
      const edges = polygonToEdges(poly, opts);
      pitEdges.push(...edges);
    });
  }
  return pitEdges;
}

/**
 * Construct a scene "region" that is the scene rectangle minus any region pits.
 * @param {Region[]} [pits]
 * @returns {ClipperPaths}
 */
function sceneBackgroundRegion() {
  const ClipperPaths = CONFIG.GeometryLib.ClipperPaths;
  const pits = regionPits();
  const scenePath = ClipperPaths.fromPolygons([canvas.dimensions.rect.toPolygon()]);
  if ( !pits.length ) return scenePath;

  // Subtract out the pit polygons from the scene rectangle.
  const polys = pits.flatMap(pit => pit.polygons);
  const paths = ClipperPaths.fromPolygons(polys);
  return paths.diffPaths(scenePath).clean();
}
