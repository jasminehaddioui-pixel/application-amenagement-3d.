/**
 * Graine de demarrage : le strict necessaire pour que le module soit
 * utilisable des la premiere ouverture, sans rien inventer.
 *
 * Attention aux taux de TVA : ce sont des valeurs PRE-REMPLIES et MODIFIABLES,
 * pas une regle fiscale. Chacun porte une note de validation, et l'ecran
 * Paramètres permet de les corriger, d'en ajouter ou d'en desactiver. Le
 * rattachement d'un produit a un taux releve de votre expert-comptable.
 */

import { newId } from './db';
import type { Family, GestionDB, User, VatRate } from './types';

/** Taux pre-remplis, a controler avec l'expert-comptable avant tout export. */
export function seedVatRates(): VatRate[] {
  const note = 'Valeur pré-remplie, à confirmer avec votre expert-comptable.';
  return [
    { id: newId('tva'), label: 'Taux normal', rate: 20, active: true, note },
    { id: newId('tva'), label: 'Taux intermédiaire', rate: 10, active: true, note },
    { id: newId('tva'), label: 'Taux réduit', rate: 5.5, active: true, note },
    { id: newId('tva'), label: 'Taux particulier', rate: 2.1, active: true, note },
    { id: newId('tva'), label: 'Non soumis / exonéré', rate: 0, active: true, note },
  ];
}

/** Rayons courants d'une superette de proximite. */
const AISLES: Array<[string, string[]]> = [
  ['Fruits et légumes', ['Fruits', 'Légumes']],
  ['Frais libre-service', ['Crèmerie', 'Charcuterie', 'Traiteur', 'Œufs']],
  ['Surgelés', ['Plats surgelés', 'Glaces', 'Légumes surgelés']],
  ['Boissons', ['Eaux', 'Sodas et jus', 'Bières', 'Vins et spiritueux']],
  ['Épicerie salée', ['Conserves', 'Pâtes et riz', 'Huiles et condiments', 'Apéritif']],
  ['Épicerie sucrée', ['Petit-déjeuner', 'Biscuits', 'Confiserie', 'Chocolat']],
  ['Boulangerie', ['Pain', 'Viennoiserie']],
  ['Hygiène et beauté', ['Soins', 'Papier', 'Bébé']],
  ['Entretien', ['Lessive', 'Nettoyants', 'Vaisselle']],
  ['Dépannage', ['Piles et ampoules', 'Bazar', 'Presse et tabac']],
];

export function seedFamilies(): Family[] {
  const out: Family[] = [];
  for (const [name, subs] of AISLES) {
    const parent: Family = { id: newId('fam'), name, parentId: null, aisle: name };
    out.push(parent);
    for (const sub of subs) {
      out.push({ id: newId('fam'), name: sub, parentId: parent.id, aisle: name });
    }
  }
  return out;
}

export function seedUsers(): User[] {
  return [
    { id: newId('usr'), name: 'Gérant', role: 'gerant', active: true },
    { id: newId('usr'), name: 'Employé', role: 'employe', active: true },
    { id: newId('usr'), name: 'Expert-comptable', role: 'comptable', active: true },
  ];
}

/** Complete une base vide avec le referentiel de depart. */
export function seed(db: GestionDB): GestionDB {
  const next = { ...db };
  if (next.vatRates.length === 0) next.vatRates = seedVatRates();
  if (next.families.length === 0) next.families = seedFamilies();
  if (next.users.length === 0) next.users = seedUsers();
  if (!next.currentUserId || !next.users.some((u) => u.id === next.currentUserId)) {
    next.currentUserId = next.users[0]?.id ?? '';
  }
  return next;
}
