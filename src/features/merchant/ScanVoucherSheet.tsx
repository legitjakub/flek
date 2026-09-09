import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { Banner, Button, Sheet } from '../../components/ui';

/**
 * The voucher's QR carries a full URL (/partner/rezervace?kod=...), because a customer's
 * phone camera has to be able to open it without our app installed. A merchant scanning
 * inside the app therefore has to accept both shapes: the link, and a bare code typed or
 * produced by some other reader.
 */
export function codeFromScan(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    const param = url.searchParams.get('kod');
    if (param) return param.trim().toUpperCase();
  } catch {
    // Not a URL: fall through and treat the payload as the code itself.
  }
  return /^FLEK-[A-Z0-9]{4,12}$/i.test(text) ? text.toUpperCase() : null;
}

type Status = 'starting' | 'scanning' | 'denied' | 'unsupported' | 'error';

/**
 * Reading the code off a customer's screen by eye and typing six characters is the step
 * that goes wrong at a busy counter. Decoding happens on-device; no frame ever leaves it.
 */
export function ScanVoucherSheet({
  open,
  onClose,
  onCode,
}: {
  open: boolean;
  onClose: () => void;
  onCode: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>('starting');
  const [detail, setDetail] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    setStatus('starting');
    setDetail(null);
    setRejected(false);

    // getUserMedia only exists in a secure context. Saying so plainly beats a bare failure.
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      return;
    }

    const handle = (raw: string) => {
      const code = codeFromScan(raw);
      if (!code) {
        // A QR that is not ours: keep the camera running, say why nothing happened.
        setRejected(true);
        return;
      }
      stopped = true;
      onCode(code);
    };

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // The back camera is the one pointed at the customer's phone.
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        // iOS refuses to play an inline video that is not muted and playsInline.
        await video.play();
        setStatus('scanning');

        // Chromium decodes in the browser; everywhere else (Safari, Firefox) a small
        // decoder is fetched on demand, so the customer bundle never carries it.
        const native =
          'BarcodeDetector' in window
            ? new (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => {
                detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]>;
              } }).BarcodeDetector({ formats: ['qr_code'] })
            : null;
        const jsQR = native ? null : (await import('jsqr')).default;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });

        const tick = async () => {
          if (stopped || !videoRef.current) return;
          const el = videoRef.current;
          if (el.readyState === el.HAVE_ENOUGH_DATA) {
            try {
              if (native) {
                const found = await native.detect(el);
                if (found.length) handle(found[0].rawValue);
              } else if (context && jsQR) {
                canvas.width = el.videoWidth;
                canvas.height = el.videoHeight;
                context.drawImage(el, 0, 0, canvas.width, canvas.height);
                const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
                const found = jsQR(pixels.data, pixels.width, pixels.height, {
                  inversionAttempts: 'dontInvert',
                });
                if (found?.data) handle(found.data);
              }
            } catch {
              // A single unreadable frame is normal while focusing; keep going.
            }
          }
          if (!stopped) frame = requestAnimationFrame(() => void tick());
        };
        frame = requestAnimationFrame(() => void tick());
      } catch (error) {
        const name = error instanceof DOMException ? error.name : '';
        setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
        setDetail(error instanceof Error ? error.message : null);
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      // Leaving the track running keeps the camera light on, which reads as spyware.
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open, onCode]);

  return (
    <Sheet open={open} onClose={onClose} title="Načíst QR rezervace">
      <div className="overflow-hidden rounded-2xl bg-ink">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Obraz z kamery pro načtení QR kódu"
          className="aspect-[3/4] w-full object-cover"
        />
      </div>

      {status === 'scanning' ? (
        <p className="mt-4 text-center text-base text-muted" role="status">
          {rejected ? 'Tenhle QR kód nepatří FLEKu. Zkuste ten z rezervace.' : 'Namiřte na QR kód v aplikaci zákazníka.'}
        </p>
      ) : null}
      {status === 'starting' ? (
        <p className="mt-4 text-center text-base text-muted" role="status">
          Spouštím kameru…
        </p>
      ) : null}
      {status === 'denied' ? (
        <div className="mt-4">
          <Banner tone="warning">
            Kamera je zakázaná. Povolte ji v nastavení prohlížeče, nebo kód zadejte ručně.
          </Banner>
        </div>
      ) : null}
      {status === 'unsupported' ? (
        <div className="mt-4">
          <Banner tone="warning">
            Tenhle prohlížeč kameru nenabízí. Zadejte kód ručně — funguje stejně.
          </Banner>
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="mt-4">
          <Banner tone="warning">{detail ?? 'Kameru se nepodařilo spustit. Zadejte kód ručně.'}</Banner>
        </div>
      ) : null}

      <Button variant="secondary" className="mt-4 w-full" onClick={onClose}>
        Zadat kód ručně
      </Button>
    </Sheet>
  );
}

/** The control that opens the scanner. Kept next to the manual field, never instead of it. */
export function ScanButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="secondary" onClick={onClick}>
      <Camera size={17} aria-hidden="true" />
      Načíst QR
    </Button>
  );
}
