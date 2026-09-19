import { describe, it, expect } from 'vitest';
import { quickXorHash, QuickXorHasher } from '../src/main/utils/quickXorHash';

describe('quickXorHash', () => {
  it('hashes empty string/buffer matching Microsoft Graph vector', () => {
    expect(quickXorHash(Buffer.alloc(0))).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  });

  it('hashes 23-byte vector correctly', () => {
    const input = Buffer.from('hello from xsync repro\n', 'utf-8');
    expect(quickXorHash(input)).toBe('CSQji5vp5jAfdiZvfwMI8DCHPLg=');
  });

  it('hashes 1000-byte patterned vector exercising wraparound', () => {
    const patterned = Buffer.alloc(1000);
    for (let i = 0; i < 1000; i++) {
      patterned[i] = (i * 37 + 11) % 256;
    }
    expect(quickXorHash(patterned)).toBe('eelcfP1hi6r3o5C8MM9VxsvKe5Y=');
  });

  it('computes identical result when streaming in chunks vs one-shot', () => {
    const patterned = Buffer.alloc(1000);
    for (let i = 0; i < 1000; i++) {
      patterned[i] = (i * 37 + 11) % 256;
    }

    const hasher = new QuickXorHasher();
    hasher.update(patterned.subarray(0, 300));
    hasher.update(patterned.subarray(300, 750));
    hasher.update(patterned.subarray(750));

    expect(hasher.digest('base64')).toBe(quickXorHash(patterned));
  });
});
