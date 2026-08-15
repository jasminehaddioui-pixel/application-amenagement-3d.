import { useEffect, useRef, useState } from 'react';
import { referenceWasRefreshed, useEditor, type ViewMode } from './state/store';
import Toolbar from './ui/Toolbar';
import LeftPanel from './ui/LeftPanel';
import PropertiesPanel from './ui/PropertiesPanel';
import ProjectsDialog from './ui/ProjectsDialog';
import ScaleDialog from './ui/ScaleDialog';
import AutoLayoutDialog from './ui/AutoLayoutDialog';
import Canvas2D from './editor2d/Canvas2D';
import Scene3D, { download3DImage } from './view3d/Scene3D';
import { exportPlanPDF, exportPlanPNG, printPlan } from './lib/exporters';
import { exportProjectFile, saveProject } from './state/projects';
import { useIsMobile } from './ui/useMediaQuery';

const AUTOSAVE_DELAY = 4000;

export default function App() {
  const project = useEditor((s) => s.project);
  const view = useEditor((s) => s.view);
  const setView = useEditor((s) => s.setView);
  const dirty = useEditor((s) => s.dirty);
  const notices = useEditor((s) => s.notices);
  const selection = useEditor((s) => s.selection);
  const pendingCatalogId = useEditor((s) => s.pendingCatalogId);
  const autoLayoutOpen = useEditor((s) => s.autoLayoutOpen);
  const store = useEditor;

  const isMobile = useIsMobile();
  const [showProjects, setShowProjects] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  // Une copie périmée du magasin de référence a été remplacée au démarrage :
  // on le dit, sinon on croit consulter une version qu'on n'a pas.
  useEffect(() => {
    if (referenceWasRefreshed) {
      store.getState().notify(
        'Le magasin de référence a été mis à jour : la version à jour est ouverte. Votre copie précédente reste dans « Projets ».',
        'success',
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // La vue partagee 2D+3D n'a pas de sens sur un ecran de telephone.
  useEffect(() => {
    if (isMobile && view === 'split') setView('2d');
  }, [isMobile, view, setView]);

  // Poser un objet demande de voir le plan : on referme le tiroir.
  useEffect(() => {
    if (isMobile && pendingCatalogId) setLeftOpen(false);
  }, [isMobile, pendingCatalogId]);

  // Les tiroirs n'existent qu'en disposition telephone.
  useEffect(() => {
    if (!isMobile) {
      setLeftOpen(false);
      setRightOpen(false);
    }
  }, [isMobile]);

  // ------------------------------------------------------- sauvegarde automatique
  useEffect(() => {
    if (!dirty) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      try {
        const saved = saveProject(store.getState().project);
        useEditor.setState({ project: saved, dirty: false });
        setLastSaved(Date.now());
      } catch (e) {
        store.getState().notify(
          e instanceof Error ? e.message : "La sauvegarde automatique a échoué.",
          'error',
        );
      }
    }, AUTOSAVE_DELAY);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [dirty, project, store]);

  // Enregistrement de securite a la fermeture de l'onglet
  useEffect(() => {
    const onUnload = () => {
      if (!useEditor.getState().dirty) return;
      try {
        saveProject(useEditor.getState().project);
      } catch {
        /* rien de plus a tenter a ce stade */
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  useEffect(() => {
    if (!showMenu) return;
    const onClick = () => setShowMenu(false);
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [showMenu]);

  const closeDrawers = () => {
    setLeftOpen(false);
    setRightOpen(false);
  };

  const runExport = async (name: string, fn: () => Promise<void> | void) => {
    setBusy(name);
    setShowMenu(false);
    try {
      await fn();
      store.getState().notify(`${name} : terminé.`, 'success');
    } catch (e) {
      store.getState().notify(e instanceof Error ? e.message : `${name} : échec.`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const menuItems: Array<[string, () => void]> = [
    ['Plan 2D en PDF (A4 paysage)', () => void runExport('Export PDF', () => exportPlanPDF(project))],
    ['Plan 2D en image PNG', () => void runExport('Export PNG', () => exportPlanPNG(project))],
    [
      'Vue 3D en image PNG',
      () =>
        void runExport('Export 3D', () => {
          if (view === '2d') throw new Error("Affichez d'abord la vue 3D pour en exporter une image.");
          if (!download3DImage(project.name)) throw new Error("La vue 3D n'est pas prête.");
        }),
    ],
    ['Imprimer le plan', () => void runExport('Impression', () => printPlan(project))],
    ['Fichier de projet (.json)', () => void runExport('Export du projet', () => exportProjectFile(project))],
  ];

  const views: Array<[ViewMode, string, string]> = [
    ['2d', 'Plan 2D', '2D'],
    ['3d', 'Vue 3D', '3D'],
    ['split', '2D + 3D', ''],
  ];

  const appClass = [
    'app',
    isMobile ? 'mobile' : '',
    leftOpen ? 'left-open' : '',
    rightOpen ? 'right-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={appClass}>
      <header className="topbar">
        {isMobile ? (
          <button
            type="button"
            className="btn icon"
            title="Bibliothèque et réglages"
            onClick={() => {
              setRightOpen(false);
              setLeftOpen((v) => !v);
            }}
          >
            ☰
          </button>
        ) : (
          <div className="brand">
            <span className="mark">P</span>
            <span>
              PlanStore
              <small>Aménagement de locaux commerciaux</small>
            </span>
          </div>
        )}

        <input
          className="project-name"
          value={project.name}
          onChange={(e) => store.getState().renameCurrent(e.target.value)}
          title="Nom du projet"
        />

        {!isMobile && (
          <>
            <button type="button" className="btn" onClick={() => setShowProjects(true)}>
              Projets
            </button>
            <button type="button" className="btn" onClick={() => store.getState().saveNow()}>
              Enregistrer
            </button>
          </>
        )}

        <div className="menu-anchor" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="btn"
            disabled={Boolean(busy)}
            onClick={() => setShowMenu((v) => !v)}
          >
            {busy ?? (isMobile ? '⋯' : 'Exporter')} {!busy && '▾'}
          </button>
          {showMenu && (
            <div className="dropdown">
              {isMobile && (
                <>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      setShowMenu(false);
                      setShowProjects(true);
                    }}
                  >
                    Projets
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      setShowMenu(false);
                      store.getState().saveNow();
                    }}
                  >
                    Enregistrer
                  </button>
                  <div className="dropdown-sep" />
                </>
              )}
              {menuItems.map(([label, fn]) => (
                <button key={label} type="button" className="btn ghost" onClick={fn}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="spacer" />

        {!isMobile && (
          <span className="saved-label">
            {dirty ? (
              <>
                <span className="dirty-dot" /> modifications non enregistrées
              </>
            ) : lastSaved ? (
              `enregistré à ${new Date(lastSaved).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
            ) : (
              'à jour'
            )}
          </span>
        )}

        <div className="seg">
          {views
            .filter(([id]) => !(isMobile && id === 'split'))
            .map(([id, label, short]) => (
              <button
                key={id}
                type="button"
                className={view === id ? 'active' : ''}
                onClick={() => setView(id)}
              >
                {isMobile ? short : label}
              </button>
            ))}
        </div>
      </header>

      <div className="app-body">
        <LeftPanel />

        <div className="workarea">
          {view !== '3d' && <Toolbar />}
          <div className={`viewport ${view === 'split' ? 'split' : ''}`}>
            {(view === '2d' || view === 'split') && <Canvas2D />}
            {(view === '3d' || view === 'split') && <Scene3D />}
          </div>
        </div>

        <aside className="panel right">
          <div className="panel-tabs">
            <button type="button" className="active">
              Propriétés
            </button>
          </div>
          <PropertiesPanel />
        </aside>

        {isMobile && (leftOpen || rightOpen) && (
          <>
            <div className="drawer-backdrop" onClick={closeDrawers} />
            {/* Le tiroir couvre presque tout l'écran : ce bouton garantit
                une cible de fermeture visible, hors du panneau. */}
            <button
              type="button"
              className={`drawer-close ${rightOpen ? 'on-left' : 'on-right'}`}
              title="Fermer"
              onClick={closeDrawers}
            >
              ✕
            </button>
          </>
        )}
      </div>

      {isMobile && (
        <nav className="mobile-bar">
          <button
            type="button"
            className={leftOpen ? 'active' : ''}
            onClick={() => {
              setRightOpen(false);
              setLeftOpen((v) => !v);
            }}
          >
            <span className="glyph">▦</span>
            Objets
          </button>
          <button
            type="button"
            className={rightOpen ? 'active' : ''}
            onClick={() => {
              setLeftOpen(false);
              setRightOpen((v) => !v);
            }}
          >
            <span className="glyph">☰</span>
            Propriétés
            {selection.length > 0 && <span className="pip">{selection.length}</span>}
          </button>
          <button type="button" onClick={() => store.getState().zoomBy(1 / 1.3)}>
            <span className="glyph">−</span>
            Zoom
          </button>
          <button type="button" onClick={() => store.getState().zoomBy(1.3)}>
            <span className="glyph">+</span>
            Zoom
          </button>
          <button
            type="button"
            onClick={() => {
              const r = document.querySelector('.canvas-wrap')?.getBoundingClientRect();
              store.getState().zoomToFit({ width: r?.width ?? 360, height: r?.height ?? 480 });
            }}
          >
            <span className="glyph">⤢</span>
            Tout voir
          </button>
        </nav>
      )}

      {showProjects && <ProjectsDialog onClose={() => setShowProjects(false)} />}
      {autoLayoutOpen && <AutoLayoutDialog onClose={() => store.getState().setAutoLayoutOpen(false)} />}
      <ScaleDialog />

      <div className="notices">
        {notices.map((n) => (
          <div key={n.id} className={`notice ${n.type}`} onClick={() => store.getState().dismissNotice(n.id)}>
            {n.text}
          </div>
        ))}
      </div>
    </div>
  );
}
