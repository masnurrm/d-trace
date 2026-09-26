import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service.js';

const service = new PasswordService();

describe('PasswordService', () => {
  it('produces an argon2id digest that does not contain the password', async () => {
    const digest = await service.hash('correct horse battery staple');

    expect(digest.startsWith('$argon2id$')).toBe(true);
    expect(digest).not.toContain('correct horse battery staple');
  });

  it('salts every hash, so identical passwords differ on disk', async () => {
    const [a, b] = await Promise.all([service.hash('same-password'), service.hash('same-password')]);
    expect(a).not.toBe(b);
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const digest = await service.hash('s3cure-password');

    await expect(service.verify(digest, 's3cure-password')).resolves.toBe(true);
    await expect(service.verify(digest, 's3cure-passworD')).resolves.toBe(false);
  });

  it('returns false rather than throwing on a corrupted digest', async () => {
    await expect(service.verify('not-a-digest', 'whatever')).resolves.toBe(false);
  });
}, 30_000);
