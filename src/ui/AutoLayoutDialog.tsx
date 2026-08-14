import { useMemo, useState } from 'react';
import { useEditor } from '../state/store';
import {
  defaultAutoLayoutOptions,
  generateLayout,
  type AutoLayoutOptions,
} from '../lib/autoLayout';
import { CheckRow, NumberField, SelectField } from './fields';

/**
 * Formulaire de l'implantation automatique.
 * Les chiffres affichés proviennent d'une génération réelle faite à la volée :
 * ce qui est annoncé est exactement ce qui sera posé sur le plan.
 */
export default function AutoLayoutDialog({ onClose }: { onClose: () => void }) {
  const settings = useEditor((s) => s.project.settings);
  const floor = useEditor((s) => s.project.floor);
  const store = useEditor;

  const [opts, setOpts] = useState<AutoLayoutOptions>(() => ({
    ...defaultAutoLayoutOptions(
      settings.defaultWallThickness,
      settings.defaultPartitionThickness,
      settings.wallHeight,
    ),
    aisleWidth: Math.max(1.6, settings.minAisleWidth),
  }));

  const planNotEmpty =
    floor.walls.length + floor.items.length + floor.zones.length + floor.columns.length > 0;
  const [replace, setReplace] = useState(true);

  const set = <K extends keyof AutoLayoutOptions>(k: K, v: AutoLayoutOptions[K]) =>
    setOpts((o) => ({ ...o, [k]: v }));

  const preview = useMemo(() => generateLayout(opts), [opts]);

  const apply = () => {
    store.getState().applyGeneratedLayout(generateLayout(opts), planNotEmpty && replace);
    // On recadre pour que le résultat soit visible immédiatement.
    const r = document.querySelector('.canvas-wrap')?.getBoundingClientRect();
    store.getState().zoomToFit({ width: r?.width ?? 900, height: r?.height ?? 600 });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Implantation automatique</h2>
          <button type="button" className="btn ghost icon" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="hint" style={{ marginTop: 0 }}>
            Le plan est composé selon les usages du commerce alimentaire : réserve au fond, meubles
            froids en périphérie contre les murs, fruits et légumes à l'entrée, épicerie en gondoles
            centrales, caisses en façade.
          </p>

          <div className="section">
            <h3 className="section-title">Le local</h3>
            <div className="grid3">
              <NumberField
                label="Largeur"
                unit="m"
                value={opts.width}
                min={4}
                max={80}
                step={0.5}
                onCommit={(v) => set('width', v)}
              />
              <NumberField
                label="Profondeur"
                unit="m"
                value={opts.depth}
                min={4}
                max={80}
                step={0.5}
                onCommit={(v) => set('depth', v)}
              />
              <NumberField
                label="Largeur d'allée"
                unit="m"
                value={opts.aisleWidth}
                min={1}
                max={4}
                step={0.1}
                onCommit={(v) => set('aisleWidth', v)}
              />
            </div>
            <CheckRow
              checked={opts.createShell}
              onChange={(v) => set('createShell', v)}
              title="Créer les murs du local"
              subtitle="À décocher si vous avez déjà tracé les murs sur un plan importé"
            />
          </div>

          <div className="section">
            <h3 className="section-title">Organisation</h3>
            <div className="grid2">
              <SelectField
                label="Entrée située à"
                value={opts.entranceSide}
                options={[
                  ['droite', 'Droite de la façade'],
                  ['gauche', 'Gauche de la façade'],
                ]}
                onCommit={(v) => set('entranceSide', v)}
              />
              <NumberField
                label="Nombre de caisses"
                value={opts.checkouts}
                min={0}
                max={8}
                step={1}
                decimals={0}
                onCommit={(v) => set('checkouts', Math.round(v))}
              />
            </div>
            <CheckRow
              checked={opts.doubleSided}
              onChange={(v) => set('doubleSided', v)}
              title="Gondoles double face"
              subtitle="Marchandise des deux côtés : plus de linéaire, allées plus espacées"
            />
            <CheckRow
              checked={opts.reserve}
              onChange={(v) => set('reserve', v)}
              title="Réserve au fond du local"
              subtitle="Séparée par une cloison, avec porte de liaison et racks"
            />
            {opts.reserve && (
              <NumberField
                label="Profondeur de la réserve"
                unit="m"
                value={opts.reserveDepth}
                min={1.5}
                max={15}
                step={0.5}
                onCommit={(v) => set('reserveDepth', v)}
              />
            )}
          </div>

          <div className="section">
            <h3 className="section-title">Ce qui sera généré</h3>
            <div className="stats">
              <div className="stat">
                <div className="k">Surface de vente</div>
                <div className="v">{preview.stats.salesArea.toFixed(1)} m²</div>
              </div>
              <div className="stat">
                <div className="k">Réserve</div>
                <div className="v">{preview.stats.reserveArea.toFixed(1)} m²</div>
              </div>
              <div className="stat">
                <div className="k">Travées de gondoles</div>
                <div className="v">{preview.stats.gondolaRuns}</div>
              </div>
              <div className="stat">
                <div className="k">Linéaire au sol</div>
                <div className="v">{preview.stats.linearMeters.toFixed(1)} m</div>
              </div>
              <div className="stat wide">
                <div className="k">Mobilier posé</div>
                <div className="v">{preview.stats.itemCount} meubles</div>
              </div>
            </div>
            {preview.warnings.map((w) => (
              <p key={w} className="hint" style={{ color: '#ff9a94' }}>
                ⚠ {w}
              </p>
            ))}
          </div>

          {planNotEmpty && (
            <div className="section">
              <h3 className="section-title">Plan existant</h3>
              <CheckRow
                checked={replace}
                onChange={setReplace}
                title="Remplacer le contenu actuel"
                subtitle={
                  replace
                    ? 'Le plan existant sera effacé — annulable avec Ctrl+Z'
                    : "L'implantation sera ajoutée par-dessus le plan actuel"
                }
              />
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn primary" onClick={apply}>
            Générer l'implantation
          </button>
        </div>
      </div>
    </div>
  );
}
