/**
 * Parse User Agent to extract device and browser info
 * Returns human-readable device type and browser name
 */

export const parseUserAgent = (userAgent) => {
  if (!userAgent) {
    return {
      device: 'Unknown',
      deviceIcon: '❓',
      browser: 'Unknown',
      os: 'Unknown',
    };
  }

  const ua = userAgent.toLowerCase();

  // Device detection
  let device = 'Desktop';
  let deviceIcon = '💻';

  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(userAgent)) {
    device = 'Tablet';
    deviceIcon = '📱';
  } else if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(userAgent)) {
    device = 'Mobile';
    deviceIcon = '📱';
  }

  // Browser detection
  let browser = 'Unknown';
  if (ua.includes('edg/')) {
    browser = 'Edge';
  } else if (ua.includes('chrome/') && !ua.includes('edg/')) {
    browser = 'Chrome';
  } else if (ua.includes('firefox/')) {
    browser = 'Firefox';
  } else if (ua.includes('safari/') && !ua.includes('chrome/')) {
    browser = 'Safari';
  } else if (ua.includes('opera/') || ua.includes('opr/')) {
    browser = 'Opera';
  } else if (ua.includes('curl/')) {
    browser = 'cURL';
    deviceIcon = '⚙️';
    device = 'API Client';
  } else if (ua.includes('postman')) {
    browser = 'Postman';
    deviceIcon = '📮';
    device = 'API Client';
  } else if (ua.includes('insomnia')) {
    browser = 'Insomnia';
    deviceIcon = '🌙';
    device = 'API Client';
  }

  // OS detection
  let os = 'Unknown';
  if (ua.includes('windows')) {
    os = 'Windows';
  } else if (ua.includes('mac os x') || ua.includes('macintosh')) {
    os = 'macOS';
  } else if (ua.includes('linux')) {
    os = 'Linux';
  } else if (ua.includes('android')) {
    os = 'Android';
  } else if (ua.includes('iphone') || ua.includes('ipad')) {
    os = 'iOS';
  }

  return {
    device,
    deviceIcon,
    browser,
    os,
  };
};

export default parseUserAgent;

