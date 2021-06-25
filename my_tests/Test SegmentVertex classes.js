// for now, just use the console or an external source to run these

// Vertex creation
let Vertex = window["elevated-vision"].Vertex;
let v1 = new Vertex(100, 100);
let v2 = new Vertex(200, 200);
canvas.controls.debug.lineStyle(1, 0xFF0000).moveTo(v1.x, v1.y).lineTo(v2.x, v2.y);


// Segment creation
canvas.controls.debug.clear();
let Segment = window["elevated-vision"].Segment;
let s1 = new Segment({x: 100, y: 100}, {x:200, y: 200});
s1.draw(0xFF0000);

// Polygon creation
canvas.controls.debug.clear();
let TerrainPolygon = window["elevated-vision"].TerrainPolygon;
let p1 = new TerrainPolygon([100, 100, 100, 200, 200, 200, 200, 100, 100, 100]);
p1.drawPolygon(0xFF0000);
p1.draw(0xFF0000);

// from terrain
let terrain_layer = canvas.layers.filter(l => l?.options?.objectClass?.name === "Terrain")[0];
let terrains = terrain_layer.placeables; // array of terrains
let terrain_polygons = terrains.map(t => {
  return TerrainPolygon.fromObject(t.data);
});
log(`Transformed ${terrain_polygons.length} terrains`, terrain_polygons);

terrain_polygons.forEach(p => {
  p.draw(0xFF0000);
})
