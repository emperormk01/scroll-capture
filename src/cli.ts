#!/usr/bin/env bun
/**
 * scroll-capture - Smooth scroll capture with Playwright + FFmpeg
 * Same settings as the Auxlo.xyz demo: instant scroll + double rAF + 80ms settle + animations disabled
 */

import { chromium } from "playwright";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
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
  scrollvid <url> [options]

Options:
  -o, --output <file>   Output mp4 (default: scroll.mp4)
  --width <px>          Viewport width (default: 1280)
  --height <px>         Viewport height (default: 720)
  --frames <n>          Frames to capture (default: 90)
  --fps <n>             Framerate (default: 30)
  --script <file>       JSON script for interactions (click, type, hover, wait)
  -h, --help            Show this help

Examples:
  scroll-capture https://auxlo.xyz -o auxlo.mp4
  scroll-capture https://example.com --frames 120 --fps 60 -o out.mp4
  scroll-capture https://auxlo.xyz --width 1920 --height 1080 -o 1080p.mp4
  scroll-capture https://auxlo.xyz --script demo.json -o demo.mp4

Settings (locked for smoothness):
  - scroll-behavior: auto (no smooth)
  - instant scroll + double requestAnimationFrame + 80ms settle
  - animations: disabled for screenshots
  - scale: Lanczos to target size
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

// Kill shake: force instant scroll and disable animations
await page.addStyleTag({
  content: `* { scroll-behavior: auto !important; } html, body { scroll-behavior: auto !important; } @media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`,
});

// Visible cursor for demo videos - arrow tilted left, so humans see clicks
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
    }
    #scroll-capture-cursor.clicking {
      transform: rotate(-10deg) scale(0.88);
    }
    #scroll-capture-cursor::after {
      content: "";
      position: absolute;
      width: 36px;
      height: 36px;
      border: 2px solid rgba(0,0,0,0.15);
      border-radius: 50%;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0);
      opacity: 0;
      pointer-events: none;
    }
    #scroll-capture-cursor.ripple::after {
      animation: cursor-ripple 0.6s ease-out;
    }
    @keyframes cursor-ripple {
      0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; }
    }
  `,
});
await page.evaluate(() => {
  const cursor = document.createElement("div");
  cursor.id = "scroll-capture-cursor";
  document.body.appendChild(cursor);
  let lastX = window.innerWidth / 2;
  let lastY = window.innerHeight / 2;
  cursor.style.left = lastX + "px";
  cursor.style.top = lastY + "px";
  document.addEventListener("mousemove", (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    cursor.style.left = lastX + "px";
    cursor.style.top = lastY + "px";
  });
  document.addEventListener("mousedown", () => {
    cursor.classList.add("clicking", "ripple");
    setTimeout(() => cursor.classList.remove("ripple"), 500);
  });
  document.addEventListener("mouseup", () => {
    cursor.classList.remove("clicking");
  });
  (window as any).__scrollCaptureCursor = cursor;
});

// Run interaction script if provided (for demo videos)
const scriptPath = values.script as string | undefined;
if (scriptPath) {
  console.log(`Running interaction script: ${scriptPath}`);
  const raw = readFileSync(scriptPath, "utf-8");
  const steps: any[] = JSON.parse(raw);
  for (const step of steps) {
    if (step.click) {
      console.log(`  click ${step.click}`);
      await page.click(step.click, { timeout: 5000 }).catch((e) => console.log(`  click failed: ${e.message}`));
      await page.waitForTimeout(1800);
    } else if (step.fill) {
      const [sel, text] = Array.isArray(step.fill) ? step.fill : [step.fill.selector, step.fill.text];
      console.log(`  fill ${sel} -> ${text}`);
      await page.fill(sel, text, { timeout: 5000 }).catch((e) => console.log(`  fill failed: ${e.message}`));
      await page.waitForTimeout(1200);
    } else if (step.type) {
      const sel = step.type.selector || step.selector;
      const text = step.type.text || step.text;
      console.log(`  type ${sel} -> ${text}`);
      await page.fill(sel, text, { timeout: 5000 }).catch(async () => {
        await page.click(sel).catch(() => {});
        await page.keyboard.type(text);
      });
      await page.waitForTimeout(1200);
    } else if (step.hover) {
      console.log(`  hover ${step.hover}`);
      await page.hover(step.hover, { timeout: 5000 }).catch((e) => console.log(`  hover failed: ${e.message}`));
      await page.waitForTimeout(3000);
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
