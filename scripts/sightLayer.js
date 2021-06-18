import { log, MODULE_ID } from "./module.js";

 /**
   * Restrict the visibility of certain canvas assets (like Tokens or DoorControls) based on the visibility polygon
   * These assets should only be displayed if they are visible given the current player's field of view
   */

// no args, no return
export function evRestrictVisiblity(wrapped, ...args) {
  const res = wrapped(...args)
  log("evRestrictVisiblity", ...args, res);
  // no return
}

 /**
   * Test whether a point on the Canvas is visible based on the current vision and LOS polygons
   *
   * @param {Point} point           The point in space to test, an object with coordinates x and y.
   * @param {number} tolerance      A numeric radial offset which allows for a non-exact match. For example, if
   *                                tolerance is 2 then the test will pass if the point is within 2px of a vision
   *                                polygon.
   * @param {PIXI.DisplayObject} [object]   An optional reference to the object whose visibility is being tested
   *
   * @return {boolean}              Whether the point is currently visible.
   */
   
/*
point: 
x: 1610
​
y: 1890

tolerance: 35

object: looks like a token. e.g., Randal token. (only other token on the map)
// iterates through each object (token) on the map

return: false
*/   
export function evTestVisibility(wrapped, point, {tolerance=2, object=null}={}) {
  const res = wrapped(point, {tolerance: tolerance, object: object});
  log("evTestVisibility object", object);
  log("evTestVisibility this", this);
  log(`evTestVisibility wrapped returned ${res}`);
  
  const debug = canvas.controls.debug;
  
  // need a token object
  if(!object) return res;
  
  // Assume for the moment that the base function tests only infinite walls based on fov / los. If so, then if a token is not seen, elevation will not change that. 
  if(!res) return res;
  
  // temporary; will eventually check for wall height as well
  if(!game.modules.get("enhanced-terrain-layer")?.active) return res;
  
  const terrain_layer = canvas.layers.filter(l => l?.options?.objectClass?.name === "Terrain")[0];
  if(!terrain_layer) return res;
  
  let terrains = terrain_layer.placeables; // array of terrains
  if(terrains.length === 0) return res;
  
  // convert points array to actual, not relative, points
  // do here to avoid repeating this later
  // t.data.height, width, x, y gives the rectangle. x,y is upper left corner?
  // t.data.points are the points of the polygon relative to x,y
  log("evTestVisiblity terrains", terrains);
  const obj_elevation = toGridDistance(object.data.elevation || 0);
  
  // this.sources is a map of selected tokens (may be size 0)
  // all tokens contribute to the vision
  // so iterate through the tokens
  if(!this.sources || this.sources.size === 0) return res;
  const visible_to_sources = [...this.sources].map(s => {
     // get the token elevation
     log("evTestVisibility source", s);
     const src_elevation = toGridDistance(s.object.data.elevation || 0);
     
     // find terrain walls that intersect the ray between the source and the test token
     // origin is the point to be tested
     let ray = new Ray(point, { x: s.x, y: s.y });
     debug.lineStyle(1, 0x00FF00).moveTo(ray.A.x, ray.A.y).lineTo(ray.B.x, ray.B.y);
     
     // TO DO: faster to check rectangles first? 
     // could do t.x, t.x + t.width, t.y, t.y + t.height
     
     const terrains_block = terrains.map(t => {
//        ray.intersectSegment?
       
       // probably faster than checking everything in the polygon?
       if(!testBounds(t, ray)) {
         log("tested bounds returned false", t, ray);
         return false;
       }
       
       const terrain_elevation = toGridDistance(t.max || 0); // Number.NEGATIVE_INFINITY may be a better option? But then should just return false...
       
       // for lines at each points, determine if intersect
       // last point is same as first point (if closed). Always open? 
       for(let i = 0; i < (t.data.points.length - 1); i++) {
         //log(`Testing intersection (${t.data.x + t.data.points[i][0]}, ${t.data.y + t.data.points[i][1]}), (${t.data.x + t.data.points[i + 1][0]}, ${t.data.y + t.data.points[i + 1][1]}`, ray);
         const segment = { A: { x: t.data.x + t.data.points[i][0],
                                y: t.data.y + t.data.points[i][1] },
                           B: { x: t.data.x + t.data.points[i + 1][0],
                                y: t.data.y + t.data.points[i + 1][1] }};
         
         const intersection = ray.intersectSegment([segment.A.x, segment.A.y,
                                                    segment.B.x, segment.B.y]);
         if(intersection) {
           log(`Intersection found at i = ${i}!`, segment, intersection);
           debug.lineStyle(1, 0xFFA500).moveTo(segment.A.x, segment.A.y).lineTo(segment.B.x, segment.B.y);
           
           if(intersectionBlocks(intersection, ray, src_elevation, obj_elevation, terrain_elevation)) return true; // once we find a blocking segment we are done
           
         } else {
           debug.lineStyle(1, 0x00FF00).moveTo(segment.A.x, segment.A.y).lineTo(segment.B.x, segment.B.y);
         }
       }
       
       return false;
       
       // Ray.fromArrays(p[0], p[1])
       //return t.shape.contains(testX, testY);
     });  // terrains.map
     // if any terrain blocks, then the token is not visible for that sight source
     const is_visible = !terrains_block.reduce((total, curr) => total || curr, false);
     log(`terrains ${is_visible ? "do not block" : "do block"}`, terrains_block);
  
     return is_visible;
     
  }); // [...this.sources].forEach
  
  // if any source has vision to the token, the token is visible
  const is_visible = visible_to_sources.reduce((total, curr) => total || curr, false);
  log(`object ${is_visible ? "is visible" : "is not visible"} to sources`, visible_to_sources);
  
  return is_visible;
}

/* 
 * Helper function to convert absolute increments to grid distance
 */
export function toGridDistance(increment) {
  return Math.round(increment * canvas.scene.data.gridDistance * 100) / 100;
}

function intersectionBlocks(intersection, ray, src_elevation, obj_elevation, terrain_elevation) {
  // terrain segment operates as the fulcrum of a see-saw, where the sight ray in 3-D moves
  //   depending on elevations: as src moves up, it can see an obj that is lower in elevation.  
  // the geometry is a rectangle with the 3-D sight line running from upper left corner to 
  //   lower right (or lower left to upper right) and the wall vertical in the middle.
  // draw a line from the vision source to the target (this should be ray)
  // get distance from source to the intersection point on the canvas
/*

 V----------T----------?
 | \ Ø      |    |
e|    \     |    |
 |       \  |    |  
 |          \    |
 |          |  \ | <- point where obj can be seen by V for given elevations 
 ----------------------
 |<-   x       ->|
 e = height of V (vision object)
 Ø = theta
 T = terrain wall
*/  
   
  
  // theta is the angle between the 3-D sight line and the sight line in 2-D
  let ray_to_intersect = new Ray(ray.A, intersection);
  
  const opposite = src_elevation - terrain_elevation;
  const ratio = opposite / ray_to_intersect.distance; // ray_to_intersect.distance is the adjacent side of the triangle
  const theta = invTan(ratio);
  const x = src_elevation / Math.tan(theta);
  log(`src_elevation: ${src_elevation}; obj_elevation: ${obj_elevation}; terrain_elevation: ${terrain_elevation}`);
  log(`opposite: ${opposite};  ratio: ${ratio}`);
  log(`distance to wall intersect (adjacent): ${ray_to_intersect.distance}`, ray_to_intersect);
  log(`(e-h): ${(src_elevation - terrain_elevation)}`); 
  log(`theta: ${theta}; x: ${x}`);
  log(`ray distance: ${ray.distance}`, ray);
  log(`tan(theta) = ((e - h) / d): tan(${theta}) = ((${src_elevation} - ${terrain_elevation}) / ${ray_to_intersect.distance})`);
  log(`x = e / tan(theta): ${x} = ${src_elevation} / tan(${theta})`);

  
  return (x > ray.distance); // x is the distance at which the terrain segment blocks for the given elevations.
}

/*
 * Helper function to calculate inverse tan, or tan-1
 */
function invTan(x) {
  return Math.atan(x) * (180 / Math.PI);
}

/*
 * Test if the ray intersects the bounds of the rectangle encompassing the terrain.
 * TO-DO: See if this improves performance: https://www.scratchapixel.com/lessons/3d-basic-rendering/minimal-ray-tracer-rendering-simple-shapes/ray-box-intersection
 */ 
function testBounds(terrain, ray) {
  //  An array of coordinates [x0, y0, x1, y1] which defines a line segment
  // rect points are A, B, C, D clockwise from upper left
  const debug = canvas.controls.debug;

  // getBounds returns the correct size and location but at the upper left corner (relative location but no real location data)
  // getLocalBounds returns the correct size but all are tied to upper left corner (no location at all)
  // bounds object is {x, y, width, height, type: 1}
  //debug.lineStyle(0).beginFill(0x66FFFF, 0.1).drawShape(terrain.getLocalBounds());
  const bounds_rect = new NormalizedRectangle(terrain.data.x, terrain.data.y, terrain.data.width, terrain.data.height);
  debug.lineStyle(0).beginFill(0x66FFFF, 0.1).drawShape(bounds_rect);

  // if the ray origin or destination is within the bounds, need to test the polygon
  // could actually be outside the polygon but inside the rectangle bounds
  if(bounds_rect.contains(ray.A.x, ray.A.y) || bounds_rect.contains(ray.B.x, ray.B.y)) return true;
  

  const A = {x: terrain.data.x, y: terrain.data.y};
  const B = {x: terrain.data.x + terrain.data.width, y: terrain.data.y};
  const C = {x: B.x, y: terrain.data.y + terrain.data.height};
  const D = {x: terrain.data.x, y: C.y};
  
  //log("testBounds bounds of terrain", terrain.getLocalBounds(), terrain.getBounds(), terrain.data);
  
  // top 
  
  debug.lineStyle(1, 0xFF0000).moveTo(A.x, A.y).lineTo(B.x, B.y);
  if(ray.intersectSegment([A.x, A.y, B.x, B.y])) return true;
  
  // right
  debug.lineStyle(1, 0xFF0000).moveTo(B.x, B.y).lineTo(C.x, C.y);
  if(ray.intersectSegment([B.x, B.y, C.x, C.y])) return true;
  
  // bottom
  debug.lineStyle(1, 0xFF0000).moveTo(C.x, C.y).lineTo(D.x, D.y);
  if(ray.intersectSegment([C.x, C.y, D.x, D.y])) return true;
  
  // left
  debug.lineStyle(1, 0xFF0000).moveTo(D.x, D.y).lineTo(A.x, A.y);
  if(ray.intersectSegment([D.x, D.y, A.x, A.y])) return true;
  
  return false;
} 


/*
​​
height: 709
​​​
hidden: false
​​​
locked: false
​​​
max: 50
​​​
min: 0
​​​
multiple: 3
​​​
obstacle: undefined
​​​
points: Array(13) [ (2) […], (2) […], (2) […], … ]
​​​​
0: Array [ 0, 377.8069279346211 ]
​​​​
1: Array [ 0, 709.5398402674591 ]
​​​​
2: Array [ 586.25, 645.0362184249628 ]
​​​​
3: Array [ 671.3508064516128, 506.81417161961366 ]
​​​​
4: Array [ 851.008064516129, 433.0957466567608 ]
​​​​
5: Array [ 973.9314516129032, 230.3700780089153 ]
​​​​
6: Array [ 1059.032258064516, 175.08125928677563 ]
​​​​
7: Array [ 1172.5, 0 ]
​​​​
8: Array [ 869.9193548387096, 9.214803120356612 ]
​​​​
9: Array [ 642.9838709677418, 258.01448736998515 ]
​​​​
10: Array [ 368.77016129032256, 405.45133729569096 ]
​​​​
11: Array [ 236.39112903225805, 396.2365341753343 ]
​​​​
12: Array [ 0, 377.8069279346211 ]
​​​​
length: 13
​​​​
<prototype>: Array []
​​​
width: 1172
​​​
x: 1312.5
​​​
y: 1417.5
*/
