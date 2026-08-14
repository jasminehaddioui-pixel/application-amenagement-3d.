import type { Column, Item, Opening, Project, Vec2, Wall, Zone, ZoneCategory } from '../../types';
import { defaultExisting, defaultSettings, emptyFloor } from '../../types';
import { catalogEntry } from '../catalog';
import { ZONE_PRESET_BY_CATEGORY } from '../zones';
import { uid } from '../geometry';

/**
 * Projet PANIER SYMPA — HAGETMAU (40700), monté à partir des documents fournis.
 *
 * SOURCES
 *  - Dossier Technique Amiante n° 25/1412/BARICOS (cabinet DTL, 15/06/2025),
 *    § 7.1 « Schéma de repérage — Local commercial RDC » : c'est LE document de
 *    coque. Il donne la cote hors œuvre 8,60 m en pignon, la longueur totale du
 *    bâtiment, et surtout la distribution réelle des locaux : bandeau de
 *    services au fond (Local tech / WC + Dégagement / Remise 1 / Remise 2 /
 *    Remise 3), Bureau 1 et Bureau 2 en retour à gauche, Magasin sur le reste.
 *    Ce schéma n'est PAS à l'échelle (le rapport longueur/largeur du dessin ne
 *    correspond pas aux cotes écrites) : il fixe la topologie, pas les mesures.
 *  - Relevé manuscrit « HAGETMAU » (plan_hagetmau_18_juin) : c'est lui qui donne
 *    l'échelle. Cotes 2320 (longueur dans œuvre), 820 (largeur dans œuvre),
 *    1600 (profondeur de la surface de vente depuis la façade), 1390 / 1000 /
 *    538-290 / 160 + 50 (implantation des poteaux), 150 (porte de service).
 *  - Plan d'implantation « hagetmau_2 » : allées 180 / 165 / 180, muraux
 *    profondeur 50, bandeau de lockers Amazon profondeur 60, presse en façade,
 *    entrée en pignon.
 *  - Devis RAY-ORG n° DE2026-133 (gondoles MAGO type Tegometall, occasion) :
 *    muraux h. 2200 en 7,03 + 3,03 + 6,03 + 1,03 ml, 8 modules centraux double
 *    face h. 2200 (2 files de 4,03), 4 têtes de gondole h. 2200, 5 modules
 *    centraux h. 1500 et leurs têtes. Module utile 1000 mm, tablette 1000 × 470,
 *    550 mm de profondeur hors tout en simple face, tête de gondole 1,03 ml.
 *  - Trame devis TILT : 1 meuble caisse bi-optique L 1400, 1 îlot fruits et
 *    légumes H 155 de 2 ml.
 *  - Dossier technique EPTA / Bonnet Névé, offre n° 260710-6140B : cotes hors
 *    tout exactes du froid (repères 1A, 1B, 2, 3).
 *
 * COMMENT LES DEUX PLANS SE RECOUPENT
 *  Le DTA cote 8,60 m hors œuvre en pignon ; le relevé cote 8,20 m dans œuvre.
 *  L'écart vaut exactement deux murs de 20 cm : les deux documents décrivent
 *  bien la même coque, l'un en extérieur, l'autre en intérieur. On retient donc
 *  8,60 × 23,60 hors œuvre, soit 8,20 × 23,20 dans œuvre.
 *  Le relevé place la limite vente / arrière à 16,00 m de la façade, et les
 *  poteaux P2 et P4 tombent tous les deux sur cette ligne : ce sont eux qui
 *  portent le refend. La zone arrière fait donc 23,20 − 16,00 = 7,20 m, ce qui
 *  laisse la place au bandeau de services (2,45 m, profondeur relevée sur
 *  l'autre schéma) et aux deux bureaux, exactement comme au DTA.
 *  Le plan d'implantation annonçait 18,77 m de vente et 160 m² : cette cote-là
 *  ignorait la zone arrière réelle et n'a pas été retenue.
 *
 * ÉCARTS ASSUMÉS
 *  - Muraux : 15 modules posés (15,00 ml) contre 17,12 ml au devis. Les poteaux
 *    P1, P4, P5, la gaine technique et la porte de service coupent le linéaire.
 *  - Gondoles h.1500 : 3 modules posés sur les 5 du devis. Le poteau P3 tombe au
 *    milieu de la file A et interdit d'y développer une travée complète.
 *  - Froid : 10 portes positives et 6 négatives, conformément au dossier EPTA
 *    (10/07), plus récent que le plan d'implantation (12 + 6).
 *
 * Toutes les cotes sont en mètres. Les éléments de structure sont marqués
 * « existant » : ils apparaissent en vert et l'aménagement se construit autour.
 */

// ------------------------------------------------------------------ la coque

const WALL = 0.2; // murs périphériques
const PART = 0.1; // cloisons intérieures
const EXT_W = 8.6; // largeur hors œuvre (DTA)
const EXT_L = 23.6; // longueur hors œuvre (relevé 23,20 dans œuvre + 2 murs)

/** Faces intérieures de la coque. */
const XL = WALL; // 0,20
const XR = EXT_W - WALL; // 8,40
const YB = WALL; // 0,20 — fond du bâtiment
const YF = EXT_L - WALL; // 23,40 — façade sur rue

/** Cotes du relevé, mesurées depuis la façade. */
const fromFront = (d: number) => YF - d;

const SALES_DEPTH = 16.0; // relevé
const PART_Y = fromFront(SALES_DEPTH); // 7,40 — axe du refend vente / arrière
const SALES_TOP = PART_Y + PART / 2; // 7,45 — face vente du refend

/** Bandeau de services au fond (profondeur relevée sur l'autre schéma). */
const BAND_DEPTH = 2.45;
const BAND_Y = YB + BAND_DEPTH + PART / 2; // 2,70 — axe de la cloison du bandeau
const BAND_FACE = BAND_Y + PART / 2; // 2,75 — face réserve

/**
 * Refends du bandeau. Les largeurs suivent les proportions du schéma DTA
 * ramenées aux 8,20 m dans œuvre du relevé.
 */
const BAND_X = [2.05, 3.25, 4.8, 6.35];
const WC_Y = 1.45; // séparation WC (au fond) / dégagement

/** Bloc bureaux, en retour à gauche (1,90 m de large, cote 190 du relevé). */
const OFF_X = 2.15; // cloison verticale des bureaux
const OFF_Y1 = 4.25; // haut du Bureau 1
const OFF_Y2 = 5.85; // Bureau 1 / Bureau 2

// Files de gondoles centrales. Les axes sont calés sur les meubles les plus
// profonds de chaque rive (froid 786 mm à droite, froid 786 mm à gauche pour le
// repère 2) pour que les trois allées soient égales et jamais sous 1,50 m.
const RUN_A = 3.04;
const RUN_B = 5.58;

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
 * adossés à la face intérieure `xFace`, depuis `from`. Renvoie l'ordonnée d'arrivée.
 */
function runY(out: Item[], s: Spec, xFace: number, side: 'left' | 'right', from: number, count: number): number {
  const cx = side === 'left' ? xFace + s.d / 2 : xFace - s.d / 2;
  let y = from;
  for (let i = 0; i < count; i++) {
    out.push(put(s, cx, y + s.w / 2, 90));
    y += s.w;
  }
  return y;
}

/** Idem le long de l'axe X, adossé à la face `yFace` (meubles non tournés). */
function runX(out: Item[], s: Spec, yFace: number, side: 'top' | 'bottom', from: number, count: number): number {
  const cy = side === 'top' ? yFace + s.d / 2 : yFace - s.d / 2;
  let x = from;
  for (let i = 0; i < count; i++) {
    out.push(put(s, x + s.w / 2, cy, 0));
    x += s.w;
  }
  return x;
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
  reference: 'RAY-ORG DE2026-133 — modules h.1500',
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
  w: TG_LEN,
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
  reference: 'TILT — îlot F&L H.155, 2 ml',
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
  reference: 'Rayonnage lourd — à chiffrer',
  w: 2.7,
  d: 1.1,
  h: 2.5,
};

const BUREAU: Spec = {
  catalogId: 'comptoir',
  name: 'Bureau',
  reference: 'Mobilier existant',
  w: 1.4,
  d: 0.7,
  h: 0.75,
  color: '#7d6a55',
};

// ------------------------------------------------------------------- montage

export function buildHagetmauProject(): Project {
  const walls: Wall[] = [];
  const openings: Opening[] = [];
  const columns: Column[] = [];
  const zones: Zone[] = [];
  const items: Item[] = [];

  // --- murs périphériques : 8,60 × 23,60 hors œuvre
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
  const frontWall = walls[2]; // tracé de (8,50 ; 23,50) vers (0,10 ; 23,50)

  // --- entrée client en pignon sur rue (le mur de façade est tracé de droite à gauche)
  const entranceX = 5.6;
  openings.push(door(frontWall.id, EXT_W - h - entranceX, 1.8));

  // ------------------------------------------------------- cloisonnement DTA

  // Refend vente / arrière, à 16,00 m de la façade (relevé), porte de 1,50 m.
  const partition = wall({ x: XL, y: PART_Y }, { x: XR, y: PART_Y }, 'partition', PART);
  walls.push(partition);
  const serviceDoorX = 7.55; // à droite, dans l'axe de l'allée du froid
  openings.push(door(partition.id, serviceDoorX - XL, 1.5));

  // Bandeau de services au fond : Local tech / WC + Dégagement / Remise 1 / 2 / 3
  const bandWall = wall({ x: XL, y: BAND_Y }, { x: XR, y: BAND_Y }, 'partition', PART);
  walls.push(bandWall);
  const bandRooms: Array<[number, number, string, ZoneCategory]> = [
    [XL, BAND_X[0] - PART / 2, 'Local technique', 'autre'],
    [BAND_X[0] + PART / 2, BAND_X[1] - PART / 2, 'Dégagement', 'circulation'],
    [BAND_X[1] + PART / 2, BAND_X[2] - PART / 2, 'Remise 1', 'reserve'],
    [BAND_X[2] + PART / 2, BAND_X[3] - PART / 2, 'Remise 2', 'reserve'],
    [BAND_X[3] + PART / 2, XR, 'Remise 3', 'reserve'],
  ];
  for (const x of BAND_X) {
    walls.push(wall({ x, y: YB }, { x, y: BAND_Y }, 'partition', PART));
  }
  // Une porte de 0,90 m par local, prise dans la cloison du bandeau.
  for (const [x0, x1] of bandRooms) {
    openings.push(door(bandWall.id, (x0 + x1) / 2 - XL, 0.9));
  }
  // Le WC est isolé au fond de son compartiment, le dégagement le dessert.
  const wcWall = wall(
    { x: BAND_X[0], y: YB + WC_Y },
    { x: BAND_X[1], y: YB + WC_Y },
    'partition',
    PART,
  );
  walls.push(wcWall);
  openings.push(door(wcWall.id, (BAND_X[1] - BAND_X[0]) / 2, 0.7));

  // Bloc bureaux en retour à gauche (DTA), 1,90 m de large (cote 190 du relevé).
  const officeWall = wall({ x: OFF_X, y: OFF_Y1 }, { x: OFF_X, y: PART_Y }, 'partition', PART);
  walls.push(officeWall);
  const off1Wall = wall({ x: XL, y: OFF_Y1 }, { x: OFF_X, y: OFF_Y1 }, 'partition', PART);
  walls.push(off1Wall);
  openings.push(door(off1Wall.id, 1.0, 0.9));
  const off2Wall = wall({ x: XL, y: OFF_Y2 }, { x: OFF_X, y: OFF_Y2 }, 'partition', PART);
  walls.push(off2Wall);
  openings.push(door(off2Wall.id, 1.0, 0.9));

  // ------------------------------------------------------ poteaux du relevé

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
  // Distances relevées le long du bâtiment depuis le pignon d'entrée, et en
  // travers depuis le mur gauche. P2 et P4 tombent exactement sur la ligne des
  // 16,00 m : ce sont eux qui portent le refend de la réserve.
  columns.push(col(XL + 0.1, fromFront(13.31), 0.2, 0.2, 'Poteau P1 — 13,31 m, contre mur gauche'));
  columns.push(col(XL + 0.1, fromFront(16.0), 0.2, 0.2, 'Poteau P2 — 16,00 m, contre mur gauche'));
  columns.push(col(XL + 2.9, fromFront(5.38), 0.2, 0.2, 'Poteau P3 — 5,38 m / 2,90 m'));
  columns.push(col(XL + 4.95, fromFront(16.0), 0.2, 0.2, 'Poteau P4 — 16,00 m / 4,95 m'));
  columns.push(col(XR - 0.1, fromFront(1.85), 0.2, 0.5, 'Poteau P5 — 1,85 m, contre mur droit (50 × 20)'));
  columns.push(col(XR - 0.35, fromFront(10.0), 0.7, 1.1, 'Gaine technique — 10,00 m, 110 × 70'));

  // -------------------------------------------------------- locaux du fond

  for (const [x0, x1, name, cat] of bandRooms) {
    // Le compartiment sanitaire est coupé en deux : WC au fond, dégagement devant.
    const top = name === 'Dégagement' ? YB + WC_Y + PART / 2 : YB;
    zones.push(zone(cat, x0, top, x1 - x0, BAND_Y - PART / 2 - top, name));
  }
  zones.push(
    zone('hygiene', BAND_X[0] + PART / 2, YB, BAND_X[1] - BAND_X[0] - PART, WC_Y - PART / 2, 'WC'),
  );

  // Réserve : tout ce qui reste entre le bandeau et le refend de vente.
  zones.push(zone('reserve', OFF_X + PART / 2, BAND_FACE, XR - OFF_X - PART / 2, PART_Y - PART / 2 - BAND_FACE));
  zones.push(zone('reserve', XL, BAND_FACE, OFF_X - PART / 2 - XL, OFF_Y1 - PART / 2 - BAND_FACE));
  zones.push(zone('autre', XL, OFF_Y1 + PART / 2, OFF_X - PART / 2 - XL, OFF_Y2 - OFF_Y1 - PART, 'Bureau 1'));
  zones.push(zone('autre', XL, OFF_Y2 + PART / 2, OFF_X - PART / 2 - XL, PART_Y - PART / 2 - OFF_Y2 - PART / 2, 'Bureau 2'));

  // Racks de réserve, disposés pour laisser une allée de manutention en U.
  items.push(put(RACK, XR - RACK.d / 2, BAND_FACE + 0.05 + RACK.w / 2, 90));
  items.push(put(RACK, OFF_X + PART / 2 + 0.05 + RACK.w / 2, BAND_FACE + 0.05 + RACK.d / 2, 0));
  items.push(put(RACK, OFF_X + PART / 2 + 0.05 + RACK.w / 2, PART_Y - PART / 2 - 0.05 - RACK.d / 2, 0));
  items.push(put(BUREAU, XL + 1.0, OFF_Y1 + PART / 2 + 0.45, 0));
  items.push(put(BUREAU, XL + 1.0, OFF_Y2 + PART / 2 + 0.45, 0));

  // -------------------------------------------------------- surface de vente

  zones.push(zone('vente', XL, SALES_TOP, XR - XL, YF - SALES_TOP));

  // --- fond de vente : lockers Amazon puis muraux, coupés par P4 et la porte
  // Le bandeau démarre après le poteau P2, qui tient l'angle du refend.
  runX(items, LOCKER, SALES_TOP, 'top', XL + 0.3, 3); // 0,50 → 3,50
  runX(items, MURAL, SALES_TOP, 'top', 3.6, 1); // s'arrête avant P4
  runX(items, MURAL, SALES_TOP, 'top', 5.35, 1); // reprend après P4, avant la porte

  // --- mur droit, du fond vers la façade : surgelés, gaine, frais, presse
  // On démarre sous le bandeau du fond pour ne pas rétrécir l'allée de tête.
  const surgTop = 8.15;
  let y = runY(items, MULTIFREEZE, XR, 'right', surgTop, 2); // 6 portes surgelés
  zones.push(zone('surgeles', XR - 0.9, surgTop, 0.9, y - surgTop));
  // La gaine technique relevée à 10,00 m de la façade coupe le linéaire ; le
  // froid positif reprend au-delà.
  const fraisTop = 14.05;
  y = runY(items, EIS_162, XR, 'right', fraisTop, 2); // repère 1A — 6 portes
  y = runY(items, EIS_112, XR, 'right', y + 0.1, 1); // repère 1B — 2 portes
  zones.push(zone('frais', XR - 0.9, fraisTop, 0.9, y - fraisTop));
  items.push(put(PRESSE, XR - PRESSE.d / 2, y + 0.1 + PRESSE.w / 2, 90));

  // --- mur gauche : muraux coupés par P1, frais repère 2, pâtisserie
  let yl = runY(items, MURAL, XL, 'left', 8.15, 1); // entre les lockers et P1
  yl = runY(items, MURAL, XL, 'left', 10.3, 7); // 7,03 ml du devis
  const rep2Top = yl + 0.1;
  yl = runY(items, EIS_112, XL, 'left', rep2Top, 1); // repère 2 — 2 portes
  zones.push(zone('frais', XL, rep2Top, 0.9, yl - rep2Top, 'Frais (rep. 2)'));
  yl = runY(items, MURAL_PERF, XL, 'left', yl + 0.1, 1); // 1,03 ml pâtisserie
  yl = runY(items, MURAL, XL, 'left', yl + 0.1, 2);

  // --- gondoles centrales
  /** Pose une travée : tête de gondole, modules, tête de gondole. */
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

  const highTop = 9.45; // 1,40 m d'allée derrière, devant les lockers
  const highEnd = gondolaRun(RUN_A, highTop, GONDOLE_H, TG_H, 4);
  gondolaRun(RUN_B, highTop, GONDOLE_H, TG_H, 4);
  zones.push(zone('epicerie', RUN_A - 0.5, highTop, RUN_B - RUN_A + 1, highEnd - highTop));

  // Allée transversale de 1,50 m, puis la travée basse côté façade : depuis
  // l'entrée on voit les caisses et la sortie par-dessus.
  // Le poteau P3 (y = 18,02) tombe au milieu de la file A : celle-ci s'arrête à
  // l'allée transversale et la travée basse ne se développe que sur la file B.
  const lowTop = highEnd + 1.5;
  const lowEnd = gondolaRun(RUN_B, lowTop, GONDOLE_B, TG_B, 2);
  zones.push(zone('promo', RUN_B - 0.6, lowTop, 1.2, lowEnd - lowTop, 'Gondoles basses'));

  // --- avant-magasin
  // L'îlot fruits et légumes est le premier univers rencontré en entrant : on
  // le pose à gauche de l'entrée, dans le dégagement laissé par la file A.
  const ilotX = XL + 0.2 + ILOT_FL.w / 2;
  items.push(put(ILOT_FL, ilotX, YF - ILOT_FL.d / 2, 0));
  zones.push(zone('fruits', XL, YF - 2.4, 2.8, 2.4));

  // Une seule caisse bi-optique, conformément au devis TILT, à droite de
  // l'entrée et dégagée du poteau P5.
  const caisseX = XR - CAISSE.w / 2;
  items.push(put(CAISSE, caisseX, YF - 0.2 - CAISSE.d / 2, 0));
  zones.push(zone('caisse', caisseX - 1.1, YF - 1.7, 2.2, 1.7));

  items.push(
    put({ catalogId: 'panier', name: 'Paniers', w: 0.45, d: 0.35, h: 0.9 }, 3.3, YF - 0.3, 0),
  );
  items.push(
    put({ catalogId: 'chariot', name: 'Chariots', w: 0.6, d: 1.0, h: 1.0 }, 6.9, YF - 2.6, 0),
  );
  zones.push(zone('entree', entranceX - 0.9, YF - 2.2, 1.8, 2.2));
  zones.push(zone('circulation', XL, highEnd, XR - XL, 1.5, 'Allée transversale'));

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
