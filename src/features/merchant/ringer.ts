/**
 * The ring a venue hears while a booking request waits for its answer, like the tablets that
 * food-delivery services put on the counter: it repeats until someone confirms or declines, the
 * request runs out, or somebody mutes it. A single chime was easy to miss across a salon, and
 * the browser usually swallowed it anyway because nobody had tapped the page yet.
 *
 * The ring is one looping AudioBuffer, not a timer. The loop runs on the audio thread, so a tab
 * in the background — where browsers slow timers down to once a minute — still rings on time.
 *
 * Browsers only let a page make sound after a tap. `armRinger` resumes the audio on the first
 * tap or key press anywhere in the console, and the screen offers a button while it could not.
 * Nothing here is stored: mute and the screen lock last as long as the page.
 */

type Listener = () => void;

let context: AudioContext | null = null;
let ring: AudioBufferSourceNode | null = null;
let ringBuffer: AudioBuffer | null = null;
let vibration: number | null = null;
let wakeLock: WakeLockSentinel | null = null;
let keepAwake = false;
const muted = new Set<string>();
/** Bumped on every mute change, so a screen can tell that `isMuted` answers differently now. */
let mutedStamp = 0;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeRinger(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function audio(): AudioContext | null {
  if (context) return context;
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  // Safari 16.4+: play like media, so the silent switch on an iPhone does not swallow the ring.
  try {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
  } catch {
    /* older Safari: the switch decides */
  }
  context = new Context();
  context.addEventListener('statechange', emit);
  return context;
}

/** Whether the page may make sound right now. */
export function soundReady(): boolean {
  return context?.state === 'running';
}

export function isRinging(): boolean {
  return ring !== null;
}

/** Resumes audio; only works from a tap or a key press. */
export async function unlockSound(): Promise<boolean> {
  const current = audio();
  if (!current) return false;
  if (current.state !== 'running') {
    try {
      await current.resume();
    } catch {
      /* still locked: the ring bar keeps offering its button */
    }
  }
  emit();
  return current.state === 'running';
}

/** Unlocks the sound on the first tap anywhere in the console. Returns the cleanup. */
export function armRinger(): () => void {
  // The events a browser counts as a user's own activation.
  const events = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'] as const;
  const unlock = (event: Event) => {
    // "Zapnout zvuk" does its own unlocking. Unlocking here first swapped that button for "Ztlumit"
    // under the finger, and the same tap then muted the ring it had just started.
    if ((event.target as Element | null)?.closest?.('[data-ring-unlock]')) return;
    if (!soundReady()) void unlockSound();
  };
  events.forEach((name) => window.addEventListener(name, unlock, { capture: true, passive: true }));
  return () => events.forEach((name) => window.removeEventListener(name, unlock, { capture: true }));
}

/**
 * FLEK's ring: a rising major triad, G–C–E, played twice like a soft mallet, then quiet —
 * 2.6 s per cycle. A doorbell "ding-dong" said "someone is at the door"; a rising chord says
 * "good news", which a new booking is, and it still cuts through a salon. Mallet timbre: a round
 * fundamental with a short bright strike on top, a slight detuned double for warmth, and each
 * note fading out cleanly so the loop never clicks. Pure, so tests and previews hear the same.
 */
export const RING_SECONDS = 2.6;
const MOTIF: Array<[number, number]> = [[0, 783.99], [0.12, 1046.5], [0.24, 1318.51]];
const NOTES = [...MOTIF, ...MOTIF.map(([start, frequency]): [number, number] => [start + 0.95, frequency])];

export function ringSamples(rate: number): Float32Array {
  const data = new Float32Array(Math.ceil(rate * RING_SECONDS));
  const length = Math.floor(0.85 * rate);
  const fade = Math.floor(0.15 * rate);
  for (const [start, frequency] of NOTES) {
    const from = Math.floor(start * rate);
    for (let index = 0; index < length && from + index < data.length; index += 1) {
      const t = index / rate;
      const attack = Math.min(1, t / 0.003);
      const release = index > length - fade ? 0.5 + 0.5 * Math.cos((Math.PI * (index - (length - fade))) / fade) : 1;
      const body = Math.exp(-t / 0.42) * (Math.sin(2 * Math.PI * frequency * t) + 0.25 * Math.sin(2 * Math.PI * frequency * 1.003 * t));
      const strike = Math.exp(-t / 0.1) * 0.22 * Math.sin(2 * Math.PI * frequency * 2 * t)
        + Math.exp(-t / 0.05) * 0.08 * Math.sin(2 * Math.PI * frequency * 4 * t);
      data[from + index] += attack * release * (body + strike);
    }
  }
  let peak = 0;
  for (const sample of data) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0) for (let index = 0; index < data.length; index += 1) data[index] = (data[index] / peak) * 0.9;
  return data;
}

function buildRing(current: AudioContext): AudioBuffer {
  const samples = ringSamples(current.sampleRate);
  const buffer = current.createBuffer(1, samples.length, current.sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}

function play(loop: boolean): AudioBufferSourceNode | null {
  const current = audio();
  if (!current || current.state !== 'running') return null;
  ringBuffer ??= buildRing(current);
  const gain = current.createGain();
  gain.gain.value = 0.6;
  const source = current.createBufferSource();
  source.buffer = ringBuffer;
  source.loop = loop;
  source.connect(gain).connect(current.destination);
  source.start();
  return source;
}

/** Starts the ring unless it already rings. False when the browser still blocks sound. */
export function startRinging(): boolean {
  if (ring) return true;
  ring = play(true);
  if (!ring) return false;
  // Phones buzz along where they can (Android); the pattern follows the ring's rhythm.
  if ('vibrate' in navigator) {
    const buzz = () => {
      if (document.visibilityState === 'visible') navigator.vibrate([250, 120, 250]);
    };
    buzz();
    vibration = window.setInterval(buzz, 2600);
  }
  emit();
  return true;
}

export function stopRinging() {
  if (vibration !== null) {
    window.clearInterval(vibration);
    vibration = null;
    if ('vibrate' in navigator) navigator.vibrate(0);
  }
  if (!ring) return;
  try {
    ring.stop();
  } catch {
    /* already stopped */
  }
  ring.disconnect();
  ring = null;
  emit();
}

/** One cycle, for "Vyzkoušet zvonění". Unlocks the sound on the way, since it comes from a tap. */
export async function ringOnce(): Promise<boolean> {
  if (!(await unlockSound())) return false;
  return play(false) !== null;
}

/** Requests already heard and silenced; a new request rings again. */
export function muteRequests(ids: string[]) {
  ids.forEach((id) => muted.add(id));
  mutedStamp += 1;
  stopRinging();
  emit();
}

/** Takes back a mute: "Zapnout zvuk" found the sound still blocked, or the venue wants the ring back. */
export function unmuteRequests(ids: string[]) {
  ids.forEach((id) => muted.delete(id));
  mutedStamp += 1;
  emit();
}

export function isMuted(id: string): boolean {
  return muted.has(id);
}

export function mutedVersion(): number {
  return mutedStamp;
}

/*
 * A phone or tablet on the counter goes dark after a minute and a dark page does not ring.
 * Where the browser supports it, the console can keep the screen on while it is open.
 */
export function screenKeptOn(): boolean {
  return keepAwake;
}

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

async function acquire() {
  if (!keepAwake || wakeLock || document.visibilityState !== 'visible' || !wakeLockSupported()) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      emit();
    });
  } catch {
    keepAwake = false;
  }
  emit();
}

let watchingVisibility = false;

export async function keepScreenOn(on: boolean) {
  keepAwake = on;
  if (!watchingVisibility) {
    watchingVisibility = true;
    // The browser drops the lock whenever the page is hidden; take it again on return.
    document.addEventListener('visibilitychange', () => void acquire());
  }
  if (on) await acquire();
  else {
    await wakeLock?.release().catch(() => undefined);
    wakeLock = null;
  }
  emit();
}
