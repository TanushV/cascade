# Known limitations

- Pi Cascade is a thin Pi extension and package overlay, not a replacement agent runtime.
- Live model availability, pricing, rate limits, and API compatibility are account- and date-dependent. Use `pi-cascade probe`.
- The bundled Meta profile is based on public OpenAI-compatible Model API integration information; an account may require a different current model ID or adapter.
- Contributor redaction and path denial are defense in depth, not a proof that proprietary information cannot be inferred from ordinary source text.
- Pi and Pi extensions execute with the launching user's permissions unless the entire process or tool surface is externally sandboxed.
- Expert cost estimates depend on provider usage/cost reporting or configured catalog rates.
- Automatic routing begins with a transparent weighted policy. It records trajectory data but does not ship a pretrained proprietary routing model.
- Harness promotion evaluates observed tasks, not every possible future repository. Global changes therefore require stricter review.
- The programmatic workspace is a bounded subprocess helper, not a security sandbox or a persistent IPython kernel.
- The distributed source package includes the full Cascade implementation and deterministic Pi overlay/bootstrap scripts. It does not redistribute Pi's entire upstream monorepo inside the npm tarball.
