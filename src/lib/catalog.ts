import type { ItemCategory } from '../types';

/** Style de rendu 3D d'un objet du catalogue. */
export type Item3DStyle =
  | 'shelf'        // gondole / rayonnage : montants + niveaux d'etageres
  | 'wallShelf'    // rayonnage mural
  | 'endcap'       // tete de gondole
  | 'fridgeOpen'   // meuble froid ouvert (positif)
  | 'fridgeGlass'  // meuble avec portes vitrees
  | 'freezerBin'   // bac surgele ouvert
  | 'display'      // presentoir / meuble promo
  | 'counter'      // comptoir / meuble caisse
  | 'checkout'     // poste de caisse avec tapis
  | 'belt'         // tapis roulant
  | 'terminal'     // TPE / borne
  | 'basket'       // panier
  | 'trolley'      // chariot
  | 'pallet'       // palette
  | 'box';         // volume simple

export interface CatalogEntry {
  id: string;
  name: string;
  category: ItemCategory;
  /** Dimensions par defaut, en metres */
  width: number;
  depth: number;
  height: number;
  color: string;
  style: Item3DStyle;
  shelves?: number;
  description?: string;
}

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  rayonnage: 'Rayonnage',
  froid: 'Froid',
  caisse: 'Caisse',
  autres: 'Autres',
};

export const CATALOG: CatalogEntry[] = [
  // ---------------------------------------------------------------- RAYONNAGE
  {
    id: 'gondole-simple',
    name: 'Gondole simple face',
    category: 'rayonnage',
    width: 1.33,
    depth: 0.5,
    height: 1.8,
    color: '#9aa5b1',
    style: 'shelf',
    shelves: 5,
    description: 'Rayonnage adosse a un mur, marchandise sur une seule face.',
  },
  {
    id: 'gondole-double',
    name: 'Gondole double face',
    category: 'rayonnage',
    width: 1.33,
    depth: 1.0,
    height: 1.8,
    color: '#8b96a3',
    style: 'shelf',
    shelves: 5,
    description: 'Gondole centrale accessible des deux cotes.',
  },
  {
    id: 'tete-gondole',
    name: 'Tete de gondole',
    category: 'rayonnage',
    width: 1.0,
    depth: 0.6,
    height: 1.5,
    color: '#c0873f',
    style: 'endcap',
    shelves: 4,
    description: 'Extremite de gondole, emplacement a forte visibilite.',
  },
  {
    id: 'rayonnage-mural',
    name: 'Rayonnage mural',
    category: 'rayonnage',
    width: 1.33,
    depth: 0.4,
    height: 2.0,
    color: '#a2adb8',
    style: 'wallShelf',
    shelves: 6,
  },
  {
    id: 'etagere',
    name: 'Étagère',
    category: 'rayonnage',
    width: 1.0,
    depth: 0.35,
    height: 1.6,
    color: '#b0b8c1',
    style: 'shelf',
    shelves: 4,
  },
  {
    id: 'presentoir-rayonnage',
    name: 'Présentoir',
    category: 'rayonnage',
    width: 0.7,
    depth: 0.7,
    height: 1.5,
    color: '#cf9b4d',
    style: 'display',
    shelves: 4,
  },

  // -------------------------------------------------------------------- FROID
  {
    id: 'froid-positif',
    name: 'Meuble froid positif',
    category: 'froid',
    width: 2.5,
    depth: 0.9,
    height: 2.0,
    color: '#5b9bd5',
    style: 'fridgeOpen',
    shelves: 5,
    description: 'Mural froid ouvert 0/+4 °C : produits frais, laitages.',
  },
  {
    id: 'froid-negatif',
    name: 'Meuble froid négatif',
    category: 'froid',
    width: 2.5,
    depth: 0.9,
    height: 2.0,
    color: '#3f7fb8',
    style: 'fridgeGlass',
    shelves: 5,
    description: 'Armoire negative -18 °C a portes vitrees.',
  },
  {
    id: 'vitrine',
    name: 'Vitrine réfrigérée',
    category: 'froid',
    width: 2.0,
    depth: 1.1,
    height: 1.3,
    color: '#7fb3d9',
    style: 'fridgeGlass',
    shelves: 2,
    description: 'Vitrine service : traiteur, boucherie, fromage.',
  },
  {
    id: 'bac-surgele',
    name: 'Bac surgelé',
    category: 'froid',
    width: 2.0,
    depth: 0.9,
    height: 0.9,
    color: '#6aa9dd',
    style: 'freezerBin',
    description: 'Bac coffre ouvert pour produits surgeles.',
  },
  {
    id: 'frigo-boissons',
    name: 'Frigo boissons',
    category: 'froid',
    width: 1.2,
    depth: 0.75,
    height: 2.0,
    color: '#4a90c4',
    style: 'fridgeGlass',
    shelves: 5,
    description: 'Armoire vitree pour boissons fraiches.',
  },

  // ------------------------------------------------------------------- CAISSE
  {
    id: 'caisse',
    name: 'Caisse',
    category: 'caisse',
    width: 0.8,
    depth: 0.8,
    height: 1.1,
    color: '#4f6d7a',
    style: 'checkout',
    description: 'Poste de caisse simple.',
  },
  {
    id: 'meuble-caisse',
    name: 'Meuble caisse',
    category: 'caisse',
    width: 2.4,
    depth: 0.9,
    height: 0.95,
    color: '#456170',
    style: 'counter',
    description: 'Ensemble caisse avec plan de depose et rangement.',
  },
  {
    id: 'tapis-roulant',
    name: 'Tapis roulant',
    category: 'caisse',
    width: 1.6,
    depth: 0.5,
    height: 0.9,
    color: '#3b4a52',
    style: 'belt',
  },
  {
    id: 'terminal-paiement',
    name: 'Terminal de paiement',
    category: 'caisse',
    width: 0.25,
    depth: 0.2,
    height: 0.25,
    color: '#2f3a40',
    style: 'terminal',
  },
  {
    id: 'borne',
    name: 'Borne',
    category: 'caisse',
    width: 0.6,
    depth: 0.6,
    height: 1.5,
    color: '#35505c',
    style: 'terminal',
    description: 'Borne de caisse automatique ou d’information.',
  },

  // ------------------------------------------------------------------- AUTRES
  {
    id: 'panier',
    name: 'Panier',
    category: 'autres',
    width: 0.45,
    depth: 0.35,
    height: 0.9,
    color: '#7f8c8d',
    style: 'basket',
    description: 'Pile de paniers de course.',
  },
  {
    id: 'chariot',
    name: 'Chariot',
    category: 'autres',
    width: 0.6,
    depth: 1.0,
    height: 1.0,
    color: '#95a5a6',
    style: 'trolley',
  },
  {
    id: 'palette',
    name: 'Palette',
    category: 'autres',
    width: 1.2,
    depth: 0.8,
    height: 1.0,
    color: '#b5893f',
    style: 'pallet',
    description: 'Palette de marchandise en masse.',
  },
  {
    id: 'reserve-rack',
    name: 'Rack de réserve',
    category: 'autres',
    width: 2.7,
    depth: 1.1,
    height: 2.5,
    color: '#8a6d3b',
    style: 'shelf',
    shelves: 4,
    description: 'Rayonnage lourd pour la reserve.',
  },
  {
    id: 'meuble-promo',
    name: 'Meuble promotionnel',
    category: 'autres',
    width: 1.2,
    depth: 0.8,
    height: 1.2,
    color: '#e07a3f',
    style: 'display',
    shelves: 3,
  },
  {
    id: 'presentoir',
    name: 'Présentoir',
    category: 'autres',
    width: 0.6,
    depth: 0.6,
    height: 1.6,
    color: '#d98f4a',
    style: 'display',
    shelves: 5,
  },
  {
    id: 'comptoir',
    name: 'Comptoir',
    category: 'autres',
    width: 2.0,
    depth: 0.7,
    height: 1.05,
    color: '#7d6a55',
    style: 'counter',
  },
];

export const CATALOG_BY_ID: Record<string, CatalogEntry> = Object.fromEntries(
  CATALOG.map((c) => [c.id, c]),
);

export function catalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG_BY_ID[id];
}

export function catalogByCategory(cat: ItemCategory): CatalogEntry[] {
  return CATALOG.filter((c) => c.category === cat);
}

export const CATEGORIES: ItemCategory[] = ['rayonnage', 'froid', 'caisse', 'autres'];
