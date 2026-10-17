import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const [code, english, french, filipino, vietnamese] = await Promise.all([
  readFile(join(rootDirectory, "i18n.js"), "utf8"),
  readFile(join(rootDirectory, "locales", "en.json"), "utf8").then(JSON.parse),
  readFile(join(rootDirectory, "locales", "fr.json"), "utf8").then(JSON.parse),
  readFile(join(rootDirectory, "locales", "fil.json"), "utf8").then(JSON.parse),
  readFile(join(rootDirectory, "locales", "vi.json"), "utf8").then(JSON.parse)
]);

function loadApi(languages = ["en-US"]) {
  const context = {
    navigator: { languages },
    Intl,
    URL,
    console
  };

  context.globalThis = context;
  vm.runInNewContext(code, context);
  return context.JlptN5I18n;
}

function catalogFetch(url) {
  const value = {
    "locales/en.json": english,
    "locales/fr.json": french,
    "locales/fil.json": filipino,
    "locales/vi.json": vietnamese
  }[url];
  assert.ok(value, `Unexpected catalog request: ${url}`);

  return Promise.resolve({ ok: true, json: async () => value });
}

test("locale resolution honors explicit choices and French system preferences", () => {
  const api = loadApi(["fr-FR", "en-US"]);

  assert.equal(api.resolveLocale("en"), "en");
  assert.equal(api.resolveLocale("fr"), "fr");
  assert.equal(api.resolveLocale("auto"), "fr");
  assert.equal(api.resolveLocale("auto", ["en-US", "fr-FR"]), "en");
  assert.equal(api.resolveLocale("auto", ["de-DE"]), "en");
});

test("French messages interpolate and pluralize with English fallback", async () => {
  const api = loadApi(["fr-FR"]);

  await api.initialize("auto", { fetchImpl: catalogFetch });

  assert.equal(api.getLocale(), "fr");
  assert.equal(api.t("common.next"), "Suivant");
  assert.equal(api.t("studyEmpty.changePace"), "Changer le rythme d’apprentissage");
  assert.equal(api.t("statistics.days", { count: 1 }), "1 jour");
  assert.equal(api.t("statistics.days", { count: 3 }), "3 jours");
  assert.equal(api.t("missing.key"), "missing.key");
});

for (const [name, locale, browserLocale, alias, answer, catalog] of [
  ["Filipino", "fil", "fil-PH", "tl-PH", "Tubig", filipino],
  ["Vietnamese", "vi", "vi-VN", "VI_VN", "Nước", vietnamese]
]) {
  test(`${name} can be enabled for the landing page without extending study languages`, async () => {
    const api = loadApi([browserLocale, "en-US"]);
    const landingLocales = [...api.supportedLocales, "fil", "vi"];

    assert.deepEqual([...api.supportedLocales], ["en", "fr"]);
    assert.equal(api.resolveLocale("auto"), "en");
    assert.equal(api.resolveLocale("auto", [alias], landingLocales), locale);
    assert.equal(api.normalizeLocale(browserLocale, landingLocales), locale);

    await api.initialize("auto", { supportedLocales: landingLocales, fetchImpl: catalogFetch });
    assert.equal(api.getLocale(), locale);
    assert.equal(api.t("landing.demo.vocabulary.answer"), answer);
    assert.equal(api.t("common.next"), english["common.next"]);
    assert.deepEqual([...api.supportedLocales], ["en", "fr"]);

    await api.initialize("auto", { fetchImpl: catalogFetch });
    assert.equal(api.getLocale(), "en");
  });

  test(`${name} translates every landing message and shared label used on the page`, async () => {
    const html = await readFile(join(rootDirectory, "landing.html"), "utf8");
    const keys = new Set([
      ...Object.keys(english).filter((key) => key.startsWith("landing.")),
      ...[...html.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/gu)].map((match) => match[1])
    ]);

    for (const key of keys) {
      assert.equal(typeof catalog[key], "string", key);
      assert.ok(catalog[key].trim().length > 0, key);
    }
  });
}
