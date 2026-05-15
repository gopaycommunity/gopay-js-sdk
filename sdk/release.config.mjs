import { analyzeCommits } from 'semantic-release-monorepo';

/** @type {import('semantic-release').GlobalConfig} */
export default {
    branches: ['master'],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release template, not JS
    tagFormat: '${version}',

    // analyzeCommits is set at the top level (not inside plugins) so the monorepo
    // decorator can intercept plugins[0] (@semantic-release/commit-analyzer) and
    // filter commits to only those that touched sdk/ or internal/core/ before
    // letting the analyzer decide the version bump. If no relevant commits exist,
    // the entire release is skipped — this package only releases when its files change.
    analyzeCommits,

    plugins: [
        // analyzeCommits above calls this at index 0 with path-filtered commits
        '@semantic-release/commit-analyzer',

        // Generate release notes (uses all commits since last tag — see note below)
        // Note: release notes may include commits from browser-sdk/ or internal/core/,
        // but the version bump and release gate are controlled by the filtered analyzeCommits above.
        '@semantic-release/release-notes-generator',

        // Update CHANGELOG.md
        [
            '@semantic-release/changelog',
            {
                changelogFile: 'CHANGELOG.md',
            },
        ],

        // Bump version in package.json. npmPublish: false until NPM_TOKEN is added and sign-off given.
        // To enable real publishing: set npmPublish: true and add NPM_TOKEN to Bitbucket repository variables.
        [
            '@semantic-release/npm',
            {
                npmPublish: false,
            },
        ],

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
