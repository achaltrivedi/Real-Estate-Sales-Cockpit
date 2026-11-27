import { EventEmitter } from 'node:events';
import type { EventName, EventPayload } from '@gsc/contracts';

/** In-process domain event bus. Subscribers: CRM sync, scheduler, (later) dashboard live updates. */
export class EventBus {
  private ee = new EventEmitter();

  emit<E extends EventName>(name: E, payload: EventPayload<E>) {
    this.ee.emit(name, payload);
  }
  on<E extends EventName>(name: E, fn: (payload: EventPayload<E>) => void | Promise<void>) {
    this.ee.on(name, (p: EventPayload<E>) => {
      Promise.resolve(fn(p)).catch((err) => console.error(`[event ${name}]`, err));
    });
  }
}
