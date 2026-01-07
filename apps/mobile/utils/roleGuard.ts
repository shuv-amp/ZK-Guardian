/**
 * Role Guard Utility
 * 
 * Route protection based on user roles.
 * Per Development Guide §1.
 * 
 * Features:
 * - Patient vs Clinician role detection
 * - Route access control
 * - Role-based redirects
 */

import { router, Href } from 'expo-router';
import { smartAuth } from '../services/SMARTAuthService';

export type UserRole = 'patient' | 'clinician' | 'admin' | 'unknown';

export interface RoleInfo {
    role: UserRole;
    id: string | null;
    displayName?: string;
}

/**
 * Get the current user's role from SMART context
 */
export async function getCurrentRole(): Promise<RoleInfo> {
    try {
        const patientId = await smartAuth.getPatientId();
        const practitionerId = await smartAuth.getPractitionerId();

        if (patientId) {
            return {
                role: 'patient',
                id: patientId
            };
        }

        if (practitionerId) {
            return {
                role: 'clinician',
                id: practitionerId
            };
        }

        return {
            role: 'unknown',
            id: null
        };
    } catch (error) {
        console.error('[RoleGuard] Failed to get role:', error);
        return {
            role: 'unknown',
            id: null
        };
    }
}

/**
 * Check if user has the required role
 */
export async function hasRole(requiredRole: UserRole | UserRole[]): Promise<boolean> {
    const { role } = await getCurrentRole();

    if (Array.isArray(requiredRole)) {
        return requiredRole.includes(role);
    }

    return role === requiredRole;
}

/**
 * Redirect if user doesn't have the required role
 */
export async function requireRole(
    requiredRole: UserRole | UserRole[],
    redirectTo: string = '/'
): Promise<boolean> {
    const hasRequiredRole = await hasRole(requiredRole);

    if (!hasRequiredRole) {
        console.log('[RoleGuard] Access denied, redirecting to:', redirectTo);
        router.replace(redirectTo as Href);
        return false;
    }

    return true;
}

/**
 * Patient-only route guard
 */
export async function requirePatient(redirectTo: string = '/clinician'): Promise<boolean> {
    return requireRole('patient', redirectTo);
}

/**
 * Clinician-only route guard
 */
export async function requireClinician(redirectTo: string = '/patient'): Promise<boolean> {
    return requireRole('clinician', redirectTo);
}

/**
 * Any authenticated user guard
 */
export async function requireAuthenticated(redirectTo: string = '/login'): Promise<boolean> {
    const isAuthenticated = smartAuth.isAuthenticated();

    if (!isAuthenticated) {
        console.log('[RoleGuard] Not authenticated, redirecting to:', redirectTo);
        router.replace(redirectTo as Href);
        return false;
    }

    return true;
}

/**
 * Route definitions by role
 */
export const ROLE_ROUTES = {
    patient: {
        home: '/patient',
        consents: '/patient/consents',
        accessHistory: '/patient/access-history',
        alerts: '/patient/alerts',
        settings: '/patient/settings'
    },
    clinician: {
        home: '/clinician',
        patients: '/clinician/patients',
        accessRequest: '/clinician/access-request',
        breakGlass: '/clinician/break-glass',
        settings: '/clinician/settings'
    },
    shared: {
        login: '/login',
        profile: '/profile',
        about: '/about'
    }
} as const;

/**
 * Get home route for current role
 */
export async function getHomeRoute(): Promise<string> {
    const { role } = await getCurrentRole();

    switch (role) {
        case 'patient':
            return ROLE_ROUTES.patient.home;
        case 'clinician':
            return ROLE_ROUTES.clinician.home;
        default:
            return ROLE_ROUTES.shared.login;
    }
}

/**
 * Navigate to role-appropriate home
 */
export async function navigateToHome(): Promise<void> {
    const homeRoute = await getHomeRoute();
    router.replace(homeRoute as Href);
}

/**
 * Role-based access control configuration
 */
export const ACCESS_CONTROL: Record<string, UserRole[]> = {
    // Patient routes
    '/patient': ['patient'],
    '/patient/consents': ['patient'],
    '/patient/access-history': ['patient'],
    '/patient/alerts': ['patient'],

    // Clinician routes
    '/clinician': ['clinician'],
    '/clinician/patients': ['clinician'],
    '/clinician/access-request': ['clinician'],
    '/clinician/break-glass': ['clinician'],

    // Shared routes (any authenticated)
    '/profile': ['patient', 'clinician', 'admin'],
    '/settings': ['patient', 'clinician', 'admin']
};

/**
 * Check if route is accessible for current user
 */
export async function canAccessRoute(routePath: string): Promise<boolean> {
    const allowedRoles = ACCESS_CONTROL[routePath];

    if (!allowedRoles) {
        // Route not in ACL = public
        return true;
    }

    return hasRole(allowedRoles);
}
