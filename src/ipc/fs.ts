// Typed wrappers around the Rust filesystem commands and the dialog plugin.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export function readFile(path: string): Promise<string> {
  return invoke("read_file", { path });
}

export function writeFile(path: string, contents: string): Promise<void> {
  return invoke("write_file", { path, contents });
}

export function writeFileAtomic(path: string, contents: string): Promise<void> {
  return invoke("write_file_atomic", { path, contents });
}

export function ensureDir(path: string): Promise<void> {
  return invoke("ensure_dir", { path });
}

export function listFolder(path: string): Promise<FileEntry[]> {
  return invoke("list_folder", { path });
}

/** Watches `path` (non-recursive); replaces any previously watched folder. */
export function watchFolder(path: string): Promise<void> {
  return invoke("watch_folder", { path });
}

/** File passed on the command line at launch, if any. */
export function startupFile(): Promise<string | null> {
  return invoke("startup_file");
}

export function openMarkdownFileDialog(options: {
  title: string;
  filterName: string;
}): Promise<string | null> {
  return open({
    title: options.title,
    multiple: false,
    directory: false,
    filters: [{ name: options.filterName, extensions: ["md"] }],
  });
}
