// AuthService: Lógica de autenticación y validación JWT
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { config } from '../../config/index.js';

export class AuthService {
  static async verifySupabaseJWT(token: string): Promise<string | null> {
    try {
      const JWKS = createRemoteJWKSet(new URL(config.SUPABASE_JWT_URL));
      const { payload } = await jwtVerify(token, JWKS, {
        algorithms: ['RS256'],
        issuer: config.SUPABASE_ISSUER,
      });
      return payload.sub as string;
    } catch (e) {
      return null;
    }
  }
}
