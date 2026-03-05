// ── Strudel.js Stranger Things-style adaptive soundtrack ─────────────────────
// Uses a hidden <strudel-editor> web component (loaded via @strudel/repl CDN)
// to generate synthesiser music that reacts to game state.
//
// Stranger Things-inspired motifs – all rooted in D minor:
//   Peaceful  : slow arpeggios, dreamy pads
//   Danger    : driving, tense, faster pulse
//   Dead      : dissonant descending line
//   Win       : bright resolution, major lift

const PATTERNS = {
  peaceful: `stack(
  note("d3 f3 a3 [c4 a3]").s("sawtooth").lpf(900).gain(0.2).room(0.8),
  note("<d4 f4> <a4 c5>").s("sawtooth").lpf(1600).gain(0.1).room(0.85).slow(2)
).cpm(120)`,

  danger: `stack(
  note("d3 [d3 f3] a3 [d4 c4]").s("sawtooth").lpf(1200).gain(0.25).room(0.6).fast(2),
  note("[d4 eb4] [f4 g4]").s("square").lpf(800).gain(0.15).room(0.7)
).cpm(140)`,

  dead: `note("d2 ~ db2 ~").s("sawtooth").lpf(500).gain(0.3).room(0.9).slow(2).cpm(60)`,

  win: `stack(
  note("d4 f4 a4 d5").s("sawtooth").lpf(2000).gain(0.25).room(0.7),
  note("d3 a3 f3 a3").s("sawtooth").lpf(1000).gain(0.2).room(0.8)
).cpm(130)`,
};

let strudelEl   = null;
let editorReady = false;
let currentTrack = null;
let pendingTrack = null;

function getEditor() {
  return strudelEl && strudelEl.editor ? strudelEl.editor : null;
}

// Poll until the strudel-editor's internal `editor` property appears.
async function waitForEditor(timeout) {
  timeout = timeout || 10000;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (strudelEl && strudelEl.editor) return strudelEl.editor;
    await new Promise(function (r) { setTimeout(r, 250); });
  }
  return null;
}

// Call once on first user interaction to prepare the audio engine.
async function init() {
  if (editorReady) return;

  strudelEl = document.getElementById('strudel-soundtrack');
  if (!strudelEl) {
    console.warn('[Soundtrack] strudel-soundtrack element not found – no music.');
    return;
  }

  const editor = await waitForEditor();
  if (!editor) {
    console.warn('[Soundtrack] Strudel editor did not initialise in time.');
    return;
  }

  editorReady = true;

  // Play any pattern that was requested while we were initialising.
  if (pendingTrack) {
    const t = pendingTrack;
    pendingTrack = null;
    _doPlay(t);
  }
}

function _doPlay(trackName) {
  const editor = getEditor();
  if (!editor) return;
  try {
    editor.setCode(PATTERNS[trackName]);
    editor.evaluate();
  } catch (e) {
    console.warn('[Soundtrack] Playback error:', e);
  }
}

// Switch to a named pattern. Safe to call before init() completes.
function play(trackName) {
  if (!PATTERNS[trackName]) return;
  if (currentTrack === trackName) return;
  currentTrack = trackName;

  if (!editorReady) {
    // Queue the request; it will be fulfilled when init() finishes.
    pendingTrack = trackName;
    return;
  }

  _doPlay(trackName);
}

// Silence all patterns.
function stop() {
  currentTrack = null;
  pendingTrack = null;
  const editor = getEditor();
  if (!editor) return;
  try { editor.stop(); } catch (e) { /* ignore */ }
}

// Expose API to game.js (which is a classic non-module script).
window.soundtrack = { init: init, play: play, stop: stop };
