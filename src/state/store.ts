import { create } from 'zustand';
import type {
  AnyElement,
  Background,
  Column,
  Dimension,
  ExistingOptions,
  Floor,
  Item,
  Opening,
  Project,
  ProjectSettings,
  ToolId,
  Vec2,
  Wall,
  Zone,
  ZoneCategory,
} from '../types';
import { catalogEntry } from '../lib/catalog';
import { ZONE_PRESET_BY_CATEGORY } from '../lib/zones';
import {
  clampOpening,
  dist,
  itemCorners,
  polygonBounds,
  projectOnSegment,
  rotate,
  uid,
  wallLength,
} from '../lib/geometry';
import {
  createProject,
  loadProject,
  lastProjectId,
  saveProject,
  deleteProject as removeProject,
  duplicateProject as dupProject,
  migrate,
} from './projects';

export type ViewMode = '2d' | '3d' | 'split';

/** Instantane leger du contenu editable (pour l'historique annuler/rétablir). */
interface Snapshot {
  name: string;
  floor: Floor;
  background: Background | null;
  existing: ExistingOptions;
  settings: ProjectSettings;
}

const HISTORY_LIMIT = 100;

function snapshot(p: Project): Snapshot {
  return {
    name: p.name,
    // Le contenu du plan est petit : clonage profond.
    floor: structuredClone(p.floor),
    // On partage la data-URL de l'image (souvent volumineuse) au lieu de la copier.
    background: p.background ? { ...p.background } : null,
    existing: { ...p.existing },
    settings: { ...p.settings },
  };
}

function applySnapshot(p: Project, s: Snapshot): Project {
  return { ...p, ...s, updatedAt: Date.now() };
}

export interface Camera2D {
  /** Coordonnees monde (m) du centre de l'ecran */
  x: number;
  y: number;
  /** Pixels par metre */
  zoom: number;
}

/** Etat transitoire d'un outil de dessin en cours. */
export interface Draft {
  tool: ToolId;
  points: Vec2[];
  /** Point courant sous le curseur */
  cursor: Vec2 | null;
}

export interface Notice {
  id: string;
  text: string;
  type: 'info' | 'success' | 'error';
}

interface EditorState {
  project: Project;
  selection: string[];
  tool: ToolId;
  view: ViewMode;
  camera: Camera2D;
  draft: Draft | null;
  past: Snapshot[];
  future: Snapshot[];
  dirty: boolean;
  notices: Notice[];
  /** Catalogue : entree en cours de depot sur le plan */
  pendingCatalogId: string | null;
  /** Calibration d'echelle en cours : longueur reelle a saisir */
  calibration: { a: Vec2; b: Vec2 } | null;

  // ---- historique
  commit: (label: string, fn: (p: Project) => void) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // ---- interface
  setTool: (t: ToolId) => void;
  setView: (v: ViewMode) => void;
  setCamera: (c: Partial<Camera2D>) => void;
  zoomBy: (factor: number, anchor?: Vec2) => void;
  zoomToFit: (viewport: { width: number; height: number }) => void;
  setDraft: (d: Draft | null) => void;
  notify: (text: string, type?: Notice['type']) => void;
  dismissNotice: (id: string) => void;
  setPendingCatalog: (id: string | null) => void;
  setCalibration: (c: { a: Vec2; b: Vec2 } | null) => void;

  // ---- selection
  select: (ids: string[], additive?: boolean) => void;
  clearSelection: () => void;
  selectedElements: () => AnyElement[];
  findElement: (id: string) => AnyElement | undefined;

  // ---- edition du plan
  addWall: (a: Vec2, b: Vec2, type: 'wall' | 'partition') => string;
  updateWall: (id: string, patch: Partial<Wall>) => void;
  addOpening: (wallId: string, offset: number, type: 'door' | 'window') => string | null;
  updateOpening: (id: string, patch: Partial<Opening>) => void;
  addColumn: (p: Vec2) => string;
  updateColumn: (id: string, patch: Partial<Column>) => void;
  addZone: (points: Vec2[], category: ZoneCategory, name?: string) => string;
  addZoneRect: (center: Vec2, category: ZoneCategory) => string;
  updateZone: (id: string, patch: Partial<Zone>) => void;
  addDimension: (a: Vec2, b: Vec2) => string;
  updateDimension: (id: string, patch: Partial<Dimension>) => void;
  addItem: (catalogId: string, at: Vec2, rotation?: number) => string | null;
  updateItem: (id: string, patch: Partial<Item>) => void;

  moveSelection: (delta: Vec2) => void;
  rotateSelection: (deltaDeg: number) => void;
  duplicateSelection: () => void;
  deleteSelection: () => void;
  toggleExistingOnSelection: () => void;

  // ---- fond de plan
  setBackground: (bg: Background | null) => void;
  updateBackground: (patch: Partial<Background>) => void;
  applyScaleFromDistance: (a: Vec2, b: Vec2, realMeters: number) => void;

  // ---- reglages
  updateSettings: (patch: Partial<ProjectSettings>) => void;
  updateExisting: (patch: Partial<ExistingOptions>) => void;

  // ---- projets
  newProject: (name?: string) => void;
  openProject: (id: string) => void;
  loadProjectObject: (p: Project) => void;
  saveNow: () => void;
  renameCurrent: (name: string) => void;
  duplicateCurrent: () => void;
  deleteCurrent: () => void;
}

function initialProject(): Project {
  const id = lastProjectId();
  if (id) {
    const p = loadProject(id);
    if (p) return p;
  }
  return createProject('Projet supérette');
}

/** Retrouve un element du plan par son identifiant. */
export function findIn(floor: Floor, id: string): AnyElement | undefined {
  return (
    floor.walls.find((e) => e.id === id) ??
    floor.openings.find((e) => e.id === id) ??
    floor.columns.find((e) => e.id === id) ??
    floor.zones.find((e) => e.id === id) ??
    floor.items.find((e) => e.id === id) ??
    floor.dimensions.find((e) => e.id === id)
  );
}

export const useEditor = create<EditorState>((set, get) => ({
  project: initialProject(),
  selection: [],
  tool: 'select',
  view: '2d',
  camera: { x: 6, y: 5, zoom: 45 },
  draft: null,
  past: [],
  future: [],
  dirty: false,
  notices: [],
  pendingCatalogId: null,
  calibration: null,

  // ------------------------------------------------------------------ history
  commit: (_label, fn) => {
    const { project, past } = get();
    const before = snapshot(project);
    const next: Project = { ...project, floor: structuredClone(project.floor) };
    fn(next);
    next.updatedAt = Date.now();
    set({
      project: next,
      past: [...past.slice(-(HISTORY_LIMIT - 1)), before],
      future: [],
      dirty: true,
    });
  },

  undo: () => {
    const { past, future, project } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({
      project: applySnapshot(project, prev),
      past: past.slice(0, -1),
      future: [snapshot(project), ...future].slice(0, HISTORY_LIMIT),
      dirty: true,
      selection: [],
      draft: null,
    });
  },

  redo: () => {
    const { past, future, project } = get();
    if (!future.length) return;
    const nextSnap = future[0];
    set({
      project: applySnapshot(project, nextSnap),
      past: [...past, snapshot(project)].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      dirty: true,
      selection: [],
      draft: null,
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  // ---------------------------------------------------------------------- UI
  setTool: (t) => set({ tool: t, draft: null, pendingCatalogId: null }),
  setView: (v) => set({ view: v }),
  setCamera: (c) => set({ camera: { ...get().camera, ...c } }),

  zoomBy: (factor, anchor) => {
    const cam = get().camera;
    const zoom = Math.max(4, Math.min(600, cam.zoom * factor));
    if (!anchor) {
      set({ camera: { ...cam, zoom } });
      return;
    }
    // On garde le point `anchor` immobile a l'ecran pendant le zoom.
    const k = cam.zoom / zoom;
    set({
      camera: {
        zoom,
        x: anchor.x + (cam.x - anchor.x) * k,
        y: anchor.y + (cam.y - anchor.y) * k,
      },
    });
  },

  zoomToFit: (viewport) => {
    const { floor, background } = get().project;
    const pts: Vec2[] = [];
    floor.walls.forEach((w) => {
      pts.push(w.a, w.b);
    });
    floor.items.forEach((i) => itemCorners(i).forEach((p) => pts.push(p)));
    floor.zones.forEach((z) => z.points.forEach((p) => pts.push(p)));
    floor.columns.forEach((c) => pts.push({ x: c.x, y: c.y }));
    if (background && background.visible) {
      pts.push({ x: background.x, y: background.y });
      pts.push({
        x: background.x + background.pxWidth * background.scale,
        y: background.y + background.pxHeight * background.scale,
      });
    }
    if (!pts.length) {
      set({ camera: { x: 6, y: 5, zoom: 45 } });
      return;
    }
    const b = polygonBounds(pts);
    const pad = 1.5;
    const zoom = Math.max(
      4,
      Math.min(
        400,
        Math.min(
          viewport.width / Math.max(0.5, b.width + pad * 2),
          viewport.height / Math.max(0.5, b.height + pad * 2),
        ),
      ),
    );
    set({ camera: { x: b.x + b.width / 2, y: b.y + b.height / 2, zoom } });
  },

  setDraft: (d) => set({ draft: d }),

  notify: (text, type = 'info') => {
    const id = uid('n');
    set({ notices: [...get().notices, { id, text, type }] });
    setTimeout(() => get().dismissNotice(id), 4500);
  },
  dismissNotice: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),
  setPendingCatalog: (id) => set({ pendingCatalogId: id, tool: id ? 'select' : get().tool }),
  setCalibration: (c) => set({ calibration: c }),

  // --------------------------------------------------------------- selection
  select: (ids, additive = false) => {
    if (!additive) {
      set({ selection: ids });
      return;
    }
    const cur = new Set(get().selection);
    ids.forEach((id) => (cur.has(id) ? cur.delete(id) : cur.add(id)));
    set({ selection: [...cur] });
  },
  clearSelection: () => set({ selection: [] }),
  selectedElements: () => {
    const { project, selection } = get();
    return selection
      .map((id) => findIn(project.floor, id))
      .filter((e): e is AnyElement => Boolean(e));
  },
  findElement: (id) => findIn(get().project.floor, id),

  // ------------------------------------------------------------------- edits
  addWall: (a, b, type) => {
    const id = uid('w');
    const s = get().project.settings;
    get().commit('Ajouter un mur', (p) => {
      p.floor.walls.push({
        id,
        kind: 'wall',
        type,
        a: { ...a },
        b: { ...b },
        thickness: type === 'wall' ? s.defaultWallThickness : s.defaultPartitionThickness,
        height: s.wallHeight,
        existing: false,
      });
    });
    return id;
  },

  updateWall: (id, patch) => {
    get().commit('Modifier un mur', (p) => {
      const w = p.floor.walls.find((x) => x.id === id);
      if (!w) return;
      Object.assign(w, patch);
      // Les ouvertures doivent rester dans le mur apres modification.
      p.floor.openings = p.floor.openings.map((o) => (o.wallId === id ? clampOpening(o, w) : o));
    });
  },

  addOpening: (wallId, offset, type) => {
    const wall = get().project.floor.walls.find((w) => w.id === wallId);
    if (!wall) return null;
    const id = uid('o');
    get().commit(type === 'door' ? 'Ajouter une porte' : 'Ajouter une fenêtre', (p) => {
      const w = p.floor.walls.find((x) => x.id === wallId)!;
      const base: Opening =
        type === 'door'
          ? { id, kind: 'opening', type, wallId, offset, width: 0.9, height: 2.1, sill: 0, flip: false, existing: false }
          : { id, kind: 'opening', type, wallId, offset, width: 1.2, height: 1.2, sill: 1, flip: false, existing: false };
      p.floor.openings.push(clampOpening(base, w));
    });
    return id;
  },

  updateOpening: (id, patch) => {
    get().commit('Modifier une ouverture', (p) => {
      const o = p.floor.openings.find((x) => x.id === id);
      if (!o) return;
      Object.assign(o, patch);
      const w = p.floor.walls.find((x) => x.id === o.wallId);
      if (w) Object.assign(o, clampOpening(o, w));
    });
  },

  addColumn: (pt) => {
    const id = uid('c');
    const h = get().project.settings.wallHeight;
    get().commit('Ajouter un poteau', (p) => {
      p.floor.columns.push({
        id,
        kind: 'column',
        shape: 'rect',
        x: pt.x,
        y: pt.y,
        width: 0.3,
        depth: 0.3,
        height: h,
        rotation: 0,
        existing: false,
      });
    });
    return id;
  },

  updateColumn: (id, patch) => {
    get().commit('Modifier un poteau', (p) => {
      const c = p.floor.columns.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
    });
  },

  addZone: (points, category, name) => {
    const id = uid('z');
    const preset = ZONE_PRESET_BY_CATEGORY[category];
    get().commit('Ajouter une zone', (p) => {
      p.floor.zones.push({
        id,
        kind: 'zone',
        name: name ?? preset.label,
        category,
        points: points.map((pt) => ({ ...pt })),
        color: preset.color,
        opacity: 0.22,
      });
    });
    return id;
  },

  addZoneRect: (center, category) => {
    const preset = ZONE_PRESET_BY_CATEGORY[category];
    const hw = preset.width / 2;
    const hd = preset.depth / 2;
    return get().addZone(
      [
        { x: center.x - hw, y: center.y - hd },
        { x: center.x + hw, y: center.y - hd },
        { x: center.x + hw, y: center.y + hd },
        { x: center.x - hw, y: center.y + hd },
      ],
      category,
    );
  },

  updateZone: (id, patch) => {
    get().commit('Modifier une zone', (p) => {
      const z = p.floor.zones.find((x) => x.id === id);
      if (z) Object.assign(z, patch);
    });
  },

  addDimension: (a, b) => {
    const id = uid('d');
    get().commit('Ajouter une cotation', (p) => {
      p.floor.dimensions.push({ id, kind: 'dimension', a: { ...a }, b: { ...b }, offset: 0.4 });
    });
    return id;
  },

  updateDimension: (id, patch) => {
    get().commit('Modifier une cotation', (p) => {
      const d = p.floor.dimensions.find((x) => x.id === id);
      if (d) Object.assign(d, patch);
    });
  },

  addItem: (catalogId, at, rotation = 0) => {
    const entry = catalogEntry(catalogId);
    if (!entry) return null;
    const id = uid('i');
    get().commit(`Ajouter : ${entry.name}`, (p) => {
      p.floor.items.push({
        id,
        kind: 'item',
        catalogId,
        name: entry.name,
        category: entry.category,
        x: at.x,
        y: at.y,
        width: entry.width,
        depth: entry.depth,
        height: entry.height,
        rotation,
        color: entry.color,
        locked: false,
        shelves: entry.shelves,
      });
    });
    return id;
  },

  updateItem: (id, patch) => {
    get().commit('Modifier un objet', (p) => {
      const it = p.floor.items.find((x) => x.id === id);
      if (it) Object.assign(it, patch);
    });
  },

  moveSelection: (delta) => {
    const ids = new Set(get().selection);
    if (!ids.size) return;
    get().commit('Déplacer', (p) => {
      p.floor.walls.forEach((w) => {
        if (ids.has(w.id)) {
          w.a = { x: w.a.x + delta.x, y: w.a.y + delta.y };
          w.b = { x: w.b.x + delta.x, y: w.b.y + delta.y };
        }
      });
      p.floor.columns.forEach((c) => {
        if (ids.has(c.id)) {
          c.x += delta.x;
          c.y += delta.y;
        }
      });
      p.floor.items.forEach((i) => {
        if (ids.has(i.id) && !i.locked) {
          i.x += delta.x;
          i.y += delta.y;
        }
      });
      p.floor.zones.forEach((z) => {
        if (ids.has(z.id)) z.points = z.points.map((pt) => ({ x: pt.x + delta.x, y: pt.y + delta.y }));
      });
      p.floor.dimensions.forEach((d) => {
        if (ids.has(d.id)) {
          d.a = { x: d.a.x + delta.x, y: d.a.y + delta.y };
          d.b = { x: d.b.x + delta.x, y: d.b.y + delta.y };
        }
      });
    });
  },

  rotateSelection: (deltaDeg) => {
    const ids = new Set(get().selection);
    if (!ids.size) return;
    // Rotation autour du barycentre de la selection.
    const els = get().selectedElements();
    const pts: Vec2[] = [];
    els.forEach((e) => {
      if (e.kind === 'wall') pts.push(e.a, e.b);
      else if (e.kind === 'column' || e.kind === 'item') pts.push({ x: e.x, y: e.y });
      else if (e.kind === 'zone') e.points.forEach((p) => pts.push(p));
      else if (e.kind === 'dimension') pts.push(e.a, e.b);
    });
    if (!pts.length) return;
    const center: Vec2 = {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
    get().commit('Pivoter', (p) => {
      p.floor.walls.forEach((w) => {
        if (ids.has(w.id)) {
          w.a = rotate(w.a, deltaDeg, center);
          w.b = rotate(w.b, deltaDeg, center);
        }
      });
      p.floor.columns.forEach((c) => {
        if (ids.has(c.id)) {
          const r = rotate({ x: c.x, y: c.y }, deltaDeg, center);
          c.x = r.x;
          c.y = r.y;
          c.rotation = (c.rotation + deltaDeg) % 360;
        }
      });
      p.floor.items.forEach((i) => {
        if (ids.has(i.id) && !i.locked) {
          const r = rotate({ x: i.x, y: i.y }, deltaDeg, center);
          i.x = r.x;
          i.y = r.y;
          i.rotation = (i.rotation + deltaDeg) % 360;
        }
      });
      p.floor.zones.forEach((z) => {
        if (ids.has(z.id)) z.points = z.points.map((pt) => rotate(pt, deltaDeg, center));
      });
      p.floor.dimensions.forEach((d) => {
        if (ids.has(d.id)) {
          d.a = rotate(d.a, deltaDeg, center);
          d.b = rotate(d.b, deltaDeg, center);
        }
      });
    });
  },

  duplicateSelection: () => {
    const ids = new Set(get().selection);
    if (!ids.size) return;
    const off = 0.5;
    const newIds: string[] = [];
    get().commit('Dupliquer', (p) => {
      const wallIdMap = new Map<string, string>();
      p.floor.walls
        .filter((w) => ids.has(w.id))
        .forEach((w) => {
          const id = uid('w');
          wallIdMap.set(w.id, id);
          newIds.push(id);
          p.floor.walls.push({
            ...structuredClone(w),
            id,
            a: { x: w.a.x + off, y: w.a.y + off },
            b: { x: w.b.x + off, y: w.b.y + off },
          });
        });
      // Les ouvertures des murs dupliques suivent leur nouveau mur.
      p.floor.openings
        .filter((o) => wallIdMap.has(o.wallId))
        .forEach((o) => {
          const id = uid('o');
          newIds.push(id);
          p.floor.openings.push({ ...structuredClone(o), id, wallId: wallIdMap.get(o.wallId)! });
        });
      // Une ouverture selectionnee seule est dupliquee sur le meme mur.
      p.floor.openings
        .filter((o) => ids.has(o.id) && !wallIdMap.has(o.wallId))
        .forEach((o) => {
          const w = p.floor.walls.find((x) => x.id === o.wallId);
          if (!w) return;
          const id = uid('o');
          newIds.push(id);
          p.floor.openings.push(
            clampOpening({ ...structuredClone(o), id, offset: o.offset + o.width + 0.2 }, w),
          );
        });
      p.floor.columns
        .filter((c) => ids.has(c.id))
        .forEach((c) => {
          const id = uid('c');
          newIds.push(id);
          p.floor.columns.push({ ...structuredClone(c), id, x: c.x + off, y: c.y + off });
        });
      p.floor.items
        .filter((i) => ids.has(i.id))
        .forEach((i) => {
          const id = uid('i');
          newIds.push(id);
          p.floor.items.push({ ...structuredClone(i), id, x: i.x + off, y: i.y + off });
        });
      p.floor.zones
        .filter((z) => ids.has(z.id))
        .forEach((z) => {
          const id = uid('z');
          newIds.push(id);
          p.floor.zones.push({
            ...structuredClone(z),
            id,
            points: z.points.map((pt) => ({ x: pt.x + off, y: pt.y + off })),
          });
        });
      p.floor.dimensions
        .filter((d) => ids.has(d.id))
        .forEach((d) => {
          const id = uid('d');
          newIds.push(id);
          p.floor.dimensions.push({
            ...structuredClone(d),
            id,
            a: { x: d.a.x + off, y: d.a.y + off },
            b: { x: d.b.x + off, y: d.b.y + off },
          });
        });
    });
    set({ selection: newIds });
  },

  deleteSelection: () => {
    const ids = new Set(get().selection);
    if (!ids.size) return;
    get().commit('Supprimer', (p) => {
      p.floor.walls = p.floor.walls.filter((w) => !ids.has(w.id));
      const wallIds = new Set(p.floor.walls.map((w) => w.id));
      // Les ouvertures d'un mur supprime disparaissent avec lui.
      p.floor.openings = p.floor.openings.filter((o) => !ids.has(o.id) && wallIds.has(o.wallId));
      p.floor.columns = p.floor.columns.filter((c) => !ids.has(c.id));
      p.floor.zones = p.floor.zones.filter((z) => !ids.has(z.id));
      p.floor.items = p.floor.items.filter((i) => !ids.has(i.id));
      p.floor.dimensions = p.floor.dimensions.filter((d) => !ids.has(d.id));
    });
    set({ selection: [] });
  },

  toggleExistingOnSelection: () => {
    const ids = new Set(get().selection);
    if (!ids.size) return;
    get().commit("Marquer comme existant", (p) => {
      p.floor.walls.forEach((w) => {
        if (ids.has(w.id)) w.existing = !w.existing;
      });
      p.floor.openings.forEach((o) => {
        if (ids.has(o.id)) o.existing = !o.existing;
      });
      p.floor.columns.forEach((c) => {
        if (ids.has(c.id)) c.existing = !c.existing;
      });
    });
  },

  // -------------------------------------------------------------- background
  setBackground: (bg) => {
    get().commit('Importer un plan', (p) => {
      p.background = bg;
    });
  },

  updateBackground: (patch) => {
    get().commit('Modifier le plan de fond', (p) => {
      if (p.background) p.background = { ...p.background, ...patch };
    });
  },

  applyScaleFromDistance: (a, b, realMeters) => {
    const bg = get().project.background;
    const measured = dist(a, b);
    if (!bg || measured < 1e-6 || realMeters <= 0) return;
    // On recalcule l'echelle du fond de plan pour que `measured` vaille `realMeters`.
    const k = realMeters / measured;
    get().commit("Régler l'échelle", (p) => {
      if (!p.background) return;
      p.background = {
        ...p.background,
        scale: p.background.scale * k,
        // Le point `a` reste fixe : le reste de l'image se dilate autour.
        x: a.x + (p.background.x - a.x) * k,
        y: a.y + (p.background.y - a.y) * k,
      };
    });
    get().notify(`Échelle réglée : 1 pixel = ${(bg.scale * k).toFixed(5)} m`, 'success');
  },

  // ---------------------------------------------------------------- settings
  updateSettings: (patch) => {
    get().commit('Modifier les réglages', (p) => {
      p.settings = { ...p.settings, ...patch };
      // La hauteur sous plafond s'applique aux murs qui suivaient l'ancienne valeur.
      if (patch.wallHeight !== undefined) {
        p.floor.walls.forEach((w) => {
          w.height = patch.wallHeight!;
        });
      }
    });
  },

  updateExisting: (patch) => {
    get().commit("Conserver l'existant", (p) => {
      p.existing = { ...p.existing, ...patch };
      // Cocher « conserver les murs » marque les murs actuels comme existants.
      if (patch.murs === true) p.floor.walls.forEach((w) => (w.existing = true));
      if (patch.murs === false) p.floor.walls.forEach((w) => (w.existing = false));
      if (patch.portes !== undefined)
        p.floor.openings.filter((o) => o.type === 'door').forEach((o) => (o.existing = patch.portes!));
      if (patch.fenetres !== undefined)
        p.floor.openings.filter((o) => o.type === 'window').forEach((o) => (o.existing = patch.fenetres!));
    });
  },

  // ---------------------------------------------------------------- projects
  newProject: (name) => {
    const p = createProject(name ?? 'Nouveau projet');
    saveProject(p);
    set({ project: p, selection: [], past: [], future: [], dirty: false, draft: null, tool: 'select' });
    get().notify('Nouveau projet créé.', 'success');
  },

  openProject: (id) => {
    const p = loadProject(id);
    if (!p) {
      get().notify('Projet introuvable.', 'error');
      return;
    }
    set({ project: p, selection: [], past: [], future: [], dirty: false, draft: null });
    get().notify(`Projet « ${p.name} » ouvert.`, 'success');
  },

  loadProjectObject: (p) => {
    const m = migrate(p);
    saveProject(m);
    set({ project: m, selection: [], past: [], future: [], dirty: false, draft: null });
  },

  saveNow: () => {
    try {
      const saved = saveProject(get().project);
      set({ project: saved, dirty: false });
      get().notify('Projet enregistré.', 'success');
    } catch (e) {
      get().notify(e instanceof Error ? e.message : "Échec de l'enregistrement.", 'error');
    }
  },

  renameCurrent: (name) => {
    get().commit('Renommer le projet', (p) => {
      p.name = name;
    });
  },

  duplicateCurrent: () => {
    const { project } = get();
    try {
      saveProject(project);
      const copy = dupProject(project.id);
      if (copy) {
        set({ project: copy, selection: [], past: [], future: [], dirty: false });
        get().notify(`Copie créée : « ${copy.name} ».`, 'success');
      }
    } catch (e) {
      get().notify(e instanceof Error ? e.message : 'Échec de la duplication.', 'error');
    }
  },

  deleteCurrent: () => {
    const { project } = get();
    removeProject(project.id);
    const p = createProject('Nouveau projet');
    saveProject(p);
    set({ project: p, selection: [], past: [], future: [], dirty: false });
    get().notify('Projet supprimé.', 'success');
  },
}));

/** Trouve le mur le plus proche d'un point, dans un rayon donne. */
export function nearestWall(
  walls: Wall[],
  p: Vec2,
  maxDist: number,
): { wall: Wall; offset: number; point: Vec2 } | null {
  let best: { wall: Wall; offset: number; point: Vec2; d: number } | null = null;
  for (const w of walls) {
    const pr = projectOnSegment(p, w.a, w.b);
    const d = pr.distance;
    if (d <= maxDist && (!best || d < best.d)) {
      best = { wall: w, offset: pr.t * wallLength(w), point: pr.point, d };
    }
  }
  return best ? { wall: best.wall, offset: best.offset, point: best.point } : null;
}
