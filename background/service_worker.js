console.log('Pinterest Video Downloader: Service worker loaded');

// Sniff for media files globally
if (chrome.webRequest) {
    chrome.webRequest.onBeforeRequest.addListener(
        (details) => {
            const ext = details.url.split('?')[0].split('.').pop().toLowerCase();
            const tabKey = 'last_video_' + details.tabId;

            if (details.type === 'media' || ext === 'mp4' || ext === 'm3u8') {
                if (details.url.startsWith('http') && !details.url.includes('blob:')) {
                    const newUrl = details.url;

                    // Priority Logic: Always prefer MP4.
                    // If we see an MP4, overwrite anything.
                    // If we see an m3u8, only save if we DON'T have an MP4 yet.

                    chrome.storage.local.get([tabKey], (result) => {
                        const existingUrl = result[tabKey];
                        const isNewMp4 = newUrl.includes('.mp4');
                        const isExistingMp4 = existingUrl && existingUrl.includes('.mp4');

                        if (isNewMp4 || !isExistingMp4) {
                            console.log('Sniffer found better video:', newUrl);
                            chrome.storage.local.set({ [tabKey]: newUrl });
                        }
                    });
                }
            }
        },
        { urls: ["<all_urls>"] }
    );
}
// Clear cache on navigation (fixes "stale video" issue across pages)
if (chrome.webNavigation) {
    const clearTabCache = (details) => {
        if (details.frameId === 0) { // Top-level frame only
            const key = 'last_video_' + details.tabId;
            chrome.storage.local.remove(key);
            console.log('Navigation detected, cleared cache for tab:', details.tabId);
        }
    };
    chrome.webNavigation.onCommitted.addListener(clearTabCache);
    chrome.webNavigation.onHistoryStateUpdated.addListener(clearTabCache);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'DOWNLOAD_VIDEO') {
        handleDownload(request.url, request.pinId, request.quality)
            .then((downloadId) => {
                sendResponse({ status: 'started', downloadId: downloadId });
            })
            .catch((error) => {
                console.error('Download failed:', error);
                sendResponse({ status: 'error', message: error.message });
            });
        return true; // Keep channel open for async response
    }

    if (request.action === 'GET_LAST_VIDEO') {
        const key = 'last_video_' + sender.tab.id;
        chrome.storage.local.get([key], (result) => {
            const url = result[key];
            sendResponse({ url: url });

            // READ-ONCE POLICY: Clear cache after reading.
            // This prevents downloading the same video URL for subsequent buttons
            // if the user hasn't played the new one yet.
            if (url) {
                chrome.storage.local.remove(key);
            }
        });
        return true; // async response
    }
});

async function handleDownload(url, pinId, quality) {
    if (!url) throw new Error('No URL provided');

    let finalUrl = url;
    let finalQuality = quality;

    // HLS -> MP4 UPGRADE (Server-Side Logic)
    if (url.includes('.m3u8')) {
        console.log('PVD Service: Attempting to upgrade HLS to MP4...');

        const candidates = [];

        // Strategy 1: IHT -> MC (720p)
        candidates.push(url.replace('/iht/', '/mc/').replace('/hls/', '/720p/').replace(/_\w+\.m3u8$/, '.mp4').replace('.m3u8', '.mp4'));
        // Strategy 2: HLS -> 720p
        candidates.push(url.replace('/hls/', '/720p/').replace(/_\w+\.m3u8$/, '.mp4').replace('.m3u8', '.mp4'));
        // Strategy 3: HLS -> Orig
        candidates.push(url.replace('/hls/', '/orig/').replace(/_\w+\.m3u8$/, '.mp4').replace('.m3u8', '.mp4'));

        for (const candidate of candidates) {
            try {
                // Add Referrer to mimic legitimate traffic
                const response = await fetch(candidate, {
                    method: 'HEAD',
                    headers: { 'Referrer': 'https://www.pinterest.com/' }
                });
                if (response.ok) {
                    console.log('PVD Service: Upgraded to MP4!', candidate);
                    finalUrl = candidate;
                    finalQuality = '720p-upgraded';
                    break;
                } else {
                    console.warn('PVD Service: MP4 Candidate rejected:', candidate, response.status);
                }
            } catch (e) {
                console.warn('PVD Service: Candidate check failed', candidate, e);
            }
        }
    }

    // Determine extension
    let ext = 'mp4';
    let isStream = false;
    if (finalUrl.includes('.m3u8') && !finalUrl.includes('.mp4')) {
        ext = 'm3u8';
        isStream = true;
    }

    // Rename file to warn user if it is a stream
    let namePart = pinId || 'video';
    if (isStream) namePart += '_mp4_not_found_use_vlc';

    const filename = `pinterest_${namePart}_${quality || 'auto'}.${ext}`;

    return new Promise((resolve, reject) => {
        chrome.downloads.download({
            url: finalUrl,
            filename: filename,
            conflictAction: 'uniquify',
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error('Chrome Download Error:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else {
                console.log('Download started:', downloadId);
                resolve(downloadId);
            }
        });
    });
}
