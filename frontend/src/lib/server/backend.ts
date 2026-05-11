import { env } from '$env/dynamic/private';

/**
 * Base URL of the BNR backend. Server-side only — never inlined into the client bundle.
 * Dev default matches docker/compose.dev.yaml; override with BACKEND_URL=… for staging/prod.
 */
export const BACKEND_URL = env.BACKEND_URL ?? 'http://localhost:3001';
