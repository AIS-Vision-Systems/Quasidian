// Command registry for the command palette. Names resolve through t() at
// open time so they always reflect the current language.
import { t } from "../i18n/i18n";
import type { PaletteItem } from "./palette";

export interface Command {
  id: string;
  /** i18n key for the display name. */
  nameKey: string;
  /** Human-readable hotkey hint, e.g. "Ctrl+S". */
  hotkey?: string;
  run(): void;
}

export function commandPaletteItems(
  commands: readonly Command[],
): PaletteItem[] {
  return commands.map((command) => ({
    id: command.id,
    label: t(command.nameKey),
    hint: command.hotkey,
  }));
}
