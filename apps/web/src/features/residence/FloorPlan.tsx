'use client';

import { useLocale, useTranslations } from 'next-intl';
import { type ReactElement, type ReactNode, useId, useMemo } from 'react';
import { type Fixture, type Opening, type ResolvedPlan, type Room, type RoomKind, doorSwing, isBathroom, labelSpot, wallSegments } from './floorplans';

/**
 * Architectural floor plan, drawn as SVG in metres (1 SVG unit = 1 m): poché walls, door swings,
 * full-height glazing, furniture and room labels. Geometry comes from ./floorplans (unit-tested).
 * The plan is never mirrored for RTL; only its text changes language.
 */

const INK = '#5B5249';
const LINE = '#A39686';
const GLASS = '#8AA4B1';

const FILL: Record<RoomKind, string> = {
  living: '#F4EEE3',
  livingDining: '#F4EEE3',
  studio: '#F4EEE3',
  kitchen: '#F1EADF',
  master: '#EFE5D4',
  bedroom: '#EFE5D4',
  ensuite: '#E9E6E1',
  bath: '#E9E6E1',
  powder: '#E9E6E1',
  walkin: '#ECE4D8',
  wardrobe: '#ECE4D8',
  store: '#ECE6DC',
  laundry: '#ECE6DC',
  foyer: '#F6F2EB',
  corridor: '#F6F2EB',
};

const HABITABLE: RoomKind[] = ['living', 'livingDining', 'studio', 'kitchen', 'master', 'bedroom'];
/** Rooms that also show their dimensions (kitchens are too full of joinery for a second line). */
const DIMENSIONED: RoomKind[] = ['living', 'livingDining', 'studio', 'master', 'bedroom'];
/** Average uppercase glyph advance incl. letter-spacing, as a fraction of the font size. */
const CHAR = 0.76;

interface Props {
  plan: ResolvedPlan;
  /** Thumbnail: no dimensions, no furniture labels. */
  compact?: boolean;
  /** Text under the view side, e.g. "Sea view". */
  viewLabel?: string;
  className?: string;
  title?: string;
  /** Overlay drawn last, in plan metres (e.g. the tour's "you are here" marker). */
  children?: ReactNode;
}

export function FloorPlan({ plan, compact = false, viewLabel, className, title, children }: Props) {
  const t = useTranslations('residence');
  const locale = useLocale();
  const uid = useId().replace(/:/g, '');
  const walls = useMemo(() => wallSegments(plan), [plan]);
  const swings = useMemo(() => plan.openings.filter((o) => o.type !== 'open').map(doorSwing), [plan]);
  const k = plan.scale;
  /** Text grows with the plan so it stays legible when a large plan is fitted to the same box. */
  const g = Math.max(1, Math.max(plan.width, plan.depth + plan.outdoor.depth) / 11);
  const num = (v: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);

  const pad = compact ? 0.5 : 1.5;
  const bottom = plan.depth + plan.outdoor.depth;
  const vb = [-pad, -pad, plan.width + pad * 2, bottom + pad * 2 + (viewLabel ? 0.5 * g : 0)];
  const tile = `tile-${uid}`;

  const roomName = (r: Room) => {
    const base = t(`room.${r.kind}`);
    return r.n ? `${base} ${new Intl.NumberFormat(locale).format(r.n)}` : base;
  };

  return (
    <svg viewBox={vb.join(' ')} className={className} role="img" aria-label={title ?? t('planAria')} style={{ fontFamily: 'inherit', direction: 'ltr' }}>
      <defs>
        <pattern id={tile} width={0.6 * k} height={0.6 * k} patternUnits="userSpaceOnUse">
          <path d={`M ${0.6 * k} 0 L 0 0 0 ${0.6 * k}`} fill="none" stroke="#D2CCC3" strokeWidth={0.015} />
        </pattern>
      </defs>

      {/* Outdoor: wavy balcony or penthouse terrace */}
      <Outdoor plan={plan} g={g} label={compact ? undefined : t(plan.outdoor.kind === 'terrace' ? 'room.terrace' : 'room.balcony')} />

      {/* Rooms */}
      {plan.rooms.map((r) => (
        <g key={r.id}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={FILL[r.kind]} />
          {isBathroom(r.kind) && <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={`url(#${tile})`} />}
        </g>
      ))}

      {/* Furniture */}
      <g stroke={LINE} strokeWidth={0.03} fill="#FBF9F5" strokeLinejoin="round">
        {plan.fixtures.map((f, i) => (
          <FixtureShape key={i} f={f} />
        ))}
      </g>

      {/* Walls (square caps close the corners) */}
      <g stroke={INK} strokeLinecap="square">
        {walls.map((s, i) => (
          <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} strokeWidth={s.exterior ? 0.24 : 0.11} />
        ))}
      </g>

      {/* Full-height glazing */}
      <g stroke={GLASS} strokeWidth={0.035}>
        {plan.windows.map((w, i) => (
          <Glazing key={i} w={w} />
        ))}
      </g>

      {/* Doors */}
      <g stroke={INK} strokeWidth={0.035} fill="none">
        {plan.openings.filter((o) => o.type !== 'open').map((o, i) => (
          <Door key={i} o={o} />
        ))}
      </g>

      {/* Labels */}
      {plan.rooms.map((r) => {
        if (r.kind === 'corridor') return null;
        const name = roomName(r);
        const big = HABITABLE.includes(r.kind);
        const fs = fitFont(name, r, (compact ? (big ? 0.36 : 0.26) : big ? 0.3 : 0.22) * g);
        if (fs < 0.12) return null;
        const showDims = !compact && DIMENSIONED.includes(r.kind);
        const boxH = fs * (showDims ? 2.6 : 1.3);
        const boxW = name.length * fs * CHAR;
        const p = labelSpot(r, [...plan.fixtures.filter((f) => f.room === r.id), ...swings], boxW, boxH);
        return (
          <g key={r.id} textAnchor="middle" style={{ paintOrder: 'stroke' }} stroke={FILL[r.kind]} strokeWidth={fs * 0.35} strokeLinejoin="round">
            <text x={p.x} y={p.y + (showDims ? -fs * 0.25 : fs * 0.35)} fontSize={fs} fill={INK} letterSpacing={locale === 'ar' ? 0 : fs * 0.12} fontWeight={500}>
              {locale === 'ar' ? name : name.toUpperCase()}
            </text>
            {showDims && (
              <text x={p.x} y={p.y + fs * 1.1} fontSize={fs * 0.8} fill={LINE} direction="ltr">
                {num(r.w)} × {num(r.h)} m
              </text>
            )}
          </g>
        );
      })}

      {/* Entry marker */}
      {!compact && <EntryMark plan={plan} label={t('entry')} g={g} />}

      {/* Overall dimensions */}
      {!compact && (
        <g stroke={LINE} strokeWidth={0.02} fill={LINE} fontSize={0.24 * g} direction="ltr">
          <line x1={0} y1={-0.95} x2={plan.width} y2={-0.95} />
          <line x1={0} y1={-1.1} x2={0} y2={-0.8} />
          <line x1={plan.width} y1={-1.1} x2={plan.width} y2={-0.8} />
          <text x={plan.width / 2} y={-1.07} textAnchor="middle" stroke="none">
            {num(plan.width)} m
          </text>
          <line x1={-0.95} y1={0} x2={-0.95} y2={plan.depth} />
          <line x1={-1.1} y1={0} x2={-0.8} y2={0} />
          <line x1={-1.1} y1={plan.depth} x2={-0.8} y2={plan.depth} />
          <text x={-1.07} y={plan.depth / 2} textAnchor="middle" stroke="none" transform={`rotate(-90 ${-1.07} ${plan.depth / 2})`}>
            {num(plan.depth)} m
          </text>
        </g>
      )}

      {viewLabel && (
        <text x={plan.width / 2} y={bottom + pad * 0.6 + 0.3 * g} textAnchor="middle" fontSize={(compact ? 0.42 : 0.28) * g} fill="#8E7049" letterSpacing={locale === 'ar' ? 0 : 0.06} fontWeight={500}>
          {locale === 'ar' ? `↓ ${viewLabel}` : `↓ ${viewLabel.toUpperCase()}`}
        </text>
      )}
      {children}
    </svg>
  );
}

function fitFont(text: string, r: Room, max: number) {
  const byWidth = (r.w * 0.84) / Math.max(1, text.length * CHAR);
  const byHeight = r.h * 0.3;
  return Math.min(max, byWidth, byHeight);
}

function Outdoor({ plan, label, g }: { plan: ResolvedPlan; label?: string; g: number }) {
  const { width: W, depth: D } = plan;
  const d = plan.outdoor.depth;
  if (plan.outdoor.kind === 'terrace') {
    return (
      <g>
        <rect x={0} y={D} width={W} height={d} fill="#EDE5D6" />
        <rect x={0} y={D} width={W} height={d} fill="none" stroke={LINE} strokeWidth={0.05} />
        {label && (
          <text x={W * 0.05 + 0.2} y={D + d * 0.55} fontSize={0.26 * g} fill={LINE} letterSpacing={0.03}>
            {label}
          </text>
        )}
      </g>
    );
  }
  // Wavy slab edge, like the towers' balconies: deepest mid-span, shallow at the ends.
  const n = 3;
  let path = `M 0 ${D} L 0 ${D + d * 0.55}`;
  for (let i = 0; i < n; i++) {
    const x0 = (W / n) * i;
    const x1 = (W / n) * (i + 1);
    const xm = (x0 + x1) / 2;
    path += ` Q ${xm} ${D + d * 1.45} ${x1} ${D + d * 0.55}`;
  }
  path += ` L ${W} ${D} Z`;
  return (
    <g>
      <path d={path} fill="#EEE7DA" stroke={LINE} strokeWidth={0.05} />
      {label && (
        <text x={W / 2} y={D + d * 0.62} fontSize={0.22 * g} fill={LINE} textAnchor="middle" letterSpacing={0.03}>
          {label}
        </text>
      )}
    </g>
  );
}

function Glazing({ w }: { w: Omit<Opening, 'type'> }) {
  const o = 0.07;
  if (w.axis === 'h')
    return (
      <g>
        <line x1={w.from} y1={w.at - o} x2={w.to} y2={w.at - o} />
        <line x1={w.from} y1={w.at + o} x2={w.to} y2={w.at + o} />
        <line x1={w.from} y1={w.at} x2={w.to} y2={w.at} strokeWidth={0.02} />
      </g>
    );
  return (
    <g>
      <line x1={w.at - o} y1={w.from} x2={w.at - o} y2={w.to} />
      <line x1={w.at + o} y1={w.from} x2={w.at + o} y2={w.to} />
      <line x1={w.at} y1={w.from} x2={w.at} y2={w.to} strokeWidth={0.02} />
    </g>
  );
}

/** Door leaf (open at 90 degrees) and its swing arc. */
function Door({ o }: { o: Opening }) {
  const L = o.to - o.from;
  const s = o.into === '-' ? -1 : 1;
  const hingeAlong = o.hinge === 'to' ? o.to : o.from;
  const freeAlong = o.hinge === 'to' ? o.from : o.to;
  const pt = (along: number, off: number): [number, number] => (o.axis === 'h' ? [along, o.at + off] : [o.at + off, along]);
  const c = pt(hingeAlong, 0);
  const leaf = pt(hingeAlong, s * L);
  const free = pt(freeAlong, 0);
  const a0 = Math.atan2(free[1] - c[1], free[0] - c[0]);
  const a1 = Math.atan2(leaf[1] - c[1], leaf[0] - c[0]);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da <= -Math.PI) da += 2 * Math.PI;
  const sweep = da > 0 ? 1 : 0;
  return (
    <g strokeWidth={o.type === 'entry' ? 0.05 : 0.035}>
      <line x1={c[0]} y1={c[1]} x2={leaf[0]} y2={leaf[1]} />
      <path d={`M ${free[0]} ${free[1]} A ${L} ${L} 0 0 ${sweep} ${leaf[0]} ${leaf[1]}`} strokeWidth={0.018} strokeDasharray="0.08 0.06" />
    </g>
  );
}

function EntryMark({ plan, label, g }: { plan: ResolvedPlan; label: string; g: number }) {
  const e = plan.openings.find((o) => o.type === 'entry');
  if (!e) return null;
  const x = (e.from + e.to) / 2;
  return (
    <g fill="#8E7049">
      <path d={`M ${x - 0.16} -0.5 L ${x + 0.16} -0.5 L ${x} -0.26 Z`} />
      <text x={x} y={-0.62} textAnchor="middle" fontSize={0.2 * g} letterSpacing={0.03}>
        {label}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ furniture */

function FixtureShape({ f }: { f: Fixture }) {
  const { x, y, w, h } = f;
  const r = Math.min(w, h);
  switch (f.kind) {
    case 'bed': {
      // Pillows at the head side, a folded throw at the foot.
      const head = f.side ?? 'left';
      const pillows: ReactElement[] = [];
      const horiz = head === 'left' || head === 'right';
      const pw = horiz ? Math.min(0.5, w * 0.22) : (w - 0.25) / 2;
      const ph = horiz ? (h - 0.25) / 2 : Math.min(0.5, h * 0.22);
      for (let i = 0; i < 2; i++) {
        const px = horiz ? (head === 'left' ? x + 0.08 : x + w - 0.08 - pw) : x + 0.08 + i * (pw + 0.09);
        const py = horiz ? y + 0.08 + i * (ph + 0.09) : head === 'top' ? y + 0.08 : y + h - 0.08 - ph;
        pillows.push(<rect key={i} x={px} y={py} width={pw} height={ph} rx={0.06} />);
      }
      const throwRect = horiz
        ? { x: head === 'left' ? x + w * 0.72 : x, y, w: w * 0.28, h }
        : { x, y: head === 'top' ? y + h * 0.72 : y, w, h: h * 0.28 };
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={0.06} />
          <rect {...throwRect} width={throwRect.w} height={throwRect.h} fill="#E9DFCF" />
          {pillows}
        </g>
      );
    }
    case 'sofa': {
      const back = 0.22;
      const side = f.side ?? 'left';
      const seat =
        side === 'left' ? { x: x + back, y, w: w - back, h } : side === 'right' ? { x, y, w: w - back, h } : side === 'top' ? { x, y: y + back, w, h: h - back } : { x, y, w, h: h - back };
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={0.12} fill="#EFE6D8" />
          <rect x={seat.x} y={seat.y} width={seat.w} height={seat.h} rx={0.08} />
        </g>
      );
    }
    case 'armchair':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={0.14} fill="#EFE6D8" />
          <rect x={x + 0.12} y={y + 0.12} width={w - 0.24} height={h - 0.24} rx={0.08} />
        </g>
      );
    case 'coffee':
      return <rect x={x} y={y} width={w} height={h} rx={Math.min(w, h) / 2} fill="#E9DFCF" />;
    case 'nightstand':
      return <rect x={x} y={y} width={w} height={h} rx={0.04} />;
    case 'dining': {
      const seats = f.seats ?? 4;
      const chairs: ReactElement[] = [];
      const long = w >= h;
      const perSide = Math.max(1, Math.floor(seats / 2));
      for (let i = 0; i < perSide; i++) {
        const t = (i + 0.5) / perSide;
        if (long) {
          chairs.push(<rect key={`a${i}`} x={x + w * t - 0.2} y={y - 0.36} width={0.4} height={0.3} rx={0.08} />);
          chairs.push(<rect key={`b${i}`} x={x + w * t - 0.2} y={y + h + 0.06} width={0.4} height={0.3} rx={0.08} />);
        } else {
          chairs.push(<rect key={`a${i}`} x={x - 0.36} y={y + h * t - 0.2} width={0.3} height={0.4} rx={0.08} />);
          chairs.push(<rect key={`b${i}`} x={x + w + 0.06} y={y + h * t - 0.2} width={0.3} height={0.4} rx={0.08} />);
        }
      }
      return (
        <g>
          {chairs}
          <rect x={x} y={y} width={w} height={h} rx={0.06} fill="#E9DFCF" />
        </g>
      );
    }
    case 'counter':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#EAE4DA" />
          {w > h ? (
            <>
              <rect x={x + w * 0.18} y={y + h * 0.18} width={0.5} height={h * 0.6} rx={0.06} fill="none" />
              <circle cx={x + w * 0.7} cy={y + h * 0.33} r={0.09} fill="none" />
              <circle cx={x + w * 0.7 + 0.28} cy={y + h * 0.33} r={0.09} fill="none" />
              <circle cx={x + w * 0.7} cy={y + h * 0.7} r={0.09} fill="none" />
              <circle cx={x + w * 0.7 + 0.28} cy={y + h * 0.7} r={0.09} fill="none" />
            </>
          ) : null}
        </g>
      );
    case 'island':
      return <rect x={x} y={y} width={w} height={h} rx={0.04} fill="#EAE4DA" />;
    case 'stools': {
      const n = f.seats ?? 3;
      return (
        <g>
          {Array.from({ length: n }, (_, i) => (
            <circle key={i} cx={x + (w * (i + 0.5)) / n} cy={y + h / 2} r={Math.min(h / 2, 0.17)} />
          ))}
        </g>
      );
    }
    case 'tub': {
      const inset = 0.1;
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={0.08} />
          <rect x={x + inset} y={y + inset} width={w - inset * 2} height={h - inset * 2} rx={Math.min(w, h) * 0.35} fill="#F0F3F4" />
        </g>
      );
    }
    case 'shower':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#F0F3F4" />
          <line x1={x} y1={y} x2={x + w} y2={y + h} strokeWidth={0.015} />
          <line x1={x + w} y1={y} x2={x} y2={y + h} strokeWidth={0.015} />
          <circle cx={x + w / 2} cy={y + h / 2} r={0.05} />
        </g>
      );
    case 'wc': {
      // Cistern on `side`, bowl pointing away from it.
      const side = f.side ?? 'top';
      const horiz = side === 'left' || side === 'right';
      const t = 0.18;
      const cistern = horiz
        ? { x: side === 'left' ? x : x + w - t, y, w: t, h }
        : { x, y: side === 'top' ? y : y + h - t, w, h: t };
      const bowl = horiz
        ? { cx: side === 'left' ? x + t + (w - t) / 2 : x + (w - t) / 2, cy: y + h / 2, rx: (w - t) / 2, ry: h * 0.38 }
        : { cx: x + w / 2, cy: side === 'top' ? y + t + (h - t) / 2 : y + (h - t) / 2, rx: w * 0.38, ry: (h - t) / 2 };
      return (
        <g>
          <rect x={cistern.x} y={cistern.y} width={cistern.w} height={cistern.h} rx={0.03} />
          <ellipse {...bowl} />
        </g>
      );
    }
    case 'vanity': {
      const horiz = w >= h;
      const basin = horiz ? { cx: x + w / 2, cy: y + h / 2, rx: Math.min(0.24, w * 0.3), ry: h * 0.3 } : { cx: x + w / 2, cy: y + h / 2, rx: w * 0.3, ry: Math.min(0.24, h * 0.3) };
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#EAE4DA" />
          <ellipse {...basin} fill="#F0F3F4" />
        </g>
      );
    }
    case 'wardrobe':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#E9E0D2" />
          {w < h ? <line x1={x + w / 2} y1={y + 0.05} x2={x + w / 2} y2={y + h - 0.05} strokeWidth={0.015} /> : <line x1={x + 0.05} y1={y + h / 2} x2={x + w - 0.05} y2={y + h / 2} strokeWidth={0.015} />}
        </g>
      );
    case 'desk':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#E9DFCF" />
          <rect x={x + w / 2 - 0.2} y={y - 0.4} width={0.4} height={0.34} rx={0.08} />
        </g>
      );
    case 'stair': {
      const n = 9;
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#EAE4DA" />
          {Array.from({ length: n - 1 }, (_, i) => (
            <line key={i} x1={x} y1={y + (h * (i + 1)) / n} x2={x + w * 0.5} y2={y + (h * (i + 1)) / n} strokeWidth={0.015} />
          ))}
          <line x1={x + w * 0.5} y1={y} x2={x + w * 0.5} y2={y + h} />
          {Array.from({ length: n - 1 }, (_, i) => (
            <line key={`b${i}`} x1={x + w * 0.5} y1={y + (h * (i + 1)) / n} x2={x + w} y2={y + (h * (i + 1)) / n} strokeWidth={0.015} />
          ))}
        </g>
      );
    }
    case 'pool':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={0.1} fill="#CFE0E2" stroke="#8AA4B1" />
          <rect x={x + 0.12} y={y + 0.12} width={w - 0.24} height={h - 0.24} rx={0.06} fill="none" stroke="#A9C2C8" strokeWidth={0.015} />
        </g>
      );
    case 'lounger':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={0.1} />
          <line x1={x + 0.06} y1={y + h * 0.3} x2={x + w - 0.06} y2={y + h * 0.3} strokeWidth={0.015} />
        </g>
      );
    default:
      return <rect x={x} y={y} width={w} height={h} rx={r * 0.1} />;
  }
}
