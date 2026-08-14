import type { Camera2D, Draft } from '../state/store';
import type { Column, Item, Project, Vec2, Wall, Zone } from '../types';
import type { CirculationReport } from '../lib/circulation';
import {
  add,
  fmtM,
  fmtM2,
  itemCorners,
  mul,
  norm,
  perp,
  pointOnWall,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  sub,
  wallDir,
  wallLength,
  wallPolygon,
} from '../lib/geometry';

export interface Viewport {
  width: number;
  height: number;
}

export interface RenderOptions {
  viewport: Viewport;
  camera: Camera2D;
  project: Project;
  selection: Set<string>;
  hover: string | null;
  draft: Draft | null;
  circulation: CirculationReport | null;
  backgroundImage: HTMLImageElement | null;
  /** 'screen' : fond sombre neutre ; 'print' : fond blanc, traits noirs */
  theme: 'screen' | 'print';
  /** Affiche les poignees de selection (desactive a l'export) */
  showHandles: boolean;
  /** Rectangle de selection en cours (coordonnees monde) */
  marquee: { a: Vec2; b: Vec2 } | null;
}

interface Palette {
  bg: string;
  grid: string;
  gridStrong: string;
  wall: string;
  wallStroke: string;
  wallExisting: string;
  partition: string;
  column: string;
  text: string;
  textMuted: string;
  dim: string;
  accent: string;
  danger: string;
  ok: string;
  floor: string;
}

const SCREEN: Palette = {
  bg: '#12161c',
  grid: 'rgba(255,255,255,0.045)',
  gridStrong: 'rgba(255,255,255,0.11)',
  wall: '#cdd4dc',
  wallStroke: '#eef2f6',
  wallExisting: '#8fbf7f',
  partition: '#9aa4af',
  column: '#b9c2cc',
  text: '#e8edf2',
  textMuted: '#93a0ad',
  dim: '#6fb3ff',
  accent: '#4c8bf5',
  danger: '#ff5f56',
  ok: '#38c172',
  floor: '#1b2029',
};

const PRINT: Palette = {
  bg: '#ffffff',
  grid: 'rgba(0,0,0,0.05)',
  gridStrong: 'rgba(0,0,0,0.12)',
  wall: '#2b2b2b',
  wallStroke: '#000000',
  wallExisting: '#2f6b34',
  partition: '#666666',
  column: '#2b2b2b',
  text: '#111111',
  textMuted: '#555555',
  dim: '#1a4f9c',
  accent: '#1a4f9c',
  danger: '#c0392b',
  ok: '#1e7e34',
  floor: '#ffffff',
};

// --------------------------------------------------------------- conversions

export function worldToScreen(p: Vec2, cam: Camera2D, vp: Viewport): Vec2 {
  return {
    x: (p.x - cam.x) * cam.zoom + vp.width / 2,
    y: (p.y - cam.y) * cam.zoom + vp.height / 2,
  };
}

export function screenToWorld(p: Vec2, cam: Camera2D, vp: Viewport): Vec2 {
  return {
    x: (p.x - vp.width / 2) / cam.zoom + cam.x,
    y: (p.y - vp.height / 2) / cam.zoom + cam.y,
  };
}

/** Fenetre du monde actuellement visible. */
export function visibleWorld(cam: Camera2D, vp: Viewport) {
  const tl = screenToWorld({ x: 0, y: 0 }, cam, vp);
  const br = screenToWorld({ x: vp.width, y: vp.height }, cam, vp);
  return { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
}

// ------------------------------------------------------------------ helpers

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  at: Vec2,
  pal: Palette,
  opts: { size?: number; bg?: string; color?: string; align?: CanvasTextAlign } = {},
): void {
  const size = opts.size ?? 12;
  ctx.save();
  ctx.font = `${size}px "Segoe UI", system-ui, -apple-system, sans-serif`;
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width;
  const padX = 4;
  const padY = 3;
  const bx = opts.align === 'left' ? at.x - padX : at.x - w / 2 - padX;
  ctx.fillStyle = opts.bg ?? (pal === SCREEN ? 'rgba(18,22,28,0.82)' : 'rgba(255,255,255,0.88)');
  ctx.fillRect(bx, at.y - size / 2 - padY, w + padX * 2, size + padY * 2);
  ctx.fillStyle = opts.color ?? pal.text;
  ctx.fillText(text, at.x, at.y);
  ctx.restore();
}

function polyPath(ctx: CanvasRenderingContext2D, pts: Vec2[], cam: Camera2D, vp: Viewport): void {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = worldToScreen(p, cam, vp);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
}

function line(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, cam: Camera2D, vp: Viewport): void {
  const sa = worldToScreen(a, cam, vp);
  const sb = worldToScreen(b, cam, vp);
  ctx.beginPath();
  ctx.moveTo(sa.x, sa.y);
  ctx.lineTo(sb.x, sb.y);
  ctx.stroke();
}

// -------------------------------------------------------------------- layers

function drawGrid(ctx: CanvasRenderingContext2D, o: RenderOptions, pal: Palette): void {
  const { camera: cam, viewport: vp, project } = o;
  if (!project.settings.showGrid) return;
  let step = project.settings.gridSize;
  // On evite une grille illisible quand on dezoome fortement.
  while (step * cam.zoom < 8) step *= 2;
  const w = visibleWorld(cam, vp);
  ctx.lineWidth = 1;

  const startX = Math.floor(w.x0 / step) * step;
  const startY = Math.floor(w.y0 / step) * step;

  for (let x = startX; x <= w.x1; x += step) {
    const isMeter = Math.abs(x / 1 - Math.round(x / 1)) < 1e-6;
    ctx.strokeStyle = isMeter ? pal.gridStrong : pal.grid;
    const s = worldToScreen({ x, y: 0 }, cam, vp);
    ctx.beginPath();
    ctx.moveTo(Math.round(s.x) + 0.5, 0);
    ctx.lineTo(Math.round(s.x) + 0.5, vp.height);
    ctx.stroke();
  }
  for (let y = startY; y <= w.y1; y += step) {
    const isMeter = Math.abs(y / 1 - Math.round(y / 1)) < 1e-6;
    ctx.strokeStyle = isMeter ? pal.gridStrong : pal.grid;
    const s = worldToScreen({ x: 0, y }, cam, vp);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(s.y) + 0.5);
    ctx.lineTo(vp.width, Math.round(s.y) + 0.5);
    ctx.stroke();
  }

  // Origine du repere
  const o0 = worldToScreen({ x: 0, y: 0 }, cam, vp);
  ctx.strokeStyle = pal.gridStrong;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(o0.x - 8, o0.y);
  ctx.lineTo(o0.x + 8, o0.y);
  ctx.moveTo(o0.x, o0.y - 8);
  ctx.lineTo(o0.x, o0.y + 8);
  ctx.stroke();
}

function drawBackground(ctx: CanvasRenderingContext2D, o: RenderOptions): void {
  const bg = o.project.background;
  if (!bg || !bg.visible || !o.backgroundImage) return;
  const { camera: cam, viewport: vp } = o;
  const tl = worldToScreen({ x: bg.x, y: bg.y }, cam, vp);
  const w = bg.pxWidth * bg.scale * cam.zoom;
  const h = bg.pxHeight * bg.scale * cam.zoom;
  ctx.save();
  ctx.globalAlpha = bg.opacity;
  ctx.translate(tl.x, tl.y);
  ctx.rotate((bg.rotation * Math.PI) / 180);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(o.backgroundImage, 0, 0, w, h);
  ctx.restore();
}

/** Carrelage existant conserve : trame de carreaux sous le plan. */
function drawTiles(ctx: CanvasRenderingContext2D, o: RenderOptions, pal: Palette): void {
  const ex = o.project.existing;
  if (!ex.carrelage) return;
  const walls = o.project.floor.walls;
  if (!walls.length) return;
  const pts: Vec2[] = [];
  walls.forEach((w) => wallPolygon(w).forEach((p) => pts.push(p)));
  const b = polygonBounds(pts);
  const size = Math.max(0.05, ex.carrelageTileSize);
  const { camera: cam, viewport: vp } = o;

  ctx.save();
  const tl = worldToScreen({ x: b.x, y: b.y }, cam, vp);
  ctx.beginPath();
  ctx.rect(tl.x, tl.y, b.width * cam.zoom, b.height * cam.zoom);
  ctx.clip();
  ctx.fillStyle = ex.carrelageColor;
  ctx.globalAlpha = o.theme === 'print' ? 0.12 : 0.16;
  ctx.fillRect(tl.x, tl.y, b.width * cam.zoom, b.height * cam.zoom);
  ctx.globalAlpha = o.theme === 'print' ? 0.35 : 0.3;
  ctx.strokeStyle = pal.textMuted;
  ctx.lineWidth = 0.6;
  for (let x = b.x; x <= b.x + b.width + size; x += size) {
    const s = worldToScreen({ x, y: 0 }, cam, vp);
    ctx.beginPath();
    ctx.moveTo(s.x, tl.y);
    ctx.lineTo(s.x, tl.y + b.height * cam.zoom);
    ctx.stroke();
  }
  for (let y = b.y; y <= b.y + b.height + size; y += size) {
    const s = worldToScreen({ x: 0, y }, cam, vp);
    ctx.beginPath();
    ctx.moveTo(tl.x, s.y);
    ctx.lineTo(tl.x + b.width * cam.zoom, s.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawZone(ctx: CanvasRenderingContext2D, z: Zone, o: RenderOptions, pal: Palette): void {
  if (z.points.length < 3) return;
  const { camera: cam, viewport: vp } = o;
  const selected = o.selection.has(z.id);
  polyPath(ctx, z.points, cam, vp);
  ctx.save();
  ctx.globalAlpha = o.theme === 'print' ? Math.min(0.18, z.opacity) : z.opacity;
  ctx.fillStyle = z.color;
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = selected ? 2.5 : 1.4;
  ctx.setLineDash(selected ? [] : [7, 5]);
  ctx.strokeStyle = selected ? pal.accent : z.color;
  ctx.stroke();
  ctx.setLineDash([]);

  const c = worldToScreen(polygonCentroid(z.points), cam, vp);
  const area = polygonArea(z.points);
  label(ctx, z.name, { x: c.x, y: c.y - 8 }, pal, { size: 13, color: pal.text });
  label(ctx, fmtM2(area), { x: c.x, y: c.y + 10 }, pal, { size: 11, color: pal.textMuted });
}

/**
 * Dessine un mur avec ses ouvertures reellement percees : le corps du mur est
 * peint par troncons pleins entre les baies, puis chaque baie recoit sa
 * symbolique (arc de porte, double trait de fenetre).
 */
function drawWall(ctx: CanvasRenderingContext2D, w: Wall, o: RenderOptions, pal: Palette): void {
  const { camera: cam, viewport: vp } = o;
  const selected = o.selection.has(w.id);
  const hovered = o.hover === w.id;
  const openings = o.project.floor.openings.filter((op) => op.wallId === w.id);

  const L = wallLength(w);
  const d = wallDir(w);
  const n = perp(d);
  const half = w.thickness / 2;

  // Le mur est peint par troncons pleins, entre les baies : le percement est
  // reellement ajoure, ce qui laisse voir le plan importe au travers.
  const holes = openings
    .map((op) => [Math.max(0, op.offset - op.width / 2), Math.min(L, op.offset + op.width / 2)] as const)
    .filter(([s, e]) => e > s)
    .sort((x, y) => x[0] - y[0]);
  const solids: Array<[number, number]> = [];
  let cursor = 0;
  for (const [s, e] of holes) {
    if (s > cursor) solids.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < L) solids.push([cursor, L]);

  ctx.fillStyle = w.existing ? pal.wallExisting : w.type === 'partition' ? pal.partition : pal.wall;
  ctx.lineWidth = selected ? 2.5 : hovered ? 2 : 1.2;
  ctx.strokeStyle = selected ? pal.accent : pal.wallStroke;
  for (const [s, e] of solids) {
    const p1 = add(w.a, mul(d, s));
    const p2 = add(w.a, mul(d, e));
    polyPath(ctx, [add(p1, mul(n, half)), add(p2, mul(n, half)), sub(p2, mul(n, half)), sub(p1, mul(n, half))], cam, vp);
    ctx.globalAlpha = w.type === 'partition' ? 0.85 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  }

  for (const op of openings) {
    const c = pointOnWall(w, op.offset);
    const hw = op.width / 2;
    const p1 = add(c, mul(d, -hw));
    const p2 = add(c, mul(d, hw));

    if (op.type === 'door') {
      // Vantail + arc de debattement
      const hinge = op.flip ? p2 : p1;
      const dir = op.flip ? mul(d, -1) : d;
      const swing = add(hinge, mul(perp(dir), op.width));
      ctx.strokeStyle = o.selection.has(op.id) ? pal.accent : pal.wallStroke;
      ctx.lineWidth = o.selection.has(op.id) ? 2.2 : 1.4;
      line(ctx, hinge, swing, cam, vp);
      const sh = worldToScreen(hinge, cam, vp);
      const r = op.width * cam.zoom;
      const a0 = Math.atan2(dir.y, dir.x);
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.arc(sh.x, sh.y, r, a0, a0 + Math.PI / 2, false);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (op.type === 'sliding') {
      // Porte vitree automatique : rail continu, puis les deux vantaux
      // representes ouverts, effaces de part et d'autre de la baie.
      const sel = o.selection.has(op.id);
      ctx.strokeStyle = sel ? pal.accent : pal.dim;
      ctx.lineWidth = sel ? 2.2 : 1.2;
      ctx.setLineDash([5, 3]);
      line(ctx, add(p1, mul(n, half)), add(p2, mul(n, half)), cam, vp);
      ctx.setLineDash([]);
      // Chaque vantail fait la moitie de la baie et coulisse vers son cote.
      ctx.strokeStyle = sel ? pal.accent : pal.wallStroke;
      ctx.lineWidth = sel ? 3.2 : 2.6;
      const leaf = op.width / 2;
      const off = mul(n, half * 0.35);
      line(ctx, add(p1, off), add(add(p1, mul(d, leaf * 0.9)), off), cam, vp);
      line(ctx, sub(p2, mul(d, leaf * 0.9)), p2, cam, vp);
      // Le trait du second vantail est ramene sur l'autre face du mur.
      ctx.lineWidth = sel ? 3.2 : 2.6;
      line(ctx, sub(add(p2, mul(d, 0)), off), sub(sub(p2, mul(d, leaf * 0.9)), off), cam, vp);
    } else {
      // Fenetre / vitrine : double trait dans l'epaisseur
      ctx.strokeStyle = o.selection.has(op.id) ? pal.accent : pal.dim;
      ctx.lineWidth = o.selection.has(op.id) ? 2.2 : 1.5;
      line(ctx, add(p1, mul(n, half * 0.45)), add(p2, mul(n, half * 0.45)), cam, vp);
      line(ctx, sub(p1, mul(n, half * 0.45)), sub(p2, mul(n, half * 0.45)), cam, vp);
    }

    if (op.existing) {
      const sc = worldToScreen(c, cam, vp);
      label(ctx, 'existant', { x: sc.x, y: sc.y - 14 }, pal, { size: 9, color: pal.ok });
    }
  }
}

function drawColumn(ctx: CanvasRenderingContext2D, c: Column, o: RenderOptions, pal: Palette): void {
  const { camera: cam, viewport: vp } = o;
  const selected = o.selection.has(c.id);
  ctx.fillStyle = c.existing ? pal.wallExisting : pal.column;
  ctx.strokeStyle = selected ? pal.accent : pal.wallStroke;
  ctx.lineWidth = selected ? 2.5 : 1.2;
  if (c.shape === 'round') {
    const s = worldToScreen({ x: c.x, y: c.y }, cam, vp);
    ctx.beginPath();
    ctx.arc(s.x, s.y, (c.width / 2) * cam.zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    polyPath(ctx, itemCorners({ x: c.x, y: c.y, width: c.width, depth: c.depth, rotation: c.rotation }), cam, vp);
    ctx.fill();
    ctx.stroke();
  }
}

/** Symbolique 2D d'un objet du mobilier. */
function drawItem(ctx: CanvasRenderingContext2D, it: Item, o: RenderOptions, pal: Palette): void {
  const { camera: cam, viewport: vp } = o;
  const selected = o.selection.has(it.id);
  const hovered = o.hover === it.id;
  const corners = itemCorners(it);

  polyPath(ctx, corners, cam, vp);
  ctx.fillStyle = it.color;
  ctx.globalAlpha = o.theme === 'print' ? 0.45 : 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = selected ? 2.5 : hovered ? 2 : 1.2;
  ctx.strokeStyle = selected ? pal.accent : o.theme === 'print' ? '#333' : 'rgba(255,255,255,0.65)';
  ctx.stroke();

  // Trait sur la face avant (cote client) : oriente la lecture du plan.
  const front: [Vec2, Vec2] = [corners[3], corners[2]];
  ctx.strokeStyle = o.theme === 'print' ? '#000' : '#ffffff';
  ctx.lineWidth = 2;
  line(ctx, front[0], front[1], cam, vp);

  // Nervures d'etageres pour le rayonnage et le froid
  if ((it.category === 'rayonnage' || it.category === 'froid') && it.width * cam.zoom > 30) {
    const n = Math.max(2, Math.round(it.width / 0.45));
    ctx.strokeStyle = o.theme === 'print' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const a = add(corners[0], mul(sub(corners[1], corners[0]), t));
      const b = add(corners[3], mul(sub(corners[2], corners[3]), t));
      line(ctx, a, b, cam, vp);
    }
  }

  const c = worldToScreen({ x: it.x, y: it.y }, cam, vp);
  if (it.width * cam.zoom > 46 && it.depth * cam.zoom > 18) {
    label(ctx, it.name, c, pal, { size: 10, color: pal.text });
  }
}

/** Ligne de cote avec fleches et texte. */
function drawDimensionLine(
  ctx: CanvasRenderingContext2D,
  a: Vec2,
  b: Vec2,
  offset: number,
  o: RenderOptions,
  pal: Palette,
  color = pal.dim,
  text?: string,
): void {
  const { camera: cam, viewport: vp } = o;
  const d = norm(sub(b, a));
  if (!Number.isFinite(d.x) || (d.x === 0 && d.y === 0)) return;
  const n = perp(d);
  const oa = add(a, mul(n, offset));
  const ob = add(b, mul(n, offset));
  const sa = worldToScreen(oa, cam, vp);
  const sb = worldToScreen(ob, cam, vp);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.1;
  // Lignes d'attache
  ctx.setLineDash([3, 3]);
  line(ctx, a, oa, cam, vp);
  line(ctx, b, ob, cam, vp);
  ctx.setLineDash([]);
  // Ligne de cote
  ctx.beginPath();
  ctx.moveTo(sa.x, sa.y);
  ctx.lineTo(sb.x, sb.y);
  ctx.stroke();

  // Fleches
  const ang = Math.atan2(sb.y - sa.y, sb.x - sa.x);
  const arrow = 6;
  for (const [pt, dir] of [
    [sa, ang],
    [sb, ang + Math.PI],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.lineTo(pt.x + Math.cos(dir - 0.35) * arrow, pt.y + Math.sin(dir - 0.35) * arrow);
    ctx.lineTo(pt.x + Math.cos(dir + 0.35) * arrow, pt.y + Math.sin(dir + 0.35) * arrow);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();

  const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
  label(ctx, text ?? fmtM(Math.hypot(b.x - a.x, b.y - a.y)), mid, pal, { size: 11, color });
}

/** Cotations automatiques : longueur de chaque mur, cote exterieur. */
function drawAutoDimensions(ctx: CanvasRenderingContext2D, o: RenderOptions, pal: Palette): void {
  if (!o.project.settings.showDimensions) return;
  const walls = o.project.floor.walls;
  if (!walls.length) return;
  // Le centre du plan sert a determiner de quel cote deporter la cote.
  const pts: Vec2[] = [];
  walls.forEach((w) => pts.push(w.a, w.b));
  const b = polygonBounds(pts);
  const center: Vec2 = { x: b.x + b.width / 2, y: b.y + b.height / 2 };

  for (const w of walls) {
    const L = wallLength(w);
    if (L < 0.2 || L * o.camera.zoom < 34) continue;
    const mid: Vec2 = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
    const n = perp(wallDir(w));
    const outward = (mid.x - center.x) * n.x + (mid.y - center.y) * n.y >= 0 ? 1 : -1;
    const off = outward * (w.thickness / 2 + 0.45);
    drawDimensionLine(ctx, w.a, w.b, off, o, pal, pal.dim);
  }
}

function drawCirculation(ctx: CanvasRenderingContext2D, o: RenderOptions, pal: Palette): void {
  const rep = o.circulation;
  if (!rep || !o.project.settings.showCirculation) return;
  for (const g of rep.gaps) {
    const color = g.narrow ? pal.danger : pal.ok;
    const { camera: cam, viewport: vp } = o;
    const sa = worldToScreen(g.from, cam, vp);
    const sb = worldToScreen(g.to, cam, vp);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = g.narrow ? 2.4 : 1.4;
    ctx.setLineDash(g.narrow ? [] : [5, 4]);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Traits d'about
    const d = norm(sub(g.to, g.from));
    const n = perp(d);
    for (const p of [g.from, g.to]) {
      const s1 = worldToScreen(add(p, mul(n, 0.12)), cam, vp);
      const s2 = worldToScreen(sub(p, mul(n, 0.12)), cam, vp);
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
    }
    ctx.restore();
    const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
    label(ctx, fmtM(g.width), mid, pal, { size: 11, color });
  }
}

function drawDraft(ctx: CanvasRenderingContext2D, o: RenderOptions, pal: Palette): void {
  const d = o.draft;
  if (!d || !d.cursor) return;
  const { camera: cam, viewport: vp } = o;
  ctx.save();
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);

  if ((d.tool === 'wall' || d.tool === 'partition') && d.points.length) {
    const a = d.points[d.points.length - 1];
    line(ctx, a, d.cursor, cam, vp);
    const mid = worldToScreen({ x: (a.x + d.cursor.x) / 2, y: (a.y + d.cursor.y) / 2 }, cam, vp);
    const L = Math.hypot(d.cursor.x - a.x, d.cursor.y - a.y);
    const ang = (Math.atan2(d.cursor.y - a.y, d.cursor.x - a.x) * 180) / Math.PI;
    label(ctx, `${fmtM(L)}  ·  ${ang.toFixed(0)}°`, { x: mid.x, y: mid.y - 14 }, pal, {
      size: 12,
      color: pal.accent,
    });
    // Segments deja poses de la polyligne
    ctx.setLineDash([]);
    for (let i = 0; i < d.points.length - 1; i++) line(ctx, d.points[i], d.points[i + 1], cam, vp);
  }

  if (d.tool === 'zone' && d.points.length) {
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    const pts = [...d.points, d.cursor];
    pts.forEach((p, i) => {
      const s = worldToScreen(p, cam, vp);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
    if (pts.length > 2) {
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = pal.accent;
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  if ((d.tool === 'dimension' || d.tool === 'calibrate' || d.tool === 'measure') && d.points.length) {
    const a = d.points[0];
    ctx.setLineDash([]);
    line(ctx, a, d.cursor, cam, vp);
    const mid = worldToScreen({ x: (a.x + d.cursor.x) / 2, y: (a.y + d.cursor.y) / 2 }, cam, vp);
    const L = Math.hypot(d.cursor.x - a.x, d.cursor.y - a.y);
    const txt =
      d.tool === 'calibrate' ? `${L.toFixed(3)} m mesurés` : fmtM(L);
    label(ctx, txt, { x: mid.x, y: mid.y - 14 }, pal, { size: 12, color: pal.accent });
  }

  // Reticule
  const sc = worldToScreen(d.cursor, cam, vp);
  ctx.setLineDash([]);
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(sc.x, sc.y, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSelectionHandles(ctx: CanvasRenderingContext2D, o: RenderOptions, pal: Palette): void {
  if (!o.showHandles || !o.selection.size) return;
  const { camera: cam, viewport: vp, project } = o;
  const drawHandle = (p: Vec2, kind: 'square' | 'circle' = 'square') => {
    const s = worldToScreen(p, cam, vp);
    ctx.fillStyle = pal.bg;
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (kind === 'circle') ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
    else ctx.rect(s.x - 4.5, s.y - 4.5, 9, 9);
    ctx.fill();
    ctx.stroke();
  };

  for (const id of o.selection) {
    const w = project.floor.walls.find((x) => x.id === id);
    if (w) {
      drawHandle(w.a, 'circle');
      drawHandle(w.b, 'circle');
      continue;
    }
    const it = project.floor.items.find((x) => x.id === id);
    if (it) {
      itemCorners(it).forEach((c) => drawHandle(c));
      // Poignee de rotation, au-dessus de la face arriere
      const corners = itemCorners(it);
      const midTop = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
      const dir = norm(sub(midTop, { x: it.x, y: it.y }));
      const handle = add(midTop, mul(dir, 0.45));
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      line(ctx, midTop, handle, cam, vp);
      ctx.setLineDash([]);
      drawHandle(handle, 'circle');
      continue;
    }
    const z = project.floor.zones.find((x) => x.id === id);
    if (z) {
      z.points.forEach((p) => drawHandle(p));
      continue;
    }
    const c = project.floor.columns.find((x) => x.id === id);
    if (c) {
      itemCorners({ x: c.x, y: c.y, width: c.width, depth: c.depth, rotation: c.rotation }).forEach((p) =>
        drawHandle(p),
      );
      continue;
    }
    const dm = project.floor.dimensions.find((x) => x.id === id);
    if (dm) {
      drawHandle(dm.a, 'circle');
      drawHandle(dm.b, 'circle');
    }
  }
}

function drawMarquee(ctx: CanvasRenderingContext2D, o: RenderOptions, pal: Palette): void {
  if (!o.marquee) return;
  const a = worldToScreen(o.marquee.a, o.camera, o.viewport);
  const b = worldToScreen(o.marquee.b, o.camera, o.viewport);
  ctx.save();
  ctx.fillStyle = 'rgba(76,139,245,0.14)';
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.restore();
}

/** Barre d'echelle graphique, en bas a gauche. */
function drawScaleBar(ctx: CanvasRenderingContext2D, o: RenderOptions, pal: Palette): void {
  const { camera: cam, viewport: vp } = o;
  const targetPx = 130;
  const candidates = [0.5, 1, 2, 5, 10, 20, 50, 100];
  let meters = candidates[candidates.length - 1];
  for (const c of candidates) {
    if (c * cam.zoom >= targetPx * 0.6) {
      meters = c;
      break;
    }
  }
  const px = meters * cam.zoom;
  const x = 18;
  const y = vp.height - 26;
  ctx.save();
  ctx.strokeStyle = pal.text;
  ctx.fillStyle = pal.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x, y + 5);
  ctx.moveTo(x, y);
  ctx.lineTo(x + px, y);
  ctx.moveTo(x + px, y - 5);
  ctx.lineTo(x + px, y + 5);
  ctx.stroke();
  ctx.font = '11px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${meters} m`, x + px + 8, y + 5);
  ctx.restore();
}

// ------------------------------------------------------------------ entree

export function renderPlan(ctx: CanvasRenderingContext2D, o: RenderOptions): void {
  const pal = o.theme === 'print' ? PRINT : SCREEN;
  const { viewport: vp, project } = o;

  ctx.save();
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, vp.width, vp.height);

  drawGrid(ctx, o, pal);
  drawBackground(ctx, o);
  drawTiles(ctx, o, pal);

  project.floor.zones.forEach((z) => drawZone(ctx, z, o, pal));
  project.floor.walls.forEach((w) => drawWall(ctx, w, o, pal));
  project.floor.columns.forEach((c) => drawColumn(ctx, c, o, pal));
  project.floor.items.forEach((i) => drawItem(ctx, i, o, pal));

  drawAutoDimensions(ctx, o, pal);
  project.floor.dimensions.forEach((d) =>
    drawDimensionLine(ctx, d.a, d.b, d.offset, o, pal, o.selection.has(d.id) ? pal.accent : pal.dim, d.label),
  );

  drawCirculation(ctx, o, pal);
  drawDraft(ctx, o, pal);
  drawMarquee(ctx, o, pal);
  drawSelectionHandles(ctx, o, pal);
  drawScaleBar(ctx, o, pal);

  ctx.restore();
}

export { SCREEN as SCREEN_PALETTE, PRINT as PRINT_PALETTE };
