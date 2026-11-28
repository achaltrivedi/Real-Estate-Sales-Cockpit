import { loadSeed } from '@gsc/db';
import { MemoryStore } from './memory';
import { describeStoreContract } from './store.contract';

describeStoreContract('MemoryStore', async () => ({ store: new MemoryStore(loadSeed()) }));
