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

/** Profondeurs hors tout du mobilier de rayonnage (devis RAY-ORG). */
const MURAL_D_CONST = 0.55;
const DOUBLE_D_CONST = 1.0;

/**
 * ÉTAT RÉEL DU LOCAL
 * Les locaux dessinés sur le tirage — groupes, chambres froides, laboratoire —
 * appartenaient à l'aménagement précédent : ils ont été déposés. Il ne reste que
 * la coque, le refend qui sépare l'aile gauche du magasin, et les deux bureaux
 * de l'aile. Tout le reste est un volume libre.
 *
 * Il n'y a donc AUCUNE cloison entre l'arrière et la surface de vente : la
 * limite est faite par une file de gondoles double face posée en travers, qui
 * masque la réserve tout en restant du mobilier démontable.
 */

/** Aile gauche : 8,00 m de large, refendue du magasin. */
const WING_R = 8.2; // nu droit de l'aile
const SHOP_L = 8.4; // nu gauche du magasin
const WING_END = 13.1; // le refend rejoint l'angle du mur biais

/** Les deux bureaux, seuls locaux cloisonnés (relevé et DTA). */
const OFF_R = 5.6; // axe de leur cloison droite
const OFF_TOP = 5.45; // axe de leur cloison haute
const OFF_MID = 8.6; // axe du refend Bureau 1 / Bureau 2
const OFF_BOTTOM = 11.75; // fin du bloc bureaux

const YF = 26.05; // façade sur rue

const EXT_W = XR + WALL; // 16,60 hors œuvre
const EXT_L = YF + WALL; // 26,25 hors œuvre

/** Cotes du relevé, mesurées depuis la façade du magasin. */
const fromFront = (d: number) => YF - d;

/**
 * ACCESSIBILITÉ (arrêté du 8 décembre 2014, ERP existants)
 *  - allée de circulation : 1,20 m minimum. On retient 1,50 m, largeur qui
 *    permet à un fauteuil de croiser un client et de faire demi-tour sur place,
 *    et qui sert de seuil à l'analyse de circulation du logiciel ;
 *  - allées structurantes (tête de gondoles et transversale) : 1,80 m ;
 *  - porte d'entrée : 1,80 m de passage libre, sans seuil ni battant ;
 *  - portes intérieures : 0,90 m, 1,20 m pour les chambres froides ;
 *  - avant-magasin dégagé sur plus de 3,50 m devant la caisse.
 */
const PMR_AISLE = 1.5;
const PMR_MAIN_AISLE = 1.8;

/**
 * Face arrière de la file de gondoles qui tient lieu de séparation, et face
 * vente de cette même file. La réserve occupe tout ce qui est au-dessus.
 */
const DIVIDER_Y = 7.05;
const SALES_TOP = DIVIDER_Y + DOUBLE_D_CONST;

// Files de gondoles centrales. Les axes sont calés sur les meubles les plus
// profonds de chaque rive : muraux de 550 à gauche, froid de 786 à droite. Tout
// le froid positif est donc regroupé sur la rive droite, ce qui rend 23 cm à
// chacune des trois allées et les fait passer au-dessus du seuil PMR.
const LEFT_FACE = SHOP_L + MURAL_D_CONST;
const RIGHT_FACE = XR - 0.786;
const AISLE = (RIGHT_FACE - LEFT_FACE - 2) / 3; // 1,555
const RUN_A = LEFT_FACE + AISLE + 0.5;
const RUN_B = RUN_A + 1 + AISLE;

const MODULE = 1.0; // module de gondole (devis RAY-ORG)
// Le long de la file, une tête de gondole occupe sa LARGEUR (1,03 ml au devis).
const TG_LEN = 1.03;
const MURAL_D = MURAL_D_CONST;
const DOUBLE_D = DOUBLE_D_CONST;

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


// ------------------------------------------------------------------- montage

export const HAGETMAU_NAME = 'Panier Sympa — Hagetmau';

/**
 * Identifiant du projet de référence. Il change chaque fois que le magasin est
 * remonté d'après un nouveau document. L'application s'en sert pour repérer
 * qu'une copie enregistrée dans le navigateur est périmée et ouvrir la version
 * à jour à la place — l'ancienne reste dans la liste des projets.
 */
export const HAGETMAU_ID = 'hagetmau-batiment-complet';

export function buildHagetmauProject(): Project {
  const walls: Wall[] = [];
  const openings: Opening[] = [];
  const columns: Column[] = [];
  const zones: Zone[] = [];
  const items: Item[] = [];

  const h = WALL / 2;

  // --- enveloppe en L. L'aile gauche s'arrête au mur biais ; au-delà, seul le
  // magasin continue jusqu'à la rue, sur ses 8,00 m de large.
  const outline: Vec2[] = [
    { x: h, y: h }, //                    angle arrière gauche
    { x: EXT_W - h, y: h }, //            mur du fond
    { x: EXT_W - h, y: EXT_L - h }, //    mur droit, jusqu'à la rue
    { x: SHOP_L - h, y: EXT_L - h }, //   façade sur rue (pignon du magasin)
    { x: SHOP_L - h, y: WING_END + 1.1 }, // flanc gauche du magasin, en extérieur
    { x: h, y: WING_END + 2.1 }, //       mur biais (hachuré au plan)
  ];
  for (let i = 0; i < outline.length; i++) {
    walls.push(wall(outline[i], outline[(i + 1) % outline.length], 'wall', WALL));
  }
  const frontWall = walls[2]; // façade, tracée de droite à gauche

  // --- façade vitrée (BAT Agelia « Mise en situation V2 »)
  // Vitrine fixe, porte vitrée automatique à deux vantaux, vitrine fixe. Les
  // trumeaux entre les baies correspondent aux montants blancs de la façade.
  const entranceX = 12.0;
  const onFront = (x: number) => EXT_W - h - x; // le mur est tracé de droite à gauche
  const GLAZE_H = 2.45;
  const GLAZE_SILL = 0.15;
  // La devanture est neuve : elle n'est pas marquée « existant ».
  const vitrine = (x: number, w: number): Opening => ({
    ...door(frontWall.id, onFront(x), w, false),
    type: 'window',
    height: GLAZE_H,
    sill: GLAZE_SILL,
  });
  openings.push(vitrine(9.7, 2.2));
  openings.push({
    ...door(frontWall.id, onFront(entranceX), 1.8, false),
    type: 'sliding',
    height: 2.2,
  });
  openings.push(vitrine(14.6, 2.8));

  // --------------------------------------------------- cloisonnement réel
  // Le refend qui sépare l'aile gauche du magasin, sur toute la hauteur du
  // bâtiment jusqu'à l'angle du mur biais.
  const wingWall = wall({ x: WING_R + h, y: YB - h }, { x: WING_R + h, y: WING_END }, 'wall', WALL);
  walls.push(wingWall);
  openings.push(door(wingWall.id, 3.4, 1.5)); // liaison aile / réserve du magasin

  // Les deux bureaux. Ce sont les seuls locaux cloisonnés qui subsistent :
  // le tirage montre leur mur haut et leur mur droit, le DTA les nomme.
  const offTop = wall({ x: XL - h, y: OFF_TOP }, { x: OFF_R, y: OFF_TOP }, 'wall', WALL);
  walls.push(offTop);
  const offRight = wall({ x: OFF_R, y: OFF_TOP }, { x: OFF_R, y: OFF_BOTTOM }, 'wall', WALL);
  walls.push(offRight);
  const offMid = wall({ x: XL - h, y: OFF_MID }, { x: OFF_R, y: OFF_MID }, 'partition', PART);
  walls.push(offMid);
  openings.push(door(offRight.id, 1.6, 0.9)); // Bureau 1
  openings.push(door(offRight.id, 4.7, 0.9)); // Bureau 2

  // Contreforts du mur gauche : trois travées de 2,70 séparées par 38 cm
  // (chaîne de cotes du tirage). Ils sont pris dans les murs des bureaux.
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
    name: 'Contrefort — travée de 2,70 m',
  });
  for (let i = 0; i < 3; i++) columns.push(buttress(2.88 + i * 3.08));

  // Volumes libres de l'aile, de part et d'autre des bureaux.
  zones.push(zone('reserve', XL, YB, WING_R - XL, OFF_TOP - h - YB, 'Réserve — aile'));
  zones.push(
    zone('circulation', OFF_R + h, OFF_TOP - h, WING_R - OFF_R - h, WING_END - h - OFF_TOP + h, 'Dégagement'),
  );
  zones.push(zone('autre', XL, OFF_TOP + h, OFF_R - h - XL, OFF_MID - PART / 2 - OFF_TOP - h, 'Bureau 1'));
  zones.push(zone('autre', XL, OFF_MID + PART / 2, OFF_R - h - XL, OFF_BOTTOM - OFF_MID - PART / 2, 'Bureau 2'));

  // ------------------------------------------------------ réserve du magasin
  // Aucune cloison : la réserve occupe tout le fond du magasin et n'est fermée
  // que par la file de gondoles posée en travers, plus bas.
  zones.push(zone('reserve', SHOP_L, YB, XR - SHOP_L, DIVIDER_Y - YB, 'Réserve magasin'));

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

  // --------------------------------------------------- rayonnage de réserve
  // Racks le long des murs, à l'écart des contreforts.
  runY(items, RACK, XR, 'right', YB + 0.15, 2);
  runX(items, RACK, YB, 'top', SHOP_L + 0.2, 1);
  runX(items, RACK, YB, 'top', XL + 0.2, 2);
  runY(items, RACK, WING_R, 'right', OFF_TOP + 0.5, 2);

  // -------------------------------------------------------- surface de vente
  zones.push(zone('vente', SHOP_L, SALES_TOP, XR - SHOP_L, YF - SALES_TOP));

  /** Pose une travée : tête de gondole, modules, tête de gondole. */
  const gondolaRun = (
    axis: number,
    top: number,
    mod: Spec,
    tg: Spec,
    count: number,
    along: 'y' | 'x' = 'y',
  ): number => {
    const rot = along === 'y' ? 90 : 0;
    const place = (spec: Spec, at: number) =>
      items.push(along === 'y' ? put(spec, axis, at, rot) : put(spec, at, axis, rot));
    let c = top;
    place(tg, c + TG_LEN / 2);
    c += TG_LEN;
    for (let i = 0; i < count; i++) {
      place(mod, c + MODULE / 2);
      c += MODULE;
    }
    place(tg, c + TG_LEN / 2);
    return c + TG_LEN;
  };

  // --- LA SÉPARATION EST UNE FILE DE GONDOLES, PAS UNE CLOISON
  // Le local n'a aucun refend entre l'arrière et la vente. La limite est faite
  // par une travée double face posée en travers, adossée au mur droit, qui
  // masque la réserve. Elle laisse à gauche un passage de service de 1,94 m.
  const dividerAxis = DIVIDER_Y + DOUBLE_D / 2;
  const dividerStart = XR - (2 * TG_LEN + 4 * MODULE);
  gondolaRun(dividerAxis, dividerStart, GONDOLE_H, TG_H, 4, 'x');
  zones.push(
    zone('circulation', SHOP_L, DIVIDER_Y, dividerStart - SHOP_L, DOUBLE_D, 'Passage de service'),
  );

  // --- mur droit : tout le froid positif y est regroupé, ce qui libère la rive
  // gauche et élargit les trois allées. La gaine technique reste contournée.
  const surgTop = SALES_TOP + 0.1;
  let y = runY(items, MULTIFREEZE, XR, 'right', surgTop, 2); // 6 portes surgelés
  zones.push(zone('surgeles', XR - 0.9, surgTop, 0.9, y - surgTop));
  const gaineTop = fromFront(10.0) - 0.55; // 15,50
  const frais1 = y + 0.1;
  y = runY(items, EIS_162, XR, 'right', frais1, 1); // repère 1A
  zones.push(zone('frais', XR - 0.9, frais1, 0.9, y - frais1));
  const frais2 = gaineTop + 1.1 + 0.1; // reprise après la gaine
  y = runY(items, EIS_162, XR, 'right', frais2, 1); // repère 1A (2e meuble)
  y = runY(items, EIS_112, XR, 'right', y + 0.1, 1); // repère 1B
  y = runY(items, EIS_112, XR, 'right', y + 0.1, 1); // repère 2
  zones.push(zone('frais', XR - 0.9, frais2, 0.9, y - frais2, 'Frais (rep. 1A / 1B / 2)'));
  // Le deuxième module de la file habille le poteau P5, coté à 1,85 m de la
  // façade sur 50 cm de large.
  runY(items, MURAL, XR, 'right', 21.7, 3);

  // --- mur gauche : une seule file de muraux, ininterrompue. Elle habille au
  // passage les poteaux P2 (16,00 m) et P1 (13,31 m), tous deux contre le mur.
  // Le départ est calé pour qu'un module entier vienne coiffer P2 plutôt que de
  // tomber à cheval dessus.
  let yl = runY(items, MURAL, SHOP_L, 'left', 8.2, 9);
  yl = runY(items, MURAL_PERF, SHOP_L, 'left', yl + 0.1, 1); // pâtisserie
  yl = runY(items, LOCKER, SHOP_L, 'left', yl + 0.1, 2);
  // La presse termine le linéaire, face à l'entrée.
  items.push(put(PRESSE, SHOP_L + PRESSE.d / 2, yl + 0.1 + PRESSE.w / 2, 90));

  // --- gondoles centrales
  // Allée de tête de 1,80 m devant la file de séparation, puis les deux travées
  // hautes : 2 files de 4 modules et 4 têtes. La tête de la file B habille le
  // poteau P4, resté seul au milieu de la vente.
  const highTop = SALES_TOP + PMR_MAIN_AISLE;
  const highEnd = gondolaRun(RUN_A, highTop, GONDOLE_H, TG_H, 4);
  gondolaRun(RUN_B, highTop, GONDOLE_H, TG_H, 4);
  zones.push(zone('epicerie', RUN_A - 0.5, highTop, RUN_B - RUN_A + 1, highEnd - highTop));
  zones.push(zone('circulation', SHOP_L, SALES_TOP, XR - SHOP_L, PMR_MAIN_AISLE, 'Allée de tête'));

  // Allée transversale, puis les travées basses côté façade. Le deuxième module
  // de la file A tombe sur le poteau P3 et l'habille.
  const lowTop = 17.75;
  const lowEnd = gondolaRun(RUN_A, lowTop, GONDOLE_B, TG_B, 3);
  gondolaRun(RUN_B, lowTop, GONDOLE_B, TG_B, 2);
  zones.push(zone('promo', RUN_A - 0.5, lowTop, RUN_B - RUN_A + 1, lowEnd - lowTop, 'Gondoles basses'));
  zones.push(
    zone('circulation', SHOP_L, highEnd, XR - SHOP_L, lowTop - highEnd, 'Allée transversale'),
  );

  // ---------------------------------------------------------- avant-magasin
  // L'îlot fruits et légumes est le premier univers rencontré en entrant.
  items.push(put(ILOT_FL, SHOP_L + 0.2 + ILOT_FL.w / 2, YF - 0.2 - ILOT_FL.d / 2, 0));
  zones.push(zone('fruits', SHOP_L, YF - 2.4, 2.6, 2.4));

  // Caisse bi-optique adossée au mur droit, face à la sortie.
  items.push(put(CAISSE, XR - CAISSE.w / 2, YF - 0.2 - CAISSE.d / 2, 0));
  zones.push(zone('caisse', XR - 2.2, YF - 1.7, 2.2, 1.7));

  items.push(
    put({ catalogId: 'panier', name: 'Paniers', w: 0.45, d: 0.35, h: 0.9 }, 14.3, YF - 0.3, 0),
  );
  items.push(
    put({ catalogId: 'chariot', name: 'Chariots', w: 0.6, d: 1.0, h: 1.0 }, 8.75, 23.7, 0),
  );
  zones.push(zone('entree', entranceX - 0.9, YF - 2.2, 1.8, 2.2));

  // ------------------------------------------------------------- le projet
  const now = Date.now();
  return {
    id: HAGETMAU_ID,
    name: HAGETMAU_NAME,
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
      // Seuil PMR retenu : 1,50 m, largeur qui permet le croisement et le
      // demi-tour d'un fauteuil roulant.
      minAisleWidth: PMR_AISLE,
      showDimensions: true,
      showCirculation: false,
      floorColor: '#d8d3cb',
    },
  };
}
