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

/*
 * Polygon class with linked Segments and Vertices.
 * For a regular polygon, where each vertex has 2 segments, 
 * this is ordered such that segment.vertex.A <--> segment <--> segment.vertex.B / segment2.vertex.A <--> segment2.vertex.B
 * the last segment.vertex.B <--> first segment.vertex.A
 * Irregular polygons may have more than one segment per vertex (such as creating overlapping polygons)
 */
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
   * Helper function to walk the polygon and do something at each vertex or segment.
   * If the polygon is irregular in that it has more than two segments at a vertex, 
   * walk the CW segment
   */
 //   walkPolygon(vertex_fn, segment_fn, use_splits = false) {
//      // start at a segment.
//      // Point A is starting; Point B is current
//      const current_segment_id = [...this.segments.keys()][0];
//      const starting_segment = this.segments.get(current_segment_id);
//      const starting_vertex_id = starting_segment.vertexA.id;
//      const current_vertex_id = starting_segment.vertexB.id;
//      
//      current_vertex = this.ver
//      
//      while(current_vertex.id !== starting_vertex_id) {
//        if(starting_vertex_id === "") {
//          current_
//        }
//      
//        // apply to segment
//        current_segments = [...current_vertex.segments.values()];
// 
//        if(current_segments.length > 2) {
//          log("walkPolygon: more than 2 current segments.");
//        }
//        if(segment_fn) { segment_fn(current_segments[1]); } 
// 
//        // apply to segment vertexB 
//        current_vertex = current_segments[1].vertexB;
//        if(vertex_fn) { vertex_fn(current_vertex); }
//       
//     
//     
//     }
//  
//  
//      const starting_vertex_id = [...this.vertices.keys()][0];
//      const current_segment_id = [...this.segments.keys()][0];
//      let current_segment_id = "";
//      
//      while(current_segment_id !== starting_vertex_id) {
//        if(current_segment_id === "") current_segment_id = starting_segment_id;
//        
//        if(segment_fn) segment_fn(current_segment_id);
//        
//        vertex_id = this.segments.get(current_segment_id).
//        
//      
//      }
//      
//      if(vertex_fn) {
//      
//      }
//      
//      if(segment_fn) {
//      
//      }
//    
//    } 
   
   
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
     const points = other_polygon.points;
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
    * @return {Map[Vertex]} Intersection points with the intersecting segments. 
    */

    intersectionPoints(other_polygon) {
      const intersection_points = new Map();
      this.segments.forEach(s1 => {
        other_polygon.segments.forEach(s2 => {
          const intersection = s1.intersectSegment([s2.A.x, s2.A.y, s2.B.x, s2.B.y]);
          if(intersection) {
            let v;
            // check if intersection is on a vertex
            if(s1.A.equals(intersection)) {
              v = s1.A;
            } else if(s1.B.equals(intersection)) {
              v = s1.B;
            } else if(s2.A.equals(intersection)) {
              v = s2.A;
            } else if(s2.B.equals(intersection)) {
              v = s2.B;
            } else {
              // intersection is a new point in the middle of the two segments
              v = Vertex.fromPoint(intersection);
            }
            
            v.segments.set(s1.id, s1);
            v.segments.set(s2.id, s2);
            
            intersection_points.set(v.id, v);
          }
        });
      
      });
      return intersection_points;
    }
    
   /*
    * Find vertices that are identical or nearly so in another polygon.
    * Add segments from the other polygon to this one.
     
    
   /*
    * Create array of edges of both polygons combined.
    * Include edges created from intersection points.
    * @param {LinkedPolygon} other_polygon  Other polygon to pull edges from.
    * @return {Array[Segments]}
    */
    edgify(other_polygon) {
      
      
      const primEdges = [...this.segments.values()].concat([...other_polygon.segments.values()]);
      const intersections = [...this.intersectionPoints(other_polygon).values];
      

      

      
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
      intersections.forEach(i => {
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
        for(let j = 0; j < s_ids.length; j += 1) {
          // intersections are vertices with 2+ segments
        
          const polygons_found = this.tracePolygon(intersection, starting_vertex.segments.get(s_ids[j]), edges.length);
          
          // check for unique polygon
          const already_found = polygons.some(p => {
            return p.equals(polygon_found);
          })
          
          if(!already_found) polygons.push(polygon_found);
        }
      }
    }
    
    
//     from upper right: 1,2,3,4,5,6,7,8 (middle)
//     
//     A poly
//     i1: 1
//     i2: 7
//     i3: 3
//     i4: 8
//     i5: 8
//     i6: 6
//     i7: 8
//     
//     a poly
//     i1: 8
//     i2: 2
//     i3: 8
//     i4: 4
//     i5: 5
//     i6: 8
//     i8: 7
//     
//     
//     
//     Segment: A|B with intersections AB1, AB2
//     Segment: A|D with intersections AD1, AD2
//     Segment: a|b with intersections ab1, ab2
//     segment: b|c with intersections bc1, bc2
//     
//     Intersections: AB1, ab2 (1)
//                    AB2, bc1 (2)
//                    AD1, ab1 (3)
//     
//     Triangle: A - AB1 - AD1
//     Triangle: AB1 - b - AB2
//     
//     start vertex: AB1 (1)
//     start edge: A|B
//     
//     1: split start edge A|B. 2 segments share AB1
//        a. segment A|AB1
//           CW: A|AB1 -- AB1|AD1 (splits, choose CW) -- A
//        
//        b. segment AB1|AB2
//           CW: AB1|AB2 -- (around long way)
//           
//     2.       
    
    
//   sorted AB1:
//   
//   initial: A|AB1
//   sorted:
//   0: AB1|AD1
//   1: AB1|AB2
//   2: AB1|b
//    
//   CW: 0 
//   A|AB1 (3): AB1|AD1 (0)
//   
//   other CW:
//   AB1|b (2): A|AB1 (3)
//   AB1|AB2 (1): AB1|b (2)
//   AB1|AD1 (0): AB1|AB2 (1)
   
   getAllEdgesFromVertex(vertex) {
     // for each segment of the vertex, find all the splits and return any split with that vertex
     const v_edges = [];
     vertex.segments.forEach(s => {
       // filter splits for only those that contain the vertex in question
//        const matching_edges = s.getSplits().filter(split => {
//          return split.contains(vertex);
//        }); 
       const matching_edges = s.getSplits().filter(split => {
         return split.vertexA.id === vertex.id || split.vertexB.id === vertex.id;
       });
       
       matching_edges.map(m => { v_edges.push(m); });       
     });
     return v_edges;
   }
   
   
/*
segment --> vertex
get next segment CW

if more than 1 next segment, others recurse anew

return next segment, new vertex 

if edge already seen, then stop
if back to starting vertex, report polygon
*/
    // generator to walk along the polygon
    // https://exploringjs.com/es6/ch_generators.html#ch_generators
    * walkFromVertex(starting_vertex_id, include_splits = false) {
      let current_vertex_id = null;
      let current_vertex = this.vertices.get(starting_vertex_id);
      let current_segment = null;
      
      const MAX_ITERATIONS = this.vertices.size + this.segments.size + 1;
      let iteration = 0;
      
      while(current_vertex_id !== starting_vertex_id) {
        yield current_vertex;
        current_segment = SecondMapValue(current_vertex.segments);
        
        if(include_splits) {
          const split_segments = current_segment.getSplits();
          
          for(let idx = 0; idx < split_segments.length; idx += 1) {
            const split = split_segments[idx];
            yield split;
            if(split.vertexB.equals(current_segment.vertexB)) { break; }
            yield split.vertexB;
          }
        
        } else {
           yield current_segment;
        }
        
       
        current_vertex = current_segment.vertexB;
        current_vertex_id = current_vertex.id;
        if(iteration > MAX_ITERATIONS) break;
        iteration += 1;
      }
    }
    
    * walkFromSegment(starting_segment_id, include_splits = false) {
      let current_segment_id = null;
      let current_segment = this.segments.get(starting_segment_id);
      let current_vertex = null;
      const MAX_ITERATIONS = this.vertices.size + this.segments.size + 1;
      let iteration = 0;
      
      while(current_segment_id !== starting_segment_id) {
        if(include_splits) {
          const split_segments = current_segment.getSplits();
          
          for(let idx = 0; idx < split_segments.length; idx += 1) {
            const split = split_segments[idx];
            yield split;
            if(split.vertexB.equals(current_segment.vertexB)) { break; }
            yield split.vertexB;
          }
        
        } else {
           yield current_segment;
        }
        current_vertex = current_segment.vertexB;
        yield current_vertex;
        current_segment = SecondMapValue(current_vertex.segments);
        
        current_segment_id = current_segment.id;
        if(iteration > MAX_ITERATIONS) break;
        iteration += 1;
      }
    
    
    }
     
     
    walkEdge(starting_vertex_id, starting_edge) {
      // return the next edge(s), sorted CCW and move to the next vertex
      const next_vertex_id = starting_edge.getOppositeVertex(starting_vertex_id);
      
      const v_segments = this.getAllEdgesFromVertex(next_vertex_id);
      
      let new_segments = v_segments.filter(s => {
        return s.id !== starting_edge.id;
      });
      
      if(new_segments.length > 1) {
        new_segments = this.sortCW(starting_edge, new_segments, starting_intersection.id);
      } 
      
      return { new_segments: new_segments,
               next_vertex_id: next_vertex_id } 
    } 
    
    traceAllPolygons(starting_intersection, max_iterations = 100) {
      const edges_found = [];
      const polygons_found = [];
      
      const v_segments = this.getAllEdgesFromVertex(starting_intersection);
            
      v_segments.forEach(s => {
        const res = this.tracePolygon(starting_intersection, s, max_iterations = max_iterations, edges_found = edges_found);
        polygons_found.concat(res);
      });  
    
      return polygons_found;
    }
    
    // walk CW around a polygon.
    // where intersections found, look for new polygon(s) by walking CW using that start point
    // return 0 or more polygons found
    tracePolygon(starting_vertex_id, starting_edge, max_iterations = 100, edges_found = []) {
      const polygon_found = [];
      const polygons_found = [];
      let current_vertex_id = starting_vertex_id;
      let current_edge = starting_edge;
      let iteration = 0;
      while(iteration < max_iterations) {
        iteration += 1;
        
        edges_found.push(current_edge);
        const walk_result = this.walkEdge(current_vertex_id, current_edge);
        if(walk_result.next_vertex_id === starting_vertex_id) { break; } // found polygon
        
        const edge_already_found = edges_found.some(e => {
          return e.id === walk_result.new_segments[0].id;
        });
        if(edge_already_found) return polygons_found; // overlapped with existing; return 
        
        polygon_found.push(walk_result.new_segments[0]);
        
        // if(walk_result.new_segments.length > 1) {
//           const other_polygons = walk_result.new_segments.slice(1).map(s => {
//             const edge_already_found = edges_found.some(e => {
//               return e.id === s.id;
//             });
//             
//             if(!edge_already_found) {
//               return this.tracePolygon(walk_result.next_vertex_id, s, max_iterations = max_iterations);
//             } else {
//               return [];
//             }
//           });
//           polygons_found.concat(other_polygons);
//         }
        current_edge = walk_result.new_segments[0];
        current_vertex_id = walk_result.next_vertex_id;
      }
      
      return polygons_found.concat(polygon_found);
     
    }
    
    sortCW(anchor_edge, other_edges, intersection_id) {
      return other_edges.sort((a, b) => {
        const a_new_v = a.getOppositeVertex(intersection_id);
        const b_new_v = b.getOppositeVertex(intersection_id);
    
        const a_ccw = anchor_edge.orient2d(a_new_v);
        const b_ccw = anchor_edge.orient2d(b_new_v);
      
        if(almostEqual(a_ccw, b_ccw)) return 0;
      
        // positive if ccw
        return (a_ccw > b_ccw) ? 1 : -1;
      });      
    }
     
} 
