import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env for local development.
// In CI, variables are injected directly as environment variables.
const dir = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(dir, '../../.env');
if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
}
