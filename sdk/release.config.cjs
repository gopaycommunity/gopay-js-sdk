/** @type {import('semantic-release').GlobalConfig} */
module.exports = {
    branches: ['master'],
    plugins: [
        // Analyze commits to determine version bump (feat → minor, fix → patch, BREAKING CHANGE → major)
        '@semantic-release/commit-analyzer',

        // Generate release notes from commits
        '@semantic-release/release-notes-generator',

        // Update CHANGELOG.md
        [
            '@semantic-release/changelog',
            {
                changelogFile: 'CHANGELOG.md',
            },
        ],

        // Publish to npm (reads NPM_TOKEN from env)
        [
            '@semantic-release/npm',
            {
                // npmPublish: true,
                // sdk is private for now
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
