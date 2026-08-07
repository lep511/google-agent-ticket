/**
 * Unit tests for the narration endpoint helpers: reading the audio out of a
 * Gemini interaction and making raw PCM playable in a browser.
 */

import { describe, expect, it } from 'vitest';

import { PCM_SAMPLE_RATE, extractAudio, wrapPcmAsWav } from './textToSpeech.ts';

function interaction(content: unknown[]): unknown {
  return { steps: [{ type: 'model_output', content }] };
}

const PCM = Buffer.from([0x01, 0x02, 0x03, 0x04]);
const PCM_BASE64 = PCM.toString('base64');

describe('extractAudio', () => {
  it('wraps raw PCM in a WAV container so an audio element can play it', () => {
    const audio = extractAudio(
      interaction([{ type: 'audio', data: PCM_BASE64, mime_type: 'audio/l16;codec=pcm;rate=24000' }]),
    );

    expect(audio?.mimeType).toBe('audio/wav');
    expect(audio?.audio.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(audio?.audio.length).toBe(44 + PCM.length);
  });

  it('treats a missing mime type as raw PCM, as the API does', () => {
    const audio = extractAudio(interaction([{ type: 'audio', data: PCM_BASE64 }]));
    expect(audio?.mimeType).toBe('audio/wav');
  });

  it('passes through audio that already carries a container', () => {
    const audio = extractAudio(
      interaction([{ type: 'audio', data: PCM_BASE64, mime_type: 'audio/mpeg' }]),
    );

    expect(audio?.mimeType).toBe('audio/mpeg');
    expect(audio?.audio).toEqual(PCM);
  });

  it('skips parts and steps that carry no audio', () => {
    const audio = extractAudio({
      steps: [
        { type: 'thought', content: [{ type: 'audio', data: PCM_BASE64 }] },
        { type: 'model_output', content: [{ type: 'text', text: 'no audio here' }] },
        { type: 'model_output', content: [{ type: 'audio', data: PCM_BASE64 }] },
      ],
    });

    expect(audio?.audio.length).toBe(44 + PCM.length);
  });

  it('returns null when the payload has no audio at all', () => {
    expect(extractAudio(undefined)).toBeNull();
    expect(extractAudio({})).toBeNull();
    expect(extractAudio({ steps: 'nope' })).toBeNull();
    expect(extractAudio(interaction([{ type: 'audio', data: '' }]))).toBeNull();
  });
});

describe('wrapPcmAsWav', () => {
  it('writes a canonical 44-byte header for mono 16-bit audio', () => {
    const wav = wrapPcmAsWav(PCM);

    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36 + PCM.length);
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM format
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(PCM_SAMPLE_RATE);
    expect(wav.readUInt32LE(28)).toBe(PCM_SAMPLE_RATE * 2); // byte rate
    expect(wav.readUInt16LE(32)).toBe(2); // block align
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(PCM.length);
    expect(wav.subarray(44)).toEqual(PCM);
  });

  it('honours a different sample rate in the header', () => {
    expect(wrapPcmAsWav(PCM, 16000).readUInt32LE(24)).toBe(16000);
  });
});
