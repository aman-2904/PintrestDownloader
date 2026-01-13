// loader.js
(async () => {
    const src = chrome.runtime.getURL('content/index.js');
    try {
        await import(src);
    } catch (e) {
        console.error('[PVD] Failed to load content script module:', e);
    }
})();
