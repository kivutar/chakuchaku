(async function initializeLanding(global) {
  "use strict";

  const i18n = global.JlptN5I18n;
  const settings = global.JlptN5Settings;
  const document = global.document;
  const landingLocales = [...i18n.supportedLocales, "fil", "vi"];
  const languageStorageKey = "chakuchaku:landing-language";
  const demos = [
    { id: "hiragana", japanese: "ねこ", prompt: "How do you read this word?", hint: "Two characters. One familiar friend.", answer: "neko · cat" },
    { id: "vocabulary", japanese: "<ruby>水<rt>みず</rt></ruby>", prompt: "What does this word mean?", hint: "A little word you’ll use every day.", answer: "Water" },
    { id: "grammar", japanese: "<ruby>水<rt>みず</rt></ruby>を<ruby>飲<rt>の</rt></ruby>みます。", prompt: "What does this sentence mean?", hint: "You know 水. Now meet it in a sentence.", answer: "I drink water." }
  ];
  let selectedDemo = 1;
  let revealed = false;
  let changingLanguage = false;
  const revealButton = document.querySelector("#demo-reveal");
  const languageButtons = [...document.querySelectorAll("[data-language]")];
  const demoButtons = [...document.querySelectorAll("[data-demo]")];

  function readLanguagePreference() {
    const requestedLanguage = new URLSearchParams(global.location.search).get("lang");
    const requestedLocale = i18n.normalizeLocale(requestedLanguage, landingLocales);
    if (requestedLocale) return requestedLocale;
    try {
      const savedLocale = global.localStorage.getItem(languageStorageKey);
      if (landingLocales.includes(savedLocale)) return savedLocale;
    } catch {
      // Browser language detection also works when storage is unavailable.
    }
    return settings.readSettings().userLanguage;
  }

  function saveLanguagePreference(locale) {
    try {
      global.localStorage.setItem(languageStorageKey, locale);
    } catch {
      // The selection still applies for the current page.
    }
    if (i18n.supportedLocales.includes(locale)) settings.writeSettings({ userLanguage: locale });
    const url = new URL(global.location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.set("lang", locale);
      global.history.replaceState(null, "", url);
    }
  }

  function message(key, fallback) {
    const value = i18n.t(key);
    return value === key ? fallback : value;
  }

  function renderDemo() {
    const demo = demos[selectedDemo];
    const japanese = document.querySelector("#demo-japanese");
    japanese.innerHTML = demo.japanese;
    japanese.classList.toggle("is-sentence", demo.id === "grammar");
    document.querySelector("#demo-prompt").textContent = message(`landing.demo.${demo.id}.prompt`, demo.prompt);
    document.querySelector("#demo-hint").textContent = message(`landing.demo.${demo.id}.hint`, demo.hint);
    document.querySelector("#demo-answer-text").textContent = message(`landing.demo.${demo.id}.answer`, demo.answer);
    document.querySelector("#demo-answer").hidden = !revealed;
    document.querySelector("#demo-counter").textContent = `0${selectedDemo + 1} / 03`;
    revealButton.querySelector("span").textContent = revealed
      ? message("landing.demo.next", "Try another little step")
      : message("landing.demo.reveal", "Reveal the answer");
    revealButton.setAttribute("aria-expanded", String(revealed));
    for (const button of demoButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.demo === demo.id));
    }
  }

  async function applyLanguage(preference) {
    if (changingLanguage) return;
    changingLanguage = true;
    languageButtons.forEach((button) => { button.disabled = true; });
    try {
      await i18n.initialize(preference, { supportedLocales: landingLocales });
      i18n.applyDocument();
      const locale = i18n.getLocale();
      document.title = i18n.t("landing.pageTitle");
      const description = i18n.t("landing.description");
      document.querySelector('meta[name="description"]').content = description;
      document.querySelector('meta[property="og:title"]').content = document.title;
      document.querySelector('meta[property="og:description"]').content = description;
      const appLocale = i18n.supportedLocales.includes(locale) ? locale : i18n.defaultLocale;
      document.querySelector("#privacy-link").href = `privacy.html?lang=${appLocale}`;
      for (const screen of document.querySelectorAll("[data-ios-screen]")) {
        screen.src = `assets/landing/iphone-${screen.dataset.iosScreen}-${appLocale}.png`;
        screen.alt = i18n.t(`landing.ios.${screen.dataset.iosScreen}Alt`);
      }
      for (const button of languageButtons) {
        button.setAttribute("aria-pressed", String(button.dataset.language === locale));
      }
      renderDemo();
      return true;
    } catch {
      // The authored English page and every learning link also work without a catalog.
      return false;
    } finally {
      changingLanguage = false;
      languageButtons.forEach((button) => { button.disabled = false; });
    }
  }

  await applyLanguage(readLanguagePreference());

  for (const button of languageButtons) {
    button.addEventListener("click", async () => {
      const locale = button.dataset.language;
      if (await applyLanguage(locale)) saveLanguagePreference(locale);
    });
  }

  for (const button of demoButtons) {
    button.addEventListener("click", () => {
      selectedDemo = demos.findIndex(({ id }) => id === button.dataset.demo);
      revealed = false;
      renderDemo();
    });
  }

  revealButton.addEventListener("click", () => {
    if (revealed) selectedDemo = (selectedDemo + 1) % demos.length;
    revealed = !revealed;
    renderDemo();
  });
})(globalThis);
