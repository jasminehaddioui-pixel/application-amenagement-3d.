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

npm run verifier:implantation   # contrôle du générateur automatique
npm run verifier:hagetmau       # contrôle géométrique du magasin de référence
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
| Fenêtres | percées dans un mur, largeur / hauteur / allège — sert aussi de vitrine |
| Portes vitrées automatiques | devanture de magasin : deux vantaux coulissants qui s'effacent latéralement, rail au-dessus, passage libre sur toute la largeur de la baie |
| Poteaux | section rectangulaire ou circulaire |
| Zones | polygones nommés et colorés, surface calculée |
| Cotations | cotations manuelles + **cotation automatique de tout le plan** : longueur de chaque mur, largeur de chaque baie, section de chaque poteau, largeur et profondeur de chaque meuble. Chaque famille n'apparaît qu'au zoom où elle reste lisible, de sorte que la vue d'ensemble ne se noie pas sous les chiffres |

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
- Affichage de la **largeur de chaque passage** directement sur le plan, en vert
  au-dessus du seuil, en rouge en dessous.
- Les passages inférieurs au seuil réglé (1,50 m pour le projet de référence, seuil
  PMR retenu ; modifiable) sont **signalés en rouge** et listés dans le panneau de
  droite.
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

## Projet de référence : Panier Sympa — Hagetmau

L'application s'ouvre directement sur le magasin de **Hagetmau (40700)**, monté à
l'échelle réelle à partir des documents du projet. Il est rechargeable à tout moment
par `Projets` → `Charger « Panier Sympa — Hagetmau »`.

Sources utilisées, par ordre d'autorité :

| Document | Ce qui en est repris |
|---|---|
| Plan coté du local (« Prévoir défoncement du dallage des chambres froides ») | la **coque complète** : chaîne de cotes du mur du fond `20 \| 3,00 \| 35 \| 1,45 \| 35 \| 3,15 \| 25 \| 3,15 \| 35 \| labo`, chaîne du mur gauche `2,45 \| 23 \| 2,70 \| 38 \| 2,70 \| 38 \| 2,70 \| 38`, et la forme en L (l'aile gauche s'arrête au mur biais, le magasin continue seul jusqu'à la rue) |
| Relevé manuscrit « HAGETMAU », reporté sur ce même plan | le **magasin** : 800 de large, 2320 de long, 1600 de vente depuis la façade, poteaux à 1390 / 1000 / 538-290 / 160 + 50, gaine 110 × 70, porte de service 150 |
| Dossier Technique Amiante n° 25/1412/BARICOS, § 7.1 | confirme la distribution : locaux au fond, réserves en retour à gauche, magasin sur le reste |
| Plan d'implantation `hagetmau_2` | lockers Amazon, presse, entrée en pignon, largeurs d'allées visées |
| Devis RAY-ORG n° DE2026-133 | muraux h. 2200 (module 1000, profondeur 550, 17,12 ml), 8 modules centraux double face h. 2200, 4 têtes de gondole 1,03 ml, modules et têtes h. 1500 |
| Trame devis TILT | caisse bi-optique L 1400, îlot fruits et légumes H 155 de 2 ml |
| Dossier technique EPTA n° 260710-6140B | cotes hors tout exactes du froid : EIS 162 HP (1875 × 786 × 2035), EIS 112 HP (1250 × 786 × 2032), Multifreeze Plus Efficia 3P (2100 × 763 × 2033) |

Chaque meuble porte sa **référence de devis**, visible et modifiable dans le panneau
de propriétés. Les murs, poteaux et portes sont marqués « existant » et le carrelage
est conservé : l'aménagement se construit autour.

**La maquette couvre tout le bâtiment**, pas seulement la surface de vente.
Le local est un seul volume : les chambres froides et le laboratoire dessinés sur le
tirage appartenaient à l'aménagement précédent et ont été déposés. Il ne reste que la
coque, le mur de la réserve, et les trois murs des bureaux — **ce sont les seules
cloisons**. En particulier, il n'y a pas de refend entre l'aile gauche et le magasin :
la ligne visible à cet endroit sur le relevé est une ligne de cote, pas un mur.

| | |
|---|---|
| **Réserve**, bande du fond, 2,45 m de profondeur sur toute la largeur | 39,7 m², c'est le seul local de stockage : c'est là que sont les groupes. Cinq racks lourds adossés au mur du fond, allée de service de 1,35 m devant |
| **Bureau 1** et **Bureau 2**, dans l'aile gauche | 15,9 et 16,4 m², les seuls autres locaux cloisonnés, conservés tels quels |
| Reste du volume, hors vente implantée | **de la surface de vente non aménagée**, 68 m². Ce n'est pas de la réserve : c'est du volume disponible, comptabilisé à part de la surface exploitée |
| Fond de la vente | **4,00 ml de lockers Amazon** côté gauche, un passage de service de 1,97 m, puis une gondole double face adossée au mur droit : c'est le mobilier qui ferme la vente, il n'y a pas de cloison |
| Surface de vente exploitée | 18,00 × 8,00 m, deux files de gondoles, froid en périphérie droite, muraux en périphérie gauche |
| Rive gauche | **une gondole continue** du fond de vente jusqu'à la caisse : 5 modules simple face à dos plein là où il n'y a pas de mur, puis 8 muraux, le départ à fond perforé, et 2 modules d'alcools forts |
| Avant-magasin | **caisse posée en retour contre la rive gauche** : elle ferme la travée d'alcools forts, qui devient un cul-de-sac sous l'œil de l'hôte de caisse — on ne peut pas atteindre les bouteilles sans passer devant lui. **Îlot fruits et légumes au centre, dans l'axe de l'entrée**, dégagé de 1,59 m des gondoles basses. Presse en façade à droite, devant la vitrine |
| Façade sur rue | devanture vitrée : vitrine fixe, porte vitrée automatique à deux vantaux, vitrine fixe — d'après le BAT Agelia « Panier Sympa de Hagetmau, mise en situation V2 » |
| Total | 16,20 × 25,85 m dans œuvre, 144 m² de vente exploitée, 68 m² de vente encore libre, 39,7 m² de réserve |

Le mur de flanc gauche du magasin ne commence qu'au droit du mur biais : au-dessus, la
vente ouvre sur le volume libre. Les muraux ne sont donc posés qu'à partir de là ;
plus haut, deux lockers Amazon autoportants tiennent la rive et coiffent le poteau P2.

**Accessibilité PMR** (arrêté du 8 décembre 2014, ERP existants). Le seuil
réglementaire d'une circulation intérieure est de 1,20 m ; le plan retient **1,50 m**,
largeur qui permet à un fauteuil de croiser un client et de faire demi-tour sur place.
C'est aussi le seuil utilisé par l'analyse de circulation du logiciel.

| | |
|---|---|
| Allées entre gondoles | **1,55 m** — les trois sont égales |
| Allée de tête et allée transversale | **1,80 m** |
| Passage de service vers le fond | 1,94 m |
| Portes de la réserve | deux passages de 1,50 m |
| Porte d'entrée automatique | 1,80 m de passage libre, sans seuil ni battant |
| Portes des bureaux | 0,90 m |
| Passage le plus étroit du magasin | **1,50 m**, mesuré par le contrôle |

Le contrôle `npm run verifier:hagetmau` liste les huit passages les plus serrés du
magasin avec leur position, ce qui permet de vérifier point par point que rien ne
descend sous le seuil. Sur l'implantation actuelle, les huit sont exactement à
1,50 m : ce sont les trois allées entre gondoles, dont la largeur est calculée pour
tomber juste au seuil compte tenu des meubles les plus profonds de chaque rive.
L'affichage des circulations est activé dès l'ouverture du projet.

Pour tenir ces largeurs dans 8,00 m de magasin, **tout le froid positif a été
regroupé sur la rive droite** : la rive gauche ne porte plus que des muraux de 550 mm
au lieu d'un meuble frigorifique de 786, ce qui rend 23 cm à chacune des trois allées.
Et parce que la réserve se limite à la bande du fond, la surface de vente exploitée
occupe 18,00 m sur les 25,85 m du magasin : l'avant-magasin dispose de la place de
manœuvre exigée pour un fauteuil, et la vente atteint 144 m² — sans compter les 68 m²
encore libres derrière la file de gondoles.

**Traitement des poteaux.** Les poteaux ne coupent plus le linéaire : quand un poteau
tombe dans l'emprise d'un meuble, le meuble est posé de façon à l'englober — c'est
l'habillage de poteau, pratique courante en agencement. P5 est habillé par un mural,
P2 par un locker, P4 par une tête de gondole, P3 par un module de gondole basse. P1
reste apparent : il tombe dans le volume libre, au-dessus du départ du mur de flanc.
La gaine technique (110 × 70) est contournée — on ne coffre pas une gaine dans un
meuble frigorifique.

**Ce qui est posé, et l'écart au devis.**

| Poste | Posé | Devis | Écart |
|---|---|---|---|
| Muraux h. 2200 | 11 modules + 1 départ à fond perforé | 17,12 ml | −5 ml, faute de mur où les adosser |
| Gondoles simple face à dos plein | 5 modules | — | poste nouveau, remplace les muraux là où il n'y a pas de mur |
| Gondole alcools forts | 2 modules | — | poste nouveau |
| Modules centraux h. 2200 | 9 (8 en files + 1 au fond) | 8 | +1 |
| Têtes de gondole h. 2200 | 5 | 4 | +1 |
| Modules h. 1500 | 5 (2 en file A, 3 en file B) | 5 | conforme |
| Lockers Amazon | 4,00 ml | — | selon la consigne |
| Froid positif | **4 meubles de 2 portes** (EIS 112 HP), soit 8 portes | 10 portes en 12 modèles panachés | parc homogène, 2 portes de moins |
| Froid négatif | **3 meubles de 2 portes** (Multifreeze 2P), soit 6 portes | 6 portes en 2 meubles de 3 portes | même nombre de portes, meubles plus petits |

Les 5 ml de muraux manquants sont remplacés par des modules simple face à dos plein,
autoportants : sur la moitié nord de la rive gauche il n'y a pas de mur où s'adosser,
la ligne ferme elle-même la vente côté volume libre. Côté froid, le deuxième meuble
2 portes est remplacé par une armoire positive une porte, type Metro, placée dans
cette même ligne. Le parc froid est ramené à un seul format, le deux portes :
quatre meubles positifs et trois négatifs, tous sur la rive droite. Le linéaire
libéré par les anciens meubles trois portes est repris en rayonnage.

**Mise à jour du magasin de référence.** Le projet porte un numéro de révision
(`HAGETMAU_REVISION`, en tête de `src/lib/projects/hagetmau.ts`). L'application le
compare à celui de la copie enregistrée dans le navigateur : si la copie est plus
ancienne, elle ouvre la version à jour et le signale. Sans ce mécanisme, un visiteur
qui a déjà ouvert l'application se verrait resservir indéfiniment l'ancien plan,
quelle que soit la mise en ligne. **Ce numéro doit être incrémenté à chaque fois que
le plan de référence change.** La copie précédente n'est pas effacée : elle reste dans
la liste des projets.

**Contrôle mécanique.** `npm run verifier:hagetmau` reconstruit le bâtiment et vérifie
qu'aucun meuble ne chevauche un autre meuble ou la coque, que chaque ouverture tient
dans son mur, qu'aucune allée client ne descend sous le seuil PMR de 1,50 m et
qu'aucune porte ne descend sous 0,90 m. Les poteaux sont traités à part : un poteau
entièrement contenu dans l'emprise d'un meuble est listé comme habillé, un
recouvrement partiel reste une erreur.

## Raccourcis clavier

| Raccourci | Action |
|---|---|
| `V` / `H` | Sélection / Navigation |
| `M` / `C` | Mur / Cloison |
| `P` / `F` | Porte / Fenêtre |
| `B` | Porte vitrée automatique |
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
