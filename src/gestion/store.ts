/**
 * Magasin d'etat du module de gestion.
 *
 * REGLE UNIQUE : toute modification passe par `mutate`. Cette fonction
 *  1. travaille sur une copie de la base ;
 *  2. incremente la revision (ce qui invalide l'index de calcul) ;
 *  3. journalise l'action dans l'audit, avec l'utilisateur et l'horodatage ;
 *  4. ECRIT IMMEDIATEMENT sur le support de stockage.
 *
 * Il n'y a donc pas de « modification non enregistree » : dès qu'un ajout ou
 * une correction est saisi, il est sur disque. Fermer l'onglet, recharger la
 * page ou changer d'ecran ne perd rien. Les autres onglets ouverts se
 * resynchronisent tout seuls.
 */

import { create } from 'zustand';
import {
  applyReset,
  emptyDB,
  nextNumber,
  newId,
  parseBackup,
  repository,
  serializeBackup,
  DB_KEY,
  type BackupInfo,
  type ResetScope,
} from './db';
import { seed } from './seed';
import { buildIndex, euro, invalidateIndex, marginOf, netCost, vatRateOf, type Index } from './calc';
import type {
  Company,
  Family,
  GestionDB,
  GestionSettings,
  Inventory,
  InventoryScope,
  Loss,
  LossReason,
  Payment,
  Product,
  PurchaseOrder,
  Reception,
  ReceptionLine,
  Sale,
  SaleLine,
  StockMovement,
  StoredDocument,
  Supplier,
  SupplierInvoice,
  User,
  VatRate,
  MovementType,
} from './types';

export type Screen =
  | 'tableau'
  | 'produits'
  | 'stocks'
  | 'inventaires'
  | 'achats'
  | 'fournisseurs'
  | 'receptions'
  | 'pertes'
  | 'marges'
  | 'tva'
  | 'comptabilite'
  | 'documents'
  | 'rapports'
  | 'dlc'
  | 'parametres';

export interface GestionNotice {
  id: string;
  text: string;
  type: 'info' | 'success' | 'error';
}

/** Options d'une mutation : ce qui alimente le journal d'audit. */
interface MutateOptions {
  scope: string;
  action: string;
  targetId?: string;
  targetLabel?: string;
  before?: string;
  after?: string;
  reason?: string;
  /** Mutation technique, non journalisee (navigation, chargement) */
  silent?: boolean;
}

const AUDIT_LIMIT = 5000;

function loadInitial(): GestionDB {
  const existing = repository.load();
  if (existing) return seed(existing);
  const fresh = seed(emptyDB());
  try {
    repository.save(fresh);
  } catch {
    /* le message d'erreur sera porte par la premiere ecriture utilisateur */
  }
  return fresh;
}

/** Carte des stocks courants, calculee une fois par mutation. */
function stockMap(db: GestionDB): Map<string, number> {
  const m = new Map<string, number>();
  for (const mv of db.movements) m.set(mv.productId, (m.get(mv.productId) ?? 0) + mv.quantity);
  return m;
}

export interface MovementInput {
  productId: string;
  type: MovementType;
  /** Quantite signee : positive en entree, negative en sortie */
  quantity: number;
  unitCost: number;
  reason: string;
  docType?: StockMovement['docType'];
  docId?: string;
  lotId?: string;
  date?: number;
}

/**
 * Ajoute une ligne au journal de stock. Le stock avant et apres est
 * photographie : on peut rejouer l'historique d'un produit sans ambiguite.
 */
function pushMovement(
  db: GestionDB,
  input: MovementInput,
  stocks: Map<string, number>,
  userId: string,
): StockMovement {
  const before = stocks.get(input.productId) ?? 0;
  const after = before + input.quantity;
  stocks.set(input.productId, after);
  const mv: StockMovement = {
    id: newId('mvt'),
    productId: input.productId,
    type: input.type,
    quantity: input.quantity,
    before,
    after,
    unitCost: input.unitCost,
    date: input.date ?? Date.now(),
    userId,
    reason: input.reason,
    docType: input.docType,
    docId: input.docId,
    lotId: input.lotId,
  };
  db.movements.push(mv);
  return mv;
}

/** Enregistre un changement de prix d'achat et mesure son impact sur la marge. */
function recordPriceChange(
  db: GestionDB,
  product: Product,
  newPrice: number,
  supplierId: string | null,
  source: 'reception' | 'saisie' | 'import',
  userId: string,
): void {
  const from = product.purchasePrice;
  if (!from || Math.abs(from - newPrice) < 0.0001) {
    product.purchasePrice = newPrice;
    return;
  }
  const idx = buildIndex(db);
  const rate = vatRateOf(idx, product.vatRateId);
  const before = marginOf(product, rate).marginRate;
  product.purchasePrice = newPrice;
  const after = marginOf(product, rate).marginRate;
  db.priceHistory.push({
    id: newId('prx'),
    productId: product.id,
    supplierId,
    date: Date.now(),
    from,
    to: newPrice,
    marginBefore: before,
    marginAfter: after,
    source,
    userId,
  });
}

export function emptyProduct(db: GestionDB): Product {
  const now = Date.now();
  return {
    id: newId('prd'),
    ref: '',
    ean: '',
    name: '',
    brand: '',
    familyId: null,
    subFamilyId: null,
    suppliers: [],
    purchaseUnit: 'piece',
    saleUnit: 'piece',
    packaging: '',
    unitsPerCase: 1,
    purchasePrice: 0,
    vatRateId: db.vatRates.find((v) => v.active)?.id ?? '',
    salePriceHT: 0,
    salePriceTTC: 0,
    stockMin: 0,
    stockMax: 0,
    safetyStock: 0,
    location: '',
    reserveLocation: '',
    perishable: false,
    lotTracked: false,
    active: true,
    createdAt: now,
    updatedAt: now,
    notes: '',
  };
}

export function emptySupplier(): Supplier {
  return {
    id: newId('frn'),
    code: '',
    name: '',
    siret: '',
    address: '',
    postalCode: '',
    city: '',
    contact: '',
    phone: '',
    email: '',
    paymentTerms: '',
    leadTimeDays: 2,
    freeShippingFrom: 0,
    minOrderAmount: 0,
    discountRate: 0,
    rfaRate: 0,
    deliveryDays: [],
    notes: '',
    active: true,
  };
}

interface GestionState {
  db: GestionDB;
  screen: Screen;
  notices: GestionNotice[];
  /** Element mis en avant apres un clic sur une alerte */
  focusId: string | null;
  /** Derniere ecriture reussie */
  savedAt: number | null;

  index: () => Index;
  currentUser: () => User | undefined;
  can: (capability: Capability) => boolean;

  setScreen: (s: Screen, focusId?: string | null) => void;
  notify: (text: string, type?: GestionNotice['type']) => void;
  dismissNotice: (id: string) => void;

  mutate: (opts: MutateOptions, fn: (db: GestionDB) => void) => void;

  // referentiels
  saveProduct: (p: Product) => void;
  deleteProduct: (id: string) => void;
  importProducts: (rows: Product[]) => number;
  saveSupplier: (s: Supplier) => void;
  deleteSupplier: (id: string) => void;
  saveFamily: (f: Family) => void;
  deleteFamily: (id: string) => void;
  saveVatRate: (v: VatRate) => void;
  deleteVatRate: (id: string) => void;

  // stock
  addMovement: (input: MovementInput) => void;
  addLoss: (input: { productId: string; quantity: number; reason: LossReason; notes: string }) => void;

  // achats
  createOrder: (supplierId: string) => string;
  saveOrder: (o: PurchaseOrder) => void;
  sendOrder: (id: string) => void;
  cancelOrder: (id: string) => void;
  deleteOrder: (id: string) => void;

  // receptions
  createReception: (orderId: string | null, supplierId: string) => string;
  saveReception: (r: Reception) => void;
  validateReception: (id: string) => void;
  deleteReception: (id: string) => void;

  // ventes
  recordSale: (lines: Array<{ productId: string; quantity: number }>, method: Sale['paymentMethod']) => void;
  deleteSale: (id: string) => void;

  // inventaires
  openInventory: (label: string, scope: InventoryScope, scopeValue: string) => string;
  countLine: (inventoryId: string, productId: string, counted: number | null) => void;
  closeInventory: (id: string) => void;
  deleteInventory: (id: string) => void;

  // comptabilite
  saveInvoice: (i: SupplierInvoice) => void;
  deleteInvoice: (id: string) => void;
  savePayment: (p: Payment) => void;
  deletePayment: (id: string) => void;
  saveDocument: (d: StoredDocument) => void;
  deleteDocument: (id: string) => void;

  // parametres
  saveCompany: (c: Company) => void;
  saveSettings: (s: GestionSettings) => void;
  saveUser: (u: User) => void;
  deleteUser: (id: string) => void;
  setCurrentUser: (id: string) => void;

  // sauvegarde
  reset: (scope: ResetScope) => void;
  backups: () => BackupInfo[];
  restoreBackup: (id: number) => void;
  exportBackupFile: () => void;
  importBackupFile: (file: File) => Promise<void>;
  reloadFromStorage: () => void;
}

// ------------------------------------------------------------------ droits

export type Capability =
  | 'gerer_produits'
  | 'gerer_achats'
  | 'receptionner'
  | 'inventorier'
  | 'saisir_pertes'
  | 'vendre'
  | 'voir_marges'
  | 'voir_comptabilite'
  | 'exporter'
  | 'parametrer'
  | 'remise_a_zero';

/** Ce que chaque profil a le droit de faire. */
const CAPABILITIES: Record<User['role'], Capability[]> = {
  gerant: [
    'gerer_produits',
    'gerer_achats',
    'receptionner',
    'inventorier',
    'saisir_pertes',
    'vendre',
    'voir_marges',
    'voir_comptabilite',
    'exporter',
    'parametrer',
    'remise_a_zero',
  ],
  employe: ['receptionner', 'inventorier', 'saisir_pertes', 'vendre'],
  comptable: ['voir_comptabilite', 'exporter'],
};

export const useGestion = create<GestionState>((set, get) => ({
  db: loadInitial(),
  screen: 'tableau',
  notices: [],
  focusId: null,
  savedAt: null,

  index: () => buildIndex(get().db),

  currentUser: () => get().db.users.find((u) => u.id === get().db.currentUserId),

  can: (capability) => {
    const role = get().currentUser()?.role;
    if (!role) return false;
    return CAPABILITIES[role].includes(capability);
  },

  setScreen: (screen, focusId = null) => set({ screen, focusId }),

  notify: (text, type = 'info') => {
    const id = newId('ntc');
    set({ notices: [...get().notices, { id, text, type }] });
    setTimeout(() => get().dismissNotice(id), 5000);
  },

  dismissNotice: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),

  mutate: (opts, fn) => {
    const draft: GestionDB = structuredClone(get().db);
    fn(draft);
    draft.rev += 1;
    draft.updatedAt = Date.now();

    if (!opts.silent) {
      draft.audit.push({
        id: newId('aud'),
        date: Date.now(),
        userId: draft.currentUserId,
        scope: opts.scope,
        action: opts.action,
        targetId: opts.targetId ?? '',
        targetLabel: opts.targetLabel ?? '',
        before: opts.before,
        after: opts.after,
        reason: opts.reason,
      });
      // Le journal d'audit ne doit pas faire exploser le stockage : on garde
      // les entrees les plus recentes.
      if (draft.audit.length > AUDIT_LIMIT) {
        draft.audit = draft.audit.slice(draft.audit.length - AUDIT_LIMIT);
      }
    }

    invalidateIndex();
    set({ db: draft });

    // Ecriture immediate : le site reste a jour, sans action de l'utilisateur.
    if (draft.settings.autoSave) {
      try {
        repository.save(draft);
        set({ savedAt: Date.now() });
      } catch (e) {
        get().notify(e instanceof Error ? e.message : "L'enregistrement a échoué.", 'error');
      }
    }
  },

  // ---------------------------------------------------------- referentiels

  saveProduct: (p) => {
    const exists = get().db.products.some((x) => x.id === p.id);
    get().mutate(
      {
        scope: 'produit',
        action: exists ? 'Modification de la fiche produit' : 'Création de la fiche produit',
        targetId: p.id,
        targetLabel: p.name,
      },
      (db) => {
        const i = db.products.findIndex((x) => x.id === p.id);
        const next: Product = { ...p, updatedAt: Date.now() };
        // Le prix d'achat passe par l'historique : on mesure l'impact sur la marge.
        if (i >= 0) {
          const previous = db.products[i];
          const target = { ...previous, ...next, purchasePrice: previous.purchasePrice };
          db.products[i] = target;
          recordPriceChange(db, target, next.purchasePrice, null, 'saisie', db.currentUserId);
        } else {
          db.products.push(next);
        }
      },
    );
  },

  deleteProduct: (id) => {
    const p = get().db.products.find((x) => x.id === id);
    get().mutate(
      { scope: 'produit', action: 'Suppression de la fiche produit', targetId: id, targetLabel: p?.name ?? '' },
      (db) => {
        db.products = db.products.filter((x) => x.id !== id);
      },
    );
  },

  importProducts: (rows) => {
    let added = 0;
    get().mutate(
      { scope: 'produit', action: `Import de ${rows.length} produit(s)`, targetLabel: 'Import massif' },
      (db) => {
        for (const row of rows) {
          const key = row.ean || row.ref;
          const existing = key
            ? db.products.find((x) => (row.ean && x.ean === row.ean) || (row.ref && x.ref === row.ref))
            : undefined;
          if (existing) {
            Object.assign(existing, row, { id: existing.id, updatedAt: Date.now() });
          } else {
            db.products.push({ ...row, id: row.id || newId('prd') });
            added += 1;
          }
        }
      },
    );
    return added;
  },

  saveSupplier: (s) => {
    const exists = get().db.suppliers.some((x) => x.id === s.id);
    get().mutate(
      {
        scope: 'fournisseur',
        action: exists ? 'Modification du fournisseur' : 'Création du fournisseur',
        targetId: s.id,
        targetLabel: s.name,
      },
      (db) => {
        const i = db.suppliers.findIndex((x) => x.id === s.id);
        if (i >= 0) db.suppliers[i] = s;
        else db.suppliers.push(s);
      },
    );
  },

  deleteSupplier: (id) => {
    const s = get().db.suppliers.find((x) => x.id === id);
    get().mutate(
      { scope: 'fournisseur', action: 'Suppression du fournisseur', targetId: id, targetLabel: s?.name ?? '' },
      (db) => {
        db.suppliers = db.suppliers.filter((x) => x.id !== id);
        // On delie les produits plutot que de les laisser pointer dans le vide.
        for (const p of db.products) p.suppliers = p.suppliers.filter((l) => l.supplierId !== id);
      },
    );
  },

  saveFamily: (f) => {
    get().mutate(
      { scope: 'referentiel', action: 'Enregistrement d’une famille', targetId: f.id, targetLabel: f.name },
      (db) => {
        const i = db.families.findIndex((x) => x.id === f.id);
        if (i >= 0) db.families[i] = f;
        else db.families.push(f);
      },
    );
  },

  deleteFamily: (id) => {
    const f = get().db.families.find((x) => x.id === id);
    get().mutate(
      { scope: 'referentiel', action: 'Suppression d’une famille', targetId: id, targetLabel: f?.name ?? '' },
      (db) => {
        db.families = db.families.filter((x) => x.id !== id && x.parentId !== id);
        for (const p of db.products) {
          if (p.familyId === id) p.familyId = null;
          if (p.subFamilyId === id) p.subFamilyId = null;
        }
      },
    );
  },

  saveVatRate: (v) => {
    get().mutate(
      {
        scope: 'tva',
        action: 'Enregistrement d’un taux de TVA',
        targetId: v.id,
        targetLabel: `${v.label} (${v.rate} %)`,
      },
      (db) => {
        const i = db.vatRates.findIndex((x) => x.id === v.id);
        if (i >= 0) db.vatRates[i] = v;
        else db.vatRates.push(v);
      },
    );
  },

  deleteVatRate: (id) => {
    const used = get().db.products.filter((p) => p.vatRateId === id).length;
    if (used > 0) {
      get().notify(
        `Ce taux est utilisé par ${used} produit(s) : réaffectez-les avant de le supprimer.`,
        'error',
      );
      return;
    }
    const v = get().db.vatRates.find((x) => x.id === id);
    get().mutate(
      { scope: 'tva', action: 'Suppression d’un taux de TVA', targetId: id, targetLabel: v?.label ?? '' },
      (db) => {
        db.vatRates = db.vatRates.filter((x) => x.id !== id);
      },
    );
  },

  // ---------------------------------------------------------- stock

  addMovement: (input) => {
    const p = get().db.products.find((x) => x.id === input.productId);
    get().mutate(
      {
        scope: 'stock',
        action: `Mouvement de stock : ${input.type}`,
        targetId: input.productId,
        targetLabel: p?.name ?? '',
        reason: input.reason,
      },
      (db) => {
        pushMovement(db, input, stockMap(db), db.currentUserId);
      },
    );
  },

  addLoss: ({ productId, quantity, reason, notes }) => {
    const p = get().db.products.find((x) => x.id === productId);
    if (!p) return;
    get().mutate(
      {
        scope: 'perte',
        action: `Perte enregistrée : ${reason}`,
        targetId: productId,
        targetLabel: p.name,
        before: '',
        after: `${quantity}`,
        reason: notes,
      },
      (db) => {
        const product = db.products.find((x) => x.id === productId);
        if (!product) return;
        const loss: Loss = {
          id: newId('prt'),
          number: nextNumber(db, 'PRT'),
          date: Date.now(),
          productId,
          quantity,
          unitCost: product.purchasePrice,
          vatRateId: product.vatRateId,
          reason,
          userId: db.currentUserId,
          notes,
        };
        db.losses.push(loss);
        // Une perte sort du stock : le journal en porte la trace.
        const type: MovementType =
          reason === 'casse'
            ? 'casse'
            : reason === 'perime' || reason === 'dlc'
              ? 'perime'
              : reason === 'vol'
                ? 'vol'
                : 'demarque';
        pushMovement(
          db,
          {
            productId,
            type,
            quantity: -Math.abs(quantity),
            unitCost: product.purchasePrice,
            reason: notes || reason,
            docType: 'perte',
            docId: loss.id,
          },
          stockMap(db),
          db.currentUserId,
        );
      },
    );
  },

  // ---------------------------------------------------------- achats

  createOrder: (supplierId) => {
    const id = newId('cmd');
    get().mutate({ scope: 'commande', action: 'Création d’un bon de commande', targetId: id }, (db) => {
      const order: PurchaseOrder = {
        id,
        number: nextNumber(db, 'BC'),
        supplierId,
        status: 'brouillon',
        createdAt: Date.now(),
        sentAt: null,
        expectedAt: null,
        lines: [],
        shipping: 0,
        notes: '',
        userId: db.currentUserId,
      };
      db.orders.push(order);
    });
    return id;
  },

  saveOrder: (o) => {
    get().mutate(
      { scope: 'commande', action: 'Modification du bon de commande', targetId: o.id, targetLabel: o.number },
      (db) => {
        const i = db.orders.findIndex((x) => x.id === o.id);
        if (i >= 0) db.orders[i] = o;
      },
    );
  },

  sendOrder: (id) => {
    const o = get().db.orders.find((x) => x.id === id);
    get().mutate(
      { scope: 'commande', action: 'Envoi du bon de commande', targetId: id, targetLabel: o?.number ?? '' },
      (db) => {
        const order = db.orders.find((x) => x.id === id);
        if (!order) return;
        order.status = 'envoyee';
        order.sentAt = Date.now();
      },
    );
  },

  cancelOrder: (id) => {
    const o = get().db.orders.find((x) => x.id === id);
    get().mutate(
      { scope: 'commande', action: 'Annulation du bon de commande', targetId: id, targetLabel: o?.number ?? '' },
      (db) => {
        const order = db.orders.find((x) => x.id === id);
        if (order) order.status = 'annulee';
      },
    );
  },

  deleteOrder: (id) => {
    const o = get().db.orders.find((x) => x.id === id);
    get().mutate(
      { scope: 'commande', action: 'Suppression du bon de commande', targetId: id, targetLabel: o?.number ?? '' },
      (db) => {
        db.orders = db.orders.filter((x) => x.id !== id);
      },
    );
  },

  // ---------------------------------------------------------- receptions

  createReception: (orderId, supplierId) => {
    const id = newId('rec');
    get().mutate({ scope: 'reception', action: 'Ouverture d’une réception', targetId: id }, (db) => {
      const order = orderId ? db.orders.find((x) => x.id === orderId) : null;
      const lines: ReceptionLine[] = (order?.lines ?? []).map((l) => ({
        productId: l.productId,
        label: l.label,
        ordered: l.quantity,
        // On pre-remplit avec le reste a livrer : l'utilisateur corrige au reel.
        received: Math.max(0, l.quantity - l.received),
        refused: 0,
        unitPrice: l.unitPrice,
        discountRate: l.discountRate,
        vatRateId: l.vatRateId,
      }));
      const rec: Reception = {
        id,
        number: nextNumber(db, 'BR'),
        orderId,
        supplierId: order?.supplierId ?? supplierId,
        date: Date.now(),
        lines,
        shipping: 0,
        deliveryNote: '',
        notes: '',
        userId: db.currentUserId,
        validated: false,
      };
      db.receptions.push(rec);
    });
    return id;
  },

  saveReception: (r) => {
    get().mutate(
      { scope: 'reception', action: 'Modification de la réception', targetId: r.id, targetLabel: r.number },
      (db) => {
        const i = db.receptions.findIndex((x) => x.id === r.id);
        if (i >= 0 && !db.receptions[i].validated) db.receptions[i] = r;
      },
    );
  },

  /**
   * Valide une reception : c'est le point ou la marchandise entre reellement.
   * Un seul geste met a jour le stock, le prix d'achat, l'historique des prix,
   * les lots, l'avancement de la commande et le journal.
   */
  validateReception: (id) => {
    const r = get().db.receptions.find((x) => x.id === id);
    if (!r) return;
    if (r.validated) {
      get().notify('Cette réception est déjà validée : elle ne peut plus être modifiée.', 'error');
      return;
    }
    get().mutate(
      { scope: 'reception', action: 'Validation de la réception', targetId: id, targetLabel: r.number },
      (db) => {
        const rec = db.receptions.find((x) => x.id === id);
        if (!rec || rec.validated) return;
        const stocks = stockMap(db);

        for (const line of rec.lines) {
          if (line.received <= 0) continue;
          const product = db.products.find((p) => p.id === line.productId);
          if (!product) continue;
          const cost = netCost(line.unitPrice, line.discountRate);

          // Prix d'achat reel constate : il devient la reference, et l'ecart
          // est trace avec son impact sur la marge.
          recordPriceChange(db, product, cost, rec.supplierId, 'reception', db.currentUserId);

          let lotId: string | undefined;
          if (product.lotTracked || line.expiry) {
            lotId = newId('lot');
            db.lots.push({
              id: lotId,
              productId: product.id,
              code: line.lotCode ?? '',
              expiry: line.expiry ?? '',
              quantity: line.received,
              receptionId: rec.id,
              createdAt: Date.now(),
            });
          }

          pushMovement(
            db,
            {
              productId: product.id,
              type: 'reception',
              quantity: line.received,
              unitCost: cost,
              reason: `Réception ${rec.number}`,
              docType: 'reception',
              docId: rec.id,
              lotId,
            },
            stocks,
            db.currentUserId,
          );
        }

        // Avancement de la commande : partielle tant qu'il reste a livrer.
        if (rec.orderId) {
          const order = db.orders.find((o) => o.id === rec.orderId);
          if (order) {
            for (const line of rec.lines) {
              const ol = order.lines.find((l) => l.productId === line.productId);
              if (ol) ol.received += line.received;
            }
            const complete = order.lines.every((l) => l.received >= l.quantity);
            order.status = complete ? 'receptionnee' : 'partielle';
          }
        }

        rec.validated = true;
      },
    );
    get().notify('Réception validée : stock, prix d’achat et commande mis à jour.', 'success');
  },

  deleteReception: (id) => {
    const r = get().db.receptions.find((x) => x.id === id);
    if (r?.validated) {
      get().notify(
        'Une réception validée ne se supprime pas : elle a généré des mouvements de stock. Passez par une régularisation.',
        'error',
      );
      return;
    }
    get().mutate(
      { scope: 'reception', action: 'Suppression de la réception', targetId: id, targetLabel: r?.number ?? '' },
      (db) => {
        db.receptions = db.receptions.filter((x) => x.id !== id);
      },
    );
  },

  // ---------------------------------------------------------- ventes

  recordSale: (lines, method) => {
    get().mutate({ scope: 'vente', action: 'Enregistrement d’un ticket' }, (db) => {
      const stocks = stockMap(db);
      const saleLines: SaleLine[] = [];
      const sale: Sale = {
        id: newId('vte'),
        number: nextNumber(db, 'TK'),
        date: Date.now(),
        lines: saleLines,
        paymentMethod: method,
        userId: db.currentUserId,
        imported: false,
        notes: '',
      };
      const idx = buildIndex(db);
      for (const l of lines) {
        const product = db.products.find((p) => p.id === l.productId);
        if (!product) continue;
        const rate = vatRateOf(idx, product.vatRateId);
        saleLines.push({
          productId: product.id,
          label: product.name,
          quantity: l.quantity,
          unitPriceTTC: product.salePriceTTC || euro(product.salePriceHT * (1 + rate / 100)),
          vatRateId: product.vatRateId,
          // Le cout est fige : la marge du ticket ne bougera plus si le prix
          // d'achat change demain.
          unitCost: product.purchasePrice,
          discountRate: 0,
        });
        pushMovement(
          db,
          {
            productId: product.id,
            type: 'vente',
            quantity: -Math.abs(l.quantity),
            unitCost: product.purchasePrice,
            reason: `Ticket ${sale.number}`,
            docType: 'vente',
            docId: sale.id,
          },
          stocks,
          db.currentUserId,
        );
      }
      db.sales.push(sale);
    });
  },

  deleteSale: (id) => {
    const s = get().db.sales.find((x) => x.id === id);
    get().mutate(
      { scope: 'vente', action: 'Annulation d’un ticket', targetId: id, targetLabel: s?.number ?? '' },
      (db) => {
        const sale = db.sales.find((x) => x.id === id);
        if (!sale) return;
        const stocks = stockMap(db);
        // On ne gomme pas l'historique : on contre-passe par des mouvements.
        for (const line of sale.lines) {
          pushMovement(
            db,
            {
              productId: line.productId,
              type: 'regularisation',
              quantity: Math.abs(line.quantity),
              unitCost: line.unitCost,
              reason: `Annulation du ticket ${sale.number}`,
              docType: 'vente',
              docId: sale.id,
            },
            stocks,
            db.currentUserId,
          );
        }
        db.sales = db.sales.filter((x) => x.id !== id);
      },
    );
  },

  // ---------------------------------------------------------- inventaires

  openInventory: (label, scope, scopeValue) => {
    const id = newId('inv');
    get().mutate({ scope: 'inventaire', action: 'Ouverture d’un inventaire', targetId: id }, (db) => {
      const idx = buildIndex(db);
      const stocks = stockMap(db);
      const inScope = db.products.filter((p) => {
        if (!p.active) return false;
        switch (scope) {
          case 'complet':
            return true;
          case 'famille':
            return p.familyId === scopeValue || p.subFamilyId === scopeValue;
          case 'fournisseur':
            return p.suppliers.some((l) => l.supplierId === scopeValue);
          case 'emplacement':
            return p.location === scopeValue || p.reserveLocation === scopeValue;
          case 'rayon': {
            const f = p.familyId ? idx.familyById.get(p.familyId) : undefined;
            return (f?.aisle ?? '') === scopeValue;
          }
          case 'partiel':
            return true;
        }
      });
      const inv: Inventory = {
        id,
        number: nextNumber(db, 'INV'),
        label,
        scope,
        scopeValue,
        openedAt: Date.now(),
        closedAt: null,
        // Le stock theorique est FIGE a l'ouverture : les ventes du jour ne
        // deplacent pas la cible pendant qu'on compte.
        lines: inScope.map((p) => ({
          productId: p.id,
          label: p.name,
          theoretical: stocks.get(p.id) ?? 0,
          counted: null,
          unitCost: p.purchasePrice,
        })),
        userId: db.currentUserId,
        notes: '',
        closed: false,
      };
      db.inventories.push(inv);
    });
    return id;
  },

  countLine: (inventoryId, productId, counted) => {
    get().mutate(
      { scope: 'inventaire', action: 'Comptage', targetId: productId, silent: true },
      (db) => {
        const inv = db.inventories.find((x) => x.id === inventoryId);
        if (!inv || inv.closed) return;
        const line = inv.lines.find((l) => l.productId === productId);
        if (line) line.counted = counted;
      },
    );
  },

  /** Cloture : les ecarts constates deviennent des mouvements de correction. */
  closeInventory: (id) => {
    const inv = get().db.inventories.find((x) => x.id === id);
    if (!inv || inv.closed) return;
    get().mutate(
      { scope: 'inventaire', action: 'Clôture de l’inventaire', targetId: id, targetLabel: inv.number },
      (db) => {
        const target = db.inventories.find((x) => x.id === id);
        if (!target || target.closed) return;
        const stocks = stockMap(db);
        for (const line of target.lines) {
          if (line.counted === null) continue;
          const current = stocks.get(line.productId) ?? 0;
          const gap = line.counted - current;
          if (Math.abs(gap) < 0.0001) continue;
          pushMovement(
            db,
            {
              productId: line.productId,
              type: 'inventaire',
              quantity: gap,
              unitCost: line.unitCost,
              reason: `Correction d'inventaire ${target.number}`,
              docType: 'inventaire',
              docId: target.id,
            },
            stocks,
            db.currentUserId,
          );
        }
        target.closed = true;
        target.closedAt = Date.now();
      },
    );
    get().notify('Inventaire clôturé : les écarts ont été régularisés dans le journal.', 'success');
  },

  deleteInventory: (id) => {
    const inv = get().db.inventories.find((x) => x.id === id);
    if (inv?.closed) {
      get().notify('Un inventaire clôturé fait partie de l’historique : il ne peut pas être supprimé.', 'error');
      return;
    }
    get().mutate(
      { scope: 'inventaire', action: 'Suppression de l’inventaire', targetId: id, targetLabel: inv?.number ?? '' },
      (db) => {
        db.inventories = db.inventories.filter((x) => x.id !== id);
      },
    );
  },

  // ---------------------------------------------------------- comptabilite

  saveInvoice: (i) => {
    get().mutate(
      { scope: 'comptabilite', action: 'Enregistrement d’une facture', targetId: i.id, targetLabel: i.number },
      (db) => {
        const k = db.invoices.findIndex((x) => x.id === i.id);
        if (k >= 0) db.invoices[k] = i;
        else db.invoices.push(i);
      },
    );
  },

  deleteInvoice: (id) => {
    const i = get().db.invoices.find((x) => x.id === id);
    get().mutate(
      { scope: 'comptabilite', action: 'Suppression d’une facture', targetId: id, targetLabel: i?.number ?? '' },
      (db) => {
        db.invoices = db.invoices.filter((x) => x.id !== id);
      },
    );
  },

  savePayment: (p) => {
    get().mutate(
      { scope: 'comptabilite', action: 'Enregistrement d’un règlement', targetId: p.id, targetLabel: p.reference },
      (db) => {
        const k = db.payments.findIndex((x) => x.id === p.id);
        if (k >= 0) db.payments[k] = p;
        else db.payments.push(p);
        // Un règlement qui solde la facture la marque payée.
        if (p.invoiceId) {
          const inv = db.invoices.find((x) => x.id === p.invoiceId);
          if (inv) {
            const paid = db.payments
              .filter((x) => x.invoiceId === inv.id)
              .reduce((n, x) => n + x.amount, 0);
            if (paid >= inv.totalTTC - 0.01) inv.status = 'payee';
          }
        }
      },
    );
  },

  deletePayment: (id) => {
    get().mutate({ scope: 'comptabilite', action: 'Suppression d’un règlement', targetId: id }, (db) => {
      db.payments = db.payments.filter((x) => x.id !== id);
    });
  },

  saveDocument: (d) => {
    get().mutate(
      { scope: 'document', action: 'Enregistrement d’un document', targetId: d.id, targetLabel: d.label },
      (db) => {
        const k = db.documents.findIndex((x) => x.id === d.id);
        if (k >= 0) db.documents[k] = d;
        else db.documents.push(d);
      },
    );
  },

  deleteDocument: (id) => {
    const d = get().db.documents.find((x) => x.id === id);
    get().mutate(
      { scope: 'document', action: 'Suppression d’un document', targetId: id, targetLabel: d?.label ?? '' },
      (db) => {
        db.documents = db.documents.filter((x) => x.id !== id);
      },
    );
  },

  // ---------------------------------------------------------- parametres

  saveCompany: (c) => {
    get().mutate({ scope: 'parametres', action: 'Modification des informations société' }, (db) => {
      db.company = c;
    });
  },

  saveSettings: (s) => {
    get().mutate({ scope: 'parametres', action: 'Modification des paramètres' }, (db) => {
      db.settings = s;
    });
    // Le réglage a pu réactiver la sauvegarde : on écrit dans tous les cas.
    try {
      repository.save(get().db);
      set({ savedAt: Date.now() });
    } catch {
      /* signale par mutate le cas echeant */
    }
  },

  saveUser: (u) => {
    get().mutate(
      { scope: 'parametres', action: 'Enregistrement d’un utilisateur', targetId: u.id, targetLabel: u.name },
      (db) => {
        const i = db.users.findIndex((x) => x.id === u.id);
        if (i >= 0) db.users[i] = u;
        else db.users.push(u);
      },
    );
  },

  deleteUser: (id) => {
    if (get().db.users.length <= 1) {
      get().notify('Il doit rester au moins un utilisateur.', 'error');
      return;
    }
    const u = get().db.users.find((x) => x.id === id);
    get().mutate(
      { scope: 'parametres', action: 'Suppression d’un utilisateur', targetId: id, targetLabel: u?.name ?? '' },
      (db) => {
        db.users = db.users.filter((x) => x.id !== id);
        if (db.currentUserId === id) db.currentUserId = db.users[0]?.id ?? '';
      },
    );
  },

  setCurrentUser: (id) => {
    const u = get().db.users.find((x) => x.id === id);
    get().mutate(
      { scope: 'parametres', action: 'Changement d’utilisateur', targetId: id, targetLabel: u?.name ?? '' },
      (db) => {
        db.currentUserId = id;
      },
    );
  },

  // ---------------------------------------------------------- sauvegarde

  reset: (scope) => {
    get().mutate(
      { scope: 'maintenance', action: `Remise à zéro : ${scope}`, targetLabel: scope },
      (db) => {
        const next = applyReset(db, scope);
        // On reporte le resultat dans le brouillon en place, en conservant
        // l'audit pour garder la trace de l'operation elle-meme.
        const audit = scope === 'audit' || scope === 'tout' ? next.audit : db.audit;
        Object.assign(db, next, { audit });
      },
    );
    get().notify('Remise à zéro effectuée et enregistrée.', 'success');
  },

  backups: () => repository.backups(),

  restoreBackup: (id) => {
    const restored = repository.restoreBackup(id);
    if (!restored) {
      get().notify('Sauvegarde introuvable.', 'error');
      return;
    }
    invalidateIndex();
    const next = seed(restored);
    next.rev += 1;
    set({ db: next });
    try {
      repository.save(next);
      set({ savedAt: Date.now() });
    } catch (e) {
      get().notify(e instanceof Error ? e.message : "L'enregistrement a échoué.", 'error');
      return;
    }
    get().notify('Sauvegarde restaurée.', 'success');
  },

  exportBackupFile: () => {
    const blob = new Blob([serializeBackup(get().db)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `gestion-sauvegarde-${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    get().notify('Sauvegarde téléchargée.', 'success');
  },

  importBackupFile: async (file) => {
    const text = await file.text();
    const parsed = parseBackup(text);
    invalidateIndex();
    const next = seed(parsed);
    next.rev += 1;
    set({ db: next });
    try {
      repository.save(next);
      set({ savedAt: Date.now() });
    } catch (e) {
      get().notify(e instanceof Error ? e.message : "L'enregistrement a échoué.", 'error');
      return;
    }
    get().notify('Sauvegarde restaurée depuis le fichier.', 'success');
  },

  reloadFromStorage: () => {
    const loaded = repository.load();
    if (!loaded) return;
    invalidateIndex();
    set({ db: seed(loaded) });
  },
}));

/**
 * Synchronisation entre onglets : si la base change dans un autre onglet, on
 * la recharge ici. Deux onglets ouverts ne se contredisent donc jamais.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== DB_KEY) return;
    useGestion.getState().reloadFromStorage();
  });
}
