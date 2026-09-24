import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StripePayouts } from './StripePayouts';
import { useEffect, useState } from 'react';
import { Clock3, Store, Upload } from 'lucide-react';
import { aresLookup, businessBilling, createBusiness, listCategories, saveBusinessBilling, updateBusiness, uploadBusinessCover } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { Banner, Button, cx, Field, Input, Segmented, Select, Textarea } from '../../components/ui';
import { MerchantShell } from './MerchantShell';
import { AddressField } from './AddressField';
import { MoneyExplainer } from './MoneyExplainer';
import { LazyMap } from '../offers/LazyMap';
import { useRouter } from '../../app/router';
import { DEFAULT_POINT } from '../../lib/geo';
import type { Business } from '../../types/database';
import { NotificationSettings } from '../notifications/Notifications';
import { BookingConfirmationInfo } from './BookingConfirmationInfo';
import { WhatsAppSettingsSection } from '../notifications/WhatsApp';
import { RingSettings } from './RequestRing';
import { useLegalInfo } from '../legal/useLegal';

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
 * accepted terms — while FLEK collects every customer payment and pays the merchant out.
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
  /** DAC7: how the venue does business, and a birth date only for a natural person. */
  seller_type: 'individual' | 'entity' | '';
  birth_date: string;
  country: string;
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
  seller_type: '',
  birth_date: '',
  country: 'CZ',
};

const COUNTRIES: [string, string][] = [['CZ', 'Česko'], ['SK', 'Slovensko'], ['PL', 'Polsko'], ['DE', 'Německo'], ['AT', 'Rakousko']];

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

/*
 * The longest page of the console — payments, alerts and the whole venue form ran to more than
 * four phone screens with a heading only in the middle. It now opens with its name, a row that
 * jumps to each part, and every part can be linked to (`?sekce=platby`), which is how the setup
 * guide sends a venue straight to the field it still has to fill in.
 */
const SECTIONS = [
  { id: 'platby', label: 'Platby' },
  { id: 'upozorneni', label: 'Upozornění' },
  { id: 'udaje', label: 'Údaje' },
  { id: 'fakturace', label: 'Fakturace' },
  { id: 'zruseni', label: 'Zrušení' },
] as const;

function jumpTo(id: string, smooth = true) {
  document.getElementById(id)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
}

/** Scrolls to `?sekce=…` once the part has rendered; the forms below load their data first. */
function useSectionFromAddress() {
  const { search } = useRouter();
  const target = search.get('sekce');
  useEffect(() => {
    if (!target) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      const element = document.getElementById(target);
      if (element || tries > 30) {
        window.clearInterval(timer);
        if (element) jumpTo(target, false);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [target]);
}

export function MerchantBusinessPage() {
  return (
    <MerchantShell>
      {(business) => <BusinessSettings business={business} />}
    </MerchantShell>
  );
}

function BusinessSettings({ business }: { business: Business }) {
  useSectionFromAddress();
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Provozovna</h1>
        <p className="mt-1 text-sm text-muted">Platby, upozornění a údaje, které o vás vidí zákazníci.</p>
        <nav aria-label="Části stránky" className="rail -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => jumpTo(section.id)}
              className="min-h-11 shrink-0 rounded-full bg-card px-4 text-sm font-bold text-ink shadow-card hover:bg-accent-soft hover:text-accent"
            >
              {section.label}
            </button>
          ))}
        </nav>
      </header>
      <div id="platby" className="scroll-mt-24"><StripePayouts business={business} /></div>
      <BookingConfirmationInfo business={business} />
      <div id="upozorneni" className="flex scroll-mt-24 flex-col gap-6">
        <RingSettings />
        <NotificationSettings businessId={business.id} />
        <div id="whatsapp" className="scroll-mt-24"><WhatsAppSettingsSection businessId={business.id} /></div>
      </div>
      <BusinessForm business={business} />
    </div>
  );
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
  const [ares, setAres] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const legal = useLegalInfo();
  const termsVersion = legal.data?.documents.merchant_terms?.version ?? null;

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
      // With terms in force only an acceptance of that version counts; before that the old timestamp does.
      terms_accepted: stored.data.terms_current ? Boolean(stored.data.terms_accepted_current) : Boolean(stored.data.terms_accepted_at),
      seller_type: stored.data.seller_type ?? '',
      birth_date: stored.data.birth_date ?? '',
      country: stored.data.country ?? 'CZ',
    });
  }

  /*
   * The venue's own photograph. It is not part of `values`, because it must only be sent when it
   * actually changed: `update_business` rejects a cover address that has not been through the
   * check (`IMAGE_REUPLOAD_REQUIRED`), and an unchanged value would trip that rule.
   */
  const [cover, setCover] = useState<string | null | undefined>(undefined);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  useEffect(() => () => {
    if (coverPreview) URL.revokeObjectURL(coverPreview);
  }, [coverPreview]);
  const shownCover = cover === undefined ? (business?.cover_url ?? null) : cover;
  const coverPending = Boolean(shownCover?.startsWith('moderation-pending://')) || business?.content_status === 'pending';

  async function uploadCover(file: File | undefined) {
    if (!file || !business || coverUploading) return;
    setCoverError(null);
    setCoverUploading(true);
    try {
      const preview = URL.createObjectURL(file);
      setCoverPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return preview;
      });
      setCover(await uploadBusinessCover(business.id, file));
      setSaved(false);
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : 'Fotku se nepodařilo nahrát. Zkuste to znovu.');
    } finally {
      setCoverUploading(false);
    }
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
    'b-seller-individual': billing.seller_type ? undefined : 'Vyberte, jestli podnikáte jako fyzická, nebo právnická osoba.',
    'b-birth': billing.seller_type !== 'individual' || billing.birth_date ? undefined : 'Zadejte datum narození.',
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
        ...(cover === undefined ? {} : { cover_url: cover }),
      };
      const saved = business ? await updateBusiness(business.id, payload) : await createBusiness(payload);
      // Two calls on purpose: the billing row is a separate table with its own RLS, and a
      // venue registered before this existed simply has no row until the first save.
      await saveBusinessBilling(saved.id, {
        ...billing,
        terms_accepted: billing.terms_accepted,
        terms_version: billing.terms_accepted ? termsVersion : null,
        seller_type: billing.seller_type || null,
        birth_date: billing.seller_type === 'individual' ? billing.birth_date : null,
      });
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
      setFailure(errorMessage(error, 'merchant'));
    },
  });

  function set<K extends keyof Values>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function setBill<K extends keyof Billing>(key: K, value: Billing[K]) {
    setBilling((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  const lookup = useMutation({
    mutationFn: () => aresLookup(billing.ico.trim(), business?.id ?? null),
    onSuccess: (found) => {
      if (!found.found) {
        setAres({ tone: 'warning', text: 'IČO jsme v registru ARES nenašli. Zkontrolujte ho.' });
        return;
      }
      setBilling((prev) => ({
        ...prev,
        legal_name: found.name,
        seller_type: found.seller_type,
        billing_address_line: found.line ?? prev.billing_address_line,
        billing_city: found.city ?? prev.billing_city,
        billing_postal_code: found.postal_code ?? prev.billing_postal_code,
        dic: prev.dic || (found.dic ?? ''),
      }));
      setSaved(false);
      setAres(found.ended
        ? { tone: 'warning', text: `Podle ARES subjekt ${found.name} zanikl. Zkontrolujte IČO.` }
        : { tone: 'success', text: `Podle ARES: ${found.name}, ${found.address}. Údaje jsme předvyplnili, uložte je.` });
    },
    onError: (error) => setAres({ tone: 'warning', text: errorMessage(error, 'merchant') }),
  });

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
      {business ? (
        <h2 id="udaje" className="scroll-mt-24 text-lg font-extrabold tracking-tight text-ink">Údaje o provozovně</h2>
      ) : (
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Registrace provozovny</h1>
      )}
      {!business ? (
        <>
          {/* No e-mail goes out on approval — the app has no mail provider — so the promise is
              where the merchant will see it, not that someone will get in touch. */}
          <p className="text-sm text-muted">
            Po odeslání provozovnu zkontrolujeme. Schválení obvykle trvá do 24 hodin a uvidíte ho tady po přihlášení.
            Mezitím si můžete připravit služby.
          </p>
          <MoneyExplainer />
        </>
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

      {/*
        Fotku provozovny šlo dosud nastavit jen migrací, přitom se nabízí jako volba u fotky
        služby a od téhle změny ji zákazník vidí nahoře na stránce podniku. Prochází stejnou
        kontrolou jako ostatní obsah, takže se zveřejní až po ní.
      */}
      {business ? (
        <fieldset>
          <legend className="text-sm font-bold text-ink">Fotka provozovny</legend>
          <span className="mt-0.5 block text-sm text-muted">
            Ukáže se nahoře na vaší stránce. JPG, PNG nebo WebP, nejvýše 5 MB. Zveřejníme ji po automatické kontrole.
          </span>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="relative grid h-24 w-40 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line bg-surface">
              {coverPreview || (shownCover && !shownCover.startsWith('moderation-pending://')) ? (
                <img
                  src={coverPreview ?? shownCover ?? undefined}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <Store size={24} aria-hidden="true" className="text-muted" />
              )}
            </span>
            <span className="flex flex-col gap-2">
              <label
                htmlFor="b-cover"
                aria-busy={coverUploading || undefined}
                className={cx(
                  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-card px-3 text-sm font-bold text-ink hover:border-accent',
                  coverUploading && 'pointer-events-none opacity-55',
                )}
              >
                <Upload size={17} aria-hidden="true" />
                {coverUploading ? 'Nahrávám…' : shownCover ? 'Vyměnit fotku' : 'Nahrát fotku'}
              </label>
              <input
                id="b-cover"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={coverUploading}
                onChange={(event) => {
                  void uploadCover(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              {shownCover ? (
                <button
                  type="button"
                  onClick={() => {
                    setCover(null);
                    setCoverPreview((previous) => {
                      if (previous) URL.revokeObjectURL(previous);
                      return null;
                    });
                    setSaved(false);
                  }}
                  className="inline-flex min-h-11 items-center text-sm font-bold text-muted underline underline-offset-4 hover:text-ink"
                >
                  Odebrat fotku
                </button>
              ) : null}
            </span>
          </div>
          {coverPending ? (
            <p role="status" className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-accent">
              <Clock3 size={15} aria-hidden="true" />
              Čeká na kontrolu. Zákazníkům se zatím ukazuje předchozí verze.
            </p>
          ) : null}
          {coverError ? <p role="alert" className="mt-2 text-sm font-medium text-danger">{coverError}</p> : null}
        </fieldset>
      ) : null}

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
            className="inline-flex min-h-11 items-center font-bold text-accent underline underline-offset-4"
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
      <section id="fakturace" className="mt-2 flex scroll-mt-24 flex-col gap-4 rounded-2xl border border-line p-4">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-ink">Fakturační údaje</h2>
          <p className="mt-1 text-sm text-muted">
            Potřebujeme je k výplatám a k oznámení podle DAC7. Název, IČO a sídlo uvidí zákazník u rezervace jako údaje o
            poskytovateli služby. Datum narození, kontakty a účet neuvidí nikdo mimo FLEK.
          </p>
        </div>

        <Field id="b-legal" label="Název firmy nebo jméno podnikatele" hint="Tak, jak je v rejstříku.">
          <Input id="b-legal" value={billing.legal_name} onChange={(event) => setBill('legal_name', event.target.value)} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="b-ico" label="IČO" hint="Bez IČO provozovnu neschválíme." error={attempted ? errors['b-ico'] : undefined}>
            <Input id="b-ico" inputMode="numeric" placeholder="12345678" value={billing.ico} onChange={(event) => { setAres(null); setBill('ico', event.target.value.replace(/\D/g, '').slice(0, 8)); }} />
          </Field>
          <Field id="b-dic" label="DIČ" hint="Nepovinné, pokud nejste plátce DPH." error={attempted ? errors['b-dic'] : undefined}>
            <Input id="b-dic" placeholder="CZ12345678" value={billing.dic} onChange={(event) => setBill('dic', event.target.value.toUpperCase())} />
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            disabled={!/^\d{8}$/.test(billing.ico.trim())}
            loading={lookup.isPending}
            onClick={() => lookup.mutate()}
          >
            Načíst údaje z ARES
          </Button>
          {ares ? <Banner tone={ares.tone}>{ares.text}</Banner> : null}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 text-sm font-bold text-ink">Podnikáte jako</legend>
          <div className="flex flex-wrap gap-x-6">
            {([['individual', 'Fyzická osoba (OSVČ)'], ['entity', 'Právnická osoba (například s.r.o.)']] as const).map(([value, label]) => (
              <label key={value} htmlFor={`b-seller-${value}`} className="flex min-h-11 cursor-pointer items-center gap-2 text-base text-ink">
                <input
                  id={`b-seller-${value}`}
                  type="radio"
                  name="b-seller"
                  checked={billing.seller_type === value}
                  onChange={() => setBill('seller_type', value)}
                  className="size-5 accent-[var(--color-accent)]"
                />
                {label}
              </label>
            ))}
          </div>
          {attempted && errors['b-seller-individual'] ? <p className="text-sm font-medium text-danger">{errors['b-seller-individual']}</p> : null}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          {billing.seller_type === 'individual' ? (
            <Field id="b-birth" label="Datum narození" hint="Jen pro oznámení podle DAC7." error={attempted ? errors['b-birth'] : undefined}>
              <Input id="b-birth" type="date" value={billing.birth_date} onChange={(event) => setBill('birth_date', event.target.value)} />
            </Field>
          ) : null}
          <Field id="b-country" label="Stát sídla">
            <Select id="b-country" value={billing.country} onChange={(event) => setBill('country', event.target.value)}>
              {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </Select>
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
              {termsVersion ? (
                <>
                  Souhlasím s{' '}
                  <a href="/podminky-podniky" target="_blank" rel="noopener" className="font-bold underline underline-offset-4">obchodními podmínkami pro podniky</a>{' '}
                  (verze {termsVersion}). Za každou uskutečněnou rezervaci dostanu celou částku, kterou si u nabídky nastavím.
                  Servisní poplatek FLEK platí zákazník navíc.
                </>
              ) : (
                'Souhlasím s obchodními podmínkami FLEKu. Za každou uskutečněnou rezervaci dostanu celou částku, kterou si u nabídky nastavím. Servisní poplatek FLEK platí zákazník navíc.'
              )}
            </span>
          </label>
          {attempted && errors['b-terms'] ? (
            <p className="mt-1.5 text-sm font-medium text-danger">{errors['b-terms']}</p>
          ) : null}
        </div>
      </section>

      <fieldset id="zruseni" className="flex scroll-mt-24 flex-col gap-2">
        <legend className="pb-1 text-sm font-bold">Bezplatné zrušení</legend>
        <p className="text-sm text-muted">
          Do kdy před začátkem může zákazník zrušit a dostat peníze zpět. Kdo si termín
          rezervuje později, má na rozmyšlenou vždy 10 minut od potvrzení rezervace.
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
