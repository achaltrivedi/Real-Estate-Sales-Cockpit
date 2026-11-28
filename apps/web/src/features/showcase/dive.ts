/**
 * Scroll-dive choreography for the cinematic hero (pure; unit-tested).
 *
 * One scroll progress u ∈ [0, 1] drives everything:
 *   0 → B   push in across the lagoon towards Tower 1's crown. Depth layers zoom about the crown
 *           at different rates (parallax), the framing palms part, the crown drifts to screen centre.
 *   B → 1   the crown becomes a window: shot C (the sky terrace at sunset) opens from the crown's
 *           on-screen rectangle to full screen while its own layers settle (pull-back).
 * Zoom is interpolated in log space so it feels uniform, and the two phases meet with matching speed.
 */

export const B = 0.5;

/** Normalised rectangle in frame space (0..1), as written by cinematic.py: [left, top, right, bottom]. */
export type Rect4 = [number, number, number, number];

export interface Box {
  /** viewport */
  vw: number;
  vh: number;
  /** cover-fitted frame (same aspect as the renders), centred in the viewport */
  fw: number;
  fh: number;
}

/** Transform of one layer: scale about `origin`, then translate. Translation in frame fractions. */
export interface LayerT {
  s: number;
  tx: number;
  ty: number;
  o: number;
}

export interface DiveState {
  origin: [number, number]; // crown centre, frame fractions (transform-origin of the A layers)
  bg: LayerT;
  towers: LayerT;
  mid: LayerT;
  fgLeft: LayerT;
  fgRight: LayerT;
  view: LayerT;
  terrace: LayerT;
  /** Shot C reveal: CSS inset() in px plus corner radius. */
  portal: { top: number; right: number; bottom: number; left: number; radius: number; o: number };
  intro: number; // opacity of the opening title
  outro: number; // opacity of the closing line + CTAs
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smallest scale (about origin c, after translation t) that still covers [0,1] on one axis. */
export function coverScale(c: number, t: number): number {
  const top = c > 0 ? (c + t) / c : 1;
  const bottom = c < 1 ? (1 - c - t) / (1 - c) : 1;
  return Math.max(1, top, bottom);
}

/** Scale at which the crown spans ~60% of the viewport width (bounded so phones and ultrawides stay sane). */
export function crownZoom(crown: Rect4, box: Box): number {
  const crownPx = Math.max(1e-3, (crown[2] - crown[0]) * box.fw);
  return Math.min(4.5, Math.max(1.6, (0.46 * Math.min(box.vw, box.vh * 1.5)) / crownPx));
}

export function diveState(u: number, crown: Rect4, box: Box): DiveState {
  u = clamp01(u);
  const cx = (crown[0] + crown[2]) / 2;
  const cy = (crown[1] + crown[3]) / 2;
  const sB = crownZoom(crown, box);
  const lnB = Math.log(sB);
  const e1 = easeIn(clamp01(u / B));
  const e2 = easeOut(clamp01((u - B) / (1 - B)));

  // Bring the crown to the centre of the frame (the frame is centred on the viewport).
  const full: [number, number] = [0.5 - cx, 0.5 - cy];

  // Phase-2 zoom: at least 4×, and enough for the crown rectangle to cover the whole viewport
  // (tall phones need more because the crown is wide and short there).
  const coverNeed = Math.max(box.vw / ((crown[2] - crown[0]) * box.fw), box.vh / ((crown[3] - crown[1]) * box.fh)) * 1.08;
  const lnZoom2 = Math.log(Math.max(4, coverNeed / sB));
  const towersS = Math.exp(lnB * e1 + lnZoom2 * e2);
  const towers: LayerT = { s: towersS, tx: full[0] * e1, ty: full[1] * e1, o: 1 };

  const bgT: [number, number] = [full[0] * 0.4 * e1, full[1] * 0.4 * e1];
  const bgS = Math.max(Math.exp(lnB * 0.22 * e1 + 0.2 * e2), coverScale(cx, bgT[0]), coverScale(cy, bgT[1]));
  const bg: LayerT = { s: bgS, tx: bgT[0], ty: bgT[1], o: 1 };

  const mid: LayerT = {
    s: Math.exp(lnB * 1.3 * e1),
    tx: full[0] * 1.15 * e1,
    ty: full[1] * 1.15 * e1 + 0.08 * e1,
    o: 1 - clamp01((e1 - 0.65) / 0.35),
  };

  // Framing palms part like curtains and fall away.
  const part = 0.55 * e1;
  const fgO = 1 - clamp01((e1 - 0.55) / 0.4);
  const fgLeft: LayerT = { s: 1 + 0.7 * e1, tx: -part, ty: 0.12 * e1, o: fgO };
  const fgRight: LayerT = { s: 1 + 0.7 * e1, tx: part, ty: 0.12 * e1, o: fgO };

  // Portal = the crown rectangle as transformed by the towers layer, in viewport px.
  const fx0 = (box.vw - box.fw) / 2;
  const fy0 = (box.vh - box.fh) / 2;
  const map = (p: number, c: number, t: number) => c + (p - c) * towers.s + t;
  const L = fx0 + map(crown[0], cx, towers.tx) * box.fw;
  const R = fx0 + map(crown[2], cx, towers.tx) * box.fw;
  const T = fy0 + map(crown[1], cy, towers.ty) * box.fh;
  const Bm = fy0 + map(crown[3], cy, towers.ty) * box.fh;
  const portal = {
    top: Math.max(0, T),
    left: Math.max(0, L),
    right: Math.max(0, box.vw - R),
    bottom: Math.max(0, box.vh - Bm),
    radius: lerp(28, 0, clamp01(e2 * 1.6)),
    o: u <= B ? 0 : clamp01((u - B) / (0.08 * (1 - B))),
  };

  const view: LayerT = { s: lerp(1.3, 1, e2), tx: 0, ty: 0, o: 1 };
  const terrace: LayerT = { s: lerp(1.55, 1, e2), tx: 0, ty: lerp(0.08, 0, e2), o: 1 };

  return {
    origin: [cx, cy],
    bg,
    towers,
    mid,
    fgLeft,
    fgRight,
    view,
    terrace,
    portal,
    intro: 1 - clamp01(u / 0.12),
    outro: clamp01((u - 0.88) / 0.1),
  };
}

/** CSS transform for a layer whose transform-origin is set to the crown centre. */
export function layerCss(t: LayerT): string {
  return `translate3d(${(t.tx * 100).toFixed(3)}%, ${(t.ty * 100).toFixed(3)}%, 0) scale(${t.s.toFixed(4)})`;
}
