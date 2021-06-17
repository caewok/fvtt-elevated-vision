import { log } from "./module.js";

export function evRestrictVisiblity(wrapped, ...args) {
  const res = wrapped(...args)
  log("evRestrictVisiblity", ...args, res);
}

export function evTestVisibility(wrapped, ...args) {
  const res = wrapped(...args)
  log("evTestVisibility", ...args, res);
}