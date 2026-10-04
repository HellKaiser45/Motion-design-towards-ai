# AGENTS.md

**agent-stage** is a wrapper framework around three.js + GSAP that hides 3D/2D boilerplate behind a declarative, JSON-serializable spec. It is designed so LLM/AI agents can author animations by mapping intent to a small, enumerable token vocabulary.

## Current state (Phase 1)

Implemented:

- `src/spec/schema.js` — single source of truth for the token vocabulary (pure data module, no three.js/gsap imports). `describeTokens()` emits the full vocabulary as JSON.
- `src/spec/validate.js` — `validateSpec()` / `normalizeSpec()`: structured errors with did-you-mean suggestions and JSON-pointer paths rooted at `/`.
- `src/stage/createStage.js` — `createStage(spec)` builds renderer/scene/camera/lights/objects and exposes `timeline` (a single paused GSAP timeline), `objects` (name -> mesh registry), `lights` (name -> light registry), and `seek/play/pause/render/dispose`. Works headless in Node (renderer auto-skips without WebGL).
- Tests: `npm test` (node --test).

Not yet implemented (Phase 2+): score compiler (cues -> GSAP timeline), SVG overlay layer, decal bridge, render/verdict tooling, docs.

## Contract for agents

- Specs are JSON-serializable objects. Every token is validated; typos produce structured errors with suggestions — never guess, fix from the suggestion.
- Determinism is non-negotiable: `stage.seek(t)` must always produce the same scene state for the same `t`.
- The one-page token map will live in `docs/tokens.md` once Phase 2 lands; until then, `describeTokens()` (exported from the package root) is the authoritative vocabulary.
