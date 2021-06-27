import { log, MODULE_ID, FORCE_TOKEN_VISION_DEBUG, FORCE_FOV_DEBUG } from "./module.js";
import { COLORS, TerrainElevationAtPoint, TokenElevationAtPoint, toGridDistance } from "./utility.js";
import { TerrainPolygon } from "./TerrainPolygon_class.js";
import { RadialSweep } from "./RadialSweep_class.js";

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
// fov is restricted by radius; los is not

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

  const isDebuggingVision = FORCE_TOKEN_VISION_DEBUG;  
  
  // -------------- TESTING: DRAW LOS & FOV --------------------------------------------//
  // Transform los and fov. Just for testing for now.
  const los_polygon = TerrainPolygon.fromObject(res.los);
  const fov_polygon = TerrainPolygon.fromObject(res.fov);
  
  if(isDebuggingVision) {
    canvas.controls.debug.clear();
    log(`evComputePolygon drawing los, fov`, los_polygon, fov_polygon);
    los_polygon.draw(COLORS.greenyellow);
    fov_polygon.draw(COLORS.yellow);
  }

  // return res;
  
 /* Plan:
Cannot easily cutout fov or los with shadows, because it will create holes
that the PIXI system does not easily understand.

Instead, build a shadows layer with polygons representing the shadows created
by terrain or non-infinite walls.

For the moment, just draw where we would expect shadows

Issue: computePolygon does not appear to pass the elevation for the origin.
Solution: For the moment, infer it using origin position.

Long-Term Solution: Possibly move this code elsewhere. Likely candidates?
1. updateSource method in PlaceableObject or classes inheriting from PlaceableObject.
- updateSource calls canvas.walls.computePolygon. 
  Could do something similar to calculate shadows.
  Also sets vision.los and vision.fov for the object; could add vision.shadows
- ??
  */
  
  //--------------- SET UP TERRAIN POLYGONS --------------------------------------------//
  
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
  
  // draw the polygons if debugging 
//   if(isDebuggingVision) {
//      terrain_polygons.forEach(t => {
//       t.draw();
//     });
//   }
  
  //--------------- INFER ELEVATION FOR ORIGIN -----------------------------------------//
   // for the moment, infer Ve based on controlled tokens
  // TO-DO: may move this whole process into sightLayer to more easily get at the correct vision object
  let Ve = TokenElevationAtPoint(origin); 
  if(!Ve) Ve = TerrainElevationAtPoint(origin);
  log(`TokenElevation: ${TokenElevationAtPoint(origin)}; TerrainElevation: ${TerrainElevationAtPoint(origin)}`);
  Ve = toGridDistance(Ve);
  // do we need this?  
  // terrain_polygons.forEach(t => {
//     t.vision_elevation = Ve;
//   });
  
  //--------------- ORDER VERTICES LEFT-TO-RIGHT ---------------------------------------//
  const vertices = [];
  terrain_polygons.forEach(t => {
    t.vertices.forEach(v => {
      vertices.push(v);
    });
  });
  
  const sorted_vertices = RadialSweep.sortVertices(origin, vertices);
  log(`evComputePolygon: ${sorted_vertices.length} sorted vertices`, sorted_vertices);
  
  //--------------- SWEEP LEFT-TO-RIGHT VISION TEST ------------------------------------//
  // See https://www.redblobgames.com/articles/visibility/ for basic algorithm
  // Trickier than a normal vision sweep
  // Ve = elevation at the vision point
  // Te = elevation of the terrain
  // if Ve < Te, nearest segments block vision (looking up at terrain segment)
  // if Ve >= Te, nearest segments do not block. (looking down at terrain segment)
  //   (Note: default Foundry setup is that if Ve === Te, vision unblocked)
  // If V is outside a T polygon, far segments shadow
  // Plus, if V is within a T polygon, then the nearest segments shadow (if not blocking)
  // Segment property labels:
  // - vision_type: "block", "shadow", "ignore"
  // - vision_distance: "near", "far"
  // TO-DO: Shadows should only cover terrain/map with elevation <= 
  //   shadow-causing segment elevation
  
 
  const radial_sweep = new RadialSweep(origin, Ve, marker = { vision_type: "block" }, true);
  sorted_vertices.forEach(vertex => {
    radial_sweep.nextVertex(vertex);
  }
  radial_sweep.complete();
  
  // For each Terrain Polygon, do a radial sweep to mark near / far segments relative
  //   to vision point. 
  // Is this sweep better done within the polygon class?   
  
  log(`evComputePolygon sweep test: after test`, sorted_vertices);
  
  if(isDebuggingVision) {
    terrain_polygons.forEach(t => {
      t.draw();
    });
  }
  
  
  
  /*
  terrain_polygons.forEach(t => {
    t.characterizeSegmentDistance(origin);
    log(`${t.segment_distance_types.length} terrains_distance_types`, t.segment_distance_types);
  })
    
  if(isDebuggingVision) {
    terrain_polygons.forEach((t, t_idx) => {
      t.drawFarNearSegments();
    });
  }
  */
  
  
  
  
  // create a Map of terrain polygons to use for constructing shadows
  // avoids using terrains that were previously filtered out
  /*
  const terrain_polygons_map = new Map();
  terrain_polygons.forEach(t => {
    terrain_polygons_map.set(t.originating_id, t);
  });
  
  terrain_polygons.forEach(t => {
    t.other_terrains = terrain_polygons_map;
  });
  */
  // for each polygon, draw the shadow as a filled gray area
  /*
  terrain_polygons.forEach(t => {
    const shadows = t.shadows;
    log("Terrain shadows", shadows);
    
    shadows.forEach(s => {
      //if(s.near) s.near.draw();
      //if(s.e0_shadow) s.e0_shadow.draw()
      
      if(s.terrain_shadows) {
        // terrain_shadows are a Map
        s.terrain_shadows.forEach(s_t => {
          // array of shadows, one for each affected segment of the terrain
          s_t.forEach(shadow => {
            shadow.draw();
          });
        });
      }
    });
  
  });
  */
  
  
  return res;   
                              
}


/*
 * Determine the closest blocking segment to an elevated vision point.
 * To determine the closest segment w/o/r/t elevation, leave Ve undefined.
 * @param {Array[Segments]} segments  Segments to test against the point.
 * @param {PIXI.Point} p              Point in {x,y} format to test.
 * @param {Number} Ve                 Elevation of p.
 * @return {Segment} Closest blocking segment or undefined if none
 */
function closestBlockingSegmentToPoint(segments, p, Ve) {
  return [...segments].reduce((acc, [key, current]) => {
    // [...walls] will break the Map into [0] id and [1] object
    //log(`Reducing walls: acc, current`, acc, current);
    //log(`closestBlockingSegmentToPoint: Segment ${current.id} has elevation ${current.properties.elevation} compared to ${Ve}`, current);
    if(Ve && current.properties.elevation <= Ve) return acc; // current doesn't block
    if(acc === undefined) return current;
    if(current.inFrontOf(acc, p)) return current;
    return acc;
  }, undefined);
}


/*
 * Compare the new closest segment with the previous closest segment.
 * Mark the frontmost segment or segment portion with the property.
 * @param {Segmnent} current    The new closest segment.
 * @param {Segment} prior       The previous closest segment.
 * @param {Vertex} vertex       Vertex or {x, y} point we are testing.
 * @param {PIXI.Point} origin   Vision origin point in {x, y} format.
 * @param {Object} property     Property object to merge when marking the closest.
 */
function markClosest(current, prior, vertex, origin, property = {}) {
  log(`markClosest: current is ${current?.id}; prior is ${prior?.id}`, current, prior, vertex, property);   
  if(!current) return; // nothing found
  if(current.id === prior.id) return; // nothing changed
  
  
  // we have switched the closest wall segment
  // mark prior segment, which was blocking up until now
  
  // If the current vertex is at the end of the prior, then simply mark the prior.
  if(prior.hasEndpoint(vertex)) {
    // may or may not have been split earlier
    log(`markClosest: marking ${prior.id}`);
    prior.mergePropertyAtSplit(vertex, property);
  } else {
    // If the current vertex is not at the end of the closest, then may need to split.
    // Mark the prior portion as blocking
    // Locate the intersection: origin (vision) --> vertex (current) --> prior
    const rayOV = new Ray(origin, vertex);
    const rayOV_extended = new Ray(origin, rayOV.project(MAX_DISTANCE));
    const intersection = rayOV_extended.intersectSegment([ prior.A.x, 
                                                           prior.A.y,
                                                           prior.B.x,
                                                           prior.B.y ]);                               
    
    if(intersection) {
      log(`markClosest: splitting and marking ${prior.id} at ${intersection.x}, ${intersection.y}`); 
      closest_blocking.splitAt(intersection);
      closest_blocking.mergePropertyAtSplit(intersection, property);
    } else {
      // likely situation where we have jumped to another segment
      // intersection point would be the edge of the canvas or the edge of the los
      // TO-DO: is it sufficient to simply mark prior segment without splitting? 
      log(`markClosest: intersection is false when testing vertex ${vertex.id} and prior ${prior.id}`);
      
      // need the correct vertex -- the one to the right
      // if ccw, then B is to the left; otherwise B is to the right
      const v_label = prior.ccw(origin) ? "B" : "A";
      prior.mergePropertyAtSplit(prior[v_label], property);
    }
  }
  
  // If we have moved to the middle of the current segment, then need to split
  if(!current.hasEndpoint(vertex)) {
    // Locate the intersection: origin (vision) --> vertex --> current 
    const rayOV = new Ray(origin, vertex);
    const rayOV_extended = new Ray(origin, rayOV.project(MAX_DISTANCE));
    const intersection = rayOV_extended.intersectSegment([ current.A.x, 
                                                           current.A.y,
                                                           current.B.x,
                                                           current.B.y ]); 
    log(`markClosest: splitting current ${current.id} at ${intersection.x}, ${intersection.y}`); 
   
    if(intersection) {
      current.splitAt(intersection);
    } else {
      console.error(`${MODULE_ID}|markClosest: intersection is false when testing vertex ${vertex.id} and current ${current.id}`, rayOV);
      // unclear how this could happen...
    }
  }
  
  return;
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

