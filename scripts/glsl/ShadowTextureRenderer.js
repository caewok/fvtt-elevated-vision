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
  get width() {
    const diameter = this.source.radius * 2;
    return Math.min(ShadowTextureRenderer.MAX_TEXTURE_SIZE, diameter);
  }

  /**
   * Height of the render texture based on the source dimensions.
   * @type {number}
   */
  get height() {
    const diameter = this.source.radius * 2;
    return Math.min(ShadowTextureRenderer.MAX_TEXTURE_SIZE, diameter);
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
    return {
      width: this.width,
      height: this.height,
      scaleMode: PIXI.SCALE_MODES.NEAREST
    };
  }

  /**
   * Adjust the texture size based on change to source radius.
   * @returns {PIXI.RenderTexture} Updated render texture.
   */
  updateSourceRadius() {
    this.renderTexture.resize(this.width, this.height);
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
  get width() {
    const { width, height } = canvas.dimensions;
    let texWidth = width;
    const maxSize = ShadowTextureRenderer.MAX_TEXTURE_SIZE;

    if ( width > height && width > maxSize ) texWidth = maxSize;
    else if ( height > width && height > maxSize ) {
      const reduction = maxSize / height;
      texWidth = width * reduction;
    }
    return texWidth;
  }

  get height() {
    const { width, height } = canvas.dimensions;
    let texHeight = height;
    const maxSize = ShadowTextureRenderer.MAX_TEXTURE_SIZE;

    if ( width > height && width > maxSize ) {
      const reduction = maxSize / width;
      texHeight = height * reduction;
    } else if ( height > width && height > maxSize ) texHeight = maxSize;

    return texHeight;
  }

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
