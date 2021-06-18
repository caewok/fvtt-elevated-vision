import { log } from "./module.js";

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
  
  // need a token object
  if(!object) return res;
  
  // Assume for the moment that the base function tests only infinite walls based on fov / los. If so, then if a token is not seen, elevation will not change that. 
  if(!res) return res;
  
  // temporary; will eventually check for wall height as well
  if(!game.settings.get(MODULE_ID, "enable-terrain-elevation")) return res;
  
  const terrain_layer = canvas.layers.filter(l => l?.options?.objectClass?.name === "Terrain")[0];
  if(!terrain_layer) return res;
  
  let terrains = terrain_layer.placeables; // array of terrains
  if(terrains.length === 0) return res;
  
  // convert points array to actual, not relative, points
  // do here to avoid repeating this later
  // t.data.height, width, x, y gives the rectangle. x,y is upper left corner?
  // t.data.points are the points of the polygon relative to x,y
  terrains = terrains.map(t => {
    t.points = t.points.map(p => {
      return[t.x + p[0], t.y + p[1]];
    });
    return t;
  });
  
  // get the object elevation
  
  
  // this.sources is a map of selected tokens (may be size 0)
  // all tokens contribute to the vision
  // so iterate through the tokens
  [...this.sources].forEach(s => {
     // get the token elevation
     
     // find terrain walls that intersect the ray between the source and the test token
     // origin is the point to be tested
     let ray = new Ray(point, { x: s.x, y: s.y });
     
     // TO DO: faster to check rectangles first? 
     // could do t.x, t.x + t.width, t.y, t.y + t.height
     
     let terrains = terrains.filter(t => {
//        ray.intersectSegment?
       
       // probably faster than checking everything in the polygon?
       if(!testBounds(t, ray)) return false;
       
       // for lines at each points, determine if intersect
       // last point is same as first point (if closed). Always open? 
       for(let i = 0; i < (t.points.length - 1); i++) {
         const intersection = ray.intersectSegment([t.points[i][0], t.points[i][1],
                                                    t.points[i + 1][0], t.points[i + 1][1]]);
         if(intersection) {
           log("Intersection found at i = ${i}!", intersection);
         }
       
       }
       
       
       // Ray.fromArrays(p[0], p[1])
       //return t.shape.contains(testX, testY);
     });
     
  });
  
  
  return res;
}

/*
 * Test if the ray intersects the bounds of the rectangle encompassing the terrain.
 * TO-DO: See if this improves performance: https://www.scratchapixel.com/lessons/3d-basic-rendering/minimal-ray-tracer-rendering-simple-shapes/ray-box-intersection
 */ 
function testBounds(terrain, ray) {
  //  An array of coordinates [x0, y0, x1, y1] which defines a line segment
  // rect points are A, B, C, D clockwise from upper left
  const A = {x: terrain.x, y: terrain.y};
  const B = {x: terrain.x + terrain.width, terrain.y};
  const C = {x: B.x, terrain.y + terrain.height};
  const D = {x: terrain.x, y: C.y};
  
  
  // top 
  if(ray.intersectSegment([A.x, A.y, B.x, B.y])) return true;
  
  // right
  if(ray.intersectSegment([B.x, B.y, C.x, C.y])) return true;
  
  // bottom
  if(ray.intersectSegment([C.x, C.y, D.x, D.y])) return true;
  
  // left
  if(ray.intersectSegment([Dx, D.y, A.x, A.y])) return true;
  
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