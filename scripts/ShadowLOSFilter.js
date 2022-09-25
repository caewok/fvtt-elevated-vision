/* globals
canvas,
AbstractBaseFilter,
PIXI
*/
"use strict";

import { perpendicularPoint, distanceBetweenPoints } from "./util.js";
import { FRAGMENT_FUNCTIONS } from "./lighting.js";

// In GLSL 2, cannot use dynamic arrays. So set a maximum number of walls for a given light.
const MAX_NUM_WALLS = 100;

/**
 * Filter that removes polygon fill from shadow areas where the terrain
 * rises above the shadow.
 * For basic gradient filter on a graphic, see:
 * https://www.html5gamedevs.com/topic/37350-how-to-apply-pixifilter-on-polygon-pixigraphics/
 * https://jsfiddle.net/ravindu89/vsvL9knj/6/
 */
export class ShadowLOSFilter extends AbstractBaseFilter {
  /** @override */
  static defaultUniforms = {
    EV_numWalls: 0,
    EV_wallCanvasCoords: new Float32Array(MAX_NUM_WALLS*4),
    EV_wallCanvasElevations: new Float32Array(MAX_NUM_WALLS),
    EV_sourceCanvasElevation: 0,
    EV_sourceCanvasLocation: [0, 0],
    EV_wallCanvasDistances: new Float32Array(MAX_NUM_WALLS),
    EV_hasElevationSampler: false,

    // [min, step, maxPixValue]
    EV_elevationResolution: [0, 1, 255, 1]
  };

  static vertexShader = `
    attribute vec2 aVertexPosition;

    uniform mat3 projectionMatrix;
    uniform mat3 canvasMatrix;
    uniform vec4 inputSize;
    uniform vec4 outputFrame;

    varying vec2 vTextureCoord;
    varying vec2 vCanvasCoord;

    void main(void)
    {
       vTextureCoord = aVertexPosition * (outputFrame.zw * inputSize.zw);
       vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.)) + outputFrame.xy;
       vCanvasCoord = (canvasMatrix * vec3(position, 1.0)).xy;
       gl_Position = vec4((projectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
    }
  `;

  static fragmentShader = `
    varying vec2 vTextureCoord;
    varying vec2 vCanvasCoord;

    uniform sampler2D uSampler;
    uniform vec2 EV_canvasXY;
    uniform int EV_numWalls;
    uniform vec4 EV_wallCanvasCoords[${MAX_NUM_WALLS}];
    uniform float EV_wallCanvasElevations[${MAX_NUM_WALLS}];
    uniform float EV_wallCanvasDistances[${MAX_NUM_WALLS}];
    uniform float EV_sourceCanvasElevation;
    uniform vec2 EV_sourceCanvasLocation;
    uniform sampler2D EV_elevationSampler;
    uniform bool EV_hasElevationSampler;
    uniform vec4 EV_elevationResolution;

    ${FRAGMENT_FUNCTIONS}

    vec4 visionColor = vec4(1., 0., 0., 1.);
    vec4 shadowColor = vec4(0., 0., 0., 0.);

    void main() {
      gl_FragColor = visionColor;
      return;

      vec4 fg = texture2D(uSampler, vTextureCoord);

//       if ( fg.a == 0. ) {
//         gl_FragColor = fg;
//         return;
//       }

      if ( !EV_hasElevationSampler ) {
//         gl_FragColor = fg;
        gl_FragColor = visionColor;
        return;
      }

      vec4 backgroundElevation = texture2D(EV_elevationSampler, vCanvasCoord / EV_canvasXY);
      float pixelCanvasElevation = canvasElevationFromPixel(backgroundElevation.r, EV_elevationResolution);
      bool inShadow = false;
      float percentDistanceFromWall;

      if ( pixelCanvasElevation > EV_sourceCanvasElevation ) {
        inShadow = true;
      } else if ( EV_numWalls > 0 ) {
        const int maxWalls = ${MAX_NUM_WALLS};
        for ( int i = 0; i < maxWalls; i++ ) {
          if ( i >= EV_numWalls ) break;

          bool thisWallInShadow = locationInWallShadow(
            EV_wallCanvasCoords[i],
            EV_wallCanvasElevations[i],
            EV_wallCanvasDistances[i],
            EV_sourceCanvasElevation,
            EV_sourceCanvasLocation,
            pixelCanvasElevation,
            vCanvasCoord,
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
//         fg = shadowColor * fg.a;
        fg = shadowColor;
      } else {
//         fg = visionColor * fg.a;
        fg = visionColor;
      }

      gl_FragColor = fg;
    }
  `;

  /** @override */
  static create(uniforms={}, source) {
    uniforms = { ...this.defaultUniforms, ...uniforms};
    uniforms = updateShadowFilterUniforms(uniforms, source);
    return new this(this.vertexShader, this.fragmentShader, uniforms);
  }

  /** @override */
  // Thanks to https://ptb.discord.com/channels/732325252788387980/734082399453052938/1009287977261879388
  apply(filterManager, input, output, clear, currentState) {
    const { size, distance, width, height } = canvas.dimensions;

    this.uniforms.EV_canvasXY = [width, height];
    this.uniforms.EV_elevationSampler = canvas.elevation?._elevationTexture;
    this.uniforms.EV_hasElevationSampler = Boolean(this.uniforms.EV_elevationSampler);
    this.uniforms.EV_elevationSampler ??= PIXI.Texture.EMPTY;

    // [min, step, maxPixValue, canvasMult]
    const { elevationMin, elevationStep, maximumPixelValue } = canvas.elevation;
    this.uniforms.EV_elevationResolution = [elevationMin, elevationStep, maximumPixelValue, size / distance];

    this.uniforms.canvasMatrix ??= new PIXI.Matrix();
    this.uniforms.canvasMatrix.copyFrom(currentState.target.worldTransform).invert();
    return super.apply(filterManager, input, output, clear, currentState);
  }
}

function updateShadowFilterUniforms(uniforms, source) {
  const walls = source.los.wallsBelowSource || new Set();
  const { x, y } = source;

  uniforms.EV_sourceCanvasElevation = source.elevationZ;
  if ( !isFinite(uniforms.EV_sourceCanvasElevation) ) uniforms.EV_sourceCanvasElevation = Number.MAX_SAFE_INTEGER;

  uniforms.EV_sourceCanvasLocation = [x, y];

  let wallCoords = [];
  let wallElevations = [];
  let wallDistances = [];
  for ( const w of walls ) {
    const a = w.A;
    const b = w.B;

    // Point where line from light, perpendicular to wall, intersects
    const wallIx = perpendicularPoint(a, b, {x, y});
    if ( !wallIx ) continue; // Likely a and b not proper wall.

    const wallOriginDist = distanceBetweenPoints({x, y}, wallIx);
    wallDistances.push(wallOriginDist);
    wallElevations.push(w.topZ);
    wallCoords.push(a.x, a.y, b.x, b.y);
  }

  uniforms.EV_numWalls = wallElevations.length;

  if ( !wallCoords.length ) wallCoords = new Float32Array(MAX_NUM_WALLS*4);
  if ( !wallElevations.length ) wallElevations = new Float32Array(MAX_NUM_WALLS);
  if ( !wallDistances.length ) wallDistances = new Float32Array(MAX_NUM_WALLS);

  uniforms.EV_wallCanvasCoords = wallCoords;
  uniforms.EV_wallCanvasElevations = wallElevations;
  uniforms.EV_wallCanvasDistances = wallDistances;

  return uniforms;
}
