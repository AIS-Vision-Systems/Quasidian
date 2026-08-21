// Pure module: no Tauri, no DOM. Debounced save scheduling; the actual
// write is the caller's `save` callback.

export interface AutosaveOptions {
  enabled: boolean;
  intervalMs: number;
}

export interface AutosaveScheduler {
  /** Marks the document dirty and (re)schedules a save if autosave is on. */
  notifyChange(): void;
  /** Saves immediately if dirty (explicit Ctrl+S, switching files, closing). */
  flush(): void;
  /** Drops the dirty flag and any pending save without saving. */
  cancel(): void;
  isDirty(): boolean;
}

export function createAutosaveScheduler(
  save: () => void,
  options: AutosaveOptions,
): AutosaveScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    notifyChange(): void {
      dirty = true;
      if (!options.enabled) {
        return;
      }
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        dirty = false;
        save();
      }, options.intervalMs);
    },

    flush(): void {
      clearTimer();
      if (dirty) {
        dirty = false;
        save();
      }
    },

    cancel(): void {
      clearTimer();
      dirty = false;
    },

    isDirty(): boolean {
      return dirty;
    },
  };
}
