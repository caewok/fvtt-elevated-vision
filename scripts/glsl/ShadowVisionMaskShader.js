/* globals
canvas,
PIXI
*/
"use strict";

import { AbstractEVShader } from "./AbstractEVShader.js";
import { defineFunction } from "./GLSLFunctions.js";


export class ShadowVisionMaskShader extends AbstractEVShader {
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec2 aVertexPosition;

out vec2 vVertexPosition;
out vec2 vTextureCoord;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

void main() {
  // Don't use aTextureCoord because it is broken.
  // https://ptb.discord.com/channels/170995199584108546/811676497965613117/1122891745705861211
  vTextureCoord = aVertexPosition * 0.5 + 0.5;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec2 vVertexPosition;
in vec2 vTextureCoord;

out vec4 fragColor;

uniform sampler2D uShadowSampler;

void main() {
  if ( vTextureCoord.x < 0.0
    || vTextureCoord.x > 1.0
    || vTextureCoord.y < 0.0
    || vTextureCoord.y > 1.0 ) discard;

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
    uShadowSampler: 0
  };

  static create(shadowSampler, defaultUniforms = {}) {
    defaultUniforms.uShadowSampler = shadowSampler.baseTexture;
    return super.create(defaultUniforms);
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

out vec2 vVertexPosition;
out vec2 vTextureCoord;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec2 uCanvasDim; // width, height

void main() {
  // Don't use aTextureCoord because it is broken.
  // https://ptb.discord.com/channels/170995199584108546/811676497965613117/1122891745705861211
  vTextureCoord = aVertexPosition / uCanvasDim;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec2 vVertexPosition;
in vec2 vTextureCoord;

out vec4 fragColor;

uniform sampler2D uShadowSampler;

${defineFunction("between")}

void main() {
  if ( any(equal(between(0.0, 1.0, vTextureCoord), vec2(0.0))) ) discard;

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
    uCanvasDim: [1, 1]  // Params: width, height
  };

  static create(shadowSampler, defaultUniforms = {}) {
    const { width, height } = canvas.dimensions;
    defaultUniforms.uCanvasDim = [width, height];
    defaultUniforms.uShadowSampler = shadowSampler.baseTexture;
    return super.create(defaultUniforms);
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

mask = source.elevatedvision.shadowVisionMask
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
