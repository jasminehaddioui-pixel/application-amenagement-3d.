/**
 * Moteur de calcul du module de gestion.
 *
 * Tout est derive : rien n'est stocke en double. Le stock vient du journal des
 * mouvements, la marge vient du couple (prix d'achat, prix de vente, TVA), le
 * chiffre d'affaires vient des tickets, la TVA vient des lignes. Une donnee
 * saisie une fois se propage partout.
 *
 * L'index est memorise sur `db.rev` : il n'est reconstruit qu'apres une
 * modification reelle de la base, jamais a chaque rendu.
 */

import type {
  GestionDB,
  ISODate,
  Loss,
  MovementType,
  Product,
  Sale,
  StockMovement,
  VatRate,
} from './types';

// ------------------------------------------------------------------ arrondis

/** Arrondi monetaire au centime (evite les 0.30000000000000004). */
export function euro(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export function fmtEuro(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${euro(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}

export function fmtQty(n: number): string {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

export function fmtDate(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('fr-FR');
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ------------------------------------------------------------------ dates

export const DAY = 86400000;

export function toISODate(ts: number): ISODate {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fromISODate(s: ISODate): number {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export interface Period {
  from: number;
  to: number;
  label: string;
}

export type PeriodPreset = 'jour' | 'semaine' | 'mois' | 'mois_precedent' | 'trimestre' | 'annee';

export function periodOf(preset: PeriodPreset, ref = Date.now()): Period {
  const d = new Date(ref);
  switch (preset) {
    case 'jour':
      return { from: startOfDay(ref), to: endOfDay(ref), label: `Journée du ${fmtDate(ref)}` };
    case 'semaine': {
      const dow = (d.getDay() + 6) % 7; // lundi = 0
      const from = startOfDay(ref - dow * DAY);
      return { from, to: endOfDay(from + 6 * DAY), label: 'Semaine en cours' };
    }
    case 'mois': {
      const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      const to = endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime());
      return { from, to, label: monthLabel(from) };
    }
    case 'mois_precedent': {
      const from = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
      const to = endOfDay(new Date(d.getFullYear(), d.getMonth(), 0).getTime());
      return { from, to, label: monthLabel(from) };
    }
    case 'trimestre': {
      const q = Math.floor(d.getMonth() / 3);
      const from = new Date(d.getFullYear(), q * 3, 1).getTime();
      const to = endOfDay(new Date(d.getFullYear(), q * 3 + 3, 0).getTime());
      return { from, to, label: `${q + 1}ᵉ trimestre ${d.getFullYear()}` };
    }
    case 'annee': {
      const from = new Date(d.getFullYear(), 0, 1).getTime();
      const to = endOfDay(new Date(d.getFullYear(), 11, 31).getTime());
      return { from, to, label: `Exercice ${d.getFullYear()}` };
    }
  }
}

export function monthLabel(ts: number): string {
  return new Date(ts).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

function inPeriod(ts: number, p: Period): boolean {
  return ts >= p.from && ts <= p.to;
}

// ------------------------------------------------------------------ mouvements

/** Sens attendu de chaque nature de mouvement (0 = les deux sens possibles). */
export const MOVEMENT_SIGN: Record<MovementType, -1 | 0 | 1> = {
  reception: 1,
  vente: -1,
  casse: -1,
  perime: -1,
  vol: -1,
  demarque: -1,
  retour_fournisseur: -1,
  transfert: 0,
  inventaire: 0,
  regularisation: 0,
  initial: 1,
};

// ------------------------------------------------------------------ index

export interface ProductStats {
  /** Stock courant, somme du journal */
  stock: number;
  /** Quantite vendue sur 7 / 30 / 90 jours glissants */
  sold7: number;
  sold30: number;
  sold90: number;
  /** Chiffre d'affaires HT genere sur 30 jours */
  revenue30: number;
  /** Marge brute degagee sur 30 jours */
  margin30: number;
  lastSaleAt: number | null;
  lastReceptionAt: number | null;
  /** Quantite deja commandee et pas encore recue */
  onOrder: number;
  /** Perte cumulee (quantite) sur 30 jours */
  lost30: number;
}

export interface Index {
  rev: number;
  productById: Map<string, Product>;
  supplierById: Map<string, GestionDB['suppliers'][number]>;
  familyById: Map<string, GestionDB['families'][number]>;
  vatById: Map<string, VatRate>;
  stats: Map<string, ProductStats>;
  /** Mouvements par produit, du plus recent au plus ancien */
  movementsByProduct: Map<string, StockMovement[]>;
}

function emptyStats(): ProductStats {
  return {
    stock: 0,
    sold7: 0,
    sold30: 0,
    sold90: 0,
    revenue30: 0,
    margin30: 0,
    lastSaleAt: null,
    lastReceptionAt: null,
    onOrder: 0,
    lost30: 0,
  };
}

let cachedIndex: Index | null = null;

/** Index memorise : reconstruit uniquement quand `db.rev` change. */
export function buildIndex(db: GestionDB): Index {
  if (cachedIndex && cachedIndex.rev === db.rev) return cachedIndex;

  const now = Date.now();
  const idx: Index = {
    rev: db.rev,
    productById: new Map(db.products.map((p) => [p.id, p])),
    supplierById: new Map(db.suppliers.map((s) => [s.id, s])),
    familyById: new Map(db.families.map((f) => [f.id, f])),
    vatById: new Map(db.vatRates.map((v) => [v.id, v])),
    stats: new Map(db.products.map((p) => [p.id, emptyStats()])),
    movementsByProduct: new Map(),
  };

  const stat = (id: string): ProductStats => {
    let s = idx.stats.get(id);
    if (!s) {
      s = emptyStats();
      idx.stats.set(id, s);
    }
    return s;
  };

  // Journal des mouvements : source unique du stock.
  for (const m of db.movements) {
    const s = stat(m.productId);
    s.stock += m.quantity;
    if (m.type === 'reception' && (!s.lastReceptionAt || m.date > s.lastReceptionAt)) {
      s.lastReceptionAt = m.date;
    }
    const list = idx.movementsByProduct.get(m.productId);
    if (list) list.push(m);
    else idx.movementsByProduct.set(m.productId, [m]);
  }
  for (const list of idx.movementsByProduct.values()) list.sort((a, b) => b.date - a.date);

  // Ventes : cadences, chiffre d'affaires, marge.
  for (const sale of db.sales) {
    const age = now - sale.date;
    for (const line of sale.lines) {
      const s = stat(line.productId);
      if (!s.lastSaleAt || sale.date > s.lastSaleAt) s.lastSaleAt = sale.date;
      if (age <= 7 * DAY) s.sold7 += line.quantity;
      if (age <= 30 * DAY) {
        s.sold30 += line.quantity;
        const vat = idx.vatById.get(line.vatRateId);
        const ht = htFromTTC(line.unitPriceTTC * line.quantity, vat?.rate ?? 0);
        s.revenue30 += ht;
        s.margin30 += ht - line.unitCost * line.quantity;
      }
      if (age <= 90 * DAY) s.sold90 += line.quantity;
    }
  }

  // Pertes recentes.
  for (const loss of db.losses) {
    if (now - loss.date <= 30 * DAY) stat(loss.productId).lost30 += loss.quantity;
  }

  // Commandes en cours : reste a livrer.
  for (const o of db.orders) {
    if (o.status !== 'envoyee' && o.status !== 'partielle') continue;
    for (const l of o.lines) {
      stat(l.productId).onOrder += Math.max(0, l.quantity - l.received);
    }
  }

  cachedIndex = idx;
  return idx;
}

/** Invalide l'index (utile apres un chargement de base externe). */
export function invalidateIndex(): void {
  cachedIndex = null;
}

export function statsOf(idx: Index, productId: string): ProductStats {
  return idx.stats.get(productId) ?? emptyStats();
}

// ------------------------------------------------------------------ TVA

export function vatRateOf(idx: Index, vatRateId: string): number {
  return idx.vatById.get(vatRateId)?.rate ?? 0;
}

export function ttcFromHT(ht: number, rate: number): number {
  return ht * (1 + rate / 100);
}

export function htFromTTC(ttc: number, rate: number): number {
  return ttc / (1 + rate / 100);
}

// ------------------------------------------------------------------ marges

export interface Margin {
  /** Cout d'achat unitaire HT, remise deduite */
  cost: number;
  priceHT: number;
  priceTTC: number;
  vatRate: number;
  /** Marge brute unitaire en euros HT */
  marginEuro: number;
  /** Taux de marge = marge / prix d'achat */
  marginRate: number;
  /** Taux de marque = marge / prix de vente */
  markRate: number;
  /** Coefficient multiplicateur PV TTC / PA HT */
  coefficient: number;
}

export function marginOf(product: Product, vatRate: number): Margin {
  const cost = product.purchasePrice;
  const priceHT = product.salePriceHT;
  const priceTTC = product.salePriceTTC || ttcFromHT(priceHT, vatRate);
  const marginEuro = priceHT - cost;
  return {
    cost,
    priceHT,
    priceTTC,
    vatRate,
    marginEuro,
    marginRate: cost > 0 ? (marginEuro / cost) * 100 : 0,
    markRate: priceHT > 0 ? (marginEuro / priceHT) * 100 : 0,
    coefficient: cost > 0 ? priceTTC / cost : 0,
  };
}

/** Prix de vente HT deduit d'un taux de marque vise. */
export function priceFromMarkRate(cost: number, markRate: number): number {
  if (markRate >= 100) return cost;
  return cost / (1 - markRate / 100);
}

/** Prix de vente HT deduit d'un taux de marge vise. */
export function priceFromMarginRate(cost: number, marginRate: number): number {
  return cost * (1 + marginRate / 100);
}

/** Cout d'achat net, remises appliquees. */
export function netCost(unitPrice: number, discountRate: number): number {
  return unitPrice * (1 - (discountRate || 0) / 100);
}

// ------------------------------------------------------------------ stock

export interface StockValuation {
  /** Valeur du stock au prix d'achat HT */
  valueHT: number;
  /** Valeur du stock au prix de vente TTC (potentiel commercial) */
  valueTTC: number;
  /** Nombre de references en stock */
  references: number;
  /** Nombre d'unites en stock */
  units: number;
  /** References en rupture (stock <= 0) */
  ruptures: number;
  /** References sous le stock minimum */
  low: number;
  /** References en stock negatif : incoherence a corriger */
  negatives: number;
}

export function valuation(db: GestionDB, idx: Index): StockValuation {
  const v: StockValuation = {
    valueHT: 0,
    valueTTC: 0,
    references: 0,
    units: 0,
    ruptures: 0,
    low: 0,
    negatives: 0,
  };
  for (const p of db.products) {
    if (!p.active) continue;
    const s = statsOf(idx, p.id);
    if (s.stock > 0) {
      v.references += 1;
      v.units += s.stock;
      v.valueHT += s.stock * p.purchasePrice;
      v.valueTTC += s.stock * (p.salePriceTTC || ttcFromHT(p.salePriceHT, vatRateOf(idx, p.vatRateId)));
    }
    if (s.stock <= 0) v.ruptures += 1;
    if (s.stock < 0) v.negatives += 1;
    if (s.stock > 0 && s.stock <= p.stockMin) v.low += 1;
  }
  v.valueHT = euro(v.valueHT);
  v.valueTTC = euro(v.valueTTC);
  return v;
}

/** Rotation du stock : nombre de fois ou le stock se renouvelle sur un an. */
export function rotation(idx: Index, productId: string): number {
  const s = statsOf(idx, productId);
  if (s.stock <= 0) return 0;
  const annual = (s.sold90 / 90) * 365;
  return round(annual / s.stock, 2);
}

/** Couverture de stock, en jours de vente. */
export function coverageDays(idx: Index, productId: string, windowDays = 30): number | null {
  const s = statsOf(idx, productId);
  const daily = dailySales(s, windowDays);
  if (daily <= 0) return null;
  return round(s.stock / daily, 1);
}

/** Vente moyenne quotidienne, sur la fenetre la plus representative disponible. */
export function dailySales(s: ProductStats, windowDays = 30): number {
  if (windowDays <= 7) return s.sold7 / 7;
  if (windowDays <= 30) return s.sold30 / 30;
  return s.sold90 / 90;
}

// ------------------------------------------------------------------ prevision

export interface OrderSuggestion {
  productId: string;
  stock: number;
  onOrder: number;
  /** Vente moyenne quotidienne retenue */
  daily: number;
  leadTimeDays: number;
  safetyStock: number;
  /** Besoin brut sur le delai de livraison + tampon */
  need: number;
  /** Quantite conseillee, arrondie au conditionnement */
  suggested: number;
  /** Explication en clair, affichee a l'utilisateur */
  explanation: string;
}

/**
 * Quantite conseillee a commander.
 * Besoin = ventes prevues pendant le delai fournisseur + stock de securite,
 * moins ce qu'on a deja en stock et deja commande. Arrondi au colis.
 * L'utilisateur peut toujours modifier la proposition.
 */
export function suggestOrder(
  db: GestionDB,
  idx: Index,
  product: Product,
  supplierId?: string,
): OrderSuggestion {
  const s = statsOf(idx, product.id);
  const link =
    product.suppliers.find((l) => l.supplierId === supplierId) ??
    product.suppliers.find((l) => l.primary) ??
    product.suppliers[0];
  const supplier = link ? idx.supplierById.get(link.supplierId) : undefined;
  const leadTime = supplier?.leadTimeDays ?? 2;
  const window = db.settings.forecastWindowDays;
  const daily = round(dailySales(s, window) * (db.settings.seasonalityFactor || 1), 3);
  const safety = product.safetyStock || 0;

  const need = daily * leadTime + safety;
  let suggested = Math.max(0, need - s.stock - s.onOrder);

  // On respecte le conditionnement : on ne commande pas 7 unites d'un colis de 6.
  const pack = link?.packSize && link.packSize > 1 ? link.packSize : 1;
  if (pack > 1) suggested = Math.ceil(suggested / pack) * pack;
  else suggested = Math.ceil(suggested);

  // Le stock maximum plafonne la commande, quand il est renseigne.
  if (product.stockMax > 0) {
    suggested = Math.max(0, Math.min(suggested, product.stockMax - s.stock - s.onOrder));
    if (pack > 1) suggested = Math.floor(suggested / pack) * pack;
  }

  return {
    productId: product.id,
    stock: s.stock,
    onOrder: s.onOrder,
    daily,
    leadTimeDays: leadTime,
    safetyStock: safety,
    need: round(need, 2),
    suggested,
    explanation:
      `Stock ${fmtQty(s.stock)} · vente moyenne ${fmtQty(daily)}/jour · ` +
      `livraison ${leadTime} j · sécurité ${fmtQty(safety)}` +
      (s.onOrder > 0 ? ` · déjà commandé ${fmtQty(s.onOrder)}` : '') +
      (pack > 1 ? ` · colis de ${pack}` : ''),
  };
}

// ------------------------------------------------------------------ ventes

export interface SalesReport {
  revenueHT: number;
  revenueTTC: number;
  costHT: number;
  marginHT: number;
  marginRate: number;
  markRate: number;
  tickets: number;
  averageBasket: number;
  units: number;
  /** Ventilation par taux de TVA */
  vat: Array<{ vatRateId: string; label: string; rate: number; baseHT: number; vat: number; ttc: number }>;
  /** Ventilation par moyen de paiement */
  payments: Array<{ method: string; amount: number; count: number }>;
}

export function salesReport(db: GestionDB, idx: Index, p: Period): SalesReport {
  const r: SalesReport = {
    revenueHT: 0,
    revenueTTC: 0,
    costHT: 0,
    marginHT: 0,
    marginRate: 0,
    markRate: 0,
    tickets: 0,
    averageBasket: 0,
    units: 0,
    vat: [],
    payments: [],
  };
  const vatMap = new Map<string, { baseHT: number; vat: number; ttc: number }>();
  const payMap = new Map<string, { amount: number; count: number }>();

  for (const sale of db.sales) {
    if (!inPeriod(sale.date, p)) continue;
    r.tickets += 1;
    let ticketTTC = 0;
    for (const line of sale.lines) {
      const rate = vatRateOf(idx, line.vatRateId);
      const ttc = line.unitPriceTTC * line.quantity * (1 - (line.discountRate || 0) / 100);
      const ht = htFromTTC(ttc, rate);
      ticketTTC += ttc;
      r.revenueTTC += ttc;
      r.revenueHT += ht;
      r.costHT += line.unitCost * line.quantity;
      r.units += line.quantity;
      const acc = vatMap.get(line.vatRateId) ?? { baseHT: 0, vat: 0, ttc: 0 };
      acc.baseHT += ht;
      acc.vat += ttc - ht;
      acc.ttc += ttc;
      vatMap.set(line.vatRateId, acc);
    }
    const pay = payMap.get(sale.paymentMethod) ?? { amount: 0, count: 0 };
    pay.amount += ticketTTC;
    pay.count += 1;
    payMap.set(sale.paymentMethod, pay);
  }

  r.marginHT = r.revenueHT - r.costHT;
  r.marginRate = r.costHT > 0 ? (r.marginHT / r.costHT) * 100 : 0;
  r.markRate = r.revenueHT > 0 ? (r.marginHT / r.revenueHT) * 100 : 0;
  r.averageBasket = r.tickets > 0 ? r.revenueTTC / r.tickets : 0;
  r.vat = [...vatMap.entries()].map(([id, v]) => ({
    vatRateId: id,
    label: idx.vatById.get(id)?.label ?? 'Taux inconnu',
    rate: vatRateOf(idx, id),
    baseHT: euro(v.baseHT),
    vat: euro(v.vat),
    ttc: euro(v.ttc),
  }));
  r.vat.sort((a, b) => a.rate - b.rate);
  r.payments = [...payMap.entries()].map(([method, v]) => ({
    method,
    amount: euro(v.amount),
    count: v.count,
  }));
  return r;
}

// ------------------------------------------------------------------ achats

export interface PurchaseReport {
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  receptions: number;
  lines: number;
  vat: Array<{ vatRateId: string; label: string; rate: number; baseHT: number; vat: number }>;
  bySupplier: Array<{ supplierId: string; name: string; totalHT: number }>;
}

export function purchaseReport(db: GestionDB, idx: Index, p: Period): PurchaseReport {
  const r: PurchaseReport = {
    totalHT: 0,
    totalVAT: 0,
    totalTTC: 0,
    receptions: 0,
    lines: 0,
    vat: [],
    bySupplier: [],
  };
  const vatMap = new Map<string, { baseHT: number; vat: number }>();
  const supMap = new Map<string, number>();

  for (const rec of db.receptions) {
    if (!rec.validated || !inPeriod(rec.date, p)) continue;
    r.receptions += 1;
    for (const line of rec.lines) {
      const cost = netCost(line.unitPrice, line.discountRate) * line.received;
      const rate = vatRateOf(idx, line.vatRateId);
      r.totalHT += cost;
      r.totalVAT += cost * (rate / 100);
      r.lines += 1;
      const acc = vatMap.get(line.vatRateId) ?? { baseHT: 0, vat: 0 };
      acc.baseHT += cost;
      acc.vat += cost * (rate / 100);
      vatMap.set(line.vatRateId, acc);
      supMap.set(rec.supplierId, (supMap.get(rec.supplierId) ?? 0) + cost);
    }
    r.totalHT += rec.shipping || 0;
  }

  r.totalTTC = r.totalHT + r.totalVAT;
  r.vat = [...vatMap.entries()].map(([id, v]) => ({
    vatRateId: id,
    label: idx.vatById.get(id)?.label ?? 'Taux inconnu',
    rate: vatRateOf(idx, id),
    baseHT: euro(v.baseHT),
    vat: euro(v.vat),
  }));
  r.vat.sort((a, b) => a.rate - b.rate);
  r.bySupplier = [...supMap.entries()]
    .map(([supplierId, totalHT]) => ({
      supplierId,
      name: idx.supplierById.get(supplierId)?.name ?? 'Fournisseur inconnu',
      totalHT: euro(totalHT),
    }))
    .sort((a, b) => b.totalHT - a.totalHT);
  return r;
}

// ------------------------------------------------------------------ pertes

export interface LossReport {
  totalHT: number;
  totalVAT: number;
  units: number;
  count: number;
  /** Taux de demarque = pertes HT / chiffre d'affaires HT */
  rate: number;
  byReason: Array<{ reason: string; totalHT: number; units: number }>;
  byFamily: Array<{ familyId: string; name: string; totalHT: number }>;
  byProduct: Array<{ productId: string; name: string; totalHT: number; units: number }>;
}

export function lossReport(db: GestionDB, idx: Index, p: Period, revenueHT = 0): LossReport {
  const r: LossReport = {
    totalHT: 0,
    totalVAT: 0,
    units: 0,
    count: 0,
    rate: 0,
    byReason: [],
    byFamily: [],
    byProduct: [],
  };
  const reasonMap = new Map<string, { totalHT: number; units: number }>();
  const famMap = new Map<string, number>();
  const prodMap = new Map<string, { totalHT: number; units: number }>();

  for (const loss of db.losses) {
    if (!inPeriod(loss.date, p)) continue;
    const value = loss.unitCost * loss.quantity;
    const rate = vatRateOf(idx, loss.vatRateId);
    r.totalHT += value;
    r.totalVAT += value * (rate / 100);
    r.units += loss.quantity;
    r.count += 1;

    const a = reasonMap.get(loss.reason) ?? { totalHT: 0, units: 0 };
    a.totalHT += value;
    a.units += loss.quantity;
    reasonMap.set(loss.reason, a);

    const product = idx.productById.get(loss.productId);
    const famId = product?.familyId ?? 'sans';
    famMap.set(famId, (famMap.get(famId) ?? 0) + value);

    const b = prodMap.get(loss.productId) ?? { totalHT: 0, units: 0 };
    b.totalHT += value;
    b.units += loss.quantity;
    prodMap.set(loss.productId, b);
  }

  r.totalHT = euro(r.totalHT);
  r.totalVAT = euro(r.totalVAT);
  r.rate = revenueHT > 0 ? (r.totalHT / revenueHT) * 100 : 0;
  r.byReason = [...reasonMap.entries()]
    .map(([reason, v]) => ({ reason, totalHT: euro(v.totalHT), units: v.units }))
    .sort((a, b) => b.totalHT - a.totalHT);
  r.byFamily = [...famMap.entries()]
    .map(([familyId, totalHT]) => ({
      familyId,
      name: idx.familyById.get(familyId)?.name ?? 'Sans famille',
      totalHT: euro(totalHT),
    }))
    .sort((a, b) => b.totalHT - a.totalHT);
  r.byProduct = [...prodMap.entries()]
    .map(([productId, v]) => ({
      productId,
      name: idx.productById.get(productId)?.name ?? 'Produit supprimé',
      totalHT: euro(v.totalHT),
      units: v.units,
    }))
    .sort((a, b) => b.totalHT - a.totalHT);
  return r;
}

// ------------------------------------------------------------------ marges par axe

export interface MarginRow {
  key: string;
  label: string;
  revenueHT: number;
  costHT: number;
  marginHT: number;
  marginRate: number;
  markRate: number;
  units: number;
}

export type MarginAxis = 'produit' | 'famille' | 'rayon' | 'fournisseur';

export function marginByAxis(db: GestionDB, idx: Index, p: Period, axis: MarginAxis): MarginRow[] {
  const map = new Map<string, MarginRow>();

  const keyOf = (productId: string): { key: string; label: string } => {
    const product = idx.productById.get(productId);
    if (!product) return { key: 'inconnu', label: 'Produit supprimé' };
    switch (axis) {
      case 'produit':
        return { key: product.id, label: product.name };
      case 'famille': {
        const f = product.familyId ? idx.familyById.get(product.familyId) : undefined;
        return { key: product.familyId ?? 'sans', label: f?.name ?? 'Sans famille' };
      }
      case 'rayon': {
        const f = product.familyId ? idx.familyById.get(product.familyId) : undefined;
        const aisle = f?.aisle || product.location || 'Sans rayon';
        return { key: aisle, label: aisle };
      }
      case 'fournisseur': {
        const link = product.suppliers.find((l) => l.primary) ?? product.suppliers[0];
        const s = link ? idx.supplierById.get(link.supplierId) : undefined;
        return { key: link?.supplierId ?? 'sans', label: s?.name ?? 'Sans fournisseur' };
      }
    }
  };

  for (const sale of db.sales) {
    if (!inPeriod(sale.date, p)) continue;
    for (const line of sale.lines) {
      const { key, label } = keyOf(line.productId);
      const row =
        map.get(key) ??
        { key, label, revenueHT: 0, costHT: 0, marginHT: 0, marginRate: 0, markRate: 0, units: 0 };
      const rate = vatRateOf(idx, line.vatRateId);
      const ttc = line.unitPriceTTC * line.quantity * (1 - (line.discountRate || 0) / 100);
      row.revenueHT += htFromTTC(ttc, rate);
      row.costHT += line.unitCost * line.quantity;
      row.units += line.quantity;
      map.set(key, row);
    }
  }

  const rows = [...map.values()].map((r) => {
    r.revenueHT = euro(r.revenueHT);
    r.costHT = euro(r.costHT);
    r.marginHT = euro(r.revenueHT - r.costHT);
    r.marginRate = r.costHT > 0 ? (r.marginHT / r.costHT) * 100 : 0;
    r.markRate = r.revenueHT > 0 ? (r.marginHT / r.revenueHT) * 100 : 0;
    return r;
  });
  rows.sort((a, b) => b.marginHT - a.marginHT);
  return rows;
}

// ------------------------------------------------------------------ TVA / comptabilite

export interface VatLine {
  vatRateId: string;
  label: string;
  rate: number;
  /** Base HT des ventes */
  salesBase: number;
  /** TVA collectee sur les ventes */
  collected: number;
  /** Base HT des achats */
  purchaseBase: number;
  /** TVA deductible sur les achats */
  deductible: number;
}

export interface VatReport {
  period: Period;
  lines: VatLine[];
  totalCollected: number;
  totalDeductible: number;
  /** Solde : positif = a reverser, negatif = credit. A valider par l'expert-comptable. */
  balance: number;
}

export function vatReport(db: GestionDB, idx: Index, p: Period): VatReport {
  const sales = salesReport(db, idx, p);
  const purchases = purchaseReport(db, idx, p);
  const ids = new Set<string>([...sales.vat.map((v) => v.vatRateId), ...purchases.vat.map((v) => v.vatRateId)]);

  const lines: VatLine[] = [...ids].map((id) => {
    const s = sales.vat.find((v) => v.vatRateId === id);
    const a = purchases.vat.find((v) => v.vatRateId === id);
    const rate = idx.vatById.get(id)?.rate ?? 0;
    return {
      vatRateId: id,
      label: idx.vatById.get(id)?.label ?? 'Taux inconnu',
      rate,
      salesBase: euro(s?.baseHT ?? 0),
      collected: euro(s?.vat ?? 0),
      purchaseBase: euro(a?.baseHT ?? 0),
      deductible: euro(a?.vat ?? 0),
    };
  });
  lines.sort((x, y) => x.rate - y.rate);

  const totalCollected = euro(lines.reduce((n, l) => n + l.collected, 0));
  const totalDeductible = euro(lines.reduce((n, l) => n + l.deductible, 0));
  return {
    period: p,
    lines,
    totalCollected,
    totalDeductible,
    balance: euro(totalCollected - totalDeductible),
  };
}

export interface AccountingSummary {
  period: Period;
  revenueHT: number;
  revenueTTC: number;
  purchasesHT: number;
  vatCollected: number;
  vatDeductible: number;
  vatBalance: number;
  lossesHT: number;
  grossMarginHT: number;
  /** Valeur du stock a la date de fin de periode */
  stockValueHT: number;
  /** Variation de stock sur la periode (fin - debut) */
  stockVariationHT: number;
  supplierPayments: number;
  supplierDebt: number;
  cashIn: number;
  byPaymentMethod: Array<{ method: string; amount: number; count: number }>;
}

/** Valeur du stock a une date donnee, reconstituee depuis le journal. */
export function stockValueAt(db: GestionDB, at: number): number {
  const qty = new Map<string, number>();
  for (const m of db.movements) {
    if (m.date > at) continue;
    qty.set(m.productId, (qty.get(m.productId) ?? 0) + m.quantity);
  }
  let total = 0;
  for (const [productId, q] of qty) {
    if (q <= 0) continue;
    const p = db.products.find((x) => x.id === productId);
    total += q * (p?.purchasePrice ?? 0);
  }
  return euro(total);
}

export function accountingSummary(db: GestionDB, idx: Index, p: Period): AccountingSummary {
  const sales = salesReport(db, idx, p);
  const purchases = purchaseReport(db, idx, p);
  const losses = lossReport(db, idx, p, sales.revenueHT);
  const vat = vatReport(db, idx, p);

  const stockStart = stockValueAt(db, p.from - 1);
  const stockEnd = stockValueAt(db, p.to);

  const payments = db.payments.filter((x) => {
    const ts = fromISODate(x.date);
    return ts >= p.from && ts <= p.to;
  });
  const paid = euro(payments.reduce((n, x) => n + x.amount, 0));

  const debt = euro(
    db.invoices
      .filter((i) => i.status !== 'payee')
      .reduce((n, i) => n + (i.isCredit ? -i.totalTTC : i.totalTTC), 0) -
      db.payments.reduce((n, x) => n + (x.invoiceId ? 0 : x.amount), 0),
  );

  return {
    period: p,
    revenueHT: euro(sales.revenueHT),
    revenueTTC: euro(sales.revenueTTC),
    purchasesHT: euro(purchases.totalHT),
    vatCollected: vat.totalCollected,
    vatDeductible: vat.totalDeductible,
    vatBalance: vat.balance,
    lossesHT: losses.totalHT,
    grossMarginHT: euro(sales.marginHT),
    stockValueHT: stockEnd,
    stockVariationHT: euro(stockEnd - stockStart),
    supplierPayments: paid,
    supplierDebt: debt,
    cashIn: euro(sales.payments.find((x) => x.method === 'especes')?.amount ?? 0),
    byPaymentMethod: sales.payments,
  };
}

// ------------------------------------------------------------------ inventaire

export interface InventorySummary {
  counted: number;
  total: number;
  /** Ecart quantitatif net */
  gapUnits: number;
  /** Valeur HT de l'ecart (negative = manquant) */
  gapValue: number;
  /** Valeur absolue des ecarts, dans les deux sens */
  gapAbsolute: number;
  /** Valeur theorique du perimetre inventorie */
  theoreticalValue: number;
  /** Taux d'ecart en valeur */
  gapRate: number;
  missing: number;
  surplus: number;
}

export function inventorySummary(inv: { lines: Array<{ theoretical: number; counted: number | null; unitCost: number }> }): InventorySummary {
  const s: InventorySummary = {
    counted: 0,
    total: inv.lines.length,
    gapUnits: 0,
    gapValue: 0,
    gapAbsolute: 0,
    theoreticalValue: 0,
    gapRate: 0,
    missing: 0,
    surplus: 0,
  };
  for (const l of inv.lines) {
    s.theoreticalValue += l.theoretical * l.unitCost;
    if (l.counted === null) continue;
    s.counted += 1;
    const gap = l.counted - l.theoretical;
    s.gapUnits += gap;
    s.gapValue += gap * l.unitCost;
    s.gapAbsolute += Math.abs(gap) * l.unitCost;
    if (gap < 0) s.missing += 1;
    if (gap > 0) s.surplus += 1;
  }
  s.theoreticalValue = euro(s.theoreticalValue);
  s.gapValue = euro(s.gapValue);
  s.gapAbsolute = euro(s.gapAbsolute);
  s.gapRate = s.theoreticalValue > 0 ? (Math.abs(s.gapValue) / s.theoreticalValue) * 100 : 0;
  return s;
}

// ------------------------------------------------------------------ totaux documents

export interface DocTotals {
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  vat: Array<{ vatRateId: string; rate: number; base: number; vat: number }>;
}

export function linesTotals(
  idx: Index,
  lines: Array<{ quantity: number; unitPrice: number; discountRate: number; vatRateId: string }>,
  shipping = 0,
): DocTotals {
  const map = new Map<string, { rate: number; base: number; vat: number }>();
  let totalHT = 0;
  for (const l of lines) {
    const base = netCost(l.unitPrice, l.discountRate) * l.quantity;
    const rate = vatRateOf(idx, l.vatRateId);
    totalHT += base;
    const acc = map.get(l.vatRateId) ?? { rate, base: 0, vat: 0 };
    acc.base += base;
    acc.vat += base * (rate / 100);
    map.set(l.vatRateId, acc);
  }
  totalHT += shipping;
  const vat = [...map.entries()]
    .map(([vatRateId, v]) => ({ vatRateId, rate: v.rate, base: euro(v.base), vat: euro(v.vat) }))
    .sort((a, b) => a.rate - b.rate);
  const totalVAT = euro(vat.reduce((n, v) => n + v.vat, 0));
  return { totalHT: euro(totalHT), totalVAT, totalTTC: euro(totalHT + totalVAT), vat };
}

// ------------------------------------------------------------------ divers

/** Somme des ventes d'un produit sur une periode. */
export function soldInPeriod(sales: Sale[], productId: string, p: Period): number {
  let n = 0;
  for (const s of sales) {
    if (!inPeriod(s.date, p)) continue;
    for (const l of s.lines) if (l.productId === productId) n += l.quantity;
  }
  return n;
}

export function lossesOfProduct(losses: Loss[], productId: string): Loss[] {
  return losses.filter((l) => l.productId === productId).sort((a, b) => b.date - a.date);
}

/** Evolution en % entre deux valeurs, null si la reference est nulle. */
export function evolution(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
