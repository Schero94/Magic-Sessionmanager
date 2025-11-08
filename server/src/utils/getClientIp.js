/**
 * Extract real client IP address from request
 * Handles proxies, load balancers, and various header formats
 * 
 * Priority order:
 * 1. CF-Connecting-IP (Cloudflare)
 * 2. True-Client-IP (Akamai, Cloudflare)
 * 3. X-Real-IP (nginx)
 * 4. X-Forwarded-For (standard proxy header)
 * 5. X-Client-IP
 * 6. X-Cluster-Client-IP
 * 7. ctx.request.ip (Koa default)
 */

const getClientIp = (ctx) => {
  try {
    const headers = ctx.request.headers || ctx.request.header || {};
    
    // 1. Cloudflare
    if (headers['cf-connecting-ip']) {
      return cleanIp(headers['cf-connecting-ip']);
    }
    
    // 2. True-Client-IP (Akamai, Cloudflare Enterprise)
    if (headers['true-client-ip']) {
      return cleanIp(headers['true-client-ip']);
    }
    
    // 3. X-Real-IP (nginx proxy_pass)
    if (headers['x-real-ip']) {
      return cleanIp(headers['x-real-ip']);
    }
    
    // 4. X-Forwarded-For (most common)
    // Format: "client, proxy1, proxy2"
    // We want the FIRST IP (the actual client)
    if (headers['x-forwarded-for']) {
      const forwardedIps = headers['x-forwarded-for'].split(',');
      const clientIp = forwardedIps[0].trim();
      if (clientIp && !isPrivateIp(clientIp)) {
        return cleanIp(clientIp);
      }
    }
    
    // 5. X-Client-IP
    if (headers['x-client-ip']) {
      return cleanIp(headers['x-client-ip']);
    }
    
    // 6. X-Cluster-Client-IP (Rackspace, Riverbed)
    if (headers['x-cluster-client-ip']) {
      return cleanIp(headers['x-cluster-client-ip']);
    }
    
    // 7. Forwarded (RFC 7239)
    if (headers['forwarded']) {
      const match = headers['forwarded'].match(/for=([^;,\s]+)/);
      if (match && match[1]) {
        return cleanIp(match[1].replace(/"/g, ''));
      }
    }
    
    // 8. Fallback to Koa's ctx.request.ip
    if (ctx.request.ip) {
      return cleanIp(ctx.request.ip);
    }
    
    // 9. Last resort
    return 'unknown';
    
  } catch (error) {
    console.error('[getClientIp] Error extracting IP:', error);
    return 'unknown';
  }
};

/**
 * Clean IP address (remove IPv6 prefix, port, etc.)
 */
const cleanIp = (ip) => {
  if (!ip) return 'unknown';
  
  // Remove port if present
  ip = ip.split(':')[0];
  
  // Remove IPv6 prefix (::ffff:)
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  
  // Trim whitespace
  ip = ip.trim();
  
  return ip || 'unknown';
};

/**
 * Check if IP is private/local
 */
const isPrivateIp = (ip) => {
  if (!ip) return true;
  
  // Private IP ranges
  if (ip === '127.0.0.1' || ip === 'localhost' || ip === '::1') return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith('fc00:') || ip.startsWith('fd00:')) return true;
  if (ip.startsWith('fe80:')) return true;
  
  return false;
};

module.exports = getClientIp;

