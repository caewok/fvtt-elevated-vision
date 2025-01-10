/* globals
canvas,
PIXI
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Shadow terrain when the source is below.
// Also shadow based on limited angle.

import { MODULE_ID, FLAGS } from "../const.js";
import { sourceAtCanvasElevation } from "../util.js";
import { AbstractEVShader } from "./AbstractEVShader.js";
import { defineFunction } from "./GLSLFunctions.js";


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

    const lightPosition = CONFIG.GeometryLib.threeD.Point3d.fromPointSource(source);
    if ( sourceAtCanvasElevation(lightPosition) ) lightPosition.z += 1;
    defaultUniforms.uSourcePosition = [lightPosition.x, lightPosition.y, lightPosition.z];

    const radius = source.radius || source.data.externalRadius;
    defaultUniforms.uSourceRadius2 = Math.pow(radius, 2);

    // Angle (Emission Angle): angle is split on either side of the line from source in direction of rotation
    // Rotation: 0º / 360º points due south; 90º due west. Rotate so 0º is due west; 90º is due south
    const rot = source.data.rotation || 360;
    defaultUniforms.uRotation = Math.normalizeRadians(Math.toRadians(rot + 90));

    let angle = source.data.angle || 360;
    if ( angle < 180
      && !source.isDirectional
      && source.object.document.getFlag(MODULE_ID, FLAGS.LIGHT_SIZE) ) {
      angle = 180;
    }
    defaultUniforms.uEmissionAngle = angle;

    const shader = super.create(defaultUniforms);
    shader.source = source;
    return shader;
  }

  /**
   * Update based on indicated changes to the source.
   * @param {Set<string>} changes         Change keys for the source.
   * @returns {boolean} True if the indicated changes resulted in a change to the shader.
   */
  sourceUpdated(changes) {
    const changedPosition = changes.has("x") || changes.has("y");
    const changedElevation = changes.has("elevation");
    const changedRadius = changes.has("dim");
    const changedRotation = changes.has("rotation");
    const changedEmissionAngle = changes.has("angle");

    if ( changedPosition || changedElevation ) this.updateSourcePosition();
    if ( changedRadius ) this.updateSourceRadius();
    if ( changedRotation ) this.updateSourceRotation();
    if ( changedEmissionAngle ) this.updateSourceEmissionAngle();
    return changedPosition || changedElevation || changedRadius || changedRotation || changedEmissionAngle;
  }

  updateSourcePosition() {
    const lightPosition = CONFIG.GeometryLib.threeD.Point3d.fromPointSource(this.source);
    if ( sourceAtCanvasElevation(lightPosition) ) lightPosition.z += 1;
    this.uniforms.uSourcePosition = [lightPosition.x, lightPosition.y, lightPosition.z];
  }

  updateSourceRadius() {
    const radius = this.source.radius || this.source.data.externalRadius;
    this.uniforms.uSourceRadius2 = Math.pow(radius, 2);
  }

  updateSourceRotation() {
    const rot = this.source.data.rotation || 360;
    this.uniforms.uRotation = Math.normalizeRadians(Math.toRadians(rot + 90));
  }

  updateSourceEmissionAngle() {
    let angle = this.source.data.angle || 360;
    if ( angle < 180
      && !this.source.isDirectional
      && this.source.object.document.getFlag(MODULE_ID, FLAGS.LIGHT_SIZE) ) {
      angle = 180;
    }
    this.uniforms.uEmissionAngle = angle;
  }

  /**
   * Remove links to large objects.
   */
  destroy() {
    this.source = null;
    super.destroy();
  }
}
