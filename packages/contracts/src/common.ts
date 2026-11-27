import { z } from 'zod';

export const Id = z.string().min(1);
export const IsoDateTime = z.string().datetime({ offset: true });
export const Locale = z.enum(['en', 'ar']);
export type Locale = z.infer<typeof Locale>;

/** All money is integer AED (no fils) to avoid float drift in the calculator. */
export const Currency = z.literal('AED');
export const MoneyAed = z.number().int().nonnegative();

/** Every seed-backed payload carries this so the UI can show the "SAMPLE DATA" label. */
export const SampleFlag = z.literal(true);
