import { useState, useEffect } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import styled, { keyframes } from 'styled-components';
import {
  Box,
  Typography,
  Flex,
  Loader,
  Badge,
} from '@strapi/design-system';
import { 
  ChartBubble,
  User,
  Monitor,
  Clock,
  Crown,
} from '@strapi/icons';
import pluginId from '../pluginId';
import { useLicense } from '../hooks/useLicense';

// ================ THEME ================
const theme = {
  colors: {
    primary: { 50: '#F0F9FF', 100: '#E0F2FE', 500: '#0EA5E9', 600: '#0284C7', 700: '#0369A1' },
    secondary: { 50: '#F5F3FF', 100: '#EDE9FE', 500: '#A855F7', 600: '#9333EA' },
    success: { 50: '#DCFCE7', 100: '#DCFCE7', 500: '#22C55E', 600: '#16A34A', 700: '#15803D' },
    warning: { 50: '#FEF3C7', 100: '#FEF3C7', 500: '#F59E0B', 600: '#D97706' },
    danger: { 50: '#FEE2E2', 100: '#FEE2E2', 500: '#EF4444', 600: '#DC2626' },
    neutral: { 0: '#FFFFFF', 50: '#F9FAFB', 100: '#F3F4F6', 200: '#E5E7EB', 600: '#4B5563', 700: '#374151', 800: '#1F2937' }
  },
  shadows: {
    sm: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
  },
  transitions: {
    fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
    normal: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
    slow: '500ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  spacing: { xl: '32px', '2xl': '48px' },
  borderRadius: { lg: '12px', xl: '16px' },
};

// ================ ANIMATIONS ================
const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
`;

const slideIn = keyframes`
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
`;

const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`;

const float = keyframes`
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-8px); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.8; }
`;

const growBar = keyframes`
  from { width: 0; }
  to { width: var(--bar-width); }
`;

// ================ STYLED COMPONENTS ================
const Container = styled(Box)`
  animation: ${fadeIn} 0.6s;
  min-height: 100vh;
  max-width: 1440px;
  margin: 0 auto;
  padding: ${theme.spacing.xl} 24px 0;
`;

const Header = styled(Box)`
  background: linear-gradient(135deg, ${theme.colors.primary[600]} 0%, ${theme.colors.secondary[600]} 100%);
  border-radius: ${theme.borderRadius.xl};
  padding: ${theme.spacing.xl} ${theme.spacing['2xl']};
  margin-bottom: ${theme.spacing.xl};
  position: relative;
  overflow: hidden;
  box-shadow: ${theme.shadows.xl};
  
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 200%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.15), transparent);
    animation: ${shimmer} 3s infinite;
  }
  
  &::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 100%;
    height: 100%;
    background-image: radial-gradient(circle at 20% 80%, transparent 50%, rgba(255, 255, 255, 0.1) 50%);
    background-size: 15px 15px;
    opacity: 0.3;
  }
`;

const HeaderContent = styled(Flex)`
  position: relative;
  z-index: 1;
`;

const Title = styled(Typography)`
  color: ${theme.colors.neutral[0]};
  font-size: 2.25rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 8px;
  
  svg {
    width: 32px;
    height: 32px;
    animation: ${float} 3s ease-in-out infinite;
  }
`;

const Subtitle = styled(Typography)`
  color: rgba(255, 255, 255, 0.95);
  font-size: 1rem;
  font-weight: 400;
  letter-spacing: 0.01em;
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 24px;
  margin-bottom: 40px;
`;

const StatCard = styled(Box)`
  background: ${theme.colors.neutral[0]};
  border-radius: ${theme.borderRadius.lg};
  padding: 32px;
  position: relative;
  overflow: hidden;
  transition: all ${theme.transitions.normal};
  animation: ${fadeIn} ${theme.transitions.slow} backwards;
  animation-delay: ${props => props.$delay || '0s'};
  box-shadow: ${theme.shadows.sm};
  border: 1px solid ${theme.colors.neutral[200]};
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  
  &:hover {
    transform: translateY(-6px);
    box-shadow: ${theme.shadows.xl};
    border-color: ${props => props.$borderColor || theme.colors.primary[500]};
    
    .stat-icon {
      transform: scale(1.15) rotate(5deg);
    }
    
    .stat-value {
      transform: scale(1.08);
      color: ${props => props.$accentColor || theme.colors.primary[600]};
    }
  }
`;

const StatIcon = styled(Box)`
  width: 80px;
  height: 80px;
  border-radius: ${theme.borderRadius.lg};
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${props => props.$bg || theme.colors.primary[100]};
  transition: all ${theme.transitions.normal};
  margin: 0 auto 24px;
  box-shadow: ${theme.shadows.sm};
  
  svg {
    width: 40px;
    height: 40px;
    color: ${props => props.$color || theme.colors.primary[600]};
  }
`;

const StatValue = styled(Typography)`
  font-size: 3.5rem;
  font-weight: 700;
  color: ${theme.colors.neutral[800]};
  line-height: 1;
  margin-bottom: 12px;
  transition: all ${theme.transitions.normal};
  text-align: center;
`;

const StatLabel = styled(Typography)`
  font-size: 1rem;
  color: ${theme.colors.neutral[600]};
  font-weight: 500;
  text-align: center;
`;

const ChartCard = styled(Box)`
  background: ${theme.colors.neutral[0]};
  border-radius: ${theme.borderRadius.lg};
  padding: 36px;
  box-shadow: ${theme.shadows.md};
  border: 1px solid ${theme.colors.neutral[200]};
  margin-bottom: 28px;
  animation: ${slideIn} ${theme.transitions.slow};
  transition: all ${theme.transitions.normal};
  
  &:hover {
    box-shadow: ${theme.shadows.lg};
    border-color: ${theme.colors.primary[200]};
  }
`;

const ChartTitle = styled(Typography)`
  font-size: 1.25rem;
  font-weight: 700;
  color: ${theme.colors.neutral[800]};
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  
  svg {
    width: 24px;
    height: 24px;
    color: ${theme.colors.primary[600]};
  }
`;

const BarChart = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const BarRow = styled.div`
  display: flex;
  align-items: center;
  gap: 20px;
  animation: ${fadeIn} 0.6s backwards;
  animation-delay: ${props => props.$delay || '0s'};
`;

const BarLabel = styled(Typography)`
  min-width: 110px;
  font-size: 15px;
  font-weight: 600;
  color: ${theme.colors.neutral[700]};
`;

const BarContainer = styled.div`
  flex: 1;
  height: 40px;
  background: ${theme.colors.neutral[100]};
  border-radius: 10px;
  overflow: hidden;
  position: relative;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.06);
`;

const BarFill = styled.div`
  height: 100%;
  background: linear-gradient(90deg, ${props => props.$color1 || theme.colors.primary[500]}, ${props => props.$color2 || theme.colors.primary[600]});
  border-radius: 10px;
  --bar-width: ${props => props.$percentage || 0}%;
  animation: ${growBar} 1s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  animation-delay: ${props => props.$delay || '0s'};
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
`;

const BarValue = styled(Typography)`
  color: white;
  font-size: 15px;
  font-weight: 700;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
`;

const LoadingOverlay = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  gap: 24px;
  
  .loader-icon {
    animation: ${pulse} 2s ease-in-out infinite;
  }
`;

const AnalyticsPage = () => {
  const { get } = useFetchClient();
  const { isPremium, loading: licenseLoading } = useLicense();
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState(null);

  useEffect(() => {
    if (!licenseLoading) {
      fetchAnalytics();
    }
  }, [licenseLoading]);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const { data } = await get(`/${pluginId}/sessions`);
      const sessions = data.data || [];
      
      const now = Date.now();
      const dayAgo = now - (24 * 60 * 60 * 1000);
      const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
      
      const todayLogins = sessions.filter(s => new Date(s.loginTime).getTime() > dayAgo);
      const weekLogins = sessions.filter(s => new Date(s.loginTime).getTime() > weekAgo);
      
      const devices = {};
      const browsers = {};
      const operatingSystems = {};
      const countries = {};
      const loginHours = Array(24).fill(0);
      const uniqueUsers = new Set();
      const uniqueIPs = new Set();
      
      sessions.forEach(session => {
        const ua = session.userAgent.toLowerCase();
        
        // Devices
        if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
          devices['Mobile'] = (devices['Mobile'] || 0) + 1;
        } else if (ua.includes('tablet') || ua.includes('ipad')) {
          devices['Tablet'] = (devices['Tablet'] || 0) + 1;
        } else {
          devices['Desktop'] = (devices['Desktop'] || 0) + 1;
        }
        
        // Browsers
        if (ua.includes('chrome') && !ua.includes('edg')) browsers['Chrome'] = (browsers['Chrome'] || 0) + 1;
        else if (ua.includes('firefox')) browsers['Firefox'] = (browsers['Firefox'] || 0) + 1;
        else if (ua.includes('safari') && !ua.includes('chrome')) browsers['Safari'] = (browsers['Safari'] || 0) + 1;
        else if (ua.includes('edg')) browsers['Edge'] = (browsers['Edge'] || 0) + 1;
        else if (ua.includes('postman') || ua.includes('curl')) browsers['API Client'] = (browsers['API Client'] || 0) + 1;
        else browsers['Other'] = (browsers['Other'] || 0) + 1;
        
        // Operating Systems
        if (ua.includes('windows') || ua.includes('win32') || ua.includes('win64')) {
          operatingSystems['Windows'] = (operatingSystems['Windows'] || 0) + 1;
        } else if (ua.includes('mac') || ua.includes('darwin')) {
          operatingSystems['macOS'] = (operatingSystems['macOS'] || 0) + 1;
        } else if (ua.includes('linux')) {
          operatingSystems['Linux'] = (operatingSystems['Linux'] || 0) + 1;
        } else if (ua.includes('android')) {
          operatingSystems['Android'] = (operatingSystems['Android'] || 0) + 1;
        } else if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) {
          operatingSystems['iOS'] = (operatingSystems['iOS'] || 0) + 1;
        } else {
          operatingSystems['Other'] = (operatingSystems['Other'] || 0) + 1;
        }
        
        // Login Hours (24h distribution)
        const loginHour = new Date(session.loginTime).getHours();
        loginHours[loginHour]++;
        
        // Unique tracking
        if (session.user?.id) uniqueUsers.add(session.user.id);
        if (session.ipAddress) uniqueIPs.add(session.ipAddress);
      });
      
      // Calculate peak hour
      const peakHour = loginHours.indexOf(Math.max(...loginHours));
      
      // Calculate logout vs timeout ratio
      const loggedOut = sessions.filter(s => !s.isActive && s.logoutTime).length;
      const terminated = sessions.filter(s => !s.isActive && !s.logoutTime).length;
      
      // Calculate mobile vs desktop ratio
      const mobileCount = (devices['Mobile'] || 0) + (devices['Tablet'] || 0);
      const desktopCount = devices['Desktop'] || 0;
      const mobileRatio = sessions.length > 0 ? Math.round((mobileCount / sessions.length) * 100) : 0;
      
      setAnalytics({
        totalSessions: sessions.length,
        activeSessions: sessions.filter(s => s.isActive && s.isTrulyActive).length,
        todayLogins: todayLogins.length,
        weekLogins: weekLogins.length,
        devices,
        browsers,
        operatingSystems,
        loginHours,
        peakHour,
        uniqueUsers: uniqueUsers.size,
        uniqueIPs: uniqueIPs.size,
        loggedOut,
        terminated,
        mobileRatio,
        avgSessionDuration: sessions.length > 0 
          ? Math.floor(sessions.reduce((sum, s) => sum + (s.minutesSinceActive || 0), 0) / sessions.length)
          : 0,
      });
    } catch (err) {
      console.error('[Analytics] Error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Loading state während License-Check
  if (licenseLoading) {
    return (
      <Container>
        <LoadingOverlay>
          <ChartBubble className="loader-icon" style={{ width: '64px', height: '64px', color: theme.colors.primary[600] }} />
          <Loader>Checking license...</Loader>
          <Typography variant="pi" textColor="neutral600">
            Please wait while we verify your premium access
          </Typography>
        </LoadingOverlay>
      </Container>
    );
  }

  // Upgrade Screen für Free-User
  if (!isPremium) {
    return (
      <Container>
        <Box padding={8}>
          <Box
            padding={10}
            style={{
              background: 'linear-gradient(135deg, #fef3c7 0%, #fed7aa 100%)',
              borderRadius: '20px',
              border: '3px solid #fbbf24',
              textAlign: 'center',
              boxShadow: '0 20px 40px rgba(245, 158, 11, 0.2)',
              maxWidth: '800px',
              margin: '60px auto',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Background Pattern */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundImage: 'radial-gradient(circle at 20% 80%, transparent 50%, rgba(255, 255, 255, 0.1) 50%)',
              backgroundSize: '20px 20px',
              opacity: 0.5,
              zIndex: 0,
            }} />
            
            <div style={{ position: 'relative', zIndex: 1 }}>
              <Crown style={{ 
                width: '96px', 
                height: '96px', 
                color: '#d97706', 
                margin: '0 auto 32px',
                display: 'block',
                animation: `${float} 3s ease-in-out infinite`,
              }} />
              
              <Typography 
                variant="alpha" 
                style={{ 
                  color: '#92400e', 
                  fontWeight: '700', 
                  marginBottom: '24px', 
                  fontSize: '36px',
                  display: 'block',
                  textShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                }}
              >
                📊 Analytics Dashboard
              </Typography>
              
              <Typography 
                variant="omega" 
                style={{ 
                  color: '#78350f', 
                  lineHeight: '1.9', 
                  marginBottom: '44px', 
                  fontSize: '17px',
                  display: 'block',
                  maxWidth: '620px',
                  margin: '0 auto 44px',
                }}
              >
                Unlock premium analytics to get powerful insights about your user sessions, device statistics, browser trends, and activity patterns
              </Typography>
              
              <button
                onClick={() => window.open('https://magicapi.fitlex.me', '_blank')}
                style={{
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  color: 'white',
                  border: 'none',
                  padding: '16px 48px',
                  borderRadius: '12px',
                  fontSize: '17px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  boxShadow: '0 6px 16px rgba(245, 158, 11, 0.4)',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-3px) scale(1.05)';
                  e.currentTarget.style.boxShadow = '0 12px 24px rgba(245, 158, 11, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0) scale(1)';
                  e.currentTarget.style.boxShadow = '0 6px 16px rgba(245, 158, 11, 0.4)';
                }}
              >
                ✨ Upgrade to Premium
              </button>
            </div>
          </Box>
        </Box>
      </Container>
    );
  }

  // Loading analytics data
  if (loading) {
    return (
      <Container>
        <LoadingOverlay>
          <ChartBubble className="loader-icon" style={{ width: '64px', height: '64px', color: theme.colors.primary[600] }} />
          <Loader>Loading analytics data...</Loader>
        </LoadingOverlay>
      </Container>
    );
  }

  const maxDevices = Math.max(...Object.values(analytics?.devices || {}), 1);
  const maxBrowsers = Math.max(...Object.values(analytics?.browsers || {}), 1);
  const maxOS = Math.max(...Object.values(analytics?.operatingSystems || {}), 1);
  const maxLoginHour = Math.max(...(analytics?.loginHours || []), 1);

  const deviceColors = {
    'Desktop': [theme.colors.primary[500], theme.colors.primary[600]],
    'Mobile': [theme.colors.success[500], theme.colors.success[600]],
    'Tablet': [theme.colors.warning[500], theme.colors.warning[600]],
  };

  const browserColors = {
    'Chrome': [theme.colors.success[500], theme.colors.success[600]],
    'Firefox': [theme.colors.warning[500], theme.colors.warning[600]],
    'Safari': [theme.colors.primary[500], theme.colors.primary[600]],
    'Edge': [theme.colors.secondary[500], theme.colors.secondary[600]],
    'API Client': [theme.colors.neutral[600], theme.colors.neutral[700]],
    'Other': [theme.colors.neutral[500], theme.colors.neutral[600]],
  };

  return (
    <Container>
      {/* Gradient Header */}
      <Header>
        <HeaderContent direction="column" alignItems="flex-start" gap={2}>
          <Title>
            <ChartBubble /> Session Analytics
          </Title>
          <Subtitle>
            Comprehensive insights and statistics about user sessions
          </Subtitle>
        </HeaderContent>
      </Header>

      {/* Overview Stats */}
      <StatsGrid>
        <StatCard $delay="0.1s" $borderColor={theme.colors.primary[500]} $accentColor={theme.colors.primary[600]}>
          <StatIcon className="stat-icon" $bg={theme.colors.primary[100]} $color={theme.colors.primary[600]}>
            <ChartBubble />
          </StatIcon>
          <StatValue className="stat-value">{analytics?.totalSessions || 0}</StatValue>
          <StatLabel>Total Sessions</StatLabel>
        </StatCard>

        <StatCard $delay="0.2s" $borderColor={theme.colors.success[500]} $accentColor={theme.colors.success[600]}>
          <StatIcon className="stat-icon" $bg={theme.colors.success[100]} $color={theme.colors.success[600]}>
            <User />
          </StatIcon>
          <StatValue className="stat-value">{analytics?.activeSessions || 0}</StatValue>
          <StatLabel>Active Now</StatLabel>
        </StatCard>

        <StatCard $delay="0.3s" $borderColor={theme.colors.warning[500]} $accentColor={theme.colors.warning[600]}>
          <StatIcon className="stat-icon" $bg={theme.colors.warning[100]} $color={theme.colors.warning[600]}>
            <Clock />
          </StatIcon>
          <StatValue className="stat-value">{analytics?.todayLogins || 0}</StatValue>
          <StatLabel>Today's Logins</StatLabel>
        </StatCard>

        <StatCard $delay="0.4s" $borderColor={theme.colors.secondary[500]} $accentColor={theme.colors.secondary[600]}>
          <StatIcon className="stat-icon" $bg={theme.colors.secondary[100]} $color={theme.colors.secondary[600]}>
            <Clock />
          </StatIcon>
          <StatValue className="stat-value">{analytics?.weekLogins || 0}</StatValue>
          <StatLabel>This Week</StatLabel>
        </StatCard>
      </StatsGrid>

      {/* Charts Row */}
      <Flex gap={4} wrap="wrap" style={{ marginBottom: '28px' }}>
        {/* Devices Chart */}
        <Box style={{ flex: 1, minWidth: '450px' }}>
          <ChartCard>
            <ChartTitle>
              <Monitor />
              Device Distribution
            </ChartTitle>
            <BarChart>
              {analytics?.devices && Object.entries(analytics.devices)
                .sort(([, a], [, b]) => b - a)
                .map(([device, count], idx) => (
                  <BarRow key={device} $delay={`${0.5 + idx * 0.1}s`}>
                    <BarLabel>{device}</BarLabel>
                    <BarContainer>
                      <BarFill 
                        $percentage={(count / maxDevices) * 100}
                        $color1={deviceColors[device]?.[0] || theme.colors.neutral[500]}
                        $color2={deviceColors[device]?.[1] || theme.colors.neutral[600]}
                        $delay={`${0.5 + idx * 0.1}s`}
                      >
                        <BarValue>{count}</BarValue>
                      </BarFill>
                    </BarContainer>
                  </BarRow>
                ))}
            </BarChart>
          </ChartCard>
        </Box>

        {/* Browsers Chart */}
        <Box style={{ flex: 1, minWidth: '450px' }}>
          <ChartCard>
            <ChartTitle>
              <Monitor />
              Browser Usage
            </ChartTitle>
            <BarChart>
              {analytics?.browsers && Object.entries(analytics.browsers)
                .sort(([, a], [, b]) => b - a)
                .map(([browser, count], idx) => (
                  <BarRow key={browser} $delay={`${0.5 + idx * 0.1}s`}>
                    <BarLabel>{browser}</BarLabel>
                    <BarContainer>
                      <BarFill 
                        $percentage={(count / maxBrowsers) * 100}
                        $color1={browserColors[browser]?.[0] || theme.colors.neutral[500]}
                        $color2={browserColors[browser]?.[1] || theme.colors.neutral[600]}
                        $delay={`${0.5 + idx * 0.1}s`}
                      >
                        <BarValue>{count}</BarValue>
                      </BarFill>
                    </BarContainer>
                  </BarRow>
                ))}
            </BarChart>
          </ChartCard>
        </Box>
      </Flex>

      {/* Average Session Duration */}
      <ChartCard>
        <Flex alignItems="center" justifyContent="space-between">
          <ChartTitle style={{ marginBottom: 0 }}>
            <Clock />
            Average Session Duration
          </ChartTitle>
          <Badge 
            backgroundColor="primary600" 
            textColor="neutral0"
            style={{ 
              fontSize: '18px', 
              fontWeight: '700', 
              padding: '12px 24px',
              boxShadow: theme.shadows.md,
            }}
          >
            {analytics?.avgSessionDuration || 0} minutes
          </Badge>
        </Flex>
        
        {analytics?.avgSessionDuration > 0 && (
          <Box marginTop={5} padding={5} background="primary50" hasRadius style={{ border: `1px solid ${theme.colors.primary[100]}` }}>
            <Typography variant="omega" textColor="primary700" style={{ fontSize: '14px', lineHeight: '1.8', fontWeight: '500' }}>
              ℹ️ Average time between login and last activity across all sessions. 
              Lower values indicate more frequent activity, higher values may indicate idle or abandoned sessions.
            </Typography>
          </Box>
        )}
      </ChartCard>
    </Container>
  );
};

export default AnalyticsPage;
