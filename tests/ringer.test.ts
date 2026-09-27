import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The ringer against a fake Web Audio: what it starts, whether it loops, when it stops, and what
 * the ring itself sounds like as samples. Each test loads a fresh module, since the ringer keeps
 * one audio context per page.
 */

type Played = { loop: boolean; started: number; stopped: number };

function fakeAudio({ locked = false } = {}) {
  const played: Played[] = [];
  const vibrations: unknown[] = [];
  let buffer: Float32Array | null = null;
  class FakeContext {
    state = locked ? 'suspended' : 'running';
    sampleRate = 8000;
    currentTime = 0;
    destination = {};
    private listeners: Array<() => void> = [];
    addEventListener(_: string, listener: () => void) { this.listeners.push(listener); }
    async resume() { this.state = 'running'; this.listeners.forEach((listener) => listener()); }
    createBuffer(_channels: number, length: number) {
      buffer = new Float32Array(length);
      return { getChannelData: () => buffer!, length };
    }
    createGain() { return { gain: { value: 1 }, connect: (target: unknown) => target }; }
    createBufferSource() {
      const record: Played = { loop: false, started: 0, stopped: 0 };
      played.push(record);
      return {
        buffer: null,
        set loop(value: boolean) { record.loop = value; },
        get loop() { return record.loop; },
        connect: (target: unknown) => target,
        disconnect: () => undefined,
        start: () => { record.started += 1; },
        stop: () => { record.stopped += 1; },
      };
    }
  }
  vi.stubGlobal('window', { AudioContext: FakeContext, setInterval, clearInterval, addEventListener: () => undefined, removeEventListener: () => undefined });
  vi.stubGlobal('navigator', { vibrate: (pattern: unknown) => { vibrations.push(pattern); return true; } });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: () => undefined });
  return { played, vibrations, samples: () => buffer };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ringer', () => {
  it('stays silent while the browser blocks sound and rings once a tap unlocks it', async () => {
    const audio = fakeAudio({ locked: true });
    const ringer = await import('../src/features/merchant/ringer');
    expect(ringer.startRinging()).toBe(false);
    expect(ringer.soundReady()).toBe(false);
    expect(await ringer.unlockSound()).toBe(true);
    expect(ringer.startRinging()).toBe(true);
    expect(audio.played).toHaveLength(1);
    expect(audio.played[0]).toMatchObject({ loop: true, started: 1, stopped: 0 });
    ringer.stopRinging();
  });

  it('rings in a loop without stacking and stops cleanly, buzz included', async () => {
    const audio = fakeAudio();
    const ringer = await import('../src/features/merchant/ringer');
    await ringer.unlockSound();
    ringer.startRinging();
    ringer.startRinging();
    expect(audio.played).toHaveLength(1);
    expect(ringer.isRinging()).toBe(true);
    expect(audio.vibrations[0]).toEqual([250, 120, 250]);
    ringer.stopRinging();
    expect(audio.played[0].stopped).toBe(1);
    expect(ringer.isRinging()).toBe(false);
    expect(audio.vibrations.at(-1)).toBe(0);
  });

  it('plays a single ring for the test button, never a loop', async () => {
    const audio = fakeAudio();
    const ringer = await import('../src/features/merchant/ringer');
    expect(await ringer.ringOnce()).toBe(true);
    expect(audio.played[0]).toMatchObject({ loop: false, started: 1 });
    expect(ringer.isRinging()).toBe(false);
  });

  it('mutes only the requests it was given and stops the ring', async () => {
    fakeAudio();
    const ringer = await import('../src/features/merchant/ringer');
    await ringer.unlockSound();
    ringer.startRinging();
    ringer.muteRequests(['req-a', 'req-b']);
    expect(ringer.isRinging()).toBe(false);
    expect(ringer.isMuted('req-a')).toBe(true);
    expect(ringer.isMuted('req-c')).toBe(false);
  });

  it('sounds like the rising FLEK chord twice and a pause, loud enough but never clipping', async () => {
    const audio = fakeAudio();
    const ringer = await import('../src/features/merchant/ringer');
    await ringer.ringOnce();
    const samples = audio.samples()!;
    const rate = 8000;
    expect(samples.length).toBe(Math.ceil(rate * 2.6));
    const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
    expect(peak).toBeGreaterThan(0.8);
    expect(peak).toBeLessThanOrEqual(0.9 + 1e-6);
    // The chord starts straight away and plays twice; the end of the cycle is a clean pause.
    const loudness = (from: number, to: number) => samples.slice(Math.floor(from * rate), Math.floor(to * rate)).reduce((sum, sample) => sum + sample * sample, 0);
    expect(loudness(0, 0.1)).toBeGreaterThan(1);
    expect(loudness(0.95, 1.05)).toBeGreaterThan(1);
    expect(loudness(2.1, 2.6)).toBe(0);
    // No click where the loop wraps: the last sample is silent like the first one starts.
    expect(Math.abs(samples[samples.length - 1])).toBe(0);
  });

  it('rises: each note of the motif is higher than the one before', async () => {
    const { ringSamples } = await import('../src/features/merchant/ringer');
    const rate = 16000;
    const samples = ringSamples(rate);
    // Count zero crossings in a short window after each note starts: more crossings, higher pitch.
    const pitch = (start: number) => {
      let crossings = 0;
      const from = Math.floor((start + 0.01) * rate);
      for (let index = from + 1; index < from + 0.08 * rate; index += 1) if ((samples[index - 1] < 0) !== (samples[index] < 0)) crossings += 1;
      return crossings;
    };
    expect(pitch(0.12)).toBeGreaterThan(pitch(0));
    expect(pitch(0.24)).toBeGreaterThan(pitch(0.12));
  });
});
