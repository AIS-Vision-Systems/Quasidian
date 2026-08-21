// Pure module: no Tauri, no DOM. The update flow's UI state machine
// (m43), shared by the settings/credits widget and the status-bar
// notice so their transitions and labels cannot drift apart. The
// plugin's Update object never enters this module — the UI keeps it
// beside the state.

export type UpdateUiState =
  | { kind: "idle" }
  | { kind: "current" }
  | { kind: "manual"; version: string; url: string }
  | { kind: "installable"; version: string }
  | { kind: "installing"; percent: number | null }
  | { kind: "installed" }
  | { kind: "failed" };

export interface CheckOutcome {
  status: "current" | "installable" | "manual" | "error";
  version?: string;
  url?: string;
}

/** State after a check completes. */
export function afterCheck(outcome: CheckOutcome): UpdateUiState {
  switch (outcome.status) {
    case "current":
      return { kind: "current" };
    case "installable":
      return { kind: "installable", version: outcome.version ?? "" };
    case "manual":
      return {
        kind: "manual",
        version: outcome.version ?? "",
        url: outcome.url ?? "",
      };
    default:
      return { kind: "failed" };
  }
}

export interface InstallPhaseEvent {
  phase: "downloading" | "installed" | "error";
  percent?: number | null;
}

/** State while an install runs (only reachable from `installable`). */
export function afterInstallPhase(event: InstallPhaseEvent): UpdateUiState {
  if (event.phase === "downloading") {
    return { kind: "installing", percent: event.percent ?? null };
  }
  return event.phase === "installed" ? { kind: "installed" } : { kind: "failed" };
}

export interface LabelSpec {
  key: string;
  params?: Record<string, string | number>;
}

/** The widget's action-button label for a state. */
export function buttonLabel(state: UpdateUiState): LabelSpec {
  switch (state.kind) {
    case "installable":
      return { key: "updates.install" };
    case "installed":
      return { key: "updates.restart" };
    default:
      return { key: "updates.check" };
  }
}

/** The widget's status line for a state; null shows nothing. */
export function statusLabel(state: UpdateUiState): LabelSpec | null {
  switch (state.kind) {
    case "current":
      return { key: "updates.current" };
    case "manual":
    case "installable":
      return { key: "updates.available", params: { version: state.version } };
    case "installing":
      return state.percent === null
        ? { key: "updates.downloading" }
        : { key: "updates.downloadingPercent", params: { percent: state.percent } };
    case "installed":
      return { key: "updates.installed" };
    case "failed":
      return { key: "updates.error" };
    default:
      return null;
  }
}

/** The status-bar notice text; null hides the notice. */
export function noticeLabel(state: UpdateUiState): LabelSpec | null {
  switch (state.kind) {
    case "installable":
      return { key: "updates.installNotice", params: { version: state.version } };
    case "manual":
      return { key: "updates.available", params: { version: state.version } };
    case "installing":
      return state.percent === null
        ? { key: "updates.downloading" }
        : { key: "updates.downloadingPercent", params: { percent: state.percent } };
    case "installed":
      return { key: "updates.restart" };
    default:
      return null;
  }
}
