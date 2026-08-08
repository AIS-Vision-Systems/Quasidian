// App shell: sidebar with folder listing, CM6 editor, status bar.
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t } from "../i18n/i18n";
import {
  listFolder,
  openMarkdownFileDialog,
  readFile,
  startupFile,
  watchFolder,
  writeFile,
} from "../ipc/fs";
import { createEditor } from "../editor/editor";
import { createAutosaveScheduler } from "../editor/autosave";
import { createBacklinkIndex } from "../lib/backlinkIndex";
import { createSearchIndex, type SearchMatch } from "../lib/searchIndex";
import { basename, dirname, normalizePath, samePath } from "../lib/paths";
import type { EditorModeSetting } from "../lib/settings";
import { countWords } from "../lib/text";
import { resolveWikilink, type FolderFile } from "../lib/wikilinks";
import { renderToHtml } from "../markdown/render";
import { isImageTarget } from "../markdown/wikilinks";
import { getSettings, subscribeSettings } from "../ipc/settingsStore";
import { editorConfigFrom } from "./applySettings";
import { commandPaletteItems, type Command } from "./commands";
import { openPalette } from "./palette";
import { createReadingView } from "./readingView";
import { openSettingsModal } from "./settingsModal";

export function mountLayout(root: HTMLElement): void {
  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";

  const sidebarFiles = document.createElement("div");
  sidebarFiles.className = "sidebar-view";

  const openButton = document.createElement("button");
  openButton.className = "sidebar-open-button";
  openButton.textContent = t("sidebar.openFile");
  sidebarFiles.append(openButton);

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
  searchClose.textContent = "×";
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

  const settingsButton = document.createElement("button");
  settingsButton.className = "sidebar-settings-button";
  settingsButton.textContent = "⚙";
  settingsButton.title = t("settings.title");
  settingsButton.setAttribute("aria-label", t("settings.title"));
  settingsButton.addEventListener("click", () => openSettingsModal());
  sidebar.append(settingsButton);

  const workspace = document.createElement("main");
  workspace.className = "workspace";

  const viewHeader = document.createElement("div");
  viewHeader.className = "view-header";
  const viewTitle = document.createElement("span");
  viewTitle.className = "view-title";
  const headerActions = document.createElement("div");
  headerActions.className = "view-header-actions";
  const modeHeaderButton = document.createElement("button");
  modeHeaderButton.className = "view-header-button";
  modeHeaderButton.textContent = "📖";
  modeHeaderButton.title = t("command.toggleReadingMode");
  modeHeaderButton.addEventListener("click", () => void toggleMode());
  const backlinksHeaderButton = document.createElement("button");
  backlinksHeaderButton.className = "view-header-button";
  backlinksHeaderButton.textContent = "🔗";
  backlinksHeaderButton.title = t("command.toggleBacklinks");
  backlinksHeaderButton.addEventListener("click", () => toggleBacklinksPanel());
  headerActions.append(modeHeaderButton, backlinksHeaderButton);
  viewHeader.append(viewTitle, headerActions);

  const workspaceBody = document.createElement("div");
  workspaceBody.className = "workspace-body";

  const welcome = document.createElement("div");
  welcome.className = "workspace-welcome";
  welcome.textContent = t("workspace.welcome");

  const editorHost = document.createElement("div");
  editorHost.className = "editor-host is-hidden";

  workspaceBody.append(welcome, editorHost);
  workspace.append(viewHeader, workspaceBody);

  const backlinksPanel = document.createElement("aside");
  backlinksPanel.className = "backlinks-panel";
  const backlinksHeader = document.createElement("div");
  backlinksHeader.className = "backlinks-header";
  const backlinksTitle = document.createElement("span");
  backlinksTitle.textContent = t("backlinks.title");
  const backlinksCount = document.createElement("span");
  backlinksCount.className = "backlinks-count";
  backlinksHeader.append(backlinksTitle, backlinksCount);
  const backlinksList = document.createElement("ul");
  backlinksList.className = "backlinks-list";
  backlinksPanel.append(backlinksHeader, backlinksList);

  const statusBar = document.createElement("footer");
  statusBar.className = "status-bar";
  const statusError = document.createElement("span");
  statusError.className = "status-bar-error";
  const wordCount = document.createElement("span");
  const modeButton = document.createElement("button");
  modeButton.className = "status-bar-mode";
  modeButton.textContent = t("statusBar.mode.edit");
  modeButton.addEventListener("click", () => void toggleMode());
  statusBar.append(statusError, wordCount, modeButton);

  root.append(sidebar, workspace, backlinksPanel, statusBar);

  let openedPath: string | null = null;
  let currentFolder: string | null = null;
  let folderFiles: FolderFile[] = [];
  let folderImages: FolderFile[] = [];
  let lastWordCount = 0;
  let watchedFolder: string | null = null;
  let backlinksVisible = true;
  let reloadingFromDisk = false;
  let searchVisible = false;
  const backlinkIndex = createBacklinkIndex();
  const searchIndex = createSearchIndex();

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

  async function renderEmbedNote(target: string): Promise<string | null> {
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
    try {
      return renderToHtml(await readFile(resolution.path));
    } catch {
      return null;
    }
  }

  const editor = createEditor(editorHost, {
    onDocChanged(doc) {
      setWordCount(countWords(doc));
      if (openedPath !== null && !reloadingFromDisk) {
        autosave.notifyChange();
      }
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
    resolveEmbedSrc,
    renderEmbedNote,
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
    resolveEmbedSrc,
    renderEmbedNote,
  });
  workspaceBody.append(readingView.element);

  const fileModes = new Map<string, EditorModeSetting>();
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
    modeHeaderButton.textContent = editing ? "📖" : "✎";
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

  function setWordCount(count: number): void {
    lastWordCount = count;
    wordCount.textContent = t("statusBar.words", { count });
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
      renderBacklinks();
      if (searchVisible) {
        runSearch();
      }
    } catch (error) {
      setStatusError(t("error.writeFile", { error: String(error) }));
    }
  }

  function renderBacklinks(): void {
    if (openedPath === null || currentFolder === null) {
      backlinksCount.textContent = "";
      const empty = document.createElement("li");
      empty.className = "backlinks-empty";
      empty.textContent = t("backlinks.empty");
      backlinksList.replaceChildren(empty);
      return;
    }
    const links = backlinkIndex.backlinksOf(
      openedPath,
      currentFolder,
      folderFiles,
      getSettings().files.defaultExtension,
    );
    backlinksCount.textContent = String(links.length);
    if (links.length === 0) {
      const empty = document.createElement("li");
      empty.className = "backlinks-empty";
      empty.textContent = t("backlinks.empty");
      backlinksList.replaceChildren(empty);
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

  async function rebuildIndex(): Promise<void> {
    backlinkIndex.clear();
    searchIndex.clear();
    const files = [...folderFiles];
    await Promise.all(
      files.map(async (file) => {
        try {
          const contents = await readFile(file.path);
          backlinkIndex.setFile(file.path, contents);
          searchIndex.setFile(file.path, contents);
        } catch {
          // Deleted or unreadable mid-scan; the watcher will retrigger.
        }
      }),
    );
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
        return item;
      }),
    );
  }

  async function openWikilink(target: string): Promise<void> {
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
  }

  async function openFile(path: string): Promise<void> {
    if (openedPath !== null && samePath(path, openedPath)) {
      return;
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
    viewTitle.textContent = basename(path).replace(/\.md$/i, "");
    // The folder state must exist before setDoc: embed widgets resolve
    // their sources against it while building decorations.
    await refreshFolder(dirname(path));
    try {
      editor.setDoc(contents);
      setWordCount(countWords(contents));
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

  function openQuickSwitcher(): void {
    openPalette({
      placeholder: t("switcher.placeholder"),
      emptyLabel:
        currentFolder === null ? t("sidebar.noFolder") : t("palette.noResults"),
      items: folderFiles.map((file) => ({
        id: file.path,
        label: file.name.replace(/\.md$/i, ""),
      })),
      onSelect(item) {
        void openFile(item.id);
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
      id: "toggle-backlinks",
      nameKey: "command.toggleBacklinks",
      run: toggleBacklinksPanel,
    },
    {
      id: "global-search",
      nameKey: "command.globalSearch",
      hotkey: "Ctrl+Shift+F",
      run: openSearch,
    },
  ];

  function toggleBacklinksPanel(): void {
    backlinksVisible = !backlinksVisible;
    backlinksPanel.classList.toggle("is-hidden", !backlinksVisible);
    if (backlinksVisible) {
      renderBacklinks();
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

  openButton.addEventListener("click", () => void openFileFromDialog());

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

  window.addEventListener("keydown", (event) => {
    // Already consumed (e.g. the editor keymap handled Ctrl+E): acting
    // again here would toggle twice and look like a no-op.
    if (event.defaultPrevented) {
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
    editor.applyConfig(editorConfigFrom(settings));
    refreshTexts();
  });

  function refreshTexts(): void {
    openButton.textContent = t("sidebar.openFile");
    settingsButton.title = t("settings.title");
    settingsButton.setAttribute("aria-label", t("settings.title"));
    modeButton.textContent = t(
      currentMode === "edit" ? "statusBar.mode.edit" : "statusBar.mode.read",
    );
    wordCount.textContent = t("statusBar.words", { count: lastWordCount });
    welcome.textContent = t("workspace.welcome");
    modeHeaderButton.title = t("command.toggleReadingMode");
    backlinksHeaderButton.title = t("command.toggleBacklinks");
    backlinksTitle.textContent = t("backlinks.title");
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
    setWordCount(countWords(contents));
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
  setWordCount(0);
  renderBacklinks();

  // Double-clicking an associated .md passes its path on the command line.
  void (async () => {
    const file = await startupFile();
    if (file !== null) {
      await openFile(file);
    }
  })();
}
