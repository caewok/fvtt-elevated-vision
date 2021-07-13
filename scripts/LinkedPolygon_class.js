// Polygon that contains a linked set of edges and vertices.
// Each edge is a Segment linked to two Vertex, in a chain.
// Methods provided to split a segment recursively.
// Basic drawing methods using the segments.

// Intersection methods adapted from https://github.com/vrd/js-intersect/blob/gh-pages/solution.js
// License: MIT

import { Vertex } from "./Vertex_class.js";
import { Segment } from "./Segment_class.js";
import { ShadowSegment } from "./ShadowSegment_class.js";
import { locationOf, COLORS, FirstMapValue, SecondMapValue, almostEqual } from "./utility.js";
import { log } from "./module.js";


export class LinkedPolygon extends PIXI.Polygon {  
 /*
  * Construct the map of segments for the polygon.
  * Cached.
  * @type {Map}
  */
  get segments() {
    if(this._segments === undefined || this._segments.size === 0) {
      this._segments = this._constructSegments();
      }
    return this._segments; 
  }
  
 /*
  * Construct the map of vertices for the polygon.
  * Cached. Will remove prior segments, if any.
  * @type {Map}
  */
  get vertices() {
    if(this._vertices === undefined || this._vertices.size === 0) {
      this._segments = undefined;
      this._vertices = this._constructVertices();
    }
    return this._vertices;
  }
  
 /*
  * Set color for the underlying segments.
  * @param {Hex} color    Color to use (default: black)
  */
  setSegmentsColor(color) {
    // set property for each segment
    for(const [key, segment] of this.segments) {
      segment.mergeProperty({ color: color });
    }
  }

 /*
  * Internal function to construct the map of vertices for the polygon
  * Each vertex links to two segments, using the internal Segment and Vertex linking.
  * @return {Map}
  */
  _constructVertices(segment_class = "Segment") {
    const SEGMENT_CLASSES = {
       Segment,
       ShadowSegment
     }
  
    const poly_vertices = new Map();  
    let prior_vertex = new Vertex(this.points[0], this.points[1]);
    let new_vertex;
    prior_vertex.originating_object = this;
    poly_vertices.set(prior_vertex.id, prior_vertex);
    
    //log(`_constructVertices 0:`, prior_vertex, new_vertex);
    
    // save the first id to link at the end
    const l = this.points.length;
    if(this.points[0] !== this.points[l - 2] ||
       this.points[1] !== this.points[l - 1]) {
       console.error(`${MODULE_ID}|_constructVertices expects a closed set of points.`, this);
       }
    
    const first_vertex_id = prior_vertex.id;

    // TO-DO: assuming closed stroke for now.
    for (let i = 2; i < (this.points.length - 2); i += 2) {
      new_vertex = prior_vertex.connectPoint(this.points[i], this.points[i + 1], segment_class);
      //log(`_constructVertices ${i} new_vertex`, new_vertex);
      
      poly_vertices.set(new_vertex.id, new_vertex);
      prior_vertex = new_vertex;
      //log(`_constructVertices ${i} end:`, prior_vertex, new_vertex)
    }
    
    //log(`_constructVertices ended loop`);
    
    // link to beginning
    const last_vertex_id = new_vertex.id;
    
    const s_last_first = SEGMENT_CLASSES[segment_class].fromVertices(poly_vertices.get(last_vertex_id),
                                              poly_vertices.get(first_vertex_id),);
                                                                         
    poly_vertices.get(last_vertex_id).includeSegment(s_last_first)
    
    // to ensure segments are A, B for the vertex, as in prior(A) --> vertex --> next (B)
    // need to insert this s_first_last as A in the first vertex
    const s_first_second =  FirstMapValue(poly_vertices.get(first_vertex_id).segments);
    poly_vertices.get(first_vertex_id).segments.clear();
    poly_vertices.get(first_vertex_id).includeSegment(s_last_first);
    poly_vertices.get(first_vertex_id).includeSegment(s_first_second);
    
    //log(`_constructVertices return`, poly_vertices);

    return poly_vertices;
  }
  
 /*
  * Internal function to build the Map of polygon segments.
  * Each segment shares two vertices with two other segments, linked here
  *   using the internal Segment and Vertex linking.
  * @return {Map}
  */
  _constructSegments() {
    const poly_segments = new Map();

    for(const [key, vertex] of this.vertices) {
      // only add the second segment, so that first<-->last segment is last
      const s_second = SecondMapValue(vertex.segments);

      // Default every segment: 
      //   - "far" until calculateNearFarSegments is run
      //   - "ignore" for vision type (block, shadow, ignore)
      s_second.mergeProperty({ vision_distance: "far", 
                               vision_type: "ignore" });      
      poly_segments.set(s_second.id, s_second);
    }
    return poly_segments;
  }
  
  /*
   * Draw the polygon on the canvas, using the PIXI.Polygon shape from points.
   * @param {Hex} color    Color to use (default: black)
   */
   drawPolygon(color = COLORS.black) {
     canvas.controls.debug.lineStyle(1, color).drawShape(this);
   }
   
  /*
   * Draw the polygon using the individual segments.
   * @param {Hex} default_color Color to use if the segment color property 
   *   has not yet been set.
   */
   draw(default_color = COLORS.black) {
     for(const [key, segment] of this.segments) {    
       const splits = segment.getSplits();
       splits.forEach(s => {
         s.draw(s.properties?.color || default_color);
       });      
     }
   }
   
  /*
   * Test for equality against another polygon.
   * Equal if the two polygons contain nearly equal points.
   * Points can start wherever but must be in the same order.
   * @param {PIXI.Polygon} other_polygon  Polygon to test.
   * @param {Number} EPSILON Error to tolerate when comparing points
   * @return {Boolean} True if the two polygons share all points in order.
   */
   equals(other_polygon, EPSILON = 1e-5) {
     // if equal, then point 0 should be found in other_polygon at least once
     const matching_indices_x = [];
     
     const test_point_x = this.points[0];
     other_polygon.points.forEach((p, idx) => {
       if(idx % 2 === 1) return; // skip the y points 
     
       if(almostEqual(test_point_x, p)) {
         matching_indices.push(idx);
       }
     });
     
     if(matching_indices_x.length === 0) return false;
     
     const matching_indices_y = [];
     const test_point_y = this.points[1];
     matching_indices_x.forEach(i => {
       const y = this.points[i + 1];
     
       if(almostEqual(test_point_y, y)) {
         matching_indices_y.push(i + 1);
       }
      
     });
     
     if(matching_indices_y.length === 0) return false;
     
     const res = matching_indices_x.some(x => {
       // each forward or backward, all the points should match
       // forward
       const forward = this._pointsMatch(this.points, other_polygon.points, 0, x);
       
       // backward
       const reversed = other_polygon.points.reverse();
       const backward = this._pointsMatch(this.points, reversed, 0, other_polygon.points.length - 1 - x);
       
       return forward || backward;
     });
     
     return res;
   }
   
  /*
   * Compare arrays of numbers starting at given index.
   * @param {Array[Number]} arr1   Array of numbers
   * @param {Array[Number]} arr2   Array of numbers
   * @param {Number} idx1          Index to start to compare arr1
   * @param {Number} idx2          Index to start to compare arr2
   * @return True if the arrays match, given the starting positions.
   */
   _pointsMatch(arr1, arr2, idx1 = 0, idx2 = 0) {
     if(arr1.length !== arr2.length) return false;
   
     for(let i = 0; i < arr1.length; i++) {
       arr1_idx = arr1.length % (idx1 + i);
       arr2_idx = arr2.length % (idx2 + i);
       if(!almostEqual(arr1[arr1_idx], arr2[arr2_idx])) return false;
     }
     return true;
   }
   
   
  /*
   * Return Set of polygons that represent the intersection
   *   of two polygons.
   * @param {LinkedPolygon} other_polygon Polygon to compare
   * @return {Set[LinkedPolygon]} Set of polygons, if any
   */
   intersection(other_polygon) {
     return this._setOperation(other_polygon, "intersection");
   }
   
  /*
   * 
   
   
  /*
   * Internal function to handle intersect, union, xor
   * "xor": this polygon minus the other polygon
   * Basic algorithm:
   *   At each intersect point:
   *     - split the segment.
   *     - add the segment from p2 to the split vertex at p1.
   *   At each intersect point for the new "complex" polygon:
   *     - "walk" the polygon
   *     - "multiple worlds":
   *       - start a new walk at any intersection encountered
   *       - also continue existing walk in all new directions
   *     - stop if you hit any vertex previously encountered.
   *     - return a polygon if you return to the start.
   * Possibly use a sweep algorithm for both intersections and 
   *   polygon creation? 
   *   - sweep left to right
   *   - at each point, make a right turn until back to beginning
   *   - at intersection, make new polygon
   *   - intersecting polygons:
   *   -   at intersection, look for rightmost or second line?
   *       or just test for internal overlapping points at the end?
   * @param {LinkedPolygon} other_polygon Polygon to compare
   * @param {String} set_type             Type of set (intersection, union, xor)
   * @return {Set[LinkedPolygon]} Set of polygons, if any
   */
   // http://www.cs.ucr.edu/~eldawy/19SCS133/slides/CS133-05-Intersection.pdf
   // https://github.com/vrd/js-intersect
   _setOperation(other_polygon, set_type = "intersection") {
     other_polygon_a = this.alignPolygon(other_polygon);
     
     // check polygons?
     
     const edges = edgify(other_polygon_a);
   
     const polygons = this.polygonate(other_polygon);
     return this.filterPolygons(polygons, set_type);
   }
   
   /*
    * Construct a new polygon where if the points are sufficiently close
    * to this polygon, make them equal
    * @param {LinkedPolygon} other_polygon Polygon to compare
    * @return {LinkedPolygon} new polygon with points comparable to other_polygon
    */
   alignPolygon(other_polygon) {
     points = other_polygon.points;
     this.vertices.forEach(v => {
       for(let i = 0; i < (points.length - 2); i += 2) {
         if(v.squaredDistance(points[i], points[i + 1]) < 0.00000001) {
           points[i] = v.x;
           points[j] = v.y;
         }
       }
     });
     
     return new LinkedPolygon(points);
   }
   
   /*
    * Brute-force identification of intersection points between two polygons.
    * @param {LinkedPolygon} other_polygon  Polygon to check for intersections.
    * @return {Array[Vertex]} Intersection points with the intersecting segments. 
    */

    intersectionPoints(other_polygon) {
      const intersection_points = [];
      this.segments.forEach(s1 => {
        other_polygon.segments.forEach(s2 => {
          const intersection = s1.intersectSegment([s2.A.x, s2.A.y, s2.B.x, s2.B.y]);
          if(intersection) {
            const v = Vertex.fromPoint(intersection);
            v.segments.set(s1.id, s1);
            v.segments.set(s2.id, s2);
          
            intersection_points.push(v);
          }
        });
      
      });
      return intersection_points;
    }
    
   /*
    * Create array of edges of both polygons combined.
    * Include edges created from intersection points.
    * @param {LinkedPolygon} other_polygon  Other polygon to pull edges from.
    * @return {Array[Segments]}
    */
    edgify(other_polygon) {
      const primEdges = [...this.segments.values()].concat([...other_polygon.segments.values()]);
      const intersection_points = this.intersectionPoints(other_polygon);
      

      

      
      return primEdges;     
    }
     
   /*
    * Create array of polygons from array of edges.
    * Move CCW around the polygon.
    */
    // use intersections to identify smaller polygons
    // from each intersection, move around the polygon
    // if you come back to the intersection, store the polygon
    // if you meet another intersection, take the CCW path
    polygonate(edges, intersections) {
      // add intersections to edges by splitting the edge
      // can take advantage of the reference to split directly
      intersection_points.forEach(i => {
        i.segments.forEach(s => {
          s.splitAt(i);
        });
      });
    
      // find a valid starting point and direction
      // need to move clockwise along edges with the polygon to the inside
      polygons = [];
      vertices_visited = [];
      
      for(let i = 0; i < intersections.length; i += 1) {
        const intersection = intersections[i];
        
        // create a polygon using each edge from the intersection
        const s_ids = [...intersection.segments.keys()]
        for(let s_id = 0; s_id < s_ids.length; s_id += 1) {
          const polygon_found = tracePolygon(intersection, s_id, edges.length);
          
          // check for unique polygon
          const already_found = polygons.some(p => {
            return p.equals(polygon_found);
          })
          
          if(!already_found) polygons.push(polygon_found);
        }
      }
    }
    
    tracePolygon(starting_vertex, starting_edge_id, max_iterations = 100) {
      let current_edge = starting_vertex.segments.get(starting_edge_id);
      let edges_found = [current_edge];
      let current_vertex = undefined;
      
      let iteration = 0; // for testing, to avoid infinite loops.
      while(iteration < max_iterations) {
        iteration += 1;
        
        current_vertex = current_edge.getOppositeVertex(current_vertex.id);
        if(current_vertex.id === starting_vertex.id) break;
        
        if(current_vertex.segments.size > 2) {
          // 0 should be the current edge
          const sorted_segments = sortCCW(current_vertex.segments, current_vertex.id);
          current_edge = sorted_segments[1];
        } else {
          // find the next edge by eliminating the one we just visited
          current_edge = [...current_vertex.segments.values].filter(s => {
            s.id !== current_edge.id;
          });
        }
        edges_found.push(current_edge);
      }
    
    }
    
    
    
   
    
   /*
    * For an edge, sort the segments for a vertex CCW
    * @param {Segment} edge   Edge to use
    * @param {String} direction Vertex to use ("A" or "B")
    * @return {Array[Segment]} Segments sorted by CCW. 0 is the current edge.
    */  
    sortCCW(edge, anchor_id) {
      const v = edge.getOppositeVertex(anchor_id);
          
      log(`edge ${edge.id} from anchor ${anchor_v_id}`, edge);
      
      const s_sorted = [...v.segments.values()].sort((a, b) => {
        if(a.id === edge.id) return -1;
        if(b.id === edge.id) return 1;
        
        const a_new_v = a.A.id === v.A.id || a.A.id === v.B.id ? a.B : a.A;
        const b_new_v = b.A.id === v.A.id || b.A.id === v.B.id ? b.B : b.A; 
        
        const a_ccw = e1.orient2d(a_new_v);
        const b_ccw = e1.orient2d(b_new_v);
        
        if(almostEqual(a_ccw, b_ccw)) return 0;
        
        // positive if ccw
        return (a_ccw > b_ccw) ? 1 : -1;
      });
      
      log(`sorted segments`, [...s_sorted]);
      
      return s_sorted;
    }
    
    
   

     
} 
