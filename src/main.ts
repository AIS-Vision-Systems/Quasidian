import "katex/dist/katex.min.css";
import "@aisvision/quasidian-core/theme.css";
import "@aisvision/quasidian-core/core.css";
import "./styles/app.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { t } from "./i18n/i18n";
import { setCoreTranslator } from "@aisvision/quasidian-core";
import { loadSettings, subscribeSettings } from "./ipc/settingsStore";
import { applyAppearance, applyLanguage } from "./ui/applySettings";
import { mountLayout } from "./ui/layout";

async function init(): Promise<void> {
  // The editor core ships English defaults for its strings; the app
  // plugs its translator in so they follow the locale (m41).
  setCoreTranslator(t);
  const settings = await loadSettings();
  applyLanguage(settings);
  applyAppearance(settings);
  // Subscribed before mountLayout so language applies before the layout
  // refreshes its labels on later changes.
  subscribeSettings((next) => {
    applyLanguage(next);
    applyAppearance(next);
  });
  const root = document.getElementById("app");
  if (root !== null) {
    mountLayout(root);
  }
  // The window is created hidden so the window-state plugin can restore
  // the last position/size first: showing it here avoids the flicker of
  // the default placement. Failures must never leave it invisible.
  const window = getCurrentWindow();
  await window.show().catch(() => undefined);
  await window.setFocus().catch(() => undefined);
}

void init();
