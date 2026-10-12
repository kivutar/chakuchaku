(function initializeReadingView(global) {
  "use strict";

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  // Reading is deliberately not an SRS exercise. Answers live only in this view.
  function mount({ root, passage, locale, t, createToken, getAudioAvailability, onSpeechActive }) {
    const { localizedText, gradeAnswers } = global.JlptN5Reading;
    const text = (value) => localizedText(value, locale);
    const answers = {};
    const questionViews = new Map();
    const sentencesById = new Map(passage.sentences.map((sentence) => [sentence.id, sentence]));
    const sentenceElements = new Map();
    let corrected = false;
    let destroyed = false;
    let playing;

    function sentenceContent(sentence, endingButton) {
      const content = element("span", "reading-sentence-text");
      content.lang = "ja";
      const splitAt = endingButton ? Math.max(0, sentence.tokens.length - 2) : sentence.tokens.length;
      for (const token of sentence.tokens.slice(0, splitAt)) content.append(createToken(token));
      if (endingButton) {
        const ending = element("span", "reading-sentence-ending");
        for (const token of sentence.tokens.slice(splitAt)) ending.append(createToken(token));
        ending.append(endingButton);
        content.append(ending);
      }
      return content;
    }

    function setAudioState(button, state, number) {
      button.dataset.state = state;
      button.disabled = state === "checking" || state === "unavailable";
      button.setAttribute("aria-pressed", String(state === "playing"));
      button.setAttribute("aria-busy", String(state === "loading" || state === "checking"));
      const label = state === "playing" || state === "loading"
        ? t("reading.stopSentence", { number })
        : state === "unavailable" ? t("speech.unavailable")
          : state === "checking" ? t("speech.checking")
            : state === "error" ? t("speech.retry")
              : t("reading.playSentence", { number });
      button.setAttribute("aria-label", label);
      button.title = label;
    }

    function stopAudio() {
      if (!playing) return;
      const previous = playing;
      playing = undefined;
      previous.audio.pause();
      previous.audio.removeAttribute("src");
      previous.audio.load();
      setAudioState(previous.button, "ready", previous.number);
      onSpeechActive(false);
    }

    function audioButton(sentence, number) {
      const button = element("button", "reading-speak-button");
      button.type = "button";
      button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
      setAudioState(button, "checking", number);
      Promise.resolve(getAudioAvailability(sentence.audio)).then((available) => {
        if (!destroyed) setAudioState(button, available ? "ready" : "unavailable", number);
      }).catch(() => {
        if (!destroyed) setAudioState(button, "unavailable", number);
      });
      button.addEventListener("click", async () => {
        const wasPlaying = playing?.button === button;
        stopAudio();
        if (wasPlaying || destroyed) return;
        const audio = new Audio(new URL(sentence.audio, document.baseURI).href);
        const request = { audio, button, number };
        playing = request;
        setAudioState(button, "loading", number);
        onSpeechActive(true);
        const failed = () => {
          if (playing !== request) return;
          stopAudio();
          setAudioState(button, "error", number);
        };
        audio.addEventListener("ended", () => {
          if (playing === request) stopAudio();
        });
        audio.addEventListener("error", failed);
        try {
          await audio.play();
          if (playing === request && !destroyed) setAudioState(button, "playing", number);
        } catch {
          failed();
        }
      });
      return button;
    }

    root.replaceChildren();
    root.hidden = false;
    const header = element("header", "reading-header");
    header.append(element("p", "reading-eyebrow", t("reading.eyebrow")));
    const title = element("h1", "reading-title", text(passage.title));
    title.id = "reading-title";
    const metadata = element("p", "reading-metadata", t("reading.metadata", {
      level: passage.level.toUpperCase(), sentences: passage.sentences.length, questions: passage.questions.length
    }));
    header.append(title, metadata, element("p", "reading-instructions", t("reading.instructions")));
    const questionLink = element("a", "reading-question-link", t("reading.goToQuestions"));
    // Static route pages use <base href="../">; resolve fragments against the
    // current document, not that base, to stay inside the reading section.
    questionLink.href = new URL("#reading-questions", window.location.href).href;
    header.append(questionLink);
    const article = element("article", "reading-article");
    article.setAttribute("aria-labelledby", title.id);
    let paragraph;
    let paragraphNumber;
    passage.sentences.forEach((sentence, index) => {
      if (sentence.paragraph !== paragraphNumber) {
        paragraph = element("p", "reading-paragraph");
        article.append(paragraph);
        paragraphNumber = sentence.paragraph;
      }
      const row = element("span", "reading-sentence");
      row.id = sentence.id;
      row.append(sentenceContent(sentence, audioButton(sentence, index + 1)));
      sentenceElements.set(sentence.id, row);
      paragraph.append(row, document.createTextNode(" "));
    });

    const quiz = element("section", "reading-quiz");
    quiz.id = "reading-questions";
    quiz.setAttribute("aria-labelledby", "reading-questions-title");
    const quizTitle = element("h2", "reading-questions-title", t("reading.questions"));
    quizTitle.id = "reading-questions-title";
    quiz.append(quizTitle, element("p", "reading-quiz-instructions", t("reading.quizInstructions")));
    const form = element("form", "reading-form");
    const progress = element("p", "reading-quiz-progress");
    progress.setAttribute("role", "status");
    const summary = element("div", "reading-score");
    summary.hidden = true;
    summary.tabIndex = -1;
    summary.setAttribute("role", "status");
    quiz.append(summary);

    function showEvidence(question) {
      for (const row of sentenceElements.values()) row.classList.remove("is-evidence");
      for (const id of question.evidenceSentenceIds) sentenceElements.get(id).classList.add("is-evidence");
      sentenceElements.get(question.evidenceSentenceIds[0]).scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        block: "center"
      });
    }

    passage.questions.forEach((question, index) => {
      const fieldset = element("fieldset", "reading-question");
      const legend = element("legend", "reading-question-prompt", `${index + 1}. ${text(question.prompt)}`);
      fieldset.append(legend);
      const options = new Map();
      const inputs = [];
      question.choices.forEach((choice) => {
        const label = element("label", "reading-choice");
        const input = element("input");
        input.type = "radio";
        input.name = question.id;
        input.value = choice.id;
        input.required = true;
        inputs.push(input);
        input.addEventListener("change", () => {
          if (corrected) return;
          answers[question.id] = choice.id;
          updateProgress();
        });
        const choiceText = element("span", "reading-choice-text", text(choice.label));
        const status = element("span", "reading-choice-status");
        label.append(input, choiceText, status);
        fieldset.append(label);
        options.set(choice.id, { label, status });
      });
      const correction = element("div", "reading-correction");
      correction.hidden = true;
      fieldset.append(correction);
      form.append(fieldset);
      questionViews.set(question.id, { fieldset, inputs, options, correction });
    });

    const actions = element("div", "reading-actions");
    const submit = element("button", "reading-submit", t("reading.correct"));
    submit.type = "submit";
    const retry = element("button", "reading-retry", t("reading.retry"));
    retry.type = "button";
    retry.hidden = true;
    actions.append(submit, retry);
    form.append(progress, actions);
    quiz.append(form);
    root.append(header, article, quiz);

    function updateProgress() {
      const count = Object.keys(answers).length;
      progress.textContent = t("reading.answered", { count, total: passage.questions.length });
      submit.disabled = corrected || count < passage.questions.length;
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (corrected || submit.disabled) return;
      const grade = gradeAnswers(passage, answers);
      corrected = true;
      summary.replaceChildren(
        element("strong", "reading-score-value", t("reading.score", { correct: grade.correct, total: grade.total })),
        element("p", "reading-score-description", t("reading.correctionInstructions"))
      );
      summary.hidden = false;
      passage.questions.forEach((question, index) => {
        const { inputs, options, correction } = questionViews.get(question.id);
        const result = grade.results[index];
        for (const input of inputs) input.disabled = true;
        for (const [id, { label, status }] of options) {
          if (id === result.correctAnswerId) {
            label.dataset.result = "correct";
            status.textContent = t("reading.correctAnswer");
          } else if (id === result.answerId) {
            label.dataset.result = "incorrect";
            status.textContent = t("reading.yourAnswer");
          }
        }
        const outcome = element("p", "reading-question-outcome", result.correct ? t("feedback.correct") : t("reading.incorrect"));
        outcome.dataset.result = result.correct ? "correct" : "incorrect";
        correction.append(outcome, element("p", "reading-explanation", text(question.explanation)));
        const excerpt = element("blockquote", "reading-evidence");
        for (const id of question.evidenceSentenceIds) {
          excerpt.append(sentenceContent(sentencesById.get(id)), document.createTextNode(" "));
        }
        const evidenceLink = element("button", "reading-evidence-link", t("reading.findEvidence"));
        evidenceLink.type = "button";
        evidenceLink.addEventListener("click", () => showEvidence(question));
        correction.append(excerpt, evidenceLink);
        correction.hidden = false;
      });
      submit.hidden = true;
      retry.hidden = false;
      progress.hidden = true;
      summary.focus();
    });

    retry.addEventListener("click", () => {
      corrected = false;
      for (const id of Object.keys(answers)) delete answers[id];
      form.reset();
      for (const { inputs, options, correction } of questionViews.values()) {
        for (const input of inputs) input.disabled = false;
        for (const { label, status } of options.values()) {
          delete label.dataset.result;
          status.textContent = "";
        }
        correction.replaceChildren();
        correction.hidden = true;
      }
      for (const row of sentenceElements.values()) row.classList.remove("is-evidence");
      summary.hidden = true;
      progress.hidden = false;
      submit.hidden = false;
      retry.hidden = true;
      updateProgress();
      questionViews.values().next().value.inputs[0].focus();
    });
    updateProgress();

    // Hide/leave stops narration; no autoplay and at most one sentence at a time.
    const handleVisibility = () => { if (document.hidden) stopAudio(); };
    // Keep the shared vocabulary bubbles inside narrow viewports.
    const positionTooltip = (event) => {
      const token = event.target.closest?.(".token[data-gloss]");
      if (!token) return;
      window.requestAnimationFrame(() => {
        if (destroyed) return;
        const style = getComputedStyle(token, "::after");
        const width = parseFloat(style.width) + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        if (!Number.isFinite(width)) return;
        const bounds = token.getBoundingClientRect();
        const left = bounds.left + bounds.width / 2 - width / 2;
        const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - width - 8));
        token.style.setProperty("--reading-tooltip-offset", `${clampedLeft - left}px`);
      });
    };
    for (const event of ["pointerover", "focusin", "click"]) root.addEventListener(event, positionTooltip, true);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", stopAudio);
    return function destroy() {
      destroyed = true;
      stopAudio();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", stopAudio);
      for (const event of ["pointerover", "focusin", "click"]) root.removeEventListener(event, positionTooltip, true);
    };
  }

  function mountLibrary({ passages, ...options }) {
    const { root, locale, t } = options;
    const { localizedText, filterPassages, paginatePassages, storyUrl } = global.JlptN5Reading;
    const filters = { query: "", level: "all", locale };
    let page = 1;
    let destroyStory;
    let activeStoryId;

    function renderLibrary(notFound) {
      root.replaceChildren();
      root.hidden = false;
      const header = element("header", "reading-header");
      header.append(element("p", "reading-eyebrow", t("reading.eyebrow")));
      const title = element("h1", "reading-title", t("reading.libraryTitle"));
      title.id = "reading-title";
      header.append(title, element("p", "reading-instructions", t("reading.libraryInstructions")));
      if (notFound) header.append(element("p", "reading-instructions", t("reading.storyNotFound")));
      const toolbar = element("div", "reading-library-toolbar");
      const searchLabel = element("label", "reading-library-field", t("reading.search"));
      const search = element("input", "reading-search");
      search.type = "search";
      search.value = filters.query;
      search.placeholder = t("reading.searchPlaceholder");
      searchLabel.append(search);
      const levelLabel = element("label", "reading-library-field", t("reading.level"));
      const level = element("select", "reading-level-filter");
      const availableLevels = new Set(passages.map((passage) => passage.level));
      for (const id of ["all", "n5", "n4"]) {
        if (id !== "all" && !availableLevels.has(id)) continue;
        const option = element("option", "", id === "all" ? t("reading.allLevels") : id.toUpperCase());
        option.value = id;
        level.append(option);
      }
      level.value = filters.level;
      levelLabel.append(level);
      toolbar.append(searchLabel, levelLabel);
      const status = element("p", "reading-library-status");
      status.setAttribute("role", "status");
      const list = element("ul", "reading-story-list");
      const pagination = element("nav", "reading-pagination");
      pagination.setAttribute("aria-label", t("reading.pages"));
      const previous = element("button", "reading-page-button", t("reading.previousPage"));
      const next = element("button", "reading-page-button", t("reading.nextPage"));
      previous.type = next.type = "button";
      const pageLabel = element("span", "reading-page-label");
      pagination.append(previous, pageLabel, next);
      root.append(header, toolbar, status, list, pagination);

      function updateResults() {
        const result = paginatePassages(filterPassages(passages, filters), page);
        page = result.page;
        status.textContent = result.total === 1 ? t("reading.oneStory") : result.total
          ? t("reading.storyCount", { count: result.total }) : t("reading.noStories");
        list.replaceChildren(...result.items.map((passage) => {
          const item = element("li");
          const link = element("a", "reading-story-link");
          link.href = storyUrl(window.location.href, passage.id);
          link.dataset.story = passage.id;
          link.append(element("span", "reading-story-title", localizedText(passage.title, locale)),
            element("span", "reading-metadata", t("reading.metadata", {
              level: passage.level.toUpperCase(), sentences: passage.sentences.length, questions: passage.questions.length
            })));
          if (passage.description) link.append(element("span", "reading-story-description", localizedText(passage.description, locale)));
          item.append(link);
          return item;
        }));
        pagination.hidden = result.pages === 1;
        previous.disabled = result.page === 1;
        next.disabled = result.page === result.pages;
        pageLabel.textContent = t("reading.page", { page: result.page, total: result.pages });
      }
      search.addEventListener("input", () => { filters.query = search.value; page = 1; updateResults(); });
      level.addEventListener("change", () => { filters.level = level.value; page = 1; updateResults(); });
      previous.addEventListener("click", () => { page -= 1; updateResults(); });
      next.addEventListener("click", () => { page += 1; updateResults(); });
      updateResults();
    }

    function showCurrentPage(focus = false) {
      destroyStory?.();
      destroyStory = undefined;
      activeStoryId = new URL(window.location.href).searchParams.get("story");
      const passage = passages.find(({ id }) => id === activeStoryId);
      if (passage) {
        destroyStory = mount({ ...options, passage });
        const navigation = element("nav", "reading-story-navigation");
        navigation.setAttribute("aria-label", t("reading.libraryTitle"));
        const back = element("a", "reading-back-link", t("reading.backToLibrary"));
        back.href = storyUrl(window.location.href);
        navigation.append(back);
        root.prepend(navigation);
      } else renderLibrary(Boolean(activeStoryId));
      if (focus) {
        const heading = root.querySelector("h1");
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: "instant" });
      } else if (passage && window.location.hash === "#reading-questions") {
        root.querySelector("#reading-questions").scrollIntoView();
      }
    }

    const navigate = (event) => {
      const link = event.target.closest?.(".reading-story-link, .reading-back-link");
      if (!link || !root.contains(link) || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      window.history.pushState(null, "", link.href);
      showCurrentPage(true);
    };
    const handleBack = () => {
      // A questions/evidence fragment is still the same story. Do not erase
      // quiz answers when Back merely removes a fragment from its URL.
      if (new URL(window.location.href).searchParams.get("story") !== activeStoryId) showCurrentPage(true);
    };
    root.addEventListener("click", navigate);
    window.addEventListener("popstate", handleBack);
    showCurrentPage();
    return function destroyLibrary() {
      destroyStory?.();
      root.removeEventListener("click", navigate);
      window.removeEventListener("popstate", handleBack);
    };
  }

  global.JlptN5ReadingView = Object.freeze({ mount, mountLibrary });
})(globalThis);
