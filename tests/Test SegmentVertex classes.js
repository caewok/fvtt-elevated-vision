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
s1.draw();