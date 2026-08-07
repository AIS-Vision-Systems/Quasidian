// App shell: sidebar with folder listing, main area, status bar.
// The file view is a plain <pre> placeholder until the CodeMirror editor
// lands in milestone 2.
import { t } from "../i18n/i18n";
import { listFolder, openMarkdownFileDialog, readFile } from "../ipc/fs";

function dirname(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator === -1 ? path : path.slice(0, separator);
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

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

  const statusBar = document.createElement("footer");
  statusBar.className = "status-bar";
  const wordCount = document.createElement("span");
  const mode = document.createElement("span");
  mode.textContent = t("statusBar.mode.edit");
  statusBar.append(wordCount, mode);

  root.append(sidebar, workspace, statusBar);

  let activePath: string | null = null;

  function setWorkspaceMessage(message: string): void {
    const welcome = document.createElement("div");
    welcome.className = "workspace-welcome";
    welcome.textContent = message;
    workspace.replaceChildren(welcome);
  }

  function setWordCount(count: number): void {
    wordCount.textContent = t("statusBar.words", { count });
  }

  function setListMessage(message: string): void {
    const empty = document.createElement("li");
    empty.className = "file-list-empty";
    empty.textContent = message;
    fileList.replaceChildren(empty);
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
        item.classList.toggle("is-active", entry.path === activePath);
        item.textContent = entry.name.replace(/\.md$/i, "");
        item.addEventListener("click", () => void openFile(entry.path));
        return item;
      }),
    );
  }

  async function openFile(path: string): Promise<void> {
    let contents;
    try {
      contents = await readFile(path);
    } catch (error) {
      setWorkspaceMessage(t("error.readFile", { error: String(error) }));
      return;
    }
    activePath = path;
    const view = document.createElement("pre");
    view.className = "file-view";
    view.textContent = contents;
    workspace.replaceChildren(view);
    setWordCount(countWords(contents));
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

  setListMessage(t("sidebar.noFolder"));
  setWorkspaceMessage(t("workspace.welcome"));
  setWordCount(0);
}
