import { COLORS, toGridDistance } from "./utility.js";
import { Shadow } from "./Shadow_class.js";
import { log } from "./module.js";

// TO-DO: Should segments use an extended Ray class with advanced calculation methods? 

// Two types of polygons:
// 1. TerrainData: t.data, containing t.data.x, t.data.y, t.data.points, t.data.max (elevation)
// 2. fov/los: SourcePolygon, with x, y, radius, points
// TerrainData: 
//   - relative points to x, y
//   - points are [[x0, y0], [x1, y1], ...]
// SourcePolygon:
//   - uses absolute points; 
//   - the x,y are just for identifying the center point.
//   - points are like PIXI.Polygon: [x0, y0, x1, y1, ...]

/*
 * Polygon with methods to assist with measuring terrain elevation.
 * @param {Array} points          Array of points [x0, y0, x1, y1, ...]
 */
export class TerrainPolygon extends PIXI.Polygon {
  constructor(...points) {
    super(...points);
    this.elevation = 0;
    this.originating_id = "";
    this._vision_elevation = 0;
  }
  
  /**
   * A factory method to construct an TerrainPolygon from an object.
   * Object can be:
   * - inherit from PIXI.Polygon.
   * - inherit from TerrainData
   * - default: any object with points
   * @param {Object} obj          Object to use to construct the TerrainPolygon.
   * @return {TerrainPolygon}    The constructed TerrainPolygon.
   */
  static fromObject(obj) {
    // TerrainData does not appear to be exported to this scope
    // simplest answer is to just check the constructor name
    // will not work for inheritance, but should give what we need here.
    //if(obj instanceof TerrainData) {
    if(obj.constructor.name === "TerrainData") {
      // transform the points based on x,y
      const transformed_points = [];
      obj.points.forEach(p => {
        transformed_points.push(p[0] + obj.x);
        transformed_points.push(p[1] + obj.y);
      });
      
      const e = obj.max || 0;
      
      // do we need obj.width and obj.height?   
      let poly = new this(transformed_points);
      poly.elevation = e;
      poly.originating_id = obj._id;
      return poly;
      
    } else {
      return new this(obj.points);
    }
  }
  

  /**
   * The segments of the polygon as an array of Rays.
   * Computed lazily as required.
   * @type {Array}
   */
  get segments() {
    if(this._segments === undefined) this._segments = this._constructSegments();
    return this._segments; 
  }

  _constructSegments() {
    const poly_segments = [];
    for(let i = 0; i < (this.points.length - 2); i += 2) {
      const poly_segment = new Ray({ x: this.points[i],
                                     y: this.points[i + 1] },
                                   { x: this.points[i + 2],
                                     y: this.points[i + 3] });
      poly_segments.push(poly_segment);
    }
    return poly_segments;
  }
  
  /* 
   * Getter for filtering segments by near/far. Cached.
   * @type {Array} Array of Ray segments.
   */ 
  get near_segments() {
    if(this._near_segments === undefined) this._near_segments = this._filterSegmentsByType("near");
    return this._near_segments;
  }

  /* 
   * Getter for filtering segments by near/far. Cached.
   * @type {Array} Array of Ray segments.
   */ 
  get far_segments() {
    if(this._far_segments === undefined) this._far_segments = this._filterSegmentsByType("far");
    return this._far_segments;
  }

  /* 
   * Internal method for filtering segments by near/far.
   * @param {String} type Either "near" or "far" (see segment_distance)
   * @type {Array} Array of Ray segments.
   */ 
  _filterSegmentsByType(type = "near") {
    return this.segments.filter((s, idx) => {
      if(this.segment_distance_types[idx] === type) return true;
      return false;
    });
  }
  
  /**
   * Test if ray is totally inside polygon
   * @param {Ray} Segment ray to check
   * @return {boolean} true if ray is totally inside polygon
   */
  rayInside(ray) {
    return (this.contains(ray.A.x, ray.A.y) && this.contains(ray.B.x, ray.B.y));
  }
  
  /**
   * Test if ray intersects polygon
   * @param {Ray} Segment ray to check
   * @return {Obj} false if ray intersects the polygon; intersection if found
   */
   // TO-DO: Shortcuts? Sort by closest in some fashion?
  intersectsRay(ray) {
    for(let i = 0; i < this.segments; i++) {
      const segment = this.segments[i];
      const intersection = ray.intersectSegment([segment.A.x, segment.A.y,
                             segment.B.x, segment.B.y]);
      if(intersection) return intersection;
    }   
    return false;
  }
  
  /**
   * Test if another polygon intersects or is contained in another.
   * @param {TerrainPolygon} poly    An TerrainPolygon to test.
   * @param {boolean} contained_only  If true, will test only for fully contained.
   * @return {boolean} true if intersects or is contained in
   */
  intersectsPolygon(poly, contained_only = false) {
    const segments = this.segments;
    for(let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if(contained_only) {
        if(!poly.rayInside(segment)) return false;
      } else {
        if(poly.rayInside(segment)) return true;
        if(poly.intersectsRay(segment)) return true;
      } 
    }
    return contained_only; // if contained_only, is true; if includes intersection, false.
  }
  
  /* 
   * Associate a vision origin with the polygon.
   * Once set, this permits calculating various things such as labeling 
   *   segments near or far.
   * Not needed for everything, so for now throw an error if not defined first.
   * @type {Point}
   */
   get vision_origin() {
     if(this._vision_origin === undefined) console.error(`Elevated Vision: need to define vision_origin.`, this);
     return this._vision_origin;
   }
   
   /*
    * The vision origin associated with this polygon.
    * If set, will reset various cached calculations.
    * @type {Point}
    */
   set vision_origin(value) {
     if(this._vision_origin !== value) {
       // delete cached calculations
       delete this._segment_distance_types;
     }
     this._vision_origin = value;
   }
   
   /*
    * Associate a vision elevation with the polygon.
    * Once set, this permits calculating various things.
    * Not needed for everything; default to 0.
    * @type {Number}
    */
    get vision_elevation() {
       return this._vision_elevation;
    }
    
   /*
    * Set vision elevation
    * Causes deletion of certain cached calculations.
    * @param {Number} value    Elevation in game units (e.g., 5 foot grid, 40 foot of elevation)
    * @type {Point}
    */
    set vision_elevation(value) {
      value = toGridDistance(value);
      if(this._vision_elevation != value) {
        // delete cached calculations
      }
      this._vision_elevation = value;
    }

   /*
    * Associate an elevation with the polygon.
    * Once set, this permits calculating various things.
    * Not needed for everything; default to 0.
    * @type {Number}
    */
    get elevation() {
       return this._elevation;
    }
    
   /*
    * Set elevation for the polygon
    * Causes deletion of certain cached calculations.
    * @param {Number} value    Elevation in game units (e.g., 5 foot grid, 40 foot of elevation)
    * @type {Point}
    */
    set elevation(value) {
      value = toGridDistance(value);
      if(this._elevation != value) {
        // delete cached calculations
      }
      this._elevation = value;
    }
    
   /*
    * Label each segment of a polygon is near or far
    * @type {Array}
    */
   get segment_distance_types() {
     if(this._segment_distance_types === undefined) this._segment_distance_types = this._characterizeSegmentDistances();
     return this._segment_distance_types;
   }
   
   /*
    * Helper function to characterize segment distance, resetting vision origin only if necessary.
    * @param {Point} vision_origin  Origin point for the viewer.
    */
   characterizeSegmentDistance(vision_origin = this.vision_origin) {
     this.vision_origin = vision_origin;
     return this.segment_distance_types;
   }
  
   /*
    * Underlying function to determine if each polygon segment is "near" or "far" from the observer.
    * "Near": drawing a straight line from the segment endpoints to the observer does not 
    *  intersect the other segments of the polygon.
    * "Far": Opposite; drawing a straight line intersects.
    * @return {Array} Array of "near" or "far" corresponding to segments.
    */
   _characterizeSegmentDistances() {
     const distance_types = [];
     for(let i = 0; i < this.segments.length; i++) {
        const ray_A = new Ray(this.vision_origin, this.segments[i].A);
        const ray_B = new Ray(this.vision_origin, this.segments[i].B);

        // Options:
        // 1. both rays intersect some other segment: far
        // 2. segment is adjacent; the non-shared point intersects: far
        // 3. 1 of 2 rays intersect: mixed.
        // Mixed means part of the segment is far and part is near
        // Tricky, b/c at some point we need to treat the mixed segment differently.
        // Here, split it into two segments and add to the queue. 
        // Make sure to put it in the right place, as location in the points array matters.
        let d_type = "near";
        for(let j = 0; j < this.segments.length; j++) {
          if(i === j) continue; // don't need to test against itself
          
          const intersections = [];
          if(!TerrainPolygon.PointEndsSegment(ray_A.B, this.segments[j])) {
            intersections.push(ray_A.intersectSegment([this.segments[j].A.x, this.segments[j].A.y,
                                                       this.segments[j].B.x, this.segments[j].B.y]));
          }

          if(!TerrainPolygon.PointEndsSegment(ray_B.B, this.segments[j])) {
            intersections.push(ray_B.intersectSegment([this.segments[j].A.x, this.segments[j].A.y,
                                                       this.segments[j].B.x, this.segments[j].B.y]));
          }
          
          if(intersections.length === 2) {
            if(intersections[0] && intersections[1]) {
              d_type = "far";
              break; // done once intersections found? TO-DO: could we have multiple intersections, with some mixed?
            } else if(!intersections[0] && !intersections[1]) {
              // near, but need to test all the rest
              
            } else {
              d_type = "mixed";
            }
            
          } else if(intersections.length === 1) {
            d_type = intersections[0] ? "far" : "near";  
          
          } else {
            console.error(`${MODULE_ID}|_characterizeSegmentDistances: incorrect number of intersections`, intersections);
          }
          
          if(d_type === "mixed") {
            // run ray from V to the j segment and figure out where it intersects with the i segment
            const ray_Vj_A = new Ray(this.vision_origin, this.segments[j].A);
            const ray_Vj_B = new Ray(this.vision_origin, this.segments[j].B);
            
            intersection_A = ray_Vj_A.intersectSegment([this.segments[i].A.x, this.segments[i].A.y,
                                                        this.segments[i].B.x, this.segments[i].B.y]);
                                                        
            intersection_B = ray_Vj_B.intersectSegment([this.segments[i].A.x, this.segments[i].A.y,
                                                        this.segments[i].B.x, this.segments[i].B.y]);                                            
            if(intersection_A && intersection_B) {
              console.error(`${MODULE_ID}|_characterizeSegmentDistances: two mixed intersections where there should be one`, intersection_A, intersection_B);
              
            } else if(intersection_A) {
              // split the j segment along intersection A. 
              // re-do the j loop. 
              // re-do this i segment. 
              // note: we have not yet set the distance type for this i segment.
              this._splitSegment(i, intersection_A);
              i -= 1;
              break;
            
            } else if(intersection_B) {
              // split the j segment along intersection B. 
              this._splitSegment(i, intersection_B);
              i -= 1;
              break;
            
            } else {
              console.error(`${MODULE_ID}|_characterizeSegmentDistances: zero mixed intersections where there should be one`, intersection_A, intersection_B);
            }                                             
          
          } 
          
        } // for(let j = 0; j < this.segments.length; j++)
        // done with the segment, so we can now label it.
        distance_types.push(d_type);
        
      } // for(let i = 0; i < this.segments.length; i++)
      log(`_characterizeSegmentDistances`, distance_types);

      return distance_types;
   } 
   
   /*
    * Split a segment into two along a split point.
    * Change the underlying points accordingly.
    * @param {Number} segment_idx  Index of the segment in this.segments Array to split. 
    *   Starts at index 0.
    * @param {Object} split_point  {x, y} of the point along the segment. 
    *   Does not have to be on the segment per se. Cannot be an endpoint.
    */ 
   _splitSegment(segment_idx, split_point) {
     if(TerrainPolygon.PointEndsSegment(split_point, this.segments[segment_idx])) {
       console.error(`${MODULE_ID}|_splitSegment: cannot split on a segment endpoint.`);
       return;
     }
   
     // segments are constructed:
     // { x: this.points[i],
     //   y: this.points[i + 1] },
     // { x: this.points[i + 2],
     //   y: this.points[i + 3] });
     // The first two correspond to A, the second two are B
     // So for segment_idx x, the points start at x * 4.
     // Need to insert after the starting segment point. 
     // So if original points are ..., x0, y0, x1, y1, ...
     //    new should be ..., x0, y0, new_x0, new_y0, new_x1, new_y1, x1, y1, ...
     
     // hopefully, inserting points does not screw up the underlying PIXI.Polygon, 
     //   otherwise will need to re-construct it from scratch
     this.points.splice(segment_idx * 4 + 2, split_point.A.x, split_point.A.y, split_point.B.x, split_point.B.y);
     this._segments = undefined; // force segment recalculation
   }
   
   /*  
    * Factory function to check if point is at either end of segment
    * @param {Point} p Point as {x, y}
    * @param {Ray} segment Segment ray as {A: {x, y}, B: {x, y}}
    * @return true if the point matches an endpoint of the segment
    */
    static PointEndsSegment(p, segment) {
      return (p.x === segment.A.x && p.y === segment.A.y) ||
             (p.x === segment.B.x && p.y === segment.B.y);
    }
    
    /*
     * Draw the polygon on the canvas
     * @param {Hex} color    Color to use (default: black)
     */
     draw(color = COLORS.black) {
       canvas.controls.debug.lineStyle(1, color).drawShape(this);
     }
     
    /*
     * Draw polygon segments with separate colors for far, near
     * @param {Hex} far_color   Color to use for far segments (default: orange)
     * @param {Hex} near_color  Color to use for near segments (default: red)
     */
     drawFarNearSegments(far_color = COLORS.orange, near_color = COLORS.red) {
       this.segments.forEach((s, s_idx) => {
        const color = this.segment_distance_types[s_idx] === "far" ? far_color : near_color;
        canvas.controls.debug.lineStyle(1, color).moveTo(s.A.x, s.A.y).lineTo(s.B.x, s.B.y);
      });
     }
     
    /*
     * Get shadows for segments
     * This set of functions will build a set of shadow polygons for segment points.
     */
     get shadows() {
       if(this._shadows === undefined) this._shadows = this._calculateShadows();
       return this._shadows;
     
     }
     
     _calculateShadows() {
       log(`vision elevation: ${this.vision_elevation}; terrain elevation: ${this.elevation}; id: ${this.originating_id}`);
       if(this.vision_elevation < this.elevation) {
         // Vision point is lower than the terrain
         // Use near segments.
         // Each segment blocks vision infinitely far beyond.
         return this._calculateNearShadows();
      
       } else {
         // Vision point is higher or equal to the terrain.
         // If equal, treat like base foundry where token can see terrain at same elevation as token.
         // Ve > Te or Ve === Te: Far Segments shadow lower elevation for calculated distance
         // Calculate distance using trigonometry based on vision point elevation and terrain elevation.
         return this._calculateFarShadows();         
       }
     }
     
     _calculateNearShadows() {
       return this.near_segments.map(s => {
         log(`_calculateNearShadows max distance ${this.max_distance}`);
         return { near: Shadow.buildShadowTrapezoid(this.vision_origin, s, this.max_distance) }; 
       });
     }
     
     _calculateFarShadows() {
       // Here is where the problems begin...
       // The shaded area will vary depending on the terrain elevation of that shaded area.
       // If the terrain elevation is Negative ∞, this will shade the whole area.
       // Simplest approach might be to get terrains within the shaded area and 
       //   calculate a shadow for each.
       // So create an object for default zero-elevation that also has a map of any
       //   relevant terrains.
       return this.far_segments.map(s => {
          // start by calculating shade assuming elevation 0
          const Oe = 0;
          const dist_A = this.calculateShadowDistance(s.A, Oe);
          const dist_B = this.calculateShadowDistance(s.B, Oe);
          log(`_calculateFarShadows dist_A ${dist_A} dist_B ${dist_B} with Oe ${Oe}`, s); 
          const e0_shadow = Shadow.buildShadowTrapezoid(this.vision_origin, s, dist_A, dist_B);
          
          // now we really need to check any terrain within the full shaded version
          // only care about near terrain segments.
          // A near terrain segment that has an endpoint within the full shade counts.
          // either fully in or one or more intersection points. 
          const infinite_shade_trapezoid = Shadow.buildShadowTrapezoid(this.vision_origin, s, this.max_distance);
          
          // note: other_terrains should have already removed this polygon if it has id 
          log(`other terrains`, this.other_terrains); 
          const terrains_to_check = [...this.other_terrains].filter(t => {
            return t.intersectsPolygon(infinite_shade_trapezoid);
          });
          
          // for each terrain, find the near segments and calculate a shade trapezoid for each
          // any 2 of 4 lines should work:
          //   1. V --> s endpoint --> intersects t_s (either s.A or s.B)
          //   2. V --> intersects s --> t_s endpoint (either t_s.A or t_s.B)
          
          const terrain_shade_trapezoids = new Map(); 
          terrains_to_check.forEach(t => {
            const Te = t.elevation;
            // is the segment within the shade poly? If yes, then calculate a shade trapezoid
            const t_shadows = t.near_segments.map(t_s => {
              if(infinite_shade_trapezoid.intersectsRay(t_s) || infinite_shade_trapezoid.rayInside(t_s)) {
                let t_intersections = [];
                let s_intersections = [];
                
                // V --> s @ endpoint A --> terrain segment intersection? 
                let ray_VS_A = new Ray(this.vision_origin, s.A);
                ray_VS_A = new Ray(this.vision_origin, ray_VS_A.project(this.max_distance));
                const intersection_T_A = ray_VS_A.intersectSegment([t_s.A.x, t_s.A.y, t_s.B.x, t_s.B.y]);
                if(intersection_T_A) { 
                  t_intersections.push(intersection_T_A); 
                  s_intersections.push(s.A);
                }
                
                // V --> s @ endpoint B --> terrain segment intersection? 
                let ray_VS_B = new Ray(this.vision_origin, s.B);
                ray_VS_B = new Ray(this.vision_origin, ray_VS_B.project(this.max_distance));
                const intersection_T_B = ray_VS_B.intersectSegment([t_s.A.x, t_s.A.y, t_s.B.x, t_s.B.y]);
                if(intersection_T_B) { 
                  t_intersections.push(intersection_T_B); 
                  s_intersections.push(s.B);
                }
                
                // V --> s intersection? --> terrain segment A 
                if(t_intersections.length < 2) {
                  let ray_VT_A = new Ray(this.vision_origin, t_s.A);
                  const intersection_S_A = ray_VT_A.intersectSegment([s.A.x, s.A.y, s.B.x, s.B.y]);
                  if(intersection_S_A) { 
                    t_intersections.push(t_s.A);
                    s_intersections.push(intersection_S_A); 
                  }
                }
                
                // V --> s intersection? --> terrain segment B
                if(t_intersections.length < 2) {
                  let ray_VT_B = new Ray(this.vision_origin, t_s.B);
                  const intersection_S_B = ray_VT_B.intersectSegment([s.A.x, s.A.y, s.B.x, s.B.y]);
                  if(intersection_S_B) { 
                    t_intersections.push(t_s.B); 
                    s_intersections.push(intersection_S_B);
                  }
                }
                
                // should have two intersection points for t_s. One or both could be an endpoint.
                if(t_intersections.length !== 2 || s_intersections.length !== 2) {
                  console.error(`${MODULE_ID}|Wrong number of intersections for terrain_shade_trapezoids`, t_intersections, s_intersections);
                  return;
                }
                
                // distance from s intersections:
                const dist_A = this.calculateShadowDistance(s_intersections[0], Te);
                const dist_B = this.calculateShadowDistance(s_intersections[1], Te);
                
                // subtract out the distance to reach the terrain segment
                const ray_ST0 = new Ray(s_intersections[0], t_intersections[0]);
                const ray_ST1 = new Ray(s_intersections[1], t_intersections[1]);
                const t_dist_A = max(0, dist_A - ray_ST0.distance);
                const t_dist_B = max(0, dist_B - ray_ST0.distance);
                 
                // build shade with terrain segment as one parallel, angle using vision, and
                //   distance extending out from the terrain segment
                // Should only be that portion of the terrain segment that is intersected
                const ray_T_partial = new Ray(t_intersections[0], t_intersections[1]);
                const t_shadow = Shadow.buildShadowTrapezoid(this.vision_origin, ray_T_partial, t_dist_A, t_dist_B);
                return t_shadow;
              }
            
              terrain_shade_trapezoids.set(t.originating_id, t_shadows);
              
            }); // t.near_segments.map
          }); // terrains_to_check.forEach
          
          return { e0_shadow: e0_shadow,
                   terrain_shadows: terrain_shade_trapezoids };
       }); // this.far_segments.map
     }
     
     get other_terrains() {
       if(this._other_terrains === undefined) this._other_terrains = this._createOtherTerrainPolygons();
       return this._other_terrains;
     }
     
     set other_terrains(value) {
       // do not keep this terrain
       if(this.originating_id !== "") value.delete(this.originating_id);
       this._other_terrains = value;
     }
     
     _createOtherTerrainPolygons() {
        const terrain_layer = canvas.layers.filter(l => l?.options?.objectClass?.name === "Terrain")[0];
        if(!terrain_layer) return res;
        let terrains = terrain_layer.placeables; // array of terrains
        if(terrains.length === 0) return res;
        
        const terrain_polygons_map = new Map();
        terrains.forEach(t => {
          const t_classed = TerrainPolygon.fromObject(t.data);
          terrain_polygons_map.set(t_classed.originating_id, t_classed);
        });
        
        // do not keep this terrain
        if(this.originating_id !== "") terrain_polygons_map.delete(this.originating_id);
        
        return terrain_polygons_map;
     }
     
     get max_distance() {
       if(this._max_distance === undefined) this._max_distance = (new Ray({x: 0, y: 0}, {x: canvas.dimensions.sceneWidth, y: canvas.dimensions.sceneHeight})).distance;
       return this._max_distance;
     }
     

     
     /**
      * Calculate distance from vision point for which an elevated wall blocks vision.
      * @param {Point} T Terrain wall end point
      * @param {Number} Ve Vision elevation
      * @param {Number} Te Terrain wall elevation
      * @param {Number} Oe Elevation of the space beyond the terrain wall
      * @param {Point} V Vision origin point
      * @param {Number} Ve Vision elevation
      * @param {Number} Te Terrain wall elevation
      * @return {Number} distance from V to O at which O would first be seen, assuming 
      *   O lies on the line extended from V to T.
      */
// TO-DO: Use this formula in sightLayer to test tokens.
// Can first calculate the intersection with the wall, and then pass 
// the intersection point as T.
      calculateShadowDistance(T, Oe, V = this.vision_origin, Ve = this.vision_elevation, Te = this.elevation) {        
        // if any elevation is negative, normalize so that the lowest elevation is 0
        const min_elevation = Math.min(Ve, Oe, Te);
        if(min_elevation < 0) {
          const adder = abs(min_elevation);
          Ve = Ve + adder;
          Oe = Oe + adder;
          Te = Te + adder;
        }

        // If the vision elevation is less than or equal to the terrain, 
        //   the wall blocks infinitely unless the object is higher than the wall
        if(Ve <= Te && Oe <= Te) return Number.POSITIVE_INFINITY;

        const ray_VT = new Ray(V, T);

        // theta is the angle between the 3-D sight line and the sight line in 2-D
        const theta = Math.atan((Ve - Te) / ray_VT.distance); // theta is in radians

        // distance at which O would be seen
        // assuming O lies on the line extended from V to T
        const TO_needed = (Te - Oe) / Math.tan(theta); // tan needs radians

        return TO_needed;
     }    
}
