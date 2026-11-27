import { createApiClient } from '@gsc/contracts/client';

/** The web app reaches the engine ONLY through this typed client (real API or Prism mock). */
export const api = createApiClient(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000');
export const PROJECT_ID = process.env.NEXT_PUBLIC_DEFAULT_PROJECT_ID ?? 'prj_azure_crest';
