import type { Column, Item, Opening, Project, Vec2, Wall, Zone, ZoneCategory } from '../../types';
import { defaultExisting, defaultSettings, emptyFloor } from '../../types';
import { catalogEntry } from '../catalog';
import { ZONE_PRESET_BY_CATEGORY } from '../zones';
import { uid } from '../geometry';

/**
 * Projet PANIER SYMPA — HAGETMAU (40700), monté à partir des documents fournis.
 *
 * SOURCES
 *  - Relevé manuscrit « HAGETMAU » (plan_hagetmau_18_juin) : coque 23,20 × 8,20 m
 *    hors tout, poteaux 20 × 20, porte de 1,50 m, cotes 1600 / 1390 / 160 / 50.
 *  - Plan d'implantation « hagetmau_2 » : 160 m² de vente, 18,77 m de profondeur,
 *    allées 180 / 165 / 180, muraux profondeur 50, lockers Amazon profondeur 60,
 *    presse en façade, entrée en pignon.
 *  - Devis RAY-ORG n° DE2026-133 (gondoles MAGO type Tegometall, occasion) :
 *    muraux h. 2200 en 7,03 + 3,03 + 6,03 + 1,03 ml, 8 modules centraux double
 *    face h. 2200 (2 files de 4,03), 4 têtes de gondole h. 2200, 5 modules
 *    centraux h. 1500, têtes h. 1500. Module utile 1000 mm, tablette 1000 × 470,
 *    550 mm de profondeur hors tout en simple face.
 *  - Trame devis TILT : 1 meuble caisse bi-optique L 1400, 1 îlot fruits et
 *    légumes H 155 de 2 ml, profondeur 60.
 *  - Dossier technique EPTA / Bonnet Névé, offre n° 260710-6140B : cotes hors
 *    tout exactes du froid (repères 1A, 1B, 2, 3).
 *
 * ÉCARTS ENTRE DOCUMENTS, ET CHOIX RETENUS
 *  - Le relevé donne 23,20 m de longueur totale ; le plan d'implantation annonce
 *    18,77 m de vente et 160 m². 23,20 − 18,77 = 4,43 m : la réserve a donc été
 *    fixée à 4,43 m au fond, ce qui réconcilie les deux documents.
 *  - Le relevé donne 8,20 m hors tout (7,80 m dans œuvre) là où le plan
 *    d'implantation suppose une largeur d'environ 8,50 m. Le relevé, qui est le
 *    document mesuré sur place, fait foi : les allées ont été ramenées de
 *    180 / 165 / 180 à 145 / 150 / 150-175 pour tenir dans la largeur réelle.
 *  - Le plan d'implantation annonçait 12 portes positives et 6 négatives ; le
 *    dossier EPTA, plus récent (10 juillet), en retient 10 positives et 6
 *    négatives. C'est le dossier EPTA qui a été suivi.
 *
 * Toutes les cotes sont en mètres. Les éléments de structure sont marqués
 * « existant » : ils apparaissent en vert et l'aménagement se construit autour.
 */

// ------------------------------------------------------------------ la coque

const WALL = 0.2; // épaisseur des murs périphériques (relevé)
const PART = 0.1; // cloison de réserve
const EXT_W = 8.2; // largeur hors tout (relevé)
const EXT_L = 23.2; // longueur hors tout (relevé)

/** Faces intérieures. */
const XL = WALL; // 0,20
const XR = EXT_W - WALL; // 8,00
const YB = WALL; // 0,20 — fond du bâtiment
const YF = EXT_L - WALL; // 23,00 — façade / rue

const RESERVE_DEPTH = 4.43; // 23,20 − 18,77 (plan d'implantation)
const PART_Y = YB + RESERVE_DEPTH; // axe de la cloison
const SALES_TOP = PART_Y + PART / 2; // 4,68

// Axes des gondoles centrales : le magasin est étroit, on décale légèrement
// vers la gauche pour dégager l'allée devant le froid, plus profond que les muraux.
const RUN_A = 2.7; // axe file A (largeur 1,00)
const RUN_B = 5.2; // axe file B

const MODULE = 1.0; // module de gondole (devis RAY-ORG)
// Le long de la file, une tête de gondole occupe sa LARGEUR (1,03 ml au devis),
// et non sa profondeur : c'est un module posé en bout de travée.
const TG_LEN = 1.03;
const MURAL_D = 0.55; // profondeur hors tout d'un mural simple face
const DOUBLE_D = 1.0; // profondeur hors tout d'une gondole double face

// ---------------------------------------------------------------- fabriques

function wall(a: Vec2, b: Vec2, type: 'wall' | 'partition', thickness: number, existing = true): Wall {
  return { id: uid('w'), kind: 'wall', type, a, b, thickness, height: 3, existing };
}

function door(wallId: string, offset: number, width: number, existing = true): Opening {
  return {
    id: uid('o'),
    kind: 'opening',
    type: 'door',
    wallId,
    offset,
    width,
    height: 2.1,
    sill: 0,
    flip: false,
    existing,
  };
}

interface Spec {
  catalogId: string;
  name: string;
  reference?: string;
  w: number;
  d: number;
  h: number;
  color?: string;
  shelves?: number;
}

/** Pose un meuble, `x`/`y` étant son centre. */
function put(s: Spec, x: number, y: number, rotation: number): Item {
  const e = catalogEntry(s.catalogId);
  return {
    id: uid('i'),
    kind: 'item',
    catalogId: s.catalogId,
    name: s.name,
    reference: s.reference,
    category: e?.category ?? 'autres',
    x,
    y,
    width: s.w,
    depth: s.d,
    height: s.h,
    rotation,
    color: s.color ?? e?.color ?? '#8b96a3',
    locked: false,
    shelves: s.shelves ?? e?.shelves,
  };
}

/**
 * Pose une file de meubles identiques le long de l'axe Y (meubles tournés de 90°),
 * depuis `from`, et renvoie l'ordonnée d'arrivée.
 */
function runY(out: Item[], s: Spec, xFace: number, side: 'left' | 'right', from: number, count: number): number {
  // xFace est la face intérieure du mur ; le meuble s'adosse contre.
  const cx = side === 'left' ? xFace + s.d / 2 : xFace - s.d / 2;
  let y = from;
  for (let i = 0; i < count; i++) {
    out.push(put(s, cx, y + s.w / 2, 90));
    y += s.w;
  }
  return y;
}

function zone(category: ZoneCategory, x: number, y: number, w: number, h: number, name?: string): Zone {
  const preset = ZONE_PRESET_BY_CATEGORY[category];
  return {
    id: uid('z'),
    kind: 'zone',
    name: name ?? preset.label,
    category,
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    color: preset.color,
    opacity: 0.16,
  };
}

// ------------------------------------------------------------- les matériels

const MURAL: Spec = {
  catalogId: 'rayonnage-mural',
  name: 'Rayonnage mural h.2200',
  reference: 'RAY-ORG DE2026-133 — MAGO/Tegometall, module 1000, tablette 1000×470',
  w: MODULE,
  d: MURAL_D,
  h: 2.2,
  shelves: 7,
};

const MURAL_PERF: Spec = {
  ...MURAL,
  name: 'Rayonnage mural h.2200 — fond perforé (pâtisserie)',
  reference: 'RAY-ORG DE2026-133 — départ simple face FOND PERFORÉ',
  shelves: 4,
  color: '#b7c0c9',
};

const GONDOLE_H: Spec = {
  catalogId: 'gondole-double',
  name: 'Gondole centrale double face h.2200',
  reference: 'RAY-ORG DE2026-133 — 8 modules, 2 files de 4,03 ml',
  w: MODULE,
  d: DOUBLE_D,
  h: 2.2,
  shelves: 7,
};

const GONDOLE_B: Spec = {
  catalogId: 'gondole-double',
  name: 'Gondole centrale double face h.1500',
  reference: 'RAY-ORG DE2026-133 — 5 modules h.1500',
  w: MODULE,
  d: DOUBLE_D,
  h: 1.5,
  shelves: 4,
  color: '#9fa9b4',
};

const TG_H: Spec = {
  catalogId: 'tete-gondole',
  name: 'Tête de gondole h.2200',
  reference: 'RAY-ORG DE2026-133 — TG 1,03 ml simple face',
  w: 1.03,
  d: DOUBLE_D,
  h: 2.2,
  shelves: 7,
};

const TG_B: Spec = {
  ...TG_H,
  name: 'Tête de gondole h.1500',
  reference: 'RAY-ORG DE2026-133 — TG 1,03 ml h.1500',
  h: 1.5,
  shelves: 4,
};

// Froid — dossier technique EPTA / Bonnet Névé, offre 260710-6140B
const EIS_162: Spec = {
  catalogId: 'froid-negatif',
  name: 'Frais LS — IARP EIS 162 HP (3 portes)',
  reference: 'EPTA 260710-6140B rep.1A — 1875 × 786 × 2035, −1/+7 °C',
  w: 1.875,
  d: 0.786,
  h: 2.035,
  color: '#5b9bd5',
  shelves: 5,
};

const EIS_112: Spec = {
  catalogId: 'froid-negatif',
  name: 'Frais LS — IARP EIS 112 HP (2 portes)',
  reference: 'EPTA 260710-6140B rep.1B / 2 — 1250 × 786 × 2032, −1/+7 °C',
  w: 1.25,
  d: 0.786,
  h: 2.032,
  color: '#5b9bd5',
  shelves: 5,
};

const MULTIFREEZE: Spec = {
  catalogId: 'froid-negatif',
  name: 'Surgelés — Multifreeze Plus Efficia 3P',
  reference: 'EPTA 260710-6140B rep.3 — 2100 × 763 × 2033, −25/−23 °C',
  w: 2.1,
  d: 0.763,
  h: 2.033,
  color: '#3f7fb8',
  shelves: 7,
};

const CAISSE: Spec = {
  catalogId: 'meuble-caisse',
  name: 'Meuble caisse bi-optique L.1400',
  reference: 'TILT — meuble caisse bi-optique L:140',
  w: 1.4,
  d: 0.9,
  h: 0.95,
};

const ILOT_FL: Spec = {
  catalogId: 'meuble-promo',
  name: 'Îlot fruits et légumes H.155',
  reference: 'TILT — îlot F&L H.155, 2 ml, profondeur 60',
  w: 2.0,
  d: 1.0,
  h: 1.55,
  color: '#7cb342',
  shelves: 3,
};

const LOCKER: Spec = {
  catalogId: 'locker',
  name: 'Locker Amazon',
  reference: "Plan d'implantation — bandeau AMAZON, profondeur 60",
  w: 1.0,
  d: 0.6,
  h: 2.0,
};

const PRESSE: Spec = {
  catalogId: 'presentoir',
  name: 'Présentoir presse',
  reference: "Plan d'implantation — zone PRESSE en façade",
  w: 1.2,
  d: 0.5,
  h: 1.5,
  color: '#d94fa0',
  shelves: 4,
};

const RACK: Spec = {
  catalogId: 'reserve-rack',
  name: 'Rack de réserve',
  reference: 'Provisoire — à confirmer',
  w: 2.7,
  d: 1.1,
  h: 2.5,
};

// ------------------------------------------------------------------- montage

export function buildHagetmauProject(): Project {
  const walls: Wall[] = [];
  const openings: Opening[] = [];
  const columns: Column[] = [];
  const zones: Zone[] = [];
  const items: Item[] = [];

  // --- murs périphériques (relevé : 23,20 × 8,20 hors tout)
  const h = WALL / 2;
  const corners: Vec2[] = [
    { x: h, y: h },
    { x: EXT_W - h, y: h },
    { x: EXT_W - h, y: EXT_L - h },
    { x: h, y: EXT_L - h },
  ];
  for (let i = 0; i < 4; i++) {
    walls.push(wall(corners[i], corners[(i + 1) % 4], 'wall', WALL));
  }
  const frontWall = walls[2]; // tracé de (8,20 ; 23,10) vers (0,10 ; 23,10)

  // --- cloison de réserve + porte de service de 1,50 m (relevé)
  const partition = wall({ x: XL, y: PART_Y }, { x: XR, y: PART_Y }, 'partition', PART);
  walls.push(partition);
  openings.push(door(partition.id, 1.6, 1.5));

  // --- entrée client en façade (le mur de façade est tracé de droite à gauche)
  const entranceX = 5.6;
  openings.push(door(frontWall.id, EXT_W - h - entranceX, 1.8));

  // --- poteaux existants (relevé : sections 20 × 20 et 50 × 20)
  const col = (x: number, y: number, w: number, d: number, name: string) => ({
    id: uid('c'),
    kind: 'column' as const,
    shape: 'rect' as const,
    x,
    y,
    width: w,
    depth: d,
    height: 3,
    rotation: 0,
    existing: true,
    name,
  });
  columns.push(col(2.9, 5.38, 0.2, 0.2, 'Poteau existant'));
  columns.push(col(0.42, 13.38, 0.2, 0.2, 'Poteau existant'));
  columns.push(col(7.7, 2.01, 0.5, 0.2, 'Poteau existant (réserve)'));

  // ------------------------------------------------------------- la réserve
  zones.push(zone('reserve', XL, YB, XR - XL, RESERVE_DEPTH));
  items.push(put(RACK, XL + RACK.d / 2, YB + 1.6, 90));
  items.push(put(RACK, XL + RACK.d / 2, YB + 1.6 + RACK.w, 90));
  items.push(put(RACK, XR - RACK.d / 2, YB + 1.6, 90));

  // -------------------------------------------------------- surface de vente
  const salesH = YF - SALES_TOP;
  zones.push(zone('vente', XL, SALES_TOP, XR - XL, salesH));

  // --- fond de vente : lockers Amazon (plan d'implantation)
  for (let i = 0; i < 3; i++) {
    items.push(put(LOCKER, XL + 0.55 + LOCKER.w / 2 + i * LOCKER.w, SALES_TOP + LOCKER.d / 2, 0));
  }

  // --- mur droit, du fond vers la façade : surgelés, frais, mural, presse
  let y = SALES_TOP;
  y = runY(items, MULTIFREEZE, XR, 'right', y, 2); // 6 portes surgelés
  zones.push(zone('surgeles', XR - 0.9, SALES_TOP, 0.9, y - SALES_TOP));
  const fraisTop = y + 0.32;
  y = runY(items, EIS_162, XR, 'right', fraisTop, 2); // repère 1A
  y = runY(items, EIS_112, XR, 'right', y, 1); // repère 1B
  zones.push(zone('frais', XR - 0.9, fraisTop, 0.9, y - fraisTop));
  y = runY(items, MURAL, XR, 'right', y + 0.3, 5); // mural 5,03 ml
  // La presse se pose côté gauche en façade, face à l'entrée.
  items.push(put(PRESSE, XL + PRESSE.d / 2, YF - 1.0, 90));

  // --- mur gauche : mural 7,03, poteau, mural 3,03, frais rep.2, mural 1,03
  let yl = SALES_TOP + LOCKER.d;
  yl = runY(items, MURAL, XL, 'left', yl, 7); // 7,03 ml
  yl = runY(items, MURAL, XL, 'left', 13.9, 3); // 3,03 ml, après le poteau
  const rep2Top = yl + 0.3;
  yl = runY(items, EIS_112, XL, 'left', rep2Top, 1); // repère 2
  zones.push(zone('frais', XL, rep2Top, 0.9, yl - rep2Top, 'Frais (rep. 2)'));
  runY(items, MURAL_PERF, XL, 'left', yl + 0.3, 1); // 1,03 ml pâtisserie

  // --- gondoles centrales
  /** Pose une file : tête de gondole, modules, tête de gondole. */
  const gondolaRun = (axis: number, top: number, mod: Spec, tg: Spec, count: number): number => {
    let cy = top;
    items.push(put(tg, axis, cy + TG_LEN / 2, 90));
    cy += TG_LEN;
    for (let i = 0; i < count; i++) {
      items.push(put(mod, axis, cy + MODULE / 2, 90));
      cy += MODULE;
    }
    items.push(put(tg, axis, cy + TG_LEN / 2, 90));
    return cy + TG_LEN;
  };

  const highTop = 6.68;
  const highEnd = gondolaRun(RUN_A, highTop, GONDOLE_H, TG_H, 4);
  gondolaRun(RUN_B, highTop, GONDOLE_H, TG_H, 4);
  zones.push(zone('epicerie', RUN_A - 0.5, highTop, RUN_B - RUN_A + 1, highEnd - highTop));

  const lowTop = highEnd + 1.6; // allée transversale
  const lowEnd = gondolaRun(RUN_A, lowTop, GONDOLE_B, TG_B, 3);
  gondolaRun(RUN_B, lowTop, GONDOLE_B, TG_B, 2);

  // --- avant-magasin
  // L'îlot fruits et légumes occupe le centre de l'entrée de magasin : c'est
  // le premier univers rencontré, et il reste dégagé de tous côtés.
  const ilotY = 21.3;
  items.push(put(ILOT_FL, 3.95, ilotY, 0));
  zones.push(zone('fruits', 3.95 - 1.2, ilotY - 0.8, 2.4, 1.6));

  // Une seule caisse bi-optique, conformément au devis TILT, adossée au mur
  // droit face à la sortie. Le poste de l'hôte de caisse reste dégagé.
  items.push(put(CAISSE, XR - CAISSE.d / 2, 21.3, 90));
  zones.push(zone('caisse', XR - 2.6, YF - 3.0, 2.6, 3.0));

  items.push(
    put({ catalogId: 'panier', name: 'Paniers', w: 0.45, d: 0.35, h: 0.9 }, 5.0, YF - 0.6, 0),
  );
  items.push(
    put({ catalogId: 'chariot', name: 'Chariots', w: 0.6, d: 1.0, h: 1.0 }, 6.2, YF - 0.8, 0),
  );
  zones.push(zone('entree', entranceX - 1.2, YF - 2.4, 2.4, 2.4));
  zones.push(zone('circulation', XL, lowEnd + 0.1, XR - XL, 1.5, 'Allée principale'));

  // ------------------------------------------------------------- le projet
  const now = Date.now();
  return {
    id: uid('prj'),
    name: 'Panier Sympa — Hagetmau',
    createdAt: now,
    updatedAt: now,
    floor: { ...emptyFloor(), walls, openings, columns, zones, items },
    background: null,
    existing: {
      ...defaultExisting(),
      // Le carrelage existant est conservé : l'aménagement se pose dessus.
      carrelage: true,
      murs: true,
      portes: true,
      fenetres: true,
      carrelageColor: '#cfc9c0',
      carrelageTileSize: 0.6,
    },
    settings: {
      ...defaultSettings(),
      wallHeight: 3,
      defaultWallThickness: WALL,
      defaultPartitionThickness: PART,
      gridSize: 0.25,
      minAisleWidth: 1.4,
      showDimensions: true,
      showCirculation: false,
      floorColor: '#d8d3cb',
    },
  };
}
