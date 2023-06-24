/* globals
canvas,
flattenObject,
GlobalLightSource,
Hooks,
PIXI
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";

import { ShadowMaskWallShader, ShadowWallPointSourceMesh } from "./glsl/ShadowMaskShader.js";
import { ShadowTextureRenderer } from "./glsl/ShadowTextureRenderer.js";
import { TestShadowShader } from "./glsl/TestShadowShader.js";
import { EVQuadMesh } from "./glsl/EVQuadMesh.js";
import { PointSourceShadowWallGeometry, SourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";


// Hooks used for updating source shadow geometry, mesh, texture
// NOTE: Ambient Light Hooks

/**
 * Hook the initial ambient light draw to construct shadows.
 * A hook event that fires when a {@link PlaceableObject} is initially drawn.
 * The dispatched event name replaces "Object" with the named PlaceableObject subclass, i.e. "drawToken".
 * @event drawObject
 * @category PlaceableObject
 * @param {PlaceableObject} object    The object instance being drawn
 */
export function drawAmbientLightHook(object) {
  const lightSource = object.source;
  if ( !lightSource ) return;

  // TODO: Is drawAmbientLightHook still needed?
}

/**
 * Hook light source shader initialization
 * @param {LightSource} lightSource
 */
function initializeLightSourceShadersHook(lightSource) {
  if ( lightSource instanceof GlobalLightSource ) return;
  const ev = lightSource[MODULE_ID] ??= {};

  // Build the geometry.
  if ( ev.wallGeometry ) ev.wallGeometry.destroy(); // Just in case.
  ev.wallGeometry = new PointSourceShadowWallGeometry(lightSource);

  // Build the shadow mesh.
  const lightPosition = Point3d.fromPointSource(lightSource);
  const shader = ShadowMaskWallShader.create(lightPosition);
  if ( ev.shadowMesh ) ev.shadowMesh.destroy(); // Just in case.
  const mesh = new ShadowWallPointSourceMesh(lightSource, shader);
  ev.shadowMesh = mesh;

  // Build the shadow render texture
  ev.shadowRenderer = new ShadowTextureRenderer(lightSource, mesh);
  ev.shadowRenderer.renderShadowMeshToTexture();

  // For testing, add to the canvas effects
//   const shadowShader = TestShadowShader.create(ev.shadowRenderer.renderTexture);
//   ev.shadowQuadMesh = new EVQuadMesh(lightSource.object.bounds, shadowShader);
//
//   if ( !canvas.effects.EVshadows ) canvas.effects.EVshadows = canvas.effects.addChild(new PIXI.Container());
//   canvas.effects.EVshadows.addChild(ev.shadowQuadMesh);
  lightSource.layers.illumination.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
  lightSource.layers.coloration.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
  lightSource.layers.background.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
}


/**
 * Hook lighting refresh to update the source geometry
 * See Placeable.prototype._applyRenderFlags.
 * @param {PlaceableObject} object    The object instance being refreshed
 * @param {RenderFlags} flags
 */
export function refreshAmbientLightHook(object, flags) {
  const ev = object.source[MODULE_ID];
  if ( !ev ) return;

  if ( flags.refreshPosition || flags.refreshElevation || flags.refreshRadius ) {
    // console.log(`EV|refreshAmbientLightHook light ${object.source.x},${object.source.y},${object.source.elevationE} flag: ${object.document.flags.elevatedvision.elevation}`);
    ev.geom?.refreshWalls();
    ev.shadowMesh?.updateLightPosition();
  }

  if ( flags.refreshPosition ) {
    ev.shadowRenderer?.update();
    ev.shadowQuadMesh?.updateGeometry(object.bounds);

  } else if ( flags.refreshRadius ) {
    ev.shadowRenderer?.updateSourceRadius();
    ev.shadowQuadMesh?.updateGeometry(object.bounds);

  } else if ( flags.refreshElevation ) {
    ev.shadowRenderer?.update();
  }
}

/**
 * A hook event that fires when a {@link PlaceableObject} is destroyed.
 * The dispatched event name replaces "Object" with the named PlaceableObject subclass, i.e. "destroyToken".
 * @event destroyObject
 * @category PlaceableObject
 * @param {PlaceableObject} object    The object instance being refreshed
 */
export function destroyAmbientLightHook(object) {
  const ev = object.source[MODULE_ID];
  if ( !ev ) return;

  if ( ev.shadowQuadMesh ) {
    if ( canvas.effects.EVshadows ) canvas.effects.EVshadows.removeChild(ev.shadowQuadMesh);
    ev.shadowQuadMesh.destroy();
    ev.shadowQuadMesh = undefined;
  }

  if ( ev.shadowRenderer ) {
    ev.shadowRenderer.destroy();
    ev.shadowRenderer = undefined;
  }

  if ( ev.mesh ) {
    ev.mesh.destroy();
    ev.mesh = undefined;
  }

  if ( ev.wallGeometry ) {
    ev.wallGeometry.destroy();
    ev.wallGeometry = undefined;
  }
}

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
export function createWallHook(wallD, _options, _userId) {
  for ( const src of canvas.effects.lightSources ) {
    const ev = src[MODULE_ID];
    if ( !ev ) continue;
    ev.wallGeometry?.addWall(wallD.object);
    ev.shadowRenderer?.update();
  }
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
export function updateWallHook(wallD, data, _options, _userId) {
  const changes = new Set(Object.keys(flattenObject(data)));
  // TODO: Will eventually need to monitor changes for sounds and sight, possibly move.
  // TODO: Need to deal with threshold as well
  const changeFlags = SourceShadowWallGeometry.CHANGE_FLAGS;
  if ( !(changeFlags.WALL_COORDINATES.some(f => changes.has(f))
    || changeFlags.WALL_RESTRICTED.some(f => changes.has(f))) ) return;

  for ( const src of canvas.effects.lightSources ) {
    const ev = src[MODULE_ID];
    if ( !ev ) continue;
    ev.wallGeometry?.updateWall(wallD.object, { changes });
    ev.shadowRenderer?.update();
  }
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
export function deleteWallHook(wallD, _options, _userId) {
  for ( const src of canvas.effects.lightSources ) {
    const ev = src[MODULE_ID];
    if ( !ev ) continue;
    ev.wallGeometry.removeWall(wallD.id);
    ev.shadowRenderer?.update();
  }
}

Hooks.on("drawAmbientLight", drawAmbientLightHook);
Hooks.on("refreshAmbientLight", refreshAmbientLightHook);
Hooks.on("destroyAmbientLight", destroyAmbientLightHook);
Hooks.on("createWall", createWallHook);
Hooks.on("updateWall", updateWallHook);
Hooks.on("deleteWall", deleteWallHook);
Hooks.on("initializeLightSourceShaders", initializeLightSourceShadersHook);
