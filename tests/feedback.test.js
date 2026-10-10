import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const code = await readFile(new URL("../feedback.js", import.meta.url), "utf8");

class Element {
  children = [];
  dataset = {};
  attributes = {};
  className = "";
  value = "";
  style = { setProperty() {} };
  classList = {
    add: (...names) => { this.className = [...new Set([...this.className.split(" "), ...names])].join(" "); },
    remove: (...names) => { this.className = this.className.split(" ").filter((name) => !names.includes(name)).join(" "); },
    contains: (name) => this.className.split(" ").includes(name)
  };
  setAttribute(name, value) { this.attributes[name] = value; }
  getBoundingClientRect() { return { left: 100, top: 200, width: 36, height: 36 }; }
  append(...children) {
    for (const child of children) { child.parent = this; this.children.push(child); }
  }
  replaceChildren(...children) { this.children = []; this.value = ""; this.append(...children); }
  remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
  get textContent() { return this.value + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.value = value; this.children = []; }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.classList.contains(selector.slice(1))) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}

function setup({ reduced = false, resume } = {}) {
  const contexts = [];
  const timers = new Map();
  let timerId = 0;
  let now = 0;
  let onMotionChange;
  const media = {
    matches: reduced,
    addEventListener: (_, handler) => { onMotionChange = handler; }
  };
  class AudioContext {
    state = resume ? "suspended" : "running";
    currentTime = 0;
    destination = {};
    notes = [];
    constructor() { contexts.push(this); }
    async resume() { await resume?.(); this.state = "running"; }
    createOscillator() {
      const note = {
        frequency: { setValueAtTime() {} },
        connect() {}, disconnect() {},
        start: () => { note.started = true; },
        stop: (time) => { note.lastStop = time; }
      };
      this.notes.push(note);
      return note;
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}, disconnect() {}
      };
    }
  }
  const global = {
    AudioContext,
    document: { body: new Element(), createElement: () => new Element(), createElementNS: () => new Element() },
    matchMedia: () => media,
    setTimeout: (handler, delay) => { timers.set(++timerId, { handler, at: now + delay }); return timerId; },
    clearTimeout: (id) => timers.delete(id)
  };
  global.globalThis = global;
  vm.runInNewContext(code, global);
  function advanceClock(milliseconds) {
    const end = now + milliseconds;
    for (;;) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].handler();
    }
    now = end;
  }
  return {
    api: global.JlptN5Feedback, global, contexts, timers, media, advanceClock,
    motionChange: () => onMotionChange()
  };
}

test("success gets a visible viewport burst after the panel opens, without sound by default", () => {
  const { api, global, contexts, timers, advanceClock } = setup();
  const target = new Element();
  api.show(target, "good", { label: "Correct" });
  assert.equal(target.textContent, "Correct");
  assert.equal(target.dataset.outcome, "good");
  assert.equal(global.document.body.querySelector(".feedback-stage"), null);
  advanceClock(320);
  const stage = global.document.body.querySelector(".feedback-stage");
  assert.equal(stage.attributes["aria-hidden"], "true");
  assert.equal(stage.querySelector(".feedback-particles").children.length, 24);
  assert.equal(stage.children.filter((child) => child.className === "feedback-wave").length, 2);
  assert.equal(target.querySelector(".feedback-particles"), null, "the answer panel cannot clip the burst");
  assert.equal(target.querySelector(".feedback-mark").attributes["aria-hidden"], "true");
  assert.equal(contexts.length, 0);
  advanceClock(1130);
  assert.equal(global.document.body.querySelector(".feedback-stage"), null);
  assert.equal(timers.size, 0);
  assert.equal(target.classList.contains("feedback-enter"), false);
});

test("a mistake has a readable cross, no burst, and no motion on its label", () => {
  const { api, global, advanceClock } = setup();
  const target = new Element();
  api.show(target, "again", { label: "Reference answer" });
  assert.equal(target.textContent, "Reference answer");
  assert.equal(target.dataset.outcome, "again");
  assert.equal(target.querySelector(".feedback-particles"), null);
  advanceClock(320);
  assert.equal(global.document.body.querySelector(".feedback-stage"), null);
  const path = target.querySelector(".feedback-mark").children[0].children[0];
  assert.match(path.attributes.d, /M6 6 14 14/);
});

test("visuals off and reduced motion retain the static outcome and skip particles", () => {
  for (const reduced of [false, true]) {
    const { api, global, advanceClock } = setup({ reduced });
    if (!reduced) api.configure({ visualEffects: false });
    const target = new Element();
    api.show(target, "good", { label: "Correct" });
    assert.equal(target.textContent, "Correct");
    assert.ok(target.querySelector(".feedback-mark"));
    assert.equal(target.querySelector(".feedback-particles"), null);
    assert.equal(target.classList.contains("feedback-enter"), false);
    advanceClock(2000);
    assert.equal(global.document.body.querySelector(".feedback-stage"), null);
  }
});

test("overrides replace the mark quietly and clean up the previous burst", () => {
  const { api, global, timers, advanceClock } = setup();
  const target = new Element();
  api.show(target, "good", { label: "Correct" });
  advanceClock(400);
  api.show(target, "again", { label: "Reference answer", animate: false, sound: false });
  assert.equal(target.dataset.outcome, "again");
  assert.equal(target.textContent, "Reference answer");
  assert.equal(target.children.length, 2);
  assert.equal(timers.size, 0);
  assert.equal(target.classList.contains("feedback-enter"), false);
  assert.equal(global.document.body.querySelector(".feedback-stage"), null);
});

test("changing motion preferences or resetting removes all temporary effects", () => {
  const { api, global, timers, media, motionChange, advanceClock } = setup();
  const target = new Element();
  api.show(target, "good");
  advanceClock(320);
  media.matches = true;
  motionChange();
  assert.equal(target.querySelector(".feedback-particles"), null);
  assert.equal(timers.size, 0);
  assert.equal(global.document.body.querySelector(".feedback-stage"), null);
  media.matches = false;
  api.show(target, "good", { complete: true, label: "" });
  advanceClock(320);
  assert.equal(global.document.body.querySelector(".feedback-particles").children.length, 36);
  api.reset();
  assert.equal(timers.size, 0);
  assert.equal(global.document.body.querySelector(".feedback-stage"), null);
});

test("Next cancels a delayed burst before it starts", () => {
  const { api, global, timers, advanceClock } = setup();
  const target = new Element();
  api.show(target, "good");
  advanceClock(100);
  api.reset();
  advanceClock(2000);
  assert.equal(global.document.body.querySelector(".feedback-stage"), null);
  assert.equal(timers.size, 0);
  assert.equal(target.classList.contains("feedback-enter"), false);
});

test("sounds are opt-in, stop for speech, and do not play while speech is active", async () => {
  const { api, contexts } = setup();
  assert.equal(await api.playSound("good"), false);
  assert.equal(contexts.length, 0);
  api.configure({ soundEffects: true });
  assert.equal(await api.playSound("good"), true);
  assert.equal(contexts[0].notes.length, 2);
  api.setSpeechActive(true);
  assert.ok(contexts[0].notes.every((note) => note.lastStop === undefined));
  assert.equal(await api.playSound("again"), false);
  api.setSpeechActive(false);
  assert.equal(await api.playSound("complete"), true);
  api.configure({ soundEffects: false });
  assert.equal(await api.playSound("good"), false);
});

test("pending audio resumes cannot outlive Next, speech, or the mute switch", async () => {
  for (const cancel of ["reset", "speech", "mute"]) {
    let resolveResume;
    const { api, contexts } = setup({ resume: () => new Promise((resolve) => { resolveResume = resolve; }) });
    api.configure({ soundEffects: true });
    const played = api.playSound("good");
    if (cancel === "reset") api.reset();
    if (cancel === "speech") { api.setSpeechActive(true); api.setSpeechActive(false); }
    if (cancel === "mute") api.configure({ soundEffects: false });
    resolveResume();
    assert.equal(await played, false, cancel);
    assert.equal(contexts[0].notes.length, 0, cancel);
  }
});

test("unavailable or denied browser audio degrades silently", async () => {
  const { api, global } = setup({ resume: () => Promise.reject(new Error("NotAllowedError")) });
  api.configure({ soundEffects: true });
  assert.equal(await api.playSound("good"), false);
  global.AudioContext = undefined;
  // Test the missing API with a fresh feedback module and no cached context.
  vm.runInNewContext(code, global);
  global.JlptN5Feedback.configure({ soundEffects: true });
  assert.equal(await global.JlptN5Feedback.playSound("good"), false);
});
