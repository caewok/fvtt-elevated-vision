/* globals
canvas,
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

  const useWebGL = getSceneSetting(Settings.KEYS.SHADING.ALGORITHM) === Settings.KEYS.SHADING.TYPES.WEBGL;
  const sources = useWebGL ? [
    ...canvas.effects.lightSources,
    ...canvas.tokens.placeables.map(t => t.vision).filter(v => Boolean(v))
  ] : [];
  sources.forEach(src => src.refreshEdges());
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
}

PATCHES.REGIONS.HOOKS = { updateRegion, destroyRegion, canvasReady };

/**
 * Fill in the shape of a region and add to the elevation set.
 * @param {Region} region
 */
function addRegionElevation(region) {
  const polys = region.polygons;
  const graphics = new PIXI.Graphics();
  graphics._region = region;
  const elevation = region.document.elevation.top ?? canvas.elevation.elevationMax;
  drawPolygonWithHoles(polys, { graphics, fillColor: canvas.elevation.elevationColor(elevation) });
  canvas.elevation._setElevationForGraphics(graphics, elevation);
}

/**
 * Remove the region's graphics from the elevation set.
 * @param {Region} region
 */
function removeRegionElevation(region) {
  let idx = canvas.elevation._graphicsContainer.children.findIndex(c => c._region === region);
  if ( ~idx ) canvas.elevation._graphicsContainer.removeChildAt(idx);
  idx = canvas.elevation.undoQueue.elements.findIndex(e => e._region === region);
  if ( ~idx ) canvas.elevation.undoQueue.elements.splice(idx, 1);
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
  top ??= canvas.elevation.elevationMax;
  bottom ??= canvas.elevation.elevationMin;
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
      sources.forEach(src => src.edgeAdded(edge));
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
    sources.forEach(src => src.edgeRemoved(edge.id));
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
