import type { Item, Opening, Vec2, Wall, Zone } from '../types';

export const EPS = 1e-9;

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

export function norm(a: Vec2): Vec2 {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Normale gauche (perpendiculaire) du vecteur. */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export function rotate(p: Vec2, deg: number, origin: Vec2 = { x: 0, y: 0 }): Vec2 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return { x: origin.x + dx * c - dy * s, y: origin.y + dx * s + dy * c };
}

export const round = (n: number, decimals = 3): number => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/** Arrondi a un pas de grille. */
export function snapToGrid(p: Vec2, step: number): Vec2 {
  if (step <= 0) return p;
  return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
}

/** Contraint un point sur un multiple de 15 degres autour d'une origine. */
export function snapAngle(origin: Vec2, p: Vec2, stepDeg = 15): Vec2 {
  const d = sub(p, origin);
  const l = len(d);
  if (l < EPS) return p;
  const ang = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  const snapped = (Math.round(ang / stepDeg) * stepDeg * Math.PI) / 180;
  return { x: origin.x + Math.cos(snapped) * l, y: origin.y + Math.sin(snapped) * l };
}

/** Projection d'un point sur un segment, avec le parametre t borne [0,1]. */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; distance: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return { point: a, t: 0, distance: dist(p, a) };
  let t = dot(sub(p, a), ab) / l2;
  t = Math.max(0, Math.min(1, t));
  const point = add(a, mul(ab, t));
  return { point, t, distance: dist(p, point) };
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return projectOnSegment(p, a, b).distance;
}

/** Intersection de deux segments. Retourne null si pas d'intersection stricte. */
export function segmentIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const denom = cross(r, s);
  if (Math.abs(denom) < EPS) return null;
  const t = cross(sub(b1, a1), s) / denom;
  const u = cross(sub(b1, a1), r) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return add(a1, mul(r, t));
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectFromPoints(a: Vec2, b: Vec2): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function rectContains(r: Rect, p: Vec2): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function rectIntersects(a: Rect, b: Rect): boolean {
  return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
}

/** Les 4 sommets d'un objet oriente (rectangle tourne). */
export function itemCorners(it: { x: number; y: number; width: number; depth: number; rotation: number }): Vec2[] {
  const hw = it.width / 2;
  const hd = it.depth / 2;
  const base: Vec2[] = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ];
  return base.map((p) => {
    const r = rotate(p, it.rotation);
    return { x: r.x + it.x, y: r.y + it.y };
  });
}

/** Boite englobante alignee sur les axes d'un objet oriente. */
export function itemBounds(it: { x: number; y: number; width: number; depth: number; rotation: number }): Rect {
  const c = itemCorners(it);
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/** Test point-dans-rectangle-oriente : on ramene le point dans le repere local. */
export function pointInItem(p: Vec2, it: { x: number; y: number; width: number; depth: number; rotation: number }): boolean {
  const local = rotate({ x: p.x - it.x, y: p.y - it.y }, -it.rotation);
  return Math.abs(local.x) <= it.width / 2 && Math.abs(local.y) <= it.depth / 2;
}

/** Test point-dans-polygone (ray casting). */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    const intersect =
      pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y + EPS) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(a / 2);
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    a += f;
    cx += (poly[j].x + poly[i].x) * f;
    cy += (poly[j].y + poly[i].y) * f;
  }
  if (Math.abs(a) < EPS) {
    // Polygone degenere : moyenne simple
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function polygonBounds(poly: Vec2[]): Rect {
  if (!poly.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

export const wallLength = (w: Wall): number => dist(w.a, w.b);
export const wallAngle = (w: Wall): number => Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
export const wallDir = (w: Wall): Vec2 => norm(sub(w.b, w.a));

/** Point situe a `offset` metres du point a, le long du mur. */
export function pointOnWall(w: Wall, offset: number): Vec2 {
  return add(w.a, mul(wallDir(w), offset));
}

/** Les 4 sommets du quadrilatere representant l'emprise du mur. */
export function wallPolygon(w: Wall): Vec2[] {
  const d = wallDir(w);
  const n = mul(perp(d), w.thickness / 2);
  return [add(w.a, n), add(w.b, n), sub(w.b, n), sub(w.a, n)];
}

/** Position monde du centre d'une ouverture. */
export function openingCenter(o: Opening, w: Wall): Vec2 {
  return pointOnWall(w, o.offset);
}

/** Bornes de l'ouverture le long du mur, en metres. */
export function openingRange(o: Opening): [number, number] {
  return [o.offset - o.width / 2, o.offset + o.width / 2];
}

/** Verifie qu'une ouverture tient bien dans son mur. */
export function clampOpening(o: Opening, w: Wall): Opening {
  const L = wallLength(w);
  const width = Math.min(o.width, Math.max(0.1, L - 0.02));
  const half = width / 2;
  const offset = Math.max(half, Math.min(L - half, o.offset));
  return { ...o, width, offset };
}

/** Formate une longueur en metres pour l'affichage. */
export function fmtM(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (Math.abs(m) < 1) return `${Math.round(m * 100)} cm`;
  return `${m.toFixed(2)} m`;
}

export function fmtM2(m2: number): string {
  return `${m2.toFixed(2)} m²`;
}

/** Genere un identifiant unique. */
let idCounter = 0;
export function uid(prefix = 'e'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Boite englobante de tout le contenu du plan (pour le zoom « tout voir »). */
export function contentBounds(walls: Wall[], items: Item[], zones: Zone[]): Rect | null {
  const pts: Vec2[] = [];
  walls.forEach((w) => wallPolygon(w).forEach((p) => pts.push(p)));
  items.forEach((i) => itemCorners(i).forEach((p) => pts.push(p)));
  zones.forEach((z) => z.points.forEach((p) => pts.push(p)));
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}
