# Known limitations

- Cascade is an additive Pi extension and launcher, not an independent model runtime.
- Live model availability, pricing, limits, and provider compatibility remain account- and date-dependent. Use `cascade probe`.
- The bundled Meta profile may require a different current model ID or adapter for a particular account.
- Contributor redaction and denied paths are defense in depth, not proof that ordinary source text cannot reveal sensitive information.
- Pi and its extensions run with the launching user's permissions unless externally sandboxed.
- Expert cost estimates depend on provider usage reporting or configured catalog rates.
- Automatic routing starts from a transparent weighted policy rather than a pretrained proprietary router.
- Harness replay evaluates observed tasks, not all possible future work; broad promotions require stricter review.
- The optional programmatic workspace is a bounded subprocess helper, not a security sandbox or persistent IPython kernel.
- `cascade update` replaces the global package from GitHub and therefore requires npm/GitHub access. The running process keeps the old loaded code until restarted.
- Real pseudo-terminal coverage runs on Unix-like systems; Windows CI still exercises all non-PTY unit, integration, packaging, and command-shim paths.
