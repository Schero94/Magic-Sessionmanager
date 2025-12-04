/**
 * IP Geolocation Service
 * Uses ipapi.co for accurate IP information
 * Free tier: 30,000 requests/month
 * 
 * Premium features:
 * - Country, City, Region
 * - Timezone
 * - VPN/Proxy/Threat detection
 * - Security scoring
 */

module.exports = ({ strapi }) => ({
  /**
   * Get IP information from ipapi.co
   * @param {string} ipAddress - IP to lookup
   * @returns {Promise<Object>} Geolocation data
   */
  async getIpInfo(ipAddress) {
    try {
      // Skip localhost/private IPs
      if (!ipAddress || ipAddress === '127.0.0.1' || ipAddress === '::1' || ipAddress.startsWith('192.168.') || ipAddress.startsWith('10.')) {
        return {
          ip: ipAddress,
          country: 'Local Network',
          country_code: 'XX',
          country_flag: '🏠',
          city: 'Localhost',
          region: 'Private Network',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          latitude: null,
          longitude: null,
          isVpn: false,
          isProxy: false,
          isThreat: false,
          securityScore: 100,
          riskLevel: 'None',
        };
      }

      // Call ipapi.co API
      const response = await fetch(`https://ipapi.co/${ipAddress}/json/`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Strapi-Magic-SessionManager/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Check for rate limit
      if (data.error) {
        strapi.log.warn(`[magic-sessionmanager/geolocation] API Error: ${data.reason}`);
        return this.getFallbackData(ipAddress);
      }

      // Parse and return structured data
      const result = {
        ip: data.ip,
        country: data.country_name,
        country_code: data.country_code,
        country_flag: this.getCountryFlag(data.country_code),
        city: data.city,
        region: data.region,
        timezone: data.timezone,
        latitude: data.latitude,
        longitude: data.longitude,
        postal: data.postal,
        org: data.org,
        asn: data.asn,
        
        // Security features (available in ipapi.co response)
        isVpn: data.threat?.is_vpn || false,
        isProxy: data.threat?.is_proxy || false,
        isThreat: data.threat?.is_threat || false,
        isAnonymous: data.threat?.is_anonymous || false,
        isTor: data.threat?.is_tor || false,
        
        // Calculate security score (0-100, higher is safer)
        securityScore: this.calculateSecurityScore({
          isVpn: data.threat?.is_vpn,
          isProxy: data.threat?.is_proxy,
          isThreat: data.threat?.is_threat,
          isAnonymous: data.threat?.is_anonymous,
          isTor: data.threat?.is_tor,
        }),
        
        riskLevel: this.getRiskLevel({
          isVpn: data.threat?.is_vpn,
          isProxy: data.threat?.is_proxy,
          isThreat: data.threat?.is_threat,
        }),
      };

      strapi.log.debug(`[magic-sessionmanager/geolocation] IP ${ipAddress}: ${result.city}, ${result.country} (Score: ${result.securityScore})`);

      return result;
    } catch (error) {
      strapi.log.error(`[magic-sessionmanager/geolocation] Error fetching IP info for ${ipAddress}:`, error.message);
      return this.getFallbackData(ipAddress);
    }
  },

  /**
   * Calculate security score based on threat indicators
   */
  calculateSecurityScore({ isVpn, isProxy, isThreat, isAnonymous, isTor }) {
    let score = 100;
    
    if (isTor) score -= 50;          // Tor = sehr verdächtig
    if (isThreat) score -= 40;       // Known threat
    if (isVpn) score -= 20;          // VPN = moderate risk
    if (isProxy) score -= 15;        // Proxy = low-moderate risk
    if (isAnonymous) score -= 10;    // Anonymous service
    
    return Math.max(0, score);
  },

  /**
   * Get risk level based on indicators
   */
  getRiskLevel({ isVpn, isProxy, isThreat }) {
    if (isThreat) return 'High';
    if (isVpn && isProxy) return 'Medium-High';
    if (isVpn || isProxy) return 'Medium';
    return 'Low';
  },

  /**
   * Get country flag emoji
   * @param {string} countryCode - ISO 2-letter country code
   * @returns {string} Flag emoji or empty string
   */
  getCountryFlag(countryCode) {
    if (!countryCode) return '';
    
    // Convert country code to flag emoji
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt());
    
    return String.fromCodePoint(...codePoints);
  },

  /**
   * Fallback data when API fails
   */
  getFallbackData(ipAddress) {
    return {
      ip: ipAddress,
      country: 'Unknown',
      country_code: 'XX',
      country_flag: '[GEO]',
      city: 'Unknown',
      region: 'Unknown',
      timezone: 'Unknown',
      latitude: null,
      longitude: null,
      isVpn: false,
      isProxy: false,
      isThreat: false,
      securityScore: 50,
      riskLevel: 'Unknown',
    };
  },

  /**
   * Batch lookup multiple IPs (for efficiency)
   */
  async batchGetIpInfo(ipAddresses) {
    const results = await Promise.all(
      ipAddresses.map(ip => this.getIpInfo(ip))
    );
    return results;
  },
});

