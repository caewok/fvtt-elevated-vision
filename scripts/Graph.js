/* globals
*/
"use strict";

/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */


// GraphVertex, GraphEdge, and Graph initially based on
// https://github.com/trekhleb/javascript-algorithms/tree/master/src/data-structures/graph

/**
 * Vertex of an undirected graph.
 */
class GraphVertex {
  #edges = new Set(); // TODO: Linked List or other alternative?

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
   * @param {GraphVertex} vertex
   * @returns {GraphEdge|undefined}
   */
  findEdge(vertex) {
    return this.#edges.find(edge => edge.A === vertex || edge.B === vertex);
  }

  // TODO: Change this to use integers or object index when available?
  /** @type {string} */
  get key() {  return this.value.toString(); }

  /**
   * @return {GraphVertex}
   */
  deleteAllEdges() {
    this.#edges.clear();
    return this;
  }

  /**
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
class GraphEdge {
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
  get key() { return `${this.A.key}_${this.B.key}`; }

  /**
   * Get the other vertex of this edge
   * @param {GraphVertex}   vertex    One vertex of this edge.
   * @returns {GraphVertex}   One of the vertices of this edge. If vertex matches neither, B is returned.
   */
  otherVertex(vertex) {
    return vertex.key === this.B.key ? this.A : this.B;
  }

  // TODO: Do we need reverse? Would upset the cache.

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
class Graph {
  /** @type {Map<GraphVertex>} */
  vertices = new Map();

  /** @type {Map<GraphEdges>} */
  edges = new Map();

  /**
   * @param {GraphVertex} newVertex
   * @returns {Graph}
   */
  addVertex(newVertex) {
    this.vertices.set(newVertex.key, newVertex);
    return this;
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
   * @param {GraphEdge} edge
   * @returns {Graph}
   */
  addEdge(edge) {
    // Try to find the start and end vertices.
    let A = this.getVertexByKey(edge.A.key);
    let B = this.getVertexByKey(edge.B.key);

    // Insert start vertex if not already inserted.
    if ( !A ) {
      this.addVertex(edge.A);
      A = this.getVertexByKey(edge.A.key);
    }

    // Insert end vertex if not already inserted.
    if ( !B ) {
      this.addVertex(edge.B);
      B = this.getVertexByKey(edge.B.key);
    }

    // Check if edge already added.
    if ( this.edges.has(edge.key) ) {
      console.error("Edge has already been added before");
      return this;
    } else this.edges.set(edge.key, edge);

    // Add edge to the vertices.
    // Undirected, so add to both.
    A.addEdge(edge);
    B.addEdge(edge);

    return this;
  }

  /**
   * @param {GraphEdge} edge
   */
  deleteEdge(edge) {
    if ( this.edges.has(edge.key) ) this.edges.delete(edge.key);
    else throw new Error("Edge not found in graph.");

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

  // TODO: Do we need reverse?

  /**
   * @return {Map<string, number>}
   */
  getVerticesIndices() {
    const verticesIndices = new Map();
    this.getAllVertices().forEach((vertex, index) => {
      verticesIndices.set(vertex.key, index);
    });
    return verticesIndices;
  }

  /**
   * @return {*[][]}
   */
  getAdjacencyMatrix() {
    const vertices = this.getAllVertices();
    const verticesIndices = this.getVerticesIndices();

    // Init matrix with infinities meaning that there is no way of getting from one vertex to another
    const adjacencyMatrix = Array(vertices.length).fill(null).map(() => {
      return Array(vertices.length).fill(Infinity);
    });

    // Fill the columns.
    vertices.forEach((vertex, vertexIndex) => {
      vertex.neighbors.forEach(neighbor => {
        const neighborIndex = verticesIndices.get(neighbor.key);
        adjacencyMatrix[vertexIndex][neighborIndex] = this.findEdge(vertex, neighbor).weight;
      });
    });

    return adjacencyMatrix;
  }

  /**
   * @return {string}
   */
  toString() {
    return [...this.vertices.keys()].toString();
  }

  // ----- Depth-first search ----- //

  /**
   * @typedef {Object} Callbacks
   *
   * @property {function(vertices: Object): boolean} [allowTraversal] -
   *  Determines whether DFS should traverse from the vertex to its neighbor
   *  (along the edge). By default prohibits visiting the same vertex again.
   *
   * @property {function(vertices: Object)} [enterVertex] - Called when DFS enters the vertex.
   *
   * @property {function(vertices: Object)} [leaveVertex] - Called when DFS leaves the vertex.
   */

  /**
   * @param {Graph} graph
   * @param {GraphVertex} startVertex
   * @param {Callbacks} [callbacks]
   */
  depthFirstSearch(startVertex, callbacks) {
    const previousVertex = null;
    this.#depthFirstSearchRecursive(startVertex, previousVertex, this.#initCallbacks(callbacks));
  }

  /**
   * @param {GraphVertex} currentVertex
   * @param {GraphVertex} previousVertex
   * @param {Callbacks} callbacks
   */
  #depthFirstSearchRecursive(currentVertex, previousVertex, callbacks) {
    callbacks.enterVertex({ currentVertex, previousVertex });

    currentVertex.neighbors.forEach(nextVertex => {
      if (callbacks.allowTraversal({ previousVertex, currentVertex, nextVertex })) {
        this.#depthFirstSearchRecursive(nextVertex, currentVertex, callbacks);
      }
    });

    callbacks.leaveVertex({ currentVertex, previousVertex });
  }

  /**
   * @param {Callbacks} [callbacks]
   * @returns {Callbacks}
   */
  #initCallbacks(callbacks = {}) {
    const initiatedCallback = callbacks;

    const stubCallback = () => {};

    const allowTraversalCallback = (
      () => {
        const seen = {};
        return ({ nextVertex }) => {
          if (!seen[nextVertex.key]) {
            seen[nextVertex.key] = true;
            return true;
          }
          return false;
        };
      }
    )();

    initiatedCallback.allowTraversal = callbacks.allowTraversal || allowTraversalCallback;
    initiatedCallback.enterVertex = callbacks.enterVertex || stubCallback;
    initiatedCallback.leaveVertex = callbacks.leaveVertex || stubCallback;

    return initiatedCallback;
  }

  // ----- Detect cycles ----- //

  /**
   * Detect cycle in undirected graph using Depth First Search.
   */
  detectCycle(startIndex = 0) {
    let cycle = null;

    // List of vertices that we have visited.
    const visitedVertices = {};

    // List of parents vertices for every visited vertex.
    const parents = {};

    // Callbacks for DFS traversing.
    const callbacks = {
      allowTraversal: ({ currentVertex, nextVertex }) => {
        // Don't allow further traversal in case if cycle has been detected.
        if (cycle) {
          return false;
        }

        // Don't allow traversal from child back to its parent.
        const currentVertexParent = parents[currentVertex.key];
        const currentVertexParentKey = currentVertexParent ? currentVertexParent.key : null;

        return currentVertexParentKey !== nextVertex.key;
      },
      enterVertex: ({ currentVertex, previousVertex }) => {
        if (visitedVertices[currentVertex.key]) {
          // Compile cycle path based on parents of previous vertices.
          cycle = {};

          let currentCycleVertex = currentVertex;
          let previousCycleVertex = previousVertex;

          while (previousCycleVertex.key !== currentVertex.key) {
            cycle[currentCycleVertex.key] = previousCycleVertex;
            currentCycleVertex = previousCycleVertex;
            previousCycleVertex = parents[previousCycleVertex.key];
          }

          cycle[currentCycleVertex.key] = previousCycleVertex;
        } else {
          // Add next vertex to visited set.
          visitedVertices[currentVertex.key] = currentVertex;
          parents[currentVertex.key] = previousVertex;
        }
      }
    };

    // Start DFS traversing.
    const startVertex = this.getAllVertices()[startIndex];
    this.depthFirstSearch(startVertex, callbacks);

    return cycle;
  }

  // ----- All Simple Cycles ---- //
  // https://javascript.plainenglish.io/finding-simple-cycles-in-an-undirected-graph-a-javascript-approach-1fa84d2f3218

  // how to sort the vertices for getAllCycles
  /** @enum */
  static VERTEX_SORT = {
    NONE: 0,   // no sort
    LEAST: 1,  // least overlap (smallest degree first)
    MOST: 2    // most overlap (highest degree first)
  };

  /**
   * Get all vertices in the graph sorted by decreasing degree (number of edges).
   * @returns {GraphVertex[]}
   */
  getSortedVertices({ sortType = Graph.VERTEX_SORT.LEAST } = {}) {
    switch ( sortType ) {
      case Graph.VERTEX_SORT.NONE: return this.getAllVertices();
      case Graph.VERTEX_SORT.LEAST: return this.getAllVertices().sort((a, b) => b.degree - a.degree); // least overlap
      case Graph.VERTEX_SORT.MOST: return this.getAllVertices().sort((a, b) => a.degree - b.degree); // most overlap
    }
  }

  /**
   * Construct a spanning tree, meaning a map of vertex keys with values of neighboring vertices.
   * @param {GraphVertex[]} vertices    Array of vertices, possibly sorted from getSortedVertices
   * @returns {Map<string, Set<GraphVertex>}
   */
  getSpanningTree(vertices) {
    const spanningTree = new Map();

    // Add a key for each vertex to the tree.
    vertices.forEach(v => spanningTree.set(v.key, new Set()));

    // Add the vertex neighbors
    const visitedVertices = new Set();
    vertices.forEach(v => {
      const spanningVertex = spanningTree.get(v.key);
      v.neighbors.forEach(neighbor => {
        if ( !visitedVertices.has(neighbor.key) ) {
          visitedVertices.add(neighbor.key); // TODO: Should be able to use neighbor directly

          // If not all vertices provided, then the spanning tree may not contain vertex or neighbor.
          const spanningNeighbor = spanningTree.get(neighbor.key);
          if ( spanningVertex ) spanningVertex.add(neighbor)  // TODO: Faster if we could drop this test when we know we have all vertices.
          if ( spanningNeighbor ) spanningNeighbor.add(v); // TODO: Faster if we could drop this test when we know we have all vertices.
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
   * @param {Map<string, Set<GraphVertex>} spanningTree
   * @returns {string[][]}  Keys of vertices in arrays. Each array represents a cycle.
   */
  _getCyclesForSpanningTree(spanningTree) {
    const cycles = [];
    const rejectedEdges = this._getRejectedEdges(spanningTree);
    rejectedEdges.forEach(edge => {
      const ends = edge.split("-");
      const start = ends[0];
      const end = ends[1];
      const cycle = findCycle(start, end, spanningTree);
      if ( cycle && cycle.length > 2 ) cycles.push(cycle);
    });

    return cycles;
  }

  /**
   * Rejected edges is a set of edge keys, found by iterating through the graph and adding
   * edges that are not present in the spanning tree.
   * @param {Map<string, Set<GraphVertex>} spanningTree
   */
  _getRejectedEdges(spanningTree) {
    const rejectedEdges = new Set();
    const vertices = this.getAllVertices();
    vertices.forEach(v => {
      if ( spanningTree.has(v.key) ) {
        v.neighbors.forEach(neighbor => {
          if ( !spanningTree.get(v.key).has(neighbor) ) {
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
 * @param {string} start                  Key of the start vertex
 * @param {string} end                    Key of the end vertex
 * @param {Map<string, Set<GraphVertex>} spanningTree   Spanning tree created by this.getSpanningTree
 * @param {Set<string>} visited           Holds the set of visited vertices while traversing
 *                                        the tree in order to find a cycle
 * @param {Map<string, string>} parents   Stores the immediate parent of a node while traversing the tree
 * @param {string} current_node           Name (key) of the current vertex in the recursion
 * @param {string} parent_node            Name (key) of the parent vertex in the recursion
 */
function findCycle(
  start,
  end,
  spanningTree,
  visited = new Set(),
  parents = new Map(),
  current_node = start,
  parent_node =  " ") {

  let cycle = null;
  visited.add(current_node);
  parents.set(current_node, parent_node);
  const destinations = spanningTree.get(current_node);
  if ( !destinations ) return cycle; // If less than all vertices in spanningTree.

  for ( const destination of destinations ) {
    const destinationKey = destination.key;
    if ( destinationKey === end ) {
      cycle = getCyclePath(start, end, current_node, parents);
      return cycle;
    }

    if ( destination == parents.get(current_node)) continue;

    if ( !visited.has(destinationKey) ) {
      cycle = findCycle(
        start,
        end,
        spanningTree,
        visited,
        parents,
        destinationKey,
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
  while ( current != start ) {
    cycle.push(current);
    current = parents.get(current);
  }
  cycle.push(start);
  return cycle;
}



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


// Testing

/*
A -- B -- C
 \   |   /
   \ |  /
     D

*/

/*
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

graph.getSortedVertices()
spanningTree = graph.getSpanningTree()
graph._getRejectedEdges(spanningTree)
graph.getAllCycles()


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
  let A = new GraphVertex(aKey);
  let B = new GraphVertex(bKey);
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

This is the End: ~ .77 ms per for each
Hunter's Ravine: ~ .33 ms per for each
Delicious Palace: ~ 10.6 ms per for each (ouch!)



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


