// Credits and help page: logo, name, runtime version, creator credit,
// license line and AIS Vision Systems branding, plus the bundled user
// guide (markdown per language) rendered through the shared reading
// pipeline — the app documents itself with its own format. Closes like
// the settings modal (X, Escape, click outside).
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import appIconUrl from "../../app-icon.png";
import aisBlueUrl from "../assets/AisBlue.png";
import aisWhiteUrl from "../assets/AisWhite.png";
import guideCa from "../help/guide.ca.md?raw";
import guideEs from "../help/guide.es.md?raw";
import guideEn from "../help/guide.en.md?raw";
import { getLocale, t } from "../i18n/i18n";
import { renderToHtml } from "../markdown/render";
import { createIcon } from "./icons";
import { addCodePills, highlightCodeBlocks } from "./renderedContent";
import { createUpdateCheck } from "./updateCheck";

const GUIDES: Record<string, string> = {
  ca: guideCa,
  es: guideEs,
  en: guideEn,
};

const LICENSE_URL =
  "https://github.com/AIS-Vision-Systems/Quasidian/blob/main/LICENSE.md";

let activeClose: (() => void) | null = null;

export function openHelpModal(): void {
  activeClose?.();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const modal = document.createElement("div");
  modal.className = "help-modal";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "settings-close";
  closeButton.append(createIcon("x"));
  closeButton.title = t("help.close");
  closeButton.setAttribute("aria-label", t("help.close"));
  closeButton.addEventListener("click", () => close());

  // Credits: logo, name, version (filled in at runtime) and author.
  const credits = document.createElement("div");
  credits.className = "help-credits";
  const logo = document.createElement("img");
  logo.className = "help-logo";
  logo.src = appIconUrl;
  logo.alt = "Quasidian";
  const identity = document.createElement("div");
  identity.className = "help-identity";
  const name = document.createElement("div");
  name.className = "help-name";
  name.textContent = "Quasidian";
  const version = document.createElement("div");
  version.className = "help-meta";
  void getVersion()
    .then((value) => {
      version.textContent = `${t("help.version")} ${value}`;
    })
    .catch(() => undefined);
  const creator = document.createElement("div");
  creator.className = "help-meta";
  creator.textContent = `${t("help.creator")}: Xavi Anguera`;
  const license = document.createElement("div");
  license.className = "help-meta help-license";
  license.textContent = t("help.license");
  license.title = t("help.viewLicense");
  license.addEventListener("click", () => {
    void openUrl(LICENSE_URL).catch(() => undefined);
  });
  identity.append(name, version, creator, license);
  // Update check fills the free space on the right of the credits.
  const updates = document.createElement("div");
  updates.className = "help-updates";
  updates.append(createUpdateCheck());
  credits.append(logo, identity, updates);

  // Branding: the theme (body class) picks the blue or the white logo.
  const branding = document.createElement("div");
  branding.className = "help-branding";
  const aisBlue = document.createElement("img");
  aisBlue.className = "help-ais-logo help-ais-logo-blue";
  aisBlue.src = aisBlueUrl;
  aisBlue.alt = "AIS Vision Systems";
  const aisWhite = document.createElement("img");
  aisWhite.className = "help-ais-logo help-ais-logo-white";
  aisWhite.src = aisWhiteUrl;
  aisWhite.alt = "AIS Vision Systems";
  const brandText = document.createElement("span");
  brandText.textContent = t("help.aisApp");
  branding.append(aisBlue, aisWhite, brandText);

  // The guide for the UI language, rendered with the shared pipeline.
  // Raw imports keep the file's CRLF line endings, which the parser
  // does not treat as line breaks (tables would not parse): normalize.
  const guide = document.createElement("div");
  guide.className = "help-guide markdown-rendered";
  const source = (GUIDES[getLocale()] ?? guideEn).replace(/\r\n?/g, "\n");
  guide.innerHTML = renderToHtml(source, { properties: false });
  highlightCodeBlocks(guide);
  addCodePills(guide);

  modal.append(closeButton, credits, branding, guide);
  overlay.append(modal);
  document.body.append(overlay);

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  function close(): void {
    activeClose = null;
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
}
