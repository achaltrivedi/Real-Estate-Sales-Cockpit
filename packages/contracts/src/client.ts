import { endpoints, type BodyOf, type EndpointName, type QueryOf, type ResponseOf } from './api';

export interface CallOptions<N extends EndpointName> {
  params?: Record<string, string>;
  body?: BodyOf<N>;
  query?: QueryOf<N>;
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public payload: unknown,
  ) {
    super(`API ${status}`);
  }
}

/**
 * Typed client shared by apps/web and apps/dashboard.
 * Front ends talk to the engine ONLY through this; never import engine packages.
 */
export function createApiClient(baseUrl: string, fetchImpl: typeof fetch = fetch) {
  return async function call<N extends EndpointName>(
    name: N,
    opts: CallOptions<N> = {},
  ): Promise<ResponseOf<N>> {
    const def = endpoints[name];
    let path: string = def.path;
    for (const [k, v] of Object.entries(opts.params ?? {})) {
      path = path.replace(`:${k}`, encodeURIComponent(v));
    }
    const query = opts.query as Record<string, unknown> | undefined;
    const qs = query
      ? '?' +
        new URLSearchParams(
          Object.entries(query)
            .filter(([, v]) => v !== undefined && v !== '')
            .map(([k, v]): [string, string] => [k, String(v)]),
        ).toString()
      : '';
    const res = await fetchImpl(`${baseUrl}${path}${qs}`, {
      method: def.method,
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new ApiClientError(res.status, json);
    return def.response.parse(json) as ResponseOf<N>;
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
