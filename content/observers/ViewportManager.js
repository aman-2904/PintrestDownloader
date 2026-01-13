import { logger } from '../utils/logger.js';

export class ViewportManager {
    constructor(onActivePinChange) {
        this.onActivePinChange = onActivePinChange;
        this.intersectionObserver = null;
        this.visiblePins = new Map(); // Node -> Ratio
    }

    start() {
        const options = {
            root: null, // viewport
            rootMargin: '0px',
            threshold: [0.5, 0.75] // trigger when 50% or 75% visible
        };

        this.intersectionObserver = new IntersectionObserver(this.handleIntersection.bind(this), options);
    }

    observe(node) {
        if (this.intersectionObserver) {
            this.intersectionObserver.observe(node);
        }
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
        // Find the pin with max intersection ratio
        let maxRatio = 0;
        let activePin = null;

        for (const [node, ratio] of this.visiblePins.entries()) {
            if (ratio > maxRatio) {
                maxRatio = ratio;
                activePin = node;
            }
        }

        if (activePin) {
            this.onActivePinChange(activePin);
        }
    }
}
