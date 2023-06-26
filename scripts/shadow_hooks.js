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
import { SETTINGS, getSceneSetting } from "./settings.js";

import { ShadowWallShader, ShadowWallPointSourceMesh } from "./glsl/ShadowWallShader.js";
import { ShadowTextureRenderer } from "./glsl/ShadowTextureRenderer.js";
import { PointSourceShadowWallGeometry, SourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";
import { ShadowVisionMaskShader } from "./glsl/ShadowVisionMaskShader.js";
import { EVQuadMesh } from "./glsl/EVQuadMesh.js";
import { TestShadowShader } from "./glsl/TestShadowShader.js";

export function _configureRenderedPointSource(wrapped, changes) {
  wrapped(changes);

  // At this point, ev property should exist on source b/c of initialize shaders hook.
  const ev = this[MODULE_ID];
  if ( !ev ) return;

  console.log(`${MODULE_ID}|_configureRenderedPointSource (${this.constructor.name}) for ${this.object?.name || this.object?.id} with ${Object.keys(changes).length} changed properties.`, changes);

  // Test for different change properties
  const changedPosition = Object.hasOwn(changes, "x") || Object.hasOwn(changes, "y");
  const changedRadius = Object.hasOwn(changes, "radius");
  const changedElevation = Object.hasOwn(changes, "elevation");

  if ( changedPosition || changedElevation || changedRadius ) {
    // console.log(`EV|refreshAmbientLightHook light ${object.source.x},${object.source.y},${object.source.elevationE} flag: ${object.document.flags.elevatedvision.elevation}`);
    ev.geom?.refreshWalls();
    ev.shadowMesh?.updateLightPosition();
  }

  if ( changedPosition ) {
    ev.shadowRenderer?.update();
    ev.shadowQuadMesh?.updateGeometry(ev.shadowRenderer.sourceBounds);
    ev.shadowVisionMask?.updateGeometry(ev.shadowRenderer.sourceBounds);

  } else if ( changedRadius ) {
    ev.shadowRenderer?.updateSourceRadius();
    ev.shadowQuadMesh?.updateGeometry(ev.shadowRenderer.sourceBounds);
    ev.shadowVisionMask?.updateGeometry(ev.shadowRenderer.sourceBounds);

  } else if ( changedElevation ) {
    ev.shadowRenderer?.update();
  }
}

export function destroyRenderedPointSource(wrapped) {
  console.log(`${MODULE_ID}|destroyRenderedPointSource (${this.constructor.name}) for ${this.object?.name || this.object?.id}.`);
  const ev = this[MODULE_ID];
  if ( !ev ) return wrapped();

  if ( ev.shadowQuadMesh ) {
    if ( canvas.effects.EVshadows ) canvas.effects.EVshadows.removeChild(ev.shadowQuadMesh);
    ev.shadowQuadMesh.destroy();
    ev.shadowQuadMesh = undefined;
  }

  if ( ev.shadowVisionMask ) {
    ev.shadowVisionMask.destroy();
    ev.shadowVisionMask = undefined;
  }

  if ( ev.shadowRenderer ) {
    ev.shadowRenderer.destroy();
    ev.shadowRenderer = undefined;
  }

  if ( ev.shadowMesh ) {
    ev.shadowMesh.destroy();
    ev.shadowMesh = undefined;
  }

  if ( ev.wallGeometry ) {
    ev.wallGeometry.destroy();
    ev.wallGeometry = undefined;
  }

  return wrapped();
}

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
  ev.wallGeometry ??= new PointSourceShadowWallGeometry(source);

  // Build the shadow mesh.
  if ( !ev.shadowMesh ) {
    const position = Point3d.fromPointSource(source);
    const shader = ShadowWallShader.create(position);
    ev.shadowMesh = new ShadowWallPointSourceMesh(source, shader);

    // Force a uniform update, to avoid ghosting of placeables in the light radius.
    // TODO: Find the underlying issue and fix this!
    // Why doesn't this work:
//     source.layers.background.shader.uniformGroup.update();
//     source.layers.coloration.shader.uniformGroup.update();
//     source.layers.illumination.shader.uniformGroup.update();
    const { ALGORITHM, TYPES } = SETTINGS.SHADING;
    const EVshadows = getSceneSetting(ALGORITHM) === TYPES.WEBGL;
    source.layers.background.shader.uniforms.EVshadows = EVshadows;
    source.layers.coloration.shader.uniforms.EVshadows = EVshadows;
    source.layers.illumination.shader.uniforms.EVshadows = EVshadows;
  }

  // Build the shadow render texture
  ev.shadowRenderer ??= new ShadowTextureRenderer(source, ev.shadowMesh);
  ev.shadowRenderer.renderShadowMeshToTexture();

  // Build the vision mask.
  if ( !ev.shadowVisionMask ) {
    const shader = ShadowVisionMaskShader.create(ev.shadowRenderer.renderTexture);
    ev.shadowVisionMask = new EVQuadMesh(ev.shadowRenderer.sourceBounds, shader);
  }

  // If vision source, build extra LOS geometry and add an additional mask for the LOS.
  if ( source instanceof VisionSource ) {
    updateLOSGeometryVisionSource(source);


  }
  // TODO: Comment out the shadowQuadMesh.
  // Testing use only.
  if ( !ev.shadowQuadMesh ) {
    const shader = TestShadowShader.create(ev.shadowRenderer.renderTexture);
    ev.shadowQuadMesh = new EVQuadMesh(ev.shadowRenderer.sourceBounds, shader);
  }
  // For testing, add to the canvas effects
  //   if ( !canvas.effects.EVshadows ) canvas.effects.EVshadows = canvas.effects.addChild(new PIXI.Container());
  //   canvas.effects.EVshadows.addChild(ev.shadowQuadMesh);
  source.layers.illumination.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
  source.layers.coloration.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
  source.layers.background.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
}

/**
 * Update the los geometry for a vision source shape used in the vision mask.
 * Copy of RenderedPointSource.prototype.#updateGeometry
 */
function updateLOSGeometryVisionSource(source) {
  const {x, y, radius} = source.data;
  const offset = source._flags.renderSoftEdges ? source.constructor.EDGE_OFFSET : 0;
  const pm = new PolygonMesher(source.los, {x, y, radius, normalize: true, offset});
  source[MODULE_ID].losGeometry ??= null;
  source[MODULE_ID].losGeometry = pm.triangulate(source[MODULE_ID].losGeometry);

  // Compute bounds of the geometry (used for optimizing culling)
  const bounds = new PIXI.Rectangle(0, 0, 0, 0);
  if ( radius > 0 ) {
    const b = source.los instanceof PointSourcePolygon ? source.los.bounds : source.los.getBounds();
    bounds.x = (b.x - x) / radius;
    bounds.y = (b.y - y) / radius;
    bounds.width = b.width / radius;
    bounds.height = b.height / radius;
  }
  if ( source[MODULE_ID].losGeometry.bounds ) source[MODULE_ID].losGeometry.bounds.copyFrom(bounds);
  else source[MODULE_ID].losGeometry.bounds = bounds;
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
Hooks.on("initializeVisionSourceShaders", initializeSourceShadersHook);
