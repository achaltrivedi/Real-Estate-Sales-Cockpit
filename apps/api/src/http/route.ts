import { endpoints, type BodyOf, type EndpointName, type ResponseOf } from '@gsc/contracts';
import type { FastifyInstance } from 'fastify';
import { ZodError, type z } from 'zod';
import { HttpError } from '../domain/lead-service';

type QueryParsed<N extends EndpointName> = (typeof endpoints)[N] extends { query: infer Q extends z.ZodTypeAny } ? z.infer<Q> : never;

interface Ctx<N extends EndpointName> {
  params: Record<string, string>;
  body: BodyOf<N>;
  query: QueryParsed<N>;
}

/**
 * Registers a route straight from the contract registry: same path, same method,
 * request validated with the contract's Zod schema. Server can't drift from the client.
 */
export function route<N extends EndpointName>(
  app: FastifyInstance,
  name: N,
  handler: (ctx: Ctx<N>) => Promise<ResponseOf<N>>,
) {
  const def = endpoints[name];
  app.route({
    method: def.method,
    url: def.path,
    handler: async (req, reply) => {
      try {
        const body = 'body' in def ? (def.body as z.ZodTypeAny).parse(req.body) : undefined;
        const query = 'query' in def ? (def.query as z.ZodTypeAny).parse(req.query) : undefined;
        const result = await handler({ params: req.params as Record<string, string>, body, query } as Ctx<N>);
        return reply.send(result);
      } catch (err) {
        if (err instanceof ZodError) return reply.status(400).send({ error: 'Validation failed', details: err.issues });
        if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
        throw err;
      }
    },
  });
}
