# Known limitations

- Cascade uses Pi's engine and terminal component library internally. It is a separate application boundary, not an independently reimplemented agent engine.
- Provider availability, model IDs, prices, limits, and terms change independently of Cascade. Use `/login`, `/model`, and `cascade probe` with your own account.
- Cascade extensions run with the launching user's operating-system permissions. Use an external sandbox for untrusted repositories or commands.
- Secret redaction and denied paths are defense in depth; ordinary source text can still disclose proprietary information.
- The initial router is a transparent trajectory-scoring policy. Repository-local outcome learning requires real usage data and does not guarantee optimal model allocation.
- Global compaction limits expose the engine's `reserveTokens` and `keepRecentTokens` controls. They do not create a hard provider-side context cap.
- `cascade update` depends on npm, Git, network access, and write permission to the active global npm prefix.
- Project `AGENTS.md` files remain visible because they are repository instructions. Pi-specific global state and `.pi/extensions` are isolated.
