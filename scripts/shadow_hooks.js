/* globals
canvas,
flattenObject,
GlobalLightSource,
Hooks,
PIXI,
PolygonMesher,
VisionSource
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { SETTINGS, getSceneSetting } from "./settings.js";

import { ShadowWallShader, ShadowWallPointSourceMesh } from "./glsl/ShadowWallShader.js";
import { ShadowTextureRenderer, ShadowVisionLOSTextureRenderer } from "./glsl/ShadowTextureRenderer.js";
import { PointSourceShadowWallGeometry, SourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";
import { ShadowVisionMaskShader, ShadowVisionMaskTokenLOSShader } from "./glsl/ShadowVisionMaskShader.js";
import { EVQuadMesh } from "./glsl/EVQuadMesh.js";
import { TestShadowShader } from "./glsl/TestShadowShader.js";

/* Shadow texture workflow

LightSource
1. wallGeometry (PointSourceShadowWallGeometry extends PIXI.Geometry)
   Walls within radius of the light source.
2. shadowMesh (ShadowWallPointSourceMesh extends PIXI.Mesh)
   - shader: ShadowWallShader based on source position
   - geometry: wallGeometry (1)
3. shadowRenderer (ShadowTextureRenderer)
   - mesh: shadowMesh (2)
   Renders the shadowMesh to a texture. Updates the render texture using:
     - updateSourceRadius
     - update
   --> shadowRenderer.renderTexture output
4. shadowVisionMask (PIXI.Mesh)
   - shader: ShadowVisionMaskShader.
     Draws only lighted areas in red, discards shadow areas.
     Uses shadowRenderer.renderTexture (3) as uniform
   - geometry: source.layers.background.mesh.geometry
     Could probably use QuadMesh with light bounds instead but might need the circle radius.
5. shadowQuadMesh (EVQuadMesh extends PIXI.Mesh)
   - shader: shadowRenderer.renderTexture
   - geometry: Custom quad
   For testing drawing the renderTexture.

VisionSource FOV
1–5: Same as LightSource. Used for the FOV, which has a radius.

VisionSource LOS
1–3: Same as LightSource.
     Geometry not limited by radius.

3.1 shadowVisionLOSRenderer (ShadowVisionLOSTextureRenderer extends ShadowTextureRenderer)
    Same as shadowRenderer for LightSource.
    Render the shadowMesh to a texture.


3.2: losGeometry (PIXI.Geometry)
   Triangulation of the vision.los (unconstrained) polygon.
   Update using vision.updateLOSGeometry()

4: shadowVisionLOSMask
   - shader: ShadowVisionMaskTokenLOSShader
     Draws only lighted areas in red, discards shadow areas.
     Uses shadowVisionLOSRenderer.renderTexture (3.1) as uniform





*/



// NOTE: Wraps for RenderedPointSource methods.

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
    ev.shadowVisionLOSMesh?.updateLightPosition();
    if ( this instanceof VisionSource ) this.updateLOSGeometry();
  }

  if ( changedPosition ) {
    ev.shadowRenderer?.update();
    ev.shadowVisionLOSRenderer?.update();
    ev.shadowQuadMesh?.updateGeometry(ev.shadowRenderer.source.bounds);
    ev.shadowVisionMask.position.copyFrom(this);

  } else if ( changedRadius ) {
    ev.shadowRenderer?.updateSourceRadius();
    ev.shadowQuadMesh?.updateGeometry(ev.shadowRenderer.source.bounds);
    ev.shadowVisionMask.scale = { x: this.radius, y: this.radius };

  } else if ( changedElevation ) {
    ev.shadowRenderer?.update();
    ev.shadowVisionLOSRenderer?.update();
  }
}

export function destroyRenderedPointSource(wrapped) {
  console.log(`${MODULE_ID}|destroyRenderedPointSource (${this.constructor.name}) for ${this.object?.name || this.object?.id}.`);
  const ev = this[MODULE_ID];
  if ( !ev ) return wrapped();

  if ( ev.shadowQuadMesh && canvas.effects.EVshadows ) canvas.effects.EVshadows.removeChild(ev.shadowQuadMesh);

  const assets = [
    "shadowQuadMesh",
    "shadowRenderer",
    "shadowMesh",
    "wallGeometry",
    "shadowVisionMask",
    "shadowVisionLOSMask",
    "shadowVisionLOSMesh",
    "shadowVisionLOSRenderer",
    "losGeometry"
  ];

  for ( const asset of assets ) {
    if ( !ev[asset] ) continue;
    ev[asset].destroy();
    ev[asset] = undefined;
  }

  return wrapped();
}

// NOTE: Hooks used for updating source shadow geometry, mesh, texture

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
    ev.shadowMesh = new ShadowWallPointSourceMesh(source, ev.wallGeometry);

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
    ev.shadowVisionMask = new PIXI.Mesh(source.layers.background.mesh.geometry, shader);
    ev.shadowVisionMask.position.copyFrom(source);
    ev.shadowVisionMask.scale = { x: source.radius, y: source.radius };
  }

  // If vision source, build extra LOS geometry and add an additional mask for the LOS.
  if ( source instanceof VisionSource && !ev.shadowVisionLOSMesh ) {
    // Shadow mesh of the entire canvas for LOS.
    ev.wallGeometryUnbounded = new SourceShadowWallGeometry(source);
    ev.shadowVisionLOSMesh = new ShadowWallPointSourceMesh(source, ev.wallGeometryUnbounded);
    ev.shadowVisionLOSRenderer = new ShadowVisionLOSTextureRenderer(source, ev.shadowVisionLOSMesh);
    ev.shadowVisionLOSRenderer.renderShadowMeshToTexture();

    // Add or update the LOS geometry for the vision source.
    source.updateLOSGeometry();

    // Build LOS vision mask.
    const shader = ShadowVisionMaskTokenLOSShader.create(ev.shadowVisionLOSRenderer.renderTexture);
    ev.shadowVisionLOSMask = new EVQuadMesh(source.los.bounds, shader);
  }

  // TODO: Comment out the shadowQuadMesh.
  // Testing use only.
  if ( !ev.shadowQuadMesh ) {
    const shader = TestShadowShader.create(ev.shadowRenderer.renderTexture);
    ev.shadowQuadMesh = new EVQuadMesh(ev.shadowRenderer.source.bounds, shader);
  }
  // For testing, add to the canvas effects
  //   if ( !canvas.effects.EVshadows ) canvas.effects.EVshadows = canvas.effects.addChild(new PIXI.Container());
  //   canvas.effects.EVshadows.addChild(ev.shadowQuadMesh);
  source.layers.illumination.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
  source.layers.coloration.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
  source.layers.background.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
}

/**
 * New method:  RenderedPointSource.prototype.updateLOSGeometry
 * Update the los geometry for a vision source shape used in the vision mask.
 * Copy of RenderedPointSource.prototype.#updateGeometry
 */
export function updateLOSGeometryVisionSource() {
  const {x, y} = this.data;
  const offset = this._flags.renderSoftEdges ? this.constructor.EDGE_OFFSET : 0;
  const pm = new PolygonMesher(this.los, {x, y, radius: 0, normalize: false, offset});
  const ev = this[MODULE_ID];
  ev.losGeometry ??= null;
  ev.losGeometry = pm.triangulate(ev.losGeometry);
}

// NOTE: Wall handling for RenderedPointSource

/**
 * New method: RenderedPointSource.prototype.wallAdded
 * Update shadow data based on the added wall, as necessary.
 * @param {Wall} wall     Wall that was added to the scene.
 */
export function wallAddedRenderedPointSource(wall) { handleWallChange(this, wall, "addWall"); }

/**
 * New method: RenderedPointSource.prototype.wallUpdated
 * Update shadow data based on the updated wall, as necessary.
 * @param {Wall} wall     Wall that was updated in the scene.
 */
export function wallUpdatedRenderedPointSource(wall, changes) {
  handleWallChange(this, wall, "updateWall", { changes });
}

/**
 * New method: RenderedPointSource.prototype.wallRemoved
 * Update shadow data based on the removed wall, as necessary.
 * @param {Wall} wallId     Wall id that was removed from the scene.
 */
export function wallRemovedRenderedPointSource(wallId) { handleWallChange(this, wallId, "removeWall"); }


/**
 * New getter: RenderedPointSource.prototype.bounds
 */
export function boundsRenderedPointSource() {
  const r = this.radius ?? this.data.externalRadius;
  if ( !r ) return this.object?.bounds ?? new PIXI.Rectangle(this.x - 1, this.y - 1, 2, 2);

  const { x, y } = this;
  const d = r * 2;
  return new PIXI.Rectangle(x - r, y - r, d, d);
}

/**
 * Utility function to handle variety of wall changes to a source.
 * @param {RenderedPointSource} source
 * @param {Wall} wall
 * @param {string} updateFn   Name of the update method for the wall geometry.
 * @param {object} opts       Options passed to updateFn
 */
function handleWallChange(source, wall, updateFn, opts = {}) {
  const ev = source[MODULE_ID];
  if ( !ev ) return;

  // At this point, the wall caused a change to the geometry.
  // Update accordingly.
  if ( ev.wallGeometry?.[updateFn](wall, opts) ) ev.shadowRenderer?.update();

  // For vision sources, update the LOS geometry.
  if ( ev.losGeometry ) source.updateLOSGeometry();

  // For vision sources, update the LOS texture.
  if ( ev.shadowVisionLOSRenderer ) ev.shadowVisionLOSRenderer.update();
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
    ...canvas.tokens.placeables.map(t => t.vision),
    ...canvas.sounds.sources
  ];

  for ( const src of sources ) src.wallAdded(wallD.object);
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
    ...canvas.tokens.placeables.map(t => t.vision),
    ...canvas.sounds.sources
  ];

  for ( const src of sources ) src.wallUpdated(wallD.object, changes);
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
    ...canvas.tokens.placeables.map(t => t.vision),
    ...canvas.sounds.sources
  ];

  for ( const src of sources ) src.wallRemoved(wallD.id);
}

// Hooks.on("drawAmbientLight", drawAmbientLightHook);

Hooks.on("createWall", createWallHook);
Hooks.on("updateWall", updateWallHook);
Hooks.on("deleteWall", deleteWallHook);

Hooks.on("initializeLightSourceShaders", initializeSourceShadersHook);
Hooks.on("initializeVisionSourceShaders", initializeSourceShadersHook);
