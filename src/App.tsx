import { useEffect, useRef, useState } from 'react';
import { useEditor, type ViewMode } from './state/store';
import Toolbar from './ui/Toolbar';
import LeftPanel from './ui/LeftPanel';
import PropertiesPanel from './ui/PropertiesPanel';
import ProjectsDialog from './ui/ProjectsDialog';
import ScaleDialog from './ui/ScaleDialog';
import Canvas2D from './editor2d/Canvas2D';
import Scene3D, { download3DImage } from './view3d/Scene3D';
import { exportPlanPDF, exportPlanPNG, printPlan } from './lib/exporters';
import { exportProjectFile, saveProject } from './state/projects';

const AUTOSAVE_DELAY = 4000;

export default function App() {
  const project = useEditor((s) => s.project);
  const view = useEditor((s) => s.view);
  const setView = useEditor((s) => s.setView);
  const dirty = useEditor((s) => s.dirty);
  const notices = useEditor((s) => s.notices);
  const store = useEditor;

  const [showProjects, setShowProjects] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

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

  // Fermeture du menu d'export au clic exterieur
  useEffect(() => {
    if (!showExport) return;
    const onClick = () => setShowExport(false);
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [showExport]);

  const runExport = async (name: string, fn: () => Promise<void> | void) => {
    setBusy(name);
    setShowExport(false);
    try {
      await fn();
      store.getState().notify(`${name} : terminé.`, 'success');
    } catch (e) {
      store.getState().notify(e instanceof Error ? e.message : `${name} : échec.`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark">P</span>
          <span>
            PlanStore
            <small>Aménagement de locaux commerciaux</small>
          </span>
        </div>

        <input
          className="project-name"
          value={project.name}
          onChange={(e) => store.getState().renameCurrent(e.target.value)}
          title="Nom du projet"
        />

        <button type="button" className="btn" onClick={() => setShowProjects(true)}>
          Projets
        </button>

        <button type="button" className="btn" onClick={() => store.getState().saveNow()}>
          Enregistrer
        </button>

        <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => setShowExport((v) => !v)}>
            {busy ?? 'Exporter'} ▾
          </button>
          {showExport && (
            <div
              className="modal"
              style={{
                position: 'absolute',
                top: 36,
                right: 0,
                width: 268,
                padding: 6,
                zIndex: 50,
              }}
            >
              <button
                type="button"
                className="btn ghost"
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onClick={() => void runExport('Export PDF', () => exportPlanPDF(project))}
              >
                Plan 2D en PDF (A4 paysage)
              </button>
              <button
                type="button"
                className="btn ghost"
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onClick={() => void runExport('Export PNG', () => exportPlanPNG(project))}
              >
                Plan 2D en image PNG
              </button>
              <button
                type="button"
                className="btn ghost"
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onClick={() =>
                  void runExport('Export 3D', () => {
                    if (view === '2d') {
                      throw new Error("Affichez d'abord la vue 3D pour en exporter une image.");
                    }
                    if (!download3DImage(project.name)) {
                      throw new Error("La vue 3D n'est pas prête.");
                    }
                  })
                }
              >
                Vue 3D en image PNG
              </button>
              <button
                type="button"
                className="btn ghost"
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onClick={() => void runExport('Impression', () => printPlan(project))}
              >
                Imprimer le plan
              </button>
              <button
                type="button"
                className="btn ghost"
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onClick={() => void runExport('Export du projet', () => exportProjectFile(project))}
              >
                Fichier de projet (.json)
              </button>
            </div>
          )}
        </div>

        <div className="spacer" />

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

        <div className="seg">
          {(
            [
              ['2d', 'Plan 2D'],
              ['3d', 'Vue 3D'],
              ['split', '2D + 3D'],
            ] as Array<[ViewMode, string]>
          ).map(([id, lbl]) => (
            <button key={id} type="button" className={view === id ? 'active' : ''} onClick={() => setView(id)}>
              {lbl}
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
      </div>

      {showProjects && <ProjectsDialog onClose={() => setShowProjects(false)} />}
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
