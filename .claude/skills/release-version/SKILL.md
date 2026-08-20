---
name: release-version
description: Cutting a Quasidian release — bumping the version in the three manifests plus both lockfiles, tagging vX.Y.Z, and what release.yml does with it. Use for "bump the version", "release 1.0.2", "publish a release", or when the in-app update check needs a new version to find.
---

# Cutting a release

## 1. Bump the version — five files, one value

| File | Field |
|---|---|
| `package.json` | `version` |
| `package-lock.json` | `version` in both the root object and the `""` package entry |
| `src-tauri/tauri.conf.json` | `version` |
| `src-tauri/Cargo.toml` | `[package] version` |
| `src-tauri/Cargo.lock` | the `quasidian` package entry |

Prefer letting the tools rewrite the lockfiles (`npm version --no-git-tag-version <x.y.z>`, and `cargo build` or `cargo update -p quasidian` for `Cargo.lock`) over hand-editing them.

`create-release` in CI asserts that the tag matches all three manifests and fails the release if any disagree. Semver: `fix:` → patch, `feat:` → minor.

The version is **never hardcoded in the app** — the credits page and the update check read it from the Tauri config at runtime.

## 2. Land it, then tag

```sh
# on a branch, via PR — main takes no direct pushes
git switch -c chore/bump-<x.y.z>
# … bump, commit as: chore: bump version to <x.y.z>
gh pr create && gh pr merge --squash --delete-branch

git switch main && git pull
git tag v<x.y.z> && git push origin v<x.y.z>
```

`v*` tags are restricted to admins by the repository ruleset.

## 3. What CI does — `.github/workflows/release.yml`

Pushing the tag runs three jobs, using only the ephemeral `GITHUB_TOKEN` (no PAT, no secret in the repo):

1. **`create-release`** — the tag ↔ version guard, then `gh release create --draft`.
2. **`build`** — matrix: `windows-latest` → NSIS installer, `ubuntu-22.04` → `.deb` + AppImage. Each uploads its bundles to the draft with `gh release upload --clobber`.
3. **`publish`** — `gh release edit --draft=false`, gated on every build succeeding.

The draft-until-complete sequence is deliberate: the in-app update check reads `https://api.github.com/repos/AIS-Vision-Systems/Quasidian/releases/latest`, so a release must never become "latest" while its installers are still uploading. Don't publish a draft by hand.

## 4. After the run

- `gh release view v<x.y.z>` — the release is published and carries the Windows installer, the `.deb` and the AppImage.
- The release body is the changelog users see; write it for users, not as a commit dump.
- Check the in-app "Check for updates" (settings → general, and the credits page) finds the new version.

## Notes

- Signed updates via `tauri-plugin-updater` are milestone 43. Until then the app only *notifies* about a new version and opens the download page — it never downloads or installs anything by itself. On Linux the updater will support AppImage only, which is why the AppImage is published alongside the `.deb`.
- `CI` (`ci.yml`) is a different workflow: it runs `npm run typecheck` and `npm test` on PRs to `main` and is the required `test` check. It does not build Rust.
