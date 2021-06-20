/* 
 * Helper function to convert absolute increments to grid distance
 */
export function toGridDistance(increment) {
  // TO-DO: What about hex or no grid maps? 
  return Math.round(increment * canvas.grid.w / canvas.scene.data.gridDistance * 100) / 100;
}

// ----- TERRAIN LAYER ELEVATION ----- //
export function TerrainElevationAtPoint(p) {
  if(!game.settings.get(MODULE_ID, "enable-terrain-elevation") || !game.modules.get("enhanced-terrain-layer")?.active) {
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
