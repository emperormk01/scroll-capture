#!/usr/bin/env bun
/**
 * scroll-capture - Smooth scroll capture with Playwright + FFmpeg
 * Instant scroll + double rAF + 240ms settle (3x slower) + animations disabled + arrow cursor + zoom focus
 */

import { chromium } from "playwright";
import { mkdirSync, rmSync, readFileSync } from "fs";
import { spawnSync } from "child_process";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    output: { type: "string", short: "o", default: "scroll.mp4" },
    width: { type: "string", default: "1280" },
    height: { type: "string", default: "720" },
    frames: { type: "string", default: "90" },
    fps: { type: "string", default: "30" },
    script: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`
scroll-capture - Turn any site into a buttery scroll video

Usage:
  scroll-capture <url> [options]

Options:
  -o, --output <file>   Output mp4 (default: scroll.mp4)
  --width <px>          Viewport width (default: 1280)
  --height <px>         Viewport height (default: 720)
  --frames <n>          Frames to capture (default: 90)
  --fps <n>             Framerate (default: 30)
  --script <file>       JSON script for interactions (click, type, hover, wait)
  -h, --help            Show this help

Settings (human-friendly):
  - scroll-behavior: auto, instant scroll + double rAF + 240ms settle (3x slow)
  - arrow cursor tilted left + smooth glide + ripple + zoom focus on click
  - typing is character-by-character, not instant fill
  - scale: Lanczos
`);
  process.exit(0);
}

const url = positionals[0];
if (!url.startsWith("http")) {
  console.error("URL must start with http:// or https://");
  process.exit(1);
}

const output = values.output as string;
const width = parseInt(values.width as string);
const height = parseInt(values.height as string);
const frames = parseInt(values.frames as string);
const fps = parseInt(values.fps as string);

const framesDir = "/tmp/scroll-capture-frames";
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

console.log(`Opening ${url} at ${width}x${height}...`);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width, height } });
const page = await context.newPage();

await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(4500);

// Kill shake: force instant scroll and disable animations (keep transitions for zoom/cursor)
await page.addStyleTag({
  content: `* { scroll-behavior: auto !important; } html, body { scroll-behavior: auto !important; }`,
});

// Visible arrow cursor + zoom container
await page.addStyleTag({
  content: `
    #scroll-capture-cursor {
      position: fixed;
      width: 28px;
      height: 28px;
      background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M3 3 L3 22 L8.5 14.5 L11.5 18.5 L13.5 16.5 L10.5 12.5 L20 8 Z" fill="white" stroke="black" stroke-width="1.6" stroke-linejoin="round"/></svg>') no-repeat;
      background-size: contain;
      pointer-events: none;
      z-index: 999999;
      filter: drop-shadow(0 2px 6px rgba(0,0,0,0.35));
      transform: rotate(-10deg);
      transition: transform 0.12s ease-out;
      will-change: left, top;
      left: 50%;
      top: 50%;
    }
    #scroll-capture-cursor.clicking { transform: rotate(-10deg) scale(0.88); }
    #scroll-capture-cursor::after {
      content: ""; position: absolute; width: 36px; height: 36px;
      border: 2px solid rgba(0,0,0,0.15); border-radius: 50%;
      top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0); opacity: 0; pointer-events: none;
    }
    #scroll-capture-cursor.ripple::after { animation: cursor-ripple 0.6s ease-out; }
    @keyframes cursor-ripple { 0% { transform: translate(-50%, -50%) scale(0); opacity: 1; } 100% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; } }
    #scroll-zoom-wrap { transition: transform 0.55s cubic-bezier(0.2,0,0.2,1); transform-origin: 50% 50%; will-change: transform; }
    #scroll-zoom-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.0); pointer-events: none; z-index: 999998;
      transition: background 0.4s ease; opacity: 0;
    }
    #scroll-zoom-backdrop.active { background: rgba(0,0,0,0.18); opacity: 1; }
    #scroll-zoom-highlight {
      position: fixed; border: 2px solid rgba(255,218,110,0.0); border-radius: 12px;
      box-shadow: 0 0 0 0 rgba(255,218,110,0); pointer-events: none; z-index: 999998;
      transition: all 0.4s ease; opacity: 0;
    }
    #scroll-zoom-highlight.active { border-color: rgba(255,218,110,0.95); box-shadow: 0 8px 32px rgba(0,0,0,0.25), 0 0 0 4px rgba(255,218,110,0.3); opacity: 1; }
  `,
});

await page.evaluate(() => {
  // Wrap body for zoom (keep cursor fixed outside wrap)
  const wrap = document.createElement("div");
  wrap.id = "scroll-zoom-wrap";
  while (document.body.firstChild) wrap.appendChild(document.body.firstChild);
  document.body.appendChild(wrap);
  const backdrop = document.createElement("div");
  backdrop.id = "scroll-zoom-backdrop";
  document.body.appendChild(backdrop);
  const highlight = document.createElement("div");
  highlight.id = "scroll-zoom-highlight";
  document.body.appendChild(highlight);

  const cursor = document.createElement("div");
  cursor.id = "scroll-capture-cursor";
  document.body.appendChild(cursor);
  let curX = window.innerWidth / 2;
  let curY = window.innerHeight / 2;
  cursor.style.left = curX + "px";
  cursor.style.top = curY + "px";

  // Smooth glide helper
  (window as any).__moveCursorTo = async (x: number, y: number, ms = 650) => {
    const startX = curX, startY = curY;
    const start = performance.now();
    return new Promise<void>((resolve) => {
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / ms);
        const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOut
        curX = startX + (x - startX) * e;
        curY = startY + (y - startY) * e;
        cursor.style.left = curX + "px";
        cursor.style.top = curY + "px";
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  };
  (window as any).__cursorClickIn = () => {
    cursor.classList.add("clicking", "ripple");
    setTimeout(() => cursor.classList.remove("ripple"), 600);
  };
  (window as any).__cursorClickOut = () => cursor.classList.remove("clicking");

  (window as any).__zoomIn = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // Choose scale based on element size - smaller elements get more zoom
    const scale = r.width < 300 ? 1.65 : r.width < 500 ? 1.4 : 1.25;
    const originX = (cx / window.innerWidth) * 100;
    const originY = (cy / window.innerHeight) * 100;
    wrap.style.transformOrigin = `${originX}% ${originY}%`;
    wrap.style.transform = `scale(${scale})`;
    backdrop.classList.add("active");
    highlight.style.left = r.left - 6 + "px";
    highlight.style.top = r.top - 6 + "px";
    highlight.style.width = r.width + 12 + "px";
    highlight.style.height = r.height + 12 + "px";
    highlight.classList.add("active");
  };
  (window as any).__zoomOut = () => {
    wrap.style.transform = "scale(1)";
    backdrop.classList.remove("active");
    highlight.classList.remove("active");
  };
  // Keep cursor tracking real mouse for fallback
  document.addEventListener("mousemove", (e) => {
    // only update if not animating via __moveCursorTo
  });
});

// Helpers to get element center
async function getCenter(selector: string) {
  const box = await page.locator(selector).first().boundingBox().catch(() => null);
  if (box) return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
  // Fallback via evaluate
  const rect = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top };
  }, selector);
  if (rect) return { x: rect.x, y: rect.y, box: { x: rect.left, y: rect.top, width: rect.w, height: rect.h } as any };
  return null;
}

async function smoothClick(selector: string) {
  const center = await getCenter(selector);
  if (center) {
    await page.evaluate(({ x, y }) => (window as any).__moveCursorTo(x, y, 700), { x: center.x, y: center.y });
    await page.waitForTimeout(250);
    // Zoom in before click
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) (window as any).__zoomIn(el);
    }, selector);
    await page.waitForTimeout(550);
    await page.evaluate(() => (window as any).__cursorClickIn());
    await page.click(selector, { timeout: 5000 }).catch((e) => console.log(`  click failed: ${e.message}`));
    await page.waitForTimeout(300);
    await page.evaluate(() => (window as any).__cursorClickOut());
    await page.waitForTimeout(900);
    await page.evaluate(() => (window as any).__zoomOut());
    await page.waitForTimeout(500);
  } else {
    console.log(`  center not found for ${selector}, direct click`);
    await page.click(selector, { timeout: 5000 }).catch((e) => console.log(`  click failed: ${e.message}`));
  }
  await page.waitForTimeout(1800);
}

async function smoothType(selector: string, text: string) {
  const center = await getCenter(selector);
  if (center) {
    await page.evaluate(({ x, y }) => (window as any).__moveCursorTo(x, y, 600), { x: center.x, y: center.y });
    await page.waitForTimeout(200);
    await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement;
      if (el) (window as any).__zoomIn(el);
    }, selector);
    await page.waitForTimeout(450);
  }
  // Focus, clear, then type char by char so it's visible (not pre-filled)
  await page.click(selector, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(200);
  await page.keyboard.press("ControlOrMeta+A").catch(() => {});
  await page.waitForTimeout(150);
  await page.keyboard.press("Backspace").catch(() => {});
  await page.waitForTimeout(200);
  // Type with delay - human visible
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: 110 });
    // Tiny cursor nudge to feel alive
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(600);
  if (center) {
    await page.evaluate(() => (window as any).__zoomOut());
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1200);
}

// Run interaction script if provided (for demo videos)
const scriptPath = values.script as string | undefined;
if (scriptPath) {
  console.log(`Running interaction script: ${scriptPath}`);
  const raw = readFileSync(scriptPath, "utf-8");
  const steps: any[] = JSON.parse(raw);
  for (const step of steps) {
    if (step.click) {
      console.log(`  click ${step.click}`);
      await smoothClick(step.click);
    } else if (step.fill) {
      const [sel, text] = Array.isArray(step.fill) ? step.fill : [step.fill.selector, step.fill.text];
      console.log(`  fill (typed) ${sel} -> ${text}`);
      await smoothType(sel, text);
    } else if (step.type) {
      const sel = step.type.selector || step.selector;
      const text = step.type.text || step.text;
      console.log(`  type ${sel} -> ${text}`);
      await smoothType(sel, text);
    } else if (step.hover) {
      console.log(`  hover ${step.hover}`);
      const c = await getCenter(step.hover);
      if (c) await page.evaluate(({ x, y }) => (window as any).__moveCursorTo(x, y, 600), { x: c.x, y: c.y });
      await page.hover(step.hover, { timeout: 5000 }).catch((e) => console.log(`  hover failed: ${e.message}`));
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) (window as any).__zoomIn(el);
      }, step.hover).catch(() => {});
      await page.waitForTimeout(1400);
      await page.evaluate(() => (window as any).__zoomOut()).catch(() => {});
      await page.waitForTimeout(1600);
    } else if (step.wait) {
      const ms = typeof step.wait === "number" ? step.wait : parseInt(step.wait);
      console.log(`  wait ${ms}ms`);
      await page.waitForTimeout(ms);
    } else if (step.scroll) {
      const y = typeof step.scroll === "number" ? step.scroll : parseInt(step.scroll);
      console.log(`  scroll to ${y}`);
      await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: "instant" }), y);
      await page.waitForTimeout(1200);
    } else if (step.keypress || step.press) {
      const key = step.keypress || step.press;
      console.log(`  press ${key}`);
      await page.keyboard.press(key);
      await page.waitForTimeout(900);
    } else if (step.evaluate) {
      console.log(`  evaluate ${step.evaluate.slice(0, 40)}`);
      await page.evaluate(new Function(step.evaluate) as any);
      await page.waitForTimeout(900);
    }
  }
  console.log("Script done, starting scroll capture...");
}

const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
const scrollHeight = Math.max(0, bodyHeight - height);
console.log(`bodyHeight=${bodyHeight} scrollHeight=${scrollHeight} frames=${frames} fps=${fps}`);

for (let i = 0; i < frames; i++) {
  const progress = frames === 1 ? 0 : i / (frames - 1);
  const y = Math.round(progress * scrollHeight);
  await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: "instant" }), y);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(240);
  await page.screenshot({ path: `${framesDir}/${String(i).padStart(4, "0")}.png`, animations: "disabled" });
  if (i % 15 === 0) console.log(`frame ${i}/${frames} y=${y}`);
}

await browser.close();
console.log(`Captured ${frames} frames, stitching with FFmpeg...`);

const ffmpegArgs = [
  "-y",
  "-framerate",
  String(fps),
  "-i",
  `${framesDir}/%04d.png`,
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-vf",
  `scale=${width}:${height}:flags=lanczos`,
  output,
];

const result = spawnSync("ffmpeg", ffmpegArgs, { stdio: "inherit" });
if (result.status !== 0) {
  console.error("FFmpeg failed. Is ffmpeg installed? (apt install ffmpeg / brew install ffmpeg)");
  process.exit(1);
}

console.log(`Done: ${output} (${width}x${height}, ${fps}fps, ${frames} frames)`);
