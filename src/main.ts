import "./styles/theme.css";
import "./styles/app.css";
import { detectLocale, getLocale, setLocale } from "./i18n/i18n";
import { mountLayout } from "./ui/layout";

setLocale(detectLocale(navigator.language));
document.documentElement.lang = getLocale();

const root = document.getElementById("app");
if (root !== null) {
  mountLayout(root);
}
