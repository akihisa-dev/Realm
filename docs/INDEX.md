# Realm documentation index

This index routes work to the source-of-truth document. A document may summarize another one, but implementation decisions must be checked against the most specific source.

## Product

- [Project overview](project/overview.md): purpose, scope, users, non-goals, and terminology.

## Engineering

- [Architecture](engineering/architecture.md): Electron main/preload boundaries, state ownership, and offline guarantees.
- [Data model](engineering/data-model.md): schema 12 `.realmmap` SQLite contract, three persistent layers, and transient grid selections.
- [Stack](engineering/stack.md): selected technologies and platform constraints.
- [Test strategy](engineering/test-strategy.md): test layers and evidence expected before publication.

## Design

- [Design source](design/DESIGN.md): initial visual system, application states, layout, and renderer presentation rules.

## Development and operations

- [Development](development.md): local setup, safe commands, document rules, and verification.
- [Release operations](operations/release.md): explicit approval, local publication gates, tags, and draft artifacts.

## Repository policy

- [AGENTS.md](../AGENTS.md): automated-contributor rules.
- [CONTRIBUTING.md](../CONTRIBUTING.md): owner-led contribution policy.
- [SECURITY.md](../SECURITY.md): secret defense and vulnerability reporting.
- [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md): dependency notice starting point.

When a code change makes one of these statements inaccurate, update the document in the same change. Do not create a second competing source of truth.
