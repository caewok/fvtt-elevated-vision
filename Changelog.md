## 0.0.1-alpha4
Working prototype for ambient light sources. When the wall height is less than the light source elevation, one or more shadow polygons are constructed representing how the light is obscured by the wall. For now, shadows are just drawn on the canvas.

## 0.0.1-alpha3
Change the module name. Starting anew on the code.

## 0.0.1-alpha2
Wrap testVisibility in order to hide a token based on elevation.
Given one or more points of vision to a token:
- test for intersection with an Enhanced Terrain Layer polygon.
- Test if the token can be seen from the point(s) of vision, assuming 3-D elevation for the token, wall, and point(s) of vision.
- Hide token as necessary

Also adds a log debug flag using the devMode module, and currently sets a debug flag to visualize the terrain polygons and intersections.

## 0.0.1-alpha1
Basic framework
