## 0.1.0
Substantial performance improvement by using meshes instead of sprites for the vision los and fov. Partial compatibility with Perfect Vision---shadows in lighting is working but shadows in vision are not. Does not throw errors when initially loading Perfect Vision. Improvements to handling automated elevation changes.

Fix issue #10 (moving between elevated areas.)
Fix issue #9 (Performance)
Possible fix for issue #6 (periodic error when selecting tokens)
Partial fix for issue #4 (Perfect Vision compatibility)

## 0.1.0-alpha
Tentative fix for issue #9 (extreme performance hit). For CanvasVisibilityShader.prototype.refresh, use meshes instead of sprites for los and fov.

## 0.0.3
When dragging a token, elevation of the token updates automatically if parameters are met to do so. When moving, the token's vision matches the elevation it is at. (The elevation number indicator shows the destination elevation when moving after a drag, but the vision will be calculated based on elevation for the location.)

Fix issue #5 (Elevation layer tooltip localization.)
Fix issue #7 (Improvements to save.)
Fix issue #8 (Adjust token elevation when dragging or moving.)
Possible fix for issue #6 (Selecting tokens.)

## 0.0.2
Fix issue #1 (Error when selecting a token in v10.284.)
Fix issue #2 (libWrapper error.)
Fix issue #3 (Allow decimal steps for elevation interval.)

## 0.0.1
First public release!
Fixes since alpha10:
- Display wall ranges in elevation layer
- Better sizing of elevation number control; css fixes.
- Better handling of hex grid: fill grid by hex and measure token by hex size.
- Allow GM to set the minimum elevation and elevation step size per scene.
- Default setting to not account for terrain elevation for tokens until performance can be improved.
- Default setting to use token centers for auto elevation; alternatively use token shape.
- Store (and download/upload) only the scene-sized texture, not including canvas borders.
- Fix for auto token measurement when calculating average over the token shape.

## 0.0.1-alpha10
Account for terrain elevation in fog-of-war/token vision.
Add setting to switch between accounting for terrain elevation (shader) or not (polygons only) in token vision.
Add setting to toggle automatic elevation changes for tokens.
English localization.
Attempted css to fix size of elevation number in control tools.

## 0.0.1-alpha9
Fixes for v10.279.

## 0.0.1-alpha8
Working in v10.277. Will undoubtedly break in v10.279.

- Elevation layer
  - Set elevation by grid space
  - Set elevation by filling line-of-sight
  - Set elevation by filling space enclosed by walls
  - Load and save elevation by image file
  - Automatic save of elevation settings by scene
  - Undo
  - Clear all elevation, with confirmation dialog
  - Shades of red represent elevation on the elevation layer
  - Hover to see the precise elevation value at a location
- Tokens
  - Visibility of other tokens based on elevation.
  - Automatic elevation change when moving token across the map.
- Lighting
  - Calculate lighting shadows based on wall and light elevation.
  - Account for canvas terrain elevation for lighting shadows
- Fog of War
  - Fog of war polygon modified by wall shadows
  - Does not currently account for terrain elevation

## 0.0.1-alpha7
Updated module.json for installing in v10.

## 0.0.1-alpha6
Switched to better method to block token and lights for shadows. Fixes the visual artifacts. Shadows for a token given unlimited lighting are very faint, which might be fine but would probably prefer a bit more darkness.

All three parts of lighting are blocked fully. Would prefer something with an alpha gradient to blend the lighting shadows.

## 0.0.1-alpha5
Working prototype for token vision and lights. Corrections to the calculation of the shadow polygons and better use of Clipper to union shadows for a given source.

When viewing the vision from a token, areas are shaded if partially obscured by a wall lower than the token. Other tokens elevated above the wall can be seen. Some visual artifacts when moving tokens around but not too bad.

Lights currently add shadows at the lighting layer level, which is not ideal but works for now. Future work needed to mask individual lights properly.

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
