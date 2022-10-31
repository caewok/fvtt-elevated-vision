/* globals
PIXI,
Ray,
canvas,
ClipperLib
*/
"use strict";

import { perpendicularPoint, distanceBetweenPoints } from "./util.js";
import { COLORS, drawShape } from "./drawing.js";

/* Rules for shadows and line-of-sight

Light (and sound)

Top of wall:
1. If the light is lower in elevation than the top of the wall, the wall blocks.
2. If the light is equal in elevation to the top of the wall, the wall blocks.
   (So the default can be 0 elevation walls and 0 elevation tokens, and walls block.)
3. If the light is higher in elevation than the top of the wall, the wall
   creates a shadow opposite the wall. The shadow is a parallelogram whose angled
   edges correspond to the line between the source origin and the endpoints of the wall.

Bottom of wall:
At the moment, bottom of walls are ignored. If the wall does not reach the elevation
level of a light, the wall does not block the light.

Ultimately, we might let light in, basically reversing the shadow.
1. If wall bottom is lower in elevation than the light but not equal or below terrain elevation,
   the wall blocks some of the light. The side opposite the light has a parallelogram
   that is bright light up until some distance at which the wall blocks.
2. If the wall bottom is equal or greater in elevation than the light, it creates no effect (blocks light).

GM can decide whether shadows are bright light (decoration only), dim light, or no light.


Tokens
1. Token height governed by the settings in wall-height.
2. Token vision is assumed to be from the top of the token.
3. Tokens must have line of sight to the bottom or top of a token without that line of sight
   intersecting one or more walls.
4. Token line of sight polygon created by ignoring walls that do not impact the token

(3) is subtly different than what Wall Height is doing. Wall Height lets a token ignore a
wall if that wall is lower than the token vision. Instead, (3) means that a token might
be unable to traverse a wall or see past it, but may see an object that is sufficiently
large or sufficiently high.

So Token los polygon should have holes for shadows unless .

In addition, use Token.isVisible and canvas.sight.testVisibility to determine if a token
is visible with respect to some other based on elevation and collision test.
So a token may be visible if:
1. It is not "in shadow", meaning it is within los of a light before considering shadows
   and is "above" the shadow.
2. It is in shadow but token has fov b/c dimSight. Note that unlimited vision is an issue
   here. Arguably should have shadow areas only seen by dimSight regardless of unlimited.
   Would be nice for GM to have option to change how this works.
3. It is not in shadow at all and otherwise visible

--> Approach for tokens to use shadows:
- Render LOS accounting for wall heights. Walls below token block visual LOS
- Need LOS + lighting not in shadow (unless dimsight?)

*/

export class Shadow extends PIXI.Polygon {

  constructor(...points) {
    super(...points);

    // Round to nearest pixel to avoid some visual artifacts when joining shadows
    this.points = this.points.map(val => Math.round(val));

    if ( !this.isClosed ) {
      const ln = this.points.length;
      this.addPoint({ x: this.points[ln - 2], y: this.points[ln -1] });
    }
  }

  /**
   * Build the parallelogram representing a shadow cast from a wall.
   * Looking top-down with a light or other source object at a given elevation
   * above a wall.
   * @param {Wall} w
   * @param {LightSource} source
   * @return {Shadow}
   */
  static constructShadow(wall, source, surfaceElevation = 0) {
    /*
     Looking at a cross-section:
      V----------T----O-----?
      | \ Ø      |    |
    Ve|    \     |    |
      |       \  |    |
      |          \    |
      |        Te|  \ | <- point O where obj can be seen by V for given elevations
      ----------------•----
      |<-   VO      ->|
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
       / 𝜶  B |   |
     V -------T---• O
     (and mirrored on bottom)
     S = shadow area
     B = bright area

     naming:
     - single upper case: point. e.g. V
     - double upper case: ray/segment. e.g. VT
     - lower case: descriptor. e.g., Ve for elevation of V.

    */

    // Note: elevation should already be in grid pixel units
    let Oe = surfaceElevation;
    let Te = wall.topZ; // TO-DO: allow floating walls to let light through the bottom portion
//     let Oe = 0; // TO-DO: allow this to be modified by terrain elevation
    let Ve = source.elevationZ;
    if ( Ve <= Te ) return null; // Vision object blocked completely by wall

    // Need the point of the wall that forms a perpendicular line to the vision object
    const Tix = perpendicularPoint(wall.A, wall.B, source);
    if ( !Tix ) return null; // Line collinear with vision object
    const VT = new Ray(source, Tix);

    // If any elevation is negative, normalize so that the lowest elevation is 0
    const min_elevation = Math.min(Ve, Oe, Te);
    if ( min_elevation < 0 ) {
      const adder = Math.abs(min_elevation);
      Ve = Ve + adder;
      Oe = Oe + adder;
      Te = Te + adder;
    }

    // Theta is the angle between the 3-D sight line and the sight line in 2-D
    const theta = Math.atan((Ve - Te) / VT.distance); // Theta is in radians
    const TOdist = (Te - Oe) / Math.tan(theta); // Tan wants radians
    const VOdist = VT.distance + TOdist;

    /* Testing
    // Ray extending out V --> T --> O
    api.drawing.drawPoint(source, {color: api.drawing.COLORS.yellow})

    VO = Ray.towardsPoint(source, Tix, VOdist)
    api.drawing.drawPoint(VO.B, {color: api.drawing.COLORS.lightblue})
    */

    // We know the small triangle on each side:
    // V --> T --> wall.A and
    // V --> T --> wall.B
    // We need the larger encompassing triangle:
    // V --> O --> ? (wall.A side and wall.B side)

    // Get the distances between Tix and the wall endpoints.
    const distA = distanceBetweenPoints(wall.A, Tix);
    const distB = distanceBetweenPoints(wall.B, Tix);


    /* Testing
    // Ray extending Tix --> Wall.A
    rayTA = new Ray(wall.A, Tix);
    rayTA.distance

    rayTB = new Ray(wall.B, Tix);
    rayTB.distance;
    */

    // Calculate the hypotenuse of the big triangle on each side.
    // That hypotenuse is used to extend a line from V past each endpoint.
    // First get the angle
    const alphaA = Math.atan(distA / VT.distance);
    const alphaB = Math.atan(distB / VT.distance);

    // Now calculate the hypotenuse
    const hypA = VOdist / Math.cos(alphaA);
    const hypB = VOdist / Math.cos(alphaB);

    // Extend a line from V past wall T at each endpoint.
    // Each distance is the hypotenuse ont he side.
    // given angle alpha.
    // Should form the parallelogram with wall T on one parallel side
    const VOa = Ray.towardsPoint(source, wall.A, hypA);
    const VOb = Ray.towardsPoint(source, wall.B, hypB);

    /* Testing
    // Rays extending V --> T.A or T.B --> end of shadow
    api.drawing.drawSegment(VOa, {color: api.drawing.COLORS.green})
    api.drawing.drawSegment(VOb, {color: api.drawing.COLORS.orange})
    api.drawing.drawSegment({A: VOa.B, B: VOb.B}, {color: api.drawing.COLORS.gray})
    */

    const shadow = new this([wall.A, VOa.B, VOb.B, wall.B]);

    /* Testing
    api.drawing.drawShape(shadow)
    */

    // Cache some values
    shadow.wall = wall;
    shadow.source = source;
    shadow.VT = VT;
    shadow.theta = theta;
    shadow.alpha = { A: alphaA, B: alphaB };

    return shadow;
  }

  /**
   * Intersect this shadow against a polygon and return a new shadow.
   * Copy relevant data from this shadow.
   * Used primarily to intersect against the sweep.
   */
  intersectPolygon(poly) {
    // Cannot rely on the super.intersectPolygon because we need to retrieve all the holes.
    const solution = this.clipperClip(poly, { cliptype: ClipperLib.ClipType.ctIntersection });

    return solution.map(pts => {
      const polyIx = PIXI.Polygon.fromClipperPoints(pts);
      const model = new this.constructor();
      Object.assign(model, polyIx);

      model.wall = this.wall;
      model.source = this.source;
      model.VT = this.VT;
      model.theta = this.theta;
      model.alpha = this.alpha;

      return model;
    });
  }

  /**
   * Draw a shadow shape on canvas. Used for debugging.
   * Optional:
   * @param {HexString} color   Color of outline shape
   * @param {number} width      Width of outline shape
   * @param {HexString} fill    Color used to fill the shape
   * @param {number} alpha      Alpha transparency between 0 and 1
   */
  draw({ color = COLORS.gray, width = 1, fill = COLORS.gray, alpha = .5 } = {} ) {
    canvas.controls.debug.beginFill(fill, alpha);
    drawShape(this, { color, width });
    canvas.controls.debug.endFill();
  }
}
