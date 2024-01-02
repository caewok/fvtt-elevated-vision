/* globals
*/
"use strict";

import { Settings, getSceneSetting } from "../settings.js";
import { ShaderPatcher, applyPatches } from "../perfect-vision/shader-patcher.js";

export const PATCHES = {};
PATCHES.BASIC = {}; // Basic b/c we are switching the shader uniform dynamically.


/**
 * Wrap AdaptiveLightingShader.create
 * Inherited by AdaptiveVisionShader
 * Add shadow GLSL code to the lighting fragment shaders.
 */
function create(wrapped, ...args) {
  // Don't patch the vision shaders to avoid ghosting.
  if ( AdaptiveVisionShader.isPrototypeOf(this) ) return wrapped(...args);

  applyPatches(this,
    source => {
      source = addShadowVertexCode(source);
      return source;
    },
    source => {
      source = addShadowFragmentCode(source);
      return source;
    }
  );

  const shader = wrapped(...args);
  const shaderAlgorithm = getSceneSetting(Settings.KEYS.SHADING.ALGORITHM);
  shader.uniforms.uEVShadowSampler = PIXI.Texture.EMPTY;
  shader.uniforms.uEVShadows = false;
  return shader;
}

PATCHES.BASIC.STATIC_WRAPS = { create };

/**
 * Add Shadow GLSL code to the vertex source.
 * Calculate canvas position and pass as uv coordinate between 0 and 1.
 */
function addShadowVertexCode(source) {
  try {
    source = new ShaderPatcher("vert")
      .setSource(source)
      .addUniform("uEVCanvasDimensions", "vec2")  // width, height of the canvas rect
      .addUniform("uEVSourceOrigin", "vec2") // x, y source center
      .addUniform("uEVSourceRadius", "float")
      .addVarying("vEVCanvasUV", "vec2")

      .wrapMain(`
void main() {
  vEVCanvasUV =  ((aVertexPosition * uEVSourceRadius) + uEVSourceOrigin) / uEVCanvasDimensions.xy;
  @main();
}`)
      .getSource();

  } finally {
    return source;
  }
}

/**
 * Add Shadow GLSL code to the fragment source.
 * Mark shadow areas using the depth parameter---moving toward full shadow decreases depth to 0.
 */
function addShadowFragmentCode(source) {
  try {
    source = new ShaderPatcher("frag")
      .setSource(source)
      .addUniform("uEVShadowSampler", "sampler2D")
      .addUniform("uEVShadows", "bool")
      .addUniform("uEVDirectional", "bool")
      .addVarying("vEVCanvasUV", "vec2")
      .replace(/gl_FragColor = /, `
        if ( uEVShadows ) {
          vec2 texCoordEV = uEVDirectional ? vEVCanvasUV : vUvs;
          vec4 EV_shadowTexel = texture2D(uEVShadowSampler, texCoordEV);
          float EV_lightAmount = EV_shadowTexel.r;
          if ( EV_shadowTexel.g < 0.3) EV_lightAmount *= EV_shadowTexel.b;
          depth *= EV_lightAmount;
        }
        gl_FragColor =`)

      .getSource();
  } finally {
    return source;
  }
}
