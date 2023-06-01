/* globals

*/
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";

// Methods and hooks to track wall updates.

Hooks.on("createWall", createWallHook);
Hooks.on("updateWall", updateWallHook);
Hooks.on("deleteWall", deleteWallHook);
Hooks.on("canvasReady", canvasReadyHook);

function createWallHook(document, options, userId) {

}

function updateWallHook(document, change, options, userId) {
  // Update Levels data to keep wall elevations in sync.


}

function deleteWallHook(document, options, userId) {

}

function canvasReadyHook() {
  if ( !game.user.isGM ) return;

  importWallHeightWallData(false); // async function
}

/**
 * Does this wall need elevation data converted from Wall Height flag to the EV flag?
 * @param {Wall} wall
 * @param {boolean} override    If true, this returns true if the Wall Height flag does not
 *   equal the Elevation flag.
 * @returns {boolean}
 */
function _wallNeedsConversionFromWallHeight(wall, override = false) {
  if ( !Object.hasOwn(wall.document.flags, "wall-height") ) return false;
  if ( !override ) return !Boolean(wall.document.flags?.elevatedvision?.elevation);

  const { top, bottom } = wall.document.flags["wall-height"];
  const ev = wall.document.flags.elevatedvision.elevation;
  return top !== ev.top && bottom != ev.bottom;
}

/**
 * Do one or more walls in the scene need to be updated to be in-sync between
 * Wall Height and Elevated Vision?
 * @param {boolean} override    If true, any wall with inconsistent flag data counts.
 * @returns {boolean}
 */
export function wallsNeedConversionFromWallHeight(override = false) {
  return canvas.walls.some(wall => _wallNeedsConversionFromWallHeight(wall, override));
}

/**
 * Import the Wall Height flag data for all the walls in the current scene.
 * Wall Height flag is "wall-height": { top, bottom}
 * @param {boolean} override      Should the data override existing Elevated Vision data?
 * @returns {[Wall]} Output from WallDocument.updateDocuments.
 */
export async function importWallHeightWallData(override = false) {
  const wallsToUpdate = canvas.walls.placeables.filter(wall => _wallNeedsConversionFromWallHeight(wall, override));

  const updates = wallsToUpdate.map(wall => {
    const top = wall.document.flags["wall-height"]?.top ?? Number.POSITIVE_INFINITY;
    const bottom = wall.document.flags["wall-height"]?.bottom ?? Number.NEGATIVE_INFINITY;


    return { _id: wall.id, [`flags.${MODULE_ID}.${FLAGS.WALL.ELEVATION}`]: { bottom, top } };
  });

  await WallDocument.updateDocuments(updates, { parent: canvas.scene});
}

