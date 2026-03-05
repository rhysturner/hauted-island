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

// ── Map layout (20×14 grid) ───────────────────────────────────────────────────
// 0=water 1=sand 2=grass 3=tree 4=rock
// prettier-ignore
const MAP_TEMPLATE = [
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,1,1,1,1,1,0,0,0,0,1,1,1,1,0,0,0,0,0],
  [0,1,1,2,2,2,1,1,0,0,1,1,2,2,1,1,0,0,0,0],
  [0,1,2,2,3,2,2,1,0,0,1,2,2,3,2,1,0,0,0,0],
  [0,1,1,2,2,2,2,1,1,1,1,2,2,2,1,1,0,0,0,0],
  [0,0,1,1,2,2,2,2,2,2,2,2,2,1,1,0,0,0,0,0],
  [0,0,0,1,2,3,2,2,2,2,2,2,2,2,1,1,0,0,0,0],
  [0,0,1,1,2,2,2,4,2,2,4,2,2,2,2,1,1,0,0,0],
  [0,1,1,2,2,2,2,2,2,2,2,2,2,2,1,1,0,0,0,0],
  [0,1,2,2,3,2,2,2,2,2,2,2,3,2,1,1,0,0,0,0],
  [0,1,1,2,2,2,2,2,2,2,2,2,2,1,1,0,0,0,0,0],
  [0,0,1,1,2,2,2,2,2,2,2,2,1,1,0,0,0,0,0,0],
  [0,0,0,1,1,1,2,1,1,1,1,1,1,0,0,0,0,0,0,0],
  [0,0,0,0,0,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0],
];

// ── Item types ────────────────────────────────────────────────────────────────
const ITEMS = [
  { type: 'holy_water',  label: 'Holy Water',   emoji: '⚗️',  range: 70 },
  { type: 'torch',       label: 'Torch',        emoji: '🔦', range: 55 },
  { type: 'dagger',      label: 'Silver Dagger', emoji: '🗡️', range: 50 },
];

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

// Minimal stub so the draw loop is safe before game starts
function makePlayerStub() {
  return { x: 5.5 * TILE, y: 8 * TILE, w: 28, h: 28, hp: 3, maxHp: 3,
           heldItem: null, invincible: 0, facing: 'down', px: 0, py: 0 };
}

// ── Utility ───────────────────────────────────────────────────────────────────
function tileAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return WATER;
  return MAP_TEMPLATE[ty][tx];
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
    mode: 'patrol',     // 'patrol' | 'chase' | 'attack'
    patrol: { tx: x, ty: y, timer: 0 },
    attackTimer: 0,
    alive: true,
    flashTimer: 0,
    name:        name        || 'Unknown Skeleton',
    personality: personality || 'mysterious and silent',
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

// ── Pickups ───────────────────────────────────────────────────────────────────
function makePickups() {
  const positions = [
    [7, 9], [11, 4], [13, 9], [5, 4], [9, 7], [12, 11],
  ];
  return positions.map(([tx, ty], i) => ({
    x: tx * TILE + TILE / 2,
    y: ty * TILE + TILE / 2,
    ...ITEMS[i % ITEMS.length],
    collected: false,
  }));
}

// ── Init game ─────────────────────────────────────────────────────────────────
function initGame() {
  player   = makePlayer();
  animTick = 0;
  keys     = {};

  // Reset dialogue state in case a game was restarted mid-conversation
  closeDialogue();

  // Scatter skeletons on walkable tiles away from player spawn
  const skelPositions = [
    [14 * TILE, 3 * TILE],
    [12 * TILE, 9 * TILE],
    [4  * TILE, 10 * TILE],
    [10 * TILE, 6 * TILE],
    [7  * TILE, 3 * TILE],
  ];
  skeletons = skelPositions.map(([x, y], i) =>
    makeSkeleton(x, y, SKELETON_DATA[i].name, SKELETON_DATA[i].personality)
  );
  skeletons.forEach(pickPatrolTarget);

  pickups = makePickups();

  keys = {};
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
const dialoguePanel  = document.getElementById('dialogue-panel');
const dialogueName   = document.getElementById('dialogue-name');
const dialogueText   = document.getElementById('dialogue-text');

function openDialogue(sk) {
  dialogueActive   = true;
  dialogueSkeleton = sk;
  dialogueLoading  = true;
  dialogueName.textContent = sk.name;
  dialogueText.textContent = '';
  dialogueText.classList.add('loading');
  dialoguePanel.classList.remove('hidden');
}

function closeDialogue() {
  dialogueActive   = false;
  dialogueSkeleton = null;
  dialogueLoading  = false;
  dialogueText.classList.remove('loading');
  dialoguePanel.classList.add('hidden');
}

function setDialogueText(text) {
  dialogueLoading = false;
  dialogueText.classList.remove('loading');
  dialogueText.textContent = text;
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
      callGemini(sk, apiKey);
    });
    return;
  }

  openDialogue(sk);
  callGemini(sk, apiKey);
}

async function callGemini(sk, apiKey) {
  const prompt =
    `You are ${sk.name}, a skeleton NPC haunting a cursed island in a browser game. ` +
    `Your personality: ${sk.personality}. ` +
    `A traveller has approached you and wants to talk. ` +
    `Respond in character in 1–2 short sentences. ` +
    `Do not use asterisks, stage directions, or quotation marks.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 120, temperature: 1.0 },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message || `API error ${res.status}`;
      // If the key is invalid/expired, clear it so the user is prompted again
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        localStorage.removeItem(LS_KEY);
      }
      setDialogueText(`[${msg}]`);
      return;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      || '…the skeleton says nothing.';
    setDialogueText(text);
  } catch (_) {
    setDialogueText('…the skeleton\'s jaw moves but makes no sound.');
  }
}

// ── Talk to nearby skeleton ───────────────────────────────────────────────────
function talkToSkeleton() {
  if (dialogueActive) { closeDialogue(); return; }

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
  if (e.key.toLowerCase() === 'f' && state === 'play' && !dialogueActive) {
    useItem();
  }

  // Talk to skeleton
  if (e.key.toLowerCase() === 't' && state === 'play') {
    talkToSkeleton();
  }
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

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

    // Win check
    if (skeletons.every(s => !s.alive)) {
      state = 'win';
      showOverlay('🎉 You Escaped!', '#ffe066',
        'All skeletons have been vanquished!<br/>You escaped the Haunted Island!',
        'Play Again');
    }
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
      const t = MAP_TEMPLATE[row][col];
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

    // Shadow
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(sx, sk.y + sk.h + 2, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Body
    ctx.fillStyle = chasing ? '#f0f0f0' : '#d0d0c0';
    ctx.strokeStyle = chasing ? '#ff4444' : '#808070';
    ctx.lineWidth = 1.5;

    // Torso
    ctx.fillRect(sx - 7, sk.y + 10 + wobble, 14, 12);
    ctx.strokeRect(sx - 7, sk.y + 10 + wobble, 14, 12);

    // Skull
    ctx.beginPath();
    ctx.arc(sx, sk.y + 7 + wobble, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Eye sockets
    ctx.fillStyle = chasing ? '#ff0000' : '#222';
    ctx.fillRect(sx - 5, sk.y + 4 + wobble, 4, 4);
    ctx.fillRect(sx + 1,  sk.y + 4 + wobble, 4, 4);

    // Legs
    ctx.strokeStyle = chasing ? '#ff4444' : '#808070';
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

    // "[T] Talk" label when player is within talk range
    if (!dialogueActive && state === 'play') {
      const pc = { x: player.x + player.w / 2, y: player.y + player.h / 2 };
      if (dist(pc, { x: sx, y: sy }) < SKEL_TALK_RANGE) {
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#ffe066';
        ctx.globalAlpha = 0.85 + 0.15 * Math.sin(animTick * 4);
        ctx.fillText('[T] Talk', sx, sk.y - 4);
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
