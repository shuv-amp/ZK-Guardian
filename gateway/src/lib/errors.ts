/**
 * Custom Error Classes for ZK Guardian
 * 
 * Structured errors with codes for consistent API responses.
 */

export abstract class AppError extends Error {
    abstract readonly code: string;
    abstract readonly statusCode: number;
    readonly isOperational: boolean = true;

    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }

    toJSON() {
        return {
            error: this.code,
            message: this.message,
            statusCode: this.statusCode
        };
    }
}

// Authentication Errors

export class AuthenticationError extends AppError {
    readonly code = 'AUTHENTICATION_FAILED';
    readonly statusCode = 401;
}

export class AuthorizationError extends AppError {
    readonly code = 'AUTHORIZATION_FAILED';
    readonly statusCode = 403;
}

export class TokenExpiredError extends AppError {
    readonly code = 'TOKEN_EXPIRED';
    readonly statusCode = 401;
}

// Consent Errors

export class ConsentDeniedError extends AppError {
    readonly code = 'CONSENT_DENIED';
    readonly statusCode = 403;

    constructor(
        message: string = 'Patient consent required for this access',
        public readonly patientId?: string
    ) {
        super(message);
    }
}

export class ConsentExpiredError extends AppError {
    readonly code = 'CONSENT_EXPIRED';
    readonly statusCode = 403;
}

export class ConsentTimeoutError extends AppError {
    readonly code = 'CONSENT_TIMEOUT';
    readonly statusCode = 408;
}

// ZK Proof Errors

export class ProofGenerationError extends AppError {
    readonly code = 'PROOF_GENERATION_FAILED';
    readonly statusCode = 500;
}

export class ProofVerificationError extends AppError {
    readonly code = 'PROOF_VERIFICATION_FAILED';
    readonly statusCode = 400;
}

// Break-Glass Errors

export class BreakGlassInvalidError extends AppError {
    readonly code = 'INVALID_BREAK_GLASS';
    readonly statusCode = 400;
}

export class BreakGlassExpiredError extends AppError {
    readonly code = 'BREAK_GLASS_EXPIRED';
    readonly statusCode = 403;
}

// Resource Errors

export class ResourceNotFoundError extends AppError {
    readonly code = 'RESOURCE_NOT_FOUND';
    readonly statusCode = 404;

    constructor(resourceType: string, id: string) {
        super(`${resourceType}/${id} not found`);
    }
}

export class ResourceCategoryNotAllowedError extends AppError {
    readonly code = 'CATEGORY_NOT_ALLOWED';
    readonly statusCode = 403;

    constructor(category: string) {
        super(`Access to ${category} resources is not permitted by patient consent`);
    }
}

// Validation Errors

export class ValidationError extends AppError {
    readonly code = 'VALIDATION_ERROR';
    readonly statusCode = 400;

    constructor(
        message: string,
        public readonly errors: Array<{ path: string; message: string }>
    ) {
        super(message);
    }

    toJSON() {
        return {
            ...super.toJSON(),
            errors: this.errors
        };
    }
}

// Rate Limit Errors

export class RateLimitError extends AppError {
    readonly code = 'RATE_LIMIT_EXCEEDED';
    readonly statusCode = 429;

    constructor(
        public readonly retryAfter: number
    ) {
        super(`Too many requests. Retry after ${retryAfter} seconds.`);
    }

    toJSON() {
        return {
            ...super.toJSON(),
            retryAfter: this.retryAfter
        };
    }
}

// Database Errors

export class DatabaseError extends AppError {
    readonly code = 'DATABASE_ERROR';
    readonly statusCode = 500;
    readonly isOperational = false;
}

export class ConnectionError extends AppError {
    readonly code = 'CONNECTION_ERROR';
    readonly statusCode = 503;
    readonly isOperational = false;
}

// Error Handler Helper

export function isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
}

export function toErrorResponse(error: unknown): {
    error: string;
    message: string;
    statusCode: number;
} {
    if (isAppError(error)) {
        return error.toJSON();
    }

    // Generic error
    return {
        error: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'development'
            ? (error as Error).message
            : 'An unexpected error occurred',
        statusCode: 500
    };
}
