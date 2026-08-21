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

/** Fails if the destination already exists. */
export function renameFile(from: string, to: string): Promise<void> {
  return invoke("rename_file", { from, to });
}

/** Byte-for-byte copy (binaries stay intact); never overwrites. */
export function copyFile(from: string, to: string): Promise<void> {
  return invoke("copy_file", { from, to });
}

export function deleteFile(path: string): Promise<void> {
  return invoke("delete_file", { path });
}

export function listFolder(path: string): Promise<FileEntry[]> {
  return invoke("list_folder", { path });
}

/**
 * Watches `path`, replacing any previously watched folder; `recursive`
 * covers the whole subtree (vault modes).
 */
export function watchFolder(path: string, recursive = false): Promise<void> {
  return invoke("watch_folder", { path, recursive });
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

export function openFolderDialog(options: {
  title: string;
}): Promise<string | null> {
  return open({ title: options.title, multiple: false, directory: true });
}
