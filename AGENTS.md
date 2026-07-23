# Repository guide

- Use Node.js 22 or newer and pnpm.
- `config-example.json` and the tracked demo profiles are safe starting points;
  keep local credentials in environment variables and local `config.json`.
- `pnpm run verify` performs the repository build used by CI.
- Regenerate configuration types with `pnpm run generate-config-schema`.
- Regenerate checked-in UNS reference types with the `generate-uns-*` scripts.
- Do not add Azure Pipelines or deployment-version bump automation. GitHub
  Actions validates source changes; release tags are maintained separately.
