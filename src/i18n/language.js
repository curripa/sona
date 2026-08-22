import { DEFAULT_LANG } from "./dict.js";

export function resolveLanguage() {
  if (typeof navigator === "undefined") return DEFAULT_LANG;
  const langs =
    navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language];
  const primary = String(langs[0] || "").toLowerCase();
  if (primary.startsWith("es")) return "es";
  if (primary.startsWith("en")) return "en";
  return DEFAULT_LANG;
}

export function getLang() {
  if (typeof document !== "undefined") {
    const l = document.documentElement.lang;
    if (l === "es" || l === "en") return l;
  }
  return resolveLanguage();
}
