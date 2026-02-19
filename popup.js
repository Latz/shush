// Popup script for Where's the Noise extension

async function loadNoisyTabs() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="no-tabs">Scanning for noisy tabs...</div>';

  try {
    // Get all tabs from all windows
    const allTabs = await chrome.tabs.query({});
    console.log('Found', allTabs.length, 'tabs');

    // Get the current window and its active tab
    const currentWindow = await chrome.windows.getCurrent({ populate: true });
    const currentActiveTab = currentWindow.tabs.find(t => t.active);
    console.log('Current active tab:', currentActiveTab?.title);

    // Check each tab for audio
    const noisyTabsList = [];
    let totalAudioTabs = 0;

    for (const tab of allTabs) {
      // Skip tabs without URLs (like chrome:// pages)
      if (!tab.url || !tab.url.startsWith('http')) continue;

      // Check if tab is audible
      const isAudible = tab.audible;
      // Only consider a tab "not noisy" if it's the active tab in the CURRENT window
      const isActiveInCurrentWindow = currentActiveTab && tab.id === currentActiveTab.id;

      if (isAudible) {
        totalAudioTabs++;
        if (!isActiveInCurrentWindow) {
          noisyTabsList.push({
            id: tab.id,
            title: tab.title || 'Untitled',
            url: tab.url,
            favIconUrl: tab.favIconUrl || '',
            muted: tab.mutedInfo?.muted || false
          });
        }
      }
    }

    console.log('Total audio tabs:', totalAudioTabs);
    console.log('Noisy tabs (not active):', noisyTabsList.length);

    // Handle different scenarios
    if (totalAudioTabs === 0) {
      content.innerHTML = '<div class="no-tabs">No tabs are playing audio. All quiet!</div>';
    } else if (noisyTabsList.length === 0) {
      content.innerHTML = '<div class="no-tabs">All audio is coming from the current tab.</div>';
    } else {
      // Show noisy tabs
      let html = '';
      noisyTabsList.forEach(tab => {
        const tabTitle = tab.title.length > 30 ? tab.title.substring(0, 27) + '...' : tab.title;
        const faviconHtml = tab.favIconUrl ? `<img class="tab-favicon" src="${tab.favIconUrl}">` : '';
        html += `
          <div class="tab-item">
            ${faviconHtml}
            <div class="tab-title" title="${tab.title}">${tabTitle}</div>
            <div class="tab-actions">
              <button class="switch-btn" data-tab-id="${tab.id}">Switch</button>
              <button class="${tab.muted ? 'unmute-btn' : 'mute-btn'}" data-tab-id="${tab.id}" data-action="${tab.muted ? 'unmute' : 'mute'}">
                ${tab.muted ? 'Unmute' : 'Mute'}
              </button>
            </div>
          </div>
        `;
      });
      content.innerHTML = html;

      // Hide favicons that fail to load (inline onerror is blocked by MV3 CSP)
      document.querySelectorAll('img.tab-favicon').forEach(img => {
        img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
      });

      // Add event listeners
      document.querySelectorAll('.switch-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const tabId = parseInt(e.target.dataset.tabId);
          chrome.tabs.update(tabId, { active: true });
          window.close();
        });
      });

      document.querySelectorAll('.mute-btn, .unmute-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const tabId = parseInt(e.target.dataset.tabId);
          const action = e.target.dataset.action;
          chrome.tabs.update(tabId, { muted: action === 'mute' });
          window.close();
        });
      });
    }
  } catch (error) {
    console.error('Error loading noisy tabs:', error);
    content.innerHTML = '<div class="no-tabs">Error loading tabs. Please try again.</div>';
  }
}

// Load tabs when popup opens
document.addEventListener('DOMContentLoaded', loadNoisyTabs);

// Refresh button
document.getElementById('refresh').addEventListener('click', loadNoisyTabs);
