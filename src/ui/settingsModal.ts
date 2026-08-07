// Obsidian-style settings modal: section list on the left, option rows on
// the right. Every change goes through updateSettings, which notifies the
// hot-appliers and persists atomically.
import { t } from "../i18n/i18n";
import {
  getSettings,
  subscribeSettings,
  updateSettings,
} from "../ipc/settingsStore";
import type { Settings } from "../lib/settings";

type SectionId = "general" | "appearance" | "editor" | "files";

const SECTIONS: ReadonlyArray<{ id: SectionId; labelKey: string }> = [
  { id: "general", labelKey: "settings.section.general" },
  { id: "appearance", labelKey: "settings.section.appearance" },
  { id: "editor", labelKey: "settings.section.editor" },
  { id: "files", labelKey: "settings.section.files" },
];

let activeClose: (() => void) | null = null;

export function closeSettingsModal(): void {
  activeClose?.();
}

export function openSettingsModal(): void {
  activeClose?.();

  let activeSection: SectionId = "general";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const modal = document.createElement("div");
  modal.className = "settings-modal";
  const sidebar = document.createElement("nav");
  sidebar.className = "settings-sidebar";
  const content = document.createElement("div");
  content.className = "settings-content";
  modal.append(sidebar, content);
  overlay.append(modal);
  document.body.append(overlay);

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  const unsubscribe = subscribeSettings(() => render());

  function close(): void {
    activeClose = null;
    unsubscribe();
    window.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }
  activeClose = close;

  window.addEventListener("keydown", onKeydown);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  function mutate(change: (settings: Settings) => Settings): void {
    void updateSettings(change);
  }

  function row(
    nameKey: string,
    descKey: string,
    control: HTMLElement,
  ): HTMLElement {
    const item = document.createElement("div");
    item.className = "setting-row";
    const info = document.createElement("div");
    info.className = "setting-info";
    const name = document.createElement("div");
    name.className = "setting-name";
    name.textContent = t(nameKey);
    const desc = document.createElement("div");
    desc.className = "setting-desc";
    desc.textContent = t(descKey);
    info.append(name, desc);
    item.append(info, control);
    return item;
  }

  function select<T extends string>(
    current: T,
    options: ReadonlyArray<{ value: T; labelKey: string }>,
    onChange: (value: T) => void,
  ): HTMLSelectElement {
    const element = document.createElement("select");
    element.className = "setting-select";
    for (const option of options) {
      const optionEl = document.createElement("option");
      optionEl.value = option.value;
      optionEl.textContent = t(option.labelKey);
      optionEl.selected = option.value === current;
      element.append(optionEl);
    }
    element.addEventListener("change", () => {
      onChange(element.value as T);
    });
    return element;
  }

  function toggle(
    checked: boolean,
    onChange: (value: boolean) => void,
  ): HTMLInputElement {
    const element = document.createElement("input");
    element.type = "checkbox";
    element.className = "setting-toggle";
    element.checked = checked;
    element.addEventListener("change", () => {
      onChange(element.checked);
    });
    return element;
  }

  function textInput(
    value: string,
    onChange: (value: string) => void,
  ): HTMLInputElement {
    const element = document.createElement("input");
    element.type = "text";
    element.className = "setting-text";
    element.value = value;
    element.spellcheck = false;
    element.addEventListener("change", () => {
      onChange(element.value);
    });
    return element;
  }

  function numberInput(
    value: number,
    min: number,
    max: number,
    onChange: (value: number) => void,
  ): HTMLInputElement {
    const element = document.createElement("input");
    element.type = "number";
    element.className = "setting-number";
    element.min = String(min);
    element.max = String(max);
    element.value = String(value);
    element.addEventListener("change", () => {
      const parsed = Number(element.value);
      if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
        onChange(parsed);
      } else {
        element.value = String(value);
      }
    });
    return element;
  }

  function colorInput(
    value: string,
    onChange: (value: string) => void,
  ): HTMLInputElement {
    const element = document.createElement("input");
    element.type = "color";
    element.className = "setting-color";
    element.value = value;
    element.addEventListener("change", () => {
      onChange(element.value);
    });
    return element;
  }

  function renderSidebar(): void {
    sidebar.replaceChildren(
      ...SECTIONS.map((section) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "settings-section-button";
        item.classList.toggle("is-active", section.id === activeSection);
        item.textContent = t(section.labelKey);
        item.addEventListener("click", () => {
          activeSection = section.id;
          render();
        });
        return item;
      }),
    );
  }

  function generalRows(settings: Settings): HTMLElement[] {
    return [
      row(
        "settings.language.name",
        "settings.language.desc",
        select(
          settings.language,
          [
            { value: "system", labelKey: "settings.language.system" },
            { value: "ca", labelKey: "settings.language.ca" },
            { value: "es", labelKey: "settings.language.es" },
            { value: "en", labelKey: "settings.language.en" },
          ],
          (language) => mutate((s) => ({ ...s, language })),
        ),
      ),
    ];
  }

  function appearanceRows(settings: Settings): HTMLElement[] {
    const a = settings.appearance;
    const patch = (partial: Partial<Settings["appearance"]>) =>
      mutate((s) => ({ ...s, appearance: { ...s.appearance, ...partial } }));
    return [
      row(
        "settings.theme.name",
        "settings.theme.desc",
        select(
          a.theme,
          [
            { value: "dark", labelKey: "settings.theme.dark" },
            { value: "light", labelKey: "settings.theme.light" },
            { value: "system", labelKey: "settings.theme.system" },
          ],
          (theme) => patch({ theme }),
        ),
      ),
      row(
        "settings.accentColor.name",
        "settings.accentColor.desc",
        colorInput(a.accentColor, (accentColor) => patch({ accentColor })),
      ),
      row(
        "settings.interfaceFont.name",
        "settings.interfaceFont.desc",
        textInput(a.interfaceFont, (interfaceFont) => patch({ interfaceFont })),
      ),
      row(
        "settings.editorFont.name",
        "settings.editorFont.desc",
        select(
          a.editorFont,
          [
            {
              value: "proportional",
              labelKey: "settings.editorFont.proportional",
            },
            { value: "monospace", labelKey: "settings.editorFont.monospace" },
          ],
          (editorFont) => patch({ editorFont }),
        ),
      ),
      row(
        "settings.fontSize.name",
        "settings.fontSize.desc",
        numberInput(a.fontSize, 8, 40, (fontSize) => patch({ fontSize })),
      ),
      row(
        "settings.readableLine.name",
        "settings.readableLine.desc",
        toggle(a.readableLineLength, (readableLineLength) =>
          patch({ readableLineLength }),
        ),
      ),
    ];
  }

  function editorRows(settings: Settings): HTMLElement[] {
    const e = settings.editor;
    const patch = (partial: Partial<Settings["editor"]>) =>
      mutate((s) => ({ ...s, editor: { ...s.editor, ...partial } }));
    return [
      row(
        "settings.defaultMode.name",
        "settings.defaultMode.desc",
        select(
          e.defaultMode,
          [
            { value: "edit", labelKey: "settings.defaultMode.edit" },
            { value: "read", labelKey: "settings.defaultMode.read" },
          ],
          (defaultMode) => patch({ defaultMode }),
        ),
      ),
      row(
        "settings.autosave.name",
        "settings.autosave.desc",
        toggle(e.autosave, (autosave) => patch({ autosave })),
      ),
      row(
        "settings.autosaveInterval.name",
        "settings.autosaveInterval.desc",
        numberInput(
          Math.round(e.autosaveIntervalMs / 1000),
          1,
          600,
          (seconds) => patch({ autosaveIntervalMs: seconds * 1000 }),
        ),
      ),
      row(
        "settings.lineNumbers.name",
        "settings.lineNumbers.desc",
        toggle(e.showLineNumbers, (showLineNumbers) =>
          patch({ showLineNumbers }),
        ),
      ),
      row(
        "settings.indentation.name",
        "settings.indentation.desc",
        select(
          e.indentation,
          [
            { value: "spaces", labelKey: "settings.indentation.spaces" },
            { value: "tabs", labelKey: "settings.indentation.tabs" },
          ],
          (indentation) => patch({ indentation }),
        ),
      ),
      row(
        "settings.spellcheck.name",
        "settings.spellcheck.desc",
        toggle(e.spellcheck, (spellcheck) => patch({ spellcheck })),
      ),
    ];
  }

  function filesRows(settings: Settings): HTMLElement[] {
    const f = settings.files;
    const patch = (partial: Partial<Settings["files"]>) =>
      mutate((s) => ({ ...s, files: { ...s.files, ...partial } }));
    return [
      row(
        "settings.confirmDelete.name",
        "settings.confirmDelete.desc",
        toggle(f.confirmDelete, (confirmDelete) => patch({ confirmDelete })),
      ),
      row(
        "settings.defaultExtension.name",
        "settings.defaultExtension.desc",
        textInput(f.defaultExtension, (defaultExtension) =>
          patch({ defaultExtension }),
        ),
      ),
    ];
  }

  function renderContent(): void {
    const settings = getSettings();
    const heading = document.createElement("h2");
    heading.className = "settings-heading";
    heading.textContent = t(
      SECTIONS.find((section) => section.id === activeSection)?.labelKey ??
        "settings.title",
    );
    const rows =
      activeSection === "general"
        ? generalRows(settings)
        : activeSection === "appearance"
          ? appearanceRows(settings)
          : activeSection === "editor"
            ? editorRows(settings)
            : filesRows(settings);
    content.replaceChildren(heading, ...rows);
  }

  function render(): void {
    renderSidebar();
    renderContent();
  }

  render();
}
