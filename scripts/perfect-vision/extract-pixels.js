// Shamelessly borrowed from https://github.com/dev7355608/perfect-vision/blob/main/scripts/utils/extract-pixels.js

/**
 * Extract a rectangular block of pixels from the texture (without unpremultiplying).
 * @param {PIXI.Renderer} renderer - The renderer.
 * @param {PIXI.Texture|PIXI.RenderTexture|null} [texture] - The texture the pixels are extracted from; otherwise extract from the renderer.
 * @param {PIXI.Rectangle} [frame] - The rectangle the pixels are extracted from.
 * @returns {{pixels: Uint8Array, width: number, height: number}} The extracted pixel data.
 */
export function extractPixels(renderer, texture, frame) {
    const baseTexture = texture?.baseTexture;
    if (texture && (!baseTexture
      || !baseTexture.valid
      || baseTexture.parentTextureArray)) throw new Error("Texture is invalid");

    const gl = renderer.gl;
    let type = gl.UNSIGNED_BYTE;
    let format = gl.RGBA;
    if ( baseTexture ) {
      type = PIXI.TYPES[baseTexture.resource?.type] ?? baseTexture.type;
      format = PIXI.FORMATS[baseTexture.resource?.format] ?? baseTexture.format;
    }

    const typedArray = TYPED_ARRAY[PIXI.TYPES[type]];
    if ( !typedArray ) throw new Error(`Texture type ${type} not supported.`);
    const nComponents = FORMATS_TO_COMPONENTS[format] ?? 1;


    const readPixels = (frame, resolution) => {
        const x = Math.round(frame.left * resolution);
        const y = Math.round(frame.top * resolution);
        const width = Math.round(frame.right * resolution) - x;
        const height = Math.round(frame.bottom * resolution) - y;
        const pixels = new typedArray(nComponents * width * height);

        gl.readPixels(x, y, width, height, format, type, pixels);

        return { pixels, x, y, width, height };
    }

    if (!texture) {
        renderer.renderTexture.bind(null);
        return readPixels(frame ?? renderer.screen, renderer.resolution);

    } else if (texture instanceof PIXI.RenderTexture) {
        renderer.renderTexture.bind(texture);
        return readPixels(frame ?? texture.frame, baseTexture.resolution);

    } else {
        renderer.texture.bind(texture);
        const framebuffer = gl.createFramebuffer();
        try {
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(
                gl.FRAMEBUFFER,
                gl.COLOR_ATTACHMENT0,
                gl.TEXTURE_2D,
                baseTexture._glTextures[renderer.CONTEXT_UID]?.texture,
                0
            );

            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                throw new Error("Failed to extract pixels from texture");
            }

            return readPixels(frame ?? texture.frame, baseTexture.resolution);
        } finally {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteFramebuffer(framebuffer);
        }
    }
}

/**
 * Unpremultiply the pixel data.
 * @param {Uint8Array} pixels
 */
export function unpremultiplyPixels(pixels) {
    const n = pixels.length;

    for (let i = 0; i < n; i += 4) {
        const alpha = pixels[i + 3];

        if (alpha === 0) {
            const a = 255 / alpha;

            pixels[i] = Math.min(pixels[i] * a + 0.5, 255);
            pixels[i + 1] = Math.min(pixels[i + 1] * a + 0.5, 255);
            pixels[i + 2] = Math.min(pixels[i + 2] * a + 0.5, 255);
        }
    }
}

/**
 * Create a canvas element containing the pixel data.
 * @param {Uint8Array} pixels
 * @param {number} width
 * @param {number} height
 * @returns {HTMLCanvasElement}
 */
export function pixelsToCanvas(pixels, width, height) {
    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    const imageData = context.getImageData(0, 0, width, height);

    imageData.data.set(pixels);
    context.putImageData(imageData, 0, 0);

    return canvas;
}

/**
 * Asynchronously convert a canvas element to base64.
 * @param {HTMLCanvasElement} canvas
 * @param {string} [type="image/png"]
 * @param {number} [quality]
 * @returns {Promise<string>} The base64 string of the canvas.
 */
export async function canvasToBase64(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        }, type, quality);
    });
}


/**
 * Select a typed array for a given texture type; used in extraction.
 */
const TYPED_ARRAY = {
  BYTE: Int8Array,
  SHORT: Int16Array,
  INT: Int32Array,
  UNSIGNED_BYTE: Uint8Array,
  UNSIGNED_SHORT: Uint16Array,
  UNSIGNED_INT: Int32Array,
  FLOAT: Float32Array
};

/**
 * Select number of components for a given texture format; used in extraction.
 * Could use PIXI.FORMATS_TO_COMPONENTS if it was complete.
 */
const FORMATS_TO_COMPONENTS = {
  6402: 1,  // "DEPTH_COMPONENT"
  6403: 1, // "RED"
  6406: 1, // "ALPHA"
  6407: 3, // "RGB"
  6408: 4, // "RGBA"
  6409: 3, // "LUMINANCE"
  6410: 4, // "LUMINANCE_ALPHA"
  33319: 2, // "RG"
  33320: 2, //"RG_INTEGER"
  34041: 1, // "DEPTH_STENCIL"
  36244: 1, // "RED_INTEGER"
  36248: 3, // "RGB_INTEGER"
  36249: 4 //  "RGBA_INTEGER"
}
