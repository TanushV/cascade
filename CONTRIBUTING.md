# Contributing

Thank you for improving Pi Cascade. Keep changes narrow, tested, and compatible with the pinned Pi runtime.

## Development setup

```bash
git clone https://github.com/TanushV/cascade.git
cd cascade
npm install --ignore-scripts
npm run ci
```

Node.js 22.19 or newer is required.

## Pull requests

- Describe the behavior change and why it is needed.
- Add or update tests for functional changes.
- Run `npm run ci` before opening a pull request.
- Do not commit credentials, provider responses containing private code, `.pi-cascade` state, or `node_modules`.
- Preserve `LICENSE`, `THIRD_PARTY_NOTICES.md`, `licenses/`, and `UPSTREAM.json`.
- Avoid copying upstream Pi source. Prefer public extension APIs and documented package interfaces.

## Licensing

By submitting a contribution, you certify that you have the right to provide it under the repository's MIT License. Third-party code or documentation must retain its required license and attribution, and its provenance must be documented.

## Security reports

Do not open a public issue for a vulnerability that could expose credentials or user source code. Follow [`SECURITY.md`](SECURITY.md).
