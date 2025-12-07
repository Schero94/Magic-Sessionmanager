/**
 * Theme Utilities for Dark Mode Support
 * 
 * IMPORTANT: For Dark Mode to work properly, use props.theme in styled-components:
 * 
 * Example:
 *   background: ${props => props.theme.colors.neutral0};
 *   color: ${props => props.theme.colors.neutral800};
 *   border: 1px solid ${props => props.theme.colors.neutral200};
 * 
 * Strapi's ThemeProvider automatically switches these values between Light and Dark mode.
 * 
 * Use the static `theme` object below ONLY for:
 * - Gradients (which don't change between light/dark)
 * - Shadows
 * - Spacing
 * - Border radius
 * - Transitions
 */

// Static design tokens (for non-theme-dependent values)
export const theme = {
  colors: {
    primary: {
      50: '#F0F9FF',
      100: '#E0F2FE',
      200: '#BAE6FD',
      500: '#0EA5E9',
      600: '#0284C7',
      700: '#0369A1',
    },
    secondary: {
      50: '#FAF5FF',
      100: '#F3E8FF',
      500: '#A855F7',
      600: '#9333EA',
    },
    success: {
      50: '#F0FDF4',
      100: '#DCFCE7',
      500: '#22C55E',
      600: '#16A34A',
      700: '#15803D',
    },
    warning: {
      50: '#FFFBEB',
      100: '#FEF3C7',
      500: '#F59E0B',
      600: '#D97706',
    },
    danger: {
      50: '#FEF2F2',
      100: '#FEE2E2',
      500: '#EF4444',
      600: '#DC2626',
    },
  },
  shadows: {
    sm: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
  },
  transitions: {
    fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
    normal: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
    slow: '500ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    '2xl': '48px',
  },
  borderRadius: {
    sm: '6px',
    md: '8px',
    lg: '12px',
    xl: '16px',
  }
};

export default theme;
