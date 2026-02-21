# Tech Stack Register

> Load when technical choices, tools, or frameworks come up.
> Contains: languages, frameworks, libraries, infrastructure, constraints, versions.

<!-- Add entries as: ## [Project/Context] with subheadings for Languages, Frameworks, Tools, Constraints -->

## Chrome Extension MV3 — Service Worker Constraints

- **claim**: `chrome.windows.getCurrent()` is unreliable in MV3 service workers (no user-gesture context); use `chrome.tabs.query({ active: true, lastFocusedWindow: true })` to get the tab the user is focused on ^tre25b494ffe
- **confidence**: high
- **evidence**: observed in where-s-the-noise — isCurrentTab was always false until switched to query approach
- **last_verified**: 2026-02-19

- **claim**: `chrome.contextMenus.onShown` does not exist in Chrome's API (it exists in Firefox/WebExtensions only); accessing `.addListener` on it crashes the service worker at startup with status code 15 ^tr241601a802
- **confidence**: high
- **evidence**: confirmed against Chrome contextMenus API reference; caused SW registration failure in where-s-the-noise
- **last_verified**: 2026-02-19

## Emoji-to-PNG icon generation on WSL — 2026-02-21

- **claim**: PIL cannot render color emoji from Windows COLR/CPAL fonts (e.g. `seguiemj.ttf`) on Linux — glyphs render as blank/white. Headless Chromium also fails without a Linux color emoji font. Reliable solution: download Twemoji SVG + convert with ImageMagick `convert -background none -resize NxN emoji.svg icon.png` ^tr5b9d3e6f01
- **confidence**: high
- **evidence**: PIL rendered white pixels; Chromium rendered blank; ImageMagick + Twemoji SVG produced correct color emoji at all three sizes (16, 48, 128px)
- **last_verified**: 2026-02-21

### Notes
- Twemoji 🤫 SVG URL: `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f92b.svg`
- ImageMagick must be available (`convert --version`)
- Installing `fonts-noto-color-emoji` via apt would also fix Chromium rendering, but requires sudo
