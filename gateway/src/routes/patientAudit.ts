import { Router } from 'express';

export const patientAuditRouter: Router = Router();

patientAuditRouter.get('/', (req, res) => {
    res.json({ message: "Audit Router Stub" });
});
