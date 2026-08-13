import type { Background } from '../types';

/**
 * Import d'un plan existant (PDF, JPG, PNG) comme fond de travail.
 * Un PDF est rasterise en image via pdf.js ; les images sont utilisees telles quelles.
 */

/** Largeur par defaut attribuee au plan importe, avant calibrage (m). */
const DEFAULT_PLAN_WIDTH_M = 20;

/** Resolution de rasterisation d'un PDF (px pour la plus grande dimension). */
const PDF_TARGET_PX = 2200;

export const ACCEPTED_TYPES = '.pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf';

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    r.readAsDataURL(file);
  });
}

function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Format d'image non reconnu."));
    img.src = src;
  });
}

/** Rasterise la premiere page d'un PDF en PNG (data URL). */
async function rasterizePdf(file: File): Promise<{ src: string; width: number; height: number }> {
  // Import dynamique : pdf.js n'est charge que si l'utilisateur importe un PDF.
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);

  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4, PDF_TARGET_PX / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible pour la conversion du PDF.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  return { src: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

/**
 * Construit le fond de plan a partir d'un fichier.
 * L'echelle initiale est arbitraire : l'utilisateur la corrige ensuite avec
 * l'outil « Régler l'échelle » en tracant une distance connue.
 */
export async function importPlanFile(file: File): Promise<Background> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

  let src: string;
  let pxWidth: number;
  let pxHeight: number;

  if (isPdf) {
    const r = await rasterizePdf(file);
    src = r.src;
    pxWidth = r.width;
    pxHeight = r.height;
  } else {
    src = await readAsDataURL(file);
    const s = await imageSize(src);
    pxWidth = s.width;
    pxHeight = s.height;
  }

  if (!pxWidth || !pxHeight) throw new Error('Plan illisible : dimensions inconnues.');

  const scale = DEFAULT_PLAN_WIDTH_M / pxWidth;

  return {
    src,
    fileName: file.name,
    x: 0,
    y: 0,
    scale,
    rotation: 0,
    opacity: 0.75,
    visible: true,
    locked: true,
    pxWidth,
    pxHeight,
  };
}

/** Taille approximative en Mo d'une data-URL (pour prevenir l'utilisateur). */
export function dataUrlSizeMB(src: string): number {
  const b64 = src.slice(src.indexOf(',') + 1);
  return (b64.length * 0.75) / (1024 * 1024);
}
