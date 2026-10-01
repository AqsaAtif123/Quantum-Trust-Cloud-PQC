import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root (parent directory of backend)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * All configuration is validated at boot. If a required secret is missing,
 * the process refuses to start rather than falling back to an insecure
 * default. This is intentional: QuantumTrust must never run with a
 * hard-coded or guessed secret.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be >= 32 chars'),

  // Object storage (S3-compatible; MinIO in dev)
  STORAGE_PROVIDER: z.enum(['minio', 's3', 'azure']).default('minio'),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_BUCKET: z.string().default('quantumtrust-files'),
  STORAGE_ACCESS_KEY: z.string().min(1, 'STORAGE_ACCESS_KEY is required'),
  STORAGE_SECRET_KEY: z.string().min(1, 'STORAGE_SECRET_KEY is required'),
  STORAGE_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  // Blockchain (Avalanche Fuji testnet during development)
  CHAIN_RPC_URL: z.string().optional(),
  CHAIN_PRIVATE_KEY: z.string().optional(),
  AUDIT_CONTRACT_ADDRESS: z.string().optional(),

  // QuantumPay (stablecoin provider)
  PAYMENT_RECEIVING_ADDRESS: z.string().optional(),
  STABLECOIN_CONTRACT_ADDRESS: z.string().optional(),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('❌ Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
