/* globals
canvas,
PIXI
*/
"use strict";

/**
 * Take the output of a shadow mesh and render to a texture representing the light amount.
 * TODO: Combine with multiple tile shadow meshes to get total light amount.
 */
export class ShadowTextureRenderer {
  // TODO: Allow to be changed via CONFIG.

  /** @type {number} */
  static MAX_TEXTURE_SIZE = 4096;

  /** @type PIXI.RenderTexture */
  renderTexture;

  /** @type {RenderedPointSource} */
  source;

  constructor(source, mesh) {
    this.source = source;
    this.mesh = mesh;
    this.renderTexture = PIXI.RenderTexture.create(this.configureTexture());
    this.renderTexture.baseTexture.clearColor = [1, 1, 1, 1];
    this.renderTexture.baseTexture.alphaMode = PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA;
  }

  /**
   * Width of the render texture based on the source dimensions.
   * @type {number}
   */
  get width() { return this.source.radius * 2; }

  /**
   * Height of the render texture based on the source dimensions.
   * @type {number}
   */
  get height() { return this.source.radius * 2; }

  /**
   * Resolution of the render texture base on maximum texture size.
   * @type {number}
   */
  get resolution() {
    const { width, height } = this;

    let resolution = 1;
    const maxSize = Math.min(this.constructor.MAX_TEXTURE_SIZE,  resolution * Math.max(width, height));
    if ( width >= height ) resolution = maxSize / width;
    else resolution = maxSize / height;

    return resolution;
  }

  /**
   * Source bounds defined by the radius of the source.
   * @type {PIXI.Rectangle}
   */
  get sourceBounds() {
    const { x, y } = this.source;
    const r = this.source.radius ?? canvas.dimensions.maxR;
    const d = r * 2;
    return new PIXI.Rectangle(x - r, y - r, d, d);
  }

  /**
   * Render a shadow mesh to the texture.
   * @param {ShadowWallPointSourceMesh} mesh
   * @returns {PIXI.RenderTexture}
   */
  renderShadowMeshToTexture() {
    this.mesh.position = { x: -this.sourceBounds.x, y: -this.sourceBounds.y };
    canvas.app.renderer.render(this.mesh, { renderTexture: this.renderTexture, clear: true });
    return this.renderTexture;
  }

  configureTexture() {
    const { width, height, resolution } = this;
    return {
      width, height, resolution,
      scaleMode: PIXI.SCALE_MODES.NEAREST
    };
  }

  /**
   * Adjust the texture size based on change to source radius.
   * @returns {PIXI.RenderTexture} Updated render texture.
   */
  updateSourceRadius() {
    this.renderTexture.setResolution(this.resolution);
    this.renderTexture.resize(this.width, this.height, true);
    return this.renderShadowMeshToTexture();
  }

  /**
   * Redraws the render texture based on changes to the mesh.
   * @returns {PIXI.RenderTexture} Updated render texture.
   */
  update() {
    return this.renderShadowMeshToTexture();
  }

  /**
   * Destroy the underlying render texture.
   */
  destroy() {
    this.renderTexture.destroy();
  }
}

export class ShadowVisionLOSTextureRenderer extends ShadowTextureRenderer {
  get width() { return canvas.dimensions.width; }

  get height() { return canvas.dimensions.height; }

  /**
   * Source bounds defined by the canvas rectangle or scene rectangle.
   * @type {PIXI.Rectangle}
   */
  get sourceBounds() {
//     const { rect, sceneRect } = canvas.dimensions;
//     if ( sceneRect.contains(this.source.object.center) ) return sceneRect;
    return canvas.dimensions.rect;
  }
}

/* Testing
let [l] = canvas.lighting.placeables;
lightSource = l.source;
mesh = l.source.elevatedvision.shadowMesh

str = new ShadowTextureRenderer(lightSource, mesh);
rt = str.renderShadowMeshToTexture()

s = new PIXI.Sprite(rt);
canvas.stage.addChild(s)
canvas.stage.removeChild(s)

*/
