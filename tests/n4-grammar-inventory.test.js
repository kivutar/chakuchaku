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

test("planned N4 grammar definitions are unique, localized, and ready for promotion", async () => {
  const [grammar, inventory, french] = await Promise.all([
    readJson("data/jlpt-n5-grammar.json"),
    readJson("data/source/n4-grammar-inventory.json"),
    readJson("data/source/locales/fr/n4-grammar-inventory.json")
  ]);
  const grammarIds = new Set(grammar.map(({ id }) => id));
  const sourceIds = new Set(Object.keys(inventory.sources));
  const plannedIds = inventory.planned.map(({ id }) => id);

  assert.equal(new Set(plannedIds).size, plannedIds.length);
  assert.deepEqual(Object.keys(french).sort(), [...plannedIds].sort());

  for (const entry of inventory.planned) {
    assert.ok(!grammarIds.has(entry.id), `${entry.id} is already integrated`);
    assert.equal(entry.introducedAt, "n4");
    assert.ok(["core", "boundary"].includes(entry.scope));
    assert.ok(["concept", "form", "particle", "pattern", "system"].includes(entry.kind));

    for (const field of ["id", "category", "pattern", "name", "meaning"]) {
      assert.equal(typeof entry[field], "string");
      assert.ok(entry[field].trim(), `${entry.id} needs ${field}`);
    }

    assert.ok(Array.isArray(entry.sourceRefs) && entry.sourceRefs.length > 0);
    assert.ok(entry.sourceRefs.every((id) => sourceIds.has(id)));
    assert.equal(typeof french[entry.id]?.name, "string");
    assert.ok(french[entry.id].name.trim());
    assert.equal(typeof french[entry.id]?.meaning, "string");
    assert.ok(french[entry.id].meaning.trim());
  }

  for (const requiredId of [
    "causative-form",
    "ba-conditional",
    "te-oku",
    "you-ni-naru",
    "noni-concession",
    "sonkeigo-system"
  ]) {
    assert.ok(plannedIds.includes(requiredId), `Missing N4 family ${requiredId}`);
  }
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
  const inventory = await readJson("data/source/n4-grammar-inventory.json");
  const planned = Object.fromEntries(inventory.planned.map((entry) => [entry.id, entry]));

  assert.match(planned["causative-passive-form"].pattern, /～される/);
  assert.match(planned["imperative-form"].pattern, /～よ/);
  assert.match(planned["imperative-form"].pattern, /せよ/);
  assert.match(planned["you-da-inference"].pattern, /な-adjective \+ なようだ/);
  assert.match(planned["you-da-inference"].pattern, /noun \+ のようだ/);
  assert.match(planned["you-na-ni-simile"].pattern, /な-adjective \+ なような/);
  assert.match(planned["noni-concession"].pattern, /な-adjective \/ noun \+ なのに/);
  assert.match(planned["baai-wa"].pattern, /な-adjective \+ な場合は/);
  assert.match(planned["baai-wa"].pattern, /noun \+ の場合は/);
  assert.equal(planned.mama.scope, "boundary");
  assert.match(planned.mama.pattern, /Vた \/ Vない/);
  assert.match(planned.mama.pattern, /な-adjective \+ なまま/);
  assert.match(planned["stem-dasu"].meaning, /Lexical compounds/);
  assert.equal(planned["te-kudasaru"].name, "Honorific benefactive action");
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
