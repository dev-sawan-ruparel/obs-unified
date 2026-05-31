# `sdks/_template/` — community SDK skeleton

Use this directory as a starting point for adding a new first-party or community
SDK in a language not yet covered. The template documents the **minimum
surface** an SDK needs to expose, and the **conformance tests** it MUST pass to
be listed in the polyglot matrix.

## Required surface

Every conformant obs-unified SDK exposes these primitives. Names should follow
the idiomatic style of your language; signatures and semantics MUST match the
reference.

| Concept                | Reference (Node)                         | Required?                      |
| ---------------------- | ---------------------------------------- | ------------------------------ |
| Init                   | `init(config): Shutdown`                 | yes                            |
| LLM span               | `withLLMSpan(opts, fn)`                  | yes (for AI parity)            |
| Tool span              | `withToolSpan(opts, fn)`                 | yes (for AI parity)            |
| Project propagation    | `setProjectId(id)` + `PROJECT_ID_HEADER` | yes for multi-tenant           |
| Interaction stamping   | `stampInteractionFromRequest(span, req)` | yes (the unified-stack thesis) |
| Interaction validation | `isValidInteractionId(s)`                | yes (for tests)                |

The [`docs/spec/interaction-id.md`](../../docs/spec/interaction-id.md) file is
the **wire spec**. Read it before implementing.

## Required tests

Every SDK MUST pass the four cases in
[`tests/conformance/interaction-id/`](../../tests/conformance/interaction-id/).
The test runner can be language-native (`pytest` / `go test` / `cargo test`) but
the assertions MUST match the spec exactly:

1. **ID format** — 1,000 generated IDs all match the wire regex.
2. **Header round-trip** — well-formed header stamps the active span.
3. **Absent-header no-op** — missing header → no attribute, no error.
4. **Malformed-header no-op** — invalid header → no attribute, no error.

## Required files

```
sdks/<lang>/
├── README.md             # quickstart + cross-link to docs/spec/
├── <lang>-package-file>  # package.json / Cargo.toml / go.mod / pyproject.toml
├── src/
│   ├── init.<ext>        # OTLP exporter setup
│   ├── interaction.<ext> # stamp_interaction + is_valid_interaction_id
│   ├── llm.<ext>         # withLLMSpan / withToolSpan
│   └── project.<ext>     # setProjectId
├── examples/
│   └── basic.<ext>       # init + one span + flush
└── tests/
    └── interaction_conformance.<ext>
```

## Submitting

1. Fork.
2. Build under `sdks/<your-lang>/` mirroring the structure above.
3. Run the conformance tests locally.
4. Open a PR. The maintainers will run the conformance suite in CI and review
   the API ergonomics for idiomatic-ness.
5. Once merged, your SDK is listed in [`sdks/README.md`](../README.md).

## Maintenance contract

Community SDKs are listed under a "Community" column with the maintainer's
GitHub handle. The obs-unified core team will **not** fix bugs in community SDKs
but **will** keep the wire spec backwards-compatible — any breaking change to
the wire format triggers a major version bump of the spec and explicit migration
notes.

## License

MIT, matching the rest of obs-unified.
