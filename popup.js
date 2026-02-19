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
      content.innerHTML = '';
      noisyTabsList.forEach(tab => {
        const cleanTitle = tab.title.replace(/^\(\d+\)\s*/, '');
        const tabTitle = cleanTitle.length > 30 ? cleanTitle.substring(0, 27) + '...' : cleanTitle;

        const item = document.createElement('div');
        item.className = 'tab-item';

        if (tab.favIconUrl) {
          const img = document.createElement('img');
          img.className = 'tab-favicon';
          img.src = tab.favIconUrl;
          img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
          item.appendChild(img);
        }

        const titleDiv = document.createElement('div');
        titleDiv.className = 'tab-title';
        titleDiv.title = cleanTitle;
        titleDiv.textContent = tabTitle;
        item.appendChild(titleDiv);

        const actions = document.createElement('div');
        actions.className = 'tab-actions';

        const switchBtn = document.createElement('button');
        switchBtn.className = 'switch-btn';
        switchBtn.textContent = 'Switch';
        switchBtn.addEventListener('click', () => {
          chrome.tabs.update(tab.id, { active: true });
          window.close();
        });
        actions.appendChild(switchBtn);

        const muteBtn = document.createElement('button');
        muteBtn.className = tab.muted ? 'unmute-btn' : 'mute-btn';
        muteBtn.textContent = tab.muted ? 'Unmute' : 'Mute';
        muteBtn.addEventListener('click', () => {
          chrome.tabs.update(tab.id, { muted: !tab.muted });
          window.close();
        });
        actions.appendChild(muteBtn);

        item.appendChild(actions);
        content.appendChild(item);
      });
    }
  } catch (error) {
    console.error('Error loading noisy tabs:', error);
    content.innerHTML = '<div class="no-tabs">Error loading tabs. Please try again.</div>';
  }
}

// Load tabs when popup opens
document.addEventListener('DOMContentLoaded', loadNoisyTabs);
