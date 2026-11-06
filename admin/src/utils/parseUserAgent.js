/**
 * Compatibility entry point. The parser lives in parseUserAgent.mjs so it can
 * be unit tested with node:test; it returns empty strings for unknown facts
 * and never infers a desktop device for an unrecognised user agent.
 */
export { parseUserAgent, LEGACY_DEVICE_LABELS } from './parseUserAgent.mjs';
export { default } from './parseUserAgent.mjs';
