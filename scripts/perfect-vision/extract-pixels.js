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

    if (texture && (!baseTexture || !baseTexture.valid || baseTexture.parentTextureArray)) {
        throw new Error("Texture is invalid");
    }

    const gl = renderer.gl;
    const readPixels = (frame, resolution) => {
        const x = Math.round(frame.left * resolution);
        const y = Math.round(frame.top * resolution);
        const width = Math.round(frame.right * resolution) - x;
        const height = Math.round(frame.bottom * resolution) - y;
        const pixels = new Uint8Array(4 * width * height);

        gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

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
 * Extract a rectangular block of pixels from the texture (without unpremultiplying).
 * @param {PIXI.Renderer} renderer - The renderer.
 * @param {PIXI.Texture|PIXI.RenderTexture|null} [texture] - The texture the pixels are extracted from; otherwise extract from the renderer.
 * @param {PIXI.Rectangle} [frame] - The rectangle the pixels are extracted from.
 * @returns {{pixels: Uint8Array, width: number, height: number}} The extracted pixel data.
 */
export function extractPixelsFromFloat(renderer, texture, frame) {
    const baseTexture = texture?.baseTexture;

    if (texture && (!baseTexture || !baseTexture.valid || baseTexture.parentTextureArray)) {
        throw new Error("Texture is invalid");
    }

    const gl = renderer.gl;
    const readPixels = (frame, resolution) => {
        const x = Math.round(frame.left * resolution);
        const y = Math.round(frame.top * resolution);
        const width = Math.round(frame.right * resolution) - x;
        const height = Math.round(frame.bottom * resolution) - y;
        const pixels = new Float32Array(width * height);

        gl.readPixels(x, y, width, height, gl.RED, gl.FLOAT, pixels);

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
