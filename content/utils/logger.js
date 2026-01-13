export const logger = {
    log: (...args) => console.log('[PVD]', ...args),
    warn: (...args) => console.warn('[PVD]', ...args),
    error: (...args) => console.error('[PVD]', ...args)
};
