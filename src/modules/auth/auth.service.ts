// AuthService: Lógica de autenticación y validación JWT
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { config } from '../../config/index.js';

export class AuthService {
  static async verifySupabaseJWT(token: string): Promise<string | null> {
    try {
      const JWKS = createRemoteJWKSet(new URL(config.SUPABASE_JWT_URL));
      const { payload } = await jwtVerify(token, JWKS, {
        algorithms: ['ES256'],
        issuer: config.SUPABASE_ISSUER,
      });
      return payload.sub as string;
    } catch (e: any) {
      // Decode header+payload without verifying to diagnose the mismatch
      try {
        const [h, p] = token.split('.');
        const header = JSON.parse(Buffer.from(h, 'base64').toString());
        const payload = JSON.parse(Buffer.from(p, 'base64').toString());
        console.error('[JWT] verify failed:', e?.message);
        console.error('[JWT] token alg:', header.alg, '| iss:', payload.iss, '| exp:', new Date(payload.exp * 1000).toISOString());
        console.error('[JWT] config  alg: RS256 | issuer:', config.SUPABASE_ISSUER, '| jwks_url:', config.SUPABASE_JWT_URL);
      } catch { /* ignore decode errors */ }
      return null;
    }
  }
}
