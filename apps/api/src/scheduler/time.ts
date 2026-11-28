/** Minutes since local midnight in `timeZone`. */
function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value);
  const m = Number(parts.find((p) => p.type === 'minute')?.value);
  return (h % 24) * 60 + m;
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Parses "22:00-08:00" into minute offsets; throws on a malformed window. */
export function parseQuietHours(window: string): [number, number] {
  const parts = window.split('-').map((s) => s.trim());
  const mins = parts.map((t) => {
    const m = HHMM.exec(t);
    if (!m) throw new Error(`Invalid quiet hours "${window}" (expected HH:MM-HH:MM)`);
    return Number(m[1]) * 60 + Number(m[2]);
  });
  if (mins.length !== 2) throw new Error(`Invalid quiet hours "${window}" (expected HH:MM-HH:MM)`);
  return [mins[0]!, mins[1]!];
}

/** Quiet hours, e.g. "22:00-08:00" in Asia/Dubai. Windows may cross midnight. Equal start/end = never quiet. */
export function isQuietHour(now: Date, window = '22:00-08:00', timeZone = 'Asia/Dubai'): boolean {
  const [start, end] = parseQuietHours(window);
  if (start === end) return false;
  const mins = localMinutes(now, timeZone);
  return start > end ? mins >= start || mins < end : mins >= start && mins < end;
}

/** First moment at or after `now` outside quiet hours (minute precision). */
export function nextAllowedTime(now: Date, window = '22:00-08:00', timeZone = 'Asia/Dubai'): Date {
  if (!isQuietHour(now, window, timeZone)) return now;
  const [, end] = parseQuietHours(window);
  const mins = localMinutes(now, timeZone);
  const wait = (end - mins + 24 * 60) % (24 * 60) || 24 * 60;
  const at = new Date(now.getTime() + wait * 60_000);
  at.setUTCSeconds(0, 0);
  return at;
}

const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** "30s,2m,1h,1d" → milliseconds. Throws on anything else, so a typo in env fails at startup. */
export function parseDurations(list: string): number[] {
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(\d+)\s*([smhd])$/i.exec(s);
      if (!m || Number(m[1]) <= 0)
        throw new Error(`Invalid duration "${s}" (use e.g. 30s, 10m, 1h, 2d)`);
      return Number(m[1]) * UNIT_MS[m[2]!.toLowerCase()]!;
    });
}
