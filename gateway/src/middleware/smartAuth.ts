import { Request, Response, NextFunction } from 'express';

export const smartAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Stub: Allow basic testing
    next();
};
