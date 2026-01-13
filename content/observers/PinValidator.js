import { logger } from '../utils/logger.js';

export class PinValidator {
    static isVideoPin(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;

        // Check 1: Explicit <video> tag
        if (node.querySelector('video')) return true;

        // Check 2: Class name markers
        const hasVideoClass = Array.from(node.querySelectorAll('*')).some(el =>
            el.className && typeof el.className === 'string' && el.className.includes('video')
        );
        if (hasVideoClass) return true;

        // Check 3: Look for data attributes or aria
        if (node.querySelector('[aria-label="Video"]')) return true;

        // Check 4: Duration presence often implies video
        if (node.querySelector('.duration') || node.innerText.match(/\d+:\d+/)) { // Loose heuristic
            return true;
        }

        return false;
    }

    static getPinId(node) {
        // Try to find a link that looks like /pin/12345/
        const link = node.querySelector('a[href^="/pin/"]');
        if (link) {
            const parts = link.getAttribute('href').split('/');
            return parts[2]; // /pin/ID/
        }
        return null;
    }
}
