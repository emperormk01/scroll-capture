#!/usr/bin/env bun
/**
 * scroll-capture - Smooth scroll capture with Playwright + FFmpeg
 * Same settings as the Auxlo.xyz demo: instant scroll + double rAF + 80ms settle + animations disabled
 */

import { chromium } from "playwright";
import { mkdirSync, rmSync, existsSync } from "fs";
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
  -h, --help            Show this help

Examples:
  scroll-capture https://auxlo.xyz -o auxlo.mp4
  scroll-capture https://example.com --frames 120 --fps 60 -o out.mp4
  scroll-capture https://auxlo.xyz --width 1920 --height 1080 -o 1080p.mp4

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
await page.waitForTimeout(1500);

// Kill shake: force instant scroll and disable animations
await page.addStyleTag({
  content: `* { scroll-behavior: auto !important; } html, body { scroll-behavior: auto !important; } @media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`,
});

const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
const scrollHeight = Math.max(0, bodyHeight - height);
console.log(`bodyHeight=${bodyHeight} scrollHeight=${scrollHeight} frames=${frames} fps=${fps}`);

for (let i = 0; i < frames; i++) {
  const progress = frames === 1 ? 0 : i / (frames - 1);
  const y = Math.round(progress * scrollHeight);
  await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: "instant" }), y);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(80);
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
