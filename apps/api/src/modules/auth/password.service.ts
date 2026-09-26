import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id with OWASP's 2024 baseline parameters (19 MiB, t=2, p=1).
 * Tune `memoryCost` to the host, but never below 19456.
 */
/** `Algorithm.Argon2id`, inlined: the exported enum is `const`, which
 *  `isolatedModules` forbids importing as a value. */
const ARGON2ID = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  /**
   * Returns false instead of throwing on a malformed digest, so a corrupted
   * row reads as "wrong password" rather than a 500 that reveals its state.
   */
  async verify(digest: string, plain: string): Promise<boolean> {
    try {
      return await verify(digest, plain, ARGON2_OPTIONS);
    } catch {
      return false;
    }
  }

  /**
   * Burns roughly the same CPU as a real verification. Called when the email
   * does not exist, so response timing cannot be used to enumerate accounts.
   */
  async dummyVerify(): Promise<void> {
    await hash('dtrace-timing-equalizer', ARGON2_OPTIONS);
  }
}
