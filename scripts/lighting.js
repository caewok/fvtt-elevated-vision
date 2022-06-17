/* globals
GhostLightIlluminationShader,
PIXI,
canvas
*/
"use strict";

import { log } from "./util.js";
import { MODULE_ID } from "./const.js";
import { InvertFilter } from "./InvertFilter.js";

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
// _updateMesh(mesh) {
//   mesh.position.set(this.data.x, this.data.y);
//   mesh.width = mesh.height = this.radius * 2;
//   return mesh



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
      objMaskSprite.drawShape(shadow.clone());
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


// Draw gradient circle
function gradient(from, to) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const grd = ctx.createLinearGradient(0,0,100,100);
  grd.addColorStop(0, from);
  grd.addColorStop(1, to);
  ctx.fillStyle = grd;
  ctx.fillRect(0,0,100,100);
  return new PIXI.Texture.from(c);
}

// alternatively, dg = new PIXI.Graphics()
dg = canvas.controls.debug;
cir = new PIXI.Circle(0, 0, 500)
dg.beginTextureFill(gradient('#9ff', '#033'))
dg.drawShape(cir)
dg.endFill()




/**
 * Wrap LightSource.prototype.drawLight
 * Add a mask for shadows of this light to the light container
 */
export function EVLightSourceDrawLight(wrapped) {
  const out = wrapped(); // Doesn't work at all when doing this first.

  const shadows = this.los.shadows;
  if ( !shadows || !shadows.length ) return out;

  const shadowGraphics = new PIXI.Graphics();

  for ( const shadow of shadows ) {


  }





  const shadows = this.los.shadows;
  if ( !shadows || !shadows.length ) return out;

//   const maskSprite = new PIXI.Sprite();

  const shadowGraphics = new PIXI.Graphics();

//   const maskContainer = new PIXI.Container();
//   maskContainer.position.set(this.data.x, this.data.y); // does not appear at all

//   this.losMask.clear().beginFill(0xFFFFFF).drawShape(this.los);
//   this.losMask.clear().beginFill(0xFFFFFF).drawShape(this.los).endFill();
//   this.losMask.clear()
  for ( const shadow of shadows ) {
    shadowGraphics.beginFill(0xFFFFFF, .7).drawShape(shadow).endFill();

//     this.losMask.beginFill(0x000000, .5).drawShape(shadow).endFill();
//     this.losMask.beginFill(0xFFFFFF, .5).drawShape(shadow).endFill();
//     this.losMask.beginHole().drawShape(shadow).endHole();

  }
  shadowGraphics.endFill();

  // https://stackoverflow.com/questions/50940737/how-to-convert-a-graphic-to-a-sprite-in-pixijs
  const shadowTexture = canvas.app.renderer.generateTexture(shadowGraphics);
  const shadowSprite = new PIXI.Sprite(shadowTexture);

//   this.losMask.endFill();

  // this.losMask.filters = [new InvertFilter];
  this.illumination.filters ??= [];

  // from https://github.com/pixijs/pixijs/issues/8207
  this.illumination.filters.push(new PIXI.SpriteMaskFilter(undefined, `\


  this.illumination.filters[0].maskSprite = shadowSprite;


//   for ( const shadow of shadows ) {
//     this.losMask.beginFill(0xFFFFFF, .2).drawShape(shadow).endFill();
//
//   }


//   out.addChild(maskContainer);
//   this.illumination.addChild(maskContainer);
//   out.addChild(maskContainer);
//   out.mask = maskContainer;
//   maskContainer.position.set(this.data.x, this.data.y)
  return out;
}

/* Testing
l = [...canvas.lighting.objects.children][0];
ill = l.source.illumination
maskContainer = ill.children[0]
maskSprite = maskContainer.children[0]
canvas.app.stage.addChild(maskSprite)

mask = ill.mask.children[0]
canvas.app.stage.addChild(mask)

// draw original shadow
shadow = l.source.los.shadows[0]
shadow.draw();

*/

/**
 * Wrap LightSource.prototype.drawColor
 * Add a mask for shadows of this light to the color container
 */
export function EVLightSourceDrawColor(wrapped) {
//   const out = wrapped();

  const shadows = this.los.shadows;
  if ( !shadows || !shadows.length ) return wrapped();

//   const maskContainer = new PIXI.Container();

  for ( const shadow of shadows ) {
    const gr = new PIXI.Graphics();
//     gr.beginFill(canvas.lighting.channels.background.hex, .5); // black 0x000000
    gr.beginFill(0x000000, .5);
    gr.drawShape(shadow.clone());
    gr.endFill();

    const texture = canvas.app.renderer.generateTexture(gr);
    const maskSprite = new PIXI.Sprite(texture);
    maskSprite.position.set(this.data.x, this.data.y);
    // maskSprite.tint = canvas.lighting.channels.background.hex;
//     maskSprite.zIndex = 10;
    this.coloration.addChild(maskSprite);
  }


  return wrapped();
}

export function EVLightSourceDrawBackground(wrapped) {
//   const out = wrapped();

  const shadows = this.los.shadows;
  if ( !shadows || !shadows.length ) return wrapped();

//   const maskContainer = new PIXI.Container();

  for ( const shadow of shadows ) {
    const gr = new PIXI.Graphics();
//     gr.beginFill(canvas.lighting.channels.background.hex, .5); // black 0x000000
    gr.beginFill(0x000000, .5);
    gr.drawShape(shadow.clone());
    gr.endFill();

    const texture = canvas.app.renderer.generateTexture(gr);
    const maskSprite = new PIXI.Sprite(texture);
    maskSprite.tint = canvas.lighting.channels.background.hex;
    maskSprite.zIndex = 10;
    maskSprite.blendMode = PIXI.BLEND_MODES.ERASE;
    this.background.addChild(maskSprite);
  }

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

