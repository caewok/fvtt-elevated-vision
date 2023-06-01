/* globals
canvas,
CONFIG,
foundry,
game,
Hooks,
PreciseText,
WallDocument
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";

// Methods and hooks to track wall updates.

Hooks.on("preUpdateWall", preUpdateWallHook);
Hooks.on("createWall", createWallHook);
Hooks.on("updateWall", updateWallHook);
Hooks.on("deleteWall", deleteWallHook);
Hooks.on("canvasReady", canvasReadyHook);
Hooks.on("drawWall", drawWallHook);
Hooks.on("refreshWall", refreshWallHook);
Hooks.on("destroyWall", destroyWallHook);


const WALL_TEXT_NAME = "ev-wall-height-text";

/**
 * Hook event fires when wall is initially drawn.
 * @param {Wall} wall
 */
function drawWallHook(wall) {
  drawWallRange(wall);
}

/**
 * Hook event fires when wall is refreshed.
 * @param {Wall} wall
 */
function refreshWallHook(wall) {
  drawWallRange(wall);
}

/**
 * Hook event fires when wall is destroyed.
 * @param {Wall} wall
 */
function destroyWallHook(wall) {
  wall.children.filter(c => c.name === WALL_TEXT_NAME).forEach(c => c.destroy());
}

function createWallHook(_document, _options, _userId) {

}

function preUpdateWallHook(document, changes, _options, _userId) {
  const updateData = {};

  // Update Wall Height data to keep wall elevations in sync.
  const evFlagChanged = changes.flags?.[MODULE_ID]?.[FLAGS.WALL.ELEVATION];
  if ( evFlagChanged ) {
    const topChanged = evFlagChanged.top;
    if ( typeof topChanged !== "undefined" ) updateData["changes.flags.wall-height.top"] = topChanged;

    const bottomChanged = evFlagChanged.bottom;
    if ( typeof bottomChanged !== "undefined" ) updateData["changes.flags.wall-height.bottom"] = bottomChanged;
  }

  foundry.utils.mergeObject(changes, updateData, {inplace: true});
}

function updateWallHook(_document, _change, _options, _userId) {

}

function deleteWallHook(_document, _options, _userId) {

}

function canvasReadyHook() {
  if ( !game.user.isGM ) return;

  importWallHeightWallData(false); // Async function
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
  if ( !override ) return !(wall.document.flags?.elevatedvision?.elevation);

  const { top, bottom } = wall.document.flags["wall-height"];
  const ev = wall.document.flags.elevatedvision.elevation;
  return top !== ev.top && bottom !== ev.bottom;
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

/**
 * See https://github.com/theripper93/wall-height/blob/12c204b44e6acfa1e835464174ac1d80e77cec4a/scripts/patches.js#L318
 * Draw the wall lower and upper heights on the canvas.
 */
function drawWallRange(wall) {
  const wallElevation = {
    top: wall.topE,
    bottom: wall.bottomE
  };

  // No range label for infinite walls.
  if ( wallElevation.top === Infinity && wallElevation.bottom === -Infinity ) {
    wall.children.filter(c => c.name === WALL_TEXT_NAME).forEach(c => c.destroy());
    return;
  }

  const style = CONFIG.canvasTextStyle.clone();
  style.fontSize /= 1.5;
  style.fill = wall._getWallColor();
  if ( wallElevation.top === Infinity ) wallElevation.top = "∞";
  if ( wallElevation.bottom === -Infinity ) wallElevation.bottom = "-∞";
  const range = `⇡${wallElevation.top}/${wallElevation.bottom}⇣`;

  let text = wall.children.find(c => c.name === WALL_TEXT_NAME);
  if ( !text ) {
    text = new PreciseText(range, style);
    wall.addChild(text);
  }
  text.text = range;
  text.name = WALL_TEXT_NAME;

  // Determine the text angle.
  // Want the angle between -90º and 90º
  // 90º : A --> B pointing south
  // 90º -- 180º: A --> B moving right to left (BL quadrant)
  // -90º -- -180: A --> B moving right to left (UL quadrant)
  let angle = (Math.atan2( wall.coords[3] - wall.coords[1], wall.coords[2] - wall.coords[0] ) * ( 180 / Math.PI ));
  if ( angle > 90 ) angle -= 180;
  else if ( angle < -90 ) angle += 180;

  // Position the label in the center of the wall.
  text.position.set(wall.center.x, wall.center.y);
  text.anchor.set(0.5, 0.5);
  text.angle = angle;
}

