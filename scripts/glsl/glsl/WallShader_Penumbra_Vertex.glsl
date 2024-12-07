/* ----- NOTE: Penumbra Vertex ----- */

// Defined constants.
int vertexNum = gl_VertexID % 3;

// @type {vec2} vVertexPosition
Wall wall = calculateWallPositions();
vec2[3] penumbraTri = definePenumbraTriangle(wall);
vVertexPosition = penumbraTri[vertexNum];

// Varyings
defineBasicVaryings(wall);

// Flats
if ( vertexNum == 2 ) defineBasicFlats();