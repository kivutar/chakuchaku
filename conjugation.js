(function initializeConjugation(global) {
  "use strict";

  const forms = Object.freeze({
    politePresent: "polite-present",
    politePast: "polite-past",
    politeNegative: "polite-negative",
    politePastNegative: "polite-past-negative",
    te: "te-form"
  });
  const verbClasses = Object.freeze({
    godan: "godan",
    ichidan: "ichidan",
    suru: "suru",
    kuru: "kuru"
  });
  const politeSuffixes = Object.freeze({
    [forms.politePresent]: "ます",
    [forms.politePast]: "ました",
    [forms.politeNegative]: "ません",
    [forms.politePastNegative]: "ませんでした"
  });
  const godanIEndings = Object.freeze({
    "う": "い",
    "く": "き",
    "ぐ": "ぎ",
    "す": "し",
    "つ": "ち",
    "ぬ": "に",
    "ぶ": "び",
    "む": "み",
    "る": "り"
  });
  const teEndings = Object.freeze({
    "う": { suffix: "って", group: "godan-u-tsu-ru" },
    "つ": { suffix: "って", group: "godan-u-tsu-ru" },
    "る": { suffix: "って", group: "godan-u-tsu-ru" },
    "む": { suffix: "んで", group: "godan-mu-bu-nu" },
    "ぶ": { suffix: "んで", group: "godan-mu-bu-nu" },
    "ぬ": { suffix: "んで", group: "godan-mu-bu-nu" },
    "く": { suffix: "いて", group: "godan-ku" },
    "ぐ": { suffix: "いで", group: "godan-gu" },
    "す": { suffix: "して", group: "godan-su" }
  });
  const politeClasses = [
    verbClasses.godan,
    verbClasses.ichidan,
    verbClasses.suru,
    verbClasses.kuru
  ];
  const politeForms = [
    forms.politePresent,
    forms.politePast,
    forms.politeNegative,
    forms.politePastNegative
  ];
  const teGroups = [
    "godan-u-tsu-ru",
    "godan-mu-bu-nu",
    "godan-ku",
    "godan-gu",
    "godan-su",
    "ichidan",
    "suru",
    "kuru",
    "iku"
  ];
  const pointPatterns = Object.freeze({
    "godan-u-tsu-ru-te-form": "～う・つ・る → ～って",
    "godan-mu-bu-nu-te-form": "～む・ぶ・ぬ → ～んで",
    "godan-ku-te-form": "～く → ～いて",
    "godan-gu-te-form": "～ぐ → ～いで",
    "godan-su-te-form": "～す → ～して",
    "ichidan-te-form": "～る → ～て",
    "suru-te-form": "する → して",
    "kuru-te-form": "来る → 来て",
    "iku-te-form": "行く → 行って"
  });

  function createPointId(group, form) {
    return `${group}-${form}`;
  }

  function getGroupKey(group) {
    return `conjugation.group.${group}`;
  }

  function getFormKey(form) {
    return `conjugation.form.${form}`;
  }

  function createPoint(group, form) {
    const id = createPointId(group, form);
    const suffix = politeSuffixes[form];
    const subject = {
      godan: "う-verbs",
      ichidan: "る-verbs",
      suru: "する",
      kuru: "来る"
    }[group];

    return Object.freeze({
      id,
      group,
      form,
      groupKey: getGroupKey(group),
      formKey: getFormKey(form),
      pattern: pointPatterns[id] || `${subject} → ～${suffix}`
    });
  }

  const points = Object.freeze([
    ...politeClasses.flatMap((verbClass) => {
      return politeForms.map((form) => createPoint(verbClass, form));
    }),
    ...teGroups.map((group) => createPoint(group, forms.te))
  ]);

  function getConverter(converter) {
    const resolvedConverter = converter || global.wanakana;

    if (!resolvedConverter) {
      throw new Error("WanaKana must load before conjugation exercises are used.");
    }

    return resolvedConverter;
  }

  function replaceEnding(value, endingLength, suffix) {
    return `${value.slice(0, -endingLength)}${suffix}`;
  }

  function createMasuStem(value, verbClass) {
    if (verbClass === verbClasses.godan) {
      const ending = value.at(-1);
      const replacement = godanIEndings[ending];

      if (!replacement) {
        throw new TypeError(`Unsupported godan ending: ${ending}`);
      }

      return replaceEnding(value, 1, replacement);
    }

    if (verbClass === verbClasses.ichidan) {
      return replaceEnding(value, 1, "");
    }

    if (verbClass === verbClasses.suru) {
      return replaceEnding(value, 2, "し");
    }

    if (verbClass === verbClasses.kuru) {
      return value === "来る" ? "来" : "き";
    }

    throw new TypeError(`Unsupported verb class: ${verbClass}`);
  }

  function createTeForm(value, verb) {
    if (verb.teException === "iku") {
      return replaceEnding(value, 1, "って");
    }

    if (verb.class === verbClasses.godan) {
      const rule = teEndings[verb.reading.at(-1)];

      if (!rule) {
        throw new TypeError(`Unsupported godan te-form ending: ${verb.reading.at(-1)}`);
      }

      return replaceEnding(value, 1, rule.suffix);
    }

    if (verb.class === verbClasses.ichidan) {
      return replaceEnding(value, 1, "て");
    }

    if (verb.class === verbClasses.suru) {
      return replaceEnding(value, 2, "して");
    }

    if (verb.class === verbClasses.kuru) {
      return value === "来る" ? "来て" : "きて";
    }

    throw new TypeError(`Unsupported verb class: ${verb.class}`);
  }

  function getPointIdForVerb(verb, form) {
    if (form !== forms.te) {
      return createPointId(verb.class, form);
    }

    if (verb.teException === "iku") {
      return createPointId("iku", form);
    }

    if (verb.class !== verbClasses.godan) {
      return createPointId(verb.class, form);
    }

    const rule = teEndings[verb.reading.at(-1)];

    if (!rule) {
      throw new TypeError(`Unsupported godan te-form ending: ${verb.reading.at(-1)}`);
    }

    return createPointId(rule.group, form);
  }

  function conjugateVerb(verb, form) {
    if (!verb || typeof verb.term !== "string" || typeof verb.reading !== "string") {
      throw new TypeError("A conjugatable verb needs a written form and reading.");
    }

    if (form === forms.te) {
      return {
        surface: createTeForm(verb.term, verb),
        reading: createTeForm(verb.reading, verb)
      };
    }

    const suffix = politeSuffixes[form];

    if (!suffix) {
      throw new TypeError(`Unsupported conjugation form: ${form}`);
    }

    return {
      surface: `${createMasuStem(verb.term, verb.class)}${suffix}`,
      reading: `${createMasuStem(verb.reading, verb.class)}${suffix}`
    };
  }

  function createExercisePool(vocabulary, curriculum) {
    const entriesById = vocabulary instanceof Map
      ? vocabulary
      : new Map((Array.isArray(vocabulary) ? vocabulary : []).map((entry) => [entry.id, entry]));

    if (!Array.isArray(curriculum)) {
      return [];
    }

    return curriculum.flatMap((curriculumEntry) => {
      const vocabularyEntry = entriesById.get(curriculumEntry?.vocabularyId);

      if (
        !vocabularyEntry ||
        !Object.values(verbClasses).includes(curriculumEntry.class) ||
        typeof vocabularyEntry.term !== "string" ||
        typeof vocabularyEntry.reading !== "string"
      ) {
        return [];
      }

      const verb = {
        ...vocabularyEntry,
        class: curriculumEntry.class,
        teException: curriculumEntry.teException
      };

      return [...politeForms, forms.te].map((form) => {
        const answer = conjugateVerb(verb, form);
        const conjugationPointId = getPointIdForVerb(verb, form);

        return {
          id: `conjugation-${conjugationPointId}-${verb.id}`,
          section: "conjugation",
          vocabularyId: verb.id,
          term: verb.term,
          reading: verb.reading,
          meaning: verb.meaning,
          verbClass: verb.class,
          form,
          conjugationPointId,
          conjugationPointIds: [conjugationPointId],
          answerSurface: answer.surface,
          answerReading: answer.reading,
          text: verb.term,
          solution: answer.surface
        };
      });
    });
  }

  function chooseExercise(pool, targetPointId, { previousExerciseId, random = Math.random } = {}) {
    const matching = (Array.isArray(pool) ? pool : []).filter(({ conjugationPointIds }) => {
      return conjugationPointIds.includes(targetPointId);
    });
    const unrepeated = matching.filter(({ id }) => id !== previousExerciseId);
    const candidates = unrepeated.length > 0 ? unrepeated : matching;

    if (candidates.length === 0) {
      return undefined;
    }

    return candidates[Math.floor(random() * candidates.length)];
  }

  function normalizeJapanese(value, converter) {
    const compact = String(value || "")
      .normalize("NFKC")
      .replace(/[\s~～・･、。！？!?]+/gu, "");

    return {
      surface: compact,
      reading: getConverter(converter).toHiragana(compact)
    };
  }

  function gradeAnswer(exercise, answer, converter) {
    const normalized = normalizeJapanese(answer, converter);
    const correct = normalized.surface === exercise.answerSurface ||
      normalized.reading === exercise.answerReading;

    return {
      correct,
      outcome: correct ? "good" : "again",
      expectedAnswer: exercise.answerSurface,
      expectedReading: exercise.answerReading,
      normalizedAnswer: normalized.surface,
      ratings: exercise.conjugationPointIds.map((conjugationPointId) => ({
        conjugationPointId,
        outcome: correct ? "good" : "again"
      }))
    };
  }

  global.JlptN5Conjugation = Object.freeze({
    forms,
    verbClasses,
    points,
    conjugateVerb,
    getPointIdForVerb,
    createExercisePool,
    chooseExercise,
    normalizeJapanese,
    gradeAnswer
  });
})(globalThis);
