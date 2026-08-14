# PlanStore — logiciel d'aménagement de locaux commerciaux

Application web professionnelle pour concevoir l'aménagement d'une supérette ou d'un
local commercial : import du plan existant, modélisation 2D à l'échelle, passage
automatique en 3D, bibliothèque de mobilier spécialisée, analyse des circulations
clients et exports professionnels (PDF, images, impression).

Tout fonctionne côté navigateur, sans serveur ni compte utilisateur : les projets
sont enregistrés localement et peuvent être exportés en fichier.

---

## Démarrage

```bash
npm install
npm run dev        # serveur de développement sur http://localhost:5173
npm run build      # vérification TypeScript + build de production dans dist/
npm run preview    # sert le build de production sur http://localhost:4173
```

Prérequis : Node.js 18 ou supérieur. Le navigateur doit supporter WebGL pour la vue 3D.

## Mise en ligne

Le dépôt contient un workflow GitHub Actions (`.github/workflows/deploy.yml`) qui
vérifie les types, construit le bundle et le publie sur GitHub Pages à chaque push.

Une configuration manuelle est nécessaire **une seule fois** : dans
**Settings → Pages → Build and deployment**, choisir **GitHub Actions** comme source.
Le jeton du workflow n'a pas le droit de le faire à votre place. Relancez ensuite le
workflow depuis l'onglet Actions.

Attention : GitHub Pages sur un dépôt **privé** nécessite un abonnement GitHub payant.
Sur le plan gratuit, il faut rendre le dépôt public. Publier l'application n'expose
aucun de vos plans : l'application n'a pas de serveur, chaque projet reste dans le
navigateur de la personne qui l'utilise.

Alternative si le dépôt doit rester privé : Netlify ou Vercel acceptent les dépôts
privés sur leur offre gratuite. Il suffit d'y connecter le dépôt avec la commande de
build `npm run build` et le dossier de publication `dist`.

---

## Fonctionnalités

### 1. Importation du plan

- Import d'un plan au format **PDF, JPG, PNG ou WebP**. Les PDF sont rasterisés à
  haute résolution par pdf.js (première page).
- Le plan s'affiche comme **fond de travail** sous la modélisation.
- **Réglage de l'échelle par distance connue** : on trace sur le plan une longueur
  dont on connaît la valeur réelle (une façade, une porte), on saisit cette valeur en
  mètres, et tout le plan est mis à l'échelle. Un réglage fin en mètres par pixel
  reste accessible.
- Les murs se tracent **directement par-dessus** le plan importé, avec aimantation.
- Toutes les dimensions sont affichées en **mètres réels**.
- Le plan d'origine peut être **masqué / réaffiché**, verrouillé, déplacé, pivoté, et
  son opacité est réglable.

### 2. Modélisation 2D

Éditeur vectoriel complet, dessiné sur canvas :

| Élément | Détail |
|---|---|
| Murs | épaisseur et hauteur réglables, tracé en polyligne enchaînée |
| Cloisons | même outil, épaisseur par défaut distincte |
| Portes | percées dans un mur, largeur / hauteur / sens d'ouverture |
| Fenêtres | percées dans un mur, largeur / hauteur / allège |
| Poteaux | section rectangulaire ou circulaire |
| Zones | polygones nommés et colorés, surface calculée |
| Cotations | cotations manuelles + **cotations automatiques** de chaque mur |

- **Grille** au pas réglable et **aimantation** (grille, extrémités et milieux de murs,
  sommets de zones, coins d'objets, projection sur l'axe d'un mur).
- **Contrainte d'angle** par multiples de 15°.
- **Déplacement précis** à la souris, au clavier (flèches, `Maj` = pas de la grille) ou
  par saisie numérique de X/Y dans le panneau de propriétés.
- **Rotation** libre par poignée, par pas de 90°, ou par saisie de l'angle.
- **Duplication**, **suppression**, **sélection multiple** au lasso ou à `Maj`+clic.
- **Annuler / rétablir** sur 100 niveaux (`Ctrl+Z` / `Ctrl+Maj+Z`).
- Redimensionnement des objets par les poignées d'angle.

### 3. Passage 2D → 3D

- Le modèle 3D est **généré automatiquement** à partir du plan 2D, en temps réel.
- Murs à **hauteur réglable**, découpés en tronçons pleins : les portes et fenêtres
  sont de **véritables percements** traversants, avec huisseries, vitrage transparent
  et vantail de porte entrouvert.
- **Sol** (avec carrelage si conservé) et **plafond** optionnel.
- **Caméra orbitale** : rotation, panoramique, zoom molette.
- Trois cadrages : **vue extérieure**, **vue intérieure** à hauteur d'œil (placée
  automatiquement dans l'angle le plus dégagé du local) et **vue de dessus**.
- **Éclairage réaliste** : lumière hémisphérique, soleil directionnel avec ombres
  douces, lumière d'appoint, tone mapping ACES.
- Mode **2D + 3D** côte à côte, synchronisé en direct.

### 4. Bibliothèque spécifique supérette

24 modèles, avec géométrie 3D dédiée à chaque famille :

- **Rayonnage** — gondole simple face, gondole double face, tête de gondole,
  rayonnage mural, étagère, présentoir.
- **Froid** — meuble froid positif, meuble froid négatif, vitrine réfrigérée,
  bac surgelé, frigo boissons.
- **Caisse** — caisse, meuble caisse, tapis roulant, terminal de paiement, borne.
- **Autres** — panier, chariot, palette, rack de réserve, meuble promotionnel,
  présentoir, comptoir.

Chaque objet peut être déplacé, tourné, redimensionné, dupliqué, supprimé, verrouillé,
renommé, recoloré, et configuré avec ses **dimensions exactes** (largeur, profondeur,
hauteur, nombre de niveaux d'étagères).

### 5. Carrelage et existant

Case à cocher pour chacun :

- ☑ conserver le carrelage existant (teinte et format de carreau paramétrables, trame
  reprise au sol en 2D comme en 3D, et bouton pour caler la grille de travail sur les
  joints) ;
- ☑ conserver les murs existants ;
- ☑ conserver les portes existantes ;
- ☑ conserver les fenêtres existantes.

Les éléments conservés sont signalés en vert sur le plan et dans la vue 3D, de sorte que
l'aménagement se construit visiblement autour d'eux. Chaque élément peut aussi être
marqué « existant » individuellement depuis le panneau de propriétés.

### 6. Plan de supérette

Création rapide en un clic des zones métier, avec dimensions et couleur par défaut :
surface de vente, réserve, caisse, entrée, sortie, circulation clients, zone
promotionnelle, fruits et légumes, épicerie, boissons, frais, surgelés, hygiène,
entretien, plus une zone libre personnalisable. La surface de chaque zone est calculée
et affichée en permanence.

### 7. Circulation

- Mesure automatique de **tous les passages** entre meubles et entre meuble et mur.
- Affichage de la **largeur de chaque passage** directement sur le plan.
- Les passages inférieurs au seuil réglé (1,40 m par défaut, modifiable) sont
  **signalés en rouge** et listés dans le panneau de droite.
- Les mesures ignorent les passages qui traverseraient un autre meuble, afin de ne
  retenir que les circulations réelles.

### 8. Propriétés

À la sélection d'un élément, le panneau de droite affiche et rend **modifiable** :
nom, catégorie, largeur, profondeur, hauteur, position X/Y, rotation, couleur, ainsi
que les propriétés propres au type (épaisseur et longueur de mur, allège de fenêtre,
position d'une ouverture sur son mur, opacité d'une zone…). Toutes les valeurs sont
saisissables au centième de mètre. Sans sélection, le panneau affiche la synthèse du
plan et le rapport de circulation.

### 9. Projets

Nouveau, ouvrir, enregistrer, dupliquer, renommer, supprimer, plus une **sauvegarde
automatique** (4 secondes après la dernière modification, et à la fermeture de
l'onglet). Les projets vivent dans le stockage local du navigateur et peuvent être
exportés / réimportés en fichier `.json` pour être archivés ou transférés.

### 10. Export professionnel

- **Plan 2D en PDF** A4 paysage, en rendu noir et blanc, avec cartouche complet
  (nom, date, échelle approximative 1:N, hauteur sous plafond, quantités, surfaces,
  conformité des circulations, existant conservé) et une seconde page de légende des
  zones et de nomenclature du mobilier.
- **Plan 2D en image PNG** haute définition.
- **Vue 3D en image PNG**.
- **Impression** du plan mis en page avec son cartouche.
- **Export du projet** en fichier `.json`.

### 11. Interface

Barre supérieure (projet, enregistrement, exports, bascule 2D / 3D / 2D+3D), barre
latérale gauche à onglets (bibliothèque d'objets, zones, plan importé, existant,
réglages), barre d'outils, grande zone de travail, panneau de propriétés à droite,
contrôles de zoom et notifications.

### 12. Usage sur téléphone et tablette

En dessous de 860 px de large, l'interface se réorganise pour laisser tout l'écran au
plan :

- les deux panneaux deviennent des **tiroirs coulissants**, ouverts par la barre basse
  et refermés par un bouton dédié ou en touchant à côté ;
- choisir un objet dans la bibliothèque **referme le tiroir automatiquement**, pour
  pouvoir le poser immédiatement ;
- la barre d'outils défile horizontalement, tous les outils restent accessibles ;
- la barre basse regroupe bibliothèque, propriétés, zoom et cadrage ;
- **pincer à deux doigts zoome et déplace le plan** en un seul geste, ce qui remplace
  la molette ; un doigt suffit pour sélectionner, déplacer et tracer ;
- la vue 3D se manipule au doigt (rotation à un doigt, déplacement et zoom à deux).

---

## Raccourcis clavier

| Raccourci | Action |
|---|---|
| `V` / `H` | Sélection / Navigation |
| `M` / `C` | Mur / Cloison |
| `P` / `F` | Porte / Fenêtre |
| `O` / `Z` / `K` | Poteau / Zone / Cotation |
| `Entrée` | Terminer la polyligne en cours |
| `Échap` | Annuler l'outil ou la sélection |
| `Ctrl+Z` / `Ctrl+Maj+Z` | Annuler / Rétablir |
| `Ctrl+D` | Dupliquer la sélection |
| `Ctrl+A` | Tout sélectionner |
| `Ctrl+S` | Enregistrer |
| `R` / `Maj+R` | Pivoter de 90° / −90° |
| `Suppr` | Supprimer la sélection |
| Flèches | Déplacer de 5 cm (`Maj` : pas de la grille) |
| Molette | Zoomer autour du curseur |
| `Alt`+glisser, clic milieu | Naviguer dans le plan |

---

## Architecture du code

```
src/
  types.ts                 modèle de données (mètres, degrés) et valeurs par défaut
  state/
    store.ts               store Zustand : projet, sélection, outils, historique
    projects.ts            persistance locale, import/export de fichier projet
  lib/
    geometry.ts            vecteurs, aimantation, polygones, cotations
    catalog.ts             bibliothèque des 24 objets supérette
    zones.ts               préréglages des zones du magasin
    circulation.ts         distances entre empreintes, détection des allées étroites
    importPlan.ts          import PDF (pdf.js) / images, mise à l'échelle initiale
    exporters.ts           PDF (jsPDF), PNG, impression, cartouche
  editor2d/
    Canvas2D.tsx           interactions : outils, glisser-déposer, clavier
    render.ts              moteur de rendu du plan (écran, impression, export)
    hit.ts                 sélection, poignées, points d'accrochage
    bgImage.ts             cache de l'image du plan importé
  view3d/
    Scene3D.tsx            scène three.js, caméra orbitale, cadrages, capture
    builders.ts            génération de la géométrie 3D depuis le plan 2D
  ui/                      barre d'outils, panneaux, modales, champs de saisie
```

Le rendu 2D est une fonction pure `renderPlan(ctx, options)` : la même routine sert à
l'affichage écran, à l'export PDF et à l'impression, ce qui garantit que le document
imprimé correspond exactement à ce qui est à l'écran.

L'historique conserve des instantanés du contenu éditable ; la data-URL du plan importé
est partagée entre instantanés plutôt que recopiée, afin de rester léger en mémoire.

---

## Pile technique

React 18 · TypeScript (mode strict) · Vite 5 · Zustand 5 · three.js · pdf.js · jsPDF

## Limites connues

- Les projets sont stockés dans le `localStorage` du navigateur, dont la capacité est
  de quelques mégaoctets : un plan importé très lourd peut saturer le quota. Un message
  l'indique et l'export en fichier `.json` reste toujours possible.
- Un seul niveau (rez-de-chaussée) par projet.
- Seule la première page d'un PDF importé est utilisée.
