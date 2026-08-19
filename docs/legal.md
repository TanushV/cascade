# Legal and licensing notes

Pi Cascade is released under the MIT License. The full license is in [`LICENSE`](../LICENSE).

## Relationship to Pi

Pi Cascade is an independent extension and wrapper around the published `@earendil-works/pi-coding-agent` package. It is not an official Pi distribution and is not affiliated with, sponsored by, or endorsed by the Pi project, Mario Zechner, or Earendil Works.

The implementation does **not** copy or vendor the Pi source tree. The package declares an exact runtime dependency on `@earendil-works/pi-coding-agent@0.84.2`; npm downloads that dependency separately when Pi Cascade is installed. Pi remains under its own MIT License. A copy is preserved at [`licenses/PI-LICENSE.txt`](../licenses/PI-LICENSE.txt), and attribution is recorded in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

The integration uses Pi's published CLI and public extension APIs. [`UPSTREAM.json`](../UPSTREAM.json) records the compatible upstream commit and package version.

## Distribution

The source repository and release tarballs contain Pi Cascade code, documentation, tests, and integration metadata. They do not include Pi's complete source tree or `node_modules`.

The repository currently stores the exact tested source in a SHA-256-verified bootstrap archive because the initial publication environment could not perform a normal Git push. `npm install -g github:TanushV/cascade` verifies and materializes that source before npm packages it. The source archive is Pi Cascade code, not a copy of Pi.

During installation, npm resolves the pinned Pi dependency from the npm registry.

## Names and marks

“Pi Cascade” is the name of this independent compatibility project. References to “Pi,” package names, providers, and model names are nominative descriptions of interoperability. No upstream endorsement is claimed.

## Contributions

Contributors must submit work they have the right to license under this repository's MIT License and must preserve third-party notices. See [`CONTRIBUTING.md`](../CONTRIBUTING.md).

This document records the project's engineering licensing posture and is not legal advice. Organizations with special compliance requirements should perform their own review.
