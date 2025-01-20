/* ----- NOTE: Penumbra Vertex ----- */
/*
#ifdef UNSIZED_SOURCE
int vertexNum = gl_VertexID % 3;

Wall wall = calculateWallPositions();
vec2[3] penumbraTri = definePenumbraTriangle(wall);

defineSharedVaryings(wall, penumbraTri);
defineVaryings(wall, penumbraTri);
if ( vertexNum == 2 ) {
  defineSharedFlats(wall, penumbraTri);
  defineFlats(wall, penumbraTri);
}
#endif

#ifndef UNSIZED_SOURCE
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
#endif
*/