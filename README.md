# scroll-capture

Smooth scroll capture - Playwright + Chromium + FFmpeg.

Turn any site into a buttery scroll video. Same settings as the Auxlo.xyz demo: instant scroll plus double `requestAnimationFrame` plus 80ms settle plus `animations: disabled`, stitched at 30fps with Lanczos.

People are dying for this because screen records shake, Loom jitters, and manual scrolls are uneven. This is programmatic, frame perfect.

## Step by step

### 1. Install prerequisites

You need Node.js 18+, `ffmpeg`, and Chromium.

```bash
# Check Node
node --version # should be >=18

# Install ffmpeg
# Ubuntu / Debian
sudo apt update && sudo apt install -y ffmpeg
# macOS
brew install ffmpeg

# Verify
ffmpeg -version | head -1
```

### 2. Install the tool

Pick one:

```bash
# Option A: Global install (recommended)
npm install -g scroll-capture
scroll-capture --help

# Option B: No install, run directly
npx scroll-capture --help
bunx scroll-capture --help

# Option C: From source
git clone https://github.com/emperormk01/scroll-capture.git
cd scroll-capture
npm install
npx playwright install chromium
```

### 3. Run your first capture

```bash
# Basic: Auxlo.xyz to auxlo.mp4
scroll-capture https://auxlo.xyz -o auxlo.mp4

# Custom: 120 frames at 60fps, 1080p
scroll-capture https://example.com --frames 120 --fps 60 --width 1920 --height 1080 -o out.mp4

# Alias also works
scrollvid https://auxlo.xyz -o auxlo.mp4
```

What happens:

1. Opens the URL in headless Chromium at your viewport (default 1280x720)
2. Forces `scroll-behavior: auto` and disables smooth plus reduced motion
3. Scrolls from top to bottom with `behavior: instant`, double `rAF`, and 80ms settle per frame
4. Captures each frame with `animations: disabled` to `/tmp/frames`
5. Stitches with `ffmpeg -framerate 30 -i frames/%04d.png -c:v libx264 -pix_fmt yuv420p -vf scale=...` to your `-o` file

Result is shake free, 30fps, Lanczos scaled.

### 4. Check output

```bash
ls -lh auxlo.mp4
# 1.2M auxlo.mp4, 1280x720, 30fps, 3s
```

### 5. Tweak quality

- More frames = longer or slower scroll: `--frames 180` for 6 seconds at 30fps
- Higher fps = smoother: `--fps 60` with `--frames 180`
- Higher res: `--width 1920 --height 1080` for 1080p

Peak quality because every frame is a full PNG before h264.

## Options

- `-o, --output` - Output mp4 (default: `scroll.mp4`)
- `--width` - Viewport width (default: 1280)
- `--height` - Viewport height (default: 720)
- `--frames` - Frames to capture (default: 90)
- `--fps` - Framerate (default: 30)
- `-h, --help` - Show help

## Troubleshooting

- `ffmpeg: command not found` - install ffmpeg as in step 1
- `Executable doesn't exist at ... chromium` - run `npx playwright install chromium`
- `401 Unauthorized` - site blocks headless, try `--width` change or add delay
- Video is blank - check URL is reachable, try `https://example.com` first

## License

MIT - Emperor M.K

## Interactions for demo videos

Not impossible. Playwright drives the page for you.

Create a `demo.json`:

```json
[
  { "click": "text=Get Started" },
  { "wait": 800 },
  { "fill": ["input[name=email]", "demo@auxlo.xyz"] },
  { "keypress": "Enter" },
  { "hover": "nav" },
  { "scroll": 1200 }
]
```

Supported steps: `click`, `fill`, `type`, `hover`, `wait`, `scroll`, `keypress`, `evaluate`.

Run:

```bash
scroll-capture https://auxlo.xyz --script demo.json -o demo.mp4
```

It will run the interactions first, then do the smooth scroll capture. Same shake free settings.
