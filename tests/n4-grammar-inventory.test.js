import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(
  new URL(`../${path}`, import.meta.url),
  "utf8"
));

test("the N4 grammar audit maps integrated families to stable grammar points", async () => {
  const [grammar, inventory] = await Promise.all([
    readJson("data/jlpt-n5-grammar.json"),
    readJson("data/source/n4-grammar-inventory.json")
  ]);
  const grammarIds = new Set(grammar.map(({ id }) => id));
  const sourceIds = new Set(Object.keys(inventory.sources));
  const integratedIds = new Set();
  const mappedGrammarIds = new Set();

  assert.equal(inventory.version, 1);
  assert.match(inventory.auditedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(inventory.sourceRefPolicy.includes("non-exhaustive"));
  assert.ok(inventory.integrated.length > 0);

  for (const entry of inventory.integrated) {
    assert.equal(typeof entry.id, "string");
    assert.ok(entry.id);
    assert.ok(!integratedIds.has(entry.id), `Duplicate integrated family ${entry.id}`);
    assert.ok(Array.isArray(entry.grammarPointIds) && entry.grammarPointIds.length > 0);
    assert.ok(entry.grammarPointIds.every((id) => grammarIds.has(id)));
    assert.ok(Array.isArray(entry.sourceRefs) && entry.sourceRefs.length > 0);
    assert.ok(entry.sourceRefs.every((id) => sourceIds.has(id)));
    integratedIds.add(entry.id);

    for (const grammarPointId of entry.grammarPointIds) {
      assert.ok(
        !mappedGrammarIds.has(grammarPointId),
        `${grammarPointId} is assigned to more than one N4 inventory family`
      );
      mappedGrammarIds.add(grammarPointId);
    }
  }

  assert.deepEqual(
    grammar.filter(({ introducedAt }) => introducedAt === "n4")
      .map(({ id }) => id)
      .filter((id) => !mappedGrammarIds.has(id)),
    []
  );
});

test("the completed N4 audit has no unpromoted grammar definitions", async () => {
  const [inventory, french] = await Promise.all([
    readJson("data/source/n4-grammar-inventory.json"),
    readJson("data/source/locales/fr/n4-grammar-inventory.json")
  ]);
  const plannedIds = inventory.planned.map(({ id }) => id);

  assert.deepEqual(plannedIds, []);
  assert.deepEqual(french, {});
});

test("the documented inventory summary and source roles stay in sync", async () => {
  const [inventory, readme] = await Promise.all([
    readJson("data/source/n4-grammar-inventory.json"),
    readFile(new URL("../data/README.md", import.meta.url), "utf8")
  ]);
  const core = inventory.planned.filter(({ scope }) => scope === "core").length;
  const boundary = inventory.planned.filter(({ scope }) => scope === "boundary").length;

  assert.deepEqual(inventory.summary, {
    integratedFamilies: inventory.integrated.length,
    plannedPoints: inventory.planned.length,
    plannedCore: core,
    plannedBoundary: boundary,
    excludedCandidateGroups: inventory.excludedCandidates.length
  });
  assert.ok(readme.includes(
    `maps ${inventory.integrated.length} semantic families\n` +
    `to grammar already taught by ChakuChaku and defines ${inventory.planned.length} missing points: ${core} core\n` +
    `and ${boundary} boundary items.`
  ));

  const evidenceRefs = new Set([
    ...inventory.contextSourceRefs,
    ...inventory.coverageBenchmarkRefs,
    ...inventory.integrated.flatMap(({ sourceRefs }) => sourceRefs),
    ...inventory.planned.flatMap(({ sourceRefs }) => sourceRefs)
  ]);
  assert.deepEqual([...evidenceRefs].sort(), Object.keys(inventory.sources).sort());
});

test("tricky N4 attachment patterns retain their reviewed distinctions", async () => {
  const grammar = await readJson("data/jlpt-n5-grammar.json");
  const grammarById = Object.fromEntries(grammar.map((entry) => [entry.id, entry]));

  assert.match(grammarById["causative-passive-form"].pattern, /～される/);
  assert.match(grammarById["imperative-form"].pattern, /～よ/);
  assert.match(grammarById["imperative-form"].pattern, /せよ/);
  assert.match(grammarById["tara-dou"].pattern, /～だらどう/);
  assert.match(grammarById["hitsuyou-ga-aru"].pattern, /必要はない/);
  assert.match(grammarById["you-to-suru"].highlightPattern, /～ろうとする/);
  assert.match(grammarById["te-hoshii"].pattern, /～ないでほしい/);
  assert.match(grammarById["te-sumimasen"].pattern, /～なくてすみません/);
  assert.match(grammarById["ru-tokoro"].highlightPattern, /～るところ/);
  assert.match(grammarById["teiru-tokoro"].highlightPattern, /～ているところ/);
  assert.match(grammarById["ta-tokoro"].highlightPattern, /～たところ/);
  assert.match(grammarById["you-da-inference"].pattern, /な-adjective \+ なようだ/);
  assert.match(grammarById["you-da-inference"].pattern, /noun \+ のようだ/);
  assert.match(grammarById["you-na-ni-simile"].pattern, /な-adjective \+ なような/);
  assert.match(grammarById["noni-concession"].pattern, /な-adjective \/ noun \+ なのに/);
  assert.match(grammarById["tame-ni-purpose"].pattern, /dictionary form/);
  assert.match(grammarById["tame-ni-cause"].pattern, /plain form/);
  assert.match(grammarById["no-wa-da"].pattern, /のは～だ/);
  assert.match(grammarById["you-ni-to-iu"].pattern, /ない form/);
  assert.match(grammarById["adjective-sa"].pattern, /adjective stem/);
  assert.match(grammarById["baai-wa"].pattern, /な-adjective \+ な場合は/);
  assert.match(grammarById["baai-wa"].pattern, /noun \+ の場合は/);
  assert.equal(grammarById.mama.scope, "boundary");
  assert.match(grammarById.mama.pattern, /Vた \/ Vない/);
  assert.match(grammarById.mama.pattern, /な-adjective \+ なまま/);
  assert.match(grammarById["stem-dasu"].meaning, /Lexical compounds/);
  assert.equal(grammarById["te-kudasaru"].name, "Honorific benefactive action");
  assert.match(grammarById["kana-wonder"].pattern, /かな/);
  assert.match(grammarById["kashira-wonder"].meaning, /feminine speech/);
  assert.match(grammarById["kai-question"].meaning, /masculine or older speech/);
  assert.match(grammarById["dewa-nai-ka"].pattern, /じゃないか/);
});

test("audited exclusions remain explicit instead of silently disappearing", async () => {
  const inventory = await readJson("data/source/n4-grammar-inventory.json");

  assert.ok(Array.isArray(inventory.excludedCandidates));
  assert.ok(inventory.excludedCandidates.length > 0);

  for (const entry of inventory.excludedCandidates) {
    assert.ok(Array.isArray(entry.forms) && entry.forms.length > 0);
    assert.ok(entry.forms.every((form) => typeof form === "string" && form));
    assert.equal(typeof entry.classification, "string");
    assert.ok(entry.classification);
    assert.equal(typeof entry.reason, "string");
    assert.ok(entry.reason);
  }
});
