/* globals
flattenObject
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
import { MODULE_ID, FLAGS } from "./const.js";

const PATCHES = {};
PATCHES.BASIC = {};

/**
 * Hook when the elevation flag is changed in the AmbientSoundDocument.
 * Used below to update the underlying source elevation.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
export function updateAmbientSoundHook(doc, data, _options, _userId) {
  const changeFlag = `flags.${MODULE_ID}.${FLAGS.ELEVATION}`;
  const flatData = flattenObject(data);
  const changed = new Set(Object.keys(flatData));
  if ( !changed.has(changeFlag) ) return;

  doc.object.renderFlags.set({
    refreshElevation: true
  });
}

PATCHES.BASIC.HOOKS = {
  updateAmbientSound: updateAmbientSoundHook
};
