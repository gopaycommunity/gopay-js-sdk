import { readFileSync, writeFileSync } from 'node:fs';

// @semantic-release/npm's `npm version` command fails on workspace:* deps (Yarn-only syntax).
// This plugin does the same version bump via direct JSON edit instead.
// Must be exported as named function (not an inline object) so semantic-release-monorepo's
// semantic-release-plugin-decorators can resolve a string plugin name via the file path.
export function prepare(_pluginConfig, context) {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    pkg.version = context.nextRelease.version;
    writeFileSync('package.json', `${JSON.stringify(pkg, null, 4)}\n`);
}
