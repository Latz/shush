# Changelog

All notable changes to Shush! are documented in this file.

## [Unreleased]

### Major

- **[Major]** "Mute All" button in the popup — shush-mutes every listed background tab in one click. Hidden when nothing is unmuted, disabled while the batch runs, and one failing tab no longer stops the rest.
- **[Major]** Keyboard shortcut `Ctrl+Shift+M` to mute/unmute the current tab without opening the popup.
- **[Major]** Full localisation in six languages (English, German, French, Spanish, Japanese, Chinese) — popup, context menu, notifications and the extension description.
- **[Major]** Automatic dark mode following the system theme.
- **[Major]** Media-element muting via injected content script, so muting also works in Vivaldi where the tab-level mute is unreliable. Newly added audio/video elements stay muted, and the page's own scripts can no longer un-mute a tab behind your back.
- **[Major]** Popup listing every noisy tab with its favicon and title, plus per-tab "Switch" and "Shush!"/"Unshush!" buttons.
- **[Major]** "Find Noisy Tabs" context menu that rebuilds itself as tabs start and stop playing audio, with a Switch/Mute submenu per tab.

### Minor

- Fixed muted tabs occasionally being forgotten entirely: the background worker could act on its saved list before that list had finished loading, and closing a tab in that window wiped the saved state.
- Mute state is now written to storage immediately instead of a fraction of a second later, so it can no longer be lost when the browser shuts the background worker down.
- The popup now saves its tab list as it changes rather than while closing, where the save frequently did not complete.
- Narrowed the site access permission from all URLs to web pages (`http`/`https`) only — the extension never acted on other address types.
- The popup's scrollbar is now slim and reserves its space, so a long list of noisy tabs no longer shifts sideways the moment the scrollbar appears.
- Button labels now use a browser-computed contrast colour, keeping them legible on every button background.
- Popup stylesheet modernised to current web standards (single set of colour tokens covering both themes, logical properties, balanced heading wrapping). No visual change intended.
- The "Find Noisy Tabs" context menu is now updated in place when a tab is muted or you switch tabs, instead of being torn down and rebuilt each time. It is still rebuilt when tabs start or stop making noise, so the menu order always follows the tab order.
- The popup builds its tab list in one go before showing it, rather than adding entries one by one.
- The injected mute script now only inspects newly added DOM nodes instead of re-scanning the whole page on every mutation. Removes noticeable slowdown on busy pages (live chat, infinite scroll) while a tab is muted.
- Background worker no longer fetches every open tab on each update when nothing is shush-muted — it queries only audible tabs in that case.
- Repeated mute re-injections are now throttled to once per second per tab. Pages that start and stop audio frequently (ad breaks, gaps between tracks) no longer trigger a script injection into every frame each time. Re-injection after a page navigation is unaffected.
- Popup opens with one fewer browser query: the audible-tab list is derived from the tab list it already requests.
- Switching to a tab that lives in a different Vivaldi Workspace now shows a notification explaining why the tab did not visibly come to the front.
- Fixed a short audio "peep" in Vivaldi when muting a tab.
- Muted tabs are remembered across popup open/close cycles and across service worker restarts, and stale entries are cleared when a new browser session starts.
- Tabs muted from the context menu now also appear in the popup, so they can be unmuted from either place.
- Mute/unmute state in the popup updates immediately instead of waiting for the browser to respond.
- Switching to a tab now also focuses its window.
- Media that a player paused on mute resumes when you unmute.
- Mute stays applied after a page navigation and when a muted tab starts producing audio again (Vivaldi).
- The current tab is labelled as such in the context menu and shown as a plain entry without Switch/Mute sub-items.
- Leading notification counts (for example "(3)") are stripped from tab titles.
- Toolbar icon redesigned as the 🤫 emoji.
- Favicons that fail to load are removed from the popup instead of leaving a gap, and mute buttons have a fixed width so the layout no longer shifts when the label changes.
- Various speed-ups reducing the number of browser API calls: badge and menu updates merged into one pass, tab queries parallelised, debounced updates on rapid tab switching, and an event filter so only relevant tab updates are processed (with an automatic fallback for browsers that reject it).

### Deletions

- Removed the action-icon badge.
- Removed the "Close Menu" entry from the context menu.
- Removed the "Refresh" button from the popup — the list now updates on its own.
- Removed the `activeTab` permission, which was unused.
