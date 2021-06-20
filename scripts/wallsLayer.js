import { log, MODULE_ID } from "./module.js";

/*
Clicking token:
1. computePolygon
2. testVisibility
3. sightRefresh
4. restrictVisibility

Move token 1 square:
1. computePolygon
2. computePolygon
3. testVisiblity
4. sightRefresh
5. restrictVisibility
6. computePolygon
7. testVisibility
8. sightRefresh
9. restrictVisibility
*/

/* -------------------------------------------- */
  /*  Source Polygon Computation                  */
  /* -------------------------------------------- */

  /**
   * Compute source polygons of a requested type for a given origin position and maximum radius.
   * This method returns two polygons, one which is unrestricted by the provided radius, and one that is constrained
   * by the maximum radius.
   *
   * @param {Point} origin            An point with coordinates x and y representing the origin of the test
   * @param {number} radius           A distance in canvas pixels which reflects the visible range
   * @param {object} [options={}]     Additional options which modify the sight computation
   * @param {string} [options.type=sight]     The type of polygon being computed: "movement", "sight", or "sound"
   * @param {number} [options.angle=360]      An optional limited angle of emission with which to restrict polygons
   * @param {number} [options.density=6]      The desired radial density of emission for rays, in degrees
   * @param {number} [options.rotation=0]     The current angle of rotation, used when the angle is limited
   * @param {boolean} [options.unrestricted=false]  Compute sight that is fully unrestricted by walls
   *
   * @returns {{rays: Ray[], los: PIXI.Polygon, fov: PIXI.Polygon}}   The computed rays and polygons
   */
/*
origin:
x: 2590.448673605
​
y: 1705.6773472099756

radius: 630
options:
  angle: 360
​
  rotation: 30
​
  type: "sight"
​
  unrestricted: false

return: 
fov: 
closeStroke: true
​​
points: Array(188) [ 1963.8998795229877, 1639.8244153513538, 1974.2156851427021, … ]
​​
radius: 630
​​
type: 0
​​
x: 2590.448673605
​​
y: 1705.6773472099756

los:
closeStroke: true
​​
points: Array(188) [ 839.9999999999998, 1521.6977779989038, 840, … ]
​​
radius: 3101.573720446954
​​
type: 0
​​
x: 2590.448673605
​​
y: 1705.6773472099756

rays (Array):
​
0: Object { _angle: -3.036872898470133, _distance: 3101.573720446954, y0: 1705.6773472099756, … }
​​​
A: Object { x: 2590.448673605, y: 1705.6773472099756 }
​​​
B: Object { x: -494.13430147833196, y: 1381.474612500316 }
​​​
_angle: -3.036872898470133
​​​
_c: Object { x: 839.9999999999998, y: 1521.6977779989038, t0: 0.5674830885551752, … }
​​​
_cs: Map { 55051762 → {…} }
​​​
_distance: 3101.573720446954
​​​
dx: -3084.582975083332
​​​
dy: -324.2027347096596
​​​
fov: Object { x: 1963.8998795229877, y: 1639.8244153513538 }
​​​
los: Object { x: 839.9999999999998, y: 1521.6977779989038, t0: 0.5674830885551752, … }
​​​
slope: 0.10510423526567673
​​​
x0: 2590.448673605
​​​
y0: 1705.6773472099756
​​​
<prototype>: Object { … }
​​
1: Object { _angle: -2.9321531433504737, _distance: 3101.573720446954, y0: 1705.6773472099756, … } ...


*/
export function evComputePolygon(wrapped, ...args) {
  const res = wrapped(...args)
  log("evComputePolygon", ...args, res);
  
  const isDebuggingVision = CONFIG.debug.sightRays;
  if(isDebuggingVision) {
    const debug = canvas.controls.debug;
    debug.clear();
  }
  return res;
}

 /**
   * Test a single Ray against a single Wall
   * @param {Ray} ray                 The Ray being tested
   * @param {Wall} wall               The Wall against which to test
   * @return {RayIntersection|null}   A RayIntersection if a collision occurred, or null
   */
   
/*
Called *a lot*

Ray:
​
A: Object { x: 2590.448673605, y: 1750.89734721 }
​
B: Object { x: -519.0931903894461, y: 2077.723366851742 }
​
_angle: 3.0368728984701328
​
_c: Object { x: 840, y: 1934.876916421071, t0: 0.5629281579622838, … }
​
_cs: Map { 55052175 → {…} }
​
_distance: 3126.670089895785
​
dx: -3109.541863994446
​
dy: 326.82601964174205
​
fov: Object { x: 1963.8998795229877, y: 1816.7502790686215 }
  x: 1963.8998795229877
​​
 y: 1816.7502790686215
​
los: Object { x: 840, y: 1934.876916421071, t0: 0.5629281579622838, … }
  t0: 0.5629281579622838
​​
  t1: 0.6137843376879781
​​
  type: 1
​​
  x: 840
​​
  y: 1934.876916421071
​
slope: -0.10510423526567636
​
x0: 2590.448673605
​
y0: 1750.89734721

Wall:
_bounds: Object { minX: Infinity, minY: Infinity, updateID: -1, … }
​
_boundsID: 42
​
_boundsRect: null
​
_controlled: false
​
_destroyed: false
​
_enabledFilters: null
​
_events: Object {  }
​
_eventsCount: 0
​
_hover: false
​
_lastSortedIndex: 11
​
_localBounds: null
​
_localBoundsRect: null
​
_mask: null
​
_zIndex: 0
​
alpha: 1
​
children: Array [ {…}, {…} ]
​
controlIcon: null
​
data: Object { _id: "mRMKbdplB6WeyuTE", move: 1, sense: 1, … }
- flags: 
​
directionIcon: null
​
document: Object { apps: {}, _sheet: null, _object: {…}, … }
​
doorControl: null
​
endpoints: Object { _eventsCount: 3, alpha: 1, visible: true, … }
​
filterArea: null
​
filters: null
​
isMask: false
​
isSprite: false
​
line: Object { _eventsCount: 2, alpha: 1, visible: true, … }
​
mouseInteractionManager: Object { state: 0, dragTime: 0, _dragThrottleMS: 17, … }
​
parent: Object { _eventsCount: 0, alpha: 1, visible: false, … }
​
renderable: true
​
roof: undefined
​
scene: Object { dimensions: {…}, apps: {}, _view: true, … }
​
sortDirty: true
​
sortableChildren: false
​
tempDisplayObjectParent: null
​
transform: Object { _rotation: 0, _cx: 1, _sx: 0, … }
​
visible: true
​
vision: Object { fov: undefined, los: undefined }
​
worldAlpha: 1


*/   
export function evTestWall(wrapped, ...args) {
  const res = wrapped(...args)
  //log("evTestWall", ...args, res);  
  return res;
}

