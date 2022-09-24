/* globals
AdaptiveLightingShader,
*/
"use strict";

import { log } from "./util.js";
import { perpendicularPoint, distanceBetweenPoints } from "./util.js";
import { FRAGMENT_FUNCTIONS, pointCircleCoord } from "./lighting.js";

// In GLSL 2, cannot use dynamic arrays. So set a maximum number of walls for a given light.
const MAX_NUM_WALLS = 100;

export class ShadowShader extends AdaptiveLightingShader {

  static vertexShader = `
  ${this.VERTEX_ATTRIBUTES}
  ${this.VERTEX_UNIFORMS}
  ${this.VERTEX_FRAGMENT_VARYINGS}

  uniform vec4 EV_transform;
  varying vec2 EV_textureCoord;

  void main() {
    vec3 tPos = translationMatrix * vec3(aVertexPosition, 1.0);
    vUvs = aVertexPosition * 0.5 + 0.5;
    vDepth = aDepthValue;
    vSamplerUvs = tPos.xy / screenDimensions;

    EV_textureCoord = EV_transform.xy * vUvs + EV_transform.zw;

    gl_Position = vec4((projectionMatrix * tPos).xy, 0.0, 1.0);
  }`;

  static fragmentShader = `
  varying vec2 EV_textureCoord;
  varying vec2 vSamplerUvs;
  varying vec2 vUvs;

  uniform sampler2D uSampler;
  uniform sampler2D EV_elevationSampler;
  uniform vec2 EV_canvasXY;
  uniform vec4 EV_elevationResolution;
  uniform float EV_sourceElevation;
  uniform int EV_numWalls;

  // Wall data, in vUvs coordinate space
  uniform vec4 EV_wallCoords[${MAX_NUM_WALLS}];
  uniform float EV_wallElevations[${MAX_NUM_WALLS}];
  uniform float EV_wallDistances[${MAX_NUM_WALLS}];

  // EV functions
  ${FRAGMENT_FUNCTIONS}

  // Defined constants
  vec4 visionColor = vec4(1., 0., 0., 1.);
  vec4 shadowColor = vec4(0., 0., 0., 1.);
  vec2 center = vec2(0.5);
  const int maxWalls = ${MAX_NUM_WALLS};

  void main() {
    vec4 backgroundElevation = texture2D(EV_elevationSampler, EV_textureCoord);
    float pixelCanvasElevation = canvasElevationFromPixel(backgroundElevation.r, EV_elevationResolution);
    bool inShadow = false;
    float percentDistanceFromWall;

    if ( pixelCanvasElevation > EV_sourceElevation ) {
        inShadow = true;
    } else if ( EV_numWalls > 0 ){
      for ( int i = 0; i < maxWalls; i++ ) {
        if ( i >= EV_numWalls ) break;

        bool thisWallInShadow = locationInWallShadow(
          EV_wallCoords[i],
          EV_wallElevations[i],
          EV_wallDistances[i],
          EV_sourceElevation,
          center,
          pixelCanvasElevation,
          vUvs,
          percentDistanceFromWall
        );

        if ( thisWallInShadow ) {
          // Current location is within shadow of this wall
          inShadow = true;
          break;
        }
      }
    }

    if ( inShadow ) {
      discard;
    } else {
      gl_FragColor = visionColor;
    }


//     if ( backgroundElevation.r > 0. ) {
// //       gl_FragColor = shadowColor;
//       discard; // Unclear whether discard is what we want here.
//     } else {
// //       vec4 fg = texture2D(uSampler, vSamplerUvs);
// //        gl_FragColor = fg;
//       gl_FragColor = visionColor;
//
//     }
  }
  `;

  /** @override */
  static create(uniforms={}, source) {
    updateShadowShaderUniforms(uniforms, source);
    return super.create(uniforms);
  }

}

export function updateShadowShaderUniforms(uniforms, source) {
  // Screen-space to local coords:
  // https://ptb.discord.com/channels/732325252788387980/734082399453052938/1010914586532261909
  // shader.uniforms.EV_canvasMatrix ??= new PIXI.Matrix();
  // shader.uniforms.EV_canvasMatrix
  //   .copyFrom(canvas.stage.worldTransform)
  //   .invert()
  //   .append(mesh.transform.worldTransform);

  const { elevationMin, elevationStep, maximumPixelValue } = canvas.elevation;
  const { size, distance, width, height } = canvas.dimensions;
  const { x, y, radius } = source;
  const r_inv = 1 / radius;

  uniforms.EV_elevationSampler = canvas.elevation?._elevationTexture || PIXI.Texture.EMPTY;

  // [min, step, maxPixValue, canvasMult]
  const elevationMult = size * (1 / distance) * 0.5 * r_inv;
  uniforms.EV_elevationResolution = [elevationMin, elevationStep, maximumPixelValue, elevationMult];

  // Uniforms based on source
  uniforms.EV_sourceElevation = source.elevationZ * 0.5 * r_inv

  // Alternative version using vUvs, given that light source mesh have no rotation
  // https://ptb.discord.com/channels/732325252788387980/734082399453052938/1010999752030171136

  uniforms.EV_transform = [
    radius * 2 / width,
    radius * 2 / height,
    (x - radius) / width,
    (y - radius) / height
  ];

  // Construct wall data
  const center = {x, y};
  const center_shader = {x: 0.5, y: 0.5};
  const walls = source.los.wallsBelowSource || new Set();
  let wallCoords = [];
  let wallElevations = [];
  let wallDistances = [];
  for ( const w of walls ) {
    const a = pointCircleCoord(w.A, radius, center, r_inv);
    const b = pointCircleCoord(w.B, radius, center, r_inv);

    // Point where line from light, perpendicular to wall, intersects
    const wallIx = perpendicularPoint(a, b, center_shader);
    if ( !wallIx ) continue; // Likely a and b not proper wall.

    const wallOriginDist = distanceBetweenPoints(center_shader, wallIx);
    wallDistances.push(wallOriginDist);
    wallElevations.push(w.topZ * 0.5 * r_inv);
    wallCoords.push(a.x, a.y, b.x, b.y);
  }

  uniforms.EV_numWalls = wallElevations.length;

  if ( !wallCoords.length ) wallCoords = new Float32Array(MAX_NUM_WALLS*4);
  if ( !wallElevations.length ) wallElevations = new Float32Array(MAX_NUM_WALLS);
  if ( !wallDistances.length ) wallDistances = new Float32Array(MAX_NUM_WALLS);

  uniforms.EV_wallCoords = wallCoords;
  uniforms.EV_wallElevations = wallElevations;
  uniforms.EV_wallDistances = wallDistances;
}

/**
 * Wrap LightSource.prototype.updateUniforms
 */
export function _updateUniformsLightSource(wrapper) {
  log("_updateUniformsLightSource")
  wrapper();
  if ( this._EV_mesh.los._destroyed ) {
    log("_updateUniformsLightSource los mesh destroyed!");
    this._createEVMeshes();
  }

  updateShadowShaderUniforms(this._EV_mesh.los.shader.uniforms, this);
}

/**
 * Wrap VisionSource.prototype.updateUniforms
 */
export function _updateUniformsVisionSource(wrapper) {
  log("_updateUniformsVisionSource")
  wrapper();
  if ( this._EV_mesh.los._destroyed || this._EV_mesh.fov._destroyed ) {
    log("_updateUniformsLightSource los mesh destroyed!");
    this._createEVMeshes();
  }

  updateShadowShaderUniforms(this._EV_mesh.los.shader.uniforms, this);
  updateShadowShaderUniforms(this._EV_mesh.fov.shader.uniforms, this);
}
