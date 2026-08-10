/**
 * Registry of "sub" template styles (see sub-scene-writer.mjs) — each is a pure
 * `render(params) -> htmlString` module, no LLM involved. Adding a new visual
 * variant (the user's own words: "image_full_focus chỉ là 1 style mà tôi muốn") is
 * just a new file in this directory + one line registering it here.
 */
import * as imageFullFocus from "./image-full-focus.mjs";
import * as kineticTypography from "./kinetic-typography.mjs";
import * as imageBlurCard from "./image-blur-card.mjs";
import * as imageLifeInsightsLight from "./image-life-insights-light.mjs";
import * as investigationBoard from "./investigation-board.mjs";

export const SUB_STYLES = {
  [imageFullFocus.id]: imageFullFocus,
  [kineticTypography.id]: kineticTypography,
  [imageBlurCard.id]: imageBlurCard,
  [imageLifeInsightsLight.id]: imageLifeInsightsLight,
  [investigationBoard.id]: investigationBoard,
};

export const DEFAULT_SUB_STYLE = imageFullFocus.id;
