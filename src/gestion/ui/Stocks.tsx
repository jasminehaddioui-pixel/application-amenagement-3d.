/**
 * Stocks : etat courant, et journal de chaque produit.
 *
 * On ne corrige jamais une quantite « en direct » : toute correction est un
 * mouvement motive, qui laisse sa trace. C'est ce qui rend la valorisation
 * defendable devant un tiers.
 */

import { useMemo, useState } from 'react';
import { useGestion } from '../store';
import {
  buildIndex,
  coverageDays,
  fmtDateTime,
  fmtEuro,
  fmtQty,
  rotation,
  statsOf,
  valuation,
} from '../calc';
import { downloadCSV } from '../csv';
import { MOVEMENT_LABEL, type MovementType, type Product } from '../types';
import { Card, Empty, Field, Modal, NoticeBox, NumberInput, Section, Select, TextInput } from './common';

type Filter = 'tous' | 'rupture' | 'bas' | 'negatif' | 'dormant';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'tous', label: 'Tous les produits' },
  { value: 'rupture', label: 'En rupture' },
  { value: 'bas', label: 'Sous le minimum' },
  { value: 'negatif', label: 'Stock négatif' },
  { value: 'dormant', label: 'Sans vente récente' },
];

/** Natures de mouvement saisissables a la main. */
const MANUAL_TYPES: MovementType[] = ['initial', 'regularisation', 'transfert', 'retour_fournisseur'];

export default function Stocks() {
  const db = useGestion((s) => s.db);
  const focusId = useGestion((s) => s.focusId);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('tous');
  const [detail, setDetail] = useState<Product | null>(null);

  const idx = useMemo(() => buildIndex(db), [db]);
  const val = useMemo(() => valuation(db, idx), [db, idx]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return db.products
      .filter((p) => {
        if (!p.active) return false;
        const s = statsOf(idx, p.id);
        if (filter === 'rupture' && s.stock > 0) return false;
        if (filter === 'bas' && !(s.stock > 0 && p.stockMin > 0 && s.stock <= p.stockMin)) return false;
        if (filter === 'negatif' && s.stock >= 0) return false;
        if (filter === 'dormant' && (s.sold30 > 0 || s.stock <= 0)) return false;
        if (!q) return true;
        return p.name.toLowerCase().includes(q) || p.ean.includes(q) || p.ref.toLowerCase().includes(q);
      })
      .sort((a, b) => statsOf(idx, a.id).stock - statsOf(idx, b.id).stock);
  }, [db.products, idx, search, filter]);

  const exportCSV = () => {
    downloadCSV(
      'etat-des-stocks.csv',
      ['Référence', 'EAN', 'Désignation', 'Emplacement', 'Stock', 'Stock mini', 'PA HT', 'Valeur HT', 'Couverture (j)', 'Rotation'],
      rows.map((p) => {
        const s = statsOf(idx, p.id);
        return [
          p.ref,
          p.ean,
          p.name,
          p.location,
          s.stock,
          p.stockMin,
          p.purchasePrice,
          Math.round(s.stock * p.purchasePrice * 100) / 100,
          coverageDays(idx, p.id, db.settings.forecastWindowDays) ?? '',
          rotation(idx, p.id),
        ];
      }),
    );
  };

  return (
    <>
      <Section title="Valorisation">
        <div className="g-cards">
          <Card k="Valeur du stock (PA HT)" v={fmtEuro(val.valueHT)} d={`${val.references} référence(s)`} />
          <Card k="Valeur commerciale (PV TTC)" v={fmtEuro(val.valueTTC)} d="potentiel de vente" />
          <Card k="Unités en stock" v={fmtQty(val.units)} />
          <Card k="Ruptures" v={val.ruptures} tone={val.ruptures ? 'bad' : 'good'} />
          <Card k="Sous le minimum" v={val.low} tone={val.low ? 'warn' : 'good'} />
          <Card
            k="Stocks négatifs"
            v={val.negatives}
            d={val.negatives ? 'à régulariser par inventaire' : 'aucune incohérence'}
            tone={val.negatives ? 'bad' : 'good'}
          />
        </div>
      </Section>

      {val.negatives > 0 && (
        <NoticeBox tone="danger" title="Des stocks sont négatifs">
          Une sortie a été enregistrée sans entrée correspondante — réception oubliée, ou vente
          saisie deux fois. Régularisez par un inventaire : l'écart sera tracé au lieu d'être gommé.
        </NoticeBox>
      )}

      <div className="g-toolbar" style={{ marginTop: 14 }}>
        <input
          className="g-search"
          placeholder="Rechercher un produit…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ width: 190 }}>
          <Select value={filter} onChange={setFilter} options={FILTERS} />
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={exportCSV} disabled={rows.length === 0}>
          Exporter l'état des stocks
        </button>
      </div>

      {rows.length === 0 ? (
        <Empty icon="📊" title="Rien à afficher">
          Aucun produit ne correspond à ce filtre.
        </Empty>
      ) : (
        <div className="g-table-wrap">
          <table className="g-table">
            <thead>
              <tr>
                <th>Désignation</th>
                <th>Emplacement</th>
                <th className="g-num">Stock</th>
                <th className="g-num">Mini</th>
                <th className="g-num">En commande</th>
                <th className="g-num">Couverture</th>
                <th className="g-num">Rotation</th>
                <th className="g-num">Valeur HT</th>
                <th>Dernier mouvement</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const s = statsOf(idx, p.id);
                const cover = coverageDays(idx, p.id, db.settings.forecastWindowDays);
                const last = idx.movementsByProduct.get(p.id)?.[0];
                const low = p.stockMin > 0 && s.stock <= p.stockMin;
                return (
                  <tr key={p.id} className={focusId === p.id ? 'selected' : ''}>
                    <td className="g-strong g-wrap">{p.name}</td>
                    <td className="g-muted">{p.location || '—'}</td>
                    <td className={`g-num g-strong ${s.stock < 0 ? 'g-bad' : s.stock === 0 ? 'g-bad' : low ? 'g-warnc' : ''}`}>
                      {fmtQty(s.stock)}
                    </td>
                    <td className="g-num g-muted">{p.stockMin || '—'}</td>
                    <td className="g-num g-muted">{s.onOrder ? fmtQty(s.onOrder) : '—'}</td>
                    <td className="g-num">{cover === null ? '—' : `${cover} j`}</td>
                    <td className="g-num g-muted">{rotation(idx, p.id) || '—'}</td>
                    <td className="g-num">{fmtEuro(s.stock * p.purchasePrice)}</td>
                    <td className="g-muted">
                      {last ? `${MOVEMENT_LABEL[last.type]} · ${fmtDateTime(last.date)}` : 'aucun'}
                    </td>
                    <td className="g-num">
                      <button type="button" className="btn small ghost" onClick={() => setDetail(p)}>
                        Journal
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detail && <ProductJournal product={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

// ------------------------------------------------------------------ journal

function ProductJournal({ product, onClose }: { product: Product; onClose: () => void }) {
  const db = useGestion((s) => s.db);
  const addMovement = useGestion((s) => s.addMovement);
  const can = useGestion((s) => s.can);
  const notify = useGestion((s) => s.notify);
  const idx = useMemo(() => buildIndex(db), [db]);

  const movements = idx.movementsByProduct.get(product.id) ?? [];
  const stock = statsOf(idx, product.id).stock;

  const [type, setType] = useState<MovementType>('regularisation');
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState('');

  const submit = () => {
    if (!quantity) {
      notify('Indiquez une quantité différente de zéro.', 'error');
      return;
    }
    if (!reason.trim()) {
      notify('Un motif est obligatoire : c’est lui qui rend la correction justifiable.', 'error');
      return;
    }
    addMovement({
      productId: product.id,
      type,
      quantity,
      unitCost: product.purchasePrice,
      reason: reason.trim(),
      docType: 'autre',
    });
    setQuantity(0);
    setReason('');
    notify('Mouvement enregistré.', 'success');
  };

  return (
    <Modal title={`Journal de stock — ${product.name}`} wide onClose={onClose}>
      <div className="g-cards" style={{ marginBottom: 14 }}>
        <Card k="Stock actuel" v={fmtQty(stock)} d={fmtEuro(stock * product.purchasePrice)} />
        <Card k="Mouvements" v={movements.length} />
        <Card k="Vendu (30 j)" v={fmtQty(statsOf(idx, product.id).sold30)} />
        <Card k="Perdu (30 j)" v={fmtQty(statsOf(idx, product.id).lost30)} />
      </div>

      {can('inventorier') && (
        <div className="g-panel" style={{ marginBottom: 14 }}>
          <h3>Saisir un mouvement</h3>
          <NoticeBox tone="info">
            Le stock n'est jamais réécrit directement : vous enregistrez une entrée ou une sortie
            motivée, et le stock en découle. Une quantité négative retire du stock.
          </NoticeBox>
          <div className="g-grid3" style={{ marginTop: 10 }}>
            <Field label="Nature">
              <Select
                value={type}
                onChange={setType}
                options={MANUAL_TYPES.map((t) => ({ value: t, label: MOVEMENT_LABEL[t] }))}
              />
            </Field>
            <Field label="Quantité (négative = sortie)">
              <NumberInput value={quantity} onChange={setQuantity} />
            </Field>
            <Field label="Motif">
              <TextInput value={reason} onChange={setReason} placeholder="Ex. : erreur de saisie du 12/08" />
            </Field>
          </div>
          <div className="g-row end">
            <button type="button" className="btn primary" onClick={submit}>
              Enregistrer le mouvement
            </button>
          </div>
        </div>
      )}

      {movements.length === 0 ? (
        <Empty icon="🗒️" title="Aucun mouvement">
          Ce produit n'a encore ni entrée ni sortie.
        </Empty>
      ) : (
        <div className="g-table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="g-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Nature</th>
                <th className="g-num">Quantité</th>
                <th className="g-num">Avant</th>
                <th className="g-num">Après</th>
                <th className="g-num">PA HT</th>
                <th>Utilisateur</th>
                <th className="g-wrap">Motif</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="g-muted">{fmtDateTime(m.date)}</td>
                  <td>{MOVEMENT_LABEL[m.type]}</td>
                  <td className={`g-num g-strong ${m.quantity < 0 ? 'g-bad' : 'g-ok'}`}>
                    {m.quantity > 0 ? '+' : ''}
                    {fmtQty(m.quantity)}
                  </td>
                  <td className="g-num g-muted">{fmtQty(m.before)}</td>
                  <td className="g-num">{fmtQty(m.after)}</td>
                  <td className="g-num g-muted">{fmtEuro(m.unitCost)}</td>
                  <td className="g-muted">{db.users.find((u) => u.id === m.userId)?.name ?? '—'}</td>
                  <td className="g-wrap g-muted">{m.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
