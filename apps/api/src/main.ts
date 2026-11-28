import { ConfigError, loadConfig, type Config } from './config';
import { buildDeps, buildServer } from './server';

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const deps = buildDeps(process.env, config);
const app = await buildServer(deps, config);

// Fail fast with a fix-it hint instead of 500s on the first request.
try {
  await deps.store.ping();
  if ((await deps.store.listSalespeople()).length === 0) {
    app.log.warn('Store has no seed data. Run: pnpm --filter @gsc/db seed');
  }
} catch (err) {
  app.log.fatal(
    { err },
    `Store "${deps.store.name}" unreachable. For DATA_DRIVER=postgres: pnpm db:up && pnpm --filter @gsc/db migrate && pnpm --filter @gsc/db seed`,
  );
  await app.close();
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, 'shutdown failed');
        process.exit(1);
      },
    );
  });
}

await app.listen({ port: config.port, host: config.host });
app.log.info(
  {
    store: deps.store.name,
    channel: deps.channel.name,
    crm: deps.crm.name,
    cors: config.corsOrigins,
  },
  'api ready',
);
