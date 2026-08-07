// App shell: sidebar with folder listing, CM6 editor, status bar.
import { t } from "../i18n/i18n";
import { listFolder, openMarkdownFileDialog, readFile, writeFile } from "../ipc/fs";
import { createEditor } from "../editor/editor";
import { createAutosaveScheduler } from "../editor/autosave";
import { dirname } from "../lib/paths";
import { countWords } from "../lib/text";

// Autosave defaults; wired to the settings module in milestone 6.
const AUTOSAVE_ENABLED = true;
const AUTOSAVE_INTERVAL_MS = 2000;

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
  const mode = document.createElement("span");
  mode.textContent = t("statusBar.mode.edit");
  statusBar.append(statusError, wordCount, mode);

  root.append(sidebar, workspace, statusBar);

  let openedPath: string | null = null;

  const autosave = createAutosaveScheduler(() => void saveNow(), {
    enabled: AUTOSAVE_ENABLED,
    intervalMs: AUTOSAVE_INTERVAL_MS,
  });

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
  });

  function setWordCount(count: number): void {
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
    if (markdownFiles.length === 0) {
      setListMessage(t("sidebar.emptyFolder"));
      return;
    }
    fileList.replaceChildren(
      ...markdownFiles.map((entry) => {
        const item = document.createElement("li");
        item.className = "file-item";
        item.classList.toggle("is-active", entry.path === openedPath);
        item.textContent = entry.name.replace(/\.md$/i, "");
        item.addEventListener("click", () => void openFile(entry.path));
        return item;
      }),
    );
  }

  async function openFile(path: string): Promise<void> {
    if (path === openedPath) {
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
    editorHost.classList.remove("is-hidden");
    editor.setDoc(contents);
    setWordCount(countWords(contents));
    editor.focus();
    await refreshFolder(dirname(path));
  }

  openButton.addEventListener("click", async () => {
    const path = await openMarkdownFileDialog({
      title: t("dialog.openFile.title"),
      filterName: t("dialog.openFile.markdownFilter"),
    });
    if (path !== null) {
      await openFile(path);
    }
  });

  // Best-effort save of pending changes when the window closes.
  window.addEventListener("beforeunload", () => {
    autosave.flush();
  });

  setListMessage(t("sidebar.noFolder"));
  setWordCount(0);
}
