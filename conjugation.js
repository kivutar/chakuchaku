(function initializeConjugation(global) {
  "use strict";

  const forms = Object.freeze({
    politePresent: "polite-present",
    politePast: "polite-past",
    politeNegative: "polite-negative",
    politePastNegative: "polite-past-negative",
    politeVolitional: "polite-volitional",
    adverbial: "adverbial",
    te: "te-form"
  });
  const verbClasses = Object.freeze({
    godan: "godan",
    ichidan: "ichidan",
    suru: "suru",
    kuru: "kuru"
  });
  const adjectiveClasses = Object.freeze({
    i: "i-adjective",
    ii: "ii-adjective",
    na: "na-adjective"
  });
  const politeSuffixes = Object.freeze({
    [forms.politePresent]: "ます",
    [forms.politePast]: "ました",
    [forms.politeNegative]: "ません",
    [forms.politePastNegative]: "ませんでした",
    [forms.politeVolitional]: "ましょう"
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
  const adjectiveForms = [...politeForms, forms.te, forms.adverbial];
  const adjectivePointForms = Object.freeze({
    [adjectiveClasses.i]: adjectiveForms,
    [adjectiveClasses.ii]: adjectiveForms.filter((form) => form !== forms.politePresent),
    [adjectiveClasses.na]: adjectiveForms
  });
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
    "iku-te-form": "行く → 行って",
    "i-adjective-polite-present": "～い → ～いです",
    "i-adjective-polite-past": "～い → ～かったです",
    "i-adjective-polite-negative": "～い → ～くないです",
    "i-adjective-polite-past-negative": "～い → ～くなかったです",
    "i-adjective-te-form": "～い → ～くて",
    "i-adjective-adverbial": "～い → ～く",
    "ii-adjective-polite-past": "いい → よかったです",
    "ii-adjective-polite-negative": "いい → よくないです",
    "ii-adjective-polite-past-negative": "いい → よくなかったです",
    "ii-adjective-te-form": "いい → よくて",
    "ii-adjective-adverbial": "いい → よく",
    "na-adjective-polite-present": "～（な） → ～です",
    "na-adjective-polite-past": "～（な） → ～でした",
    "na-adjective-polite-negative": "～（な） → ～ではありません",
    "na-adjective-polite-past-negative": "～（な） → ～ではありませんでした",
    "na-adjective-te-form": "～（な） → ～で",
    "na-adjective-adverbial": "～（な） → ～に"
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
      kuru: "来る",
      [adjectiveClasses.i]: "い-adjectives",
      [adjectiveClasses.ii]: "いい",
      [adjectiveClasses.na]: "な-adjectives"
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
    ...politeClasses.map((verbClass) => createPoint(verbClass, forms.politeVolitional)),
    ...teGroups.map((group) => createPoint(group, forms.te)),
    ...Object.entries(adjectivePointForms).flatMap(([adjectiveClass, adjectiveForms]) => {
      return adjectiveForms.map((form) => createPoint(adjectiveClass, form));
    })
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

  function conjugateAdjectiveValue(value, adjectiveClass, form, useAlternativeNegative = false) {
    if (adjectiveClass === adjectiveClasses.na) {
      const suffix = {
        [forms.politePresent]: "です",
        [forms.politePast]: "でした",
        [forms.politeNegative]: useAlternativeNegative ? "じゃありません" : "ではありません",
        [forms.politePastNegative]: useAlternativeNegative
          ? "じゃありませんでした"
          : "ではありませんでした",
        [forms.te]: "で",
        [forms.adverbial]: "に"
      }[form];

      if (!suffix) {
        throw new TypeError(`Unsupported な-adjective form: ${form}`);
      }

      return `${value}${suffix}`;
    }

    const isIiAdjective = adjectiveClass === adjectiveClasses.ii;

    if (adjectiveClass !== adjectiveClasses.i && !isIiAdjective) {
      throw new TypeError(`Unsupported adjective class: ${adjectiveClass}`);
    }

    if (form === forms.politePresent) {
      return `${value}です`;
    }

    const ending = isIiAdjective ? "いい" : "い";

    if (!value.endsWith(ending)) {
      throw new TypeError(`${value} does not end in ${ending}.`);
    }

    const stem = replaceEnding(value, ending.length, isIiAdjective ? "よ" : "");
    const suffix = {
      [forms.politePast]: "かったです",
      [forms.politeNegative]: useAlternativeNegative ? "くありません" : "くないです",
      [forms.politePastNegative]: useAlternativeNegative
        ? "くありませんでした"
        : "くなかったです",
      [forms.te]: "くて",
      [forms.adverbial]: "く"
    }[form];

    if (!suffix) {
      throw new TypeError(`Unsupported い-adjective form: ${form}`);
    }

    return `${stem}${suffix}`;
  }

  function conjugateAdjective(adjective, form) {
    if (
      !adjective ||
      typeof adjective.term !== "string" ||
      typeof adjective.reading !== "string"
    ) {
      throw new TypeError("A conjugatable adjective needs a written form and reading.");
    }

    return {
      surface: conjugateAdjectiveValue(adjective.term, adjective.class, form),
      reading: conjugateAdjectiveValue(adjective.reading, adjective.class, form)
    };
  }

  function createAdjectiveAlternatives(adjective, form) {
    const alternatives = [];

    if ([forms.politeNegative, forms.politePastNegative].includes(form)) {
      alternatives.push({
        surface: conjugateAdjectiveValue(adjective.term, adjective.class, form, true),
        reading: conjugateAdjectiveValue(adjective.reading, adjective.class, form, true)
      });

      if (adjective.class === adjectiveClasses.na) {
        const plainPoliteSuffixes = form === forms.politeNegative
          ? ["ではないです", "じゃないです"]
          : ["ではなかったです", "じゃなかったです"];

        alternatives.push(...plainPoliteSuffixes.map((suffix) => ({
          surface: `${adjective.term}${suffix}`,
          reading: `${adjective.reading}${suffix}`
        })));
      }
    }

    if (adjective.class === adjectiveClasses.ii && form === forms.politePresent) {
      for (const variant of adjective.variants || []) {
        if (typeof variant === "string" && variant.endsWith("い")) {
          alternatives.push({ surface: `${variant}です`, reading: `${variant}です` });
        }
      }
    }

    return alternatives;
  }

  function getPointIdForItem(item, form) {
    if (Object.values(adjectiveClasses).includes(item.class)) {
      const pointClass = item.class === adjectiveClasses.ii && form === forms.politePresent
        ? adjectiveClasses.i
        : item.class;

      return createPointId(pointClass, form);
    }

    return getPointIdForVerb(item, form);
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

      const isVerb = Object.values(verbClasses).includes(curriculumEntry?.class);
      const isAdjective = Object.values(adjectiveClasses).includes(curriculumEntry?.class);

      if (
        !vocabularyEntry ||
        (!isVerb && !isAdjective) ||
        (isVerb && vocabularyEntry.partOfSpeech !== "verb") ||
        (isAdjective && vocabularyEntry.partOfSpeech !== "adjective") ||
        typeof vocabularyEntry.term !== "string" ||
        typeof vocabularyEntry.reading !== "string"
      ) {
        return [];
      }

      const item = {
        ...vocabularyEntry,
        class: curriculumEntry.class,
        teException: curriculumEntry.teException
      };
      const itemForms = isVerb
        ? [...politeForms, forms.politeVolitional, forms.te]
        : adjectiveForms;

      return itemForms.map((form) => {
        const answer = isVerb
          ? conjugateVerb(item, form)
          : conjugateAdjective(item, form);
        const alternatives = isAdjective ? createAdjectiveAlternatives(item, form) : [];
        const conjugationPointId = getPointIdForItem(item, form);

        return {
          id: `conjugation-${conjugationPointId}-${item.id}`,
          section: "conjugation",
          vocabularyId: item.id,
          term: item.term,
          reading: item.reading,
          meaning: item.meaning,
          conjugationClass: item.class,
          form,
          conjugationPointId,
          conjugationPointIds: [conjugationPointId],
          answerSurface: answer.surface,
          answerReading: answer.reading,
          acceptedAnswers: alternatives.flatMap(({ surface, reading }) => [surface, reading]),
          text: item.term,
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
    const acceptedAnswers = [
      exercise.answerSurface,
      exercise.answerReading,
      ...(Array.isArray(exercise.acceptedAnswers) ? exercise.acceptedAnswers : [])
    ].map((candidate) => normalizeJapanese(candidate, converter));
    const correct = acceptedAnswers.some((candidate) => {
      return normalized.surface === candidate.surface || normalized.reading === candidate.reading;
    });

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
    adjectiveClasses,
    points,
    conjugateVerb,
    conjugateAdjective,
    getPointIdForVerb,
    createExercisePool,
    chooseExercise,
    normalizeJapanese,
    gradeAnswer
  });
})(globalThis);
