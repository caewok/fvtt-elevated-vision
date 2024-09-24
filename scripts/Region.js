/* globals
canvas,
foundry,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { drawPolygonWithHoles } from "./util.js";

// Patches for the Region class
export const PATCHES = {};
PATCHES.REGIONS = {};

/**
 * Hook canvasReady
 * Set up each blocking region.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} changed                          Differential data that was used to update the document
 * @param {Partial<DatabaseUpdateOperation>} options Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function canvasReady() {
  canvas.regions.placeables
    .filter(r => r.document.getFlag(MODULE_ID, FLAGS.BLOCKS_VISION))
    .forEach(r => {
      addRegionElevation(r);
      addRegionWalls(r);
    });
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

}

/**
 * Remove the region's walls from the wall geometry.
 * @param {Region} region
 */
function removeRegionWalls(region) {

}

PATCHES.REGIONS.HOOKS = { canvasReady, updateRegion, destroyRegion };
