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
in vec2 aTextureCoord;

out vec2 vVertexPosition;
out vec2 vTextureCoord;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

void main() {
  vTextureCoord = aTextureCoord;
  vVertexPosition = aVertexPosition;
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
uniform vec2 uSourcePosition;
uniform float uSourceRadius2;

${defineFunction("between")}
${defineFunction("distanceSquared")}

void main() {
  // if ( any(equal(between(0.0, 1.0, vTextureCoord), vec2(0.0))) ) discard;
  float dist2 = distanceSquared(vVertexPosition, uSourcePosition);
  if ( dist2 > uSourceRadius2 ) discard;

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
    uSourceRadius2: 1
  };

  static create(source, defaultUniforms = {}) {
    const radius = source.radius || source.data.externalRadius;

    defaultUniforms.uShadowSampler = source.EVShadowTexture.baseTexture;
    defaultUniforms.uSourcePosition = [source.x, source.y];
    defaultUniforms.uSourceRadius2 = Math.pow(radius, 2);

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

void main() {
  vTextureCoord = aTextureCoord;
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
  };

  static create(source, defaultUniforms = {}) {
    defaultUniforms.uShadowSampler = source.EVShadowTexture.baseTexture;
    return super.create(defaultUniforms);
  }

  // Disable unused methods.
  updateSourcePosition(source) { return; }

  updateSourceRadius(source) { return; }

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
