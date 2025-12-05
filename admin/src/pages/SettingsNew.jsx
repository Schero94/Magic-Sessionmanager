import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Flex,
  Button,
  Loader,
  SingleSelect,
  SingleSelectOption,
  Checkbox,
  Alert,
  TextInput,
  Textarea,
  Tabs,
  Divider,
  Badge,
  Accordion,
  Grid,
  Toggle,
  NumberInput,
} from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { Check, Information, Duplicate, Trash, Mail, Code, Cog, Shield, Clock } from '@strapi/icons';
import styled, { keyframes, css } from 'styled-components';
import pluginId from '../pluginId';
import { useLicense } from '../hooks/useLicense';

// ================ THEME ================
const theme = {
  colors: {
    primary: { 600: '#0284C7', 700: '#075985', 100: '#E0F2FE', 50: '#F0F9FF' },
    success: { 600: '#16A34A', 700: '#15803D', 100: '#DCFCE7', 50: '#F0FDF4' },
    danger: { 600: '#DC2626', 700: '#B91C1C', 100: '#FEE2E2', 50: '#FEF2F2' },
    warning: { 600: '#D97706', 700: '#A16207', 100: '#FEF3C7', 50: '#FFFBEB' },
    neutral: { 0: '#FFFFFF', 50: '#F9FAFB', 100: '#F3F4F6', 200: '#E5E7EB', 400: '#9CA3AF', 600: '#4B5563', 700: '#374151', 800: '#1F2937' }
  },
  shadows: { sm: '0 1px 3px rgba(0,0,0,0.1)', md: '0 4px 6px rgba(0,0,0,0.1)', xl: '0 20px 25px rgba(0,0,0,0.1)' },
  borderRadius: { md: '8px', lg: '12px', xl: '16px' }
};

// ================ ANIMATIONS ================
const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;

const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`;

// ================ STYLED COMPONENTS ================
const Container = styled(Box)`
  ${css`animation: ${fadeIn} 0.5s;`}
  max-width: 1400px;
  margin: 0 auto;
`;

const StickySaveBar = styled(Box)`
  position: sticky;
  top: 0;
  z-index: 10;
  background: white;
  border-bottom: 1px solid ${theme.colors.neutral[200]};
  box-shadow: ${theme.shadows.sm};
`;

const ToggleCard = styled(Box)`
  background: ${props => props.$active ? theme.colors.success[50] : theme.colors.neutral[50]};
  border-radius: ${theme.borderRadius.md};
  padding: 20px;
  transition: all 0.3s;
  border: 2px solid ${props => props.$active ? theme.colors.success[600] : theme.colors.neutral[200]};
  box-shadow: ${props => props.$active ? '0 4px 12px rgba(34, 197, 94, 0.2)' : '0 1px 3px rgba(0, 0, 0, 0.1)'};
  position: relative;
  cursor: pointer;
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: ${props => props.$active ? '0 6px 16px rgba(34, 197, 94, 0.3)' : '0 3px 8px rgba(0, 0, 0, 0.15)'};
  }
  
  ${props => props.$active && `
    &::before {
      content: 'ACTIVE';
      position: absolute;
      top: 8px;
      right: 8px;
      background: ${theme.colors.success[600]};
      color: white;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: bold;
    }
  `}
  
  ${props => !props.$active && `
    &::before {
      content: 'INACTIVE';
      position: absolute;
      top: 8px;
      right: 8px;
      background: ${theme.colors.neutral[400]};
      color: white;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: bold;
    }
  `}
`;

const GreenToggle = styled.div`
  ${props => props.$isActive && `
    button[role="switch"] {
      background-color: #16A34A !important;
      border-color: #16A34A !important;
      
      &:hover {
        background-color: #15803D !important;
        border-color: #15803D !important;
      }
      
      &:focus {
        background-color: #16A34A !important;
        border-color: #16A34A !important;
        box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.2) !important;
      }
    }
    
    /* Toggle handle */
    button[role="switch"] > span {
      background-color: white !important;
    }
  `}
  
  ${props => !props.$isActive && `
    button[role="switch"] {
      background-color: #E5E7EB;
      
      &:hover {
        background-color: #D1D5DB;
      }
    }
  `}
`;

// Template variable definitions
const TEMPLATE_VARIABLES = {
  suspiciousLogin: [
    { var: '{{user.email}}', desc: 'User email address' },
    { var: '{{user.username}}', desc: 'Username' },
    { var: '{{session.loginTime}}', desc: 'Login timestamp' },
    { var: '{{session.ipAddress}}', desc: 'IP address' },
    { var: '{{geo.city}}', desc: 'City (if available)' },
    { var: '{{geo.country}}', desc: 'Country (if available)' },
    { var: '{{geo.timezone}}', desc: 'Timezone (if available)' },
    { var: '{{session.userAgent}}', desc: 'Browser/Device info' },
    { var: '{{reason.isVpn}}', desc: 'VPN detected (true/false)' },
    { var: '{{reason.isProxy}}', desc: 'Proxy detected (true/false)' },
    { var: '{{reason.isThreat}}', desc: 'Threat detected (true/false)' },
    { var: '{{reason.securityScore}}', desc: 'Security score (0-100)' },
  ],
  newLocation: [
    { var: '{{user.email}}', desc: 'User email address' },
    { var: '{{user.username}}', desc: 'Username' },
    { var: '{{session.loginTime}}', desc: 'Login timestamp' },
    { var: '{{session.ipAddress}}', desc: 'IP address' },
    { var: '{{geo.city}}', desc: 'City' },
    { var: '{{geo.country}}', desc: 'Country' },
    { var: '{{geo.timezone}}', desc: 'Timezone' },
    { var: '{{session.userAgent}}', desc: 'Browser/Device info' },
  ],
  vpnProxy: [
    { var: '{{user.email}}', desc: 'User email address' },
    { var: '{{user.username}}', desc: 'Username' },
    { var: '{{session.loginTime}}', desc: 'Login timestamp' },
    { var: '{{session.ipAddress}}', desc: 'IP address' },
    { var: '{{geo.city}}', desc: 'City (if available)' },
    { var: '{{geo.country}}', desc: 'Country (if available)' },
    { var: '{{session.userAgent}}', desc: 'Browser/Device info' },
    { var: '{{reason.isVpn}}', desc: 'VPN detected (true/false)' },
    { var: '{{reason.isProxy}}', desc: 'Proxy detected (true/false)' },
  ],
};

// Validate template variables
const validateTemplate = (template, templateType) => {
  const requiredVars = TEMPLATE_VARIABLES[templateType];
  const foundVars = [];
  
  requiredVars.forEach(({ var: variable }) => {
    if (template.includes(variable)) {
      foundVars.push(variable);
    }
  });
  
  return {
    isValid: foundVars.length > 0,
    foundVars,
    totalAvailable: requiredVars.length,
  };
};

// Get default email templates
const getDefaultTemplates = () => ({
  suspiciousLogin: {
    subject: '[ALERT] Suspicious Login Alert - Session Manager',
    html: `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb; border-radius: 10px;">
    <h2 style="color: #dc2626;">[ALERT] Suspicious Login Detected</h2>
    <p>A potentially suspicious login was detected for your account.</p>
    
    <div style="background: white; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <h3 style="margin-top: 0;">Account Information:</h3>
      <ul>
        <li><strong>Email:</strong> {{user.email}}</li>
        <li><strong>Username:</strong> {{user.username}}</li>
      </ul>
      
      <h3>Login Details:</h3>
      <ul>
        <li><strong>Time:</strong> {{session.loginTime}}</li>
        <li><strong>IP Address:</strong> {{session.ipAddress}}</li>
        <li><strong>Location:</strong> {{geo.city}}, {{geo.country}}</li>
        <li><strong>Timezone:</strong> {{geo.timezone}}</li>
        <li><strong>Device:</strong> {{session.userAgent}}</li>
      </ul>
      
      <h3 style="color: #dc2626;">Security Alert:</h3>
      <ul>
        <li>VPN Detected: {{reason.isVpn}}</li>
        <li>Proxy Detected: {{reason.isProxy}}</li>
        <li>Threat Detected: {{reason.isThreat}}</li>
        <li>Security Score: {{reason.securityScore}}/100</li>
      </ul>
    </div>
    
    <p>If this was you, you can safely ignore this email. If you don't recognize this activity, please secure your account immediately.</p>
    
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;"/>
    <p style="color: #666; font-size: 12px;">This is an automated security notification from Magic Session Manager.</p>
  </div>
</body>
</html>`,
    text: `[ALERT] Suspicious Login Detected

A potentially suspicious login was detected for your account.

Account: {{user.email}}
Username: {{user.username}}

Login Details:
- Time: {{session.loginTime}}
- IP: {{session.ipAddress}}
- Location: {{geo.city}}, {{geo.country}}

Security: VPN={{reason.isVpn}}, Proxy={{reason.isProxy}}, Threat={{reason.isThreat}}, Score={{reason.securityScore}}/100`,
  },
  newLocation: {
    subject: '[LOCATION] New Location Login Detected',
    html: `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f0f9ff; border-radius: 10px;">
    <h2 style="color: #0284c7;">[LOCATION] Login from New Location</h2>
    <p>Your account was accessed from a new location.</p>
    
    <div style="background: white; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <h3 style="margin-top: 0;">Account:</h3>
      <p><strong>{{user.email}}</strong></p>
      
      <h3>New Location Details:</h3>
      <ul>
        <li><strong>Time:</strong> {{session.loginTime}}</li>
        <li><strong>Location:</strong> {{geo.city}}, {{geo.country}}</li>
        <li><strong>IP Address:</strong> {{session.ipAddress}}</li>
        <li><strong>Device:</strong> {{session.userAgent}}</li>
      </ul>
    </div>
    
    <p>If this was you, no action is needed. If you don't recognize this login, please secure your account.</p>
    
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;"/>
    <p style="color: #666; font-size: 12px;">Magic Session Manager notification</p>
  </div>
</body>
</html>`,
    text: `[LOCATION] Login from New Location

Your account was accessed from a new location.

Account: {{user.email}}

New Location Details:
- Time: {{session.loginTime}}
- Location: {{geo.city}}, {{geo.country}}
- IP Address: {{session.ipAddress}}
- Device: {{session.userAgent}}

If this was you, no action is needed.`,
  },
  vpnProxy: {
    subject: '[WARNING] VPN/Proxy Login Detected',
    html: `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px; background-color: #fffbeb; border-radius: 10px;">
    <h2 style="color: #d97706;">[WARNING] VPN/Proxy Detected</h2>
    <p>A login from a VPN or proxy service was detected on your account.</p>
    
    <div style="background: white; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <h3 style="margin-top: 0;">Account:</h3>
      <p><strong>{{user.email}}</strong></p>
      
      <h3>Login Details:</h3>
      <ul>
        <li><strong>Time:</strong> {{session.loginTime}}</li>
        <li><strong>IP Address:</strong> {{session.ipAddress}}</li>
        <li><strong>Location:</strong> {{geo.city}}, {{geo.country}}</li>
        <li><strong>Device:</strong> {{session.userAgent}}</li>
        <li><strong>VPN:</strong> {{reason.isVpn}}</li>
        <li><strong>Proxy:</strong> {{reason.isProxy}}</li>
      </ul>
    </div>
    
    <p>VPN/Proxy usage may indicate suspicious activity. If this was you, you can safely ignore this email.</p>
    
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;"/>
    <p style="color: #666; font-size: 12px;">Magic Session Manager notification</p>
  </div>
</body>
</html>`,
    text: `[WARNING] VPN/Proxy Detected

A login from a VPN or proxy service was detected on your account.

Account: {{user.email}}

Login Details:
- Time: {{session.loginTime}}
- IP Address: {{session.ipAddress}}
- Location: {{geo.city}}, {{geo.country}}
- VPN: {{reason.isVpn}}, Proxy: {{reason.isProxy}}`,
  },
});

const SettingsPage = () => {
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const { isPremium, isAdvanced, isEnterprise } = useLicense();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [activeTemplateTab, setActiveTemplateTab] = useState('suspiciousLogin');
  
  const [settings, setSettings] = useState({
    inactivityTimeout: 15,
    cleanupInterval: 30,
    lastSeenRateLimit: 30,
    retentionDays: 90,
    enableGeolocation: true,
    enableSecurityScoring: true,
    blockSuspiciousSessions: false,
    maxFailedLogins: 5,
    enableEmailAlerts: false,
    alertOnSuspiciousLogin: true,
    alertOnNewLocation: true,
    alertOnVpnProxy: true,
    enableWebhooks: false,
    discordWebhookUrl: '',
    slackWebhookUrl: '',
    enableGeofencing: false,
    allowedCountries: [],
    blockedCountries: [],
    emailTemplates: {
      suspiciousLogin: { subject: '', html: '', text: '' },
      newLocation: { subject: '', html: '', text: '' },
      vpnProxy: { subject: '', html: '', text: '' },
    },
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const saved = localStorage.getItem(`${pluginId}-settings`);
      if (saved) {
        const loadedSettings = JSON.parse(saved);
        if (!loadedSettings.emailTemplates) {
          loadedSettings.emailTemplates = getDefaultTemplates();
        }
        setSettings(loadedSettings);
      } else {
        setSettings(prev => ({ ...prev, emailTemplates: getDefaultTemplates() }));
      }
    } catch (err) {
      console.error('[Settings] Error loading:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const updateSetting = (key, value) => {
    handleChange(key, value);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      localStorage.setItem(`${pluginId}-settings`, JSON.stringify(settings));
      
      toggleNotification({
        type: 'success',
        message: 'Settings saved successfully!',
      });
      
      setHasChanges(false);
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: 'Failed to save settings',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    fetchSettings();
    setHasChanges(false);
  };

  const handleCleanInactive = async () => {
    if (!confirm('[WARNING] This will permanently delete ALL inactive sessions.\n\nContinue?')) {
      return;
    }

    setCleaning(true);
    try {
      const { data } = await post(`/${pluginId}/sessions/clean-inactive`);
      
      toggleNotification({
        type: 'success',
        message: `Successfully deleted ${data.deletedCount} inactive sessions!`,
      });
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: 'Failed to delete inactive sessions',
      });
    } finally {
      setCleaning(false);
    }
  };

  if (loading) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader>Loading settings...</Loader>
      </Flex>
    );
  }

  return (
    <Container>
      {/* Sticky Header */}
      <StickySaveBar paddingTop={5} paddingBottom={5} paddingLeft={6} paddingRight={6}>
        <Flex justifyContent="space-between" alignItems="center">
          <Flex direction="column" gap={1} alignItems="flex-start">
            <Typography variant="alpha" fontWeight="bold" style={{ fontSize: '24px' }}>
              ⚙️ Session Manager Settings
            </Typography>
            <Typography variant="epsilon" textColor="neutral600">
              Configure session tracking, security, and email notifications
            </Typography>
          </Flex>
          <Flex gap={2}>
            {hasChanges && (
              <Button onClick={handleReset} variant="tertiary" size="L">
                Reset
              </Button>
            )}
            <Button
              onClick={handleSave}
              loading={saving}
              startIcon={<Check />}
              size="L"
              disabled={!hasChanges || saving}
              style={{
                background: hasChanges && !saving
                  ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' 
                  : '#e5e7eb',
                color: hasChanges && !saving ? 'white' : '#9ca3af',
                fontWeight: '600',
                padding: '12px 24px',
                border: 'none',
                boxShadow: hasChanges && !saving ? '0 4px 12px rgba(102, 126, 234, 0.4)' : 'none',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
              onMouseEnter={(e) => {
                if (hasChanges && !saving) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 8px 20px rgba(102, 126, 234, 0.5)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = hasChanges && !saving ? '0 4px 12px rgba(102, 126, 234, 0.4)' : 'none';
              }}
            >
              {saving ? 'Saving...' : hasChanges ? 'Save Changes' : 'No Changes'}
            </Button>
          </Flex>
        </Flex>
      </StickySaveBar>

      {/* Content */}
      <Box paddingTop={6} paddingLeft={6} paddingRight={6} paddingBottom={10}>
        
        {/* Info Alert */}
        <Alert variant="default" title="Configuration Note" closeLabel="Close" style={{ marginBottom: '24px' }}>
          Changes require a server restart. Update config/plugins.ts for permanent changes.
        </Alert>

        {/* Accordion Layout */}
        <Accordion.Root type="multiple" defaultValue={['general', 'security', 'email']}>
          
          {/* General Settings */}
          <Accordion.Item value="general">
            <Accordion.Header>
              <Accordion.Trigger
                icon={Cog}
                description="Basic session tracking configuration"
              >
                General Settings
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Box padding={6}>
                
                {/* Session Timeout */}
                <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '16px', display: 'block', color: theme.colors.neutral[700] }}>
                  SESSION TIMEOUT
                </Typography>
                <Grid.Root gap={6} style={{ marginBottom: '32px' }}>
                  <Grid.Item col={6} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        Inactivity Timeout
                      </Typography>
                      <SingleSelect
                        value={String(settings.inactivityTimeout)}
                        onChange={(value) => handleChange('inactivityTimeout', parseInt(value))}
                      >
                        <SingleSelectOption value="5">5 minutes (Very Strict)</SingleSelectOption>
                        <SingleSelectOption value="10">10 minutes (Strict)</SingleSelectOption>
                        <SingleSelectOption value="15">15 minutes (Recommended)</SingleSelectOption>
                        <SingleSelectOption value="30">30 minutes (Moderate)</SingleSelectOption>
                        <SingleSelectOption value="60">1 hour (Relaxed)</SingleSelectOption>
                        <SingleSelectOption value="120">2 hours (Very Relaxed)</SingleSelectOption>
                      </SingleSelect>
                      <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '8px' }}>
                        Sessions inactive for more than {settings.inactivityTimeout} minutes will be marked as offline
                      </Typography>
                    </Box>
                  </Grid.Item>
                  
                  <Grid.Item col={6} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        Last Seen Rate Limit
                      </Typography>
                      <SingleSelect
                        value={String(settings.lastSeenRateLimit)}
                        onChange={(value) => handleChange('lastSeenRateLimit', parseInt(value))}
                      >
                        <SingleSelectOption value="10">10 seconds</SingleSelectOption>
                        <SingleSelectOption value="30">30 seconds (Recommended)</SingleSelectOption>
                        <SingleSelectOption value="60">1 minute</SingleSelectOption>
                        <SingleSelectOption value="120">2 minutes</SingleSelectOption>
                        <SingleSelectOption value="300">5 minutes</SingleSelectOption>
                      </SingleSelect>
                      <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '8px' }}>
                        Prevents excessive database writes. Updates throttled to once every {settings.lastSeenRateLimit} seconds
                      </Typography>
                    </Box>
                  </Grid.Item>
                </Grid.Root>

                {/* Cleanup & Retention */}
                <Divider style={{ marginBottom: '24px' }} />
                <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '16px', display: 'block', color: theme.colors.neutral[700] }}>
                  🧹 AUTO-CLEANUP & RETENTION
                </Typography>
                <Grid.Root gap={6}>
                  <Grid.Item col={6} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        Cleanup Interval
                      </Typography>
                      <SingleSelect
                        value={String(settings.cleanupInterval)}
                        onChange={(value) => handleChange('cleanupInterval', parseInt(value))}
                      >
                        <SingleSelectOption value="15">15 minutes</SingleSelectOption>
                        <SingleSelectOption value="30">30 minutes (Recommended)</SingleSelectOption>
                        <SingleSelectOption value="60">1 hour</SingleSelectOption>
                        <SingleSelectOption value="120">2 hours</SingleSelectOption>
                      </SingleSelect>
                      <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '8px' }}>
                        Inactive sessions are automatically cleaned every {settings.cleanupInterval} minutes
                      </Typography>
                    </Box>
                  </Grid.Item>
                  
                  <Grid.Item col={6} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        Retention Period
                      </Typography>
                      <SingleSelect
                        value={String(settings.retentionDays)}
                        onChange={(value) => handleChange('retentionDays', parseInt(value))}
                      >
                        <SingleSelectOption value="7">7 days</SingleSelectOption>
                        <SingleSelectOption value="30">30 days</SingleSelectOption>
                        <SingleSelectOption value="60">60 days</SingleSelectOption>
                        <SingleSelectOption value="90">90 days (Recommended)</SingleSelectOption>
                        <SingleSelectOption value="180">180 days</SingleSelectOption>
                        <SingleSelectOption value="365">1 year</SingleSelectOption>
                        <SingleSelectOption value="-1">Forever</SingleSelectOption>
                      </SingleSelect>
                      <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '8px' }}>
                        Old sessions deleted after {settings.retentionDays === -1 ? 'never' : `${settings.retentionDays} days`}
                      </Typography>
                    </Box>
                  </Grid.Item>
                  
                  <Grid.Item col={12}>
                    <Box padding={4} background="danger100" style={{ borderRadius: theme.borderRadius.md, border: `2px solid ${theme.colors.danger[200]}` }}>
                      <Flex gap={3} alignItems="flex-start">
                        <Trash style={{ width: '18px', height: '18px', color: theme.colors.danger[600], flexShrink: 0, marginTop: '2px' }} />
                        <Box style={{ flex: 1 }}>
                          <Typography variant="omega" fontWeight="bold" textColor="danger700" style={{ marginBottom: '8px', display: 'block' }}>
                            Danger Zone
                          </Typography>
                          <Typography variant="pi" textColor="danger600" style={{ fontSize: '13px', lineHeight: '1.7' }}>
                            <strong>Clean All Inactive:</strong> Permanently deletes all inactive sessions. This cannot be undone.
                          </Typography>
                        </Box>
                        <Button
                          onClick={handleCleanInactive}
                          loading={cleaning}
                          startIcon={<Trash />}
                          variant="danger"
                          size="S"
                          style={{ flexShrink: 0 }}
                        >
                          Clean Now
                        </Button>
                      </Flex>
                    </Box>
                  </Grid.Item>
                </Grid.Root>

              </Box>
            </Accordion.Content>
          </Accordion.Item>

          {/* Security Settings */}
          <Accordion.Item value="security">
            <Accordion.Header>
              <Accordion.Trigger
                icon={Shield}
                description="Security policies and threat protection"
              >
                Security Settings
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Box padding={6}>
                
                <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '16px', display: 'block', color: theme.colors.neutral[700] }}>
                  SECURITY OPTIONS
                </Typography>
                
                {/* Feature Toggles */}
                <Box background="neutral100" padding={5} style={{ borderRadius: theme.borderRadius.md, marginBottom: '32px' }}>
                  <Grid.Root gap={4}>
                    <Grid.Item col={6} s={12}>
                      <ToggleCard 
                        $active={settings.blockSuspiciousSessions}
                        onClick={() => handleChange('blockSuspiciousSessions', !settings.blockSuspiciousSessions)}
                      >
                        <Flex direction="column" gap={2}>
                          <Flex justifyContent="space-between" alignItems="center">
                            <Typography variant="omega" fontWeight="bold" textColor={settings.blockSuspiciousSessions ? 'success700' : 'neutral700'}>
                              Block Suspicious Sessions
                            </Typography>
                            <GreenToggle $isActive={settings.blockSuspiciousSessions}>
                              <Toggle
                                checked={settings.blockSuspiciousSessions}
                                onChange={() => handleChange('blockSuspiciousSessions', !settings.blockSuspiciousSessions)}
                              />
                            </GreenToggle>
                          </Flex>
                          <Typography variant="pi" textColor="neutral600" style={{ fontSize: '12px' }}>
                            Automatically block sessions from VPNs, proxies, or threat IPs
                          </Typography>
                        </Flex>
                      </ToggleCard>
                    </Grid.Item>
                    
                    {isPremium && (
                      <>
                        <Grid.Item col={6} s={12}>
                          <ToggleCard 
                            $active={settings.enableGeolocation}
                            onClick={() => handleChange('enableGeolocation', !settings.enableGeolocation)}
                          >
                            <Flex direction="column" gap={2}>
                              <Flex justifyContent="space-between" alignItems="center">
                                <Typography variant="omega" fontWeight="bold" textColor={settings.enableGeolocation ? 'success700' : 'neutral700'}>
                                  IP Geolocation
                                </Typography>
                                <GreenToggle $isActive={settings.enableGeolocation}>
                                  <Toggle
                                    checked={settings.enableGeolocation}
                                    onChange={() => handleChange('enableGeolocation', !settings.enableGeolocation)}
                                  />
                                </GreenToggle>
                              </Flex>
                              <Typography variant="pi" textColor="neutral600" style={{ fontSize: '12px' }}>
                                Fetch location data for each session (Premium)
                              </Typography>
                            </Flex>
                          </ToggleCard>
                        </Grid.Item>
                        
                        <Grid.Item col={6} s={12}>
                          <ToggleCard 
                            $active={settings.enableSecurityScoring}
                            onClick={() => handleChange('enableSecurityScoring', !settings.enableSecurityScoring)}
                          >
                            <Flex direction="column" gap={2}>
                              <Flex justifyContent="space-between" alignItems="center">
                                <Typography variant="omega" fontWeight="bold" textColor={settings.enableSecurityScoring ? 'success700' : 'neutral700'}>
                                  Security Scoring
                                </Typography>
                                <GreenToggle $isActive={settings.enableSecurityScoring}>
                                  <Toggle
                                    checked={settings.enableSecurityScoring}
                                    onChange={() => handleChange('enableSecurityScoring', !settings.enableSecurityScoring)}
                                  />
                                </GreenToggle>
                              </Flex>
                              <Typography variant="pi" textColor="neutral600" style={{ fontSize: '12px' }}>
                                Calculate security scores and detect threats (Premium)
                              </Typography>
                            </Flex>
                          </ToggleCard>
                        </Grid.Item>
                      </>
                    )}
                  </Grid.Root>
                </Box>

                {/* Max Failed Logins */}
                <Grid.Root gap={6}>
                  <Grid.Item col={6} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        🚫 Max Failed Login Attempts
                      </Typography>
                      <NumberInput
                        value={settings.maxFailedLogins}
                        onValueChange={(val) => handleChange('maxFailedLogins', val)}
                        min={1}
                        max={20}
                      />
                      <Box padding={2} background="warning50" style={{ borderRadius: '4px', marginTop: '8px' }}>
                        <Typography variant="pi" textColor="warning700" style={{ fontSize: '11px' }}>
                          User will be blocked after {settings.maxFailedLogins} failed attempts
                        </Typography>
                      </Box>
                    </Box>
                  </Grid.Item>
                </Grid.Root>

              </Box>
            </Accordion.Content>
          </Accordion.Item>

          {/* Email Notifications - Advanced Only */}
          {isAdvanced && (
            <Accordion.Item value="email">
              <Accordion.Header>
                <Accordion.Trigger
                  icon={Mail}
                  description="Email alerts for security events"
                >
                  Email Notifications (Advanced)
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={6}>
                  
                  {/* Email Alerts Toggle */}
                  <Box background="neutral100" padding={5} style={{ borderRadius: theme.borderRadius.md, marginBottom: '32px' }}>
                    <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '8px', display: 'block', textAlign: 'center', color: theme.colors.neutral[700] }}>
                      📧 EMAIL ALERTS
                    </Typography>
                    <Typography variant="pi" textColor="neutral600" style={{ marginBottom: '20px', display: 'block', textAlign: 'center', fontSize: '12px' }}>
                      Send security alerts to users via email
                    </Typography>
                    <Grid.Root gap={4}>
                      <Grid.Item col={12}>
                        <ToggleCard 
                          $active={settings.enableEmailAlerts}
                          onClick={() => handleChange('enableEmailAlerts', !settings.enableEmailAlerts)}
                        >
                          <Flex direction="column" gap={2}>
                            <Flex justifyContent="space-between" alignItems="center">
                              <Typography variant="omega" fontWeight="bold" textColor={settings.enableEmailAlerts ? 'success700' : 'neutral700'}>
                                Enable Email Alerts
                              </Typography>
                              <GreenToggle $isActive={settings.enableEmailAlerts}>
                                <Toggle
                                  checked={settings.enableEmailAlerts}
                                  onChange={() => handleChange('enableEmailAlerts', !settings.enableEmailAlerts)}
                                />
                              </GreenToggle>
                            </Flex>
                            <Typography variant="pi" textColor="neutral600" style={{ fontSize: '12px' }}>
                              Send security alerts for suspicious logins, new locations, and VPN/Proxy usage
                            </Typography>
                          </Flex>
                        </ToggleCard>
                      </Grid.Item>
                    </Grid.Root>
                  </Box>

                  {/* Alert Type Checkboxes */}
                  {settings.enableEmailAlerts && (
                    <>
                      <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '16px', display: 'block', color: theme.colors.neutral[700] }}>
                        ⚙️ ALERT TYPES
                      </Typography>
                      <Grid.Root gap={4} style={{ marginBottom: '32px' }}>
                        <Grid.Item col={4} s={12}>
                          <Box padding={3} background="neutral50" style={{ borderRadius: theme.borderRadius.md, border: '1px solid #E5E7EB' }}>
                            <Checkbox
                              checked={settings.alertOnSuspiciousLogin}
                              onChange={() => handleChange('alertOnSuspiciousLogin', !settings.alertOnSuspiciousLogin)}
                            >
                              Suspicious Login
                            </Checkbox>
                          </Box>
                        </Grid.Item>
                        <Grid.Item col={4} s={12}>
                          <Box padding={3} background="neutral50" style={{ borderRadius: theme.borderRadius.md, border: '1px solid #E5E7EB' }}>
                            <Checkbox
                              checked={settings.alertOnNewLocation}
                              onChange={() => handleChange('alertOnNewLocation', !settings.alertOnNewLocation)}
                            >
                              New Location
                            </Checkbox>
                          </Box>
                        </Grid.Item>
                        <Grid.Item col={4} s={12}>
                          <Box padding={3} background="neutral50" style={{ borderRadius: theme.borderRadius.md, border: '1px solid #E5E7EB' }}>
                            <Checkbox
                              checked={settings.alertOnVpnProxy}
                              onChange={() => handleChange('alertOnVpnProxy', !settings.alertOnVpnProxy)}
                            >
                              VPN/Proxy
                            </Checkbox>
                          </Box>
                        </Grid.Item>
                      </Grid.Root>

                      {/* Email Templates */}
                      <Divider style={{ marginBottom: '24px' }} />
                      <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '8px', display: 'block', color: theme.colors.neutral[700] }}>
                        EMAIL TEMPLATES
                      </Typography>
                      <Typography variant="pi" textColor="neutral600" style={{ marginBottom: '20px', display: 'block', fontSize: '12px' }}>
                        Customize email notification templates with dynamic variables
                      </Typography>
                      
                      {/* Template Tabs */}
                      <Tabs.Root value={activeTemplateTab} onValueChange={setActiveTemplateTab}>
                        <Tabs.List aria-label="Email Templates">
                          <Tabs.Trigger value="suspiciousLogin">Suspicious Login</Tabs.Trigger>
                          <Tabs.Trigger value="newLocation">New Location</Tabs.Trigger>
                          <Tabs.Trigger value="vpnProxy">VPN/Proxy</Tabs.Trigger>
                        </Tabs.List>
                        
                        {Object.keys(settings.emailTemplates).map((templateKey) => (
                          <Tabs.Content key={templateKey} value={templateKey}>
                            <Box paddingTop={4}>
                              {/* Subject */}
                              <Box style={{ marginBottom: '24px' }}>
                                <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                                  Email Subject
                                </Typography>
                                <TextInput
                                  value={settings.emailTemplates[templateKey].subject}
                                  onChange={(e) => {
                                    const newTemplates = { ...settings.emailTemplates };
                                    newTemplates[templateKey].subject = e.target.value;
                                    handleChange('emailTemplates', newTemplates);
                                  }}
                                  placeholder="Enter email subject..."
                                />
                              </Box>
                              
                              {/* Available Variables */}
                              <Box 
                                padding={3} 
                                background="primary100" 
                                style={{ borderRadius: theme.borderRadius.md, marginBottom: '20px', border: '2px solid #BAE6FD' }}
                              >
                                <Flex direction="column" gap={2}>
                                  <Flex alignItems="center" gap={2}>
                                    <Code style={{ width: '16px', height: '16px', color: theme.colors.primary[600] }} />
                                    <Typography variant="omega" fontWeight="bold" textColor="primary600">
                                      Available Variables (click to copy)
                                    </Typography>
                                  </Flex>
                                  <Flex gap={2} wrap="wrap">
                                    {TEMPLATE_VARIABLES[templateKey].map(({ var: variable, desc }) => (
                                      <Button
                                        key={variable}
                                        size="S"
                                        variant="tertiary"
                                        onClick={() => {
                                          navigator.clipboard.writeText(variable);
                                          toggleNotification({ type: 'success', message: `${variable} copied!` });
                                        }}
                                        style={{ 
                                          fontFamily: 'monospace', 
                                          fontSize: '11px',
                                          padding: '4px 8px',
                                        }}
                                        title={desc}
                                      >
                                        {variable}
                                      </Button>
                                    ))}
                                  </Flex>
                                </Flex>
                              </Box>
                              
                              {/* HTML Template */}
                              <Box style={{ marginBottom: '24px' }}>
                                <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: '10px' }}>
                                  <Typography variant="pi" fontWeight="bold">
                                    🎨 HTML Template
                                  </Typography>
                                  <Button
                                    size="S"
                                    variant="secondary"
                                    onClick={() => {
                                      const validation = validateTemplate(settings.emailTemplates[templateKey].html, templateKey);
                                      toggleNotification({
                                        type: validation.isValid ? 'success' : 'warning',
                                        message: validation.isValid 
                                          ? `Template valid! Found ${validation.foundVars.length} variables.`
                                          : 'No variables found in template. Add at least one variable.',
                                      });
                                    }}
                                  >
                                    ✓ Validate
                                  </Button>
                                </Flex>
                                <Textarea
                                  value={settings.emailTemplates[templateKey].html}
                                  onChange={(e) => {
                                    const newTemplates = { ...settings.emailTemplates };
                                    newTemplates[templateKey].html = e.target.value;
                                    handleChange('emailTemplates', newTemplates);
                                  }}
                                  style={{
                                    fontFamily: 'Monaco, Consolas, monospace',
                                    fontSize: '12px',
                                    minHeight: '250px',
                                    lineHeight: '1.8',
                                  }}
                                  placeholder="Enter HTML template with variables like {{user.email}}..."
                                />
                                <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '8px' }}>
                                  Use HTML formatting and insert variables from the list above
                                </Typography>
                              </Box>
                              
                              {/* Text Template */}
                              <Box style={{ marginBottom: '24px' }}>
                                <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                                  📄 Text Template (Fallback)
                                </Typography>
                                <Textarea
                                  value={settings.emailTemplates[templateKey].text}
                                  onChange={(e) => {
                                    const newTemplates = { ...settings.emailTemplates };
                                    newTemplates[templateKey].text = e.target.value;
                                    handleChange('emailTemplates', newTemplates);
                                  }}
                                  style={{
                                    fontFamily: 'Monaco, Consolas, monospace',
                                    fontSize: '12px',
                                    minHeight: '150px',
                                    lineHeight: '1.8',
                                  }}
                                  placeholder="Plain text version (no HTML)..."
                                />
                                <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '8px' }}>
                                  Plain text version for email clients that don't support HTML
                                </Typography>
                              </Box>
                              
                              {/* Load Default Template Button */}
                              <Button
                                size="S"
                                variant="secondary"
                                onClick={() => {
                                  const defaultTemplates = getDefaultTemplates();
                                  const newTemplates = { ...settings.emailTemplates };
                                  newTemplates[templateKey] = defaultTemplates[templateKey];
                                  handleChange('emailTemplates', newTemplates);
                                  toggleNotification({ type: 'success', message: 'Default template loaded!' });
                                }}
                              >
                                📋 Load Default Template
                              </Button>
                            </Box>
                          </Tabs.Content>
                        ))}
                      </Tabs.Root>
                    </>
                  )}

                </Box>
              </Accordion.Content>
            </Accordion.Item>
          )}

          {/* Webhooks - Advanced Only */}
          {isAdvanced && (
            <Accordion.Item value="webhooks">
              <Accordion.Header>
                <Accordion.Trigger
                  icon={Code}
                  description="Discord & Slack integration"
                >
                  Webhook Integration (Advanced)
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={6}>
                  
                  {/* Enable Webhooks Toggle */}
                  <Box background="neutral100" padding={5} style={{ borderRadius: theme.borderRadius.md, marginBottom: '32px' }}>
                    <Grid.Root gap={4}>
                      <Grid.Item col={12}>
                        <ToggleCard 
                          $active={settings.enableWebhooks}
                          onClick={() => handleChange('enableWebhooks', !settings.enableWebhooks)}
                        >
                          <Flex direction="column" gap={2}>
                            <Flex justifyContent="space-between" alignItems="center">
                              <Typography variant="omega" fontWeight="bold" textColor={settings.enableWebhooks ? 'success700' : 'neutral700'}>
                                Enable Webhooks
                              </Typography>
                              <GreenToggle $isActive={settings.enableWebhooks}>
                                <Toggle
                                  checked={settings.enableWebhooks}
                                  onChange={() => handleChange('enableWebhooks', !settings.enableWebhooks)}
                                />
                              </GreenToggle>
                            </Flex>
                            <Typography variant="pi" textColor="neutral600" style={{ fontSize: '12px' }}>
                              Send session events to Discord, Slack, or custom endpoints
                            </Typography>
                          </Flex>
                        </ToggleCard>
                      </Grid.Item>
                    </Grid.Root>
                  </Box>

                  {/* Webhook URLs */}
                  {settings.enableWebhooks && (
                    <Grid.Root gap={6}>
                      <Grid.Item col={12}>
                        <Box>
                          <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                            Discord Webhook URL
                          </Typography>
                          <TextInput
                            placeholder="https://discord.com/api/webhooks/..."
                            value={settings.discordWebhookUrl}
                            onChange={(e) => handleChange('discordWebhookUrl', e.target.value)}
                          />
                          <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '8px' }}>
                            Optional: Post session alerts to Discord
                          </Typography>
                        </Box>
                      </Grid.Item>

                      <Grid.Item col={12}>
                        <Box>
                          <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                            Slack Webhook URL
                          </Typography>
                          <TextInput
                            placeholder="https://hooks.slack.com/services/..."
                            value={settings.slackWebhookUrl}
                            onChange={(e) => handleChange('slackWebhookUrl', e.target.value)}
                          />
                          <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '8px' }}>
                            Optional: Post session alerts to Slack
                          </Typography>
                        </Box>
                      </Grid.Item>
                    </Grid.Root>
                  )}

                </Box>
              </Accordion.Content>
            </Accordion.Item>
          )}

        </Accordion.Root>

        {/* Footer Info */}
        <Box padding={5} background="neutral100" style={{ borderRadius: theme.borderRadius.md, marginTop: '32px' }}>
          <Flex gap={3} alignItems="flex-start">
            <Information style={{ width: '20px', height: '20px', color: theme.colors.neutral[600], flexShrink: 0, marginTop: '2px' }} />
            <Box style={{ flex: 1 }}>
              <Typography variant="omega" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                How to Apply These Settings
              </Typography>
              <Typography variant="pi" textColor="neutral600" style={{ fontSize: '13px', lineHeight: '1.8' }}>
                Settings are saved in your browser. To apply permanently, copy the config below and paste it into{' '}
                <code style={{ background: '#e5e7eb', padding: '2px 6px', borderRadius: '4px' }}>config/plugins.ts</code>, then restart.
              </Typography>
              <Button
                onClick={async () => {
                  const configCode = `'magic-sessionmanager': {
  config: {
    inactivityTimeout: ${settings.inactivityTimeout * 60 * 1000},  // ${settings.inactivityTimeout} min
    cleanupInterval: ${settings.cleanupInterval * 60 * 1000},      // ${settings.cleanupInterval} min
    lastSeenRateLimit: ${settings.lastSeenRateLimit * 1000},       // ${settings.lastSeenRateLimit} sec
    retentionDays: ${settings.retentionDays},
    enableGeolocation: ${settings.enableGeolocation},
    enableSecurityScoring: ${settings.enableSecurityScoring},
    blockSuspiciousSessions: ${settings.blockSuspiciousSessions},
    maxFailedLogins: ${settings.maxFailedLogins},
    enableEmailAlerts: ${settings.enableEmailAlerts},
    alertOnSuspiciousLogin: ${settings.alertOnSuspiciousLogin},
    alertOnNewLocation: ${settings.alertOnNewLocation},
    alertOnVpnProxy: ${settings.alertOnVpnProxy},
    enableWebhooks: ${settings.enableWebhooks},
  }
}`;
                  
                  try {
                    await navigator.clipboard.writeText(configCode);
                    toggleNotification({ type: 'success', message: 'Config copied to clipboard!' });
                  } catch (err) {
                    toggleNotification({ type: 'danger', message: 'Failed to copy' });
                  }
                }}
                startIcon={<Duplicate />}
                size="S"
                variant="secondary"
                style={{ marginTop: '16px' }}
              >
                Copy Config
              </Button>
            </Box>
          </Flex>
        </Box>

      </Box>
    </Container>
  );
};

export default SettingsPage;

