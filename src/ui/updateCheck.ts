// "Check for updates" widget shared by the settings modal and the
// credits page: a button plus a status line. Where the signed updater
// applies (NSIS, AppImage) the button walks check → update → restart,
// each step behind its own click; elsewhere (.deb) an available
// version stays a link to the download page (m43). The states and
// labels come from the pure updateFlow module, shared with the
// status-bar notice.
import { openUrl } from "@tauri-apps/plugin-opener";
import { t } from "../i18n/i18n";
import {
  afterCheck,
  afterInstallPhase,
  buttonLabel,
  statusLabel,
  type UpdateUiState,
} from "../lib/updateFlow";
import {
  checkForUpdateFlow,
  installUpdate,
  relaunchApp,
  type Update,
} from "../ipc/updates";

export function createUpdateCheck(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "update-check";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "setting-button";
  const status = document.createElement("div");
  status.className = "update-check-status";
  let state: UpdateUiState = { kind: "idle" };
  // The plugin's handle rides beside the pure state.
  let pendingUpdate: Update | null = null;

  function refresh(): void {
    const label = buttonLabel(state);
    button.textContent = t(label.key, label.params);
    button.disabled = state.kind === "installing";
    const line = statusLabel(state);
    status.textContent = line === null ? "" : t(line.key, line.params);
    status.classList.toggle("is-link", state.kind === "manual");
  }

  async function runCheck(): Promise<void> {
    pendingUpdate = null;
    status.textContent = t("updates.checking");
    const result = await checkForUpdateFlow();
    if (result.status === "installable") {
      pendingUpdate = result.update;
      state = afterCheck({ status: "installable", version: result.version });
    } else if (result.status === "manual") {
      state = afterCheck({
        status: "manual",
        version: result.latest.version,
        url: result.latest.url,
      });
    } else {
      state = afterCheck({ status: result.status });
    }
  }

  async function runInstall(update: Update): Promise<void> {
    await installUpdate(update, (phase) => {
      state = afterInstallPhase(phase);
      refresh();
    });
  }

  button.addEventListener("click", () => {
    void (async () => {
      if (state.kind === "installable" && pendingUpdate !== null) {
        await runInstall(pendingUpdate);
      } else if (state.kind === "installed") {
        await relaunchApp().catch(() => undefined);
      } else if (state.kind !== "installing") {
        button.disabled = true;
        await runCheck();
      }
      refresh();
    })();
  });
  status.addEventListener("click", () => {
    if (state.kind === "manual") {
      void openUrl(state.url).catch(() => undefined);
    }
  });
  refresh();
  wrap.append(button, status);
  return wrap;
}
