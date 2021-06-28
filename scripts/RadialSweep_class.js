import { log, MODULE_ID } from "./module.js";
import { COLORS, orient2drounded } from "./utility.js";
import { orient2d } from "./lib/orient2d.min.js";

// Class to track a radial sweep from vision point clockwise 360 degrees.
export class RadialSweep {
  constructor(vision_point, vision_elevation, marker = {}, debug = false) {
    this.clear();
    this.debug = debug;
    this.vision_point = vision_point;
    this.marker = marker;
    this.vision_elevation = vision_elevation;
  }
  
 /*
  * maximum distance we might need to extend a Ray
  * @type {Number}
  */
  get max_distance() {
    if(this._max_distance === undefined) this._max_distance = new Ray({ x: 0, y: 0 }, 
                               { x: canvas.dimensions.sceneWidth, 
                                 y: canvas.dimensions.sceneHeight }).distance;
    return this._max_distance;
  }
  
 /*
  * Clear the sweep if re-using for some reason.
  */
  clear() { 
    this.walls = new Map();
    this.closest = undefined;
  } 
  
 /*
  * Starts the sweep.
  * Must locate any segments that intersect the starting sweep and add them
  * to walls. My strong hypothesis is that if a shape does not intersect the 
  * starting point, the only way it could be closest is if it has a left-most
  * vertex later in the sweep. 
  * TO-DO: Does the closest segment need to be split along the intersect?
  * TO-DO: It seems wasteful to check every segment, but how to limit?
  * @param {Array|Map[Segments]} segments Segments to check.
  */
  start(segments) {
    // starting ray is straight left from vision point
    const coords = [this.vision_point.x, this.vision_point.y, 
                    0, this.vision_point.y];
    
    const intersecting_segments = [];
    segments.forEach(s => {
      if(s.intersectSegment(coords)) intersecting_segments.push(s);
    });
    
    if(intersecting_segments.length === 0) return;
    log(`radialSweep: Checking ${intersecting_segments.length} intersecting segments from point ${this.vision_point.x}, ${this.vision_point.y} with elevation ${this.vision_elevation}`, intersecting_segments);

    this.closest = RadialSweep.closestBlockingSegmentToPoint(intersecting_segments,
                     this.vision_point, this.vision_elevation);

    if(this.closest) {
      this.walls.set(this.closest.id, this.closest);
      log(`radialSweep: Adding segment ${this.closest.id} as closest`, this.closest);
    }

  }
    
 /*
  * Primary method to increment the sweep
  * @param {Vertex} vertex  Point to test for the sweep.
  */ 
  nextVertex(vertex) {
    log(`RadialSweep: vertex ${vertex.id}`);
  
    this.updateWallTracking(vertex);
    const new_closest = RadialSweep.closestBlockingSegmentToPoint([...this.walls.values()], this.vision_point, this.vision_elevation) || this.closest;
    log(`RadialSweep: new closest is ${new_closest?.id}; prior closest is ${this.closest?.id}`, new_closest, this.closest);
    if(!this.closest) this.closest = new_closest;
    
    this.markClosest(new_closest, vertex);
    
    this.closest = new_closest; 
    
    if(this.debug) {
      // make lighter to signify complete
      canvas.controls.debug.lineStyle(1, COLORS.lightblue, .25).moveTo(this.vision_point.x, this.vision_point.y).lineTo(vertex.x, vertex.y);
    }
  }
  
 /*
  * Signify completion by marking the last segment if needed, and clear.
  * (cannot do automatically b/c we don't know how many vertices there are)
  */
  complete() {
    if(this.closest) {
      const v_label = this.closest.ccw(this.vision_point) ? "B" : "A";
      this.closest.mergePropertyAtSplit(this.closest[v_label], this.marker);
    }
    this.clear();
  }
  
 /*
  * Compare the new closest segment with the previous closest segment.
  * Mark the frontmost segment or segment portion with the property.
  * @param {Segmnent} current    The new closest segment.
  * @param {Vertex} vertex       Vertex or {x, y} point we are testing.
  *
  * Internal params:
  * @param {Segment} prior       The previous closest segment.
  * @param {PIXI.Point} vision_point   Vision point in {x, y} format.
  * @param {Object} property     Property object to merge when marking the closest.
  */
  markClosest(current, vertex) {
    const prior = this.closest;
    log(`markClosest: current is ${current?.id}; prior is ${prior?.id}`, current, prior, vertex, this.marker);   
    if(!current) return; // nothing found
    if(current.id === prior.id) return; // nothing changed
  
  
    // we have switched the closest wall segment
    // mark prior segment, which was blocking up until now
  
    // If the current vertex is at the end of the prior, then simply mark the prior.
    if(prior.hasEndpoint(vertex)) {
      // may or may not have been split earlier
      log(`markClosest: marking ${prior.id}`);
      prior.mergePropertyAtSplit(vertex, this.marker);
    } else {
      // If the current vertex is not at the end of the closest, then may need to split.
      // Mark the prior portion as blocking
      // Locate the intersection: origin (vision_point) --> vertex (on current) --> prior
      const rayOV = new Ray(this.vision_point, vertex);
      const rayOV_extended = new Ray(this.vision_point, rayOV.project(this.max_distance));
      const intersection = rayOV_extended.intersectSegment([ prior.A.x, 
                                                             prior.A.y,
                                                             prior.B.x,
                                                             prior.B.y ]);                               
    
      if(intersection) {
        log(`markClosest: splitting and marking ${prior.id} at ${intersection.x}, ${intersection.y}`); 
        prior.splitAt(intersection);
        prior.mergePropertyAtSplitWithVision(intersection, this.vision_point, this.marker);
      } else {
        // likely situation where we have jumped to another segment
        // intersection point would be the edge of the canvas or the edge of the los
        // TO-DO: is it sufficient to simply mark prior segment without splitting? 
        log(`markClosest: intersection is false when testing vertex ${vertex.id} and prior ${prior.id}`, rayOV, rayOV_extended, prior);
      
        // need the correct vertex -- the one to the right
        // if ccw, then B is to the left; otherwise B is to the right
        const v_label = prior.ccw(this.vision_point) ? "B" : "A";
        prior.mergePropertyAtSplit(prior[v_label], this.marker);
      }
    }
  
    // If we have moved to the middle of the current segment, then need to split
    if(!current.hasEndpoint(vertex)) {
      // Locate the intersection: origin (vision_point) --> vertex --> current 
      const rayOV = new Ray(this.vision_point, vertex);
      const rayOV_extended = new Ray(this.vision_point, rayOV.project(this.max_distance));
      const intersection = rayOV_extended.intersectSegment([ current.A.x, 
                                                             current.A.y,
                                                             current.B.x,
                                                             current.B.y ]); 
     
      if(intersection) {
        log(`markClosest: splitting current ${current.id} at ${intersection.x}, ${intersection.y}`); 
        current.splitAt(intersection);
      } else {
        console.error(`${MODULE_ID}|markClosest: intersection is false when testing vertex ${vertex.id} and current ${current.id}`, rayOV);
        // unclear how this could happen...
      }
    }
  
    return;
  }
  
 /*
  * Internal function to update the wall tracking given a vertex.
  * Typically called by nextVertex method.
  * @param {Vertex} vertex  Point to test for the sweep.
  */
  updateWallTracking(vertex) {
    const wall_ids_to_remove = [];
    const wall_ids_to_add = [];
    vertex.segments.forEach(s => {
      this.walls.has(s.id) ? wall_ids_to_remove.push(s.id) : wall_ids_to_add.push(s.id);
    });

    wall_ids_to_remove.forEach(id => { this.walls.delete(id); });
    wall_ids_to_add.forEach(id => { this.walls.set(id, vertex.segments.get(id)); });

    log(`radialSweep: tracking ${this.walls.size} walls`, [...this.walls.keys()]);
    if(this.debug) {
      this.walls.forEach(s => {
        s.draw(COLORS.gray);
      });
    }
  }
  
  
 /*  
  * Helper function to sort vertices by left-to-right by relative orientation to a point.
  * @param {PIXI.Point} vision_point  Point by which to order vertices, in {x, y} format
  * @param {Array[Vertex]} vertices Array of vertices to sort.
  * @return {Array[Vertex]} Array of sorted vertices, where element 0 is leftmost.
  */
  static sortVertices(vision_point, vertices) { 
    return vertices.sort((a, b) => {
      // arbitrarily declare upper hemisphere to be first
      // so x < vision_point (above) is before x > vision_point (below)
      // walk quadrants, so Q1 is upper left, Q3 is lower right
      // return > 0 to sort b before a
      if(a.y >= vision_point.y && b.y < vision_point.y) return 1;
      if(a.y < vision_point.y && b.y >= vision_point.y) return -1;
      
      // in same hemisphere      
      return orient2d(vision_point.x, vision_point.y, 
                  a.x, a.y,
                  b.x, b.y);
    });
  }
  
 /*
  * Helper function to determine the closest blocking segment to an elevated vision point.
  * To determine the closest segment w/o/r/t elevation, leave Ve undefined.
  * @param {Array[Segments]} segments  Segments to test against the point.
  * @param {PIXI.Point} p              Point in {x,y} format to test.
  * @param {Number} Ve                 Elevation of p.
  * @return {Segment} Closest blocking segment or undefined if none
  */
  static closestBlockingSegmentToPoint(segments, p, Ve) {
    //log(`closestBlocking: segments`, segments);
    return segments.reduce((acc, current) => {
      // [...walls] will break the Map into [0] id and [1] object
      //log(`Reducing walls: acc, current`, acc, current);
      //log(`closestBlockingSegmentToPoint: Segment ${current.id} has elevation ${current.properties.elevation} compared to ${Ve}`, current, acc);
      if(Ve && current.properties.elevation <= Ve) return acc; // current doesn't block
      if(acc === undefined) return current;
      if(current.inFrontOf(acc, p)) return current;
      return acc;
    }, undefined);
  }

}
