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
     const polygons = this.polygonate(other_polygon);
     return this.filterPolygons(polygons, set_type);
   }
   
   
   /*
    * Where the other_polygon intersects with this one, make new points.
    * (e.g., split the segment at the intersection points)
    * @param {LinkedPolygon} other_polygon    The polygon to test.
    */
   edgify(other_polygon) {
     // if the poly
     this.segments.forEach(s => {
       // check every edge for intersection with every edge except itself
       
     });
   }
   
   /*
    * Bentley-Ottmann sweep algorithm to sort vertices and return a list of
    * intersecting points.
    * http://www.cs.ucr.edu/~eldawy/19SCS133/slides/CS133-05-Intersection.pdf
    * TO-DO: advanced version with bounding rectangles
    * TO-DO: Use a tree? e.g. https://github.com/w8r/splay-tree
    */
    intersectionPoints(other_polygon) {      
      const MAX_ITERATIONS = this.segments.size * other_polygon.segments.size + 1; // breaker for the while loop 
      let P = []; // top point of each line segment {id, score, object}
      let S = []; // sweep line state: {id, score, object}
                  // {id, score, segment} 
      let intersection_points = [];
      
      
      const compareP = function(a, b) {
        // a and b are Vertex points
        // y increases top --> bottom
        // if a.y == b.y, tiebreaker goes to leftmost x
        if(almostEqual(a.y, b.y, 1e-5)) {
          return almostEqual(a.x, b.x, 1e-5) ? 0 :
                 a.x < b.x ? 1 : -1;
        }        

        return a.y < b.y ? 1 : -1;
      }

      // find the top and bottom points of a segment by y 
      const getVertex = function(s, top = true) { 
        const a = s.A;
        const b = s.B;
        const compare_res = compareP(a, b) === 1;
        //log(`getVertex: ${compare_res}`, a, b);
        if(!top) return compare_res ? b : a;
        return compare_res ? a : b;
      }

      const getTopVertex = function(s) { return getVertex(s, true); }
      const getBottomVertex = function(s) { return getVertex(s, false); }
      
      // Calculate x intersection with sweep for a given segment
      const sweepIntersect = function(segment, y_sweep) {
        // http://www.cs.ucr.edu/~eldawy/19SCS133/slides/CS133-05-Intersection.pdf 
        // See Sweep Line State
        const delta_x = segment.A.x - segment.B.x;
        const delta_y = segment.A.y - segment.B.y;
        if(delta_y === 0) return segment.A.x; // horizontal line; pick an x
        return segment.A.x + (delta_x / delta_y) * (y_sweep - segment.A.y);
      }
      
      // Sort S by x coordinate of intersections between segment and sweep
      const sortS = function(S, y_sweep) {
        // use a mapped sort to pre-calculate the x intersection with sweep
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
        const mapped_S = S.map((segment, idx) => {
          const value = sweepIntersect(segment, y_sweep);  
          log(`Segment ${segment.id} sort value ${value} at y=${y_sweep}`);

          return { i: idx, value: value }
        });
        
        mapped_S.sort((a, b) => {
          return a.value > b.value ? 1 : 
                 a.value < b.value ? -1 :
                 0; 
        });
        
        return mapped_S.map(v => S[v.i]);
      }
     
     //log(`intersectionPoints topVertex example`, 
     //  getTopVertex(FirstMapValue(this.segments)), 
     //  FirstMapValue(this.segments));

     log(`intersectionPoints polygon, this`, other_polygon, this);
 
     [this, other_polygon].forEach(p => {
        p.segments.forEach(s => {
          // find the top segment vertex; add to P
          const top_v = getTopVertex(s); 
          if(!P.includes(top_v)) { P.push(getTopVertex(s)); }
        });
      });
      
      log(`intersectionPoints length ${P.length}`, [...P]);      
      // sort such that top of the list is at end of array, 
      //   so we can pop the top point
      P.sort(compareP);
      log(`intersectionPoints sorted length ${P.length}`, [...P]);
      let num_iterations = 0;

      while(P.length > 0 && num_iterations < MAX_ITERATIONS) {
        num_iterations += 1;

        log(`P (length ${P.length})`, [...P]);
        log(`S (length ${S.length})`, [...S]);
        
        const p = P.pop();
//        S = sortS(S, p.y);
        console.log(`\n-------------------------\n`);
        
        
        // TO-DO: use splice or some other method to insert into the sorted arrays?
        // https://stackoverflow.com/questions/1344500/efficient-way-to-insert-a-number-into-a-sorted-array-of-numbers
        
        // Given vertex can have 2+ segments.
        // If any are interior, treat all as interior?
        // Otherwise, run top before bottom
        const p_type = [...p.segments.entries()].map([key, s] => {
          if(p.equals(getTopVertex(s))) return { id: key, type: "top" };
          if(p.equals(getBottomVertex(s))) return { id: key, type: "bottom" };
          return { id: key, type: "interior"};
        });
        
        
        log(`iteration ${num_iterations}: p ${p.id} has types`, p_type);
        
        if(p_type.some(t => t.type === "interior")) {
          log(`${p.id} is interior`);
          // p is interior point
          // report as intersection
          //intersection_points.push(p); // reported in checkIntersection
          // get the segments for the intersection; find first
          const ids = p_type.map(t => t.id);
          const i0 = S.findIndex(elem => elem.id === ids[0]);
          const i1 = S.findIndex(elem => elem.id === ids[1]);
          const i = Math.min(i0, i1);
          log(`i is ${i}. (${ids[0]}: ${i0}, ${ids[1]}: ${i1})`);
          
          if(i >= 0) {
            // swap
            const s0 = S[i0];
            const s1 = S[i1];
            S[i0] = s1;
            S[i1] = s0;
          
            log(`S (length ${S.length})`, [...S]);
            this._checkIntersection(i - 1, i, P, S, p.y, intersection_points)             
            this._checkIntersection(i + 1, i + 2, P, S, p.y, intersection_points) 
          }
        
        } else {
          p_type.sort((a, b) => a.type === "top" ? 1 : -1);
          p_type.forEach((id, type) => {
            console.log(`\n`);
            const s = p.segments.get(id);
            
            log(`Segment ${s.id} is ${value}`, s);
            log(`P (length ${P.length})`, [...P]);
            log(`S (length ${S.length})`, [...S]);
          
            if(type === "top") {
              log(`${p.id} is top`);
              // p is the top point for the segment
              S.push(s)
              S = sortS(S, p.y);
              log(`S (length ${S.length})`, [...S]); 
              const i = S.findIndex(elem => elem.id === s.id);
              log(`i is ${i}`);
            
              this._checkIntersection(i - 1, i, P, S, p.y, intersection_points)             
              this._checkIntersection(i, i + 1, P, S, p.y, intersection_points)
            
              // add end point to P
              if(!P.includes(bottom_p)) { P.push(bottom_p); }
              P.sort(compareP); 
            
            } else if(type === "bottom") {
              log(`${p.id} is bottom`);
              // p is the bottom point for the segment
              // Remove the segment from S
              const i = S.findIndex(elem => elem.id === s.id);
              log(`i is ${i}`);
              S.splice(i, 1);
              log(`S (length ${S.length})`, [...S]);
              this._checkIntersection(i - 1, i, P, S, p.y, intersection_points)
            
            } // if(type === "top")
          
          }); // p_type.forEach((id, type) 
          
        } //  if(p_type.some(t => t.type === "interior")
        
      } // while(P.length > 0)

      return intersection_points;
    }
    
    _checkIntersection(idx1, idx2, P, S, sweep_y, intersection_points) {
      log(`idx1: ${idx1}; idx2: ${idx2}; S is length ${S.length}; sweep_y: ${sweep_y}`);
      if(idx1 < 0 || idx2 < 0 || idx1 >= S.length || idx2 >= S.length) { return; }
    
      const s1 = S[idx1];
      const s2 = S[idx2];
      
      // if the segments share a vertex they do not intersect
      if(s1.A.equals(s2.A) || s1.A.equals(s2.B) || s1.B.equals(s2.A) || s1.B.equals(s2.B)) { return; }
      
      const intersect_p = this._getIntersectionPoint(s1, s2, P, sweep_y);
      log(`testing intersection ${s1.id}, ${s2.id}`);
      log(`intersect_p is ${intersect_p?.x}, ${intersect_p?.y}`);

 
      if(intersect_p) {
        const intersection_already_found = intersection_points.some(elem => { return elem.equals(intersect_p); });     
        if(intersection_already_found) {
          log(`intersection ${intersect_p?.x}, ${intersect_p?.y} already found.`);
          return;
        }   
        // add the segments for later reference
        const compareP = function(a, b) {
          // a and b are Vertex points
          // y increases top --> bottom
          // if a.y == b.y, tiebreaker goes to leftmost x
          if(almostEqual(a.y, b.y, 1e-5)) {
            return almostEqual(a.x, b.x, 1e-5) ? 0 :
                   a.x < b.x ? 1 : -1;
          }        

          return a.y < b.y ? 1 : -1;
        }

//      const intersect_in_P = P.some(elem => { return elem.equals(intersect_p); });
//      if(intersect_in_P) return undefined; // already found
      

        intersect_p.segments.set(s1.id, s1);
        intersect_p.segments.set(s2.id, s2); 
        P.push(intersect_p);
        P.sort(compareP); 
        intersection_points.push(intersect_p);
      } 
    }
    
    _getIntersectionPoint(s1, s2, P, sweep_y) {
      const intersect_p = s1.intersectSegment([s2.A.x, s2.A.y, s2.B.x, s2.B.y]);
      if(!intersect_p) return undefined;
      if(intersect_p.y < sweep_y) return undefined; // above the sweep line
       
      return Vertex.fromPoint(intersect_p);

    }    
     
} 
