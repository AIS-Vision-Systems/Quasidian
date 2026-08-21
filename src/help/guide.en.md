# User guide

## Folders and files

Quasidian has no vaults and no configuration: **the folder of the open file is your workspace**. Open a folder or a `.md` file with the sidebar buttons; the list shows the folder's notes (no subfolders). Links, backlinks and search resolve inside that folder.

If the folder — or an ancestor — holds a project marker (`CLAUDE.md`, `.claude`, `AGENTS.md`, `.codex`, `.obsidian` or `.git`, even as a file), that folder becomes the root of a **recursive vault**: the tree shows subfolders, and links, backlinks and search span the whole project. Hidden folders (starting with a dot) are not scanned by default; the marker still works. Turn on "Show hidden folders" in the settings to include them.

- **Global search**: `Ctrl+Shift+F` or the sidebar magnifier.
- **Quick switcher**: `Ctrl+O` — jump to any note by name or by its aliases.
- **Command palette**: `Ctrl+P` — every available action.
- Right-click a file: rename (incoming links repoint themselves), make a copy (`Name 1.md`…), move it to another vault folder (path links repoint), copy the path, open it with the default app, show in the system explorer, export to PDF or delete.

## Editing and reading modes

`Ctrl+E` toggles between **editing** (Live Preview: syntax hides away from the active line) and **reading** (rendered HTML, only task checkboxes stay interactive). The book button in the file bar does the same. The pane's three-dots menu also switches the mode and folds or unfolds all headings, in both modes. Within editing mode, **source mode** (in the same menu or from the palette) shows all syntax as plain highlighted text, per tab.

## Links and transclusions

- `[[note]]` links a note; `[[note|alias]]` shows different text; `[[note#section]]` jumps to a heading.
- Clicking a link opens it (or **creates the note** when it does not exist). `Ctrl+click` or middle-click: new tab.
- From the context menu, "Insert ▸ Wikilink" types `[[]]` and opens the note autocomplete.
- **Preview**: hover a link in reading mode (or `Ctrl`+hover while editing) to see its content in a popup.
- `![[note]]` embeds another note's content (also `![[note#section]]` and images `![[image.png|500]]`).

## Properties

A `---` block at the top of the note holds its properties (tags, aliases…), always edited through the widget: add, remove or change values with its controls. **Aliases** work in the switcher and in wikilinks; **tags** are searchable.

## Formatting

- `Ctrl+B` bold, `Ctrl+I` italic; also `==highlight==`, `~~strikethrough~~`, `` `code` `` and `$formula$` (KaTeX).
- **Lists**: `- ` or `1. ` start a list; `Tab`/`Shift+Tab` change the level (numbered lists renumber themselves); `- [ ]` creates a task.
- **Tables**: insert them from the context menu ("Insert ▸ Table"). They are always edited cell by cell: `Tab`/arrows to move, `Enter` to go down, drag the handles to move rows and columns, right-click for the full menu.
- **Callouts**: `> [!note] Title` creates a colored box (`warning`, `tip`, `check`, `danger`…). With `[!note]-` it starts collapsed; the chevron toggles it.
- **Footnotes**: `[^1]` with its definition `[^1]: text`, or inline with `^[text]`. Reading mode collects them at the bottom; hovering shows their content.

## Tabs

- Navigating reuses the active tab; `Ctrl+click` opens a new one.
- `Ctrl+W` closes; `Ctrl+Tab` / `Ctrl+Shift+Tab` cycles; drag to reorder.
- Right-click: close others, close all, or **pin** (a pinned tab is never reused).
- On startup the app restores the previous session (tabs, modes and window) — configurable in settings.

## Export to PDF

In the file menu (right-click or the three-dots button): "Export to PDF". The note prints exactly as reading mode shows it, on a white background with the note name as the title.

## Main shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+P` | Command palette |
| `Ctrl+O` | Quick switcher |
| `Ctrl+E` | Edit/reading mode |
| `Ctrl+S` | Save the note |
| `Ctrl+Shift+F` | Global search |
| `Ctrl+B` / `Ctrl+I` | Bold / italic |
| `Ctrl+W` | Close tab |
| `Ctrl+Tab` | Next tab |
| `Ctrl+,` | Settings |
