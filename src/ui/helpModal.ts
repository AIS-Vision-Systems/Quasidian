// Credits and help page: logo, name, runtime version and author, plus
// the bundled user guide (markdown per language) rendered through the
// shared reading pipeline — the app documents itself with its own
// format. Closes like the settings modal (X, Escape, click outside).
import { getVersion } from "@tauri-apps/api/app";
import appIconUrl from "../../app-icon.png";
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
  const author = document.createElement("div");
  author.className = "help-meta";
  author.textContent = `${t("help.author")}: Xavi Anguera`;
  identity.append(name, version, author);
  // Update check fills the free space on the right of the credits.
  const updates = document.createElement("div");
  updates.className = "help-updates";
  updates.append(createUpdateCheck());
  credits.append(logo, identity, updates);

  // The guide for the UI language, rendered with the shared pipeline.
  // Raw imports keep the file's CRLF line endings, which the parser
  // does not treat as line breaks (tables would not parse): normalize.
  const guide = document.createElement("div");
  guide.className = "help-guide markdown-rendered";
  const source = (GUIDES[getLocale()] ?? guideEn).replace(/\r\n?/g, "\n");
  guide.innerHTML = renderToHtml(source, { properties: false });
  highlightCodeBlocks(guide);
  addCodePills(guide);

  modal.append(closeButton, credits, guide);
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
