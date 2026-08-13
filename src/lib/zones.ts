import type { ZoneCategory } from '../types';

export interface ZonePreset {
  category: ZoneCategory;
  label: string;
  color: string;
  /** Dimensions par defaut du rectangle cree en un clic (m) */
  width: number;
  depth: number;
  description: string;
}

export const ZONE_PRESETS: ZonePreset[] = [
  {
    category: 'vente',
    label: 'Surface de vente',
    color: '#4c8bf5',
    width: 12,
    depth: 9,
    description: 'Zone marchande principale accessible au public.',
  },
  {
    category: 'reserve',
    label: 'Réserve',
    color: '#8d6e63',
    width: 5,
    depth: 4,
    description: 'Stockage, arriere-boutique, reception marchandise.',
  },
  {
    category: 'caisse',
    label: 'Caisse',
    color: '#3f51b5',
    width: 4,
    depth: 3,
    description: 'Ligne de caisses et zone d’attente.',
  },
  {
    category: 'entree',
    label: 'Entrée',
    color: '#2e9e5b',
    width: 2.5,
    depth: 2.5,
    description: 'Sas et flux entrant des clients.',
  },
  {
    category: 'sortie',
    label: 'Sortie',
    color: '#e0562d',
    width: 2.5,
    depth: 2.5,
    description: 'Flux sortant apres passage en caisse.',
  },
  {
    category: 'circulation',
    label: 'Circulation clients',
    color: '#00acc1',
    width: 10,
    depth: 1.8,
    description: 'Allee principale de circulation.',
  },
  {
    category: 'promo',
    label: 'Zone promotionnelle',
    color: '#f4511e',
    width: 3,
    depth: 2,
    description: 'Operations commerciales, mise en avant.',
  },
  {
    category: 'fruits',
    label: 'Fruits et légumes',
    color: '#7cb342',
    width: 5,
    depth: 4,
    description: 'Univers frais non emballe, souvent en entree de magasin.',
  },
  {
    category: 'epicerie',
    label: 'Épicerie',
    color: '#c0873f',
    width: 6,
    depth: 5,
    description: 'Produits secs, conserves, epicerie salee et sucree.',
  },
  {
    category: 'boissons',
    label: 'Boissons',
    color: '#5e35b1',
    width: 5,
    depth: 3,
    description: 'Eaux, sodas, alcools.',
  },
  {
    category: 'frais',
    label: 'Frais',
    color: '#039be5',
    width: 5,
    depth: 3,
    description: 'Produits laitiers, traiteur, viande.',
  },
  {
    category: 'surgeles',
    label: 'Surgelés',
    color: '#0277bd',
    width: 4,
    depth: 3,
    description: 'Bacs et armoires negatives.',
  },
  {
    category: 'hygiene',
    label: 'Hygiène',
    color: '#ec407a',
    width: 4,
    depth: 3,
    description: 'Droguerie, parfumerie, hygiene.',
  },
  {
    category: 'entretien',
    label: 'Entretien',
    color: '#8e24aa',
    width: 4,
    depth: 3,
    description: 'Produits menagers et entretien.',
  },
  {
    category: 'autre',
    label: 'Zone libre',
    color: '#78909c',
    width: 4,
    depth: 3,
    description: 'Zone personnalisee.',
  },
];

export const ZONE_PRESET_BY_CATEGORY: Record<ZoneCategory, ZonePreset> = Object.fromEntries(
  ZONE_PRESETS.map((z) => [z.category, z]),
) as Record<ZoneCategory, ZonePreset>;

export function zoneLabel(cat: ZoneCategory): string {
  return ZONE_PRESET_BY_CATEGORY[cat]?.label ?? 'Zone';
}

export function zoneColor(cat: ZoneCategory): string {
  return ZONE_PRESET_BY_CATEGORY[cat]?.color ?? '#78909c';
}
