import { writeFileSync } from 'node:fs';
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);
const { endpoints } = await import('../src/api');

const registry = new OpenAPIRegistry();
for (const [name, e] of Object.entries(endpoints)) {
  const params = [...e.path.matchAll(/:(\w+)/g)].map((m) => m[1]!);
  registry.registerPath({
    operationId: name,
    method: e.method.toLowerCase() as 'get' | 'post' | 'patch',
    path: e.path.replace(/:(\w+)/g, '{$1}'),
    summary: e.summary,
    request: {
      params: params.length
        ? z.object(Object.fromEntries(params.map((p) => [p, z.string()])))
        : undefined,
      query: 'query' in e ? (e.query as z.AnyZodObject) : undefined,
      body:
        'body' in e
          ? { content: { 'application/json': { schema: e.body as z.ZodTypeAny } } }
          : undefined,
    },
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: e.response } } },
    },
  });
}

const doc = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.3',
  info: { title: 'Genesis Sales Cockpit API', version: '0.1.0' },
  servers: [{ url: 'http://localhost:4000' }],
});
writeFileSync(new URL('../openapi.json', import.meta.url), JSON.stringify(doc, null, 2));
console.log('openapi.json written');
