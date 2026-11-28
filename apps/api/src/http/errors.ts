import type { ApiError } from '@gsc/contracts';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError, type z } from 'zod';
import { HttpError } from '../domain/errors';

type ApiErrorBody = z.infer<typeof ApiError>;

/**
 * Every failure leaves the API as the contract's `ApiError` shape: `{ error, details? }`.
 * 4xx messages are safe to show; 5xx never leak internals (the request id links to the log line).
 */
export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    let status = 500;
    let body: ApiErrorBody = { error: 'Internal server error', details: { requestId: req.id } };

    if (err instanceof ZodError) {
      status = 400;
      body = { error: 'Validation failed', details: err.issues };
    } else if (err instanceof HttpError) {
      status = err.status;
      body =
        err.details === undefined
          ? { error: err.message }
          : { error: err.message, details: err.details };
    } else if (
      'statusCode' in err &&
      typeof err.statusCode === 'number' &&
      err.statusCode >= 400 &&
      err.statusCode < 500
    ) {
      // Fastify's own client errors: malformed JSON, payload too large, unsupported media type, ...
      status = err.statusCode;
      body = { error: err.message, details: err.code ? { code: err.code } : undefined };
    }

    if (status >= 500) req.log.error({ err }, 'unhandled error');
    else req.log.info({ status, error: body.error }, 'request rejected');
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    const body: ApiErrorBody = { error: `Route not found: ${req.method} ${req.url.split('?')[0]}` };
    return reply.status(404).send(body);
  });
}
