/* globals
PIXI
*/
"use strict";

import { AbstractEVShader } from "./AbstractEVShader.js";


export class TestShadowShader extends AbstractEVShader {
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
  vVertexPosition = aVertexPosition;
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

  // Ignore fully light areas for this test by setting opacity to 0.
  fragColor = vec4(vec3(0.0), 1.0 - lightAmount);
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

/* Testing
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
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

shadowShader = TestShadowShader.create(rt);

quadMesh = new EVQuadMesh(str.sourceBounds, shadowShader);

canvas.stage.addChild(quadMesh);
canvas.stage.removeChild(quadMesh);

*/
