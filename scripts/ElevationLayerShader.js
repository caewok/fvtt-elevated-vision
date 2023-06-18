/* global
canvas,
Color,
foundry,
mergeObject,
PIXI
*/
"use strict";

import { getSetting, SETTINGS } from "./settings.js";

class AbstractEVShader extends PIXI.Shader {
  constructor(program, uniforms) {
    super(program, foundry.utils.deepClone(uniforms));

    /**
     * The initial default values of shader uniforms
     * @type {object}
     */
    this._defaults = uniforms;
  }

  /* -------------------------------------------- */

  /**
   * The raw vertex shader used by this class.
   * A subclass of AbstractBaseShader must implement the vertexShader static field.
   * @type {string}
   */
  static vertexShader = "";

  /**
   * The raw fragment shader used by this class.
   * A subclass of AbstractBaseShader must implement the fragmentShader static field.
   * @type {string}
   */
  static fragmentShader = "";

  /**
   * The default uniform values for the shader.
   * A subclass of AbstractBaseShader must implement the defaultUniforms static field.
   * @type {object}
   */
  static defaultUniforms = {};

  /* -------------------------------------------- */

  /**
   * A factory method for creating the shader using its defined default values
   * @param {object} defaultUniforms
   * @returns {AbstractBaseShader}
   */
  static create(defaultUniforms) {
    const program = PIXI.Program.from(this.vertexShader, this.fragmentShader);
    const uniforms = mergeObject(this.defaultUniforms, defaultUniforms, {inplace: false, insertKeys: false});
    return new this(program, uniforms);
  }

  /* -------------------------------------------- */

  /**
   * Reset the shader uniforms back to their provided default values
   * @private
   */
  reset() {
    for (let [k, v] of Object.entries(this._defaults)) {
      this.uniforms[k] = v;
    }
  }
}

/**
 * Mesh that takes a rectangular frame instead of a geometry.
 * @param {PIXI.Rectangle} rect
 */
export class EVQuadMesh extends PIXI.Mesh {
  constructor(rect, shader, state, drawMode) {
    const geometry = EVQuadMesh.calculateQuadGeometry(rect);
    super(geometry, shader, state, drawMode);
    this.rect = rect;
  }

  /**
   * Construct a geometry that represents a rectangle on the canvas.
   * Adds vertex coordinates and texture UV coordinates.
   * @param {PIXI.Rectangle} rect   Rectangle to use for the frame.
   * @returns {PIXI.Geometry}
   */
  static calculateQuadGeometry(rect) {
    const { left, right, top, bottom } = rect;
    const geometry = new PIXI.Geometry();
    geometry.addAttribute("aVertexPosition", [
      left, top,      // TL
      right, top,   // TR
      right, bottom, // BR
      left, bottom  // BL
    ], 2);

    // Texture coordinates:
    // BL: 0,0; BR: 1,0; TL: 0,1; TR: 1,1
    geometry.addAttribute("aTextureCoord", [
      0, 0, // TL
      1, 0, // TR
      1, 1, // BR
      0, 1 // BL
    ], 2);
    geometry.addIndex([0, 1, 2, 0, 2, 3]);
    return geometry;
  }
}

/**
 * Shader to represent elevation values on the elevation layer canvas.
 */
export class ElevationLayerShader extends AbstractEVShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
`
#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec2 aVertexPosition;
in vec2 aTextureCoord;

out vec2 vVertexPosition;
out vec2 vTextureCoord;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

void main() {
  vVertexPosition = aVertexPosition;
  vTextureCoord = aTextureCoord;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

  static fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec2 vVertexPosition;
in vec2 vTextureCoord;

out vec4 fragColor;

uniform sampler2D uTerrainSampler; // Elevation Texture
uniform vec4 uElevationRes;
uniform vec4 uMinColor;
uniform vec4 uMaxColor;
uniform float uMaxNormalizedElevation;

/**
 * Convert a Hue-Saturation-Brightness color to RGB - useful to convert polar coordinates to RGB
 * See BaseShaderMixin.HSB2RGB
 * @type {string}
 */
vec3 hsb2rgb(in vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0), 6.0)-3.0)-1.0, 0.0, 1.0 );
  rgb = rgb*rgb*(3.0-2.0*rgb);
  return c.z * mix(vec3(1.0), rgb, c.y);
}

/**
 * From https://stackoverflow.com/questions/15095909/from-rgb-to-hsv-in-opengl-glsl
 * @param {vec3} c    RGB color representation (0–1)
 * @returns {vec3} HSV color representation (0–1)
 */
// All components are in the range [0…1], including hue.
vec3 rgb2hsv(in vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

/**
 * From https://www.shadertoy.com/view/XljGzV.
 * @param {vec3} c    HSV color representation (0–1)
 * @returns {vec3} RGB color representation (0–1)
 */
// All components are in the range [0…1], including hue.
vec3 hsv2rgb(in vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

/**
 * Return the normalized elevation value for a given color representation.
 * @param {vec4} pixel    Color representation of elevation value on canvas
 * @returns {float} The normalized elevation value, between 0 and 65,536.
 */
float decodeElevationChannels(in vec4 color) {
  color = color * 255.0;
  return (color.g * 256.0) + color.r;
}

/**
 * Return the scaled elevation value for a given normalized value.
 * @param {float} value   The normalized elevation between 0 and 65,536
 * @returns {float} Scaled elevation value based on scene settings, in grid units
 */
float scaleNormalizedElevation(in float value) {
  float elevationMin = uElevationRes.r;
  float elevationStep = uElevationRes.g;
  return elevationMin + (round(value * elevationStep * 10.0) * 0.1);
}

/**
 * Convert grid to pixel units.
 * @param {float} value     Number, in grid units
 * @returns {float} The equivalent number in pixel units based on grid distance
 */
float gridUnitsToPixels(in float value) {
  float distancePixels = uElevationRes.a;
  return value * distancePixels;
}

/**
 * Convert a color pixel to a scaled elevation value, in pixel units.
 */
float colorToElevationPixelUnits(in vec4 color) {
  float e = decodeElevationChannels(color);
  e = scaleNormalizedElevation(e);
  return gridUnitsToPixels(e);
}

/**
 * Determine the color for a given elevation value.
 * Currently draws increasing shades of red with a gamma correction to avoid extremely light alpha.
 */
vec4 colorForElevation(float eNorm) {
  // Linear mix of the two HSV colors and alpha.
  // Skipping 0, so one less entry
  float maxNorm = max(1.0, uMaxNormalizedElevation - 1.0);
  vec4 color = mix(uMinColor, uMaxColor, (eNorm - 1.0) / maxNorm);

  // If using hsv
  // color.rgb = hsv2rgb(color.rgb);

  // Gamma correction to avoid extremely light alpha?
  // color.a = pow(color.a, 1. / 2.2);

  // Gamma correct alpha and colors?
  // color = pow(color, vec4(1. / 2.2));

  return color;
}

void main() {
  // Terrain is sized to the scene.
  vec4 terrainPixel = texture(uTerrainSampler, vTextureCoord);
  float eNorm = decodeElevationChannels(terrainPixel);
  fragColor = eNorm == 0.0 ? vec4(0.0) : colorForElevation(eNorm);
}`;

  static defaultUniforms = {
    uElevationRes: [
        0,
        1,
        256 * 256,
        1
      ],
    uTerrainSampler: 0,
    uMinColor: [1, 0, 0, 1],
    uMaxColor: [0, 0, 1, 1],
    uMaxNormalizedElevation: 65536
  };

  static create(defaultUniforms = {}) {
    const ev = canvas.elevation;
    defaultUniforms.uElevationRes ??= [
        ev.elevationMin,
        ev.elevationStep,
        ev.elevationMax,
        // canvas.elevation.maximumPixelValue,
        canvas.dimensions.distancePixels
      ];
    defaultUniforms.uTerrainSampler = canvas.elevation._elevationTexture;
    defaultUniforms.uMinColor = this.getDefaultColorArray("MIN");
    defaultUniforms.uMaxColor = this.getDefaultColorArray("MAX");
    defaultUniforms.uMaxNormalizedElevation = ev._normalizeElevation(ev.elevationCurrentMax);

    return super.create(defaultUniforms);
  }

  /**
   * Update the minimum color uniform.
   * @param {string} newColorHex
   */
  updateMinColor(newColorHex) {
    this.uniforms.uMinColor = this.constructor.getColorArray(newColorHex);
  }

  /**
   * Update the maximum color uniform.
   * @param {string} newColorHex
   */
  updateMaxColor(newColorHex) {
    this.uniforms.uMaxColor = this.constructor.getColorArray(newColorHex);
  }

  /**
   * Update the maximum elevation value.
   * @param {number}
   */
  updateMaxCurrentElevation() {
    this.uniforms.uMaxNormalizedElevation = canvas.elevation._normalizeElevation(canvas.elevation.elevationCurrentMax);
  }

  /**
   * Return the current color setting as a 4-element array.
   * @param {string} type   MIN or MAX
   * @returns {number[4]}
   */
  static getDefaultColorArray(type = "MIN") {
    const hex = getSetting(SETTINGS.COLOR[type]);
    return this.getColorArray(hex);
  }

  /**
   * Return the color array for a given hex.
   * @param {string} hex    Hex value for color with alpha
   * @returns {number[4]}
   */
  static getColorArray(hex) {
    const startIdx = hex.startsWith("#") ? 1 : 0;
    const hexColor = hex.substring(startIdx, startIdx + 6);
    const hexAlpha = hex.substring(startIdx + 6);
    const alpha = parseInt(hexAlpha, 16) / 255;
    const c = Color.fromString(hexColor);
    return [...c.rgb, alpha];
  }
}
