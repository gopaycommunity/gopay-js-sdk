/** @type {import('semantic-release').GlobalConfig} */
module.exports = {
    branches: ['master'],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release template, not JS
    tagFormat: 'browser-sdk-${version}',
    plugins: [
        '@semantic-release/commit-analyzer',
        '@semantic-release/release-notes-generator',
        [
            '@semantic-release/changelog',
            {
                changelogFile: 'CHANGELOG.md',
            },
        ],
        [
            '@semantic-release/exec',
            {
                // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release template, not JS
                prepareCmd: 'npm pkg set version=${nextRelease.version}',
            },
        ],
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
