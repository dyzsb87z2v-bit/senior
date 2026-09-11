import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scryptAsync = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))));
const N = 16384, r = 8, p = 1, KEYLEN = 64;

/** scrypt with a per-password salt; format "scrypt$N$r$p$salt$hash" (base64). No native dependency. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [algo, n, rr, pp, saltB64, hashB64] = stored.split('$');
    if (algo !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const key = await scryptAsync(password.normalize('NFKC'), salt, expected.length, { N: Number(n), r: Number(rr), p: Number(pp) });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** Minimum policy for staff passwords: length is what matters most. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < 10) return 'Das Passwort muss mindestens 10 Zeichen lang sein';
  if (password.length > 200) return 'Das Passwort ist zu lang';
  return null;
}
