/* globals
PIXI
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "./const.js";
import { Draw } from "./geometry/Draw.js";
import { WebGLShadows } from "./glsl/WebGLShadows.js";

/* Methods related to RenderedEffectSource
• RenderedEffectSource extends BaseEffectSource
• BaseLightSource extends RenderedEffectSource
• GlobalLightSource extends BaseLightSource
• PointVisionSource extends PointEffectSourceMixin(RenderedEffectSource)
• PointLightSource extends PointEffectSourceMixin(BaseLightSource)
• PointDarknessSource extends PointEffectSourceMixin(BaseLightSource)
• PointMovementSource extends PointEffectSourceMixin(BaseEffectSource)

BaseEffectSource
  --> RenderedEffectSource
        --> (PointEffectSourceMixin) --> PointVisionSource
        --> BaseLightSource
            --> GlobalLightSource
            --> (PointEffectSourceMixin) --> PointLightSource
            --> (PointEffectSourceMixin) --> PointDarknessSource
            --> (PointEffectSourceMixin) --> PointMovementSource
*/

//
//
//
// PointVisionSource extends PointEffectSourceMixin(RenderedEffectSource)
// class PointLightSource extends PointEffectSourceMixin(BaseLightSource)
/* Foundry BaseLightSource workflow

_configure
--> #initializeMeshes
--> If #initializeMeshes returns true or shader key changes, --> #initializeShaders

#initializeShaders
--> #createShader
--> #updateUniforms
--> Hooks.call(initialize[LightSource]Shader)

#initializeMeshes
--> #updateGeometry
--> if no prior #geometry set, #createMeshes

#updateGeometry
--> Passes this.shape to the PolygonMesher
  -- x, y, radius
--> Triangulate the PolygonMesher output to set geometry.

*/

/* New Methods
_initializeEVShadows
- Just calls the below initialize methods

_initializeEVShadowGeometry
- Wall geometry for the source.

_initializeEVShadowMesh
- Shadows for walls coded to handle terrain walls.

_initializeEVTerrainShadowMesh
- Shadow terrain when source is below.
- Also shadow based on limited angle

_initializeEVShadowRenderer
- Render the wall shadows

_initializeEVShadowMask
- Color red the lit (unshadowed) areas for the source

_updateEVShadowData(changes)
- Update the shadow mesh, geometry, render, given changes.

pointInShadow(point)
- Return percentage shadow for the point

targetInShadow(target, testPoint)
- Return percentage shadow for given target and a point on or near the target.
- Relies on pixelMesh
*/

/* New Getters
EVVisionMask
- Retrieve the mask corresponding to this source. Passed to CanvasVisibility to mask vision.
- Distinct version for

EVShadowTexture
- Retrieve the shadow texture corresponding to this source. Used for lighting shaders and vision masking

*/

/* Wrapped Methods
_configure
- Update shadow data

destroy
- Remove shadow data

_createPolygon
- Create shadow polygons

*/

export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.POLYGONS = {};
PATCHES.WEBGL = {};

// ----- NOTE: Polygon Shadows ----- //
// NOTE: Polygon Wraps
function EVVisionMaskPolygon() {
  const g = new PIXI.Graphics();
  const draw = new Draw(g);

  const ev = this[MODULE_ID];
  if ( !ev || !ev.polygonShadows?.combined?.length ) {
    draw.shape(this.shape, { fill: 0xFF0000 });
    return g;
  }

  for ( const poly of ev.polygonShadows.combined ) {
    if ( poly.isHole ) {
      g.beginHole();
      g.drawShape(poly, { fill: 0xFF0000 });
      g.endHole();
    } else this.drawShape(poly, { fill: 0xFF0000 });
  }
  return g;
}

PATCHES.POLYGONS.METHODS = { EVVisionMask: EVVisionMaskPolygon };

// NOTE: Polygon Methods

function _createShapes(wrapped) {
  wrapped();
  // TODO: this.polygonShadows(this.shape);
}

PATCHES.POLYGONS.WRAPS = { _createShapes };

// ----- NOTE: WebGL Shadows ----- //


// NOTE: WebGL Wraps

/**
 * Wrap RenderedEffectSource.prototype._configure
 * Update shadow data when relevant changes are indicated.
 * @param {object} changes    Object of updates to point source data.
 *   Note: will only contain source.data properties.
 */
function _configure(wrapped, changes) {
  wrapped(changes);

  // At this point, ev property should exist on source b/c of initialize shaders hook.
  const ev = this[MODULE_ID];
  if ( !ev ) return;
  ev._updateShadowData(changes);
}

/**
 * Wrap RenderedEffectSource.prototype.destroy
 * Destroy shadow meshes, geometry, textures.
 */
function destroy(wrapped) {
  const ev = this[MODULE_ID];
  if ( ev ) ev.destroy();
  return wrapped();
}

PATCHES.WEBGL.WRAPS = {
  _configure,
  destroy
};

// ----- NOTE: WebGL Getters ----- //

/**
 * Create the WebGLShadows class for this source, on demand.
 * Store as getter at source[MODULE_ID]
 */
function webGLShadowsGetter() {
  if ( this._elevatedvision ) return this._elevatedvision;
  const ev = this._elevatedvision = WebGLShadows.fromSource(this);
  ev.initializeShadows();
  return ev;
}

PATCHES.WEBGL.GETTERS = { elevatedvision: webGLShadowsGetter };

// NOTE: WebGL Hooks

/**
 * Store a shadow texture for a given (rendered) source.
 * 1. Store wall geometry.
 * 2. Store a mesh with encoded shadow data.
 * 3. Render the shadow data to a texture.
 * @param {RenderedEffectSource} source
 */
function initializeRenderedEffectSourceShaders(source) {
  log("initializeRenderedEffectSourceShaders", source);
//   const ev = this[MODULE_ID] ??= WebGLShadows.fromSource(source);
//   ev.initializeShadows();
}

PATCHES.WEBGL.HOOKS = { initializeRenderedEffectSourceShaders };
