import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const SCHEME = 'scrypt';

/**
 * A patient password as stored: "scrypt$<salt>$<key>", both base64url. scrypt
 * is slow on purpose and built into Node, so no extra package is needed. The
 * salt is random per password, so two patients with the same password get
 * different hashes.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return `${SCHEME}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** Whether `password` matches `stored`. Compared in constant time. */
export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, saltText, keyText] = stored.split('$');
  if (scheme !== SCHEME || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(saltText, 'base64url'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * A hash nobody's password matches, checked against when the number is
 * unknown or has no password: the answer then takes as long as a real check,
 * so timing doesn't tell which numbers belong to patients.
 */
export const DECOY_HASH = `${SCHEME}$${Buffer.alloc(SALT_LENGTH).toString('base64url')}$${Buffer.alloc(KEY_LENGTH).toString('base64url')}`;
