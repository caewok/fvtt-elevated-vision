/* globals
canvas,
CONST,
PIXI
*/
"use strict";

import { Point3d } from "./geometry/3d/Point3d.js";
import { Draw } from "./geometry/Draw.js";

// Bounding Volume Hierarchy
// https://raytracing.github.io/books/RayTracingTheNextWeek.html#boundingvolumehierarchies

/* Key concepts
Need to be able to identify whether a fragment is shadowed by a wall or tile texture.
Ideally, would handle tile texture transparencies and terrain walls.
Would also be able to create penumbras and fades at end of shadows.

Key insights:
- Once shadowed, the fragment is done. This means we can cycle through renders to test
  tile textures one at a time. Plus we can quickly skip shadowed fragments in future renders.
- Shadows can be added? multiplied? Can render all the shadows all at once at end.

For walls and non-transparent tiles, it is likely better to use a single render
(or maybe one for walls and one for tiles). Need to be able to test multiple wall coordinates
efficiently. Thus, BVH.
- Walls/tiles can be initially grouped by quadrant. Directional: from center. Point: from center of light.
- Walls and tiles present very different coordinate shapes and thus may be better stored separately.
*/

/* Bounding Box coordinates for shader
uInt16 x4 is sufficient
[minX minY maxX maxY] [minZ maxZ ? ?] <-- Keep Z last, so x and y can be pulled in first x4 channel

To facilitate tree lookup, last two channels used to signify indices of its children.
Indices can be further branches or elements.

So, in total:
[minX minY maxX maxY] [minZ maxZ index index] <-- second index is 0 if this is leaf.

For a leaf:
[minX minY maxX maxY] [minZ maxZ index 0] <-- index points to the coordinates texture


*/

/* Compact BVH coordinates
See https://pbr-book.org/3ed-2018/Primitives_and_Intersection_Acceleration/Bounding_Volume_Hierarchies

Linear layout:
- First child found immediately after parent node.
- Second child found via offset pointer.
- Leaf nodes have no children.

  A
 B  C
D E

Would be:
ABDEC

Lay out by row, so:
A: [minX minY maxX maxY] [minZ maxZ 5 0] <-- Index (5) is the offset pointer
B: [minX minY maxX maxY] [minZ maxZ 4 0]
D: [minX minY maxX maxY] [minZ maxZ 0 0] <-- Index(0) is the coordinates. Indicated by the 0 in the first.
E: [minX minY maxX maxY] [minZ maxZ 0 1]
C: [minX minY maxX maxY] [minZ maxZ 0 2]

Size: 32 bits * 8 = 256 per row.
64: 16384
32: 8192
16: 4096
https://github.com/gpuweb/gpuweb/discussions/2348
https://www.w3.org/TR/WGSL/#alignment-and-size
alignment = alignment of largest structure

struct BVHInput {
  vec2 minXY;          // offset: 0, size: 4
  vec2 maxXY;          // offset: 4, size: 4
  vec2 minMaxZ;        // offset: 8, size: 4
  float offset;         // offset: 12, size: 4
  float primitiveIndex; // offset: 16, size: 4
}
size = Math.ceil(AlignOf(S), OffsetOfMember(S, L) + SizeofMember(S, L))
where L is the last member

size = Math.ceil(4, 16 + 4) = 20


Or
struct BVH {
  vec3 min;             // offset: 0, size: 12, align: 16
  // Implicit buffer    // offset: 12, size: 4
  vec3 max;             // offset: 16, size: 12, align: 16
  // Implicit buffer    // offset: 20, size: 4
  float offset;         // offset: 24, size: 4
  float primitiveIndex; // offset: 28, size: 4
}

size = Math.ceil(16, 28 + 4) = 32.
Unless the floats can be used in lieu of buffer, in which case:
size = Math.ceil(16, 20 + 4) = 24.



They are floats, so could encode the x/y or x/y/z.
x/y encode:
[minXY maxXY minMaxZ index] [index] <-- Maybe this would save space? Might use a filler.
http://forum.lwjgl.org/index.php?topic=7151.0 <-- Claims you can do vec3 followed by float

-- Alternatively, could encode index as well. So first X would be for tree / rest for primitive.
[minXY maxXY minMaxZ index/index]

https://github.com/gpuweb/gpuweb/discussions/2348
http://learnwebgl.brown37.net/12_shader_language/glsl_data_types.html

struct BVHInput {
  float minXY;    // offset: 0, size: 4
  float maxXY;    // offset: 4, size: 4
  float minMaxZ;  // offset: 8, size: 4
  float index;    // offset: 12, size: 4
}
size = Math.ceil(4, 12 + 4) = 16 bytes

Even at 16 bytes, would be too large with leaves:
16 * 1024 = 16384
16 * 512 = 8192
16 * 256 = 4096

Even on my laptop. likely max limit is 16384. That is less than 1000 walls, b/c of tree structure.


(No short, so use either floats or uint; same size either way.)
Might be worth keeping only the above BVHInput and converting on the fly...
This version would likely be size 32, instead of size 16 as above.
struct BVH {
  vec3 min;
  vec3 max;
  float offset;
  float primitiveIndex;
}



Wall Tex:
0: [Ax Ay ...] (D leaf here)
1: [Ax Ay ...] (E leaf here)
2: [Ax Ay ...] (C leaf here)



*/

/* Wall coordinates for shader
uInt16 x4

[Ax Ay Bx By] [topZ bottomZ label (wall/terrain)] <-- Keep z last, so x and y can be tested alone

Can we represent as UBO? Probably not; too big.

struct Wall {
  vec3 A;         // offset: 0, size: 12, align: 16
  float type;     // offset: 12, size: 4, align: 4
  vec3 B;         // offset: 16, size: 12, align: 16
  float unused;   // offset: 28, size: 4, align: 4
}
size = ceil(16, 28 + 4) = 32 bytes.

512 walls: 16384
256 walls: 8192


struct WallCompressed {
  float Axy;    // offset: 4, size: 4
  float Bxy;    // offset: 8, size: 4
  float z;      // offset: 12, size: 4
  float type;   // offset: 16, size: 4
}
size = ceil(4, 16 + 4) = 20 bytes




*/

/* Tile coordinates for shader
uInt16 x4

[TL.x TL.y TR.x TR.y] [BL.x BL.y BR.x BR.y] [Z]

*/

// TODO: Use alternative where x/y or z values are combined into a single key? Would require uInt32.
//       Could be worthwhile if we cut out a column.

class PVHBoundingBox {

  /** @type {Point3d} minimum */
  minimum = new Point3d();

  /** @type {Point3d} maximum */
  maximum = new Point3d();

  /**
   * @param {Point3d} min
   * @param {Point3d} max
   */
  constructor(min, max) {
    this.minimum.copyFrom(min);
    this.maximum.copyFrom(max);
  }

  /**
   * Test for a hit along a ray.
   * For debugging; implemented in shader directly.
   * @param {PVHRay} ray    The ray to test
   * @param {number} tMin   Minimum t-value along the ray
   * @param {number} tMax   Maximum t-value along the ray
   * @returns {bool}
   */
  hit(ray, tMin, tMax, dims = ["x", "y", "z"]) {
    for ( const dim of dims ) {
      const invD = 1 / ray.direction[dim];
      let t0 = (this.minimum[dim] - ray.origin[dim]) * invD;
      let t1 = (this.maximum[dim] - ray.origin[dim]) * invD;
      if ( invD < 0 ) [t0, t1] = [t1, t0]; // Swap
      tMin = t0 > tMin ? t0 : tMin;
      tMax = t1 < tMax ? t1 : tMax;
      if ( tMax <= tMin ) return false;
    }
    return true;
  }

  hit2d(ray, tMin, tMax) { return this.hit(ray, tMin, tMax, ["x", "y"]); }

  hit3d(ray, tMin, tMax) { return this.hit(ray, tMin, tMax, ["x", "y", "z"]); }

  /**
   * Output array texture values for this bounding box
   * @returns {number[]}
   */
  textureData() {
    return [
      this.minimum.x, this.minimum.y,
      this.maximum.x, this.maximum.y,
      this.minimum.z, this.maximum.z
    ];
  }

  /**
   * Compute the bounding box of two boxes.
   * @param {PVHBoundingBox} box0
   * @param {PVHBoundingBox} box1
   * @returns {PVHBoundingBox}
   */
  static union(box0, box1) {
    const small = new Point3d(
      Math.min(box0.minimum.x, box1.minimum.x),
      Math.min(box0.minimum.y, box1.minimum.y),
      Math.min(box0.minimum.z, box1.minimum.z));

    const large = new Point3d(
      Math.max(box0.maximum.x, box1.maximum.x),
      Math.max(box0.maximum.y, box1.maximum.y),
      Math.max(box0.maximum.z, box1.maximum.z));

    return new PVHBoundingBox(small, large);
  }

  /**
   * Draw 2d representation of the bounding box.
   * @param {Color} [color]
   */
  draw(color = Draw.COLORS.blue) {
    const minX = this.minimum.x;
    const minY = this.minimum.y;
    const width = this.maximum.x - minX;
    const height = this.maximum.y - minY;
    const rect = new PIXI.Rectangle(minX, minY, width, height);
    Draw.shape(rect, { color });
  }
}

class PVHRay {
  /** @type {Point3d} origin */
  origin = new Point3d();

  /** @type {Point3d} direction */
  direction = new Point3d();

  /**
   * @param {Point3d} origin      Origin point of the ray
   * @param {Point3d} direction   Direction of the ray
   * @returns {bool}
   */
  constructor(origin, direction) {
    this.origin.copyFrom(origin);
    this.direction.copyFrom(direction);
  }

  /**
   * @param {Point3d} origin
   * @param {Point3d} destination
   * @returns {PVHRay}
   */
  static fromPoints(origin, destination) {
    return new this(origin, destination.subtract(origin));
  }

  /**
   * Draw the 2d display of the ray.
   * @param {Color} color
   */
  draw(color = Draw.COLORS.yellow) {
    Draw.segment({ A: this.origin, B: this.origin.add(this.direction) }, { color });
  }
}

class PVHWall {
  /** @type {Wall} */
  wall;

  /** @type {PVHBoundingBox} */
  bbox;

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  type;

  /**
   * Index in the coordinate lookup texture.
   * @type {number}
   */
  coordinateIndex = -1;

  /** @type {number} */
  branchIndex = 0;

  /** @type {number} */
  branchOffset = 0;

  /**
   * @param {Wall} wall
   */
  constructor(wall, coordinateIndex = -1, type = "light") {
    this.wall = wall;
    this.coordinateIndex = coordinateIndex;
    this.type = type;

    const min = new Point3d(
      Math.min(wall.A.x, wall.B.x),
      Math.min(wall.A.y, wall.B.y),
      Math.min(wall.topZ, wall.bottomZ));
    const max = new Point3d(
      Math.max(wall.A.x, wall.B.x),
      Math.max(wall.A.y, wall.B.y),
      Math.max(wall.topZ, wall.bottomZ));
    this.bbox = new PVHBoundingBox(min, max);
  }

  get isLimited() { return this.type === CONST.WALL_RESTRICTION_TYPES.LIMITED; }

  /**
   * Test for a hit along a ray.
   * For debugging; implemented in shader directly.
   * @param {PVHRay} ray    The ray to test
   * @param {number} tMin   Minimum t-value along the ray
   * @param {number} tMax   Maximum t-value along the ray
   * @returns {false|PVHWall[]}
   */
  hit(ray, tMin, tMax) {
    if ( !this.bbox.hit(ray, tMin, tMax) ) return [];
    return [this];
  }

  /**
   * Output array texture values for this wall's bounding box.
   * @returns {number[]}
   */
  textureData(index) {
    return {
      data: [...this.bbox.textureData(), 0, this.coordinateIndex],
      maxIndex: index
    };
  }

  /**
   * Draw the wall location.
   * @param {Color} [color]
   */
  draw(color = Draw.COLORS.green) {
    const wall = this.wall;
    Draw.point(wall.A, { color });
    Draw.point(wall.B, { color });
    Draw.segment(wall, { color });
  }

  /**
   * Draw the boundary box.
   * @param {Color} color
   */
  drawBox(color = Draw.COLORS.blue) { this.bbox.draw(color); }
}

class PVHTile {
  /** @type {Tile} */
  tile;

  /** @type {PVHBoundingBox} */
  bbox;

  /** @type {object} */
  coords;

  /**
   * Index in the coordinate lookup texture.
   * @type {number}
   */
  coordinateIndex = -1;

  /** @type {number} */
  branchIndex = 0;

  /** @type {number} */
  branchOffset = 0;

  /**
   * @param {Wall} wall
   */
  constructor(tile, coordinateIndex = -1) {
    this.tile = tile;
    this.coordinateIndex = coordinateIndex;
    const { height, width } = tile.texture.baseTexture;
    const toLocalM = tile._evPixelCache._calculateToLocalTransform(1);
    const toCanvasM = toLocalM.invert();

    const TL = toCanvasM.multiplyPoint2d(new PIXI.Point(0, 0));
    const TR = toCanvasM.multiplyPoint2d(new PIXI.Point(width, 0));
    const BR = toCanvasM.multiplyPoint2d(new PIXI.Point(width, height));
    const BL = toCanvasM.multiplyPoint2d(new PIXI.Point(0, height));

    this.coords = { TL, TR, BR, BL };

    const xMinMax = Math.minMax(TL.x, TR.x, BR.x, BL.x);
    const yMinMax = Math.minMax(TL.y, TR.y, BR.y, BL.y);
    const elevation = tile.elevationZ;

    this.bbox = new PVHBoundingBox(
      new Point3d(xMinMax.min, yMinMax.min, elevation),
      new Point3d(xMinMax.max, yMinMax.max, elevation)
    );
  }

  /**
   * Test for a hit along a ray.
   * For debugging; implemented in shader directly.
   * @param {PVHRay} ray    The ray to test
   * @param {number} tMin   Minimum t-value along the ray
   * @param {number} tMax   Maximum t-value along the ray
   * @returns {false|PVHWall[]}
   */
  hit(ray, tMin, tMax) {
    if ( !this.bbox.hit(ray, tMin, tMax) ) return [];
    return [this];
  }

  /**
   * Output array texture values for this tile's bounding box.
   * @returns {number[]}
   */
  textureData(index) {
    return {
      data: [...this.bbox.textureData(), this.coordinateIndex, 0],
      maxIndex: index
    }
  }

  /**
   * Draw the tile outline.
   * @param {Color} color
   */
  draw(color = Draw.COLORS.orange) {
    const { TL, TR, BL, BR } = this.coords;

    Draw.point(TL, { color });
    Draw.point(TR, { color });
    Draw.point(BL, { color });
    Draw.point(BR, { color });
    Draw.segment({ A: TL, B: TR }, { color });
    Draw.segment({ A: TR, B: BR }, { color });
    Draw.segment({ A: BR, B: BL }, { color });
    Draw.segment({ A: BL, B: TL }, { color });
  }

  /**
   * Draw the boundary box.
   * @param {Color} color
   */
  drawBox(color = Draw.COLORS.blue) { this.bbox.draw(color); }
}

class PVH {
  /** @type {PVH} */
  left = null;

  /** @type {PVH} */
  right = null;

  /** @type {PVHBoundingBox} */
  bbox;

  /** @type {number} */
  #branchIndex = 0;

  /** @type {number} */
  #branchOffset = 0;

  /**
   * @param {(PVHWall|PVHTile)[]} objects   Objects to be placed in the tree
   * @param {number} start                  First object index
   * @param {number} end                    Last object index
   */
  constructor(objects, start, end) {
    start ??= 0;
    end ??= objects.length - 1;

    const axis = Math.floor(Math.random() * 2); // Only pick x or y axes for splits
    const cmp = axis === 0
      ? (a, b) => a.bbox.minimum.x - b.bbox.minimum.x
      : (a, b) => a.bbox.minimum.y - b.bbox.minimum.y;

    const span = end - start;
    switch ( span ) {
      case 0:
        this.left = objects[start];
        this.right = objects[start];
        break;

      case 1:
        if ( cmp(objects[start], objects[start + 1]) ) {
          this.left = objects[start];
          this.right = objects[start + 1];
        } else {
          this.left = objects[start + 1];
          this.right = objects[start];
        }
        break;

      default: {
        const spanObjects = objects.slice(start, end);
        spanObjects.sort(cmp);
        const mid = start + Math.floor(span * 0.5);
        this.left = new this.constructor(objects, start, mid);
        this.right = new this.constructor(objects, mid, end);
      }
    }
    this.bbox = PVHBoundingBox.union(this.left.bbox, this.right.bbox);
  }

  get branchOffset() { return this.#branchOffset; }

  set branchOffset(value) {
    this.#branchOffset = value;
    this.left.branchOffset = value;
    this.right.branchOffset = value;
  }

  /**
   * @param {PVHRay} ray    The ray to test
   * @param {number} tMin   Minimum t-value along the ray
   * @param {number} tMax   Maximum t-value along the ray
   * @returns {PVHWall[]}
   */
  hit(ray, tMin, tMax) {
    // TODO: Return boolean or an empty array?
    if ( !this.bbox.hit(ray, tMin, tMax) ) return [];

    const left = this.left.hit(ray, tMin, tMax);
    const right = this.right.hit(ray, tMin, tMax);
    return [...left, ...right];
  }

  /**
   * Output data to represent this node in a texture.
   * Note: first set tree.branchIndex.
   * @returns {number[]}
   */
  textureData(index = 0) {
    // Format is:
    // [minX minY maxX maxY] [minZ maxZ 1 2]
    // [minX minY maxX maxY] [minZ maxZ 3 4] ...
    // Leaves:
    // [minX minY maxX maxY] [minZ maxZ ]
    // Order is preorder traversal (depth first)
    //

    const { data: leftData, maxIndex: leftIndex } = this.left.textureData(index + 1);
    const { data: rightData, maxIndex: rightIndex } = this.right.textureData(leftIndex + 1);
    const data = [
      ...this.bbox.textureData(), leftIndex + 1 + this.branchOffset, 0,
      ...leftData,
      ...rightData
    ];

    return { data, maxIndex: rightIndex }
  }

  /**
   * Draw the bounding boxes for the tree.
   */
  drawBox() {
    this.bbox.draw();
    this.left.drawBox();
    this.right.drawBox();
  }

  /**
   * Draw the objects for the tree.
   */
  draw() {
    this.left.draw();
    this.right.draw();
  }

  /**
   * For debugging.
   * Print the texture data in columns of 8, as would be seen in a texture.
   */
  printTextureData() {
    const dat = this.textureData().data;
    const output = [];
    for ( let i = 0; i < dat.length; i += 8 ) output.push(dat.slice(i, i + 8));
    console.table(output)
  }
}

class GLSL {


  /**
   * Mimic GLSL texelFetch
   * @param {texture2d} texData   Object with texture data.
   * @param {PIXI.Point} coords   Lookup coordinates
   * @returns {vec4}
   */
  static texelFetch(tex, coords) {
    const { height, width, elementSize } = tex;

    if ( coords.x > width || coords.x < 0 ) console.error("Out of bounds in x direction.");
    if ( coords.y > height || coords.y < 0 ) console.error("Out of bounds in y direction.");

    const index = coords.y * width * elementSize + (coords.x * elementSize);
    const dat = tex.data.slice(index, index + elementSize)
    switch ( elementSize ) {
      case 1: return dat[0];
      case 2: return new PIXI.Point(dat[0], dat[1]);
      case 3: return new Point3d(dat[0], dat[1], dat[2]);
      case 4: return new vec4(dat);
      default: {
        console.error("Texture size unsupported.");
        return dat;
      }
    }
  }

  /**
   * Mimic GLSL texture
   * @param {texture2d} texData   Object with texture data.
   * @param {PIXI.Point} coords   Lookup coordinates between [0, 1]
   * @returns {vec4}
   */
  static texture(tex, coords) {
    const x = Math.floor(coords.x * tex.width);
    const y = Math.floor(coords.y * tex.height);
    return this.texelFetch(tex, { x, y });
  }
}

/**
 * Mimic GLSL texture object.
 * @param {number[]} arr            Data for the texture
 * @param {number} width            Width of the texture
 * @param {number} [elementSize=4]  How many values at each coordinate position. I.e., vec4 vs float, etc.
 */
function texture2d(arr, width, elementSize = 4) {
  this.data = arr;
  this.width = width;
  this.height = (arr.length / elementSize) / width;
  this.elementSize = 4;

  this.printTextureData = function() {
    const dat = this.data;
    const output = [];
    const nRows = this.width * this.elementSize;
    for ( let i = 0; i < dat.length; i += nRows ) output.push(dat.slice(i, i + nRows));
    console.table(output)
  }
}

function vec4(arr) {
  arr ??= [0, 0, 0, 0];
  this.x = arr[0];
  this.y = arr[1];
  this.z = arr[2];
  this.w = arr[3];

  Object.defineProperty(this, "r", {
    get: function() { return this.x; },
    set: function(value) { this.x = value; }
  });

  Object.defineProperty(this, "g", {
    get: function() { return this.y; },
    set: function(value) { this.y = value; }
  });

  Object.defineProperty(this, "b", {
    get: function() { return this.z; },
    set: function(value) { this.z = value; }
  });

  Object.defineProperty(this, "a", {
    get: function() { return this.a; },
    set: function(value) { this.w = value; }
  });
}


// GLSL structures
function BVHNode() {
  this.min = new Point3d();
  this.offset = 0;
  this.max = new Point3d();
  this.primitiveIndex = 0;
  this.index = 0;

  this.draw = function(color) {
    const box = new PVHBoundingBox(this.min, this.max);
    box.draw(color);
  }
}

function GLSLPlaceable(v0, v1, v2, v3) {
  this.v0 = v0 ?? new Point3d();
  this.v1 = v1 ?? new Point3d();
  this.v2 = v2 ?? new Point3d();
  this.v3 = v3 ?? new Point3d();

  this.draw = function(color) {
    Draw.point(this.v0, { color });
    Draw.point(this.v1, { color });
    Draw.point(this.v2, { color });
    Draw.point(this.v3, { color });
    Draw.segment({ A: this.v0, B: this.v1 }, { color });
    Draw.segment({ A: this.v1, B: this.v2 }, { color });
    Draw.segment({ A: this.v2, B: this.v3 }, { color });
    Draw.segment({ A: this.v3, B: this.v0 }, { color });
  }
}

function GLSLRay(origin, direction) {
  this.origin = origin ?? new Point3d();
  this.direction =  direction ?? new Point3d();
  this.draw = function(color) {
    const r = new PVHRay(this.origin, this.direction);
    r.draw(color);
  }
}

class GLSL_BVH {
  // Values set internally in GLSL
  static TEX_BVH_WIDTH = 8;
  static TEX_PRIMITIVES_WIDTH = 12;
  static ELEVATION_OFFSET = 32767.0;

  /** @type {number} */
  QUADRANTS = {
    TL: 0,
    BL: 1,
    TR: 2,
    BR: 3
  }

  uniforms = {};

  fragPosition = new Point3d();

  debug = false;

  /**
   * Parameter inputs treated as the "uniforms" per GLSL.
   */
  constructor(fragPosition, texBVH, texPrimitives, lightPosition) {
    this.uniforms.texBVH = texBVH;
    this.uniforms.texPrimitives = texPrimitives;
    this.uniforms.lightPosition = lightPosition;
    this.fragPosition = fragPosition;
  }

  /**
   * @param {Point3d} bboxMin
   * @param {Point3d} bboxMax
   * @param {Ray} ray
   * @param {object} t          Must contain { tMin, tMax }
   * @param {string|number} dim "x"|"y"|"z"|0|1|2
   * @returns {bool}
   */
  hitForDim(bboxMin, bboxMax, ray, t, dim) {
    // So numbers can be passed instead... only needed in JS.
    switch ( dim ) {
      case 0: dim = "x"; break;
      case 1: dim = "y"; break;
      case 2: dim = "z"; break;
    }

    const invD = 1 / ray.direction[dim];
    let t0 = (bboxMin[dim] - ray.origin[dim]) * invD;
    let t1 = (bboxMax[dim] - ray.origin[dim]) * invD;
    if ( invD < 0 ) [t0, t1] = [t1, t0]; // Swap
    t.tMin = t0 > t.tMin ? t0 : t.tMin;
    t.tMax = t1 < t.tMax ? t1 : t.tMax;
    if ( t.tMax <= t.tMin ) return false;
    return true;
  }

  /**
   * Pull node data for the current node index from the texture.
   * @param {number} currentNodeIndex
   * @returns {BVHNode}
   */
  initializeNodeXY(currentNodeIndex) {
    // Pull the relevant XY data from the texture.
    const texCoord = new PIXI.Point(0, currentNodeIndex);
    const minMaxXY = GLSL.texelFetch(this.uniforms.texBVH, texCoord);
    const min = new Point3d(minMaxXY.x, minMaxXY.y, 0);
    const max = new Point3d(minMaxXY.z, minMaxXY.w, 0);

    const node = new BVHNode();
    node.min = min;
    node.max = max;
    node.index = currentNodeIndex;
    return node;
  }

  /**
   * Pull z and indices data for the provided node from the texture.
   * @param {BVHNode} node
   * @returns {BVHNode}
   */
  initializeNodeZ(node) {
    const texCoord = new PIXI.Point(1, node.index);
    const dat = GLSL.texelFetch(this.uniforms.texBVH, texCoord);
    node.min.z = dat.x;
    node.max.z = dat.y;
    node.offset = dat.z;
    node.primitiveIndex = dat.w;
    return node;
  }

  /**
   * Pull primitive coordinates for wall.
   */
  initializePrimitive(primitiveIndex) {
    const dat0 = GLSL.texelFetch(this.uniforms.texPrimitives, new PIXI.Point(0, primitiveIndex));
    const dat1 = GLSL.texelFetch(this.uniforms.texPrimitives, new PIXI.Point(1, primitiveIndex));
    const dat2 = GLSL.texelFetch(this.uniforms.texPrimitives, new PIXI.Point(2, primitiveIndex));

    // Adjust the elevation coordinate.
    const elevationZ = new PIXI.Point(dat2.r, dat2.g);
    elevationZ.x -= GLSL_BVH.ELEVATION_OFFSET;
    elevationZ.y -= GLSL_BVH.ELEVATION_OFFSET;

    const out = new GLSLPlaceable();
    out.v0.x = dat0.x;
    out.v0.y = dat0.y;
    out.v0.z = elevationZ.x;

    out.v1.x = dat1.z;
    out.v1.y = dat1.w;
    out.v1.z = elevationZ.y;

    out.v2.x = dat1.x;
    out.v2.y = dat1.y;
    out.v2.z = elevationZ.y;

    out.v3.x = dat0.z;
    out.v3.y = dat0.w;
    out.v3.z = elevationZ.x;

    return out;
  }

  shadowValueForFragment() {
    const ray = new GLSLRay();
    ray.origin.copyFrom(this.fragPosition);
    ray.direction = this.uniforms.lightPosition.subtract(this.fragPosition);
    if ( this.debug ) Draw.segment({ A: this.fragPosition, B: this.uniforms.lightPosition}, { color: Draw.COLORS.yellow })


    let toVisitOffset = 0;
    let currentNodeIndex = 0;
    const nodesToVisit = new Uint32Array(16); // Allows 2^16 walls. Need one slot per layer.

    const MAX_ITER = 100;
    let iter = 0;
    while ( true ) {
      if ( ++iter > MAX_ITER ) {
        console.error("Max iterations reached.");
        return 0;
      }

      // TODO: Limit by quadrant first.
      if ( this.debug ) console.log(`currentNodeIndex ${currentNodeIndex}\t toVisitOffset ${toVisitOffset}\t`, [...nodesToVisit]);
      const node = this.initializeNodeXY(currentNodeIndex);
      if ( this.debug ) node.draw(Draw.COLORS.lightblue);

      if ( this.rayIntersectsNodeBounds(ray, node) ) {
        if ( this.debug ) node.draw(Draw.COLORS.lightred);
        if ( this.debug ) console.log("\thit bbox");

        if ( node.primitiveIndex > 0 ) {
          const prim = this.initializePrimitive(node.primitiveIndex);
          if ( this.debug ) prim.draw(Draw.COLORS.blue)
          if ( this.rayIntersectsPlaceable(ray, prim) ) {
            if ( this.debug ) prim.draw(Draw.COLORS.red)
            if ( this.debug ) console.log("\thit primitive");
            // TODO: Test for penumbra and umbra; return once full shadow found.
            return 1.0;
          }

          if ( toVisitOffset === 0 ) return 0;
          currentNodeIndex = nodesToVisit[--toVisitOffset];

        } else if ( node.offset < 1 ) {
          // If the primitives are not set (for testing), need this test as if no bounds hit.
          if ( toVisitOffset === 0 ) return 0;
          currentNodeIndex = nodesToVisit[--toVisitOffset];

        } else {
          // Put far BVH node on stack; advance to near node.
          nodesToVisit[toVisitOffset++] = node.offset;
          currentNodeIndex += 1;
        }
      } else {
        if ( toVisitOffset === 0 ) return 0;
        currentNodeIndex = nodesToVisit[--toVisitOffset];
      }
    }
    return 0.0;
  }


  // For now, just test the light center point and ignore barycentric coords.
  rayIntersectsPlaceable(ray, placeable) {
    const { v0, v1, v2, v3 } = placeable;
    const { origin, direction } = ray;
    return Plane.rayIntersectionQuad3dLD(origin, direction, v0, v1, v2, v3);

    // TODO: Test for terrain walls. Need to pass a counter.
    // TODO: Check for tile transparency. Likely a separate shader for this.
  }


  /**
   * Test if the ray intersects the node bounds.
   * @param {BVHRay} ray
   * @param {BVHNode} node
   * @returns {bool}
   */
  rayIntersectsNodeBounds(ray, node) {
    // Store t in object to reference as pointers.
    const t = { tMin: 0, tMax: 1 };

    // Check for XY intersection
    // TODO: Faster to store 1 / ray.direction in a vector and pass to hitForDim.
    if ( !this.hitForDim(node.min, node.max, ray, t, "x") ) return false;
    if ( !this.hitForDim(node.min, node.max, ray, t, "y") ) return false;

    // Check for Z intersection
    this.initializeNodeZ(node);
    return this.hitForDim(node.min, node.max, ray, t, "z");
  }
}

/**
 * Set of limited size. Once filled, new values will overwrite the oldest.
 * @param {number} length     Size of cache. Must be power of 2.
 * @param {number} [fill=0]   Value used as "null".
 */
function GLSLCache(length, fill = 0) {
  if ( !isPowerOfTwo(length) ) console.error("Length must be power of two.")

  this.length = length;
  this.cache = new Float32Array(length).fill(0);
  this.nextInsertion = 0;

  this.add = function(value) {
    this.cache[this.nextInsertion] = value;
    this.nextInsertion = bitMod(this.nextInsertion + 1, this.length);
  }

  this.has = function(value) {
    // Search backwards from the last insertion, assuming it is the most likely.
    for ( let i = this.nextInsertion - 1; i >= 0; i -= 1 ) {
      if ( this.cache[i] === value ) return true;
    }

    // Search remainder.
    for ( let i = this.length - 1; i >= this.nextInsertion; i += 1 ) {
      if ( this.cache[i] === value ) return true;
    }

    return false;
  }
}

// Note: fails for negatives or 0 or (arguably) 1.
function isPowerOfTwo(x) {
  return (x & (x - 1)) === 0;
}

// Note: d must be power of two.
function bitMod(n, d) {
  if ( !isPowerOfTwo(length) ) console.error("d must be power of two.");
  return n & (d - 1);
}



/**
 * Frag quadrant, relative to center of scene.
 * @param {PIXI.Point} sceneCenter
 * @param {PIXI.Point} fragPosition
 * @returns {QUADRANTS}
 */
function GLSLDirectionalLightQuadrant(sceneCenter, fragPosition) {
  const bottom = Number(fragPosition.y > sceneCenter.y); // Note: use int
  const right = Number(fragPosition.x > sceneCenter.x); // Note: use int
  return bottom | (right * 2);
}

/**
 * @param {PIXI.Point} sceneCenter
 * @param {PIXI.Point} fragPosition
 * @returns {QUADRANTS}
 */
function GLSLPointLightQuadrant(lightPosition, fragPosition) {
  const bottom = Number(fragPosition.y > sceneCenter.y); // Note: use int
  const right = Number(fragPosition.x > sceneCenter.x); // Note: use int
  return bottom | (right * 2);
}



/*

Assume 1000 walls in a large scene.
Assume 10% overlap at least one quadrant.
A light might take up 1/4 of a quadrant.

Quadrant: 250 walls + 50 walls overlap = 300 walls.
Light: ~ 75 walls. Let's round to a nice 100 walls.

For light, we can divide by quadrant again.

Positional:
- 100 walls total.
- 25 + 5 overlap = 30.
- 30 walls tested max, per fragment.

Directional or very large lights:
- 1000 walls total.
- 250 + 50 overlap = 300.
- 300 walls tested max, per fragment. Ouch!

Using BVH, we can assume O(log(N)) search time.
But we have to pull the textures as well.

Positional:
- 30 walls.
- ln(30) ~ 3.4 => 4?

Directional:
- 300 walls
- ln(300) ~ 5.7 => 6?

Worst case, every wall is transparent and in the ray line, so would test every wall.
But on average, might reasonably expect to cut testing by 1/3 to 2/3.
- Usually, first intersected wall is all you need. (This may fail for penumbra testing.)
- Sorting by distance from light position might help with positional lights.
*/


/**
 * Determine shadow amount for a fragment.
 * 1. Test walls for hits on light ray.
 * 2. Test for penumbra and umbra on 2d plane, top-down.
 * 3. Track if we already tested an object; don't retest? Avoid double-counting penumbra.
 * 3. Return the float. 1.0 for shadow; 0.0 for none. Fractional (0, 0.5) for penumbra; [0.5, 1.0) for umbra.
 */
function GLSLDirectionalShadow(BVHTex, CoordsTex, fragPosition, sceneCenter, lightDirection, lightSize) {
  // First, determine quadrant.
  const quadrant = GLSLDirectionalLightQuadrant(sceneCenter, fragPosition);




}


function GLSLPointShadow(BVHTex, CoordsTex, fragPosition, lightPosition, lightAngle) {
  // First, determine quadrant.
  const quadrant = GLSLPointLightQuadrant(lightPosition, fragPosition);
}


/**
 * Determine whether the ray hits wall(s).
 */
function GLSLHit(, origin, fragPosition) {


}




// Testing
api = game.modules.get("elevatedvision").api
Draw = CONFIG.GeometryLib.Draw;
SourceDepthShadowMap = api.SourceDepthShadowMap
PlaceablesCoordinatesData = api.PlaceablesCoordinatesData
Point3d = CONFIG.GeometryLib.threeD.Point3d
Matrix = CONFIG.GeometryLib.Matrix
Plane = CONFIG.GeometryLib.Plane


walls = canvas.walls.placeables;
objects = walls.map(w => new PVHWall(w));

// Draw objects and their bounding boxes
objects.forEach(obj => obj.draw());
objects.forEach(obj => obj.bbox.draw())


tree = new PVH(objects);

// Draw bounding boxes and objects at each level
tree.draw();
tree.drawBox();

Draw.clearDrawings();
tree.draw();

tree.bbox.draw();
subtree = tree.left;
subtree = tree.right;
subtree.bbox.draw();
subtree = subtree.left;
subtree = subtree.right;

// Output texture data
tree.branchIndex = 0

objects[0].textureData()
tree.textureData()




// Shoot a ray and draw bboxes


rOrigin = new Point3d(_token.center.x, _token.center.y, _token.bottomZ);
rDest = new Point3d(_token.center.x, _token.center.y, _token.bottomZ);
ray = PVHRay.fromPoints(rOrigin, rDest);

hitObjs = tree.hit(ray, 0, 1);
hitObjs.forEach(obj => obj.bbox.draw());
hitObjs.forEach(obj => obj.draw());



subtree = tree
if ( !subtree.bbox.hit(ray, tMin, tMax) ) return [];
left = subtree.left.hit(ray, tMin, tMax);
subtree = subtree.left

right = subtree.right.hit(ray, tMin, tMax)
subtree = subtree.right


subtree === tree.left.right


const right = tree.right.hit(ray, tMin, tMax);
return [...left, ...right];


// Test GLSL-type code
lightOrigin = new Point3d(100, 100, 1600);
// lightOrigin = new Point3d(100, canvas.dimensions.height - 100, 1600);

directional = true;
lightRadius = undefined;
lightSize = 1;

Draw.clearDrawings()
Draw.point(lightOrigin, { color: Draw.COLORS.yellow });
Draw.segment({A: lightOrigin, B: canvas.dimensions.sceneRect.center }, { color: Draw.COLORS.yellow })

// Set up tree
placeablesCoords = new PlaceablesCoordinatesData("light"); // For the wall data texture

objects = []
placeablesCoords.coordinates.forEach((obj, idx) => {
  if ( !(obj.object instanceof Wall) ) return;
  objects.push(new PVHWall(obj.object, idx));
})

tree = new PVH(objects);
tree.draw()
tree.drawBox()

// Set up textures
treeData = tree.textureData().data
texBVH = new texture2d(treeData, 2, 4)
texBVH.printTextureData()


texPrimitives = new texture2d(placeablesCoords._wallDataArray(), 3, 4)
texPrimitives.printTextureData()

// Build ray to test.
// Use token center to be the "fragment"
center = _token.center
fragPosition = new Point3d(center.x, center.y, 0)
glslTest = new GLSL_BVH(fragPosition, texBVH, texPrimitives, lightOrigin)

// Test individual nodes for debugging
ray = new GLSLRay(fragPosition, lightOrigin.subtract(fragPosition))
node = glslTest.initializeNodeXY(0);

t = {tMin: 0, tMax: 1}
glslTest.hitForDim(node.min, node.max, ray, t, "x")
glslTest.hitForDim(node.min, node.max, ray, t, "y")

glslTest.initializeNodeZ(node)
glslTest.hitForDim(node.min, node.max, ray, t, "z")

glslTest.rayIntersectsNodeBounds(ray, node)


// Compare to other JS code
rayPVH = new PVHRay(ray.origin, ray.direction);
bboxPVH = new PVHBoundingBox(node.min, node.max);
bboxPVH.hit(ray, 0, 1, dims = ["x"])
bboxPVH.hit(ray, 0, 1)


// Run the full shadow detection function
Draw.clearDrawings()
glslTest = new GLSL_BVH(fragPosition, texBVH, texPrimitives, lightOrigin)
glslTest.debug = true
glslTest.shadowValueForFragment()


ray = new GLSLRay();
ray.origin.copyFrom(glslTest.fragPosition);
ray.direction = glslTest.uniforms.lightPosition.subtract(glslTest.fragPosition);
if ( glslTest.debug ) Draw.segment({ A: glslTest.fragPosition, B: glslTest.uniforms.lightPosition}, { color: Draw.COLORS.yellow })


let toVisitOffset = 0;
let currentNodeIndex = 0;
nodesToVisit = new Uint32Array(16); // Allows 2^16 walls. Need one slot per layer.

MAX_ITER = 100;
let iter = 0;
while ( true ) {
  if ( ++iter > MAX_ITER ) {
    console.error("Max iterations reached.");
    return 0;
  }

  // TODO: Limit by quadrant first.
  let node = glslTest.initializeNodeXY(currentNodeIndex);
  if ( glslTest.debug ) console.log(`currentNodeIndex ${currentNodeIndex}\t toVisitOffset ${toVisitOffset}\t`, [...nodesToVisit]);
  if ( glslTest.debug ) node.draw(Draw.COLORS.lightblue);


  if ( glslTest.rayIntersectsNodeBounds(ray, node) ) {
    if ( glslTest.debug ) node.draw(Draw.COLORS.lightred);
    if ( glslTest.debug ) console.log("\thit bbox");

    if ( node.primitiveIndex > 0 ) {
      const prim = glslTest.initializePrimitive(node.primitiveIndex);
      if ( glslTest.debug ) prim.draw(Draw.COLORS.blue)
      if ( rayIntersectsPlaceable(prim) ) {
        if ( this.debug ) prim.draw(Draw.COLORS.red)
        // TODO: Test for penumbra and umbra; return once full shadow found.
        return 1.0;
      }
      if ( toVisitOffset === 0 ) return 0;
      currentNodeIndex = nodesToVisit[--toVisitOffset];

    } else {
      // Put far BVH node on stack; advance to near node.
      nodesToVisit[toVisitOffset++] = node.offset;
      currentNodeIndex += 1;
    }
  } else {
    if ( toVisitOffset === 0 ) return 0;
    currentNodeIndex = nodesToVisit[--toVisitOffset];
  }
}
return 0.0;

