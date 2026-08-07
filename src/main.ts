import "./styles/theme.css";
import "./styles/app.css";
import { loadSettings, subscribeSettings } from "./ipc/settingsStore";
import { applyAppearance, applyLanguage } from "./ui/applySettings";
import { mountLayout } from "./ui/layout";

async function init(): Promise<void> {
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
}

void init();
