/**
 * PDF Generation Service
 * 
 * Generates professional, compliance-ready PDF reports for patient audit trails.
 * Uses PDFKit for high-quality document creation.
 */

import PDFDocument from 'pdfkit';
import { prisma } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

export class PDFService {

    /**
     * Generate a PDF audit report for a patient
     */
    async generateAuditReport(patientId: string): Promise<Buffer> {
        return new Promise(async (resolve, reject) => {
            try {
                // Fetch Data
                const logs = await prisma.auditLog.findMany({
                    where: { patientId },
                    orderBy: { createdAt: 'desc' },
                    take: 100 // Limit for now
                });

                // Create Document
                const doc = new PDFDocument({ margin: 50 });
                const buffers: Buffer[] = [];

                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => {
                    resolve(Buffer.concat(buffers));
                });

                // --- Header ---
                doc.fontSize(20).text('ZK Guardian', { align: 'center' });
                doc.fontSize(12).text('Privacy-Preserving Access Audit Record', { align: 'center' });
                doc.moveDown();

                doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'right' });
                doc.text(`Patient ID: ${patientId}`, { align: 'right' });
                doc.moveDown(2);

                // --- Summary ---
                doc.fontSize(14).text('Access Summary');
                doc.fontSize(10).text(`Total Records: ${logs.length}`);
                const breakGlassCount = logs.filter(l => l.isBreakGlass).length;
                if (breakGlassCount > 0) {
                    doc.fillColor('red').text(`Break-Glass Events: ${breakGlassCount}`);
                    doc.fillColor('black');
                } else {
                    doc.text(`Break-Glass Events: 0`);
                }
                doc.moveDown(2);

                // --- Table Header ---
                const tableTop = doc.y;
                const dateX = 50;
                const clinicianX = 200;
                const resourceX = 350;
                const statusX = 500;

                doc.fontSize(10).font('Helvetica-Bold');
                doc.text('Date / Time', dateX, tableTop);
                doc.text('Clinician / Entity', clinicianX, tableTop);
                doc.text('Resource', resourceX, tableTop);
                doc.text('Status', statusX, tableTop);

                doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

                doc.font('Helvetica');
                let y = tableTop + 30;

                // --- Table Rows ---
                for (const log of logs) {
                    // Check for page break
                    if (y > 700) {
                        doc.addPage();
                        y = 50;
                    }

                    const dateStr = log.createdAt.toLocaleDateString() + ' ' + log.createdAt.toLocaleTimeString();
                    const clinician = log.clinicianName || log.clinicianId || 'Unknown';
                    const resource = `${log.resourceType} ${log.resourceId ? `(${log.resourceId.substring(0, 6)}...)` : ''}`;

                    doc.text(dateStr, dateX, y, { width: 140 });
                    doc.text(clinician, clinicianX, y, { width: 140 });
                    doc.text(resource, resourceX, y, { width: 140 });

                    if (log.isBreakGlass) {
                        doc.fillColor('red').text('BREAK-GLASS', statusX, y);
                        doc.fillColor('black');
                    } else {
                        doc.text('Authorized', statusX, y);
                    }

                    y += 30; // Row height
                }

                // --- Footer ---
                // doc.text('Footer content', 50, doc.page.height - 50);

                doc.end();

            } catch (error) {
                logger.error({ error }, 'PDF Generation failed');
                reject(error);
            }
        });
    }
}

export const pdfService = new PDFService();
