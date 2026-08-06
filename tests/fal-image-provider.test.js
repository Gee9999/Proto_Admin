import { Jimp } from 'jimp';
import { afterEach, describe, expect, it } from 'vitest';
import {
  downloadFalOutput,
  FAL_BACKGROUND_MODEL,
  removeBackgroundWithFal,
  standardizeFalOutput,
  validateFalOutputUrl,
} from '../api/_fal-image-provider.js';

const originalFalKey = process.env.FAL_KEY;

afterEach(() => {
  if (originalFalKey == null) delete process.env.FAL_KEY;
  else process.env.FAL_KEY = originalFalKey;
});

describe('fal.ai image provider', () => {
  it('keeps credentials server-side and calls the BRIA background-removal model', async () => {
    const calls = [];
    const client = {
      config: (value) => calls.push(['config', value]),
      subscribe: async (...args) => {
        calls.push(['subscribe', ...args]);
        return { data: { image: { url: 'https://v3.fal.media/files/result.png' } }, requestId: 'req_123' };
      },
    };
    const result = await removeBackgroundWithFal('https://signed.proto.test/source.jpg', {
      client,
      credentials: 'test-secret',
    });

    expect(result).toEqual({ outputUrl: 'https://v3.fal.media/files/result.png', requestId: 'req_123' });
    expect(calls[0]).toEqual(['config', { credentials: 'test-secret' }]);
    expect(calls[1][1]).toBe(FAL_BACKGROUND_MODEL);
    expect(calls[1][2].input).toEqual({ image_url: 'https://signed.proto.test/source.jpg' });
  });

  it('rejects untrusted output hosts before downloading them', async () => {
    expect(() => validateFalOutputUrl('http://v3.fal.media/result.png')).toThrow(/unexpected output host/);
    expect(() => validateFalOutputUrl('https://attacker.example/result.png')).toThrow(/unexpected output host/);
    await expect(downloadFalOutput('https://attacker.example/result.png', {
      fetchImpl: async () => { throw new Error('must not fetch'); },
    })).rejects.toThrow(/unexpected output host/);
  });

  it('fails safely when the preview does not have FAL_KEY', async () => {
    delete process.env.FAL_KEY;
    await expect(removeBackgroundWithFal('https://signed.proto.test/source.jpg')).rejects.toThrow(
      'FAL_KEY is not configured for this preview environment',
    );
  });

  it('crops a transparent result and exports a centred 1600px transparent PNG', async () => {
    const transparent = new Jimp({ width: 160, height: 120, color: 0x00000000 });
    for (let y = 20; y < 100; y += 1) {
      for (let x = 50; x < 110; x += 1) transparent.setPixelColor(0x204060ff, x, y);
    }
    const png = await transparent.getBuffer('image/png');
    const result = await standardizeFalOutput(png);
    const output = await Jimp.read(result.buffer);

    expect(output.bitmap).toMatchObject({ width: 1600, height: 1600 });
    expect([...result.buffer.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const corner = output.getPixelColor(0, 0);
    expect(corner & 0xff).toBe(0);
  });
});
