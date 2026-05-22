import { readFileSync, writeFileSync } from 'node:fs';

// @semantic-release/npm's `npm version` command fails on workspace:* deps (Yarn-only syntax).
// This inline plugin does the same version bump via direct JSON edit instead.
export const versionBumper = {
    prepare(_pluginConfig, context) {
        const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
        pkg.version = context.nextRelease.version;
        writeFileSync('package.json', `${JSON.stringify(pkg, null, 4)}\n`);
    },
};
