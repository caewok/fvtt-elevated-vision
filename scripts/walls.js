/* globals

*/
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";

// Methods and hooks to track wall updates.

Hooks.on("createWall", createWallHook);
Hooks.on("updateWall", updateWallHook);
Hooks.on("deleteWall", deleteWallHook);

function createWallHook(document, options, userId) {

}

function updateWallHook(document, change, options, userId) {

}

function deleteWallHook(document, options, userId) {

}

export async function importWallHeightWallData(override = false) {
  const wallsToUpdate = canvas.walls.placeables.filter(wall => {
    if ( !override && this.document.flags?.elevatedvision?.elevation ) return false;
    return Object.hasOwn(wall.document.flags, "wall-height");
  });

  const updates = wallsToUpdate.map(wall => {
    const top = wall.document.flags["wall-height"]?.top ?? Number.POSITIVE_INFINITY;
    const bottom = wall.document.flags["wall-height"]?.bottom ?? Number.NEGATIVE_INFINITY;


    return { _id: wall.id, [`flags.${MODULE_ID}.${FLAGS.WALL.ELEVATION}`]: { bottom, top } };
  });

  await WallDocument.updateDocuments(updates, { parent: canvas.scene});
}