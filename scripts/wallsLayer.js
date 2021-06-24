import { log, MODULE_ID, FORCE_TOKEN_VISION_DEBUG, FORCE_FOV_DEBUG } from "./module.js";
import { COLORS, TerrainElevationAtPoint, TokenElevationAtPoint } from "./utility.js";
import { TerrainPolygon } from "./TerrainPolygon_class.js";
import { orient2d } from "./lib/orient2d.min.js";

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
  log("evComputePolygon this", this);                                       

  if(type !== "sight") return res;
  
  log("orient2d lib test:", orient2d.toString(), orient2d(10,10, 20,20, 25,20));

  const isDebuggingVision = FORCE_FOV_DEBUG;
  const debug = isDebuggingVision ? canvas.controls.debug : undefined;
  //const isDebuggingVision = CONFIG.debug.sightRays;
  if(FORCE_FOV_DEBUG || FORCE_TOKEN_VISION_DEBUG) debug.clear();

  // Transform los and fov
  const los_polygon = TerrainPolygon.fromObject(res.los);
  const fov_polygon = TerrainPolygon.fromObject(res.fov);
  
  if(isDebuggingVision) {
    los_polygon.draw(COLORS.greenyellow);
    fov_polygon.draw(COLORS.yellow);
  }

  /* Plan:
Cannot easily cutout fov or los with shadows, because it will create holes
that the PIXI system does not easily understand.

Instead, build a shadows layer with polygons representing the shadows created
by terrain or non-infinite walls.
  */
  
  // Get the terrains and transform into more usable polygon representations
  const terrain_layer = canvas.layers.filter(l => l?.options?.objectClass?.name === "Terrain")[0];
  if(!terrain_layer) return res;
  let terrains = terrain_layer.placeables; // array of terrains
  if(terrains.length === 0) return res;
  log(`${terrains.length} terrains`, terrains);

  let terrain_polygons = terrains.map(t => {
    return TerrainPolygon.fromObject(t.data);
  });
  log(`Transformed ${terrain_polygons.length} terrains`, terrain_polygons);
  
  
  // check if the terrains are within the LOS
  terrain_polygons = terrain_polygons.filter(t => {
    return t.intersectsPolygon(los_polygon);
  });
  
  // distance types are specific to the origin point and terrain, so keep separate; no flag
  // for each terrain, draw rays from the vision point to terrain points
  // if the ray intersects another segment of the same terrain polygon, the terrain point
  //   is far; otherwise it is near.
  terrain_polygons.forEach(t => {
    t.characterizeSegmentDistance(origin);
    log(`${t.segment_distance_types.length} terrains_distance_types`, t.segment_distance_types);
  })
    
  if(isDebuggingVision) {
    terrain_polygons.forEach((t, t_idx) => {
      t.drawFarNearSegments();
    });
  }

  // for each terrain, construct polygons representing areas shaded by the polygon
  // Ve = elevation at the vision point
  // Te = elevation of the terrain
  // if Ve < Te, use the nearest segments; segment acts as wall to vision
  // if Ve > Te, use the farthest segments; segment shadows lower elevation beyond
  // if Ve === Te, can see the terrain at that elevation but nothing lower
  // closest = ray VT0 and VT1 do not intersect other segments in T
  // farthest = ray VT0 or VT1 do intersect other segments in T
  // return polygons representing shaded (non-visible) areas
  
  // for the moment, infer Ve based on controlled tokens
  // TO-DO: may move this whole process into sightLayer to more easily get at the correct vision object
  let Ve = TokenElevationAtPoint(origin); 
  if(!Ve) Ve = TerrainElevationAtPoint(origin);
  log(`TokenElevation: ${TokenElevationAtPoint(origin)}; TerrainElevation: ${TerrainElevationAtPoint(origin)}`);
    
  terrain_polygons.forEach(t => {
    t.vision_elevation = Ve;
  });
  
  // create a Map of terrain polygons to use for constructing shadows
  // avoids using terrains that were previously filtered out
  const terrain_polygons_map = new Map();
  terrain_polygons.forEach(t => {
    terrain_polygons_map.set(t.originating_id, t);
  });
  
  terrain_polygons.forEach(t => {
    t.other_terrains = terrain_polygons_map;
  });
  
  // for each polygon, draw the shadow as a filled gray area
  terrain_polygons.forEach(t => {
    const shadows = t.shadows;
    log("Terrain shadows", shadows);
    
    shadows.forEach(s => {
      //if(s.near) s.near.draw();
      //if(s.e0_shadow) s.e0_shadow.draw()
      /*
      if(s.terrain_shadows) {
        // terrain_shadows are a Map
        s.terrain_shadows.forEach(s_t => {
          // array of shadows, one for each affected segment of the terrain
          s_t.forEach(shadow => {
            shadow.draw();
          });
        });
      }*/
    });
  
  });
  
  return res;
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
   * Test a single Ray against a single Wall
   * @param {Ray} ray                 The Ray being tested
   * @param {Wall} wall               The Wall against which to test
   * @return {RayIntersection|null}   A RayIntersection if a collision occurred, or null
   */
// Called *a lot*
export function evTestWall(wrapped, ...args) {
  const res = wrapped(...args)
  //log("evTestWall", ...args, res);
  return res;
}

