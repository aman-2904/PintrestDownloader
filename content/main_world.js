// This script runs in the MAIN world, so it can see window variables and React props.
console.log('[PVD:Main] Main World script loaded');

// Helper to find React props on a node
function getReactProps(node) {
    const reactKey = Object.keys(node).find(key => key.startsWith('__reactProps'));
    return reactKey ? node[reactKey] : null;
}

function findPinDataInProps(obj, depth = 0) {
    if (!obj || depth > 6) return null;
    if (obj.videos && obj.id) return obj;
    if (obj.data && obj.data.videos) return obj.data;
    if (obj.story_pin_data && obj.story_pin_data.metadata && obj.story_pin_data.metadata.videos) return obj.story_pin_data.metadata;

    if (obj.children && obj.children.props) {
        return findPinDataInProps(obj.children.props, depth + 1);
    }
    return null;
}

// Listen for requests from Isolated/Content script
window.addEventListener('PVD_REQUEST_DATA', (e) => {
    const { elementId } = e.detail;
    const node = document.querySelector(`[data-pvd-id="${elementId}"]`);

    if (!node) {
        console.warn('[PVD:Main] Element not found for ID:', elementId);
        return;
    }

    const props = getReactProps(node);
    let videoData = null;

    if (props) {
        // Try to find video data in the props of this node or its parents
        // Often the generic wrapper has the props
        let current = node;
        let attempts = 0;
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
    }

    // specific hack for Pinterest: sometimes props are on the 'Pin' div inside
    if (!videoData) {
        const pinInner = node.querySelector('[data-test-id="pin-visual-wrapper"]');
        if (pinInner) {
            const p = getReactProps(pinInner);
            if (p) videoData = findPinDataInProps(p);
        }
    }

    window.dispatchEvent(new CustomEvent('PVD_RESPONSE_DATA', {
        detail: {
            elementId: elementId,
            videoData: videoData
        }
    }));
});
