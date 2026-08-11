# Changelog

All notable changes to Shush! are documented in this file.

## [Unreleased]

## [1.0.0] - 2026-08-11

First release.

### Major

- **[Major]** "Mute All" button in the popup — shush-mutes every listed background tab in one click. Hidden when nothing is unmuted, disabled while the batch runs, and one failing tab no longer stops the rest.
- **[Major]** Keyboard shortcut `Ctrl+Shift+M` to mute/unmute the current tab without opening the popup.
- **[Major]** Full localisation in English and German — popup, context menu, notifications and the extension description.
- **[Major]** Automatic dark mode following the system theme.
- **[Major]** Media-element muting via injected content script, so muting also works in Vivaldi where the tab-level mute is unreliable. Newly added audio/video elements stay muted, and the page's own scripts can no longer un-mute a tab behind your back.
- **[Major]** Popup listing every noisy tab with its favicon and title, plus per-tab "Switch" and "Shush!"/"Unshush!" buttons.
- **[Major]** "Find Noisy Tabs" context menu that rebuilds itself as tabs start and stop playing audio, with a Switch/Mute submenu per tab.

### Minor

- Muted tabs are remembered across popup open/close cycles and across browser restarts, and stale entries are cleared when a new session starts.
- Tabs muted from the context menu also appear in the popup, so they can be unmuted from either place.
- Mute survives page navigation and a muted tab starting to play again — needed in Vivaldi, which drops the mute on load.
- Media that a player paused on mute resumes when you unmute.
- Switching to a tab also focuses its window, and warns when the tab sits in a different Vivaldi Workspace and so cannot be brought to the front.
- The current tab is labelled as such in the context menu and shown as a plain entry without Switch/Mute sub-items.
- Leading notification counts (for example "(3)") are stripped from tab titles.
- Favicons that fail to load are removed from the popup instead of leaving a gap, and mute buttons have a fixed width so the layout does not shift when the label changes.
- Requires Chrome 122 or newer.

### Site access

- Access to `http`/`https` pages only, used solely to inject the muting script into tabs you have explicitly muted. The `favicon` permission serves tab icons from the browser's own cache, so opening the popup sends no request to the listed sites.
