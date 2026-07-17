import { execSync } from 'node:child_process';

/** @type {import('semantic-release').GlobalConfig} */
export default {
    branches: ['master'],
    // Pin repositoryUrl to the actual git origin (Bitbucket) explicitly. semantic-release
    // otherwise prefers package.json's `repository` field over the git remote, and since
    // GPOMA-2423 added `repository.url` pointing at the public GitHub mirror (for npm display
    // purposes only), it would otherwise fetch/push release tags against the mirror instead of
    // the real Bitbucket repo.
    repositoryUrl: execSync('git config --get remote.origin.url', {
        encoding: 'utf8',
    }).trim(),
    // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release template, not JS
    tagFormat: '${version}',

    // analyzeCommits is intentionally NOT set here — this package uses the default semantic-release
    // behavior and analyzes ALL commits since the last tag. This means it bumps on every releasable
    // change anywhere in the repo (sdk/, browser-sdk/, internal/core/, example/, etc.).
    //
    // Rationale: the gopay-js-sdk version is the Docker deploy tag
    // (repo.gopay.com/gp-gw-js-sdk:<version>). The Docker image bundles both the server SDK and
    // the browser SDK, so it must be rebuilt and retagged whenever either SDK changes. Making this
    // package the umbrella version ensures the tag always advances on every release, so the
    // pipeline's idempotency check (docker pull → skip-if-exists) never falsely skips a build.
    //
    // browser-sdk/ (gopay-js-sdk-browser) still uses semantic-release-monorepo to filter commits,
    // so it only releases when browser-sdk/ files changed. Server-SDK bumps without a browser
    // bump are therefore fine and expected.

    plugins: [
        // Analyze all commits since the last tag to decide the version bump.
        '@semantic-release/commit-analyzer',

        // Generate release notes from all commits since the last tag.
        '@semantic-release/release-notes-generator',

        // Update CHANGELOG.md
        [
            '@semantic-release/changelog',
            {
                changelogFile: 'CHANGELOG.md',
            },
        ],

        // Bump version in package.json (npm publishing disabled).
        // semantic-release-yarn replaces @semantic-release/npm: uses `yarn version --immediate`
        // instead of `npm version`, which understands workspace:* protocol natively.
        // ['semantic-release-yarn', { npmPublish: true }],
        ['semantic-release-yarn', { npmPublish: false }],

        // Commit version bump + CHANGELOG back to the repo
        [
            '@semantic-release/git',
            {
                assets: ['package.json', 'CHANGELOG.md'],
                message:
                    // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release template string, not JS
                    'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
            },
        ],
    ],
};
