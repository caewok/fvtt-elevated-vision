/* globals
PIXI
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { AbstractEVShader } from "./AbstractEVShader.js";
import { defineFunction } from "./GLSLFunctions.js";


export class ShadowVisionMaskShader extends AbstractEVShader {
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec2 aVertexPosition;
in vec2 aTextureCoord;

out vec2 vVertexPosition;
out vec2 vTextureCoord;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec2 uSourcePosition;
uniform float uRotation; // Radians
uniform float uEmissionAngle; // Degrees

flat out vec4 rMinMax;

${defineFunction("fromAngle")}
${defineFunction("toRadians")}

void main() {
  // Calculate the min (ccw) and max (cw) bounding rays if angle not 360º
  if ( uEmissionAngle != 360.0 ) {
    float rad = toRadians(uEmissionAngle * 0.5);
    vec2 rMin = fromAngle(uSourcePosition, uRotation - rad, 10.0);
    vec2 rMax = fromAngle(uSourcePosition, uRotation + rad, 10.0);
    rMinMax = vec4(rMin, rMax);
  }

  vTextureCoord = aTextureCoord;
  vVertexPosition = aVertexPosition;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec2 vVertexPosition;
in vec2 vTextureCoord;

out vec4 fragColor;

uniform sampler2D uShadowSampler;
uniform vec2 uSourcePosition;
uniform float uSourceRadius2;
uniform float uEmissionAngle; // Degrees

flat in vec4 rMinMax;

${defineFunction("between")}
${defineFunction("distanceSquared")}
${defineFunction("pointBetweenRays")}
${defineFunction("toRadians")}

void main() {
  // if ( any(equal(between(0.0, 1.0, vTextureCoord), vec2(0.0))) ) discard;
  if ( distanceSquared(vVertexPosition, uSourcePosition) > uSourceRadius2 ) discard;

  // Discard pixels outside the angle of the source.
  if ( uEmissionAngle != 360.0
    && !pointBetweenRays(vVertexPosition, uSourcePosition, rMinMax.xy, rMinMax.zw, uEmissionAngle) ) discard;

  vec4 shadowTexel = texture(uShadowSampler, vTextureCoord);
  float lightAmount = shadowTexel.r;

  // If more than 1 limited wall at this point, add to the shadow.
  // If a single limited wall, ignore.
  if ( shadowTexel.g < 0.3 ) lightAmount *= shadowTexel.b;

  // If in light, color red. Discard if in shadow.
  // See https://github.com/caewok/fvtt-elevated-vision/blob/0.4.8/scripts/vision.js#L209
  // and https://github.com/caewok/fvtt-elevated-vision/blob/0.4.8/scripts/ShadowShaderNoRadius.js
  // Greater than 50% in anticipation of penumbra shadows.
  if ( lightAmount < 0.50 ) discard;
  fragColor = vec4(1.0, 0.0, 0.0, 0.5);
}`;

  /**
   * Uniform parameters:
   * uElevationRes: [minElevation, elevationStep, maxElevation, gridScale]
   * uTerrainSampler: elevation texture
   * uMinColor: Color to use at the minimum elevation: minElevation + elevationStep
   * uMaxColor: Color to use at the maximum current elevation: uMaxNormalizedElevation
   * uMaxNormalizedElevation: Maximum elevation, normalized units
   */
  static defaultUniforms = {
    uShadowSampler: 0,
    uSourcePosition: [0, 0],
    uSourceRadius2: 1,
    uRotation: 0, // In radians. Between 1º and 360º
    uEmissionAngle: 360 // In degrees. Between 1º and 360º (0º === 360º)
  };

  static create(source, defaultUniforms = {}) {
    const radius = source.radius || source.data.externalRadius;

    defaultUniforms.uShadowSampler = source.EVShadowTexture.baseTexture;
    defaultUniforms.uSourcePosition = [source.x, source.y];
    defaultUniforms.uSourceRadius2 = Math.pow(radius, 2);

    // Angle (Emission Angle): angle is split on either side of the line from source in direction of rotation
    // Rotation: 0º / 360º points due south; 90º due west. Rotate so 0º is due west; 90º is due south
    const rot = source.data.rotation || 360;
    defaultUniforms.uRotation = Math.normalizeRadians(Math.toRadians(rot + 90));
    defaultUniforms.uEmissionAngle = source.data.angle || 360;

    const out = super.create(defaultUniforms);
    out.source = source;
    return out;
  }

  updateSourcePosition(source) {
    this.uniforms.uSourcePosition = [source.x, source.y];
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


// TODO: Extend ShadowVisionMaskShader or vice-versa and use #define to modify the shaders.
/**
 * Token LOS is the LOS polygon; aVertexPosition is in canvas coordinates.
 */
export class ShadowVisionMaskTokenLOSShader extends AbstractEVShader {
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec2 aVertexPosition;
in vec2 aTextureCoord;

out vec2 vVertexPosition;
out vec2 vTextureCoord;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec2 uSourcePosition;
uniform float uRotation; // Radians
uniform float uEmissionAngle; // Degrees

flat out vec4 rMinMax;

${defineFunction("fromAngle")}
${defineFunction("toRadians")}

void main() {
  // Calculate the min (ccw) and max (cw) bounding rays if angle not 360º
  if ( uEmissionAngle != 360.0 ) {
    float rad = toRadians(uEmissionAngle * 0.5);
    vec2 rMin = fromAngle(uSourcePosition, uRotation - rad, 10.0);
    vec2 rMax = fromAngle(uSourcePosition, uRotation + rad, 10.0);
    rMinMax = vec4(rMin, rMax);
  }

  vTextureCoord = aTextureCoord;
  vVertexPosition = aVertexPosition;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec2 vVertexPosition;
in vec2 vTextureCoord;

out vec4 fragColor;

uniform sampler2D uShadowSampler;
uniform vec2 uSourcePosition;
uniform float uSourceRadius2;
uniform float uEmissionAngle; // Degrees

flat in vec4 rMinMax;

${defineFunction("between")}
${defineFunction("distanceSquared")}
${defineFunction("pointBetweenRays")}
${defineFunction("toRadians")}

void main() {
  if ( any(equal(between(0.0, 1.0, vTextureCoord), vec2(0.0))) ) discard;

  // Discard pixels outside the angle of the source.
  if ( uEmissionAngle != 360.0
    && !pointBetweenRays(vVertexPosition, uSourcePosition, rMinMax.xy, rMinMax.zw, uEmissionAngle) ) discard;

  vec4 shadowTexel = texture(uShadowSampler, vTextureCoord);

  float lightAmount = shadowTexel.r;

  // If more than 1 limited wall at this point, add to the shadow.
  // If a single limited wall, ignore.
  if ( shadowTexel.g < 0.3 ) lightAmount *= shadowTexel.b;

  // If in light, color red. Discard if in shadow.
  // See https://github.com/caewok/fvtt-elevated-vision/blob/0.4.8/scripts/vision.js#L209
  // and https://github.com/caewok/fvtt-elevated-vision/blob/0.4.8/scripts/ShadowShaderNoRadius.js
  // Greater than 50% in anticipation of penumbra shadows.
  if ( lightAmount < 0.50 ) discard;
  fragColor = vec4(1.0, 0.0, 0.0, 0.5);
}`;

  /**
   * Uniform parameters:
   * uElevationRes: [minElevation, elevationStep, maxElevation, gridScale]
   * uTerrainSampler: elevation texture
   * uMinColor: Color to use at the minimum elevation: minElevation + elevationStep
   * uMaxColor: Color to use at the maximum current elevation: uMaxNormalizedElevation
   * uMaxNormalizedElevation: Maximum elevation, normalized units
   */
  static defaultUniforms = {
    uShadowSampler: 0,
    uSourcePosition: [0, 0],
    uRotation: 0, // In radians. Between 1º and 360º
    uEmissionAngle: 360 // In degrees. Between 1º and 360º (0º === 360º)
  };

  static create(source, defaultUniforms = {}) {
    defaultUniforms.uShadowSampler = source.EVShadowTexture.baseTexture;

    // Angle (Emission Angle): angle is split on either side of the line from source in direction of rotation
    // Rotation: 0º / 360º points due south; 90º due west. Rotate so 0º is due west; 90º is due south
    defaultUniforms.uSourcePosition = [source.x, source.y];
    const rot = source.data.rotation || 360;
    defaultUniforms.uRotation = Math.normalizeRadians(Math.toRadians(rot + 90));
    defaultUniforms.uEmissionAngle = source.data.angle || 360;

    return super.create(defaultUniforms);
  }

  // Disable unused methods.
  updateSourcePosition(_source) {
    this.uniforms.uSourcePosition = [source.x, source.y];
  } // eslint-disable-line no-useless-return

  updateSourceRadius(_source) { return; } // eslint-disable-line no-useless-return

  updateSourceRotation(source) {
    const rot = source.data.rotation || 360;
    this.uniforms.uRotation = Math.normalizeRadians(Math.toRadians(rot + 90));
  }

  updateSourceEmissionAngle(source) {
    this.uniforms.uEmissionAngle = source.data.angle || 360;
  }
}

/* Testing
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevatedvision").api
AbstractEVShader = api.AbstractEVShader
EVQuadMesh = api.EVQuadMesh
ShadowTextureRenderer = api.ShadowTextureRenderer
TestShadowShader = api.TestShadowShader


let [l] = canvas.lighting.placeables;
source = l.source;

source = _token.vision

shadowMesh = source.elevatedvision.shadowMesh
canvas.stage.addChild(shadowMesh)
canvas.stage.removeChild(shadowMesh)

str = new ShadowTextureRenderer(source, shadowMesh);
rt = str.renderShadowMeshToTexture()

s = new PIXI.Sprite(rt)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)

shadowShader = ShadowVisionMaskShader.create(rt);

quadMesh = new EVQuadMesh(str.source.bounds, shadowShader);

canvas.stage.addChild(quadMesh);
canvas.stage.removeChild(quadMesh);

// Testing the already constructed mask
Draw.shape(source.object.los, { color: Draw.COLORS.red, width: 5 });

shadowMesh = source.elevatedvision.shadowMesh
canvas.stage.addChild(shadowMesh)
canvas.stage.removeChild(shadowMesh)

str = source.elevatedvision.shadowRenderer;
s = new PIXI.Sprite(str.renderTexture)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)


mask = source.elevatedvision.shadowVisionMask
canvas.stage.addChild(mask)
canvas.stage.removeChild(mask)


mask = source.EVVisionMask
canvas.stage.addChild(mask)
canvas.stage.removeChild(mask)

// Test the vision LOS mask
Draw.shape(source.object.fov, { color: Draw.COLORS.red, width: 5 });
Draw.shape(source.object.los, { color: Draw.COLORS.blue, width: 5 });

mesh = source.elevatedvision.shadowVisionLOSMesh
canvas.stage.addChild(mesh)
canvas.stage.removeChild(mesh)


s = new PIXI.Sprite(source.elevatedvision.shadowVisionLOSRenderer.renderTexture)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)


mask = source.elevatedvision.shadowVisionLOSMask;
canvas.stage.addChild(mask)
canvas.stage.removeChild(mask)

*/
