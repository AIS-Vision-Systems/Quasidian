// App shell: sidebar with folder listing, CM6 editor, status bar.
import { convertFileSrc } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import {
  getAllWebviewWindows,
  WebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { t } from "../i18n/i18n";
import {
  deleteFile,
  listFolder,
  openFolderDialog,
  openMarkdownFileDialog,
  readFile,
  renameFile,
  startupFile,
  watchFolder,
  writeFile,
  type FileEntry,
} from "../ipc/fs";
import { createEditor } from "../editor/editor";
import {
  initialResizeAnchor,
  onBurstEnd,
  onHostResize,
  onUserScroll,
  RESIZE_BURST_QUIET_MS,
} from "../editor/resizeAnchor";
import {
  bumpEmbedGeneration,
  clearEmbedHtmlCache,
  setInlineTitle,
  setInlineTitleRename,
  setKnownPropertyKeys,
} from "../editor/livePreview";
import { createAutosaveScheduler } from "../editor/autosave";
import { createBacklinkIndex } from "../lib/backlinkIndex";
import { createSearchIndex, type SearchMatch } from "../lib/searchIndex";
import {
  basename,
  dirname,
  joinPath,
  normalizePath,
  samePath,
} from "../lib/paths";
import type { EditorModeSetting } from "../lib/settings";
import { extractLinkTargets } from "../lib/backlinkIndex";
import { parseFrontmatter } from "../lib/frontmatter";
import { computeOutline, findHeading, sectionSlice } from "../lib/outline";
import { applyRewrites, renameLinkTargets } from "../lib/renameLinks";
import { countCharacters, countWords } from "../lib/text";
import {
  resolveWikilink,
  splitAnchor,
  type FolderFile,
} from "../lib/wikilinks";
import {
  detectVault,
  isIgnoredDir,
  MAX_VAULT_DEPTH,
  type VaultMode,
} from "../lib/vault";
import {
  buildFolderTree,
  collapsedByDefault,
  relativePath,
  type TreeNode,
} from "../lib/folderTree";
import {
  activeTabPath,
  cloneTab,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  emptyWorkspace,
  findTab,
  goBack,
  goForward,
  historyState,
  makeTab,
  moveTab,
  newEmptyTab,
  openPath as openTabPath,
  peekBack,
  peekForward,
  renameTabPath,
  setPinned,
  type PanelSizes,
  type RightPanelView,
  type Tab,
  type WorkspaceState,
} from "../lib/workspace";
import {
  closePane,
  moveTabToPane,
  paneById,
  resizeBorder,
  serializeSession,
  setActivePane,
  singlePane,
  splitRight,
  withWorkspace,
  withWorkspaceOrCollapse,
  type SessionData,
  type SplitState,
} from "../lib/panes";
import {
  loadUiState,
  loadVaultSession,
  migrateLegacySessions,
  saveUiState,
  saveVaultSession,
} from "../ipc/sessionStore";
import { checkForUpdate } from "../ipc/updates";
import {
  emptyUiState,
  parseScopeEntry,
  resolveScope,
  routeDecision,
  scopeOf,
  sessionOwner,
  type ScopeEntry,
  type ScopeInfo,
  type UiState,
} from "../lib/vaultSession";
import type { EditorHandle } from "../editor/editor";
import type { ReadingViewHandle } from "./readingView";
import { renderToHtml } from "../markdown/render";
import { isExternalTarget, isImageTarget } from "../markdown/wikilinks";
import {
  getSettings,
  subscribeSettings,
  updateSettings,
} from "../ipc/settingsStore";
import { editorConfigFrom } from "./applySettings";
import { commandPaletteItems, type Command } from "./commands";
import {
  openContextMenu,
  openPromptModal,
  type MenuEntry,
} from "./contextMenu";
import { openHelpModal } from "./helpModal";
import { hideHoverPreview } from "./hoverPreview";
import { createIcon } from "./icons";
import { copyText } from "./renderedContent";
import { openPalette } from "./palette";
import { exportNoteToPdf } from "./printExport";
import { createReadingView } from "./readingView";
import { openSettingsModal } from "./settingsModal";

export function mountLayout(root: HTMLElement): void {
  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";

  // Left top bar: open file, open folder, search.
  const sidebarHeader = document.createElement("div");
  sidebarHeader.className = "sidebar-header";
  const openFileButton = document.createElement("button");
  openFileButton.className = "view-header-button";
  openFileButton.append(createIcon("file-plus"));
  openFileButton.addEventListener("click", () => void openFileFromDialog());
  const openFolderButton = document.createElement("button");
  openFolderButton.className = "view-header-button";
  openFolderButton.append(createIcon("folder"));
  openFolderButton.addEventListener("click", () => void openFolderFromDialog());
  const searchButton = document.createElement("button");
  searchButton.className = "view-header-button";
  searchButton.append(createIcon("search"));
  searchButton.addEventListener("click", () => toggleSearch());
  // Collapse/expand every folder of the vault tree (vault mode only);
  // Ctrl+click re-applies the smart fold, right-click lists all three.
  const collapseAllButton = document.createElement("button");
  collapseAllButton.className = "view-header-button is-hidden";
  collapseAllButton.addEventListener("click", (event) => {
    if (event.ctrlKey || event.metaKey) {
      applySmartFold();
      // Ctrl is still down over the button: keep the preview up.
      syncCollapseAllPreview(true);
    } else {
      toggleCollapseAll();
    }
  });
  collapseAllButton.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openContextMenu(event.clientX, event.clientY, [
      {
        label: t("sidebar.collapseAll"),
        icon: "chevrons-down-up",
        onClick: () => collapseAllFolders(),
      },
      {
        label: t("sidebar.expandAll"),
        icon: "chevrons-up-down",
        onClick: () => expandAllFolders(),
      },
      {
        label: t("sidebar.smartFold"),
        icon: "sparkles",
        onClick: () => applySmartFold(),
      },
    ]);
  });
  // Ctrl held while hovering previews the smart fold: the button shows
  // the sparkles icon and its tooltip until Ctrl is released or the
  // pointer leaves; then the state icon and tooltip come back. The
  // preview must be idempotent: holding Ctrl auto-repeats keydown, and
  // re-replacing the icon on every repeat suppresses both the native
  // tooltip and the click (the pressed element would vanish mid-click).
  let collapseAllHovered = false;
  let collapseAllPreview = false;
  // Native title tooltips only appear after a mouse move, so pressing
  // Ctrl with the pointer at rest would never show one: the preview
  // brings its own tip instead.
  const collapseAllTip = document.createElement("div");
  collapseAllTip.className = "button-tip";
  document.body.append(collapseAllTip);
  const syncCollapseAllPreview = (smart: boolean): void => {
    if (smart === collapseAllPreview) {
      return;
    }
    if (smart) {
      collapseAllPreview = true;
      const label = t("sidebar.smartFold");
      collapseAllButton.replaceChildren(createIcon("sparkles"));
      collapseAllButton.removeAttribute("title");
      collapseAllButton.setAttribute("aria-label", label);
      collapseAllTip.textContent = label;
      const rect = collapseAllButton.getBoundingClientRect();
      collapseAllTip.style.left = `${rect.left}px`;
      collapseAllTip.style.top = `${rect.bottom + 6}px`;
      collapseAllTip.classList.add("is-visible");
    } else {
      collapseAllTip.classList.remove("is-visible");
      updateCollapseAllButton();
    }
  };
  collapseAllButton.addEventListener("mouseenter", (event) => {
    collapseAllHovered = true;
    syncCollapseAllPreview(event.ctrlKey || event.metaKey);
  });
  collapseAllButton.addEventListener("mouseleave", () => {
    collapseAllHovered = false;
    updateCollapseAllButton();
  });
  window.addEventListener("keydown", (event) => {
    if (collapseAllHovered && (event.key === "Control" || event.key === "Meta")) {
      syncCollapseAllPreview(true);
    }
  });
  window.addEventListener("keyup", (event) => {
    if (collapseAllHovered && (event.key === "Control" || event.key === "Meta")) {
      syncCollapseAllPreview(false);
    }
  });
  sidebarHeader.append(
    openFileButton,
    openFolderButton,
    searchButton,
    collapseAllButton,
  );
  sidebar.append(sidebarHeader);

  const sidebarFiles = document.createElement("div");
  sidebarFiles.className = "sidebar-view";

  const fileList = document.createElement("ul");
  fileList.className = "file-list";
  sidebarFiles.append(fileList);
  sidebar.append(sidebarFiles);

  const sidebarSearch = document.createElement("div");
  sidebarSearch.className = "sidebar-view is-hidden";
  const searchHeader = document.createElement("div");
  searchHeader.className = "search-header";
  const searchTitle = document.createElement("span");
  searchTitle.textContent = t("search.title");
  const searchClose = document.createElement("button");
  searchClose.className = "search-close";
  searchClose.append(createIcon("x"));
  searchClose.title = t("search.close");
  searchClose.setAttribute("aria-label", t("search.close"));
  searchHeader.append(searchTitle, searchClose);
  const searchInput = document.createElement("input");
  searchInput.className = "search-input";
  searchInput.placeholder = t("search.placeholder");
  searchInput.spellcheck = false;
  const searchStatus = document.createElement("div");
  searchStatus.className = "search-status";
  const searchResults = document.createElement("ul");
  searchResults.className = "search-results";
  sidebarSearch.append(searchHeader, searchInput, searchStatus, searchResults);
  sidebar.append(sidebarSearch);


  const workspace = document.createElement("main");
  workspace.className = "workspace";

  // Central area: a row of vertical panes (splits), each with its own
  // tab strip, file bar, editor and reading view. The collapse buttons
  // sit at the far ends of the first/last pane's strip.
  const collapseLeftButton = document.createElement("button");
  collapseLeftButton.className = "view-header-button";
  collapseLeftButton.append(createIcon("panel-left"));
  collapseLeftButton.addEventListener("click", () => toggleSidebar());
  const collapseRightButton = document.createElement("button");
  collapseRightButton.className = "view-header-button";
  collapseRightButton.append(createIcon("panel-right"));
  collapseRightButton.addEventListener("click", () => toggleRightPanel());

  const panesRow = document.createElement("div");
  panesRow.className = "panes-row";
  workspace.append(panesRow);

  interface PaneUi {
    id: number;
    root: HTMLElement;
    header: HTMLElement;
    tabBar: HTMLElement;
    fileBar: HTMLElement;
    viewTitle: HTMLElement;
    navBackButton: HTMLButtonElement;
    navForwardButton: HTMLButtonElement;
    modeHeaderButton: HTMLButtonElement;
    moreButton: HTMLButtonElement;
    body: HTMLElement;
    welcome: HTMLElement;
    editorHost: HTMLElement;
    emptyTabView: HTMLElement;
    imageView: HTMLElement;
    imageEl: HTMLImageElement;
    editor: EditorHandle;
    readingView: ReadingViewHandle;
    /** Disconnects the reading view's resize re-anchoring (m36). */
    disposeReadingResize: () => void;
    openedPath: string | null;
    mode: EditorModeSetting;
  }

  const paneUis = new Map<number, PaneUi>();
  let boundPaneId = 1;

  // Active-pane bindings: everything below operates on these; they are
  // re-assigned whenever another pane becomes the active one.
  let tabBar!: HTMLElement;
  let fileBar!: HTMLElement;
  let viewTitle!: HTMLElement;
  let navBackButton!: HTMLButtonElement;
  let navForwardButton!: HTMLButtonElement;
  let modeHeaderButton!: HTMLButtonElement;
  let workspaceBody!: HTMLElement;
  let welcome!: HTMLElement;
  let editorHost!: HTMLElement;
  let emptyTabView!: HTMLElement;
  let imageView!: HTMLElement;
  let imageEl!: HTMLImageElement;
  let editor!: EditorHandle;
  let readingView!: ReadingViewHandle;

  function createPaneUi(id: number): PaneUi {
    const root = document.createElement("section");
    root.className = "pane";
    root.dataset.paneId = String(id);
    const header = document.createElement("div");
    header.className = "view-header";
    const paneTabBar = document.createElement("div");
    paneTabBar.className = "tab-bar";
    header.append(paneTabBar);

    const paneFileBar = document.createElement("div");
    paneFileBar.className = "file-bar is-hidden";
    const navGroup = document.createElement("div");
    navGroup.className = "view-header-actions file-nav";
    const back = document.createElement("button");
    back.className = "view-header-button";
    back.append(createIcon("arrow-left"));
    // Ctrl/Cmd+click (and middle-click) opens the history entry in a
    // new tab instead of navigating, like Obsidian.
    back.addEventListener("click", (event) =>
      event.ctrlKey || event.metaKey
        ? void openHistoryInNewTab(-1)
        : void navigateHistory(-1),
    );
    back.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        void openHistoryInNewTab(-1);
      }
    });
    const forward = document.createElement("button");
    forward.className = "view-header-button";
    forward.append(createIcon("arrow-right"));
    forward.addEventListener("click", (event) =>
      event.ctrlKey || event.metaKey
        ? void openHistoryInNewTab(1)
        : void navigateHistory(1),
    );
    forward.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        void openHistoryInNewTab(1);
      }
    });
    navGroup.append(back, forward);
    const title = document.createElement("span");
    title.className = "view-title";
    title.addEventListener("contextmenu", (event) => {
      if (openedPath !== null) {
        event.preventDefault();
        openFileMenu(event.clientX, event.clientY, openedPath, "title");
      }
    });
    const actions = document.createElement("div");
    actions.className = "view-header-actions";
    const mode = document.createElement("button");
    mode.className = "view-header-button";
    mode.append(createIcon("book-open"));
    mode.addEventListener("click", () => void toggleMode());
    const more = document.createElement("button");
    more.className = "view-header-button";
    more.append(createIcon("more-vertical"));
    more.addEventListener("click", () => {
      if (openedPath !== null) {
        const rect = more.getBoundingClientRect();
        openFileMenu(rect.left, rect.bottom + 4, openedPath, "more");
      }
    });
    actions.append(mode, more);
    paneFileBar.append(navGroup, title, actions);

    const body = document.createElement("div");
    body.className = "workspace-body";
    const welcomeEl = document.createElement("div");
    welcomeEl.className = "workspace-welcome";
    welcomeEl.textContent = t("workspace.welcome");
    const host = document.createElement("div");
    host.className = "editor-host is-hidden";
    // Right-clicking the editor's empty margins or the line-number
    // gutter opens the view menu; inside the text, the editor's menu
    // applies.
    host.addEventListener("contextmenu", (event) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        target.closest(".cm-content") !== null
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openViewMenu(event.clientX, event.clientY);
    });
    const emptyView = document.createElement("div");
    emptyView.className = "empty-tab-view is-hidden";
    const emptyTabAction = (
      labelKey: string,
      onClick: () => void,
    ): HTMLButtonElement => {
      const action = document.createElement("button");
      action.className = "empty-tab-action";
      action.dataset.labelKey = labelKey;
      action.textContent = t(labelKey);
      action.addEventListener("click", onClick);
      return action;
    };
    emptyView.append(
      emptyTabAction("tabs.actionNewNote", () => void createNewNote()),
      emptyTabAction("tabs.actionOpenFile", () => openQuickSwitcher()),
      emptyTabAction("tabs.actionClose", () => {
        if (tabsState.active !== -1) {
          void closeTabAt(tabsState.active);
        }
      }),
    );
    // Read-only image view (milestone 32): a tab holding an image file
    // renders it here instead of the editor.
    const paneImageView = document.createElement("div");
    paneImageView.className = "image-view is-hidden";
    const paneImageEl = document.createElement("img");
    paneImageView.append(paneImageEl);
    const paneEditor = createPaneEditor(host);
    const paneReading = createPaneReading();
    body.append(welcomeEl, host, emptyView, paneImageView, paneReading.element);
    root.append(header, paneFileBar, body);

    // Reading mode reflows on window/pane resizes exactly like the
    // editor: hold the top anchor through the burst and re-apply it
    // (m36). The editor's own observer lives inside createEditor;
    // scrollReadingToAnchorIn keeps re-applying while heights settle.
    let readResize = initialResizeAnchor();
    let readBurst: number | null = null;
    const readReapply = (): void => {
      if (readResize.holding !== null) {
        scrollReadingToAnchorIn(
          paneReading.element,
          paneEditor.getDoc().length,
          readResize.holding,
        );
      }
    };
    const readDrop = (): void => {
      readResize = onUserScroll(readResize);
      if (readBurst !== null) {
        clearTimeout(readBurst);
        readBurst = null;
      }
    };
    const readObserver = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1].contentRect;
      const { state, action } = onHostResize(
        readResize,
        rect.width,
        rect.height,
        () =>
          readingTopAnchorIn(paneReading.element, paneEditor.getDoc().length),
      );
      readResize = state;
      if (action.kind !== "anchor") {
        return;
      }
      readReapply();
      if (readBurst !== null) {
        clearTimeout(readBurst);
      }
      readBurst = window.setTimeout(() => {
        readBurst = null;
        readReapply();
        readResize = onBurstEnd(readResize);
      }, RESIZE_BURST_QUIET_MS);
    });
    readObserver.observe(paneReading.element);
    paneReading.element.addEventListener("wheel", readDrop, { passive: true });
    paneReading.element.addEventListener("mousedown", readDrop);
    paneReading.element.addEventListener("touchstart", readDrop, {
      passive: true,
    });

    // Interacting anywhere in a pane makes it the active one — in the
    // capture phase, so every inner handler sees the new bindings.
    root.addEventListener(
      "mousedown",
      () => {
        if (boundPaneId !== id) {
          focusPane(id);
        }
      },
      true,
    );

    const ui: PaneUi = {
      id,
      root,
      header,
      tabBar: paneTabBar,
      fileBar: paneFileBar,
      viewTitle: title,
      navBackButton: back,
      navForwardButton: forward,
      modeHeaderButton: mode,
      moreButton: more,
      body,
      welcome: welcomeEl,
      editorHost: host,
      emptyTabView: emptyView,
      imageView: paneImageView,
      imageEl: paneImageEl,
      editor: paneEditor,
      readingView: paneReading,
      disposeReadingResize: () => {
        readObserver.disconnect();
        if (readBurst !== null) {
          clearTimeout(readBurst);
        }
      },
      openedPath: null,
      mode: "edit",
    };
    paneUis.set(id, ui);
    return ui;
  }

  /** Saves the bound pane's volatile state and rebinds all aliases. */
  function bindPaneUi(id: number): void {
    // Always save first — also when re-binding the same pane, so the
    // read-back below never resurrects stale state.
    const current = paneUis.get(boundPaneId);
    if (current !== undefined) {
      current.openedPath = openedPath;
      current.mode = currentMode;
      splitState = withWorkspace(splitState, boundPaneId, tabsState);
    }
    const ui = paneUis.get(id);
    if (ui === undefined) {
      return;
    }
    boundPaneId = id;
    tabBar = ui.tabBar;
    fileBar = ui.fileBar;
    viewTitle = ui.viewTitle;
    navBackButton = ui.navBackButton;
    navForwardButton = ui.navForwardButton;
    modeHeaderButton = ui.modeHeaderButton;
    workspaceBody = ui.body;
    welcome = ui.welcome;
    editorHost = ui.editorHost;
    emptyTabView = ui.emptyTabView;
    imageView = ui.imageView;
    imageEl = ui.imageEl;
    editor = ui.editor;
    readingView = ui.readingView;
    openedPath = ui.openedPath;
    currentMode = ui.mode;
    const pane = paneById(splitState, id);
    tabsState = pane === null ? emptyWorkspace() : pane.workspace;
    // The inline-title module state follows the bound pane.
    setInlineTitle(
      openedPath !== null && getSettings().appearance.inlineTitle
        ? basename(openedPath).replace(/\.md$/i, "")
        : null,
    );
    editor.refreshBlocks();
  }

  /** Makes pane `id` the active one (user interaction). */
  function focusPane(id: number): void {
    if (boundPaneId === id && splitState.activePane === id) {
      return;
    }
    bindPaneUi(id);
    splitState = setActivePane(splitState, id);
    for (const [paneId, ui] of paneUis) {
      ui.root.classList.toggle("is-active-pane", paneId === id);
    }
    // Status bar and right panel follow the active pane. The tab bars
    // themselves are not rebuilt here: a rebuild mid-mousedown would
    // detach the element the user is clicking.
    refreshStatusChrome();
    updateNavButtons();
    renderBacklinks();
    scheduleSessionSave();
  }

  // Right panel: one list, three views (backlinks, outgoing, outline).
  type RightView = RightPanelView;
  let rightView: RightView = "backlinks";
  const backlinksPanel = document.createElement("aside");
  backlinksPanel.className = "backlinks-panel";
  const rightHeader = document.createElement("div");
  rightHeader.className = "backlinks-header";
  const rightViewButtons = new Map<RightView, HTMLButtonElement>();
  const rightViewsBar = document.createElement("div");
  rightViewsBar.className = "right-panel-views";
  for (const [view, icon] of [
    ["backlinks", "link"],
    ["outgoing", "arrow-up-right"],
    ["outline", "list"],
  ] as const) {
    const button = document.createElement("button");
    button.className = "view-header-button";
    button.append(createIcon(icon));
    button.addEventListener("click", () => {
      rightView = view;
      renderRightPanel();
      scheduleSessionSave();
    });
    rightViewButtons.set(view, button);
    rightViewsBar.append(button);
  }
  const backlinksTitle = document.createElement("span");
  backlinksTitle.className = "right-panel-title";
  const backlinksCount = document.createElement("span");
  backlinksCount.className = "backlinks-count";
  rightHeader.append(rightViewsBar, backlinksTitle, backlinksCount);
  const backlinksList = document.createElement("ul");
  backlinksList.className = "backlinks-list";
  backlinksPanel.append(rightHeader, backlinksList);

  const statusBar = document.createElement("footer");
  statusBar.className = "status-bar";
  // Left side: command palette, quick switcher and settings.
  const statusPalette = document.createElement("button");
  statusPalette.className = "status-bar-icon";
  statusPalette.append(createIcon("terminal"));
  statusPalette.addEventListener("click", () => openCommandPalette());
  const statusSwitcher = document.createElement("button");
  statusSwitcher.className = "status-bar-icon";
  statusSwitcher.append(createIcon("file-search"));
  statusSwitcher.addEventListener("click", () => openQuickSwitcher());
  const settingsButton = document.createElement("button");
  settingsButton.className = "status-bar-icon";
  settingsButton.append(createIcon("settings"));
  settingsButton.addEventListener("click", () => openSettingsModal());
  const helpButton = document.createElement("button");
  helpButton.className = "status-bar-icon";
  helpButton.append(createIcon("help-circle"));
  helpButton.addEventListener("click", () => openHelpModal());
  const statusError = document.createElement("span");
  statusError.className = "status-bar-error";
  // Discreet startup notice when a newer version exists (check-only);
  // clicking opens the download page.
  const statusUpdate = document.createElement("button");
  statusUpdate.className = "status-bar-update";
  statusUpdate.hidden = true;
  let availableUpdate: { version: string; url: string } | null = null;
  statusUpdate.addEventListener("click", () => {
    if (availableUpdate !== null) {
      void openUrl(availableUpdate.url).catch(() => undefined);
    }
  });
  const statusBacklinks = document.createElement("button");
  statusBacklinks.className = "status-bar-backlinks";
  statusBacklinks.hidden = true;
  statusBacklinks.addEventListener("click", () => showBacklinksView());
  const wordCount = document.createElement("span");
  const charCount = document.createElement("span");
  const modeButton = document.createElement("button");
  modeButton.className = "status-bar-mode";
  modeButton.textContent = t("statusBar.mode.edit");
  modeButton.addEventListener("click", () => void toggleMode());
  statusBar.append(
    settingsButton,
    helpButton,
    statusPalette,
    statusSwitcher,
    statusError,
    statusUpdate,
    statusBacklinks,
    wordCount,
    charCount,
    modeButton,
  );

  root.append(sidebar, workspace, backlinksPanel, statusBar);

  // Side panels resize by dragging the workspace's edges; the widths
  // persist with the session.
  let panelSizes: PanelSizes | null = null;

  function applyPanelSizes(): void {
    if (panelSizes !== null) {
      root.style.setProperty("--left-panel-width", `${panelSizes.left}px`);
      root.style.setProperty("--right-panel-width", `${panelSizes.right}px`);
    }
  }

  function panelResizeHandle(side: "left" | "right"): HTMLElement {
    const handle = document.createElement("div");
    handle.className = `panel-resize panel-resize-${side}`;
    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const start: PanelSizes = panelSizes ?? {
        left: Math.round(sidebar.getBoundingClientRect().width),
        right: Math.round(backlinksPanel.getBoundingClientRect().width),
      };
      const startWidth = side === "left" ? start.left : start.right;
      handle.classList.add("is-dragging");
      const onMove = (move: MouseEvent): void => {
        const delta =
          side === "left" ? move.clientX - startX : startX - move.clientX;
        const width = Math.max(
          160,
          Math.min(600, Math.round(startWidth + delta)),
        );
        panelSizes =
          side === "left"
            ? { ...start, left: width }
            : { ...start, right: width };
        applyPanelSizes();
      };
      const onUp = (): void => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        handle.classList.remove("is-dragging");
        scheduleSessionSave();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    return handle;
  }
  workspace.append(panelResizeHandle("left"), panelResizeHandle("right"));

  let openedPath: string | null = null;
  let tabsState: WorkspaceState = emptyWorkspace();
  let splitState: SplitState = singlePane(emptyWorkspace());
  let currentFolder: string | null = null;
  // Multi-folder vault modes (CLAUDE/GPT): a marker file roots a
  // recursive vault; currentFolder then holds the vault root.
  let vaultRoot: string | null = null;
  let vaultMode: VaultMode | null = null;
  let vaultTree: TreeNode[] = [];
  // Last folder probed for markers, so flat folders are not re-probed
  // on every file open (markers are picked up on folder changes).
  let vaultProbeBase: string | null = null;
  const collapsedDirs = new Set<string>();
  // Whether the fold state came from the vault session or the user;
  // false = compute the smart default on the next vault render.
  let foldStateKnown = false;
  const windowLabel = getCurrentWindow().label;
  const isMainWindow = windowLabel === "main";
  // Per-vault sessions: the scope this window belongs to. Set only by
  // explicit opens and the startup restore — never by following links
  // or switching tabs — so saves never leak into another vault's
  // session even though the sidebar keeps tracking the active file.
  let homeScope: ScopeInfo | null = null;
  // The user home (and its ancestors) never roots a vault: config
  // dirs like ~/.claude would swallow every note under the profile.
  const excludedVaultRoot: Promise<string | undefined> = homeDir().catch(
    () => undefined,
  );

  // --- Cross-window scope registry (milestone 31) ---
  // Every window publishes its home scope under its own localStorage
  // key (shared origin across windows), so explicit opens can route to
  // the window already holding a vault. One key per window: no writer
  // ever races another. Entries of crashed windows are filtered by
  // intersecting with the live window list.
  const SCOPE_ENTRY_PREFIX = "qd-scope:";

  function publishScope(): void {
    if (homeScope === null) {
      return;
    }
    try {
      localStorage.setItem(
        SCOPE_ENTRY_PREFIX + windowLabel,
        JSON.stringify({
          key: homeScope.key,
          root: homeScope.root,
          focusedAt: Date.now(),
        }),
      );
    } catch {
      // Registry is best-effort; routing degrades to spawning.
    }
  }

  function clearScopeEntry(): void {
    try {
      localStorage.removeItem(SCOPE_ENTRY_PREFIX + windowLabel);
    } catch {
      // Best effort.
    }
  }

  function queryScopes(): ScopeEntry[] {
    const entries: ScopeEntry[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key === null || !key.startsWith(SCOPE_ENTRY_PREFIX)) {
          continue;
        }
        const value = localStorage.getItem(key);
        if (value === null) {
          continue;
        }
        const entry = parseScopeEntry(
          key.slice(SCOPE_ENTRY_PREFIX.length),
          value,
        );
        if (entry !== null) {
          entries.push(entry);
        }
      }
    } catch {
      // Best effort.
    }
    return entries;
  }

  async function liveWindowLabels(): Promise<string[]> {
    try {
      return (await getAllWebviewWindows()).map((win) => win.label);
    } catch {
      return [];
    }
  }

  /** Adopts `scope` as this window's vault and announces it. */
  function setHomeScope(scope: ScopeInfo): void {
    homeScope = scope;
    publishScope();
    uiState.lastVault = scope.root;
    void saveUiState(uiState);
  }

  // Workspace mutations arriving from outside the UI (startup restore,
  // routed opens, single-instance forwards) run strictly one after
  // another: a routed file landing mid-restore must not interleave two
  // async flows over the same split state.
  let workspaceQueue: Promise<void> = Promise.resolve();
  function enqueueWorkspace(task: () => Promise<void>): Promise<void> {
    const next = workspaceQueue.then(task);
    workspaceQueue = next.catch(() => undefined);
    return next;
  }
  // Global layout fallbacks + last-vault pointer (ui-state.json).
  let uiState: UiState = emptyUiState();
  let folderFiles: FolderFile[] = [];
  let folderImages: FolderFile[] = [];
  let lastWordCount = 0;
  let lastCharCount = 0;
  let watchedFolder: string | null = null;
  let sidebarVisible = true;
  let rightVisible = true;
  let reloadingFromDisk = false;
  let searchVisible = false;
  const backlinkIndex = createBacklinkIndex();
  const searchIndex = createSearchIndex();
  // Frontmatter metadata (aliases, tags) per file, kept with the indexes.
  const fileMeta = new Map<
    string,
    { aliases: string[]; tags: string[]; keys: string[] }
  >();

  /** Copies indexed aliases onto the folder listing used by resolution. */
  function attachAliases(): void {
    for (const file of folderFiles) {
      file.aliases = fileMeta.get(normalizePath(file.path))?.aliases;
    }
    const keys: string[] = [];
    for (const meta of fileMeta.values()) {
      for (const key of meta.keys) {
        if (!keys.includes(key)) {
          keys.push(key);
        }
      }
    }
    setKnownPropertyKeys(keys);
  }

  function setFileMeta(path: string, contents: string): void {
    const data = parseFrontmatter(contents);
    fileMeta.set(normalizePath(path), {
      aliases: data.aliases,
      tags: data.tags,
      keys: data.properties.map((property) => property.key),
    });
  }

  // Shared mutable options: the scheduler reads them on every change, so
  // settings updates apply on the next keystroke.
  const autosaveOptions = {
    enabled: getSettings().editor.autosave,
    intervalMs: getSettings().editor.autosaveIntervalMs,
  };
  const autosave = createAutosaveScheduler(() => void saveNow(), autosaveOptions);

  function resolveEmbedSrc(target: string): string | null {
    if (currentFolder === null) {
      return null;
    }
    // Images resolve by name vault-wide too: without folderImages in
    // the listing, a recursive vault would fall back to joining the
    // target onto the vault root and break every embedded image.
    const resolution = resolveWikilink(
      target,
      currentFolder,
      [...folderFiles, ...folderImages],
      getSettings().files.defaultExtension,
    );
    return resolution === null ? null : convertFileSrc(resolution.path);
  }

  async function renderEmbedNote(
    target: string,
  ): Promise<{ html: string; path: string } | null> {
    const { note, anchor } = splitAnchor(target);
    let path: string;
    if (note === "") {
      // Same-file anchor: preview against the open buffer.
      if (openedPath === null) {
        return null;
      }
      path = openedPath;
    } else {
      if (currentFolder === null) {
        return null;
      }
      const resolution = resolveWikilink(
        target,
        currentFolder,
        folderFiles,
        getSettings().files.defaultExtension,
      );
      if (resolution === null) {
        return null;
      }
      path = resolution.path;
    }
    try {
      const isOpen = openedPath !== null && samePath(path, openedPath);
      let contents = isOpen ? editor.getDoc() : await readFile(path);
      if (anchor !== null) {
        contents = sectionSlice(contents, anchor) ?? contents;
      }
      return {
        html: renderToHtml(contents, {
          properties:
            anchor === null && getSettings().editor.showProperties,
        }),
        path,
      };
    } catch {
      return null;
    }
  }

  /** Whether a wikilink target points to an existing note. */
  function isResolvedTarget(target: string): boolean {
    const { note } = splitAnchor(target);
    if (note === "") {
      return openedPath !== null;
    }
    if (currentFolder === null) {
      return false;
    }
    const resolution = resolveWikilink(
      target,
      currentFolder,
      folderFiles,
      getSettings().files.defaultExtension,
    );
    return resolution !== null && resolution.exists;
  }

  /** Scrolls the current view to the heading named by `anchor`. */
  function revealAnchor(anchor: string): void {
    const doc = editor.getDoc();
    const heading = findHeading(doc, anchor);
    if (heading === null) {
      return;
    }
    if (currentMode === "edit") {
      editor.revealRange(heading.from, heading.from);
    } else {
      setScrollFraction(
        readingView.element,
        heading.from / Math.max(1, doc.length),
      );
    }
  }

  // Re-render timers for read-mode twins while typing in another pane.
  const twinRenderTimers = new Map<number, ReturnType<typeof setTimeout>>();

  /**
   * Same note open in more than one pane: every other pane showing
   * `path` mirrors the buffer (reading views re-render, debounced).
   */
  function mirrorToTwins(path: string, doc: string): void {
    for (const ui of paneUis.values()) {
      if (
        ui.id === boundPaneId ||
        ui.openedPath === null ||
        !samePath(ui.openedPath, path)
      ) {
        continue;
      }
      ui.editor.reloadDoc(doc);
      if (ui.mode === "read") {
        const pending = twinRenderTimers.get(ui.id);
        if (pending !== undefined) {
          clearTimeout(pending);
        }
        twinRenderTimers.set(
          ui.id,
          setTimeout(() => {
            twinRenderTimers.delete(ui.id);
            const scroll = ui.readingView.element.scrollTop;
            ui.readingView.render(ui.editor.getDoc());
            ui.readingView.element.scrollTop = scroll;
          }, 250),
        );
      }
    }
  }

  function createPaneEditor(host: HTMLElement): EditorHandle {
    return createEditor(host, {
    onDocChanged(doc, quiet) {
      setCounts(doc);
      if (openedPath !== null && !reloadingFromDisk && !quiet) {
        autosave.notifyChange();
        mirrorToTwins(openedPath, doc);
      }
      scheduleRightPanelRefresh();
    },
    onSaveRequested() {
      void saveNow();
    },
    onToggleModeRequested() {
      void toggleMode();
    },
    onWikilinkClick(target, newTab) {
      void openWikilink(target, newTab === true);
    },
    getWikilinkCompletions() {
      return [
        ...folderFiles.map((file) => file.name.replace(/\.md$/i, "")),
        ...folderImages.map((file) => file.name),
      ];
    },
    getLinkPathCompletions() {
      // Markdown links carry the extension; in a vault, the path from
      // the vault root (the suffix resolver finds it from anywhere).
      const label = (path: string, name: string): string =>
        vaultRoot === null ? name : relativePath(vaultRoot, path);
      return [
        ...folderFiles.map((file) => label(file.path, file.name)),
        ...folderImages.map((file) => label(file.path, file.name)),
      ];
    },
    async getHeadingCompletions(note) {
      try {
        if (note === "") {
          return computeOutline(editor.getDoc()).map((item) => item.text);
        }
        if (currentFolder === null) {
          return [];
        }
        const resolution = resolveWikilink(
          note,
          currentFolder,
          folderFiles,
          getSettings().files.defaultExtension,
        );
        if (resolution === null) {
          return [];
        }
        return computeOutline(await readFile(resolution.path)).map(
          (item) => item.text,
        );
      } catch {
        return [];
      }
    },
    resolveEmbedSrc,
    renderEmbedNote,
    isResolved: isResolvedTarget,
    currentFilePath: () => openedPath,
    }, editorConfigFrom(getSettings()));
  }

  function createPaneReading(): ReadingViewHandle {
    return createReadingView({
    onInternalLink(target, newTab) {
      void openWikilink(target, newTab === true);
    },
    onTaskToggle(pos, checked) {
      editor.replaceRange(pos, pos + 3, checked ? "[x]" : "[ ]");
      void saveNow();
      readingView.render(editor.getDoc());
    },
    onCalloutToggle(pos, fold) {
      editor.replaceRange(pos, pos + 1, fold ? "-" : "+");
      void saveNow();
      const scroll = readingView.element.scrollTop;
      readingView.render(editor.getDoc());
      readingView.element.scrollTop = scroll;
    },
    resolveEmbedSrc,
    renderEmbedNote,
    isResolved: isResolvedTarget,
    currentFilePath: () => openedPath,
    foldInfoAt(pos) {
      return editor.foldInfoAt(pos);
    },
    onToggleFold(pos) {
      // The editor state is the single source of truth for folds, so
      // both modes stay in sync and fileFolds keeps working.
      editor.toggleFoldAt(pos);
      const scroll = readingView.element.scrollTop;
      readingView.render(editor.getDoc());
      readingView.element.scrollTop = scroll;
    },
    showProperties() {
      return getSettings().editor.showProperties;
    },
    inlineTitle() {
      return openedPath !== null && getSettings().appearance.inlineTitle
        ? basename(openedPath).replace(/\.md$/i, "")
        : null;
    },
    onInlineTitleRename(name) {
      if (openedPath !== null) {
        void renameNoteTo(openedPath, name);
      }
    },
    });
  }

  // Inline-title edits in the editor widget commit through the same
  // rename flow (links repointed, tabs and state updated).
  setInlineTitleRename((name) => {
    if (openedPath !== null) {
      void renameNoteTo(openedPath, name);
    }
  });

  // Mode, scroll and cursor are per tab instance (two tabs of the same
  // file stay independent); folds are shared per file. Scroll is a
  // document offset (top visible block + intra-block fraction), never
  // pixels or fractions: those break whenever async content (embeds,
  // images) changes the page height between save and restore.
  const tabModes = new Map<number, EditorModeSetting>();
  const tabScroll = new Map<number, number>();
  const tabSelection = new Map<number, { anchor: number; head: number }>();
  // Mode requested for a path before its tab exists (?open=...&mode=).
  const pendingModes = new Map<string, EditorModeSetting>();
  // Fold state per file, in memory only (never written to the folder).
  const fileFolds = new Map<string, { from: number; to: number }[]>();
  let currentMode: EditorModeSetting = "edit";

  function activeTabId(): number | null {
    return tabsState.tabs[tabsState.active]?.id ?? null;
  }

  function applyMode(mode: EditorModeSetting): void {
    currentMode = mode;
    const id = activeTabId();
    if (openedPath !== null && id !== null) {
      tabModes.set(id, mode);
    }
    const editing = mode === "edit";
    imageView.classList.add("is-hidden");
    editorHost.classList.toggle("is-hidden", !editing);
    readingView.element.classList.toggle("is-hidden", editing);
    setStatusMode(editing ? "edit" : "read");
    modeHeaderButton.replaceChildren(
      createIcon(editing ? "book-open" : "pencil"),
    );
    scheduleSessionSave();
  }

  /**
   * Status-bar mode label and header toggle: hidden for image tabs
   * (nothing to switch), the mode name otherwise.
   */
  function setStatusMode(mode: EditorModeSetting | "image"): void {
    const image = mode === "image";
    modeButton.hidden = image;
    modeHeaderButton.hidden = image;
    if (!image) {
      modeButton.textContent = t(
        mode === "edit" ? "statusBar.mode.edit" : "statusBar.mode.read",
      );
    }
  }

  // --- Tabs ---

  /** Session snapshot: panes, tabs, modes, layout and fold state. */
  function snapshotSession() {
    splitState = withWorkspace(splitState, boundPaneId, tabsState);
    pruneTabState();
    return serializeSession(
      splitState,
      (tab) => tabModes.get(tab.id) ?? getSettings().editor.defaultMode,
      {
        panels: panelSizes,
        rightView,
        collapsed: foldStateKnown ? [...collapsedDirs] : null,
        leftVisible: sidebarVisible,
        rightVisible,
      },
    );
  }

  /** Drops per-tab state whose tab no longer exists in any pane. */
  function pruneTabState(): void {
    const alive = new Set<number>();
    for (const pane of splitState.panes) {
      for (const tab of pane.workspace.tabs) {
        alive.add(tab.id);
      }
    }
    for (const id of [...tabModes.keys()]) {
      if (!alive.has(id)) {
        tabModes.delete(id);
      }
    }
    for (const id of [...tabScroll.keys()]) {
      if (!alive.has(id)) {
        tabScroll.delete(id);
      }
    }
    for (const id of [...tabSelection.keys()]) {
      if (!alive.has(id)) {
        tabSelection.delete(id);
      }
    }
  }

  let sessionSaveDebounce: ReturnType<typeof setTimeout> | null = null;
  function scheduleSessionSave(): void {
    if (sessionSaveDebounce !== null) {
      clearTimeout(sessionSaveDebounce);
    }
    sessionSaveDebounce = setTimeout(() => {
      sessionSaveDebounce = null;
      void (async () =>
        persistSession({
          entries: queryScopes(),
          live: await liveWindowLabels(),
        }))();
    }, 300);
  }

  /**
   * Saves this vault's session and the global ui-state fallbacks. The
   * `arbiter` snapshot elects one saver among windows sharing a scope:
   * only the most recently focused one persists the tab session, so a
   * stray second window (a moved-out tab) never clobbers it. Without
   * an arbiter the tab session always saves.
   */
  function persistSession(arbiter?: {
    entries: ScopeEntry[];
    live?: readonly string[];
  }): Promise<void> {
    // Never mirror an unset panel width over a stored fallback.
    if (panelSizes !== null) {
      uiState.panels = panelSizes;
    }
    uiState.rightView = rightView;
    uiState.leftVisible = sidebarVisible;
    uiState.rightVisible = rightVisible;
    if (homeScope !== null) {
      uiState.lastVault = homeScope.root;
    }
    const saves = [saveUiState(uiState)];
    if (homeScope !== null) {
      const owner =
        arbiter === undefined
          ? null
          : sessionOwner(arbiter.entries, homeScope.key, arbiter.live);
      if (owner === null || owner === windowLabel) {
        saves.push(saveVaultSession(homeScope, snapshotSession()));
      }
    }
    return Promise.all(saves).then(() => undefined);
  }

  /** Cancels the debounce and saves right now (vault switches). */
  function flushSessionSave(): Promise<void> {
    if (sessionSaveDebounce !== null) {
      clearTimeout(sessionSaveDebounce);
      sessionSaveDebounce = null;
    }
    return persistSession({ entries: queryScopes() });
  }

  /** Saves the active tab's transient state (folds, scroll, buffer). */
  async function stashCurrentTabState(): Promise<void> {
    if (openedPath === null) {
      return;
    }
    if (isImageTarget(openedPath)) {
      return; // nothing of the editor's belongs to an image tab
    }
    fileFolds.set(normalizePath(openedPath), editor.getFolds());
    const id = activeTabId();
    if (id !== null) {
      tabScroll.set(
        id,
        currentMode === "edit"
          ? editor.topVisiblePos()
          : (readingTopAnchor() ?? 0),
      );
      tabSelection.set(id, editor.getSelection());
    }
    if (autosave.isDirty()) {
      await saveNow();
    }
  }

  function renderPaneTabBar(ui: PaneUi, paneTabs: WorkspaceState): void {
    const plusButton = document.createElement("button");
    plusButton.className = "tab-new-button";
    plusButton.append(createIcon("plus"));
    plusButton.title = t("tabs.new");
    plusButton.setAttribute("aria-label", t("tabs.new"));
    plusButton.addEventListener("click", () =>
      void applyTabsChange(newEmptyTab(tabsState)),
    );
    ui.tabBar.replaceChildren(
      ...paneTabs.tabs.map((tab, index) => {
        const el = document.createElement("div");
        el.className = "workspace-tab";
        el.classList.toggle("is-active", index === paneTabs.active);
        el.classList.toggle("is-pinned", tab.pinned);
        el.title = tab.path ?? t("tabs.newTab");
        if (tab.pinned) {
          const pin = document.createElement("span");
          pin.className = "workspace-tab-pin";
          pin.append(createIcon("pin"));
          el.append(pin);
        }
        const name = document.createElement("span");
        name.className = "workspace-tab-name";
        const image = tab.path !== null && isImageTarget(tab.path);
        name.textContent =
          tab.path === null
            ? t("tabs.newTab")
            : image
              ? imageBaseName(tab.path)
              : basename(tab.path).replace(/\.md$/i, "");
        el.append(name);
        if (image && tab.path !== null) {
          el.append(extensionChip(basename(tab.path)));
        }
        if (!tab.pinned) {
          const close = document.createElement("button");
          close.className = "workspace-tab-close";
          close.append(createIcon("x"));
          close.title = t("tabs.close");
          close.addEventListener("click", (event) => {
            event.stopPropagation();
            void closeTabAt(index);
          });
          el.append(close);
        }
        el.addEventListener("mousedown", (event) => {
          const onClose =
            event.target instanceof Element &&
            event.target.closest(".workspace-tab-close") !== null;
          if (event.button === 0 && !onClose) {
            startTabDrag(el, index, event);
          }
        });
        el.addEventListener("auxclick", (event) => {
          if (event.button === 1) {
            event.preventDefault();
            void closeTabAt(index);
          }
        });
        el.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          openTabMenu(event.clientX, event.clientY, index);
        });
        return el;
      }),
      plusButton,
    );
  }

  /** Renders every pane's tab bar and repositions the collapse buttons. */
  function renderTabs(): void {
    splitState = withWorkspace(splitState, boundPaneId, tabsState);
    for (const pane of splitState.panes) {
      const ui = paneUis.get(pane.id);
      if (ui !== undefined) {
        renderPaneTabBar(
          ui,
          pane.id === boundPaneId ? tabsState : pane.workspace,
        );
      }
    }
    placeCollapseButtons();
    updateNavButtons();
  }

  function placeCollapseButtons(): void {
    const first = paneUis.get(splitState.panes[0]?.id ?? -1);
    const last = paneUis.get(
      splitState.panes[splitState.panes.length - 1]?.id ?? -1,
    );
    if (first !== undefined) {
      first.header.prepend(collapseLeftButton);
    }
    if (last !== undefined) {
      last.header.append(collapseRightButton);
    }
  }

  /**
   * Applies a new tab state: when the active path changes, the current
   * tab is stashed and the new one loads; otherwise just re-render.
   */
  async function applyTabsChange(next: WorkspaceState): Promise<void> {
    const prevPath = openedPath;
    const nextPath = activeTabPath(next);
    if (nextPath === null) {
      await stashCurrentTabState();
      if (next.active === -1 && splitState.panes.length > 1) {
        // The pane emptied and others remain: collapse it.
        tabsState = next;
        splitState = withWorkspace(splitState, boundPaneId, next);
        await applySplitChange(closePane(splitState, boundPaneId));
        return;
      }
      tabsState = next;
      if (next.active === -1) {
        clearWorkspaceView();
      } else {
        showEmptyTabView();
      }
      renderTabs();
      scheduleSessionSave();
      return;
    }
    const prevId = activeTabId();
    if (prevPath === null || !samePath(prevPath, nextPath)) {
      await stashCurrentTabState();
      tabsState = next;
      await loadFile(nextPath);
      return;
    }
    if (prevId !== (next.tabs[next.active]?.id ?? null)) {
      // Another instance of the same file: shared buffer, own view
      // state — no reload, just this tab's mode and scroll.
      await stashCurrentTabState();
      tabsState = next;
      await applyActiveTabView();
      renderTabs();
      scheduleSessionSave();
      return;
    }
    tabsState = next;
    renderTabs();
    scheduleSessionSave();
  }

  /** Applies the active tab's own mode, cursor and scroll. */
  async function applyActiveTabView(): Promise<void> {
    if (openedPath !== null && isImageTarget(openedPath)) {
      return; // a twin image tab shares the same static view
    }
    const id = activeTabId();
    const mode =
      (id !== null ? tabModes.get(id) : undefined) ??
      getSettings().editor.defaultMode;
    if (mode === "read" && currentMode !== "read") {
      // Entering reading: render and let embeds settle before showing,
      // so the anchor below measures the final layout. When the twin
      // was already reading the same buffer, the settled view is
      // reused as-is.
      await readingView.render(editor.getDoc());
    }
    applyMode(mode);
    const selection = id !== null ? tabSelection.get(id) : undefined;
    if (selection !== undefined) {
      editor.setSelection(selection.anchor, selection.head);
    }
    if (mode === "edit") {
      editor.focus();
    }
    // Scroll goes last, so a focus-induced jump to the (shared-buffer)
    // cursor never wins over this tab's own position.
    const saved = id !== null ? tabScroll.get(id) : undefined;
    if (saved !== undefined) {
      if (mode === "edit") {
        scrollEditorToAnchor(saved);
      } else if (!scrollReadingToAnchor(saved)) {
        readingView.element.scrollTop = 0;
      }
    }
  }

  /** The active tab is empty: show its three actions. */
  function showEmptyTabView(): void {
    autosave.cancel();
    openedPath = null;
    editor.setDoc("");
    editorHost.classList.add("is-hidden");
    readingView.element.classList.add("is-hidden");
    imageView.classList.add("is-hidden");
    setStatusMode(currentMode);
    welcome.remove();
    emptyTabView.classList.remove("is-hidden");
    fileBar.classList.remove("is-hidden");
    viewTitle.textContent = t("tabs.newTab");
    setInlineTitle(null);
    setCounts("");
    if (currentFolder !== null) {
      void getCurrentWindow()
        .setTitle(basename(currentFolder))
        .catch(() => undefined);
    }
  }

  async function closeTabAt(index: number): Promise<void> {
    await applyTabsChange(closeTab(tabsState, index));
  }

  function destroyPaneUi(id: number): void {
    const ui = paneUis.get(id);
    if (ui === undefined) {
      return;
    }
    ui.disposeReadingResize();
    ui.editor.destroy();
    ui.root.remove();
    paneUis.delete(id);
  }

  /** Lays panes out in order with their sizes and rebuilds resizers. */
  function applySplitSizes(): void {
    for (const resizer of [...panesRow.querySelectorAll(".split-resize")]) {
      resizer.remove();
    }
    splitState.panes.forEach((pane, index) => {
      const ui = paneUis.get(pane.id);
      if (ui === undefined) {
        return;
      }
      panesRow.append(ui.root);
      ui.root.style.flexGrow = String(Math.max(pane.size, 0.05) * 100);
      if (index < splitState.panes.length - 1) {
        panesRow.append(createSplitResizer(pane.id));
      }
    });
  }

  function createSplitResizer(leftPaneId: number): HTMLElement {
    const handle = document.createElement("div");
    handle.className = "split-resize";
    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      let lastX = event.clientX;
      const width = panesRow.getBoundingClientRect().width;
      const onMove = (move: MouseEvent): void => {
        const delta = (move.clientX - lastX) / Math.max(1, width);
        lastX = move.clientX;
        splitState = resizeBorder(splitState, leftPaneId, delta);
        applySplitSizes();
      };
      const onUp = (): void => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        scheduleSessionSave();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    return handle;
  }

  /**
   * Reconciles the pane UIs with a new split state: removed panes are
   * destroyed, new ones mounted, and every pane whose view does not
   * match its active tab reloads. Ends bound to the active pane.
   */
  async function applySplitChange(next: SplitState): Promise<void> {
    const previousIds = new Set(splitState.panes.map((pane) => pane.id));
    splitState = next;
    for (const id of previousIds) {
      if (paneById(splitState, id) === null) {
        destroyPaneUi(id);
      }
    }
    for (const pane of splitState.panes) {
      if (!paneUis.has(pane.id)) {
        createPaneUi(pane.id);
      }
    }
    applySplitSizes();
    for (const pane of splitState.panes) {
      const ui = paneUis.get(pane.id);
      if (ui === undefined) {
        continue;
      }
      const want =
        pane.workspace.active === -1
          ? null
          : (pane.workspace.tabs[pane.workspace.active]?.path ?? null);
      const has = pane.id === boundPaneId ? openedPath : ui.openedPath;
      const wantEmptyView = want === null && pane.workspace.active !== -1;
      const showsEmptyView = !ui.emptyTabView.classList.contains("is-hidden");
      if (want === has && wantEmptyView === showsEmptyView) {
        continue;
      }
      bindPaneUi(pane.id);
      tabsState = pane.workspace;
      if (want === null) {
        if (pane.workspace.active === -1) {
          clearWorkspaceView();
        } else {
          showEmptyTabView();
        }
      } else {
        await loadFile(want);
      }
      splitState = withWorkspace(splitState, pane.id, tabsState);
    }
    bindPaneUi(splitState.activePane);
    for (const [paneId, ui] of paneUis) {
      ui.root.classList.toggle(
        "is-active-pane",
        paneId === splitState.activePane,
      );
    }
    refreshStatusChrome();
    renderBacklinks();
    renderTabs();
    scheduleSessionSave();
  }

  /** Opens a new app window; `path` (with `mode`) preloads a file. */
  function spawnWindow(label: string, query: string): void {
    const spawned = new WebviewWindow(label, {
      url: `index.html${query}`,
      title: "Quasidian",
      width: 1100,
      height: 750,
      visible: false,
      theme: "dark",
      backgroundColor: "#000000",
    });
    void spawned.once("tauri://error", (event) => {
      setStatusError(t("error.openFile", { error: String(event.payload) }));
    });
  }

  /** Copies one tab instance's view state onto another. */
  function copyTabState(fromId: number, toId: number): void {
    const mode = tabModes.get(fromId);
    if (mode !== undefined) {
      tabModes.set(toId, mode);
    }
    const scroll = tabScroll.get(fromId);
    if (scroll !== undefined) {
      tabScroll.set(toId, scroll);
    }
    const selection = tabSelection.get(fromId);
    if (selection !== undefined) {
      tabSelection.set(toId, { ...selection });
    }
  }

  /**
   * Moves the tab at `index` into a brand-new window; `duplicate`
   * keeps the original where it is (a second instance).
   */
  async function moveTabToNewWindow(
    index: number,
    options?: { duplicate?: boolean },
  ): Promise<void> {
    const tab = tabsState.tabs[index];
    if (tab === undefined || tab.path === null) {
      return;
    }
    // Flush pending edits so the new window reads the fresh contents.
    await stashCurrentTabState();
    const label = `w${Date.now().toString(36)}`;
    const mode = tabModes.get(tab.id);
    spawnWindow(
      label,
      `?open=${encodeURIComponent(tab.path)}${mode !== undefined ? `&mode=${mode}` : ""}`,
    );
    if (options?.duplicate !== true) {
      await closeTabAt(index);
    }
  }

  /**
   * Moves the tab at `index` of the active pane into a new right pane;
   * `duplicate` keeps the original where it is (a second instance).
   */
  async function splitTabRight(
    index: number,
    options?: { duplicate?: boolean },
  ): Promise<void> {
    const tab = tabsState.tabs[index];
    if (tab === undefined) {
      return;
    }
    hideHoverPreview();
    await stashCurrentTabState();
    const moved: Tab = options?.duplicate ? cloneTab(tab) : tab;
    if (options?.duplicate) {
      copyTabState(tab.id, moved.id);
    }
    let source = options?.duplicate ? tabsState : closeTab(tabsState, index);
    if (source.tabs.length === 0) {
      source = { tabs: [makeTab(null)], active: 0 };
    }
    tabsState = source;
    let next = withWorkspace(splitState, boundPaneId, source);
    next = splitRight(next, boundPaneId, moved);
    await applySplitChange(next);
  }

  /** Steps the active tab through its own history (-1 back, 1 forward). */
  async function navigateHistory(direction: -1 | 1): Promise<void> {
    const next = direction === -1 ? goBack(tabsState) : goForward(tabsState);
    if (next === null) {
      return;
    }
    hideHoverPreview();
    await stashCurrentTabState();
    tabsState = next;
    const path = activeTabPath(tabsState);
    if (path !== null) {
      await loadFile(path);
    }
  }

  function updateNavButtons(): void {
    const { canBack, canForward } = historyState(tabsState);
    navBackButton.disabled = !canBack;
    navForwardButton.disabled = !canForward;
  }

  /**
   * The history entry a back/forward step would reach, opened in a new
   * tab; the current tab's history stays untouched.
   */
  async function openHistoryInNewTab(direction: -1 | 1): Promise<void> {
    const path =
      direction === -1 ? peekBack(tabsState) : peekForward(tabsState);
    if (path !== null) {
      hideHoverPreview();
      await openFile(path, { newTab: true });
    }
  }

  async function activateTab(index: number): Promise<void> {
    const tab = tabsState.tabs[index];
    if (tab === undefined || index === tabsState.active) {
      return;
    }
    // By index, never by path: two tabs may hold the same file.
    await applyTabsChange({ ...tabsState, active: index });
  }

  function cycleTab(delta: number): void {
    const count = tabsState.tabs.length;
    if (count < 2) {
      return;
    }
    void activateTab((tabsState.active + delta + count) % count);
  }

  /**
   * Click activates; dragging reorders within the bar, docks into
   * another pane's bar, or splits right when dropped on a pane's right
   * edge.
   */
  function startTabDrag(
    el: HTMLElement,
    index: number,
    start: MouseEvent,
  ): void {
    let dragging = false;
    let target = index;
    let targetPaneId: number | null = null;
    let splitPaneId: number | null = null;
    const clearMarkers = (): void => {
      for (const ui of paneUis.values()) {
        for (const tabEl of ui.tabBar.children) {
          tabEl.classList.remove("drop-before", "drop-after");
        }
        ui.root.classList.remove("split-drop-hint");
      }
    };
    const paneIdAt = (element: Element | null): number | null => {
      const paneEl = element?.closest<HTMLElement>(".pane") ?? null;
      const id = paneEl === null ? NaN : Number(paneEl.dataset.paneId);
      return Number.isFinite(id) ? id : null;
    };
    const onMove = (event: MouseEvent): void => {
      if (!dragging && Math.abs(event.clientX - start.clientX) < 5) {
        return;
      }
      dragging = true;
      el.classList.add("is-dragging");
      clearMarkers();
      targetPaneId = null;
      splitPaneId = null;
      const under = document.elementFromPoint(event.clientX, event.clientY);
      const overBar = under?.closest<HTMLElement>(".tab-bar") ?? null;
      const paneId = paneIdAt(under);
      if (overBar !== null && paneId !== null && paneId !== boundPaneId) {
        // Docking into another pane's bar.
        targetPaneId = paneId;
        const tabs = [...overBar.children].filter((child) =>
          child.classList.contains("workspace-tab"),
        ) as HTMLElement[];
        target = tabs.length;
        for (let i = 0; i < tabs.length; i++) {
          const rect = tabs[i].getBoundingClientRect();
          if (event.clientX < rect.left + rect.width / 2) {
            target = i;
            tabs[i].classList.add("drop-before");
            return;
          }
        }
        tabs[tabs.length - 1]?.classList.add("drop-after");
        return;
      }
      if (overBar === null && paneId !== null) {
        const ui = paneUis.get(paneId);
        const rect = ui?.root.getBoundingClientRect();
        if (rect !== undefined && event.clientX > rect.right - 60) {
          // Split right of that pane.
          splitPaneId = paneId;
          ui?.root.classList.add("split-drop-hint");
          return;
        }
      }
      // Reorder within the own bar.
      const tabs = [...tabBar.children].filter((child) =>
        child.classList.contains("workspace-tab"),
      ) as HTMLElement[];
      target = tabs.length - 1;
      for (let i = 0; i < tabs.length; i++) {
        const rect = tabs[i].getBoundingClientRect();
        if (event.clientX < rect.left + rect.width / 2) {
          target = i > index ? i - 1 : i;
          tabs[i].classList.add("drop-before");
          return;
        }
      }
      tabs[tabs.length - 1]?.classList.add("drop-after");
    };
    const onUp = (): void => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      el.classList.remove("is-dragging");
      clearMarkers();
      if (!dragging) {
        void activateTab(index);
        return;
      }
      if (splitPaneId !== null) {
        void dropSplitRight(index, splitPaneId);
        return;
      }
      if (targetPaneId !== null) {
        void dropOnPane(index, targetPaneId, target);
        return;
      }
      void applyTabsChange(moveTab(tabsState, index, target));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /** Docks the active pane's tab `index` into pane `targetId`. */
  async function dropOnPane(
    index: number,
    targetId: number,
    position: number,
  ): Promise<void> {
    await stashCurrentTabState();
    let next = withWorkspace(splitState, boundPaneId, tabsState);
    next = moveTabToPane(next, boundPaneId, index, targetId, position);
    await applySplitChange(next);
  }

  /** Drops the active pane's tab `index` as a new pane right of `paneId`. */
  async function dropSplitRight(index: number, paneId: number): Promise<void> {
    const tab = tabsState.tabs[index];
    if (tab === undefined) {
      return;
    }
    await stashCurrentTabState();
    let source = closeTab(tabsState, index);
    let next = withWorkspace(splitState, boundPaneId, source);
    next = splitRight(next, paneId, tab);
    if (source.tabs.length === 0) {
      next = withWorkspaceOrCollapse(next, boundPaneId, source);
    }
    tabsState = paneById(next, boundPaneId)?.workspace ?? source;
    await applySplitChange(next);
  }

  function openTabMenu(x: number, y: number, index: number): void {
    const tab = tabsState.tabs[index];
    if (tab === undefined) {
      return;
    }
    openContextMenu(x, y, [
      {
        label: t("tabs.close"),
        icon: "x",
        onClick: () => void closeTabAt(index),
      },
      {
        label: t("tabs.closeOthers"),
        onClick: () => void applyTabsChange(closeOtherTabs(tabsState, index)),
      },
      {
        label: t("tabs.closeAll"),
        onClick: () => void applyTabsChange(closeAllTabs(tabsState)),
      },
      "separator",
      {
        label: t("tabs.splitRight"),
        icon: "separator-vertical",
        // Ctrl+click duplicates: the original stays in this pane.
        onClick: (event) =>
          void splitTabRight(index, {
            duplicate: event.ctrlKey || event.metaKey,
          }),
      },
      ...(tab.path !== null
        ? [
            {
              label: t("tabs.moveToWindow"),
              icon: "external-link" as const,
              // Ctrl+click duplicates: the original stays in this pane.
              onClick: (event: MouseEvent) =>
                void moveTabToNewWindow(index, {
                  duplicate: event.ctrlKey || event.metaKey,
                }),
            },
          ]
        : []),
      {
        label: t(tab.pinned ? "tabs.unpin" : "tabs.pin"),
        icon: "pin",
        onClick: () =>
          void applyTabsChange(setPinned(tabsState, index, !tab.pinned)),
      },
    ]);
  }

  function scrollFraction(el: Element | null): number {
    if (!(el instanceof HTMLElement)) {
      return 0;
    }
    const max = el.scrollHeight - el.clientHeight;
    return max <= 0 ? 0 : el.scrollTop / max;
  }

  function setScrollFraction(el: Element | null, fraction: number): void {
    if (el instanceof HTMLElement) {
      el.scrollTop = fraction * (el.scrollHeight - el.clientHeight);
    }
  }

  /**
   * Reading-view elements carrying a document offset, in document
   * order. Embedded notes are skipped (their offsets belong to another
   * document), as are elements hidden by folds.
   */
  function readingAnchorsIn(
    container: HTMLElement,
  ): { pos: number; el: HTMLElement }[] {
    const anchors: { pos: number; el: HTMLElement }[] = [];
    for (const el of container.querySelectorAll<HTMLElement>(
      "[data-pos]",
    )) {
      const pos = Number(el.dataset.pos);
      if (
        Number.isFinite(pos) &&
        el.closest(".embed-note") === null &&
        el.getClientRects().length > 0
      ) {
        anchors.push({ pos, el });
      }
    }
    return anchors;
  }

  /**
   * Re-applies an idempotent scroll anchor while late-loading content
   * (images, embeds, math fonts) is still reflowing the page. Stops as
   * soon as the user scrolls on their own.
   */
  function keepAnchoredWhileLoading(
    container: HTMLElement,
    applyAnchor: () => void,
  ): void {
    let expected = container.scrollTop;
    const reapply = (): void => {
      if (Math.abs(container.scrollTop - expected) > 2) {
        return; // the user has scrolled; never fight them
      }
      applyAnchor();
      expected = container.scrollTop;
    };
    requestAnimationFrame(reapply);
    window.setTimeout(reapply, 150);
    window.setTimeout(reapply, 400);
    for (const image of container.querySelectorAll("img")) {
      if (!image.complete) {
        image.addEventListener("load", reapply, { once: true });
      }
    }
  }

  /**
   * Document offset at the top of the reading view: the first visible
   * block plus the fraction already scrolled past inside it. Null when
   * the view has no anchors (empty or unrendered).
   */
  function readingTopAnchorIn(
    container: HTMLElement,
    docLength: number,
  ): number | null {
    const containerTop = container.getBoundingClientRect().top;
    const anchors = readingAnchorsIn(container);
    for (let i = 0; i < anchors.length; i++) {
      const rect = anchors[i].el.getBoundingClientRect();
      if (rect.bottom > containerTop + 1) {
        const pos = anchors[i].pos;
        const nextPos = anchors[i + 1]?.pos ?? docLength;
        const within =
          rect.height > 0 && rect.top < containerTop
            ? Math.min((containerTop - rect.top) / rect.height, 1)
            : 0;
        return Math.round(pos + within * (nextPos - pos));
      }
    }
    return null;
  }

  /**
   * Scrolls the reading view so the block holding `topPos` sits at the
   * top, offset by the intra-block fraction, and keeps it anchored
   * while late content loads. False when the view has no usable anchor.
   */
  function scrollReadingToAnchorIn(
    container: HTMLElement,
    docLength: number,
    topPos: number,
  ): boolean {
    let target: { pos: number; el: HTMLElement } | null = null;
    let nextPos = docLength;
    for (const anchor of readingAnchorsIn(container)) {
      if (anchor.pos > topPos) {
        nextPos = anchor.pos;
        break;
      }
      target = anchor;
    }
    if (target === null) {
      return false;
    }
    const el = target.el;
    const from = target.pos;
    const within =
      nextPos > from
        ? Math.min((topPos - from) / (nextPos - from), 1)
        : 0;
    const applyAnchor = (): void => {
      const rect = el.getBoundingClientRect();
      container.scrollTop +=
        rect.top -
        container.getBoundingClientRect().top +
        within * rect.height;
    };
    applyAnchor();
    keepAnchoredWhileLoading(container, applyAnchor);
    return true;
  }

  /** Bound-pane wrappers of the anchor helpers above. */
  function readingTopAnchor(): number | null {
    return readingTopAnchorIn(readingView.element, editor.getDoc().length);
  }

  function scrollReadingToAnchor(topPos: number): boolean {
    return scrollReadingToAnchorIn(
      readingView.element,
      editor.getDoc().length,
      topPos,
    );
  }

  /** Editor twin of scrollReadingToAnchor (heights settle async). */
  function scrollEditorToAnchor(pos: number): void {
    editor.scrollPosToTop(pos);
    const scrollerEl = editorHost.querySelector(".cm-scroller");
    if (scrollerEl instanceof HTMLElement) {
      keepAnchoredWhileLoading(scrollerEl, () => editor.scrollPosToTop(pos));
    }
  }

  /**
   * Switches between editing and reading keeping the same block at the
   * top of the view, mapped through the shared document offsets.
   */
  async function toggleMode(): Promise<void> {
    hideHoverPreview();
    if (openedPath === null || isImageTarget(openedPath)) {
      return;
    }
    const scroller = editorHost.querySelector(".cm-scroller");
    if (currentMode === "edit") {
      if (autosave.isDirty()) {
        await saveNow();
      }
      const topPos = editor.topVisiblePos();
      const fraction = scrollFraction(scroller);
      // The editor stays on screen until embeds have been filled in:
      // anchoring against the placeholder layout and correcting later
      // would paint a visible double jump.
      await readingView.render(editor.getDoc());
      applyMode("read");
      if (!scrollReadingToAnchor(topPos)) {
        setScrollFraction(readingView.element, fraction);
      }
    } else {
      const topPos = readingTopAnchor();
      const fraction = scrollFraction(readingView.element);
      applyMode("edit");
      if (topPos === null) {
        setScrollFraction(scroller, fraction);
      } else {
        scrollEditorToAnchor(topPos);
      }
      editor.focus();
    }
  }

  function setCounts(doc: string): void {
    lastWordCount = countWords(doc);
    lastCharCount = countCharacters(doc);
    wordCount.textContent = t("statusBar.words", { count: lastWordCount });
    charCount.textContent = t("statusBar.characters", {
      count: lastCharCount,
    });
  }

  /** Counts and mode chrome for the active tab; blank for images. */
  function refreshStatusChrome(): void {
    if (openedPath !== null && isImageTarget(openedPath)) {
      wordCount.textContent = "";
      charCount.textContent = "";
      setStatusMode("image");
    } else {
      setCounts(editor.getDoc());
      setStatusMode(currentMode);
    }
  }

  function setStatusError(message: string | null): void {
    statusError.textContent = message ?? "";
  }

  function setListMessage(message: string): void {
    const empty = document.createElement("li");
    empty.className = "file-list-empty";
    empty.textContent = message;
    fileList.replaceChildren(empty);
  }

  async function saveNow(): Promise<void> {
    // Never let the buffer editor write over an image tab's file.
    if (openedPath === null || isImageTarget(openedPath)) {
      return;
    }
    autosave.cancel();
    try {
      await writeFile(openedPath, editor.getDoc());
      // The saved note may be embedded elsewhere: stale HTML must not
      // be served when those widgets rebuild.
      clearEmbedHtmlCache();
      setStatusError(null);
      backlinkIndex.setFile(openedPath, editor.getDoc());
      searchIndex.setFile(openedPath, editor.getDoc());
      setFileMeta(openedPath, editor.getDoc());
      attachAliases();
      renderBacklinks();
      if (searchVisible) {
        runSearch();
      }
    } catch (error) {
      setStatusError(t("error.writeFile", { error: String(error) }));
    }
  }

  function emptyItem(labelKey: string): HTMLLIElement {
    const empty = document.createElement("li");
    empty.className = "backlinks-empty";
    empty.textContent = t(labelKey);
    return empty;
  }

  function currentBacklinks(): string[] {
    if (openedPath === null || currentFolder === null) {
      return [];
    }
    return backlinkIndex.backlinksOf(
      openedPath,
      currentFolder,
      folderFiles,
      getSettings().files.defaultExtension,
    );
  }

  function renderBacklinksView(): void {
    if (openedPath === null || currentFolder === null) {
      backlinksCount.textContent = "";
      backlinksList.replaceChildren(emptyItem("backlinks.empty"));
      return;
    }
    const links = currentBacklinks();
    backlinksCount.textContent = String(links.length);
    if (links.length === 0) {
      backlinksList.replaceChildren(emptyItem("backlinks.empty"));
      return;
    }
    backlinksList.replaceChildren(
      ...links.map((path) => {
        const item = document.createElement("li");
        item.className = "file-item";
        item.textContent = basename(path).replace(/\.md$/i, "");
        item.addEventListener("click", (event) =>
          void openFile(path, { newTab: event.ctrlKey || event.metaKey }),
        );
        return item;
      }),
    );
  }

  function renderOutgoingView(): void {
    if (openedPath === null || currentFolder === null) {
      backlinksCount.textContent = "";
      backlinksList.replaceChildren(emptyItem("rightPanel.outgoingEmpty"));
      return;
    }
    const targets = [...new Set(extractLinkTargets(editor.getDoc()))];
    backlinksCount.textContent = String(targets.length);
    if (targets.length === 0) {
      backlinksList.replaceChildren(emptyItem("rightPanel.outgoingEmpty"));
      return;
    }
    backlinksList.replaceChildren(
      ...targets.map((target) => {
        const item = document.createElement("li");
        item.className = "file-item";
        const resolution =
          currentFolder === null
            ? null
            : resolveWikilink(
                target,
                currentFolder,
                folderFiles,
                getSettings().files.defaultExtension,
              );
        item.classList.toggle(
          "is-unresolved",
          resolution === null || !resolution.exists,
        );
        item.textContent = target;
        item.addEventListener("click", (event) =>
          void openWikilink(target, event.ctrlKey || event.metaKey),
        );
        return item;
      }),
    );
  }

  // Collapsed outline headings, per file (in memory only).
  const outlineCollapsed = new Map<string, Set<number>>();

  function renderOutlineView(): void {
    backlinksCount.textContent = "";
    if (openedPath === null) {
      backlinksList.replaceChildren(emptyItem("rightPanel.outlineEmpty"));
      return;
    }
    const doc = editor.getDoc();
    const items = computeOutline(doc);
    if (items.length === 0) {
      backlinksList.replaceChildren(emptyItem("rightPanel.outlineEmpty"));
      return;
    }
    const key = normalizePath(openedPath);
    const collapsed = outlineCollapsed.get(key) ?? new Set<number>();

    const goTo = (from: number): void => {
      if (currentMode === "edit") {
        editor.revealRange(from, from);
      } else {
        // The reading view has no position mapping; approximate.
        setScrollFraction(
          readingView.element,
          from / Math.max(1, doc.length),
        );
      }
    };

    // Nested tree with per-level guide lines and collapse chevrons.
    const rootList = document.createElement("div");
    rootList.className = "outline-tree";
    const stack: { level: number; container: HTMLElement }[] = [
      { level: 0, container: rootList },
    ];
    items.forEach((heading, index) => {
      const hasChildren =
        index + 1 < items.length && items[index + 1].level > heading.level;
      while (
        stack.length > 1 &&
        stack[stack.length - 1].level >= heading.level
      ) {
        stack.pop();
      }
      const parent = stack[stack.length - 1].container;
      const item = document.createElement("div");
      item.className = "outline-item";
      const row = document.createElement("div");
      row.className = "file-item outline-row";
      const chevron = document.createElement("span");
      chevron.className = "outline-chevron";
      if (hasChildren) {
        const isCollapsed = collapsed.has(heading.from);
        chevron.append(
          createIcon(isCollapsed ? "chevron-right" : "chevron-down"),
        );
        chevron.addEventListener("click", (event) => {
          event.stopPropagation();
          if (isCollapsed) {
            collapsed.delete(heading.from);
          } else {
            collapsed.add(heading.from);
          }
          outlineCollapsed.set(key, collapsed);
          renderOutlineView();
        });
      }
      const text = document.createElement("span");
      text.className = "outline-text";
      text.textContent = heading.text;
      row.append(chevron, text);
      row.addEventListener("click", () => goTo(heading.from));
      item.append(row);
      parent.append(item);
      if (hasChildren) {
        const children = document.createElement("div");
        children.className = "outline-children";
        children.classList.toggle("is-hidden", collapsed.has(heading.from));
        item.append(children);
        stack.push({ level: heading.level, container: children });
      }
    });
    backlinksList.replaceChildren(rootList);
  }

  function renderRightPanel(): void {
    for (const [view, button] of rightViewButtons) {
      button.classList.toggle("is-active", view === rightView);
      button.title = t(`rightPanel.${view}`);
    }
    backlinksTitle.textContent = t(`rightPanel.${rightView}`);
    if (rightView === "backlinks") {
      renderBacklinksView();
    } else if (rightView === "outgoing") {
      renderOutgoingView();
    } else {
      renderOutlineView();
    }
  }

  // Outline and outgoing links follow the doc as it changes, coalesced.
  let rightPanelDebounce: ReturnType<typeof setTimeout> | null = null;
  function scheduleRightPanelRefresh(): void {
    if (!rightVisible || rightView === "backlinks") {
      return;
    }
    if (rightPanelDebounce !== null) {
      clearTimeout(rightPanelDebounce);
    }
    rightPanelDebounce = setTimeout(() => {
      rightPanelDebounce = null;
      renderRightPanel();
    }, 300);
  }

  /** Data changed: refresh the status-bar count and the visible panel. */
  function renderBacklinks(): void {
    if (openedPath === null || currentFolder === null) {
      statusBacklinks.hidden = true;
    } else {
      const links = currentBacklinks();
      statusBacklinks.hidden = false;
      statusBacklinks.textContent = t("statusBar.backlinks", {
        count: links.length,
      });
      statusBacklinks.title = t("rightPanel.backlinks");
    }
    if (rightVisible) {
      renderRightPanel();
    }
  }

  async function rebuildIndex(): Promise<void> {
    backlinkIndex.clear();
    searchIndex.clear();
    fileMeta.clear();
    const files = [...folderFiles];
    await Promise.all(
      files.map(async (file) => {
        try {
          const contents = await readFile(file.path);
          backlinkIndex.setFile(file.path, contents);
          searchIndex.setFile(file.path, contents);
          setFileMeta(file.path, contents);
        } catch {
          // Deleted or unreadable mid-scan; the watcher will retrigger.
        }
      }),
    );
    attachAliases();
    renderBacklinks();
    if (searchVisible) {
      runSearch();
    }
  }

  function matchSnippet(
    match: SearchMatch,
    onClick: (event: MouseEvent) => void,
  ): HTMLElement {
    const item = document.createElement("li");
    item.className = "search-match-line";
    let prefix = match.lineText.slice(0, match.colFrom);
    let suffix = match.lineText.slice(match.colTo);
    if (prefix.length > 30) {
      prefix = "…" + prefix.slice(-30);
    }
    if (suffix.length > 60) {
      suffix = suffix.slice(0, 60) + "…";
    }
    const highlight = document.createElement("span");
    highlight.className = "search-hl";
    highlight.textContent = match.lineText.slice(match.colFrom, match.colTo);
    item.append(document.createTextNode(prefix), highlight, document.createTextNode(suffix));
    item.addEventListener("click", onClick);
    return item;
  }

  function runSearch(): void {
    const query = searchInput.value;
    if (currentFolder === null) {
      searchStatus.textContent = t("sidebar.noFolder");
      searchResults.replaceChildren();
      return;
    }
    if (query.trim() === "") {
      searchStatus.textContent = "";
      searchResults.replaceChildren();
      return;
    }
    const outcome = searchIndex.search(query);
    searchStatus.textContent = outcome.truncated
      ? t("search.truncated", { count: outcome.totalMatches })
      : t("search.results", { count: outcome.totalMatches });
    searchResults.replaceChildren(
      ...outcome.results.map((result) => {
        const fileItem = document.createElement("li");
        fileItem.className = "search-file";
        const fileName = document.createElement("div");
        fileName.className = "search-file-name";
        fileName.textContent = basename(result.path).replace(/\.md$/i, "");
        fileName.addEventListener("click", (event) =>
          void openFile(result.path, {
            newTab: event.ctrlKey || event.metaKey,
          }),
        );
        const matches = document.createElement("ul");
        matches.className = "search-matches";
        matches.append(
          ...result.matches.map((match) =>
            matchSnippet(match, (event) =>
              void openFileAt(
                result.path,
                match,
                event.ctrlKey || event.metaKey,
              ),
            ),
          ),
        );
        fileItem.append(fileName, matches);
        return fileItem;
      }),
    );
  }

  async function openFileAt(
    path: string,
    match: SearchMatch,
    newTab = false,
  ): Promise<void> {
    await openFile(path, { newTab });
    if (currentMode === "edit") {
      editor.revealRange(match.from, match.to);
    }
  }

  function openSearch(): void {
    searchVisible = true;
    sidebarFiles.classList.add("is-hidden");
    sidebarSearch.classList.remove("is-hidden");
    runSearch();
    searchInput.focus();
    searchInput.select();
  }

  function closeSearch(): void {
    searchVisible = false;
    sidebarSearch.classList.add("is-hidden");
    sidebarFiles.classList.remove("is-hidden");
    editor.focus();
  }

  function toggleSearch(): void {
    if (searchVisible) {
      closeSearch();
    } else {
      openSearch();
    }
  }

  /** Whether `folderPath` lies inside the active vault root. */
  function insideVault(folderPath: string): boolean {
    if (vaultRoot === null) {
      return false;
    }
    const rootKey = normalizePath(vaultRoot).toLowerCase();
    const key = normalizePath(folderPath).toLowerCase();
    return key === rootKey || key.startsWith(rootKey + "/");
  }

  /** Marker probe for vault detection, backed by the folder listing. */
  async function folderContains(dir: string, name: string): Promise<boolean> {
    try {
      const entries = await listFolder(dir);
      const lower = name.toLowerCase();
      return entries.some((entry) => entry.name.toLowerCase() === lower);
    } catch {
      return false;
    }
  }

  /** Session scope of a file or folder: vault root or the folder. */
  async function resolveScopeOf(
    path: string,
    kind: "file" | "folder",
  ): Promise<ScopeInfo> {
    return resolveScope(path, kind, folderContains, await excludedVaultRoot);
  }

  /** Breadth-first vault scan honoring the ignore rules and depth cap. */
  async function scanVault(root: string): Promise<FileEntry[]> {
    const collected: FileEntry[] = [];
    const queue: { path: string; depth: number }[] = [
      { path: root, depth: 0 },
    ];
    while (queue.length > 0) {
      const { path, depth } = queue.shift() as {
        path: string;
        depth: number;
      };
      let entries: FileEntry[];
      try {
        entries = await listFolder(path);
      } catch {
        continue; // unreadable subfolder: skip, never fail the vault
      }
      for (const entry of entries) {
        if (entry.isDir) {
          if (depth < MAX_VAULT_DEPTH && !isIgnoredDir(entry.name)) {
            collected.push(entry);
            queue.push({ path: entry.path, depth: depth + 1 });
          }
        } else {
          collected.push(entry);
        }
      }
    }
    return collected;
  }

  async function refreshFolder(
    folderPath: string,
    options?: { redetect?: boolean },
  ): Promise<void> {
    // Multi-folder modes: a marker in the folder or an ancestor roots a
    // recursive vault there. Detection reruns when leaving the current
    // vault or when a folder is opened explicitly.
    const probed =
      vaultProbeBase !== null && samePath(vaultProbeBase, folderPath);
    if (
      options?.redetect === true ||
      (!insideVault(folderPath) && !probed)
    ) {
      const info = await detectVault(
        folderPath,
        folderContains,
        await excludedVaultRoot,
      );
      vaultRoot = info?.root ?? null;
      vaultMode = info?.mode ?? null;
      vaultProbeBase = folderPath;
      // Styling/debug hook: which mode (if any) the sidebar reflects.
      fileList.dataset.vaultMode = vaultMode ?? "";
    }
    const scope = vaultRoot ?? folderPath;
    let entries: FileEntry[];
    try {
      entries =
        vaultRoot === null ? await listFolder(scope) : await scanVault(scope);
    } catch (error) {
      setListMessage(t("error.listFolder", { error: String(error) }));
      return;
    }
    const markdownFiles = entries
      .filter((entry) => !entry.isDir && entry.name.toLowerCase().endsWith(".md"))
      .sort((a, b) => a.name.localeCompare(b.name));
    currentFolder = scope;
    folderFiles = markdownFiles.map(({ name, path }) => ({ name, path }));
    folderImages = entries
      .filter((entry) => !entry.isDir && isImageTarget(entry.name))
      .map(({ name, path }) => ({ name, path }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (watchedFolder === null || !samePath(watchedFolder, scope)) {
      watchedFolder = scope;
      watchFolder(scope, vaultRoot !== null).catch(() => undefined);
      void rebuildIndex();
    } else {
      renderBacklinks();
    }
    if (markdownFiles.length === 0 && folderImages.length === 0) {
      setListMessage(t("sidebar.emptyFolder"));
      return;
    }
    if (vaultRoot === null) {
      // Notes and images interleave alphabetically, like Obsidian.
      const listed = [...markdownFiles, ...folderImages].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      fileList.replaceChildren(
        ...listed.map((entry) => fileListItem(entry.path, entry.name)),
      );
    } else {
      vaultTree = buildFolderTree(
        vaultRoot,
        entries.filter(
          (entry) =>
            entry.isDir ||
            entry.name.toLowerCase().endsWith(".md") ||
            isImageTarget(entry.name),
        ),
      );
      if (!foldStateKnown) {
        // First look at this vault: noise branches (no notes, no
        // images anywhere below) start collapsed.
        collapsedDirs.clear();
        for (const dir of collapsedByDefault(vaultTree)) {
          collapsedDirs.add(normalizePath(dir));
        }
        foldStateKnown = true;
      }
      renderVaultTree();
    }
    collapseAllButton.classList.toggle("is-hidden", vaultRoot === null);
    updateCollapseAllButton();
  }

  /** Uppercase extension chip for image entries ("JPG", "PNG"…). */
  function extensionChip(name: string): HTMLSpanElement {
    const chip = document.createElement("span");
    chip.className = "file-item-chip";
    chip.textContent = name.replace(/^.*\./, "").toUpperCase();
    return chip;
  }

  /** Sidebar entry for one file (flat list and vault tree share it). */
  function fileListItem(path: string, name: string): HTMLLIElement {
    const item = document.createElement("li");
    item.className = "file-item";
    item.classList.toggle(
      "is-active",
      openedPath !== null && samePath(path, openedPath),
    );
    if (isImageTarget(name)) {
      const label = document.createElement("span");
      label.className = "file-item-name";
      label.textContent = name.replace(/\.[^.]+$/, "");
      item.append(label, extensionChip(name));
    } else {
      item.textContent = name.replace(/\.md$/i, "");
    }
    item.addEventListener("click", (event) =>
      void openFile(path, {
        newTab: event.ctrlKey || event.metaKey,
      }),
    );
    item.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        void openFile(path, { newTab: true });
      }
    });
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openFileMenu(event.clientX, event.clientY, path, "sidebar");
    });
    return item;
  }

  /** Collapsible folder tree of the recursive vault. */
  function renderVaultTree(): void {
    const render = (nodes: TreeNode[]): HTMLLIElement[] =>
      nodes.map((node) => {
        if (!node.isDir) {
          return fileListItem(node.path, node.name);
        }
        const item = document.createElement("li");
        item.className = "tree-folder";
        const collapsed = collapsedDirs.has(normalizePath(node.path));
        const row = document.createElement("div");
        row.className = "tree-folder-row";
        row.append(
          createIcon(collapsed ? "chevron-right" : "chevron-down"),
        );
        const label = document.createElement("span");
        label.className = "tree-folder-name";
        label.textContent = node.name;
        row.append(label);
        row.addEventListener("click", () => {
          const key = normalizePath(node.path);
          if (collapsedDirs.has(key)) {
            collapsedDirs.delete(key);
          } else {
            collapsedDirs.add(key);
          }
          foldStateKnown = true;
          renderVaultTree();
          updateCollapseAllButton();
          scheduleSessionSave();
        });
        item.append(row);
        if (!collapsed && node.children.length > 0) {
          const children = document.createElement("ul");
          children.className = "tree-children";
          children.append(...render(node.children));
          item.append(children);
        }
        return item;
      });
    fileList.replaceChildren(...render(vaultTree));
  }

  /** Every folder path of the vault tree, any depth. */
  function collectTreeDirs(nodes: TreeNode[]): string[] {
    const dirs: string[] = [];
    const walk = (list: TreeNode[]): void => {
      for (const node of list) {
        if (node.isDir) {
          dirs.push(node.path);
          walk(node.children);
        }
      }
    };
    walk(nodes);
    return dirs;
  }

  /** Collapses every folder, or expands them all when none is open. */
  function toggleCollapseAll(): void {
    const anyExpanded = collectTreeDirs(vaultTree).some(
      (dir) => !collapsedDirs.has(normalizePath(dir)),
    );
    if (anyExpanded) {
      collapseAllFolders();
    } else {
      expandAllFolders();
    }
  }

  function collapseAllFolders(): void {
    collapsedDirs.clear();
    for (const dir of collectTreeDirs(vaultTree)) {
      collapsedDirs.add(normalizePath(dir));
    }
    applyFoldChange();
  }

  function expandAllFolders(): void {
    collapsedDirs.clear();
    applyFoldChange();
  }

  function applyFoldChange(): void {
    foldStateKnown = true;
    renderVaultTree();
    updateCollapseAllButton();
    scheduleSessionSave();
  }

  /** Re-applies the smart default fold on demand (Ctrl+click, menu). */
  function applySmartFold(): void {
    if (vaultRoot === null) {
      return;
    }
    collapsedDirs.clear();
    for (const dir of collapsedByDefault(vaultTree)) {
      collapsedDirs.add(normalizePath(dir));
    }
    applyFoldChange();
  }

  /** Icon and tooltip follow what a click would do next. */
  function updateCollapseAllButton(): void {
    collapseAllPreview = false;
    collapseAllTip.classList.remove("is-visible");
    const dirs = collectTreeDirs(vaultTree);
    const anyExpanded = dirs.some(
      (dir) => !collapsedDirs.has(normalizePath(dir)),
    );
    const label = t(anyExpanded ? "sidebar.collapseAll" : "sidebar.expandAll");
    collapseAllButton.replaceChildren(
      createIcon(anyExpanded ? "chevrons-down-up" : "chevrons-up-down"),
    );
    collapseAllButton.title = label;
    collapseAllButton.setAttribute("aria-label", label);
  }

  /** Fold state from the vault session; null = smart default later. */
  function applyRestoredFoldState(session: SessionData | null): void {
    collapsedDirs.clear();
    if (session !== null && session.collapsed !== null) {
      for (const dir of session.collapsed) {
        collapsedDirs.add(normalizePath(dir));
      }
      foldStateKnown = true;
    } else {
      foldStateKnown = false;
    }
  }

  async function openWikilink(target: string, newTab = false): Promise<void> {
    // Markdown links may point outside the vault: external URLs open in
    // the system browser (wikilink targets never carry a scheme).
    if (isExternalTarget(target)) {
      void openUrl(target).catch(() => undefined);
      return;
    }
    const { note, anchor } = splitAnchor(target);
    // Same-file anchor: just scroll to the heading.
    if (note === "") {
      if (anchor !== null) {
        revealAnchor(anchor);
      }
      return;
    }
    if (currentFolder === null) {
      return;
    }
    const resolution = resolveWikilink(
      target,
      currentFolder,
      folderFiles,
      getSettings().files.defaultExtension,
    );
    if (resolution === null) {
      return;
    }
    if (!resolution.exists) {
      // Cross-folder targets may exist even if unknown here: probe first,
      // create only when the read fails.
      try {
        await readFile(resolution.path);
      } catch {
        try {
          await writeFile(resolution.path, "");
        } catch (error) {
          setStatusError(t("error.createFile", { error: String(error) }));
          return;
        }
      }
    }
    await openFile(resolution.path, { newTab });
    if (anchor !== null) {
      revealAnchor(anchor);
    }
  }

  /** Navigation entry: routes `path` through the tab state, then loads. */
  async function openFile(
    path: string,
    opts?: { newTab?: boolean },
  ): Promise<void> {
    hideHoverPreview();
    if (openedPath !== null && samePath(path, openedPath)) {
      return;
    }
    const before = tabsState;
    tabsState = openTabPath(tabsState, path, opts?.newTab === true);
    await stashCurrentTabState();
    if (!(await loadFile(path))) {
      tabsState = before;
      renderTabs();
    }
  }

  /** Loads `path` into the workspace view; false when reading fails. */
  async function loadFile(path: string): Promise<boolean> {
    if (isImageTarget(path)) {
      return loadImageFile(path);
    }
    let contents;
    try {
      contents = await readFile(path);
    } catch (error) {
      setStatusError(t("error.readFile", { error: String(error) }));
      return false;
    }
    openedPath = path;
    setStatusError(null);
    welcome.remove();
    emptyTabView.classList.add("is-hidden");
    fileBar.classList.remove("is-hidden");
    const noteName = basename(path).replace(/\.md$/i, "");
    viewTitle.textContent = noteName;
    // Before setDoc: the block-decorations field reads it on rebuild.
    setInlineTitle(getSettings().appearance.inlineTitle ? noteName : null);
    // The folder state must exist before setDoc: embed widgets resolve
    // their sources against it while building decorations.
    await refreshFolder(dirname(path));
    // Window title "vault - note" (vault root name in vault mode);
    // cosmetic, so failures are ignored.
    void getCurrentWindow()
      .setTitle(`${basename(vaultRoot ?? dirname(path))} - ${noteName}`)
      .catch(() => undefined);
    try {
      editor.setDoc(contents);
      const folds = fileFolds.get(normalizePath(path));
      if (folds !== undefined) {
        editor.setFolds(folds);
      }
      // Never leave the cursor inside an atomic frontmatter block.
      const frontmatterData = parseFrontmatter(contents);
      if (frontmatterData.exists) {
        const pos = Math.min(frontmatterData.end + 1, contents.length);
        editor.revealRange(pos, pos);
      }
      setCounts(contents);
      const id = activeTabId();
      const pending = pendingModes.get(normalizePath(path));
      pendingModes.delete(normalizePath(path));
      const mode =
        (id !== null ? tabModes.get(id) : undefined) ??
        pending ??
        getSettings().editor.defaultMode;
      if (mode === "read") {
        // Let embeds settle so the scroll anchor measures the final
        // layout in one go.
        await readingView.render(contents);
      }
      applyMode(mode);
      const selection = id !== null ? tabSelection.get(id) : undefined;
      if (selection !== undefined) {
        editor.setSelection(selection.anchor, selection.head);
      }
      if (mode === "edit") {
        editor.focus();
      }
      // Scroll goes last, so a focus-induced jump to the cursor never
      // wins over this tab's own position.
      const savedScroll = id !== null ? tabScroll.get(id) : undefined;
      if (savedScroll !== undefined) {
        if (mode === "edit") {
          scrollEditorToAnchor(savedScroll);
        } else if (!scrollReadingToAnchor(savedScroll)) {
          readingView.element.scrollTop = 0;
        }
      }
    } catch (error) {
      // A rendering failure must never leave the view half-open.
      setStatusError(t("error.openFile", { error: String(error) }));
    }
    renderTabs();
    renderBacklinks();
    scheduleSessionSave();
    return true;
  }

  /** Image file name without its extension, for titles and labels. */
  function imageBaseName(path: string): string {
    return basename(path).replace(/\.[^.]+$/, "");
  }

  /**
   * Read-only image tab (milestone 32): the file renders in the pane's
   * image view via the asset protocol; the text editor never sees it.
   */
  async function loadImageFile(path: string): Promise<boolean> {
    autosave.cancel();
    openedPath = path;
    setStatusError(null);
    welcome.remove();
    emptyTabView.classList.add("is-hidden");
    fileBar.classList.remove("is-hidden");
    const name = imageBaseName(path);
    viewTitle.textContent = name;
    setInlineTitle(null);
    await refreshFolder(dirname(path));
    void getCurrentWindow()
      .setTitle(`${basename(vaultRoot ?? dirname(path))} - ${name}`)
      .catch(() => undefined);
    editorHost.classList.add("is-hidden");
    readingView.element.classList.add("is-hidden");
    imageView.classList.remove("is-hidden");
    imageEl.src = convertFileSrc(path);
    imageEl.alt = name;
    refreshStatusChrome();
    renderTabs();
    renderBacklinks();
    scheduleSessionSave();
    return true;
  }

  /** Creates "Sense títol[ N].md" in the current folder and opens it. */
  async function createNewNote(): Promise<void> {
    if (currentFolder === null) {
      await openFolderFromDialog();
      if (currentFolder === null) {
        return;
      }
    }
    const base = t("tabs.untitled");
    let name = base;
    let counter = 1;
    const taken = (candidate: string): boolean =>
      folderFiles.some(
        (file) => file.name.toLowerCase() === `${candidate.toLowerCase()}.md`,
      );
    while (taken(name)) {
      name = `${base} ${counter++}`;
    }
    const path = joinPath(currentFolder, `${name}.md`);
    try {
      await writeFile(path, "");
    } catch (error) {
      setStatusError(t("error.createFile", { error: String(error) }));
      return;
    }
    await refreshFolder(currentFolder);
    await openFile(path);
  }

  async function openFileFromDialog(): Promise<void> {
    const path = await openMarkdownFileDialog({
      title: t("dialog.openFile.title"),
      filterName: t("dialog.openFile.markdownFilter"),
    });
    if (path !== null) {
      await routeOpen("file", path);
    }
  }

  /**
   * Explicit open (dialogs, OS double-click): lands in this window
   * (own scope, or none adopted yet), in the live window already
   * holding the target vault — focused, tab selected — or in a new
   * window restoring that vault's session. Windows never mix vaults.
   */
  async function routeOpen(
    kind: "file" | "folder",
    path: string,
    opts?: { focusSelf?: boolean },
  ): Promise<void> {
    const target = await resolveScopeOf(path, kind);
    const decision = routeDecision(
      target.key,
      homeScope?.key ?? null,
      queryScopes(),
      await liveWindowLabels(),
      windowLabel,
    );
    if (decision.action === "in-place") {
      if (homeScope !== null && homeScope.key === target.key) {
        if (kind === "file") {
          await revealOrOpen(path);
        } else {
          // Same vault: refresh the listing, the workspace stays.
          await refreshFolder(target.root, { redetect: true });
          renderBacklinks();
        }
      } else {
        // A window without a vault adopts the target's session.
        await switchToScope(target, kind === "file" ? { file: path } : {});
      }
      if (opts?.focusSelf === true) {
        const self = getCurrentWindow();
        await self.unminimize().catch(() => undefined);
        await self.setFocus().catch(() => undefined);
      }
      return;
    }
    if (decision.action === "focus") {
      await focusAndSend(decision.label, kind, path);
      return;
    }
    await spawnVaultWindow(target, kind, path);
  }

  /** Brings `label` to front and hands it the open to perform. */
  async function focusAndSend(
    label: string,
    kind: "file" | "folder",
    path: string,
  ): Promise<void> {
    const win = await WebviewWindow.getByLabel(label);
    await win?.unminimize().catch(() => undefined);
    await win?.setFocus().catch(() => undefined);
    // `to` travels in the payload: plain listen() hears events for
    // every target, so each receiver must drop what is not its own.
    await emitTo(label, "routed-open", { to: label, kind, path }).catch(
      () => undefined,
    );
  }

  /**
   * Two rapid opens into the same still-closed vault must not spawn
   * two windows: the second waits for the first window to publish its
   * scope, then routes to it.
   */
  const pendingSpawns = new Map<string, { label: string; at: number }>();

  async function spawnVaultWindow(
    target: ScopeInfo,
    kind: "file" | "folder",
    path: string,
  ): Promise<void> {
    const pending = pendingSpawns.get(target.key);
    if (pending !== undefined && Date.now() - pending.at < 5000) {
      if (await waitForWindowScope(pending.label, target.key, 3000)) {
        await focusAndSend(pending.label, kind, path);
        return;
      }
    }
    const label = `w${Date.now().toString(36)}`;
    pendingSpawns.set(target.key, { label, at: Date.now() });
    const param = kind === "file" ? "vopen" : "vfolder";
    spawnWindow(label, `?${param}=${encodeURIComponent(path)}`);
  }

  async function waitForWindowScope(
    label: string,
    key: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (
        queryScopes().some(
          (entry) => entry.label === label && entry.key === key,
        )
      ) {
        return true;
      }
      if (Date.now() >= deadline) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  /** Activates the tab holding `path` in any pane, or opens it. */
  async function revealOrOpen(path: string): Promise<void> {
    splitState = withWorkspace(splitState, boundPaneId, tabsState);
    for (const pane of splitState.panes) {
      const index = findTab(pane.workspace, path);
      if (index !== -1) {
        await applySplitChange(
          setActivePane(
            withWorkspace(splitState, pane.id, {
              ...pane.workspace,
              active: index,
            }),
            pane.id,
          ),
        );
        return;
      }
    }
    await openFile(path, { newTab: true });
  }

  /** Clears the workspace to the welcome view (no tab left to show). */
  function clearWorkspaceView(): void {
    autosave.cancel();
    openedPath = null;
    editor.setDoc("");
    editorHost.classList.add("is-hidden");
    readingView.element.classList.add("is-hidden");
    imageView.classList.add("is-hidden");
    emptyTabView.classList.add("is-hidden");
    setStatusMode(currentMode);
    if (!welcome.isConnected) {
      workspaceBody.prepend(welcome);
    }
    viewTitle.textContent = "";
    fileBar.classList.add("is-hidden");
    setInlineTitle(null);
    setCounts("");
    if (currentFolder !== null) {
      void getCurrentWindow()
        .setTitle(basename(currentFolder))
        .catch(() => undefined);
    }
  }

  /**
   * Moves per-file in-memory state (folds) to a new path. Per-tab
   * state (mode, scroll) keys off tab ids and survives renames as-is.
   */
  function moveFileState(from: string, to: string): void {
    const oldKey = normalizePath(from);
    const newKey = normalizePath(to);
    const folds = fileFolds.get(oldKey);
    if (folds !== undefined) {
      fileFolds.delete(oldKey);
      fileFolds.set(newKey, folds);
    }
  }

  async function renameFromMenu(path: string): Promise<void> {
    const current = isImageTarget(path)
      ? imageBaseName(path)
      : basename(path).replace(/\.md$/i, "");
    const name = await openPromptModal({
      title: t("menu.rename"),
      initial: current,
      acceptLabel: t("menu.rename").replace(/…$/, ""),
    });
    if (name === null || name === current) {
      return;
    }
    await renameNoteTo(path, name);
  }

  /** Renames `path` to `name`, repointing links (menu + inline title). */
  async function renameNoteTo(path: string, name: string): Promise<void> {
    // Images keep their own extension; notes default to .md.
    const extension = isImageTarget(path)
      ? basename(path).replace(/^.*(?=\.)/, "")
      : ".md";
    const target = joinPath(
      dirname(path),
      name.toLowerCase().endsWith(extension.toLowerCase())
        ? name
        : `${name}${extension}`,
    );
    // Files linking here, resolved with the pre-rename index and listing.
    const linkers =
      currentFolder === null
        ? []
        : backlinkIndex.backlinksOf(
            path,
            currentFolder,
            folderFiles,
            getSettings().files.defaultExtension,
          );
    try {
      if (openedPath !== null && samePath(path, openedPath) && autosave.isDirty()) {
        await saveNow();
      }
      await renameFile(path, target);
    } catch (error) {
      setStatusError(t("error.renameFile", { error: String(error) }));
      return;
    }
    moveFileState(path, target);
    tabsState = renameTabPath(tabsState, path, target);
    splitState = {
      ...splitState,
      panes: splitState.panes.map((pane) => ({
        ...pane,
        workspace: renameTabPath(pane.workspace, path, target),
      })),
    };
    for (const ui of paneUis.values()) {
      if (
        ui.id !== boundPaneId &&
        ui.openedPath !== null &&
        samePath(ui.openedPath, path)
      ) {
        ui.openedPath = target;
        ui.viewTitle.textContent = basename(target).replace(/\.md$/i, "");
      }
    }
    // Repoint the wikilinks of every linker to the new name.
    for (const linker of linkers) {
      try {
        const isOpen = openedPath !== null && samePath(linker, openedPath);
        const contents = isOpen ? editor.getDoc() : await readFile(linker);
        const rewrites = renameLinkTargets(
          contents,
          currentFolder ?? dirname(linker),
          folderFiles,
          path,
          target,
          getSettings().files.defaultExtension,
        );
        if (rewrites.length === 0) {
          continue;
        }
        const updated = applyRewrites(contents, rewrites);
        await writeFile(linker, updated);
        backlinkIndex.setFile(linker, updated);
        searchIndex.setFile(linker, updated);
        if (isOpen) {
          reloadingFromDisk = true;
          editor.reloadDoc(updated);
          reloadingFromDisk = false;
          setCounts(updated);
          if (currentMode === "read") {
            readingView.render(updated);
          }
        }
      } catch (error) {
        setStatusError(t("error.writeFile", { error: String(error) }));
      }
    }
    if (openedPath !== null && samePath(path, openedPath)) {
      openedPath = target;
      const noteName = basename(target).replace(/\.md$/i, "");
      viewTitle.textContent = noteName;
      void getCurrentWindow()
        .setTitle(`${basename(vaultRoot ?? dirname(target))} - ${noteName}`)
        .catch(() => undefined);
      setInlineTitle(
        getSettings().appearance.inlineTitle ? noteName : null,
      );
      editor.refreshBlocks();
      if (currentMode === "read") {
        const scroll = readingView.element.scrollTop;
        readingView.render(editor.getDoc());
        readingView.element.scrollTop = scroll;
      }
    }
    renderTabs();
    scheduleSessionSave();
    if (currentFolder !== null) {
      await refreshFolder(currentFolder);
      await rebuildIndex();
    }
  }

  async function deleteFromMenu(path: string): Promise<void> {
    if (getSettings().files.confirmDelete) {
      const confirmed = await ask(
        t("dialog.delete.message", { name: basename(path) }),
        { title: t("menu.delete"), kind: "warning" },
      );
      if (!confirmed) {
        return;
      }
    }
    try {
      await deleteFile(path);
    } catch (error) {
      setStatusError(t("error.deleteFile", { error: String(error) }));
      return;
    }
    fileFolds.delete(normalizePath(path));
    pendingModes.delete(normalizePath(path));
    // Close every tab holding the file, in every pane.
    if (openedPath !== null && samePath(path, openedPath)) {
      // The buffer belongs to a deleted file: never save it back.
      autosave.cancel();
      openedPath = null;
    }
    splitState = withWorkspace(splitState, boundPaneId, tabsState);
    let next = splitState;
    let touched = false;
    for (const pane of splitState.panes) {
      let ws = pane.workspace;
      let idx = findTab(ws, path);
      while (idx !== -1) {
        ws = closeTab(ws, idx);
        idx = findTab(ws, path);
        touched = true;
      }
      next = withWorkspaceOrCollapse(next, pane.id, ws);
    }
    if (touched) {
      if (boundPaneId === splitState.activePane) {
        tabsState = paneById(next, boundPaneId)?.workspace ?? tabsState;
      }
      await applySplitChange(next);
    }
    if (currentFolder !== null) {
      await refreshFolder(currentFolder);
      await rebuildIndex();
    }
    renderBacklinks();
  }

  /** Exports a note as the reading view renders it, via the print dialog. */
  async function exportPdfFromMenu(path: string): Promise<void> {
    try {
      const isOpen = openedPath !== null && samePath(path, openedPath);
      const contents = isOpen ? editor.getDoc() : await readFile(path);
      await exportNoteToPdf({
        title: basename(path).replace(/\.md$/i, ""),
        doc: contents,
        hooks: {
          resolveEmbedSrc,
          renderEmbedNote,
          isResolved: isResolvedTarget,
        },
        showProperties: getSettings().editor.showProperties,
        path,
      });
    } catch (error) {
      setStatusError(t("error.readFile", { error: String(error) }));
    }
  }

  /** View menu on the editor's empty margins / line-number gutter. */
  function openViewMenu(x: number, y: number): void {
    const settings = getSettings();
    openContextMenu(x, y, [
      {
        label: t("settings.readableLine.name"),
        icon: "text",
        checked: settings.appearance.readableLineLength,
        onClick: () =>
          void updateSettings((s) => ({
            ...s,
            appearance: {
              ...s.appearance,
              readableLineLength: !s.appearance.readableLineLength,
            },
          })),
      },
      {
        label: t("settings.lineNumbers.name"),
        icon: "list",
        checked: settings.editor.showLineNumbers,
        onClick: () =>
          void updateSettings((s) => ({
            ...s,
            editor: {
              ...s.editor,
              showLineNumbers: !s.editor.showLineNumbers,
            },
          })),
      },
      {
        label: t("settings.inlineTitle.name"),
        icon: "pencil",
        checked: settings.appearance.inlineTitle,
        onClick: () =>
          void updateSettings((s) => ({
            ...s,
            appearance: {
              ...s.appearance,
              inlineTitle: !s.appearance.inlineTitle,
            },
          })),
      },
    ]);
  }

  /** Where the shared file menu was opened from (m37). */
  type FileMenuOrigin = "sidebar" | "title" | "more";

  function openFileMenu(
    x: number,
    y: number,
    path: string,
    origin: FileMenuOrigin,
  ): void {
    const isOpenFile = openedPath !== null && samePath(path, openedPath);
    const image = isImageTarget(path);
    // View section: only from a pane's three-dots button with a note
    // open — never for images nor from the sidebar. Fold state is
    // shared between modes, so the fold entries work in both.
    const viewSection: MenuEntry[] =
      origin === "more" && isOpenFile && !image
        ? [
            {
              label:
                currentMode === "edit"
                  ? t("menu.readingMode")
                  : t("menu.editingMode"),
              icon: currentMode === "edit" ? "book-open" : "pencil",
              onClick: () => void toggleMode(),
            },
            "separator",
            {
              label: t("command.foldAll"),
              icon: "chevrons-down-up",
              onClick: () => runFoldCommand(() => editor.foldAllSections()),
            },
            {
              label: t("command.unfoldAll"),
              icon: "chevrons-up-down",
              onClick: () => runFoldCommand(() => editor.unfoldAllSections()),
            },
            {
              label: t("command.toggleFold"),
              icon: "chevron-down",
              onClick: () => runFoldCommand(() => editor.toggleAllSections()),
            },
            "separator",
          ]
        : [];
    openContextMenu(x, y, [
      ...viewSection,
      {
        label: t("menu.rename"),
        icon: "pencil",
        onClick: () => void renameFromMenu(path),
      },
      ...(isOpenFile && !image
        ? [
            {
              label: t("menu.addProperty"),
              icon: "plus" as const,
              onClick: () => editor.addProperty(),
            },
          ]
        : []),
      ...(isOpenFile
        ? [
            {
              label: t("tabs.splitRight"),
              icon: "separator-vertical" as const,
              onClick: () => void splitTabRight(tabsState.active),
            },
          ]
        : []),
      {
        label: t("menu.copyPath"),
        icon: "copy",
        submenu: [
          {
            label: t("menu.copyAbsolutePath"),
            onClick: () => void copyText(path),
          },
          {
            label: t("menu.copyRelativePath"),
            onClick: () => void copyText(basename(path)),
          },
        ],
      },
      "separator",
      {
        label: t("menu.openInDefaultApp"),
        icon: "external-link",
        onClick: () =>
          void openPath(path).catch((error) =>
            setStatusError(t("error.openFile", { error: String(error) })),
          ),
      },
      {
        label: t("menu.showInExplorer"),
        icon: "folder",
        onClick: () =>
          void revealItemInDir(path).catch((error) =>
            setStatusError(t("error.openFile", { error: String(error) })),
          ),
      },
      ...(image
        ? []
        : [
            {
              label: t("menu.exportPdf"),
              icon: "file-down" as const,
              onClick: () => void exportPdfFromMenu(path),
            },
          ]),
      "separator",
      {
        label: t("menu.delete"),
        icon: "trash",
        danger: true,
        onClick: () => void deleteFromMenu(path),
      },
    ]);
  }

  /** Explicit folder open: routes to the folder's vault window. */
  async function openFolder(path: string): Promise<void> {
    setStatusError(null);
    await routeOpen("folder", path);
  }

  async function openFolderFromDialog(): Promise<void> {
    const folder = await openFolderDialog({
      title: t("dialog.openFolder.title"),
    });
    if (folder !== null) {
      await openFolder(folder);
    }
  }

  /** Switcher label: vault-relative path in vault mode, bare name flat. */
  function switcherLabel(file: FolderFile): string {
    const label =
      vaultRoot === null
        ? file.name
        : relativePath(vaultRoot, file.path);
    return label.replace(/\.md$/i, "");
  }

  function openQuickSwitcher(): void {
    openPalette({
      placeholder: t("switcher.placeholder"),
      emptyLabel:
        currentFolder === null ? t("sidebar.noFolder") : t("palette.noResults"),
      items: [
        // In vault mode the label is the path from the vault root, so
        // duplicate names stay distinguishable (Obsidian-style).
        ...folderFiles.map((file) => ({
          id: file.path,
          label: switcherLabel(file),
        })),
        // Aliases jump to their note; "|" never appears in Windows paths.
        ...folderFiles.flatMap((file) =>
          (file.aliases ?? []).map((alias) => ({
            id: `${file.path}|${alias}`,
            label: `${alias} → ${switcherLabel(file)}`,
          })),
        ),
      ],
      onSelect(item) {
        void openFile(item.id.split("|")[0]);
      },
      onCreate:
        currentFolder === null
          ? undefined
          : (name) => {
              void openWikilink(name);
            },
      createLabel: (name) => t("switcher.create", { name }),
      onClose() {
        editor.focus();
      },
    });
  }

  /**
   * Runs a fold command and keeps the open view in step: fold state
   * lives in the editor and the reading render hides folded sections,
   * so read mode re-renders in place, preserving its scroll (m37).
   */
  function runFoldCommand(action: () => void): void {
    action();
    if (currentMode === "read") {
      const scroll = readingView.element.scrollTop;
      readingView.render(editor.getDoc());
      readingView.element.scrollTop = scroll;
    } else {
      editor.focus();
    }
  }

  const commands: Command[] = [
    {
      id: "open-file",
      nameKey: "command.openFile",
      run: () => void openFileFromDialog(),
    },
    {
      id: "save-file",
      nameKey: "command.saveFile",
      hotkey: "Ctrl+S",
      run: () => void saveNow(),
    },
    {
      id: "quick-switcher",
      nameKey: "command.quickSwitcher",
      hotkey: "Ctrl+O",
      run: openQuickSwitcher,
    },
    {
      id: "open-settings",
      nameKey: "command.openSettings",
      hotkey: "Ctrl+,",
      run: () => openSettingsModal(),
    },
    {
      id: "toggle-reading-mode",
      nameKey: "command.toggleReadingMode",
      hotkey: "Ctrl+E",
      run: () => void toggleMode(),
    },
    {
      id: "open-folder",
      nameKey: "command.openFolder",
      run: () => void openFolderFromDialog(),
    },
    {
      id: "toggle-backlinks",
      nameKey: "command.toggleBacklinks",
      run: toggleRightPanel,
    },
    {
      id: "fold-all",
      nameKey: "command.foldAll",
      run: () => runFoldCommand(() => editor.foldAllSections()),
    },
    {
      id: "smart-fold-folders",
      nameKey: "command.smartFold",
      run: () => applySmartFold(),
    },
    {
      id: "unfold-all",
      nameKey: "command.unfoldAll",
      run: () => runFoldCommand(() => editor.unfoldAllSections()),
    },
    {
      id: "toggle-fold-all",
      nameKey: "command.toggleFold",
      run: () => runFoldCommand(() => editor.toggleAllSections()),
    },
    {
      id: "insert-table",
      nameKey: "menu.insertTable",
      run: () => editor.insertTable(),
    },
    {
      id: "global-search",
      nameKey: "command.globalSearch",
      hotkey: "Ctrl+Shift+F",
      run: openSearch,
    },
    {
      id: "export-pdf",
      nameKey: "menu.exportPdf",
      run: () => {
        if (openedPath !== null) {
          void exportPdfFromMenu(openedPath);
        }
      },
    },
    {
      id: "new-note",
      nameKey: "command.newNote",
      hotkey: "Ctrl+N",
      run: () => void createNewNote(),
    },
    {
      id: "new-tab",
      nameKey: "tabs.new",
      run: () => void applyTabsChange(newEmptyTab(tabsState)),
    },
    {
      id: "close-tab",
      nameKey: "command.closeTab",
      hotkey: "Ctrl+W",
      run: () => {
        if (tabsState.active !== -1) {
          void closeTabAt(tabsState.active);
        }
      },
    },
    {
      id: "next-tab",
      nameKey: "command.nextTab",
      hotkey: "Ctrl+Tab",
      run: () => cycleTab(1),
    },
    {
      id: "prev-tab",
      nameKey: "command.prevTab",
      hotkey: "Ctrl+Shift+Tab",
      run: () => cycleTab(-1),
    },
  ];

  function applySidebarVisible(visible: boolean): void {
    sidebarVisible = visible;
    root.classList.toggle("left-collapsed", !visible);
  }

  function applyRightVisible(visible: boolean): void {
    rightVisible = visible;
    backlinksPanel.classList.toggle("is-hidden", !visible);
    root.classList.toggle("right-collapsed", !visible);
    if (visible) {
      renderRightPanel();
    }
  }

  function toggleSidebar(): void {
    applySidebarVisible(!sidebarVisible);
    scheduleSessionSave();
  }

  function toggleRightPanel(): void {
    applyRightVisible(!rightVisible);
    scheduleSessionSave();
  }

  /** Opens the right panel on the backlinks view (status-bar shortcut). */
  function showBacklinksView(): void {
    rightView = "backlinks";
    if (!rightVisible) {
      toggleRightPanel();
    } else {
      renderRightPanel();
    }
    scheduleSessionSave();
  }

  function openCommandPalette(): void {
    openPalette({
      placeholder: t("palette.commandPlaceholder"),
      emptyLabel: t("palette.noResults"),
      items: commandPaletteItems(commands),
      onSelect(item) {
        commands.find((command) => command.id === item.id)?.run();
      },
      onClose() {
        editor.focus();
      },
    });
  }

  let searchDebounce: ReturnType<typeof setTimeout> | null = null;
  searchInput.addEventListener("input", () => {
    if (searchDebounce !== null) {
      clearTimeout(searchDebounce);
    }
    searchDebounce = setTimeout(() => {
      searchDebounce = null;
      runSearch();
    }, 150);
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
    }
  });
  searchClose.addEventListener("click", closeSearch);

  // The WebView's own context menu (reload, print…) never applies here;
  // our menus preventDefault on their targets before this runs.
  window.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  // Mouse side buttons: history back/forward, like a browser.
  window.addEventListener("auxclick", (event) => {
    if (event.button === 3) {
      event.preventDefault();
      void navigateHistory(-1);
    } else if (event.button === 4) {
      event.preventDefault();
      void navigateHistory(1);
    }
  });

  window.addEventListener("keydown", (event) => {
    // Already consumed (e.g. the editor keymap handled Ctrl+E): acting
    // again here would toggle twice and look like a no-op.
    if (event.defaultPrevented) {
      return;
    }
    // WebView chrome shortcuts: reload would wipe the session, and
    // Ctrl+S must save the note instead of the page.
    if (
      event.key === "F5" ||
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r")
    ) {
      event.preventDefault();
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "s"
    ) {
      event.preventDefault();
      void saveNow();
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "f"
    ) {
      event.preventDefault();
      toggleSearch();
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void navigateHistory(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        void navigateHistory(1);
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Tab") {
      event.preventDefault();
      cycleTab(event.shiftKey ? -1 : 1);
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "w"
    ) {
      // The WebView would close the window otherwise.
      event.preventDefault();
      if (tabsState.active !== -1) {
        void closeTabAt(tabsState.active);
      }
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "n") {
      event.preventDefault();
      void createNewNote();
    } else if (key === "o") {
      event.preventDefault();
      openQuickSwitcher();
    } else if (key === "p") {
      event.preventDefault();
      openCommandPalette();
    } else if (key === ",") {
      event.preventDefault();
      openSettingsModal();
    } else if (key === "e") {
      event.preventDefault();
      void toggleMode();
    }
  });

  // Hot-apply settings changes to the editor, autosave and static labels.
  subscribeSettings((settings) => {
    autosaveOptions.enabled = settings.editor.autosave;
    autosaveOptions.intervalMs = settings.editor.autosaveIntervalMs;
    // Before applyConfig: its dispatch rebuilds embed widgets, which
    // must pick up the new generation (e.g. showProperties changes).
    bumpEmbedGeneration();
    setInlineTitle(
      openedPath !== null && settings.appearance.inlineTitle
        ? basename(openedPath).replace(/\.md$/i, "")
        : null,
    );
    for (const ui of paneUis.values()) {
      ui.editor.applyConfig(editorConfigFrom(settings));
    }
    editor.refreshBlocks();
    refreshTexts();
    // Hot-apply the properties visibility to an open reading view.
    if (openedPath !== null && currentMode === "read") {
      const scroll = readingView.element.scrollTop;
      readingView.render(editor.getDoc());
      readingView.element.scrollTop = scroll;
    }
  });

  function refreshTexts(): void {
    openFileButton.title = t("sidebar.openFile");
    openFileButton.setAttribute("aria-label", t("sidebar.openFile"));
    openFolderButton.title = t("sidebar.openFolder");
    openFolderButton.setAttribute("aria-label", t("sidebar.openFolder"));
    searchButton.title = t("search.title");
    searchButton.setAttribute("aria-label", t("search.title"));
    updateCollapseAllButton();
    collapseLeftButton.title = t("workspace.collapseLeft");
    collapseRightButton.title = t("workspace.collapseRight");
    settingsButton.title = t("settings.title");
    settingsButton.setAttribute("aria-label", t("settings.title"));
    helpButton.title = t("help.title");
    helpButton.setAttribute("aria-label", t("help.title"));
    statusPalette.title = t("command.commandPalette");
    statusPalette.setAttribute("aria-label", t("command.commandPalette"));
    statusSwitcher.title = t("command.quickSwitcher");
    statusSwitcher.setAttribute("aria-label", t("command.quickSwitcher"));
    refreshStatusChrome();
    renderUpdateNotice();
    for (const ui of paneUis.values()) {
      ui.welcome.textContent = t("workspace.welcome");
      ui.modeHeaderButton.title = t("command.toggleReadingMode");
      ui.moreButton.title = t("workspace.moreOptions");
      ui.moreButton.setAttribute("aria-label", t("workspace.moreOptions"));
      ui.navBackButton.title = t("nav.back");
      ui.navBackButton.setAttribute("aria-label", t("nav.back"));
      ui.navForwardButton.title = t("nav.forward");
      ui.navForwardButton.setAttribute("aria-label", t("nav.forward"));
      for (const action of ui.emptyTabView.querySelectorAll<HTMLElement>(
        ".empty-tab-action",
      )) {
        if (action.dataset.labelKey !== undefined) {
          action.textContent = t(action.dataset.labelKey);
        }
      }
    }
    renderTabs();
    searchTitle.textContent = t("search.title");
    searchInput.placeholder = t("search.placeholder");
    searchClose.title = t("search.close");
    searchClose.setAttribute("aria-label", t("search.close"));
    if (searchVisible) {
      runSearch();
    }
    renderBacklinks();
    if (currentFolder === null) {
      setListMessage(t("sidebar.noFolder"));
    } else if (folderFiles.length === 0) {
      setListMessage(t("sidebar.emptyFolder"));
    }
  }

  // External change to the open file: reload it only when there are no
  // pending local edits (local wins during the autosave window).
  async function maybeReloadOpenFile(): Promise<void> {
    if (openedPath === null || autosave.isDirty()) {
      return;
    }
    if (isImageTarget(openedPath)) {
      // The webview caches asset URLs; re-set the source so an edited
      // image repaints.
      imageEl.src = convertFileSrc(openedPath) + `?v=${Date.now()}`;
      return;
    }
    let contents: string;
    try {
      contents = await readFile(openedPath);
    } catch {
      // Deleted or unreadable on disk: keep the buffer; saving recreates it.
      return;
    }
    if (contents === editor.getDoc()) {
      return;
    }
    // The reader must stay where they are: anchor in document space
    // before the reload and re-apply after — a full-document replace
    // (and the reading re-render) would otherwise land at the top.
    const anchor =
      currentMode === "edit" ? editor.topVisiblePos() : readingTopAnchor();
    reloadingFromDisk = true;
    editor.reloadDoc(contents);
    reloadingFromDisk = false;
    setCounts(contents);
    if (currentMode === "read") {
      await readingView.render(contents);
      if (anchor !== null) {
        scrollReadingToAnchor(anchor);
      }
    } else if (anchor !== null) {
      scrollEditorToAnchor(anchor);
    }
    mirrorToTwins(openedPath, contents);
  }

  // The watcher fires in bursts (editors write several times); coalesce
  // and then re-list + reindex the whole folder — small by design.
  let watcherDebounce: ReturnType<typeof setTimeout> | null = null;
  void listen("folder-changed", () => {
    if (watcherDebounce !== null) {
      clearTimeout(watcherDebounce);
    }
    watcherDebounce = setTimeout(() => {
      watcherDebounce = null;
      const folder = currentFolder;
      if (folder !== null) {
        clearEmbedHtmlCache();
        void (async () => {
          await refreshFolder(folder);
          await rebuildIndex();
          await maybeReloadOpenFile();
        })();
      }
    }, 300);
  });

  // Best-effort save of pending changes when the window closes. The
  // arbiter snapshot is read before this window's registry entry is
  // removed, so a surviving same-scope window keeps the session.
  window.addEventListener("beforeunload", () => {
    autosave.flush();
    const entries = queryScopes();
    clearScopeEntry();
    void persistSession({ entries });
  });

  // Mount the initial single pane and bind everything to it.
  createPaneUi(1);
  bindPaneUi(1);
  paneUis.get(1)?.root.classList.add("is-active-pane");
  applySplitSizes();

  setListMessage(t("sidebar.noFolder"));
  setCounts("");
  refreshTexts();
  renderBacklinks();

  // A second app instance forwards its command line to every window
  // (single instance). Exactly one handles it: the live window whose
  // label sorts first ("main" before "w*") — deterministic without
  // coordination, and it also covers the main window being closed
  // while secondaries live on. The leader routes the file to the
  // right vault window.
  void listen<string[]>("single-instance", (event) => {
    void (async () => {
      const file = event.payload.find((arg) =>
        arg.toLowerCase().endsWith(".md"),
      );
      if (file === undefined) {
        return;
      }
      const labels = (await liveWindowLabels()).sort();
      if (labels.length > 0 && labels[0] !== windowLabel) {
        return;
      }
      await enqueueWorkspace(() => routeOpen("file", file, { focusSelf: true }));
    })();
  });

  // Routed opens arriving from another window: reveal or open the
  // file here; a folder just refreshes the listing (never destroys
  // this window's tabs remotely).
  void listen<{ to: string; kind: "file" | "folder"; path: string }>(
    "routed-open",
    (event) => {
      if (event.payload.to !== windowLabel) {
        return; // addressed to another window
      }
      void enqueueWorkspace(async () => {
        if (event.payload.kind === "file") {
          await revealOrOpen(event.payload.path);
        } else {
          await refreshFolder(event.payload.path, { redetect: true });
          renderBacklinks();
        }
      });
    },
  );

  // Startup precedence: a file passed via the URL (moved tab or a
  // routed spawn), then the command line (main window), then the
  // session of the last active vault.
  void (async () => {
    await enqueueWorkspace(() => restoreStartup());
    // The focused window's vault is the one a plain launch reopens,
    // and its freshness elects the session owner among same-scope
    // windows.
    void getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload && homeScope !== null) {
        publishScope();
        uiState.lastVault = homeScope.root;
        void saveUiState(uiState);
      }
    });
    // Startup update check (main window, when enabled): silent while
    // up to date, a discreet status-bar notice otherwise.
    if (isMainWindow && getSettings().updates.checkAutomatically) {
      const result = await checkForUpdate();
      if (result.status === "outdated") {
        availableUpdate = {
          version: result.latest.version,
          url: result.latest.url,
        };
        renderUpdateNotice();
      }
    }
  })();

  function renderUpdateNotice(): void {
    statusUpdate.hidden = availableUpdate === null;
    if (availableUpdate !== null) {
      statusUpdate.textContent = t("updates.available", {
        version: availableUpdate.version,
      });
    }
  }

  async function restoreStartup(): Promise<void> {
    // A previous run of this same label may have crashed: its stale
    // registry entry must not outlive it. The main window also sweeps
    // entries of labels that are no longer alive.
    clearScopeEntry();
    if (isMainWindow) {
      const live = await liveWindowLabels();
      for (const entry of queryScopes()) {
        if (!live.includes(entry.label)) {
          try {
            localStorage.removeItem(SCOPE_ENTRY_PREFIX + entry.label);
          } catch {
            // Best effort.
          }
        }
      }
    }
    const params = new URLSearchParams(window.location.search);
    const openParam = params.get("open");
    if (openParam !== null) {
      // Tab moved into this fresh window: only that file opens, and
      // the window joins the file's vault. The save arbiter keeps its
      // single-tab snapshot from clobbering the origin window's
      // session — only the last-focused same-scope window persists.
      const mode = params.get("mode");
      if (mode === "edit" || mode === "read") {
        pendingModes.set(normalizePath(openParam), mode);
      }
      uiState = (await loadUiState()) ?? emptyUiState();
      const scope = await resolveScopeOf(openParam, "file");
      const session = await loadVaultSession(scope);
      applyRestoredGeometry(session);
      applyRestoredFoldState(session);
      setHomeScope(scope);
      await openFile(openParam);
      return;
    }
    // Routed spawn (milestone 31): a fresh window opening a vault that
    // no live window held — full per-vault restore, then the target.
    const routedFile = params.get("vopen");
    const routedFolder = params.get("vfolder");
    if (routedFile !== null || routedFolder !== null) {
      uiState = (await loadUiState()) ?? emptyUiState();
      if (routedFile !== null) {
        await switchToScope(await resolveScopeOf(routedFile, "file"), {
          file: routedFile,
        });
      } else if (routedFolder !== null) {
        await switchToScope(await resolveScopeOf(routedFolder, "folder"), {});
      }
      return;
    }
    if (isMainWindow) {
      await migrateLegacySessions((path) => resolveScopeOf(path, "file"));
    }
    uiState = (await loadUiState()) ?? emptyUiState();
    const startup = isMainWindow ? await startupFile() : null;
    if (startup !== null) {
      await routeOpen("file", startup, { focusSelf: true });
      return;
    }
    if (uiState.lastVault !== null) {
      await switchToScope(scopeOf(uiState.lastVault), {});
      return;
    }
    // Nothing to reopen: apply the global layout fallbacks only.
    applyRestoredGeometry(null);
  }

  /** Layout state: the vault session's values, else the global ones. */
  function applyRestoredGeometry(session: SessionData | null): void {
    const panels = session?.panels ?? uiState.panels;
    if (panels !== null) {
      panelSizes = panels;
      applyPanelSizes();
    }
    const view = session?.rightView ?? uiState.rightView;
    if (view !== null) {
      rightView = view;
      renderRightPanel();
    }
    const left = session?.leftVisible ?? uiState.leftVisible;
    if (left !== null) {
      applySidebarVisible(left);
    }
    const right = session?.rightVisible ?? uiState.rightVisible;
    if (right !== null) {
      applyRightVisible(right);
    }
  }

  /**
   * Makes `scope` this window's vault: the outgoing vault's session is
   * saved, the target's session (or an empty workspace) replaces the
   * current one, and `opts.file` opens on top. The per-vault geometry
   * falls back to the global ui-state.
   */
  async function switchToScope(
    scope: ScopeInfo,
    opts: { file?: string },
  ): Promise<void> {
    if (homeScope !== null && homeScope.key === scope.key) {
      if (opts.file !== undefined) {
        await revealOrOpen(opts.file);
      }
      return;
    }
    await stashCurrentTabState();
    autosave.flush();
    if (homeScope !== null) {
      // The outgoing vault keeps its session before the workspace
      // turns. A scopeless window has nothing to save — flushing
      // would clobber the stored ui-state before it is applied.
      await flushSessionSave();
    }
    setHomeScope(scope);
    const session = await loadVaultSession(scope);
    applyRestoredGeometry(session);
    applyRestoredFoldState(session);
    const restored =
      session !== null && getSettings().files.restoreSession
        ? await restoreSessionPanes(session)
        : false;
    if (!restored) {
      await applySplitChange(singlePane(emptyWorkspace()));
    }
    if (opts.file !== undefined) {
      await revealOrOpen(opts.file);
      return;
    }
    if (!restored) {
      // Folder with nothing to reopen: show its (possibly empty)
      // listing. An unreadable root leaves the window unassigned so
      // the next explicit open can re-home it.
      try {
        await listFolder(scope.root);
      } catch {
        homeScope = null;
        clearScopeEntry();
        return;
      }
      await refreshFolder(scope.root, { redetect: true });
      renderBacklinks();
      void getCurrentWindow()
        .setTitle(basename(vaultRoot ?? scope.root))
        .catch(() => undefined);
    }
  }

  /**
   * Rebuilds the split state, probing files and dropping the missing;
   * false when nothing valid remained to restore.
   */
  async function restoreSessionPanes(session: SessionData): Promise<boolean> {
    const paneStates: SplitState["panes"] = [];
    for (const sessionPane of session.panes) {
      const tabs: Tab[] = [];
      for (const tab of sessionPane.tabs) {
        // Images cannot be read as text: probe them via the listing.
        if (isImageTarget(tab.path)) {
          if (!(await folderContains(dirname(tab.path), basename(tab.path)))) {
            continue; // gone since last session
          }
        } else {
          try {
            await readFile(tab.path);
          } catch {
            continue; // gone since last session
          }
        }
        const restored: Tab = {
          ...makeTab(tab.path, tab.pinned),
          back: tab.back,
          forward: tab.forward,
        };
        tabs.push(restored);
        tabModes.set(restored.id, tab.mode);
      }
      if (tabs.length === 0) {
        continue;
      }
      paneStates.push({
        id: paneStates.length + 1,
        workspace: {
          tabs,
          active: Math.min(sessionPane.active, tabs.length - 1),
        },
        size: sessionPane.size,
      });
    }
    if (paneStates.length === 0) {
      return false;
    }
    const activeIndex = Math.min(session.activePane, paneStates.length - 1);
    await applySplitChange({
      panes: paneStates,
      activePane: paneStates[activeIndex].id,
      nextId: paneStates.length + 1,
    });
    return true;
  }
}
