/**
 * Modele de donnees du module de gestion (superette).
 *
 * Principe fondateur : le STOCK N'EST JAMAIS UNE VALEUR QU'ON ECRIT.
 * C'est la somme du journal des mouvements. Toute variation de quantite passe
 * par un StockMovement date, signe et motive. Le stock affiche est recalcule
 * depuis ce journal : il est donc toujours coherent et toujours auditable.
 *
 * Conventions :
 *  - les montants sont en EUROS, stockes en nombre decimal (arrondi a l'affichage) ;
 *  - les prix d'achat et de vente de reference sont HORS TAXES ;
 *  - les dates sont des timestamps (ms) ou des chaines ISO 'YYYY-MM-DD' pour les
 *    dates sans heure (DLC, echeances, periodes d'exercice) ;
 *  - aucun taux de TVA n'est ecrit en dur : ils vivent dans `db.vatRates`.
 */

export type ISODate = string; // 'YYYY-MM-DD'

// ---------------------------------------------------------------- societe

/** Parametres societe. Tout ce qui depend du regime fiscal est configurable. */
export interface Company {
  name: string;
  legalForm: string;
  siren: string;
  siret: string;
  vatNumber: string;
  ape: string;
  capital: string;
  address: string;
  postalCode: string;
  city: string;
  phone: string;
  email: string;
  /** Regime fiscal declare (texte libre : a valider par l'expert-comptable) */
  taxRegime: string;
  /** Regime de TVA declare (texte libre : a valider par l'expert-comptable) */
  vatRegime: string;
  /** Periodicite declarative de la TVA */
  vatPeriodicity: 'mensuelle' | 'trimestrielle' | 'annuelle' | 'autre';
  /** Exercice comptable : jour/mois de debut et de fin, format 'JJ/MM' */
  fiscalYearStart: string;
  fiscalYearEnd: string;
  accountantName: string;
  accountantFirm: string;
  accountantEmail: string;
  accountantPhone: string;
}

/** Un taux de TVA parametrable. Rien n'est code en dur. */
export interface VatRate {
  id: string;
  /** Libelle affiche : « Taux normal », « Taux reduit alimentaire »… */
  label: string;
  /** Taux en pourcentage, ex. 5.5 */
  rate: number;
  /** Compte de TVA collectee, si l'expert-comptable l'a communique */
  accountCollected?: string;
  /** Compte de TVA deductible, si l'expert-comptable l'a communique */
  accountDeductible?: string;
  active: boolean;
  /** Note de rattachement : a faire valider par l'expert-comptable */
  note?: string;
}

// ---------------------------------------------------------------- referentiels

export interface Family {
  id: string;
  name: string;
  /** Famille parente (sous-famille si renseigne) */
  parentId: string | null;
  /** Rayon physique du magasin */
  aisle?: string;
  /** Taux de marge cible en % (sert aux alertes de marge insuffisante) */
  targetMarginRate?: number;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  siret: string;
  address: string;
  postalCode: string;
  city: string;
  contact: string;
  phone: string;
  email: string;
  /** Conditions de reglement, ex. « 30 jours fin de mois » */
  paymentTerms: string;
  /** Delai de livraison en jours (utilise par la prevision de commande) */
  leadTimeDays: number;
  /** Franco de port en euros HT (0 = pas de franco) */
  freeShippingFrom: number;
  /** Minimum de commande en euros HT */
  minOrderAmount: number;
  /** Remise de base en % */
  discountRate: number;
  /** Remise de fin d'annee en % */
  rfaRate: number;
  /** Jours de livraison habituels (0 = dimanche) */
  deliveryDays: number[];
  notes: string;
  active: boolean;
}

/** Lien produit <-> fournisseur : un produit peut avoir plusieurs sources. */
export interface SupplierLink {
  supplierId: string;
  /** Reference du produit chez ce fournisseur */
  reference: string;
  /** Prix d'achat HT chez ce fournisseur, par unite d'achat */
  purchasePrice: number;
  /** Remise specifique en % */
  discountRate: number;
  /** Nombre d'unites de vente par unite d'achat (colis) */
  packSize: number;
  /** Fournisseur principal du produit */
  primary: boolean;
}

export type ProductUnit = 'piece' | 'kg' | 'litre' | 'lot';

export interface Product {
  id: string;
  /** Reference interne */
  ref: string;
  /** Code-barres EAN */
  ean: string;
  name: string;
  brand: string;
  familyId: string | null;
  subFamilyId: string | null;
  suppliers: SupplierLink[];
  /** Unite d'achat (ce qu'on commande) */
  purchaseUnit: ProductUnit;
  /** Unite de vente (ce qui passe en caisse) */
  saleUnit: ProductUnit;
  /** Description du conditionnement, ex. « carton de 24 » */
  packaging: string;
  /** Unites de vente par carton */
  unitsPerCase: number;
  /** Prix d'achat HT de reference (unite de vente) */
  purchasePrice: number;
  vatRateId: string;
  /** Prix de vente HT */
  salePriceHT: number;
  /** Prix de vente TTC (saisi ou calcule) */
  salePriceTTC: number;
  stockMin: number;
  stockMax: number;
  /** Stock de securite : tampon conserve en plus du besoin calcule */
  safetyStock: number;
  /** Emplacement en surface de vente */
  location: string;
  /** Emplacement en reserve */
  reserveLocation: string;
  /** Produit soumis a DLC/DDM */
  perishable: boolean;
  /** Gestion par lots activee */
  lotTracked: boolean;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  notes: string;
}

/** Un lot physique, avec sa date limite. */
export interface Lot {
  id: string;
  productId: string;
  /** Numero de lot fournisseur */
  code: string;
  /** DLC ou DDM */
  expiry: ISODate;
  /** Quantite entree sur ce lot */
  quantity: number;
  receptionId: string | null;
  createdAt: number;
}

// ---------------------------------------------------------------- mouvements

/**
 * Nature d'un mouvement de stock. Le signe est porte par la quantite,
 * mais chaque nature a un sens attendu (cf. MOVEMENT_SIGN dans calc.ts).
 */
export type MovementType =
  | 'reception'
  | 'vente'
  | 'casse'
  | 'perime'
  | 'vol'
  | 'demarque'
  | 'retour_fournisseur'
  | 'transfert'
  | 'inventaire'
  | 'regularisation'
  | 'initial';

export interface StockMovement {
  id: string;
  productId: string;
  type: MovementType;
  /** Quantite signee : positive en entree, negative en sortie */
  quantity: number;
  /** Stock avant le mouvement (photo, pour l'audit) */
  before: number;
  /** Stock apres le mouvement (photo, pour l'audit) */
  after: number;
  /** Prix d'achat unitaire HT au moment du mouvement (valorisation) */
  unitCost: number;
  date: number;
  userId: string;
  reason: string;
  /** Document rattache : commande, reception, inventaire, perte, vente… */
  docType?: 'commande' | 'reception' | 'inventaire' | 'perte' | 'vente' | 'autre';
  docId?: string;
  lotId?: string;
}

// ---------------------------------------------------------------- achats

export type OrderStatus = 'brouillon' | 'envoyee' | 'partielle' | 'receptionnee' | 'annulee';

export interface OrderLine {
  productId: string;
  /** Libelle fige au moment de la commande */
  label: string;
  /** Quantite commandee, en unites de vente */
  quantity: number;
  /** Prix d'achat unitaire HT retenu */
  unitPrice: number;
  discountRate: number;
  vatRateId: string;
  /** Quantite deja receptionnee (cumul des receptions rattachees) */
  received: number;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  supplierId: string;
  status: OrderStatus;
  createdAt: number;
  sentAt: number | null;
  /** Date de livraison attendue */
  expectedAt: ISODate | null;
  lines: OrderLine[];
  /** Frais de port HT */
  shipping: number;
  notes: string;
  userId: string;
}

export interface ReceptionLine {
  productId: string;
  label: string;
  /** Quantite annoncee sur la commande */
  ordered: number;
  /** Quantite reellement recue et acceptee */
  received: number;
  /** Quantite refusee (casse au transport, non conforme) */
  refused: number;
  /** Prix d'achat reel constate sur le bon/facture */
  unitPrice: number;
  discountRate: number;
  vatRateId: string;
  lotCode?: string;
  expiry?: ISODate;
}

export interface Reception {
  id: string;
  number: string;
  orderId: string | null;
  supplierId: string;
  date: number;
  lines: ReceptionLine[];
  shipping: number;
  /** Numero du bon de livraison fournisseur */
  deliveryNote: string;
  notes: string;
  userId: string;
  /** Une reception validee a genere ses mouvements de stock : elle est figee. */
  validated: boolean;
}

export type InvoiceStatus = 'a_rapprocher' | 'rapprochee' | 'litige' | 'payee';

export interface SupplierInvoice {
  id: string;
  number: string;
  supplierId: string;
  date: ISODate;
  dueDate: ISODate | null;
  /** Receptions rattachees */
  receptionIds: string[];
  totalHT: number;
  /** Ventilation de la TVA par taux */
  vatBreakdown: Array<{ vatRateId: string; base: number; vat: number }>;
  totalTTC: number;
  status: InvoiceStatus;
  /** Avoir (montant negatif attendu) */
  isCredit: boolean;
  /** Justificatif rattache (nom + data URL) */
  attachment: Attachment | null;
  notes: string;
}

export interface Payment {
  id: string;
  supplierId: string;
  invoiceId: string | null;
  date: ISODate;
  amount: number;
  method: PaymentMethod;
  reference: string;
  notes: string;
}

export type PaymentMethod = 'especes' | 'cb' | 'cheque' | 'virement' | 'prelevement' | 'titre' | 'autre';

// ---------------------------------------------------------------- ventes

export interface SaleLine {
  productId: string;
  label: string;
  quantity: number;
  /** Prix de vente unitaire TTC effectivement encaisse */
  unitPriceTTC: number;
  vatRateId: string;
  /** Prix d'achat unitaire HT au moment de la vente (fige pour la marge) */
  unitCost: number;
  /** Remise ligne en % (demarque commerciale) */
  discountRate: number;
}

/** Un ticket de caisse, saisi ou importe depuis la caisse. */
export interface Sale {
  id: string;
  number: string;
  date: number;
  lines: SaleLine[];
  paymentMethod: PaymentMethod;
  userId: string;
  /** Ticket importe depuis un fichier de caisse */
  imported: boolean;
  notes: string;
}

// ---------------------------------------------------------------- inventaire

export type InventoryScope = 'complet' | 'rayon' | 'famille' | 'fournisseur' | 'emplacement' | 'partiel';

export interface InventoryLine {
  productId: string;
  label: string;
  /** Stock theorique fige a l'ouverture de l'inventaire */
  theoretical: number;
  /** Stock reellement compte (null tant que non compte) */
  counted: number | null;
  /** Prix d'achat unitaire HT retenu pour valoriser l'ecart */
  unitCost: number;
}

export interface Inventory {
  id: string;
  number: string;
  label: string;
  scope: InventoryScope;
  /** Valeur du filtre selon le perimetre (id de famille, de fournisseur, nom de rayon…) */
  scopeValue: string;
  openedAt: number;
  closedAt: number | null;
  lines: InventoryLine[];
  userId: string;
  notes: string;
  /** Un inventaire cloture a genere ses mouvements de regularisation. */
  closed: boolean;
}

// ---------------------------------------------------------------- pertes

export type LossReason =
  | 'casse'
  | 'perime'
  | 'dlc'
  | 'abime'
  | 'vol'
  | 'erreur_reception'
  | 'erreur_saisie'
  | 'demarque_commerciale'
  | 'demarque_inconnue';

export interface Loss {
  id: string;
  number: string;
  date: number;
  productId: string;
  quantity: number;
  /** Prix d'achat unitaire HT au moment de la perte */
  unitCost: number;
  vatRateId: string;
  reason: LossReason;
  userId: string;
  notes: string;
  lotId?: string;
}

// ---------------------------------------------------------------- historique prix

export interface PriceHistoryEntry {
  id: string;
  productId: string;
  supplierId: string | null;
  date: number;
  /** Ancien prix d'achat HT */
  from: number;
  /** Nouveau prix d'achat HT */
  to: number;
  /** Taux de marge avant / apres, pour mesurer l'impact */
  marginBefore: number;
  marginAfter: number;
  source: 'reception' | 'saisie' | 'import';
  userId: string;
}

// ---------------------------------------------------------------- utilisateurs / audit

export type Role = 'gerant' | 'employe' | 'comptable';

export interface User {
  id: string;
  name: string;
  role: Role;
  active: boolean;
}

export interface AuditEntry {
  id: string;
  date: number;
  userId: string;
  /** Domaine touche : 'produit', 'stock', 'commande'… */
  scope: string;
  /** Action effectuee, en clair */
  action: string;
  /** Cible : identifiant + libelle */
  targetId: string;
  targetLabel: string;
  before?: string;
  after?: string;
  reason?: string;
}

// ---------------------------------------------------------------- documents

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  /** Contenu en data URL. Volumineux : a deporter en base lors du passage en production. */
  dataUrl: string;
  addedAt: number;
}

export interface StoredDocument {
  id: string;
  number: string;
  kind: 'facture' | 'avoir' | 'bon_commande' | 'bon_reception' | 'releve' | 'justificatif' | 'autre';
  label: string;
  date: ISODate;
  /** Rattachement metier */
  linkType?: 'fournisseur' | 'commande' | 'reception' | 'facture' | 'inventaire' | 'autre';
  linkId?: string;
  amount: number | null;
  attachment: Attachment | null;
  notes: string;
}

// ---------------------------------------------------------------- parametres

/** Seuils d'alerte, tous configurables. */
export interface AlertSettings {
  /** Jours de couverture en dessous desquels on signale une rupture imminente */
  ruptureDays: number;
  /** Taux de marge minimal acceptable en % */
  minMarginRate: number;
  /** Hausse de prix d'achat en % declenchant une alerte */
  priceIncreaseRate: number;
  /** Nombre de jours sans vente avant de signaler un produit dormant */
  noSaleDays: number;
  /** Jours avant DLC declenchant le controle */
  dlcWarningDays: number;
  /** Ecart d'inventaire en % de la valeur declenchant une alerte */
  inventoryGapRate: number;
  /** Nombre de jours entre deux inventaires */
  inventoryIntervalDays: number;
  /** Ecart en euros entre facture et reception declenchant un litige */
  invoiceGapAmount: number;
}

export interface GestionSettings {
  alerts: AlertSettings;
  /** Nombre de jours d'historique de vente utilise par la prevision */
  forecastWindowDays: number;
  /** Coefficient de saisonnalite applique a la prevision (1 = neutre) */
  seasonalityFactor: number;
  /** Moyens de paiement acceptes en caisse */
  paymentMethods: PaymentMethod[];
  /** Fond de caisse en euros */
  cashFloat: number;
  /** Sauvegarde automatique a chaque modification */
  autoSave: boolean;
  /** Nombre de sauvegardes de securite conservees en local */
  backupCount: number;
}

// ---------------------------------------------------------------- base

/** Numerotation continue des documents, par prefixe. */
export interface Counters {
  [prefix: string]: number;
}

/** Racine de la base de gestion. Un seul objet, versionne et migrable. */
export interface GestionDB {
  /** Version du schema, pour les migrations */
  schemaVersion: number;
  /** Compteur de revision : incremente a chaque mutation (invalidation des index) */
  rev: number;
  updatedAt: number;
  company: Company;
  vatRates: VatRate[];
  families: Family[];
  suppliers: Supplier[];
  products: Product[];
  lots: Lot[];
  movements: StockMovement[];
  orders: PurchaseOrder[];
  receptions: Reception[];
  invoices: SupplierInvoice[];
  payments: Payment[];
  sales: Sale[];
  inventories: Inventory[];
  losses: Loss[];
  priceHistory: PriceHistoryEntry[];
  documents: StoredDocument[];
  users: User[];
  currentUserId: string;
  audit: AuditEntry[];
  settings: GestionSettings;
  counters: Counters;
}

export const SCHEMA_VERSION = 1;

export const defaultCompany = (): Company => ({
  name: 'Ma supérette',
  legalForm: 'SARL',
  siren: '',
  siret: '',
  vatNumber: '',
  ape: '',
  capital: '',
  address: '',
  postalCode: '',
  city: '',
  phone: '',
  email: '',
  taxRegime: 'À renseigner — à valider par l’expert-comptable',
  vatRegime: 'À renseigner — à valider par l’expert-comptable',
  vatPeriodicity: 'mensuelle',
  fiscalYearStart: '01/01',
  fiscalYearEnd: '31/12',
  accountantName: '',
  accountantFirm: '',
  accountantEmail: '',
  accountantPhone: '',
});

export const defaultAlerts = (): AlertSettings => ({
  ruptureDays: 3,
  minMarginRate: 15,
  priceIncreaseRate: 5,
  noSaleDays: 60,
  dlcWarningDays: 7,
  inventoryGapRate: 2,
  inventoryIntervalDays: 90,
  invoiceGapAmount: 5,
});

export const defaultSettings = (): GestionSettings => ({
  alerts: defaultAlerts(),
  forecastWindowDays: 30,
  seasonalityFactor: 1,
  paymentMethods: ['especes', 'cb', 'cheque', 'titre'],
  cashFloat: 150,
  autoSave: true,
  backupCount: 5,
});

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  reception: 'Entrée fournisseur',
  vente: 'Sortie vente',
  casse: 'Casse',
  perime: 'Périmé',
  vol: 'Vol',
  demarque: 'Démarque',
  retour_fournisseur: 'Retour fournisseur',
  transfert: 'Transfert',
  inventaire: "Correction d'inventaire",
  regularisation: 'Régularisation',
  initial: 'Stock initial',
};

export const LOSS_LABEL: Record<LossReason, string> = {
  casse: 'Casse',
  perime: 'Produit périmé',
  dlc: 'DLC dépassée',
  abime: 'Produit abîmé',
  vol: 'Vol',
  erreur_reception: 'Erreur de réception',
  erreur_saisie: 'Erreur de saisie',
  demarque_commerciale: 'Démarque commerciale',
  demarque_inconnue: 'Démarque inconnue',
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  especes: 'Espèces',
  cb: 'Carte bancaire',
  cheque: 'Chèque',
  virement: 'Virement',
  prelevement: 'Prélèvement',
  titre: 'Titre-restaurant',
  autre: 'Autre',
};

export const ROLE_LABEL: Record<Role, string> = {
  gerant: 'Administrateur / Gérant',
  employe: 'Employé',
  comptable: 'Comptabilité / Expert-comptable',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  brouillon: 'Brouillon',
  envoyee: 'Envoyée',
  partielle: 'Reçue partiellement',
  receptionnee: 'Réceptionnée',
  annulee: 'Annulée',
};

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  a_rapprocher: 'À rapprocher',
  rapprochee: 'Rapprochée',
  litige: 'En litige',
  payee: 'Payée',
};
