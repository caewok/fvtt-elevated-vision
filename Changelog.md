# 0.4.4
Refactor token elevation calculator class. Now split into three parts:
1. CoordinateElevationCalculator: Elevation using a single point.
2. TokenPointElevationCalculator: Simple wrapper on (1) to accept a token instead of a point. Measured by token center.
3. TokenAverageElevationCalculator: Extends (2) to use averaging over token shape.
This provides additional tools for Elevation Ruler.

Add automatic elevation support for Enhanced Terrain Layer.

Better support for 3d Canvas.

## 0.4.3
Update to geometry lib 0.1.5.

## 0.4.2
Permissions fix.

## 0.4.1
Possible fix for PV error where it expects Tile width and height pixel values to be rounded.

## 0.4.0
Overhaul the saving and loading of the elevation texture so lower resolution images can be used. Should resolve issue #38 (large maps) and generally improve speed.

Use a pixel cache for elevation texture and tile textures. Add patch for [Foundry issue #8831](https://github.com/foundryvtt/foundryvtt/issues/8831). Improves speed and allows for more complex auto-elevations.

Move selection of auto-elevation and shadow algorithm to the scene configuration. As a consequence, the world settings now operate as default values for new scenes.

Added an optional "fly" button to the token controls when auto-elevation is enabled. When the button is enabled, it tells EV that the token should fly if it encounters a lower elevation (like a terrain cliff or a tile hole).

New methodology to determine elevation automatically. Auto-elevation will consider a token to be "on-the-ground" if the token elevation equals the terrain elevation or the elevation of an overhead tile at that position. Transparent portions of tiles are ignored (treated as "holes"). If the fly button is not enabled, as a token on the ground moves, it's elevation will adjust up or down. If the fly button is enabled, a token's elevation will not change if it would result in a movement down further than the token height. In effect, the token will be treated as "flying" over valleys or terrain holes. May resolve issue #28.

The new auto-elevation allows for use of bridges over canyons and tiles with transparent holes.

Possible fix for multiple changes to the minimum elevation when using Levels 3D. Auto-elevation and shading will be disabled when a scene is using 3D.

Use the changelog dialog from Perfect Vision.

Fix upload of elevation files from the EV control panel.

## 0.3.5
Fix for enhanced LOS when limited walls or walls with defined heights are present.

## 0.3.4
Update to geometry lib v0.1.3.

## 0.3.3
Much improved fill algorithm. Closes #22.
Fix for terrain wall shadows when rendering using Polygons or WebGL. Possibly fixes #37.
Ignore tiles with infinite elevation when setting token elevations. Allow GM to set the tile elevation in the tile config, which will override the terrain elevation at that point.

Experimental speed-up to vision/lighting/sound rendering when the source is contained in a closed set of walls. Uses the fill algorithm to identify closed polygonal areas, speeding up the clockwise sweep.

Update to geometry lib v0.1.2.

## 0.3.2
Update to geometry lib v0.1.1.

## 0.3.1
Fix scene failing to load for scenes with existing sources (issue #34).

## 0.3.0
Add a shared geometry git submodule.
Clearly differentiate WebGL vs non-WebGL (Polygons) shadows in settings.
Add setting to disable shadows altogether (issue #30).
Handle limited-sight (terrain) walls in both Polygons and WebGL settings (issue #21).
Handle shadows for walls whose bottom elevation is above the canvas (issue #33).
Fix for conflict with Flying Tokens Module (issue #32).
Add an elevation setting for light configuration.

## 0.2.1
Potential fix for issue #29 (canvas freeze re "rangeBottom")

## 0.2.0
Remove 3d visibility code. (Taken over by Alternative Token Visibility.)

Remove dependency on Wall Height. (Still highly recommended.)

## 0.1.6
Incorporate update from Perfect Vision 4.0.34; no longer need to force PV into debug mode.

Fix issue #27 (Elevation fill not getting saved to scene).

Fix issue #23 (Avoid changing elevations when min or step elevation is changed).

Fix issue #20 (Check for elevated tiles before adjusting token elevation). EV now considers tokens on tiles to be "on the ground" if the token and tile elevation are the same. This should allow creation of "bridges" made of tiles and better functionality with Levels.

Fix issue #26 (Vision broken when using Levels). EV will now set the scene minimum elevation to the minimum tile elevation. In addition, for basements, it is necessary that the terrain elevation around the basement be modified to equal the basement level. (E.g., if the basement is at -10, color all the elevation tiles around the basement to -10.)

EV will now exclude from shadow calculations walls under tiles, or walls under elevation 0 if the vision or light source is above the tile. This avoids rendering shadows in unexpected places, such as in a building set up for Levels where the walls should only appear if the token is at the same level as the walls.

## 0.1.5
Compatibility with Perfect Vision should be much improved (issues #4 and #18). Added an additional non-radius vision shader and simplified the shader geometry calculation. This also addresses issue #15 in a more comprehensive way.

Fix for calculating averageElevationAtGridPoint.

Fix issue #19 (default elevation). Added a method, changePixelElevationValues, that changes every pixel that is currently at a specified elevation to a different elevation. Also added a macro for easy access to this functionality. This allows, for example, the user to change the scene from the default value to some other value.

## 0.1.4
Fix for issue #15 (no vision when sight.range = 0). To avoid a bug in PolygonMesher and because ShadowShader assumes normalized geometry based on radius, set radius to 1 if radius is 0.

## 0.1.3
Fix for issue #17 (inverted polygon shadows).
Avoid combining shadows unless required for vision, which provides performance improvement when using the shader for vision shadows.

## 0.1.2
Fix for testing detect range. This should fix functionality for detect tremor. Note that detection is using a 3d range, which affects detection when token or target is elevated. Tremor does not currently consider whether or not a token is "on the ground."

Fix for issue #16 (negative elevation).
Fix for issue #12 (levels compatibility) and #14 (_testRange check).
Possible fix for issue #15.

## 0.1.1
Fix for issue #13 (applying elevation data to limited vision).

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
