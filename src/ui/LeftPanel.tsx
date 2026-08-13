import { useRef, useState } from 'react';
import { useEditor } from '../state/store';
import { CATALOG, CATEGORIES, CATEGORY_LABELS, catalogByCategory } from '../lib/catalog';
import { ZONE_PRESETS } from '../lib/zones';
import { ACCEPTED_TYPES, dataUrlSizeMB, importPlanFile } from '../lib/importPlan';
import { CheckRow, ColorField, NumberField } from './fields';
import type { ItemCategory, ProjectSettings } from '../types';

type Tab = 'objets' | 'zones' | 'plan' | 'existant' | 'reglages';

export default function LeftPanel() {
  const [tab, setTab] = useState<Tab>('objets');

  return (
    <aside className="panel left">
      <nav className="panel-tabs">
        {(
          [
            ['objets', 'Objets'],
            ['zones', 'Zones'],
            ['plan', 'Plan'],
            ['existant', 'Existant'],
            ['reglages', 'Réglages'],
          ] as Array<[Tab, string]>
        ).map(([id, lbl]) => (
          <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {lbl}
          </button>
        ))}
      </nav>
      {tab === 'objets' && <CatalogTab />}
      {tab === 'zones' && <ZonesTab />}
      {tab === 'plan' && <PlanTab />}
      {tab === 'existant' && <ExistingTab />}
      {tab === 'reglages' && <SettingsTab />}
    </aside>
  );
}

// ------------------------------------------------------------- bibliotheque

function CatalogTab() {
  const pending = useEditor((s) => s.pendingCatalogId);
  const setPending = useEditor((s) => s.setPendingCatalog);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const matches = (cat: ItemCategory) =>
    catalogByCategory(cat).filter((e) => !q || e.name.toLowerCase().includes(q));

  return (
    <div className="panel-body">
      <div className="field">
        <input
          className="input"
          placeholder="Rechercher un objet…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {pending && (
        <p className="hint" style={{ marginBottom: 12 }}>
          <b>{CATALOG.find((c) => c.id === pending)?.name}</b> — cliquez sur le plan pour le poser.{' '}
          <button type="button" className="link-btn" onClick={() => setPending(null)}>
            annuler
          </button>
        </p>
      )}

      {CATEGORIES.map((cat) => {
        const list = matches(cat);
        if (!list.length) return null;
        return (
          <div className="section" key={cat}>
            <h3 className="section-title">
              {CATEGORY_LABELS[cat]} <span className="badge">{list.length}</span>
            </h3>
            <div className="catalog-grid">
              {list.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className={`catalog-item ${pending === e.id ? 'active' : ''}`}
                  title={e.description ?? e.name}
                  onClick={() => setPending(pending === e.id ? null : e.id)}
                >
                  <span className="swatch" style={{ background: e.color }} />
                  <span className="nm">{e.name}</span>
                  <span className="dim">
                    {e.width.toFixed(2)} × {e.depth.toFixed(2)} × {e.height.toFixed(2)} m
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {!CATEGORIES.some((c) => matches(c).length) && (
        <div className="empty-state">Aucun objet ne correspond à « {query} ».</div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- zones

function ZonesTab() {
  const store = useEditor;
  const camera = useEditor((s) => s.camera);
  const zones = useEditor((s) => s.project.floor.zones);
  const tool = useEditor((s) => s.tool);

  return (
    <div className="panel-body">
      <div className="section">
        <h3 className="section-title">Créer une zone</h3>
        <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
          Un clic pose une zone rectangulaire au centre de la vue. Utilisez « Zone libre » dans la barre d'outils
          pour tracer un contour quelconque.
        </p>
        <div className="zone-list">
          {ZONE_PRESETS.map((z) => (
            <button
              key={z.category}
              type="button"
              className="zone-btn"
              title={z.description}
              onClick={() => {
                const id = store.getState().addZoneRect({ x: camera.x, y: camera.y }, z.category);
                store.getState().select([id]);
              }}
            >
              <span className="dot" style={{ background: z.color }} />
              <span className="lbl">{z.label}</span>
              <span className="sz">
                {z.width}×{z.depth} m
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`btn small ${tool === 'zone' ? 'primary' : ''}`}
          style={{ marginTop: 8 }}
          onClick={() => store.getState().setTool(tool === 'zone' ? 'select' : 'zone')}
        >
          {tool === 'zone' ? 'Tracé de zone en cours…' : 'Tracer une zone libre'}
        </button>
      </div>

      <div className="section">
        <h3 className="section-title">
          Zones du projet <span className="badge">{zones.length}</span>
        </h3>
        {!zones.length && <p className="hint">Aucune zone définie.</p>}
        <div className="sel-list" style={{ maxHeight: 'none' }}>
          {zones.map((z) => (
            <button key={z.id} type="button" className="sel-row" onClick={() => store.getState().select([z.id])}>
              <span className="dot" style={{ width: 10, height: 10, borderRadius: 3, background: z.color }} />
              <span style={{ flex: 1 }}>{z.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- plan importe

function PlanTab() {
  const project = useEditor((s) => s.project);
  const store = useEditor;
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const bg = project.background;
  const tool = useEditor((s) => s.tool);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const background = await importPlanFile(file);
      store.getState().setBackground(background);
      const mb = dataUrlSizeMB(background.src);
      store
        .getState()
        .notify(
          `Plan « ${file.name} » importé (${mb.toFixed(1)} Mo). Réglez maintenant l'échelle avec une distance connue.`,
          'success',
        );
      store.getState().setTool('calibrate');
    } catch (e) {
      store.getState().notify(e instanceof Error ? e.message : "Échec de l'import.", 'error');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="panel-body">
      <div className="section">
        <h3 className="section-title">Importer un plan</h3>
        <input
          ref={inputRef}
          className="file-input"
          type="file"
          accept={ACCEPTED_TYPES}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <button
          type="button"
          className="btn primary"
          style={{ width: '100%' }}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Import en cours…' : 'Choisir un fichier PDF, JPG ou PNG'}
        </button>
        <p className="hint">
          Le plan est affiché en fond de travail. Vous pouvez ensuite tracer les murs directement par-dessus.
        </p>
      </div>

      {!bg && (
        <div className="empty-state">
          <span className="big">🗺️</span>
          Aucun plan importé.
          <br />
          Importez le plan du local pour travailler dessus à l'échelle réelle.
        </div>
      )}

      {bg && (
        <>
          <div className="section">
            <h3 className="section-title">Échelle</h3>
            <div className="stats">
              <div className="stat wide">
                <div className="k">Dimensions réelles du plan</div>
                <div className="v">
                  {(bg.pxWidth * bg.scale).toFixed(2)} × {(bg.pxHeight * bg.scale).toFixed(2)} m
                </div>
              </div>
            </div>
            <button
              type="button"
              className={`btn ${tool === 'calibrate' ? 'primary' : ''}`}
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => store.getState().setTool(tool === 'calibrate' ? 'select' : 'calibrate')}
            >
              {tool === 'calibrate' ? 'Tracez la distance connue…' : "Régler l'échelle avec une distance connue"}
            </button>
            <p className="hint">
              Tracez sur le plan une distance dont vous connaissez la valeur réelle (une façade, une porte…), puis
              saisissez cette valeur en mètres.
            </p>
            <NumberField
              label="Échelle fine — mètres par pixel image"
              value={bg.scale}
              decimals={5}
              step={0.0001}
              min={0.00001}
              onCommit={(v) => store.getState().updateBackground({ scale: v })}
            />
          </div>

          <div className="section">
            <h3 className="section-title">Affichage</h3>
            <CheckRow
              checked={bg.visible}
              onChange={(v) => store.getState().updateBackground({ visible: v })}
              title="Afficher le plan d'origine"
              subtitle="Masquez-le pour ne conserver que votre modélisation"
            />
            <CheckRow
              checked={bg.locked}
              onChange={(v) => store.getState().updateBackground({ locked: v })}
              title="Verrouiller le plan"
              subtitle="Empêche tout déplacement accidentel du fond"
            />
            <NumberField
              label="Opacité"
              value={bg.opacity}
              min={0.05}
              max={1}
              step={0.05}
              onCommit={(v) => store.getState().updateBackground({ opacity: v })}
            />
          </div>

          <div className="section">
            <h3 className="section-title">Position et orientation</h3>
            <div className="grid2">
              <NumberField
                label="X"
                unit="m"
                value={bg.x}
                disabled={bg.locked}
                onCommit={(v) => store.getState().updateBackground({ x: v })}
              />
              <NumberField
                label="Y"
                unit="m"
                value={bg.y}
                disabled={bg.locked}
                onCommit={(v) => store.getState().updateBackground({ y: v })}
              />
            </div>
            <NumberField
              label="Rotation"
              unit="°"
              decimals={1}
              step={0.5}
              value={bg.rotation}
              disabled={bg.locked}
              onCommit={(v) => store.getState().updateBackground({ rotation: v })}
            />
          </div>

          <div className="section">
            <h3 className="section-title">Fichier</h3>
            <p className="hint" style={{ marginTop: 0 }}>
              {bg.fileName} — {bg.pxWidth} × {bg.pxHeight} px — {dataUrlSizeMB(bg.src).toFixed(1)} Mo
            </p>
            <button
              type="button"
              className="btn small danger"
              onClick={() => {
                store.getState().setBackground(null);
                store.getState().notify('Plan de fond retiré.', 'info');
              }}
            >
              Retirer le plan de fond
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- existant

function ExistingTab() {
  const existing = useEditor((s) => s.project.existing);
  const floor = useEditor((s) => s.project.floor);
  const store = useEditor;

  const keptWalls = floor.walls.filter((w) => w.existing).length;
  const keptDoors = floor.openings.filter((o) => o.type === 'door' && o.existing).length;
  const keptWindows = floor.openings.filter((o) => o.type === 'window' && o.existing).length;

  return (
    <div className="panel-body">
      <div className="section">
        <h3 className="section-title">Conserver l'existant</h3>
        <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
          Les éléments conservés sont figés et signalés en vert : l'aménagement se construit autour d'eux.
        </p>
        <CheckRow
          checked={existing.carrelage}
          onChange={(v) => store.getState().updateExisting({ carrelage: v })}
          title="Conserver le carrelage existant"
          subtitle="La trame du carrelage est reprise au sol, en 2D et en 3D"
        />
        <CheckRow
          checked={existing.murs}
          onChange={(v) => store.getState().updateExisting({ murs: v })}
          title="Conserver les murs existants"
          subtitle={`${keptWalls} mur(s) marqué(s) sur ${floor.walls.length}`}
        />
        <CheckRow
          checked={existing.portes}
          onChange={(v) => store.getState().updateExisting({ portes: v })}
          title="Conserver les portes existantes"
          subtitle={`${keptDoors} porte(s) marquée(s)`}
        />
        <CheckRow
          checked={existing.fenetres}
          onChange={(v) => store.getState().updateExisting({ fenetres: v })}
          title="Conserver les fenêtres existantes"
          subtitle={`${keptWindows} fenêtre(s) marquée(s)`}
        />
      </div>

      {existing.carrelage && (
        <div className="section">
          <h3 className="section-title">Carrelage conservé</h3>
          <ColorField
            label="Teinte du carrelage"
            value={existing.carrelageColor}
            onCommit={(v) => store.getState().updateExisting({ carrelageColor: v })}
          />
          <NumberField
            label="Format des carreaux"
            unit="m"
            value={existing.carrelageTileSize}
            min={0.05}
            max={2}
            step={0.05}
            onCommit={(v) => store.getState().updateExisting({ carrelageTileSize: v })}
          />
          <p className="hint">
            La trame sert de repère d'implantation : les meubles peuvent être alignés sur les joints existants en
            réglant le pas de la grille sur le format des carreaux.
          </p>
          <button
            type="button"
            className="btn small"
            onClick={() => store.getState().updateSettings({ gridSize: existing.carrelageTileSize })}
          >
            Caler la grille sur le carrelage
          </button>
        </div>
      )}

      <div className="section">
        <h3 className="section-title">Marquage individuel</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Sélectionnez un mur, une porte, une fenêtre ou un poteau sur le plan, puis cochez « existant » dans le
          panneau de droite pour le conserver isolément.
        </p>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- reglages

function SettingsTab() {
  const settings = useEditor((s) => s.project.settings);
  const store = useEditor;
  const up = (patch: Partial<ProjectSettings>) => store.getState().updateSettings(patch);

  return (
    <div className="panel-body">
      <div className="section">
        <h3 className="section-title">Construction</h3>
        <NumberField
          label="Hauteur sous plafond"
          unit="m"
          value={settings.wallHeight}
          min={1.5}
          max={12}
          step={0.05}
          onCommit={(v) => up({ wallHeight: v })}
        />
        <div className="grid2">
          <NumberField
            label="Épaisseur mur"
            unit="m"
            value={settings.defaultWallThickness}
            min={0.02}
            step={0.01}
            onCommit={(v) => up({ defaultWallThickness: v })}
          />
          <NumberField
            label="Épaisseur cloison"
            unit="m"
            value={settings.defaultPartitionThickness}
            min={0.02}
            step={0.01}
            onCommit={(v) => up({ defaultPartitionThickness: v })}
          />
        </div>
      </div>

      <div className="section">
        <h3 className="section-title">Grille et aimantation</h3>
        <NumberField
          label="Pas de la grille"
          unit="m"
          value={settings.gridSize}
          min={0.05}
          max={5}
          step={0.05}
          onCommit={(v) => up({ gridSize: v })}
        />
        <CheckRow checked={settings.showGrid} onChange={(v) => up({ showGrid: v })} title="Afficher la grille" />
        <CheckRow
          checked={settings.snap}
          onChange={(v) => up({ snap: v })}
          title="Aimantation"
          subtitle="Accroche sur la grille et les points remarquables"
        />
        <CheckRow
          checked={settings.snapAngle}
          onChange={(v) => up({ snapAngle: v })}
          title="Contrainte d'angle"
          subtitle="Trace par multiples de 15°"
        />
      </div>

      <div className="section">
        <h3 className="section-title">Affichage du plan</h3>
        <CheckRow
          checked={settings.showDimensions}
          onChange={(v) => up({ showDimensions: v })}
          title="Cotations automatiques"
          subtitle="Longueur de chaque mur, cotée à l'extérieur"
        />
        <CheckRow
          checked={settings.showCirculation}
          onChange={(v) => up({ showCirculation: v })}
          title="Circulations clients"
          subtitle="Mesure les passages et signale les zones trop étroites"
        />
        <NumberField
          label="Largeur minimale des allées"
          unit="m"
          value={settings.minAisleWidth}
          min={0.6}
          max={5}
          step={0.05}
          onCommit={(v) => up({ minAisleWidth: v })}
        />
      </div>

      <div className="section">
        <h3 className="section-title">Rendu 3D</h3>
        <CheckRow
          checked={settings.showCeiling}
          onChange={(v) => up({ showCeiling: v })}
          title="Afficher le plafond"
          subtitle="À désactiver pour la vue extérieure en maquette ouverte"
        />
        <ColorField label="Couleur du sol" value={settings.floorColor} onCommit={(v) => up({ floorColor: v })} />
        <ColorField label="Couleur des murs" value={settings.wallColor} onCommit={(v) => up({ wallColor: v })} />
      </div>
    </div>
  );
}
