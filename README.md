# 💀 Haunted Island

A browser-based survival game built with vanilla HTML5 Canvas.

## How to Play

Open `index.html` in any modern browser — no build step required.

### Objective

You are stranded on a haunted island.  Skeletons roam the island and will
chase you on sight.  Collect weapons and potions scattered across the island,
then use them to destroy every skeleton.  Destroy them all to escape!

### Controls

| Key | Action |
|-----|--------|
| `W` / `↑` | Move up |
| `S` / `↓` | Move down |
| `A` / `←` | Move left |
| `D` / `→` | Move right |
| `F` | Use held item on a nearby skeleton |

### Items

| Item | Range | Description |
|------|-------|-------------|
| ⚗️ Holy Water | 70 px | Dissolves skeletons on contact |
| 🔦 Torch | 55 px | Burns skeletons within reach |
| 🗡️ Silver Dagger | 50 px | Stabs skeletons at close range |

### Tips

* Skeletons have a sight range — stay out of it or run!
* You have **3 hearts**; after losing all three the game ends.
* You get brief **invincibility frames** after being hit — use them to escape.
* Only one item can be held at a time.  Unused items stay on the ground.

## Files

```
index.html   – Game page and HUD
style.css    – Styling and overlay
game.js      – All game logic (canvas rendering, AI, collision)
```

## Inspiration

Inspired by [Gemma Journey](https://github.com/google/gemma-journey).