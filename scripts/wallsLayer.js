import { log, MODULE_ID, FORCE_TOKEN_VISION_DEBUG, FORCE_FOV_DEBUG } from "./module.js";

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

y: 1705.6773472099756

radius: 630
options:
  angle: 360

  rotation: 30

  type: "sight"

  unrestricted: false

return:
fov:
closeStroke: true

points: Array(188) [ 1963.8998795229877, 1639.8244153513538, 1974.2156851427021, … ]

radius: 630

type: 0

x: 2590.448673605

y: 1705.6773472099756

los:
closeStroke: true

points: Array(188) [ 839.9999999999998, 1521.6977779989038, 840, … ]

radius: 3101.573720446954

type: 0

x: 2590.448673605

y: 1705.6773472099756

rays (Array):

0: Object { _angle: -3.036872898470133, _distance: 3101.573720446954, y0: 1705.6773472099756, … }

A: Object { x: 2590.448673605, y: 1705.6773472099756 }

B: Object { x: -494.13430147833196, y: 1381.474612500316 }

_angle: -3.036872898470133

_c: Object { x: 839.9999999999998, y: 1521.6977779989038, t0: 0.5674830885551752, … }

_cs: Map { 55051762 → {…} }

_distance: 3101.573720446954

dx: -3084.582975083332

dy: -324.2027347096596

fov: Object { x: 1963.8998795229877, y: 1639.8244153513538 }

los: Object { x: 839.9999999999998, y: 1521.6977779989038, t0: 0.5674830885551752, … }

slope: 0.10510423526567673

x0: 2590.448673605

y0: 1705.6773472099756

<prototype>: Object { … }

1: Object { _angle: -2.9321531433504737, _distance: 3101.573720446954, y0: 1705.6773472099756, … } ...


*/

/*
   * @param {Point} origin            An point with coordinates x and y representing the origin of the test
   * @param {number} radius           A distance in canvas pixels which reflects the visible range
   * @param {object} [options={}]     Additional options which modify the sight computation
   * @param {string} [options.type=sight]     The type of polygon being computed: "movement", "sight", or "sound"
   * @param {number} [options.angle=360]      An optional limited angle of emission with which to restrict polygons
   * @param {number} [options.density=6]      The desired radial density of emission for rays, in degrees
   * @param {number} [options.rotation=0]     The current angle of rotation, used when the angle is limited
   * @param {boolean} [options.unrestricted=false]  Compute sight that is fully unrestricted by walls
*/
// fov is restricted by radius; lov is not

// https://htmlcolorcodes.com/
// t# is lesser tints
const COLORS = {
  orange: 0xFFA500,
  oranget1: 0xFFB733,
  oranget2: 0xFFC55C,
  yellow: 0xFFFF00,
  greenyellow: 0xADFF2F,
  blue: 0x0000FF,
  red: 0xFF0000
}

export function evComputePolygon(wrapped,
                                 origin,
                                 radius,
                                 { type="sight",
                                   angle=360,
                                   density=6,
                                   rotation=0,
                                   unrestricted=false }={}) {
  const res = wrapped(origin, radius, { type: type,
                                        angle: angle,
                                        density: density,
                                        rotation: rotation,
                                        unrestricted: unrestricted })
  log("evComputePolygon", origin, radius, { type: type,
                                        angle: angle,
                                        density: density,
                                        rotation: rotation,
                                        unrestricted: unrestricted }, res);

  if(type !== "sight") return res;

  const isDebuggingVision = FORCE_FOV_DEBUG;
  const debug = isDebuggingVision ? canvas.controls.debug : undefined;
  //const isDebuggingVision = CONFIG.debug.sightRays;
  if(FORCE_FOV_DEBUG || FORCE_TOKEN_VISION_DEBUG) debug.clear();

  if(isDebuggingVision) {
    debug.lineStyle(1, COLORS.yellow).drawShape(res.fov);
    debug.lineStyle(1, COLORS.greenyellow).drawShape(res.los);
  }

  /* Plan:
Cannot easily cutout fov or los with shadows, because it will create holes
that the PIXI system does not understand.

Instead, build a shadows layer with polygons representing the shadows created
by terrain or non-infinite walls.
  */
  const terrain_layer = canvas.layers.filter(l => l?.options?.objectClass?.name === "Terrain")[0];
  if(!terrain_layer) return res;
  let terrains = terrain_layer.placeables; // array of terrains
  if(terrains.length === 0) return res;

  // construct terrain segments, which are used for the filter and elsewhere
  // only need to do once per terrain
  // can we do this with forEach?
  // https://flaviocopes.com/javascript-async-await-array-map/
  // https://stackoverflow.com/questions/47227550/using-await-inside-non-async-function
  // https://stackoverflow.com/questions/37576685/using-async-await-with-a-foreach-loop
  // (async () => {
//     await Promise.all(terrains.map(async (t) => {
//       if(!t.document.getFlag(MODULE_ID, "segments")) {
//         await t.document.setFlag(MODULE_ID, "segments", GetPolygonSegments(t.data));
//       }
//     }));
//   }) ();

  // check if the terrains are within the LOS
  terrains = terrains.filter(t => {
    const segments = getTerrainSegments(t);
  
    for(let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if(RayInsidePolygon(segments[i], res.los)) return true;          
      if(RayIntersectsPolygon(segments[i], res.los)) return true;
    }
    return false;
  });

  log(`computePolygon found ${terrains.length} terrains.`, terrains);
  log(`terrain segments for terrain 1`, getTerrainSegments(terrains[1]));
  
  // distance types are specific to the origin point and terrain, so keep separate; no flag
  const terrains_distance_types = terrains.map(t => {
    const segments = getTerrainSegments(t);
    const dist_types = CharacterizePolygonDistance(origin, segments);
    return dist_types;
  });
  
  log(`${terrains_distance_types.length} terrains_distance_types`, terrains_distance_types);
  
  if(isDebuggingVision) {
    terrains.forEach((t, t_idx) => {
/*
 Simple version:
       
      const translated_shape_points = t.shape.points.map((p, idx) => {
        if(idx % 2 === 0) return p + t.data.x; // even, so x
        return p + t.data.y;
      });
      
      debug.lineStyle(1, 0xFF8C00).drawPolygon(translated_shape_points);
*/

/* To draw from a polygon shape:
       
      const translated_poly = new PIXI.Polygon(translated_shape_points);
      debug.lineStyle(1, 0xFF8C00).drawShape(translated_poly);
*/
    // version that draws different-colored sides:
      const segments = getTerrainSegments(t);
      const dist_types = terrains_distance_types[t_idx];
      segments.forEach((s, s_idx) => {
        const color = dist_types[s_idx] === "far" ? COLORS.orange : COLORS.red;
        debug.lineStyle(1, color).moveTo(s.A.x, s.A.y).lineTo(s.B.x, s.B.y);

      });
    });
  }

  // for each terrain, draw rays from the vision point to terrain points
  // if Ve < Te, use the closest segments; segment acts as wall to vision
  // if Ve > Te, use the farthest segments; segment shadows lower elevation beyond
  // if Ve === Te, can see the terrain at that elevation but nothing lower
  // closest = ray VT0 and VT1 do not intersect other segments in T
  // farthest = ray VT0 or VT1 do intersect other segments in T


  return res;
}


/**
 * Construct a set of line segments based on polygon points array
 * @param {Object} Polygon to check, with {x, y, points} where points
 *    are in [[x0,y0], [x1,y1],...] format.
 * @return {Array} Array of Rays corresponding to polygon segments.
 */
function GetPolygonSegments(poly) {
  const poly_segments = [];
  for(let i = 0; i < (poly.points.length - 1); i++) {
    const poly_segment = new Ray({ x: poly.x + poly.points[i][0],
                                   y: poly.y + poly.points[i][1] },
                                 { x: poly.x + poly.points[i + 1][0],
                                   y: poly.y + poly.points[i + 1][1] });
   poly_segments.push(poly_segment);
  }
  
  return poly_segments;
}

/**
 * Test if each segment of a polygon is close or far
 * @param {Point} Vision point to use
 * @param {Array[Rays]} segments of the polygon, as an Array of Rays
 * @return [Array] Characterized segments, in order of the points
 */
function CharacterizePolygonDistance(vision_point, segments) {
  const segment_types = Array(segments.length).fill("close");
  for(let i = 0; i < segments.length; i++) {
    const ray_A = new Ray(vision_point, segments[i].A);
    const ray_B = new Ray(vision_point, segments[i].B);

    // if either of the rays intersect any other poly segment, the segment is far
    for(let j = 0; j < segments.length; j++) {
      if(i === j) continue; // don't need to test against itself

      // don't test adjacent segments 
      // so if the segment tested shares an endpoint with ray_A.B, don't test ray_A for that segment
      if(!PointEndsSegment(ray_A.B, segments[j])) {
        if(ray_A.intersectSegment([segments[j].A.x, segments[j].A.y,
                                   segments[j].B.x, segments[j].B.y])) {
          segment_types[i] = "far";
          break;
        }
      }

      if(!PointEndsSegment(ray_B.B, segments[j])) {
        if(ray_B.intersectSegment([segments[j].A.x, segments[j].A.y,
                                   segments[j].B.x, segments[j].B.y])) {
          segment_types[i] = "far";
          break;
        }
      }
    }
  }

  return segment_types;
}


/*  
 * Helper function to check if point is at either end of segment
 * @param {Point} p Point as {x, y}
 * @param {Ray} segment Segment ray as {A: {x, y}, B: {x, y}}
 * @return true if the point matches an endpoint of the segment
 */
function PointEndsSegment(p, segment) {
  return (p.x === segment.A.x && p.y === segment.A.y) ||
         (p.x === segment.B.x && p.y === segment.B.y);
}

/**
 * Get the segments of the terrain as an array of Rays
 * Cache the segments in the terrain flag
 */
function getTerrainSegments(t) {
  // for debugging, clear the segments
  //(async () => { await t.document.unsetFlag(MODULE_ID, "segments"); }) ();

  //let segments = t.document.getFlag(MODULE_ID, "segments");
  
  //if(!segments) {
    let segments = GetPolygonSegments(t.data);
    //(async () => { await t.document.setFlag(MODULE_ID, "segments", segments); }) ();
    
  //} else {
    // convert to Ray class
    //segments = segments.map(s => {
    //  return new Ray(s.A, s.B);
    //});
  //}
  return segments;
}

/*
// test drawing polygon
let debug = canvas.controls.debug;
const terrain_layer = canvas.layers.filter(l => l?.options?.objectClass?.name === "Terrain")[0];
let t = terrain_layer.placeables[0];
debug.lineStyle(1, 0xFF8C00).drawPolygon(t.data.points);

// works but wrong spot
debug.lineStyle(1, 0xFF8C00).drawShape(t.shape)
// t.shape is array of numbers [x0, y0, x1, y1, ...]
// t.data.points is array of arrays: [[x0, y0], [x1, y1], ...]

// does not work
debug.lineStyle(1, 0xFF8C00).moveTo(t.data.x, t.data.y).drawShape(t.shape)

// map the x, y shape array
let translated_shape_points = t.shape.points.map((p, idx) => {
  if(idx % 2 === 0) return p + t.data.x; // even, so x
  return p + t.data.y;
});
let translated_p = new PIXI.Polygon(translated_shape_points);
debug.lineStyle(1, 0xFF8C00).drawShape(translated_p);

// or
debug.lineStyle(1, 0xFF8C00).drawPolygon(translated_shape_points);
*/


/**
 * Test if ray is partially or totally inside polygon
 * @param {Ray} Segment ray to check
 * @param {PIXI.Polygon} Polygon to check
 * @return {boolean} true if ray is inside polygon
 */
function RayInsidePolygon(ray, poly) {
   if(poly.contains(ray.A.x, ray.A.y)) return true;
   if(poly.contains(ray.B.x, ray.B.y)) return true;
   return false;
}

/**
 * Test if a ray intersects a polygon
 * @param {Ray} Segment ray to check
 * @param {PIXI.Polygon} Polygon to check
 * @return {boolean} true if ray intersects the polygon.
 */
function RayIntersectsPolygon(ray, poly) {
  // TO-DO: Shortcuts? Sort by closest in some fashion?
  for(let i = 0; i < (poly.points.length - 2); i++) {
    const poly_segment = { A: { x: poly.x + poly.points[i][0],
                                y: poly.y + poly.points[i][1] },
                           B: { x: poly.x + poly.points[i + 1][0],
                                y: poly.y + poly.points[i + 1][1] }};

    if(ray.intersectSegment([poly_segment.A.x, poly_segment.A.y,
                             poly_segment.B.x, poly_segment.B.y])) return true;
  }

  return false;
}



/**
 * An extension of the base PIXI.Polygon representing shadow cast by a wall.
 * @param {Segment} wall            Segment of wall or terrain that casts the shadow.
 * @param {Number} base_elevation   Elevation of the ground covered by the shadow.
 * @param {Point} vision_point      Point from which the observer is viewing the wall.
 * @param {Number} vision_elevation Elevation of the observer.
 * @param {Array} ...points         Array of points of the polygon
 */
class Shadow extends PIXI.Polygon {
  constructor(origin_wall, base_elevation, vision_point, vision_elevation, ...points) {
    super(...points);
    this.origin_wall = origin_wall;
    this.base_elevation = base_elevation
    this.vision_point = vision_point;
    this.vision_elevation = vision_elevation;
  }

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

A: Object { x: 2590.448673605, y: 1750.89734721 }

B: Object { x: -519.0931903894461, y: 2077.723366851742 }

_angle: 3.0368728984701328

_c: Object { x: 840, y: 1934.876916421071, t0: 0.5629281579622838, … }

_cs: Map { 55052175 → {…} }

_distance: 3126.670089895785

dx: -3109.541863994446

dy: 326.82601964174205

fov: Object { x: 1963.8998795229877, y: 1816.7502790686215 }
  x: 1963.8998795229877

 y: 1816.7502790686215

los: Object { x: 840, y: 1934.876916421071, t0: 0.5629281579622838, … }
  t0: 0.5629281579622838

  t1: 0.6137843376879781

  type: 1

  x: 840

  y: 1934.876916421071

slope: -0.10510423526567636

x0: 2590.448673605

y0: 1750.89734721

Wall:
_bounds: Object { minX: Infinity, minY: Infinity, updateID: -1, … }

_boundsID: 42

_boundsRect: null

_controlled: false

_destroyed: false

_enabledFilters: null

_events: Object {  }

_eventsCount: 0

_hover: false

_lastSortedIndex: 11

_localBounds: null

_localBoundsRect: null

_mask: null

_zIndex: 0

alpha: 1

children: Array [ {…}, {…} ]

controlIcon: null

data: Object { _id: "mRMKbdplB6WeyuTE", move: 1, sense: 1, … }
- flags:

directionIcon: null

document: Object { apps: {}, _sheet: null, _object: {…}, … }

doorControl: null

endpoints: Object { _eventsCount: 3, alpha: 1, visible: true, … }

filterArea: null

filters: null

isMask: false

isSprite: false

line: Object { _eventsCount: 2, alpha: 1, visible: true, … }

mouseInteractionManager: Object { state: 0, dragTime: 0, _dragThrottleMS: 17, … }

parent: Object { _eventsCount: 0, alpha: 1, visible: false, … }

renderable: true

roof: undefined

scene: Object { dimensions: {…}, apps: {}, _view: true, … }

sortDirty: true

sortableChildren: false

tempDisplayObjectParent: null

transform: Object { _rotation: 0, _cx: 1, _sx: 0, … }

visible: true

vision: Object { fov: undefined, los: undefined }

worldAlpha: 1


*/
export function evTestWall(wrapped, ...args) {
  const res = wrapped(...args)
  //log("evTestWall", ...args, res);
  return res;
}

