import { useEffect, useState } from 'react';

/** S'abonne a une media query CSS et suit son etat. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Seuil en dessous duquel l'interface bascule en disposition telephone. */
export const MOBILE_QUERY = '(max-width: 860px)';

export const useIsMobile = (): boolean => useMediaQuery(MOBILE_QUERY);
