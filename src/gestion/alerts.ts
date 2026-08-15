/**
 * Alertes et controles de coherence.
 *
 * Deux familles distinctes :
 *  - les ALERTES metier (rupture, marge, DLC, commande a passer…) : elles
 *    dependent de seuils configurables dans les parametres ;
 *  - les CONTROLES de donnees (produit sans TVA, doublon d'EAN, stock
 *    negatif…) : ce sont des incoherences a corriger, pas des seuils.
 *
 * Aucune de ces regles n'invente de regle fiscale : elles ne portent que sur
 * la coherence interne des donnees saisies.
 */

import {
  buildIndex,
  coverageDays,
  dailySales,
  fmtEuro,
  fmtPct,
  fmtQty,
  marginOf,
  statsOf,
  vatRateOf,
  DAY,
  fromISODate,
  inventorySummary,
  type Index,
} from './calc';
import type { GestionDB } from './types';

export type AlertLevel = 'critique' | 'attention' | 'info';

export interface Alert {
  id: string;
  level: AlertLevel;
  category:
    | 'rupture'
    | 'stock'
    | 'commande'
    | 'prix'
    | 'marge'
    | 'dormant'
    | 'dlc'
    | 'inventaire'
    | 'facture'
    | 'donnees';
  title: string;
  detail: string;
  /** Cible cliquable : ecran a ouvrir et identifiant concerne */
  target?: { screen: string; id?: string };
}

const LEVEL_ORDER: Record<AlertLevel, number> = { critique: 0, attention: 1, info: 2 };

/** Toutes les alertes metier, triees par gravite. */
export function computeAlerts(db: GestionDB, idx: Index = buildIndex(db)): Alert[] {
  const out: Alert[] = [];
  const a = db.settings.alerts;
  const now = Date.now();

  for (const p of db.products) {
    if (!p.active) continue;
    const s = statsOf(idx, p.id);
    const daily = dailySales(s, db.settings.forecastWindowDays);

    // --- rupture et stock faible
    if (s.stock <= 0) {
      out.push({
        id: `rupture-${p.id}`,
        level: 'critique',
        category: 'rupture',
        title: `Rupture : ${p.name}`,
        detail:
          s.onOrder > 0
            ? `Stock épuisé. ${fmtQty(s.onOrder)} en commande.`
            : 'Stock épuisé, aucune commande en cours.',
        target: { screen: 'produits', id: p.id },
      });
    } else {
      const cover = coverageDays(idx, p.id, db.settings.forecastWindowDays);
      if (cover !== null && cover <= a.ruptureDays && s.onOrder <= 0) {
        out.push({
          id: `imminent-${p.id}`,
          level: 'critique',
          category: 'rupture',
          title: `Rupture imminente : ${p.name}`,
          detail: `${fmtQty(s.stock)} en stock, ${fmtQty(daily)}/jour : ${cover} jour(s) de couverture.`,
          target: { screen: 'produits', id: p.id },
        });
      } else if (s.stock <= p.stockMin && p.stockMin > 0) {
        out.push({
          id: `bas-${p.id}`,
          level: 'attention',
          category: 'stock',
          title: `Stock faible : ${p.name}`,
          detail: `${fmtQty(s.stock)} en stock pour un minimum de ${fmtQty(p.stockMin)}.`,
          target: { screen: 'produits', id: p.id },
        });
      }
    }

    // --- marge insuffisante
    const m = marginOf(p, vatRateOf(idx, p.vatRateId));
    if (p.purchasePrice > 0 && p.salePriceHT > 0) {
      if (m.marginEuro < 0) {
        out.push({
          id: `marge-neg-${p.id}`,
          level: 'critique',
          category: 'marge',
          title: `Marge négative : ${p.name}`,
          detail: `Vendu ${fmtEuro(p.salePriceHT)} HT pour un achat à ${fmtEuro(p.purchasePrice)} HT.`,
          target: { screen: 'marges', id: p.id },
        });
      } else if (m.marginRate < a.minMarginRate) {
        out.push({
          id: `marge-${p.id}`,
          level: 'attention',
          category: 'marge',
          title: `Marge insuffisante : ${p.name}`,
          detail: `Taux de marge ${fmtPct(m.marginRate)} pour un minimum attendu de ${fmtPct(a.minMarginRate)}.`,
          target: { screen: 'marges', id: p.id },
        });
      }
    }

    // --- produit dormant
    if (s.stock > 0 && p.active) {
      const last = s.lastSaleAt;
      const days = last ? Math.floor((now - last) / DAY) : null;
      if (days !== null && days >= a.noSaleDays) {
        out.push({
          id: `dormant-${p.id}`,
          level: 'info',
          category: 'dormant',
          title: `Aucune vente depuis ${days} jours : ${p.name}`,
          detail: `${fmtQty(s.stock)} en stock, soit ${fmtEuro(s.stock * p.purchasePrice)} immobilisés.`,
          target: { screen: 'produits', id: p.id },
        });
      }
    }
  }

  // --- hausses de prix d'achat
  for (const h of db.priceHistory) {
    if (now - h.date > 60 * DAY) continue;
    if (h.from <= 0) continue;
    const increase = ((h.to - h.from) / h.from) * 100;
    if (increase < a.priceIncreaseRate) continue;
    const p = idx.productById.get(h.productId);
    if (!p) continue;
    out.push({
      id: `prix-${h.id}`,
      level: 'critique',
      category: 'prix',
      title: `Prix d'achat en hausse : ${p.name}`,
      detail:
        `+${increase.toFixed(1)} % (${fmtEuro(h.from)} → ${fmtEuro(h.to)} HT). ` +
        `Votre marge est passée de ${fmtPct(h.marginBefore)} à ${fmtPct(h.marginAfter)}.`,
      target: { screen: 'marges', id: p.id },
    });
  }

  // --- DLC
  for (const lot of db.lots) {
    if (!lot.expiry) continue;
    const days = Math.floor((fromISODate(lot.expiry) - now) / DAY);
    if (days > a.dlcWarningDays) continue;
    const p = idx.productById.get(lot.productId);
    if (!p) continue;
    out.push({
      id: `dlc-${lot.id}`,
      level: days < 0 ? 'critique' : 'attention',
      category: 'dlc',
      title: days < 0 ? `DLC dépassée : ${p.name}` : `DLC proche : ${p.name}`,
      detail:
        days < 0
          ? `Lot ${lot.code || '—'} périmé depuis ${-days} jour(s). À retirer de la vente.`
          : `Lot ${lot.code || '—'} à ${lot.expiry} : ${days} jour(s). Envisagez une démarque.`,
      target: { screen: 'dlc', id: lot.productId },
    });
  }

  // --- commandes a preparer
  const toOrder = db.products.filter((p) => {
    if (!p.active) return false;
    const s = statsOf(idx, p.id);
    if (s.onOrder > 0) return false;
    const cover = coverageDays(idx, p.id, db.settings.forecastWindowDays);
    return s.stock <= 0 || (cover !== null && cover <= a.ruptureDays) || (p.stockMin > 0 && s.stock <= p.stockMin);
  });
  if (toOrder.length > 0) {
    out.push({
      id: 'commande-a-preparer',
      level: 'attention',
      category: 'commande',
      title: `${toOrder.length} référence(s) à commander`,
      detail: 'Le module Achats propose déjà les quantités à partir de vos ventes.',
      target: { screen: 'achats' },
    });
  }

  // --- livraisons attendues
  const today = new Date().toISOString().slice(0, 10);
  for (const o of db.orders) {
    if (o.status !== 'envoyee' && o.status !== 'partielle') continue;
    if (!o.expectedAt) continue;
    if (o.expectedAt > today) continue;
    const s = idx.supplierById.get(o.supplierId);
    out.push({
      id: `livraison-${o.id}`,
      level: o.expectedAt < today ? 'critique' : 'info',
      category: 'commande',
      title:
        o.expectedAt < today
          ? `Livraison en retard : ${o.number}`
          : `Livraison attendue aujourd'hui : ${o.number}`,
      detail: `${s?.name ?? 'Fournisseur'} — livraison prévue le ${o.expectedAt}.`,
      target: { screen: 'receptions', id: o.id },
    });
  }

  // --- inventaires
  const lastClosed = db.inventories
    .filter((i) => i.closed && i.closedAt)
    .sort((x, y) => (y.closedAt ?? 0) - (x.closedAt ?? 0))[0];
  if (db.products.length > 0) {
    const since = lastClosed?.closedAt ? Math.floor((now - lastClosed.closedAt) / DAY) : null;
    if (since === null) {
      out.push({
        id: 'inventaire-jamais',
        level: 'attention',
        category: 'inventaire',
        title: 'Aucun inventaire réalisé',
        detail: 'Un premier inventaire fiabilise toutes les valorisations de stock.',
        target: { screen: 'inventaires' },
      });
    } else if (since >= a.inventoryIntervalDays) {
      out.push({
        id: 'inventaire-du',
        level: 'attention',
        category: 'inventaire',
        title: `Inventaire à réaliser (${since} jours)`,
        detail: `Dernier inventaire clôturé il y a ${since} jours, pour un intervalle attendu de ${a.inventoryIntervalDays} jours.`,
        target: { screen: 'inventaires' },
      });
    }
  }
  for (const inv of db.inventories) {
    if (!inv.closed) continue;
    if (now - (inv.closedAt ?? 0) > 90 * DAY) continue;
    const s = inventorySummary(inv);
    if (s.gapRate >= a.inventoryGapRate && s.theoreticalValue > 0) {
      out.push({
        id: `ecart-${inv.id}`,
        level: 'critique',
        category: 'inventaire',
        title: `Écart d'inventaire important : ${inv.number}`,
        detail: `${fmtEuro(s.gapValue)} d'écart, soit ${fmtPct(s.gapRate)} de la valeur inventoriée.`,
        target: { screen: 'inventaires', id: inv.id },
      });
    }
  }

  // --- factures
  for (const inv of db.invoices) {
    if (inv.status === 'a_rapprocher') {
      out.push({
        id: `facture-${inv.id}`,
        level: 'attention',
        category: 'facture',
        title: `Facture non rapprochée : ${inv.number}`,
        detail: `${idx.supplierById.get(inv.supplierId)?.name ?? 'Fournisseur'} — ${fmtEuro(inv.totalTTC)} TTC.`,
        target: { screen: 'comptabilite', id: inv.id },
      });
    }
    if (inv.receptionIds.length > 0) {
      const expected = inv.receptionIds.reduce((n, rid) => {
        const rec = db.receptions.find((r) => r.id === rid);
        if (!rec) return n;
        return (
          n +
          rec.lines.reduce(
            (m, l) => m + l.unitPrice * (1 - (l.discountRate || 0) / 100) * l.received,
            0,
          ) +
          (rec.shipping || 0)
        );
      }, 0);
      const gap = Math.abs(expected - inv.totalHT);
      if (gap > a.invoiceGapAmount) {
        out.push({
          id: `ecart-facture-${inv.id}`,
          level: 'critique',
          category: 'facture',
          title: `Écart facture / réception : ${inv.number}`,
          detail: `Réception ${fmtEuro(expected)} HT contre ${fmtEuro(inv.totalHT)} HT facturés, soit ${fmtEuro(gap)} d'écart.`,
          target: { screen: 'comptabilite', id: inv.id },
        });
      }
    }
  }

  out.sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level]);
  return out;
}

// ---------------------------------------------------------------- controles

export interface DataIssue {
  id: string;
  severity: 'bloquant' | 'a_corriger' | 'a_verifier';
  label: string;
  detail: string;
  target?: { screen: string; id?: string };
}

/** Controles de coherence des donnees. */
export function checkData(db: GestionDB, idx: Index = buildIndex(db)): DataIssue[] {
  const out: DataIssue[] = [];
  const eans = new Map<string, string[]>();
  const refs = new Map<string, string[]>();

  for (const p of db.products) {
    const s = statsOf(idx, p.id);

    if (!p.vatRateId || !idx.vatById.has(p.vatRateId)) {
      out.push({
        id: `tva-${p.id}`,
        severity: 'bloquant',
        label: `Produit sans taux de TVA : ${p.name}`,
        detail: 'Sans taux, ce produit fausse la TVA collectée et les exports comptables.',
        target: { screen: 'produits', id: p.id },
      });
    }
    if (!p.purchasePrice) {
      out.push({
        id: `pa-${p.id}`,
        severity: 'a_corriger',
        label: `Produit sans prix d'achat : ${p.name}`,
        detail: 'La marge et la valorisation du stock sont incalculables.',
        target: { screen: 'produits', id: p.id },
      });
    }
    if (!p.salePriceHT && !p.salePriceTTC) {
      out.push({
        id: `pv-${p.id}`,
        severity: 'a_corriger',
        label: `Produit sans prix de vente : ${p.name}`,
        detail: 'Aucun chiffre d’affaires ne pourra être rattaché à ce produit.',
        target: { screen: 'produits', id: p.id },
      });
    }
    if (p.purchasePrice > 0 && p.salePriceHT > 0 && p.salePriceHT < p.purchasePrice) {
      out.push({
        id: `marge-${p.id}`,
        severity: 'a_corriger',
        label: `Marge négative : ${p.name}`,
        detail: `Vente ${fmtEuro(p.salePriceHT)} HT < achat ${fmtEuro(p.purchasePrice)} HT.`,
        target: { screen: 'marges', id: p.id },
      });
    }
    if (s.stock < 0) {
      out.push({
        id: `neg-${p.id}`,
        severity: 'bloquant',
        label: `Stock négatif : ${p.name}`,
        detail: `${fmtQty(s.stock)} : une sortie a été saisie sans entrée correspondante. À régulariser par un inventaire.`,
        target: { screen: 'stocks', id: p.id },
      });
    }
    if (p.suppliers.length === 0) {
      out.push({
        id: `four-${p.id}`,
        severity: 'a_verifier',
        label: `Produit sans fournisseur : ${p.name}`,
        detail: 'Il ne pourra pas être proposé au réapprovisionnement.',
        target: { screen: 'produits', id: p.id },
      });
    }
    if (p.ean) {
      const list = eans.get(p.ean) ?? [];
      list.push(p.name);
      eans.set(p.ean, list);
    }
    if (p.ref) {
      const list = refs.get(p.ref) ?? [];
      list.push(p.name);
      refs.set(p.ref, list);
    }
  }

  for (const [ean, names] of eans) {
    if (names.length > 1) {
      out.push({
        id: `ean-${ean}`,
        severity: 'bloquant',
        label: `Code-barres dupliqué : ${ean}`,
        detail: `Utilisé par ${names.length} produits : ${names.join(', ')}. Le scan devient ambigu.`,
        target: { screen: 'produits' },
      });
    }
  }
  for (const [ref, names] of refs) {
    if (names.length > 1) {
      out.push({
        id: `ref-${ref}`,
        severity: 'a_corriger',
        label: `Référence interne dupliquée : ${ref}`,
        detail: `Portée par ${names.length} produits : ${names.join(', ')}.`,
        target: { screen: 'produits' },
      });
    }
  }

  for (const inv of db.invoices) {
    if (!inv.supplierId || !idx.supplierById.has(inv.supplierId)) {
      out.push({
        id: `f-sansfour-${inv.id}`,
        severity: 'bloquant',
        label: `Facture sans fournisseur : ${inv.number}`,
        detail: 'Impossible de la rattacher aux achats de la période.',
        target: { screen: 'comptabilite', id: inv.id },
      });
    }
  }

  for (const rec of db.receptions) {
    if (!rec.orderId) {
      out.push({
        id: `rec-sanscmd-${rec.id}`,
        severity: 'a_verifier',
        label: `Réception sans commande : ${rec.number}`,
        detail: 'Aucun bon de commande à rapprocher : les écarts ne peuvent pas être détectés.',
        target: { screen: 'receptions', id: rec.id },
      });
    }
  }

  const staleDays = 21;
  for (const o of db.orders) {
    if (o.status !== 'envoyee') continue;
    if (!o.sentAt || Date.now() - o.sentAt < staleDays * DAY) continue;
    out.push({
      id: `cmd-sansrec-${o.id}`,
      severity: 'a_verifier',
      label: `Commande sans réception : ${o.number}`,
      detail: `Envoyée il y a plus de ${staleDays} jours et toujours pas réceptionnée.`,
      target: { screen: 'achats', id: o.id },
    });
  }

  const order: Record<DataIssue['severity'], number> = { bloquant: 0, a_corriger: 1, a_verifier: 2 };
  out.sort((x, y) => order[x.severity] - order[y.severity]);
  return out;
}
