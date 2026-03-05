// ─── Haunted Island – main game script ───────────────────────────────────────

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;   // 800
const H = canvas.height;  // 560

// ── Tile IDs ──────────────────────────────────────────────────────────────────
const WATER  = 0;
const SAND   = 1;
const GRASS  = 2;
const TREE   = 3;
const ROCK   = 4;

const TILE = 40;           // px per tile
const COLS = W / TILE;     // 20
const ROWS = H / TILE;     // 14

// ── Colours ───────────────────────────────────────────────────────────────────
const COLOUR = {
  [WATER]:  '#1a3a6b',
  [SAND]:   '#c8a85a',
  [GRASS]:  '#2e7d32',
  [TREE]:   '#1b5e20',
  [ROCK]:   '#616161',
};

// ── Map layout ────────────────────────────────────────────────────────────────
// currentMap is a 20×14 grid of tile IDs (0=water 1=sand 2=grass 3=tree 4=rock).
// It is regenerated each time a new game starts via generateMap().
let currentMap = null;

// ── Procedural map generator ──────────────────────────────────────────────────
function generateMap() {
  const map = Array.from({ length: ROWS }, () => Array(COLS).fill(WATER));

  // Pick a random island centre, keeping a water border around the edges
  const cx = 4 + Math.random() * (COLS - 8);
  const cy = 3 + Math.random() * (ROWS - 6);

  // Irregular island shape: a circular base distorted by sinusoidal lobes
  const baseRadius = 4.5 + Math.random() * 2.0;      // overall size (tiles)
  const numLobes   = 3 + Math.floor(Math.random() * 4); // 3–6 lobes
  const lobeAmp    = 0.5 + Math.random() * 1.2;       // lobe depth
  const rotation   = Math.random() * Math.PI * 2;     // rotate the pattern
  const xStretch   = 0.9 + Math.random() * 0.5;       // horizontal stretch

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const dx    = (col - cx) / xStretch;
      const dy    = row - cy;
      const d     = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const r     = baseRadius + lobeAmp * Math.sin(angle * numLobes + rotation);

      if (d < r - 1.0)      map[row][col] = GRASS;
      else if (d < r + 1.2) map[row][col] = SAND;
    }
  }

  // Scatter trees and rocks across grass tiles
  const treeChance = 0.08 + Math.random() * 0.06; // 8–14 %
  const rockChance = 0.04 + Math.random() * 0.04; // 4–8 %
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (map[row][col] === GRASS) {
        const r = Math.random();
        if      (r < treeChance)              map[row][col] = TREE;
        else if (r < treeChance + rockChance) map[row][col] = ROCK;
      }
    }
  }

  return map;
}

// Return pixel top-left coords of every walkable tile in currentMap
function getWalkableTiles() {
  const tiles = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (isWalkable(col, row)) tiles.push({ x: col * TILE, y: row * TILE });
    }
  }
  return tiles;
}

// Return a random walkable position at least minDist pixels from every point in occupied[].
// occupied entries must have { cx, cy } (pixel centre coords).
function randomWalkablePos(walkable, minDist, occupied) {
  // Fisher-Yates shuffle for unbiased randomisation
  const shuffled = walkable.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  for (const t of shuffled) {
    const cx = t.x + TILE / 2;
    const cy = t.y + TILE / 2;
    const ok = occupied.every(o => {
      const dx = o.cx - cx, dy = o.cy - cy;
      return Math.sqrt(dx * dx + dy * dy) >= minDist;
    });
    if (ok) return { x: t.x, y: t.y, cx, cy };
  }
  // Fallback: accept any walkable tile
  const t = shuffled[0] || { x: TILE, y: TILE };
  return { x: t.x, y: t.y, cx: t.x + TILE / 2, cy: t.y + TILE / 2 };
}

// ── Item types ────────────────────────────────────────────────────────────────
const ITEMS = [
  { type: 'holy_water',  label: 'Holy Water',   emoji: '⚗️',  range: 70 },
  { type: 'torch',       label: 'Torch',        emoji: '🔦', range: 55 },
  { type: 'dagger',      label: 'Silver Dagger', emoji: '🗡️', range: 50 },
];

// ── Spawn-spacing constants ───────────────────────────────────────────────────
const SKELETON_MIN_DIST = 5 * TILE;  // min px between skeleton spawns (and from player)
const PICKUP_MIN_DIST   = 2 * TILE;  // min px between pickup spawns
// Minimum walkable tiles needed: 1 player + 5 skeletons + 8 max pickups + margin
const MIN_WALKABLE_TILES = 30;

// ── Game state ────────────────────────────────────────────────────────────────
let state;        // 'menu' | 'play' | 'dead' | 'win'
let player    = makePlayerStub();
let skeletons = [];
let pickups   = [];
let keys      = {};
let animTick  = 0;

// ── Dialogue state ────────────────────────────────────────────────────────────
let dialogueActive   = false;   // true while a skeleton dialogue is open
let dialogueSkeleton = null;    // skeleton currently being spoken to
let dialogueLoading  = false;   // true while awaiting LLM response
let dialoguePhase    = 'closed'; // 'greeting' | 'awaiting-input' | 'responding' | 'done' | 'closed'

// Minimal stub so the draw loop is safe before game starts
function makePlayerStub() {
  return { x: 5.5 * TILE, y: 8 * TILE, w: 28, h: 28, hp: 3, maxHp: 3,
           heldItem: null, invincible: 0, facing: 'down', px: 0, py: 0 };
}

// ── Utility ───────────────────────────────────────────────────────────────────
function tileAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return WATER;
  if (!currentMap) return WATER;
  return currentMap[ty][tx];
}

function isWalkable(tx, ty) {
  const t = tileAt(tx, ty);
  return t === SAND || t === GRASS;
}

// Pixel centre → tile
function toTile(px) { return Math.floor(px / TILE); }

// Rectangle collision between two axis-aligned boxes
function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Clamp entity inside walkable area (very simple per-axis resolution)
function clampToMap(e, hw, hh) {
  // Try x alone, then y alone
  let tx = toTile(e.x), ty = toTile(e.y);
  if (!isWalkable(tx, ty)) {
    e.x = e.px; e.y = e.py;
  }
}

// ── Player ────────────────────────────────────────────────────────────────────
function makePlayer() {
  return {
    x: 5.5 * TILE,
    y: 8 * TILE,
    px: 5.5 * TILE,
    py: 8 * TILE,
    w: 28, h: 28,
    speed: 130,          // px/s
    hp: 3,
    maxHp: 3,
    heldItem: null,      // item object or null
    invincible: 0,       // invincibility frames (s)
    facing: 'down',
  };
}

// ── Skeletons ─────────────────────────────────────────────────────────────────
const SKEL_SPEED_IDLE   = 45;
const SKEL_SPEED_CHASE  = 90;
const SKEL_SIGHT        = 160;  // px
const SKEL_ATTACK_RANGE = 24;   // px (edge-to-edge)
const SKEL_ATTACK_CD    = 1.2;  // seconds between attacks
const SKEL_TALK_RANGE   = 72;   // px — must be within this distance to talk
const SKEL_GOOD_HEAL_RANGE  = 35; // px — good skeleton heals player within this distance
const SKEL_GOOD_HEAL_CD     = 8;  // seconds between heals
const SKEL_GOOD_HEAL_AMOUNT = 1;  // HP restored per heal

// Each skeleton's unique identity for LLM prompting
const SKELETON_DATA = [
  { name: 'Captain Malgrath',  personality: 'imperious and commanding, mourning your sunken fleet' },
  { name: 'Sister Orvaine',    personality: 'eerie and philosophical, speaking with unsettling calm about death' },
  { name: 'Old Barnacle Pete', personality: 'jovial and darkly humorous about your bones and undead state' },
  { name: 'The Pale Scholar',  personality: 'cryptic and scholarly, speaking in riddles about the island\'s curse' },
  { name: 'Wailing Brigitte',  personality: 'melancholic and sorrowful, longing desperately for the living world' },
];

function makeSkeleton(x, y, name, personality) {
  return {
    x, y,
    px: x, py: y,
    w: 28, h: 28,
    mode: 'patrol',     // 'patrol' | 'chase'
    patrol: { tx: x, ty: y, timer: 0 },
    attackTimer: 0,
    alive: true,
    flashTimer: 0,
    name:        name        || 'Unknown Skeleton',
    personality: personality || 'mysterious and silent',
    alignment:   Math.random() < 0.5 ? 'good' : 'bad',  // randomly assigned
    talked:      false,   // has the player held a dialogue with this skeleton?
    helpTimer:   0,       // cooldown for healing the player (good alignment only)
  };
}

function pickPatrolTarget(sk) {
  // Pick a random walkable tile near the skeleton
  for (let tries = 0; tries < 30; tries++) {
    const offX = (Math.random() * 6 - 3) * TILE;
    const offY = (Math.random() * 6 - 3) * TILE;
    const nx = sk.x + offX;
    const ny = sk.y + offY;
    const tx = toTile(nx), ty = toTile(ny);
    if (isWalkable(tx, ty)) {
      sk.patrol.tx = nx;
      sk.patrol.ty = ny;
      sk.patrol.timer = 2 + Math.random() * 3;
      return;
    }
  }
  // fallback – stay put
  sk.patrol.tx = sk.x;
  sk.patrol.ty = sk.y;
  sk.patrol.timer = 2;
}

// ── Init game ─────────────────────────────────────────────────────────────────
function initGame() {
  animTick = 0;
  keys     = {};

  // Reset dialogue state in case a game was restarted mid-conversation
  closeDialogue();

  // ── Generate a fresh random island map ──────────────────────────────────────
  // Regenerate until the island has enough walkable space for all entities
  let walkable = [];
  do {
    currentMap = generateMap();
    walkable   = getWalkableTiles();
  } while (walkable.length < MIN_WALKABLE_TILES);

  const occupied = [];  // accumulates { cx, cy } for already-placed entities

  // ── Place player near the walkable tile closest to the map centre ────────────
  const mapCX = (COLS / 2) * TILE;
  const mapCY = (ROWS / 2) * TILE;
  const centerTile = walkable.reduce((best, t) => {
    const da = Math.abs(t.x + TILE / 2 - mapCX) + Math.abs(t.y + TILE / 2 - mapCY);
    const db = Math.abs(best.x + TILE / 2 - mapCX) + Math.abs(best.y + TILE / 2 - mapCY);
    return da < db ? t : best;
  });
  const pad = (TILE - 28) / 2;
  player    = makePlayer();
  player.x  = centerTile.x + pad;
  player.y  = centerTile.y + pad;
  player.px = player.x;
  player.py = player.y;
  occupied.push({ cx: centerTile.x + TILE / 2, cy: centerTile.y + TILE / 2 });

  // ── Place skeletons at random walkable positions far from player/each other ──
  skeletons = SKELETON_DATA.map(({ name, personality }) => {
    const pos = randomWalkablePos(walkable, SKELETON_MIN_DIST, occupied);
    occupied.push({ cx: pos.cx, cy: pos.cy });
    return makeSkeleton(pos.x + pad, pos.y + pad, name, personality);
  });

  // Guarantee at least one hostile skeleton so the game is never trivially won
  if (skeletons.every(s => s.alignment === 'good')) {
    skeletons[Math.floor(Math.random() * skeletons.length)].alignment = 'bad';
  }
  skeletons.forEach(pickPatrolTarget);

  // ── Place pickups at random walkable positions ───────────────────────────────
  const numPickups = 5 + Math.floor(Math.random() * 4); // 5–8 per run
  pickups = [];
  for (let i = 0; i < numPickups; i++) {
    const pos = randomWalkablePos(walkable, PICKUP_MIN_DIST, occupied);
    occupied.push({ cx: pos.cx, cy: pos.cy });
    pickups.push({
      x: pos.cx,
      y: pos.cy,
      ...ITEMS[i % ITEMS.length],
      collected: false,
    });
  }

  keys  = {};
  state = 'play';
  updateHUD();
}

// ── HUD ───────────────────────────────────────────────────────────────────────
function updateHUD() {
  document.getElementById('hearts').textContent =
    '♥'.repeat(player.hp) + '♡'.repeat(player.maxHp - player.hp);
  document.getElementById('skelCount').textContent =
    skeletons.filter(s => s.alive).length;
  document.getElementById('itemCount').textContent =
    pickups.filter(p => !p.collected).length;
  document.getElementById('heldItem').textContent =
    player.heldItem ? player.heldItem.emoji + ' ' + player.heldItem.label : 'None';
}

// ── Overlay helpers ───────────────────────────────────────────────────────────
const overlay   = document.getElementById('overlay');
const oTitle    = document.getElementById('overlay-title');
const oMsg      = document.getElementById('overlay-msg');
const startBtn  = document.getElementById('startBtn');

function showOverlay(title, colour, msg, btnLabel) {
  oTitle.textContent = title;
  oTitle.style.color = colour;
  oMsg.innerHTML = msg;
  startBtn.textContent = btnLabel;
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
}

startBtn.addEventListener('click', () => {
  initGame();
  hideOverlay();
});

// ── Dialogue UI ───────────────────────────────────────────────────────────────
const dialoguePanel     = document.getElementById('dialogue-panel');
const dialogueName      = document.getElementById('dialogue-name');
const dialogueText      = document.getElementById('dialogue-text');
const dialogueHint      = document.getElementById('dialogue-hint');
const dialogueInputWrap = document.getElementById('dialogue-input-wrap');
const dialogueInput     = document.getElementById('dialogue-input');
const dialogueSend      = document.getElementById('dialogue-send');

function openDialogue(sk) {
  dialogueActive   = true;
  dialogueSkeleton = sk;
  dialogueLoading  = true;
  dialoguePhase    = 'greeting';
  dialogueName.textContent = sk.name;
  dialogueText.textContent = '';
  dialogueText.classList.add('loading');
  dialogueInputWrap.classList.add('hidden');
  dialogueInput.value = '';
  dialogueHint.textContent = '';
  dialoguePanel.classList.remove('hidden');
}

function closeDialogue() {
  dialogueActive   = false;
  dialogueSkeleton = null;
  dialogueLoading  = false;
  dialoguePhase    = 'closed';
  dialogueText.classList.remove('loading');
  dialoguePanel.classList.add('hidden');
  dialogueInputWrap.classList.add('hidden');
  dialogueInput.value = '';
}

// Called when the skeleton's greeting arrives from the LLM
function setDialogueGreeting(text) {
  dialogueLoading = false;
  dialoguePhase   = 'awaiting-input';
  dialogueText.classList.remove('loading');
  dialogueText.textContent = text;
  dialogueInputWrap.classList.remove('hidden');
  dialogueHint.textContent = 'Type your reply and press Enter (or click Send)';
  dialogueInput.focus();
}

// Called when the skeleton's response to the player arrives
function setDialogueResponse(text) {
  dialogueLoading = false;
  dialoguePhase   = 'done';
  dialogueText.classList.remove('loading');
  dialogueText.textContent = text;
  dialogueInputWrap.classList.add('hidden');
  dialogueHint.textContent = 'Tap or press any key to close';
  // Check win in case talking converted the last hostile skeleton
  if (state === 'play') checkWin();
}

// Legacy helper kept for error paths
function setDialogueText(text) {
  setDialogueGreeting(text);
}

// ── API key modal ─────────────────────────────────────────────────────────────
const apiKeyModal  = document.getElementById('api-key-modal');
const apiKeyInput  = document.getElementById('api-key-input');
const apiKeySave   = document.getElementById('api-key-save');
const apiKeyCancel = document.getElementById('api-key-cancel');
const LS_KEY       = 'hauted-island-gemini-key';

function showApiKeyModal(onSave) {
  apiKeyInput.value = '';
  apiKeyModal.classList.remove('hidden');
  apiKeyInput.focus();

  function handleSave() {
    const key = apiKeyInput.value.trim();
    if (!key) return;
    localStorage.setItem(LS_KEY, key);
    apiKeyModal.classList.add('hidden');
    cleanup();
    onSave(key);
  }

  function handleCancel() {
    apiKeyModal.classList.add('hidden');
    cleanup();
    closeDialogue();
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') handleCancel();
    e.stopPropagation();   // don't let game keydown handler see these
  }

  function cleanup() {
    apiKeySave  .removeEventListener('click',   handleSave);
    apiKeyCancel.removeEventListener('click',   handleCancel);
    apiKeyModal .removeEventListener('keydown', handleKeydown);
  }

  apiKeySave  .addEventListener('click',   handleSave);
  apiKeyCancel.addEventListener('click',   handleCancel);
  apiKeyModal .addEventListener('keydown', handleKeydown);
}

// ── Settings modal ────────────────────────────────────────────────────────────
const settingsModal    = document.getElementById('settings-modal');
const settingsApiKey   = document.getElementById('settings-api-key');
const settingsSaveBtn  = document.getElementById('settings-save');
const settingsCloseBtn = document.getElementById('settings-close');
const settingsBtn      = document.getElementById('settings-btn');

function openSettings() {
  const saved = localStorage.getItem(LS_KEY) || '';
  settingsApiKey.value = saved;
  settingsModal.classList.remove('hidden');
  settingsApiKey.focus();
}

function closeSettings() {
  settingsModal.classList.add('hidden');
}

settingsBtn.addEventListener('click', openSettings);

settingsSaveBtn.addEventListener('click', () => {
  const key = settingsApiKey.value.trim();
  if (key) {
    localStorage.setItem(LS_KEY, key);
  } else {
    localStorage.removeItem(LS_KEY);
  }
  closeSettings();
});

settingsCloseBtn.addEventListener('click', closeSettings);

settingsModal.addEventListener('keydown', e => {
  if (e.key === 'Enter') { settingsSaveBtn.click(); e.stopPropagation(); }
  if (e.key === 'Escape') { closeSettings(); e.stopPropagation(); }
});

// ── LLM dialogue fetch ────────────────────────────────────────────────────────
async function fetchSkeletonDialogue(sk) {
  let apiKey = localStorage.getItem(LS_KEY);

  if (!apiKey) {
    openDialogue(sk);
    showApiKeyModal(key => {
      apiKey = key;
      callGemini(sk, apiKey, null);
    });
    return;
  }

  openDialogue(sk);
  callGemini(sk, apiKey, null);  // null = initial greeting
}

async function callGemini(sk, apiKey, playerMessage) {
  const alignmentHint = sk.alignment === 'good'
    ? 'You are currently well-disposed toward travellers.'
    : 'You are currently hostile toward travellers.';

  let prompt;
  if (!playerMessage) {
    // ── Greeting ──────────────────────────────────────────────────────────────
    prompt =
      `You are ${sk.name}, a skeleton NPC haunting a cursed island in a browser game. ` +
      `Your personality: ${sk.personality}. ${alignmentHint} ` +
      `A traveller has approached you. Greet them in character in 1–2 short sentences. ` +
      `Do not use asterisks, stage directions, or quotation marks.`;
  } else {
    // ── Response to player ────────────────────────────────────────────────────
    prompt =
      `You are ${sk.name}, a skeleton NPC haunting a cursed island in a browser game. ` +
      `Your personality: ${sk.personality}. ${alignmentHint} ` +
      `The traveller said to you: "${playerMessage}". ` +
      `Respond in character in 1–2 short sentences based on whether you like what they said. ` +
      `After your response, on a new line write exactly one of these tags: ` +
      `[MOOD:friendly] if you are pleased with them, or [MOOD:hostile] if you are displeased. ` +
      `Do not use asterisks, stage directions, or quotation marks.`;
  }

  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 140, temperature: 1.0 },
        }),
      }
    );
    if (!res.ok) {
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        localStorage.removeItem(LS_KEY);
      }
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody?.error?.message || res.statusText;
      setDialogueText(`[${msg}]`);
      return;
    }
    const data = await res.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      || (playerMessage ? '…the skeleton turns away.' : '…the skeleton regards you silently.');

    if (playerMessage) {
      // Parse and apply the mood tag
      const moodMatch = text.match(/\[MOOD:(friendly|hostile)\]/i);
      if (moodMatch) {
        const newAlignment = moodMatch[1].toLowerCase() === 'friendly' ? 'good' : 'bad';
        sk.alignment = newAlignment;
        if (newAlignment === 'good' && sk.mode === 'chase') {
          sk.mode = 'patrol';
          pickPatrolTarget(sk);
        }
        text = text.replace(/\[MOOD:(friendly|hostile)\]/gi, '').trim();
      }
      sk.talked = true;
      setDialogueResponse(text);
    } else {
      setDialogueGreeting(text);
    }
  } catch (_) {
    if (playerMessage) {
      setDialogueResponse('…the skeleton\'s jaw moves but makes no sound.');
    } else {
      setDialogueGreeting('…the skeleton regards you silently.');
    }
  }
}

// ── Talk to nearby skeleton ───────────────────────────────────────────────────
function talkToSkeleton() {
  if (dialogueActive) {
    // Only dismiss when the response is fully shown
    if (dialoguePhase === 'done') closeDialogue();
    return;
  }

  // Find closest living skeleton within talk range
  let target = null;
  let best   = Infinity;
  const pc = { x: player.x + player.w / 2, y: player.y + player.h / 2 };
  for (const sk of skeletons) {
    if (!sk.alive) continue;
    const d = dist(pc, { x: sk.x + sk.w / 2, y: sk.y + sk.h / 2 });
    if (d < SKEL_TALK_RANGE && d < best) { best = d; target = sk; }
  }

  if (target) fetchSkeletonDialogue(target);
}

// ── Player reply to skeleton ──────────────────────────────────────────────────
function submitPlayerReply() {
  if (dialoguePhase !== 'awaiting-input') return;
  const message = dialogueInput.value.trim();
  if (!message) return;

  const sk = dialogueSkeleton;
  dialogueLoading = true;
  dialoguePhase   = 'responding';
  dialogueText.textContent = '';
  dialogueText.classList.add('loading');
  dialogueInputWrap.classList.add('hidden');
  dialogueHint.textContent = '';
  dialogueInput.value = '';

  const apiKey = localStorage.getItem(LS_KEY);
  if (apiKey) {
    callGemini(sk, apiKey, message);
  } else {
    // Fallback (no API key): randomly update alignment
    sk.talked = true;
    const happy = Math.random() < 0.5;
    sk.alignment = happy ? 'good' : 'bad';
    if (happy && sk.mode === 'chase') { sk.mode = 'patrol'; pickPatrolTarget(sk); }
    setDialogueResponse(happy
      ? '…the skeleton seems pleased by your words.'
      : '…the skeleton\'s eyes glow red with anger.');
  }
}

// ── Input ─────────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  // Don't process game input while settings modal is open
  if (!settingsModal.classList.contains('hidden')) return;

  // Close dialogue on any key (unless the API key modal is open)
  if (dialogueActive && !dialogueLoading && apiKeyModal.classList.contains('hidden')) {
    closeDialogue();
    return;
  }

  keys[e.key.toLowerCase()] = true;

  // Use held item
  if (e.key.toLowerCase() === 'f' && state === 'play') {
    useItem();
  }

  // Talk to skeleton
  if (e.key.toLowerCase() === 't' && state === 'play') {
    talkToSkeleton();
  }
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

// Wire up the player input controls
dialogueInput.addEventListener('keydown', e => {
  e.stopPropagation();  // don't let game see these keystrokes
  if (e.key === 'Enter') submitPlayerReply();
});
dialogueSend.addEventListener('click', submitPlayerReply);

// Tap dialogue hint or panel body to close on mobile (phase: done)
dialogueHint.addEventListener('click', () => {
  if (!dialogueLoading && dialoguePhase === 'done') closeDialogue();
});
dialoguePanel.addEventListener('click', e => {
  if (!dialogueLoading && dialoguePhase === 'done' &&
      !e.target.closest('#dialogue-input-wrap')) {
    closeDialogue();
  }
});

// ── Mobile touch controls ─────────────────────────────────────────────────────
(function setupMobileControls() {
  const dpadMap = {
    'dpad-up':    ['arrowup',    'w'],
    'dpad-down':  ['arrowdown',  's'],
    'dpad-left':  ['arrowleft',  'a'],
    'dpad-right': ['arrowright', 'd'],
  };

  for (const [id, keyNames] of Object.entries(dpadMap)) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      for (const k of keyNames) keys[k] = true;
    });
    const release = e => {
      e.preventDefault();
      for (const k of keyNames) keys[k] = false;
    };
    btn.addEventListener('pointerup',     release);
    btn.addEventListener('pointercancel', release);
  }

  const actionF = document.getElementById('action-f');
  if (actionF) {
    actionF.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (state === 'play') useItem();
    });
  }

  const actionT = document.getElementById('action-t');
  if (actionT) {
    actionT.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (state === 'play') talkToSkeleton();
    });
  }
})();

function checkWin() {
  // Win when every skeleton is either dead or friendly (good alignment)
  if (skeletons.every(s => !s.alive || s.alignment === 'good')) {
    state = 'win';
    const allDead = skeletons.every(s => !s.alive);
    showOverlay('🎉 You Escaped!', '#ffe066',
      allDead
        ? 'All skeletons have been vanquished!<br/>You escaped the Haunted Island!'
        : 'You befriended the remaining skeletons!<br/>You escaped the Haunted Island!',
      'Play Again');
  }
}

function useItem() {
  if (!player.heldItem) return;
  const item = player.heldItem;
  const range = item.range + 10;  // a little generous

  // Find closest living skeleton within range
  let target = null;
  let best = Infinity;
  for (const sk of skeletons) {
    if (!sk.alive) continue;
    const d = dist(
      { x: player.x + player.w / 2, y: player.y + player.h / 2 },
      { x: sk.x + sk.w / 2,         y: sk.y + sk.h / 2 }
    );
    if (d < range && d < best) { best = d; target = sk; }
  }

  if (target) {
    target.alive = false;
    target.flashTimer = 0.5;
    player.heldItem = null;
    updateHUD();
    checkWin();
  }
  // If no target in range – item is still consumed (missed swing)
  else {
    player.heldItem = null;
    updateHUD();
  }
}

// ── Update ────────────────────────────────────────────────────────────────────
let lastTime = null;

function update(ts) {
  const dt = lastTime === null ? 0 : Math.min((ts - lastTime) / 1000, 0.1);
  lastTime = ts;
  animTick += dt;

  if (state !== 'play' || dialogueActive) {
    draw();
    requestAnimationFrame(update);
    return;
  }

  // ── Player movement ──────────────────────────────────────────────────────
  let dx = 0, dy = 0;
  if (keys['arrowleft']  || keys['a']) { dx = -1; player.facing = 'left';  }
  if (keys['arrowright'] || keys['d']) { dx =  1; player.facing = 'right'; }
  if (keys['arrowup']    || keys['w']) { dy = -1; player.facing = 'up';    }
  if (keys['arrowdown']  || keys['s']) { dy =  1; player.facing = 'down';  }

  if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

  player.px = player.x;
  player.py = player.y;
  player.x += dx * player.speed * dt;
  player.y += dy * player.speed * dt;

  // Separate X/Y collision resolution
  resolvePlayerMap();

  // ── Pickup collision ──────────────────────────────────────────────────────
  for (const p of pickups) {
    if (p.collected) continue;
    if (dist({ x: player.x + player.w / 2, y: player.y + player.h / 2 },
             { x: p.x, y: p.y }) < 24) {
      p.collected = true;
      if (!player.heldItem) player.heldItem = p;
      updateHUD();
    }
  }

  // ── Skeletons ─────────────────────────────────────────────────────────────
  if (player.invincible > 0) player.invincible -= dt;

  for (const sk of skeletons) {
    if (!sk.alive) {
      if (sk.flashTimer > 0) sk.flashTimer -= dt;
      continue;
    }

    const px = player.x + player.w / 2;
    const py = player.y + player.h / 2;
    const sx = sk.x + sk.w / 2;
    const sy = sk.y + sk.h / 2;
    const d  = dist({ x: px, y: py }, { x: sx, y: sy });

    if (sk.alignment === 'bad') {
      // ── Bad skeleton: chase and attack ──────────────────────────────────
      if (d < SKEL_SIGHT) {
        sk.mode = 'chase';
      } else if (sk.mode === 'chase' && d > SKEL_SIGHT * 1.4) {
        sk.mode = 'patrol';
        pickPatrolTarget(sk);
      }

      if (sk.mode === 'chase') {
        // Move toward player
        const angle = Math.atan2(py - sy, px - sx);
        sk.px = sk.x; sk.py = sk.y;
        sk.x += Math.cos(angle) * SKEL_SPEED_CHASE * dt;
        sk.y += Math.sin(angle) * SKEL_SPEED_CHASE * dt;
        resolveEntityMap(sk);

        // Attack
        sk.attackTimer -= dt;
        if (d - (sk.w / 2 + player.w / 2) < SKEL_ATTACK_RANGE && sk.attackTimer <= 0) {
          sk.attackTimer = SKEL_ATTACK_CD;
          if (player.invincible <= 0) {
            player.hp = Math.max(0, player.hp - 1);
            player.invincible = 1.2;
            updateHUD();
            if (player.hp === 0) {
              state = 'dead';
              showOverlay('💀 You Died!', '#ff4444',
                'The skeletons have claimed another soul.<br/>Better luck next time…',
                'Try Again');
            }
          }
        }
      } else {
        // Patrol
        sk.patrol.timer -= dt;
        const tdx = sk.patrol.tx - sk.x;
        const tdy = sk.patrol.ty - sk.y;
        const td  = Math.sqrt(tdx * tdx + tdy * tdy);
        if (td < 4 || sk.patrol.timer <= 0) {
          pickPatrolTarget(sk);
        } else {
          sk.px = sk.x; sk.py = sk.y;
          sk.x += (tdx / td) * SKEL_SPEED_IDLE * dt;
          sk.y += (tdy / td) * SKEL_SPEED_IDLE * dt;
          resolveEntityMap(sk);
        }
      }
    } else {
      // ── Good skeleton: patrol peacefully, heal nearby injured player ──────
      if (sk.mode === 'chase') {
        sk.mode = 'patrol';
        pickPatrolTarget(sk);
      }

      // Heal the player when close and their HP is not full
      if (sk.helpTimer > 0) sk.helpTimer -= dt;
      if (d < SKEL_GOOD_HEAL_RANGE && sk.helpTimer <= 0 && player.hp < player.maxHp) {
        player.hp = Math.min(player.maxHp, player.hp + SKEL_GOOD_HEAL_AMOUNT);
        sk.helpTimer = SKEL_GOOD_HEAL_CD;
        updateHUD();
      }

      // Patrol
      sk.patrol.timer -= dt;
      const tdx = sk.patrol.tx - sk.x;
      const tdy = sk.patrol.ty - sk.y;
      const td  = Math.sqrt(tdx * tdx + tdy * tdy);
      if (td < 4 || sk.patrol.timer <= 0) {
        pickPatrolTarget(sk);
      } else {
        sk.px = sk.x; sk.py = sk.y;
        sk.x += (tdx / td) * SKEL_SPEED_IDLE * dt;
        sk.y += (tdy / td) * SKEL_SPEED_IDLE * dt;
        resolveEntityMap(sk);
      }
    }
  }


  draw();
  requestAnimationFrame(update);
}

// ── Map collision helpers ─────────────────────────────────────────────────────
function resolvePlayerMap() {
  const e = player;
  // X axis
  const txL = toTile(e.x);
  const txR = toTile(e.x + e.w - 1);
  const tyT = toTile(e.y);
  const tyB = toTile(e.y + e.h - 1);

  if (!isWalkable(txL, tyT) || !isWalkable(txL, tyB) ||
      !isWalkable(txR, tyT) || !isWalkable(txR, tyB)) {
    // Try reverting just X
    e.x = e.px;
    const txL2 = toTile(e.x);
    const txR2 = toTile(e.x + e.w - 1);
    if (!isWalkable(txL2, tyT) || !isWalkable(txL2, tyB) ||
        !isWalkable(txR2, tyT) || !isWalkable(txR2, tyB)) {
      e.y = e.py;
    }
  }
}

function resolveEntityMap(e) {
  const txL = toTile(e.x);
  const txR = toTile(e.x + e.w - 1);
  const tyT = toTile(e.y);
  const tyB = toTile(e.y + e.h - 1);

  if (!isWalkable(txL, tyT) || !isWalkable(txL, tyB) ||
      !isWalkable(txR, tyT) || !isWalkable(txR, tyB)) {
    e.x = e.px;
    const txL2 = toTile(e.x);
    const txR2 = toTile(e.x + e.w - 1);
    if (!isWalkable(txL2, tyT) || !isWalkable(txL2, tyB) ||
        !isWalkable(txR2, tyT) || !isWalkable(txR2, tyB)) {
      e.y = e.py;
    }
  }
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, W, H);

  drawMap();
  drawPickups();
  drawSkeletons();
  drawPlayer();
}

function drawMap() {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const t = currentMap ? currentMap[row][col] : WATER;
      const x = col * TILE, y = row * TILE;

      ctx.fillStyle = COLOUR[t] || '#000';
      ctx.fillRect(x, y, TILE, TILE);

      if (t === WATER) {
        // Animated water shimmer
        const phase = (animTick * 0.7 + col * 0.3 + row * 0.5) % (Math.PI * 2);
        ctx.globalAlpha = 0.12 + 0.08 * Math.sin(phase);
        ctx.fillStyle = '#4a90d9';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.globalAlpha = 1;
      }

      if (t === TREE) {
        // Draw a simple tree over the grass base
        ctx.fillStyle = '#2e7d32';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#1b5e20';
        ctx.beginPath();
        ctx.arc(x + TILE / 2, y + TILE / 2, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4caf50';
        ctx.beginPath();
        ctx.arc(x + TILE / 2 - 3, y + TILE / 2 - 3, 8, 0, Math.PI * 2);
        ctx.fill();
      }

      if (t === ROCK) {
        ctx.fillStyle = '#2e7d32';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#757575';
        ctx.beginPath();
        ctx.ellipse(x + TILE / 2, y + TILE / 2, 14, 10, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9e9e9e';
        ctx.beginPath();
        ctx.ellipse(x + TILE / 2 - 2, y + TILE / 2 - 2, 8, 5, 0.3, 0, Math.PI * 2);
        ctx.fill();
      }

      if (t === SAND) {
        // Subtle texture dots
        ctx.fillStyle = 'rgba(180,140,60,0.25)';
        for (let d = 0; d < 3; d++) {
          const dx = ((col * 7 + d * 13 + row * 3) % TILE);
          const dy = ((row * 11 + d * 7 + col * 5) % TILE);
          ctx.fillRect(x + dx, y + dy, 2, 2);
        }
      }
    }
  }

  // Grid lines (subtle)
  ctx.strokeStyle = 'rgba(0,0,0,0.07)';
  ctx.lineWidth = 0.5;
  for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(c * TILE, 0); ctx.lineTo(c * TILE, H); ctx.stroke(); }
  for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * TILE); ctx.lineTo(W, r * TILE); ctx.stroke(); }
}

function drawPickups() {
  for (const p of pickups) {
    if (p.collected) continue;
    const bob = Math.sin(animTick * 2.5 + p.x) * 3;
    ctx.font = '22px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.emoji, p.x, p.y + bob);
    // Glow
    ctx.globalAlpha = 0.3 + 0.2 * Math.sin(animTick * 3);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(p.x, p.y + bob, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawSkeletons() {
  for (const sk of skeletons) {
    const sx = sk.x + sk.w / 2;
    const sy = sk.y + sk.h / 2;

    if (!sk.alive) {
      if (sk.flashTimer > 0) {
        // Death burst
        ctx.globalAlpha = sk.flashTimer * 2;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(sx, sy, 26 * (1 - sk.flashTimer * 2), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      continue;
    }

    const chasing = sk.mode === 'chase';
    const wobble  = Math.sin(animTick * (chasing ? 8 : 4) + sx) * 2;

    // Determine colour theme based on alignment visibility
    // Before talking: neutral grey (can't tell good from bad)
    // After talking: green for good, red for bad even while patrolling
    let bodyColour, strokeColour, eyeColour;
    if (chasing) {
      // Always show red while actively chasing
      bodyColour   = '#f0f0f0';
      strokeColour = '#ff4444';
      eyeColour    = '#ff0000';
    } else if (sk.talked && sk.alignment === 'good') {
      bodyColour   = '#d0f0d8';
      strokeColour = '#44aa55';
      eyeColour    = '#22aa33';
    } else if (sk.talked && sk.alignment === 'bad') {
      bodyColour   = '#f0d0d0';
      strokeColour = '#aa3333';
      eyeColour    = '#880000';
    } else {
      bodyColour   = '#d0d0c0';
      strokeColour = '#808070';
      eyeColour    = '#222';
    }

    // Good-skeleton healing glow (pulse when player is very close)
    if (sk.alignment === 'good' && !chasing) {
      const d = dist({ x: player.x + player.w / 2, y: player.y + player.h / 2 },
                     { x: sx, y: sy });
      if (d < SKEL_GOOD_HEAL_RANGE * 2) {
        ctx.globalAlpha = 0.18 + 0.12 * Math.sin(animTick * 5);
        ctx.fillStyle = '#44ff77';
        ctx.beginPath();
        ctx.arc(sx, sy, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Shadow
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(sx, sk.y + sk.h + 2, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Body
    ctx.fillStyle   = bodyColour;
    ctx.strokeStyle = strokeColour;
    ctx.lineWidth   = 1.5;

    // Torso
    ctx.fillRect(sx - 7, sk.y + 10 + wobble, 14, 12);
    ctx.strokeRect(sx - 7, sk.y + 10 + wobble, 14, 12);

    // Skull
    ctx.beginPath();
    ctx.arc(sx, sk.y + 7 + wobble, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Eye sockets
    ctx.fillStyle = eyeColour;
    ctx.fillRect(sx - 5, sk.y + 4 + wobble, 4, 4);
    ctx.fillRect(sx + 1,  sk.y + 4 + wobble, 4, 4);

    // Legs
    ctx.strokeStyle = strokeColour;
    ctx.lineWidth = 2;
    const legSwing = Math.sin(animTick * (chasing ? 10 : 5) + sx) * 6;
    // Left leg
    ctx.beginPath();
    ctx.moveTo(sx - 4, sk.y + 22 + wobble);
    ctx.lineTo(sx - 4, sk.y + 32 + wobble + legSwing);
    ctx.stroke();
    // Right leg
    ctx.beginPath();
    ctx.moveTo(sx + 4, sk.y + 22 + wobble);
    ctx.lineTo(sx + 4, sk.y + 32 + wobble - legSwing);
    ctx.stroke();

    // Arms
    const armSwing = Math.sin(animTick * (chasing ? 9 : 4.5) + sy) * 8;
    ctx.beginPath();
    ctx.moveTo(sx - 7, sk.y + 13 + wobble);
    ctx.lineTo(sx - 14, sk.y + 20 + wobble + armSwing);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx + 7, sk.y + 13 + wobble);
    ctx.lineTo(sx + 14, sk.y + 20 + wobble - armSwing);
    ctx.stroke();

    // Sight ring when chasing
    if (chasing) {
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, SKEL_SIGHT, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Labels above the skeleton when the player is within talk range
    if (!dialogueActive && state === 'play') {
      const pc = { x: player.x + player.w / 2, y: player.y + player.h / 2 };
      if (dist(pc, { x: sx, y: sy }) < SKEL_TALK_RANGE) {
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.globalAlpha = 0.85 + 0.15 * Math.sin(animTick * 4);

        if (sk.talked) {
          // Show alignment badge after having spoken to this skeleton
          if (sk.alignment === 'good') {
            ctx.fillStyle = '#66ff88';
            ctx.fillText('✨ Friendly', sx, sk.y - 4);
          } else {
            ctx.fillStyle = '#ff6666';
            ctx.fillText('☠ Hostile', sx, sk.y - 4);
          }
        } else {
          ctx.fillStyle = '#ffe066';
          ctx.fillText('[T] Talk', sx, sk.y - 4);
        }
        ctx.globalAlpha = 1;
      }
    }
  }
}

function drawPlayer() {
  const px = player.x + player.w / 2;
  const py = player.y + player.h / 2;

  // Invincibility flash
  if (player.invincible > 0 && Math.floor(player.invincible * 8) % 2 === 0) return;

  // Shadow
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(px, player.y + player.h + 2, 12, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Body (simple adventurer figure)
  const bob = Math.sin(animTick * 6) * 1.5 *
    ((keys['a'] || keys['d'] || keys['w'] || keys['s'] ||
      keys['arrowleft'] || keys['arrowright'] || keys['arrowup'] || keys['arrowdown']) ? 1 : 0);

  // Cloak
  ctx.fillStyle = '#5c3317';
  ctx.beginPath();
  ctx.moveTo(px - 10, player.y + 14 + bob);
  ctx.lineTo(px - 12, player.y + player.h + 2 + bob);
  ctx.lineTo(px + 12, player.y + player.h + 2 + bob);
  ctx.lineTo(px + 10, player.y + 14 + bob);
  ctx.closePath();
  ctx.fill();

  // Torso
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(px - 8, player.y + 10 + bob, 16, 14);

  // Head
  ctx.fillStyle = '#ffd5a8';
  ctx.beginPath();
  ctx.arc(px, player.y + 7 + bob, 8, 0, Math.PI * 2);
  ctx.fill();

  // Eyes based on facing
  ctx.fillStyle = '#222';
  if (player.facing === 'down' || player.facing === 'right') {
    ctx.fillRect(px - 3, player.y + 5 + bob, 2, 3);
    ctx.fillRect(px + 1,  player.y + 5 + bob, 2, 3);
  } else if (player.facing === 'up') {
    // facing away – show back of head
    ctx.fillStyle = '#5c3317';
    ctx.beginPath();
    ctx.arc(px, player.y + 7 + bob, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hat
  ctx.fillStyle = '#222';
  ctx.fillRect(px - 9, player.y + 1 + bob, 18, 4);
  ctx.fillRect(px - 5, player.y - 5 + bob, 10, 8);

  // Held item indicator
  if (player.heldItem) {
    ctx.font = '16px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.heldItem.emoji, px + 14, player.y + 10 + bob);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
state = 'menu';
// Show start overlay (already visible in HTML)
lastTime = null;
requestAnimationFrame(update);
