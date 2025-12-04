import { useState, useEffect } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import pluginId from '../pluginId';

/**
 * Hook to check license status
 * Returns: { isPremium, loading, error }
 */
export const useLicense = () => {
  const { get } = useFetchClient();
  const [isPremium, setIsPremium] = useState(false);
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [isEnterprise, setIsEnterprise] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [licenseData, setLicenseData] = useState(null);

  useEffect(() => {
    checkLicense();
    
    // Auto-refresh every 1 hour to detect license changes (silent background check)
    const interval = setInterval(() => {
      checkLicense(true); // Silent refresh - user merkt nichts
    }, 60 * 60 * 1000); // 1 hour
    
    return () => clearInterval(interval);
  }, []);

  const checkLicense = async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    
    try {
      const response = await get(`/${pluginId}/license/status`);
      
      // Debug logging with plugin name
      if (!silent) {
        console.log('[magic-sessionmanager/useLicense] Full API Response:', response.data);
        console.log('[magic-sessionmanager/useLicense] License Details:', {
          valid: response.data?.valid,
          demo: response.data?.demo,
          licenseKey: response.data?.data?.licenseKey?.substring(0, 13) + '...',
          email: response.data?.data?.email,
          features: response.data?.data?.features,
          rawFeaturePremium: response.data?.data?.features?.premium,
        });
      }
      
      // Check if license is valid AND has premium feature enabled
      const isValid = response.data?.valid || false;
      const hasPremiumFeature = response.data?.data?.features?.premium || false;
      const hasAdvancedFeature = response.data?.data?.features?.advanced || false;
      const hasEnterpriseFeature = response.data?.data?.features?.enterprise || false;
      const newIsPremium = isValid && hasPremiumFeature;
      const newIsAdvanced = isValid && hasAdvancedFeature;
      const newIsEnterprise = isValid && hasEnterpriseFeature;
      
      // Log with plugin name
      if ((newIsPremium !== isPremium || !silent) && !silent) {
        console.log(`[magic-sessionmanager/useLicense] Premium Status: ${newIsPremium} (valid: ${isValid}, featurePremium: ${hasPremiumFeature})`);
        if (!newIsPremium && isValid) {
          console.warn('[magic-sessionmanager/useLicense] [WARN] License is valid but Premium feature is not enabled!');
        }
      }
      
      setIsPremium(newIsPremium);
      setIsAdvanced(newIsAdvanced);
      setIsEnterprise(newIsEnterprise);
      setLicenseData(response.data?.data || null);
      setError(null);
    } catch (err) {
      if (!silent) {
        console.error('[useLicense] Error checking license:', err);
      }
      setIsPremium(false);
      setIsAdvanced(false);
      setIsEnterprise(false);
      setLicenseData(null);
      setError(err);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  return { 
    isPremium, 
    isAdvanced,
    isEnterprise,
    loading, 
    error, 
    licenseData,
    features: {
      premium: isPremium,
      advanced: isAdvanced,
      enterprise: isEnterprise,
    },
    refetch: checkLicense 
  };
};

