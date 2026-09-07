import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type RouterValue = {
  path: string;
  search: URLSearchParams;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  back: () => void;
};

const RouterContext = createContext<RouterValue | null>(null);

function current() {
  return window.location.pathname + window.location.search;
}

/**
 * A ~50-line History API router. React Router would add a dependency for exactly two
 * features we need — path matching and a link that does not reload the page.
 */
export function RouterProvider({ children }: { children: ReactNode }) {
  const [href, setHref] = useState(current);

  useEffect(() => {
    const onPop = () => setHref(current());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (to === current()) return;
    window.history[options?.replace ? 'replaceState' : 'pushState']({}, '', to);
    setHref(to);
    window.scrollTo({ top: 0 });
  }, []);

  const value = useMemo<RouterValue>(() => {
    const [path, query = ''] = href.split('?');
    return { path, search: new URLSearchParams(query), navigate, back: () => window.history.back() };
  }, [href, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('useRouter musí být uvnitř RouterProvider.');
  return value;
}

/** Matches `/nabidka/:id` against the current path and returns the parameters. */
export function useMatch(pattern: string): Record<string, string> | null {
  const { path } = useRouter();
  return useMemo(() => matchPath(pattern, path), [pattern, path]);
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i += 1) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Link({
  to,
  children,
  className,
  replace,
  ...rest
}: { to: string; children: ReactNode; className?: string; replace?: boolean } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
>) {
  const { navigate } = useRouter();
  return (
    <a
      {...rest}
      href={to}
      className={className}
      onClick={(event) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to, { replace });
      }}
    >
      {children}
    </a>
  );
}
