/**
 * Registry of "sub" template styles (see sub-scene-writer.mjs) — each is a pure
 * `render(params) -> htmlString` module, no LLM involved. Adding a new visual
 * variant (the user's own words: "image_full_focus chỉ là 1 style mà tôi muốn") is
 * just a new file in this directory + one line registering it here.
 */
import * as imageFullFocus from "./image-full-focus.mjs";

export const SUB_STYLES = {
  [imageFullFocus.id]: imageFullFocus,
};

export const DEFAULT_SUB_STYLE = imageFullFocus.id;
