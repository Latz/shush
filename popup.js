// Popup script for Shush! extension

async function loadNoisyTabs() {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="no-tabs">${chrome.i18n.getMessage('popupScanning')}</div>`;

  try {
    const [noisyTabs, [currentActiveTab]] = await Promise.all([
      chrome.tabs.query({ audible: true }),
      chrome.tabs.query({ active: true, currentWindow: true })
    ]);

    const noisyTabsList = [];
    let totalAudioTabs = 0;

    for (const tab of noisyTabs) {
      // Skip tabs without URLs (like chrome:// pages)
      if (!tab.url?.startsWith('http')) continue;

      totalAudioTabs++;
      const isActiveInCurrentWindow = currentActiveTab && tab.id === currentActiveTab.id;
      if (!isActiveInCurrentWindow) {
        noisyTabsList.push({
          id: tab.id,
          title: tab.title || chrome.i18n.getMessage('untitled'),
          url: tab.url,
          favIconUrl: tab.favIconUrl || '',
          muted: tab.mutedInfo?.muted || false
        });
      }
    }

    // Handle different scenarios
    if (totalAudioTabs === 0) {
      content.innerHTML = `<div class="no-tabs">${chrome.i18n.getMessage('noAudio')}</div>`;
    } else if (noisyTabsList.length === 0) {
      content.innerHTML = `<div class="no-tabs">${chrome.i18n.getMessage('audioCurrentTab')}</div>`;
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
        switchBtn.textContent = chrome.i18n.getMessage('btnSwitch');
        switchBtn.addEventListener('click', () => {
          chrome.tabs.update(tab.id, { active: true });
          window.close();
        });
        actions.appendChild(switchBtn);

        const muteBtn = document.createElement('button');
        muteBtn.className = tab.muted ? 'unmute-btn' : 'mute-btn';
        muteBtn.textContent = tab.muted ? 'Unshush!' : 'Shush!';
        muteBtn.addEventListener('click', async () => {
          const nowMuted = !tab.muted;
          try {
            // Delegate mute to background service worker to avoid popup-context revert
            const response = await chrome.runtime.sendMessage({ action: 'muteTab', tabId: tab.id, muted: nowMuted });
            const actuallyMuted = response?.muted ?? nowMuted;
            tab.muted = actuallyMuted;
            muteBtn.textContent = actuallyMuted ? 'Unshush!' : 'Shush!';
            muteBtn.className = actuallyMuted ? 'unmute-btn' : 'mute-btn';
          } catch (err) {
            console.error('Mute failed:', err);
          }
        });
        actions.appendChild(muteBtn);

        item.appendChild(actions);
        content.appendChild(item);
      });
    }
  } catch (error) {
    console.error('Error loading noisy tabs:', error);
    content.innerHTML = `<div class="no-tabs">${chrome.i18n.getMessage('errorLoadTabs')}</div>`;
  }
}

// Load tabs when popup opens
document.addEventListener('DOMContentLoaded', loadNoisyTabs);
