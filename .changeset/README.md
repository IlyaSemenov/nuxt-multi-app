# Changesets

This folder is managed by `@changesets/cli` and stores release notes for pending version changes.

See the Changesets documentation for the workflow and file format:
https://github.com/changesets/changesets

## Releasing

Run `bun run release` from the repository root on the base branch configured in `.changeset/config.json`, with committed changes pushed to GitHub.
The command versions pending changesets, asks for confirmation, pushes the release commit, and starts `.github/workflows/publish.yml` after CI passes.
The workflow publishes to npm with provenance, pushes tags, and creates GitHub Releases.

Before releasing, configure an npm trusted publisher for `.github/workflows/publish.yml` and its `npm` environment for each published package.
