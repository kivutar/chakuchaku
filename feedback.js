(function initializeFeedback(global) {
  "use strict";

  const reducedMotion = global.matchMedia?.("(prefers-reduced-motion: reduce)");
  const activeVisuals = new Map();
  const soundingNotes = new Map();
  let preferences = { visualEffects: true, soundEffects: false };
  let audioContext;
  let soundGeneration = 0;
  let speechActive = false;

  function clearVisuals() {
    for (const [target, effect] of activeVisuals) {
      global.clearTimeout(effect.startTimer);
      global.clearTimeout(effect.endTimer);
      target.classList.remove("feedback-enter");
      effect.stage?.remove();
    }
    activeVisuals.clear();
  }

  function stopSound() {
    soundGeneration += 1;
    for (const [oscillator, gain] of soundingNotes) {
      try {
        oscillator.stop();
      } catch {
        // A scheduled note may already have ended.
      }
      oscillator.disconnect();
      gain.disconnect();
    }
    soundingNotes.clear();
  }

  function configure(settings) {
    preferences = {
      visualEffects: settings.visualEffects !== false,
      soundEffects: settings.soundEffects === true
    };
    if (!preferences.visualEffects) clearVisuals();
    if (!preferences.soundEffects) stopSound();
  }

  function setSpeechActive(active) {
    speechActive = active;
    if (active) stopSound();
  }

  async function playSound(outcome) {
    if (!preferences.soundEffects || speechActive) return false;
    stopSound();
    const generation = soundGeneration;

    try {
      const AudioContext = global.AudioContext || global.webkitAudioContext;
      if (!AudioContext) return false;
      audioContext ||= new AudioContext();
      if (audioContext.state !== "running") await audioContext.resume();
      if (generation !== soundGeneration || !preferences.soundEffects || speechActive) {
        return false;
      }

      const notes = outcome === "complete"
        ? [[660, 0, 0.18], [880, 0.12, 0.22]]
        : outcome === "good"
          ? [[660, 0, 0.18], [990, 0, 0.12]]
          : [[180, 0, 0.085], [360, 0, 0.055]];

      for (const [frequency, delay, duration] of notes) {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const start = audioContext.currentTime + delay;

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.035, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        soundingNotes.set(oscillator, gain);
        oscillator.onended = () => {
          soundingNotes.delete(oscillator);
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(start);
        oscillator.stop(start + duration + 0.01);
      }
      return true;
    } catch {
      // Unsupported audio or autoplay restrictions never interrupt an exercise.
      stopSound();
      return false;
    }
  }

  function createMark(outcome) {
    const mark = global.document.createElement("span");
    const svg = global.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = global.document.createElementNS("http://www.w3.org/2000/svg", "path");

    mark.className = "feedback-mark";
    mark.setAttribute("aria-hidden", "true");
    svg.setAttribute("viewBox", "0 0 20 20");
    path.setAttribute("d", outcome === "good" ? "M4 10.5 8 14.5 16 5.5" : "M6 6 14 14 M14 6 6 14");
    path.setAttribute("pathLength", "1");
    svg.append(path);
    mark.append(svg);
    return mark;
  }

  function createBurst(target, complete) {
    // Render outside the scrollable answer panel so rings and sparks aren't clipped.
    const stage = global.document.createElement("span");
    const particles = global.document.createElement("span");
    const bounds = target.querySelector(".feedback-mark").getBoundingClientRect();
    const count = complete ? 36 : 24;

    stage.className = "feedback-stage";
    stage.setAttribute("aria-hidden", "true");
    stage.dataset.complete = String(complete);
    stage.style.setProperty("--feedback-origin-x", `${bounds.left + bounds.width / 2}px`);
    stage.style.setProperty("--feedback-origin-y", `${bounds.top + bounds.height / 2}px`);
    for (let index = 0; index < 2; index += 1) {
      const ring = global.document.createElement("span");
      ring.className = "feedback-wave";
      stage.append(ring);
    }
    particles.className = "feedback-particles";
    for (let index = 0; index < count; index += 1) {
      const particle = global.document.createElement("i");
      const angle = (index / count * Math.PI * 2) - 0.4;
      const distance = (complete ? 125 : 78) + (index % 4) * 17;

      particle.style.setProperty("--particle-x", `${Math.cos(angle) * distance}px`);
      particle.style.setProperty("--particle-y", `${Math.sin(angle) * distance}px`);
      particle.style.setProperty("--particle-turn", `${(index % 2 ? 1 : -1) * (70 + index * 9)}deg`);
      particle.style.setProperty("--particle-delay", `${index % 3 * 35}ms`);
      particles.append(particle);
    }
    stage.append(particles);
    global.document.body.append(stage);
    return stage;
  }

  function show(target, outcome, {
    label = target?.textContent || "",
    animate = true,
    sound = true,
    complete = false
  } = {}) {
    if (!target || !["good", "again"].includes(outcome)) return;
    clearVisuals();
    const mark = createMark(outcome);
    const text = global.document.createElement("span");

    text.className = "feedback-label";
    text.textContent = label;
    target.classList.add("feedback-summary");
    target.dataset.outcome = outcome;
    target.dataset.complete = String(complete);
    target.replaceChildren(mark, ...(label ? [text] : []));

    if (animate && preferences.visualEffects && !reducedMotion?.matches) {
      target.classList.add("feedback-enter");
      const effect = {};
      // Give the answer panel time to open before locating the burst's origin.
      if (outcome === "good") {
        effect.startTimer = global.setTimeout(() => {
          effect.stage = createBurst(target, complete);
        }, 320);
      }
      effect.endTimer = global.setTimeout(() => {
        target.classList.remove("feedback-enter");
        effect.stage?.remove();
        activeVisuals.delete(target);
      }, outcome === "again" ? 700 : complete ? 1700 : 1450);
      activeVisuals.set(target, effect);
    }
    if (sound) void playSound(complete ? "complete" : outcome);
  }

  function reset() {
    clearVisuals();
    stopSound();
  }

  reducedMotion?.addEventListener?.("change", () => {
    if (reducedMotion.matches) clearVisuals();
  });
  global.JlptN5Feedback = Object.freeze({
    configure, show, playSound, setSpeechActive, reset
  });
})(globalThis);
