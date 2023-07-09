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
  get width() { return this.source.bounds.width; }

  /**
   * Height of the render texture based on the source dimensions.
   * @type {number}
   */
  get height() { return this.source.bounds.height; }

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
   * Position of the mesh relative to the render texture.
   * The render texture goes from 0,0 --> width, height.
   * But the mesh is in canvas coordinates.
   * Center the render texture on the source center by moving the mesh in the opposite direction.
   */
  get meshPosition() {
    return new PIXI.Point(
      -this.source.x + (this.width * 0.5),
      -this.source.y + (this.height * 0.5)
    );
  }

  /**
   * Render a shadow mesh to the texture.
   * @param {ShadowWallPointSourceMesh} mesh
   * @returns {PIXI.RenderTexture}
   */
  renderShadowMeshToTexture() {
    const tl = this.topLeft;
    this.mesh.position.set(this.meshPosition.x, this.meshPosition.y);
    canvas.app.renderer.render(this.mesh, { renderTexture: this.renderTexture, clear: true });
    this.mesh.position.set(0, 0);
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
  /** @type {number} */
  get width() { return canvas.dimensions.width; }

  /** @type {number} */
  get height() { return canvas.dimensions.height; }

  /**
   * Here, the render texture and the mesh are the same coordinate system: the canvas
   * @type {PIXI.Point}
   */
  get meshPosition() { return new PIXI.Point(0, 0); }

  // Disable updating source radius b/c not needed.
  updateSourceRadius() { return; }
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
