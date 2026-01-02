'use strict';

/**
 * User-Agent Parser Utility
 * Parses user agent strings to extract device, browser, and OS information
 * Lightweight implementation without external dependencies
 */

/**
 * Parse user agent string to extract device, browser, and OS info
 * @param {string} userAgent - The user agent string
 * @returns {Object} Parsed information
 */
function parseUserAgent(userAgent) {
  if (!userAgent) {
    return {
      deviceType: 'unknown',
      browserName: 'unknown',
      browserVersion: null,
      osName: 'unknown',
      osVersion: null,
    };
  }

  const ua = userAgent.toLowerCase();

  // Detect device type
  let deviceType = 'desktop';
  if (/mobile|android.*mobile|iphone|ipod|blackberry|iemobile|opera mini|opera mobi/i.test(userAgent)) {
    deviceType = 'mobile';
  } else if (/tablet|ipad|android(?!.*mobile)|kindle|silk/i.test(userAgent)) {
    deviceType = 'tablet';
  } else if (/bot|crawl|spider|slurp|mediapartners/i.test(userAgent)) {
    deviceType = 'bot';
  }

  // Detect browser
  let browserName = 'unknown';
  let browserVersion = null;

  if (/edg\//i.test(userAgent)) {
    browserName = 'Edge';
    browserVersion = extractVersion(userAgent, /edg\/(\d+[\.\d]*)/i);
  } else if (/opr\//i.test(userAgent) || /opera/i.test(userAgent)) {
    browserName = 'Opera';
    browserVersion = extractVersion(userAgent, /(?:opr|opera)[\s\/](\d+[\.\d]*)/i);
  } else if (/chrome|crios/i.test(userAgent) && !/edg/i.test(userAgent)) {
    browserName = 'Chrome';
    browserVersion = extractVersion(userAgent, /(?:chrome|crios)\/(\d+[\.\d]*)/i);
  } else if (/firefox|fxios/i.test(userAgent)) {
    browserName = 'Firefox';
    browserVersion = extractVersion(userAgent, /(?:firefox|fxios)\/(\d+[\.\d]*)/i);
  } else if (/safari/i.test(userAgent) && !/chrome|chromium/i.test(userAgent)) {
    browserName = 'Safari';
    browserVersion = extractVersion(userAgent, /version\/(\d+[\.\d]*)/i);
  } else if (/msie|trident/i.test(userAgent)) {
    browserName = 'Internet Explorer';
    browserVersion = extractVersion(userAgent, /(?:msie |rv:)(\d+[\.\d]*)/i);
  }

  // Detect OS
  let osName = 'unknown';
  let osVersion = null;

  if (/windows nt/i.test(userAgent)) {
    osName = 'Windows';
    const winVersion = extractVersion(userAgent, /windows nt (\d+[\.\d]*)/i);
    // Map Windows NT versions to marketing names
    const winVersionMap = {
      '10.0': '10/11',
      '6.3': '8.1',
      '6.2': '8',
      '6.1': '7',
      '6.0': 'Vista',
      '5.1': 'XP',
    };
    osVersion = winVersionMap[winVersion] || winVersion;
  } else if (/mac os x/i.test(userAgent)) {
    osName = 'macOS';
    osVersion = extractVersion(userAgent, /mac os x (\d+[_\.\d]*)/i)?.replace(/_/g, '.');
  } else if (/iphone|ipad|ipod/i.test(userAgent)) {
    osName = 'iOS';
    osVersion = extractVersion(userAgent, /os (\d+[_\.\d]*)/i)?.replace(/_/g, '.');
  } else if (/android/i.test(userAgent)) {
    osName = 'Android';
    osVersion = extractVersion(userAgent, /android (\d+[\.\d]*)/i);
  } else if (/linux/i.test(userAgent)) {
    osName = 'Linux';
  } else if (/cros/i.test(userAgent)) {
    osName = 'Chrome OS';
  }

  return {
    deviceType,
    browserName,
    browserVersion,
    osName,
    osVersion,
  };
}

/**
 * Extract version number from user agent using regex
 * @param {string} userAgent - User agent string
 * @param {RegExp} regex - Regex with capture group for version
 * @returns {string|null} Version string or null
 */
function extractVersion(userAgent, regex) {
  const match = userAgent.match(regex);
  return match ? match[1] : null;
}

/**
 * Get a human-readable device description
 * @param {Object} parsed - Parsed user agent object
 * @returns {string} Human-readable description
 */
function getDeviceDescription(parsed) {
  const browser = parsed.browserVersion 
    ? `${parsed.browserName} ${parsed.browserVersion}` 
    : parsed.browserName;
  
  const os = parsed.osVersion 
    ? `${parsed.osName} ${parsed.osVersion}` 
    : parsed.osName;

  return `${browser} on ${os}`;
}

module.exports = {
  parseUserAgent,
  getDeviceDescription,
};
