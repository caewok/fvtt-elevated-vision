/* ----- NOTE: Penumbra Fragment ----- */
// Debugging:
// fragColor = vec4(1.0, 0.0, 0.0, 1.0);
// return;

// Assume no shadow as the default
fragColor = noShadow();

// Tests for within relevant bounds.
if ( inFrontOfWall() ) return;
if ( thresholdApplies() ) return;

// Classes must define shadowPercentage() function.
float shadow = shadowPercentage();
if ( shadow == 0.0 ) return;

// Light is simply the absence of shadow.
float totalLight = clamp(0.0, 1.0, 1.0 - shadow);
fragColor = lightEncoding(totalLight);
