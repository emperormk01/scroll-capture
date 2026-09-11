# scroll-capture

Smooth scroll capture - Playwright + Chromium + FFmpeg.

Turn any site into a buttery scroll video. Same settings as the Auxlo.xyz demo that went clean: instant scroll plus double `requestAnimationFrame` plus 80ms settle plus `animations: disabled`, stitched at 30fps with Lanczos.

People are dying for this because screen records shake, Loom jitters, and manual scrolls are uneven. This is programmatic, frame perfect.

## Install

```bash
npm install -g scroll-capture
# or
bunx scroll-capture --help
# or
npx scroll-capture --help
```

Requires `ffmpeg` (`apt install ffmpeg` or `brew install ffmpeg`) and Playwright Chromium (`npx playwright install chromium`).

## Usage

```bash
scroll-capture https://auxlo.xyz -o auxlo.mp4
scroll-capture https://example.com --frames 120 --fps 60 -o out.mp4
scroll-capture https://auxlo.xyz --width 1920 --height 1080 -o 1080p.mp4
scrollvid https://auxlo.xyz -o auxlo.mp4 # alias
```

Options:

- `-o, --output` - Output mp4 (default: `scroll.mp4`)
- `--width` - Viewport width (default: 1280)
- `--height` - Viewport height (default: 720)
- `--frames` - Frames to capture (default: 90)
- `--fps` - Framerate (default: 30)

## How it works

1. Opens the URL in headless Chromium at your viewport
2. Forces `scroll-behavior: auto` and disables smooth plus reduced motion
3. Scrolls from top to bottom with `behavior: instant`, double `rAF`, and 80ms settle per frame
4. Captures each frame with `animations: disabled`
5. Stitches with `ffmpeg -framerate 30 -i frames/%04d.png -c:v libx264 -pix_fmt yuv420p -vf scale=...`

Result is shake free, 30fps, Lanczos scaled.

## Quality

Default 90 frames at 30fps gives a 3 second scroll for a 5k page at 1280x720. Increase `--frames` for longer or slower scrolls.

Peak quality because every frame is a full PNG before h264.

## License

MIT - Emperor M.K
