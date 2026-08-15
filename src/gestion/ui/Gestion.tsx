/**
 * Coquille du module de gestion : menu de gauche, en-tete, ecran courant.
 *
 * Le menu n'affiche que des ecrans qui existent : pas de rubrique morte.
 * L'indicateur d'enregistrement en en-tete dit a tout moment si le travail
 * est bien sur le disque.
 */

import { useEffect, useMemo, useState } from 'react';
import { useGestion, type Screen } from '../store';
import { computeAlerts } from '../alerts';
import { buildIndex } from '../calc';
import { useIsMobile } from '../../ui/useMediaQuery';
import Dashboard from './Dashboard';
import Produits from './Produits';
import Stocks from './Stocks';
import Parametres from './Parametres';
import '../gestion.css';

interface Entry {
  id: Screen;
  label: string;
  icon: string;
  title: string;
  subtitle: string;
}

const ENTRIES: Entry[] = [
  {
    id: 'tableau',
    label: 'Tableau de bord',
    icon: '◧',
    title: 'Tableau de bord',
    subtitle: "L'essentiel de la journée et du mois en cours",
  },
  {
    id: 'produits',
    label: 'Produits',
    icon: '▤',
    title: 'Fiches produits',
    subtitle: 'Référentiel, prix, marges et conditionnements',
  },
  {
    id: 'stocks',
    label: 'Stocks',
    icon: '▦',
    title: 'Stocks',
    subtitle: 'État courant et journal des mouvements',
  },
  {
    id: 'parametres',
    label: 'Paramètres',
    icon: '⚙',
    title: 'Paramètres',
    subtitle: 'Société, TVA, seuils, utilisateurs et sauvegardes',
  },
];

export default function Gestion() {
  const screen = useGestion((s) => s.screen);
  const setScreen = useGestion((s) => s.setScreen);
  const db = useGestion((s) => s.db);
  const savedAt = useGestion((s) => s.savedAt);
  const notices = useGestion((s) => s.notices);
  const dismissNotice = useGestion((s) => s.dismissNotice);
  const currentUser = useGestion((s) => s.currentUser);

  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);

  const alerts = useMemo(() => computeAlerts(db, buildIndex(db)), [db]);
  const critical = alerts.filter((a) => a.level === 'critique').length;
  const warnings = alerts.filter((a) => a.level === 'attention').length;

  // Choisir un ecran referme le tiroir : sur telephone, il couvre la page.
  useEffect(() => {
    setMenuOpen(false);
  }, [screen]);

  const entry = ENTRIES.find((e) => e.id === screen) ?? ENTRIES[0];
  const user = currentUser();

  return (
    <div className={`gestion ${menuOpen ? 'menu-open' : ''}`}>
      <nav className="g-menu">
        <div className="g-menu-title">Gestion</div>
        {ENTRIES.map((e) => (
          <button
            key={e.id}
            type="button"
            className={screen === e.id ? 'active' : ''}
            onClick={() => setScreen(e.id)}
          >
            <span className="g-ico">{e.icon}</span>
            {e.label}
            {e.id === 'tableau' && critical > 0 && <span className="g-badge">{critical}</span>}
            {e.id === 'tableau' && critical === 0 && warnings > 0 && (
              <span className="g-badge soft">{warnings}</span>
            )}
          </button>
        ))}
        <div className="g-menu-title" style={{ marginTop: 'auto' }}>
          Utilisateur
        </div>
        <div style={{ padding: '0 14px 4px', fontSize: 12 }}>
          <div style={{ fontWeight: 600 }}>{user?.name ?? '—'}</div>
          <div className="g-muted" style={{ fontSize: 10.5 }}>
            {user ? { gerant: 'Gérant', employe: 'Employé', comptable: 'Comptabilité' }[user.role] : ''}
          </div>
        </div>
      </nav>

      <div className="g-main">
        <header className="g-head">
          {isMobile && (
            <button type="button" className="btn icon" onClick={() => setMenuOpen((v) => !v)} title="Menu">
              ☰
            </button>
          )}
          <div>
            <h1>{entry.title}</h1>
            <div className="sub">{entry.subtitle}</div>
          </div>
          <div style={{ flex: 1 }} />
          <span className={`g-saved ${db.settings.autoSave ? '' : 'off'}`}>
            <span className="dot" />
            {db.settings.autoSave
              ? savedAt
                ? `enregistré à ${new Date(savedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                : 'enregistrement automatique'
              : 'enregistrement automatique désactivé'}
          </span>
        </header>

        {/* On se cale sur `entry` et non sur `screen` : une alerte qui vise un
            écran encore à construire retombe sur le tableau de bord plutôt que
            sur une page blanche. */}
        <div className="g-body">
          {entry.id === 'tableau' && <Dashboard />}
          {entry.id === 'produits' && <Produits />}
          {entry.id === 'stocks' && <Stocks />}
          {entry.id === 'parametres' && <Parametres />}
        </div>
      </div>

      {isMobile && menuOpen && <div className="drawer-backdrop" onClick={() => setMenuOpen(false)} />}

      <div className="notices">
        {notices.map((n) => (
          <div key={n.id} className={`notice ${n.type}`} onClick={() => dismissNotice(n.id)}>
            {n.text}
          </div>
        ))}
      </div>
    </div>
  );
}
