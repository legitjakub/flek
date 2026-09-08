import { useEffect, useId, useRef, useState } from 'react';
import { MapPin, Search } from 'lucide-react';
import { Field, Input, Spinner } from '../../components/ui';
import { searchAddress, type AddressSuggestion } from '../../lib/geocode';

/**
 * Merchants used to type a latitude. They type the address now, pick it from the list, and
 * the coordinates come along with it — the venue's position is a consequence of the address
 * rather than a separate thing to get wrong.
 */
export function AddressField({
  value,
  onPick,
  hint,
}: {
  value: string;
  onPick: (suggestion: AddressSuggestion) => void;
  hint?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState(value);
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const picked = useRef(value);

  useEffect(() => {
    setQuery(value);
    picked.current = value;
  }, [value]);

  useEffect(() => {
    if (query.trim().length < 3 || query === picked.current) {
      setItems([]);
      setPending(false);
      return;
    }
    const controller = new AbortController();
    setPending(true);
    setFailed(false);
    // Typing is faster than the network, so only the last keystroke gets asked.
    const timer = window.setTimeout(() => {
      searchAddress(query, controller.signal)
        .then((found) => {
          setItems(found);
          setOpen(true);
          setActive(-1);
        })
        .catch((error: unknown) => {
          if ((error as Error)?.name !== 'AbortError') setFailed(true);
        })
        .finally(() => setPending(false));
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const onAway = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onAway);
    return () => document.removeEventListener('mousedown', onAway);
  }, []);

  function choose(suggestion: AddressSuggestion) {
    picked.current = suggestion.address_line;
    setQuery(suggestion.address_line);
    setItems([]);
    setOpen(false);
    onPick(suggestion);
  }

  return (
    <div ref={box} className="relative">
      <Field id={id} label="Adresa provozovny" hint={hint ?? 'Začněte psát ulici a vyberte z nabídky.'}>
        <div className="relative">
          <Search
            size={17}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
          />
          <Input
            id={id}
            className="pl-9"
            autoComplete="off"
            role="combobox"
            aria-expanded={open && items.length > 0}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
            placeholder="Např. Korunní 42"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => items.length && setOpen(true)}
            onKeyDown={(event) => {
              if (!open || items.length === 0) return;
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((i) => (i + 1) % items.length);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
              } else if (event.key === 'Enter' && active >= 0) {
                event.preventDefault();
                choose(items[active]);
              } else if (event.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          {pending ? (
            <span className="absolute top-1/2 right-3 -translate-y-1/2 text-muted">
              <Spinner label="Hledáme adresu" />
            </span>
          ) : null}
        </div>
      </Field>

      {failed ? (
        <p className="mt-1 text-sm text-muted">
          Napovídání adres je nedostupné. Adresu můžete napsat ručně a polohu upravit níže.
        </p>
      ) : null}

      {open && items.length > 0 ? (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-line bg-card py-1 shadow-card"
        >
          {items.map((item, index) => (
            <li key={item.id} id={`${id}-opt-${index}`} role="option" aria-selected={index === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(item)}
                className={`flex min-h-12 w-full items-start gap-2 px-3 py-2 text-left text-sm ${
                  index === active ? 'bg-accent-soft text-ink' : 'text-ink'
                }`}
              >
                <MapPin size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
                <span>
                  <span className="font-semibold">{item.address_line}</span>
                  <span className="block text-muted">
                    {[item.postal_code, item.city, item.district].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
