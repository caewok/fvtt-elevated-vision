[![License](https://img.shields.io/github/license/caewok/fvtt-elevated-vision)](LICENSE)

[![Version (latest)](https://img.shields.io/github/v/release/caewok/fvtt-elevated-vision)](https://github.com/caewok/fvtt-elevated-vision/releases/latest)

[![Foundry Version](https://img.shields.io/badge/dynamic/json.svg?url=https://github.com/caewok/fvtt-elevated-vision/releases/latest/download/module.json&label=Foundry%20Version&query=$.compatibleCoreVersion&colorB=blueviolet)](https://github.com/caewok/fvtt-elevated-vision/releases/latest)


You can use this [Module JSON link](https://github.com/caewok/fvtt-elevated-vision/releases/latest/download/module.json) to install.

This Foundry VTT module builds on the [Wall Height](https://foundryvtt.com/packages/wall-height/) module to create shadows whenever a token or light is above a given wall.

# Module compatibility

## Required modules
- [Wall Height](https://foundryvtt.com/packages/wall-height/)

## Recommended modules
- [Token Lean](https://foundryvtt.com/packages/token-lean). Token Lean is a great addition because it allows tokens to "peak" over the edge of a cliff.

## Incompatible modules
None known at this time, but it is likely that [Levels](https://foundryvtt.com/packages/levels) and [Perfect Vision](https://foundryvtt.com/packages/perfect-vision) will have issues.

# Token shadows
Whenever a token is above a wall with a top height lower than the token vision elevation, the wall obscures the vision of the token for the area immediately next to the wall opposite the token. As the token approaches, that obscured area becomes smaller (think of approaching a cliff and being able to see more and more of what is directly below the cliff). A token whose vision is obscured by a wall can still view other tokens on the other side of the wall if those tokens are elevated to a point sufficiently high to be seen beyond the wall.

Note: This module uses Wall Height's token height implementation. Thus, token vision is at a height of the token elevation + token height. For purposes of seeing other tokens, the token is considered viewable if either the top or bottom of the token would be visible.

For example, a token approaches a 10-foot wall. If that token is at elevation 0, it cannot see past the wall. But it can see a wizard on the other side who is flying at elevation 15.

If that token's vision is instead at elevation 15, it can see past the wall. As the token approaches closer, it sees more and more of the ground past the wall.

<img src="https://raw.githubusercontent.com/caewok/fvtt-elevated-vision/feature/screenshots/screenshots/ravine.jpg" width="400" alt="View of shadows overlooking a ravine">

This token vision shadowing effect is easier to understand when using the Token Lean module, as in this video. Using token lean, the vision origination point of the token is moved closer to the cliff, causing more of the area below to appear and the commensurate shadow area to shrink. This is as if the token is creeping up to the cliff edge and looking over it.

![Peeking over a ravine](https://raw.githubusercontent.com/caewok/fvtt-elevated-vision/feature/screenshots/screenshots/ravine_peek.webm)

# Lighting shadows
Whenever a light's top elevation is above a wall's top elevation, the wall casts a shadow on the side of the wall opposite the light. Currently, this shadow is a visualization effect only (but see token shadows, above).

Note: This module assumes the light's top elevation is its actual elevation. Bottom elevation is ignored. Setting elevation to positive infinity causes the light to be treated as in default Foundry, with no shadows.

<img src="https://raw.githubusercontent.com/caewok/fvtt-elevated-vision/feature/screenshots/screenshots/lighting_basic.jpg" width="400" alt="Single wall casting a shadow from a light">

# Wishlist for future improvements
- Improved shadow rendering for lights, particularly where multiple lights overlap or have overlapping shadows.
- Adjust shadows based on terrain elevation. Currently, shadows are constructed assuming they are projected onto a terrain of elevation 0.
- Fix visual errors that can arise when moving tokens around with multiple shadows present.
- Tie token vision to light shadows, with the option for light shadows to be considered dim light or no light from the perspective of the token.