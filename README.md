# Where's the Noise - Chrome Extension

A Chrome extension that detects tabs playing sound in the background. Find out which tabs are making noise when they're not the active tab!

## Features

- **Tab Audio Detection**: Scans all tabs to find which ones are currently playing audio
- **Background Noise Alert**: Identifies noisy tabs that are not the currently active tab
- **One-Click Actions**: Switch to or mute noisy tabs directly from the popup
- **Real-Time Badge**: Shows the count of audio-playing tabs in the browser toolbar
- **Visual Indicators**: Green badge when current tab is noisy, red when background tabs are noisy

## How It Works

The extension uses Chrome's built-in `tab.audible` property to detect which tabs are actively playing audio. When you click "Find Noisy Tabs", it:

1. Queries all open tabs
2. Checks which tabs have `audible = true`
3. Filters out the currently active tab
4. Displays a list of background tabs playing audio
5. Provides quick actions to switch to or mute those tabs

## Installation

1. **Open Chrome Extensions**:
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode" in the top right corner

2. **Load Unpacked Extension**:
   - Click "Load unpacked"
   - Select the `where-s-the-noise` folder

3. **Verify Installation**:
   - The extension icon should appear in your Chrome toolbar
   - Click it to open the popup interface

## Usage

1. **Open multiple tabs** with audio (YouTube, Spotify, etc.)
2. **Switch to a different tab** (so the audio tab becomes background)
3. **Click the extension icon** in the toolbar
4. **Click "Find Noisy Tabs"**
5. **See results**:
   - **Active Tab Info**: Shows what you're currently viewing
   - **Summary**: Count of noisy background tabs vs total audio tabs
   - **Noisy Tabs List**: Details of each background tab playing audio

### Actions Available

- **Switch to Tab**: Click to immediately switch to that tab
- **Mute Tab**: Click to mute that specific tab

### Badge Colors

- **Red badge**: Background tabs are playing audio
- **Green badge**: Current tab is playing audio
- **No badge**: No audio detected

## Understanding Results

### Status Messages

- **"Found X noisy tab(s) in background"**: Audio detected in non-active tabs
- **"No audio detected in any tabs"**: All tabs are silent
- **"All audio is coming from the current tab"**: Only the active tab is noisy

### What Counts as "Noisy"

Any tab that has `audible = true` (audio is actively playing):
- YouTube videos
- Spotify/Web players
- Video calls (Zoom, Meet, etc.)
- Any website with audio playback

## Permissions

- **tabs**: Access all tabs to check their audio state and switch/mute them

## Technical Details

### How Chrome Detects Audio

Chrome automatically sets the `audible` property on tab objects when:
- Audio elements (`<audio>`, `<video>`) are playing
- Web Audio API is producing sound
- Any tab-generated audio is active

This property updates in real-time, so the extension always shows current state.

### Background Script

The `background.js` monitors:
- Tab updates (audio state changes)
- Tab activation (to update badge)
- Badge color based on active vs background audio

### Popup Script

The `popup.js` handles:
- Scanning all tabs on demand
- Filtering out active tabs
- Displaying results with actions
- Muting/switching to tabs

## Example Scenario

You're working on a document but forgot about a YouTube video playing in another tab:

1. Click "Where's the Noise" extension icon
2. Click "Find Noisy Tabs"
3. See: "Found 1 noisy tab in background"
4. See the YouTube tab listed
5. Click "Mute Tab" to silence it, or "Switch to Tab" to view it

## Troubleshooting

### Extension shows 0 tabs but audio is playing

- **Check if tab is in current window**: Extension only checks current window by default
- **Verify audio is actually playing**: Paused videos won't show as audible
- **Reload the extension**: Go to chrome://extensions/ and click refresh

### Badge not updating

- The badge updates when you switch tabs
- Open/close the popup to force a refresh

## Future Enhancements

- [ ] Multi-window support
- [ ] Audio level indicators
- [ ] Auto-mute after X minutes of background audio
- [ ] Whitelist domains to ignore
- [ ] Notification when background audio starts
- [ ] History of noisy tabs

---

**Made with ❤️ for tab management**
