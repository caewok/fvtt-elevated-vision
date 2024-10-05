/* globals
canvas,
PIXI
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Shadow terrain when the source is below.
// Also shadow based on limited angle.

import { AbstractEVShader } from "./AbstractEVShader.js";
import { defineFunction } from "./GLSLFunctions.js";
import { MODULE_ID } from "../const.js";

export class ShadowTerrainShader extends AbstractEVShader {
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec2 aVertexPosition;

out vec2 vVertexPosition;
out vec2 vTerrainTexCoord;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec4 uSceneDims;
uniform vec3 uSourcePosition;
uniform float uRotation; // Radians
uniform float uEmissionAngle; // Degrees

flat out vec4 rMinMax;

${defineFunction("fromAngle")}
${defineFunction("toRadians")}

void main() {
  // Calculate the min (ccw) and max (cw) bounding rays if angle not 360º
  if ( uEmissionAngle != 360.0 ) {
    float rad = toRadians(uEmissionAngle * 0.5);
    vec2 rMin = fromAngle(uSourcePosition.xy, uRotation - rad, 10.0);
    vec2 rMax = fromAngle(uSourcePosition.xy, uRotation + rad, 10.0);
    rMinMax = vec4(rMin, rMax);
  }

  // Calculate the terrain texture coordinate at this vertex based on scene dimensions.
  vTerrainTexCoord = (aVertexPosition.xy - uSceneDims.xy) / uSceneDims.zw;
  vVertexPosition = aVertexPosition;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

// #define SHADOW

in vec2 vVertexPosition;
in vec2 vTerrainTexCoord;

flat in vec4 rMinMax;

out vec4 fragColor;

uniform sampler2D uTerrainSampler;
uniform vec3 uSourcePosition;
uniform vec4 uElevationRes;
uniform float uEmissionAngle; // Degrees
uniform float uSourceRadius2;

${defineFunction("distanceSquared")}
${defineFunction("pointBetweenRays")}
${defineFunction("toRadians")}
${defineFunction("terrainElevation")}

void main() {
  // If we are outside the radius; ignore
  // float dist2 = distanceSquared(vVertexPosition, uSourcePosition.xy);
  // if ( dist2 > uSourceRadius2 ) discard;

  bool fullShadow = false;

  // Shadow pixels outside the limited angle
  fullShadow = fullShadow  || (uEmissionAngle != 360.0
    && !pointBetweenRays(vVertexPosition, uSourcePosition.xy, rMinMax.xy, rMinMax.zw, uEmissionAngle));

  if ( !fullShadow ) {
    // Test terrain elevation
    float elevation = terrainElevation(uTerrainSampler, vTerrainTexCoord, uElevationRes);
    fullShadow = elevation > uSourcePosition.z;
  }

  if ( !fullShadow ) discard;

  // Encoding for no light.
  fragColor = vec4(0.0, 1.0, 1.0, 1.0);
}`;

  static defaultUniforms = {
    uSceneDims: [0, 0, 1, 1],
    uElevationRes: [0, 1, 256 * 256, 1],
    uSourcePosition: [0, 0, 0],
    uTerrainSampler: 0,
    uSourceRadius2: 1,
    uRotation: 0, // In radians. Between 1º and 360º
    uEmissionAngle: 360 // In degrees. Between 1º and 360º (0º === 360º)
  };

  static create(source, defaultUniforms = {}) {
    const { sceneRect, distancePixels } = canvas.dimensions;
    defaultUniforms.uSceneDims ??= [
      sceneRect.x,
      sceneRect.y,
      sceneRect.width,
      sceneRect.height
    ];

    const ev = canvas.scene[MODULE_ID];
    defaultUniforms.uElevationRes ??= [
      ev.elevationMin,
      ev.elevationStep,
      ev.elevationMax,
      distancePixels
    ];

    defaultUniforms.uTerrainSampler = ev._elevationTexture;
    defaultUniforms.uSourcePosition = [source.x, source.y, source.elevationZ];

    const radius = source.radius || source.data.externalRadius;
    defaultUniforms.uSourceRadius2 = Math.pow(radius, 2);

    // Angle (Emission Angle): angle is split on either side of the line from source in direction of rotation
    // Rotation: 0º / 360º points due south; 90º due west. Rotate so 0º is due west; 90º is due south
    const rot = source.data.rotation || 360;
    defaultUniforms.uRotation = Math.normalizeRadians(Math.toRadians(rot + 90));
    defaultUniforms.uEmissionAngle = source.data.angle || 360;

    return super.create(defaultUniforms);
  }

  /**
   * Update based on indicated changes to the source.
   * @param {RenderedSourcePoint} source
   * @param {object} [changes]    Object indicating which properties of the source changed
   * @param {boolean} [changes.changedPosition]   True if the source changed position
   * @param {boolean} [changes.changedRadius]     True if the source changed radius
   * @param {boolean} [changes.changedRotation]   True if the source changed rotation
   * @param {boolean} [changes.changedEmissionAngle]  True if the source changed emission angle
   * @returns {boolean} True if the indicated changes resulted in a change to the shader.
   */
  sourceUpdated(source, { changedPosition, changedElevation, changedRadius, changedRotation, changedEmissionAngle } = {}) {
    if ( changedPosition || changedElevation ) this.updateSourcePosition(source);
    if ( changedRadius ) this.updateSourceRadius(source);
    if ( changedRotation ) this.updateSourceRotation(source);
    if ( changedEmissionAngle ) this.updateSourceEmissionAngle(source);
    return changedPosition || changedElevation || changedRadius || changedRotation || changedEmissionAngle;
  }

  updateSourcePosition(source) {
    this.uniforms.uSourcePosition = [source.x, source.y, source.elevationZ];
  }

  updateSourceRadius(source) {
    const radius = source.radius || source.data.externalRadius;
    this.uniforms.uSourceRadius2 = Math.pow(radius, 2);
  }

  updateSourceRotation(source) {
    const rot = source.data.rotation || 360;
    this.uniforms.uRotation = Math.normalizeRadians(Math.toRadians(rot + 90));
  }

  updateSourceEmissionAngle(source) {
    this.uniforms.uEmissionAngle = source.data.angle || 360;
  }
}
