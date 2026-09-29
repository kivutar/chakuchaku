import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TokenizerBuilder } from "lindera-wasm-ipadic-nodejs";
import { toHiragana } from "wanakana";

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(rootDirectory, "data", "source", "open-anki-jlpt-n4.csv");
const vocabularyPath = join(rootDirectory, "data", "jlpt-n5-vocabulary.json");
const sourceCommit = "1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0";
const curriculumLevelOrder = new Map([["n5", 0], ["n4", 1]]);
const excludedGrammar = new Map([
  ["いくら～ても", "grammar construction"],
  ["～ございます", "polite grammar construction"],
  ["～(て) しまう", "grammar construction"],
  ["～ばかり", "grammar construction"],
  ["～だす", "compound-verb grammar"],
  ["～続ける", "compound-verb grammar"],
  ["～やすい", "existing grammar point"],
  ["～始める", "compound-verb grammar"],
  ["～まま", "grammar construction"],
  ["～(に) よると", "grammar construction"],
  ["～おわる", "compound-verb grammar"],
  ["～おき", "grammar construction"],
  ["～(に) ついて", "grammar construction"],
  ["～にくい", "existing grammar point"]
]);
const mergedDuplicateTerms = new Map([
  ["～員", "vocab-9958661a47af"],
  ["～目", "vocab-6c0b9f3278dc"],
  ["全然", "vocab-77ac88ee840e"],
  ["中々", "vocab-521820030457"]
]);
const voiceSlugOverrides = new Map([
  ["空く", { reading: "あく", slug: "aku-empty" }],
  ["内", "uchi-inside"],
  ["億", "oku-hundred-million"],
  ["下りる", "oriru-descend"],
  ["～会", "kai-association"],
  ["変える", "kaeru-change"],
  ["彼", "kare-he"],
  ["気", "ki-spirit"],
  ["急", "kyuu-urgent"],
  ["～区", "ku-ward"],
  ["子", "ko-child"],
  ["御～", "go-honorific"],
  ["市", "shi-city"],
  ["字", "ji-character"],
  ["習慣", "shuukan-habit"],
  ["済む", "sumu-finish"],
  ["～製", "sei-made"],
  ["線", "sen-line"],
  ["～代", "dai-charge"],
  ["点く", "tsuku-light"],
  ["漬ける", "tsukeru-soak"],
  ["都", "to-capital"],
  ["泊まる", "tomaru-stay"],
  ["泣く", "naku-cry"],
  ["鳴る", "naru-ring"],
  ["葉", "ha-leaf"],
  ["変", "hen-strange"],
  ["優しい", "yasashii-kind"],
  ["寄る", "yoru-stop-by"],
  ["事", "koto-thing"],
  ["暮れる", "kureru-get-dark"],
  ["立てる", "tateru-stand"],
  ["日", "hi-day"],
  ["火", "hi-fire"],
  ["月", "tsuki-moon"],
  ["～月", { reading: "～つき", slug: "tsuki-month-counter" }],
  ["おる", "oru-humble-be"],
  ["折る", "oru-fold"],
  ["うかがう", "ukagau-ask"],
  ["伺う", "ukagau-humble"],
  ["無くなる", "nakunaru-disappear"],
  ["亡くなる", "nakunaru-die"],
  ["治る", "naoru-heal"],
  ["直る", "naoru-be-fixed"],
  ["用", "you-use"],
  ["様", "you-manner"],
  ["尋ねる", "tazuneru-ask"],
  ["訪ねる", "tazuneru-visit"]
]);
const entryOverrides = new Map([
  ["ごらんになる", { reading: "ごらんになる" }],
  ["かまう", { reading: "かまう" }],
  ["パート (タイム)", {
    term: "パート",
    reading: "ぱーと",
    variants: ["パートタイム"]
  }],
  ["スーパー (マーケット)", {
    term: "スーパー",
    reading: "すーぱー",
    variants: ["スーパーマーケット"]
  }],
  ["堅; 硬; 固い", {
    term: "固い",
    reading: "かたい",
    variants: ["堅い", "硬い"]
  }],
  ["落る", { term: "落ちる", reading: "おちる" }],
  ["楽む", { term: "楽しむ", reading: "たのしむ", partOfSpeech: "verb" }],
  ["建て", {
    term: "～建て",
    reading: "～だて",
    meaning: "~-story; built as ~",
    partOfSpeech: "affix"
  }],
  ["中学校", { meaning: "junior high school; middle school" }],
  ["見える", { meaning: "to be visible; to be able to see" }],
  ["大抵", { partOfSpeech: "adverb" }],
  ["是非", { partOfSpeech: "adverb" }],
  ["さっき", { partOfSpeech: "adverb" }],
  ["この頃", { partOfSpeech: "adverb" }],
  ["久しぶり", { partOfSpeech: "expression" }],
  ["最近", { partOfSpeech: "adverb" }],
  ["ひげ", { partOfSpeech: "noun" }],
  ["自由", { partOfSpeech: "noun" }],
  ["あ", { partOfSpeech: "interjection" }],
  ["一度", { partOfSpeech: "adverb" }],
  ["一杯", { partOfSpeech: "adverb" }],
  ["十分", { partOfSpeech: "adjective" }],
  ["帰り", { partOfSpeech: "noun" }],
  ["終わり", { partOfSpeech: "noun" }],
  ["引き出し", { partOfSpeech: "noun" }],
  ["日", { introducedAt: "n5" }],
  ["舟", { variants: ["船"] }],
  ["湯", { variants: ["お湯"] }]
]);

function parsePositiveInteger(value, option) {
  if (!/^[1-9]\d*$/u.test(value || "")) {
    throw new Error(`${option} requires a positive integer.`);
  }

  return Number(value);
}

function parseArguments(arguments_) {
  let check = false;
  let limit = Number.POSITIVE_INFINITY;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];

    if (argument === "--check") {
      check = true;
    } else if (argument === "--limit") {
      limit = parsePositiveInteger(arguments_[index += 1], argument);
    } else if (argument.startsWith("--limit=")) {
      limit = parsePositiveInteger(argument.slice("--limit=".length), "--limit");
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return { check, limit };
}

function parseCsv(value) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quoted) {
      if (character === "\"" && value[index + 1] === "\"") {
        field += "\"";
        index += 1;
      } else if (character === "\"") {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === "\"") {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field || row.length > 0) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }

  return rows;
}

function normalizeReading(value) {
  return toHiragana(
    value.normalize("NFKC").replaceAll("~", "～"),
    { convertLongVowelMark: false }
  );
}

function vocabularyKey(term, reading) {
  return `${term.normalize("NFKC")}\u0000${normalizeReading(reading)}`;
}

function vocabularyId(term, reading) {
  const digest = createHash("sha256")
    .update(vocabularyKey(term, reading))
    .digest("hex")
    .slice(0, 12);

  return `vocab-${digest}`;
}

function splitAlternatives(value) {
  return value.split(/;\s*/u).map((part) => part.trim()).filter(Boolean);
}

function lessonNumber(tags) {
  const match = tags.match(/(?:^|\s)Genki_Ln\.(\d+)(?:\s|$)/u);

  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function tokenizerPartOfSpeech(tokens, term, meaning) {
  if (term.includes("～")) {
    return /\bcounter\b/iu.test(meaning) ? "counter" : "affix";
  }

  if (term.endsWith("する")) {
    return "verb";
  }

  if (term.endsWith("に") && tokens.at(-1)?.details[0] === "助詞") {
    return "adverb";
  }

  const adjective = tokens.find(({ details }) => details[0] === "形容詞");
  const verb = /^to\s+/iu.test(meaning)
    ? [...tokens].reverse().find(({ details }) => details[0] === "動詞")
    : undefined;
  const lexical = tokens.find(({ details }) => {
    return ["名詞", "感動詞", "副詞", "連体詞", "接続詞", "助詞"].includes(details[0]);
  });
  const token = adjective || verb || lexical || tokens[0];
  const [primary, secondary, tertiary] = token?.details || [];

  if (primary === "名詞") {
    if (secondary === "代名詞") {
      return "pronoun";
    }

    if (secondary === "数") {
      return "number";
    }

    if (tertiary === "助数詞") {
      return "counter";
    }

    if (secondary === "形容動詞語幹") {
      return "adjective";
    }

    return "noun";
  }

  return {
    動詞: "verb",
    形容詞: "adjective",
    感動詞: "interjection",
    副詞: "adverb",
    連体詞: "determiner",
    接続詞: "conjunction",
    助詞: "particle"
  }[primary] || "expression";
}

function normalizeRow(row, sourceIndex, tokenizer) {
  const [rawTerm, rawReading, rawMeaning, tags, guid] = row;
  const override = entryOverrides.get(rawTerm) || {};
  const terms = splitAlternatives(rawTerm);
  const readings = splitAlternatives(rawReading);
  let term = override.term || terms[0];
  let reading = override.reading || readings[0] || term;
  const meaning = override.meaning || rawMeaning.trim();

  if (!term.endsWith("する") && reading.endsWith("する")) {
    reading = reading.slice(0, -2);
  }

  if (/\p{Script=Han}/u.test(reading) && !/\p{Script=Han}/u.test(term)) {
    reading = term;
  }

  term = term.normalize("NFKC").replaceAll("~", "～");
  reading = normalizeReading(reading);
  const variants = [...new Set([
    ...(override.variants || []),
    ...terms.slice(1)
  ].map((variant) => variant.normalize("NFKC")).filter((variant) => variant !== term))];
  const alternateReadings = [...new Set(readings.slice(1).map(normalizeReading))]
    .filter((candidate) => candidate !== reading);
  const tokens = tokenizer.tokenize(term.replaceAll("～", ""));
  const partOfSpeech = override.partOfSpeech || tokenizerPartOfSpeech(tokens, term, meaning);
  const voiceSlugOverride = voiceSlugOverrides.get(rawTerm);
  const voiceSlug = typeof voiceSlugOverride === "string"
    ? voiceSlugOverride
    : (voiceSlugOverride?.reading === reading ? voiceSlugOverride.slug : undefined);

  return {
    id: vocabularyId(term, reading),
    term,
    reading,
    meaning,
    ...(variants.length > 0 ? { variants } : {}),
    ...(alternateReadings.length > 0 ? { alternateReadings } : {}),
    scope: "core",
    introducedAt: override.introducedAt || "n4",
    source: "open-anki-jlpt-decks",
    partOfSpeech,
    ...(voiceSlug ? { voiceSlug } : {}),
    sourceIndex,
    sourceGuid: guid,
    lesson: lessonNumber(tags)
  };
}

function publicEntry(entry) {
  const { sourceIndex, sourceGuid, lesson, ...result } = entry;

  return result;
}

function mergeVocabulary(existing, additions) {
  return [...existing, ...additions].sort((left, right) => {
    const leftRank = curriculumLevelOrder.get(left.introducedAt);
    const rightRank = curriculumLevelOrder.get(right.introducedAt);

    if (leftRank === undefined || rightRank === undefined) {
      throw new Error("N4 vocabulary import encountered an unknown curriculum level.");
    }

    return leftRank - rightRank;
  });
}

function prepareImport(rows, existing, tokenizer) {
  const header = rows[0];

  if (header?.join(",") !== "expression,reading,meaning,tags,guid") {
    throw new Error("Unexpected Open Anki N4 CSV header.");
  }

  const existingKeys = new Set(existing.map(({ term, reading }) => vocabularyKey(term, reading)));
  const existingIds = new Set(existing.map(({ id }) => id));
  const sourceGuids = new Set();
  const excluded = [];
  const duplicates = [];
  const candidates = [];

  for (const [offset, row] of rows.slice(1).entries()) {
    if (row.length === 1 && row[0] === "") {
      continue;
    }

    if (row.length !== 5 || row.some((value) => typeof value !== "string")) {
      throw new Error(`Invalid N4 source row ${offset + 2}.`);
    }

    if (!row[4] || sourceGuids.has(row[4])) {
      throw new Error(`Missing or duplicate N4 source guid on row ${offset + 2}.`);
    }

    sourceGuids.add(row[4]);

    if (excludedGrammar.has(row[0])) {
      excluded.push({ term: row[0], reason: excludedGrammar.get(row[0]) });
      continue;
    }

    const mergedDuplicateId = mergedDuplicateTerms.get(row[0]);

    if (mergedDuplicateId) {
      if (!existingIds.has(mergedDuplicateId)) {
        throw new Error(
          `${row[0]} expects existing merged vocabulary ${mergedDuplicateId}.`
        );
      }

      duplicates.push(normalizeRow(row, offset, tokenizer));
      continue;
    }

    const entry = normalizeRow(row, offset, tokenizer);
    const key = vocabularyKey(entry.term, entry.reading);

    if (existingKeys.has(key) || existingIds.has(entry.id)) {
      duplicates.push(entry);
      continue;
    }

    existingKeys.add(key);
    existingIds.add(entry.id);
    candidates.push(entry);
  }

  candidates.sort((left, right) => {
    return left.lesson - right.lesson || left.sourceIndex - right.sourceIndex;
  });

  return { candidates, duplicates, excluded, sourceRows: sourceGuids.size };
}

async function main(arguments_ = process.argv.slice(2)) {
  const { check, limit } = parseArguments(arguments_);
  const [source, vocabulary] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(vocabularyPath, "utf8").then(JSON.parse)
  ]);
  const tokenizerBuilder = new TokenizerBuilder();

  tokenizerBuilder.setDictionary("embedded://ipadic");
  tokenizerBuilder.setMode("normal");

  const result = prepareImport(parseCsv(source), vocabulary, tokenizerBuilder.build());
  const additions = result.candidates.slice(0, limit).map(publicEntry);

  console.log(
    `Open Anki N4 ${sourceCommit.slice(0, 7)}: ${result.sourceRows} rows, ` +
    `${result.duplicates.length} already present, ${result.excluded.length} grammar exclusions, ` +
    `${result.candidates.length} importable.`
  );

  if (check) {
    if (result.candidates.length > 0) {
      throw new Error(`${result.candidates.length} importable N4 vocabulary rows are missing.`);
    }

    return;
  }

  if (additions.length === 0) {
    console.log("No N4 vocabulary entries need importing.");
    return;
  }

  await writeFile(
    vocabularyPath,
    `${JSON.stringify(mergeVocabulary(vocabulary, additions), null, 2)}\n`
  );
  console.log(`Imported ${additions.length} N4 vocabulary entries.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

export {
  excludedGrammar,
  mergeVocabulary,
  mergedDuplicateTerms,
  normalizeReading,
  parseArguments,
  parseCsv,
  prepareImport,
  sourceCommit,
  voiceSlugOverrides,
  vocabularyId,
  vocabularyKey
};
