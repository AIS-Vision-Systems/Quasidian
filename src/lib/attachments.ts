// Pure module: no Tauri, no DOM. The decisions behind inserting a file
// into a note by paste or by drag and drop (m51): which files are
// admitted, what a pasted image is called, and how the embed that
// points at the file is written.
import { isImageTarget } from "@aisvision/quasidian-core";
import { relativePath } from "./folderTree";
import { basename, copyName, joinPath, normalizePath, samePath } from "./paths";
import { resolveWikilink, type FolderFile } from "./wikilinks";

/** Notes and images: the files a note can embed with `![[…]]`. */
export function isAdmittedFile(name: string): boolean {
  return /\.md$/i.test(name.trim()) || isImageTarget(name);
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
};

/** File extension (with its dot) for an admitted image type, or null. */
export function extensionForMime(mime: string): string | null {
  return MIME_EXTENSIONS[mime.trim().toLowerCase()] ?? null;
}

/**
 * Whether a clipboard file carries no name of its own: a screenshot or
 * a copied bitmap arrives as "image.png", not as a file the user named.
 */
export function isGenericClipboardName(name: string): boolean {
  return name.trim() === "" || /^image\.[a-z0-9]+$/i.test(name.trim());
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Name for a pasted image: `base` (a translated label) followed by the
 * local date and time down to the second, so names sort by the moment
 * they were pasted — "Imatge enganxada 20261004153012.png".
 */
export function pastedImageName(
  base: string,
  date: Date,
  extension: string,
): string {
  const stamp =
    String(date.getFullYear()) +
    two(date.getMonth() + 1) +
    two(date.getDate()) +
    two(date.getHours()) +
    two(date.getMinutes()) +
    two(date.getSeconds());
  return `${base} ${stamp}${extension}`;
}

/**
 * `name` when it is free, the first free "name 1", "name 2"… otherwise:
 * an inserted file never overwrites another one.
 */
export function uniqueName(
  name: string,
  taken: (candidate: string) => boolean,
): string {
  return taken(name) ? copyName(name, taken) : name;
}

/**
 * Whether a file called `candidate` in `dir` would collide with one of
 * `paths`. Case-insensitive on purpose: Windows treats "Foto.png" and
 * "foto.png" as one file, and on a case-sensitive system steering clear
 * of the pair costs nothing.
 */
export function nameTakenIn(
  dir: string,
  candidate: string,
  paths: string[],
): boolean {
  const key = normalizePath(joinPath(dir, candidate)).toLowerCase();
  return paths.some((path) => normalizePath(path).toLowerCase() === key);
}

/**
 * A drop position as the system reports it, in physical pixels, to the
 * CSS pixels the page measures in.
 */
export function toClientPoint(
  position: { x: number; y: number },
  scale: number,
): { x: number; y: number } {
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return { x: position.x / factor, y: position.y / factor };
}

/**
 * The wikilink target that embeds `path`: its bare name (a note
 * without ".md", an image with its extension) whenever that name
 * resolves to this very file; otherwise its path relative to `folder`,
 * because another file answers to the bare name first.
 */
export function embedTargetFor(
  path: string,
  folder: string,
  files: FolderFile[],
  defaultExtension: string,
): string {
  const bare = basename(path).replace(/\.md$/i, "");
  const resolution = resolveWikilink(bare, folder, files, defaultExtension);
  if (
    resolution !== null &&
    resolution.exists &&
    samePath(resolution.path, path)
  ) {
    return bare;
  }
  return relativePath(folder, path).replace(/\.md$/i, "");
}

/** The embeds for `targets`, one per line. */
export function embedText(targets: string[]): string {
  return targets.map((target) => `![[${target}]]`).join("\n");
}
