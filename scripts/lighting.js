/* globals
GhostLightIlluminationShader,
PIXI,
canvas
*/
"use strict";

import { log } from "./util.js";
import { MODULE_ID } from "./const.js";

// Class PointSource:
/**
 * Create a new Mesh for this source using a provided shader class
 * @param {Function} shaderCls  The subclass of AdaptiveLightingShader being used for this Mesh
 * @returns {PIXI.Mesh}         The created Mesh
 * @protected
 */
//   _createMesh(shaderCls) {
//     const state = new PIXI.State();
//     const mesh = new PIXI.Mesh(this.constructor.GEOMETRY, shaderCls.create(), state);
//     mesh.mask = this.losMask;
//     Object.defineProperty(mesh, "uniforms", {get: () => mesh.shader.uniforms});
//     return mesh;
//   }

/**
 * Update the position and size of the mesh each time it is drawn.
 * @param {PIXI.Mesh} mesh      The Mesh being updated
 * @returns {PIXI.Mesh}         The updated Mesh
 * @protected
 */
//   _updateMesh(mesh) {
//     mesh.position.set(this.data.x, this.data.y);
//     mesh.width = mesh.height = this.radius * 2;
//     return mesh

/**
 * Wrap LightSource.prototype.initialize
 */
export function EVLightSourceInitialize(wrapped, data = {}) {
  // Like in LightSource.constructor
  // don't use _createMesh b/c it links to losMask; we want a separate mask

  const shaderCls = AdaptiveIlluminationShader; // Just for testing
  const state = new PIXI.State();
  const mesh = new PIXI.Mesh(this.constructor.GEOMETRY, shaderCls.create(), state);
  mesh.mask = new PIXI.LegacyGraphics();
  Object.defineProperty(mesh, "uniforms", {get: () => mesh.shader.uniforms});
  this.shadowsMesh = mesh;

  wrapped(data);

}

// LightingLayer.prototype.refresh
// For each light source, sets the source.losMask and then
// gets meshes from source.drawMeshes. Adds meshes.light to ilm.lights

/**
 * Wrap LightSource.prototype._initializeShaders
 */
export function EVLightSourceInitializeShaders(wrapped) {
  wrapped();

  // Below function inside _initializeShaders
  // Create each shader
  const createShader = (cls, container) => {
    const current = container.shader;
    if ( current?.constructor.name === cls.name ) return;
    const shader = cls.create({
      uBkgSampler: canvas.primary.renderTexture,
      fovTexture: this._flags.useFov ? this.fovTexture : null
    });
    shader.container = container;
    container.shader = shader;
    if ( current ) current.destroy();
  };

  // Base initialize method will calculate los.
  createShader(AdaptiveIlluminationShader, this.shadowsMesh);
}

/**
 * Wrap LightSource.prototype._initializeBlending
 */
export function EVLightSourceInitializeBlending(wrapped) {
  wrapped();
  this.shadowsMesh.blendMode = PIXI.BLEND_MODES.MIN_COLOR;
  this.shadowsMesh.zIndex = this.data.z ?? 10; // From defaultZ in _initializeBlending
}

/**
 * Wrap LightSource.prototype.drawMeshes
 */
export function EVDrawMeshes(wrapped) {
  const out = wrapped();
  log("drawMeshes", out);
//   return out;

  if ( !this.los.shadows || !this.los.shadows.length ) return out;

  this.shadowsMesh.mask.clear().beginFill(0xFFFFFF);
  for ( const shadow of this.los.shadows) {
    this.shadowsMesh.mask.drawShape(shadow);
  }
  this.shadowsMesh.mask.endFill();

  // From drawLight

  // Protect against cases where the canvas is being deactivated
  const shader = this.shadowsMesh.shader;
  if ( !shader ) return null;

  // Update illumination uniforms
  const s = this.shadowsMesh;
  const updateChannels = !(this._flags.lightingVersion >= canvas.lighting.version);
  if ( this._resetUniforms.illumination || updateChannels ) {
    this._updateIlluminationUniforms(shader);
    if ( this._shutdown.illumination ) this._shutdown.illumination = !(s.renderable = true);
    this._flags.lightingVersion = canvas.lighting.version;
  }
  if ( this._resetUniforms.illumination ) {
    this._resetUniforms.illumination = false;
  }


  const mesh = this._updateMesh(this.shadowsMesh);

  // Need to add shadowsMesh to ilm.lights directly. See LightingLayer.prototype.refresh
  canvas.lighting.illumination.lights.addChild(mesh);

  return out;
}

/**
 * Wrap LightingLayer.prototype.refresh
 * Primarily to test simpler masking option for light shadows
 */
export function EVLightingLayerRefresh(wrapped, {darkness, backgroundColor}={}) {
  wrapped({darkness, backgroundColor});

  // See https://github.com/fantasycalendar/FoundryVTT-Sequencer/blob/3ed6588bb351206cfee4eed6d750dd56744f7861/scripts/module/canvas-effects/canvas-effect.js
  const maskSprite = new PIXI.Sprite();
  const maskContainer = new PIXI.Container();
  const blurFilter = new BlurFilter({ strength: 2 });
  maskContainer.filters = [blurFilter];

  // Render shadows from light sources
  for ( const src of this.sources ) {
    if ( !src.los.shadows || !src.los.shadows.length ) continue;
    for ( const shadow of src.los.shadows ) {
      const objMaskSprite = new PIXI.Graphics();
      const blurFilter = new BlurFilter({ strength: 1 });
      objMaskSprite.filters = [blurFilter];

      const spriteContainer = new PIXI.Container();

      spriteContainer.addChild(objMaskSprite);
      spriteContainer.maskSprite = objMaskSprite;
      maskContainer.addChild(spriteContainer);

      const maskSprite = new PIXI.Sprite();

      //objMaskSprite.beginFill(0xFFFFFF, .5); // white
      objMaskSprite.beginFill(0x000000, .5); // black
      objMaskSprite.drawShape(shadow);
      objMaskSprite.endFill();
    }
  }

  this.illumination.lights.addChild(maskContainer);
  this.coloration.addChild(maskContainer);


    // See refresh:
          // Block illumination
//       const si = roof.getRoofSprite();
//       if ( !si ) continue;
//       si.zIndex = 9999; // By convention
//       si.tint = this.channels.background.hex;
//       this.illumination.lights.addChild(si)
//
//       // Block coloration
//       const sc = roof.getRoofSprite();
//       sc.tint = 0x000000;
//       this.coloration.addChild(sc);
}

/**
 * Wrap LightSource.prototype.drawLight
 * Add a mask for shadows of this light to the light container
 */
export function EVLightSourceDrawLight(wrapped) {
  const shadows = this.los.shadows;
  if ( !shadows || !shadows.length ) return wrapped();

  const maskSprite = new PIXI.Sprite();
  const maskContainer = new PIXI.Container();
  const blurFilter = new BlurFilter({ strength: 2 });
  maskContainer.filters = [blurFilter];

  for ( const shadow of shadows ) {
    const objMaskSprite = new PIXI.Graphics();
    const blurFilter = new BlurFilter({ strength: 1 });
    objMaskSprite.filters = [blurFilter];

    const spriteContainer = new PIXI.Container();

    spriteContainer.addChild(objMaskSprite);
    spriteContainer.maskSprite = objMaskSprite;
    maskContainer.addChild(spriteContainer);

    const maskSprite = new PIXI.Sprite();

    objMaskSprite.beginFill(0x000000, .5); // black
    objMaskSprite.drawShape(shadow);
    objMaskSprite.endFill();
  }

  this.illumination.addChild(maskContainer);

  return wrapped();
}

/**
 * Wrap LightSource.prototype.drawColor
 * Add a mask for shadows of this light to the color container
 */
export function EVLightSourceDrawColor(wrapped) {
  const shadows = this.los.shadows;
  if ( !shadows || !shadows.length ) return wrapped();

  const maskSprite = new PIXI.Sprite();
  const maskContainer = new PIXI.Container();
  const blurFilter = new BlurFilter({ strength: 2 });
  maskContainer.filters = [blurFilter];

  for ( const shadow of shadows ) {
    const objMaskSprite = new PIXI.Graphics();
    const blurFilter = new BlurFilter({ strength: 1 });
    objMaskSprite.filters = [blurFilter];

    const spriteContainer = new PIXI.Container();

    spriteContainer.addChild(objMaskSprite);
    spriteContainer.maskSprite = objMaskSprite;
    maskContainer.addChild(spriteContainer);

    const maskSprite = new PIXI.Sprite();

    objMaskSprite.beginFill(0x000000, .5); // black
    objMaskSprite.drawShape(shadow);
    objMaskSprite.endFill();
  }

  this.coloration.addChild(maskContainer);

  return wrapped();
}


// From https://github.com/fantasycalendar/FoundryVTT-Sequencer/blob/3ed6588bb351206cfee4eed6d750dd56744f7861/scripts/module/lib/filters/blur-filter.js
class BlurFilter extends PIXI.filters.BlurFilter {

    /**
     * Properties & default values:
     *     - strength [8]
     *     - blur [2]
     *     - blurX [2]
     *     - blurY [2]
     *     - quality [4]
     *     - resolution [PIXI.settings.FILTER_RESOLUTION]
     *     - kernelSize [5]
     */
    constructor(inData = {}) {

        inData = foundry.utils.mergeObject({
            strength: 1,
            quality: 4,
            resolution: PIXI.settings.FILTER_RESOLUTION,
            kernelSize: 5
        }, inData)

        super(...Object.values(inData));

        this.isValid = true;
        for (let [key, value] of Object.entries(inData)) {
            try {
                this[key] = value;
            } catch (err) {
                let warning = `${MODULE_ID} | ${this.constructor.name} | Could not set property ${key}`;
                ui.notifications.warn(warning);
                console.warn(warning)
                this.isValid = false;
            }
        }
    }
}

