/**
 * Couche de persistance du module de gestion.
 *
 * L'application tourne aujourd'hui dans le navigateur : le stockage est
 * localStorage. Mais TOUT passe par l'interface `Repository` ci-dessous, et
 * aucun ecran n'appelle localStorage directement. Le jour ou l'application
 * passe en production avec PostgreSQL, il suffit d'ecrire un `HttpRepository`
 * qui implemente la meme interface (voir la note en bas de fichier) : aucun
 * ecran, aucun calcul, aucun export n'a besoin d'etre touche.
 *
 * Les sauvegardes de securite sont tournantes : a chaque ecriture, l'etat
 * precedent est empile dans un anneau de N sauvegardes. Une fausse manoeuvre
 * se rattrape donc sans fichier externe.
 */

import { uid } from '../lib/geometry';
import {
  SCHEMA_VERSION,
  defaultCompany,
  defaultSettings,
  type GestionDB,
} from './types';

const DB_KEY = 'gestion.db.v1';
const BACKUP_KEY = (n: number) => `gestion.backup.${n}`;
const BACKUP_INDEX_KEY = 'gestion.backup.index';

/** Base vide : aucun produit, aucun taux. La graine est posee par seed.ts. */
export function emptyDB(): GestionDB {
  return {
    schemaVersion: SCHEMA_VERSION,
    rev: 0,
    updatedAt: Date.now(),
    company: defaultCompany(),
    vatRates: [],
    families: [],
    suppliers: [],
    products: [],
    lots: [],
    movements: [],
    orders: [],
    receptions: [],
    invoices: [],
    payments: [],
    sales: [],
    inventories: [],
    losses: [],
    priceHistory: [],
    documents: [],
    users: [],
    currentUserId: '',
    audit: [],
    settings: defaultSettings(),
    counters: {},
  };
}

/** Erreur de quota : message actionnable plutot qu'une DOMException brute. */
export class GestionStorageFullError extends Error {
  constructor() {
    super(
      "L'espace de stockage du navigateur est plein. Faites une sauvegarde en fichier, " +
        'puis purgez les justificatifs volumineux ou les mouvements les plus anciens.',
    );
    this.name = 'GestionStorageFullError';
  }
}

export interface Repository {
  load(): GestionDB | null;
  save(db: GestionDB): void;
  clear(): void;
  /** Sauvegardes de securite disponibles, plus recente en premier */
  backups(): BackupInfo[];
  restoreBackup(id: number): GestionDB | null;
}

export interface BackupInfo {
  id: number;
  date: number;
  /** Taille approximative en octets */
  size: number;
  label: string;
}

/** Implementation navigateur. */
export class LocalRepository implements Repository {
  load(): GestionDB | null {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return null;
    try {
      return migrate(JSON.parse(raw) as GestionDB);
    } catch {
      return null;
    }
  }

  save(db: GestionDB): void {
    const payload = JSON.stringify(db);
    try {
      // On empile l'etat PRECEDENT avant d'ecrire le nouveau : la sauvegarde
      // de securite represente donc toujours un etat anterieur exploitable.
      const previous = localStorage.getItem(DB_KEY);
      if (previous) this.pushBackup(previous, db.settings.backupCount);
      localStorage.setItem(DB_KEY, payload);
    } catch (e) {
      if (e instanceof DOMException) {
        // Le quota est peut-etre sature par les sauvegardes : on les libere
        // et on retente une fois avant d'abandonner.
        this.dropBackups();
        try {
          localStorage.setItem(DB_KEY, payload);
          return;
        } catch {
          throw new GestionStorageFullError();
        }
      }
      throw e;
    }
  }

  clear(): void {
    localStorage.removeItem(DB_KEY);
  }

  private pushBackup(payload: string, keep: number): void {
    const count = Math.max(0, Math.min(20, keep));
    if (count === 0) return;
    const index = this.backupIndex();
    const next = (index[0]?.id ?? 0) + 1;
    try {
      localStorage.setItem(BACKUP_KEY(next), payload);
    } catch {
      return; // une sauvegarde de securite ne doit jamais bloquer l'ecriture
    }
    const info: BackupInfo = {
      id: next,
      date: Date.now(),
      size: payload.length,
      label: new Date().toLocaleString('fr-FR'),
    };
    const list = [info, ...index];
    for (const old of list.slice(count)) localStorage.removeItem(BACKUP_KEY(old.id));
    localStorage.setItem(BACKUP_INDEX_KEY, JSON.stringify(list.slice(0, count)));
  }

  private backupIndex(): BackupInfo[] {
    try {
      return JSON.parse(localStorage.getItem(BACKUP_INDEX_KEY) ?? '[]') as BackupInfo[];
    } catch {
      return [];
    }
  }

  private dropBackups(): void {
    for (const b of this.backupIndex()) localStorage.removeItem(BACKUP_KEY(b.id));
    localStorage.removeItem(BACKUP_INDEX_KEY);
  }

  backups(): BackupInfo[] {
    return this.backupIndex();
  }

  restoreBackup(id: number): GestionDB | null {
    const raw = localStorage.getItem(BACKUP_KEY(id));
    if (!raw) return null;
    try {
      return migrate(JSON.parse(raw) as GestionDB);
    } catch {
      return null;
    }
  }
}

export const repository: Repository = new LocalRepository();

/**
 * Complete une base chargee depuis une version anterieure du schema.
 * Chaque collection absente est recreee vide : une base ancienne s'ouvre
 * toujours, sans perte des donnees deja presentes.
 */
export function migrate(db: Partial<GestionDB>): GestionDB {
  const base = emptyDB();
  return {
    ...base,
    ...db,
    schemaVersion: SCHEMA_VERSION,
    company: { ...base.company, ...(db.company ?? {}) },
    settings: {
      ...base.settings,
      ...(db.settings ?? {}),
      alerts: { ...base.settings.alerts, ...(db.settings?.alerts ?? {}) },
    },
    vatRates: db.vatRates ?? [],
    families: db.families ?? [],
    suppliers: db.suppliers ?? [],
    products: db.products ?? [],
    lots: db.lots ?? [],
    movements: db.movements ?? [],
    orders: db.orders ?? [],
    receptions: db.receptions ?? [],
    invoices: db.invoices ?? [],
    payments: db.payments ?? [],
    sales: db.sales ?? [],
    inventories: db.inventories ?? [],
    losses: db.losses ?? [],
    priceHistory: db.priceHistory ?? [],
    documents: db.documents ?? [],
    users: db.users ?? [],
    audit: db.audit ?? [],
    counters: db.counters ?? {},
  };
}

// ------------------------------------------------------------ remise a zero

/**
 * Perimetres de remise a zero. Chacun est independant : on peut vider les
 * mouvements sans perdre le referentiel produits, ou repartir a neuf.
 */
export type ResetScope =
  | 'mouvements'
  | 'ventes'
  | 'achats'
  | 'inventaires'
  | 'pertes'
  | 'documents'
  | 'produits'
  | 'fournisseurs'
  | 'audit'
  | 'parametres'
  | 'tout';

export const RESET_SCOPES: Array<{ id: ResetScope; label: string; detail: string }> = [
  {
    id: 'mouvements',
    label: 'Journal des mouvements',
    detail: 'Vide le journal de stock. Les quantités repartent de zéro, le référentiel est conservé.',
  },
  {
    id: 'ventes',
    label: 'Ventes et tickets',
    detail: 'Supprime les tickets de caisse et les sorties de stock correspondantes.',
  },
  {
    id: 'achats',
    label: 'Achats',
    detail: 'Supprime commandes, réceptions, factures et règlements fournisseurs.',
  },
  { id: 'inventaires', label: 'Inventaires', detail: 'Supprime les inventaires et leurs régularisations.' },
  { id: 'pertes', label: 'Pertes et démarque', detail: 'Supprime les pertes enregistrées et leurs mouvements.' },
  { id: 'documents', label: 'Documents et justificatifs', detail: 'Supprime les pièces rattachées.' },
  {
    id: 'produits',
    label: 'Fiches produits',
    detail: 'Supprime les produits, ainsi que tout ce qui en dépend (mouvements, lignes, lots).',
  },
  { id: 'fournisseurs', label: 'Fiches fournisseurs', detail: 'Supprime les fournisseurs et les délie des produits.' },
  { id: 'audit', label: "Journal d'audit", detail: "Purge l'historique des modifications." },
  { id: 'parametres', label: 'Paramètres et société', detail: 'Rétablit les réglages par défaut.' },
  { id: 'tout', label: 'Tout remettre à zéro', detail: 'Repart d’une base entièrement vide.' },
];

/** Applique une remise a zero sur une copie de la base. */
export function applyReset(db: GestionDB, scope: ResetScope): GestionDB {
  const next: GestionDB = structuredClone(db);
  switch (scope) {
    case 'mouvements':
      next.movements = [];
      next.lots = [];
      break;
    case 'ventes':
      next.sales = [];
      next.movements = next.movements.filter((m) => m.type !== 'vente');
      break;
    case 'achats':
      next.orders = [];
      next.receptions = [];
      next.invoices = [];
      next.payments = [];
      next.movements = next.movements.filter((m) => m.type !== 'reception' && m.type !== 'retour_fournisseur');
      break;
    case 'inventaires':
      next.inventories = [];
      next.movements = next.movements.filter((m) => m.type !== 'inventaire');
      break;
    case 'pertes':
      next.losses = [];
      next.movements = next.movements.filter(
        (m) => !['casse', 'perime', 'vol', 'demarque'].includes(m.type),
      );
      break;
    case 'documents':
      next.documents = [];
      next.invoices = next.invoices.map((i) => ({ ...i, attachment: null }));
      break;
    case 'produits':
      next.products = [];
      next.lots = [];
      next.movements = [];
      next.orders = [];
      next.receptions = [];
      next.sales = [];
      next.inventories = [];
      next.losses = [];
      next.priceHistory = [];
      break;
    case 'fournisseurs':
      next.suppliers = [];
      next.products = next.products.map((p) => ({ ...p, suppliers: [] }));
      next.orders = [];
      next.receptions = [];
      next.invoices = [];
      next.payments = [];
      break;
    case 'audit':
      next.audit = [];
      break;
    case 'parametres':
      next.company = defaultCompany();
      next.settings = defaultSettings();
      break;
    case 'tout': {
      const fresh = emptyDB();
      fresh.users = db.users;
      fresh.currentUserId = db.currentUserId;
      return fresh;
    }
  }
  return next;
}

// ------------------------------------------------------------ sauvegarde fichier

/** Enveloppe d'un fichier de sauvegarde, pour reconnaitre ce qu'on relit. */
export interface BackupFile {
  format: 'planstore-gestion';
  schemaVersion: number;
  exportedAt: number;
  db: GestionDB;
}

export function serializeBackup(db: GestionDB): string {
  const file: BackupFile = {
    format: 'planstore-gestion',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    db,
  };
  return JSON.stringify(file, null, 2);
}

export function parseBackup(text: string): GestionDB {
  const raw = JSON.parse(text) as BackupFile | GestionDB;
  const candidate =
    typeof raw === 'object' && raw !== null && 'format' in raw && raw.format === 'planstore-gestion'
      ? (raw as BackupFile).db
      : (raw as GestionDB);
  if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.products)) {
    throw new Error('Fichier de sauvegarde illisible : ce n’est pas une base de gestion.');
  }
  return migrate(candidate);
}

/** Numerotation continue des documents : « BC-2026-0007 ». */
export function nextNumber(db: GestionDB, prefix: string): string {
  const year = new Date().getFullYear();
  const key = `${prefix}-${year}`;
  const n = (db.counters[key] ?? 0) + 1;
  db.counters[key] = n;
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}

export function newId(prefix: string): string {
  return uid(prefix);
}

/*
 * Passage en production (PostgreSQL ou equivalent)
 * ------------------------------------------------
 * Le modele est deja relationnel : chaque collection de `GestionDB` correspond
 * a une table, et les liens se font par identifiant (`productId`,
 * `supplierId`, `orderId`…). La migration consiste a :
 *   1. creer une table par collection, en gardant les memes noms de colonnes ;
 *   2. ecrire une classe `HttpRepository implements Repository` qui appelle
 *      une API REST au lieu de localStorage ;
 *   3. remplacer l'export `repository` ci-dessus.
 * Le journal des mouvements est concu en ecriture seule (append-only) : il se
 * traduit directement en table d'audit, sans retouche du modele.
 */
