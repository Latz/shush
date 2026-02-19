document.addEventListener('DOMContentLoaded', function() {
  const status = document.getElementById('status');
  const results = document.getElementById('results');
  const emptyState = document.getElementById('emptyState');
  const noisyTabs = document.getElementById('noisyTabs');

  // Show spinner immediately when options page opens
  status.textContent = 'Scanning for audio...';
  status.classList.add('listening');
  results.classList.remove('visible');
  emptyState.style.display = 'none';

  // Auto-scan on options page open
  scanTabs();

  async function scanTabs() {

    try {
      // Get all tabs from all windows
      const allTabs = await chrome.tabs.query({});

      // Get the current window (where popup was opened) and its active tab
      const currentWindow = await chrome.windows.getCurrent({ populate: true });
      const currentActiveTab = currentWindow.tabs.find(t => t.active);

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
        // Check if tab is muted
        const isMuted = tab.mutedInfo?.muted || false;

        if (isAudible) {
          totalAudioTabs++;
          if (!isActiveInCurrentWindow) {
            noisyTabsList.push({
              id: tab.id,
              title: tab.title || 'Untitled',
              url: tab.url,
              favicon: tab.favIconUrl,
              muted: isMuted
            });
          }
        }
      }

      // Display results
      displayResults(noisyTabsList, totalAudioTabs);

    } catch (error) {
      console.error('Scan error:', error);
      status.textContent = 'Error scanning tabs. Please try again.';
      status.classList.remove('listening');
      showEmptyState();
    }
  }

  function displayResults(noisyTabsList, totalAudioTabs) {
    const inactiveNoisyCount = noisyTabsList.length;

    // If only one or zero audio tabs, show a simple message
    if (totalAudioTabs <= 1) {
      if (totalAudioTabs === 0) {
        status.textContent = 'No audio detected in any tabs';
      } else {
        status.textContent = 'Only one tab is playing audio';
      }
      status.classList.remove('listening');
      showEmptyState();
      return;
    }

    // Multiple audio tabs - show the full results
    status.classList.remove('listening');
    status.style.display = 'none';

    // Noisy tabs list
    noisyTabs.innerHTML = '';

    if (noisyTabsList.length === 0) {
      noisyTabs.innerHTML = `
        <div class="empty-state" style="padding: 10px;">
          <div>All audio is coming from the current tab. 🔊</div>
        </div>
      `;
    } else {
      noisyTabsList.forEach(tab => {
        const item = document.createElement('div');
        item.className = 'noisy-tab';

        const muteButtonText = tab.muted ? 'Unmute Tab' : 'Mute Tab';
        const muteButtonClass = tab.muted ? 'unmute' : 'mute';

        item.innerHTML = `
          <div class="tab-header">
            <div class="tab-title">${escapeHtml(cleanTitle(tab.title))}</div>
          </div>
          <div class="tab-url">${escapeHtml(tab.url)}</div>
          <div class="tab-actions">
            <button class="tab-btn switch" data-tab-id="${tab.id}">Switch to Tab</button>
            <button class="tab-btn ${muteButtonClass}" data-tab-id="${tab.id}" data-muted="${tab.muted}">${muteButtonText}</button>
          </div>
        `;

        noisyTabs.appendChild(item);
      });

      // Add event listeners to buttons
      noisyTabs.querySelectorAll('.tab-btn.switch').forEach(btn => {
        btn.addEventListener('click', async function(e) {
          e.stopPropagation();
          const tabId = parseInt(this.dataset.tabId);
          await chrome.tabs.update(tabId, { active: true });
        });
      });

      noisyTabs.querySelectorAll('.tab-btn.mute, .tab-btn.unmute').forEach(btn => {
        btn.addEventListener('click', async function(e) {
          e.stopPropagation();
          const tabId = parseInt(this.dataset.tabId);
          const isCurrentlyMuted = this.dataset.muted === 'true';

          if (isCurrentlyMuted) {
            // Unmute the tab
            await chrome.tabs.update(tabId, { muted: false });
            this.textContent = 'Unmuted ✓';
            this.dataset.muted = 'false';
          } else {
            // Mute the tab
            await chrome.tabs.update(tabId, { muted: true });
            this.textContent = 'Muted ✓';
            this.dataset.muted = 'true';
          }

          this.disabled = true;
          this.style.opacity = '0.5';
        });
      });
    }

    results.classList.add('visible');
    emptyState.style.display = 'none';
  }

  function showEmptyState() {
    status.classList.remove('listening');
    results.classList.remove('visible');
    emptyState.style.display = 'block';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function cleanTitle(text) {
    // Remove patterns like "(123)" or "(327)" from titles
    return text.replace(/\s*\(\d+\)\s*/g, ' ').trim();
  }
});
