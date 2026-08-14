import type { Item, Opening, Vec2, Wall, Zone, ZoneCategory } from '../types';
import { catalogEntry } from './catalog';
import { ZONE_PRESET_BY_CATEGORY } from './zones';
import { uid } from './geometry';
import { MIN_WALKABLE_GAP } from './circulation';

/**
 * Générateur d'implantation automatique de supérette.
 *
 * Il applique les règles courantes du commerce alimentaire de proximité :
 * réserve au fond, frais en périphérie (les meubles froids ont besoin des murs
 * pour leurs groupes), fruits et légumes à l'entrée, épicerie en gondoles
 * centrales perpendiculaires au flux, ligne de caisses en façade, et une allée
 * périphérique qui fait le tour du magasin.
 *
 * Aucun appel réseau, aucun modèle : de la géométrie et des règles métier.
 */

export interface AutoLayoutOptions {
  /** Dimensions hors tout du local, en mètres */
  width: number;
  depth: number;
  /** Créer aussi les murs périphériques */
  createShell: boolean;
  /** Largeur des allées clients */
  aisleWidth: number;
  /** Gondoles centrales double face (sinon simple face adossées dos à dos) */
  doubleSided: boolean;
  /** Réserve au fond du local */
  reserve: boolean;
  reserveDepth: number;
  /** Nombre de postes de caisse */
  checkouts: number;
  /** Côté de l'entrée, vu depuis la rue */
  entranceSide: 'gauche' | 'droite';
  /** Épaisseurs et hauteur reprises des réglages du projet */
  wallThickness: number;
  partitionThickness: number;
  wallHeight: number;
}

export interface GeneratedLayout {
  walls: Wall[];
  openings: Opening[];
  zones: Zone[];
  items: Item[];
  /** Points d'attention à signaler à l'utilisateur */
  warnings: string[];
  stats: {
    salesArea: number;
    reserveArea: number;
    gondolaRuns: number;
    linearMeters: number;
    itemCount: number;
    /** Largeur d'allée réellement appliquée (réduite si le local est serré) */
    effectiveAisle: number;
  };
}

export const defaultAutoLayoutOptions = (
  wallThickness: number,
  partitionThickness: number,
  wallHeight: number,
): AutoLayoutOptions => ({
  // Format courant d'une supérette de quartier, environ 250 m² hors tout.
  width: 18,
  depth: 14,
  createShell: true,
  aisleWidth: 1.8,
  doubleSided: true,
  reserve: true,
  reserveDepth: 2.5,
  checkouts: 2,
  entranceSide: 'droite',
  wallThickness,
  partitionThickness,
  wallHeight,
});

/** Profondeur des bandes périphériques, par famille de matériel. */
const BAND = {
  fridge: 0.9,
  drinks: 0.75,
  wallShelf: 0.4,
  produce: 0.7,
  freezer: 0.9,
};

/** Bande de façade : caisses et sas d'entrée. Bornes min / max, ajustée au local. */
const FRONT_BAND_MIN = 1.9;
const FRONT_BAND_MAX = 3.4;
/**
 * Les meubles périphériques se posent strictement contre le mur. Un jeu, même
 * de deux centimètres, laisse une fente par laquelle l'analyse de circulation
 * fait passer ses mesures et croit voir un passage là où il n'y en a pas.
 */
const CLEARANCE = 0;
/** En dessous, une travée centrale n'a pas de sens. */
const MIN_CENTRAL = 1.1;

function makeItem(catalogId: string, x: number, y: number, rotation: number, name?: string): Item | null {
  const e = catalogEntry(catalogId);
  if (!e) return null;
  return {
    id: uid('i'),
    kind: 'item',
    catalogId,
    name: name ?? e.name,
    category: e.category,
    x,
    y,
    width: e.width,
    depth: e.depth,
    height: e.height,
    rotation,
    color: e.color,
    locked: false,
    shelves: e.shelves,
  };
}

/**
 * Répartition de la chute d'une file de modules.
 *
 * Une file laisse presque toujours un reste. Mal placé, ce reste devient une
 * poche de 60 cm à 1,50 m contre un mur : trop étroite pour circuler, assez
 * large pour que l'analyse la compte comme une allée non conforme. On choisit
 * donc, dans l'ordre :
 *   - reste invisible (< seuil de circulation) : on le centre ;
 *   - reste répartissable entre les modules en jeux invisibles : on l'étale ;
 *   - reste assez grand pour être une vraie allée : on le met d'un seul côté ;
 *   - sinon on retire un module pour libérer une vraie allée.
 */
function planRun(
  span: number,
  moduleWidth: number,
  aisle: number,
  ignorable = MIN_WALKABLE_GAP,
): { n: number; gap: number; start: number } | null {
  for (let n = Math.floor(span / moduleWidth); n >= 1; n--) {
    const slack = span - n * moduleWidth;
    if (slack < ignorable) {
      return { n, gap: 0, start: slack / 2 };
    }
    if (n > 1 && slack / (n - 1) < ignorable) {
      return { n, gap: slack / (n - 1), start: 0 };
    }
    if (slack >= aisle) {
      // Toute la chute au bout libre de la file : elle devient un passage
      // utilisable. La laisser au départ ouvrirait une poche dans l'angle,
      // juste à côté de la file perpendiculaire.
      return { n, gap: 0, start: 0 };
    }
  }
  return null;
}

/**
 * Remplit un segment avec autant de modules que possible.
 * `along` indique l'axe du segment : les modules sont tournés en conséquence.
 */
function fillRun(
  catalogId: string,
  from: number,
  to: number,
  fixed: number,
  along: 'x' | 'y',
  out: Item[],
  aisle: number,
  name?: string,
  overrides?: Partial<Item>,
): number {
  const e = catalogEntry(catalogId);
  if (!e) return 0;
  const plan = planRun(to - from, e.width, aisle);
  if (!plan) return 0;
  for (let i = 0; i < plan.n; i++) {
    const pos = from + plan.start + e.width / 2 + i * (e.width + plan.gap);
    const item =
      along === 'x'
        ? makeItem(catalogId, pos, fixed, 0, name)
        : makeItem(catalogId, fixed, pos, 90, name);
    if (item) out.push(overrides ? { ...item, ...overrides } : item);
  }
  return plan.n;
}

function makeZone(category: ZoneCategory, x: number, y: number, w: number, h: number, name?: string): Zone {
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
    opacity: 0.18,
  };
}

function makeWall(a: Vec2, b: Vec2, thickness: number, height: number, type: 'wall' | 'partition' = 'wall'): Wall {
  return { id: uid('w'), kind: 'wall', type, a, b, thickness, height, existing: false };
}

export function generateLayout(o: AutoLayoutOptions): GeneratedLayout {
  const walls: Wall[] = [];
  const openings: Opening[] = [];
  const zones: Zone[] = [];
  const items: Item[] = [];
  const warnings: string[] = [];

  const t = o.wallThickness;
  const tp = o.partitionThickness;

  // Repère : x vers la droite, y vers le bas. Le fond du magasin est en haut,
  // la façade et l'entrée en bas, côté rue.
  const x0 = t;
  const y0 = t;
  const iw = Math.max(2, o.width - 2 * t);
  const id = Math.max(2, o.depth - 2 * t);

  // ------------------------------------------------------------------ murs
  if (o.createShell) {
    const h = t / 2;
    const c: Vec2[] = [
      { x: h, y: h },
      { x: o.width - h, y: h },
      { x: o.width - h, y: o.depth - h },
      { x: h, y: o.depth - h },
    ];
    for (let i = 0; i < 4; i++) {
      walls.push(makeWall(c[i], c[(i + 1) % 4], t, o.wallHeight));
    }
  }

  // La bande de façade s'adapte : sur un petit local, 3,4 m de caisses
  // mangeraient toute la profondeur et il ne resterait rien pour les gondoles.
  const FRONT_BAND = Math.max(FRONT_BAND_MIN, Math.min(FRONT_BAND_MAX, id * 0.22));

  // --------------------------------------------------------------- réserve
  const reserveDepth = o.reserve ? Math.min(o.reserveDepth, id * 0.3) : 0;
  if (o.reserve && reserveDepth < 1.5) {
    warnings.push("Le local est trop peu profond pour une réserve confortable : elle a été réduite.");
  }

  let salesTop = y0;
  if (o.reserve && reserveDepth > 0.8) {
    const yPart = y0 + reserveDepth;
    const partition = makeWall({ x: x0, y: yPart }, { x: x0 + iw, y: yPart }, tp, o.wallHeight, 'partition');
    walls.push(partition);
    // Porte de liaison réserve / surface de vente, côté opposé à l'entrée.
    const doorOffset = o.entranceSide === 'droite' ? iw * 0.25 : iw * 0.75;
    openings.push({
      id: uid('o'),
      kind: 'opening',
      type: 'door',
      wallId: partition.id,
      offset: doorOffset,
      width: 1.2,
      height: 2.1,
      sill: 0,
      flip: false,
      existing: false,
    });
    zones.push(makeZone('reserve', x0, y0, iw, reserveDepth));
    salesTop = yPart + tp / 2;

    // Racks de réserve le long du mur du fond
    fillRun('reserve-rack', x0, x0 + iw, y0 + 1.1 / 2, 'x', items, o.aisleWidth);
  }

  const salesBottom = y0 + id;
  const salesH = salesBottom - salesTop;
  if (salesH < 5) {
    warnings.push("La surface de vente est très réduite : augmentez la profondeur du local.");
  }
  zones.push(makeZone('vente', x0, salesTop, iw, salesH));

  // --------------------------------------------------- entrée, sortie, caisses
  const frontTop = salesBottom - FRONT_BAND;
  const entranceW = Math.min(3, iw * 0.25);
  const entranceX =
    o.entranceSide === 'droite' ? x0 + iw - entranceW - 0.3 : x0 + 0.3;
  zones.push(makeZone('entree', entranceX, salesBottom - 2.6, entranceW, 2.6));

  // Porte d'entrée dans le mur de façade
  if (o.createShell) {
    const frontWall = walls[2]; // troisième segment : façade, tracée de droite à gauche
    if (frontWall) {
      // Le mur de façade va de (W, D) vers (0, D) : l'abscisse est inversée.
      const centerX = entranceX + entranceW / 2;
      openings.push({
        id: uid('o'),
        kind: 'opening',
        type: 'door',
        wallId: frontWall.id,
        // Ce mur est tracé de la droite vers la gauche : l'abscisse est inversée.
        offset: Math.max(1, o.width - t / 2 - centerX),
        width: Math.min(1.8, entranceW),
        height: 2.2,
        sill: 0,
        flip: false,
        existing: false,
      });
    }
  }

  // Ligne de caisses, perpendiculaire à la façade, du côté opposé à l'entrée.
  // Sur une façade peu profonde, le meuble de 2,40 m ne tient pas : on retombe
  // sur un poste simple, ce que font les petits commerces.
  const roomyFront = FRONT_BAND >= 2.9;
  const checkoutId = roomyFront ? 'meuble-caisse' : 'caisse';
  const checkoutEntry = catalogEntry(checkoutId);
  const checkoutN = Math.max(0, Math.min(o.checkouts, 8));
  if (checkoutEntry && checkoutN > 0) {
    // Chaque poste occupe sa profondeur plus un couloir client.
    const lane = 0.95;
    const pitch = checkoutEntry.depth + lane;
    let totalW = checkoutN * pitch;
    // Le dégagement en bout de ligne est le passage de sortie des clients :
    // il lui faut une vraie largeur d'allée.
    let n = checkoutN;
    while (n > 1 && iw - n * pitch - entranceW < o.aisleWidth * 2) n--;
    if (n < checkoutN) {
      warnings.push(
        `Seules ${n} caisse(s) tiennent en façade en conservant un passage de ${o.aisleWidth.toFixed(2)} m.`,
      );
    }
    totalW = n * pitch;
    const endMargin = Math.max(o.aisleWidth, (iw - totalW - entranceW) / 2);
    const startX =
      o.entranceSide === 'droite' ? x0 + endMargin : x0 + iw - endMargin - totalW;
    // Le poste reste entièrement dans la bande de façade : sinon il empièterait
    // sur le rayonnage mural et créerait un passage trop étroit.
    const yCheckout = Math.max(
      frontTop + checkoutEntry.width / 2 + 0.05,
      salesBottom - 0.3 - checkoutEntry.width / 2,
    );
    for (let i = 0; i < n; i++) {
      const cx = startX + pitch * (i + 0.5);
      if (cx < x0 + 0.3 || cx > x0 + iw - 0.3) continue;
      // Rotation de 90° : le meuble s'étire vers l'intérieur du magasin.
      const item = makeItem(checkoutId, cx, yCheckout, 90);
      if (item) items.push(item);
    }
    zones.push(
      makeZone(
        'caisse',
        Math.max(x0, startX),
        salesBottom - FRONT_BAND * 0.75,
        Math.min(totalW, iw),
        FRONT_BAND * 0.75,
      ),
    );
  }

  // Paniers et chariots à l'entrée
  const basket = makeItem('panier', entranceX + entranceW / 2, salesBottom - 3.0, 0);
  if (basket) items.push(basket);

  // ------------------------------------------------------------- périphérie
  // Fond de la surface de vente : meubles froid positif (crèmerie, traiteur).
  const fridgeY = salesTop + CLEARANCE + BAND.fridge / 2;
  const nFridge = fillRun(
    'froid-positif',
    x0 + BAND.wallShelf + CLEARANCE,
    x0 + iw - BAND.drinks - CLEARANCE,
    fridgeY,
    'x',
    items,
    o.aisleWidth,
  );
  if (nFridge > 0) {
    zones.push(makeZone('frais', x0, salesTop, iw, BAND.fridge + CLEARANCE * 2));
  }

  const bandTop = salesTop + BAND.fridge + CLEARANCE * 2;

  // Mur de droite : boissons. Mur de gauche : rayonnage mural (épicerie).
  // Les files latérales s'arrêtent une allée avant la bande de façade : elles
  // ne doivent pas venir enserrer la ligne de caisses.
  const sideTop = salesTop + CLEARANCE;
  const sideBottom = frontTop - Math.max(0.2, o.aisleWidth * 0.5);
  const drinksX = x0 + iw - CLEARANCE - BAND.drinks / 2;
  const shelfX = x0 + CLEARANCE + BAND.wallShelf / 2;

  // Fruits et légumes : sur la périphérie, en bas du mur côté entrée — c'est
  // l'usage, et cela garantit le dégagement. Un îlot posé au milieu de la
  // surface venait sinon rétrécir l'allée devant les gondoles.
  const sideSpan = sideBottom - sideTop;
  const produceLen = Math.min(3.0, sideSpan * 0.35);
  const hasProduce = produceLen >= 1.4;
  if (!hasProduce) {
    warnings.push("Pas assez de place pour un espace fruits et légumes distinct.");
  }
  const produceFrom = sideBottom - produceLen;
  const onRight = o.entranceSide === 'droite';

  // La file du mur côté entrée s'arrête pour laisser la place aux fruits.
  const drinksEnd = onRight && hasProduce ? produceFrom - 0.05 : sideBottom;
  const shelfEnd = !onRight && hasProduce ? produceFrom - 0.05 : sideBottom;

  const nDrinks = fillRun('frigo-boissons', sideTop, drinksEnd, drinksX, 'y', items, o.aisleWidth);
  if (nDrinks > 0) {
    zones.push(
      makeZone('boissons', x0 + iw - BAND.drinks, sideTop, BAND.drinks, drinksEnd - sideTop),
    );
  }
  fillRun('rayonnage-mural', sideTop, shelfEnd, shelfX, 'y', items, o.aisleWidth);

  if (hasProduce) {
    const produceX = onRight ? x0 + iw - BAND.produce / 2 : x0 + BAND.produce / 2;
    fillRun(
      'presentoir-rayonnage',
      produceFrom,
      sideBottom,
      produceX,
      'y',
      items,
      o.aisleWidth,
      'Fruits et légumes',
    );
    zones.push(
      makeZone(
        'fruits',
        onRight ? x0 + iw - BAND.produce : x0,
        produceFrom,
        BAND.produce,
        produceLen,
      ),
    );
  }

  // --------------------------------------------------------- gondoles centrales
  const gondolaId = o.doubleSided ? 'gondole-double' : 'gondole-simple';
  const gondola = catalogEntry(gondolaId)!;
  const head = catalogEntry('tete-gondole')!;

  /** Emprise centrale disponible pour une largeur d'allée périphérique donnée. */
  const centralFor = (aisle: number) => {
    const left = x0 + BAND.wallShelf + CLEARANCE * 2 + aisle;
    const right = x0 + iw - BAND.drinks - CLEARANCE * 2 - aisle;
    const top = bandTop + aisle;
    const bottom = frontTop - aisle;
    return { left, right, top, bottom, w: right - left, h: bottom - top };
  };

  // Sur un local serré, on resserre les allées périphériques plutôt que de
  // renoncer complètement aux gondoles centrales.
  let aisle = o.aisleWidth;
  let central = centralFor(aisle);
  if (central.w < MIN_CENTRAL || central.h < MIN_CENTRAL) {
    const reduced = Math.max(1.1, o.aisleWidth * 0.7);
    const alt = centralFor(reduced);
    if (alt.w >= MIN_CENTRAL && alt.h >= MIN_CENTRAL) {
      aisle = reduced;
      central = alt;
      warnings.push(
        `Local serré : les allées périphériques ont été ramenées à ${reduced.toFixed(2)} m.`,
      );
    }
  }

  // Les bacs surgelés occupent le haut de l'espace central, contre le frais.
  // Leur bande doit être retirée avant de calculer les travées, sinon la
  // première rangée de gondoles vient buter contre eux.
  const freezer = catalogEntry('bac-surgele')!;
  const wantFreezer = central.h > 6 && central.w >= freezer.width;
  const freezerBand = wantFreezer ? BAND.freezer + o.aisleWidth : 0;
  const runArea = {
    left: central.left,
    right: central.right,
    top: central.top + freezerBand,
    bottom: central.bottom,
    w: central.w,
    h: central.h - freezerBand,
  };

  if (wantFreezer) {
    const nFreezer = fillRun(
      'bac-surgele',
      central.left,
      central.right,
      central.top + BAND.freezer / 2,
      'x',
      items,
      o.aisleWidth,
    );
    if (nFreezer > 0) {
      zones.push(
        makeZone('surgeles', central.left, central.top - 0.2, central.w, BAND.freezer + 0.4),
      );
    }
  }

  let runs = 0;

  if (runArea.w < MIN_CENTRAL || runArea.h < MIN_CENTRAL) {
    warnings.push(
      "Le local est trop petit pour des gondoles centrales : seule la périphérie a été implantée.",
    );
  } else {
    const pitch = gondola.depth + o.aisleWidth;
    /** Nombre de travées tenant sur une largeur donnée. */
    const runCount = (across: number) => Math.max(0, Math.floor((across + o.aisleWidth) / pitch));

    // Les deux orientations possibles ne donnent pas le même linéaire : les
    // arrondis favorisent nettement l'une ou l'autre selon la forme du local.
    // On retient celle qui offre le plus de mètres de gondole.
    const optionY = { axis: 'y' as const, runs: runCount(runArea.w), length: runArea.h };
    const optionX = { axis: 'x' as const, runs: runCount(runArea.h), length: runArea.w };
    const best =
      optionY.runs * optionY.length >= optionX.runs * optionX.length ? optionY : optionX;

    runs = best.runs;
    if (runs === 0) {
      warnings.push("Aucune travée centrale ne tient : réduisez la largeur d'allée.");
    } else {
      const acrossFrom = best.axis === 'y' ? runArea.left : runArea.top;
      const acrossSize = best.axis === 'y' ? runArea.w : runArea.h;
      const runFrom = best.axis === 'y' ? runArea.top : runArea.left;
      const runTo = best.axis === 'y' ? runArea.bottom : runArea.right;

      const used = runs * gondola.depth + (runs - 1) * o.aisleWidth;
      const offset = (acrossSize - used) / 2;

      // Au-delà de 12 m, une allée transversale évite d'enfermer le client
      // au fond d'une travée sans échappatoire.
      const crossAisle = best.length > 12 ? o.aisleWidth : 0;
      const segments: Array<[number, number]> = crossAisle
        ? [
            [runFrom, runFrom + (best.length - crossAisle) / 2],
            [runFrom + (best.length + crossAisle) / 2, runTo],
          ]
        : [[runFrom, runTo]];

      for (let r = 0; r < runs; r++) {
        const fixed = acrossFrom + offset + gondola.depth / 2 + r * pitch;
        for (const [a, b] of segments) {
          // Têtes de gondole aux extrémités : emplacements à forte visibilité.
          const from = a + head.width / 2 + 0.02;
          const to = b - head.width / 2 - 0.02;
          if (to - from < gondola.width) continue;
          fillRun(gondolaId, from, to, fixed, best.axis, items, o.aisleWidth);
          const rot = best.axis === 'y' ? 90 : 0;
          const h1 =
            best.axis === 'y'
              ? makeItem('tete-gondole', fixed, a + head.width / 2, rot)
              : makeItem('tete-gondole', a + head.width / 2, fixed, rot);
          if (h1) h1.depth = gondola.depth;
          const h2 =
            best.axis === 'y'
              ? makeItem('tete-gondole', fixed, b - head.width / 2, rot)
              : makeItem('tete-gondole', b - head.width / 2, fixed, rot);
          if (h2) h2.depth = gondola.depth;
          if (h1) items.push(h1);
          if (h2) items.push(h2);
        }
      }

      zones.push(makeZone('epicerie', runArea.left, runArea.top, runArea.w, runArea.h));
    }

  }

  // Zone de circulation principale, le long de la façade
  zones.push(makeZone('circulation', x0, frontTop, iw, o.aisleWidth, 'Allée principale'));

  const linearMeters = items
    .filter((i) => i.category === 'rayonnage' || i.category === 'froid')
    .reduce((s, i) => s + i.width, 0);

  return {
    walls,
    openings,
    zones,
    items,
    warnings,
    stats: {
      salesArea: iw * salesH,
      reserveArea: o.reserve ? iw * reserveDepth : 0,
      gondolaRuns: runs,
      linearMeters,
      itemCount: items.length,
      effectiveAisle: aisle,
    },
  };
}

/** Estime l'implantation sans la produire, pour l'aperçu du formulaire. */
export function previewStats(o: AutoLayoutOptions): GeneratedLayout['stats'] & { warnings: string[] } {
  const g = generateLayout(o);
  return { ...g.stats, warnings: g.warnings };
}
