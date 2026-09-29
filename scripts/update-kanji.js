import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import { normalizeReading, surfaceCarriesReading } from "./kanji-reading-evidence.js";

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = join(rootDirectory, "data", "source");
const curriculumManifestPath = join(rootDirectory, "data", "curriculum.json");
const curriculumSourcesPath = join(sourceDirectory, "kanji-curricula.json");
const vocabularyPath = join(rootDirectory, "data", "jlpt-n5-vocabulary.json");
const contextPath = join(rootDirectory, "data", "kanji-contexts.json");
const outputPath = join(rootDirectory, "data", "jlpt-n5-kanji.json");
const kanjidicUrl = "https://www.edrdg.org/kanjidic/kanjidic2.xml.gz";
const checkOnly = process.argv.includes("--check");
const sourceArgumentIndex = process.argv.indexOf("--source");
const sourcePath = sourceArgumentIndex === -1
  ? undefined
  : process.argv[sourceArgumentIndex + 1];

if (sourceArgumentIndex !== -1 && !sourcePath) {
  throw new Error("--source needs a KANJIDIC2 XML or XML.GZ path.");
}

function asArray(value) {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function unique(values) {
  return [...new Set(values)];
}

function uniqueByReading(values, foldVoicing = false) {
  const seen = new Set();

  return values.filter((value) => {
    const normalized = normalizeForComparison(value, foldVoicing);

    if (seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
}

function removeReadingPrefixes(readings, foldVoicing = false) {
  return readings.filter((reading) => {
    const normalized = normalizeForComparison(reading, foldVoicing);

    return !readings.some((candidate) => {
      const normalizedCandidate = normalizeForComparison(candidate, foldVoicing);
      return normalizedCandidate.length > normalized.length &&
        normalizedCandidate.startsWith(normalized);
    });
  });
}

function getNodeText(node) {
  return typeof node === "string" ? node : node?.["#text"];
}

function normalizeOnReading(reading) {
  return normalizeReading(reading.replaceAll("-", ""));
}

function normalizeKunReading(reading) {
  return reading.replace(/^-/, "").split(".")[0].replace(/-$/, "");
}

function normalizeForComparison(text, foldVoicing) {
  return normalizeReading(text, { foldVoicing });
}

function isWholeWordReading(entry, reading = entry?.reading) {
  return Array.isArray(entry?.specialReadings) && entry.specialReadings.some((note) => {
    return note?.type === "whole-word" && note.reading === reading;
  });
}

function createVocabularyForms(vocabulary) {
  return vocabulary.flatMap((entry) => {
    if (isWholeWordReading(entry)) {
      return [];
    }

    return [
      { surface: entry.term, reading: entry.reading },
      ...(entry.variants || []).map((surface) => ({ surface, reading: entry.reading })),
      ...(entry.inflections || [])
    ];
  });
}

function hasReadingEvidence(
  character,
  reading,
  vocabularyForms,
  foldVoicing = false
) {
  return vocabularyForms.some((form) => {
    return surfaceCarriesReading(
      form.surface,
      form.reading,
      character,
      reading,
      { foldVoicing }
    );
  });
}

async function loadKanjidicXml() {
  if (sourcePath) {
    const contents = await readFile(sourcePath);
    return extname(sourcePath) === ".gz" ? gunzipSync(contents).toString("utf8") : contents.toString("utf8");
  }

  const response = await fetch(kanjidicUrl);

  if (!response.ok) {
    throw new Error(`KANJIDIC2 download failed with HTTP ${response.status}.`);
  }

  return gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");
}

const [curriculumManifest, curriculumSourceManifest, vocabulary, contexts, xml] = await Promise.all([
  readFile(curriculumManifestPath, "utf8").then(JSON.parse),
  readFile(curriculumSourcesPath, "utf8").then(JSON.parse),
  readFile(vocabularyPath, "utf8").then(JSON.parse),
  readFile(contextPath, "utf8").then(JSON.parse),
  loadKanjidicXml()
]);
const rankByLevel = new Map(
  curriculumManifest.levels.map(({ id, rank }) => [id, rank])
);
const expectedLevelIds = curriculumManifest.levels
  .filter(({ id }) => id !== "foundation")
  .map(({ id }) => id);
const declaredLevelIds = Array.isArray(curriculumSourceManifest)
  ? curriculumSourceManifest.map(({ level }) => level)
  : [];

if (
  !Array.isArray(curriculumSourceManifest) ||
  curriculumSourceManifest.length === 0 ||
  curriculumSourceManifest.some(({ level, curriculumSource, curriculumFormat }) => (
    !rankByLevel.has(level) ||
    typeof curriculumSource !== "string" ||
    !["stages", "reference"].includes(curriculumFormat)
  )) ||
  new Set(declaredLevelIds).size !== declaredLevelIds.length ||
  expectedLevelIds.some((level) => !declaredLevelIds.includes(level)) ||
  declaredLevelIds.some((level) => !expectedLevelIds.includes(level))
) {
  throw new Error("Kanji curriculum sources are invalid.");
}

const curriculumSources = await Promise.all(curriculumSourceManifest
  .toSorted((left, right) => rankByLevel.get(left.level) - rankByLevel.get(right.level))
  .map(async (descriptor) => ({
    descriptor,
    source: JSON.parse(await readFile(
      join(sourceDirectory, descriptor.curriculumSource),
      "utf8"
    ))
  })));
const seenCurriculumCharacters = new Set();
const curriculum = curriculumSources.flatMap(({ descriptor, source }) => {
  const stages = descriptor.curriculumFormat === "stages"
    ? source
    : [{
        stage: source.stage,
        meaningOverrides: source.meaningOverrides,
        characters: source.characters
      }];

  if (
    !Array.isArray(stages) ||
    stages.some(({ stage, characters }) => (
      typeof stage !== "string" || typeof characters !== "string"
    ))
  ) {
    throw new Error(`${descriptor.curriculumSource} has invalid kanji stages.`);
  }

  return stages.map((stage) => {
    const characters = [...stage.characters]
      .filter((character) => {
        if (seenCurriculumCharacters.has(character)) {
          return false;
        }

        seenCurriculumCharacters.add(character);
        return true;
      })
      .join("");

    return {
      ...stage,
      introducedAt: descriptor.level,
      characters
    };
  });
});
const vocabularyEntries = [...vocabulary, ...contexts];
const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true
});
const kanjidic = parser.parse(xml).kanjidic2;
const entriesByCharacter = new Map(
  kanjidic.character.map((entry) => [entry.literal, entry])
);
const result = [];
const seenCharacters = new Set();

for (const stage of curriculum) {
  const availableVocabulary = vocabularyEntries.filter((entry) => {
    const entryRank = rankByLevel.get(entry.introducedAt);
    const stageRank = rankByLevel.get(stage.introducedAt);

    return entryRank !== undefined && entryRank <= stageRank;
  });
  const vocabularyForms = createVocabularyForms(availableVocabulary);

  for (const character of stage.characters) {
    if (seenCharacters.has(character)) {
      throw new Error(`${character} appears more than once in the kanji curriculum.`);
    }

    const source = entriesByCharacter.get(character);

    if (!source) {
      throw new Error(`${character} is missing from KANJIDIC2.`);
    }

    const readingGroups = asArray(source.reading_meaning?.rmgroup);
    const readings = readingGroups.flatMap((group) => asArray(group.reading));
    const meanings = readingGroups
      .flatMap((group) => asArray(group.meaning))
      .filter((meaning) => typeof meaning === "string");
    const vocabularyMeaning = availableVocabulary.find((entry) => {
      return entry.scope === "core" && entry.term === character;
    })?.meaning;
    const allOnReadings = unique(readings
      .filter((reading) => reading?.["@_r_type"] === "ja_on")
      .map(getNodeText)
      .filter(Boolean)
      .map(normalizeOnReading));
    const kunReadingCandidates = readings
      .filter((reading) => reading?.["@_r_type"] === "ja_kun")
      .map(getNodeText)
      .filter(Boolean);
    const allKunReadings = uniqueByReading(
      kunReadingCandidates.map(normalizeKunReading),
      true
    );
    const preserveLegacyVoicing = stage.introducedAt === "n5";
    let onReadings = removeReadingPrefixes(allOnReadings.filter((reading) => {
      return hasReadingEvidence(
        character,
        reading,
        vocabularyForms,
        preserveLegacyVoicing
      );
    }), preserveLegacyVoicing);
    let kunReadings = uniqueByReading(kunReadingCandidates
      .filter((reading) => {
        const normalized = normalizeKunReading(reading);
        return hasReadingEvidence(
          character,
          normalized,
          vocabularyForms,
          preserveLegacyVoicing
        );
      })
      .map(normalizeKunReading), preserveLegacyVoicing);
    if (!preserveLegacyVoicing) {
      const onReadingSet = new Set(onReadings);
      kunReadings = kunReadings.filter((reading) => !onReadingSet.has(reading));
    }
    kunReadings = kunReadings.filter((reading) => {
      const normalized = normalizeForComparison(reading, true);

      if ([...reading].length !== 1) {
        return true;
      }

      return !vocabularyForms.some((form) => {
        const surface = form.surface.replace(/[～〜]/gu, "");
        const wordReading = normalizeForComparison(
          form.reading.replace(/[～〜]/gu, ""),
          true
        );

        return surface === character &&
          wordReading !== normalized &&
          wordReading.startsWith(normalized);
      });
    });
    const codePoint = character.codePointAt(0).toString(16).padStart(4, "0");

    if (onReadings.length + kunReadings.length === 0) {
      onReadings = allOnReadings.slice(0, 1);

      if (onReadings.length === 0) {
        kunReadings = allKunReadings.slice(0, 1);
      }
    }

    if (meanings.length === 0 || onReadings.length + kunReadings.length === 0) {
      throw new Error(`${character} has incomplete KANJIDIC2 metadata.`);
    }

    seenCharacters.add(character);
    result.push({
      id: `kanji-${codePoint}`,
      character,
      meaning: stage.meaningOverrides?.[character] || vocabularyMeaning || meanings[0],
      stage: stage.stage,
      introducedAt: stage.introducedAt,
      onReadings,
      kunReadings
    });
  }
}

const serialized = `${JSON.stringify(result, null, 2)}\n`;

if (checkOnly) {
  const current = await readFile(outputPath, "utf8");

  if (current !== serialized) {
    throw new Error(
      "Kanji metadata is stale. Run npm run kanji:update with the same KANJIDIC2 source."
    );
  }
} else {
  await writeFile(outputPath, serialized);
}

console.log(
  `${checkOnly ? "Checked" : "Updated"} ${result.length} kanji from KANJIDIC2 ${kanjidic.header.date_of_creation}.`
);
