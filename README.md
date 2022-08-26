[![License](https://img.shields.io/github/license/caewok/fvtt-elevated-vision)](LICENSE)

[![Version (latest)](https://img.shields.io/github/v/release/caewok/fvtt-elevated-vision)](https://github.com/caewok/fvtt-elevated-vision/releases/latest)

[![Foundry Version](https://img.shields.io/badge/dynamic/json.svg?url=https://github.com/caewok/fvtt-elevated-vision/releases/latest/download/module.json&label=Foundry%20Version&query=$.compatibleCoreVersion&colorB=blueviolet)](https://github.com/caewok/fvtt-elevated-vision/releases/latest)


You can use this [Module JSON link](https://github.com/caewok/fvtt-elevated-vision/releases/latest/download/module.json) to install.

This Foundry VTT module provides an elevation canvas layer that lets the GM modify elevation values for the scene. Elevation maps can be uploaded or downloaded for a scene. Tokens and lights are affected by the elevation settings:
- Tokens that are currently at the height of the terrain ("on the ground") will change elevation if they move to a higher or lower terrain.
- Lights create shadows based on wall height and terrain elevation
- Token vision affected by wall height and terrain elevation
- Fog of war affected by wall height

This module relies in part on the [Wall Height](https://foundryvtt.com/packages/wall-height/) module to create shadows whenever a token or light is above a wall with a defined height. It also uses the elevation settings for tokens and lights.

*This module is still in early development stages. Many things are likely to change, including the image download/upload format.*

# Module compatibility

## Required modules
- [Wall Height](https://foundryvtt.com/packages/wall-height/)

## Recommended modules
- [Token Lean](https://foundryvtt.com/packages/token-lean). Token Lean is a great addition because it allows tokens to "peak" over the edge of a cliff.

## Incompatible modules
None known at this time, but it is likely that [Levels](https://foundryvtt.com/packages/levels) and [Perfect Vision](https://foundryvtt.com/packages/perfect-vision) will have issues. If you want real 3d, I recommend [Ripper's 3d Canvas](https://theripper93.com/). It probably goes without saying, but I will say it anyway, that mixing this module with 3d Canvas will likely result in serious errors.

# Elevation Layer
Switch to the elevation layer in the controls to modify the elevation data in a given scene.

## Setting elevation

Currently three tools are provided to modify elevation in a scene.
1. Fill by grid. Click a spot on the scene to set the elevation for that grid space.
2. Fill by line-of-sight. Click a spot, and all portions of the map will be set to that elevation that have line of sight to that spot. This uses the same algorithm as token vision, so it is the equivalent of a token's 360º vision from that spot, assuming global illumination.
3. Fill. Click a spot, and it will fill the space enclosed by walls. Note that if the walls are open, it may fill the entire scene. All wall types are treated as normal walls for this purpose. It **should** respect islands. Walls must be actually connected by endpoints, otherwise the fill will likely leak through.

Hover over a spot on the canvas to see the current elevation value. Elevation values are currently represented as different alpha values of red.

## Saving and loading elevation data

You can download the current scene data as a png file using the download button. Use `canvas.elevation.downloadElevationData({ format: "image/png", fileName: "elevation"})` in the console to trigger a save. It is using [PIXI.Extract](https://pixijs.download/release/docs/PIXI.Extract.html), and so recognizes other image formats, such as "image/webp".

You can upload an image file and set it as the elevation data for the current scene using the upload button. Use `canvas.elevation.importFromImageFile` and provide the method a file location in the console to trigger the change manually. It is using [PIXI.Extract](https://pixijs.download/release/docs/PIXI.Extract.html), and so recognizes various image formats, such as "image/webp" or "image/png".

Currently, image data is written to and read from the red channel, with values assumed to be integers between 0 and 255. Essentially, it is a "bump" map. These values are then scaled for a given scene's elevation settings. (Currently set manually but a future update should allow the GM to set the scene's elevation minimum and step size in scene settings.)  It is likely that the channel used will change in the future. Ultimately, I would like to allow for ["normal maps"](https://www.cgdirector.com/normal-vs-displacement-vs-bump-maps/). At the moment, however, Foundry lighting is not set up to take advantage of normals for a given map (outside of maybe [Ripper's 3d Canvas](https://theripper93.com/)).

## Undo and delete

Undo removes the previous action. This only works for recent actions—--exiting the elevation control layer or loading new elevation data will cause a save of data to the scene, which cannot be undone. Deletion will remove all elevation data from the scene.

Scene elevation data save is triggered when leaving the canvas layer.

# Token elevation
A token is assumed to be "on the ground" if its current elevation is equal to that of the terrain. Elevation for this purpose is measured as the average of the elevation at each pixel underneath the token bounds. Elevation is always rounded to the nearest integer.

If a token is "on the ground" and it moves to a new location, its elevation will be automatically adjusted to that of the new location. Tokens not "on the ground" will not have their elevation adjusted.

Future improvements may add settings to allow the GM to toggle or adjust this behavior.

# Token vision shadows
Whenever a token is above a wall with a top height lower than the token vision elevation, the wall obscures the vision of the token for the area immediately next to the wall opposite the token. As the token approaches, that obscured area becomes smaller (think of approaching a cliff and being able to see more and more of what is directly below the cliff). A token whose vision is obscured by a wall can still view other tokens on the other side of the wall if those tokens are elevated to a point sufficiently high to be seen beyond the wall.

Note: This module uses Wall Height's token height implementation. Thus, token vision is at a height of the token elevation + token height. For purposes of seeing other tokens, the token is considered viewable if either the top or bottom of the token would be visible.

For example, a token approaches a 10-foot wall. If that token is at elevation 0, it cannot see past the wall. But it can see a wizard on the other side who is flying at elevation 15.

If that token's vision is instead at elevation 15, it can see past the wall. As the token approaches closer, it sees more and more of the ground past the wall.

<img src="https://raw.githubusercontent.com/caewok/fvtt-elevated-vision/feature/screenshots/screenshots/ravine.jpg" width="400" alt="View of shadows overlooking a ravine">

This token vision shadowing effect is easier to understand when using the Token Lean module, as in this video. Using token lean, the vision origination point of the token is moved closer to the cliff, causing more of the area below to appear and the commensurate shadow area to shrink. This is as if the token is creeping up to the cliff edge and looking over it.

https://user-images.githubusercontent.com/1267134/173108532-2d8732d8-3632-432d-87dc-f2a51bc62def.mov

Currently, token vision shadowing—--which is closely related to fog of war---does not account for terrain elevation. This will hopefully change in the future.

# Lighting shadows
Whenever a light's top elevation is above a wall's top elevation, the wall casts a shadow on the side of the wall opposite the light. Currently, this shadow is a visualization effect only (but see token shadows, above).

Note: This module assumes the light's top elevation is its actual elevation. Bottom elevation is ignored. Setting elevation to positive infinity causes the light to be treated as in default Foundry, with no shadows.

<img src="https://raw.githubusercontent.com/caewok/fvtt-elevated-vision/feature/screenshots/screenshots/lighting_basic.jpg" width="400" alt="Single wall casting a shadow from a light">

Lighting shadows account for terrain elevation. Thus, a wall that casts a shadow will cast less of a shadow---or none at all---over portions of the terrain that are higher than other portions.

Long term, I would like to use a more sophisticated method to render the shadow effect itself, but my WebGL knowledge is quite limited. Suggestions and PRs are welcome!

# API

Much of the underlying functionality of this module can be accessed through `game.modules.get("elevatedvision").api` or through `canvas.elevation`.

In particular, it is expected that systems and modules may wish to query the elevation layer. Key getters/setters and methods. All should be prefaced by `canvas.elevation`.

```js

// Set or get the increment between elevation measurements.
elevationStep

// Set or get the minimum elevation
elevationMin

/**
 * Download the elevation data as an image file.
 * Currently writes the texture elevation data to red channel.
 * @param {object} [options]  Options that affect how the image file is formatted.
 * @param {string} [options.format] Image format, e.g. "image/jpeg" or "image/webp".
 * @param {string} [options.fileName] Name of the file. Extension will be added based on format.
 */
async downloadElevationData({ format = "image/png", fileName = "elevation"} = {})

/**
 * Retrieve the elevation at a single pixel location, using canvas coordinates.
 * @param {number} x
 * @param {number} y
 * @returns {number}   Elevation value.
 */
elevationAt(x, y)

/**
 * Calculate the average elevation for a grid space.
 * @param {number} row    Grid row
 * @param {number} col    Grid column
 * @returns {number} Elevation value.
 */
averageElevationForGridSpace(row, col)

/**
 * Retrieve the average elevation of the grid space that encloses these
 * coordinates. Currently assumes a rectangular grid.
 * @param {number} x
 * @param {number} y
 * @returns {number} Elevation value.
 */
averageElevationAtGridPoint(x, y)

/**
 * Calculate the average elevation value underneath a given rectangle.
 * @param {PIXI.Rectangle} rect
 * @returns {number} Elevation value
 */
averageElevation(rect = new PIXI.Rectangle(0, 0, this._resolution.width, this._resolution.height))

/**
 * Set the elevation for the grid space that contains the point.
 * @param {Point} p             Point within the grid square/hex.
 * @param {number} elevation    Elevation to use to fill the grid space
 * @param {object}  [options]   Options that affect setting this elevation
 * @param {boolean} [options.temporary]   If true, don't immediately require a save.
 *   This setting does not prevent a save if the user further modifies the canvas.
 * @returns {PIXI.Graphics} The child graphics added to the _graphicsContainer
 */
setElevationForGridSpace(p, elevation = 0, { temporary = false } = {})

/**
 * Construct a LOS polygon from this point and fill with the provided elevation.
 * @param {Point} origin        Point where viewer is assumed to be.
 * @param {number} elevation    Elevation to use for the fill.
 * @param {object} [options]    Options that affect the fill.
 * @param {string} [options.type]   Type of line-of-sight to use, which can affect
 *   which walls are included. Defaults to "light".
 * @returns {PIXI.Graphics} The child graphics added to the _graphicsContainer
 */
fillLOS(origin, elevation = 0, { type = "light"} = {})


/**
 * Fill spaces enclosed by walls from a given origin point.
 * @param {Point} origin    Start point for the fill.
 * @param {number} elevation
 * @returns {PIXI.Graphics}   The child graphics added to the _graphicsContainer
 */
fill(origin, elevation)

```

# Wishlist for future improvements

Suggestions or PRs welcome!

- [ ] Adjust fog-of-war and vision based on elevation. Currently, fog-of-war is modified by the shadow cast by walls that have a height below that of the viewing token. But the token vision and fog-of-war should also account for elevation of the terrain. For example, a wall that is 20' high should not create shadows on terrain behind it that is also 20' high.
- [ ] Improved shadow rendering for lights.
- [ ] Handle Hex grids.
- [ ] Tie token vision to light shadows, with the option for light shadows to be considered dim light or no light from the perspective of the token.
- [ ] Modify terrain elevation values by "painting" using a circular or square brush
- [ ] Allow import of normal data for better shadow and shading (using an RGBA import).
- [ ] Consider switching to depth values to measure elevation on the terrain.
- [ ] Switch to alpha channel for image download/upload/internal save.
- [ ] Save only the single channel internally if no normal data is used.
- [ ] Token HUD to place the token "on the ground".
- [ ] Use mousewheel to adjust elevation setting.
- [ ] Fix sizing of current elevation display.
- [ ] Better display of elevation values by color on a scene. Possibly a red gradient or red to blue gradient.
- [x] Adjust shadows based on terrain elevation.
- [x] Fix visual errors that can arise when moving tokens around with multiple shadows present.

