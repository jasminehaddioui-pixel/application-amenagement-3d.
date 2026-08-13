import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/store';
import {
  deleteProject,
  duplicateProject,
  exportProjectFile,
  importProjectFile,
  listProjects,
  renameProject,
  saveProject,
  type ProjectSummary,
} from '../state/projects';

export default function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const current = useEditor((s) => s.project);
  const store = useEditor;
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [newName, setNewName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => setItems(listProjects());

  useEffect(() => {
    // Le projet courant doit apparaitre dans la liste, meme jamais enregistre.
    try {
      saveProject(current);
    } catch {
      /* quota plein : on affiche quand meme la liste existante */
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (ts: number) =>
    new Date(ts).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Projets</h2>
          <button type="button" className="btn ghost icon" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="section">
            <h3 className="section-title">Nouveau projet</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                placeholder="Nom du projet (ex. Supérette Centre-ville)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newName.trim()) {
                    store.getState().newProject(newName.trim());
                    setNewName('');
                    refresh();
                  }
                }}
              />
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  store.getState().newProject(newName.trim() || 'Nouveau projet');
                  setNewName('');
                  refresh();
                }}
              >
                Créer
              </button>
            </div>
          </div>

          <div className="section">
            <h3 className="section-title">
              Projets enregistrés <span className="badge">{items.length}</span>
            </h3>
            {!items.length && <p className="hint">Aucun projet enregistré pour le moment.</p>}
            {items.map((p) => (
              <div key={p.id} className={`project-row ${p.id === current.id ? 'current' : ''}`}>
                <div className="meta">
                  <b>
                    {p.name} {p.id === current.id && <span className="badge ok">ouvert</span>}
                  </b>
                  <span>Modifié le {fmt(p.updatedAt)}</span>
                </div>
                <button
                  type="button"
                  className="btn small"
                  disabled={p.id === current.id}
                  onClick={() => {
                    try {
                      saveProject(current);
                    } catch {
                      /* on ouvre quand meme le projet demande */
                    }
                    store.getState().openProject(p.id);
                    onClose();
                  }}
                >
                  Ouvrir
                </button>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    const name = window.prompt('Nouveau nom du projet :', p.name);
                    if (!name) return;
                    if (p.id === current.id) store.getState().renameCurrent(name);
                    else renameProject(p.id, name);
                    refresh();
                  }}
                >
                  Renommer
                </button>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    if (p.id === current.id) {
                      store.getState().duplicateCurrent();
                    } else {
                      duplicateProject(p.id);
                    }
                    refresh();
                  }}
                >
                  Dupliquer
                </button>
                <button
                  type="button"
                  className="btn small danger"
                  onClick={() => {
                    if (!window.confirm(`Supprimer définitivement « ${p.name} » ?`)) return;
                    if (p.id === current.id) store.getState().deleteCurrent();
                    else deleteProject(p.id);
                    refresh();
                  }}
                >
                  Supprimer
                </button>
              </div>
            ))}
          </div>

          <div className="section">
            <h3 className="section-title">Fichier de projet</h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="btn small" onClick={() => exportProjectFile(current)}>
                Exporter le projet courant (.json)
              </button>
              <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>
                Importer un fichier de projet
              </button>
              <input
                ref={fileRef}
                className="file-input"
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const p = await importProjectFile(f);
                    store.getState().loadProjectObject(p);
                    store.getState().notify(`Projet « ${p.name} » importé.`, 'success');
                    refresh();
                    onClose();
                  } catch (err) {
                    store.getState().notify(
                      err instanceof Error ? err.message : "Fichier de projet illisible.",
                      'error',
                    );
                  } finally {
                    e.target.value = '';
                  }
                }}
              />
            </div>
            <p className="hint">
              Les projets sont enregistrés dans ce navigateur. Exportez un fichier .json pour les archiver ou les
              transférer sur un autre poste.
            </p>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
