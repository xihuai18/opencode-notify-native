# Contributing

## Development

This repository ships one npm package:

- `opencode-plugin/` -> `@leo000001/opencode-notify-native`

Commands:

```bash
npm ci --prefix opencode-plugin
npm run build --prefix opencode-plugin
npm run typecheck --prefix opencode-plugin
npm test --prefix opencode-plugin
```

## Release

1. Bump `opencode-plugin/package.json` version.
2. Tag `vX.Y.Z` matching that version.
3. Push the tag. The release workflow builds/tests/packs and publishes to npm when `NPM_TOKEN` is configured.
