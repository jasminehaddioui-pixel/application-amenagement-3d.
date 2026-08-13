import * as THREE from 'three';
import type { Item, Opening, Project, Vec2, Wall } from '../types';
import { catalogEntry, type Item3DStyle } from '../lib/catalog';
import { polygonBounds, wallLength, wallPolygon } from '../lib/geometry';

/**
 * Generation du modele 3D a partir du plan 2D.
 *
 * Convention : le plan (x, y) devient (x, -y) au sol dans la scene three.js,
 * l'axe Y de three.js portant la hauteur. Ce miroir conserve l'orientation
 * visuelle du plan quand on regarde la scene depuis le dessus.
 */

export const planToWorld = (p: Vec2, height = 0): THREE.Vector3 => new THREE.Vector3(p.x, height, p.y);

/** Toutes les ressources GPU creees, pour pouvoir les liberer au rebuild. */
export interface BuiltScene {
  root: THREE.Group;
  bounds: THREE.Box3;
  dispose: () => void;
}

class ResourceTracker {
  private geometries = new Set<THREE.BufferGeometry>();
  private materials = new Set<THREE.Material>();
  private textures = new Set<THREE.Texture>();

  geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.add(g);
    return g;
  }
  mat<T extends THREE.Material>(m: T): T {
    this.materials.add(m);
    return m;
  }
  tex<T extends THREE.Texture>(t: T): T {
    this.textures.add(t);
    return t;
  }
  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
  }
}

/** Texture de carrelage generee : couleur + joints. */
function tileTexture(track: ResourceTracker, color: string, tileMeters: number, extentMeters: number): THREE.Texture {
  const px = 512;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, px, px);
  // Legere variation pour eviter un aplat trop synthetique
  ctx.fillStyle = 'rgba(0,0,0,0.03)';
  for (let i = 0; i < 400; i++) {
    ctx.fillRect(Math.random() * px, Math.random() * px, 2, 2);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, px, px);
  const tex = track.tex(new THREE.CanvasTexture(c));
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  const repeat = Math.max(1, extentMeters / Math.max(0.05, tileMeters));
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Segments pleins d'un mur, en tenant compte des ouvertures.
 * Chaque segment est decrit par [debut, fin] le long du mur, et une plage de hauteur.
 */
interface WallChunk {
  from: number;
  to: number;
  yFrom: number;
  yTo: number;
}

export function wallChunks(wall: Wall, openings: Opening[]): WallChunk[] {
  const L = wallLength(wall);
  const H = wall.height;
  const ops = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => ({
      from: Math.max(0, o.offset - o.width / 2),
      to: Math.min(L, o.offset + o.width / 2),
      sill: Math.max(0, o.sill),
      top: Math.min(H, o.sill + o.height),
    }))
    .filter((o) => o.to > o.from)
    .sort((a, b) => a.from - b.from);

  const chunks: WallChunk[] = [];
  let cursor = 0;
  for (const o of ops) {
    if (o.from > cursor) chunks.push({ from: cursor, to: o.from, yFrom: 0, yTo: H });
    // Allege sous une fenetre
    if (o.sill > 0.001) chunks.push({ from: o.from, to: o.to, yFrom: 0, yTo: o.sill });
    // Linteau au-dessus de la baie
    if (o.top < H - 0.001) chunks.push({ from: o.from, to: o.to, yFrom: o.top, yTo: H });
    cursor = Math.max(cursor, o.to);
  }
  if (cursor < L) chunks.push({ from: cursor, to: L, yFrom: 0, yTo: H });
  return chunks.filter((c) => c.to - c.from > 0.001 && c.yTo - c.yFrom > 0.001);
}

function addWall(
  root: THREE.Group,
  track: ResourceTracker,
  wall: Wall,
  openings: Opening[],
  baseColor: string,
): void {
  const L = wallLength(wall);
  if (L < 0.01) return;
  const angle = Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x);
  const color = wall.existing ? new THREE.Color(baseColor).lerp(new THREE.Color('#7fbf6f'), 0.35) : new THREE.Color(baseColor);
  const mat = track.mat(
    new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.02 }),
  );

  for (const c of wallChunks(wall, openings)) {
    const w = c.to - c.from;
    const h = c.yTo - c.yFrom;
    const geo = track.geo(new THREE.BoxGeometry(w, h, wall.thickness));
    const mesh = new THREE.Mesh(geo, mat);
    // Position du centre du morceau, le long de l'axe du mur
    const mid = c.from + w / 2;
    const px = wall.a.x + Math.cos(angle) * mid;
    const py = wall.a.y + Math.sin(angle) * mid;
    mesh.position.set(px, c.yFrom + h / 2, py);
    // On tourne autour de Y : dans la scene, l'axe Z correspond a l'axe Y du plan.
    mesh.rotation.y = -angle;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  // Vitrages et huisseries
  for (const o of openings.filter((x) => x.wallId === wall.id)) {
    const mid = o.offset;
    const px = wall.a.x + Math.cos(angle) * mid;
    const py = wall.a.y + Math.sin(angle) * mid;

    if (o.type === 'window') {
      const glassMat = track.mat(
        new THREE.MeshPhysicalMaterial({
          color: '#bfe0f2',
          transparent: true,
          opacity: 0.32,
          roughness: 0.05,
          metalness: 0,
          transmission: 0.6,
          side: THREE.DoubleSide,
        }),
      );
      const geo = track.geo(new THREE.BoxGeometry(o.width * 0.94, o.height * 0.94, 0.02));
      const glass = new THREE.Mesh(geo, glassMat);
      glass.position.set(px, o.sill + o.height / 2, py);
      glass.rotation.y = -angle;
      root.add(glass);
    }

    // Encadrement (visible aussi bien pour les portes que les fenetres)
    const frameMat = track.mat(
      new THREE.MeshStandardMaterial({ color: o.existing ? '#5f8f52' : '#8a8f96', roughness: 0.6 }),
    );
    const t = wall.thickness + 0.02;
    const bars: Array<[number, number, number, number, number]> = [
      // [largeur, hauteur, offset X local, offset Y, profondeur]
      [o.width + 0.08, 0.06, 0, o.sill + o.height, t],
      [0.06, o.height, -(o.width / 2 + 0.03), o.sill + o.height / 2, t],
      [0.06, o.height, o.width / 2 + 0.03, o.sill + o.height / 2, t],
    ];
    if (o.type === 'window' && o.sill > 0.01) bars.push([o.width + 0.08, 0.06, 0, o.sill, t]);
    for (const [bw, bh, ox, oy, bd] of bars) {
      const geo = track.geo(new THREE.BoxGeometry(bw, bh, bd));
      const m = new THREE.Mesh(geo, frameMat);
      m.position.set(px + Math.cos(angle) * ox, oy, py + Math.sin(angle) * ox);
      m.rotation.y = -angle;
      m.castShadow = true;
      root.add(m);
    }

    if (o.type === 'door') {
      // Vantail entrouvert, pour lire le sens d'ouverture en 3D
      const doorMat = track.mat(new THREE.MeshStandardMaterial({ color: '#a8916a', roughness: 0.75 }));
      const geo = track.geo(new THREE.BoxGeometry(o.width * 0.96, o.height * 0.98, 0.04));
      const leaf = new THREE.Mesh(geo, doorMat);
      const pivot = new THREE.Group();
      const hingeSign = o.flip ? 1 : -1;
      pivot.position.set(px + Math.cos(angle) * (hingeSign * o.width) / 2, 0, py + Math.sin(angle) * (hingeSign * o.width) / 2);
      pivot.rotation.y = -angle - hingeSign * Math.PI / 3;
      leaf.position.set((-hingeSign * o.width) / 2, o.height / 2, 0);
      leaf.castShadow = true;
      pivot.add(leaf);
      root.add(pivot);
    }
  }
}

// ------------------------------------------------------------------ mobilier

function boxMesh(
  track: ResourceTracker,
  w: number,
  h: number,
  d: number,
  color: THREE.ColorRepresentation,
  opts: { opacity?: number; roughness?: number; metalness?: number } = {},
): THREE.Mesh {
  const mat = track.mat(
    new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.75,
      metalness: opts.metalness ?? 0.05,
      transparent: (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
    }),
  );
  const mesh = new THREE.Mesh(track.geo(new THREE.BoxGeometry(w, h, d)), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Construit la geometrie d'un objet du catalogue, centree sur l'origine. */
function buildItemMesh(track: ResourceTracker, item: Item, style: Item3DStyle): THREE.Group {
  const g = new THREE.Group();
  const { width: w, depth: d, height: h, color } = item;
  const shelves = Math.max(1, item.shelves ?? 4);
  const metal = '#9aa3ad';

  const addShelves = (topClearance = 0.05, from = 0.1) => {
    for (let i = 0; i < shelves; i++) {
      const y = from + ((h - from - topClearance) * i) / Math.max(1, shelves - 1);
      const board = boxMesh(track, w * 0.96, 0.03, d * 0.9, color);
      board.position.y = y;
      g.add(board);
    }
  };

  switch (style) {
    case 'shelf':
    case 'wallShelf': {
      // Montants lateraux + fond + niveaux
      const side1 = boxMesh(track, 0.04, h, d, metal);
      side1.position.set(-w / 2 + 0.02, h / 2, 0);
      const side2 = side1.clone();
      side2.position.x = w / 2 - 0.02;
      g.add(side1, side2);
      const back = boxMesh(track, w, h, 0.03, metal);
      back.position.set(0, h / 2, style === 'wallShelf' ? -d / 2 + 0.015 : 0);
      g.add(back);
      addShelves();
      break;
    }
    case 'endcap': {
      const back = boxMesh(track, w, h, 0.04, metal);
      back.position.set(0, h / 2, -d / 2 + 0.02);
      g.add(back);
      addShelves();
      // Bandeau d'affichage promo
      const crown = boxMesh(track, w, 0.18, d * 0.3, '#d64f2a');
      crown.position.set(0, h + 0.09, 0);
      g.add(crown);
      break;
    }
    case 'fridgeOpen': {
      const body = boxMesh(track, w, h, d, color, { roughness: 0.4, metalness: 0.35 });
      body.position.y = h / 2;
      g.add(body);
      // Creux de presentation, ouvert sur l'avant
      const inner = boxMesh(track, w * 0.94, h * 0.72, d * 0.8, '#eef4f8', { roughness: 0.3 });
      inner.position.set(0, h * 0.52, d * 0.12);
      g.add(inner);
      for (let i = 0; i < shelves; i++) {
        const y = h * 0.22 + ((h * 0.68) * i) / Math.max(1, shelves - 1);
        const board = boxMesh(track, w * 0.92, 0.03, d * 0.6, '#dbe4ea');
        board.position.set(0, y, d * 0.1);
        g.add(board);
      }
      break;
    }
    case 'fridgeGlass': {
      const body = boxMesh(track, w, h, d, color, { roughness: 0.35, metalness: 0.4 });
      body.position.y = h / 2;
      g.add(body);
      const glassMat = track.mat(
        new THREE.MeshPhysicalMaterial({
          color: '#d6ecf7',
          transparent: true,
          opacity: 0.35,
          roughness: 0.05,
          transmission: 0.7,
        }),
      );
      const glass = new THREE.Mesh(track.geo(new THREE.BoxGeometry(w * 0.9, h * 0.78, 0.03)), glassMat);
      glass.position.set(0, h * 0.55, d / 2 + 0.015);
      g.add(glass);
      for (let i = 0; i < shelves; i++) {
        const y = h * 0.2 + ((h * 0.6) * i) / Math.max(1, shelves - 1);
        const board = boxMesh(track, w * 0.86, 0.025, d * 0.7, '#e7eef3');
        board.position.set(0, y, 0);
        g.add(board);
      }
      break;
    }
    case 'freezerBin': {
      const body = boxMesh(track, w, h, d, color, { roughness: 0.4, metalness: 0.3 });
      body.position.y = h / 2;
      g.add(body);
      const inner = boxMesh(track, w * 0.9, h * 0.25, d * 0.85, '#f2f8fb');
      inner.position.y = h - h * 0.1;
      g.add(inner);
      break;
    }
    case 'display': {
      const base = boxMesh(track, w, 0.25, d, '#8a704f');
      base.position.y = 0.125;
      g.add(base);
      const mast = boxMesh(track, 0.06, h, 0.06, metal);
      mast.position.y = h / 2;
      g.add(mast);
      for (let i = 0; i < shelves; i++) {
        const t = i / Math.max(1, shelves - 1);
        const size = 1 - t * 0.35;
        const board = boxMesh(track, w * size, 0.03, d * size, color);
        board.position.y = 0.3 + (h - 0.4) * t;
        g.add(board);
      }
      break;
    }
    case 'counter': {
      const body = boxMesh(track, w, h, d, color, { roughness: 0.6 });
      body.position.y = h / 2;
      g.add(body);
      const top = boxMesh(track, w + 0.06, 0.05, d + 0.06, '#3c3f45', { roughness: 0.35, metalness: 0.2 });
      top.position.y = h + 0.02;
      g.add(top);
      break;
    }
    case 'checkout': {
      const body = boxMesh(track, w, h * 0.8, d, color);
      body.position.y = (h * 0.8) / 2;
      g.add(body);
      const screen = boxMesh(track, w * 0.5, 0.28, 0.04, '#20262b', { roughness: 0.3 });
      screen.position.set(0, h * 0.8 + 0.18, -d * 0.2);
      screen.rotation.x = -0.25;
      g.add(screen);
      const scanner = boxMesh(track, w * 0.4, 0.06, d * 0.4, '#2f3a40');
      scanner.position.set(0, h * 0.8 + 0.03, d * 0.15);
      g.add(scanner);
      break;
    }
    case 'belt': {
      const frame = boxMesh(track, w, h * 0.9, d, color);
      frame.position.y = (h * 0.9) / 2;
      g.add(frame);
      const belt = boxMesh(track, w * 0.94, 0.04, d * 0.85, '#1f2429', { roughness: 0.9 });
      belt.position.y = h * 0.9 + 0.02;
      g.add(belt);
      break;
    }
    case 'terminal': {
      const pole = boxMesh(track, Math.min(w, 0.12), h * 0.7, Math.min(d, 0.12), '#4a5560');
      pole.position.y = (h * 0.7) / 2;
      g.add(pole);
      const head = boxMesh(track, w, h * 0.3, d, color, { roughness: 0.3 });
      head.position.y = h * 0.85;
      head.rotation.x = -0.2;
      g.add(head);
      break;
    }
    case 'basket': {
      for (let i = 0; i < 5; i++) {
        const b = boxMesh(track, w * 0.9, h * 0.22, d * 0.9, i % 2 ? '#c0392b' : color, { roughness: 0.8 });
        b.position.y = h * 0.12 + i * h * 0.17;
        b.rotation.y = i * 0.03;
        g.add(b);
      }
      break;
    }
    case 'trolley': {
      const basket = boxMesh(track, w, h * 0.45, d * 0.8, color, { roughness: 0.5, metalness: 0.4, opacity: 0.9 });
      basket.position.set(0, h * 0.62, 0);
      g.add(basket);
      const handle = boxMesh(track, w, 0.04, 0.04, metal);
      handle.position.set(0, h * 0.95, -d * 0.42);
      g.add(handle);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const wheel = new THREE.Mesh(
            track.geo(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12)),
            track.mat(new THREE.MeshStandardMaterial({ color: '#22262b' })),
          );
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set((sx * w) / 2.6, 0.05, (sz * d) / 2.6);
          g.add(wheel);
        }
      }
      break;
    }
    case 'pallet': {
      const pal = boxMesh(track, w, 0.14, d, '#a9803f', { roughness: 1 });
      pal.position.y = 0.07;
      g.add(pal);
      const load = boxMesh(track, w * 0.92, Math.max(0.1, h - 0.14), d * 0.92, color, { roughness: 0.9 });
      load.position.y = 0.14 + Math.max(0.1, h - 0.14) / 2;
      g.add(load);
      break;
    }
    case 'box':
    default: {
      const body = boxMesh(track, w, h, d, color);
      body.position.y = h / 2;
      g.add(body);
      break;
    }
  }
  return g;
}

// --------------------------------------------------------------- scene entiere

export function buildScene(project: Project): BuiltScene {
  const track = new ResourceTracker();
  const root = new THREE.Group();
  const { floor, settings, existing } = project;

  // Emprise du plan : sert au sol, au plafond et au cadrage camera.
  const pts: Vec2[] = [];
  floor.walls.forEach((w) => wallPolygon(w).forEach((p) => pts.push(p)));
  floor.items.forEach((i) => pts.push({ x: i.x, y: i.y }));
  floor.zones.forEach((z) => z.points.forEach((p) => pts.push(p)));
  const b = pts.length ? polygonBounds(pts) : { x: -5, y: -5, width: 10, height: 10 };
  const padded = {
    x: b.x - 1,
    y: b.y - 1,
    width: Math.max(2, b.width + 2),
    height: Math.max(2, b.height + 2),
  };
  const cx = padded.x + padded.width / 2;
  const cy = padded.y + padded.height / 2;
  const extent = Math.max(padded.width, padded.height);

  // --- Sol
  const floorMatOpts: THREE.MeshStandardMaterialParameters = {
    roughness: 0.85,
    metalness: 0.02,
  };
  if (existing.carrelage) {
    floorMatOpts.map = tileTexture(track, existing.carrelageColor, existing.carrelageTileSize, extent);
    floorMatOpts.color = new THREE.Color('#ffffff');
  } else {
    floorMatOpts.color = new THREE.Color(settings.floorColor);
  }
  const floorMesh = new THREE.Mesh(
    track.geo(new THREE.PlaneGeometry(padded.width, padded.height)),
    track.mat(new THREE.MeshStandardMaterial(floorMatOpts)),
  );
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set(cx, 0, cy);
  floorMesh.receiveShadow = true;
  root.add(floorMesh);

  // --- Zones : aplats colores poses sur le sol
  for (const z of floor.zones) {
    if (z.points.length < 3) continue;
    const shape = new THREE.Shape();
    z.points.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)));
    shape.closePath();
    const geo = track.geo(new THREE.ShapeGeometry(shape));
    const mat = track.mat(
      new THREE.MeshBasicMaterial({
        color: z.color,
        transparent: true,
        opacity: Math.min(0.4, z.opacity + 0.05),
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = 0.006;
    root.add(mesh);
  }

  // --- Murs et cloisons, avec percements reels
  for (const w of floor.walls) {
    addWall(root, track, w, floor.openings, settings.wallColor);
  }

  // --- Poteaux
  for (const c of floor.columns) {
    const mat = track.mat(
      new THREE.MeshStandardMaterial({ color: c.existing ? '#8fbf7f' : '#c8ccd2', roughness: 0.9 }),
    );
    const geo =
      c.shape === 'round'
        ? track.geo(new THREE.CylinderGeometry(c.width / 2, c.width / 2, c.height, 20))
        : track.geo(new THREE.BoxGeometry(c.width, c.height, c.depth));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(c.x, c.height / 2, c.y);
    mesh.rotation.y = (-c.rotation * Math.PI) / 180;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  // --- Mobilier
  for (const it of floor.items) {
    const entry = catalogEntry(it.catalogId);
    const g = buildItemMesh(track, it, entry?.style ?? 'box');
    g.position.set(it.x, 0, it.y);
    g.rotation.y = (-it.rotation * Math.PI) / 180;
    g.userData.itemId = it.id;
    root.add(g);
  }

  // --- Plafond
  if (settings.showCeiling) {
    const ceil = new THREE.Mesh(
      track.geo(new THREE.PlaneGeometry(padded.width, padded.height)),
      track.mat(new THREE.MeshStandardMaterial({ color: '#f2f3f5', roughness: 1, side: THREE.DoubleSide })),
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(cx, settings.wallHeight, cy);
    root.add(ceil);
  }

  const bounds = new THREE.Box3(
    new THREE.Vector3(padded.x, 0, padded.y),
    new THREE.Vector3(padded.x + padded.width, settings.wallHeight, padded.y + padded.height),
  );

  return { root, bounds, dispose: () => track.dispose() };
}

/** Hauteur d'oeil retenue pour la vue interieure. */
const EYE_HEIGHT = 1.65;

/**
 * Pose de camera pour la vue interieure.
 * On se place en retrait d'un angle du local, a hauteur d'oeil, en visant le
 * centre : c'est le point de vue qui donne la meilleure lecture d'un magasin.
 * L'angle retenu est celui qui est le plus degage du mobilier, pour ne pas
 * demarrer la visite le nez contre une gondole.
 */
export function interiorPose(project: Project): { position: THREE.Vector3; target: THREE.Vector3 } {
  const { floor } = project;

  const pts: Vec2[] = [];
  floor.walls.forEach((w) => pts.push(w.a, w.b));
  if (!pts.length) {
    const sales = floor.zones.find((z) => z.category === 'vente') ?? floor.zones[0];
    if (sales && sales.points.length >= 3) sales.points.forEach((p) => pts.push(p));
  }
  if (!pts.length) {
    return {
      position: new THREE.Vector3(-4, EYE_HEIGHT, -4),
      target: new THREE.Vector3(0, 1.45, 0),
    };
  }

  const b = polygonBounds(pts);
  const center: Vec2 = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const inset = Math.min(1.6, Math.max(0.6, Math.min(b.width, b.height) * 0.22));

  const candidates: Vec2[] = [
    { x: b.x + inset, y: b.y + inset },
    { x: b.x + b.width - inset, y: b.y + inset },
    { x: b.x + b.width - inset, y: b.y + b.height - inset },
    { x: b.x + inset, y: b.y + b.height - inset },
  ];

  // Degagement : distance au mobilier le plus proche (rayon englobant simplifie).
  const clearance = (p: Vec2): number => {
    let min = Infinity;
    for (const it of floor.items) {
      const r = Math.hypot(it.width, it.depth) / 2;
      min = Math.min(min, Math.hypot(it.x - p.x, it.y - p.y) - r);
    }
    for (const c of floor.columns) {
      min = Math.min(min, Math.hypot(c.x - p.x, c.y - p.y) - Math.max(c.width, c.depth) / 2);
    }
    return Number.isFinite(min) ? min : 99;
  };

  let best = candidates[0];
  let bestScore = -Infinity;
  for (const c of candidates) {
    const score = clearance(c);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return {
    position: new THREE.Vector3(best.x, EYE_HEIGHT, best.y),
    target: new THREE.Vector3(center.x, 1.45, center.y),
  };
}
