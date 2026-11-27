import { readFileSync } from 'node:fs';
import { SeedFile } from '@gsc/contracts';

/** Loads + validates assets/seed/project.json. Used by the memory store AND the Postgres seed. */
export function loadSeed(path = new URL('../../../assets/seed/project.json', import.meta.url)): SeedFile {
  return SeedFile.parse(JSON.parse(readFileSync(path, 'utf8')));
}
