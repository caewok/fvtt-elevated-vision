/* globals
*/
"use strict";

/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */


// GraphVertex, GraphEdge, and Graph initially based on
// https://github.com/trekhleb/javascript-algorithms/tree/master/src/data-structures/graph

/**
 * Vertex of an undirected graph.
 */
export class GraphVertex {
  #edges = new Set();

  /** @type {*} */
  value;

  /**
   * @param {*} value     A unique value representing this vertex.
   *                      Typically a string, but may be a number or object.
   */
  constructor(value) {
    if ( typeof value === "undefined" ) throw new Error("Graph vertex must have a value");
    this.value = value;
  }

  /**
   * @param { GraphEdge }
   * @returns { GraphVertex }
   */
  addEdge(edge) {
    this.#edges.add(edge);
    return this;
  }

  /**
   * @param {GraphEdge} edge
   */
  deleteEdge(edge) {
    this.#edges.delete(edge);
  }

  /**
   * @type {GraphVertex[]}
   */
  get neighbors() {
    const edges = [...this.#edges];
    const neighborsConverter = edge => edge.otherVertex(this);
    return edges.map(neighborsConverter);
  }

  /** @type {GraphEdge[]} */
  get edges() { return [...this.#edges]; }

  /** @type {number} */
  get degree() { return this.#edges.size; }

  /**
   * Return the edge set for internal use.
   * Faster than get edges, but can be more easily abused.
   * @type {Set<GraphEdge>}
   */
  get _edgeSet() { return this.#edges; }

  /**
   * @param {GraphEdge} requiredEdge
   * @returns {boolean}
   */
  hasEdge(requiredEdge) {
    return this.#edges.has(requiredEdge);
  }

  /**
   * @param {GraphVertex} vertex
   * @returns {boolean}
   */
  hasNeighbor(vertex) {
    return Boolean(this.#edges.find(edge => edge.A === vertex || edge.B === vertex));
  }

  /**
   * Find
   * @param {GraphVertex} vertex
   * @returns {GraphEdge|undefined}
   */
  findEdge(vertex) {
    return this.#edges.find(edge => edge.A === vertex || edge.B === vertex);
  }

  // TODO: Change this to use integers or object index when available?
  /** @type {string} */
  get key() { return this.value; }

  /**
   * Remove all edges linked to this vertex.
   * @return {GraphVertex}
   */
  deleteAllEdges() {
    this.#edges.clear();
    return this;
  }

  /**
   * Convert the vertex to a string. String should be unique such that it can be an id or key.
   * @param {function} [callback]
   * @returns {string}
   */
  toString(callback) {
    return callback ? callback(this.value) : `${this.value}`;
  }
}

/**
 * Edge of an undirected graph.
 */
export class GraphEdge {
  /** @type {GraphVertex} */
  A;

  /** @type {GraphVertex} */
  B;

  /** @type {GraphVertex} */
  weight = 0;

  /**
   * @param {GraphVertex} A       Starting vertex
   * @param {GraphVertex} B       Ending vertex
   * @param {number} [weight=0]   Optional weight assigned to this edge, e.g. distance.
   */
  constructor(A, B, weight = 0) {
    this.A = A;
    this.B = B;
    this.weight = weight;
  }

  /**
   * @return {string}
   */
  get key() { return `${this.A.toString()}_${this.B.toString()}`; }

  /**
   * Get the other vertex of this edge
   * @param {GraphVertex}   vertex    One vertex of this edge.
   * @returns {GraphVertex}   One of the vertices of this edge. If vertex matches neither, B is returned.
   */
  otherVertex(vertex) {
    return vertex.key === this.B.key ? this.A : this.B;
  }

  /**
   * Reverse this edge
   * @returns {GraphEdge}
   */
  reverse() {
    return new this.constructor(this.B, this.A, this.weight);
  }

  /**
   * @return {string}
   */
  toString() {
    return this.key;
  }

}

/**
 * Undirected graph that holds vertices and edges.
 */
export class Graph {
  /** @type {Map<GraphVertex>} */
  vertices = new Map();

  /** @type {Map<GraphEdges>} */
  edges = new Map();

  /**
   * Add a new vertex. If already added, this will keep the old vertex.
   * @param {GraphVertex} newVertex
   * @returns {GraphVertex} New or existing vertex, based on key.
   */
  addVertex(newVertex) {
    const key = newVertex.key;
    if ( this.vertices.has(key) ) return this.vertices.get(key);
    this.vertices.set(key, newVertex);
    return newVertex;
  }

  /**
   * @param {string} vertexKey
   * @returns {GraphVertex}
   */
  getVertexByKey(vertexKey) {
    return this.vertices.get(vertexKey);
  }

  /**
   * @return {GraphVertex[]}
   */
  getAllVertices() {
    return [...this.vertices.values()];
  }

  /**
   * @return {GraphEdge[]}
   */
  getAllEdges() {
    return [...this.edges.values()];
  }

  /**
   * Add a new edge. If already added, this will keep the old edge.
   * @param {GraphEdge} edge
   * @returns {GraphEdge} The old or new edge.
   */
  addEdge(edge) {
    const key = edge.key;
    if ( this.edges.has(key) ) return this.edges.get(key);
    return this.addEdgeVertices(edge.A, edge.B, edge.weight);
  }

  /**
   * Add a new edge for two vertices. Adds vertices as necessary; reuses existing where possible.
   * If the edge already exists, does nothing.
   * @param {GraphVertex} vertexA   First vertex to add
   * @param {GraphVertex} vertexB   Second vertex to add
   * @param {number} [weight=0]     Optional weight assigned to this edge, e.g. distance.
   * @returns {GraphEdge} The old or existing edge.
   */
  addEdgeVertices(vertexA, vertexB, weight = 0) {
    // Try to find the start and end vertices.
    const A = this.addVertex(vertexA);
    const B = this.addVertex(vertexB);

    // Build and add the edge.
    const edge = this._addEdge(new GraphEdge(A, B, weight));

    // Add edge to the vertices.
    // Undirected, so add to both.
    A.addEdge(edge);
    B.addEdge(edge);

    return edge;
  }

  /**
   * Add a new edge.
   * Internal, because it lacks the checks on whether the vertices already exist
   * and does not add the edge to the vertices.
   * @param {GraphEdge} edge
   * @returns {GraphEdge} The new or existing edge.
   */
  _addEdge(edge) {
    const key = edge.key;
    if ( this.edges.has(key) ) return this.edges.get(key);
    this.edges.set(key, edge);
    return edge;
  }

  /**
   * @param {GraphEdge} edge
   */
  deleteEdge(edge) {
    if ( this.edges.has(edge.key) ) this.edges.delete(edge.key);
    else {
      console.warn("Edge not found in graph.");
      return;
    }

    // TODO: This is probably unnecessary.
    // Locate vertices and delete the associated edge.
    const A = this.getVertexByKey(edge.A.key);
    const B = this.getVertexByKey(edge.B.key);

    A.deleteEdge(edge);
    B.deleteEdge(edge);
  }

  /**
   * @param {GraphVertex} A
   * @param {GraphVertex} B
   * @return {GraphEdge|null}
   */
  findEdge(A, B) {
    const vertex = this.getVertexByKey(A.key);
    if ( !vertex ) return null;
    return vertex.findEdge(B);
  }

  /**
   * @return {number}
   */
  getWeight() {
    return this.getAllEdges().reduce((weight, graphEdge) => {
      return weight + graphEdge.weight;
    }, 0);
  }

  /**
   * @return {string}
   */
  toString() {
    const vStrings = [...this.vertices.entries()].map(v => v.toString());
    return "".concat([...vStrings]);
  }

  // ----- All Simple Cycles ---- //
  // https://javascript.plainenglish.io/finding-simple-cycles-in-an-undirected-graph-a-javascript-approach-1fa84d2f3218

  // how to sort the vertices for getAllCycles
  /** @enum */
  static VERTEX_SORT = {
    NONE: 0,   // No sort
    LEAST: 1,  // Least overlap (smallest degree first)
    MOST: 2    // Most overlap (highest degree first)
  };

  /**
   * Get all vertices in the graph sorted by decreasing degree (number of edges).
   * @returns {GraphVertex[]}
   */
  getSortedVertices({ sortType = Graph.VERTEX_SORT.LEAST } = {}) {
    switch ( sortType ) {
      case Graph.VERTEX_SORT.NONE: return this.getAllVertices();
      case Graph.VERTEX_SORT.LEAST: return this.getAllVertices().sort((a, b) => b.degree - a.degree); // Least overlap
      case Graph.VERTEX_SORT.MOST: return this.getAllVertices().sort((a, b) => a.degree - b.degree); // Most overlap
    }
  }

  /**
   * Construct a spanning tree, meaning a map of vertex keys with values of neighboring vertices.
   * @param {GraphVertex[]} vertices    Array of vertices, possibly sorted from getSortedVertices
   * @returns {Map<*, Map<*, GraphVertex>>} spanningTree. Keys are keys of vertices; values are vertices
   */
  getSpanningTree(vertices) {
    const spanningTree = new Map();

    // Add a key for each vertex to the tree.
    // Each key points to a set of keys.
    vertices.forEach(v => spanningTree.set(v.key, new Map()));

    // Add the vertex neighbors
    const visitedVertices = new Set();
    vertices.forEach(v => {
      const spanningVertexMap = spanningTree.get(v.key);
      v.neighbors.forEach(neighbor => {
        if ( !visitedVertices.has(neighbor.key) ) {
          visitedVertices.add(neighbor.key); // TODO: Should be able to use neighbor directly

          // If not all vertices provided, then the spanning tree may not contain vertex or neighbor.
          const spanningNeighborMap = spanningTree.get(neighbor.key);
          if ( spanningVertexMap ) spanningVertexMap.set(neighbor.key, neighbor);  // TODO: Faster if we could drop this test when we know we have all vertices.
          if ( spanningNeighborMap ) spanningNeighborMap.set(v.key, v); // TODO: Faster if we could drop this test when we know we have all vertices.
        }
      });
    });

    return spanningTree;
  }

  /**
   * Get cycles for a specified vertex or vertices.
   * @param {GraphVertex[]} vertices
   * @returns {string[][]}  Keys of vertices in arrays. Each array represents a cycle.
   */
  getCyclesForVertices(vertices) {
    const spanningTree = this.getSpanningTree(vertices);
    return this._getCyclesForSpanningTree(spanningTree);
  }

  /**
   * Get cycles for all vertices in the graph.
   * @param {object} [options]
   * @param {VERTEX_SORT} [options.sortType]    How to sort the vertices used to detect cycles.
   *                                            Least will prioritize least overlap between edges.
   * @returns {string[][]}  Keys of vertices in arrays. Each array represents a cycle.
   */
  getAllCycles({ sortType = Graph.VERTEX_SORT.LEAST } = {}) {
    const vertices = this.getSortedVertices({sortType});
    const spanningTree = this.getSpanningTree(vertices);
    return this._getCyclesForSpanningTree(spanningTree);
  }

  /**
   * Perform DFS traversal on the spanning tree.
   * @param {Map<*, Map<*, GraphVertex>>} spanningTree
   * @returns {*[][]}  Keys of vertices in arrays. Each array represents a cycle.
   */
  _getCyclesForSpanningTree(spanningTree) {
    const cycles = [];
    const rejectedEdges = this._getRejectedEdges(spanningTree);
    for ( const edge of rejectedEdges.values() ) {
      const start = edge.A;
      const end = edge.B;
      const cycle = findCycle(start, end, spanningTree);
      if ( cycle && cycle.length > 2 ) cycles.push(cycle);
    }

    return cycles;
  }

  /**
   * Rejected edges is a set of edge keys, found by iterating through the graph and adding
   * edges that are not present in the spanning tree.
   * @param {Map<*, Map<*, GraphVertex>>} spanningTree. Keys are keys of vertices; values are set of vertex keys
   * @returns {Map<string, GraphEdge>} Map where keys are edge keys (strings), values are edges.
   */
  _getRejectedEdges(spanningTree) {
    const rejectedEdges = new Map();
    const vertices = this.getAllVertices();
    for ( const v of vertices ) {
      if ( !spanningTree.has(v.key) ) continue;
      for ( const edge of v._edgeSet ) {
        // Opposite vertex for edge is the neighbor. Test whether neighbor is in span for this vertex.
        const neighbor = edge.otherVertex(v);
        if ( spanningTree.get(v.key).has(neighbor.key) ) continue;
        // Add v --> neighbor edge to rejected set. But only if rejected set does not have neighbor --> v.
        const [edgeVN, edgeNV] = edge.A.key === v.key ? [edge, edge.reverse()] : [edge.reverse(), edge];
        if ( !rejectedEdges.has(edgeNV.key) ) rejectedEdges.set(edgeVN.key, edgeVN); // This is a critical flip.
      }
    }

    return rejectedEdges;
  }

  _getRejectedEdgesOrig(spanningTree) {
    const rejectedEdges = new Set();
    const vertices = this.getAllVertices();
    vertices.forEach(v => {
      if ( spanningTree.has(v.key) ) {
        v.neighbors.forEach(neighbor => {
          if ( !spanningTree.get(v.key).has(neighbor.key) ) {
            if ( !rejectedEdges.has(`${neighbor.toString()}-${v.toString()}`) ) {
              rejectedEdges.add(`${v.toString()}-${neighbor.toString()}`);
            }
          }
        });
      }
    });

    return rejectedEdges;
  }
}

/**
 * Takes the start and end of the removed edge and performs DFS traversal
 * recursively on the spanning tree from start until it finds the end.
 * @param {GraphVertex} start               Start vertex
 * @param {GraphVertex} end                 End vertex
 * @param {Map<*, Map<*, GraphVertex>>} spanningTree      Spanning tree created by this.getSpanningTree
 * @param {Set<*>} visited        Holds the set of visited vertices while traversing
 *                                        the tree in order to find a cycle
 * @param {Map<string, string>} parents   Stores the immediate parent of a node while traversing the tree
 * @param {GraphVertex} current_node           Name (key) of the current vertex in the recursion
 * @param {GraphVertex} parent_node            Name (key) of the parent vertex in the recursion
 */
function findCycle(
  start,
  end,
  spanningTree,
  visited = new Set(),
  parents = new Map(),
  current_node = start,
  parent_node = null) {

  let cycle = null;
  visited.add(current_node.key);
  parents.set(current_node.key, parent_node);
  const destinationMap = spanningTree.get(current_node.key);
  if ( !destinationMap ) return cycle; // If less than all vertices in spanningTree.

  for ( const [destinationKey, destinationVertex] of destinationMap ) {
    if ( destinationKey === end.key ) {
      cycle = getCyclePath(start, end, current_node, parents);
      return cycle;
    }

    const parentValue = parents.get(current_node.key);
    if ( parentValue && destinationKey == parentValue.key ) continue;

    if ( !visited.has(destinationKey) ) {
      cycle = findCycle(
        start,
        end,
        spanningTree,
        visited,
        parents,
        destinationVertex,
        current_node
      );
      if ( !!cycle ) return cycle;
    }
  }

  return cycle;
}

/**
 * Captures the cyclic path between the start and end vertices by backtracking the spanning tree
 * from the end vertex to the start. The parents map is used to get the reference of the
 * parent vertices.
 * @param {} start
 * @param {} end
 * @param {string} current
 * @param {Map<string, string>} parents
 * @returns {}  The cyclic path
 */
function getCyclePath(start, end, current, parents) {
  const cycle = [end];
  while ( current.key != start.key ) {
    cycle.push(current);
    current = parents.get(current.key);
  }
  cycle.push(start);
  return cycle;
}

// Testing

/*
A -- B -- C
 \   |   /
   \ |  /
     D

*/

/*

// For testing with WallTracer
function updateWallTracer() {
  const t0 = performance.now();
  WallTracerVertex.clear();
  WallTracerEdge.clear();
  const walls = [...canvas.walls.placeables] ?? [];
//   walls.push(...canvas.walls.outerBounds);
  walls.push(...canvas.walls.innerBounds);
  for ( const wall of walls ) WallTracerEdge.addWall(wall);
  const t1 = performance.now();
  WallTracerEdge.verifyConnectedEdges();
  const t2 = performance.now();
  console.log(`Tracked ${walls.length} walls in ${t1 - t0} ms. Verified in ${t2 - t1} ms.`);
}

function benchCycle(tracerEdgesSet) {
  const t0 = performance.now();
  const graph = new Graph();
  for ( let tracerEdge of tracerEdgesSet ) {
    const aKey = tracerEdge.A.key;
    const bKey = tracerEdge.B.key;
    let A = new GraphVertex(aKey);
    let B = new GraphVertex(bKey);
    edgeAB = new GraphEdge(A, B);
    graph.addEdge(edgeAB);
  }

  const t1 = performance.now();
  let cycles = graph.getAllCycles()

  const t2 = performance.now();
  cycles = cycles.filter(c => c.length > 2);
  const cycleVertices = cycles.map(c => c.map(key => tracerVerticesMap.get(Number.fromString(key))));
  const cyclePolygons = cycleVertices.map(vArr => new PIXI.Polygon(vArr))
  const t3 = performance.now();

  console.log(
`
${t1 - t0} ms: build graph
${t2 - t1} ms: find cycles
${t3 - t2} ms: convert to polygons
${t3 - t0} ms: total
`);

  return { graph, cyclePolygons };
}


graph = new Graph();
A = new GraphVertex("A")
B = new GraphVertex("B")
C = new GraphVertex("C")
D = new GraphVertex("D")

edgeAB = new GraphEdge(A, B)
edgeAD = new GraphEdge(A, D)
edgeBD = new GraphEdge(B, D)
edgeBC = new GraphEdge(B, C)
edgeCD = new GraphEdge(C, D)

graph.addEdge(edgeAB)
graph.addEdge(edgeAD)
graph.addEdge(edgeBD)
graph.addEdge(edgeBC)
graph.addEdge(edgeCD)

graph.getAllVertices().map(v => v.toString())
graph.getAllEdges().map(e => e.toString())
edgeAB.otherVertex(B)
A.neighbors

graph.getAdjacencyMatrix()
graph.detectCycle()
graph.detectCycle(1)
graph.detectCycle(2)
graph.detectCycle(3)

vertices = graph.getSortedVertices()
spanningTree = graph.getSpanningTree(vertices)
rejectedEdges = graph._getRejectedEdges(spanningTree)
rejectedEdgesOrig = graph._getRejectedEdgesOrig(spanningTree)
graph.getAllCycles()


getSpanningTreeOrig(vertices)

// Test on scene with WallTracerEdges
api = game.modules.get("elevatedvision").api
WallTracerEdge = api.WallTracerEdge
WallTracerVertex = api.WallTracerVertex
WallTracer = api.WallTracer
ClipperPaths = CONFIG.GeometryLib.ClipperPaths
Draw = CONFIG.GeometryLib.Draw
draw = new Draw

updateWallTracer()
tracerVerticesMap = WallTracerVertex._cachedVertices;
tracerEdgesSet = WallTracerEdge.allEdges();

tracerEdgesSet.forEach(e => e.draw())

graph = new Graph();
for ( let tracerEdge of tracerEdgesSet ) {
  const aKey = tracerEdge.A.key;
  const bKey = tracerEdge.B.key;
  const A = new GraphVertex(aKey);
  const B = new GraphVertex(bKey);
  edgeAB = new GraphEdge(A, B);
  graph.addEdge(edgeAB);
}

tracerEdgesSet = WallTracerEdge.allEdges();
let { graph, cyclePolygons } = benchCycle(tracerEdgesSet)


cyclesNone = graph.getAllCycles({ sortType: Graph.VERTEX_SORT.NONE })
cyclesLeast = graph.getAllCycles({ sortType: Graph.VERTEX_SORT.LEAST })
cyclesMost = graph.getAllCycles({ sortType: Graph.VERTEX_SORT.MOST })

cyclesNone = cyclesNone.filter(c => c.length > 2);
cyclesLeast = cyclesLeast.filter(c => c.length > 2);
cyclesMost = cyclesMost.filter(c => c.length > 2);

cycleVerticesNone = cyclesNone.map(c => c.map(key => tracerVerticesMap.get(Number.fromString(key))));
cycleVerticesLeast = cyclesLeast.map(c => c.map(key => tracerVerticesMap.get(Number.fromString(key))));
cycleVerticesMost = cyclesMost.map(c => c.map(key => tracerVerticesMap.get(Number.fromString(key))));

cyclePolygons = cycleVerticesNone.map(vArr => new PIXI.Polygon(vArr))
cyclePolygons = cycleVerticesLeast.map(vArr => new PIXI.Polygon(vArr))
cyclePolygons = cycleVerticesMost.map(vArr => new PIXI.Polygon(vArr))


N = 1000
benchFn = function(graph) { return graph.getAllCycles() }
await foundry.utils.benchmark(benchFn, N, graph, { sortType: Graph.VERTEX_SORT.NONE })
await foundry.utils.benchmark(benchFn, N, graph, { sortType: Graph.VERTEX_SORT.LEAST })
await foundry.utils.benchmark(benchFn, N, graph, { sortType: Graph.VERTEX_SORT.MOST })

This is the End: ~ .77 ms per for each  Using Map and object/integer keys: ~ .23 ms
Hunter's Ravine: ~ .33 ms per for each  Using Map and object/integer keys: ~ .12 ms
Delicious Palace: ~ 10.6 ms per for each (ouch!) using Map and object/integer keys: ~ 1 ms

cycles = graph.getAllCycles()
cycles = cycles.filter(c => c.length > 2);
cycleVertices = cycles.map(c => c.map(key => tracerVerticesMap.get(Number.fromString(key))));
cyclePolygons = cycleVertices.map(vArr => new PIXI.Polygon(vArr))
cyclePolygons.forEach((poly, i) => {
  let color;
  switch ( i % 3 ) {
    case 0: color = Draw.COLORS.blue; break;
    case 1: color = Draw.COLORS.red; break;
    case 2: color = Draw.COLORS.green; break;
  }
  draw.shape(poly, { color })
})


for ( const key of WallTracerVertex._cachedVertices.keys() ) {
  console.log(`Spanning tree ${spanningTree.has(key.toString()) ? "has" : "does not have"} key ${key}`);
}

// are keys and sortKeys equivalent? Yes.
tracerVerticesMap = WallTracerVertex._cachedVertices;
for ( const v of tracerVerticesMap.values() ) {
  const pt = v.point;

  if ( pt.key !== pt.sortKey ) {
    console.log(`vertex { x: ${v.x}, y: ${v.y} } has key ${pt.key} and sortKey ${pt.sortKey}`)
  }
}

// Can we force the cycle to prioritize a certain edge?
// (Exclusively or force that cycle to be found along with others?)
let [w] = canvas.walls.controlled
edgeSet = WallTracerEdge.edgeSetForWall(w)
let [edge] = edgeSet

v1 = graph.getVertexByKey(edge.A.key.toString())
v2 = graph.getVertexByKey(edge.B.key.toString())

// Apparently we need at least two vertices to get a result.
cycles1 = graph.getCyclesForVertices([v1]);
cycles2 = graph.getCyclesForVertices([v2]);
cycles12 = graph.getCyclesForVertices([v1, v2]);

*/


