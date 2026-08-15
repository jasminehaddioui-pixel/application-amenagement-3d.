/**
 * Fabrique une version de l'application en UN SEUL FICHIER HTML.
 *
 *   npm run build && npm run fichier-unique
 *
 * Le fichier produit s'ouvre directement depuis le téléphone ou l'ordinateur,
 * par double-clic ou depuis une pièce jointe : aucun serveur, aucun réseau. Il
 * sert quand l'hébergement n'est pas joignable — connexion filtrée, entreprise,
 * déplacement — ou simplement pour archiver une version du plan.
 *
 * Ce qui reste indisponible dans cette version : l'import d'un plan PDF et les
 * exports PDF / image, qui reposent sur des morceaux de code chargés à la
 * demande et qu'un fichier isolé ne peut pas aller chercher. Le plan, la 3D,
 * les cotations et l'analyse des circulations fonctionnent normalement.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

let html;
try {
  html = readFileSync(join(dist, 'index.html'), 'utf8');
} catch {
  console.error("dist/index.html est introuvable : lancez d'abord « npm run build ».");
  process.exit(1);
}

// --- garde-fou : les morceaux chargés à la demande n'existent pas ici
const guard = `<script>
// Fichier autonome : les modules chargés à la demande (import et export PDF)
// ne peuvent pas être récupérés. On le dit clairement plutôt que de laisser
// l'action échouer en silence.
window.addEventListener('unhandledrejection', function (e) {
  var m = String((e.reason && e.reason.message) || e.reason || '');
  if (m.indexOf('Failed to fetch dynamically imported module') === -1) return;
  e.preventDefault();
  alert(
    "Cette fonction (import ou export de PDF) n'est pas disponible dans le fichier autonome.\\n" +
      'Utilisez la version en ligne pour cela.',
  );
});
</script>`;
html = html.replace('</head>', `${guard}\n</head>`);

const assets = readdirSync(join(dist, 'assets'));
const readAsset = (name) => readFileSync(join(dist, 'assets', name), 'utf8');

// --- feuille de style
const cssName = assets.find((f) => f.startsWith('index-') && f.endsWith('.css'));
if (!cssName) {
  console.error('Aucune feuille de style trouvée dans dist/assets.');
  process.exit(1);
}
html = html.replace(
  /<link[^>]+rel="stylesheet"[^>]*>/,
  `<style>\n${readAsset(cssName)}\n</style>`,
);

// --- script principal
// Le bundle est embarqué en URL de données plutôt que collé tel quel dans la
// page : un bundle de plus d'un mégaoctet contient forcément des séquences que
// l'analyseur HTML interpréterait — à commencer par une balise de fermeture de
// script dans une chaîne de caractères — et la page se briserait en silence.
const jsName = assets.find((f) => /^index-.*\.js$/.test(f));
if (!jsName) {
  console.error('Aucun script principal trouvé dans dist/assets.');
  process.exit(1);
}
const js64 = readFileSync(join(dist, 'assets', jsName)).toString('base64');
html = html.replace(
  /<script[^>]+src="[^"]*index-[^"]*\.js"[^>]*><\/script>/,
  `<script type="module" src="data:text/javascript;base64,${js64}"></script>`,
);


const outDir = join(root, 'dist-fichier-unique');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'PlanStore-Hagetmau.html');
writeFileSync(out, html, 'utf8');

const ko = (n) => `${(n / 1024).toFixed(0)} Ko`;
console.log(`Fichier unique écrit : ${out}`);
console.log(`Taille : ${ko(Buffer.byteLength(html))}`);
