/* globals
PIXI,
canvas
*/
"use strict";

import { log } from "./util.js";
import { MODULE_ID } from "./const.js";


export function createAdaptiveLightingShader(wrapped, ...args) {
//   if (!this.fragmentShader.includes("#version 300 es")) {
// //     this.vertexShader = "#version 300 es \n" + this.vertexShader;
//     this.fragmentShader = "#version 300 es \n precision mediump float; \n" + this.fragmentShader;
//   }

  log("createAdaptiveLightingShader");

  if ( this.fragmentShader.includes(UNIFORMS) ) return wrapped(...args);

  log("createAdaptiveLightingShader adding shadow shader code");

  const replaceUniformStr = "uniform sampler2D uBkgSampler;";
  const replaceFragStr = "float depth = smoothstep(0.0, 1.0, vDepth);";

  this.fragmentShader = this.fragmentShader.replace(
    replaceUniformStr, `${replaceUniformStr}\n${UNIFORMS}`);

  this.fragmentShader = this.fragmentShader.replace(
    replaceFragStr, `${replaceFragStr}\n${DEPTH_CALCULATION}`);

   const shader = wrapped(...args);
   shader.uniforms.EV_numEndpoints = 0;
   shader.uniforms.EV_wallHeights = new Float32Array();
   shader.uniforms.EV_wallCoords = new Float32Array();
   shader.uniforms.EV_pointRadius = .1;
   return shader;

}

// In GLSL 2, cannot use dynamic arrays. So set a maximum number of walls for a given light.
const MAX_NUM_WALLS = 100;

// 4 coords per wall (A, B endpoints).
const UNIFORMS =
`
uniform int EV_numEndpoints;
uniform vec2 EV_wallCoords[${MAX_NUM_WALLS * 2}];
uniform float EV_wallHeights[${MAX_NUM_WALLS}];
uniform float EV_pointRadius;
`;

// For now, just mark the endpoints of walls
// If near a wall endpoint, make depth 0.
// Use maxIts to avoid issue in GLSL 1 about indexing conditional must be constant
// const DEPTH_CALCULATION =
// `
// const int maxIts = ${MAX_NUM_WALLS * 2};
// for ( int i = 0; i < maxIts; i++ ) {
//   if ( maxIts > EV_numEndpoints ) break;
//
//   vec2 coords = EV_wallCoords[i];
//   float z = EV_wallHeights[i / 2];
//
//   vec3 e0 = vec3(coords, z);
//   vec4 t0 = vec4(projectionMatrix * (translationMatrix * e0), 1);
//
//   if ( distance(t0, gl_FragCoord) < EV_pointRadius ) {
//     depth = 0.0;
//     break;
//   }
// }
// `;

// origin is vec3
/*
float dist = distance(vUvs, vec2(0.5)) * 2.0;
dist 1 is the radius size
so:
  if ( dist < 0.1 ) { depth = 0.0; }
  if radius is 25, 25 * .1 = 2.5; alpha/depth will be 0 within 2.5 feet of the center.

Thus, vec2(0.5) (0.5, 0.5) must be the circle center.
If vUvs is (0, 0), then distance([0,0], [0.5,0.5]) = .707 * 2 = 1.414
If vUvs is (.4, .5), then it is 5 feet away (.1*2) from the circle center in the x direction.
  distance([.4, .5], [.5,.5]) = 0.1 * 2 = .2

*/

const DEPTH_CALCULATION =
`
vec2 coord = vec2(.3, .5);
float distCoord = distance(vUvs, coord) * 2.0;

if ( distCoord < .1 ) {
  depth = 0.0;
}
`

/**
 * @param {number[]} mat    Array, representing a square matrix
 * @param {number[]} vec    Array, representing a vector
 * @return {number[]} Vector result of mat * v
 */
function multMatrixVector(mat, vec) {
  const vln = vec.length;
  const matLn = mat.length;
  if ( matLn % vln !== 0 ) console.warn("multSquareMatrixVector requires matrix rows to equal vector length.");

  const res = [];
  for ( let r = 0; r < matLn; r += vln ) {
    let val = 0;
    for ( let c = 0; c < vln; c += 1 ) {
//       console.log(`r: ${r}; c: ${c} | ${mat[r + c]} * ${vec[c]}`)
      val += mat[r + c] * vec[c];
    }
    res.push(val);
  }
  return res;
}

/**
 * @param {number[]} mat3   Array, representing a 3x3 matrix.
 * @return {number[]} An array representing a 4x4 matrix
 */
function to4D(mat3) {
  return [
    mat3[0], mat3[1], mat3[2], 0,
    mat3[3], mat3[4], mat3[5], 0,
    mat3[6], mat3[7], mat3[9], 0,
    0, 0, 0, 1
  ];
}

export function _updateColorationUniformsLightSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;
  log(`_updateColorationUniformsLightSource ${this.object.id}`);
  updateLightUniforms(this.coloration.shader, this.los.shadowsWalls, this.center, this.radius);
}

export function _updateIlluminationUniformsLightSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;
  log(`_updateIlluminationUniformsLightSource ${this.object.id}`);
  updateLightUniforms(this.illumination.shader, this.los.shadowsWalls, this.center, this.radius);
}

function updateLightUniforms(shader, shadows, center, radius) {
  const u = shader.uniforms;

  u.EV_numEndpoints = shadows.length;
  u.EV_pointRadius = .1;

  const wallCoords = [];
  const wallHeights = [];
  const r_inv = 1 / radius;
  for ( let i = 0; i < u.EV_numWalls; i += 1 ) {
    const s = shadows[i];
    wallHeights.push(elevationCircleCoord(s.wall.topZ, radius, r_inv));
    const a = pointCircleCoord(s.wall.A, center, radius, r_inv);
    const b = pointCircleCoord(s.wall.B, center, radius, r_inv);

    wallCoords.push(
      a.x, a.y,
      b.x, b.y
    );

  }

  u.EV_wallCoords = new Float32Array(wallCoords);
  u.EV_wallHeights = new Float32Array(wallHeights);
}

/**
 * Transform a point coordinate to be in relation to a circle center and radius.
 * Between 0 and 1 where [0.5, 0.5] is the center
 * [0, .5] is at the edge in the westerly direction.
 * [1, .5] is the edge in the easterly direction
 * @param {Point} point
 * @param {number} radius
 * @param {Point} center
 * @returns {Point}
 */
function pointCircleCoord(point, center, radius, r_inv = 1 / radius) {
  return {
    x: ((point.x + center.x) * r_inv) - 0.5,
    y: ((point.y + center.y) * r_inv) - 0.5,
  }
}

function elevationCircleCoord(a, radius, r_inv = 1 / radius) {
  return (a * r_inv) - 0.5;
}




/*
 this.fragmentShader = this.fragmentShader.replace(
            "uniform sampler2D uBkgSampler;",
            "uniform sampler2D uBkgSampler;\nuniform sampler2D mymodule_maskTexture;"
        );
        this.fragmentShader = this.fragmentShader.replace(
             "float depth = smoothstep(0.0, 1.0, vDepth);",
             "float depth = smoothstep(0.0, 1.0, vDepth);\ndepth *= texture2D(mymodule_maskTexture, vSamplerUvs).r;"
        );
*/

export function _createLOSLightSource(wrapped) {
  log(`_createLOSLightSource ${this.source.id}`);
  const los = wrapped();
//   if ( !los.shadows || !los.shadows.length ) return los;
//
//   log("Adding shadow filter");
//   this.createReverseShadowMaskFilter()
//   this.illumination.filters = [this.reverseShadowMaskFilter];
//   this.coloration.filters = [this.reverseShadowMaskFilter];
//
  return los;
}


export function drawLightLightSource(wrapped) {
  log("drawLightLightSource");
  if ( this.los.shadows && this.los.shadows.length ) {
    log("drawLightLightSource has shadows");
//     this.illumination.filters = [this.createReverseShadowMaskFilter()];
  }

  if ( this.los._drawShadows ) this.los._drawShadows();
  return wrapped();
}
//
// export function createReverseShadowMaskFilter() {
// //   if ( !this.reverseShadowMaskFilter ) {
//     this.shadowsRenderTexture =
//        canvas.primary.createRenderTexture({renderFunction: this.renderShadows.bind(this), clearColor: [0, 0, 0, 0]});
//     this.reverseShadowMaskFilter = ReverseMaskFilter.create({
//       uMaskSampler: this.shadowsRenderTexture,
//       channel: "a"
//     });
//     this.reverseShadowMaskFilter.blendMode = PIXI.BLEND_MODES.NORMAL;
// //   }
//   return this.reverseShadowMaskFilter;
// }
//
// export function renderShadows(renderer) {
//   const cir = new PIXI.Circle(0, 0, 50);
//   const graphics = new PIXI.Graphics();
//   const rt = renderer.renderTexture;
//   graphics.beginFill(0, 1); // color, alpha
//   graphics.drawCircle(cir);
//   graphics.endFill;
//   renderer.render(graphics, rt);
//   return rt;
// }

// Simple version
// export function _createLOSLightSource(wrapped) {
//   const los = wrapped();
//   this.createReverseMaskFilter();
//   this.illumination.filters = [this.reverseMaskFilter];
//   this.coloration.filters = [this.reverseMaskFilter];
//   return los;
// }
//
// // Added to LightSource.prototype
// export function createReverseMaskFilter() {
//   const rt = canvas.primary.createRenderTexture({renderFunction: renderInnerCircle.bind(this), clearColor: [0, 0, 0, 0]});
//   this.reverseMaskFilter = ReverseMaskFilter.create({
//     uMaskSampler: rt,
//     channel: "a"
//   });
//   this.reverseMaskFilter.blendMode = PIXI.BLEND_MODES.NORMAL;
//   return this.reverseMaskFilter;
// }
//
// function renderInnerCircle(renderer) {
//   const cir = new PIXI.Circle(0, 0, 50);
//   const graphics = new PIXI.Graphics();
//   const rt = renderer.renderTexture;
//   graphics.beginFill(0, 1); // color, alpha
//   graphics.drawCircle(cir);
//   graphics.endFill;
//   renderer.render(graphics, rt);
//   return rt;
// }




// export function renderShadows(renderer) {
//   if ( !this.los.shadows || !this.los.shadows.length ) return;
//
//   const graphics = new PIXI.Graphics();
//   const rt = renderer.renderTexture;
//
//   for ( const shadow of this.los.shadows) {
//     graphics.beginFill(0, 1); // color, alpha
//     graphics.drawPolygon(shadow);
//     graphics.endFill;
//   }
//   renderer.render(graphics, rt);
//   return rt;
// }




//   #createReverseMaskFilter() {
//     if ( !this.reverseMaskfilter ) {
//       this.reverseMaskfilter = ReverseMaskFilter.create({
//         uMaskSampler: canvas.primary.tokensRenderTexture,
//         channel: "a"
//       });
//       this.reverseMaskfilter.blendMode = PIXI.BLEND_MODES.NORMAL;
//     }
//     return this.reverseMaskfilter;
//   }
//
//
//    this.tokensRenderTexture =
//       this.createRenderTexture({renderFunction: this._renderTokens.bind(this), clearColor: [0, 0, 0, 0]});
//
//
//
//
//
//   createRenderTexture({renderFunction, clearColor}={}) {
//     const renderOptions = {};
//     const renderer = canvas.app?.renderer;
//
//     // Creating the render texture
//     const renderTexture = PIXI.RenderTexture.create({
//       width: renderer?.screen.width ?? window.innerWidth,
//       height: renderer?.screen.height ?? window.innerHeight,
//       resolution: renderer.resolution ?? PIXI.settings.RESOLUTION
//     });
//     renderOptions.renderFunction = renderFunction;            // Binding the render function
//     renderOptions.clearColor = clearColor;                    // Saving the optional clear color
//     this.#renderPaths.set(renderTexture, renderOptions);      // Push into the render paths
//
//     // Return a reference to the render texture
//     return renderTexture;
//   }
//
//   _renderTokens(renderer) {
//     for ( const tokenMesh of this.tokens ) {
//       tokenMesh.render(renderer);
//     }
//


// Class PointSource:
/**
 * Create a new Mesh for this source using a provided shader class
 * @param {Function} shaderCls  The subclass of AdaptiveLightingShader being used for this Mesh
 * @returns {PIXI.Mesh}         The created Mesh
 * @protected
 */
//   _createMesh(shaderCls) {
//     const state = new PIXI.State();
//     const mesh = new PIXI.Mesh(this.constructor.GEOMETRY, shaderCls.create(), state);
//     mesh.mask = this.losMask;
//     Object.defineProperty(mesh, "uniforms", {get: () => mesh.shader.uniforms});
//     return mesh;
//   }

/**
 * Update the position and size of the mesh each time it is drawn.
 * @param {PIXI.Mesh} mesh      The Mesh being updated
 * @returns {PIXI.Mesh}         The updated Mesh
 * @protected
 */
// _updateMesh(mesh) {
//   mesh.position.set(this.data.x, this.data.y);
//   mesh.width = mesh.height = this.radius * 2;
//   return mesh




