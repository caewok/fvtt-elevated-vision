/* globals
canvas,
PIXI
*/
"use strict";

import { SETTINGS, getSceneSetting } from "../settings.js";
import { ShaderPatcher, applyPatches } from "../perfect-vision/shader-patcher.js";

// Add shadow GLSL code to the lighting shaders.
const originalFragmentSource = new Map();

export function createAdaptiveLightingShader(wrapped, ...args) {
//   if ( !originalFragmentSource.has(this.name) ) originalFragmentSource.set(this.name, this.fragmentShader);
//   const shaderAlgorithm = getSceneSetting(SETTINGS.SHADING.ALGORITHM);
//   if ( shaderAlgorithm !== SETTINGS.SHADING.TYPES.WEBGL ) {
//     this.fragmentShader = originalFragmentSource.get(this.name);
//     return wrapped(...args);
//   }

  applyPatches(this,
    false,
    source => {
      source = addShadowFragmentCode(source);
      return source;
    }
  );

  const shader = wrapped(...args);
  shader.uniforms.uEVShadowSampler = 0;
  return shader;
}

function addShadowFragmentCode(source) {
  try {
    source = new ShaderPatcher("frag")
      .setSource(source)
      .addUniform("uEVShadowSampler", "sampler2D")

      .replace(/gl_FragColor = /, `
        vec4 EV_shadowTexel = texture2D(uEVShadowSampler, vUvs);
        float EV_lightAmount = EV_shadowTexel.r;
        if ( EV_shadowTexel.g < 0.5) EV_lightAmount *= EV_shadowTexel.b;
        depth *= EV_lightAmount;
        gl_FragColor =`)

      .getSource();
  } finally {
    return source;
  }
}
