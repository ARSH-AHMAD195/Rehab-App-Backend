import { DECOY_HASH, hashPassword, passwordMatches } from './password-hash';

describe('patient password hashing', () => {
  it('matches the right password only', async () => {
    const stored = await hashPassword('ganga123');
    expect(stored).toMatch(/^scrypt\$[\w-]+\$[\w-]+$/);
    expect(stored).not.toContain('ganga123');
    await expect(passwordMatches('ganga123', stored)).resolves.toBe(true);
    await expect(passwordMatches('ganga124', stored)).resolves.toBe(false);
    await expect(passwordMatches('', stored)).resolves.toBe(false);
  });

  it('gives the same password a different hash each time', async () => {
    expect(await hashPassword('same-one')).not.toBe(await hashPassword('same-one'));
  });

  it('nothing matches the decoy, or a broken stored value', async () => {
    await expect(passwordMatches('anything', DECOY_HASH)).resolves.toBe(false);
    await expect(passwordMatches('anything', 'not-a-hash')).resolves.toBe(false);
  });
});
