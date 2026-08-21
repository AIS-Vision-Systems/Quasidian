// @aisvision/quasidian-core — the embeddable heart of Quasidian:
// a CodeMirror 6 markdown editor with Obsidian-style Live Preview,
// and a reading-mode HTML renderer fed by the same Lezer tree. No
// Tauri, no filesystem: wikilink resolution, embed sources and
// navigation are injected through the editor hooks; strings and
// icons ship with defaults and take the host's own via
// setCoreTranslator / setIconProvider (m41).

// --- The editor factory: CM6 + Live Preview + folding + commands ---
export {
  createEditor,
  type EditorConfig,
  type EditorHandle,
  type EditorHooks,
} from "./editor/editor";
export { createAutosaveScheduler } from "./editor/autosave";
export {
  arePropertiesCollapsed,
  bumpEmbedGeneration,
  clearEmbedHtmlCache,
  setInlineTitle,
  setInlineTitleRename,
  setKnownPropertyKeys,
  setPropertiesCollapsed,
  sourceMode,
  type LivePreviewHooks,
} from "./editor/livePreview";
export { cachedImageSize, cacheImageSize } from "./editor/imageSizeCache";
export {
  initialResizeAnchor,
  onBurstEnd,
  onHostResize,
  onUserScroll,
  RESIZE_BURST_QUIET_MS,
  type ResizeAnchorState,
} from "./editor/resizeAnchor";

// --- The shared markdown pipeline and the reading render ---
export { markdownExtensions, markdownParser } from "./markdown/parser";
export { renderToHtml } from "./markdown/render";
export { isExternalTarget, isImageTarget } from "./markdown/wikilinks";
export { parseFrontmatter } from "./lib/frontmatter";

// --- Rendered-content helpers (embeds, code, math) ---
export {
  addCodePills,
  copyText,
  fillEmbedImages,
  fillEmbedNotes,
  highlightCodeBlocks,
  markUnresolvedLinks,
  renderMathElements,
  type EmbedFillHooks,
  type EmbedNoteResult,
} from "./ui/renderedContent";
export {
  hideHoverPreview,
  scheduleHoverHide,
  scheduleHoverShow,
  scheduleHtmlHover,
} from "./ui/hoverPreview";
export { buildInlineTitleElement } from "./ui/inlineTitle";

// --- Chrome the editor experience needs (menus, icons) ---
export {
  closeContextMenu,
  openContextMenu,
  openPromptModal,
  type MenuEntry,
  type MenuItem,
} from "./ui/contextMenu";
export {
  createIcon,
  iconMarkup,
  setIconProvider,
  type IconName,
} from "./ui/icons";

// --- Host integration: strings ---
export {
  CORE_STRINGS,
  ct,
  setCoreTranslator,
  type CoreStringKey,
  type CoreTranslator,
} from "./lib/coreStrings";
