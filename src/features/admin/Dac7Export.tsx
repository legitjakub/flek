import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { adminDac7Report } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { Banner, Button, Field, Select } from '../../components/ui';
import { dac7Csv } from './dac7';

export function Dac7Export() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear - 1 >= 2026 ? thisYear - 1 : thisYear);
  const [count, setCount] = useState<number | null>(null);
  const download = useMutation({
    mutationFn: () => adminDac7Report(year),
    onSuccess: (rows) => {
      setCount(rows.length);
      const url = URL.createObjectURL(new Blob([dac7Csv(rows)], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `flek-dac7-${year}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    },
  });

  return (
    <section className="mt-8 flex flex-col gap-3 rounded-2xl bg-card p-5 shadow-card" aria-labelledby="dac7">
      <h2 id="dac7" className="text-lg font-extrabold tracking-tight text-ink">Podklad pro oznámení DAC7</h2>
      <p className="text-sm text-muted">
        Zaplacené a nevrácené ostré platby po čtvrtletích na podnik a údaje o podnikateli. Do konce ledna se oznamují
        Specializovanému finančnímu úřadu za předchozí rok. Testovací platby se nepočítají.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field id="dac7-year" label="Rok">
          <Select id="dac7-year" value={year} onChange={(event) => setYear(Number(event.target.value))} className="w-32">
            {Array.from({ length: Math.max(1, thisYear - 2026 + 1) }, (_, index) => 2026 + index).map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </Select>
        </Field>
        <Button variant="secondary" loading={download.isPending} onClick={() => download.mutate()}>
          Stáhnout CSV
        </Button>
      </div>
      {download.isError ? <Banner tone="warning">{errorMessage(download.error, 'merchant')}</Banner> : null}
      {count !== null && !download.isPending ? (
        <p className="text-sm text-muted" role="status">
          {count === 0 ? 'Za tento rok nejsou žádné ostré platby k oznámení.' : `Staženo: ${count} podniků.`}
        </p>
      ) : null}
    </section>
  );
}
