# 0.5.10
Fix incorrect shading for terrain for token vision LOS when webGL shadows are enabled. Closes issue #90. Thanks @Demonkiller89.
Handle error when deleting walls.
Fix for token vision seeing through walls as tokens are moved around the scene. Closes issue #88.
Update geometry lib to 0.2.10.

# 0.5.9
Fix for token update error. Closes issue #84.
Add check for Rideables module tokens and avoid autoelevating them. Closes issue #83.
Store per-user setting for status of the token fly button so it keeps its state when the scene/foundry is reloaded. Closes issue #85.
Fix for Levels stairs with autoelevation. Closes issue #80. Note that if there is no supporting tile or terrain underneath, the token will still fall to the bottom. Enabling the fly button also will make the token stay at the level set by the stair.
Update geometry lib to 0.2.6.

# 0.5.8
Rewrite of the code used to automatically estimate token elevation as a token moves around a scene. Added options in the token configuration (and default token configuration) to set the algorithm used for estimating terrain elevation and whether the token is on a tile:
1. Center point. Use only the token center point. This is the least resource-intensive.
2. Clustered center points. (Default option.) Use 9 points (including center) at 10% of the token minimum width/height from center. For elevation, take the median value. For tile opacity, take the maximum value (if any one point is on an opaque tile pixel, the token is on that tile).
3. 9 points. Use default Foundry spacing for the 9 points. Otherwise same as (2).
4. Average. Use a grid of closely spaced points on the token shape. For both elevation and tile opacity, use the average. This is the most resource-intensive.

Fix for issue #78 (object vision bug). Thanks, @Boomer-Kuwanger, for the PR!
Fix for issue #76 (diagonal walls and vision).
Fix for issue #77 (incompatibility with Limits)
Fix for issue #75 (ducking)
Fix for issue #70 (tiles with low opacity dropping tokens).
Fix for issue #69 (tiles near terrain not working for bridge).

# 0.5.7
- Improve directional light shadow resolution by rendering only the shadow texture for the scene instead of the entire light radius.
- Keep the directional light position at the original x,y coordinates to allow more flexibility in displaying directional lighting that is meant to be overhead on a map. This also gives more options for animating directional lights. Note that directional lights can be set to 0 bright radius if you don't want the bright circle on the canvas.
- Set elevation angle of the directional light based on only the scene rectangle, which should fix issues with changing to the padding %. Closes issue #68.
- Fix handling of door updates so the shadows properly update when opening/closing doors. Closes issue #71.
- Fix handling of light position updates so that shadows properly update for threshold walls when the light is dragged. Closes issue #67.

# 0.5.6
Add back WebGL as choice of default algorithm for new scenes. Closes issue #66.
Fix error when moving tokens with Levels module enabled. Closes issues #64 and #61.
Set the elevation in the toolbar to the nearest elevation step.

# 0.5.5
GM can set a "light size" in the ambient light configuration. This controls the amount of penumbra in the shadow. Lights are modeled physically as 3d spheres, with penumbra appearing for the left and right edges of walls and top/bottom edges of limited height walls when the light source is above the wall.

GM can change an ambient light to a "directional light", which models a light source such as the sun or moon that is very far away. Moving the light around the scene controls its azimuth and elevation angle, with elevation angle approaching 90º as the light reaches the center of the canvas. GM can also set the solar angle, which controls the amount of penumbra in the shadow. All properties are physically modeled, allowing light to stream across the entire canvas. Lighting animations work as normal, although some are a lot better than others (sunburst, starlight, and fog are pretty good).

Rework of the switching between lighting algorithms in a scene, to avoid reloading the scene.

- Fix for bridge effect not working with tiles (issue #62).
- Update geometry lib to v0.2.3.
- Include fix from 0.4.12 when loading a scene in The Forge the first time.
- Possible fixes for issues #61 (can't move tokens) and #63 (darkvision).

# 0.5.4
Fix for storing elevation data in The Forge. Resolves issue #60. See v0.4.9 and 0.4.10.

# 0.5.3
WebGL shadows rewritten entirely. No longer a limit on the number of walls it can consider when calculating shadows using the GPU. (Technically, may be limited by the number of attributes that can be passed to a shader, but that should be sufficiently large for most use cases.) WebGL shadows also should be a lot more performant because shadows are drawn to a texture which is then used for rendering---this avoids a lot of calculations in the fragment shader on the fly.

Lights now display their elevation when the lighting layer is active.

Token vision is now based on token height, which can be set using Wall Height module. Making a token prone reduces the token height and changes the shadows accordingly.

# 0.5.2
GM can define a minimum and maximum elevation color in settings. The coloration in the elevation layer will be interpolated between the two colors, based on the scene minimum and the current maximum elevation in the scene.

# 0.5.1
Elevation can now handle up to 65,536 distinct values. This is accomplished by utilizing both red and green channels of the elevation image.

Switched to storing the elevation data for each scene as a webp image in worlds/[world-id]/assets/elevatedvision/[world-id][scene-id]-elevationMap.webp. Previously, the elevation data was stored in the scene flag. Switching to storing an image should be faster by avoiding database churn. In addition, I will backport this to v10 to avoid a potential v10 database issue if the length of the elevation data got too long.

Switched to a Foundry worker for saving the elevation data image when it is modified, which should be faster than the previous approach.

Fixed an error seen in v11 whereby setting the elevation of a grid square would create a border with a lower elevation.

# 0.5.0
Updated for Foundry v11. Update geometry lib to v0.2.1.

Display of the elevation number when in the elevation layer is now faster.

WebGL shadows disabled until a more robust solution can be implemented.

# 0.4.12
Correct error when loading scene for the first time.

# 0.4.11
Correct issue with 0.4.10 release.

# 0.4.10
Try a cache-busting URL to avoid file caching issue with texture image data when in The Forge.

# 0.4.9
Backport from upcoming v0.5.2 to fix storing elevation data in the Forge. Should resolve issue #60. File path creation should no longer override the "html://" prefix. Avoids use of `FilePicker.browse` in favor of `FilePicker.createDirectory`.

# 0.4.8
Backport from v0.5.1 of storing the elevation data for each scene as a webp image in `worlds/[world-id]/assets/elevatedvision/[world-id][scene-id]-elevationMap.webp`. Previously, the elevation data was stored in the scene flag. Switching to storing an image should be faster by avoiding database churn. Avoids a potential v10 database issue that could cause the world not to load if the length of the elevation data got too long.

# 0.4.7
Fix for error thrown with rotated tiles, due to bug in PixelCache.
Remove unnecessary console warning re PixelCache uneven division.

# 0.4.6
Possible fix for issue #54 (moving to new scenes that do not have EV properties set).

Is Potato? Set shadows algorithm to "None" for the scene if performance mode is set to low.

Fix for warning about rendering failure with "/" when opening lighting configuration.

# 0.4.5
Change to how elevation getters are set on placeables to improve compatibility with Alt. Token Visibility.

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
