import { useEditor } from '../state/store';
import type { ToolId } from '../types';

interface ToolDef {
  id: ToolId;
  glyph: string;
  label: string;
  title: string;
}

const TOOLS: ToolDef[][] = [
  [
    { id: 'select', glyph: '⬉', label: 'Sélection', title: 'Sélectionner et déplacer (V)' },
    { id: 'pan', glyph: '✋', label: 'Naviguer', title: 'Se déplacer dans le plan (H)' },
  ],
  [
    { id: 'wall', glyph: '▬', label: 'Mur', title: 'Tracer des murs (M)' },
    { id: 'partition', glyph: '▭', label: 'Cloison', title: 'Tracer des cloisons (C)' },
    { id: 'door', glyph: '🚪', label: 'Porte', title: 'Percer une porte dans un mur (P)' },
    { id: 'window', glyph: '🪟', label: 'Fenêtre', title: 'Percer une fenêtre ou une vitrine (F)' },
    {
      id: 'sliding',
      glyph: '🏬',
      label: 'Porte auto.',
      title: 'Poser une porte vitrée automatique de magasin (B)',
    },
    { id: 'column', glyph: '◧', label: 'Poteau', title: 'Poser un poteau (O)' },
  ],
  [
    { id: 'zone', glyph: '⬠', label: 'Zone', title: 'Tracer une zone du magasin (Z)' },
    { id: 'dimension', glyph: '↔', label: 'Cotation', title: 'Ajouter une cotation (K)' },
    { id: 'measure', glyph: '📏', label: 'Mesurer', title: 'Mesurer une distance sans rien créer' },
    { id: 'calibrate', glyph: '⚖', label: 'Échelle', title: "Régler l'échelle du plan importé" },
  ],
];

export default function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const settings = useEditor((s) => s.project.settings);
  const updateSettings = useEditor((s) => s.updateSettings);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const store = useEditor;

  return (
    <div className="toolbar">
      {TOOLS.map((group, gi) => (
        <div key={gi} style={{ display: 'contents' }}>
          <div className="tool-group">
            {group.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.title}
                className={`tool ${tool === t.id ? 'active' : ''}`}
                onClick={() => setTool(t.id)}
              >
                <span className="glyph">{t.glyph}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <div className="divider" />
        </div>
      ))}

      <div className="tool-group">
        <button
          type="button"
          className="btn icon"
          title="Annuler (Ctrl+Z)"
          disabled={!canUndo}
          onClick={() => store.getState().undo()}
        >
          ↶
        </button>
        <button
          type="button"
          className="btn icon"
          title="Rétablir (Ctrl+Maj+Z)"
          disabled={!canRedo}
          onClick={() => store.getState().redo()}
        >
          ↷
        </button>
        <button
          type="button"
          className="btn icon"
          title="Dupliquer la sélection (Ctrl+D)"
          onClick={() => store.getState().duplicateSelection()}
        >
          ⧉
        </button>
        <button
          type="button"
          className="btn icon"
          title="Pivoter de 90° (R)"
          onClick={() => store.getState().rotateSelection(90)}
        >
          ⟳
        </button>
        <button
          type="button"
          className="btn icon danger"
          title="Supprimer la sélection (Suppr)"
          onClick={() => store.getState().deleteSelection()}
        >
          🗑
        </button>
      </div>

      <div className="divider" />

      <div className="tool-group">
        <button
          type="button"
          className={`toggle-chip ${settings.showGrid ? 'on' : ''}`}
          onClick={() => updateSettings({ showGrid: !settings.showGrid })}
        >
          Grille
        </button>
        <button
          type="button"
          className={`toggle-chip ${settings.snap ? 'on' : ''}`}
          onClick={() => updateSettings({ snap: !settings.snap })}
        >
          Aimantation
        </button>
        <button
          type="button"
          className={`toggle-chip ${settings.showDimensions ? 'on' : ''}`}
          onClick={() => updateSettings({ showDimensions: !settings.showDimensions })}
        >
          Cotations
        </button>
        <button
          type="button"
          className={`toggle-chip ${settings.showCirculation ? 'on' : ''}`}
          onClick={() => updateSettings({ showCirculation: !settings.showCirculation })}
        >
          Circulations
        </button>
      </div>

      <div className="spacer" />

      <div className="tool-group">
        <button type="button" className="btn icon" title="Zoom arrière" onClick={() => store.getState().zoomBy(1 / 1.25)}>
          −
        </button>
        <button type="button" className="btn icon" title="Zoom avant" onClick={() => store.getState().zoomBy(1.25)}>
          +
        </button>
        <button
          type="button"
          className="btn small"
          title="Cadrer tout le plan"
          onClick={() => {
            const el = document.querySelector('.canvas-wrap');
            const r = el?.getBoundingClientRect();
            store.getState().zoomToFit({ width: r?.width ?? 900, height: r?.height ?? 600 });
          }}
        >
          Tout voir
        </button>
      </div>
    </div>
  );
}
