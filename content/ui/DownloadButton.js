import { logger } from '../utils/logger.js';
import { MediaExtractor } from '../utils/mediaExtractor.js';

export class DownloadButton {
    constructor(container, pinId) {
        this.container = container;
        this.pinId = pinId;
        this.element = null;
        this.state = 'idle'; // idle, fetching, downloading, success, error
    }

    inject() {
        if (this.container.querySelector('.pvd-download-btn')) return;

        this.element = document.createElement('button');
        this.element.className = 'pvd-download-btn pvd-idle';
        this.element.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span>Download</span>
    `;

        this.element.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.handleClick();
        };

        // Position it - usually better to append to the overlay wrapper if possible
        // For now, absolute positioning relative to container
        this.container.style.position = 'relative'; // Ensure container is relative
        this.container.appendChild(this.element);

        logger.log('Button injected for', this.pinId);
    }

    async handleClick() {
        if (this.state === 'downloading' || this.state === 'fetching') return;

        this.setState('fetching');

        try {
            // NEW BRIDGE LOGIC
            // 1. Mark element with unique ID for Main World to find
            const uniqueId = 'pvd-' + Math.random().toString(36).substr(2, 9);
            this.container.setAttribute('data-pvd-id', uniqueId);

            // 2. Setup listener for response
            const responseHandler = (e) => {
                if (e.detail.elementId === uniqueId) {
                    window.removeEventListener('PVD_RESPONSE_DATA', responseHandler);
                    this.handleBridgeResponse(e.detail.videoData);
                }
            };
            window.addEventListener('PVD_RESPONSE_DATA', responseHandler);

            // 3. Dispatch request
            window.dispatchEvent(new CustomEvent('PVD_REQUEST_DATA', {
                detail: { elementId: uniqueId }
            }));

            // Timeout safety
            setTimeout(() => {
                window.removeEventListener('PVD_RESPONSE_DATA', responseHandler);
                if (this.state === 'fetching') {
                    // Fallback to old DOM extraction if bridge times out
                    this.fallbackExtraction();
                }
            }, 2000);

        } catch (e) {
            logger.error('Click handle error', e);
            this.setState('error');
        }
    }

    async fallbackExtraction() {
        logger.warn('Bridge timeout, trying fallback extraction');
        const media = await MediaExtractor.getVideoUrl(this.container);
        if (media && media.url) {
            this.triggerDownload(media.url, media.quality);
        } else {
            this.setState('error');
        }
    }

    handleBridgeResponse(videoData) {
        if (!videoData) {
            logger.warn('Bridge returned no data, using fallback');
            this.fallbackExtraction();
            return;
        }

        const media = MediaExtractor.selectBestQuality(videoData);
        if (media) {
            this.triggerDownload(media.url, media.quality);
        } else {
            this.fallbackExtraction();
        }
    }

    triggerDownload(url, quality) {
        chrome.runtime.sendMessage({
            action: 'DOWNLOAD_VIDEO',
            pinId: this.pinId,
            url: url,
            quality: quality
        }, (response) => {
            if (chrome.runtime.lastError) {
                logger.error('Runtime error:', chrome.runtime.lastError);
                this.setState('error');
                return;
            }
            if (response && response.status === 'started') {
                this.setState('downloading');
            } else {
                this.setState('error');
            }
        });
    }

    setState(newState) {
        this.state = newState;
        this.element.className = `pvd-download-btn pvd-${newState}`;

        let text = 'Download';
        let icon = ''; // Simplify for now

        switch (newState) {
            case 'fetching':
                text = '...';
                break;
            case 'downloading':
                text = '...';
                break;
            case 'success':
                text = 'Done';
                break;
            case 'error':
                text = 'Error';
                break;
        }

        this.element.querySelector('span').innerText = text;
    }
}
