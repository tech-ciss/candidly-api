import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
export interface RequestContext {
  requestId: string;
}
export const requestContext = new AsyncLocalStorage<RequestContext>();
export const newRequestId = (): string => randomUUID();
export const currentRequestId = (): string | undefined =>
  requestContext.getStore()?.requestId;
