import type { Floor, Item, Vec2, Wall } from '../types';
import { itemCorners, projectOnSegment, dist, wallPolygon, pointInPolygon } from './geometry';

/** Un obstacle est represente par son empreinte au sol (polygone convexe). */
export interface Obstacle {
  id: string;
  label: string;
  poly: Vec2[];
  type: 'item' | 'wall';
}

/** Une mesure d'allee entre deux obstacles. */
export interface AisleGap {
  id: string;
  a: Obstacle;
  b: Obstacle;
  /** Segment le plus court entre les deux empreintes */
  from: Vec2;
  to: Vec2;
  /** Largeur libre en metres */
  width: number;
  /** Vrai si la largeur est inferieure au minimum requis */
  narrow: boolean;
}

export interface CirculationReport {
  gaps: AisleGap[];
  narrowCount: number;
  minWidth: number | null;
}

/** Distance minimale d'un point a un polygone (0 si le point est dedans). */
function pointPolyDistance(p: Vec2, poly: Vec2[]): { d: number; point: Vec2 } {
  if (pointInPolygon(p, poly)) return { d: 0, point: p };
  let best = Infinity;
  let bestPt = poly[0] ?? p;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const pr = projectOnSegment(p, a, b);
    if (pr.distance < best) {
      best = pr.distance;
      bestPt = pr.point;
    }
  }
  return { d: best, point: bestPt };
}

/**
 * Distance minimale entre deux polygones convexes, avec le segment qui la realise.
 * On teste tous les couples sommet/arete dans les deux sens : suffisant et exact
 * pour des polygones convexes disjoints.
 */
export function polyDistance(pa: Vec2[], pb: Vec2[]): { d: number; from: Vec2; to: Vec2 } {
  let best = Infinity;
  let from: Vec2 = pa[0];
  let to: Vec2 = pb[0];
  for (const p of pa) {
    const r = pointPolyDistance(p, pb);
    if (r.d < best) {
      best = r.d;
      from = p;
      to = r.point;
    }
  }
  for (const p of pb) {
    const r = pointPolyDistance(p, pa);
    if (r.d < best) {
      best = r.d;
      from = r.point;
      to = p;
    }
  }
  return { d: best, from, to };
}

/** Les objets bas (paniers, palettes, TPE...) ne definissent pas une allee. */
const IGNORED_FOR_AISLES = new Set(['terminal-paiement', 'panier', 'chariot']);

export function buildObstacles(floor: Floor, includeWalls = true): Obstacle[] {
  const obs: Obstacle[] = [];
  for (const it of floor.items) {
    if (IGNORED_FOR_AISLES.has(it.catalogId)) continue;
    obs.push({ id: it.id, label: it.name, poly: itemCorners(it), type: 'item' });
  }
  if (includeWalls) {
    for (const w of floor.walls) {
      obs.push({ id: w.id, label: w.type === 'wall' ? 'Mur' : 'Cloison', poly: wallPolygon(w), type: 'wall' });
    }
  }
  return obs;
}

/**
 * Verifie que le segment [from, to] ne traverse aucun autre obstacle :
 * sinon la « mesure » saute par dessus un meuble et ne represente pas une allee reelle.
 */
function segmentIsClear(from: Vec2, to: Vec2, obstacles: Obstacle[], skipA: string, skipB: string): boolean {
  const steps = 6;
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const p: Vec2 = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    for (const o of obstacles) {
      if (o.id === skipA || o.id === skipB) continue;
      if (pointInPolygon(p, o.poly)) return false;
    }
  }
  return true;
}

/**
 * Analyse les circulations clients.
 * @param maxGap largeur au dela de laquelle on ne considere plus qu'il s'agit d'une allee
 */
export function analyseCirculation(floor: Floor, minWidth: number, maxGap = 4): CirculationReport {
  const obstacles = buildObstacles(floor);
  const gaps: AisleGap[] = [];

  for (let i = 0; i < obstacles.length; i++) {
    for (let j = i + 1; j < obstacles.length; j++) {
      const a = obstacles[i];
      const b = obstacles[j];
      // Deux murs entre eux ne definissent pas une allee interessante a mesurer
      if (a.type === 'wall' && b.type === 'wall') continue;

      const { d, from, to } = polyDistance(a.poly, b.poly);
      if (d <= 0.001) continue; // en contact ou en collision
      if (d > maxGap) continue;
      if (!segmentIsClear(from, to, obstacles, a.id, b.id)) continue;

      gaps.push({
        id: `${a.id}~${b.id}`,
        a,
        b,
        from,
        to,
        width: d,
        narrow: d < minWidth,
      });
    }
  }

  gaps.sort((x, y) => x.width - y.width);
  const narrowCount = gaps.filter((g) => g.narrow).length;
  return {
    gaps,
    narrowCount,
    minWidth: gaps.length ? gaps[0].width : null,
  };
}

/** Detecte les objets qui se chevauchent (erreur d'implantation). */
export function findCollisions(items: Item[]): Array<[Item, Item]> {
  const out: Array<[Item, Item]> = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const pa = itemCorners(items[i]);
      const pb = itemCorners(items[j]);
      const { d } = polyDistance(pa, pb);
      if (d <= 0.001) {
        // distance nulle : contact ou chevauchement. On confirme par un test de centre.
        if (
          pointInPolygon({ x: items[i].x, y: items[i].y }, pb) ||
          pointInPolygon({ x: items[j].x, y: items[j].y }, pa)
        ) {
          out.push([items[i], items[j]]);
        }
      }
    }
  }
  return out;
}

/** Distance la plus courte entre un objet et les murs (utile pour l'accolement). */
export function distanceToWalls(item: Item, walls: Wall[]): number | null {
  if (!walls.length) return null;
  const poly = itemCorners(item);
  let best = Infinity;
  for (const w of walls) {
    const { d } = polyDistance(poly, wallPolygon(w));
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : null;
}

export const totalItemFootprint = (items: Item[]): number =>
  items.reduce((s, i) => s + i.width * i.depth, 0);

export const linearShelfMeters = (items: Item[]): number =>
  items
    .filter((i) => i.category === 'rayonnage' || i.category === 'froid')
    .reduce((s, i) => s + i.width * (i.shelves ?? 1), 0);

/** Distance simple entre deux points, exposee pour l'outil de mesure. */
export const measure = dist;
