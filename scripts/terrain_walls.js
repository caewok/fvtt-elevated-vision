/* globals
CONST,
foundry,
PIXI,
canvas
*/
"use strict";

import { Point3d } from "./geometry/3d/Point3d.js";
import { Plane } from "./geometry/3d/Plane.js";
import { ShadowProjection } from "./geometry/Shadow.js";


// Given a point source and a terrain wall, determine how much of that terrain wall
// blocks

// Possibly return multiple wall coordinates when walls of differing heights block

// CONST.WALL_RESTRICTION_TYPES

// Type should be "light" for lightSource, "sight" for visionSource, "move" for movementSource, "sound" for soundSource

/** Testing
let [l] = canvas.lighting.placeables
let [w] = canvas.walls.controlled
Point3d = CONFIG.GeometryLib.threeD.Point3d
ShadowProjection = CONFIG.GeometryLib.ShadowProjection
Plane = CONFIG.GeometryLib.threeD.Plane
Matrix = CONFIG.GeometryLib.Matrix

draw = new CONFIG.GeometryLib.Draw
COLORS = CONFIG.GeometryLib.Draw.COLORS



function drawWalls(source = _token.vision) {
  const draw = new CONFIG.GeometryLib.Draw;
  const COLORS = CONFIG.GeometryLib.Draw.COLORS;
  canvas.walls.placeables.forEach(w => {
    if ( isLimitedWallForSource(w, source) ) draw.segment(w, { color: COLORS.green});
    else  draw.segment(w, { color: COLORS.black });
  })
}



wallsBelowSource = l.source.los.wallsBelowSource

source = l.source
sourceOrigin = Point3d.fromPointSource(l.source)
potentialWalls = getPotentialBlockingWalls(w, sourceOrigin, "light") // This will be a Set
potentialWalls = [...potentialWalls]

terrainWallPoints = Point3d.fromWall(w)
blockingWallPoints = Point3d.fromWall(potentialWalls[1])


pt = CONFIG.GeometryLib.utils.perpendicularPoint(terrainWallPoints.A.top, terrainWallPoints.B.top, sourceOrigin)
camera = Matrix.lookAt(sourceOrigin, pt)

planePts = proj._shadowPointsForWallPoints(blockingWallPoints)

// On ground 0
blockingWallPoints = Point3d.fromWall(w)


proj = new ShadowProjection(new Plane(), l.source)
M = proj.shadowMatrix()
tmp = M.multiplyPoint3d(blockingWallPoints.A.top)
draw.point(tmp)

// ground -200
proj = new ShadowProjection(new Plane(new Point3d(0, 0, -200)), l.source)


// vertical wall
terrainWallPoints = Point3d.fromWall(wall)
plane = Plane.fromPoints(terrainWallPoints.A.top, terrainWallPoints.A.bottom, terrainWallPoints.B.bottom)
proj = new ShadowProjection(plane, l.source)
M = proj.shadowMatrix()
tmp = M.multiplyPoint3d(blockingWallPoints.A.top)
draw.point(tmp)

tmp = M.multiplyPoint3d(blockingWallPoints.B.top)
draw.point(tmp)

tmp = M.multiplyPoint3d(blockingWallPoints.A.bottom)
draw.point(tmp)

tmp = M.multiplyPoint3d(blockingWallPoints.B.bottom)
draw.point(tmp)

*/

/**
 * Build one or more sets of wall points for the given wall.
 * If the wall is limited, break into parts that block for that given source, if any.
 * @param {Wall} wall
 * @param {PointSource} source
 * @returns {object[]} Array of points from Point3d.fromWall, along with a reference to the wall for each point set.
 */
export function constructWallPoints(wall, source) {
  if ( !isLimitedWallForSource(wall, source) ) {
    const pts = Point3d.fromWall(wall);
    const out = [pts.A.top, pts.B.top, pts.B.bottom, pts.A.bottom];
    out.wall = wall;
    return [out];
  }

  return replaceTerrainWall(wall, source);
}


/**
 * Determine if the wall is restricted for the given source.
 * @param {Wall} wall
 * @param {PointSource} source
 * @returns {boolean} True if limited
 */
export function isLimitedWallForSource(wall, source) {
  let type;
  switch ( source.constructor.name ) {
    case "LightSource":
      type = "light";
      break;

    case "MovementSource":
      type = "move";
      break;

    case "SoundSource":
      type = "sound";
      break;

    case "VisionSource":
      type = "sight";
      break;

    default: return false;
  }

  return wall.document[type] === CONST.WALL_SENSE_TYPES.LIMITED;
}

/**
 * For a given terrain/limited wall, get shadows on the wall where walls between the terrain
 * and the source cause light to be blocked
 */
export function replaceTerrainWall(terrainWall, source) {
  const sourceOrigin = Point3d.fromPointSource(source);
  // Debug:
  // draw.point(sourceOrigin, { color: COLORS.yellow })

  const blockingWalls = getPotentialBlockingWalls(terrainWall, sourceOrigin);
  if ( !blockingWalls.size ) return [];

  const terrainWallPoints = Point3d.fromWall(terrainWall, { finite: true });
  const planeTW = Plane.fromWall(terrainWall);
  const proj = new ShadowProjection(planeTW, source);

  const replacements= [];
  for ( const blockingWall of blockingWalls ) {
    const newWallPoints = trimTerrainWall(terrainWallPoints, blockingWall, proj);
    if ( newWallPoints.length ) {
      newWallPoints.wall = blockingWall;
      replacements.push(newWallPoints);
    }
  }

  return replacements;
}

/**
 * Determine whether C is clockwise or counter-clockwise or collinear to AB.
 * @param {PIXI.Point} a
 * @param {PIXI.Point} b
 * @param {PIXI.Point} c
 * @returns {-1|0|1}
 */
function ccw(a, b, c) {
  return Math.sign(foundry.utils.orient2dFast(a, b, c));
}

/**
 * Given a terrain wall and a potentially blocking wall, determine
 * the shadow cast from the source by the blocking wall on the terrain wall's plane.
 * Then trim accordingly and return the shadow points.
 * @param {object} terrainWallPoints    Four Point3d for the terrain wall, as returned by Point3d.fromWall
 * @param {Wall} blockingWall   Four Point3d for the blocking wall, as returned by Point3d.fromWall
 * @param {ShadowProjection} proj       Shadow projection of the terrain wall given a point source.
 * @returns {object|null} The four Point3d for the shadow or null if none
 */
function trimTerrainWall(terrainWallPoints, blockingWall, proj) {
  const blockingWallPoints = Point3d.fromWall(blockingWall, { finite: true });

  // TODO: Can we lose these tests?
  if ( terrainWallPoints.A.top.z !== terrainWallPoints.B.top.z ) {
    console.error("trimTerrainWall terrainWallPoints top elevations differ.");
  }

  if ( terrainWallPoints.A.bottom.z !== terrainWallPoints.B.bottom.z ) {
    console.error("trimTerrainWall terrainWallPoints bottom elevations differ.");
  }

  if ( blockingWallPoints.A.top.z !== blockingWallPoints.B.top.z ) {
    console.error("trimTerrainWall blockingWallPoints top elevations differ.");
  }

  if ( blockingWallPoints.A.bottom.z !== blockingWallPoints.B.bottom.z ) {
    console.error("trimTerrainWall blockingWallPoints bottom elevations differ.");
  }

  // Test if the two cross or share an endpoint.
  // Can assume walls are vertical, so just test A|B cross
  // Assume blockingWall is C|D
  // V is the source / viewer
  const sourceOrigin = proj.sourceOrigin;
  const ccwCDV = ccw(blockingWallPoints.A.top, blockingWallPoints.B.top, sourceOrigin);
  if ( !ccwCDV ) return []; // Blocking wall and viewer are collinear

  const ccwABV = ccw(terrainWallPoints.A.top, terrainWallPoints.B.top, sourceOrigin);
  if ( !ccwABV ) return []; // Terrain wall and viewer are collinear

  const ccwABC = ccw(terrainWallPoints.A.top, terrainWallPoints.B.top, blockingWallPoints.A.top);
  const ccwABD = ccw(terrainWallPoints.A.top, terrainWallPoints.B.top, blockingWallPoints.B.top);

  if ( !(ccwABC || ccwABD) ) return []; // Walls are collinear

  const CInFront = ccwABV === ccwABC;
  const DInFront = ccwABV === ccwABD;

  if ( !(CInFront || DInFront) ) return []; // Blocking wall completely behind terrain wall from source

  if ( (!CInFront && ccwABC !== 0)
    || (!DInFront && ccwABD !== 0) ) {
    // C is on other side of terrain wall from D
    // Either they cross or cross but don't touch
    // Consider only the portion of CD in front of the terrainWall

    // Intersection A|B with C|D
    const ix = foundry.utils.lineLineIntersection(
      blockingWallPoints.A.top,
      blockingWallPoints.B.top,
      terrainWallPoints.A.top,
      terrainWallPoints.B.top
    );

    if ( !ix ) console.error("trimTerrainWall|No intersection found!");

    // Keep the front point; move the point that is behind to the intersection
    const changedPoint = CInFront ? blockingWallPoints.B : blockingWallPoints.A;
    changedPoint.top.x = ix.x;
    changedPoint.top.y = ix.y;
    changedPoint.bottom.x = ix.x;
    changedPoint.bottom.y = ix.y;
  }


  // If the terrain wall endpoint --> source intersects the blocking wall,
  //   we should be using that intersection point for the blocking wall.
  // Otherwise, we should use the existing blocking point.
  // This amounts to a left/right check.
  // Avoids situations where the blocking wall intersection with the terrain wall plane
  // is behind the source.
  if ( foundry.utils.lineSegmentIntersects(
    terrainWallPoints.A.top,
    sourceOrigin,
    blockingWallPoints.A.top,
    blockingWallPoints.B.top
    ) ) {

    const ix = foundry.utils.lineLineIntersection(
      terrainWallPoints.A.top,
      sourceOrigin,
      blockingWallPoints.A.top,
      blockingWallPoints.B.top
    );
    if ( !ix ) console.error("trimTerrainWall|No intersection found (2)!");

    const changedPoint = ccwABV === ccwCDV ? blockingWallPoints.A : blockingWallPoints.B;
    changedPoint.top.x = ix.x;
    changedPoint.top.y = ix.y;
    changedPoint.bottom.x = ix.x;
    changedPoint.bottom.y = ix.y;
  }

  if ( foundry.utils.lineSegmentIntersects(
    terrainWallPoints.B.top,
    sourceOrigin,
    blockingWallPoints.A.top,
    blockingWallPoints.B.top
    ) ) {

    const ix = foundry.utils.lineLineIntersection(
      terrainWallPoints.B.top,
      sourceOrigin,
      blockingWallPoints.A.top,
      blockingWallPoints.B.top
    );
    if ( !ix ) console.error("trimTerrainWall|No intersection found (2)!");

    const changedPoint = -ccwABV === ccwCDV ? blockingWallPoints.A : blockingWallPoints.B;
    changedPoint.top.x = ix.x;
    changedPoint.top.y = ix.y;
    changedPoint.bottom.x = ix.x;
    changedPoint.bottom.y = ix.y;
  }

  const ixPts = {
    A: {
      top: proj._intersectionWith(blockingWallPoints.A.top),
      bottom: proj._intersectionWith(blockingWallPoints.A.bottom)
    },

    B: {
      top: proj._intersectionWith(blockingWallPoints.B.top),
      bottom: proj._intersectionWith(blockingWallPoints.B.bottom)
    }
  };

  // Round before getting the intersection
  const PLACES = 4;
  ixPts.A.top.roundDecimals(PLACES);
  ixPts.A.bottom.roundDecimals(PLACES);
  ixPts.B.top.roundDecimals(PLACES);
  ixPts.B.bottom.roundDecimals(PLACES);

  const out = constrainWallPoints2(proj.plane, terrainWallPoints, ixPts);

  // Round to avoid numeric inconsistencies and to match endpoints when possible
  out.forEach(pt => pt.roundDecimals(PLACES));
  return out;
}

/**
 * Given a set of 4 planar wall points in 3d, contain a second set of planar points
 * within that planar shape.
 * The second quad should be trimmed to a new shape bounded by the first quad.
 * This may result in the second quad losing or gaining points.
 * Assumed, but not tested, that the second set of points share the same plane as the first.
 * Assumed, but not tested, that the two set of points are vertical on the canvas, like with walls.
 * @param {object} boundaryPoints   Point.fromWall output. Points that form a quad boundary.
 * @param {object} otherPoints      Point.fromWall output. Points to contain.
 * @returns {object} Array of points
 */
function constrainWallPoints(plane, boundaryPoints, otherPoints) {
  // Convert the points to the 2d plane
  const M = plane.conversion2dMatrix;
  const Minv = plane.conversion2dMatrixInverse;

  const bPts = [
    M.multiplyPoint3d(boundaryPoints.A.top),
    M.multiplyPoint3d(boundaryPoints.B.top),
    M.multiplyPoint3d(boundaryPoints.B.bottom),
    M.multiplyPoint3d(boundaryPoints.A.bottom)
  ];

  const oPts = [
    M.multiplyPoint3d(otherPoints.A.top),
    M.multiplyPoint3d(otherPoints.B.top),
    M.multiplyPoint3d(otherPoints.B.bottom),
    M.multiplyPoint3d(otherPoints.A.bottom)
  ];

  const boundaryPoly = new PIXI.Polygon(bPts);
  const otherPoly = new PIXI.Polygon(oPts);

  const ixPoly = boundaryPoly.intersectPolygon(otherPoly, { scalingFactor: 1000 })
  const pts3d = [];
  for ( const pt of ixPoly.iteratePoints({ close: false }) ) {
    pts3d.push(Minv.multiplyPoint3d(pt.to3d()))
  }

  return pts3d;
}

function constrainWallPoints2(plane, boundaryPoints, otherPoints) {
  // Convert the points to the 2d plane
  const bPts = [
    plane.to2d(boundaryPoints.A.top),
    plane.to2d(boundaryPoints.B.top),
    plane.to2d(boundaryPoints.B.bottom),
    plane.to2d(boundaryPoints.A.bottom)
  ];

  const oPts = [
    plane.to2d(otherPoints.A.top),
    plane.to2d(otherPoints.B.top),
    plane.to2d(otherPoints.B.bottom),
    plane.to2d(otherPoints.A.bottom)
  ];

  const boundaryPoly = new PIXI.Polygon(bPts);
  const otherPoly = new PIXI.Polygon(oPts);

  const ixPoly = boundaryPoly.intersectPolygon(otherPoly, { scalingFactor: 1000 })
  const pts3d = [];
  for ( const pt of ixPoly.iteratePoints({ close: false }) ) {
    pts3d.push(plane.to3d(pt));
  }

  return pts3d;
}

/* Test
// Comparable, but 2 is faster
N = 10000
await foundry.utils.benchmark(constrainWallPoints, N, proj.plane, terrainWallPoints, ixPts)
await foundry.utils.benchmark(constrainWallPoints2, N, proj.plane, terrainWallPoints, ixPts)

N = 10000
await foundry.utils.benchmark(constrainWallPoints2, N, proj.plane, terrainWallPoints, ixPts)
await foundry.utils.benchmark(constrainWallPoints, N, proj.plane, terrainWallPoints, ixPts)


*/



  /**
   * Convert a 3d point on the plane to 2d
   * https://math.stackexchange.com/questions/3528493/convert-3d-point-onto-a-2d-coordinate-plane-of-any-angle-and-location-within-the
   */
function to2d(pt, plane) {
    const { u, v } = plane.getVectorsOnPlane();
    const point = plane.point;

    const denom1 = (u.x * v.y) - (v.x * u.y);
    const denom2 = (u.x * v.z) - (v.x * u.z);
    const denom3 = (u.y * v.z) - (v.y * u.z);

    let numU;
    let numV;
    let denom;
    // Pick the largest magnitude denominator for numerical stability
    const absDenom1 = Math.abs(denom1);
    const absDenom2 = Math.abs(denom2);
    const absDenom3 = Math.abs(denom3);

    if ( absDenom1 > absDenom2 && absDenom1 && absDenom3) {
      denom = denom1;
      numU = (pt.x - point.x) * v.y - (pt.y - point.y) * v.x;
      numV = (pt.y - point.y) * u.x - (pt.x - point.x) * u.y;
    } else if ( absDenom2 > absDenom1 && absDenom2 > absDenom3 ) {
      denom = denom2;
      numU = (pt.x - point.x) * v.z - (pt.z - point.z) * v.x;
      numV = (pt.z - point.z) * u.x - (pt.x - point.x) * u.z;
    } else {
      denom = denom3;
      numU = (pt.y - point.y) * v.z - (pt.z - point.z) * v.y;
      numV = (pt.z - point.z) * u.y - (pt.y - point.y) * u.z;
    }

    return new PIXI.Point(numU / denom, numV / denom);
  }

  /**
   * Convert a 2d point in plane coordinates to a 3d point.
   * Inverse of to2d()
   */
function to3d(pt, plane) {
    const { u, v } = plane.getVectorsOnPlane();
    const point = plane.point;

    return new Point3d(
      point.x + (pt.x * u.x) + (pt.y * v.x),
      point.y + (pt.x * u.y) + (pt.y * v.y),
      point.z + (pt.x * u.z) + (pt.y * v.z)
    );
  }

/**
 * Return walls that might block between a source origin and a wall
 * @param {Wall} wall               Wall to test
 * @param {Point3d} sourceOrigin    Viewing point
 * @param {string} type             Type of wall restriction
 * @returns {Set<Wall>}
 */
function getPotentialBlockingWalls(wall, sourceOrigin, type = "sight") {
  if ( wall.document[type] !== CONST.WALL_SENSE_TYPES.LIMITED ) return [];

  // This is mostly the same as Area3d.prototype.filterWallsByVisionTriangle in ATV
  const viewableTriangle = new PIXI.Polygon([sourceOrigin.to2d(), wall.A, wall.B]);
  const bounds = viewableTriangle.getBounds();
  let walls = canvas.walls.quadtree.getObjects(bounds);
  walls = walls.filter(w => w.id !== wall.id && _testWallInclusion(w, bounds, sourceOrigin, type));

  // Filter by the precise triangle cone.
  const edges = [...viewableTriangle.iterateEdges()];
  walls = walls.filter(w => {
    if ( viewableTriangle.contains(w.A.x, w.A.y) || viewableTriangle.contains(w.B.x, w.B.y) ) return true;
    return edges.some(e => foundry.utils.lineSegmentIntersects(w.A, w.B, e.A, e.B));
  });
  return walls;
}

/**
 * Test whether a wall should be included as potentially blocking from point of view of
 * token.
 * Comparable to ClockwiseSweep.prototype._testWallInclusion
 * @param {Wall} wall               Wall to test
 * @param {PIXI.Rectangle} bounds   Boundary rectangle
 * @param {Point3d} sourceOrigin    Viewing point
 * @param {string} type             Type of wall restriction
 * @returns {Set<Wall>}
 */
function _testWallInclusion(wall, bounds, sourceOrigin, type = "sight") {
  // First test for inclusion in our overall bounding box
  if ( !bounds.lineSegmentIntersects(wall.A, wall.B, { inside: true }) ) return false;

  // Ignore walls that do not block this type
  if ( !wall.document[type] || wall.isOpen ) return false;

  // Ignore walls that are in line with the viewer and target
  if ( !foundry.utils.orient2dFast(sourceOrigin, wall.A, wall.B)
    && !foundry.utils.orient2dFast(sourceOrigin, wall.A, wall.B) ) return false;

  // Ignore one-directional walls facing away from the origin
  const side = wall.orientPoint(sourceOrigin);
  return !wall.document.dir || (side !== wall.document.dir);
}
