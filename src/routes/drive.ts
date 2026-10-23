import type { FastifyInstance } from 'fastify';
import { parse } from '../lib/validate.ts';
import { requireUser } from '../plugins/auth.ts';
import { driveOperations, driveQuery, listDrive, operationBody } from '../services/drive.ts';

export default async function driveRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/drive', async (request) => listDrive(requireUser(request).id, parse(driveQuery, request.query)));
  app.post('/api/drive/operations', async (request) => driveOperations(requireUser(request).id, parse(operationBody, request.body)));
}
