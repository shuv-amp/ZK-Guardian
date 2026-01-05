import { Router } from 'express';

export const fhirRouter: Router = Router();

fhirRouter.get('/', (req, res) => {
    res.json({ message: "FHIR Router Stub" });
});
