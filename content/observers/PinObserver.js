import { logger } from '../utils/logger.js';
import { PinValidator } from './PinValidator.js';

export class PinObserver {
    constructor(onVideoPinFound) {
        this.observer = null;
        this.onVideoPinFound = onVideoPinFound;
        this.processedPins = new Set();
    }

    start() {
        logger.log('Starting PinObserver...');
        const targetNode = document.body; // Ideally restrict this to the grid container

        const config = { childList: true, subtree: true };

        this.observer = new MutationObserver((mutations) => this.handleMutations(mutations));
        this.observer.observe(targetNode, config);
    }

    stop() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }

    handleMutations(mutations) {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check the node itself
                    this.checkNode(node);

                    // Check children - Pinterest often adds large chunks of grid
                    // Optimized selector for Pinterest's specific pins
                    const potentialPins = node.querySelectorAll('[data-test-id="pin-visual-wrapper"], [data-test-id="pin"], .Pin');
                    potentialPins.forEach(pin => {
                        // Traverse up to find the main container that holds the props
                        const container = pin.closest('[data-grid-item]') || pin;
                        this.checkNode(container);
                    });
                }
            }
        }
    }
    checkNode(node) {
        // Basic deduplication using a weak reference or ID if possible
        // For now using simple object check if we can get ID, otherwise using the node itself in a WeakSet could be better to avoid leaks
        // But processedPins is a Set of IDs.

        const pinId = PinValidator.getPinId(node);
        if (pinId && this.processedPins.has(pinId)) return;

        if (PinValidator.isVideoPin(node)) {
            if (pinId) this.processedPins.add(pinId);
            this.onVideoPinFound(node, pinId);
        }
    }
}
