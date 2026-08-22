import { dict, DEFAULT_LANG } from "./dict.js";
import { resolveLanguage } from "./language.js";

function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`));
}

export function applyLanguage(lang) {
  const strings = dict[lang] ?? dict[DEFAULT_LANG];
  document.documentElement.lang = lang;
  document.documentElement.classList.toggle("lang-en", lang === "en");
  document.documentElement.classList.toggle("lang-es", lang !== "en");

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key || !(key in strings)) return;
    const paramsRaw = el.getAttribute("data-i18n-params");
    let params;
    if (paramsRaw) {
      try {
        params = JSON.parse(paramsRaw);
      } catch {}
    }
    el.textContent = interpolate(strings[key], params);
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key && key in strings) el.setAttribute("placeholder", strings[key]);
  });

  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (key && key in strings) el.setAttribute("title", strings[key]);
  });

  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    if (key && key in strings) el.setAttribute("aria-label", strings[key]);
  });

  if (strings["layout.title"]) document.title = strings["layout.title"];
  const description = document.querySelector('meta[name="description"]');
  if (description && strings["layout.description"]) {
    description.setAttribute("content", strings["layout.description"]);
  }

  window.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
}

applyLanguage(resolveLanguage());
