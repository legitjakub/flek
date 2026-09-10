import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { businessBilling, createBusiness, listCategories, saveBusinessBilling, updateBusiness } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { Banner, Button, Field, Input, Segmented, Select, Textarea } from '../../components/ui';
import { MerchantShell } from './MerchantShell';
import { AddressField } from './AddressField';
import { LazyMap } from '../offers/LazyMap';
import { useRouter } from '../../app/router';
import { DEFAULT_POINT } from '../../lib/geo';
import type { Business } from '../../types/database';

type Values = {
  display_name: string;
  category_slug: string;
  description: string;
  phone: string;
  public_email: string;
  website: string;
  address_line: string;
  city: string;
  district: string;
  postal_code: string;
  latitude: string;
  longitude: string;
  cancellation_window_minutes: string;
};

/**
 * Everything an invoice or a payout needs, and nothing the customer sees. None of it existed
 * before — no IČO, no DIČ, no account number, no contact person, no record of anyone having
 * accepted terms — while FLEK takes a commission from every booking.
 */
type Billing = {
  legal_name: string;
  ico: string;
  dic: string;
  bank_account: string;
  contact_person: string;
  contact_phone: string;
  billing_address_line: string;
  billing_city: string;
  billing_postal_code: string;
  terms_accepted: boolean;
};

const EMPTY_BILLING: Billing = {
  legal_name: '',
  ico: '',
  dic: '',
  bank_account: '',
  contact_person: '',
  contact_phone: '',
  billing_address_line: '',
  billing_city: '',
  billing_postal_code: '',
  terms_accepted: false,
};

/** Round numbers a merchant actually thinks in, plus the option to type any other. */
const CANCELLATION_PRESETS: [number, string][] = [
  [0, 'Až do začátku'],
  [60, 'Hodinu předem'],
  [180, '3 hodiny předem'],
  [720, '12 hodin předem'],
  [1440, 'Den předem'],
];

function initial(business?: Business): Values {
  return {
    display_name: business?.display_name ?? '',
    category_slug: business?.category_slug ?? '',
    description: business?.description ?? '',
    phone: business?.phone ?? '',
    public_email: business?.public_email ?? '',
    website: business?.website ?? '',
    address_line: business?.address_line ?? '',
    city: business?.city ?? 'Praha',
    district: business?.district ?? '',
    postal_code: business?.postal_code ?? '',
    latitude: String(business?.latitude ?? DEFAULT_POINT.lat),
    longitude: String(business?.longitude ?? DEFAULT_POINT.lng),
    cancellation_window_minutes: String(business?.cancellation_window_minutes ?? 60),
  };
}

export function MerchantBusinessPage() {
  return <MerchantShell>{(business) => <BusinessForm business={business} />}</MerchantShell>;
}

/** Registration lives outside the shell: there is no business to frame it with yet. */
export function MerchantRegisterPage() {
  return <BusinessForm />;
}

function BusinessForm({ business }: { business?: Business }) {
  const queryClient = useQueryClient();
  const { navigate } = useRouter();
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 3_600_000 });
  const [values, setValues] = useState<Values>(() => initial(business));
  const [billing, setBilling] = useState<Billing>(EMPTY_BILLING);
  const [billingLoaded, setBillingLoaded] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [manualPoint, setManualPoint] = useState(false);

  const stored = useQuery({
    queryKey: ['business-billing', business?.id],
    queryFn: () => businessBilling(business!.id),
    enabled: Boolean(business),
    staleTime: 60_000,
  });

  // Prefill once, and never over an edit in progress.
  if (business && stored.data && !billingLoaded) {
    setBillingLoaded(true);
    setBilling({
      legal_name: stored.data.legal_name ?? business.legal_name ?? '',
      ico: stored.data.ico ?? '',
      dic: stored.data.dic ?? '',
      bank_account: stored.data.bank_account ?? '',
      contact_person: stored.data.contact_person ?? '',
      contact_phone: stored.data.contact_phone ?? '',
      billing_address_line: stored.data.billing_address_line ?? '',
      billing_city: stored.data.billing_city ?? '',
      billing_postal_code: stored.data.billing_postal_code ?? '',
      terms_accepted: Boolean(stored.data.terms_accepted_at),
    });
  }

  const lat = Number(values.latitude);
  const lng = Number(values.longitude);
  const validPoint = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
  /*
   * Named errors instead of one silent `disabled`. The button used to go dead with nothing
   * saying which of eleven fields was wrong — and the form is now longer, so guessing is
   * worse. Same pattern ServicesPage already uses: errors on attempt, focus to the first.
   */
  const errors: Partial<Record<string, string>> = {
    'b-name': values.display_name.trim().length >= 2 ? undefined : 'Napište název alespoň o 2 znacích.',
    'b-category': values.category_slug ? undefined : 'Vyberte kategorii.',
    'b-phone': values.phone.trim().length >= 6 ? undefined : 'Zadejte telefon.',
    'b-email': values.public_email.includes('@') ? undefined : 'Zadejte veřejný e-mail.',
    'b-address': values.address_line.trim() && validPoint ? undefined : 'Vyberte adresu z nabídky.',
    'b-city': values.city.trim() ? undefined : 'Zadejte město.',
    'b-postal': values.postal_code.trim() ? undefined : 'Zadejte PSČ.',
    'b-ico': !billing.ico || /^\d{8}$/.test(billing.ico.trim()) ? undefined : 'IČO má osm číslic.',
    'b-dic': !billing.dic || /^CZ\d{8,10}$/.test(billing.dic.trim().toUpperCase()) ? undefined : 'DIČ má tvar CZ a 8–10 číslic.',
    'b-terms': billing.terms_accepted ? undefined : 'Bez souhlasu s podmínkami vás nemůžeme zaplatit.',
  };
  const firstError = Object.keys(errors).find((key) => errors[key]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...values,
        latitude: lat,
        longitude: lng,
        cancellation_window_minutes: Number(values.cancellation_window_minutes) || 0,
      };
      const saved = business ? await updateBusiness(business.id, payload) : await createBusiness(payload);
      // Two calls on purpose: the billing row is a separate table with its own RLS, and a
      // venue registered before this existed simply has no row until the first save.
      await saveBusinessBilling(saved.id, { ...billing, terms_accepted: billing.terms_accepted });
      return saved;
    },
    onSuccess: async () => {
      setFailure(null);
      setSaved(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my-businesses'] }),
        queryClient.invalidateQueries({ queryKey: ['business-billing'] }),
      ]);
      if (!business) navigate('/partner');
    },
    onError: (error) => {
      setSaved(false);
      setFailure(errorMessage(error));
    },
  });

  function set<K extends keyof Values>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function setBill<K extends keyof Billing>(key: K, value: string) {
    setBilling((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  const body = (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (firstError) {
          window.setTimeout(() => document.getElementById(firstError)?.focus(), 0);
          return;
        }
        save.mutate();
      }}
      noValidate
    >
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">
        {business ? 'Provozovna' : 'Registrace provozovny'}
      </h1>
      {!business ? (
        <p className="text-sm text-muted">
          Po odeslání provozovnu zkontrolujeme. Ozveme se do 24 hodin, pak můžete zveřejňovat volné termíny.
        </p>
      ) : null}

      <Field id="b-name" label="Název provozovny" error={attempted ? errors['b-name'] : undefined}>
        <Input id="b-name" value={values.display_name} onChange={(event) => set('display_name', event.target.value)} />
      </Field>
      <Field id="b-category" label="Kategorie" error={attempted ? errors['b-category'] : undefined}>
        <Select id="b-category" value={values.category_slug} onChange={(event) => set('category_slug', event.target.value)}>
          <option value="">Vyberte kategorii</option>
          {(categories.data ?? []).map((item) => (
            <option key={item.slug} value={item.slug}>
              {item.label_cs}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="b-description" label="Popis" hint="Krátce, co u vás zákazník najde.">
        <Textarea id="b-description" value={values.description} onChange={(event) => set('description', event.target.value)} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="b-phone" label="Telefon" error={attempted ? errors['b-phone'] : undefined}>
          <Input id="b-phone" type="tel" value={values.phone} onChange={(event) => set('phone', event.target.value)} />
        </Field>
        <Field id="b-email" label="Veřejný e-mail" error={attempted ? errors['b-email'] : undefined}>
          <Input id="b-email" type="email" value={values.public_email} onChange={(event) => set('public_email', event.target.value)} />
        </Field>
      </div>
      <Field id="b-website" label="Web" hint="Nepovinné.">
        <Input id="b-website" value={values.website} onChange={(event) => set('website', event.target.value)} />
      </Field>

      <AddressField
        value={values.address_line}
        onPick={(picked) => {
          setSaved(false);
          setValues((prev) => ({
            ...prev,
            address_line: picked.address_line,
            city: picked.city || prev.city,
            district: picked.district || prev.district,
            postal_code: picked.postal_code || prev.postal_code,
            latitude: String(picked.latitude),
            longitude: String(picked.longitude),
          }));
        }}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="b-city" label="Město" error={attempted ? errors['b-city'] : undefined}>
          <Input id="b-city" value={values.city} onChange={(event) => set('city', event.target.value)} />
        </Field>
        <Field id="b-district" label="Čtvrť" hint="Nepovinné.">
          <Input id="b-district" value={values.district} onChange={(event) => set('district', event.target.value)} />
        </Field>
        <Field id="b-postal" label="PSČ" error={attempted ? errors['b-postal'] : undefined}>
          <Input id="b-postal" inputMode="numeric" value={values.postal_code} onChange={(event) => set('postal_code', event.target.value)} />
        </Field>
      </div>

      {validPoint ? (
        <p className="tnum text-sm text-muted">
          Poloha z adresy: {lat.toFixed(5)}, {lng.toFixed(5)}.{' '}
          <button
            type="button"
            onClick={() => setManualPoint((v) => !v)}
            className="font-bold text-accent underline underline-offset-4"
          >
            {manualPoint ? 'Skrýt ruční úpravu' : 'Upravit ručně'}
          </button>
        </p>
      ) : (
        <p className={`text-sm ${attempted && errors['b-address'] ? 'font-medium text-danger' : 'text-muted'}`}>
          Vyberte adresu z nabídky — poloha na mapě se doplní sama.
        </p>
      )}

      {manualPoint ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="b-lat" label="Zeměpisná šířka">
            <Input id="b-lat" inputMode="decimal" value={values.latitude} onChange={(event) => set('latitude', event.target.value)} />
          </Field>
          <Field id="b-lng" label="Zeměpisná délka">
            <Input id="b-lng" inputMode="decimal" value={values.longitude} onChange={(event) => set('longitude', event.target.value)} />
          </Field>
        </div>
      ) : null}

      {validPoint ? (
        <LazyMap
          className="h-48 w-full overflow-hidden rounded-2xl border border-line"
          center={{ lat, lng }}
          zoom={15}
          interactive={false}
          markers={[{ id: 'here', lat, lng, label: '1' }]}
          ariaLabel="Poloha provozovny na mapě"
        />
      ) : null}

      {/*
        Everything below this line is for invoicing and payouts, and none of it existed:
        no IČO, no DIČ, no account number, no contact person, no terms. It is kept in its own
        section, and in its own table, because the customer never sees any of it.
      */}
      <section className="mt-2 flex flex-col gap-4 rounded-2xl border border-line p-4">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-ink">Fakturační údaje</h2>
          <p className="mt-1 text-sm text-muted">
            Potřebujeme je, abychom vám mohli posílat peníze za rezervace. Zákazník je nikdy neuvidí.
          </p>
        </div>

        <Field id="b-legal" label="Název firmy nebo jméno podnikatele" hint="Tak, jak je v rejstříku.">
          <Input id="b-legal" value={billing.legal_name} onChange={(event) => setBill('legal_name', event.target.value)} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="b-ico" label="IČO" error={attempted ? errors['b-ico'] : undefined}>
            <Input id="b-ico" inputMode="numeric" placeholder="12345678" value={billing.ico} onChange={(event) => setBill('ico', event.target.value.replace(/\D/g, '').slice(0, 8))} />
          </Field>
          <Field id="b-dic" label="DIČ" hint="Nepovinné, pokud nejste plátce DPH." error={attempted ? errors['b-dic'] : undefined}>
            <Input id="b-dic" placeholder="CZ12345678" value={billing.dic} onChange={(event) => setBill('dic', event.target.value.toUpperCase())} />
          </Field>
        </div>

        <Field id="b-bank" label="Číslo účtu nebo IBAN" hint="Sem posíláme výplaty za rezervace.">
          <Input id="b-bank" placeholder="123456789/0800" value={billing.bank_account} onChange={(event) => setBill('bank_account', event.target.value)} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="b-contact" label="Kontaktní osoba" hint="Komu se máme ozvat.">
            <Input id="b-contact" value={billing.contact_person} onChange={(event) => setBill('contact_person', event.target.value)} />
          </Field>
          <Field id="b-contact-phone" label="Telefon na kontaktní osobu" hint="Nepovinné.">
            <Input id="b-contact-phone" type="tel" value={billing.contact_phone} onChange={(event) => setBill('contact_phone', event.target.value)} />
          </Field>
        </div>

        <details className="border-t border-line pt-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-muted">
            Sídlo se liší od adresy provozovny
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <Field id="b-billing-address" label="Ulice a číslo">
              <Input id="b-billing-address" value={billing.billing_address_line} onChange={(event) => setBill('billing_address_line', event.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="b-billing-city" label="Město">
                <Input id="b-billing-city" value={billing.billing_city} onChange={(event) => setBill('billing_city', event.target.value)} />
              </Field>
              <Field id="b-billing-postal" label="PSČ">
                <Input id="b-billing-postal" inputMode="numeric" value={billing.billing_postal_code} onChange={(event) => setBill('billing_postal_code', event.target.value)} />
              </Field>
            </div>
          </div>
        </details>

        {/* The timestamp is written by the server, not sent by the browser: a moment a client
            can choose is not a record of anything. */}
        <div>
          <label htmlFor="b-terms" className="flex items-start gap-3 text-sm text-ink">
            <input
              id="b-terms"
              type="checkbox"
              checked={billing.terms_accepted}
              onChange={(event) => {
                setSaved(false);
                setBilling((prev) => ({ ...prev, terms_accepted: event.target.checked }));
              }}
              className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]"
            />
            <span>
              Souhlasím s obchodními podmínkami FLEKu. Z každé rezervace si FLEK bere provizi{' '}
              <span className="tnum font-bold">{Math.round((business?.commission_rate ?? 0.15) * 100)} %</span> z ceny,
              kterou zákazník zaplatí. Zbytek vám vyplatíme.
            </span>
          </label>
          {attempted && errors['b-terms'] ? (
            <p className="mt-1.5 text-sm font-medium text-danger">{errors['b-terms']}</p>
          ) : null}
        </div>
      </section>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 text-sm font-bold">Bezplatné zrušení</legend>
        <p className="text-sm text-muted">
          Do kdy před začátkem může zákazník zrušit a dostat peníze zpět. Kdo si termín
          rezervuje později, má na rozmyšlenou vždy 10 minut od zaplacení.
        </p>
        <Segmented
          label="Bezplatné zrušení"
          value={Number(values.cancellation_window_minutes)}
          onChange={(minutes) => set('cancellation_window_minutes', String(minutes))}
          options={CANCELLATION_PRESETS.map(([value, label]) => ({ value, label }))}
          columns={2}
        />
        <Field
          id="b-cancel"
          label="Nebo přesný počet minut"
          hint="0 znamená, že zrušit lze až do začátku termínu. Nejvýše 7 dní (10 080 minut)."
        >
          <Input
            id="b-cancel"
            inputMode="numeric"
            value={values.cancellation_window_minutes}
            onChange={(event) => set('cancellation_window_minutes', event.target.value.replace(/\D/g, '') || '0')}
          />
        </Field>
      </fieldset>

      {saved ? <Banner tone="success">Údaje jsou uložené.</Banner> : null}
      {failure ? <Banner tone="warning">{failure}</Banner> : null}

      <Button type="submit" size="lg" className="self-start" loading={save.isPending}>
        {business ? 'Uložit změny' : 'Odeslat ke schválení'}
      </Button>
    </form>
  );

  if (business) return body;
  return (
    <div className="min-h-dvh bg-ink/3">
      <div className="mx-auto w-full max-w-2xl px-4 py-6">{body}</div>
    </div>
  );
}
