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
import { renderToHtml } from "../markdown/render";
import { isImageTarget } from "../markdown/wikilinks";
import { getSettings, subscribeSettings } from "../ipc/settingsStore";
import { editorConfigFrom } from "./applySettings";
import { commandPaletteItems, type Command } from "./commands";
import { openContextMenu, openPromptModal } from "./contextMenu";
import { hideHoverPreview } from "./hoverPreview";
import { createIcon } from "./icons";
import { copyText } from "./renderedContent";
import { openPalette } from "./palette";
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

  // Center top bar: collapse left, centered file name, mode, collapse right.
  const viewHeader = document.createElement("div");
  viewHeader.className = "view-header";
  const collapseLeftButton = document.createElement("button");
  collapseLeftButton.className = "view-header-button";
  collapseLeftButton.append(createIcon("panel-left"));
  collapseLeftButton.addEventListener("click", () => toggleSidebar());
  const viewTitle = document.createElement("span");
  viewTitle.className = "view-title";
  const headerActions = document.createElement("div");
  headerActions.className = "view-header-actions";
  const modeHeaderButton = document.createElement("button");
  modeHeaderButton.className = "view-header-button";
  modeHeaderButton.append(createIcon("book-open"));
  modeHeaderButton.title = t("command.toggleReadingMode");
  modeHeaderButton.addEventListener("click", () => void toggleMode());
  const collapseRightButton = document.createElement("button");
  collapseRightButton.className = "view-header-button";
  collapseRightButton.append(createIcon("panel-right"));
  collapseRightButton.addEventListener("click", () => toggleRightPanel());
  headerActions.append(modeHeaderButton, collapseRightButton);
  viewTitle.addEventListener("contextmenu", (event) => {
    if (openedPath !== null) {
      event.preventDefault();
      openFileMenu(event.clientX, event.clientY, openedPath);
    }
  });
  viewHeader.append(collapseLeftButton, viewTitle, headerActions);

  const workspaceBody = document.createElement("div");
  workspaceBody.className = "workspace-body";

  const welcome = document.createElement("div");
  welcome.className = "workspace-welcome";
  welcome.textContent = t("workspace.welcome");

  const editorHost = document.createElement("div");
  editorHost.className = "editor-host is-hidden";

  workspaceBody.append(welcome, editorHost);
  workspace.append(viewHeader, workspaceBody);

  // Right panel: one list, three views (backlinks, outgoing, outline).
  type RightView = "backlinks" | "outgoing" | "outline";
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
    statusPalette,
    statusSwitcher,
    statusError,
    statusBacklinks,
    wordCount,
    charCount,
    modeButton,
  );

  root.append(sidebar, workspace, backlinksPanel, statusBar);

  let openedPath: string | null = null;
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
    onWikilinkClick(target) {
      void openWikilink(target);
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
    onInternalLink(target) {
      void openWikilink(target);
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
  });
  workspaceBody.append(readingView.element);

  const fileModes = new Map<string, EditorModeSetting>();
  // Fold state per file, in memory only (never written to the folder).
  const fileFolds = new Map<string, { from: number; to: number }[]>();
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
        item.addEventListener("click", () => void openFile(path));
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
        item.addEventListener("click", () => void openWikilink(target));
        return item;
      }),
    );
  }

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
    backlinksList.replaceChildren(
      ...items.map((heading) => {
        const item = document.createElement("li");
        item.className = "file-item outline-item";
        item.style.paddingLeft = `${(heading.level - 1) * 14 + 8}px`;
        item.textContent = heading.text;
        item.addEventListener("click", () => {
          if (currentMode === "edit") {
            editor.revealRange(heading.from, heading.from);
          } else {
            // The reading view has no position mapping; approximate.
            setScrollFraction(
              readingView.element,
              heading.from / Math.max(1, doc.length),
            );
          }
        });
        return item;
      }),
    );
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

  function matchSnippet(match: SearchMatch, onClick: () => void): HTMLElement {
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
        fileName.addEventListener("click", () => void openFile(result.path));
        const matches = document.createElement("ul");
        matches.className = "search-matches";
        matches.append(
          ...result.matches.map((match) =>
            matchSnippet(match, () => void openFileAt(result.path, match)),
          ),
        );
        fileItem.append(fileName, matches);
        return fileItem;
      }),
    );
  }

  async function openFileAt(path: string, match: SearchMatch): Promise<void> {
    await openFile(path);
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
        item.addEventListener("click", () => void openFile(entry.path));
        item.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          openFileMenu(event.clientX, event.clientY, entry.path);
        });
        return item;
      }),
    );
  }

  async function openWikilink(target: string): Promise<void> {
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
    await openFile(resolution.path);
    if (anchor !== null) {
      revealAnchor(anchor);
    }
  }

  async function openFile(path: string): Promise<void> {
    hideHoverPreview();
    if (openedPath !== null && samePath(path, openedPath)) {
      return;
    }
    if (openedPath !== null) {
      fileFolds.set(normalizePath(openedPath), editor.getFolds());
    }
    if (openedPath !== null && autosave.isDirty()) {
      await saveNow();
    }
    let contents;
    try {
      contents = await readFile(path);
    } catch (error) {
      setStatusError(t("error.readFile", { error: String(error) }));
      return;
    }
    openedPath = path;
    setStatusError(null);
    welcome.remove();
    const noteName = basename(path).replace(/\.md$/i, "");
    viewTitle.textContent = noteName;
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
      if (mode === "edit") {
        editor.focus();
      }
    } catch (error) {
      // A rendering failure must never leave the view half-open.
      setStatusError(t("error.openFile", { error: String(error) }));
    }
    renderBacklinks();
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

  /** Clears the workspace to the welcome view (delete, folder open). */
  function closeCurrentFile(): void {
    autosave.cancel();
    openedPath = null;
    editor.setDoc("");
    editorHost.classList.add("is-hidden");
    readingView.element.classList.add("is-hidden");
    if (!welcome.isConnected) {
      workspaceBody.prepend(welcome);
    }
    viewTitle.textContent = "";
    setCounts("");
  }

  /** Moves per-file in-memory state (mode, folds) to a renamed path. */
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
    }
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
    if (openedPath !== null && samePath(path, openedPath)) {
      closeCurrentFile();
    }
    if (currentFolder !== null) {
      await refreshFolder(currentFolder);
      await rebuildIndex();
    }
    renderBacklinks();
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
    if (openedPath !== null) {
      fileFolds.set(normalizePath(openedPath), editor.getFolds());
    }
    if (openedPath !== null && autosave.isDirty()) {
      await saveNow();
    }
    closeCurrentFile();
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
  ];

  function toggleSidebar(): void {
    sidebarVisible = !sidebarVisible;
    root.classList.toggle("left-collapsed", !sidebarVisible);
  }

  function toggleRightPanel(): void {
    rightVisible = !rightVisible;
    backlinksPanel.classList.toggle("is-hidden", !rightVisible);
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
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "o") {
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
    editor.applyConfig(editorConfigFrom(settings));
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
  });

  setListMessage(t("sidebar.noFolder"));
  setCounts("");
  refreshTexts();
  renderBacklinks();

  // Double-clicking an associated .md passes its path on the command line.
  void (async () => {
    const file = await startupFile();
    if (file !== null) {
      await openFile(file);
    }
  })();
}
