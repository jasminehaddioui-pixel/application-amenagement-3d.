/**
 * Fiches produits : le referentiel dont tout le reste depend.
 * La fiche calcule la marge en direct, dans les deux sens : on peut saisir un
 * prix de vente et lire le taux, ou viser un taux et lire le prix.
 */

import { useMemo, useRef, useState } from 'react';
import { useGestion, emptyProduct } from '../store';
import {
  buildIndex,
  fmtEuro,
  fmtPct,
  fmtQty,
  htFromTTC,
  marginOf,
  priceFromMarkRate,
  statsOf,
  ttcFromHT,
  vatRateOf,
  euro,
} from '../calc';
import { downloadCSV, parseCSVObjects, parseNumber } from '../csv';
import type { Product, ProductUnit, SupplierLink } from '../types';
import { Check, Confirm, Empty, Field, Modal, NoticeBox, NumberInput, Select, TextInput } from './common';

const UNITS: Array<{ value: ProductUnit; label: string }> = [
  { value: 'piece', label: 'Pièce' },
  { value: 'kg', label: 'Kilogramme' },
  { value: 'litre', label: 'Litre' },
  { value: 'lot', label: 'Lot' },
];

export default function Produits() {
  const db = useGestion((s) => s.db);
  const focusId = useGestion((s) => s.focusId);
  const deleteProduct = useGestion((s) => s.deleteProduct);
  const can = useGestion((s) => s.can);

  const [search, setSearch] = useState('');
  const [familyFilter, setFamilyFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [edit, setEdit] = useState<Product | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);
  const [importReport, setImportReport] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importProducts = useGestion((s) => s.importProducts);
  const notify = useGestion((s) => s.notify);

  const idx = useMemo(() => buildIndex(db), [db]);
  const editable = can('gerer_produits');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return db.products
      .filter((p) => {
        if (!showInactive && !p.active) return false;
        if (familyFilter && p.familyId !== familyFilter && p.subFamilyId !== familyFilter) return false;
        if (supplierFilter && !p.suppliers.some((l) => l.supplierId === supplierFilter)) return false;
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.ean.toLowerCase().includes(q) ||
          p.ref.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [db.products, search, familyFilter, supplierFilter, showInactive]);

  const exportCSV = () => {
    downloadCSV(
      'produits.csv',
      [
        'Référence',
        'EAN',
        'Désignation',
        'Marque',
        'Famille',
        'Fournisseur principal',
        'Prix achat HT',
        'TVA %',
        'Prix vente HT',
        'Prix vente TTC',
        'Marge €',
        'Taux de marge %',
        'Taux de marque %',
        'Stock',
        'Stock mini',
        'Emplacement',
        'Actif',
      ],
      rows.map((p) => {
        const rate = vatRateOf(idx, p.vatRateId);
        const m = marginOf(p, rate);
        const link = p.suppliers.find((l) => l.primary) ?? p.suppliers[0];
        return [
          p.ref,
          p.ean,
          p.name,
          p.brand,
          p.familyId ? (idx.familyById.get(p.familyId)?.name ?? '') : '',
          link ? (idx.supplierById.get(link.supplierId)?.name ?? '') : '',
          p.purchasePrice,
          rate,
          p.salePriceHT,
          p.salePriceTTC,
          euro(m.marginEuro),
          Math.round(m.marginRate * 10) / 10,
          Math.round(m.markRate * 10) / 10,
          statsOf(idx, p.id).stock,
          p.stockMin,
          p.location,
          p.active ? 'oui' : 'non',
        ];
      }),
    );
  };

  const runImport = async (file: File) => {
    try {
      const objects = parseCSVObjects(await file.text());
      if (objects.length === 0) {
        notify('Aucune ligne exploitable dans ce fichier.', 'error');
        return;
      }
      const defaultVat = db.vatRates.find((v) => v.active)?.id ?? '';
      const products: Product[] = objects.map((o) => {
        const base = emptyProduct(db);
        const rate = parseNumber(o.tva ?? o.tva_ ?? o.taux_tva ?? '');
        const matched = db.vatRates.find((v) => Math.abs(v.rate - rate) < 0.001);
        const purchase = parseNumber(o.prix_achat_ht ?? o.prix_achat ?? o.pa_ht ?? o.pa ?? '');
        const saleHT = parseNumber(o.prix_vente_ht ?? o.pv_ht ?? '');
        const saleTTC = parseNumber(o.prix_vente_ttc ?? o.pv_ttc ?? o.prix_vente ?? '');
        const vatRateId = matched?.id ?? defaultVat;
        const vat = db.vatRates.find((v) => v.id === vatRateId)?.rate ?? 0;
        return {
          ...base,
          ref: o.reference ?? o.ref ?? '',
          ean: o.ean ?? o.code_barres ?? o.code_barre ?? o.gencod ?? '',
          name: o.designation ?? o.libelle ?? o.nom ?? o.produit ?? '',
          brand: o.marque ?? '',
          purchasePrice: purchase,
          vatRateId,
          salePriceHT: saleHT || (saleTTC ? euro(htFromTTC(saleTTC, vat)) : 0),
          salePriceTTC: saleTTC || (saleHT ? euro(ttcFromHT(saleHT, vat)) : 0),
          stockMin: parseNumber(o.stock_mini ?? o.stock_min ?? ''),
          stockMax: parseNumber(o.stock_maxi ?? o.stock_max ?? ''),
          location: o.emplacement ?? o.rayon ?? '',
          packaging: o.conditionnement ?? '',
          unitsPerCase: parseNumber(o.colisage ?? o.par_carton ?? '') || 1,
        };
      });
      const valid = products.filter((p) => p.name.trim() !== '');
      if (valid.length === 0) {
        notify(
          'Aucun nom de produit trouvé. Le fichier doit comporter une colonne « Désignation », « Libellé » ou « Nom ».',
          'error',
        );
        return;
      }
      const added = importProducts(valid);
      setImportReport(
        `${valid.length} ligne(s) traitée(s) : ${added} création(s), ${valid.length - added} mise(s) à jour.`,
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Import impossible.', 'error');
    }
  };

  return (
    <>
      <div className="g-toolbar">
        <input
          className="g-search"
          placeholder="Rechercher : nom, code-barres, référence, marque…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="g-select" style={{ width: 'auto' }} value={familyFilter} onChange={(e) => setFamilyFilter(e.target.value)}>
          <option value="">Toutes les familles</option>
          {db.families.map((f) => (
            <option key={f.id} value={f.id}>
              {f.parentId ? `— ${f.name}` : f.name}
            </option>
          ))}
        </select>
        <select
          className="g-select"
          style={{ width: 'auto' }}
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
        >
          <option value="">Tous les fournisseurs</option>
          {db.suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="g-row" style={{ fontSize: 11.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Inactifs
        </label>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={exportCSV} disabled={rows.length === 0}>
          Exporter en CSV
        </button>
        {editable && (
          <>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              Importer
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void runImport(f);
              }}
            />
            <button type="button" className="btn primary" onClick={() => setEdit(emptyProduct(db))}>
              + Nouveau produit
            </button>
          </>
        )}
      </div>

      {db.products.length === 0 ? (
        <Empty icon="📦" title="Aucun produit">
          Créez votre première fiche, ou importez un fichier CSV : les colonnes « Désignation »,
          « EAN », « Prix achat HT », « Prix vente TTC » et « TVA » sont reconnues automatiquement.
        </Empty>
      ) : (
        <div className="g-table-wrap">
          <table className="g-table">
            <thead>
              <tr>
                <th>Désignation</th>
                <th>EAN</th>
                <th>Famille</th>
                <th className="g-num">PA HT</th>
                <th className="g-num">TVA</th>
                <th className="g-num">PV TTC</th>
                <th className="g-num">Marge</th>
                <th className="g-num">Marque</th>
                <th className="g-num">Stock</th>
                <th>État</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const rate = vatRateOf(idx, p.vatRateId);
                const m = marginOf(p, rate);
                const s = statsOf(idx, p.id);
                const low = p.stockMin > 0 && s.stock <= p.stockMin;
                return (
                  <tr key={p.id} className={focusId === p.id ? 'selected' : ''}>
                    <td className="g-strong g-wrap">
                      {p.name || '(sans nom)'}
                      {p.brand && <span className="g-muted"> · {p.brand}</span>}
                    </td>
                    <td className="g-muted">{p.ean || '—'}</td>
                    <td className="g-muted">
                      {p.familyId ? (idx.familyById.get(p.familyId)?.name ?? '—') : '—'}
                    </td>
                    <td className="g-num">{fmtEuro(p.purchasePrice)}</td>
                    <td className="g-num g-muted">{rate} %</td>
                    <td className="g-num">{fmtEuro(p.salePriceTTC || ttcFromHT(p.salePriceHT, rate))}</td>
                    <td className={`g-num ${m.marginEuro < 0 ? 'g-bad' : ''}`}>{fmtEuro(m.marginEuro)}</td>
                    <td className={`g-num ${m.markRate < db.settings.alerts.minMarginRate ? 'g-warnc' : ''}`}>
                      {fmtPct(m.markRate)}
                    </td>
                    <td className={`g-num ${s.stock <= 0 ? 'g-bad' : low ? 'g-warnc' : ''}`}>{fmtQty(s.stock)}</td>
                    <td>
                      {!p.active ? (
                        <span className="g-tag">Inactif</span>
                      ) : s.stock <= 0 ? (
                        <span className="g-tag bad">Rupture</span>
                      ) : low ? (
                        <span className="g-tag warn">Stock bas</span>
                      ) : (
                        <span className="g-tag ok">OK</span>
                      )}
                    </td>
                    <td className="g-num">
                      <button type="button" className="btn small ghost" onClick={() => setEdit(p)}>
                        {editable ? 'Modifier' : 'Consulter'}
                      </button>
                      {editable && (
                        <button type="button" className="btn small danger" onClick={() => setConfirmDelete(p)}>
                          Supprimer
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {edit && <ProductEditor product={edit} readOnly={!editable} onClose={() => setEdit(null)} />}

      {confirmDelete && (
        <Confirm
          title="Supprimer ce produit"
          danger
          confirmLabel="Supprimer"
          message={
            <>
              <p style={{ marginTop: 0 }}>
                <b>{confirmDelete.name}</b> sera retiré du référentiel.
              </p>
              <p>
                Ses mouvements de stock restent dans le journal pour ne pas trouer l'historique,
                mais ils n'auront plus de fiche. Si le produit ne doit plus être vendu, préférez le
                passer <b>inactif</b> : l'historique reste lisible.
              </p>
            </>
          }
          onConfirm={() => deleteProduct(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {importReport && (
        <Modal
          title="Import terminé"
          onClose={() => setImportReport(null)}
          footer={
            <button type="button" className="btn primary" onClick={() => setImportReport(null)}>
              Fermer
            </button>
          }
        >
          <p style={{ marginTop: 0 }}>{importReport}</p>
          <NoticeBox>
            Les produits déjà connus (même EAN ou même référence) ont été mis à jour plutôt que
            dupliqués. Vérifiez les taux de TVA importés avant tout export comptable.
          </NoticeBox>
        </Modal>
      )}
    </>
  );
}

// ------------------------------------------------------------------ fiche

function ProductEditor({
  product,
  readOnly,
  onClose,
}: {
  product: Product;
  readOnly: boolean;
  onClose: () => void;
}) {
  const db = useGestion((s) => s.db);
  const saveProduct = useGestion((s) => s.saveProduct);
  const idx = useMemo(() => buildIndex(db), [db]);
  const [draft, setDraft] = useState<Product>(product);

  const rate = vatRateOf(idx, draft.vatRateId);
  const margin = marginOf(draft, rate);
  const stock = statsOf(idx, draft.id).stock;

  const set = <K extends keyof Product>(k: K, v: Product[K]) => setDraft({ ...draft, [k]: v });

  /** Saisir le HT met le TTC a jour, et reciproquement : les deux restent cohérents. */
  const setPriceHT = (v: number) => setDraft({ ...draft, salePriceHT: v, salePriceTTC: euro(ttcFromHT(v, rate)) });
  const setPriceTTC = (v: number) => setDraft({ ...draft, salePriceTTC: v, salePriceHT: euro(htFromTTC(v, rate)) });
  const setMarkRate = (v: number) => {
    const ht = euro(priceFromMarkRate(draft.purchasePrice, v));
    setDraft({ ...draft, salePriceHT: ht, salePriceTTC: euro(ttcFromHT(ht, rate)) });
  };

  const families = db.families.filter((f) => !f.parentId);
  const subFamilies = db.families.filter((f) => f.parentId === draft.familyId);

  const addSupplierLink = () => {
    const first = db.suppliers[0];
    if (!first) return;
    const link: SupplierLink = {
      supplierId: first.id,
      reference: '',
      purchasePrice: draft.purchasePrice,
      discountRate: 0,
      packSize: draft.unitsPerCase || 1,
      primary: draft.suppliers.length === 0,
    };
    set('suppliers', [...draft.suppliers, link]);
  };

  const updateLink = (i: number, patch: Partial<SupplierLink>) => {
    const next = draft.suppliers.map((l, k) => (k === i ? { ...l, ...patch } : l));
    // Un seul fournisseur principal.
    if (patch.primary) next.forEach((l, k) => (l.primary = k === i));
    set('suppliers', next);
  };

  return (
    <Modal
      title={product.name ? `Fiche produit — ${product.name}` : 'Nouveau produit'}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {readOnly ? 'Fermer' : 'Annuler'}
          </button>
          {!readOnly && (
            <button
              type="button"
              className="btn primary"
              disabled={!draft.name.trim()}
              onClick={() => {
                saveProduct(draft);
                onClose();
              }}
            >
              Enregistrer
            </button>
          )}
        </>
      }
    >
      <div className="g-split">
        <div>
          <h3 style={{ fontSize: 12, margin: '0 0 8px', color: 'var(--text-dim)' }}>Identification</h3>
          <Field label="Désignation">
            <TextInput value={draft.name} onChange={(v) => set('name', v)} disabled={readOnly} />
          </Field>
          <div className="g-grid2">
            <Field label="Référence interne">
              <TextInput value={draft.ref} onChange={(v) => set('ref', v)} disabled={readOnly} />
            </Field>
            <Field label="Code-barres (EAN)">
              <TextInput value={draft.ean} onChange={(v) => set('ean', v)} disabled={readOnly} />
            </Field>
            <Field label="Marque">
              <TextInput value={draft.brand} onChange={(v) => set('brand', v)} disabled={readOnly} />
            </Field>
            <Field label="Famille">
              <select
                className="g-select"
                value={draft.familyId ?? ''}
                disabled={readOnly}
                onChange={(e) => setDraft({ ...draft, familyId: e.target.value || null, subFamilyId: null })}
              >
                <option value="">—</option>
                {families.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sous-famille">
              <select
                className="g-select"
                value={draft.subFamilyId ?? ''}
                disabled={readOnly || subFamilies.length === 0}
                onChange={(e) => set('subFamilyId', e.target.value || null)}
              >
                <option value="">—</option>
                {subFamilies.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <h3 style={{ fontSize: 12, margin: '14px 0 8px', color: 'var(--text-dim)' }}>Conditionnement</h3>
          <div className="g-grid2">
            <Field label="Unité d'achat">
              <Select value={draft.purchaseUnit} onChange={(v) => set('purchaseUnit', v)} options={UNITS} disabled={readOnly} />
            </Field>
            <Field label="Unité de vente">
              <Select value={draft.saleUnit} onChange={(v) => set('saleUnit', v)} options={UNITS} disabled={readOnly} />
            </Field>
            <Field label="Conditionnement">
              <TextInput
                value={draft.packaging}
                onChange={(v) => set('packaging', v)}
                placeholder="carton de 24"
                disabled={readOnly}
              />
            </Field>
            <Field label="Unités par carton">
              <NumberInput value={draft.unitsPerCase} onChange={(v) => set('unitsPerCase', v)} min={1} disabled={readOnly} />
            </Field>
          </div>

          <h3 style={{ fontSize: 12, margin: '14px 0 8px', color: 'var(--text-dim)' }}>Stock</h3>
          <div className="g-grid3">
            <Field label="Stock minimum">
              <NumberInput value={draft.stockMin} onChange={(v) => set('stockMin', v)} min={0} disabled={readOnly} />
            </Field>
            <Field label="Stock maximum">
              <NumberInput value={draft.stockMax} onChange={(v) => set('stockMax', v)} min={0} disabled={readOnly} />
            </Field>
            <Field label="Stock de sécurité">
              <NumberInput value={draft.safetyStock} onChange={(v) => set('safetyStock', v)} min={0} disabled={readOnly} />
            </Field>
          </div>
          <div className="g-grid2">
            <Field label="Emplacement en magasin">
              <TextInput value={draft.location} onChange={(v) => set('location', v)} disabled={readOnly} />
            </Field>
            <Field label="Emplacement en réserve">
              <TextInput value={draft.reserveLocation} onChange={(v) => set('reserveLocation', v)} disabled={readOnly} />
            </Field>
          </div>
          <Check
            checked={draft.perishable}
            onChange={(v) => set('perishable', v)}
            label="Produit à DLC / DDM"
            disabled={readOnly}
          />
          <Check
            checked={draft.lotTracked}
            onChange={(v) => set('lotTracked', v)}
            label="Suivre les lots à la réception"
            disabled={readOnly}
          />
          <Check checked={draft.active} onChange={(v) => set('active', v)} label="Produit actif" disabled={readOnly} />
        </div>

        <div>
          <h3 style={{ fontSize: 12, margin: '0 0 8px', color: 'var(--text-dim)' }}>Prix et marge</h3>
          <div className="g-panel" style={{ marginBottom: 10 }}>
            <div className="g-grid2">
              <Field label="Prix d'achat HT">
                <NumberInput
                  value={draft.purchasePrice}
                  onChange={(v) => set('purchasePrice', v)}
                  step="0.01"
                  min={0}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Taux de TVA">
                <select
                  className="g-select"
                  value={draft.vatRateId}
                  disabled={readOnly}
                  onChange={(e) => {
                    const newRate = db.vatRates.find((v) => v.id === e.target.value)?.rate ?? 0;
                    setDraft({
                      ...draft,
                      vatRateId: e.target.value,
                      salePriceTTC: euro(ttcFromHT(draft.salePriceHT, newRate)),
                    });
                  }}
                >
                  <option value="">— à choisir —</option>
                  {db.vatRates
                    .filter((v) => v.active)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label} ({v.rate} %)
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Prix de vente HT">
                <NumberInput value={draft.salePriceHT} onChange={setPriceHT} step="0.01" min={0} disabled={readOnly} />
              </Field>
              <Field label="Prix de vente TTC">
                <NumberInput value={draft.salePriceTTC} onChange={setPriceTTC} step="0.01" min={0} disabled={readOnly} />
              </Field>
              <Field label="Taux de marque visé (%)" help="Saisir un taux recalcule le prix de vente.">
                <NumberInput
                  value={Math.round(margin.markRate * 10) / 10}
                  onChange={setMarkRate}
                  step="0.5"
                  disabled={readOnly}
                />
              </Field>
            </div>
          </div>

          <div className="g-cards" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <div className={`g-card ${margin.marginEuro < 0 ? 'bad' : 'good'}`}>
              <div className="k">Marge unitaire</div>
              <div className="v">{fmtEuro(margin.marginEuro)}</div>
            </div>
            <div className="g-card">
              <div className="k">Taux de marge</div>
              <div className="v">{fmtPct(margin.marginRate)}</div>
              <div className="d">marge / prix d'achat</div>
            </div>
            <div className="g-card">
              <div className="k">Taux de marque</div>
              <div className="v">{fmtPct(margin.markRate)}</div>
              <div className="d">marge / prix de vente</div>
            </div>
            <div className="g-card">
              <div className="k">Coefficient</div>
              <div className="v">{margin.coefficient ? margin.coefficient.toFixed(2) : '—'}</div>
              <div className="d">PV TTC / PA HT</div>
            </div>
            <div className="g-card">
              <div className="k">Stock actuel</div>
              <div className="v">{fmtQty(stock)}</div>
              <div className="d">{fmtEuro(stock * draft.purchasePrice)} au prix d'achat</div>
            </div>
          </div>

          <h3 style={{ fontSize: 12, margin: '16px 0 8px', color: 'var(--text-dim)' }}>Fournisseurs</h3>
          {db.suppliers.length === 0 ? (
            <NoticeBox tone="info">
              Aucun fournisseur enregistré. Créez-en un dans l'écran Fournisseurs pour pouvoir
              commander ce produit.
            </NoticeBox>
          ) : (
            <>
              {draft.suppliers.length === 0 && (
                <p className="g-muted" style={{ fontSize: 11.5, margin: '0 0 8px' }}>
                  Aucun fournisseur rattaché : ce produit ne sera pas proposé au réapprovisionnement.
                </p>
              )}
              {draft.suppliers.map((l, i) => (
                <div key={`${l.supplierId}-${i}`} className="g-panel" style={{ marginBottom: 8 }}>
                  <div className="g-grid2">
                    <Field label="Fournisseur">
                      <select
                        className="g-select"
                        value={l.supplierId}
                        disabled={readOnly}
                        onChange={(e) => updateLink(i, { supplierId: e.target.value })}
                      >
                        {db.suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Référence fournisseur">
                      <TextInput
                        value={l.reference}
                        onChange={(v) => updateLink(i, { reference: v })}
                        disabled={readOnly}
                      />
                    </Field>
                    <Field label="Prix d'achat HT">
                      <NumberInput
                        value={l.purchasePrice}
                        onChange={(v) => updateLink(i, { purchasePrice: v })}
                        step="0.01"
                        disabled={readOnly}
                      />
                    </Field>
                    <Field label="Remise (%)">
                      <NumberInput
                        value={l.discountRate}
                        onChange={(v) => updateLink(i, { discountRate: v })}
                        disabled={readOnly}
                      />
                    </Field>
                    <Field label="Colisage (unités par colis)">
                      <NumberInput
                        value={l.packSize}
                        onChange={(v) => updateLink(i, { packSize: v })}
                        min={1}
                        disabled={readOnly}
                      />
                    </Field>
                  </div>
                  <div className="g-row" style={{ justifyContent: 'space-between' }}>
                    <Check
                      checked={l.primary}
                      onChange={(v) => updateLink(i, { primary: v })}
                      label="Fournisseur principal"
                      disabled={readOnly}
                    />
                    {!readOnly && (
                      <button
                        type="button"
                        className="btn small danger"
                        onClick={() => set('suppliers', draft.suppliers.filter((_, k) => k !== i))}
                      >
                        Retirer
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {!readOnly && (
                <button type="button" className="btn small" onClick={addSupplierLink}>
                  + Ajouter un fournisseur
                </button>
              )}
            </>
          )}

          <Field label="Notes">
            <textarea
              className="g-input"
              value={draft.notes}
              disabled={readOnly}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
