// PVD Main World Bridge
// This script runs in the Main World (same context as the page)
(function () {
    console.log('[PVD:Main] Bridge loaded & initialized');

    function getReactProps(node) {
        if (!node) return null;
        // Search for both Props (standard) and Fiber (sometimes used)
        const reactKey = Object.keys(node).find(key => key.startsWith('__reactProps') || key.startsWith('__reactFiber'));
        if (!reactKey) return null;

        // Fiber structure is different: node[key].memoizedProps or node[key].return.memoizedProps
        const instance = node[reactKey];
        if (reactKey.startsWith('__reactFiber')) {
            return instance.memoizedProps;
        }
        return instance; // __reactProps IS the props object
    }

    function findPinDataInProps(obj, depth = 0) {
        if (!obj || depth > 15) return null; // Increased depth significantly
        try {
            if (obj.videos && obj.id) return obj;
            if (obj.data && obj.data.videos) return obj.data;
            if (obj.story_pin_data && obj.story_pin_data.metadata && obj.story_pin_data.metadata.videos) return obj.story_pin_data.metadata;

            // Specific structure for Idea Pins sometimes: "rich_metadata"
            if (obj.rich_metadata && obj.rich_metadata.videos) return obj.rich_metadata;

            if (obj.children) {
                // If array
                if (Array.isArray(obj.children)) {
                    for (const child of obj.children) {
                        if (typeof child === 'object') {
                            // React children can be raw objects or have props
                            const res = findPinDataInProps(child.props || child, depth + 1);
                            if (res) return res;
                        }
                    }
                }
                // If single object
                else if (typeof obj.children === 'object' && obj.children.props) {
                    const res = findPinDataInProps(obj.children.props, depth + 1);
                    if (res) return res;
                }
            }

            // Sometimes props are just flat properties
            if (obj.props) {
                const res = findPinDataInProps(obj.props, depth + 1);
                if (res) return res;
            }

        } catch (e) { /* ignore circular structure errors */ }
        return null;
    }

    window.addEventListener('PVD_REQUEST_DATA', (e) => {
        const { elementId } = e.detail;
        const node = document.querySelector('[data-pvd-id="' + elementId + '"]');

        if (!node) {
            console.warn('[PVD:Main] Element not found for ID:', elementId);
            return;
        }

        let videoData = null;
        let current = node;
        let attempts = 0;

        // Strategy 1: Check parents (up to 5 levels)
        while (current && attempts < 5) {
            const p = getReactProps(current);
            if (p) {
                const found = findPinDataInProps(p);
                if (found) {
                    videoData = found;
                    break;
                }
            }
            current = current.parentElement;
            attempts++;
        }

        // Strategy 2: Check specifically for the visual wrapper or pin div
        if (!videoData) {
            const commonSelectors = [
                '[data-test-id="pin-visual-wrapper"]',
                '[data-test-id="pin"]',
                '.Pin'
            ];

            for (const sel of commonSelectors) {
                const el = node.querySelector(sel);
                if (el) {
                    const p = getReactProps(el);
                    if (p) {
                        const found = findPinDataInProps(p);
                        if (found) {
                            videoData = found;
                            break;
                        }
                    }
                }
            }
        }

        console.log('[PVD:Main] Request processed for', elementId, 'Found:', !!videoData);

        window.dispatchEvent(new CustomEvent('PVD_RESPONSE_DATA', {
            detail: {
                elementId: elementId,
                videoData: videoData
            }
        }));
    });
})();
