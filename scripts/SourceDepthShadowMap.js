/* globals
canvas,
PIXI
*/
"use strict";

import { Matrix } from "./geometry/Matrix.js";
import { Point3d } from "./geometry/3d/Point3d.js";

/* Testing
// let walls = canvas.walls.placeables;
// let walls = canvas.walls.controlled;

api = game.modules.get("elevatedvision").api
SourceDepthShadowMap = api.SourceDepthShadowMap
Point3d = CONFIG.GeometryLib.threeD.Point3d


lightOrigin = new Point3d(100, 100, 1600);

map = new SourceDepthShadowMap(lightOrigin, { walls });
map._depthTest();
map._endDepthTest();
map._shadowRenderTest();
map._endShadowRenderTest();

// update walls
map._updateWallGeometry(walls);


// view and orthographic matrix for a wall
wall = walls[0]

topA = new Point3d(wall.A.x, wall.A.y, wall.topZ)
topB = new Point3d(wall.B.x, wall.B.y, wall.topZ)
bottomA = new Point3d(wall.A.x, wall.A.y, wall.bottomZ)
bottomB = new Point3d(wall.B.x, wall.B.y, wall.bottomZ)

for ( const v of [topA, topB, bottomA, bottomB] ) {
  const vCamera = map.viewMatrix.multiplyPoint3d(v);
  const vProj = map.projectionMatrix.multiplyPoint3d(vCamera);

  console.log(`(${v.x},${v.y},${v.z})
    --> (${vCamera.x.toPrecision(3)},${vCamera.y.toPrecision(3)},${vCamera.z.toPrecision(3)})
    --> (${vProj.x.toPrecision(3)},${vProj.y.toPrecision(3)},${vProj.z.toPrecision(3)})`);
}

sceneRect = canvas.dimensions.sceneRect
testPoints = [
  new Point3d(100 + sceneRect.x, 100 + sceneRect.y, 0),
  new Point3d(300 + sceneRect.x, 100 + sceneRect.y, 0),
  new Point3d(1400, 900, 100),
  new Point3d(1400, 900, 0),
  new Point3d(1400, 900, -100),
]
for ( const v of testPoints ) {
  const vCamera = map.viewMatrix.multiplyPoint3d(v);
  const vProj = map.projectionMatrix.multiplyPoint3d(vCamera);

  console.log(`(${v.x},${v.y},${v.z})
    --> (${vCamera.x.toPrecision(3)},${vCamera.y.toPrecision(3)},${vCamera.z.toPrecision(3)})
    --> (${vProj.x.toPrecision(3)},${vProj.y.toPrecision(3)},${vProj.z.toPrecision(3)})`);
}



*/

/**
 * Construct an orthographic matrix.
 * https://www.scratchapixel.com/lessons/3d-basic-rendering/perspective-and-orthographic-projection-matrix/orthographic-projection-matrix.html
 * http://learnwebgl.brown37.net/08_projections/projections_ortho.html
 * Convert a bounding box to range [-1, 1].
 * @param {number} xmin   Left, or minimum x value of the bounding box.
 * @param {number} xmax   Right, or maximum x value of the bounding box.
 * @param {number} ymin   Top, or minimum y value of the bounding box.
 * @param {number} ymax   Bottom, or maximum y value of the bounding box.
 * @param {number} near   Near, or minimum z value of the bounding box.
 * @param {number} far    Far, or maximum y value of the bounding box.
 * @returns {Matrix[4][4]}
 */
function orthographicMatrix(xmin, xmax, ymin, ymax, near, far) {
  // http://learnwebgl.brown37.net/08_projections/projections_ortho.html
  // left = xmin; right = xmax
  // bottom = ymin; top = ymax
  // near = zmin; far = zmax

  // 1. Center at the origin.
  const midX = (xmin + xmax) * 0.5;
  const midY = (ymin + ymax) * 0.5;
  const midZ = (-near - far) * 0.5;
  const centerAroundOrigin = new Matrix([
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [-midX, -midY, -midZ, 1]
  ]);

  // 2. Scale the viewing volume to 2 units wide
  const scaleX = 2 / (xmax - xmin);
  const scaleY = 2 / (ymax - ymin);
  const scaleZ = 2 / (far - near);
  const scaleViewingVolume = new Matrix([
    [scaleX, 0, 0, 0],
    [0, scaleY, 0, 0],
    [0, 0, scaleZ, 0],
    [0, 0, 0, 1]
  ]);

  // 3. Flip coordinate system
  const convertToLeftHanded = new Matrix([
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, -1, 0],
    [0, 0, 0, 1]
  ]);

  // TODO: Store out matrix to speed up the multiplications.
  return centerAroundOrigin.multiply4x4(scaleViewingVolume).multiply4x4(convertToLeftHanded);
}

/**
 * Construct a perspective matrix.
 * https://www.scratchapixel.com/lessons/3d-basic-rendering/perspective-and-orthographic-projection-matrix/orthographic-projection-matrix.html
 * http://learnwebgl.brown37.net/08_projections/projections_perspective.html
 * Convert a bounding box to range [-1, 1].
 * @param {number} xmin   Left, or minimum x value of the bounding box.
 * @param {number} xmax   Right, or maximum x value of the bounding box.
 * @param {number} ymin   Top, or minimum y value of the bounding box.
 * @param {number} ymax   Bottom, or maximum y value of the bounding box.
 * @param {number} near   Near, or minimum z value of the bounding box.
 * @param {number} far    Far, or maximum y value of the bounding box.
 * @returns {Matrix[4][4]}
 */
function perspectiveMatrix(xmin, xmax, ymin, ymax, near, far) {
  // Coordinates:
  // left = xmin; right = xmax
  // bottom = ymin; top = ymax
  // near = zmin; far = zmax

  // 1. Move frustrum apex to the origin
  const midX = (xmin + xmax) * 0.5;
  const midY = (ymin + ymax) * 0.5;
  const centerAroundOrigin = new Matrix([
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [-midX, -midY, 0, 1]
  ]);

  // 2. Perspective calculation
  // Set the w value to the divisor, -z.
  const perspectiveCalc = new Matrix([
    [near, 0, 0, 0],
    [0, near, 0, 0],
    [0, 0, 1, -1],
    [0, 0, 0, 0]
  ]);

  // 3. Scale the view window to between [-1, 1] and [1, 1]
  const scaleX = 2 / (xmax - xmin);
  const scaleY = 2 / (ymax - ymin);
  const scaleViewingVolume = new Matrix([
    [scaleX, 0, 0, 0],
    [0, scaleY, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1]
  ]);

  // 4. Map depth (z-values) to [-1, 1]
  // non-linear mapping between [-near, -far] and [-1, 1]
  // use c1 / -z + c2, where c1 and c2 are constants based on range of [-near, -far]
  // z = -near ==> c1 / -z + c2 == -1
  // z = -far ==> c1 / -z + c2 == 1
  const c1 = (2 * far * near) / (near - far);
  const c2 = (far + near) / (far - near);
  const depthMap = new Matrix([
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, -c2, -1],
    [0, 0, c1, 0]
  ]);

  // Switching direction fo the z axis to match clipping is not necessary.
  // When mapping the z values to non-linear range, new range was [-1, 1], which
  // effectively switched the direction of the z axis.
  // TODO: Store out matrix to speed up the multiplications.
  return centerAroundOrigin.multiply4x4(perspectiveCalc).multiply4x4(scaleViewingVolume).multiply4x4(depthMap);
}

/**
 * Convert a Matrix in row-major order to column-major order and return the array.
 * Used to convert Matrix to WebGL format.
 * @param {Matrix[r][c]} mat
 * @returns {Array[r x c]}
 */
function toColMajorArray(mat) {
  // Add data to array row-by-row.
  const nRow = mat.dim1;
  const nCol = mat.dim2;
  const arr = new Array(nRow * nCol);
  for ( let r = 0, i = 0; r < nRow; r += 1 ) {
    for ( let c = 0; c < nCol; c += 1, i += 1 ) {
      arr[i] = mat.arr[r][c];
    }
  }
  return arr;
}

// https://thebookofshaders.com/glossary/?search=smoothstep
function smoothStep(edge0, edge1, x) {
  const t = Math.clamped((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

export class SourceDepthShadowMap {
  // TODO: Can we make any of these empty and just update the object?

  #viewMatrix;

  #projectionMatrix;

  #lightPosition;

  #radius;

  #depthMesh;

  #depthTexture;

  #depthSprite;

  #shadowRender;

  /**
   * Construct a new SourceDepthShadowMap instance.
   * @param {Point3d} lightPosition   Position of the light
   * @param {object} [options]
   * @param {Wall[]} [options.walls]
   * @param {PIXI.Geometry} [options.wallGeometry]
   * @param {boolean} [options.directional]
   */
  constructor(lightPosition, { walls, wallGeometry, directional = true, radius }) {
    // TODO: Use LightSource instead or alternatively allow as an option?
    this.#lightPosition = lightPosition;
    this.directional = directional;

    if ( !directional && typeof radius === "undefined" ) {
      console.error("SourceDepthShadowMap requires radius for point source.");
      this.#radius = canvas.dimensions.size;
    }

    if ( !wallGeometry ) {
      walls ??= canvas.walls.placeables;
      this.wallGeometry = new PIXI.Geometry();
      this.wallGeometry.addAttribute("aVertexPosition", [], 3);
      this.wallGeometry.addIndex([]);
    } else {
      this.wallGeometry = wallGeometry;

      // Confirm we have a valid geometry
      if ( !Object.hasOwn(wallGeometry.attributes, "aVertexPosition") ) {
        console.error("SourceDepthShadowMap|wallGeometry has no aVertexPosition.");
        this.wallGeometry.addAttribute("aVertexPosition", [], 3);
      }

      if ( !wallGeometry.indexBuffer ) {
        console.error("SourceDepthShadowMap|wallGeometry has no index.");
        this.wallGeometry.addIndex([]);
      }
    }

    if ( walls ) this._updateWallGeometry(walls);
  }

  // Getters / Setters

  /** @type {Matrix} */
  get viewMatrix() {
    return this.#viewMatrix || (this.#viewMatrix = this._constructViewMatrix());
  }

  /** @type {Matrix} */
  get projectionMatrix() {
    this.#projectionMatrix ??= this.directional
      ? this._constructOrthogonalMatrix() : this._constructPerspectiveMatrix();

    return this.#projectionMatrix;
  }

  /** @type {Point3d} */
  get lightPosition() { return this.#lightPosition; }

  set lightPosition(value) {
    this.#lightPosition = value.copy();

    if ( !this.directional ) {
      console.error("Not yet implemented.");
      // Need to refilter walls based on light radius and update wall geometry
    }

    this.#viewMatrix = undefined;
    this.#projectionMatrix = undefined;
  }

  /** @type {number} */
  get radius() { return this.#radius; }

  set radius(value) {
    this.#radius = value;
    this.#viewMatrix = undefined;
    this.#projectionMatrix = undefined;
  }

  /** @type {PIXI.Mesh} */
  get depthMesh() {
    return this.#depthMesh || (this.#depthMesh = this._constructDepthMesh());
  }

  /** @type {PIXI.Texture} */
  get depthTexture() {
    return this.#depthTexture || (this.#depthTexture = this._renderDepth());
  }

  /**
   * Build the wall coordinates and indices from an array of walls.
   * @param {Wall[]} walls
   * @returns {object} { coordinates: {Number[]}, indices: {Number[]}}
   */
  _constructWallCoordinates(walls) {
    // TODO: Filter walls for given light source type and, for point source, the radius?
    const nWalls = walls.length;
    const coordinates = new Float32Array(nWalls * 12); // Coords: x,y,z for top and bottom A, top and bottom B
    const indices = new Uint16Array(nWalls * 6); // 2 triangles to form a square
    for ( let w = 0, j = 0, idx = 0, i = 0; w < nWalls; w += 1, j += 12, idx += 6, i += 4 ) {
      const wall = walls[w];
      const topZ = isFinite(wall.topZ) ? wall.topZ : 1e05;
      const bottomZ = isFinite(wall.bottomZ) ? wall.bottomZ : -1e05;

      // Even vertex (0) is bottom A
      coordinates[j] = wall.A.x;
      coordinates[j + 1] = wall.A.y;
      coordinates[j + 2] = bottomZ;

      // Odd vertex (1) is top A
      coordinates[j + 3] = wall.A.x;
      coordinates[j + 4] = wall.A.y;
      coordinates[j + 5] = topZ;

      // Even vertex (2) is bottom B
      coordinates[j + 6] = wall.B.x;
      coordinates[j + 7] = wall.B.y;
      coordinates[j + 8] = bottomZ;

      // Odd vertex (3) is top B
      coordinates[j + 9] = wall.B.x;
      coordinates[j + 10] = wall.B.y;
      coordinates[j + 11] = topZ;

      // Indices are [0, 1, 2, 1, 3, 2]
      // aBottom -- aTop -- bBottom, aTop -- bTop -- bBottom
      indices[idx] = i; // Equals: i + 0
      indices[idx + 1] = i + 1;
      indices[idx + 2] = i + 2;
      indices[idx + 3] = i + 1;
      indices[idx + 4] = i + 3;
      indices[idx + 5] = i + 2;
    }

    return { coordinates, indices };
  }

  /**
   * Update the wall geometry and reset cached matrices.
   * @param {Wall[]} walls
   */
  _updateWallGeometry(walls) {
    const { coordinates, indices } = this._constructWallCoordinates(walls);
    const vertexBuffer = this.wallGeometry.getBuffer("aVertexPosition");
    vertexBuffer.update(coordinates);
    const indexBuffer = this.wallGeometry.getIndex();
    indexBuffer.update(indices);

    // TODO: Make this an empty matrix instead and fill it? Same for #viewMatrix?
    // TODO: Do we need to destroy or update the texture, mesh, sprite?
    this.#projectionMatrix = undefined;
    this.#depthMesh = undefined;
    this.#depthTexture = undefined;
    this.#depthSprite = undefined;
    this.#shadowRender = undefined;
  }

  /**
   * Build the view matrix from light to:
   * - Directional: center of scene
   * - Point source: directly down to the canvas
   * @returns {Matrix}
   */
  _constructViewMatrix() {
    const lightPosition = this.lightPosition;

    // If the light is under or equal to minimum elevation, look down one grid unit.
    const sceneElevation = this.lightPosition.z > canvas.elevation.elevationMin
      ? canvas.elevation.elevationMin
      : lightPosition.z - canvas.dimensions.size;

    const target = this.directional
      ? new Point3d(canvas.dimensions.width * 0.5, canvas.dimensions.height * 0.5, sceneElevation)
      : new Point3d(lightPosition.x, lightPosition.y, sceneElevation);

    return Matrix.lookAt(lightPosition, target, new Point3d(0, 0, -1)).Minv;
  }

  /**
   * Build an orthogonal projection matrix.
   * @returns {Matrix}
   */
  _constructOrthogonalMatrix() {
    const pts = this._boundaryPoints();

    // Get the min/max for the sceneCameraPoints
    const cameraPoints = pts.map(pt => this.viewMatrix.multiplyPoint3d(pt));
    const xMinMax = Math.minMax(...cameraPoints.map(pt => pt.x));
    const yMinMax = Math.minMax(...cameraPoints.map(pt => pt.y));
    const zMinMax = Math.minMax(...cameraPoints.map(pt => pt.z));
    return SourceDepthShadowMap.orthographicMatrix(
      xMinMax.min, xMinMax.max,
      yMinMax.min, yMinMax.max,
      -zMinMax.max, -zMinMax.min);
  }

  /**
   * Build a perspective projection matrix
   * @returns {Matrix}
   */
  _constructPerspectiveMatrix() {
    const pts = this._boundaryPoints();

    // Get the min/max for the sceneCameraPoints
    const cameraPoints = pts.map(pt => this.viewMatrix.multiplyPoint3d(pt));
    const xMinMax = Math.minMax(...cameraPoints.map(pt => pt.x));
    const yMinMax = Math.minMax(...cameraPoints.map(pt => pt.y));
    const zMinMax = Math.minMax(...cameraPoints.map(pt => pt.z));
    return SourceDepthShadowMap.perspectiveMatrix(
      xMinMax.min, xMinMax.max,
      yMinMax.min, yMinMax.max,
      -zMinMax.max, -zMinMax.min);
  }

  /**
   * Get the points representing the edge of the boundary volume for the depth render.
   * Orthographic: based on scene
   * Perspective: based on light-radius cylinder
   * @returns {Point3d[]}
   */
  _boundaryPoints() {
    const { lightPosition, radius } = this;

    const coordinates = this.wallGeometry.getBuffer("aVertexPosition").data;
    const zCoords = coordinates.filter((e, i) => (i + 1) % 3 === 0);
    const maxElevation = Math.min(Math.max(...zCoords), this.lightPosition.z); // Don't care about what is above the light
    const minElevation = -100 + (this.lightPosition.z > canvas.elevation.elevationMin
      ? canvas.elevation.elevationMin
      : this.lightPosition.z - canvas.dimensions.size);

    let { top, bottom, left, right } = canvas.dimensions.sceneRect;
    if ( !this.directional ) {
      top = lightPosition.y - radius;
      bottom = lightPosition.y + radius;
      right = lightPosition.x - radius;
      left = lightPosition.x + radius;
    }

    const bounds = [
      // Top
      new Point3d(left, top, maxElevation), // TL
      new Point3d(right, top, maxElevation), // TR
      new Point3d(right, bottom, maxElevation), // BR
      new Point3d(left, bottom, maxElevation), // BL

      // Bottom
      new Point3d(left, top, minElevation), // TL
      new Point3d(right, top, minElevation), // TR
      new Point3d(right, bottom, minElevation), // BR
      new Point3d(left, bottom, minElevation) // BL
    ];

    return bounds;
  }

  /**
   * Construct the mesh used by the depth shader for the given geometry.
   * @returns {PIXI.Mesh}
   */
  _constructDepthMesh() {
    const uniforms = {
      projectionM: SourceDepthShadowMap.toColMajorArray(this.projectionMatrix),
      viewM: SourceDepthShadowMap.toColMajorArray(this.viewMatrix)
    };

    // Depth Map goes from 0 to 1, where 1 is furthest away (the far edge).

    let depthShader = PIXI.Shader.from(`
      #version 300 es
      precision mediump float;

      in vec3 aVertexPosition;
      uniform mat4 projectionM;
      uniform mat4 viewM;

      void main() {
        vec4 pos4 = vec4(aVertexPosition, 1.0);
        gl_Position = projectionM * viewM * pos4;
      }`,

    ` #version 300 es
      precision mediump float;
      out vec4 fragColor;
      void main() {
        fragColor = vec4(0.0); // Needed so the fragment shader actually saves the depth values.
        //fragColor = vec4(1.0, 0.0, 0.0, 1.0); // For testing
      }
    `, uniforms);

    // TODO: Can we save and update a single PIXI.Mesh?
    return new PIXI.Mesh(this.wallGeometry, depthShader);
  }

  /**
   * Render the depth of each wall in the scene, saved to a depth texture.
   * @returns {PIXI.Texture}
   */
  _renderDepth() {
    const depthMesh = this.depthMesh;
    depthMesh.state.depthTest = true;
    depthMesh.state.depthMask = true;
    const renderTexture = PIXI.RenderTexture.create({width: 1024, height: 1024});
    renderTexture.framebuffer.addDepthTexture();
    renderTexture.framebuffer.enableDepth();
    canvas.app.renderer.render(depthMesh, { renderTexture });

    // TODO: Can we store a PIXI.Texture and just update it?
    const depthTex = new PIXI.Texture(renderTexture.framebuffer.depthTexture);

    // Save the frameBuffer to avoid GC
    // https://ptb.discord.com/channels/732325252788387980/734082399453052938/1101602468221173771
    // https://github.com/pixijs/pixijs/pull/9409
    depthTex.framebuffer = renderTexture.framebuffer;

    return depthTex;
  }

  /**
   * Render a sprite to the screen to test the depth
   */
  _depthTest() {
    if ( this.#depthSprite ) canvas.stage.removeChild(this.#depthSprite);
    this.#depthSprite = new PIXI.Sprite(this.depthTexture);
    canvas.stage.addChild(this.#depthSprite);
  }

  _endDepthTest() {
    if ( this.#depthSprite ) canvas.stage.removeChild(this.#depthSprite);
  }

  /**
   * Render a test of the shadows to the canvas
   */
  _shadowRenderTest() {
    if ( this.#shadowRender ) canvas.stage.removeChild(this.#shadowRender);

    const geometryShadowRender = new PIXI.Geometry();
    const sceneRect = canvas.dimensions.sceneRect;
    geometryShadowRender.addAttribute("aVertexPosition", [
      sceneRect.left, sceneRect.top,     // TL
      sceneRect.right, sceneRect.top,    // TR
      sceneRect.right, sceneRect.bottom, // BR
      sceneRect.left, sceneRect.bottom   // BL
    ], 2);

    // Texture coordinates:
    // BL: 0,0; BR: 1,0; TL: 0,1; TR: 1,1
    geometryShadowRender.addAttribute("texCoord", [
      0, 1, // TL
      1, 1, // TR
      1, 0, // BR
      0, 0 // BL
    ], 2);
    geometryShadowRender.addIndex([0, 1, 2, 0, 2, 3]);

    const shadowRenderUniforms = {
      projectionM: SourceDepthShadowMap.toColMajorArray(this.projectionMatrix),
      viewM: SourceDepthShadowMap.toColMajorArray(this.viewMatrix),
      depthMap: this.depthTexture
    };

    let shadowRenderShader = PIXI.Shader.from(`
      #version 300 es
      precision mediump float;

      in vec2 aVertexPosition;
      in vec2 texCoord;
      out vec2 vTexCoord;
      out vec4 fragPosLightSpace;

      uniform mat3 translationMatrix;
      uniform mat3 projectionMatrix;
      uniform mat4 projectionM;
      uniform mat4 viewM;

      void main() {
        vTexCoord = texCoord;

        // For now, canvas vertices are at elevation 0.
        fragPosLightSpace = projectionM * viewM * vec4(aVertexPosition, 0.0, 1.0);

        // gl_Position for 2-d canvas vertex calculated as normal
        gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);

      }

    `,
    `
      #version 300 es
      precision mediump float;

      in vec2 vTexCoord;
      in vec4 fragPosLightSpace;
      out vec4 fragColor;

      uniform sampler2D depthMap;

      float shadowCalculation(in vec4 fragPosLightSpace) {
        // Perspective divide.
        // Needed when using perspective projection; does nothing with orthographic projection
        // Returns light-space position in range [-1, 1].
        vec3 projCoords = fragPosLightSpace.xyz / fragPosLightSpace.w;

        // Transform the NDC coordinates to range [0, 1].
        // Use to sample the depth map in range [0, 1].
        vec2 texCoords = projCoords.xy * 0.5 + 0.5;

        // Sample the depth map
        float closestDepth = texture(depthMap, texCoords).r;
        // if ( closestDepth == 1.0 ) return 0.0; // Depth 1.0 means no obstacle.

        // Projected vector's z coordinate equals depth of this fragment from light's perspective.
        // Check whether current position is in shadow.
        // currentDepth is closer to 1 the further we are from the light.
        float currentDepth = projCoords.z;

        float shadow = closestDepth != 1.0 && currentDepth < closestDepth ? 1.0 : 0.0;
        return shadow;
      }

      void main() {
        float shadow = shadowCalculation(fragPosLightSpace);

        // For testing, just draw the shadow.
        fragColor = vec4(0.0, 0.0, 0.0, shadow * 0.5);
        // fragColor = vec4(vec3(0.0), shadow);
      }

    `, shadowRenderUniforms);

    this.#shadowRender = new PIXI.Mesh(geometryShadowRender, shadowRenderShader);
    canvas.stage.addChild(this.#shadowRender);
  }

  _endShadowRenderTest() {
    if ( this.#shadowRender ) canvas.stage.removeChild(this.#shadowRender);
  }

  static toColMajorArray = toColMajorArray;

  static orthographicMatrix = orthographicMatrix;

  static perspectiveMatrix = perspectiveMatrix;
}

