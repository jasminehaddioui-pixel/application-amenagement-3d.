/**
 * Lecture et ecriture de fichiers CSV.
 *
 * Le format vise Excel en francais : separateur point-virgule, decimales a la
 * virgule, encodage UTF-8 avec BOM pour que les accents ne soient pas casses a
 * l'ouverture. La lecture, elle, accepte les deux separateurs et les deux
 * conventions decimales : un fichier fournisseur passe sans retouche.
 */

export const CSV_SEP = ';';

/** Detecte le separateur le plus probable sur la premiere ligne. */
function detectSeparator(line: string): string {
  const counts = [';', ',', '\t', '|'].map((s) => [s, line.split(s).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ';';
}

/** Analyse un CSV en tenant compte des guillemets et des retours a la ligne. */
export function parseCSV(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.slice(0, clean.indexOf('\n') === -1 ? clean.length : clean.indexOf('\n'));
  const sep = detectSeparator(firstLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < clean.length; i += 1) {
    const c = clean[i];
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** Analyse un CSV avec en-tetes, et renvoie des objets indexes par colonne. */
export function parseCSVObjects(text: string): Array<Record<string, string>> {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => normalizeHeader(h));
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      o[h] = (r[i] ?? '').trim();
    });
    return o;
  });
}

/** Normalise un en-tete : minuscules, sans accent ni ponctuation. */
export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Nombre tolerant : « 1 234,56 € » devient 1234.56. */
export function parseNumber(value: string): number {
  if (!value) return 0;
  const cleaned = value
    .replace(/\s| |€/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Les decimales passent a la virgule : Excel francais les lit comme des nombres.
  if (typeof value === 'number' && Number.isFinite(value)) s = s.replace('.', ',');
  if (s.includes('"') || s.includes(CSV_SEP) || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialise un tableau de lignes en CSV. */
export function toCSV(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(escapeCell).join(CSV_SEP)];
  for (const r of rows) lines.push(r.map(escapeCell).join(CSV_SEP));
  return lines.join('\r\n');
}

/** Contenu d'un fichier CSV, avec le BOM attendu par Excel. */
export function csvBlob(content: string): Blob {
  return new Blob([`﻿${content}`], { type: 'text/csv;charset=utf-8' });
}

/** Declenche le telechargement d'un fichier. */
export function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCSV(fileName: string, headers: string[], rows: Array<Array<unknown>>): void {
  download(csvBlob(toCSV(headers, rows)), fileName);
}
