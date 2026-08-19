# Third-Party Notices

## Pi coding agent

Pi Cascade depends on [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent), version `0.84.2`.

- Upstream repository: `earendil-works/pi`
- Integration snapshot: `59a71b235dadb4ad0d67557a8abb0aaa093e68b4`
- Copyright: Copyright (c) 2025 Mario Zechner
- License: MIT
- License copy: [`licenses/PI-LICENSE.txt`](licenses/PI-LICENSE.txt)

Pi Cascade uses Pi through its published package, command-line interface, and public extension APIs. The Pi source tree is not vendored into this repository or into the Pi Cascade npm tarball. npm installs the pinned Pi package as a separate runtime dependency, and that dependency retains its own package metadata and license.

Pi Cascade is an independent project. It is not affiliated with, sponsored by, or endorsed by the Pi project, Mario Zechner, or Earendil Works. The name “Pi” is used only to identify technical compatibility and the upstream runtime dependency.

See [`UPSTREAM.json`](UPSTREAM.json) and [`docs/legal.md`](docs/legal.md) for the integration record and distribution notes.
