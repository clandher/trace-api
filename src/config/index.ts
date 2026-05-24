// src/config/index.ts
// Centraliza la configuración de la app
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 1234,
  HOST: process.env.HOST || '0.0.0.0',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  SUPABASE_JWT_URL: process.env.SUPABASE_JWT_URL || '',
  SUPABASE_ISSUER: process.env.SUPABASE_ISSUER || '',
};
