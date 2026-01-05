import { Request, Response, NextFunction } from 'express';

export const smartAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Temporary stub to simulate a valid OIDC context.
    // We need this to test the ZK middleware without spinning up a full IdP.
    // Later we'll switch this to actual JWT validation.
    req.smartContext = {
        patient: "123", // Matches test fixtures
        practitioner: "practitioner-456",
        scope: "patient/*.read",
        sub: "practitioner-456"
    };
    next();
};
