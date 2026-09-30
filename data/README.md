# ChakuChaku curriculum levels

`curriculum.json` defines the ordered curriculum levels understood by the app.
Knowledge units use `introducedAt` for the first level at which they enter the
curriculum. An N5 unit remains useful at N4 and above, so entries carry one
introduction level rather than a repeated list of every later level.

The content `scope` remains an independent editorial classification: for
example, a `foundation` grammar point can still be introduced at `n5`, while
Hiragana and Katakana knowledge units belong to the curriculum level
`foundation`. Prepared grammar exercises declare a derived `minimumLevel`;
authors may raise it for a structurally harder sentence, and content preparation
rejects an explicit level below any grammar, vocabulary, or Kanji unit it
references.

The manifest enables N5 and the first N4 content slice while keeping N5 as the
default for existing learners. Enabling N4 did not change existing IDs or stored
SRS cards. The learner's selected target level controls which unseen units may
enter study; cards that already exist in SRS, plus encountered material above a
subsequently lowered target, remain available.

New grammar, conjugation, vocabulary, and Kanji units enter in authored array
order under a configurable daily pace. A card stores its first
`introduced_at` timestamp separately from FSRS review dates, so reloads keep the
same pending cohort and legacy cards do not retroactively consume today's
quota. Kana stay in the `foundation` layer and use vocabulary through the
selected target level without their own introduction quota.

# Grammar inventory

`jlpt-n5-grammar.json` is the canonical curriculum for the app; its filename is
retained for compatibility even though entries now span N5 and N4. It is
deliberately a flat array: categories are labels on entries, not nested sections.
Stable `id` values key lessons, exercises, and user progress.

`grammar-coverage.md` is the generated flat checklist for exercise planning. A
checked bullet means at least one authored exercise meaningfully assesses that
point and records its ID; the bullet also lists every matching exercise.
Coverage measures deliberate practice, not mastery. Run `npm run content` after
editing exercises to update it rather than editing the checklist directly.

Recognition exercises must list at least two grammar points that drive their
intended translation challenge. Production exercises may isolate one grammar
point in a shorter, lower-difficulty prompt; otherwise, two to four is the
normal range. A denser exercise may retain more when every point is independently
meaningful. Incidental foundations, routine conjugation machinery, and secondary
structures are omitted. This remains an editorial step because tokenization can
identify word forms, but cannot decide what an exercise meaningfully assesses.

Exercise fields are semantic: `text` is always the displayed prompt and
`solution` is always the reference answer. Omitting `type` creates a
`recognition` exercise with a Japanese prompt and English answer. Setting
`type: "production"` creates an English prompt and Japanese answer. Content
generation still tokenizes the Japanese side for vocabulary and kanji tracking.
During local testing, `?type=production` restricts selection to production
exercises without creating a persistent setting.

Production exercises may add `promptVocabularyHints`, mapping individual
English prompt words to one or more IDs from the vocabulary dictionary. These
authored links handle ambiguous words such as `take` without duplicating
Japanese terms or readings in exercise data. The UI shows dictionary forms on
hover and leaves conjugation to the learner.

Exercises adapted from an external corpus carry an `attribution` object with
the provider, sentence URL, creator, and licence. Sourced Japanese sentences
currently come from Tatoeba under CC BY 2.0 FR. Their English and French answers
are independently authored for ChakuChaku.

Each grammar-point entry contains only scalar fields:

- `category`: a filterable curriculum area.
- `kind`: concept, form, particle, pattern, expression, structure, or system.
- `pattern`: the Japanese form or an abstract formation.
- `highlightPattern` (optional): a Japanese locator used only to derive the
  inline highlight when the displayed `pattern` is too abstract or describes
  several formations. A leading `～` allows a match inside an inflected token.
- `name`: a concise English label.
- `meaning`: the learning objective.
- `scope`: `foundation`, `core`, or `boundary`.

There is no official itemized JLPT grammar syllabus. This inventory synthesizes
the shared conversation with the official JLPT N5 test-item descriptions and
the N5 curricula published by Bunpro, JLPT Sensei, and Yatta. `boundary` keeps
useful points that sources variously place at N5 or N4 without presenting them
as undisputed N5 requirements.

The first N4 slice contains 15 high-value points and 29 independently authored
recognition and production exercises: plain volitional and `～ようと思う`,
potential and passive usage, `～ことにする`, `～ことになる`, `～はずだ`,
`～はずがない`, `～やすい`, `～にくい`, `～ていく`, `～てくる`, `～間`,
`～間に`, and `～なら`. It is a conservative intersection informed by the
official N4 test-purpose description and the N4 curricula published by Bunpro
and JLPT Sensei; it is not presented as an official itemized list:

- https://www.jlpt.jp/e/guideline/pdf/n4_e.pdf
- https://bunpro.jp/decks/m7omkx/bunpro-n4-grammar
- https://jlptsensei.com/jlpt-n4-grammar-list/

`source/n4-grammar-inventory.json` records the complete editorial audit before
the remaining points enter the live SRS. It currently maps 52 semantic families
to grammar already taught by ChakuChaku and defines 83 missing points: 68 core
and 15 boundary items. The companion French catalogue contains original names
and learning objectives for every planned point. Candidates that are lexical,
already produced by simpler rules, or insufficiently supported are retained in
the audit with an explicit reason instead of silently disappearing.

The audit date and source-reference policy are stored in the inventory itself.
Per-entry `sourceRefs` provide non-exhaustive supporting evidence rather than a
claim that every occurrence in every curriculum was mapped. The official JLPT
description supplies the ability scope, while Bunpro serves as a broad coverage
benchmark; neither is an official itemized grammar syllabus.

This staging file deliberately does not affect Statistics or exercise
selection. Planned points move into the canonical grammar and French catalogues
only together with reviewed exercises, so the live curriculum never contains
an SRS unit that the learner cannot practise.

Writing systems, vocabulary, and kanji are excluded because this file is the
grammar curriculum. Grammar-dependent counting, time, and question systems are
included.

## Conjugation curriculum

`jlpt-n5-conjugation.json` assigns 48 verbs and 80 adjectives from the shared
vocabulary inventory to an inflection class. Verbs use godan, ichidan, `する`,
or `来る`, with the `行く` て-form exception. Adjectives use regular い,
irregular `いい` (including compounds), or な. `いかが` is not treated as an
inflecting adjective, while `ない` is omitted because requesting its negative
would create an unnatural double-negative drill.

The browser combines these entries with the rules in `conjugation.js`, producing
exercises for 88 stable SRS points rather than one card per word-and-form pair:
62 verb rules, including plain forms, `～ば`, class-specific polite and plain
volitional forms, potential forms, and passive forms, plus 26 adjective rules
covering plain, regular, irregular, and adverbial transformations. The 12 new
verb points enter at N4. When an ichidan or `来る` potential and passive have the
same written form and pronunciation, their SRS cards remain distinct while the
audio file is safely shared. The affirmative `いいです` shares the regular
`～いです` point. Per-word `excludedForms` prevent misleading mechanical drills;
for example, 分かる does not receive the unrelated potential-looking form 分かれる.

## Multi-level vocabulary inventory

`jlpt-n5-vocabulary.json` is a flat synthetic vocabulary inventory; its legacy
filename is retained for stored-data and tooling compatibility. There is no
official current word list: the JLPT organizers explain that they stopped
publishing vocabulary, kanji, and grammar specifications after the 2010 revision
because the test is intended to measure communicative use rather than memorized
lists.

The inventory currently contains 1,483 entries: 868 introduced at N5 and 615
introduced at N4.

- 719 N5 `core` entries adapted from the MIT-licensed Open Anki decks at commit
  `1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0`. This includes `日（ひ）`, which
  the N4 source labels later but the existing N5 exercises already teach.
- 611 N4 `core` entries imported from that commit's 668-row N4 snapshot. The
  importer merges 43 entries already represented in the app and excludes 14
  grammar constructions that belong in grammar or conjugation rather than the
  vocabulary SRS. Its combined `回る、回す` row is deliberately expanded into
  separate intransitive and transitive SRS units.
- 3 `core` Katakana entries restored by comparison with the former JLPT Level 4
  vocabulary specification: `グラス`, `コピー`, and `スリッパ`.
- 1 contextual core entry, `田んぼ`, added to give the initial Kanji curriculum
  a natural complete-word exercise for `田`.
- 4 curated N4 core entries: `間`, required by the first N4 grammar exercises;
  practical Katakana word `ボール`; and consensus-list gaps `引き出す` and
  `降り出す`.
- 145 `supplemental` entries: 42 recognizable and motivating beginner words,
  29 words needed by the current lessons, 37 words curated for practical
  Katakana coverage, 13 essential A1 expressions and everyday words, and 14
  useful words promoted from the Kanji exercise contexts, plus 10 practical
  gaps identified through mock-test review. These
  include `ラーメン`, `寿司`, `アニメ`, `漫画`, greetings, food, travel, culture,
  modern technology, and everyday loanwords.

The `core` label means "exam-oriented consensus candidate," not "officially
required." The `supplemental` label keeps useful lesson vocabulary without
inflating claims about the exam. This is why a familiar word can be retained
even when older exam-preparation lists omit it.

Each entry contains:

- `id`: a stable content-derived identifier.
- `term`: the preferred Japanese written form.
- `reading`: the kana reading, normalized to hiragana where applicable.
- `alternateReadings`: optional additional readings accepted by vocabulary recall.
- `acceptedJapaneseAnswers`: optional equivalent Japanese expressions accepted
  during recall without treating them as alternate written forms.
- `meaning`: a concise English gloss.
- `partOfSpeech`: a broad app-friendly grammatical category.
- `scope`: `core` or `supplemental`.
- `source`: the origin of the entry.
- `audio`: an optional `assets/voices/vocab/*.m4a` pronunciation used by kana exercises.
- `voiceSlug`: a stable semantic suffix such as `ame-rain` or `ame-candy` for
  colliding romanized readings. One pre-existing entry may retain its legacy
  unsuffixed audio path while every newly colliding entry receives a suffix.
- `variants`: optional alternative written forms.
- `inflections`: optional surface/reading pairs for tokenizer ambiguity.
- `topic`: an optional topic on curated supplemental entries.

The upstream MIT notice is retained in
`licenses/open-anki-jlpt-decks-MIT.txt`. Sources used to establish the size and
scope of the synthetic list:

- https://www.jlpt.jp/e/faq/ (no official post-2010 vocabulary specification)
- https://github.com/jamsinclair/open-anki-jlpt-decks (open N5 and N4 datasets)
- https://www.mlcjapanese.co.jp/n5_04_01.html (about 800 words; 802-item study list)
- https://www.tanos.co.uk/jlpt/jlpt5/ (689-word N5 study list)

The N4 layer was additionally cross-checked on 2026-09-29 against the 571-word
JLPT Sensei list, the 640-word Hirakata list, the 629-word Kanzen list, and the
broader 827-word Nihon Torii list. Hirakata and Kanzen both descend from older
community/Tanos material, so agreement between them is not treated as fully
independent evidence. The comparison motivated the separate `回る` / `回す`
cards and the curated `引き出す` / `降り出す` additions.

- https://jlptsensei.com/jlpt-n4-vocabulary-list/
- https://hirakata.io/vocab/n4/
- https://kanzenkanji.com/vocabulary/jlpt/n4
- https://www.nihontorii.com/jlpt/n4/vocabulary

`source/open-anki-jlpt-n4.csv` is the pinned N4 input. Run
`npm run vocabulary:n4:check` to prove that every row is imported, merged, or
deliberately excluded, and `npm run vocabulary:n4:import` after replacing the
snapshot. The importer preserves source ordering (with Genki-tagged rows first),
normalizes readings, assigns stable content-derived IDs, resolves known source
errors, and protects existing audio filenames when a new homophone appears.

`katakana-vocabulary.md` documents the Katakana pool, its exact selection
rules, additions, source comparisons, and kana coverage. It uses the former
Level 4 Katakana subset as the exam-oriented baseline, then adds a small
beginner layer cross-checked against Irodori and Marugoto A1 materials.

## Multi-level kanji inventory

`source/kanji-curricula.json` declares one curriculum and mnemonic source pair
per active study level, so adding a later level does not require another
hard-coded loader. `jlpt-n5-kanji.json` retains its legacy filename but is now a flat cumulative
N5–N4 inventory. Its foundation is the exact 209-character curriculum that
Rikkyo University describes as equivalent to JLPT N5: 73 `B6`, 68 `B5`, and 68
`B4` characters. `source/jlpt-n4-kanji.json` pins Kanzen's 170-character N4
study list; 91 were already in that broad foundation, so the `N4` stage adds 79
characters for 288 total. These are coherent study curricula, not official JLPT
specifications; the JLPT has not published an itemized kanji list since 2010.

Each entry has a stable Unicode-based `id`, one `character`, a concise English
`meaning`, its Rikkyo `stage`, and `onReadings` / `kunReadings` arrays. The exact
stage membership is stored in `source/rikkyo-n5-kanji.json` and
`source/jlpt-n4-kanji.json`. Meanings and
Japanese readings are generated from current KANJIDIC2 data. When a standalone
core vocabulary entry exists, its learner-oriented meaning takes precedence.
Readings are limited to forms evidenced by vocabulary available through the
character's own level; a single
dictionary reading is retained as a fallback when the vocabulary has no usable
evidence. Readings use hiragana stems and are intentionally not exhaustive.
Irregular whole-word readings such as 今日（きょう）remain vocabulary data.

`kanji-contexts.json` contains a small set of complete example words for
characters that have no suitable core-vocabulary context. They make all 288
characters exercisable but remain separate from the vocabulary
curriculum and its SRS. French display meanings live in
`locales/fr/kanji-contexts.json`.

`source/kanji-mnemonics.json` provides original memory aids for the 209-character
foundation, and `source/n4-kanji-mnemonics.json` does the same for the 79-character
N4 delta. Each entry combines a learner-facing visual decomposition, a
short story linking those components to the meaning, one or more useful
reading mnemonics, and an anchor ID per reading from the vocabulary or
kanji-context inventory. `source/kanji-components.json` assigns one stable
English keyword to every component symbol, so a symbol never changes meaning
between cards. Reading mnemonics prioritize the reading used by their anchor
and add a second family only when it has clear beginner value; they are not intended as
an exhaustive dictionary reading list. When a compound changes the sound by
contraction or voicing, the reading story must explicitly connect the canonical
reading to the anchor's surface reading. These are visual learning stories, not
claims about historical character etymology.

French mnemonic prose lives in `source/locales/fr/kanji-mnemonics.json` and
`source/locales/fr/n4-kanji-mnemonics.json`, while the stable French component
keywords live in `source/locales/fr/kanji-components.json`. The compact mnemonic
localization contains only independently authored stories. The preparation step
inherits component symbols, kana readings, and per-reading anchor IDs from the
canonical English source, then writes the complete browser-ready structures to
`kanji-mnemonics.json` and
`locales/fr/kanji-mnemonics.json`. Content validation requires exact 288-kanji
coverage, exact component-key coverage, valid anchor pronunciation placement,
and matching reading counts.

`source/vocabulary-examples.json` provides one short contextual sentence for
every core vocabulary item and kanji-only context. The prepared version adds
tokenization and furigana metadata, and is shown after both vocabulary and
kanji answers. French translations live in
`source/locales/fr/vocabulary-examples.json`.

Run `npm run kanji:update` to download current KANJIDIC2 data and regenerate the
flat inventory. For an already downloaded XML or XML.GZ file, run
`npm run kanji:update -- --source /path/to/kanjidic2.xml.gz`.
The corresponding reproducibility check is
`npm run kanji:update -- --check --source /path/to/kanjidic2.xml.gz`.

Sources and licences:

- https://www.jlpt.jp/e/faq/ (no official post-2010 kanji specification)
- https://cjle.rikkyo.ac.jp/SitePages/pdf/kanji1.pdf (B6-B4 curriculum)
- https://kanzenkanji.com/kanji/jlpt/n4 (primary 170-character N4 reference)
- https://jlptsensei.com/jlpt-n4-kanji-list/ (167-character cross-check)
- https://www.edrdg.org/wiki/KANJIDIC_Project.html (meanings and readings)
- https://kanjivg.tagaini.net/ (reference for visual component boundaries)
- `../licenses/KANJIDIC2-NOTICE.txt` and
  `../licenses/KANJIDIC2-CC-BY-SA-4.0.txt`
- `../licenses/KanjiVG-NOTICE.txt` and
  `../licenses/KanjiVG-CC-BY-SA-3.0.txt`

## Static lesson assets

Authored introduction and exercise data lives in `source/`. Lessons do not
contain local vocabulary lists, readings, or gloss maps. Run `npm run content`
after editing them. This tokenizes every sentence, searches the full dictionary,
narrows candidates by part of speech, and writes the discovered vocabulary IDs
into the browser-ready lesson and tokens. It also derives the unique curriculum
kanji IDs found in each sentence. At runtime, `app.js` obtains tooltip meanings
directly from `jlpt-n5-vocabulary.json` and Statistics metadata from
`jlpt-n5-kanji.json`.

Curated `inflections` supply exact surface readings. The optional
`allowPartOfSpeechMismatch` flag marks the rare form where Lindera assigns a
different part of speech; mismatch permission is never inferred for every
inflection.

If a surface form still has multiple compatible dictionary entries, the build
fails with all candidates. Add a `vocabularyOverrides` surface-to-ID mapping to
that source lesson only. Append an occurrence such as `#2` when repeated forms
need different meanings. Invalid, unused, and redundant overrides also fail so
temporary disambiguation does not accumulate unnoticed.

Use `tokenOverrides` for a category or reading correction that applies only to
one authored sentence. It uses the same surface and optional `#2` occurrence
keys as `vocabularyOverrides`. Invalid, unused, and redundant token overrides
fail content generation, keeping exceptions visible in lesson data rather than
accumulating phrase-specific branches in the tokenizer.

Run `npm run voices` to restore cached voices or generate any missing narration
through OpenAI. The generated WAV response is checked for silence and plausible
duration before it is compressed to mono AAC-LC in an M4A container. Available
M4A files under `assets/voices/grammar/` and `assets/voices/vocab/` are committed
with the application.
The API key is read only by this development command, from `OPENAI_API_KEY` or
`.key`; the browser app and static preview server do not read it or call OpenAI.

`npm run generate` prepares both the content and voices. `npm start` serves a
static local preview.

Sources consulted on 2026-08-08:

- https://www.jlpt.jp/e/faq/
- https://www.jlpt.jp/e/guideline/pdf/n5_e.pdf
- https://bunpro.jp/decks/nn10ai/Bunpro-N5-Grammar
- https://jlptsensei.com/jlpt-n5-grammar-list/
- https://www.yattajlpt.com/grammar/n5
