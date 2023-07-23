/* globals
AdaptiveVisionShader
*/
"use strict";

import { SETTINGS, getSceneSetting } from "../settings.js";
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
    false,
    source => {
      source = addShadowFragmentCode(source);
      return source;
    }
  );

  const shader = wrapped(...args);
  const shaderAlgorithm = getSceneSetting(SETTINGS.SHADING.ALGORITHM);
  shader.uniforms.uEVShadowSampler = 0;
  shader.uniforms.uEVShadows = shaderAlgorithm === SETTINGS.SHADING.TYPES.WEBGL;
  shader.uniforms.uEVrMinMax = [0, 0, 0, 0];
  shader.uniforms.uEVEmissionAngle = 360;

  return shader;
}

PATCHES.BASIC.STATIC_WRAPS = { create };

// Functions needed for lighting, in the format required by the ShaderPatcher
const LIGHTING_SHADER_FNS = {};
LIGHTING_SHADER_FNS.orient = {
  name: "orient",
  type: "float(in vec2 a, in vec2 b, in vec2 c)",
  body:
`
return (a.y - c.y) * (b.x - c.x) - (a.x - c.x) * (b.y - c.y);
`};

LIGHTING_SHADER_FNS.pointBetweenRays = {
  name: "pointBetweenRays",
  type: "bool(in vec2 pt, in vec2 v, in vec2 ccw, in vec2 cw, in float angle)",
  body:
`
if ( angle > 180.0 ) {
  bool outside = orient(v, cw, pt) <= 0.0 && orient(v, ccw, pt) >= 0.0;
  return !outside;
}
return orient(v, ccw, pt) <= 0.0 && orient(v, cw, pt) >= 0.0;
`};

/**
 * Shadow GLSL code to add to the fragment source.
 */
function addShadowFragmentCode(source) {
  const { orient, pointBetweenRays } = LIGHTING_SHADER_FNS;

  try {
    source = new ShaderPatcher("frag")
      .setSource(source)
      .addUniform("uEVShadowSampler", "sampler2D")
      .addUniform("uEVShadows", "bool")
      .addUniform("uEVrMinMax", "vec4")
      .addUniform("uEVEmissionAngle", "float")
      .addFunction(
        orient.name,
        orient.type,
        orient.body)
      .addFunction(
        pointBetweenRays.name,
        pointBetweenRays.type,
        pointBetweenRays.body)

      .replace(/gl_FragColor = /, `
        if ( uEVShadows ) {
          // Shadow outside the angle of the light.
          // Done here b/c the shadow shader only shades behind walls.
          if ( uEVEmissionAngle != 360.0
            && pointBetweenRays(vUvs, vec2(0.5), uEVrMinMax.xy, uEVrMinMax.zw, uEVEmissionAngle) ) depth = 0.0;
          if ( depth > 0.0 ) {
            vec4 EV_shadowTexel = texture2D(uEVShadowSampler, vUvs);
            float EV_lightAmount = EV_shadowTexel.r;
            if ( EV_shadowTexel.g < 0.3) EV_lightAmount *= EV_shadowTexel.b;
            depth *= EV_lightAmount;
          }
        }
        gl_FragColor =`)

      .getSource();
  } finally {
    return source;
  }
}
