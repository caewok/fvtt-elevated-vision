import { log, MODULE_ID, FORCE_TOKEN_VISION_DEBUG, FORCE_FOV_DEBUG } from "./module.js";
import { COLORS, TerrainElevationAtPoint, TokenElevationAtPoint, orient2drounded } from "./utility.js";
import { TerrainPolygon } from "./TerrainPolygon_class.js";

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
  
  // -------------- TESTING: DRAW LOS & FOV --------------------------------------------//
  // Transform los and fov. Just for testing for now.
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
  
  const sorted_vertices = vertices.sort((a, b) => {
    return orient2drounded(origin.x, origin.y, 
                a.x, a.y,
                b.x, b.y);
  });
  
  log(`evComputePolygon: ${sorted_vertices.length} sorted vertices`, sorted_vertices);
  
  //--------------- SWEEP LEFT-TO-RIGHT VISION TEST ------------------------------------//
  // See https://www.redblobgames.com/articles/visibility/ for basic algorithm
  // Trickier than a normal vision sweep
  // Ve = elevation at the vision point
  // Te = elevation of the terrain
  // if Ve < Te, use the nearest segments; segment acts as wall to vision
  // if Ve >= Te, use the farthest segments; segment shadows lower elevation beyond
  //   (Note: default Foundry setup is that if Ve === Te, vision unblocked)
  // If V is within a T polygon & V >= Te, then the nearest segments shadow
  // So choices for segments are: "block", "shadow", "ignore"
  // Segments are also "near" or "far" depending on whether they are blocked by another
  //   within the same polygon. Near segments either "block" or "ignore" depending on Ve
  // TO-DO: Shadows should only cover terrain/map with elevation <= 
  //   shadow-causing segment elevation
  
  const walls = new Map();
  let closest_blocking = undefined;
  
  // maximum distance we might need to extend a Ray
  const MAX_DISTANCE = new Ray({ x: 0, y: 0 }, 
                               { x: canvas.dimensions.sceneWidth, 
                                 y: canvas.dimensions.sceneHeight }).distance;
  
  sorted_vertices.forEach(vertex => {
    // add segments that have this point if not already added
    // remove segments that have this point that were added previously
    vertex.segments.forEach(s => {
      if(!walls.has(s.id)) {
        walls.set(s.id, s);
      } else {
        walls.delete(s.id);
      }
    });
    
    log(`evComputePolygon sweep test: walls`, walls);
    const new_closest_blocking = closestBlockingSegmentToPoint(walls, origin, Ve) || closest_blocking;
    
    if(!closest_blocking) closest_blocking = new_closest_blocking; // 
    if(!new_closest_blocking) return; // nothing blocks; go to next vertex
    if(new_closest.id === closest.id) return; // nothing changed; go to next vertex
       
    // we have switched the closest wall segment
    // mark prior segment, which was blocking up until now
    
    // If the current vertex is at the end of the closest, then simply mark the closest as blocking.
    if(closest_blocking.hasEndpoint(vertex)) {
      // may or may not have been split earlier
      closest_blocking.mergePropertyAtSplit(vertex, { vision_type: "block" });
    } else {
      // If the current vertex is not at the end of the closest, then need to split.
      // Mark the prior portion as blocking
      // Locate the intersection: vision --> vertex (new_closest) --> closest
      const rayVS = new Ray(origin, vertex);
      const rayVS_extended = new Ray(origin, rayVS.project(MAX_DISTANCE));
      const intersection = rayV_extended.intersectSegment([ closest_blocking.A.x, 
                                                            closest_blocking.A.y,
                                                            closest_blocking.B.x,
                                                            closest_blocking.B.y ]);                               
      
      closest_blocking.splitAt(intersection);
      
      // move the 
      closest_blocking.mergePropertyAtSplit(intersection, { vision_type: "block" });
    }
    
    // If we have moved to the middle of the new closest segment, then need to split
    if(!new_closest_blocking.hasEndpoint(vertex)) {
      // Locate the intersection: vision --> vertex --> new_closest 
      const rayVS = new Ray(origin, vertex);
      const rayVS_extended = new Ray(origin, rayVS.project(MAX_DISTANCE));
      const intersection = rayV_extended.intersectSegment([ new_closest_blocking.A.x, 
                                                            new_closest_blocking.A.y,
                                                            new_closest_blocking.B.x,
                                                            new_closest_blocking.B.y ]); 
    
      new_closest_blocking.splitAt(intersection);
    }
    
    
    
    closest_blocking = new_closest_blocking;
  }); // sorted_vertices.forEach
  
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
    log(`Reducing walls: acc, current`, acc, current);
    if(Ve && current.elevation <= Ve) return acc; // current doesn't block
    if(acc === undefined) return current;
    if(current.inFrontOf(acc, p)) return current;
    return acc;
  }, undefined);
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

