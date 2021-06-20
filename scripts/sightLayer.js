import { log, MODULE_ID, FORCE_TOKEN_VISION_DEBUG } from "./module.js";
import { toGridDistance } from "./utility.js";

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
  
  const isDebuggingVision = FORCE_TOKEN_VISION_DEBUG;
  // const isDebuggingVision = CONFIG.debug.sightRays;
  const debug = isDebuggingVision ? canvas.controls.debug : undefined;
  
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
  log(`evTestVisibility object with elevation ${obj_elevation}.`, object);
  // this.sources is a map of selected tokens (may be size 0)
  // all tokens contribute to the vision
  // so iterate through the tokens
  if(!this.sources || this.sources.size === 0) return res;
  const visible_to_sources = [...this.sources].map(s => {
     // get the token elevation
     const src_elevation = toGridDistance(s.object.data.elevation || 0);
     
     // find terrain walls that intersect the ray between the source and the test token
     // origin is the point to be tested
     let ray_VO = new Ray({ x: s.x, y: s.y }, point);
     if(isDebuggingVision) debug.lineStyle(1, 0x00FF00).moveTo(ray_VO.A.x, ray_VO.A.y).lineTo(ray_VO.B.x, ray_VO.B.y);
     log(`evTestVisibility source at distance ${ray_VO.distance} and elevation ${src_elevation}.`, s);
     
     // TO DO: faster to check rectangles first? 
     // could do t.x, t.x + t.width, t.y, t.y + t.height
     
     const terrains_block = terrains.map(t => {
       
       // probably faster than checking everything in the polygon?
       if(!testBounds(t, ray_VO)) {
         log("tested bounds returned false", t, ray_VO);
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
         
         const intersection = ray_VO.intersectSegment([segment.A.x, segment.A.y,
                                                    segment.B.x, segment.B.y]);
         if(intersection) {
           log(`Intersection found at i = ${i}!`, segment, intersection);
           if(isDebuggingVision) debug.lineStyle(1, 0xFFA500).moveTo(segment.A.x, segment.A.y).lineTo(segment.B.x, segment.B.y);
           
           if(intersectionBlocks(intersection, ray_VO, src_elevation, obj_elevation, terrain_elevation, object.data.name)) return true; // once we find a blocking segment we are done
           
         } else {
           if(isDebuggingVision) debug.lineStyle(1, 0x00FF00).moveTo(segment.A.x, segment.A.y).lineTo(segment.B.x, segment.B.y);
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
 * Calculate whether a terrain or wall segment blocks vision of an object.
 * @param intersection {t0: Number, t1: Number, x: Number, y: Number} Point at which the
 *   ray between the vision point and the object intersects the terrain/wall segment
 * @param ray_VO {Ray} Ray representing vision line between vision point and object. 
 *   Runs through intersection.
 * @param Ve {Number} Vision elevation in the same units as intersection and ray_VO.
 * @param Oe {Number} Object elevation in the same units as intersection and ray_VO.
 * @param Te {Number} Terrain/wall segment elevation in the same units as intersection and ray_VO.
 * return {Boolean} true if the segment blocks vision of object from view at vision point. 
 */
function intersectionBlocks(intersection, ray_VO, Ve, Oe, Te, obj_name="") {
  // terrain segment operates as the fulcrum of a see-saw, where the sight ray in 3-D moves
  //   depending on elevations: as src moves up, it can see an obj that is lower in elevation.  
  // the geometry is a rectangle with the 3-D sight line running from upper left corner to 
  //   lower right (or lower left to upper right) and the wall vertical in the middle.
  // draw line from vision source to the intersection point on the canvas
  // use the height of the terrain to figure out theta and then use the angle to infer 
  //   whether the height of O is sufficient to be seen
/*

  V----------T----------?
  | \ Ø      |    |
Ve|    \     |    |
  |       \  |    |  
  |          \    |
  |        Te|  \ | <- point where obj can be seen by V for given elevations 
  ---------------------
  |<-   VOd      ->|
 e = height of V (vision object)
 Ø = theta
 T = terrain wall
*/  
  // if any elevation is negative, normalize so that the lowest elevation is 0
  const min_elevation = Math.min(Ve, Oe, Te);
  if(min_elevation < 0) {
    const adder = abs(min_elevation);
    Ve = Ve + adder;
    Oe = Oe + adder;
    Te = Te + adder;
  }

  // if the vision elevation is less than the terrain elevation, 
  //   the wall blocks unless the object is higher than the wall 
  log(`${obj_name} Ve: ${Ve}; Oe: ${Oe}; Te: ${Te}; VO: ${ray_VO.distance}`);

  if(Ve <= Te && Oe <= Te) {
   log(`Wall blocks because Ve <= Te (${Ve} <= ${Te}) and Oe <= Te (${Oe} <= ${Te})`);
   return true;
  }
 
  // looking up, over the wall or
  // looking down at the wall; the wall shades some parts near it.
  const ray_VT = new Ray(ray_VO.A, { x: intersection.x, y: intersection.y }); 

  // theta is the angle between the 3-D sight line and the sight line in 2-D
  const theta = Math.atan((Ve - Te) / ray_VT.distance); // theta is in radians
  log(`theta = Math.atan((Ve - Te) / ray_VT.distance) = atan((${Ve} - ${Te}) / ${ray_VT.distance}) = ${theta}`);

  // distance O needs to be from the wall before it can be seen, given elevations.
  const TO_needed = (Te - Oe) / Math.tan(theta); // tan wants radians
  const VO_needed = ray_VT.distance + TO_needed; // convert to distance from vision point
  log(`TO_needed = (Te - Oe) / Math.tan(theta) = (${Te} - ${Oe}) / ${Math.tan(theta)} = ${TO_needed};`);
  log(`VO_needed: ${VO_needed}; VO: ${ray_VO.distance}`);

  return VO_needed > ray_VO.distance;  
}

/*
 * Test if the ray intersects the bounds of the rectangle encompassing the terrain.
 * TO-DO: See if this improves performance: https://www.scratchapixel.com/lessons/3d-basic-rendering/minimal-ray-tracer-rendering-simple-shapes/ray-box-intersection
 */ 
function testBounds(terrain, ray) {
  //  An array of coordinates [x0, y0, x1, y1] which defines a line segment
  // rect points are A, B, C, D clockwise from upper left
  const isDebuggingVision = FORCE_TOKEN_VISION_DEBUG;
  //const isDebuggingVision = CONFIG.debug.sightRays;
  const debug = isDebuggingVision ? canvas.controls.debug : undefined;

  // getBounds returns the correct size and location but at the upper left corner (relative location but no real location data)
  // getLocalBounds returns the correct size but all are tied to upper left corner (no location at all)
  // bounds object is {x, y, width, height, type: 1}
  //debug.lineStyle(0).beginFill(0x66FFFF, 0.1).drawShape(terrain.getLocalBounds());
  const bounds_rect = new NormalizedRectangle(terrain.data.x, terrain.data.y, terrain.data.width, terrain.data.height);
  if(isDebuggingVision) debug.lineStyle(0).beginFill(0x66FFFF, 0.1).drawShape(bounds_rect);

  // if the ray origin or destination is within the bounds, need to test the polygon
  // could actually be outside the polygon but inside the rectangle bounds
  if(bounds_rect.contains(ray.A.x, ray.A.y) || bounds_rect.contains(ray.B.x, ray.B.y)) return true;
  

  const A = {x: terrain.data.x, y: terrain.data.y};
  const B = {x: terrain.data.x + terrain.data.width, y: terrain.data.y};
  const C = {x: B.x, y: terrain.data.y + terrain.data.height};
  const D = {x: terrain.data.x, y: C.y};
  
  //log("testBounds bounds of terrain", terrain.getLocalBounds(), terrain.getBounds(), terrain.data);
  
  // top 
  
  if(isDebuggingVision) debug.lineStyle(1, 0xFF0000).moveTo(A.x, A.y).lineTo(B.x, B.y);
  if(ray.intersectSegment([A.x, A.y, B.x, B.y])) return true;
  
  // right
  if(isDebuggingVision) debug.lineStyle(1, 0xFF0000).moveTo(B.x, B.y).lineTo(C.x, C.y);
  if(ray.intersectSegment([B.x, B.y, C.x, C.y])) return true;
  
  // bottom
  if(isDebuggingVision) debug.lineStyle(1, 0xFF0000).moveTo(C.x, C.y).lineTo(D.x, D.y);
  if(ray.intersectSegment([C.x, C.y, D.x, D.y])) return true;
  
  // left
  if(isDebuggingVision) debug.lineStyle(1, 0xFF0000).moveTo(D.x, D.y).lineTo(A.x, A.y);
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
