// App shell: sidebar with folder listing, CM6 editor, status bar.
import { t } from "../i18n/i18n";
import { listFolder, openMarkdownFileDialog, readFile, writeFile } from "../ipc/fs";
import { createEditor } from "../editor/editor";
import { createAutosaveScheduler } from "../editor/autosave";
import { dirname, normalizePath, samePath } from "../lib/paths";
import type { EditorModeSetting } from "../lib/settings";
import { countWords } from "../lib/text";
import { resolveWikilink, type FolderFile } from "../lib/wikilinks";
import { getSettings, subscribeSettings } from "../ipc/settingsStore";
import { editorConfigFrom } from "./applySettings";
import { commandPaletteItems, type Command } from "./commands";
import { openPalette } from "./palette";
import { createReadingView } from "./readingView";
import { openSettingsModal } from "./settingsModal";

export function mountLayout(root: HTMLElement): void {
  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";

  const openButton = document.createElement("button");
  openButton.className = "sidebar-open-button";
  openButton.textContent = t("sidebar.openFile");
  sidebar.append(openButton);

  const fileList = document.createElement("ul");
  fileList.className = "file-list";
  sidebar.append(fileList);

  const settingsButton = document.createElement("button");
  settingsButton.className = "sidebar-settings-button";
  settingsButton.textContent = "⚙";
  settingsButton.title = t("settings.title");
  settingsButton.setAttribute("aria-label", t("settings.title"));
  settingsButton.addEventListener("click", () => openSettingsModal());
  sidebar.append(settingsButton);

  const workspace = document.createElement("main");
  workspace.className = "workspace";

  const welcome = document.createElement("div");
  welcome.className = "workspace-welcome";
  welcome.textContent = t("workspace.welcome");

  const editorHost = document.createElement("div");
  editorHost.className = "editor-host is-hidden";

  workspace.append(welcome, editorHost);

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

  root.append(sidebar, workspace, statusBar);

  let openedPath: string | null = null;
  let currentFolder: string | null = null;
  let folderFiles: FolderFile[] = [];
  let lastWordCount = 0;

  // Shared mutable options: the scheduler reads them on every change, so
  // settings updates apply on the next keystroke.
  const autosaveOptions = {
    enabled: getSettings().editor.autosave,
    intervalMs: getSettings().editor.autosaveIntervalMs,
  };
  const autosave = createAutosaveScheduler(() => void saveNow(), autosaveOptions);

  const editor = createEditor(editorHost, {
    onDocChanged(doc) {
      setWordCount(countWords(doc));
      if (openedPath !== null) {
        autosave.notifyChange();
      }
    },
    onSaveRequested() {
      void saveNow();
    },
    onWikilinkClick(target) {
      void openWikilink(target);
    },
    getWikilinkCompletions() {
      return folderFiles.map((file) => file.name.replace(/\.md$/i, ""));
    },
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
  });
  workspace.append(readingView.element);

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
    } catch (error) {
      setStatusError(t("error.writeFile", { error: String(error) }));
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
    await refreshFolder(dirname(path));
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
  ];

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

  window.addEventListener("keydown", (event) => {
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
    if (currentFolder === null) {
      setListMessage(t("sidebar.noFolder"));
    } else if (folderFiles.length === 0) {
      setListMessage(t("sidebar.emptyFolder"));
    }
  }

  // Best-effort save of pending changes when the window closes.
  window.addEventListener("beforeunload", () => {
    autosave.flush();
  });

  setListMessage(t("sidebar.noFolder"));
  setWordCount(0);
}
