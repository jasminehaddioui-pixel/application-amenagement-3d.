import { useMemo } from 'react';
import { useEditor } from '../state/store';
import type { AnyElement, ItemCategory, OpeningType, ZoneCategory } from '../types';
import { CATEGORY_LABELS, catalogEntry } from '../lib/catalog';
import { ZONE_PRESETS, ZONE_PRESET_BY_CATEGORY } from '../lib/zones';
import {
  dist,
  fmtM,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  wallLength,
} from '../lib/geometry';
import { analyseCirculation, distanceToWalls } from '../lib/circulation';
import { CheckRow, ColorField, NumberField, SelectField, TextField } from './fields';

const KIND_LABELS: Record<AnyElement['kind'], string> = {
  wall: 'Mur',
  opening: 'Ouverture',
  column: 'Poteau',
  zone: 'Zone',
  item: 'Objet',
  dimension: 'Cotation',
};

const OPENING_LABELS: Record<OpeningType, string> = {
  door: 'Porte',
  window: 'Fenêtre',
  sliding: 'Porte vitrée automatique',
};

/** Cotes reprises quand on change le type d'une baie. */
const OPENING_DEFAULTS: Record<OpeningType, { sill: number; height: number }> = {
  door: { sill: 0, height: 2.1 },
  window: { sill: 1, height: 1.2 },
  sliding: { sill: 0, height: 2.2 },
};

export default function PropertiesPanel() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const store = useEditor;

  const elements = useMemo(
    () =>
      selection
        .map(
          (id) =>
            project.floor.walls.find((e) => e.id === id) ??
            project.floor.openings.find((e) => e.id === id) ??
            project.floor.columns.find((e) => e.id === id) ??
            project.floor.zones.find((e) => e.id === id) ??
            project.floor.items.find((e) => e.id === id) ??
            project.floor.dimensions.find((e) => e.id === id),
        )
        .filter((e): e is AnyElement => Boolean(e)),
    [selection, project.floor],
  );

  if (!elements.length) return <PlanSummary />;
  if (elements.length > 1) return <MultiSelection elements={elements} />;

  const el = elements[0];
  const st = store.getState();

  switch (el.kind) {
    // ------------------------------------------------------------------ objet
    case 'item': {
      const entry = catalogEntry(el.catalogId);
      const wallGap = distanceToWalls(el, project.floor.walls);
      return (
        <div className="panel-body">
          <div className="section">
            <h3 className="section-title">
              Objet <span className="badge">{CATEGORY_LABELS[el.category as ItemCategory]}</span>
            </h3>
            <TextField label="Nom de l'objet" value={el.name} onCommit={(v) => st.updateItem(el.id, { name: v })} />
            <TextField
              label="Référence (devis, fabricant)"
              value={el.reference ?? ''}
              placeholder="ex. EPTA 260710-6140B rep.1A"
              onCommit={(v) => st.updateItem(el.id, { reference: v || undefined })}
            />
            <SelectField
              label="Catégorie"
              value={el.category}
              options={Object.entries(CATEGORY_LABELS) as Array<[ItemCategory, string]>}
              onCommit={(v) => st.updateItem(el.id, { category: v })}
            />
            {entry?.description && <p className="hint">{entry.description}</p>}
          </div>

          <div className="section">
            <h3 className="section-title">Dimensions</h3>
            <div className="grid3">
              <NumberField label="Largeur" unit="m" value={el.width} min={0.05} onCommit={(v) => st.updateItem(el.id, { width: v })} />
              <NumberField label="Profondeur" unit="m" value={el.depth} min={0.05} onCommit={(v) => st.updateItem(el.id, { depth: v })} />
              <NumberField label="Hauteur" unit="m" value={el.height} min={0.05} onCommit={(v) => st.updateItem(el.id, { height: v })} />
            </div>
            {entry && (
              <button
                type="button"
                className="link-btn"
                onClick={() =>
                  st.updateItem(el.id, { width: entry.width, depth: entry.depth, height: entry.height })
                }
              >
                Rétablir les dimensions du catalogue ({entry.width} × {entry.depth} × {entry.height} m)
              </button>
            )}
          </div>

          <div className="section">
            <h3 className="section-title">Position</h3>
            <div className="grid2">
              <NumberField label="Position X" unit="m" value={el.x} onCommit={(v) => st.updateItem(el.id, { x: v })} />
              <NumberField label="Position Y" unit="m" value={el.y} onCommit={(v) => st.updateItem(el.id, { y: v })} />
            </div>
            <NumberField
              label="Rotation"
              unit="°"
              decimals={1}
              step={1}
              value={el.rotation}
              onCommit={(v) => st.updateItem(el.id, { rotation: v })}
            />
            <div className="row" style={{ display: 'flex', gap: 6 }}>
              {[0, 90, 180, 270].map((a) => (
                <button key={a} type="button" className="btn small" onClick={() => st.updateItem(el.id, { rotation: a })}>
                  {a}°
                </button>
              ))}
            </div>
          </div>

          <div className="section">
            <h3 className="section-title">Apparence</h3>
            <ColorField label="Couleur" value={el.color} onCommit={(v) => st.updateItem(el.id, { color: v })} />
            {el.shelves !== undefined && (
              <NumberField
                label="Niveaux d'étagères"
                decimals={0}
                step={1}
                min={1}
                max={12}
                value={el.shelves}
                onCommit={(v) => st.updateItem(el.id, { shelves: Math.round(v) })}
              />
            )}
            <CheckRow
              checked={el.locked}
              onChange={(v) => st.updateItem(el.id, { locked: v })}
              title="Verrouiller la position"
              subtitle="L'objet ne peut plus être déplacé à la souris"
            />
          </div>

          <div className="section">
            <h3 className="section-title">Informations</h3>
            <div className="stats">
              <div className="stat">
                <div className="k">Emprise au sol</div>
                <div className="v">{(el.width * el.depth).toFixed(2)} m²</div>
              </div>
              <div className="stat">
                <div className="k">Linéaire</div>
                <div className="v">{(el.width * (el.shelves ?? 1)).toFixed(2)} m</div>
              </div>
              <div className="stat wide">
                <div className="k">Distance au mur le plus proche</div>
                <div className="v">{wallGap !== null ? fmtM(wallGap) : '—'}</div>
              </div>
            </div>
          </div>

          <ActionRow />
        </div>
      );
    }

    // -------------------------------------------------------------------- mur
    case 'wall': {
      const L = wallLength(el);
      const angle = (Math.atan2(el.b.y - el.a.y, el.b.x - el.a.x) * 180) / Math.PI;
      const openings = project.floor.openings.filter((o) => o.wallId === el.id);
      return (
        <div className="panel-body">
          <div className="section">
            <h3 className="section-title">
              {el.type === 'wall' ? 'Mur' : 'Cloison'}
              {el.existing && <span className="badge ok">existant</span>}
            </h3>
            <SelectField
              label="Type"
              value={el.type}
              options={[
                ['wall', 'Mur'],
                ['partition', 'Cloison'],
              ]}
              onCommit={(v) => st.updateWall(el.id, { type: v })}
            />
            <div className="grid2">
              <NumberField label="Épaisseur" unit="m" value={el.thickness} min={0.02} onCommit={(v) => st.updateWall(el.id, { thickness: v })} />
              <NumberField label="Hauteur" unit="m" value={el.height} min={0.2} onCommit={(v) => st.updateWall(el.id, { height: v })} />
            </div>
          </div>

          <div className="section">
            <h3 className="section-title">Géométrie</h3>
            <NumberField
              label="Longueur"
              unit="m"
              value={L}
              min={0.05}
              onCommit={(v) => {
                // On allonge le mur en deplacant son extremite b, direction inchangee.
                const k = v / Math.max(1e-6, L);
                st.updateWall(el.id, {
                  b: { x: el.a.x + (el.b.x - el.a.x) * k, y: el.a.y + (el.b.y - el.a.y) * k },
                });
              }}
            />
            <NumberField
              label="Angle"
              unit="°"
              decimals={1}
              step={1}
              value={angle}
              onCommit={(v) => {
                const r = (v * Math.PI) / 180;
                st.updateWall(el.id, {
                  b: { x: el.a.x + Math.cos(r) * L, y: el.a.y + Math.sin(r) * L },
                });
              }}
            />
            <div className="grid2">
              <NumberField label="Départ X" unit="m" value={el.a.x} onCommit={(v) => st.updateWall(el.id, { a: { ...el.a, x: v } })} />
              <NumberField label="Départ Y" unit="m" value={el.a.y} onCommit={(v) => st.updateWall(el.id, { a: { ...el.a, y: v } })} />
              <NumberField label="Arrivée X" unit="m" value={el.b.x} onCommit={(v) => st.updateWall(el.id, { b: { ...el.b, x: v } })} />
              <NumberField label="Arrivée Y" unit="m" value={el.b.y} onCommit={(v) => st.updateWall(el.id, { b: { ...el.b, y: v } })} />
            </div>
          </div>

          <div className="section">
            <h3 className="section-title">Existant</h3>
            <CheckRow
              checked={el.existing}
              onChange={(v) => st.updateWall(el.id, { existing: v })}
              title="Mur existant à conserver"
              subtitle="Signalé en vert sur le plan et en 3D"
            />
          </div>

          <div className="section">
            <h3 className="section-title">Ouvertures ({openings.length})</h3>
            {openings.length === 0 && (
              <p className="hint">Aucune ouverture. Utilisez les outils Porte, Fenêtre ou Porte auto.</p>
            )}
            <div className="sel-list">
              {openings.map((o) => (
                <button key={o.id} type="button" className="sel-row" onClick={() => st.select([o.id])}>
                  <span className="tag">{OPENING_LABELS[o.type].toLowerCase()}</span>
                  <span>
                    {fmtM(o.width)} à {fmtM(o.offset)} du départ
                  </span>
                </button>
              ))}
            </div>
          </div>

          <ActionRow />
        </div>
      );
    }

    // ------------------------------------------------------------- ouverture
    case 'opening': {
      const wall = project.floor.walls.find((w) => w.id === el.wallId);
      const L = wall ? wallLength(wall) : 0;
      return (
        <div className="panel-body">
          <div className="section">
            <h3 className="section-title">
              {OPENING_LABELS[el.type]}
              {el.existing && <span className="badge ok">existante</span>}
            </h3>
            <SelectField
              label="Type"
              value={el.type}
              options={[
                ['door', OPENING_LABELS.door],
                ['window', OPENING_LABELS.window],
                ['sliding', OPENING_LABELS.sliding],
              ]}
              onCommit={(v) => st.updateOpening(el.id, { type: v, ...OPENING_DEFAULTS[v] })}
            />
            <div className="grid2">
              <NumberField label="Largeur" unit="m" value={el.width} min={0.3} onCommit={(v) => st.updateOpening(el.id, { width: v })} />
              <NumberField label="Hauteur" unit="m" value={el.height} min={0.3} onCommit={(v) => st.updateOpening(el.id, { height: v })} />
            </div>
            <NumberField
              label="Hauteur d'allège"
              unit="m"
              value={el.sill}
              min={0}
              onCommit={(v) => st.updateOpening(el.id, { sill: v })}
            />
            <NumberField
              label={`Position sur le mur (0 → ${L.toFixed(2)} m)`}
              unit="m"
              value={el.offset}
              min={0}
              max={L}
              onCommit={(v) => st.updateOpening(el.id, { offset: v })}
            />
            {el.type === 'door' && (
              <CheckRow
                checked={el.flip}
                onChange={(v) => st.updateOpening(el.id, { flip: v })}
                title="Inverser le sens"
                subtitle="Change le côté du gond"
              />
            )}
            {el.type === 'sliding' && (
              <p className="hint">
                Deux vantaux vitrés qui s'effacent latéralement : la porte n'a pas de sens
                d'ouverture, et le passage libre vaut toute la largeur de la baie.
              </p>
            )}
            <CheckRow
              checked={el.existing}
              onChange={(v) => st.updateOpening(el.id, { existing: v })}
              title={`${OPENING_LABELS[el.type]} existante à conserver`}
            />
          </div>
          {wall && (
            <div className="section">
              <h3 className="section-title">Mur porteur</h3>
              <button type="button" className="sel-row" onClick={() => st.select([wall.id])}>
                <span className="tag">{wall.type === 'wall' ? 'mur' : 'cloison'}</span>
                <span>
                  {fmtM(L)} — ép. {fmtM(wall.thickness)}
                </span>
              </button>
            </div>
          )}
          <ActionRow />
        </div>
      );
    }

    // ---------------------------------------------------------------- poteau
    case 'column':
      return (
        <div className="panel-body">
          <div className="section">
            <h3 className="section-title">
              Poteau {el.existing && <span className="badge ok">existant</span>}
            </h3>
            <SelectField
              label="Section"
              value={el.shape}
              options={[
                ['rect', 'Rectangulaire'],
                ['round', 'Circulaire'],
              ]}
              onCommit={(v) => st.updateColumn(el.id, { shape: v })}
            />
            <div className="grid3">
              <NumberField
                label={el.shape === 'round' ? 'Diamètre' : 'Largeur'}
                unit="m"
                value={el.width}
                min={0.05}
                onCommit={(v) => st.updateColumn(el.id, { width: v, ...(el.shape === 'round' ? { depth: v } : {}) })}
              />
              <NumberField
                label="Profondeur"
                unit="m"
                value={el.depth}
                min={0.05}
                disabled={el.shape === 'round'}
                onCommit={(v) => st.updateColumn(el.id, { depth: v })}
              />
              <NumberField label="Hauteur" unit="m" value={el.height} min={0.1} onCommit={(v) => st.updateColumn(el.id, { height: v })} />
            </div>
            <div className="grid2">
              <NumberField label="Position X" unit="m" value={el.x} onCommit={(v) => st.updateColumn(el.id, { x: v })} />
              <NumberField label="Position Y" unit="m" value={el.y} onCommit={(v) => st.updateColumn(el.id, { y: v })} />
            </div>
            <NumberField
              label="Rotation"
              unit="°"
              decimals={1}
              step={1}
              value={el.rotation}
              onCommit={(v) => st.updateColumn(el.id, { rotation: v })}
            />
            <CheckRow
              checked={el.existing}
              onChange={(v) => st.updateColumn(el.id, { existing: v })}
              title="Poteau existant à conserver"
            />
          </div>
          <ActionRow />
        </div>
      );

    // ------------------------------------------------------------------ zone
    case 'zone': {
      const area = polygonArea(el.points);
      const b = polygonBounds(el.points);
      const c = polygonCentroid(el.points);
      const scalePoly = (sx: number, sy: number) =>
        el.points.map((p) => ({ x: c.x + (p.x - c.x) * sx, y: c.y + (p.y - c.y) * sy }));
      return (
        <div className="panel-body">
          <div className="section">
            <h3 className="section-title">Zone</h3>
            <TextField label="Nom" value={el.name} onCommit={(v) => st.updateZone(el.id, { name: v })} />
            <SelectField
              label="Catégorie"
              value={el.category}
              options={ZONE_PRESETS.map((z) => [z.category, z.label] as [ZoneCategory, string])}
              onCommit={(v) =>
                st.updateZone(el.id, {
                  category: v,
                  color: ZONE_PRESET_BY_CATEGORY[v].color,
                  name: el.name === ZONE_PRESET_BY_CATEGORY[el.category].label ? ZONE_PRESET_BY_CATEGORY[v].label : el.name,
                })
              }
            />
            <ColorField label="Couleur" value={el.color} onCommit={(v) => st.updateZone(el.id, { color: v })} />
            <NumberField
              label="Opacité"
              value={el.opacity}
              min={0.05}
              max={1}
              step={0.05}
              onCommit={(v) => st.updateZone(el.id, { opacity: v })}
            />
          </div>

          <div className="section">
            <h3 className="section-title">Emprise</h3>
            <div className="grid2">
              <NumberField
                label="Largeur"
                unit="m"
                value={b.width}
                min={0.2}
                onCommit={(v) => st.updateZone(el.id, { points: scalePoly(v / Math.max(1e-6, b.width), 1) })}
              />
              <NumberField
                label="Hauteur"
                unit="m"
                value={b.height}
                min={0.2}
                onCommit={(v) => st.updateZone(el.id, { points: scalePoly(1, v / Math.max(1e-6, b.height)) })}
              />
            </div>
            <div className="grid2">
              <NumberField
                label="Centre X"
                unit="m"
                value={c.x}
                onCommit={(v) => st.updateZone(el.id, { points: el.points.map((p) => ({ ...p, x: p.x + (v - c.x) })) })}
              />
              <NumberField
                label="Centre Y"
                unit="m"
                value={c.y}
                onCommit={(v) => st.updateZone(el.id, { points: el.points.map((p) => ({ ...p, y: p.y + (v - c.y) })) })}
              />
            </div>
            <div className="stats">
              <div className="stat wide">
                <div className="k">Surface</div>
                <div className="v">{area.toFixed(2)} m²</div>
              </div>
            </div>
            <p className="hint">{el.points.length} sommets — glissez les poignées sur le plan pour redéformer la zone.</p>
          </div>
          <ActionRow />
        </div>
      );
    }

    // -------------------------------------------------------------- cotation
    case 'dimension': {
      const L = dist(el.a, el.b);
      return (
        <div className="panel-body">
          <div className="section">
            <h3 className="section-title">Cotation</h3>
            <div className="stats">
              <div className="stat wide">
                <div className="k">Longueur mesurée</div>
                <div className="v">{fmtM(L)}</div>
              </div>
            </div>
            <NumberField
              label="Déport de la ligne de cote"
              unit="m"
              value={el.offset}
              step={0.05}
              onCommit={(v) => st.updateDimension(el.id, { offset: v })}
            />
            <TextField
              label="Texte personnalisé (vide = valeur mesurée)"
              value={el.label ?? ''}
              placeholder={fmtM(L)}
              onCommit={(v) => st.updateDimension(el.id, { label: v || undefined })}
            />
            <div className="grid2">
              <NumberField label="Départ X" unit="m" value={el.a.x} onCommit={(v) => st.updateDimension(el.id, { a: { ...el.a, x: v } })} />
              <NumberField label="Départ Y" unit="m" value={el.a.y} onCommit={(v) => st.updateDimension(el.id, { a: { ...el.a, y: v } })} />
              <NumberField label="Arrivée X" unit="m" value={el.b.x} onCommit={(v) => st.updateDimension(el.id, { b: { ...el.b, x: v } })} />
              <NumberField label="Arrivée Y" unit="m" value={el.b.y} onCommit={(v) => st.updateDimension(el.id, { b: { ...el.b, y: v } })} />
            </div>
          </div>
          <ActionRow />
        </div>
      );
    }

    default:
      return <PlanSummary />;
  }
}

// ---------------------------------------------------------------- selections

function ActionRow() {
  const st = useEditor;
  return (
    <div className="section">
      <h3 className="section-title">Actions</h3>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="btn small" onClick={() => st.getState().duplicateSelection()}>
          Dupliquer
        </button>
        <button type="button" className="btn small" onClick={() => st.getState().rotateSelection(90)}>
          Pivoter 90°
        </button>
        <button type="button" className="btn small" onClick={() => st.getState().rotateSelection(-90)}>
          Pivoter −90°
        </button>
        <button type="button" className="btn small danger" onClick={() => st.getState().deleteSelection()}>
          Supprimer
        </button>
      </div>
      <p className="hint">
        Raccourcis : <span className="kbd">Ctrl+D</span> dupliquer · <span className="kbd">R</span> pivoter ·{' '}
        <span className="kbd">Suppr</span> supprimer · flèches pour un déplacement précis.
      </p>
    </div>
  );
}

function MultiSelection({ elements }: { elements: AnyElement[] }) {
  const st = useEditor;
  const counts = elements.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div className="panel-body">
      <div className="section">
        <h3 className="section-title">Sélection multiple ({elements.length})</h3>
        <div className="stats">
          {Object.entries(counts).map(([k, n]) => (
            <div className="stat" key={k}>
              <div className="k">{KIND_LABELS[k as AnyElement['kind']]}</div>
              <div className="v">{n}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="section">
        <h3 className="section-title">Éléments</h3>
        <div className="sel-list">
          {elements.slice(0, 40).map((e) => (
            <button key={e.id} type="button" className="sel-row" onClick={() => st.getState().select([e.id])}>
              <span className="tag">{KIND_LABELS[e.kind]}</span>
              <span>{'name' in e ? e.name : e.id.slice(0, 10)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="section">
        <h3 className="section-title">Existant</h3>
        <button type="button" className="btn small" onClick={() => st.getState().toggleExistingOnSelection()}>
          Basculer « à conserver »
        </button>
      </div>
      <ActionRow />
    </div>
  );
}

// ----------------------------------------------------------- resume du plan

function PlanSummary() {
  const project = useEditor((s) => s.project);
  const { floor, settings } = project;

  const report = useMemo(
    () => analyseCirculation(floor, settings.minAisleWidth),
    [floor, settings.minAisleWidth],
  );

  const salesArea = floor.zones
    .filter((z) => z.category === 'vente')
    .reduce((s, z) => s + polygonArea(z.points), 0);
  const totalArea = floor.zones.reduce((s, z) => s + polygonArea(z.points), 0);
  const linear = floor.items
    .filter((i) => i.category === 'rayonnage' || i.category === 'froid')
    .reduce((s, i) => s + i.width, 0);

  const empty = floor.walls.length + floor.items.length + floor.zones.length === 0;

  return (
    <div className="panel-body">
      {empty && (
        <div className="section">
          <h3 className="section-title">Démarrer</h3>
          <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
            Le plan est vide. Le plus rapide est de partir d'une implantation complète, puis de
            l'ajuster.
          </p>
          <button
            type="button"
            className="btn primary"
            style={{ width: '100%' }}
            onClick={() => useEditor.getState().setAutoLayoutOpen(true)}
          >
            Générer un magasin complet
          </button>
        </div>
      )}

      <div className="section">
        <h3 className="section-title">Synthèse du plan</h3>
        <div className="stats">
          <div className="stat">
            <div className="k">Murs</div>
            <div className="v">{floor.walls.length}</div>
          </div>
          <div className="stat">
            <div className="k">Objets</div>
            <div className="v">{floor.items.length}</div>
          </div>
          <div className="stat">
            <div className="k">Portes</div>
            <div className="v">{floor.openings.filter((o) => o.type === 'door').length}</div>
          </div>
          <div className="stat">
            <div className="k">Fenêtres</div>
            <div className="v">{floor.openings.filter((o) => o.type === 'window').length}</div>
          </div>
          <div className="stat">
            <div className="k">Portes auto.</div>
            <div className="v">{floor.openings.filter((o) => o.type === 'sliding').length}</div>
          </div>
          <div className="stat">
            <div className="k">Poteaux</div>
            <div className="v">{floor.columns.length}</div>
          </div>
          <div className="stat">
            <div className="k">Zones</div>
            <div className="v">{floor.zones.length}</div>
          </div>
          <div className="stat wide">
            <div className="k">Surface de vente</div>
            <div className="v">{salesArea.toFixed(2)} m²</div>
          </div>
          <div className="stat wide">
            <div className="k">Total des zones</div>
            <div className="v">{totalArea.toFixed(2)} m²</div>
          </div>
          <div className="stat wide">
            <div className="k">Linéaire de vente au sol</div>
            <div className="v">{linear.toFixed(2)} m</div>
          </div>
        </div>
      </div>

      <div className="section">
        <h3 className="section-title">Circulation clients</h3>
        <div className="stats">
          <div className={`stat ${report.narrowCount ? 'alert' : 'good'}`}>
            <div className="k">Passages étroits</div>
            <div className="v">{report.narrowCount}</div>
          </div>
          <div className="stat">
            <div className="k">Allée mini</div>
            <div className="v">{report.minWidth !== null ? report.minWidth.toFixed(2) : '—'} m</div>
          </div>
        </div>
        {report.narrowCount > 0 && (
          <div className="sel-list" style={{ marginTop: 8 }}>
            {report.gaps
              .filter((g) => g.narrow)
              .slice(0, 10)
              .map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="sel-row"
                  onClick={() => useEditor.getState().select([g.a.id, g.b.id])}
                >
                  <span className="tag" style={{ color: '#ff9a94' }}>
                    {g.width.toFixed(2)} m
                  </span>
                  <span>
                    {g.a.label} ↔ {g.b.label}
                  </span>
                </button>
              ))}
          </div>
        )}
        <p className="hint">
          Seuil réglementaire retenu : {settings.minAisleWidth.toFixed(2)} m. Activez « Circulations » dans la barre
          d'outils pour afficher les mesures directement sur le plan.
        </p>
      </div>

      <div className="section">
        <h3 className="section-title">Aide</h3>
        <p className="hint">
          Sélectionnez un élément du plan pour modifier précisément ses dimensions, sa position et sa rotation.
        </p>
      </div>
    </div>
  );
}
