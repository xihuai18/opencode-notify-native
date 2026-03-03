# Contributing

## Development

This repository ships one npm package:

- repository root -> `@leo000001/opencode-notify-native`

Code layout:

- plugin source: `src/`
- build output: `dist/`
- tests: `src/__tests__/` (compiled to `dist-test/` during test runs)

Commands:

```bash
npm ci
npm run build
npm run typecheck
npm run test
```

## Release

1. Bump `package.json` version.
2. Tag `vX.Y.Z` matching that version.
3. Push the tag. The release workflow builds/tests/packs and publishes to npm when `NPM_TOKEN` is configured.
