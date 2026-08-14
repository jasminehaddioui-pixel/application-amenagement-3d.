import { jsPDF } from 'jspdf';
import type { Project, Vec2 } from '../types';
import { renderPlan } from '../editor2d/render';
import { loadImageAsync } from '../editor2d/bgImage';
import { analyseCirculation } from './circulation';
import { itemCorners, polygonArea, polygonBounds, wallPolygon } from './geometry';
import { slug } from '../state/projects';
import { ZONE_PRESET_BY_CATEGORY } from './zones';

const MM_PER_INCH = 25.4;
const DPI = 200;
const PX_PER_MM = DPI / MM_PER_INCH;

export interface PlanRenderResult {
  canvas: HTMLCanvasElement;
  /** Denominateur de l'echelle du dessin (1:scaleDenominator) */
  scaleDenominator: number;
}

/** Emprise du contenu du plan, en metres. */
export function planContentBounds(project: Project) {
  const pts: Vec2[] = [];
  project.floor.walls.forEach((w) => wallPolygon(w).forEach((p) => pts.push(p)));
  project.floor.items.forEach((i) => itemCorners(i).forEach((p) => pts.push(p)));
  project.floor.zones.forEach((z) => z.points.forEach((p) => pts.push(p)));
  project.floor.columns.forEach((c) => pts.push({ x: c.x, y: c.y }));
  project.floor.dimensions.forEach((d) => pts.push(d.a, d.b));
  if (project.background?.visible) {
    pts.push({ x: project.background.x, y: project.background.y });
    pts.push({
      x: project.background.x + project.background.pxWidth * project.background.scale,
      y: project.background.y + project.background.pxHeight * project.background.scale,
    });
  }
  if (!pts.length) return { x: -5, y: -5, width: 10, height: 10 };
  const b = polygonBounds(pts);
  return { x: b.x, y: b.y, width: Math.max(1, b.width), height: Math.max(1, b.height) };
}

/**
 * Rend le plan dans un canevas hors-ecran, cadre sur le contenu.
 * Utilise pour l'export PDF, l'export PNG et l'impression.
 */
export async function renderPlanToCanvas(
  project: Project,
  widthPx: number,
  heightPx: number,
  theme: 'print' | 'screen' = 'print',
): Promise<PlanRenderResult> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(widthPx);
  canvas.height = Math.round(heightPx);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible.');

  const b = planContentBounds(project);
  const padM = 1.2;
  const zoom = Math.min(
    canvas.width / (b.width + padM * 2),
    canvas.height / (b.height + padM * 2),
  );

  let backgroundImage: HTMLImageElement | null = null;
  if (project.background?.visible && project.background.src) {
    try {
      backgroundImage = await loadImageAsync(project.background.src);
    } catch {
      backgroundImage = null;
    }
  }

  const circulation = project.settings.showCirculation
    ? analyseCirculation(project.floor, project.settings.minAisleWidth)
    : null;

  renderPlan(ctx, {
    viewport: { width: canvas.width, height: canvas.height },
    camera: { x: b.x + b.width / 2, y: b.y + b.height / 2, zoom },
    project,
    selection: new Set(),
    hover: null,
    draft: null,
    circulation,
    backgroundImage,
    theme,
    showHandles: false,
    marquee: null,
  });

  // 1 m de plan occupe `zoom` px, soit zoom/PX_PER_MM mm sur le papier.
  const mmPerMeter = zoom / PX_PER_MM;
  const scaleDenominator = Math.round(1000 / Math.max(0.0001, mmPerMeter));

  return { canvas, scaleDenominator };
}

/** Statistiques affichees dans le cartouche. */
export function projectStats(project: Project) {
  const { floor } = project;
  const salesZones = floor.zones.filter((z) => z.category === 'vente');
  const salesArea = salesZones.reduce((s, z) => s + polygonArea(z.points), 0);
  const totalZoneArea = floor.zones.reduce((s, z) => s + polygonArea(z.points), 0);
  const circ = analyseCirculation(floor, project.settings.minAisleWidth);
  const linear = floor.items
    .filter((i) => i.category === 'rayonnage' || i.category === 'froid')
    .reduce((s, i) => s + i.width, 0);
  return {
    walls: floor.walls.length,
    doors: floor.openings.filter((o) => o.type === 'door').length,
    windows: floor.openings.filter((o) => o.type === 'window').length,
    sliding: floor.openings.filter((o) => o.type === 'sliding').length,
    columns: floor.columns.length,
    items: floor.items.length,
    zones: floor.zones.length,
    salesArea,
    totalZoneArea,
    linear,
    narrow: circ.narrowCount,
    minAisle: circ.minWidth,
  };
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Export du plan 2D en PDF A4 paysage avec cartouche. */
export async function exportPlanPDF(project: Project): Promise<void> {
  const pageW = 297;
  const pageH = 210;
  const margin = 8;
  const cartoucheH = 34;

  const drawW = pageW - margin * 2;
  const drawH = pageH - margin * 2 - cartoucheH - 2;

  const { canvas, scaleDenominator } = await renderPlanToCanvas(
    project,
    drawW * PX_PER_MM,
    drawH * PX_PER_MM,
    'print',
  );

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, drawW, drawH);

  // Cadre du dessin
  pdf.setDrawColor(30);
  pdf.setLineWidth(0.3);
  pdf.rect(margin, margin, drawW, drawH);

  // ---- Cartouche
  const cy = margin + drawH + 2;
  pdf.rect(margin, cy, drawW, cartoucheH);
  const s = projectStats(project);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text(project.name, margin + 4, cy + 8);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  const col1 = margin + 4;
  const col2 = margin + drawW * 0.3;
  const col3 = margin + drawW * 0.55;
  const col4 = margin + drawW * 0.78;

  pdf.text(`Plan d'aménagement — supérette`, col1, cy + 14);
  pdf.text(`Édité le ${fmtDate(Date.now())}`, col1, cy + 19);
  pdf.text(`Dernière modification : ${fmtDate(project.updatedAt)}`, col1, cy + 24);
  pdf.text(`Hauteur sous plafond : ${project.settings.wallHeight.toFixed(2)} m`, col1, cy + 29);

  pdf.text(`Échelle approx. 1 : ${scaleDenominator}`, col2, cy + 14);
  pdf.text(`Murs : ${s.walls}`, col2, cy + 19);
  pdf.text(
    `Portes : ${s.doors}   Fenêtres : ${s.windows}   Portes auto. : ${s.sliding}`,
    col2,
    cy + 24,
  );
  pdf.text(`Poteaux : ${s.columns}`, col2, cy + 29);

  pdf.text(`Surface de vente : ${s.salesArea.toFixed(2)} m²`, col3, cy + 14);
  pdf.text(`Total zones : ${s.totalZoneArea.toFixed(2)} m²`, col3, cy + 19);
  pdf.text(`Mobilier : ${s.items} objets`, col3, cy + 24);
  pdf.text(`Linéaire au sol : ${s.linear.toFixed(2)} m`, col3, cy + 29);

  pdf.text(`Allée mini requise : ${project.settings.minAisleWidth.toFixed(2)} m`, col4, cy + 14);
  pdf.text(
    `Allée la plus étroite : ${s.minAisle !== null ? `${s.minAisle.toFixed(2)} m` : '—'}`,
    col4,
    cy + 19,
  );
  if (s.narrow > 0) {
    pdf.setTextColor(180, 30, 20);
    pdf.text(`${s.narrow} passage(s) sous le minimum`, col4, cy + 24);
    pdf.setTextColor(0);
  } else {
    pdf.text('Circulations conformes', col4, cy + 24);
  }
  const kept = [
    project.existing.carrelage && 'carrelage',
    project.existing.murs && 'murs',
    project.existing.portes && 'portes',
    project.existing.fenetres && 'fenêtres',
  ].filter(Boolean);
  pdf.text(`Existant conservé : ${kept.length ? kept.join(', ') : 'aucun'}`, col4, cy + 29);

  // ---- Legende des zones, en seconde page si le projet en comporte
  if (project.floor.zones.length) {
    pdf.addPage('a4', 'landscape');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.text('Légende des zones et nomenclature du mobilier', margin, margin + 8);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    let y = margin + 18;
    pdf.text('Zones', margin, y);
    y += 5;
    for (const z of project.floor.zones) {
      const preset = ZONE_PRESET_BY_CATEGORY[z.category];
      const c = hexToRgb(z.color);
      pdf.setFillColor(c.r, c.g, c.b);
      pdf.rect(margin, y - 3, 4, 4, 'F');
      pdf.text(
        `${z.name}  (${preset?.label ?? z.category})  —  ${polygonArea(z.points).toFixed(2)} m²`,
        margin + 6,
        y,
      );
      y += 5.2;
      if (y > pageH - margin - 6) break;
    }

    // Nomenclature du mobilier, regroupee par modele
    const counts = new Map<string, { name: string; n: number; w: number; d: number; h: number }>();
    for (const it of project.floor.items) {
      const key = `${it.catalogId}|${it.width}|${it.depth}|${it.height}`;
      const e = counts.get(key);
      if (e) e.n += 1;
      else counts.set(key, { name: it.name, n: 1, w: it.width, d: it.depth, h: it.height });
    }
    y = Math.max(y + 6, margin + 18);
    const colX = margin + drawW * 0.5;
    let y2 = margin + 18;
    pdf.text('Mobilier', colX, y2);
    y2 += 5;
    for (const e of counts.values()) {
      pdf.text(
        `${e.n} ×  ${e.name}  —  ${e.w.toFixed(2)} × ${e.d.toFixed(2)} × ${e.h.toFixed(2)} m`,
        colX,
        y2,
      );
      y2 += 5.2;
      if (y2 > pageH - margin - 6) break;
    }
  }

  pdf.save(`${slug(project.name)}-plan.pdf`);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Export du plan 2D en image PNG haute definition. */
export async function exportPlanPNG(project: Project): Promise<void> {
  const { canvas } = await renderPlanToCanvas(project, 3000, 2100, 'print');
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `${slug(project.name)}-plan.png`;
  a.click();
}

/** Ouvre la boite d'impression du navigateur avec le plan mis en page. */
export async function printPlan(project: Project): Promise<void> {
  const { canvas, scaleDenominator } = await renderPlanToCanvas(project, 2600, 1750, 'print');
  const dataUrl = canvas.toDataURL('image/png');
  const s = projectStats(project);

  const w = window.open('', '_blank');
  if (!w) throw new Error("La fenêtre d'impression a été bloquée par le navigateur.");
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8" />
<title>${escapeHtml(project.name)} — plan</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  body { font-family: system-ui, sans-serif; margin: 0; color: #111; }
  img { width: 100%; height: auto; border: 1px solid #333; box-sizing: border-box; }
  .cartouche { margin-top: 6px; border: 1px solid #333; padding: 8px 10px; display: grid;
               grid-template-columns: repeat(4, 1fr); gap: 4px 16px; font-size: 10px; }
  h1 { font-size: 15px; margin: 0 0 6px; grid-column: 1 / -1; }
</style></head><body>
<img src="${dataUrl}" alt="Plan" />
<div class="cartouche">
  <h1>${escapeHtml(project.name)} — plan d'aménagement</h1>
  <div>Édité le ${fmtDate(Date.now())}</div>
  <div>Échelle approx. 1 : ${scaleDenominator}</div>
  <div>Hauteur sous plafond : ${project.settings.wallHeight.toFixed(2)} m</div>
  <div>Murs : ${s.walls} — Portes : ${s.doors} — Fenêtres : ${s.windows} — Portes auto. : ${s.sliding}</div>
  <div>Surface de vente : ${s.salesArea.toFixed(2)} m²</div>
  <div>Total zones : ${s.totalZoneArea.toFixed(2)} m²</div>
  <div>Mobilier : ${s.items} objets</div>
  <div>${s.narrow > 0 ? `${s.narrow} passage(s) trop étroit(s)` : 'Circulations conformes'}</div>
</div>
<script>window.onload = function () { setTimeout(function () { window.print(); }, 250); };</script>
</body></html>`);
  w.document.close();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
