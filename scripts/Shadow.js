/* globals
PIXI,
Ray
*/
"use strict";

import { perpendicularPoint, distanceBetweenPoints } from "./util.js";

export class Shadow extends PIXI.Polygon {

  /**
   * Build the parallelogram representing a shadow cast from a wall.
   * Looking top-down with a light or other source object at a given elevation
   * above a wall.
   * @param {Wall} w
   * @param {LightSource} source
   * @return {Shadow}
   */
  static constructShadow(wall, source) {
    /*
     Looking at a cross-section:
      V----------T----------?
      | \ Ø      |    |
    Ve|    \     |    |
      |       \  |    |
      |          \    |
      |        Te|  \ | <- point O where obj can be seen by V for given elevations
      ---------------------
      |<-   VOd      ->|
     e = height of V (vision object)
     Ø = theta
     T = terrain wall

     Looking from above:
                  •
                 /| 𝜶 is the angle VT to VT.A
              •/ -|
             /|   |
           /  | S | B
         /    |   |
       /   B  |   |
     V -------T---• O
     (and mirrored on bottom)
     S = shadow area
     B = bright area

    */
    let Te = wall.elevation;
    let Oe = 0; // TO-DO: allow this to be modified by terrain elevation
    let Ve = source.elevation;
    if ( Ve <= Te ) return null; // Vision object blocked completely by wall

    // Need the point of the wall that forms a perpendicular line to the vision object
    const vtB = perpendicularPoint(wall.A, wall.B, source);
    if ( !vtB ) return null; // Line collinear with vision object
    const vt = new Ray(source, vtB);

    // If any elevation is negative, normalize so that the lowest elevation is 0
    const min_elevation = Math.min(Ve, Oe, Te);
    if ( min_elevation < 0 ) {
      const adder = Math.abs(min_elevation);
      Ve = Ve + adder;
      Oe = Oe + adder;
      Te = Te + adder;
    }

    // Theta is the angle between the 3-D sight line and the sight line in 2-D
    const theta = Math.atan((Ve - Te) / vt.distance); // Theta is in radians
    const TO_dist = (Te - Oe) / Math.tan(theta); // Tan wants radians

    // Alpha is the angle between V|T and V|wall.A or V|wall.B
    const distA = distanceBetweenPoints(wall.A, vt.B);
    const distB = distanceBetweenPoints(wall.B, vt.B);
    const alphaA = Math.atan(distA / TO_dist);
    const alphaB = Math.atan(distB / TO_dist);

    // Get the hypotenuse size to extend a line from V past wall T at endpoint,
    // given angle alpha.
    // Should form the parallelogram with wall T on one parallel side
    const hypA = vt.distance / Math.cos(alphaA);
    const hypB = vt.distance / Math.cos(alphaB);

    const rayVA = (new Ray(source, wall.A)).project(hypA);
    const rayVB = (new Ray(source, wall.B)).project(hypB);

    const shadow = new this.constructor([wall.A, rayVA.B, rayVB.B, wall.B]);

    // Cache some values
    shadow.wall = wall;
    shadow.source = source;
    shadow.vt = vt;
    shadow.theta = theta;
    shadow.alpha = { A: alphaA, B: alphaB };

    return shadow;
  }
}
