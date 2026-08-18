// "Check for updates" widget shared by the settings modal and the
// credits page: a button plus a status line; an available version
// becomes a link to the download page. Check-only — nothing installs.
import { openUrl } from "@tauri-apps/plugin-opener";
import { t } from "../i18n/i18n";
import { checkForUpdate } from "../ipc/updates";

export function createUpdateCheck(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "update-check";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "setting-button";
  button.textContent = t("updates.check");
  const status = document.createElement("div");
  status.className = "update-check-status";
  let downloadUrl: string | null = null;
  button.addEventListener("click", () => {
    void (async () => {
      button.disabled = true;
      downloadUrl = null;
      status.classList.remove("is-link");
      status.textContent = t("updates.checking");
      const result = await checkForUpdate();
      button.disabled = false;
      if (result.status === "current") {
        status.textContent = t("updates.current");
      } else if (result.status === "outdated") {
        status.textContent = t("updates.available", {
          version: result.latest.version,
        });
        status.classList.add("is-link");
        downloadUrl = result.latest.url;
      } else {
        status.textContent = t("updates.error");
      }
    })();
  });
  status.addEventListener("click", () => {
    if (downloadUrl !== null) {
      void openUrl(downloadUrl).catch(() => undefined);
    }
  });
  wrap.append(button, status);
  return wrap;
}
