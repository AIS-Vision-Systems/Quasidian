// App shell: sidebar with folder listing, CM6 editor, status bar.
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
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
} from "../ipc/fs";
import { createEditor } from "../editor/editor";
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
  activeTabPath,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  emptyWorkspace,
  findTab,
  goBack,
  goForward,
  historyState,
  moveTab,
  newEmptyTab,
  openPath as openTabPath,
  renameTabPath,
  serializeSession,
  setPinned,
  type PanelSizes,
  type RightPanelView,
  type Tab,
  type WorkspaceState,
} from "../lib/workspace";
import { loadSession, saveSession } from "../ipc/sessionStore";
import { renderToHtml } from "../markdown/render";
import { isImageTarget } from "../markdown/wikilinks";
import {
  getSettings,
  subscribeSettings,
  updateSettings,
} from "../ipc/settingsStore";
import { editorConfigFrom } from "./applySettings";
import { commandPaletteItems, type Command } from "./commands";
import { openContextMenu, openPromptModal } from "./contextMenu";
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
  sidebarHeader.append(openFileButton, openFolderButton, searchButton);
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

  // Center top bar: collapse left, the tab bar, collapse right.
  const viewHeader = document.createElement("div");
  viewHeader.className = "view-header";
  const collapseLeftButton = document.createElement("button");
  collapseLeftButton.className = "view-header-button";
  collapseLeftButton.append(createIcon("panel-left"));
  collapseLeftButton.addEventListener("click", () => toggleSidebar());
  const tabBar = document.createElement("div");
  tabBar.className = "tab-bar";
  const collapseRightButton = document.createElement("button");
  collapseRightButton.className = "view-header-button";
  collapseRightButton.append(createIcon("panel-right"));
  collapseRightButton.addEventListener("click", () => toggleRightPanel());
  viewHeader.append(collapseLeftButton, tabBar, collapseRightButton);

  // File bar: navigation arrows on the left, note name centered, mode
  // toggle and the file menu (three dots) on the right.
  const fileBar = document.createElement("div");
  fileBar.className = "file-bar is-hidden";
  const navGroup = document.createElement("div");
  navGroup.className = "view-header-actions file-nav";
  const navBackButton = document.createElement("button");
  navBackButton.className = "view-header-button";
  navBackButton.append(createIcon("arrow-left"));
  navBackButton.addEventListener("click", () => void navigateHistory(-1));
  const navForwardButton = document.createElement("button");
  navForwardButton.className = "view-header-button";
  navForwardButton.append(createIcon("arrow-right"));
  navForwardButton.addEventListener("click", () => void navigateHistory(1));
  navGroup.append(navBackButton, navForwardButton);
  const viewTitle = document.createElement("span");
  viewTitle.className = "view-title";
  const fileActions = document.createElement("div");
  fileActions.className = "view-header-actions";
  const modeHeaderButton = document.createElement("button");
  modeHeaderButton.className = "view-header-button";
  modeHeaderButton.append(createIcon("book-open"));
  modeHeaderButton.title = t("command.toggleReadingMode");
  modeHeaderButton.addEventListener("click", () => void toggleMode());
  const moreButton = document.createElement("button");
  moreButton.className = "view-header-button";
  moreButton.append(createIcon("more-vertical"));
  moreButton.addEventListener("click", () => {
    if (openedPath !== null) {
      const rect = moreButton.getBoundingClientRect();
      openFileMenu(rect.left, rect.bottom + 4, openedPath);
    }
  });
  fileActions.append(modeHeaderButton, moreButton);
  viewTitle.addEventListener("contextmenu", (event) => {
    if (openedPath !== null) {
      event.preventDefault();
      openFileMenu(event.clientX, event.clientY, openedPath);
    }
  });
  fileBar.append(navGroup, viewTitle, fileActions);

  const workspaceBody = document.createElement("div");
  workspaceBody.className = "workspace-body";

  const welcome = document.createElement("div");
  welcome.className = "workspace-welcome";
  welcome.textContent = t("workspace.welcome");

  const editorHost = document.createElement("div");
  editorHost.className = "editor-host is-hidden";

  // Empty ("new") tab: three centered accent actions.
  const emptyTabView = document.createElement("div");
  emptyTabView.className = "empty-tab-view is-hidden";
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
  emptyTabView.append(
    emptyTabAction("tabs.actionNewNote", () => void createNewNote()),
    emptyTabAction("tabs.actionOpenFile", () => openQuickSwitcher()),
    emptyTabAction("tabs.actionClose", () => {
      if (tabsState.active !== -1) {
        void closeTabAt(tabsState.active);
      }
    }),
  );

  workspaceBody.append(welcome, editorHost, emptyTabView);
  workspace.append(viewHeader, fileBar, workspaceBody);

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
  let currentFolder: string | null = null;
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
    const resolution = resolveWikilink(
      target,
      currentFolder,
      folderFiles,
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

  const editor = createEditor(editorHost, {
    onDocChanged(doc) {
      setCounts(doc);
      if (openedPath !== null && !reloadingFromDisk) {
        autosave.notifyChange();
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

  const readingView = createReadingView({
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
  workspaceBody.append(readingView.element);

  // Inline-title edits in the editor widget commit through the same
  // rename flow (links repointed, tabs and state updated).
  setInlineTitleRename((name) => {
    if (openedPath !== null) {
      void renameNoteTo(openedPath, name);
    }
  });

  const fileModes = new Map<string, EditorModeSetting>();
  // Fold state per file, in memory only (never written to the folder).
  const fileFolds = new Map<string, { from: number; to: number }[]>();
  // Scroll fraction per file, for the mode it was left in.
  const fileScroll = new Map<string, number>();
  let currentMode: EditorModeSetting = "edit";

  function applyMode(mode: EditorModeSetting): void {
    currentMode = mode;
    if (openedPath !== null) {
      fileModes.set(normalizePath(openedPath), mode);
    }
    const editing = mode === "edit";
    editorHost.classList.toggle("is-hidden", !editing);
    readingView.element.classList.toggle("is-hidden", editing);
    modeButton.textContent = t(
      editing ? "statusBar.mode.edit" : "statusBar.mode.read",
    );
    modeHeaderButton.replaceChildren(
      createIcon(editing ? "book-open" : "pencil"),
    );
    scheduleSessionSave();
  }

  // --- Tabs ---

  /** Session snapshot: tabs, modes, panel sizes and right-panel view. */
  function snapshotSession() {
    return serializeSession(
      tabsState,
      (path) =>
        fileModes.get(normalizePath(path)) ?? getSettings().editor.defaultMode,
      panelSizes,
      rightView,
    );
  }

  let sessionSaveDebounce: ReturnType<typeof setTimeout> | null = null;
  function scheduleSessionSave(): void {
    if (sessionSaveDebounce !== null) {
      clearTimeout(sessionSaveDebounce);
    }
    sessionSaveDebounce = setTimeout(() => {
      sessionSaveDebounce = null;
      void saveSession(snapshotSession());
    }, 300);
  }

  /** Saves the active tab's transient state (folds, scroll, buffer). */
  async function stashCurrentTabState(): Promise<void> {
    if (openedPath === null) {
      return;
    }
    const key = normalizePath(openedPath);
    fileFolds.set(key, editor.getFolds());
    fileScroll.set(
      key,
      scrollFraction(
        currentMode === "edit"
          ? editorHost.querySelector(".cm-scroller")
          : readingView.element,
      ),
    );
    if (autosave.isDirty()) {
      await saveNow();
    }
  }

  function renderTabs(): void {
    const plusButton = document.createElement("button");
    plusButton.className = "tab-new-button";
    plusButton.append(createIcon("plus"));
    plusButton.title = t("tabs.new");
    plusButton.setAttribute("aria-label", t("tabs.new"));
    plusButton.addEventListener("click", () =>
      void applyTabsChange(newEmptyTab(tabsState)),
    );
    tabBar.replaceChildren(
      ...tabsState.tabs.map((tab, index) => {
        const el = document.createElement("div");
        el.className = "workspace-tab";
        el.classList.toggle("is-active", index === tabsState.active);
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
        name.textContent =
          tab.path === null
            ? t("tabs.newTab")
            : basename(tab.path).replace(/\.md$/i, "");
        el.append(name);
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
    updateNavButtons();
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
    if (prevPath === null || !samePath(prevPath, nextPath)) {
      await stashCurrentTabState();
      tabsState = next;
      await loadFile(nextPath);
      return;
    }
    tabsState = next;
    renderTabs();
    scheduleSessionSave();
  }

  /** The active tab is empty: show its three actions. */
  function showEmptyTabView(): void {
    autosave.cancel();
    openedPath = null;
    editor.setDoc("");
    editorHost.classList.add("is-hidden");
    readingView.element.classList.add("is-hidden");
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

  async function activateTab(index: number): Promise<void> {
    const tab = tabsState.tabs[index];
    if (tab === undefined || index === tabsState.active) {
      return;
    }
    if (tab.path === null) {
      await applyTabsChange({ ...tabsState, active: index });
    } else {
      await openFile(tab.path);
    }
  }

  function cycleTab(delta: number): void {
    const count = tabsState.tabs.length;
    if (count < 2) {
      return;
    }
    void activateTab((tabsState.active + delta + count) % count);
  }

  /** Click activates; dragging past a threshold reorders the tab. */
  function startTabDrag(
    el: HTMLElement,
    index: number,
    start: MouseEvent,
  ): void {
    let dragging = false;
    let target = index;
    const clearMarkers = (): void => {
      for (const tabEl of tabBar.children) {
        tabEl.classList.remove("drop-before", "drop-after");
      }
    };
    const onMove = (event: MouseEvent): void => {
      if (!dragging && Math.abs(event.clientX - start.clientX) < 5) {
        return;
      }
      dragging = true;
      el.classList.add("is-dragging");
      clearMarkers();
      const tabs = [...tabBar.children] as HTMLElement[];
      for (let i = 0; i < tabs.length; i++) {
        const rect = tabs[i].getBoundingClientRect();
        if (event.clientX < rect.left + rect.width / 2) {
          target = i > index ? i - 1 : i;
          tabs[i].classList.add("drop-before");
          return;
        }
      }
      target = tabs.length - 1;
      tabs[tabs.length - 1]?.classList.add("drop-after");
    };
    const onUp = (): void => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      el.classList.remove("is-dragging");
      clearMarkers();
      if (dragging) {
        void applyTabsChange(moveTab(tabsState, index, target));
      } else {
        void activateTab(index);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
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

  async function toggleMode(): Promise<void> {
    hideHoverPreview();
    if (openedPath === null) {
      return;
    }
    const scroller = editorHost.querySelector(".cm-scroller");
    if (currentMode === "edit") {
      if (autosave.isDirty()) {
        await saveNow();
      }
      readingView.render(editor.getDoc());
      const fraction = scrollFraction(scroller);
      applyMode("read");
      setScrollFraction(readingView.element, fraction);
    } else {
      const fraction = scrollFraction(readingView.element);
      applyMode("edit");
      setScrollFraction(scroller, fraction);
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
    if (openedPath === null) {
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

  async function refreshFolder(folderPath: string): Promise<void> {
    let entries;
    try {
      entries = await listFolder(folderPath);
    } catch (error) {
      setListMessage(t("error.listFolder", { error: String(error) }));
      return;
    }
    const markdownFiles = entries
      .filter((entry) => !entry.isDir && entry.name.toLowerCase().endsWith(".md"))
      .sort((a, b) => a.name.localeCompare(b.name));
    currentFolder = folderPath;
    folderFiles = markdownFiles.map(({ name, path }) => ({ name, path }));
    folderImages = entries
      .filter((entry) => !entry.isDir && isImageTarget(entry.name))
      .map(({ name, path }) => ({ name, path }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (watchedFolder === null || !samePath(watchedFolder, folderPath)) {
      watchedFolder = folderPath;
      watchFolder(folderPath).catch(() => undefined);
      void rebuildIndex();
    } else {
      renderBacklinks();
    }
    if (markdownFiles.length === 0) {
      setListMessage(t("sidebar.emptyFolder"));
      return;
    }
    fileList.replaceChildren(
      ...markdownFiles.map((entry) => {
        const item = document.createElement("li");
        item.className = "file-item";
        item.classList.toggle(
          "is-active",
          openedPath !== null && samePath(entry.path, openedPath),
        );
        item.textContent = entry.name.replace(/\.md$/i, "");
        item.addEventListener("click", (event) =>
          void openFile(entry.path, {
            newTab: event.ctrlKey || event.metaKey,
          }),
        );
        item.addEventListener("auxclick", (event) => {
          if (event.button === 1) {
            event.preventDefault();
            void openFile(entry.path, { newTab: true });
          }
        });
        item.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          openFileMenu(event.clientX, event.clientY, entry.path);
        });
        return item;
      }),
    );
  }

  async function openWikilink(target: string, newTab = false): Promise<void> {
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
    // Window title "folder - note"; cosmetic, so failures are ignored.
    void getCurrentWindow()
      .setTitle(`${basename(dirname(path))} - ${noteName}`)
      .catch(() => undefined);
    // The folder state must exist before setDoc: embed widgets resolve
    // their sources against it while building decorations.
    await refreshFolder(dirname(path));
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
      const mode =
        fileModes.get(normalizePath(path)) ?? getSettings().editor.defaultMode;
      if (mode === "read") {
        readingView.render(contents);
      }
      applyMode(mode);
      const savedScroll = fileScroll.get(normalizePath(path));
      if (savedScroll !== undefined) {
        setScrollFraction(
          mode === "edit"
            ? editorHost.querySelector(".cm-scroller")
            : readingView.element,
          savedScroll,
        );
      }
      if (mode === "edit") {
        editor.focus();
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
      await openFile(path);
    }
  }

  /** Clears the workspace to the welcome view (no tab left to show). */
  function clearWorkspaceView(): void {
    autosave.cancel();
    openedPath = null;
    editor.setDoc("");
    editorHost.classList.add("is-hidden");
    readingView.element.classList.add("is-hidden");
    emptyTabView.classList.add("is-hidden");
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

  /** Moves per-file in-memory state (mode, folds, scroll) to a new path. */
  function moveFileState(from: string, to: string): void {
    const oldKey = normalizePath(from);
    const newKey = normalizePath(to);
    const mode = fileModes.get(oldKey);
    if (mode !== undefined) {
      fileModes.delete(oldKey);
      fileModes.set(newKey, mode);
    }
    const folds = fileFolds.get(oldKey);
    if (folds !== undefined) {
      fileFolds.delete(oldKey);
      fileFolds.set(newKey, folds);
    }
    const scroll = fileScroll.get(oldKey);
    if (scroll !== undefined) {
      fileScroll.delete(oldKey);
      fileScroll.set(newKey, scroll);
    }
  }

  async function renameFromMenu(path: string): Promise<void> {
    const current = basename(path).replace(/\.md$/i, "");
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
    const target = joinPath(
      dirname(path),
      name.toLowerCase().endsWith(".md") ? name : `${name}.md`,
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
        .setTitle(`${basename(dirname(target))} - ${noteName}`)
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
    fileModes.delete(normalizePath(path));
    fileFolds.delete(normalizePath(path));
    fileScroll.delete(normalizePath(path));
    const tabIndex = findTab(tabsState, path);
    if (tabIndex !== -1) {
      if (openedPath !== null && samePath(path, openedPath)) {
        // The buffer belongs to a deleted file: never save it back.
        autosave.cancel();
        openedPath = null;
      }
      await applyTabsChange(closeTab(tabsState, tabIndex));
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

  function openFileMenu(x: number, y: number, path: string): void {
    const isOpenFile = openedPath !== null && samePath(path, openedPath);
    openContextMenu(x, y, [
      {
        label: t("menu.rename"),
        icon: "pencil",
        onClick: () => void renameFromMenu(path),
      },
      ...(isOpenFile
        ? [
            {
              label: t("menu.addProperty"),
              icon: "plus" as const,
              onClick: () => editor.addProperty(),
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
      {
        label: t("menu.exportPdf"),
        icon: "file-down",
        onClick: () => void exportPdfFromMenu(path),
      },
      "separator",
      {
        label: t("menu.delete"),
        icon: "trash",
        danger: true,
        onClick: () => void deleteFromMenu(path),
      },
    ]);
  }

  /** Opens a folder without a file: welcome view over its file list. */
  async function openFolder(path: string): Promise<void> {
    await stashCurrentTabState();
    tabsState = emptyWorkspace();
    clearWorkspaceView();
    renderTabs();
    scheduleSessionSave();
    setStatusError(null);
    await refreshFolder(path);
    renderBacklinks();
    void getCurrentWindow()
      .setTitle(basename(path))
      .catch(() => undefined);
  }

  async function openFolderFromDialog(): Promise<void> {
    const folder = await openFolderDialog({
      title: t("dialog.openFolder.title"),
    });
    if (folder !== null) {
      await openFolder(folder);
    }
  }

  function openQuickSwitcher(): void {
    openPalette({
      placeholder: t("switcher.placeholder"),
      emptyLabel:
        currentFolder === null ? t("sidebar.noFolder") : t("palette.noResults"),
      items: [
        ...folderFiles.map((file) => ({
          id: file.path,
          label: file.name.replace(/\.md$/i, ""),
        })),
        // Aliases jump to their note; "|" never appears in Windows paths.
        ...folderFiles.flatMap((file) =>
          (file.aliases ?? []).map((alias) => ({
            id: `${file.path}|${alias}`,
            label: `${alias} → ${file.name.replace(/\.md$/i, "")}`,
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
      run: () => {
        editor.foldAllSections();
        editor.focus();
      },
    },
    {
      id: "unfold-all",
      nameKey: "command.unfoldAll",
      run: () => {
        editor.unfoldAllSections();
        editor.focus();
      },
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

  function toggleSidebar(): void {
    sidebarVisible = !sidebarVisible;
    root.classList.toggle("left-collapsed", !sidebarVisible);
  }

  function toggleRightPanel(): void {
    rightVisible = !rightVisible;
    backlinksPanel.classList.toggle("is-hidden", !rightVisible);
    root.classList.toggle("right-collapsed", !rightVisible);
    if (rightVisible) {
      renderRightPanel();
    }
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

  // Right-clicking the editor's empty margins or the line-number gutter
  // opens the view menu; inside the text, the editor's menu applies.
  editorHost.addEventListener("contextmenu", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest(".cm-content") !== null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openViewMenu(event.clientX, event.clientY);
  });

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
    editor.applyConfig(editorConfigFrom(settings));
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
    modeButton.textContent = t(
      currentMode === "edit" ? "statusBar.mode.edit" : "statusBar.mode.read",
    );
    wordCount.textContent = t("statusBar.words", { count: lastWordCount });
    charCount.textContent = t("statusBar.characters", {
      count: lastCharCount,
    });
    welcome.textContent = t("workspace.welcome");
    modeHeaderButton.title = t("command.toggleReadingMode");
    moreButton.title = t("workspace.moreOptions");
    moreButton.setAttribute("aria-label", t("workspace.moreOptions"));
    navBackButton.title = t("nav.back");
    navBackButton.setAttribute("aria-label", t("nav.back"));
    navForwardButton.title = t("nav.forward");
    navForwardButton.setAttribute("aria-label", t("nav.forward"));
    for (const action of emptyTabView.querySelectorAll<HTMLElement>(
      ".empty-tab-action",
    )) {
      if (action.dataset.labelKey !== undefined) {
        action.textContent = t(action.dataset.labelKey);
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
    reloadingFromDisk = true;
    editor.reloadDoc(contents);
    reloadingFromDisk = false;
    setCounts(contents);
    if (currentMode === "read") {
      readingView.render(contents);
    }
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

  // Best-effort save of pending changes when the window closes.
  window.addEventListener("beforeunload", () => {
    autosave.flush();
    void saveSession(snapshotSession());
  });

  setListMessage(t("sidebar.noFolder"));
  setCounts("");
  refreshTexts();
  renderBacklinks();

  // A second app instance forwards its command line here (single
  // instance): open the file in a new tab of this window.
  void listen<string[]>("single-instance", (event) => {
    const file = event.payload.find((arg) =>
      arg.toLowerCase().endsWith(".md"),
    );
    if (file !== undefined) {
      void openFile(file, { newTab: true });
    }
  });

  // Double-clicking an associated .md passes its path on the command
  // line and takes precedence; otherwise the last session is restored
  // (when the setting allows it).
  void (async () => {
    const file = await startupFile();
    if (file !== null) {
      await openFile(file);
      return;
    }
    if (!getSettings().files.restoreSession) {
      return;
    }
    const session = await loadSession();
    if (session === null) {
      return;
    }
    if (session.panels !== null) {
      panelSizes = session.panels;
      applyPanelSizes();
    }
    if (session.rightView !== null) {
      rightView = session.rightView;
      renderRightPanel();
    }
    const tabs: Tab[] = [];
    for (const tab of session.tabs) {
      try {
        await readFile(tab.path);
      } catch {
        continue; // gone since last session
      }
      tabs.push({
        path: tab.path,
        pinned: tab.pinned,
        back: tab.back,
        forward: tab.forward,
      });
      fileModes.set(normalizePath(tab.path), tab.mode);
    }
    if (tabs.length === 0) {
      return;
    }
    tabsState = {
      tabs,
      active: Math.min(session.active, tabs.length - 1),
    };
    const activePath = activeTabPath(tabsState);
    if (activePath !== null) {
      await loadFile(activePath);
    }
  })();
}
