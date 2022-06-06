/* globals
foundry
*/

/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }]*/

"use strict";

/*
Report intersections between segments using a brute force algorithm.
"Single": Check each segment in an array against every other segment in that array.
"RedBlack": Check each segment in one array ("red") against every segment in a
            second array ("black").

Both functions take a callback function that reports intersecting segment pairs.
*/

/**
 * Identify intersections between segments in an Array.
 * O(n^2) using brute force method.
 * - Counts shared endpoints.
 * - Passes pairs of intersecting segments to a reporting function but does not
 *   calculate the intersection point.
 * @param {Segments[]} segments   Array of objects that contain points A.x, A.y, B.x, B.y
 * @param {Function} reportFn     Callback function that is passed pairs of
 *                                segment objects that intersect.
 */
export function findIntersectionsBruteSingle(segments, reportFn = (_s1, _s2) => {}) {
  const ln = segments.length;
  if (!ln) { return; }

  for (let i = 0; i < ln; i += 1) {
    const si = segments[i];
    for (let j = i + 1; j < ln; j += 1) {
      const sj = segments[j];
      foundry.utils.lineSegmentIntersects(si.A, si.B, sj.A, sj.B) && reportFn(si, sj); // eslint-disable-line no-unused-expressions
    }
  }
}

/**
 * Identify intersections between two arrays of segments.
 * Segments within a single array are not checked for intersections.
 * (If you want intra-array, see findIntersectionsBruteSingle.)
 * O(n*m) using brute force method. "n" and "m" are the lengths of the arrays.
 * - Counts shared endpoints.
 * - Passes pairs of intersecting segments to a reporting function but does not
 *   calculate the intersection point.
 * @param {Segments[]} red      Array of objects that contain points A.x, A.y, B.x, B.y.
 * @param {Segments[]} black    Array of objects that contain points A.x, A.y, B.x, B.y.
 * @param {Function} reportFn     Callback function that is passed pairs of
 *                                segment objects that intersect. Reports red, black.
 */
export function findIntersectionsBruteRedBlack(red, black, reportFn = (_s1, _s2) => {}) {
  const ln1 = red.length;
  const ln2 = black.length;
  if (!ln1 || !ln2) { return; }

  for (let i = 0; i < ln1; i += 1) {
    const si = red[i];
    for (let j = 0; j < ln2; j += 1) {
      const sj = black[j];
      foundry.utils.lineSegmentIntersects(si.A, si.B, sj.A, sj.B) && reportFn(si, sj);  // eslint-disable-line no-unused-expressions
    }
  }
}

/**
 * Determine if at least one segment from black intersects one segment from red.
 * @param {Segments[]} red      Array of objects that contain points A.x, A.y, B.x, B.y.
 * @param {Segments[]} black    Array of objects that contain points A.x, A.y, B.x, B.y.
 * @return {Boolean}
 */
export function hasIntersectionBruteRedBlack(red, black) {
  const ln1 = red.length;
  const ln2 = black.length;
  if (!ln1 || !ln2) { return; }

  for (let i = 0; i < ln1; i += 1) {
    const si = red[i];
    for (let j = 0; j < ln2; j += 1) {
      const sj = black[j];
      if ( foundry.utils.lineSegmentIntersects(si.A, si.B, sj.A, sj.B) ) return true;
    }
  }
  return false;
}
