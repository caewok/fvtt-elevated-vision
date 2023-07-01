/* globals
canvas,
flattenObject,
GlobalLightSource,
Hooks,
PIXI,
RenderedPointSource,
VisionSource
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "./const.js";
import { Draw } from "./geometry/Draw.js";

import { ShadowWallPointSourceMesh } from "./glsl/ShadowWallShader.js";
import { ShadowTextureRenderer, ShadowVisionLOSTextureRenderer } from "./glsl/ShadowTextureRenderer.js";
import { PointSourceShadowWallGeometry, SourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";
import { ShadowVisionMaskShader, ShadowVisionMaskTokenLOSShader } from "./glsl/ShadowVisionMaskShader.js";
import { EVQuadMesh } from "./glsl/EVQuadMesh.js";

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

  // console.log(`${MODULE_ID}|_configureRenderedPointSource for ${this.object?.name || this.object?.id} (${this.constructor.name}). Is ${this.object?._original ? "" : "not "}a clone. ${Object.keys(changes).length} changed properties.`, changes);

  // Test for different change properties
  const changedPosition = Object.hasOwn(changes, "x") || Object.hasOwn(changes, "y");
  const changedRadius = Object.hasOwn(changes, "radius");
  const changedElevation = Object.hasOwn(changes, "elevation");

  if ( changedPosition || changedElevation || changedRadius ) {
    // console.log(`EV|refreshAmbientLightHook light ${this.x},${this.y},${this.elevationE} flag: ${this.object.document.flags?.elevatedvision?.elevation}`);
    ev.wallGeometry?.refreshWalls();
    ev.wallGeometryUnbounded?.refreshWalls();
    ev.shadowMesh?.updateLightPosition();
    ev.shadowVisionLOSMesh?.updateLightPosition();
  }

  if ( changedPosition ) {
    ev.shadowRenderer?.update();
    ev.shadowVisionLOSRenderer?.update();
    // ev.shadowVisionLOSMask?.updateGeometry(this.los.bounds); Unneeded b/c using canvas.dimensions.rect

    if ( ev.shadowVisionMask ) {
      ev.shadowVisionMask.updateGeometry(this.bounds);
      ev.shadowVisionMask.shader.updateSourcePosition(this);
    }

    // ev.shadowVisionMask.position.copyFrom(this);

  } else if ( changedRadius ) {
    ev.shadowRenderer?.updateSourceRadius();
    // ev.shadowVisionMask.scale = { x: this.radius, y: this.radius };

    if ( ev.shadowVisionMask ) {
      ev.shadowVisionMask.updateGeometry(this.bounds);
      ev.shadowVisionMask.shader.updateSourceRadius(this);
    }

  } else if ( changedElevation ) {
    ev.shadowRenderer?.update();
    ev.shadowVisionLOSRenderer?.update();
  }
}

export function destroyRenderedPointSource(wrapped) {
  // console.log(`${MODULE_ID}|destroyRenderedPointSource (${this.constructor.name}) for ${this.object?.name || this.object?.id}.`);
  const ev = this[MODULE_ID];
  if ( !ev ) return wrapped();


  const assets = [
    "shadowRenderer",
    "shadowMesh",
    "wallGeometry",
    "wallGeometryUnbounded",
    "shadowVisionMask",
    "shadowVisionLOSMask",
    "shadowVisionLOSMesh",
    "shadowVisionLOSRenderer"
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

  // Build the geometry, shadow texture, and vision mask.
  source._initializeEVShadowGeometry();
  source._initializeEVShadowTexture();
  source._initializeEVShadowMask();

  // TODO: Does this need to be reset every time?
  source.layers.illumination.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
  source.layers.coloration.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
  source.layers.background.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
}

/* RenderedSource
// Methods
- _initializeEVShadowGeometry
- _initializeEVShadowTexture
- _initializeEVShadowMask

// Getters
- EVVisionMask

// elevatedvision properties
- wallGeometry
- shadowMesh
- shadowRenderer
- shadowVisionMask
*/

/* VisionSource
// Methods
- _initializeEVShadowGeometry (mixed)
- _initializeEVShadowTexture (mixed)
- _initializeEVShadowMask (mixed)

// Getters
- EVVisionLOSMask
- EVVisionMask (override)

// elevatedvision properties
- shadowVisionLOSRenderer
- shadowVisionLOSMask
- wallGeometryUnbounded
- shadowVisionLOSMesh

*/

/* GlobalLightSource
// Methods
- _initializeEVShadowGeometry (override)
- _initializeEVShadowTexture (override)
- _initializeEVShadowMask (override)

// Getters
- EVVisionMask (override)

*/


// NOTE: RenderedSource shadow methods and getters

/**
 * New method: RenderedPointSource.prototype._initializeEVShadowGeometry
 */
export function _initializeEVShadowGeometryRenderedPointSource() {
  const ev = this[MODULE_ID] ??= {};
  ev.wallGeometry ??= new PointSourceShadowWallGeometry(this);
}

/**
 * New method: RenderedPointSource.prototype._initializeEVShadowTexture
 */
export function _initializeEVShadowTextureRenderedPointSource() {
  const ev = this[MODULE_ID];
  if ( ev.shadowRenderer ) return;

  // Mesh that describes shadows for the given geometry and source origin.
  ev.shadowMesh = new ShadowWallPointSourceMesh(this, ev.wallGeometry);

  // Force a uniform update, to avoid ghosting of placeables in the light radius.
  // TODO: Find the underlying issue and fix this!
  // Must be a new uniform variable (one that is not already in uniforms)
  this.layers.background.shader.uniforms.uEVtmpfix = 0;
  this.layers.coloration.shader.uniforms.uEVtmpfix = 0;
  this.layers.illumination.shader.uniforms.uEVtmpfix = 0;

  // Render texture to store the shadow mesh for use by other shaders.
  ev.shadowRenderer = new ShadowTextureRenderer(this, ev.shadowMesh);
  ev.shadowRenderer.renderShadowMeshToTexture(); // TODO: Is this necessary here?
}

/**
 * New method: RenderedPointSource.prototype._initializeEVShadowMask
 */
export function _initializeEVShadowMaskRenderedPointSource() {
  const ev = this[MODULE_ID];
  if ( ev.shadowVisionMask ) return;

  // Mask that colors red areas that are lit / are viewable.
  const shader = ShadowVisionMaskShader.create(this, ev.shadowRenderer.renderTexture);
  ev.shadowVisionMask = new EVQuadMesh(this.bounds, shader);
}

/**
 * New getter: RenderedPointSource.prototype.EVVisionMask
 */
export function EVVisionMaskRenderedPointSource() {
  if ( !this[MODULE_ID]?.shadowVisionMask ) {
    console.error("elevatedvision|EVVisionMaskRenderedPointSource|No shadowVisionMask.");
  }

  return this[MODULE_ID].shadowVisionMask;
}

// NOTE: VisionSource shadow methods and getters

/**
 * New method: VisionSource.prototype._initializeEVShadowGeometry
 * Use SourceShadowWallGeometry, which does not restrict based on source bounds.
 */
export function _initializeEVShadowGeometryVisionSource() {
  // In lieu of super._initializeEVShadowGeometry
  RenderedPointSource.prototype._initializeEVShadowGeometry.call(this);

  // Build extra LOS geometry.
  const ev = this[MODULE_ID];
  ev.wallGeometryUnbounded ??= new SourceShadowWallGeometry(this);
}

/**
 * New method: VisionSource.prototype._initializeEVShadowTexture
 * Add a second LOS renderer that covers the entire canvas.
 */
export function _initializeEVShadowTextureVisionSource() {
  const ev = this[MODULE_ID];
  if ( ev.shadowVisionLOSRenderer ) return;

  // Instead of super._initializeEVShadowTexture()
  RenderedPointSource.prototype._initializeEVShadowTexture.call(this);

  // Build extra LOS shadow mesh and render to a texture for use by other shaders.
  ev.shadowVisionLOSMesh = new ShadowWallPointSourceMesh(this, ev.wallGeometryUnbounded);
  ev.shadowVisionLOSRenderer = new ShadowVisionLOSTextureRenderer(this, ev.shadowVisionLOSMesh);
  ev.shadowVisionLOSRenderer.renderShadowMeshToTexture(); // TODO: Is this necessary here?
}

/**
 * New method: VisionSource.prototype._initializeEVShadowMask
 * Mask of entire canvas (LOS)
 */
export function _initializeEVShadowMaskVisionSource() {
  const ev = this[MODULE_ID];
  if ( ev.shadowVisionLOSMask ) return;

  // Instead of super._initializeEVShadowMask
  RenderedPointSource.prototype._initializeEVShadowMask.call(this);

  // Build add an additional mask for the LOS.
  // Mask that colors red areas that are lit / are viewable.
  const shader = ShadowVisionMaskTokenLOSShader.create(ev.shadowVisionLOSRenderer.renderTexture);
  ev.shadowVisionLOSMask = new EVQuadMesh(canvas.dimensions.rect, shader);
}

/**
 * New getter: VisionSource.prototype.EVVisionLOSMask
 */
export function EVVisionLOSMaskVisionSource() {
  if ( !this[MODULE_ID]?.shadowVisionLOSMask ) {
    console.error("elevatedvision|EVVisionLOSMaskVisionSource|No shadowVisionLOSMask.");
  }

  return this[MODULE_ID].shadowVisionLOSMask;
}

/**
 * New getter: VisionSource.prototype.EVVisionMask
 */
export function EVVisionMaskVisionSource() {
  if ( !this[MODULE_ID]?.shadowVisionMask ) {
    console.error("elevatedvision|EVVisionMaskVisionSource|No shadowVisionMask.");
  }

  // return this[MODULE_ID].shadowVisionMask;

  // Ideally, could just pass shadowVisionLOSMask with a circle mask added.
  // This fails b/c masking breaks it.

  const c = new PIXI.Container();
  c.addChild(this[MODULE_ID].shadowVisionLOSMask);

  // Mask the radius circle for this vision source.
  // Do not add as mask to container; can simply add to container as a child
  // b/c the entire container is treated as a mask by the vision system.
  const r = this.radius || this.data.externalRadius;
  const g = new PIXI.Graphics();
  const draw = new Draw(g);
  draw.shape(new PIXI.Circle(this.x, this.y, r), { fill: 0xFF0000 });
  c.addChild(g);
  return c;
}

// NOTE: GlobalLightSource shadow methods and getters
/**
 * Return early for initialization methods b/c not calculating shadows.
 * New methods:
 * - GlobalLightSource.prototype._initializeEVShadowGeometry
 * - GlobalLightSource.prototype._initializeEVShadowTexture
 * - GlobalLightSource.prototype._initializeEVShadowMask
 */
export function _initializeEVShadowGeometryGlobalLightSource() { return undefined; }
export function _initializeEVShadowTextureGlobalLightSource() { return undefined; }
export function _initializeEVShadowMaskGlobalLightSource() { return undefined; }

/**
 * New getter: GlobalLightSource.prototype.EVVisionMask
 */
export function EVVisionMaskGlobalLightSource() {
  // TODO: This could be cached somewhere, b/c this.shape does not change.
  const g = new PIXI.Graphics();
  const draw = new Draw(g);
  draw.shape(this.shape, { fill: 0xFF0000 });
  return g;
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

  // At this point, the wall caused a change to the geometry. Update accordingly.
  if ( ev.wallGeometry?.[updateFn](wall, opts) ) ev.shadowRenderer.update();

  // For vision sources, update the LOS geometry.
  if ( ev.wallGeometryUnbounded?.[updateFn](wall, opts) ) ev.shadowVisionLOSRenderer.update();
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
    ...canvas.tokens.placeables.map(t => t.vision)
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
  if ( !(SourceShadowWallGeometry.CHANGE_FLAGS.some(f => changes.has(f))) ) return;

  const sources = [
    ...canvas.effects.lightSources,
    ...canvas.tokens.placeables.map(t => t.vision)
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
    ...canvas.tokens.placeables.map(t => t.vision)
  ];

  for ( const src of sources ) src.wallRemoved(wallD.id);
}

// Hooks.on("drawAmbientLight", drawAmbientLightHook);

Hooks.on("createWall", createWallHook);
Hooks.on("updateWall", updateWallHook);
Hooks.on("deleteWall", deleteWallHook);

Hooks.on("initializeLightSourceShaders", initializeSourceShadersHook);
Hooks.on("initializeVisionSourceShaders", initializeSourceShadersHook);
