# Contributing to Realm

Realm is owner-led. The owner sets product direction, architecture, release timing, and maintenance capacity. Public issues and pull requests are not actively solicited; a submission does not guarantee a response, review, acceptance, merge, or implementation.

The project is AGPL-3.0-or-later. This governance policy does not limit the license rights to use, modify, and redistribute the code.

## Before proposing a change

Read [docs/INDEX.md](docs/INDEX.md), [AGENTS.md](AGENTS.md), and the relevant document under `docs/`. Keep a proposal local and reproducible. Do not attach a `.realmmap` containing private places, personal data, or credentials.

## Local change rules

- Keep the change small and preserve unrelated work already present in the checkout.
- Do not change the `.realmmap` storage contract, year semantics, or feature history behavior without updating the corresponding architecture and data-model documents.
- Do not add network, cloud, generation, or image-to-map behavior to the 0.1.0 scope without an explicit product decision.
- Add or update tests for behavior and failure paths. Never use a real user's map file in tests; use a temporary fixture created by the test.
- Keep secrets out of source, fixtures, logs, screenshots, and commit messages. Run `.githooks/secret-guard.sh --self-test` when changing the guard.

## Verification

Run the formatter, Rust checks, strict TypeScript checks, and tests declared by the current `app/package.json`. Then run the repository checks described in [docs/development.md](docs/development.md). Before a push, the local publication gate must pass on the Apple Silicon development machine. The exact app script names are defined by the application package, not duplicated here.

## Commits and publication

Use Conventional Commits with one of the repository-approved lowercase types and a Japanese subject:

```text
<type>[!]: <version> <description>
```

The version is the exact `app/package.json` version. Put the affected English noun under `scope:` in the body and record the purpose, changes, verification, and impact. Explain data or migration impact explicitly and omit secrets, private paths, and raw sensitive errors. A commit request is not a push request. Tags, pushes, Draft Release creation, and Release publication follow separate owner gates in [.github/RELEASE_CHECKLIST.md](.github/RELEASE_CHECKLIST.md).
