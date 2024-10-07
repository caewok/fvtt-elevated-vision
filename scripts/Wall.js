/* globals
canvas,
flattenObject
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { SourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";

// Methods related to Wall

export const PATCHES = {};
PATCHES.BASIC = {};

// NOTE: Wall Document Hooks

/**
 * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
 * Substitute the Document name in the hook event to target a specific type, for example "createToken".
 * This hook fires for all connected clients after the creation has been processed.
 *
 * @event createDocument
 * @category Document
 * @param {Document} document                       The new Document instance which has been created
 * @param {DocumentModificationContext} options     Additional options which modified the creation request
 * @param {string} userId                           The ID of the User who triggered the creation workflow
 */
function createWall(wallD, _options, _userId) {
  const sources = [
    ...canvas.effects.lightSources,
    ...canvas.tokens.placeables.map(t => t.vision).filter(v => Boolean(v))
  ];

  for ( const src of sources ) src[MODULE_ID].edgeAdded(wallD.object.edge);
}

/**
 * A hook event that fires for every Document type after conclusion of an update workflow.
 * Substitute the Document name in the hook event to target a specific Document type, for example "updateActor".
 * This hook fires for all connected clients after the update has been processed.
 *
 * @event updateDocument
 * @category Document
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateWall(wallD, data, _options, _userId) {
  const changes = new Set(Object.keys(foundry.utils.flattenObject(data)));
  // TODO: Will eventually need to monitor changes for sounds and sight, possibly move.
  // TODO: Need to deal with threshold as well
  if ( !(SourceShadowWallGeometry.CHANGE_FLAGS.some(f => changes.has(f))) ) return;

  const sources = [
    ...canvas.effects.lightSources,
    ...canvas.tokens.placeables.map(t => t.vision).filter(v => Boolean(v))
  ];

  for ( const src of sources ) src[MODULE_ID].edgeUpdated(wallD.object.edge, changes);
}

/**
 * A hook event that fires for every Document type after conclusion of an deletion workflow.
 * Substitute the Document name in the hook event to target a specific Document type, for example "deleteActor".
 * This hook fires for all connected clients after the deletion has been processed.
 *
 * @event deleteDocument
 * @category Document
 * @param {Document} document                       The existing Document which was deleted
 * @param {DocumentModificationContext} options     Additional options which modified the deletion request
 * @param {string} userId                           The ID of the User who triggered the deletion workflow
 */
function deleteWall(wallD, _options, _userId) {
  const sources = [
    ...canvas.effects.lightSources,
    ...canvas.tokens.placeables.map(t => t.vision).filter(v => Boolean(v))
  ];

  for ( const src of sources ) src[MODULE_ID].edgeRemoved(wallD.id);
}

PATCHES.BASIC.HOOKS = {
  createWall,
  updateWall,
  deleteWall
};
