/**
 * Fail the build if a published type declaration points at something consumers cannot install.
 *
 * `@gopay-internal/core` is private and never published. For a while both packages' .d.ts
 * imported from it, which a consumer sees as TS2307 with skipLibCheck off and - far worse -
 * as a silent `any` for every core-derived type with it on, which is the common setup. That
 * turned the whole generated schema surface into `any` without a single warning anywhere.
 *
 * Checked here rather than trusted to review: the imports are emitted by the bundler, so
 * nobody writes them and nobody sees them in a diff.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGES = ['sdk', 'browser-sdk'];
const FORBIDDEN = '@gopay-internal';
const problems = [];

for (const pkg of PACKAGES) {
    const dist = join(pkg, 'dist');
    if (!existsSync(dist)) {
        problems.push(`${pkg}: no dist/ - build before running this check`);
        continue;
    }

    const declarations = readdirSync(dist).filter(
        (f) => f.endsWith('.d.ts') || f.endsWith('.d.cts'),
    );
    if (declarations.length === 0) {
        problems.push(
            `${pkg}: dist/ contains no .d.ts - the types are not being emitted`,
        );
    }

    for (const file of declarations) {
        const path = join(dist, file);
        const lines = readFileSync(path, 'utf-8').split('\n');
        lines.forEach((line, i) => {
            if (line.includes(FORBIDDEN)) {
                problems.push(
                    `${path}:${i + 1} references ${FORBIDDEN}: ${line.trim()}`,
                );
            }
        });
    }

    // `src` used to be published too, and every file in it imports the private package.
    const manifest = JSON.parse(
        readFileSync(join(pkg, 'package.json'), 'utf-8'),
    );
    if ((manifest.files ?? []).includes('src')) {
        problems.push(
            `${pkg}/package.json publishes "src", whose files import ${FORBIDDEN}`,
        );
    }
}

if (problems.length > 0) {
    console.error('Published types are not self-contained:\n');
    for (const p of problems) {
        console.error(`  ${p}`);
    }
    console.error(
        '\nThe declarations must inline what they reference. See the dts settings in each tsup.config.ts.',
    );
    process.exit(1);
}

console.log(
    `Published types are self-contained: no ${FORBIDDEN} references in ${PACKAGES.join(', ')} dist declarations.`,
);
