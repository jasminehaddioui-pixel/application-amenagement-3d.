import type { Project, Vec2 } from '../types';
import {
  add,
  dist,
  distToSegment,
  itemCorners,
  mul,
  norm,
  perp,
  pointInItem,
  pointInPolygon,
  projectOnSegment,
  sub,
  wallDir,
  wallLength,
  wallPolygon,
} from '../lib/geometry';

export type HandleKind =
  | { type: 'wall-end'; id: string; end: 'a' | 'b' }
  | { type: 'item-corner'; id: string; index: number }
  | { type: 'item-rotate'; id: string }
  | { type: 'zone-point'; id: string; index: number }
  | { type: 'dimension-end'; id: string; end: 'a' | 'b' };

export interface HitResult {
  id: string;
  kind: 'wall' | 'opening' | 'column' | 'zone' | 'item' | 'dimension';
}

/** Poignee de manipulation sous le curseur, pour la selection courante. */
export function hitHandle(
  project: Project,
  p: Vec2,
  selection: Set<string>,
  tol: number,
): HandleKind | null {
  for (const id of selection) {
    const it = project.floor.items.find((x) => x.id === id);
    if (it) {
      const corners = itemCorners(it);
      const midTop = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
      const dir = norm(sub(midTop, { x: it.x, y: it.y }));
      const rotHandle = add(midTop, mul(dir, 0.45));
      if (dist(p, rotHandle) <= tol) return { type: 'item-rotate', id };
      for (let i = 0; i < corners.length; i++) {
        if (dist(p, corners[i]) <= tol) return { type: 'item-corner', id, index: i };
      }
      continue;
    }
    const w = project.floor.walls.find((x) => x.id === id);
    if (w) {
      if (dist(p, w.a) <= tol) return { type: 'wall-end', id, end: 'a' };
      if (dist(p, w.b) <= tol) return { type: 'wall-end', id, end: 'b' };
      continue;
    }
    const z = project.floor.zones.find((x) => x.id === id);
    if (z) {
      for (let i = 0; i < z.points.length; i++) {
        if (dist(p, z.points[i]) <= tol) return { type: 'zone-point', id, index: i };
      }
      continue;
    }
    const d = project.floor.dimensions.find((x) => x.id === id);
    if (d) {
      if (dist(p, d.a) <= tol) return { type: 'dimension-end', id, end: 'a' };
      if (dist(p, d.b) <= tol) return { type: 'dimension-end', id, end: 'b' };
    }
  }
  return null;
}

/**
 * Element sous le curseur. L'ordre de test suit la lisibilite d'un plan :
 * ouvertures, objets, poteaux, murs, cotations, puis zones (fond).
 */
export function hitTest(project: Project, p: Vec2, tol: number): HitResult | null {
  const { floor } = project;

  // Ouvertures : on teste la portion de mur qu'elles occupent.
  for (let i = floor.openings.length - 1; i >= 0; i--) {
    const o = floor.openings[i];
    const w = floor.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const d = wallDir(w);
    const c = add(w.a, mul(d, o.offset));
    const local = { x: p.x - c.x, y: p.y - c.y };
    const along = local.x * d.x + local.y * d.y;
    const n = perp(d);
    const across = local.x * n.x + local.y * n.y;
    if (Math.abs(along) <= o.width / 2 && Math.abs(across) <= w.thickness / 2 + tol) {
      return { id: o.id, kind: 'opening' };
    }
  }

  for (let i = floor.items.length - 1; i >= 0; i--) {
    if (pointInItem(p, floor.items[i])) return { id: floor.items[i].id, kind: 'item' };
  }

  for (let i = floor.columns.length - 1; i >= 0; i--) {
    const c = floor.columns[i];
    if (c.shape === 'round') {
      if (dist(p, { x: c.x, y: c.y }) <= c.width / 2 + tol * 0.5) return { id: c.id, kind: 'column' };
    } else if (pointInItem(p, { x: c.x, y: c.y, width: c.width, depth: c.depth, rotation: c.rotation })) {
      return { id: c.id, kind: 'column' };
    }
  }

  for (let i = floor.walls.length - 1; i >= 0; i--) {
    const w = floor.walls[i];
    if (pointInPolygon(p, wallPolygon(w)) || distToSegment(p, w.a, w.b) <= w.thickness / 2 + tol) {
      return { id: w.id, kind: 'wall' };
    }
  }

  for (let i = floor.dimensions.length - 1; i >= 0; i--) {
    const d = floor.dimensions[i];
    const n = perp(norm(sub(d.b, d.a)));
    const a2 = add(d.a, mul(n, d.offset));
    const b2 = add(d.b, mul(n, d.offset));
    if (distToSegment(p, a2, b2) <= tol) return { id: d.id, kind: 'dimension' };
  }

  for (let i = floor.zones.length - 1; i >= 0; i--) {
    if (pointInPolygon(p, floor.zones[i].points)) return { id: floor.zones[i].id, kind: 'zone' };
  }

  return null;
}

/** Tous les elements dont un point caracteristique tombe dans le rectangle. */
export function hitRect(project: Project, a: Vec2, b: Vec2): string[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const inside = (p: Vec2) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  const ids: string[] = [];
  project.floor.walls.forEach((w) => {
    if (inside(w.a) && inside(w.b)) ids.push(w.id);
  });
  project.floor.items.forEach((i) => {
    if (inside({ x: i.x, y: i.y })) ids.push(i.id);
  });
  project.floor.columns.forEach((c) => {
    if (inside({ x: c.x, y: c.y })) ids.push(c.id);
  });
  project.floor.zones.forEach((z) => {
    if (z.points.every(inside)) ids.push(z.id);
  });
  project.floor.dimensions.forEach((d) => {
    if (inside(d.a) && inside(d.b)) ids.push(d.id);
  });
  return ids;
}

/**
 * Points d'accrochage remarquables : extremites et milieux de murs, sommets
 * de zones, coins d'objets. Renvoie le plus proche dans le rayon donne.
 */
export function snapPoint(project: Project, p: Vec2, radius: number, ignoreIds: Set<string> = new Set()): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = radius;
  const consider = (q: Vec2) => {
    const d = dist(p, q);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  };
  for (const w of project.floor.walls) {
    if (ignoreIds.has(w.id)) continue;
    consider(w.a);
    consider(w.b);
    consider({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
    // Projection perpendiculaire sur l'axe du mur : permet de tracer aligne.
    const pr = projectOnSegment(p, w.a, w.b);
    if (pr.distance < bestD * 0.6) consider(pr.point);
  }
  for (const z of project.floor.zones) {
    if (ignoreIds.has(z.id)) continue;
    z.points.forEach(consider);
  }
  for (const it of project.floor.items) {
    if (ignoreIds.has(it.id)) continue;
    itemCorners(it).forEach(consider);
  }
  return best;
}

/** Mur le plus proche, pour poser une porte ou une fenetre. */
export function wallUnder(project: Project, p: Vec2, tol: number) {
  let best: { wallId: string; offset: number; d: number } | null = null;
  for (const w of project.floor.walls) {
    const pr = projectOnSegment(p, w.a, w.b);
    const limit = w.thickness / 2 + tol;
    if (pr.distance <= limit && (!best || pr.distance < best.d)) {
      best = { wallId: w.id, offset: pr.t * wallLength(w), d: pr.distance };
    }
  }
  return best;
}
