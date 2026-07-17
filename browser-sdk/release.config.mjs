import { execSync } from 'node:child_process';
import { analyzeCommits } from 'semantic-release-monorepo';

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
    tagFormat: 'browser-sdk-${version}',

    // analyzeCommits is set at the top level (not inside plugins) so the monorepo
    // decorator can intercept plugins[0] (@semantic-release/commit-analyzer) and
    // filter commits to only those that touched browser-sdk/ before letting the analyzer
    // decide the version bump. If no relevant commits exist, the entire release is
    // skipped — this package only releases when browser-sdk/ files change.
    // Note: internal/core/ changes are NOT included in this filter (semantic-release-monorepo
    // v8 matches only the package's own directory). Core-only changes bump gopay-js-sdk (which
    // analyzes all commits) but not this package.
    analyzeCommits,

    plugins: [
        // analyzeCommits above calls this at index 0 with path-filtered commits
        '@semantic-release/commit-analyzer',

        // Generate release notes (uses all commits since last tag — see note below)
        // Note: release notes may include commits from sdk/ or internal/core/,
        // but the version bump and release gate are controlled by the filtered analyzeCommits above.
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
                    'chore(release): browser-sdk-${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
            },
        ],
    ],
};
