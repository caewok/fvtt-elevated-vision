/* globals
canvas,
flattenObject,
GlobalLightSource,
Hooks
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";

import { ShadowMaskWallShader, ShadowWallPointSourceMesh } from "./glsl/ShadowMaskShader.js";
import { ShadowTextureRenderer } from "./glsl/ShadowTextureRenderer.js";
import { PointSourceShadowWallGeometry, SourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";


// Hooks used for updating source shadow geometry, mesh, texture
// NOTE: Ambient Light Hooks

/**
 * Store a shadow texture for a given (rendered) source.
 * 1. Store wall geometry.
 * 2. Store a mesh with encoded shadow data.
 * 3. Render the shadow data to a texture.
 * @param {RenderedPointSource} source
 */
function initializeSourceShadersHook(source) {
  if ( source instanceof GlobalLightSource ) return;
  const ev = source[MODULE_ID] ??= {};

  // Build the geometry.
  if ( ev.wallGeometry ) ev.wallGeometry.destroy(); // Just in case.
  ev.wallGeometry = new PointSourceShadowWallGeometry(source);

  // Build the shadow mesh.
  const position = Point3d.fromPointSource(source);
  const shader = ShadowMaskWallShader.create(position);
  if ( ev.shadowMesh ) ev.shadowMesh.destroy(); // Just in case.
  const mesh = new ShadowWallPointSourceMesh(source, shader);
  ev.shadowMesh = mesh;

  // Build the shadow render texture
  ev.shadowRenderer = new ShadowTextureRenderer(source, mesh);
  ev.shadowRenderer.renderShadowMeshToTexture();

  // For testing, add to the canvas effects
  //   const shadowShader = TestShadowShader.create(ev.shadowRenderer.renderTexture);
  //   ev.shadowQuadMesh = new EVQuadMesh(source.object.bounds, shadowShader);
  //
  //   if ( !canvas.effects.EVshadows ) canvas.effects.EVshadows = canvas.effects.addChild(new PIXI.Container());
  //   canvas.effects.EVshadows.addChild(ev.shadowQuadMesh);
  source.layers.illumination.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
  source.layers.coloration.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
  source.layers.background.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
}


/**
 * Hook lighting refresh
 * Update shadow data.
 * @param {AmbientLight} object
 * @param {RenderFlags} flags
 */
function refreshAmbientLightHook(object, flags) {
  refreshSourceShadowData(object.source, object.bounds, flags);
}


/**
 * Hook lighting refresh to update the source geometry
 * See Placeable.prototype._applyRenderFlags.
 * 1. Update wall geometry.
 * 2. Update the render texture size based on radius or other changes.
 * 3. Update the shadow test quad geometry
 * @param {RenderedPointSource} source    The object instance being refreshed
 * @param {RenderFlags} flags
 */
function refreshSourceShadowData(source, bounds, flags) {
  const ev = source[MODULE_ID];
  if ( !ev ) return;

  if ( flags.refreshPosition || flags.refreshElevation || flags.refreshRadius ) {
    // console.log(`EV|refreshAmbientLightHook light ${object.source.x},${object.source.y},${object.source.elevationE} flag: ${object.document.flags.elevatedvision.elevation}`);
    ev.geom?.refreshWalls();
    ev.shadowMesh?.updateLightPosition();
  }

  if ( flags.refreshPosition ) {
    ev.shadowRenderer?.update();
    ev.shadowQuadMesh?.updateGeometry(bounds);

  } else if ( flags.refreshRadius ) {
    ev.shadowRenderer?.updateSourceRadius();
    ev.shadowQuadMesh?.updateGeometry(bounds);

  } else if ( flags.refreshElevation ) {
    ev.shadowRenderer?.update();
  }
}

/**
 * Hook lighting destroy
 * Destroy shadow data.
 * @param {AmbientLight} object
 */
function destroyAmbientLightHook(object) {
  destroySourceShadowData(object.source);
}

/**
 * A hook event that fires when a {@link PlaceableObject} is destroyed.
 * The dispatched event name replaces "Object" with the named PlaceableObject subclass, i.e. "destroyToken".
 * @event destroyObject
 * @category PlaceableObject
 * @param {PlaceableObject} object    The object instance being refreshed
 */
function destroySourceShadowData(source) {
  const ev = source[MODULE_ID];
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
function createWallHook(wallD, _options, _userId) {
  const sources = [
    ...canvas.effects.lightSources,
    ...canvas.effects.visionSources,
    ...canvas.sounds.sources
  ];

  for ( const src of sources ) {
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
function updateWallHook(wallD, data, _options, _userId) {
  const changes = new Set(Object.keys(flattenObject(data)));
  // TODO: Will eventually need to monitor changes for sounds and sight, possibly move.
  // TODO: Need to deal with threshold as well
  const changeFlags = SourceShadowWallGeometry.CHANGE_FLAGS;
  if ( !(changeFlags.WALL_COORDINATES.some(f => changes.has(f))
    || changeFlags.WALL_RESTRICTED.some(f => changes.has(f))) ) return;

  const sources = [
    ...canvas.effects.lightSources,
    ...canvas.effects.visionSources,
    ...canvas.sounds.sources
  ];

  for ( const src of sources ) {
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
function deleteWallHook(wallD, _options, _userId) {
  const sources = [
    ...canvas.effects.lightSources,
    ...canvas.effects.visionSources,
    ...canvas.sounds.sources
  ];

  for ( const src of sources ) {
    const ev = src[MODULE_ID];
    if ( !ev ) continue;
    ev.wallGeometry?.removeWall(wallD.id);
    ev.shadowRenderer?.update();
  }
}

// Hooks.on("drawAmbientLight", drawAmbientLightHook);

Hooks.on("createWall", createWallHook);
Hooks.on("updateWall", updateWallHook);
Hooks.on("deleteWall", deleteWallHook);

Hooks.on("initializeLightSourceShaders", initializeSourceShadersHook);
Hooks.on("refreshAmbientLight", refreshAmbientLightHook);
Hooks.on("destroyAmbientLight", destroyAmbientLightHook);

// Hooks.on("initializeVisionSourceShaders", initializeSourceShadersHook);
// Hooks.on("refreshToken", refreshTokenHook);
// Hooks.on("destroyToken", destroyTokenHook);


