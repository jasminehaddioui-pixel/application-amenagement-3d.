import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, Vec2 } from '../types';
import { useEditor } from '../state/store';
import { renderPlan, screenToWorld } from './render';
import { hitHandle, hitRect, hitTest, snapPoint, wallUnder, type HandleKind } from './hit';
import {
  add,
  clampOpening,
  dist,
  fmtM,
  itemCorners,
  norm,
  rotate,
  snapAngle,
  snapToGrid,
  sub,
} from '../lib/geometry';
import { analyseCirculation } from '../lib/circulation';
import { getBackgroundImage, loadBackgroundImage, onBackgroundImageChange } from './bgImage';

type DragMode =
  | { kind: 'none' }
  | { kind: 'pan'; startScreen: Vec2; startCam: Vec2 }
  | { kind: 'move'; start: Vec2; last: Vec2 }
  | { kind: 'marquee'; start: Vec2; current: Vec2 }
  | { kind: 'handle'; handle: HandleKind; start: Vec2; current: Vec2 };

const HANDLE_TOL_PX = 9;
const HIT_TOL_PX = 6;
const SNAP_RADIUS_PX = 12;

export default function Canvas2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [hover, setHover] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragMode>({ kind: 'none' });
  const [, forceRedraw] = useState(0);
  const [cursorWorld, setCursorWorld] = useState<Vec2>({ x: 0, y: 0 });

  const project = useEditor((s) => s.project);
  const camera = useEditor((s) => s.camera);
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const draft = useEditor((s) => s.draft);
  const pendingCatalogId = useEditor((s) => s.pendingCatalogId);

  const store = useEditor;

  // ---------------------------------------------------------------- image de fond
  useEffect(() => {
    loadBackgroundImage(project.background?.src ?? null);
    return onBackgroundImageChange(() => forceRedraw((n) => n + 1));
  }, [project.background?.src]);

  // ------------------------------------------------------------------ dimensions
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ width: Math.max(1, r.width), height: Math.max(1, r.height) });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ width: Math.max(1, r.width), height: Math.max(1, r.height) });
    return () => ro.disconnect();
  }, []);

  const toWorld = useCallback(
    (e: { clientX: number; clientY: number }): Vec2 => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }, camera, size);
    },
    [camera, size],
  );

  /** Applique l'aimantation active a un point du monde. */
  const applySnap = useCallback(
    (p: Vec2, opts: { ignore?: Set<string>; from?: Vec2 | null } = {}): Vec2 => {
      const s = project.settings;
      const radius = SNAP_RADIUS_PX / camera.zoom;
      if (s.snap) {
        const sp = snapPoint(project, p, radius, opts.ignore ?? new Set());
        if (sp) return sp;
      }
      let out = p;
      if (opts.from && s.snapAngle) out = snapAngle(opts.from, out, 15);
      if (s.snap) out = snapToGrid(out, s.gridSize);
      return out;
    },
    [project, camera.zoom],
  );

  // ------------------------------------------------------- projet d'apercu (drag)
  const previewProject = useMemo<Project>(() => {
    if (drag.kind !== 'move' && drag.kind !== 'handle') return project;
    const p: Project = { ...project, floor: structuredClone(project.floor) };
    const ids = new Set(selection);

    if (drag.kind === 'move') {
      const d = sub(drag.last, drag.start);
      p.floor.walls.forEach((w) => {
        if (ids.has(w.id)) {
          w.a = add(w.a, d);
          w.b = add(w.b, d);
        }
      });
      p.floor.columns.forEach((c) => {
        if (ids.has(c.id)) {
          c.x += d.x;
          c.y += d.y;
        }
      });
      p.floor.items.forEach((i) => {
        if (ids.has(i.id) && !i.locked) {
          i.x += d.x;
          i.y += d.y;
        }
      });
      p.floor.zones.forEach((z) => {
        if (ids.has(z.id)) z.points = z.points.map((pt) => add(pt, d));
      });
      p.floor.dimensions.forEach((dm) => {
        if (ids.has(dm.id)) {
          dm.a = add(dm.a, d);
          dm.b = add(dm.b, d);
        }
      });
      // Une ouverture seule glisse le long de son mur.
      p.floor.openings.forEach((o) => {
        if (!ids.has(o.id)) return;
        const w = p.floor.walls.find((x) => x.id === o.wallId);
        if (!w) return;
        const dir = norm(sub(w.b, w.a));
        const along = d.x * dir.x + d.y * dir.y;
        Object.assign(o, clampOpening({ ...o, offset: o.offset + along }, w));
      });
      return p;
    }

    const h = drag.handle;
    const cur = drag.current;
    if (h.type === 'wall-end') {
      const w = p.floor.walls.find((x) => x.id === h.id);
      if (w) w[h.end] = cur;
    } else if (h.type === 'zone-point') {
      const z = p.floor.zones.find((x) => x.id === h.id);
      if (z) z.points[h.index] = cur;
    } else if (h.type === 'dimension-end') {
      const dm = p.floor.dimensions.find((x) => x.id === h.id);
      if (dm) dm[h.end] = cur;
    } else if (h.type === 'item-rotate') {
      const it = p.floor.items.find((x) => x.id === h.id);
      if (it) {
        const ang = (Math.atan2(cur.y - it.y, cur.x - it.x) * 180) / Math.PI + 90;
        it.rotation = project.settings.snapAngle ? Math.round(ang / 5) * 5 : ang;
      }
    } else if (h.type === 'item-corner') {
      const it = p.floor.items.find((x) => x.id === h.id);
      if (it) {
        // On redimensionne dans le repere local de l'objet, en gardant le coin oppose fixe.
        const orig = project.floor.items.find((x) => x.id === h.id)!;
        const corners = itemCorners(orig);
        const opposite = corners[(h.index + 2) % 4];
        const localCur = rotate(sub(cur, opposite), -orig.rotation);
        const w = Math.max(0.1, Math.abs(localCur.x));
        const dpt = Math.max(0.1, Math.abs(localCur.y));
        const signX = Math.sign(localCur.x) || 1;
        const signY = Math.sign(localCur.y) || 1;
        const centerLocal = { x: (signX * w) / 2, y: (signY * dpt) / 2 };
        const centerWorld = add(opposite, rotate(centerLocal, orig.rotation));
        it.width = w;
        it.depth = dpt;
        it.x = centerWorld.x;
        it.y = centerWorld.y;
      }
    }
    return p;
  }, [project, drag, selection]);

  // ------------------------------------------------------------------ circulation
  const circulation = useMemo(() => {
    if (!project.settings.showCirculation) return null;
    return analyseCirculation(previewProject.floor, project.settings.minAisleWidth);
  }, [previewProject.floor, project.settings.showCirculation, project.settings.minAisleWidth]);

  // ----------------------------------------------------------------------- rendu
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderPlan(ctx, {
      viewport: size,
      camera,
      project: previewProject,
      selection: new Set(selection),
      hover,
      draft,
      circulation,
      backgroundImage: getBackgroundImage(),
      theme: 'screen',
      showHandles: true,
      marquee: drag.kind === 'marquee' ? { a: drag.start, b: drag.current } : null,
    });
  }, [size, camera, previewProject, selection, hover, draft, circulation, drag]);

  // ------------------------------------------------------------------ pointeurs
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const raw = toWorld(e);
    const st = store.getState();

    // Pan : molette enfoncee, clic droit, ou outil main
    if (e.button === 1 || (e.button === 0 && (tool === 'pan' || e.altKey))) {
      setDrag({ kind: 'pan', startScreen: { x: e.clientX, y: e.clientY }, startCam: { x: camera.x, y: camera.y } });
      return;
    }
    if (e.button !== 0) return;

    // Depot d'un objet du catalogue
    if (pendingCatalogId) {
      const p = applySnap(raw);
      const id = st.addItem(pendingCatalogId, p);
      if (id) st.select([id]);
      if (!e.shiftKey) st.setPendingCatalog(null);
      return;
    }

    const tolWorld = HIT_TOL_PX / camera.zoom;
    const handleTol = HANDLE_TOL_PX / camera.zoom;

    switch (tool) {
      case 'select': {
        const h = hitHandle(project, raw, new Set(selection), handleTol);
        if (h) {
          setDrag({ kind: 'handle', handle: h, start: raw, current: raw });
          return;
        }
        const hitRes = hitTest(project, raw, tolWorld);
        if (hitRes) {
          const already = selection.includes(hitRes.id);
          if (e.shiftKey) st.select([hitRes.id], true);
          else if (!already) st.select([hitRes.id]);
          const snapped = applySnap(raw, { ignore: new Set(selection) });
          setDrag({ kind: 'move', start: snapped, last: snapped });
        } else {
          if (!e.shiftKey) st.clearSelection();
          setDrag({ kind: 'marquee', start: raw, current: raw });
        }
        return;
      }

      case 'wall':
      case 'partition': {
        const pts = draft?.points ?? [];
        const from = pts.length ? pts[pts.length - 1] : null;
        const p = applySnap(raw, { from });
        st.setDraft({ tool, points: [...pts, p], cursor: p });
        return;
      }

      case 'door':
      case 'window': {
        const w = wallUnder(project, raw, tolWorld * 3);
        if (!w) {
          st.notify('Cliquez sur un mur pour y placer une ouverture.', 'error');
          return;
        }
        const id = st.addOpening(w.wallId, w.offset, tool === 'door' ? 'door' : 'window');
        if (id) {
          st.select([id]);
          st.setTool('select');
        }
        return;
      }

      case 'column': {
        const id = st.addColumn(applySnap(raw));
        st.select([id]);
        if (!e.shiftKey) st.setTool('select');
        return;
      }

      case 'zone': {
        const pts = draft?.points ?? [];
        const p = applySnap(raw, { from: pts.length ? pts[pts.length - 1] : null });
        st.setDraft({ tool: 'zone', points: [...pts, p], cursor: p });
        return;
      }

      case 'dimension':
      case 'measure':
      case 'calibrate': {
        const pts = draft?.points ?? [];
        const p = applySnap(raw, { from: pts.length ? pts[0] : null });
        if (!pts.length) {
          st.setDraft({ tool, points: [p], cursor: p });
        } else {
          const a = pts[0];
          if (tool === 'dimension') {
            const id = st.addDimension(a, p);
            st.select([id]);
            st.setTool('select');
          } else if (tool === 'measure') {
            st.notify(`Distance mesurée : ${fmtM(dist(a, p))}`, 'info');
          } else {
            if (!project.background) {
              st.notify("Importez d'abord un plan avant de régler l'échelle.", 'error');
            } else {
              st.setCalibration({ a, b: p });
            }
          }
          st.setDraft(null);
        }
        return;
      }

      default:
        return;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const raw = toWorld(e);
    setCursorWorld(raw);
    const st = store.getState();

    if (drag.kind === 'pan') {
      const dx = (e.clientX - drag.startScreen.x) / camera.zoom;
      const dy = (e.clientY - drag.startScreen.y) / camera.zoom;
      st.setCamera({ x: drag.startCam.x - dx, y: drag.startCam.y - dy });
      return;
    }
    if (drag.kind === 'move') {
      const snapped = applySnap(raw, { ignore: new Set(selection) });
      setDrag({ ...drag, last: snapped });
      return;
    }
    if (drag.kind === 'marquee') {
      setDrag({ ...drag, current: raw });
      return;
    }
    if (drag.kind === 'handle') {
      const h = drag.handle;
      const ignore = new Set([h.id]);
      const snapped = h.type === 'item-rotate' ? raw : applySnap(raw, { ignore });
      setDrag({ ...drag, current: snapped });
      return;
    }

    // Pas de glissement en cours : survol + previsualisation de l'outil
    if (tool === 'select') {
      const hitRes = hitTest(project, raw, HIT_TOL_PX / camera.zoom);
      setHover(hitRes?.id ?? null);
    } else {
      setHover(null);
    }
    if (draft) {
      const from = draft.points.length ? draft.points[draft.points.length - 1] : null;
      st.setDraft({ ...draft, cursor: applySnap(raw, { from: draft.tool === 'zone' ? from : from }) });
    }
  };

  const finishDrag = () => {
    const st = store.getState();
    if (drag.kind === 'move') {
      const d = sub(drag.last, drag.start);
      if (Math.abs(d.x) > 1e-6 || Math.abs(d.y) > 1e-6) {
        const openingIds = selection.filter((id) => project.floor.openings.some((o) => o.id === id));
        if (openingIds.length) {
          // Les ouvertures coulissent le long de leur mur : traitement dedie.
          openingIds.forEach((id) => {
            const o = project.floor.openings.find((x) => x.id === id)!;
            const w = project.floor.walls.find((x) => x.id === o.wallId);
            if (!w) return;
            const dir = norm(sub(w.b, w.a));
            st.updateOpening(id, { offset: o.offset + d.x * dir.x + d.y * dir.y });
          });
        }
        const others = selection.filter((id) => !openingIds.includes(id));
        if (others.length) {
          // moveSelection agit sur la selection du store : on la restreint le temps du deplacement.
          st.select(others);
          st.moveSelection(d);
          st.select(selection);
        }
      }
    } else if (drag.kind === 'marquee') {
      const ids = hitRect(project, drag.start, drag.current);
      if (ids.length) st.select(ids);
    } else if (drag.kind === 'handle') {
      const h = drag.handle;
      const preview = previewProject;
      if (h.type === 'wall-end') {
        const w = preview.floor.walls.find((x) => x.id === h.id);
        if (w) st.updateWall(h.id, { a: w.a, b: w.b });
      } else if (h.type === 'zone-point') {
        const z = preview.floor.zones.find((x) => x.id === h.id);
        if (z) st.updateZone(h.id, { points: z.points });
      } else if (h.type === 'dimension-end') {
        const dm = preview.floor.dimensions.find((x) => x.id === h.id);
        if (dm) st.updateDimension(h.id, { a: dm.a, b: dm.b });
      } else if (h.type === 'item-rotate' || h.type === 'item-corner') {
        const it = preview.floor.items.find((x) => x.id === h.id);
        if (it) st.updateItem(h.id, { x: it.x, y: it.y, width: it.width, depth: it.depth, rotation: it.rotation });
      }
    }
    setDrag({ kind: 'none' });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* le pointeur peut avoir deja ete libere */
    }
    finishDrag();
  };

  /** Termine la polyligne en cours (mur ou zone). */
  const finishDraft = useCallback(() => {
    const st = store.getState();
    const d = st.draft;
    if (!d) return;
    if ((d.tool === 'wall' || d.tool === 'partition') && d.points.length >= 2) {
      for (let i = 0; i < d.points.length - 1; i++) {
        if (dist(d.points[i], d.points[i + 1]) > 0.01) {
          st.addWall(d.points[i], d.points[i + 1], d.tool === 'wall' ? 'wall' : 'partition');
        }
      }
    } else if (d.tool === 'zone' && d.points.length >= 3) {
      st.addZone(d.points, 'autre', 'Zone');
    }
    st.setDraft(null);
  }, [store]);

  const onDoubleClick = () => {
    if (draft) finishDraft();
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (draft) finishDraft();
  };

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const anchor = screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }, camera, size);
      store.getState().zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, anchor);
    },
    [camera, size, store],
  );

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // ------------------------------------------------------------------- clavier
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const st = store.getState();

      if (e.key === 'Escape') {
        if (st.draft) st.setDraft(null);
        else if (st.pendingCatalogId) st.setPendingCatalog(null);
        else st.clearSelection();
        return;
      }
      if (e.key === 'Enter') {
        finishDraft();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        st.deleteSelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        st.duplicateSelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        st.saveNow();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const f = st.project.floor;
        st.select([
          ...f.walls.map((x) => x.id),
          ...f.items.map((x) => x.id),
          ...f.columns.map((x) => x.id),
          ...f.zones.map((x) => x.id),
          ...f.dimensions.map((x) => x.id),
        ]);
        return;
      }
      if (e.key.toLowerCase() === 'r' && st.selection.length) {
        st.rotateSelection(e.shiftKey ? -90 : 90);
        return;
      }
      // Deplacement precis au clavier
      const step = e.shiftKey ? st.project.settings.gridSize : 0.05;
      const moves: Record<string, Vec2> = {
        ArrowUp: { x: 0, y: -step },
        ArrowDown: { x: 0, y: step },
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
      };
      if (moves[e.key] && st.selection.length) {
        e.preventDefault();
        st.moveSelection(moves[e.key]);
        return;
      }
      // Raccourcis d'outils
      const tools: Record<string, string> = {
        v: 'select',
        h: 'pan',
        m: 'wall',
        c: 'partition',
        p: 'door',
        f: 'window',
        o: 'column',
        z: 'zone',
        k: 'dimension',
      };
      if (!e.ctrlKey && !e.metaKey && tools[e.key.toLowerCase()]) {
        st.setTool(tools[e.key.toLowerCase()] as never);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, finishDraft]);

  // ---------------------------------------------------------------- info-bulle
  const hint = useMemo(() => {
    if (pendingCatalogId) return 'Cliquez pour poser l’objet — Maj pour en poser plusieurs — Échap pour annuler';
    switch (tool) {
      case 'wall':
      case 'partition':
        return 'Cliquez pour enchaîner les segments — Entrée / double-clic pour terminer';
      case 'door':
        return 'Cliquez sur un mur pour y percer une porte';
      case 'window':
        return 'Cliquez sur un mur pour y percer une fenêtre';
      case 'column':
        return 'Cliquez pour poser un poteau';
      case 'zone':
        return 'Cliquez les sommets — Entrée / double-clic pour fermer la zone';
      case 'dimension':
        return 'Cliquez le point de départ puis le point d’arrivée';
      case 'calibrate':
        return 'Tracez une distance connue sur le plan importé, puis saisissez sa valeur réelle';
      case 'measure':
        return 'Cliquez deux points pour mesurer une distance';
      case 'pan':
        return 'Glissez pour vous déplacer dans le plan';
      default:
        return 'Clic : sélectionner — Glisser : déplacer — Alt+glisser : naviguer — Molette : zoomer';
    }
  }, [tool, pendingCatalogId]);

  const cursorStyle =
    drag.kind === 'pan' || tool === 'pan'
      ? 'grabbing'
      : pendingCatalogId || tool !== 'select'
        ? 'crosshair'
        : hover
          ? 'move'
          : 'default';

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="plan-canvas"
        style={{ cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      />
      <div className="canvas-hint">{hint}</div>
      <div className="canvas-coords">
        x&nbsp;{cursorWorld.x.toFixed(2)} m &nbsp;·&nbsp; y&nbsp;{cursorWorld.y.toFixed(2)} m &nbsp;·&nbsp; zoom&nbsp;
        {Math.round(camera.zoom)} px/m
      </div>
    </div>
  );
}

