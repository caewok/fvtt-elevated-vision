/* globals

*/
"use strict";

import { log, perpendicularPoint, distanceBetweenPoints } from "./util.js";
import { FRAGMENT_FUNCTIONS } from "./lighting.js";

// In GLSL 2, cannot use dynamic arrays. So set a maximum number of walls for a given light.
const MAX_NUM_WALLS = 100;


// Test filter

class MyLOSFilter extends AbstractBaseFilter {
  static defaultUniforms = {
    EV_hasElevationSampler: false,
    EV_elevationResolution: [0, 1, 255, 1],
    EV_sourceElevation: 0,
    EV_sourceXY: [0, 0]
  };

  static vertexShader = `
    attribute vec2 aVertexPosition;
    attribute vec2 aTextureCoord;

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
    varying vec2 vTextureCoord; // x,y coordinates between 0 and 1
    varying vec2 vCanvasCoord; // x,y coordinates equal to canvas coordinate system
    uniform sampler2D uSampler;
    uniform sampler2D EV_elevationSampler;
    uniform bool EV_hasElevationSampler;
    uniform vec2 EV_canvasXY;
    uniform vec4 EV_elevationResolution;
    uniform float EV_sourceElevation;
    uniform vec2 EV_sourceXY;

    void main() {
      vec4 fg = texture2D(uSampler, vTextureCoord);
      vec4 backgroundElevation = texture2D(EV_elevationSampler, vCanvasCoord / EV_canvasXY);
      float pixelElevation = ((backgroundElevation.r * EV_elevationResolution.b * EV_elevationResolution.g) - EV_elevationResolution.r) * EV_elevationResolution.a;
      bool inShadow = false;

      if ( pixelElevation > EV_sourceElevation ) {
        // Pixel location is above the source, so it is in shadow.
        inShadow = true;
      } else if ( EV_numWalls > 0 ) {
        // If pixel location is in a shadow area, it might be visible if terrain is high enough.
        float adjSourceElevation = EV_sourceElevation - pixelElevation;

        const int maxWalls = ${MAX_NUM_WALLS};
        for ( int i = 0; i < maxWalls; i++ ) {

          // If the wall is higher than the light, skip. Should not occur.
          float We = EV_wallElevations[i]
          if ( EV_sourceElevation <= We ) continue;

          // If the pixel is above the wall, skip.
          if ( pixelElevation >= We ) continue;

          // If the wall does not intersect the line between the center and this point, no shadow here.
          vec4 wall = EV_wallCoords[i];
          if ( !lineSegmentIntersects(vCanvasCoord, EV_sourceXY, wall.xy, wall.zw) ) continue;

          float distOW = EV_wallDistances[i];

          // Distance from wall (as line) to this location
          vec2 wallIxPoint = perpendicularPoint(wall.xy, wall.zw, vCanvasCoord);
          float distWP = distance(vCanvasCoord, wallIxPoint);

          float adjWe = We - pixelElevation;

          // atan(opp/adj) equivalent to JS Math.atan(opp/adj)
          // atan(y, x) equivalent to JS Math.atan2(y, x)
          float theta = atan((adjSourceElevation - adjWe) /  distOW);

          // Distance from center/origin to furthest part of shadow perpendicular to wall
          float distOV = adjSourceElevation / tan(theta);
          float maxDistWP = distOV - distOW;

          if ( distWP < maxDistWP ) {
            // Current location is within shadow
            inShadow = true;
            break;
          }
        }
      }

      if ( inShadow ) {
        fg = vec4(0., 0., 0., 0.) * fg.a;
        // fg = vec4(1., 0., 1., 1.) * fg.a; // color it magenta if inside polygon
      } else {
        fg = vec4(1., 1., 1., 1.) * fg.a;
      }

      gl_FragColor = fg;



//       gl_FragColor = mix(color2, color1, vCanvasCoord.y);
//       vec4 fg = texture2D(uSampler, vTextureCoord);
      // gl_FragColor = mix(color2, color1, vFilterCoord.y);
//       vec4 mixCol = mix(color2, color1, vFilterCoord.y);
//       gl_FragColor = mix(fg, mixCol, 1.0);


    }
  `;

  /** @override */
  // Thanks to https://ptb.discord.com/channels/732325252788387980/734082399453052938/1009287977261879388
  apply(filterManager, input, output, clear, currentState) {
    this.uniforms.EV_canvasXY = [canvas.dimensions.width, canvas.dimensions.height];
    this.uniforms.EV_elevationSampler = canvas.elevation._elevationTexture;
    this.uniforms.EV_sceneXY = [canvas.dimensions.sceneX, canvas.dimensions.sceneY];

    // [min, step, maxPixValue, canvasMult]
    const { elevationMin, elevationStep, maximumPixelValue } = canvas.elevation;
    const { size, distance } = canvas.dimensions;
    this.uniforms.EV_elevationResolution = [elevationMin, elevationStep, maximumPixelValue, size / distance];

//     this.uniforms.EV_hasElevationSampler = Boolean(this.uniforms.EV_elevationSampler);
//     this.uniforms.EV_elevationSampler ??= PIXI.Texture.EMPTY;

//     console.log(`apply filter ${this.uniforms.EV_hasElevationSampler}`).
    this.uniforms.EV_hasElevationSampler = true;
    this.uniforms.canvasMatrix ??= new PIXI.Matrix();
    this.uniforms.canvasMatrix.copyFrom(canvas.stage.worldTransform).invert();
    return super.apply(filterManager, input, output, clear, currentState);
  }
}

// Mostly for testing
function convertElevation({pixel, pixelInt, elevation, canvasElevation } = {}) {
  if ( !pixel && !pixelInt && !elevation && !canvasElevation ) pixel = 0;

  if ( pixelInt ) pixel = pixelInt / canvas.elevation.maximumPixelValue;
  else if ( elevation ) pixel = elevationToPixel(elevation);
  else if ( canvasElevation ) pixel = canvasElevationToPixel(canvasElevation);

  return {
    pixel: pixel,
    pixelInt: pixelInt ?? pixel * canvas.elevation.maximumPixelValue,
    elevation: elevation ?? pixelToElevation(pixel),
    canvasElevation: canvasElevation ?? pixelToCanvasElevation(pixel)
  }
}

function pixelToCanvasElevation(pixelValue) {
  const { size, distance } = canvas.dimensions;
  const elevation = pixelToElevation(pixelValue);
  return (elevation * size) / distance;
}

function pixelToElevation(pixelValue) {
  const { elevationMin, elevationStep, maximumPixelValue } = canvas.elevation;
  return (pixelValue * maximumPixelValue * elevationStep) - elevationMin;
}

function canvasElevationToPixel(canvasElevation) {
  const { size, distance } = canvas.dimensions;
  const elevation = (canvasElevation * dist) / size;
  return elevationToPixel(elevation);
}

function elevationToPixel(elevation) {
  const { elevationMin, elevationStep, maximumPixelValue } = canvas.elevation;
  return (elevation + elevationMin) / (maximumPixelValue * elevationStep);
}

/**
vec4 backgroundElevation = texture2D(EV_elevationSampler, vCanvasCoord / EV_canvasXY);
backgroundElevation.r is between 0 and 1
eMult = size / dist = 100 / 5 = 20


assume r is 0.1
((r * pixelMax * eStep) - eMin )* eMult
((0.1 * 255 * 5) - 0) = 127.5 * 20 = 2550







/**
api = game.modules.get("elevatedvision").api
perpendicularPoint = api.util.perpendicularPoint;
distanceBetweenPoints = api.util.distanceBetweenPoints;
ShadowLOSFilter = api.ShadowLOSFilter;

myFilter = MyLOSFilter.create();
g = new PIXI.Graphics();
g.filters = [myFilter];


g = canvas.controls.debug

source = _token.vision
los = source.los;

g.clear()
myFilter = ShadowLOSFilter.create(undefined, source)
g.filters = [myFilter];


// g.beginFill(0x008000, 0.5);
g.beginFill(0xFFFFFF, 1.0)
g.drawShape(los);
g.endFill()




*/



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
  }

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

    vec4 visionColor = vec4(1.0,1.0,1.0,1.0);

    void main() {
      vec4 fg = texture2D(uSampler, vTextureCoord);

      if ( !EV_hasElevationSampler ) {
        gl_FragColor = fg;
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
        fg = vec4(0., 0., 0., 0.) * fg.a;
      } else {
        fg = vec4(1., 1., 1., 1.) * fg.a;
      }

      gl_FragColor = fg;
    }
  `;

  /** @override */
  static create(uniforms={}, source) {
    updateShadowFilterUniforms(uniforms, source);
    return super.create(uniforms);
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
    this.uniforms.canvasMatrix.copyFrom(canvas.stage.worldTransform).invert();
    return super.apply(filterManager, input, output, clear, currentState);
  }
}

function updateShadowFilterUniforms(uniforms, source) {
  const walls = source.los.wallsBelowSource;
  if ( !walls || !walls.size ) return;
  const { x, y } = source;


  uniforms.EV_sourceCanvasElevation = source.elevationZ;
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
    wallCoords.push(a.x, a.y, b.x, b.y)
  }

  uniforms.EV_numWalls = wallElevations.length;

  if ( !wallCoords.length ) wallCoords = new Float32Array(MAX_NUM_WALLS*4);
  if ( !wallElevations.length ) wallElevations = new Float32Array(MAX_NUM_WALLS);
  if ( !wallDistances.length ) wallDistances = new Float32Array(MAX_NUM_WALLS);

  uniforms.EV_wallCanvasCoords = wallCoords;
  uniforms.EV_wallCanvasElevations = wallElevations;
  uniforms.EV_wallCanvasDistances = wallDistances;
}