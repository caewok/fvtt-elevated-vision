/* globals
canvas,
game,
PIXI
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "./const.js";
import { Draw } from "./geometry/Draw.js";
import { ShadowTerrainShader } from "./glsl/ShadowTerrainShader.js";
import { ShadowVisionLOSTextureRenderer } from "./glsl/ShadowTextureRenderer.js";
import { ShadowVisionMaskTokenLOSShader } from "./glsl/ShadowVisionMaskShader.js";
import { SourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";
import { EVQuadMesh } from "./glsl/EVQuadMesh.js";


/* Testing
source = _token.vision
ev = source.elevatedvision

canvas.stage.addChild(ev.shadowMesh)
canvas.stage.removeChild(ev.shadowMesh)

canvas.stage.addChild(ev.terrainShadowMesh)
canvas.stage.removeChild(ev.terrainShadowMesh)


// Test wall geometry
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
buffers = ev.wallGeometry.buffers;

// Wall corners repeated 3x
// Each has 4 values:
// A.x, A.y, top, blocksA
// B.x, B.y, bottom, blocksB

segments = [];
buff1 = buffers[1].data;
buff2 = buffers[2].data;

for ( let i = 0; i < buff1.length; i += 12 ) {
  const segment = {
    A: new Point3d(buff1[i], buff1[i + 1], buff1[i + 2]),
    B: new Point3d(buff2[i], buff2[i + 1], buff2[i + 2])
  };
  segment.A.blocks = buff1[i + 3];
  segment.B.blocks = buff2[i + 3];
  segments.push(segment)

  Draw.segment(segment, { color: Draw.COLORS.blue, width: 5 })
  Draw.point(segment.A, { radius: 7, color: ~segment.A.blocks ? Draw.COLORS.red : Draw.COLORS.green })
  Draw.point(segment.B, { radius: 7, color: ~segment.B.blocks ? Draw.COLORS.red : Draw.COLORS.green })
}


*/


// Methods related to VisionSource

export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.WEBGL = {};
PATCHES.VISIBILITY = {};

// ----- NOTE: Methods -----

/**
 * New method: VisionSource.prototype._initializeEVShadowGeometry
 * Use SourceShadowWallGeometry, which does not restrict based on source bounds.
 */
function _initializeEVShadowGeometry() {
  const ev = this[MODULE_ID];
  if ( ev.wallGeometry ) return;
  ev.wallGeometry = new SourceShadowWallGeometry(this);
}

/**
 * New method: BaseLightSource.prototype._initializeEVTerrainShadowMesh
 * Build terrain shadow + limited angle
 * Uses a quad sized to the canvas.
 */
function _initializeEVTerrainShadowMesh() {
  const ev = this[MODULE_ID];
  if ( ev.terrainShadowMesh ) return;
  const shader = ShadowTerrainShader.create(this);
  ev.terrainShadowMesh = new EVQuadMesh(canvas.dimensions.rect, shader);
}

/**
 * New method: VisionSource.prototype._initializeEVShadowRenderer
 * Render to the entire canvas to represent LOS.
 */
function _initializeEVShadowRenderer() {
  const ev = this[MODULE_ID];
  if ( ev.shadowRenderer ) return;

  // Render LOS to a texture for use by other shaders.
  ev.shadowRenderer = new ShadowVisionLOSTextureRenderer(this, ev.shadowMesh, ev.terrainShadowMesh);
}

/**
 * New method: VisionSource.prototype._initializeEVShadowMask
 * Mask of entire canvas (LOS)
 */
function _initializeEVShadowMask() {
  const ev = this[MODULE_ID];
  if ( ev.shadowVisionMask ) return;

  // Build the mask for the LOS based on the canvas dimensions rectangle.
  // Mask that colors red areas that are lit / are viewable.
  const shader = ShadowVisionMaskTokenLOSShader.create(this);
  ev.shadowVisionMask = new EVQuadMesh(canvas.dimensions.rect, shader);
}

/**
 * New method: VisionSource.prototype.targetInShadow
 * Do not use the shadow texture cache b/c it takes too long to construct and vision moves a lot.
 */
function targetInShadow(target, testPoint) {
  testPoint ??= target;
  return this.pointInShadow(testPoint);
}

/**
 * New method: VisionSource.prototype._getWalls
 * For vision, include all walls in the scene bounds, because
 * unseen walls can block vision from light sources beyond this source range.
 * @param {PIXI.Rectangle} bounds
 * @returns {Set<Wall>}
 */
function _getWalls(bounds) {
  const origin = PIXI.Point.fromObject(this);
  bounds ??= canvas.dimensions.rect;
  const collisionTest = o => this._testWallInclusion(o.t, origin);
  const walls = canvas.walls.quadtree.getObjects(bounds, { collisionTest });

  // Issue #81: Perceptive compatibility.
  const IgnoreWall = game.modules.get("perceptive")?.api?.IgnoreWall;
  const token = this.object;
  if ( IgnoreWall && token ) return walls.filter(w => !IgnoreWall(w.document, token.document));
  return walls;
}

PATCHES.BASIC.METHODS = {
  _getWalls
};

PATCHES.WEBGL.METHODS = {
  _initializeEVShadowGeometry,
  _initializeEVTerrainShadowMesh,
  _initializeEVShadowRenderer,
  _initializeEVShadowMask
};

PATCHES.VISIBILITY.METHODS = {
  targetInShadow
};

// ----- NOTE: Getters -----

/**
 * New getter: VisionSource.prototype.EVVisionMask
 * Field-of-view (FOV) for this vision source.
 */
function EVVisionFOVMask() {
  const ev = this[MODULE_ID];
  if ( !ev.graphicsFOV ) this._createRestrictedPolygon();
  return ev.graphicsFOV;
}

PATCHES.WEBGL.GETTERS = {
  EVVisionFOVMask
};

// ----- NOTE: Wraps -----

/**
 * Wrap VisionSource.prototype._createRestrictedPolygon
 * Create/update the graphics used for the FOV.
 */
function _createRestrictedPolygon(wrapped) {
  const ev = this[MODULE_ID] ??= {};
  ev.graphicsFOV ??= new PIXI.Graphics();
  const draw = new Draw(ev.graphicsFOV);
  draw.clearDrawings();

  // Mask the radius circle for this vision source.
  const fill = 0xFF0000;
  const width = 0;
  const origin = {x: this.data.x, y: this.data.y};
  const radius = this.data.radius || this.data.externalRadius;
  const circle = new PIXI.Circle(origin.x, origin.y, radius);
  draw.shape(circle, { width, fill });

  return wrapped();
}

PATCHES.WEBGL.WRAPS = {
  _createRestrictedPolygon
};
