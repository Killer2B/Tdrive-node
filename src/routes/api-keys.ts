import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/validate.ts';
import { requireUser } from '../plugins/auth.ts';
import { createApiKey, listApiKeys, revokeApiKey } from '../services/api-keys.ts';

export default async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/account/api-keys', async (request) => {
    const user = requireUser(request);
    return { keys: listApiKeys(user.id) };
  });

  app.post('/api/account/api-keys', async (request, reply) => {
    const user = requireUser(request);
    const body = parse(z.object({ label: z.string().trim().min(1).max(100) }).strict(), request.body);
    const created = createApiKey(user.id, body.label);
    return reply.code(201).send(created);
  });

  app.delete('/api/account/api-keys/:id', async (request) => {
    const user = requireUser(request);
    const id = (request.params as { id: string }).id;
    revokeApiKey(user.id, id);
    return { ok: true };
  });
}
