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
let frameIdx = 0;
async function captureFrame() {
  try {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(()=>{});
    await page.screenshot({ path: `${framesDir}/${String(frameIdx).padStart(4, "0")}.png`, animations: "disabled" }).catch(()=>{});
    frameIdx++;
  } catch {}
}
async function waitAndCapture(ms: number) {
  const step = 1000 / fps;
  let elapsed = 0;
  while (elapsed < ms) {
    const chunk = Math.min(step, ms - elapsed);
    try { await page.waitForTimeout(chunk); } catch {}
    await captureFrame();
    elapsed += chunk;
    if (frameIdx > 1000) break; // safety
  }
}
async function typeWithCapture(selector: string, text: string) {
  await page.click(selector, { timeout: 5000 }).catch(() => {});
  await waitAndCapture(200);
  await page.keyboard.press("ControlOrMeta+A").catch(() => {});
  await waitAndCapture(150);
  await page.keyboard.press("Backspace").catch(() => {});
  await waitAndCapture(200);
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: 110 });
    await waitAndCapture(130);
  }
  await waitAndCapture(600);
}

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
    #scroll-zoom-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.0); pointer-events: none; z-index: 999998;
      transition: background 0.4s ease; opacity: 0;
    }
    #scroll-zoom-backdrop.active { background: rgba(0,0,0,0.18); opacity: 1; }
    #scroll-zoom-highlight {
      display: none; /* disabled per user: no yellow pill border */
    }
  `,
});

await page.evaluate(() => {
  const backdrop = document.createElement("div");
  backdrop.id = "scroll-zoom-backdrop";
  document.body.appendChild(backdrop);

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

  let _zoomedEl: HTMLElement | null = null;
  let _zoomedOrigTransform = "";
  (window as any).__zoomIn = (rect: any) => {
    const left = rect.left ?? rect.x ?? 0;
    const top = rect.top ?? rect.y ?? 0;
    const width = rect.width ?? 0;
    const height = rect.height ?? 0;
    backdrop.classList.add("active");
    // Also scale the element itself for true zoom focus
    try {
      const el = document.elementFromPoint(left + width/2, top + height/2) as HTMLElement;
      if (el) {
        _zoomedEl = el.closest('button, a, input, [role="button"]') as HTMLElement || el;
        _zoomedOrigTransform = _zoomedEl.style.transform || "";
        _zoomedEl.style.transition = "transform 0.45s cubic-bezier(0.2,0,0.2,1), box-shadow 0.45s";
        _zoomedEl.style.transform = "scale(1.08)";
        _zoomedEl.style.boxShadow = "0 8px 28px rgba(0,0,0,0.22)";
        _zoomedEl.style.zIndex = "999997";
      }
    } catch {}
  };
  (window as any).__zoomOut = () => {
    backdrop.classList.remove("active");
    if (_zoomedEl) {
      _zoomedEl.style.transform = _zoomedOrigTransform;
      _zoomedEl.style.boxShadow = "";
      _zoomedEl = null;
    }
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
    try { const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top };
    } catch(e) { return null; }
  }, selector);
  if (rect) return { x: rect.x, y: rect.y, box: { x: rect.left, y: rect.top, width: rect.w, height: rect.h } as any };
  return null;
}

async function smoothClick(selector: string) {
  const center = await getCenter(selector);
  if (center) {
    await page.evaluate(({ x, y }) => (window as any).__moveCursorTo(x, y, 700), { x: center.x, y: center.y });
    await waitAndCapture(700);
    await page.evaluate((rect) => {
      if (rect) (window as any).__zoomIn(rect);
    }, center.box);
    await waitAndCapture(550);
    await page.evaluate(() => (window as any).__cursorClickIn());
    await page.click(selector, { timeout: 5000 }).catch((e) => console.log(`  click failed: ${e.message}`));
    await captureFrame();
    await waitAndCapture(300);
    await page.evaluate(() => (window as any).__cursorClickOut());
    await waitAndCapture(900);
    await page.evaluate(() => (window as any).__zoomOut());
    await waitAndCapture(500);
  } else {
    console.log(`  center not found for ${selector}, direct click`);
    await page.click(selector, { timeout: 5000 }).catch((e) => console.log(`  click failed: ${e.message}`));
    await captureFrame();
  }
  await waitAndCapture(800);
}

async function smoothType(selector: string, text: string) {
  const center = await getCenter(selector);
  if (center) {
    await page.evaluate(({ x, y }) => (window as any).__moveCursorTo(x, y, 600), { x: center.x, y: center.y });
    await waitAndCapture(600);
    await page.evaluate((rect) => {
      if (rect) (window as any).__zoomIn(rect);
    }, center.box);
    await waitAndCapture(450);
  }
  await typeWithCapture(selector, text);
  if (center) {
    await page.evaluate(() => (window as any).__zoomOut());
    await waitAndCapture(400);
  }
  await waitAndCapture(600);
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
      if (c) {
        await page.evaluate(({ x, y }) => (window as any).__moveCursorTo(x, y, 600), { x: c.x, y: c.y });
        await waitAndCapture(600);
      }
      await page.hover(step.hover, { timeout: 5000 }).catch((e) => console.log(`  hover failed: ${e.message}`));
      await captureFrame();
      const hoverCenter = await getCenter(step.hover);
      if (hoverCenter) await page.evaluate((rect) => (window as any).__zoomIn(rect), hoverCenter.box).catch(() => {});
      await waitAndCapture(1400);
      await page.evaluate(() => (window as any).__zoomOut()).catch(() => {});
      await waitAndCapture(1600);
    } else if (step.wait) {
      const ms = typeof step.wait === "number" ? step.wait : parseInt(step.wait);
      console.log(`  wait ${ms}ms`);
      await waitAndCapture(ms);
    } else if (step.scroll) {
      const y = typeof step.scroll === "number" ? step.scroll : parseInt(step.scroll);
      console.log(`  scroll to ${y}`);
      await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: "instant" }), y);
      await waitAndCapture(1200);
    } else if (step.keypress || step.press) {
      const key = step.keypress || step.press;
      console.log(`  press ${key}`);
      await page.keyboard.press(key);
      await waitAndCapture(900);
    } else if (step.evaluate) {
      console.log(`  evaluate ${step.evaluate.slice(0, 40)}`);
      await page.evaluate(new Function(step.evaluate) as any);
      await waitAndCapture(900);
    }
  }
  console.log("Script done, starting scroll capture...");
}

let bodyHeight = 0;
let scrollHeight = 0;
try {
  bodyHeight = await page.evaluate(() => document.body.scrollHeight);
  scrollHeight = Math.max(0, bodyHeight - height);
  console.log(`bodyHeight=${bodyHeight} scrollHeight=${scrollHeight} frames=${frames} fps=${fps} alreadyCaptured=${frameIdx}`);
} catch (e) {
  console.log(`bodyHeight evaluate failed (page closed?), using alreadyCaptured=${frameIdx} only`, (e as Error).message?.slice(0,100));
  bodyHeight = height;
  scrollHeight = 0;
}
if (frameIdx === 0) {
  // No script - pure scroll capture
  for (let i = 0; i < frames; i++) {
    const progress = frames === 1 ? 0 : i / (frames - 1);
    const y = Math.round(progress * scrollHeight);
    try {
      await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: "instant" }), y);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(()=>{});
      await page.waitForTimeout(240);
      await page.screenshot({ path: `${framesDir}/${String(frameIdx).padStart(4, "0")}.png`, animations: "disabled" }).catch(()=>{});
    } catch (e) {
      console.log(`scroll frame ${i} failed`, (e as Error).message?.slice(0,80));
      break;
    }
    frameIdx++;
    if (i % 15 === 0) console.log(`frame ${frameIdx}/${frames} y=${y}`);
  }
} else {
  // Script already captured interaction frames - now add scroll frames
  console.log(`Adding ${frames} scroll frames after ${frameIdx} interaction frames`);
  for (let i = 0; i < frames; i++) {
    const progress = frames === 1 ? 0 : i / (frames - 1);
    const y = Math.round(progress * scrollHeight);
    try {
      await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: "instant" }), y);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(()=>{});
      await page.waitForTimeout(240);
      await page.screenshot({ path: `${framesDir}/${String(frameIdx).padStart(4, "0")}.png`, animations: "disabled" }).catch(()=>{});
    } catch (e) {
      console.log(`scroll frame ${i} failed`, (e as Error).message?.slice(0,80));
      break;
    }
    frameIdx++;
    if (i % 15 === 0) console.log(`frame ${frameIdx} y=${y}`);
  }
}
console.log(`Total frames captured: ${frameIdx}`);
if (frameIdx === 0) {
  console.error("No frames captured, abort");
  await browser.close().catch(()=>{});
  process.exit(1);
}

try { await browser.close(); } catch {}
console.log(`Captured ${frameIdx} total frames, stitching with FFmpeg...`);

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
