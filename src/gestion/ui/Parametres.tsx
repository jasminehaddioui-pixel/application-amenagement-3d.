/**
 * Parametres : societe, TVA, seuils d'alerte, utilisateurs, sauvegarde.
 *
 * L'onglet « Sauvegarde » porte les options demandees : sauvegarde en fichier,
 * restauration, sauvegardes de securite automatiques et remise a zero par
 * perimetre. Rien n'y est irreversible sans confirmation explicite.
 */

import { useRef, useState } from 'react';
import { useGestion } from '../store';
import { RESET_SCOPES, newId, type ResetScope } from '../db';
import { fmtDateTime } from '../calc';
import type { Company, GestionSettings, Role, User, VatRate } from '../types';
import { ROLE_LABEL } from '../types';
import { Card, Check, Confirm, Field, Modal, NoticeBox, NumberInput, Section, Select, TextInput } from './common';

type Tab = 'societe' | 'tva' | 'seuils' | 'utilisateurs' | 'sauvegarde';

const TABS: Array<[Tab, string]> = [
  ['societe', 'Société'],
  ['tva', 'Taux de TVA'],
  ['seuils', "Seuils d'alerte"],
  ['utilisateurs', 'Utilisateurs'],
  ['sauvegarde', 'Sauvegarde & remise à zéro'],
];

export default function Parametres() {
  const [tab, setTab] = useState<Tab>('societe');

  return (
    <>
      <div className="g-toolbar">
        <div className="seg">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'societe' && <Societe />}
      {tab === 'tva' && <TauxTVA />}
      {tab === 'seuils' && <Seuils />}
      {tab === 'utilisateurs' && <Utilisateurs />}
      {tab === 'sauvegarde' && <Sauvegarde />}
    </>
  );
}

// ------------------------------------------------------------------ societe

function Societe() {
  const company = useGestion((s) => s.db.company);
  const saveCompany = useGestion((s) => s.saveCompany);
  const [draft, setDraft] = useState<Company>(company);
  const dirty = JSON.stringify(draft) !== JSON.stringify(company);

  const set = <K extends keyof Company>(k: K, v: Company[K]) => setDraft({ ...draft, [k]: v });

  return (
    <>
      <Section title="Identification">
        <div className="g-panel">
          <div className="g-grid2">
            <Field label="Raison sociale">
              <TextInput value={draft.name} onChange={(v) => set('name', v)} />
            </Field>
            <Field label="Forme juridique">
              <TextInput value={draft.legalForm} onChange={(v) => set('legalForm', v)} placeholder="SARL" />
            </Field>
            <Field label="SIREN">
              <TextInput value={draft.siren} onChange={(v) => set('siren', v)} />
            </Field>
            <Field label="SIRET">
              <TextInput value={draft.siret} onChange={(v) => set('siret', v)} />
            </Field>
            <Field label="N° TVA intracommunautaire">
              <TextInput value={draft.vatNumber} onChange={(v) => set('vatNumber', v)} />
            </Field>
            <Field label="Code APE / NAF">
              <TextInput value={draft.ape} onChange={(v) => set('ape', v)} />
            </Field>
            <Field label="Capital social">
              <TextInput value={draft.capital} onChange={(v) => set('capital', v)} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Coordonnées">
        <div className="g-panel">
          <Field label="Adresse">
            <TextInput value={draft.address} onChange={(v) => set('address', v)} />
          </Field>
          <div className="g-grid3">
            <Field label="Code postal">
              <TextInput value={draft.postalCode} onChange={(v) => set('postalCode', v)} />
            </Field>
            <Field label="Ville">
              <TextInput value={draft.city} onChange={(v) => set('city', v)} />
            </Field>
            <Field label="Téléphone">
              <TextInput value={draft.phone} onChange={(v) => set('phone', v)} />
            </Field>
            <Field label="Courriel">
              <TextInput value={draft.email} onChange={(v) => set('email', v)} type="email" />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Régime et exercice">
        <NoticeBox title="À faire valider par votre expert-comptable">
          Ces champs sont libres et purement déclaratifs : l'application ne déduit aucune règle
          fiscale de ce que vous saisissez ici. Ils servent à identifier la société sur les
          documents et les exports.
        </NoticeBox>
        <div className="g-panel" style={{ marginTop: 10 }}>
          <div className="g-grid2">
            <Field label="Régime fiscal">
              <TextInput value={draft.taxRegime} onChange={(v) => set('taxRegime', v)} />
            </Field>
            <Field label="Régime de TVA">
              <TextInput value={draft.vatRegime} onChange={(v) => set('vatRegime', v)} />
            </Field>
            <Field label="Périodicité de la déclaration de TVA">
              <Select
                value={draft.vatPeriodicity}
                onChange={(v) => set('vatPeriodicity', v)}
                options={[
                  { value: 'mensuelle', label: 'Mensuelle' },
                  { value: 'trimestrielle', label: 'Trimestrielle' },
                  { value: 'annuelle', label: 'Annuelle' },
                  { value: 'autre', label: 'Autre' },
                ]}
              />
            </Field>
            <Field label="Début d'exercice (JJ/MM)">
              <TextInput value={draft.fiscalYearStart} onChange={(v) => set('fiscalYearStart', v)} placeholder="01/01" />
            </Field>
            <Field label="Fin d'exercice (JJ/MM)">
              <TextInput value={draft.fiscalYearEnd} onChange={(v) => set('fiscalYearEnd', v)} placeholder="31/12" />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Expert-comptable">
        <div className="g-panel">
          <div className="g-grid2">
            <Field label="Nom du contact">
              <TextInput value={draft.accountantName} onChange={(v) => set('accountantName', v)} />
            </Field>
            <Field label="Cabinet">
              <TextInput value={draft.accountantFirm} onChange={(v) => set('accountantFirm', v)} />
            </Field>
            <Field label="Courriel">
              <TextInput value={draft.accountantEmail} onChange={(v) => set('accountantEmail', v)} type="email" />
            </Field>
            <Field label="Téléphone">
              <TextInput value={draft.accountantPhone} onChange={(v) => set('accountantPhone', v)} />
            </Field>
          </div>
        </div>
      </Section>

      <div className="g-row end">
        <button type="button" className="btn" disabled={!dirty} onClick={() => setDraft(company)}>
          Annuler les modifications
        </button>
        <button type="button" className="btn primary" disabled={!dirty} onClick={() => saveCompany(draft)}>
          Enregistrer
        </button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ TVA

function TauxTVA() {
  const rates = useGestion((s) => s.db.vatRates);
  const products = useGestion((s) => s.db.products);
  const saveVatRate = useGestion((s) => s.saveVatRate);
  const deleteVatRate = useGestion((s) => s.deleteVatRate);
  const [edit, setEdit] = useState<VatRate | null>(null);

  return (
    <>
      <NoticeBox title="Les taux ne sont jamais figés dans le logiciel">
        Ils sont modifiables ici, et c'est volontaire : le rattachement d'un produit à un taux
        dépend de la réglementation et de votre situation. Faites valider cette table par votre
        expert-comptable avant tout export de TVA.
      </NoticeBox>

      <div className="g-toolbar" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => setEdit({ id: newId('tva'), label: '', rate: 0, active: true, note: '' })}
        >
          + Ajouter un taux
        </button>
      </div>

      <div className="g-table-wrap">
        <table className="g-table">
          <thead>
            <tr>
              <th>Libellé</th>
              <th className="g-num">Taux</th>
              <th className="g-num">Produits</th>
              <th>Compte collecté</th>
              <th>Compte déductible</th>
              <th>État</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => {
              const used = products.filter((p) => p.vatRateId === r.id).length;
              return (
                <tr key={r.id}>
                  <td className="g-strong">{r.label || '—'}</td>
                  <td className="g-num">{r.rate} %</td>
                  <td className="g-num">{used}</td>
                  <td className="g-muted">{r.accountCollected || '—'}</td>
                  <td className="g-muted">{r.accountDeductible || '—'}</td>
                  <td>
                    <span className={`g-tag ${r.active ? 'ok' : ''}`}>{r.active ? 'Actif' : 'Inactif'}</span>
                  </td>
                  <td className="g-num">
                    <button type="button" className="btn small ghost" onClick={() => setEdit(r)}>
                      Modifier
                    </button>
                    <button type="button" className="btn small danger" onClick={() => deleteVatRate(r.id)}>
                      Supprimer
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {edit && (
        <VatEditor
          rate={edit}
          onClose={() => setEdit(null)}
          onSave={(v) => {
            saveVatRate(v);
            setEdit(null);
          }}
        />
      )}
    </>
  );
}

function VatEditor({
  rate,
  onSave,
  onClose,
}: {
  rate: VatRate;
  onSave: (v: VatRate) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(rate);
  return (
    <Modal
      title="Taux de TVA"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn primary" disabled={!draft.label.trim()} onClick={() => onSave(draft)}>
            Enregistrer
          </button>
        </>
      }
    >
      <Field label="Libellé">
        <TextInput value={draft.label} onChange={(v) => setDraft({ ...draft, label: v })} />
      </Field>
      <Field label="Taux (%)">
        <NumberInput value={draft.rate} onChange={(v) => setDraft({ ...draft, rate: v })} step="0.1" min={0} />
      </Field>
      <div className="g-grid2">
        <Field label="Compte TVA collectée" help="Communiqué par l'expert-comptable.">
          <TextInput
            value={draft.accountCollected ?? ''}
            onChange={(v) => setDraft({ ...draft, accountCollected: v })}
          />
        </Field>
        <Field label="Compte TVA déductible" help="Communiqué par l'expert-comptable.">
          <TextInput
            value={draft.accountDeductible ?? ''}
            onChange={(v) => setDraft({ ...draft, accountDeductible: v })}
          />
        </Field>
      </div>
      <Field label="Note">
        <TextInput value={draft.note ?? ''} onChange={(v) => setDraft({ ...draft, note: v })} />
      </Field>
      <Check checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} label="Taux actif" />
    </Modal>
  );
}

// ------------------------------------------------------------------ seuils

function Seuils() {
  const settings = useGestion((s) => s.db.settings);
  const saveSettings = useGestion((s) => s.saveSettings);
  const [draft, setDraft] = useState<GestionSettings>(settings);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const alert = <K extends keyof GestionSettings['alerts']>(k: K, v: number) =>
    setDraft({ ...draft, alerts: { ...draft.alerts, [k]: v } });

  return (
    <>
      <Section title="Déclenchement des alertes">
        <div className="g-panel">
          <div className="g-grid2">
            <Field label="Rupture imminente (jours de couverture)" help="🔴 en dessous de ce nombre de jours de vente restants.">
              <NumberInput value={draft.alerts.ruptureDays} onChange={(v) => alert('ruptureDays', v)} min={0} />
            </Field>
            <Field label="Marge minimale acceptable (%)" help="🔴 en dessous de ce taux de marge.">
              <NumberInput value={draft.alerts.minMarginRate} onChange={(v) => alert('minMarginRate', v)} min={0} />
            </Field>
            <Field label="Hausse de prix d'achat signalée (%)" help="🔴 dès que le fournisseur augmente de ce pourcentage.">
              <NumberInput value={draft.alerts.priceIncreaseRate} onChange={(v) => alert('priceIncreaseRate', v)} min={0} />
            </Field>
            <Field label="Produit dormant (jours sans vente)" help="🟠 pour les références qui immobilisent du stock.">
              <NumberInput value={draft.alerts.noSaleDays} onChange={(v) => alert('noSaleDays', v)} min={0} />
            </Field>
            <Field label="Alerte DLC (jours avant expiration)" help="🔴 pour les lots à retirer ou à démarquer.">
              <NumberInput value={draft.alerts.dlcWarningDays} onChange={(v) => alert('dlcWarningDays', v)} min={0} />
            </Field>
            <Field label="Écart d'inventaire important (%)" help="🔴 au-delà de ce pourcentage de la valeur inventoriée.">
              <NumberInput value={draft.alerts.inventoryGapRate} onChange={(v) => alert('inventoryGapRate', v)} min={0} />
            </Field>
            <Field label="Intervalle entre inventaires (jours)">
              <NumberInput value={draft.alerts.inventoryIntervalDays} onChange={(v) => alert('inventoryIntervalDays', v)} min={0} />
            </Field>
            <Field label="Écart facture / réception toléré (€)" help="🔴 au-delà de cet écart en euros.">
              <NumberInput value={draft.alerts.invoiceGapAmount} onChange={(v) => alert('invoiceGapAmount', v)} min={0} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Prévision des commandes">
        <div className="g-panel">
          <div className="g-grid2">
            <Field
              label="Fenêtre d'historique (jours)"
              help="Période de ventes servant à calculer la vente moyenne quotidienne."
            >
              <NumberInput
                value={draft.forecastWindowDays}
                onChange={(v) => setDraft({ ...draft, forecastWindowDays: v })}
                min={1}
              />
            </Field>
            <Field
              label="Coefficient de saisonnalité"
              help="1 = neutre. 1,3 majore les quantités de 30 % (période forte)."
            >
              <NumberInput
                value={draft.seasonalityFactor}
                onChange={(v) => setDraft({ ...draft, seasonalityFactor: v })}
                step="0.05"
                min={0}
              />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Caisse">
        <div className="g-panel">
          <Field label="Fond de caisse (€)">
            <NumberInput value={draft.cashFloat} onChange={(v) => setDraft({ ...draft, cashFloat: v })} min={0} />
          </Field>
        </div>
      </Section>

      <div className="g-row end">
        <button type="button" className="btn" disabled={!dirty} onClick={() => setDraft(settings)}>
          Annuler
        </button>
        <button type="button" className="btn primary" disabled={!dirty} onClick={() => saveSettings(draft)}>
          Enregistrer
        </button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ utilisateurs

function Utilisateurs() {
  const db = useGestion((s) => s.db);
  const saveUser = useGestion((s) => s.saveUser);
  const deleteUser = useGestion((s) => s.deleteUser);
  const setCurrentUser = useGestion((s) => s.setCurrentUser);
  const [edit, setEdit] = useState<User | null>(null);

  return (
    <>
      <NoticeBox tone="info" title="Profils et traçabilité">
        Le profil détermine ce que chacun peut faire. Chaque écriture porte le nom de l'utilisateur
        actif au moment de la saisie, et reste consultable dans le journal d'audit.
      </NoticeBox>

      <div className="g-toolbar" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => setEdit({ id: newId('usr'), name: '', role: 'employe', active: true })}
        >
          + Ajouter un utilisateur
        </button>
      </div>

      <div className="g-table-wrap">
        <table className="g-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Profil</th>
              <th>État</th>
              <th>Session</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {db.users.map((u) => (
              <tr key={u.id} className={u.id === db.currentUserId ? 'selected' : ''}>
                <td className="g-strong">{u.name || '—'}</td>
                <td>{ROLE_LABEL[u.role]}</td>
                <td>
                  <span className={`g-tag ${u.active ? 'ok' : ''}`}>{u.active ? 'Actif' : 'Inactif'}</span>
                </td>
                <td>
                  {u.id === db.currentUserId ? (
                    <span className="g-tag info">Utilisateur courant</span>
                  ) : (
                    <button type="button" className="btn small" onClick={() => setCurrentUser(u.id)}>
                      Basculer
                    </button>
                  )}
                </td>
                <td className="g-num">
                  <button type="button" className="btn small ghost" onClick={() => setEdit(u)}>
                    Modifier
                  </button>
                  <button type="button" className="btn small danger" onClick={() => deleteUser(u.id)}>
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal
          title="Utilisateur"
          onClose={() => setEdit(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setEdit(null)}>
                Annuler
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!edit.name.trim()}
                onClick={() => {
                  saveUser(edit);
                  setEdit(null);
                }}
              >
                Enregistrer
              </button>
            </>
          }
        >
          <Field label="Nom">
            <TextInput value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} />
          </Field>
          <Field label="Profil">
            <Select
              value={edit.role}
              onChange={(v) => setEdit({ ...edit, role: v as Role })}
              options={(Object.keys(ROLE_LABEL) as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
            />
          </Field>
          <Check checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Compte actif" />
        </Modal>
      )}

      <Section title="Journal d'audit">
        <NoticeBox tone="info">
          Ce journal n'est pas modifiable depuis l'application : il enregistre qui a fait quoi,
          quand, et sur quoi. {db.audit.length} écriture(s) conservée(s).
        </NoticeBox>
        <div className="g-table-wrap" style={{ marginTop: 10, maxHeight: 380, overflowY: 'auto' }}>
          <table className="g-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Utilisateur</th>
                <th>Domaine</th>
                <th>Action</th>
                <th>Cible</th>
              </tr>
            </thead>
            <tbody>
              {[...db.audit]
                .reverse()
                .slice(0, 200)
                .map((a) => (
                  <tr key={a.id}>
                    <td className="g-muted">{fmtDateTime(a.date)}</td>
                    <td>{db.users.find((u) => u.id === a.userId)?.name ?? '—'}</td>
                    <td>{a.scope}</td>
                    <td className="g-wrap">{a.action}</td>
                    <td className="g-muted g-wrap">{a.targetLabel || '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ sauvegarde

function Sauvegarde() {
  const db = useGestion((s) => s.db);
  const savedAt = useGestion((s) => s.savedAt);
  const saveSettings = useGestion((s) => s.saveSettings);
  const exportBackupFile = useGestion((s) => s.exportBackupFile);
  const importBackupFile = useGestion((s) => s.importBackupFile);
  const backups = useGestion((s) => s.backups);
  const restoreBackup = useGestion((s) => s.restoreBackup);
  const reset = useGestion((s) => s.reset);
  const notify = useGestion((s) => s.notify);

  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState<ResetScope | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<number | null>(null);
  const list = backups();

  const counts: Array<[string, number]> = [
    ['Produits', db.products.length],
    ['Fournisseurs', db.suppliers.length],
    ['Mouvements de stock', db.movements.length],
    ['Commandes', db.orders.length],
    ['Réceptions', db.receptions.length],
    ['Tickets de caisse', db.sales.length],
    ['Inventaires', db.inventories.length],
    ['Pertes', db.losses.length],
    ['Factures', db.invoices.length],
    ["Écritures d'audit", db.audit.length],
  ];

  return (
    <>
      <Section title="Enregistrement">
        <div className="g-panel">
          <div className="g-row wrap" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <span className={`g-saved ${db.settings.autoSave ? '' : 'off'}`}>
              <span className="dot" />
              {db.settings.autoSave
                ? savedAt
                  ? `Tout est enregistré — dernière écriture à ${new Date(savedAt).toLocaleTimeString('fr-FR')}`
                  : 'Enregistrement automatique actif'
                : 'Enregistrement automatique désactivé'}
            </span>
          </div>
          <Check
            checked={db.settings.autoSave}
            onChange={(v) => saveSettings({ ...db.settings, autoSave: v })}
            label="Enregistrer immédiatement à chaque modification (recommandé)"
          />
          <p className="g-muted" style={{ fontSize: 11.5, lineHeight: 1.6, margin: '2px 0 12px' }}>
            Quand cette option est active, chaque ajout ou correction est écrit sur le poste dès la
            validation. Fermer l'onglet, recharger la page ou éteindre l'ordinateur ne perd rien, et
            un second onglet ouvert se met à jour tout seul.
          </p>
          <Field
            label="Nombre de sauvegardes de sécurité conservées"
            help="À chaque écriture, l'état précédent est empilé. Une fausse manœuvre se rattrape sans fichier."
          >
            <NumberInput
              value={db.settings.backupCount}
              onChange={(v) => saveSettings({ ...db.settings, backupCount: Math.max(0, Math.min(20, v)) })}
              min={0}
            />
          </Field>
        </div>
      </Section>

      <Section title="Contenu de la base">
        <div className="g-cards">
          {counts.map(([k, v]) => (
            <Card key={k} k={k} v={v} />
          ))}
        </div>
      </Section>

      <Section title="Sauvegarde en fichier">
        <div className="g-panel">
          <p className="g-muted" style={{ fontSize: 12, lineHeight: 1.6, marginTop: 0 }}>
            Un fichier unique contient toute la base : référentiel, mouvements, achats, ventes,
            inventaires et paramètres. Conservez-le en dehors de l'ordinateur du magasin.
          </p>
          <div className="g-row wrap">
            <button type="button" className="btn primary" onClick={exportBackupFile}>
              Télécharger une sauvegarde
            </button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              Restaurer depuis un fichier
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  await importBackupFile(file);
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Fichier illisible.', 'error');
                }
              }}
            />
          </div>
        </div>
      </Section>

      <Section title="Sauvegardes de sécurité automatiques">
        {list.length === 0 ? (
          <div className="g-empty">
            <span className="big">🛟</span>
            <div style={{ fontWeight: 600, color: 'var(--text-dim)' }}>Aucune sauvegarde pour l'instant</div>
            <p>Elles apparaîtront dès votre prochaine modification.</p>
          </div>
        ) : (
          <div className="g-table-wrap">
            <table className="g-table">
              <thead>
                <tr>
                  <th>Enregistrée le</th>
                  <th className="g-num">Taille</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id}>
                    <td>{b.label}</td>
                    <td className="g-num g-muted">{Math.round(b.size / 1024)} Ko</td>
                    <td className="g-num">
                      <button type="button" className="btn small" onClick={() => setConfirmRestore(b.id)}>
                        Restaurer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Remise à zéro">
        <NoticeBox tone="danger" title="Ces actions effacent des données">
          Chaque périmètre est indépendant : vous pouvez repartir à zéro sur un domaine sans toucher
          au reste. Une sauvegarde de sécurité est prise juste avant, et l'opération est inscrite au
          journal d'audit. Faites tout de même une sauvegarde en fichier avant.
        </NoticeBox>
        <div className="g-table-wrap" style={{ marginTop: 10 }}>
          <table className="g-table">
            <thead>
              <tr>
                <th>Périmètre</th>
                <th className="g-wrap">Effet</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {RESET_SCOPES.map((s) => (
                <tr key={s.id}>
                  <td className="g-strong">{s.label}</td>
                  <td className="g-wrap g-muted">{s.detail}</td>
                  <td className="g-num">
                    <button
                      type="button"
                      className={s.id === 'tout' ? 'btn small danger' : 'btn small'}
                      onClick={() => setConfirmReset(s.id)}
                    >
                      Remettre à zéro
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {confirmReset && (
        <Confirm
          title={`Remise à zéro — ${RESET_SCOPES.find((s) => s.id === confirmReset)?.label}`}
          danger
          confirmLabel="Remettre à zéro"
          confirmWord={confirmReset === 'tout' ? 'EFFACER' : undefined}
          message={
            <>
              <p style={{ marginTop: 0 }}>{RESET_SCOPES.find((s) => s.id === confirmReset)?.detail}</p>
              <p>
                Cette action est <b>irréversible</b> une fois les sauvegardes de sécurité écrasées.
                Une sauvegarde est prise automatiquement juste avant l'opération.
              </p>
            </>
          }
          onConfirm={() => reset(confirmReset)}
          onCancel={() => setConfirmReset(null)}
        />
      )}

      {confirmRestore !== null && (
        <Confirm
          title="Restaurer cette sauvegarde"
          danger
          confirmLabel="Restaurer"
          message="L'état actuel sera remplacé par celui de la sauvegarde sélectionnée. L'état actuel est lui-même sauvegardé avant le remplacement."
          onConfirm={() => restoreBackup(confirmRestore)}
          onCancel={() => setConfirmRestore(null)}
        />
      )}
    </>
  );
}
