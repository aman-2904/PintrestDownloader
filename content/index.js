// PVD Consolidated Content Script
// ----------------------------------------------------

// 1. Logger
const logger = {
    log: (...args) => console.log('[PVD]', ...args),
    warn: (...args) => console.warn('[PVD]', ...args),
    error: (...args) => console.error('[PVD]', ...args)
};

// 2. MediaExtractor
class MediaExtractor {
    static async getVideoUrl(pinContainer) {
        if (!pinContainer) return null;

        // Level 1: React Fiber / Props Traversal
        const reactKey = Object.keys(pinContainer).find(key => key.startsWith('__reactProps'));

        if (reactKey) {
            try {
                const props = pinContainer[reactKey];
                let pinData = this.findPinDataInProps(props);
                if (pinData) {
                    const videoStreams = pinData.videos || (pinData.story_pin_data && pinData.story_pin_data.metadata && pinData.story_pin_data.metadata.videos);
                    if (videoStreams) {
                        logger.log('Found video streams in React props:', videoStreams);
                        return this.selectBestQuality(videoStreams);
                    }
                }
            } catch (e) {
                logger.error('Error walking React props:', e);
            }
        }

        // Level 2: JSON-LD Metadata
        try {
            const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of jsonLdScripts) {
                const data = JSON.parse(script.textContent);
                if (data && data['@type'] === 'VideoObject' && data.contentUrl) {
                    return { url: data.contentUrl, quality: 'json-ld' };
                }
            }
        } catch (e) { }

        // Level 3: DOM scraping
        const videoEl = pinContainer.querySelector('video');
        if (videoEl) {
            if (videoEl.src && !videoEl.src.startsWith('blob:')) {
                return { url: videoEl.src, quality: 'src-tag' };
            }
            const mp4Source = videoEl.querySelector('source[type="video/mp4"]');
            if (mp4Source) return { url: mp4Source.src, quality: 'source-tag' };
        }

        return null;
    }

    static findPinDataInProps(obj, depth = 0) {
        if (!obj || depth > 5) return null;
        if (obj.videos && obj.id) return obj;
        if (obj.data && obj.data.videos) return obj.data;
        if (obj.children && obj.children.props) {
            const found = this.findPinDataInProps(obj.children.props, depth + 1);
            if (found) return found;
        }
        return null;
    }

    static async fetchPublicPageVideo(pinId) {
        if (!pinId) return null;
        try {
            logger.log('PVD: Level 4 - Fetching Public Page for', pinId);
            const url = `https://www.pinterest.com/pin/${pinId}/`;
            const response = await fetch(url);
            const text = await response.text();

            // Method A: og:video meta tag
            const ogMatch = text.match(/<meta property="og:video" content="([^"]+)"/);
            if (ogMatch && ogMatch[1]) {
                const videoUrl = ogMatch[1];
                if (videoUrl.includes('.mp4')) {
                    logger.log('PVD: Found MP4 in og:video');
                    return { url: videoUrl, quality: 'public-meta' };
                }
            }

            // Method B: json-ld (embedded in string)
            // Sometimes it's inside <script type="application/ld+json">
            const jsonLdMatch = text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
            if (jsonLdMatch && jsonLdMatch[1]) {
                try {
                    const data = JSON.parse(jsonLdMatch[1]);
                    if (data && data.contentUrl && data.contentUrl.includes('.mp4')) {
                        logger.log('PVD: Found MP4 in public json-ld');
                        return { url: data.contentUrl, quality: 'public-json' };
                    }
                } catch (e) { }
            }

            // Method C: Raw regex scan for 720p mp4
            const rawMatch = text.match(/https:\/\/[^"]+\.pinterest\.com\/[^"]+\/720p\/[^"]+\.mp4/);
            if (rawMatch) {
                logger.log('PVD: Found MP4 via raw regex');
                return { url: rawMatch[0], quality: 'public-regex' };
            }

        } catch (e) {
            logger.warn('PVD: Public fetch failed', e);
        }
        return null;
    }

    static selectBestQuality(videoData) {
        let streams = videoData.video_list || videoData;
        if (!streams) return null;

        const priorities = ['V_1080P', 'V_720P', 'V_EXP7', 'V_480P', 'V_360P', 'V_HLSV3_MOBILE'];
        for (const qual of priorities) {
            if (streams[qual] && streams[qual].url && streams[qual].url.endsWith('.mp4')) {
                return { url: streams[qual].url, quality: qual };
            }
        }
        const anyMp4 = Object.values(streams).find(s => s.url && s.url.endsWith('.mp4'));
        if (anyMp4) return { url: anyMp4.url, quality: 'auto-fallback' };
        return null;
    }
}

// 3. PinValidator
class PinValidator {
    static isVideoPin(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (node.querySelector('video')) return true;

        const hasVideoClass = Array.from(node.querySelectorAll('*')).some(el =>
            el.className && typeof el.className === 'string' && el.className.includes('video')
        );
        if (hasVideoClass) return true;
        if (node.querySelector('[aria-label="Video"]')) return true;

        // Safe check for text content
        const text = node.textContent || node.innerText || '';
        if (node.querySelector('.duration') || text.match(/\d+:\d+/)) return true;

        return false;
    }
    static getPinId(node) {
        const link = node.querySelector('a[href^="/pin/"]');
        if (link) {
            const parts = link.getAttribute('href').split('/');
            return parts[2];
        }
        return null;
    }
}

// 4. PinObserver
class PinObserver {
    constructor(onVideoPinFound) {
        this.observer = null;
        this.onVideoPinFound = onVideoPinFound;
        this.processedPins = new Set();
    }
    start() {
        const targetNode = document.body;
        const config = { childList: true, subtree: true };
        this.observer = new MutationObserver((mutations) => this.handleMutations(mutations));
        this.observer.observe(targetNode, config);
    }
    handleMutations(mutations) {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    this.checkNode(node);
                    const potentialPins = node.querySelectorAll('[data-test-id="pin-visual-wrapper"], [data-test-id="pin"], .Pin');
                    potentialPins.forEach(pin => {
                        const container = pin.closest('[data-grid-item]') || pin;
                        this.checkNode(container);
                    });
                }
            }
        }
    }
    checkNode(node) {
        const pinId = PinValidator.getPinId(node);
        if (pinId && this.processedPins.has(pinId)) return;
        if (PinValidator.isVideoPin(node)) {
            if (pinId) this.processedPins.add(pinId);
            this.onVideoPinFound(node, pinId);
        }
    }
}

// 5. ViewportManager
class ViewportManager {
    constructor(onActivePinChange) {
        this.onActivePinChange = onActivePinChange;
        this.intersectionObserver = null;
        this.visiblePins = new Map();
    }
    start() {
        const options = { root: null, rootMargin: '0px', threshold: [0.5, 0.75] };
        this.intersectionObserver = new IntersectionObserver(this.handleIntersection.bind(this), options);
    }
    observe(node) {
        if (this.intersectionObserver) this.intersectionObserver.observe(node);
    }
    handleIntersection(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                this.visiblePins.set(entry.target, entry.intersectionRatio);
            } else {
                this.visiblePins.delete(entry.target);
            }
        });
        this.determineActivePin();
    }
    determineActivePin() {
        let maxRatio = 0;
        let activePin = null;
        for (const [node, ratio] of this.visiblePins.entries()) {
            if (ratio > maxRatio) {
                maxRatio = ratio;
                activePin = node;
            }
        }
        if (activePin) this.onActivePinChange(activePin);
    }
}

// 6. DownloadButton
class DownloadButton {
    constructor(container, pinId) {
        this.container = container;
        this.pinId = pinId;
        this.element = null;
        this.state = 'idle';
    }
    inject() {
        if (this.container.querySelector('.pvd-download-btn')) return;
        this.element = document.createElement('button');
        this.element.className = 'pvd-download-btn pvd-idle';
        this.element.innerHTML = `<span>Download</span>`;
        this.element.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.handleClick();
        };
        this.container.style.position = 'relative';
        this.container.appendChild(this.element);
    }
    async handleClick() {
        if (this.state === 'downloading' || this.state === 'fetching') return;

        // Debug Feedback
        alert('PVD: Attempting to find video... v1.4');
        this.setState('fetching');

        try {
            const uniqueId = 'pvd-' + Math.random().toString(36).substr(2, 9);
            this.container.setAttribute('data-pvd-id', uniqueId);

            const responseHandler = (e) => {
                if (e.detail.elementId === uniqueId) {
                    window.removeEventListener('PVD_RESPONSE_DATA', responseHandler);
                    if (e.detail.videoData) {
                        this.handleBridgeResponse(e.detail.videoData);
                    } else {
                        // Bridge replied "null"
                        this.fallbackExtraction();
                    }
                }
            };
            window.addEventListener('PVD_RESPONSE_DATA', responseHandler);
            window.dispatchEvent(new CustomEvent('PVD_REQUEST_DATA', { detail: { elementId: uniqueId } }));

            setTimeout(() => {
                window.removeEventListener('PVD_RESPONSE_DATA', responseHandler);
                if (this.state === 'fetching') this.fallbackExtraction();
            }, 1000); // Shorter timeout to try fallback faster
        } catch (e) {
            this.fallbackExtraction();
        }
    }

    async fallbackExtraction() {
        // Legacy DOM check
        let media = await MediaExtractor.getVideoUrl(this.container);
        if (media && media.url) {
            this.triggerDownload(media.url, media.quality);
            return;
        }

        // LEVEL 4: Public Page "Share Link" Scraping (User Requested)
        // This mimics external downloaders by fetching the clean public page
        const publicMedia = await MediaExtractor.fetchPublicPageVideo(this.pinId);
        if (publicMedia && publicMedia.url) {
            alert('PVD: Found MP4 via Share Link! Downloading...');
            this.triggerDownload(publicMedia.url, publicMedia.quality);
            return;
        }

        // NUCLEAR OPTION: Ask Background Sniffer
        chrome.runtime.sendMessage({ action: 'GET_LAST_VIDEO' }, (response) => {
            if (response && response.url) {
                alert('PVD: Found via Sniffer! Requesting Background to process: ' + response.url);
                this.triggerDownload(response.url, 'sniffed-auto');
            } else {
                alert('PVD Error: Could not find video URL. Please play the video fully and try again.');
                this.setState('error');
            }
        });
    }

    handleBridgeResponse(videoData) {
        if (!videoData) {
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
        if (newState === 'fetching' || newState === 'downloading') text = '...';
        if (newState === 'success') text = 'Done';
        if (newState === 'error') text = 'Error';
        this.element.querySelector('span').innerText = text;
    }
}

// 7. Sidebar
class Sidebar {
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
          <div class="pvd-sidebar-header"><h3>Video Downloader</h3><button id="pvd-close-sidebar">×</button></div>
          <div class="pvd-sidebar-content">
            <div class="pvd-preview"><img id="pvd-thumb" src="" /></div>
            <div class="pvd-info"><h4 id="pvd-title"></h4><span id="pvd-quality" class="pvd-badge">--</span></div>
            <div class="pvd-actions"><button id="pvd-sidebar-download" class="pvd-btn-primary" disabled>Download Video</button></div>
            <div id="pvd-status">Waiting...</div>
          </div>`;
        document.body.appendChild(this.element);
        this.element.querySelector('#pvd-close-sidebar').onclick = () => this.hide();
        this.downloadBtn = this.element.querySelector('#pvd-sidebar-download');
        this.downloadBtn.onclick = () => this.handleDownload();
    }
    show() { if (this.element) this.element.classList.add('visible'); this.isVisible = true; }
    hide() { if (this.element) this.element.classList.remove('visible'); this.isVisible = false; }
    async update(pinNode, pinId) {
        if (!pinNode) return;
        this.currentPin = { node: pinNode, id: pinId };
        const title = pinNode.querySelector('[title]')?.getAttribute('title') || 'Pinterest Video';
        const img = pinNode.querySelector('img');
        this.element.querySelector('#pvd-title').innerText = title.substring(0, 50);
        if (img) this.element.querySelector('#pvd-thumb').src = img.src;
        this.element.querySelector('#pvd-status').innerText = 'Ready';
        this.downloadBtn.disabled = false;
        const media = await MediaExtractor.getVideoUrl(pinNode);
        if (media) this.element.querySelector('#pvd-quality').innerText = media.quality;
        this.show();
    }
    async handleDownload() {
        if (!this.currentPin) return;
        const statusEl = this.element.querySelector('#pvd-status');
        statusEl.innerText = 'Fetching...';
        try {
            // Using logic similar to button - simplified for sidebar
            const media = await MediaExtractor.getVideoUrl(this.currentPin.node);
            if (!media || !media.url) { statusEl.innerText = 'No URL'; return; }
            chrome.runtime.sendMessage({ action: 'DOWNLOAD_VIDEO', pinId: this.currentPin.id, url: media.url, quality: media.quality }, (response) => {
                if (response && response.status === 'started') statusEl.innerText = 'Downloading...';
                else statusEl.innerText = 'Error';
            });
        } catch (e) { statusEl.innerText = 'Error'; }
    }
}

// 8. Initialization
logger.log('PVD: Content script loaded (Bundled)');

// INJECT MAIN WORLD SCRIPT VIA SRC (CSP COMPLIANT)
const script = document.createElement('script');
script.src = chrome.runtime.getURL('content/bridge.js');
script.onload = function () {
    this.remove();
    logger.log('PVD: Bridge script injected and loaded');
};
(document.head || document.documentElement).appendChild(script);

const sidebar = new Sidebar();
sidebar.inject();

const viewportManager = new ViewportManager((activePinNode) => {
    let pinId = PinValidator.getPinId(activePinNode);
    if (pinId) sidebar.update(activePinNode, pinId);
});

const pinObserver = new PinObserver((node, pinId) => {
    logger.log('New Video Pin:', pinId);
    viewportManager.observe(node);
    const btn = new DownloadButton(node, pinId);
    btn.inject();
});

// Delay for React
setTimeout(() => {
    logger.log('Starting PVD observers...');
    pinObserver.start();
    viewportManager.start();
}, 2000);
