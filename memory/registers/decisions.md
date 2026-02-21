# Decisions Register

> Load when past choices are questioned or a decision needs context.
> Contains: decisions made, rationale, alternatives considered, outcomes.

<!-- Add entries as: ## [Decision] — [Date] with subheadings for Rationale, Alternatives, Outcome -->

## Context menu uses proactive tab-event updates — 2026-02-19

- **claim**: Context menu is rebuilt on `tabs.onUpdated` / `onRemoved` / `onActivated` (proactive), not on user click — so the menu is always current on first right-click ^trde38d5cbb1
- **confidence**: high
- **evidence**: `chrome.contextMenus.onShown` doesn't exist in Chrome; click-triggered rebuild required two right-clicks; proactive approach solves both
- **last_verified**: 2026-02-19

### Rationale
`onShown` (the natural hook for pre-populating a menu) is Firefox-only and crashes Chrome's service worker. Click-triggered rebuilds cause a two-click UX. Proactive updates on tab audio events keep the menu accurate without any extra clicks.

### Alternatives considered
- `onShown` + `refresh()` — Chrome API does not exist; crashed service worker
- Rebuild on `onClicked` — works but requires two right-clicks to see results

## Dark mode via CSS custom properties + media query — 2026-02-21

- **claim**: Dark mode is implemented as pure CSS — 6 color tokens on `:root`, overridden in `@media (prefers-color-scheme: dark)`. No JS involved. ^tr8c2f4a1e7d
- **confidence**: high
- **evidence**: implemented and reviewed in popup.css; `color-scheme: light dark` added to body for native UI elements
- **last_verified**: 2026-02-21

### Rationale
Pure CSS approach is zero-maintenance, automatic, and requires no runtime logic. CSS custom properties make the dark palette a single overridable block. Colored action buttons (green/red/blue) intentionally kept hardcoded — they are branded and readable on both backgrounds.

### Alternatives considered
- JS-based class toggle — rejected (unnecessary complexity, requires storing user preference)
- Separate dark stylesheet — rejected (duplication)

## Mute/Unmute buttons labelled "Shush!" / "Unshush!" — 2026-02-21

- **claim**: The mute button reads "Shush!" and the unmute button reads "Unshush!" — branded to match the extension name ^tra4c7f8b2e9
- **confidence**: high
- **evidence**: changed in popup.js; both initial render and click-handler update use the new labels
- **last_verified**: 2026-02-21

### Rationale
Generic "Mute"/"Unmute" labels were replaced with branded terms that reinforce the extension's identity and tone.
