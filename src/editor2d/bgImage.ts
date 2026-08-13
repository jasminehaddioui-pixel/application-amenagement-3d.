/**
 * Cache de l'image du plan de fond.
 * Le canevas d'edition et les exports partagent la meme instance chargee,
 * ce qui evite de recharger une data-URL volumineuse a chaque rendu.
 */
let current: HTMLImageElement | null = null;
let currentSrc: string | null = null;
const listeners = new Set<() => void>();

export function getBackgroundImage(): HTMLImageElement | null {
  return current;
}

export function onBackgroundImageChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function loadBackgroundImage(src: string | null): void {
  if (src === currentSrc) return;
  currentSrc = src;
  if (!src) {
    current = null;
    listeners.forEach((f) => f());
    return;
  }
  const img = new Image();
  img.onload = () => {
    // Une image plus recente a pu etre demandee entre-temps.
    if (currentSrc !== src) return;
    current = img;
    listeners.forEach((f) => f());
  };
  img.onerror = () => {
    if (currentSrc !== src) return;
    current = null;
    listeners.forEach((f) => f());
  };
  img.src = src;
}

/** Charge une image et resout quand elle est prete (utilise par les exports). */
export function loadImageAsync(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Impossible de charger l'image du plan."));
    img.src = src;
  });
}
