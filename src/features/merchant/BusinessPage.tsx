import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createBusiness, listCategories, updateBusiness } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { Banner, Button, Field, Input, Select, Textarea } from '../../components/ui';
import { MerchantShell } from './MerchantShell';
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
};

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
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const lat = Number(values.latitude);
  const lng = Number(values.longitude);
  const validPoint = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
  const valid =
    values.display_name.trim().length >= 2 &&
    values.category_slug &&
    values.phone.trim() &&
    values.public_email.includes('@') &&
    values.address_line.trim() &&
    values.city.trim() &&
    values.postal_code.trim() &&
    validPoint;

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...values, latitude: lat, longitude: lng };
      return business ? updateBusiness(business.id, payload) : createBusiness(payload);
    },
    onSuccess: async () => {
      setFailure(null);
      setSaved(true);
      await queryClient.invalidateQueries();
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

  const body = (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
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

      <Field id="b-name" label="Název provozovny">
        <Input id="b-name" value={values.display_name} onChange={(event) => set('display_name', event.target.value)} />
      </Field>
      <Field id="b-category" label="Kategorie">
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
        <Field id="b-phone" label="Telefon">
          <Input id="b-phone" type="tel" value={values.phone} onChange={(event) => set('phone', event.target.value)} />
        </Field>
        <Field id="b-email" label="Veřejný e-mail">
          <Input id="b-email" type="email" value={values.public_email} onChange={(event) => set('public_email', event.target.value)} />
        </Field>
      </div>
      <Field id="b-website" label="Web" hint="Nepovinné.">
        <Input id="b-website" value={values.website} onChange={(event) => set('website', event.target.value)} />
      </Field>

      <Field id="b-address" label="Ulice a číslo">
        <Input id="b-address" value={values.address_line} onChange={(event) => set('address_line', event.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="b-city" label="Město">
          <Input id="b-city" value={values.city} onChange={(event) => set('city', event.target.value)} />
        </Field>
        <Field id="b-district" label="Čtvrť" hint="Nepovinné.">
          <Input id="b-district" value={values.district} onChange={(event) => set('district', event.target.value)} />
        </Field>
        <Field id="b-postal" label="PSČ">
          <Input id="b-postal" inputMode="numeric" value={values.postal_code} onChange={(event) => set('postal_code', event.target.value)} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="b-lat" label="Zeměpisná šířka" hint="Zkontrolujte značku na mapě.">
          <Input id="b-lat" inputMode="decimal" value={values.latitude} onChange={(event) => set('latitude', event.target.value)} />
        </Field>
        <Field id="b-lng" label="Zeměpisná délka">
          <Input id="b-lng" inputMode="decimal" value={values.longitude} onChange={(event) => set('longitude', event.target.value)} />
        </Field>
      </div>
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

      {saved ? <Banner tone="success">Údaje jsou uložené.</Banner> : null}
      {failure ? <Banner tone="warning">{failure}</Banner> : null}

      <Button type="submit" size="lg" className="self-start" loading={save.isPending} disabled={!valid}>
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
