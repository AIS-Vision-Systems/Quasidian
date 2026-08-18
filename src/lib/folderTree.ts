// Pure module: no Tauri, no DOM. Builds the collapsible sidebar tree of
// a recursive vault from the flat entry list produced by the scan.
import { basename, normalizePath } from "./paths";

export interface TreeEntry {
  /** Full path as reported by the filesystem. */
  path: string;
  isDir: boolean;
}

export interface TreeNode {
  /** Basename shown in the sidebar. */
  name: string;
  path: string;
  isDir: boolean;
  /** Sorted: folders first, then files, both alphabetically. */
  children: TreeNode[];
}

/** Path of `path` relative to `root` ("" when equal). */
export function relativePath(root: string, path: string): string {
  const rootKey = normalizePath(root).toLowerCase();
  const key = normalizePath(path);
  if (key.toLowerCase() === rootKey) {
    return "";
  }
  if (key.toLowerCase().startsWith(rootKey + "/")) {
    return key.slice(rootKey.length + 1);
  }
  return key;
}

function sortChildren(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    sortChildren(node.children);
  }
}

/**
 * Paths of the folders whose subtree holds no file at all — since the
 * tree is built from managed entries only (.md and images), these are
 * the noise branches (code, assets…) that should start collapsed when
 * a vault opens without a remembered fold state.
 */
export function collapsedByDefault(nodes: TreeNode[]): string[] {
  const collapsed: string[] = [];
  const hasFiles = (node: TreeNode): boolean => {
    if (!node.isDir) {
      return true;
    }
    let found = false;
    for (const child of node.children) {
      if (hasFiles(child)) {
        found = true;
      }
    }
    if (!found) {
      collapsed.push(node.path);
    }
    return found;
  };
  for (const node of nodes) {
    hasFiles(node);
  }
  return collapsed;
}

/**
 * Nests `entries` (any order) under their parent folders relative to
 * `root`. Entries outside `root` are ignored; missing intermediate
 * folders are created implicitly.
 */
export function buildFolderTree(
  root: string,
  entries: TreeEntry[],
): TreeNode[] {
  const rootNode: TreeNode = { name: "", path: root, isDir: true, children: [] };
  const dirs = new Map<string, TreeNode>([["", rootNode]]);
  const ensureDir = (rel: string): TreeNode => {
    const existing = dirs.get(rel.toLowerCase());
    if (existing !== undefined) {
      return existing;
    }
    const slash = rel.lastIndexOf("/");
    const parent = ensureDir(slash === -1 ? "" : rel.slice(0, slash));
    const node: TreeNode = {
      name: rel.slice(slash + 1),
      path: `${normalizePath(root)}/${rel}`,
      isDir: true,
      children: [],
    };
    parent.children.push(node);
    dirs.set(rel.toLowerCase(), node);
    return node;
  };
  const rootKey = normalizePath(root).toLowerCase();
  for (const entry of entries) {
    const norm = normalizePath(entry.path);
    if (!norm.toLowerCase().startsWith(rootKey + "/")) {
      continue; // the root itself, or a path outside it
    }
    const rel = norm.slice(rootKey.length + 1);
    if (entry.isDir) {
      ensureDir(rel);
    } else {
      const slash = rel.lastIndexOf("/");
      const parent = ensureDir(slash === -1 ? "" : rel.slice(0, slash));
      parent.children.push({
        name: basename(entry.path),
        path: entry.path,
        isDir: false,
        children: [],
      });
    }
  }
  sortChildren(rootNode.children);
  return rootNode.children;
}
