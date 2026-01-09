/**
 * @zk-guardian/react
 * 
 * React hooks and components for ZK Guardian consent verification.
 * 
 * Features:
 * - Context provider for SDK configuration
 * - Hooks for consent, audit logs, and proof generation
 * - Real-time WebSocket updates
 * - TypeScript first
 */

// Context
export { ZKGuardianProvider, useZKGuardian } from './context/ZKGuardianProvider';

// Hooks
export { useConsent } from './hooks/useConsent';
export { useAuditLog } from './hooks/useAuditLog';
export { useConsentRequest } from './hooks/useConsentRequest';
export { useBreakGlass } from './hooks/useBreakGlass';

// Types
export type {
    ZKGuardianConfig,
    ConsentState,
    ConsentRequest,
    AuditLogEntry,
    BreakGlassSession
} from './types';
