/**
 * Tableau de bord : ce que le gerant doit voir en ouvrant le magasin.
 * Tout est calcule a la volee depuis les mouvements et les tickets.
 */

import { useMemo } from 'react';
import { useGestion, type Screen } from '../store';
import { computeAlerts, checkData } from '../alerts';
import {
  accountingSummary,
  buildIndex,
  coverageDays,
  evolution,
  fmtEuro,
  fmtPct,
  fmtQty,
  lossReport,
  periodOf,
  purchaseReport,
  salesReport,
  statsOf,
  valuation,
} from '../calc';
import { Card, Empty, Section } from './common';

export default function Dashboard() {
  const db = useGestion((s) => s.db);
  const setScreen = useGestion((s) => s.setScreen);

  const data = useMemo(() => {
    const idx = buildIndex(db);
    const today = periodOf('jour');
    const month = periodOf('mois');
    const prevMonth = periodOf('mois_precedent');

    const salesToday = salesReport(db, idx, today);
    const salesMonth = salesReport(db, idx, month);
    const salesPrev = salesReport(db, idx, prevMonth);
    const purchasesMonth = purchaseReport(db, idx, month);
    const lossesToday = lossReport(db, idx, today, salesToday.revenueHT);
    const lossesMonth = lossReport(db, idx, month, salesMonth.revenueHT);
    const stock = valuation(db, idx);
    const account = accountingSummary(db, idx, month);
    const alerts = computeAlerts(db, idx);
    const issues = checkData(db, idx);

    // Reapprovisionnement : ce qui n'a plus de couverture et rien en commande.
    const toOrder = db.products.filter((p) => {
      if (!p.active) return false;
      const s = statsOf(idx, p.id);
      if (s.onOrder > 0) return false;
      const cover = coverageDays(idx, p.id, db.settings.forecastWindowDays);
      return (
        s.stock <= 0 ||
        (cover !== null && cover <= db.settings.alerts.ruptureDays) ||
        (p.stockMin > 0 && s.stock <= p.stockMin)
      );
    });

    const todayISO = new Date().toISOString().slice(0, 10);
    const incoming = db.orders.filter(
      (o) => (o.status === 'envoyee' || o.status === 'partielle') && o.expectedAt && o.expectedAt <= todayISO,
    );

    return {
      idx,
      month,
      salesToday,
      salesMonth,
      salesPrev,
      purchasesMonth,
      lossesToday,
      lossesMonth,
      stock,
      account,
      alerts,
      issues,
      toOrder,
      incoming,
    };
  }, [db]);

  const go = (screen: Screen, id?: string) => setScreen(screen, id ?? null);

  const revenueDelta = evolution(data.salesMonth.revenueHT, data.salesPrev.revenueHT);
  const marginDelta = evolution(data.salesMonth.marginHT, data.salesPrev.marginHT);

  const empty =
    db.products.length === 0 && db.sales.length === 0 && db.receptions.length === 0;

  return (
    <>
      {empty && (
        <Section title="Premiers pas">
          <Empty icon="🛒" title="Votre base est vide">
            Créez vos fournisseurs, puis vos produits — ou importez un fichier depuis l'écran
            Produits. Dès la première réception, le stock, les marges et la TVA se calculent tout
            seuls.
          </Empty>
        </Section>
      )}

      <Section title="Aujourd'hui">
        <div className="g-cards">
          <Card k="Chiffre d'affaires TTC" v={fmtEuro(data.salesToday.revenueTTC)} d={`${fmtEuro(data.salesToday.revenueHT)} HT`} />
          <Card k="Tickets" v={data.salesToday.tickets} d={`Panier moyen ${fmtEuro(data.salesToday.averageBasket)}`} />
          <Card
            k="Marge brute estimée"
            v={fmtEuro(data.salesToday.marginHT)}
            d={`Taux de marque ${fmtPct(data.salesToday.markRate)}`}
            tone={data.salesToday.marginHT > 0 ? 'good' : undefined}
          />
          <Card k="Articles vendus" v={fmtQty(data.salesToday.units)} />
          <Card
            k="Ruptures"
            v={data.stock.ruptures}
            d="références à zéro"
            tone={data.stock.ruptures > 0 ? 'bad' : 'good'}
          />
          <Card
            k="À commander"
            v={data.toOrder.length}
            d="références sous le seuil"
            tone={data.toOrder.length > 0 ? 'warn' : 'good'}
          />
          <Card
            k="Livraisons attendues"
            v={data.incoming.length}
            d={data.incoming.length ? 'commandes à réceptionner' : 'rien de prévu'}
            tone={data.incoming.length > 0 ? 'accent' : undefined}
          />
          <Card
            k="Pertes du jour"
            v={fmtEuro(data.lossesToday.totalHT)}
            d={`${fmtQty(data.lossesToday.units)} article(s)`}
            tone={data.lossesToday.totalHT > 0 ? 'bad' : undefined}
          />
        </div>
      </Section>

      <Section title={`Ce mois — ${data.month.label}`}>
        <div className="g-cards">
          <Card
            k="Chiffre d'affaires HT"
            v={fmtEuro(data.salesMonth.revenueHT)}
            d={
              revenueDelta === null ? (
                'pas de référence le mois dernier'
              ) : (
                <span className={`g-delta ${revenueDelta >= 0 ? 'up' : 'down'}`}>
                  {revenueDelta >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(revenueDelta))} vs mois précédent
                </span>
              )
            }
          />
          <Card
            k="Marge brute"
            v={fmtEuro(data.salesMonth.marginHT)}
            d={
              marginDelta === null ? (
                `Taux de marque ${fmtPct(data.salesMonth.markRate)}`
              ) : (
                <span className={`g-delta ${marginDelta >= 0 ? 'up' : 'down'}`}>
                  {marginDelta >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(marginDelta))} vs mois précédent
                </span>
              )
            }
            tone="good"
          />
          <Card k="Taux de marge" v={fmtPct(data.salesMonth.marginRate)} d={`Marque ${fmtPct(data.salesMonth.markRate)}`} />
          <Card k="Achats HT" v={fmtEuro(data.purchasesMonth.totalHT)} d={`${data.purchasesMonth.receptions} réception(s)`} />
          <Card
            k="Valeur du stock"
            v={fmtEuro(data.stock.valueHT)}
            d={`${data.stock.references} réf. · ${fmtQty(data.stock.units)} unités`}
          />
          <Card
            k="Démarque"
            v={fmtEuro(data.lossesMonth.totalHT)}
            d={`Taux ${fmtPct(data.lossesMonth.rate)} du CA`}
            tone={data.lossesMonth.rate > 2 ? 'bad' : undefined}
          />
          <Card
            k="TVA de la période"
            v={fmtEuro(data.account.vatBalance)}
            d={`Collectée ${fmtEuro(data.account.vatCollected)} · déductible ${fmtEuro(data.account.vatDeductible)}`}
          />
          <Card
            k="Variation de stock"
            v={fmtEuro(data.account.stockVariationHT)}
            d="fin de période moins début"
            tone={data.account.stockVariationHT >= 0 ? undefined : 'warn'}
          />
        </div>
      </Section>

      <Section title={`Alertes${data.alerts.length ? ` (${data.alerts.length})` : ''}`}>
        {data.alerts.length === 0 ? (
          <Empty icon="✓" title="Aucune alerte">
            Les seuils sont respectés. Vous pouvez les régler dans Paramètres.
          </Empty>
        ) : (
          <div className="g-alerts">
            {data.alerts.slice(0, 14).map((a) => (
              <button
                key={a.id}
                type="button"
                className={`g-alert ${a.level}`}
                onClick={() => a.target && go(a.target.screen as Screen, a.target.id)}
              >
                <span className="dot">
                  {a.level === 'critique' ? '🔴' : a.level === 'attention' ? '🟠' : '🟡'}
                </span>
                <span>
                  <span className="t">{a.title}</span>
                  <span className="d">{a.detail}</span>
                </span>
              </button>
            ))}
            {data.alerts.length > 14 && (
              <div className="g-muted" style={{ fontSize: 11.5, padding: '4px 2px' }}>
                et {data.alerts.length - 14} autre(s) alerte(s).
              </div>
            )}
          </div>
        )}
      </Section>

      {data.issues.length > 0 && (
        <Section title={`Contrôle des données (${data.issues.length})`}>
          <div className="g-alerts">
            {data.issues.slice(0, 8).map((i) => (
              <button
                key={i.id}
                type="button"
                className={`g-alert ${i.severity === 'bloquant' ? 'critique' : i.severity === 'a_corriger' ? 'attention' : 'info'}`}
                onClick={() => i.target && go(i.target.screen as Screen, i.target.id)}
              >
                <span className="dot">{i.severity === 'bloquant' ? '⛔' : '⚠️'}</span>
                <span>
                  <span className="t">{i.label}</span>
                  <span className="d">{i.detail}</span>
                </span>
              </button>
            ))}
            {data.issues.length > 8 && (
              <div className="g-muted" style={{ fontSize: 11.5, padding: '4px 2px' }}>
                et {data.issues.length - 8} autre(s) point(s) à corriger.
              </div>
            )}
          </div>
        </Section>
      )}
    </>
  );
}
