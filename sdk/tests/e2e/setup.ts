import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env.e2e for local development.
// In CI, variables are injected directly as environment variables.
const dir = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(dir, '../../.env.e2e');
if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
}
