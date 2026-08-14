import type { Column, Item, Opening, Project, Vec2, Wall, Zone, ZoneCategory } from '../../types';
import { defaultExisting, defaultSettings, emptyFloor } from '../../types';
import { catalogEntry } from '../catalog';
import { ZONE_PRESET_BY_CATEGORY } from '../zones';
import { uid } from '../geometry';

/**
 * Projet PANIER SYMPA — HAGETMAU (40700).
 * Bâtiment complet monté à l'échelle à partir des documents du projet.
 *
 * SOURCES
 *  - Plan coté du local (tirage « Prévoir défoncement du dallage des chambres
 *    froides »). C'est le document de référence pour la COQUE. Il donne :
 *      · la chaîne de cotes du mur du fond, de gauche à droite —
 *        20 | 3,00 | 35 | 1,45 | 35 | 3,15 | 25 | 3,15 | 35 | labo | 20 —
 *        soit GROUPES, sanitaires, C.F. CRÈMERIE, C.F. BOUCHERIE, LABO ;
 *      · la chaîne du mur gauche — 2,45 | 23 | 2,70 | 38 | 2,70 | 38 | 2,70 | 38 —
 *        soit un bandeau de locaux de 2,45 m de profondeur au fond, puis trois
 *        travées de 2,70 m séparées par des contreforts de 38 cm ;
 *      · la forme en L : l'aile gauche s'arrête au mur biais du bas, le magasin
 *        continue seul jusqu'à la rue.
 *  - Relevé manuscrit « HAGETMAU », reporté au crayon sur ce même plan. Il cote
 *    le magasin : 800 de large, 2320 de long, 1600 de vente depuis la façade,
 *    1390 / 1000 / 538-290 / 160 + 50 / 110 × 70 pour les poteaux et la gaine,
 *    150 pour la porte de service.
 *  - Dossier Technique Amiante n° 25/1412/BARICOS § 7.1 : confirme la
 *    distribution (locaux au fond, bureaux en retour, magasin sur le reste).
 *  - Plan d'implantation « hagetmau_2 » : lockers Amazon, presse, entrée en
 *    pignon, largeurs d'allées visées.
 *  - Devis RAY-ORG n° DE2026-133 : muraux h. 2200 (module 1000, profondeur 550,
 *    17,12 ml au total), 8 modules centraux double face h. 2200, 4 têtes de
 *    gondole 1,03 ml, modules et têtes h. 1500.
 *  - Trame devis TILT : caisse bi-optique L 1400, îlot fruits et légumes H 155.
 *  - Dossier technique EPTA n° 260710-6140B : cotes hors tout du froid.
 *
 * GÉOMÉTRIE RETENUE (dans œuvre, murs de 20 cm)
 *  - Bandeau de locaux au fond : 2,45 m de profondeur, sur toute la largeur.
 *  - Aile gauche : 8,00 m de large, trois travées de 2,70 m entre contreforts,
 *    fermée au sud par le mur biais.
 *  - Magasin : 8,00 × 23,20 m, réserve de 7,00 m au fond, 16,00 m de vente
 *    jusqu'à la façade — exactement la cote 1600 du relevé.
 *  - Largeur totale 16,20 m dans œuvre, longueur 26,05 m.
 *
 * TRAITEMENT DES POTEAUX
 *  Les poteaux ne coupent plus le linéaire : quand un poteau tombe dans
 *  l'emprise d'un meuble, le meuble est posé de façon à l'englober — c'est
 *  l'habillage de poteau, pratique courante en agencement. P1, P3 et P5 sont
 *  ainsi habillés, respectivement par un mural, un module de gondole basse et
 *  un mural. Seule la gaine technique (110 × 70) reste contournée : on ne
 *  coffre pas une gaine dans un meuble frigorifique.
 *
 * Toutes les cotes sont en mètres. Les éléments de structure sont marqués
 * « existant » : ils apparaissent en vert et l'aménagement se construit autour.
 */

// ------------------------------------------------------------------ la coque

const WALL = 0.2;
const PART = 0.1;

/** Faces intérieures. X vers la droite, Y du fond vers la rue. */
const XL = WALL; //  0,20 — mur gauche
const XR = 16.4; // 16,40 — mur droit
const YB = WALL; //  0,20 — mur du fond

/** Bandeau de locaux du fond (chaîne de cotes du mur gauche : 2,45 puis 23). */
const BAND_DEPTH = 2.45;
const BAND_Y = YB + BAND_DEPTH; // 2,65 — nu du bandeau
const BACK_FACE = BAND_Y + WALL; // 2,85 — nu sud du mur du bandeau

/** Refends du bandeau, chaîne de cotes du mur du fond. */
const ROOMS: Array<[number, number, string, ZoneCategory]> = [
  [0.2, 3.2, 'Groupes froids', 'autre'],
  [3.55, 5.0, 'Sanitaires', 'hygiene'],
  [5.35, 8.5, 'C.F. Crèmerie', 'frais'],
  [8.75, 11.9, 'C.F. Boucherie', 'frais'],
  [12.25, 16.4, 'Laboratoire', 'autre'],
];

/** Aile gauche : 8,00 m de large, refendue du magasin. */
const WING_R = 8.2; // nu droit de l'aile
const SHOP_L = 8.4; // nu gauche du magasin
const WING_ROOM_R = 5.55; // cloison des réserves de l'aile
const WING_MID = 5.5; // refend horizontal entre les deux réserves
const WING_END = 12.0; // fond du dégagement, avant le mur biais

/** Magasin : 8,00 × 23,20 (relevé). */
const YF = BACK_FACE + 23.2; // 26,05 — façade sur rue
const SALES_DEPTH = 16.0; // cote 1600 du relevé
const SALES_TOP = YF - SALES_DEPTH; // 10,05 — nu vente du refend
const PART_Y = SALES_TOP - WALL / 2; // 9,95 — axe du refend

const EXT_W = XR + WALL; // 16,60 hors œuvre
const EXT_L = YF + WALL; // 26,25 hors œuvre

/** Cotes du relevé, mesurées depuis la façade du magasin. */
const fromFront = (d: number) => YF - d;

// Files de gondoles centrales. Les axes sont calés sur les meubles les plus
// profonds de chaque rive (froid 786 mm des deux côtés) : trois allées égales.
const LEFT_FACE = SHOP_L + 0.786;
const RIGHT_FACE = XR - 0.786;
const AISLE = (RIGHT_FACE - LEFT_FACE - 2) / 3; // 1,476
const RUN_A = LEFT_FACE + AISLE + 0.5;
const RUN_B = RUN_A + 1 + AISLE;

const MODULE = 1.0; // module de gondole (devis RAY-ORG)
// Le long de la file, une tête de gondole occupe sa LARGEUR (1,03 ml au devis).
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

/** File de meubles le long de l'axe Y, adossée à la face `xFace`. */
function runY(out: Item[], s: Spec, xFace: number, side: 'left' | 'right', from: number, count: number): number {
  const cx = side === 'left' ? xFace + s.d / 2 : xFace - s.d / 2;
  let y = from;
  for (let i = 0; i < count; i++) {
    out.push(put(s, cx, y + s.w / 2, 90));
    y += s.w;
  }
  return y;
}

/** File de meubles le long de l'axe X, adossée à la face `yFace`. */
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

const CF_RACK: Spec = {
  catalogId: 'etagere',
  name: 'Rayonnage inox chambre froide',
  reference: 'Plan du local — C.F. existante',
  w: 1.2,
  d: 0.5,
  h: 1.8,
  color: '#9fb6c4',
  shelves: 4,
};

const PLAN_TRAVAIL: Spec = {
  catalogId: 'comptoir',
  name: 'Plan de travail inox',
  reference: 'Plan du local — LABO',
  w: 2.0,
  d: 0.7,
  h: 0.9,
  color: '#93a3ad',
};

const GROUPE: Spec = {
  catalogId: 'locker',
  name: 'Groupe frigorifique',
  reference: 'Plan du local — local GROUPES',
  w: 1.2,
  d: 0.8,
  h: 1.8,
  color: '#6b7b88',
};

// ------------------------------------------------------------------- montage

export function buildHagetmauProject(): Project {
  const walls: Wall[] = [];
  const openings: Opening[] = [];
  const columns: Column[] = [];
  const zones: Zone[] = [];
  const items: Item[] = [];

  const h = WALL / 2;

  // --- enveloppe : rectangle 16,60 × 26,25 hors œuvre
  const corners: Vec2[] = [
    { x: h, y: h },
    { x: EXT_W - h, y: h },
    { x: EXT_W - h, y: EXT_L - h },
    { x: h, y: EXT_L - h },
  ];
  for (let i = 0; i < 4; i++) {
    walls.push(wall(corners[i], corners[(i + 1) % 4], 'wall', WALL));
  }
  const frontWall = walls[2]; // tracé de droite à gauche

  // Entrée client en pignon sur rue, dans l'axe du magasin.
  const entranceX = 12.0;
  openings.push(door(frontWall.id, EXT_W - h - entranceX, 1.8));

  // --- mur biais qui ferme l'aile gauche au sud (hachuré au plan)
  walls.push(wall({ x: h, y: WING_END + 1.1 }, { x: SHOP_L - h, y: WING_END + 0.1 }, 'wall', WALL));

  // ------------------------------------------------- bandeau de locaux du fond
  const bandWall = wall({ x: XL, y: BAND_Y + h }, { x: XR, y: BAND_Y + h }, 'wall', WALL);
  walls.push(bandWall);
  for (const [x0, x1, name, cat] of ROOMS) {
    zones.push(zone(cat, x0, YB, x1 - x0, BAND_DEPTH, name));
    // Refend gauche du local (sauf pour le premier, adossé au mur pignon).
    if (x0 > XL) walls.push(wall({ x: x0 - 0.15, y: YB }, { x: x0 - 0.15, y: BAND_Y }, 'partition', 0.3));
    openings.push(door(bandWall.id, (x0 + x1) / 2 - XL, name.startsWith('C.F.') ? 1.2 : 0.9));
  }

  // ------------------------------------------------------------- aile gauche
  const wingWall = wall({ x: WING_R + h, y: BACK_FACE }, { x: WING_R + h, y: WING_END + 0.6 }, 'wall', WALL);
  walls.push(wingWall);
  openings.push(door(wingWall.id, 1.4, 1.5)); // liaison aile / réserve du magasin

  const wingSplit = wall({ x: WING_ROOM_R, y: BACK_FACE }, { x: WING_ROOM_R, y: WING_END }, 'partition', PART);
  walls.push(wingSplit);
  const wingMid = wall({ x: XL, y: WING_MID }, { x: WING_ROOM_R, y: WING_MID }, 'partition', PART);
  walls.push(wingMid);
  openings.push(door(wingSplit.id, 1.3, 1.0));
  openings.push(door(wingSplit.id, 6.0, 1.0));

  // Contreforts du mur gauche : trois travées de 2,70 séparées par 38 cm.
  const buttress = (y: number) => ({
    id: uid('c'),
    kind: 'column' as const,
    shape: 'rect' as const,
    x: XL + 0.1,
    y: y + 0.19,
    width: 0.2,
    depth: 0.38,
    height: 3,
    rotation: 0,
    existing: true,
    name: `Contrefort — travée de 2,70 m`,
  });
  for (let i = 0; i < 3; i++) columns.push(buttress(BACK_FACE + 2.7 + i * 3.08));

  zones.push(zone('reserve', XL, BACK_FACE, WING_ROOM_R - PART / 2 - XL, WING_MID - PART / 2 - BACK_FACE, 'Réserve 1'));
  zones.push(zone('reserve', XL, WING_MID + PART / 2, WING_ROOM_R - PART / 2 - XL, WING_END - WING_MID - PART / 2, 'Réserve 2'));
  zones.push(zone('circulation', WING_ROOM_R + PART / 2, BACK_FACE, WING_R - WING_ROOM_R - PART / 2, WING_END - BACK_FACE, 'Dégagement'));

  // ------------------------------------------------------ réserve du magasin
  const partition = wall({ x: SHOP_L, y: PART_Y }, { x: XR, y: PART_Y }, 'wall', WALL);
  walls.push(partition);
  const serviceDoorX = 9.95; // porte de service de 1,50 m (relevé)
  openings.push(door(partition.id, serviceDoorX - SHOP_L, 1.5));
  zones.push(zone('reserve', SHOP_L, BACK_FACE, XR - SHOP_L, PART_Y - h - BACK_FACE, 'Réserve magasin'));

  // ------------------------------------------------- poteaux relevés au plan
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
  columns.push(col(SHOP_L + 0.1, fromFront(13.31), 0.2, 0.2, 'Poteau P1 — 13,31 m, contre mur gauche'));
  columns.push(col(SHOP_L + 0.1, fromFront(16.0), 0.2, 0.2, 'Poteau P2 — 16,00 m, contre mur gauche'));
  columns.push(col(SHOP_L + 2.9, fromFront(5.38), 0.2, 0.2, 'Poteau P3 — 5,38 m / 2,90 m'));
  columns.push(col(SHOP_L + 4.95, fromFront(16.0), 0.2, 0.2, 'Poteau P4 — 16,00 m / 4,95 m'));
  columns.push(col(XR - 0.1, fromFront(1.85), 0.2, 0.5, 'Poteau P5 — 1,85 m, contre mur droit (50 × 20)'));
  columns.push(col(XR - 0.35, fromFront(10.0), 0.7, 1.1, 'Gaine technique — 10,00 m, 110 × 70'));

  // ------------------------------------------------- mobilier des arrières
  // Groupes froids, laboratoire, chambres froides : le local est équipé.
  items.push(put(GROUPE, 1.0, YB + 0.5, 0));
  items.push(put(GROUPE, 2.4, YB + 0.5, 0));
  items.push(put(PLAN_TRAVAIL, 13.4, YB + 0.4, 0));
  for (const [x0, , name] of ROOMS) {
    if (!name.startsWith('C.F.')) continue;
    runX(items, CF_RACK, YB, 'top', x0 + 0.15, 2);
  }
  // Racks. Dans l'aile, ils restent à l'écart des contreforts du mur gauche :
  // à plat au fond de la Réserve 1, le long de la cloison dans la Réserve 2.
  items.push(put(RACK, XL + 0.1 + RACK.w / 2, BACK_FACE + 0.1 + RACK.d / 2, 0));
  const wingRackX = WING_ROOM_R - PART / 2 - RACK.d / 2;
  items.push(put(RACK, wingRackX, WING_MID + PART / 2 + 0.15 + RACK.w / 2, 90));
  items.push(put(RACK, wingRackX, WING_MID + PART / 2 + 0.25 + RACK.w * 1.5, 90));
  items.push(put(RACK, XL + 0.1 + RACK.w / 2, 6.15 + RACK.d / 2, 0));
  items.push(put(RACK, XR - RACK.d / 2, BACK_FACE + 0.15 + RACK.w / 2, 90));
  items.push(put(RACK, SHOP_L + 0.15 + RACK.w / 2, PART_Y - h - 0.15 - RACK.d / 2, 0));

  // -------------------------------------------------------- surface de vente
  zones.push(zone('vente', SHOP_L, SALES_TOP, XR - SHOP_L, YF - SALES_TOP));

  // --- fond de vente : lockers Amazon puis muraux, en dégageant le poteau P4
  runX(items, LOCKER, SALES_TOP, 'top', 10.9, 2);
  runX(items, MURAL, SALES_TOP, 'top', 13.5, 2);

  // --- mur droit : surgelés, gaine technique contournée, frais, muraux
  const surgTop = SALES_TOP + 0.9;
  let y = runY(items, MULTIFREEZE, XR, 'right', surgTop, 2); // 6 portes surgelés
  zones.push(zone('surgeles', XR - 0.9, surgTop, 0.9, y - surgTop));
  const fraisTop = fromFront(10.0) + 0.55 + 0.1; // reprise après la gaine
  y = runY(items, EIS_162, XR, 'right', fraisTop, 2); // repère 1A — 6 portes
  y = runY(items, EIS_112, XR, 'right', y + 0.1, 1); // repère 1B — 2 portes
  zones.push(zone('frais', XR - 0.9, fraisTop, 0.9, y - fraisTop));
  // Les trois derniers muraux habillent le poteau P5 (le module 23,80–24,80
  // englobe le poteau, coté 1,85 m de la façade sur 50 cm).
  runY(items, MURAL, XR, 'right', y + 0.1, 3);

  // --- mur gauche : muraux (le 3e habille le poteau P1), frais repère 2,
  // pâtisserie, puis la fin du linéaire jusqu'à la presse.
  let yl = runY(items, MURAL, SHOP_L, 'left', SALES_TOP + 0.1, 7);
  const rep2Top = yl + 0.1;
  yl = runY(items, EIS_112, SHOP_L, 'left', rep2Top, 1); // repère 2 — 2 portes
  zones.push(zone('frais', SHOP_L, rep2Top, 0.9, yl - rep2Top, 'Frais (rep. 2)'));
  yl = runY(items, MURAL_PERF, SHOP_L, 'left', yl + 0.1, 1); // pâtisserie
  yl = runY(items, MURAL, SHOP_L, 'left', yl + 0.1, 5);

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

  // Les deux travées hautes du devis : 2 files de 4 modules et 4 têtes.
  const highTop = 12.06;
  const highEnd = gondolaRun(RUN_A, highTop, GONDOLE_H, TG_H, 4);
  gondolaRun(RUN_B, highTop, GONDOLE_H, TG_H, 4);
  zones.push(zone('epicerie', RUN_A - 0.5, highTop, RUN_B - RUN_A + 1, highEnd - highTop));

  // Allée transversale de 1,40 m, puis les travées basses côté façade. Le
  // premier module de la file A tombe sur le poteau P3 et l'habille.
  const lowTop = highEnd + 1.4;
  const lowEnd = gondolaRun(RUN_A, lowTop, GONDOLE_B, TG_B, 2);
  gondolaRun(RUN_B, lowTop, GONDOLE_B, TG_B, 2);
  zones.push(zone('promo', RUN_A - 0.5, lowTop, RUN_B - RUN_A + 1, lowEnd - lowTop, 'Gondoles basses'));
  zones.push(zone('circulation', SHOP_L, highEnd, XR - SHOP_L, 1.4, 'Allée transversale'));

  // ---------------------------------------------------------- avant-magasin
  // L'îlot fruits et légumes est le premier univers rencontré en entrant.
  items.push(put(ILOT_FL, SHOP_L + 0.2 + ILOT_FL.w / 2, YF - ILOT_FL.d / 2, 0));
  zones.push(zone('fruits', SHOP_L, YF - 2.4, 2.6, 2.4));

  // Presse et caisse encadrent la sortie, à droite de l'entrée.
  items.push(put(PRESSE, 13.9, YF - PRESSE.d / 2, 0));
  items.push(put(CAISSE, XR - CAISSE.w / 2, YF - 0.45, 0));
  zones.push(zone('caisse', XR - 2.2, YF - 1.7, 2.2, 1.7));

  items.push(
    put({ catalogId: 'panier', name: 'Paniers', w: 0.45, d: 0.35, h: 0.9 }, 10.85, YF - 0.3, 0),
  );
  items.push(
    put({ catalogId: 'chariot', name: 'Chariots', w: 0.6, d: 1.0, h: 1.0 }, 13.4, YF - 1.85, 0),
  );
  zones.push(zone('entree', entranceX - 0.9, YF - 2.2, 1.8, 2.2));

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
