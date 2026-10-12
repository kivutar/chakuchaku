(function initializeReading(global) {
  "use strict";

  function localizedText(value, locale) {
    return value[locale] || value.en;
  }

  function validatePassages(passages) {
    if (!Array.isArray(passages) || passages.length === 0) {
      throw new Error("Reading content must contain at least one passage.");
    }

    const passageIds = new Set();
    const sentenceIds = new Set();
    const requireId = (id) => {
      if (typeof id !== "string" || !/^[a-z0-9-]+$/u.test(id)) {
        throw new Error("Reading content needs safe, non-empty IDs.");
      }
    };
    const requireTranslations = (value) => {
      if (["en", "fr"].some((locale) => (
        typeof value?.[locale] !== "string" || !value[locale].trim()
      ))) {
        throw new Error("Reading labels need English and French translations.");
      }
    };

    for (const passage of passages) {
      requireId(passage.id);
      if (passageIds.has(passage.id)) throw new Error("Duplicate reading passage ID.");
      passageIds.add(passage.id);
      if (!["n5", "n4"].includes(passage.level)) throw new Error("Invalid reading level.");
      requireTranslations(passage.title);
      if (passage.description !== undefined) requireTranslations(passage.description);
      if (!Array.isArray(passage.sentences) || passage.sentences.length === 0) {
        throw new Error(`${passage.id}: missing sentences.`);
      }
      let previousParagraph = 1;
      const ownSentenceIds = new Set();
      for (const sentence of passage.sentences) {
        requireId(sentence.id);
        if (sentenceIds.has(sentence.id)) throw new Error("Duplicate reading sentence ID.");
        sentenceIds.add(sentence.id);
        ownSentenceIds.add(sentence.id);
        if (typeof sentence.text !== "string" || !sentence.text.trim()) {
          throw new Error(`${sentence.id}: missing Japanese text.`);
        }
        if (!Array.isArray(sentence.grammarPointIds) || !sentence.grammarPointIds.length ||
          new Set(sentence.grammarPointIds).size !== sentence.grammarPointIds.length) {
          throw new Error(`${sentence.id}: grammar coverage needs unique point IDs.`);
        }
        sentence.grammarPointIds.forEach(requireId);
        if (sentence.skipVoiceGeneration !== undefined && sentence.skipVoiceGeneration !== true) {
          throw new Error(`${sentence.id}: skipVoiceGeneration must be true when supplied.`);
        }
        if (!Number.isInteger(sentence.paragraph) ||
          sentence.paragraph < previousParagraph || sentence.paragraph > previousParagraph + 1 ||
          (ownSentenceIds.size === 1 && sentence.paragraph !== 1)) {
          throw new Error(`${sentence.id}: paragraphs must be contiguous and ordered.`);
        }
        previousParagraph = sentence.paragraph;
      }
      if (!Array.isArray(passage.questions) || passage.questions.length === 0) {
        throw new Error(`${passage.id}: missing comprehension questions.`);
      }
      const questionIds = new Set();
      for (const question of passage.questions) {
        requireId(question.id);
        if (questionIds.has(question.id)) throw new Error("Duplicate reading question ID.");
        questionIds.add(question.id);
        requireTranslations(question.prompt);
        requireTranslations(question.explanation);
        if (!Array.isArray(question.choices) || question.choices.length < 2) {
          throw new Error(`${question.id}: at least two choices are required.`);
        }
        const choiceIds = new Set();
        for (const choice of question.choices) {
          requireId(choice.id);
          if (choiceIds.has(choice.id)) throw new Error("Duplicate reading choice ID.");
          choiceIds.add(choice.id);
          requireTranslations(choice.label);
        }
        if (!choiceIds.has(question.answerId)) throw new Error(`${question.id}: invalid answer.`);
        if (!Array.isArray(question.evidenceSentenceIds) ||
          question.evidenceSentenceIds.length === 0 ||
          question.evidenceSentenceIds.some((id) => !ownSentenceIds.has(id))) {
          throw new Error(`${question.id}: evidence must reference this passage's sentences.`);
        }
      }
    }
    return passages;
  }

  function gradeAnswers(passage, answers) {
    const results = passage.questions.map((question) => {
      const answerId = answers[question.id];
      if (!question.choices.some(({ id }) => id === answerId)) {
        throw new Error(`${question.id}: choose an answer before correcting.`);
      }
      return {
        questionId: question.id,
        answerId,
        correctAnswerId: question.answerId,
        correct: answerId === question.answerId
      };
    });
    return { correct: results.filter((result) => result.correct).length, total: results.length, results };
  }

  function filterPassages(passages, { query = "", level = "all", locale = "en" } = {}) {
    const normalize = (value) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase(locale);
    const words = normalize(query.trim()).split(/\s+/u).filter(Boolean);
    return passages.filter((passage) => {
      if (level !== "all" && passage.level !== level) return false;
      const searchable = normalize(`${localizedText(passage.title, locale)} ${passage.description ? localizedText(passage.description, locale) : ""}`);
      return words.every((word) => searchable.includes(word));
    });
  }

  function paginatePassages(passages, page = 1, pageSize = 8) {
    if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("Invalid reading page size.");
    const pages = Math.max(1, Math.ceil(passages.length / pageSize));
    const current = Math.max(1, Math.min(Number.isInteger(page) ? page : 1, pages));
    return { items: passages.slice((current - 1) * pageSize, current * pageSize), page: current, pages, total: passages.length };
  }

  function storyUrl(pageUrl, passageId) {
    const url = new URL(pageUrl);
    if (passageId) url.searchParams.set("story", passageId);
    else url.searchParams.delete("story");
    url.hash = "";
    return url.href;
  }

  global.JlptN5Reading = Object.freeze({ localizedText, validatePassages, gradeAnswers, filterPassages, paginatePassages, storyUrl });
})(globalThis);
