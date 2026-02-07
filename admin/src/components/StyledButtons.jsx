/**
 * Styled Button Components for Magic SessionManager
 * Consistent button styling across all pages
 */
import styled from 'styled-components';
import { Button } from '@strapi/design-system';

// ================ PRIMARY GRADIENT BUTTON ================
export const GradientButton = styled(Button)`
  && {
    background: linear-gradient(135deg, #0EA5E9 0%, #A855F7 100%);
    color: white;
    font-weight: 600;
    border: none;
    padding: 10px 20px;
    min-height: 40px;
    transition: all 0.2s ease;
    
    &:hover:not(:disabled) {
      background: linear-gradient(135deg, #0284C7 0%, #9333EA 100%);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);
    }
    
    &:active:not(:disabled) {
      transform: translateY(0);
    }
    
    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
`;

// ================ SECONDARY BUTTON (Gradient Outline) ================
export const SecondaryButton = styled(Button)`
  && {
    background: var(--colors-neutral0, white);
    color: var(--colors-secondary600, #7C3AED);
    font-weight: 600;
    border: 2px solid transparent;
    background-image: linear-gradient(var(--colors-neutral0, white), var(--colors-neutral0, white)), linear-gradient(135deg, #0EA5E9 0%, #A855F7 100%);
    background-origin: border-box;
    background-clip: padding-box, border-box;
    padding: 10px 20px;
    min-height: 40px;
    transition: all 0.2s ease;
    
    &:hover:not(:disabled) {
      background: linear-gradient(135deg, #0EA5E9 0%, #A855F7 100%);
      background-clip: padding-box;
      color: white;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(168, 85, 247, 0.3);
    }
    
    &:active:not(:disabled) {
      transform: translateY(0);
    }
    
    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
`;

// ================ TERTIARY/GHOST BUTTON ================
export const TertiaryButton = styled(Button)`
  && {
    background: transparent;
    color: var(--colors-neutral600);
    font-weight: 500;
    border: 1px solid rgba(128, 128, 128, 0.2);
    padding: 10px 20px;
    min-height: 40px;
    transition: all 0.2s ease;
    
    &:hover:not(:disabled) {
      background: rgba(128, 128, 128, 0.08);
      border-color: rgba(128, 128, 128, 0.3);
      color: var(--colors-neutral800);
    }
    
    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
`;

// ================ DANGER BUTTON ================
export const DangerButton = styled(Button)`
  && {
    background: rgba(220, 38, 38, 0.12);
    color: var(--colors-danger600, #DC2626);
    font-weight: 600;
    border: 1px solid rgba(239, 68, 68, 0.4);
    padding: 10px 20px;
    min-height: 40px;
    transition: all 0.2s ease;
    
    &:hover:not(:disabled) {
      background: var(--colors-danger600, #DC2626);
      color: white;
      border-color: var(--colors-danger600, #DC2626);
    }
    
    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
`;

// ================ SUCCESS BUTTON ================
export const SuccessButton = styled(Button)`
  && {
    background: linear-gradient(135deg, #10B981 0%, #059669 100%);
    color: white;
    font-weight: 600;
    border: none;
    padding: 10px 20px;
    min-height: 40px;
    transition: all 0.2s ease;
    
    &:hover:not(:disabled) {
      background: linear-gradient(135deg, #059669 0%, #047857 100%);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
    }
    
    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
`;

// ================ ICON BUTTON (Small, for actions) ================
export const IconButton = styled(Button)`
  && {
    background: linear-gradient(135deg, rgba(128, 128, 128, 0.04) 0%, rgba(128, 128, 128, 0.08) 100%);
    color: var(--colors-neutral600);
    border: 1px solid rgba(128, 128, 128, 0.2);
    padding: 8px;
    min-width: 38px;
    min-height: 38px;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    
    svg {
      width: 18px;
      height: 18px;
    }
    
    &:hover:not(:disabled) {
      background: linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%);
      border-color: var(--colors-primary600, #0EA5E9);
      color: white;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(14, 165, 233, 0.25);
    }
    
    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
`;

// ================ ICON BUTTON DANGER ================
export const IconButtonDanger = styled(Button)`
  && {
    background: linear-gradient(135deg, rgba(220, 38, 38, 0.06) 0%, rgba(220, 38, 38, 0.12) 100%);
    color: var(--colors-danger600, #EF4444);
    border: 1px solid rgba(239, 68, 68, 0.4);
    padding: 8px;
    min-width: 38px;
    min-height: 38px;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    
    svg {
      width: 18px;
      height: 18px;
    }
    
    &:hover:not(:disabled) {
      background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%);
      border-color: var(--colors-danger600, #EF4444);
      color: white;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
    }
    
    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
`;

// ================ ICON BUTTON PRIMARY ================
export const IconButtonPrimary = styled(Button)`
  && {
    background: linear-gradient(135deg, rgba(2, 132, 199, 0.06) 0%, rgba(2, 132, 199, 0.12) 100%);
    color: var(--colors-primary600, #0EA5E9);
    border: 1px solid rgba(14, 165, 233, 0.3);
    padding: 8px;
    min-width: 38px;
    min-height: 38px;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    
    svg {
      width: 18px;
      height: 18px;
    }
    
    &:hover:not(:disabled) {
      background: linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%);
      border-color: var(--colors-primary600, #0EA5E9);
      color: white;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);
    }
    
    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
`;

// ================ ICON BUTTON SUCCESS ================
export const IconButtonSuccess = styled(Button)`
  && {
    background: linear-gradient(135deg, rgba(22, 163, 74, 0.06) 0%, rgba(22, 163, 74, 0.12) 100%);
    color: var(--colors-success600, #22C55E);
    border: 1px solid rgba(34, 197, 94, 0.3);
    padding: 8px;
    min-width: 38px;
    min-height: 38px;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    
    svg {
      width: 18px;
      height: 18px;
    }
    
    &:hover:not(:disabled) {
      background: linear-gradient(135deg, #22C55E 0%, #16A34A 100%);
      border-color: var(--colors-success600, #22C55E);
      color: white;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
    }
    
    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
`;

// ================ ICON BUTTON WARNING (for terminate/logout) ================
export const IconButtonWarning = styled(Button)`
  && {
    background: linear-gradient(135deg, rgba(234, 179, 8, 0.06) 0%, rgba(234, 179, 8, 0.12) 100%);
    color: var(--colors-warning600, #D97706);
    border: 1px solid rgba(234, 179, 8, 0.4);
    padding: 8px;
    min-width: 38px;
    min-height: 38px;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    
    svg {
      width: 18px;
      height: 18px;
    }
    
    &:hover:not(:disabled) {
      background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);
      border-color: var(--colors-warning600, #F59E0B);
      color: white;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
    }
    
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      background: var(--colors-neutral100);
      border-color: rgba(128, 128, 128, 0.2);
      color: var(--colors-neutral500);
    }
  }
`;

// ================ LARGE CTA BUTTON ================
export const CTAButton = styled(Button)`
  && {
    background: linear-gradient(135deg, #0EA5E9 0%, #A855F7 100%);
    color: white;
    font-weight: 700;
    font-size: 1rem;
    border: none;
    padding: 14px 28px;
    min-height: 52px;
    border-radius: 12px;
    transition: all 0.2s ease;
    box-shadow: 0 4px 14px rgba(14, 165, 233, 0.25);
    
    &:hover:not(:disabled) {
      background: linear-gradient(135deg, #0284C7 0%, #9333EA 100%);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(14, 165, 233, 0.35);
    }
    
    &:active:not(:disabled) {
      transform: translateY(0);
    }
    
    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
`;

// ================ LINK STYLE BUTTON ================
export const LinkButton = styled(Button)`
  && {
    background: transparent;
    color: var(--colors-primary600, #0EA5E9);
    font-weight: 500;
    border: none;
    padding: 4px 8px;
    min-height: auto;
    text-decoration: underline;
    transition: all 0.2s ease;
    
    &:hover:not(:disabled) {
      color: var(--colors-primary600, #0284C7);
      text-decoration: none;
    }
    
    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
`;

// ================ SHOW/HIDE BUTTON ================
export const ShowHideButton = styled(Button)`
  && {
    background: linear-gradient(135deg, rgba(128, 128, 128, 0.04) 0%, rgba(128, 128, 128, 0.08) 100%);
    color: var(--colors-neutral600);
    font-weight: 600;
    border: 1px solid rgba(128, 128, 128, 0.2);
    padding: 10px 16px;
    min-height: 40px;
    border-radius: 8px;
    transition: all 0.2s ease;
    
    &:hover:not(:disabled) {
      background: linear-gradient(135deg, rgba(128, 128, 128, 0.15) 0%, rgba(128, 128, 128, 0.25) 100%);
      color: var(--colors-neutral800);
      transform: translateY(-1px);
    }
    
    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
`;

// ================ COPY BUTTON (for clipboard actions) ================
export const CopyButton = styled(Button)`
  && {
    background: linear-gradient(135deg, rgba(2, 132, 199, 0.06) 0%, rgba(2, 132, 199, 0.12) 100%);
    color: var(--colors-primary600, #0284C7);
    font-weight: 600;
    border: 1px solid rgba(14, 165, 233, 0.3);
    padding: 10px 16px;
    min-height: 40px;
    border-radius: 8px;
    transition: all 0.2s ease;
    
    &:hover:not(:disabled) {
      background: linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%);
      color: white;
      border-color: var(--colors-primary600, #0EA5E9);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(14, 165, 233, 0.25);
    }
    
    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
`;
