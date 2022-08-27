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
    EV_hasElevationSampler: false
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
    uniform vec2 EV_sceneXY;
    uniform vec2 EV_canvasXY;

    void main() {
      vec4 fg = texture2D(uSampler, vTextureCoord);
      // vec4 backgroundElevation = texture2D(EV_elevationSampler, vTextureCoord - EV_sceneXY);
      vec4 backgroundElevation = texture2D(EV_elevationSampler, vCanvasCoord / EV_canvasXY);

      if ( backgroundElevation.r > 0.0 ) {
        // backgroundElevation = texture2D(EV_elevationSampler, vCanvasCoord);
        fg = vec4(1., 0., 1., 1.) * fg.a;


      }

//       if ( backgroundElevation.r > 0.0 ) {
//         fg = vec4(0., 0., 0., 0.);
//       }

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

//     this.uniforms.EV_hasElevationSampler = Boolean(this.uniforms.EV_elevationSampler);
//     this.uniforms.EV_elevationSampler ??= PIXI.Texture.EMPTY;

//     console.log(`apply filter ${this.uniforms.EV_hasElevationSampler}`).
    this.uniforms.EV_hasElevationSampler = true;
    this.uniforms.canvasMatrix ??= new PIXI.Matrix();
    this.uniforms.canvasMatrix.copyFrom(canvas.stage.worldTransform).invert();
    return super.apply(filterManager, input, output, clear, currentState);
  }
}

/**
myFilter = MyLOSFilter.create();
g = new PIXI.Graphics();
g.filters = [myFilter];


g = canvas.controls.debug
los = _token.vision.los;
g.clear()
myFilter = MyLOSFilter.create();
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
class ShadowLOSFilter extends AbstractBaseFilter {
  /** @override */
  static defaultUniforms = {
    EV_numWalls: 0,
    EV_wallElevations: new Float32Array(MAX_NUM_WALLS),
    EV_wallCoords: new Float32Array(MAX_NUM_WALLS*4),
    EV_sourceElevation: 0,
    EV_sourceLocation: [0, 0],
    EV_wallDistances: new Float32Array(MAX_NUM_WALLS),
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
    uniform int EV_numWalls;
    uniform vec4 EV_wallCoords[${MAX_NUM_WALLS}];
    uniform float EV_wallElevations[${MAX_NUM_WALLS}];
    uniform float EV_wallDistances[${MAX_NUM_WALLS}];
    uniform float EV_sourceElevation;
    uniform vec2 EV_sourceLocation;
    uniform sampler2D EV_elevationSampler;
    uniform vec4 EV_elevationResolution;
    uniform bool EV_hasElevationSampler;

    ${FRAGMENT_FUNCTIONS}

    vec4 visionColor = vec4(1.0,1.0,1.0,1.0);

    void main() {
      float inShadow = 0.0;
      vec4 backgroundElevation = vec4(0.0, 0.0, 0.0, 1.0);
      if ( EV_hasElevationSampler ) {
        vec2 EV_textureCoord = EV_transform.xy * vUvs + EV_transform.zw;
        backgroundElevation = texture2D(EV_elevationSampler, vCanvasCoord);
      }

      float pixelElevation = ((backgroundElevation.r * EV_elevationResolution.b * EV_elevationResolution.g) - EV_elevationResolution.r) * EV_elevationResolution.a;
      if ( pixelElevation > EV_sourceElevation ) {
        inShadow = 1.0;
      } else if ( EV_numWalls > 0 ) {
        float adjSourceElevation = EV_sourceElevation - pixelElevation;
        const int maxWalls = ${MAX_NUM_WALLS};
        for ( int i = 0; i < maxWalls; i++ ) {
          if ( i >= EV_numWalls ) break;

          // If the wall is higher than the light, skip. Should not occur.
          float We = EV_wallElevations[i];
          if ( EV_lightElevation <= We ) continue;

          // If the pixel is above the wall, skip.
          if ( pixelElevation >= We ) continue;

          // If the wall does not intersect the line between the center and this point, no shadow here.
          vec4 wall = EV_wallCoords[i];
          if ( !lineSegmentIntersects(vCanvasCoord, EV_sourceLocation, wall.xy, wall.zw) ) continue;

          float distOW = EV_wallDistances[i];

          // Distance from wall (as line) to this location
          vec2 wallIxPoint = perpendicularPoint(wall.xy, wall.zw, vCanvasCoord);
          float distWP = distance(vUvs, wallIxPoint);

          float adjWe = We - pixelElevation;

          // atan(opp/adj) equivalent to JS Math.atan(opp/adj)
          // atan(y, x) equivalent to JS Math.atan2(y, x)
          float theta = atan((adjSourceElevation - adjWe) /  distOW);

          // Distance from center/origin to furthest part of shadow perpendicular to wall
          float distOV = adjSourceElevation / tan(theta);
          float maxDistWP = distOV - distOW;

          if ( distWP < maxDistWP ) {
            // Current location is within shadow.
            inShadow = 1.0;
            break;
          }
      }
    }

    vec4 fg = texture2D(uSampler, vTextureCoord);
    gl_FragColor = mix(visionColor, fg, inShadow);
  `;

  /** @override */
  create(uniforms={}, source) {
    updateShadowFilterUniforms(uniforms, source);
    return super.apply(uniforms);
  }

  /** @override */
  // Thanks to https://ptb.discord.com/channels/732325252788387980/734082399453052938/1009287977261879388
  apply(filterManager, input, output, clear, currentState) {
    this.uniforms.EV_elevationSampler = canvas.elevation?._elevationTexture;
    this.uniforms.EV_hasElevationSampler = Boolean(this.uniforms.EV_elevationSampler);
    this.uniforms.EV_elevationSampler ??= PIXI.Texture.EMPTY;

    this.uniforms.canvasMatrix ??= new PIXI.Matrix();
    this.uniforms.canvasMatrix.copyFrom(canvas.stage.worldTransform).invert();
    return super.apply(filterManager, input, output, clear, currentState);
  }
}

function updateShadowFilterUniforms(uniforms, source) {
  const walls = source.los.wallsBelowSource;
  if ( !walls || !walls.size ) return;

  uniforms.EV_sourceElevation = source.elevationZ;
  uniforms.EV_sourceLocation = [ source.x, source.y ];

  const center = { x: source.x, y: source.y };
  let wallCoords = [];
  let wallElevations = [];
  let wallDistances = [];
  for ( const w of walls ) {
    const a = w.A;
    const b = w.B;

    // Point where line from light, perpendicular to wall, intersects
    const wallIx = perpendicularPoint(a, b, center);
    if ( !wallIx ) continue; // Likely a and b not proper wall.

    const wallOriginDist = distanceBetweenPoints(center, wallIx);
    wallDistances.push(wallOriginDist);
    wallElevations.push(w.topZ);
    wallCoords.push(a.x, a.y, b.x, b.y)
  }

  uniforms.EV_numWalls = wallElevations.length;

  if ( !wallCoords.length ) wallCoords = new Float32Array(MAX_NUM_WALLS*4);
  if ( !wallElevations.length ) wallElevations = new Float32Array(MAX_NUM_WALLS);
  if ( !wallDistances.length ) wallDistances = new Float32Array(MAX_NUM_WALLS);

  uniforms.EV_wallCoords = wallCoords;
  uniforms.EV_wallElevations = wallElevations;
  uniforms.EV_wallDistances = wallDistances;
}