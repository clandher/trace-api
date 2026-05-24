import { jwtVerify, createRemoteJWKSet } from 'jose';

const SUPABASE_JWT_URL = 'https://<YOUR_PROJECT_ID>.supabase.co/auth/v1/keys';

// Valida el JWT de Supabase y retorna el user_id si es válido
export async function verifySupabaseJWT(token: string): Promise<string | null> {
  try {
    const JWKS = createRemoteJWKSet(new URL(SUPABASE_JWT_URL));
    const { payload } = await jwtVerify(token, JWKS, {
      algorithms: ['RS256'],
      issuer: 'https://<YOUR_PROJECT_ID>.supabase.co/auth/v1',
    });
    return payload.sub as string;
  } catch (e) {
    return null;
  }
}
