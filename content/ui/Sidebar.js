import { logger } from '../utils/logger.js';
import { MediaExtractor } from '../utils/mediaExtractor.js';

export class Sidebar {
    constructor() {
        this.element = null;
        this.currentPin = null;
        this.isVisible = false;
    }

    inject() {
        if (document.getElementById('pvd-sidebar')) return;

        this.element = document.createElement('div');
        this.element.id = 'pvd-sidebar';
        this.element.innerHTML = `
      <div class="pvd-sidebar-header">
        <h3>Video Downloader</h3>
        <button id="pvd-close-sidebar">×</button>
      </div>
      <div class="pvd-sidebar-content">
        <div class="pvd-preview">
          <img id="pvd-thumb" src="" alt="Video Thumbnail" />
        </div>
        <div class="pvd-info">
          <h4 id="pvd-title">No Video Selected</h4>
          <span id="pvd-quality" class="pvd-badge">--</span>
        </div>
        <div class="pvd-actions">
          <button id="pvd-sidebar-download" class="pvd-btn-primary" disabled>Download Video</button>
        </div>
        <div id="pvd-status">Waiting for video...</div>
      </div>
    `;

        document.body.appendChild(this.element);

        // Bind events
        this.element.querySelector('#pvd-close-sidebar').onclick = () => this.hide();

        this.downloadBtn = this.element.querySelector('#pvd-sidebar-download');
        this.downloadBtn.onclick = () => this.handleDownload();

        logger.log('Sidebar injected');
    }

    show() {
        if (this.element && !this.isVisible) {
            this.element.classList.add('visible');
            this.isVisible = true;
        }
    }

    hide() {
        if (this.element && this.isVisible) {
            this.element.classList.remove('visible');
            this.isVisible = false;
        }
    }

    async update(pinNode, pinId) {
        if (!pinNode) return;
        this.currentPin = { node: pinNode, id: pinId };

        // Update UI
        const title = pinNode.querySelector('[title]')?.getAttribute('title') || 'Pinterest Video';
        const img = pinNode.querySelector('img');
        const thumbUrl = img ? img.src : '';

        this.element.querySelector('#pvd-title').innerText = title.substring(0, 50) + (title.length > 50 ? '...' : '');
        this.element.querySelector('#pvd-thumb').src = thumbUrl;
        this.element.querySelector('#pvd-status').innerText = 'Ready to download';
        this.downloadBtn.disabled = false;

        // Attempt to pre-calculate quality or check availability
        const media = await MediaExtractor.getVideoUrl(pinNode);
        if (media) {
            this.element.querySelector('#pvd-quality').innerText = media.quality === 'auto' ? 'HD' : media.quality.toUpperCase();
        }

        this.show();
    }

    async handleDownload() {
        if (!this.currentPin) return;

        const statusEl = this.element.querySelector('#pvd-status');
        statusEl.innerText = 'Fetching...';
        this.downloadBtn.disabled = true;

        try {
            const media = await MediaExtractor.getVideoUrl(this.currentPin.node);

            if (!media || !media.url) {
                statusEl.innerText = 'Error: No URL';
                this.downloadBtn.disabled = false;
                return;
            }

            chrome.runtime.sendMessage({
                action: 'DOWNLOAD_VIDEO',
                pinId: this.currentPin.id,
                url: media.url,
                quality: media.quality
            }, (response) => {
                if (response && response.status === 'started') {
                    statusEl.innerText = 'Downloading...';
                } else {
                    statusEl.innerText = 'Error starting download';
                    this.downloadBtn.disabled = false;
                }
            });

        } catch (e) {
            statusEl.innerText = 'Error: ' + e.message;
            this.downloadBtn.disabled = false;
        }
    }
}
