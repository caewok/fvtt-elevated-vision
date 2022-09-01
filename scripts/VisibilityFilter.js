/* globals

*/
"use strict";

import { FRAGMENT_FUNCTIONS } from "./lighting.js";


/**
 * Wrap VisibilityFilter.create to insert fragment shader code.
 * Do not shade when the elevation of the terrain in shadow is sufficiently
 * high to bring the terrain out of shadow.
 */
export function createVisibilityFilter(wrapped, ...args) {
  log("createVisibilityFilter");

  if ( this.fragmentShader.includes(FRAGMENT_UNIFORMS) ) return wrapped(...args);

  log("createVisibilityFilter adding shadow shader code");
  const replaceFragUniformStr = "uniform bool hasFogTexture;";
  const replaceFragStr = "gl_FragColor = mix(fow, vec4(0.0), v);";
  const replaceFragFnStr = "void main() {";


  this.fragmentShader = this.fragmentShader.replace(
    replaceFragUniformStr, `${replaceFragUniformStr}\n${FRAGMENT_UNIFORMS}`);

  this.fragmentShader = this.fragmentShader.replace(
    replaceFragFnStr, `${FRAGMENT_FUNCTIONS}\n${replaceFragFnStr}\n`);

  this.fragmentShader = this.fragmentShader.replace(
    replaceFragStr, `${SHADOW_CALCULATION}\n${replaceFragStr}`);

  const shader = wrapped(...args);
  shader.uniforms.EV_numWalls = 0;
  shader.uniforms.EV_wallElevations = new Float32Array(MAX_NUM_WALLS);
  shader.uniforms.EV_wallCoords = new Float32Array(MAX_NUM_WALLS*4);
  shader.uniforms.EV_lightElevation = 0.5;
  shader.uniforms.EV_wallDistances = new Float32Array(MAX_NUM_WALLS);
  shader.uniforms.EV_isVision = false;
  shader.uniforms.EV_elevationSampler = canvas.elevation._elevationTexture ?? PIXI.Texture.EMPTY;

  shader.uniforms.EV_transform = [1, 1, 1, 1];
  shader.uniforms.EV_hasElevationSampler = false;

  // [min, step, maxPixelValue ]
  shader.uniforms.EV_elevationResolution = [0, 1, 255, 1];

}

/**
 * Wrap VisibilityFilter.prototype.apply
 * Add canvas matrix uniform to lookup elevation texture values.
 * Thanks to https://ptb.discord.com/channels/732325252788387980/734082399453052938/1009287977261879388
 */
export applyVisibilityFilter(wrapped, ...args) {
  this.uniforms.canvasMatrix ??= new PIXI.Matrix();
  this.uniforms.canvasMatrix.copyFrom(canvas.stage.worldTransform).invert();
  return wrapped(...args);
}

const FRAGMENT_UNIFORMS =
`
uniform int EV_numWalls;
uniform vec4 EV_wallCoords[${MAX_NUM_WALLS}];
uniform float EV_wallElevations[${MAX_NUM_WALLS}];
uniform float EV_wallDistances[${MAX_NUM_WALLS}];
uniform float EV_lightElevation;
uniform bool EV_isVision;
uniform sampler2D EV_elevationSampler;
uniform vec4 EV_transform;
uniform vec4 EV_elevationResolution;
uniform bool EV_hasElevationSampler;
`;

const SHADOW_CALCULATION =
`
`


