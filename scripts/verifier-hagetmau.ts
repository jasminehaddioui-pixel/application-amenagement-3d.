/**
 * Contrôle géométrique du projet réel PANIER SYMPA — HAGETMAU.
 *
 *   npm run verifier:hagetmau
 *
 * Le magasin est monté à la cote depuis les documents du projet : il faut donc
 * vérifier mécaniquement qu'aucun meuble ne chevauche un poteau existant, ne
 * chevauche un autre meuble, ne sort de la coque, et qu'aucune allée client ne
 * descend sous la largeur réglementaire retenue.
 */
import { buildHagetmauProject } from '../src/lib/projects/hagetmau';
import { analyseCirculation } from '../src/lib/circulation';
import { polygonArea } from '../src/lib/geometry';

interface Box {
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Emprise au sol alignée sur les axes (les meubles sont posés à 0 ou 90°). */
function box(
  label: string,
  x: number,
  y: number,
  width: number,
  depth: number,
  rotation: number,
): Box {
  const turned = Math.abs(((rotation % 180) + 180) % 180 - 90) < 45;
  const w = turned ? depth : width;
  const d = turned ? width : depth;
  return { label, x0: x - w / 2, y0: y - d / 2, x1: x + w / 2, y1: y + d / 2 };
}

const overlap = (a: Box, b: Box, tol = 0.005) =>
  a.x0 < b.x1 - tol && b.x0 < a.x1 - tol && a.y0 < b.y1 - tol && b.y0 < a.y1 - tol;

/**
 * Un poteau entièrement contenu dans l'emprise d'un meuble est habillé, pas
 * heurté : c'est la façon normale de traiter un poteau en agencement. Seul un
 * recouvrement partiel est un défaut d'implantation.
 */
const encloses = (furniture: Box, column: Box, tol = 0.005) =>
  furniture.x0 <= column.x0 + tol &&
  furniture.y0 <= column.y0 + tol &&
  furniture.x1 >= column.x1 - tol &&
  furniture.y1 >= column.y1 - tol;

const project = buildHagetmauProject();
const { items, columns, zones, walls, openings } = project.floor;

// Coque : rectangle englobant les axes des murs périphériques, ± demi-épaisseur.
const peripheral = walls.filter((w) => w.type === 'wall');
const xs = peripheral.flatMap((w) => [w.a.x, w.b.x]);
const ys = peripheral.flatMap((w) => [w.a.y, w.b.y]);
const thick = peripheral[0]?.thickness ?? 0.2;
const shell = {
  x0: Math.min(...xs) + thick / 2,
  y0: Math.min(...ys) + thick / 2,
  x1: Math.max(...xs) - thick / 2,
  y1: Math.max(...ys) - thick / 2,
};

const itemBoxes = items.map((i) => box(i.name, i.x, i.y, i.width, i.depth, i.rotation));
const colBoxes = columns.map((c) => box(c.name ?? 'Poteau', c.x, c.y, c.width, c.depth, c.rotation));

const problems: string[] = [];

const dressed: string[] = [];
for (const b of itemBoxes) {
  for (const c of colBoxes) {
    if (!overlap(b, c)) continue;
    if (encloses(b, c)) dressed.push(`${c.label}  habillé par  ${b.label}`);
    else problems.push(`poteau   ${c.label}  ✗  ${b.label}`);
  }
}
for (let i = 0; i < itemBoxes.length; i++) {
  for (let j = i + 1; j < itemBoxes.length; j++) {
    if (overlap(itemBoxes[i], itemBoxes[j])) {
      problems.push(`meubles  ${itemBoxes[i].label}  ✗  ${itemBoxes[j].label}`);
    }
  }
}
for (const b of itemBoxes) {
  if (b.x0 < shell.x0 - 0.005 || b.y0 < shell.y0 - 0.005 || b.x1 > shell.x1 + 0.005 || b.y1 > shell.y1 + 0.005) {
    problems.push(
      `hors coque  ${b.label}  (${b.x0.toFixed(2)}…${b.x1.toFixed(2)} ; ${b.y0.toFixed(2)}…${b.y1.toFixed(2)})`,
    );
  }
}
for (const o of openings) {
  const w = walls.find((x) => x.id === o.wallId);
  if (!w) {
    problems.push(`ouverture orpheline ${o.id}`);
    continue;
  }
  const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
  if (o.offset - o.width / 2 < -0.005 || o.offset + o.width / 2 > len + 0.005) {
    problems.push(
      `ouverture hors mur : offset ${o.offset.toFixed(2)} ± ${(o.width / 2).toFixed(2)} sur ${len.toFixed(2)} m`,
    );
  }
}

const area = (cat: string) =>
  zones.filter((z) => z.category === cat).reduce((s, z) => s + polygonArea(z.points), 0);
const linear = items
  .filter((i) => i.category === 'rayonnage' || i.category === 'froid')
  .reduce((s, i) => s + i.width * (i.catalogId === 'gondole-double' ? 2 : 1), 0);

const minAisle = project.settings.minAisleWidth;
const circ = analyseCirculation(project.floor, minAisle);

console.log(`coque              ${(shell.x1 - shell.x0).toFixed(2)} × ${(shell.y1 - shell.y0).toFixed(2)} m dans œuvre`);
console.log(`surface de vente   ${area('vente').toFixed(1)} m²`);
console.log(`réserve + locaux   ${area('reserve').toFixed(1)} m²`);
console.log(`mobilier           ${items.length} meubles`);
console.log(`linéaire de vente  ${linear.toFixed(2)} ml`);
console.log(`murs / ouvertures  ${walls.length} / ${openings.length}`);
console.log(
  `allée mini         ${circ.minWidth !== null ? circ.minWidth.toFixed(2) + ' m' : '—'}   (seuil ${minAisle.toFixed(2)} m)`,
);
console.log(`passages étroits   ${circ.narrowCount}`);
console.log('');
console.log('les huit passages les plus serrés :');
for (const g of circ.gaps.slice(0, 8)) {
  const flag = g.narrow ? '✗' : '✓';
  console.log(
    `   ${flag} ${g.width.toFixed(2)} m   ${g.a.label} / ${g.b.label}` +
      `   (${g.from.x.toFixed(1)} ; ${g.from.y.toFixed(1)})`,
  );
}
for (const g of circ.gaps.filter((x) => x.narrow)) {
  console.log(
    `   ${g.width.toFixed(2)} m  entre ${g.a.label} et ${g.b.label}` +
      `  [(${g.from.x.toFixed(2)} ; ${g.from.y.toFixed(2)}) → (${g.to.x.toFixed(2)} ; ${g.to.y.toFixed(2)})]`,
  );
}

// ------------------------------------------------------------ accessibilité
// Arrêté du 8 décembre 2014 : une porte desservant un local doit offrir un
// passage utile d'au moins 0,83 m, ce que donne une largeur nominale de 0,90 m.
// L'entrée d'un ERP de 5e catégorie doit offrir 0,90 m de passage libre ; on
// vérifie en plus que la porte automatique de façade dépasse 1,20 m.
const MIN_DOOR = 0.9;
for (const o of openings) {
  if (o.type === 'window') continue;
  if (o.width < MIN_DOOR - 0.005) {
    problems.push(`porte trop étroite : ${o.width.toFixed(2)} m (minimum ${MIN_DOOR.toFixed(2)} m)`);
  }
}
const entrance = openings.find((o) => o.type === 'sliding');
if (!entrance) {
  problems.push('aucune porte automatique en façade');
} else if (entrance.width < 1.2 - 0.005) {
  problems.push(`entrée de ${entrance.width.toFixed(2)} m : moins de 1,20 m de passage libre`);
}
const doorWidths = openings.filter((o) => o.type !== 'window').map((o) => o.width);
console.log(
  `portes               ${doorWidths.length}, la plus étroite ${Math.min(...doorWidths).toFixed(2)} m` +
    `   entrée ${entrance ? entrance.width.toFixed(2) + ' m de passage libre' : '—'}`,
);

if (dressed.length) {
  console.log('');
  console.log(`poteaux habillés   ${dressed.length}`);
  dressed.forEach((d) => console.log('   ' + d));
}

console.log('');
if (problems.length === 0) {
  console.log('✅ aucun conflit : poteaux, meubles, coque et ouvertures sont cohérents');
} else {
  console.log(`❌ ${problems.length} conflit(s) :`);
  problems.forEach((p) => console.log('   ' + p));
}
process.exit(problems.length === 0 && circ.narrowCount === 0 ? 0 : 1);
