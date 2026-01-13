import { logger } from './logger.js';

export class MediaExtractor {
    static async getVideoUrl(pinContainer) {
        if (!pinContainer) return null;

        // Level 1: React Fiber / Props Traversal (Most robust for SPA)
        // Pinterest stores data in React internal instances on DOM nodes.
        // Keys usually start with __reactProps or __reactFiber
        const reactKey = Object.keys(pinContainer).find(key => key.startsWith('__reactProps'));

        if (reactKey) {
            try {
                const props = pinContainer[reactKey];
                // Traverse props to find 'story_pin_data' or 'video_data' or 'pin' object
                // This path is heuristic and depends on Pinterest's current structure.
                // We look for a deep object that has 'videos' or 'streams'.

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

        // Level 2: JSON-LD Metadata (Backup)
        try {
            const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of jsonLdScripts) {
                const data = JSON.parse(script.textContent);
                if (data && data['@type'] === 'VideoObject' && data.contentUrl) {
                    // Verify if this JSON belongs to our Pin (tough if multiple on page)
                    // But usually valid for the *active* pin if opened.
                    // For grid view, this is less reliable.
                    return { url: data.contentUrl, quality: 'json-ld' };
                }
            }
        } catch (e) { }

        // Level 3: DOM scraping (Original & Brittle)
        const videoEl = pinContainer.querySelector('video');
        if (videoEl) {
            if (videoEl.src && !videoEl.src.startsWith('blob:')) {
                return { url: videoEl.src, quality: 'src-tag' };
            }
            // Check sources
            const mp4Source = videoEl.querySelector('source[type="video/mp4"]');
            if (mp4Source) return { url: mp4Source.src, quality: 'source-tag' };

            // If It's a HLS blob, we can't download easily without the master string.
        }

        return null;
    }

    static findPinDataInProps(obj, depth = 0) {
        if (!obj || depth > 5) return null;
        if (obj.videos && obj.id) return obj; // Found a pin-like object with videos
        if (obj.data && obj.data.videos) return obj.data;

        // Shallow search in children/props
        if (obj.children && obj.children.props) {
            const found = this.findPinDataInProps(obj.children.props, depth + 1);
            if (found) return found;
        }

        return null;
    }

    static selectBestQuality(videoData) {
        // Pinterest specific structure: { video_list: { V_720P: { url: ... }, V_HLSV3: ... } }
        // Or sometimes just { videos: { ... } }

        let streams = videoData.video_list || videoData;
        if (!streams) return null;

        logger.log('Evaluating specific streams:', streams);

        // Priority map
        const priorities = ['V_1080P', 'V_720P', 'V_EXP7', 'V_480P', 'V_360P', 'V_HLSV3_MOBILE'];

        for (const qual of priorities) {
            if (streams[qual] && streams[qual].url && streams[qual].url.endsWith('.mp4')) {
                return { url: streams[qual].url, quality: qual };
            }
        }

        // Fallback: any MP4
        const anyMp4 = Object.values(streams).find(s => s.url && s.url.endsWith('.mp4'));
        if (anyMp4) return { url: anyMp4.url, quality: 'auto-fallback' };

        // Fallback: HLS (m3u8) - Chrome downloads API can't handle this natively as one file.
        // We would need to mention this limitation or use an external lib (ffmpeg.wasm? too heavy).
        // For now, strict requirement says "Use MP4".

        return null;
    }
}
