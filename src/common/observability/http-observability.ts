import type { Request, Response, NextFunction } from 'express';
import { performance } from 'node:perf_hooks';
import { newRequestId, requestContext } from './request-context.js';
import { structuredLog } from './structured-logger.js';
export interface CorrelatedRequest extends Request {
  requestId?: string;
}
export function observeHttp(
  request: CorrelatedRequest,
  response: Response,
  next: NextFunction,
): void {
  const requestId = newRequestId();
  const start = performance.now();
  request.requestId = requestId;
  response.setHeader('X-Request-Id', requestId);
  let logged = false;
  const complete = (): void => {
    if (logged) return;
    logged = true;
    // route.path est le template enregistré côté serveur, jamais req.url/path/query.
    const route: unknown = (request.route as { path?: unknown } | undefined)
      ?.path;
    structuredLog({
      level: response.statusCode >= 500 ? 'error' : 'info',
      module: 'Http',
      event: 'http.completed',
      requestId,
      statusCode: response.statusCode,
      durationMs: performance.now() - start,
      method: request.method,
      route: typeof route === 'string' ? route : 'unmatched',
    });
  };
  response.once('finish', complete);
  response.once('close', complete);
  requestContext.run({ requestId }, next);
}
