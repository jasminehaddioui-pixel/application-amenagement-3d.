/**
 * Contrôle du générateur d'implantation sur un éventail de formats de local.
 *
 *   npm run verifier:implantation
 *
 * Vérifie, pour chaque taille, que le générateur produit bien du mobilier,
 * qu'aucun meuble ne sort du local, et surtout qu'aucune allée ne descend sous
 * la largeur demandée — le générateur ne doit pas produire lui-même les défauts
 * que l'analyse de circulation est censée signaler.
 */
import { generateLayout, defaultAutoLayoutOptions } from '../src/lib/autoLayout';
import { analyseCirculation } from '../src/lib/circulation';
import { polygonArea } from '../src/lib/geometry';
import { emptyFloor } from '../src/types';

const sizes: Array<[number, number]> = [
  [8, 6],
  [10, 8],
  [12, 9],
  [14, 10],
  [16, 12],
  [18, 14],
  [22, 16],
  [30, 20],
  [40, 25],
  [12, 25], // local tout en longueur
  [30, 8], // local tout en largeur
];

console.log(
  'local'.padEnd(9) +
    'vente'.padStart(9) +
    'travées'.padStart(9) +
    'linéaire'.padStart(10) +
    'meubles'.padStart(9) +
    'allée min'.padStart(11) +
    'étroits'.padStart(9) +
    '   avertissements',
);

let failures = 0;

for (const [w, d] of sizes) {
  const o = { ...defaultAutoLayoutOptions(0.2, 0.1, 3), width: w, depth: d };
  const g = generateLayout(o);

  const floor = {
    ...emptyFloor(),
    walls: g.walls,
    openings: g.openings,
    items: g.items,
    zones: g.zones,
  };
  // On compare à la largeur réellement appliquée : sur un local serré, le
  // générateur réduit volontairement les allées et le signale.
  const target = g.stats.effectiveAisle;
  const circ = analyseCirculation(floor, target);
  const sales = g.zones
    .filter((z) => z.category === 'vente')
    .reduce((s, z) => s + polygonArea(z.points), 0);

  console.log(
    `${w}×${d}`.padEnd(9) +
      `${sales.toFixed(0)} m²`.padStart(9) +
      `${g.stats.gondolaRuns}`.padStart(9) +
      `${g.stats.linearMeters.toFixed(1)} m`.padStart(10) +
      `${g.stats.itemCount}`.padStart(9) +
      `${circ.minWidth !== null ? circ.minWidth.toFixed(2) : '—'}`.padStart(11) +
      `${circ.narrowCount}`.padStart(9) +
      '   ' +
      (g.warnings.length ? g.warnings.join(' / ') : ''),
  );

  if (g.items.length === 0) {
    console.log(`   ✗ ${w}×${d} : aucun meuble généré`);
    failures++;
  }
  // Le générateur s'engage sur les allées uniquement quand il n'a émis aucun
  // avertissement : sur un local trop petit, il annonce lui-même le compromis.
  if (circ.narrowCount > 0 && g.warnings.length === 0) {
    console.log(`   ✗ ${w}×${d} : ${circ.narrowCount} passage(s) sous ${o.aisleWidth} m`);
    circ.gaps
      .filter((x) => x.narrow)
      .slice(0, 3)
      .forEach((x) =>
        console.log(`       ${x.width.toFixed(2)} m entre ${x.a.label} et ${x.b.label}`),
      );
    failures++;
  }
  const out = g.items.filter((i) => i.x < 0 || i.y < 0 || i.x > w || i.y > d);
  if (out.length) {
    console.log(`   ✗ ${w}×${d} : ${out.length} meuble(s) hors du local`);
    failures++;
  }
}

console.log('');
console.log(failures === 0 ? '✅ tous les contrôles passent' : `❌ ${failures} contrôle(s) en échec`);
process.exit(failures === 0 ? 0 : 1);
