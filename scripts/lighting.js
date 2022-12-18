/* globals
GlobalLightSource
*/
"use strict";

import { log } from "./util.js";
import { ShaderPatcher, applyPatches } from "./perfect-vision/shader-patcher.js";

import { GLSL, updateUniformsForSource, MAX_NUM_WALL_ENDPOINTS } from "./Shadow_GLSL.js";

const DEPTH_CALCULATION =
`
float depth = smoothstep(0.0, 1.0, vDepth);
vec4 backgroundElevation = vec4(0.0, 0.0, 0.0, 1.0);
vec2 EV_textureCoord = EV_transform.xy * vUvs + EV_transform.zw;
backgroundElevation = texture2D(EV_elevationSampler, EV_textureCoord);

float pixelElevation = canvasElevationFromPixel(backgroundElevation.r, EV_elevationResolution);
vec3 pixelLocation = vec3(vUvs.x, vUvs.y, pixelElevation);

if ( pixelElevation > EV_sourceLocation.z ) {
  // If elevation at this point is above the light, then light cannot hit this pixel.
  depth = 0.0;
  inShadow = EV_isVision; // isShadow is global

} else {
  inShadow = pixelInShadow(
    pixelLocation,
    EV_sourceLocation,
    EV_wallCoords,
    EV_numWalls,
    EV_numTerrainWalls
  );
}
if ( inShadow ) {
  depth = min(depth, 0.1);
}
`;

const FRAG_COLOR =
`
  if ( EV_isVision && inShadow ) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
`;

function addShadowCode(source) {
  try {
    source = new ShaderPatcher("frag").setSource(source);

    for ( const uniform of GLSL.UNIFORMS ) {
      const { name, type, array } = uniform;
      source = source.addUniform(`${name}${array}`, type); // Array usually empty, sometimes, e.g. "[200]"
    }

    // Reverse to preserve dependency order for the functions (each new function added before)
    const fns = [...GLSL.FUNCTIONS].reverse(); // reverse modifies in place
    for ( const fn of fns ) {
      const { name, body, returnType, params } = fn.definition;
      source = source.addFunction(name, returnType, body, params);
    }

    // Add variable that can be seen by wrapped main
    source = source.addGlobal("inShadow", "bool", "false");

    // Add define after so it appears near the top
    // .prependBlock(`#define MAX_NUM_WALLS ${MAX_NUM_WALLS}`)

    source = source.replace(/float depth = smoothstep[(]0.0, 1.0, vDepth[)];/, DEPTH_CALCULATION);

    source = source.wrapMain(`\
      void main() {
        @main();

        ${FRAG_COLOR}
      }

    `);

    source = source.getSource();

  } finally {
    return source;
  }

}

/**
 * Wrap AdaptiveLightShader.prototype.create
 * Modify the code to add shadow depth based on background elevation and walls
 * Add uniforms used by the fragment shader to draw shadows in the color and illumination shaders.
 */
export function createAdaptiveLightingShader(wrapped, ...args) {
  log("createAdaptiveLightingShaderPV");

  applyPatches(this,
    false,
    source => {
      source = addShadowCode(source);
      return source;
    });

  const shader = wrapped(...args);

  for ( const uniform of GLSL.UNIFORMS ) {
    const { name, initial } = uniform;
    shader.uniforms[name] = initial;
  }

  shader.uniforms.EV_isVision = false;
  return shader;
}

/**
 * Wrap LightSource.prototype._updateColorationUniforms.
 * Add uniforms needed for the shadow fragment shader.
 */
export function _updateColorationUniformsLightSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;
  this._updateEVLightUniforms(this.coloration);
}

/**
 * Wrap LightSource.prototype._updateIlluminationUniforms.
 * Add uniforms needed for the shadow fragment shader.
 */
export function _updateIlluminationUniformsLightSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;
  this._updateEVLightUniforms(this.illumination);
}

/**
 * Helper function to add uniforms for the light shaders.
 * Add:
 * - elevation of the light
 * - number of walls that are in the LOS and below the light source elevation
 * For each wall that is below the light source, add
 *   (in the coordinate system used in the shader):
 * - wall coordinates
 * - wall elevations
 * - distance between the wall and the light source center
 * @param {PIXI.Shader} shader
 */
export function _updateEVLightUniformsLightSource(mesh) {
  updateUniformsForSource(mesh.shader.uniforms, this, { useRadius: true });
}

/**
 * Wrap LightSource.prototype._createLOS.
 * Trigger an update to the illumination and coloration uniforms, so that
 * the light reflects the current shadow positions when dragged.
 * @returns {ClockwiseSweepPolygon}
 */
export function _createPolygonLightSource(wrapped) {
  const los = wrapped();

  // TO-DO: Only reset uniforms if:
  // 1. there are shadows
  // 2. there were previously shadows but are now none

  this._resetUniforms.illumination = true;
  this._resetUniforms.coloration = true;

  return los;
}
