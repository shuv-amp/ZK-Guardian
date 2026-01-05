export const COLORS = {
  primary: '#4F46E5', // Indigo 600
  primaryDark: '#3730A3', // Indigo 800
  primaryLight: '#E0E7FF', // Indigo 100
  secondary: '#0EA5E9', // Sky 500
  background: '#F8FAFC', // Slate 50
  surface: '#FFFFFF',
  text: '#0F172A', // Slate 900
  textSecondary: '#64748B', // Slate 500
  textTertiary: '#94A3B8', // Slate 400
  textLight: '#94A3B8', // Slate 400
  border: '#E2E8F0', // Slate 200
  success: '#10B981', // Emerald 500
  successBg: '#ECFDF5', // Emerald 50
  error: '#EF4444', // Red 500
  errorBg: '#FEF2F2', // Red 50
  warning: '#F59E0B', // Amber 500
  warningBg: '#FFFBEB', // Amber 50
  info: '#3B82F6', // Blue 500
  infoBg: '#EFF6FF', // Blue 50
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
};

export const SHADOWS = {
  sm: {
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  // Aliases for backward compatibility
  small: {
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  medium: {
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  large: {
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  // Aliases
  s: 8,
  m: 16,
  l: 24,
};

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
  // Aliases
  s: 8,
  m: 12,
  l: 16,
};

export const FONTS = {
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
  sizes: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    xxxl: 30,
  },
  // Legacy/Direct access
  regular: { fontWeight: '400' as const },
  medium: { fontWeight: '500' as const },
  semibold: { fontWeight: '600' as const },
  bold: { fontWeight: '700' as const },
};
