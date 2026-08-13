import type { Project } from '../types';
import { defaultExisting, defaultSettings, emptyFloor } from '../types';
import { uid } from '../lib/geometry';

const INDEX_KEY = 'planstore.projects.index';
const PROJECT_KEY = (id: string) => `planstore.project.${id}`;
const LAST_KEY = 'planstore.lastProjectId';

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function createProject(name = 'Nouveau projet'): Project {
  const now = Date.now();
  return {
    id: uid('prj'),
    name,
    createdAt: now,
    updatedAt: now,
    floor: emptyFloor(),
    background: null,
    existing: defaultExisting(),
    settings: defaultSettings(),
  };
}

export function listProjects(): ProjectSummary[] {
  const list = safeParse<ProjectSummary[]>(localStorage.getItem(INDEX_KEY), []);
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

function writeIndex(list: ProjectSummary[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

function upsertIndex(p: Project): void {
  const list = safeParse<ProjectSummary[]>(localStorage.getItem(INDEX_KEY), []);
  const entry: ProjectSummary = {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
  const i = list.findIndex((x) => x.id === p.id);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  writeIndex(list);
}

export class StorageFullError extends Error {
  constructor() {
    super(
      "L'espace de stockage du navigateur est plein. Supprimez un projet, ou retirez le plan de fond importé (souvent très volumineux), puis réessayez.",
    );
    this.name = 'StorageFullError';
  }
}

export function saveProject(project: Project): Project {
  const p: Project = { ...project, updatedAt: Date.now() };
  try {
    localStorage.setItem(PROJECT_KEY(p.id), JSON.stringify(p));
  } catch (e) {
    if (e instanceof DOMException) throw new StorageFullError();
    throw e;
  }
  upsertIndex(p);
  localStorage.setItem(LAST_KEY, p.id);
  return p;
}

export function loadProject(id: string): Project | null {
  const p = safeParse<Project | null>(localStorage.getItem(PROJECT_KEY(id)), null);
  if (!p) return null;
  return migrate(p);
}

export function deleteProject(id: string): void {
  localStorage.removeItem(PROJECT_KEY(id));
  writeIndex(listProjects().filter((p) => p.id !== id));
  if (localStorage.getItem(LAST_KEY) === id) localStorage.removeItem(LAST_KEY);
}

export function duplicateProject(id: string, newName?: string): Project | null {
  const src = loadProject(id);
  if (!src) return null;
  const now = Date.now();
  const copy: Project = {
    ...structuredClone(src),
    id: uid('prj'),
    name: newName ?? `${src.name} (copie)`,
    createdAt: now,
    updatedAt: now,
  };
  return saveProject(copy);
}

export function renameProject(id: string, name: string): void {
  const p = loadProject(id);
  if (!p) return;
  saveProject({ ...p, name });
}

export function lastProjectId(): string | null {
  return localStorage.getItem(LAST_KEY);
}

/** Complete un projet charge depuis une version anterieure du format. */
export function migrate(p: Project): Project {
  return {
    ...p,
    floor: { ...emptyFloor(), ...p.floor },
    existing: { ...defaultExisting(), ...(p.existing ?? {}) },
    settings: { ...defaultSettings(), ...(p.settings ?? {}) },
    background: p.background ?? null,
  };
}

/** Export du projet dans un fichier .json telecharge. */
export function exportProjectFile(project: Project): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug(project.name)}.planstore.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importProjectFile(file: File): Promise<Project> {
  const text = await file.text();
  const raw = JSON.parse(text) as Project;
  if (!raw || typeof raw !== 'object' || !raw.floor) {
    throw new Error('Fichier de projet invalide.');
  }
  const now = Date.now();
  return migrate({
    ...raw,
    id: uid('prj'),
    name: raw.name ? `${raw.name} (importé)` : 'Projet importé',
    createdAt: raw.createdAt ?? now,
    updatedAt: now,
  });
}

export function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'projet'
  );
}
