# 🔊 Where's the Noise

You know that moment when music is playing somewhere and you have no idea which of your 30 tabs is responsible? That's what this extension is for.

It watches all your tabs and tells you which ones are making noise — and lets you mute or jump to them without hunting around.

---

## 📦 Installation

No Chrome Web Store, no auto-updates — just load it directly:

1. Go to `chrome://extensions/`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select the `where-s-the-noise` folder

That's it. The extension icon appears in your toolbar.

---

## 🎛️ Three ways to use it

### 1. 🔢 The badge

The number on the extension icon tells you how many tabs are currently playing audio. It updates automatically whenever a tab starts or stops making noise — no clicking required. If you see a `2`, two tabs are playing something.

### 2. 🪟 The popup

Click the extension icon to open the popup. It immediately shows you which background tabs are making noise, along with two buttons per tab:

- **Switch** — jumps to that tab
- **Mute / Unmute** — silences (or un-silences) the tab without switching to it

If the current tab is the only one making noise, the popup says so. If everything is quiet, it says that too.

Hit **Refresh** to re-scan if anything changed while the popup was open.

### 3. 🖱️ The right-click menu

Right-click anywhere on a page and you'll see **Find Noisy Tabs** in the context menu. The menu already shows the current noisy tabs as sub-items — no extra click needed. Each noisy tab has:

- **Switch to Tab** — takes you there
- **Mute Tab / Unmute Tab** — toggles mute

If the current page itself is noisy it shows up in the list marked as `(current tab)` — no sub-items, since switching to yourself doesn't make much sense.

The context menu updates automatically in the background whenever a tab's audio state changes, so what you see on the first right-click is always fresh.

---

## 🤔 What counts as "noisy"?

Any tab where audio is actually coming out — YouTube playing, Spotify running, a video call, a website with autoplay. A paused video doesn't count. A muted tab still shows up (it's technically audible, just silenced by Chrome).

`chrome://` pages and other non-HTTP tabs are ignored.

---

## 🔑 Permissions

| Permission | Why |
|---|---|
| `tabs` | Read tab titles, audio state, and switch/mute tabs |
| `activeTab` | Identify which tab you're currently on |
| `windows` | Find the focused window |
| `contextMenus` | Build the right-click menu |
| `notifications` | Show a notification when "Find Noisy Tabs" finds nothing |
| `scripting` | Inject a script into tabs you mute or unmute to silence `<audio>` and `<video>` elements directly, including inside embedded frames (e.g. video players in iframes) — needed for browsers (e.g. Vivaldi) where the standard tab mute API does not silence audio playback |
| `<all_urls>` (host permission) | Required by the `scripting` API to inject into tabs regardless of which site they're on — the injected script only sets `.muted` on media elements and reads nothing |

---

## 🛠️ Troubleshooting

**🔢 Badge shows a number but the popup says "All quiet!"**
The popup only lists *background* tabs. If the badge shows `1` and you're currently on that tab, the popup correctly tells you the noise is coming from where you already are.

**👻 A tab is making noise but doesn't appear**
Chrome's `audible` flag only fires when audio is actually outputting sound. If the tab just loaded or is buffering, give it a second and hit Refresh.

**😴 The extension stopped responding**
Chrome occasionally suspends the background service worker. Reloading the extension at `chrome://extensions/` brings it back.

**🔇 Mute doesn't silence everything on a tab**
The mute function silences standard `<audio>` and `<video>` elements. Audio generated via the Web Audio API (used by some games, music tools, and interactive visualizers) is not affected — there is no browser API that lets extensions reach those audio sources after a page has loaded.
