import { MODULE_ID, log } from "./module.js";
import { orient2d } from "./lib/orient2d.min.js";

// https://htmlcolorcodes.com/
export const COLORS = {
  orange: 0xFFA500,
  yellow: 0xFFFF00,
  greenyellow: 0xADFF2F,
  blue: 0x0000FF,
  lightblue: 0xADD8E6,
  red: 0xFF0000,
  gray: 0x808080,
  black: 0x000000,
  white: 0xFFFFFF
}

// tints from dark to light
// 10 total; #11 would be white. 
export const TINTS = {
  blue: [ 0x0000FF,
          0x1919FF,
          0x3232FF,
          0x4c4cFF,
          0x6666FF,
          0x7f7FFF,
          0x9999FF,
          0xB2B2FF,
          0xCCCCFF,
          0xE5E5FF]
}

/*
 * Test if two numbers are almost equal, given a small error window.
 * From https://www.toptal.com/python/computational-geometry-in-python-from-theory-to-implementation
 */
export function almostEqual(x, y, EPSILON = 1e-5) {
  return Math.abs(x - y) < EPSILON;
}

/*
 * Round a number to specified number of decimal places.
 * from: https://stackoverflow.com/questions/7342957/how-do-you-round-to-1-decimal-place-in-javascript
 * @param {Number} value      Number to round
 * @param {Number} precision  Number of decimal places to use.
 * @return {Number} The rounded number
 */
export function round(value, precision) {
    const multiplier = Math.pow(10, precision || 0);
    return Math.round(value * multiplier) / multiplier;
}
 
/*
 * Round points before getting orientation
 * orient2d is robust, but it cannot fix problems with points that crop up prior
 *   to getting to orient2d.
 * Simple solution here is to round the points, despite the slight performance penalty.
 * @param 
 */
export function orient2drounded(ax, ay, bx, by, cx, cy, PRECISION = 8) {
  return orient2d(round(ax, PRECISION), 
                  round(ay, PRECISION),
                  round(bx, PRECISION),
                  round(by, PRECISION),
                  round(cx, PRECISION),
                  round(cy, PRECISION));
}

/*
 * Get first or second value from a Map
 */
export function FirstMapValue(m) { return m.values().next().value }
export function SecondMapValue(m) { 
  const iter = m.values();
  iter.next();
  return iter.next().value;
}

/* 
 * Helper function to convert absolute increments to grid distance
 */
export function toGridDistance(increment) {
  // TO-DO: What about hex or no grid maps? 
  return Math.round(increment * canvas.grid.w / canvas.scene.data.gridDistance * 100) / 100;
}

// ----- TERRAIN LAYER ELEVATION ----- //
export function TerrainElevationAtPoint(p) {
  if(!game.modules.get("enhanced-terrain-layer")?.active) {
    return(0);
  }
  
  // modified terrainAt to account for issue: https://github.com/ironmonk88/enhanced-terrain-layer/issues/38
   const terrain_layer = canvas.layers.filter(l => l?.options?.objectClass?.name === "Terrain")[0];
   const hx = canvas.grid.w / 2;
   const hy = canvas.grid.h / 2;
   const shifted_x = p.x + hx;
   const shifted_y = p.y + hy;
        
   let terrains = terrain_layer.placeables.filter(t => {
     const testX = shifted_x - t.data.x;
     const testY = shifted_y - t.data.y;
     return t.shape.contains(testX, testY);
   });
   
   if(terrains.length === 0) return 0; // default to no elevation change at point without terrain.
   
   // get the maximum non-infinite elevation point using terrain max
   // must account for possibility of 
   // TO-DO: Allow user to ignore certain terrain types?
   let terrain_max_elevation = terrains.reduce((total, t) => {
     if(!isFinite(t.max)) return total;
     return Math.max(total, t.max);
   }, Number.NEGATIVE_INFINITY);
   
   // in case all the terrain maximums are infinite.
   terrain_max_elevation = isFinite(terrain_max_elevation) ? terrain_max_elevation : 0;
   
   log(`TerrainElevationAtPoint: Returning elevation ${terrain_max_elevation} for point ${p}`, terrains);
   
   return terrain_max_elevation;
}

/**
 * For a given point, cycle through controlled tokens and find the highest;
 *   use for elevation.
 */
export function TokenElevationAtPoint(p) {
  const tokens = retrieveVisibleTokens();
  
  const max_token_elevation = tokens.reduce((total, t) => {
    // is the point within the token control area? 
    if(!pointWithinToken(p, t)) return total;
    return Math.max(t.data.elevation, total);
  }, Number.NEGATIVE_INFINITY) || Number.NEGATIVE_INFINITY;
  
  if(max_token_elevation === Number.NEGATIVE_INFINITY) return undefined;
  
  return max_token_elevation;
}


/**
 * Check if point is within the controlled area of the token
 * (Recall that tokens may be wider than 1 square)
 */
function pointWithinToken(point, token) {
  return point.x >= token.x && 
         point.y >= token.y &&
         point.x <= (token.x + token.w) &&
         point.y <= (token.y + token.h); 
}

/**
 * Retrieve visible tokens
 * For GM, all will be visible unless 1 or more tokens are selected.
 * Combined vision for all tokens selected.
 */
function retrieveVisibleTokens() {
  return canvas.tokens.children[0].children.filter(c => c.visible);
}


