/**
 * Modele de donnees du projet.
 * Toutes les longueurs sont exprimees en METRES, les angles en DEGRES.
 * Le repere du plan : X vers la droite, Y vers le bas (comme un plan papier).
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type ElementKind =
  | 'wall'
  | 'opening'
  | 'column'
  | 'zone'
  | 'item'
  | 'dimension';

/** Un mur ou une cloison, defini par son axe (a -> b). */
export interface Wall {
  id: string;
  kind: 'wall';
  /** 'wall' = mur porteur / peripherique, 'partition' = cloison legere */
  type: 'wall' | 'partition';
  a: Vec2;
  b: Vec2;
  /** Epaisseur en metres */
  thickness: number;
  /** Hauteur en metres (utilisee en 3D) */
  height: number;
  /** Element existant a conserver */
  existing: boolean;
  color?: string;
}

export type OpeningType = 'door' | 'window' | 'sliding';

/**
 * Une baie percee dans un mur.
 *  - 'door'    : porte battante, avec un sens d'ouverture ;
 *  - 'window'  : fenetre ou vitrine, posee sur une allege ;
 *  - 'sliding' : porte vitree automatique a deux vantaux coulissants, telle
 *                qu'on la trouve en facade de magasin. Elle n'a pas de sens
 *                d'ouverture : les vantaux s'effacent lateralement.
 */
export interface Opening {
  id: string;
  kind: 'opening';
  type: OpeningType;
  wallId: string;
  /** Distance en metres depuis le point a du mur, jusqu'au CENTRE de l'ouverture */
  offset: number;
  width: number;
  /** Hauteur de l'ouverture */
  height: number;
  /** Hauteur d'allege (0 pour une porte) */
  sill: number;
  /** Sens d'ouverture pour le dessin 2D */
  flip: boolean;
  existing: boolean;
}

/** Un poteau. */
export interface Column {
  id: string;
  kind: 'column';
  /** Libelle libre, utile pour distinguer les poteaux releves sur place */
  name?: string;
  shape: 'rect' | 'round';
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
  rotation: number;
  existing: boolean;
}

export type ZoneCategory =
  | 'vente'
  | 'reserve'
  | 'caisse'
  | 'entree'
  | 'sortie'
  | 'circulation'
  | 'promo'
  | 'fruits'
  | 'epicerie'
  | 'boissons'
  | 'frais'
  | 'surgeles'
  | 'hygiene'
  | 'entretien'
  | 'autre';

/** Une zone du magasin : polygone ferme. */
export interface Zone {
  id: string;
  kind: 'zone';
  name: string;
  category: ZoneCategory;
  points: Vec2[];
  color: string;
  opacity: number;
}

export type ItemCategory = 'rayonnage' | 'froid' | 'caisse' | 'autres';

/** Un objet mobilier issu de la bibliotheque. */
export interface Item {
  id: string;
  kind: 'item';
  /** Identifiant du modele dans le catalogue */
  catalogId: string;
  name: string;
  /** Reference fabricant / ligne de devis, quand elle est connue */
  reference?: string;
  category: ItemCategory;
  /** Centre de l'objet */
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
  /** Rotation en degres, sens horaire */
  rotation: number;
  color: string;
  locked: boolean;
  /** Nombre de niveaux d'etageres (rayonnage) — utilise en 3D */
  shelves?: number;
}

/** Une cotation manuelle. */
export interface Dimension {
  id: string;
  kind: 'dimension';
  a: Vec2;
  b: Vec2;
  /** Deport de la ligne de cote par rapport au segment mesure */
  offset: number;
  label?: string;
}

/** Plan importe servant de fond de travail. */
export interface Background {
  /** Image (data URL). Un PDF importe est rasterise en PNG. */
  src: string;
  /** Nom du fichier d'origine */
  fileName: string;
  /** Position du coin haut-gauche de l'image, en metres */
  x: number;
  y: number;
  /** Echelle : metres par pixel image */
  scale: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  /** Dimensions natives de l'image, en pixels */
  pxWidth: number;
  pxHeight: number;
}

/** Options « conserver l'existant ». */
export interface ExistingOptions {
  carrelage: boolean;
  murs: boolean;
  portes: boolean;
  fenetres: boolean;
  /** Description du carrelage conserve (rendu du sol en 3D) */
  carrelageColor: string;
  carrelageTileSize: number;
}

export interface ProjectSettings {
  /** Hauteur sous plafond par defaut */
  wallHeight: number;
  defaultWallThickness: number;
  defaultPartitionThickness: number;
  gridSize: number;
  snap: boolean;
  snapAngle: boolean;
  showGrid: boolean;
  showDimensions: boolean;
  showCirculation: boolean;
  /** Largeur minimale reglementaire des allees clients (m) */
  minAisleWidth: number;
  showCeiling: boolean;
  floorColor: string;
  wallColor: string;
}

export interface Floor {
  walls: Wall[];
  openings: Opening[];
  columns: Column[];
  zones: Zone[];
  items: Item[];
  dimensions: Dimension[];
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  floor: Floor;
  background: Background | null;
  existing: ExistingOptions;
  settings: ProjectSettings;
}

export type AnyElement = Wall | Opening | Column | Zone | Item | Dimension;

export type ToolId =
  | 'select'
  | 'pan'
  | 'wall'
  | 'partition'
  | 'door'
  | 'window'
  | 'sliding'
  | 'column'
  | 'zone'
  | 'dimension'
  | 'calibrate'
  | 'measure';

export const emptyFloor = (): Floor => ({
  walls: [],
  openings: [],
  columns: [],
  zones: [],
  items: [],
  dimensions: [],
});

export const defaultSettings = (): ProjectSettings => ({
  wallHeight: 3,
  defaultWallThickness: 0.2,
  defaultPartitionThickness: 0.1,
  gridSize: 0.5,
  snap: true,
  snapAngle: true,
  showGrid: true,
  showDimensions: true,
  showCirculation: false,
  minAisleWidth: 1.4,
  showCeiling: false,
  floorColor: '#d8d3cb',
  wallColor: '#e9e6e1',
});

export const defaultExisting = (): ExistingOptions => ({
  carrelage: false,
  murs: false,
  portes: false,
  fenetres: false,
  carrelageColor: '#cfc9c0',
  carrelageTileSize: 0.6,
});
