---
paths:
  - "src-tauri/src/**/*.rs"
  - "src-tauri/build.rs"
  - "src-tauri/capabilities/**/*.json"
  - "src-tauri/tauri.conf.json"
  - "src-tauri/Cargo.toml"
  - "src/ipc/**/*.ts"
---

# Tauri shell and the IPC boundary

The Rust side is deliberately thin. `src-tauri/src/lib.rs` holds every command; `main.rs` is a stub.

- **Filesystem commands, the watcher and plugin forwarding only.** No business logic in Rust — link resolution, indexing, settings and session logic live in `src/lib/` where they are testable.
- One responsibility per command. A command exists because the frontend genuinely cannot do the job: binary files, OS integration, path scopes.
- Every new command needs its permission in `src-tauri/capabilities/default.json`. A permission that carries no `allow` scope authorizes nothing — that is the cause of the "Not allowed to open path" failure in milestone 39.
- Wrap each command in `src/ipc/` so the rest of the app never calls `invoke` directly. `src/ipc/` is the only place allowed to import `@tauri-apps/*` besides `main.ts`.
- Never embed a token, key or credential here or in a workflow file. The repository is public.
- The app version is never hardcoded: read it from the Tauri config at runtime.
- `tauri.conf.json` holds the CSP and the asset-protocol scope. Widening a scope at runtime is done from Rust (`asset_protocol_scope().allow_directory`), not by loosening the static scope.

A version bump touches `tauri.conf.json`, `Cargo.toml`, `package.json` and **both** lockfiles — CI fails the release if they disagree with the tag.

Anything changed here is tested on **Windows and Ubuntu**. Paths, the watcher, printing and the CSP behave differently on each, and CI does not build Rust.
