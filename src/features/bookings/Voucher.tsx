import { useEffect, useState } from 'react';
import { Skeleton } from '../../components/ui';

/**
 * The verification artifact the merchant checks. The code is the source of truth — the QR
 * only carries a link that opens the merchant's lookup with the code already filled in, so
 * verifying is a camera scan rather than typing six characters off a screen.
 */
export function Voucher({ code }: { code: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const target = `${window.location.origin}/partner/rezervace?kod=${encodeURIComponent(code)}`;

  useEffect(() => {
    let active = true;
    // Loaded on demand: the encoder is only ever needed on this one screen.
    import('qrcode')
      .then((mod) =>
        mod.default.toDataURL(target, { width: 480, margin: 1, color: { dark: '#253130', light: '#ffffff' } }),
      )
      .then((url) => active && setQr(url))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [target]);

  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <p className="text-sm text-muted">Rezervační kód</p>
      <p className="tnum mt-1 font-mono text-2xl font-extrabold tracking-[0.12em] text-ink">{code}</p>
      <div className="mx-auto mt-4 w-44">
        {qr ? (
          <img src={qr} alt={`QR kód rezervace ${code}`} className="w-full rounded-xl" width={480} height={480} />
        ) : failed ? null : (
          <Skeleton className="aspect-square w-full" />
        )}
      </div>
      <p className="mt-3 text-sm text-muted">
        {failed ? 'Ukaž v podniku rezervační kód.' : 'V podniku ukaž kód nebo nech načíst QR.'}
      </p>
    </div>
  );
}
