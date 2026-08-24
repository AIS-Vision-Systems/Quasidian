# Quasidian

**English** · [Català](README.ca.md) · [Español](README.es.md)

Minimalist desktop markdown editor that mimics Obsidian's look and behavior (Live Preview, wikilinks, dark theme) without the weight. Built with Tauri 2, Vite, TypeScript and CodeMirror 6, by [AIS Vision Systems](https://github.com/AIS-Vision-Systems).

## Features

- **Live Preview editing** — markdown syntax tokens hide outside the active line, Obsidian-style. Editing is always plain text.
- **Reading mode** (Ctrl+E) — rendered HTML from the same parse tree the editor uses; task-list checkboxes stay clickable.
- **Wikilinks and backlinks** — `[[links]]` with autocompletion, resolved against the open file's folder.
- **Folder = vault** — no configuration, no database, no index files written into your notes. Open a markdown file and its folder becomes the workspace.
- **Global search** across the folder, kept fresh by a file watcher.
- **Math** rendering via KaTeX.
- **Trilingual UI** — English, Català, Español.
- **Windows 11 and Ubuntu** support, with an in-app update check.

## Download

Grab the latest installer from the [Releases page](https://github.com/AIS-Vision-Systems/Quasidian/releases/latest):

- **Windows**: NSIS installer (`.exe`)
- **Ubuntu/Linux**: `.deb` package or `.AppImage`

The app checks for new versions on startup (configurable in Settings) and notifies you discreetly in the status bar.

## License

Quasidian is dual-licensed:

- **Free for noncommercial use** under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).
- **Commercial use** requires a [commercial license](LICENSE-COMMERCIAL.md) from AIS Vision Systems.

## Building from source

### Prerequisites — Windows 11

1. **Rust** (stable, MSVC toolchain):
   ```powershell
   winget install Rustlang.Rustup
   rustup default stable-x86_64-pc-windows-msvc
   ```
2. **Visual Studio C++ Build Tools** — install [Visual Studio](https://visualstudio.microsoft.com/) (Community is fine) with the *Desktop development with C++* workload, or the standalone Build Tools.
3. **WebView2** — preinstalled on Windows 11.
4. **Node.js** ≥ 20 with npm.

### Prerequisites — Ubuntu

1. System packages:
   ```sh
   sudo apt update
   sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
     libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
   ```
2. **Rust** (stable):
   ```sh
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
3. **Node.js** ≥ 20 with npm (e.g. via [nvm](https://github.com/nvm-sh/nvm) or NodeSource).

### Running

```sh
npm install
npm run tauri dev
```

The first run compiles the Rust shell and takes a few minutes; subsequent runs are fast.

### Building

```sh
npm run tauri build
```

Produces a platform installer/bundle under `src-tauri/target/release/bundle/`.

## Development

```sh
npm test           # Vitest unit tests (pure modules)
npm run typecheck  # tsc --noEmit; must pass before any commit
```

See [`CLAUDE.md`](CLAUDE.md) for architecture rules and workflow conventions, and [`CONTRIBUTING.md`](CONTRIBUTING.md) for how to contribute. Contributions require accepting the [Contributor License Agreement](CLA.md).

## Embeddable core

Quasidian's editor core — the Live Preview editor and the reading-mode renderer, sharing one Lezer tree — is published on npm as **[`@aisvision/quasidian-core`](https://www.npmjs.com/package/@aisvision/quasidian-core)**, an embeddable package for web applications with no Tauri dependency:

```sh
npm install @aisvision/quasidian-core
```

It lives in [`packages/core`](packages/core), which the desktop app consumes from the same sources, and its [README](packages/core/README.md) documents the public surface: the editor factory, the reading render, and the injected wikilink resolver, icons and strings. `@codemirror/*` and `@lezer/*` are peer dependencies, because two copies of CodeMirror on one page break the editor. A minimal browser embedding lives in [`packages/demo`](packages/demo).

## Publishing a release (maintainers)

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (plus both lockfiles), merge to `main`.
2. Tag it: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The `release` workflow creates a draft release in this repository, builds the Windows (NSIS) and Linux (deb, AppImage) installers, uploads them, and publishes the release once every installer is up — the in-app update check reads the latest published release through the GitHub API.

The core package versions independently from the app: bump `packages/core/package.json`, merge to `main`, then tag `core-vX.Y.Z`. The `publish-core` workflow publishes it to npm through **trusted publishing** (OIDC), so no npm token is stored anywhere and npm attaches provenance automatically. The trusted publisher registered on npmjs.com is keyed to the workflow's filename — renaming `publish-core.yml` breaks publishing until it is reconfigured there.

## Credits

Idea and original development by **Xavi Anguera**. A project of **AIS Vision Systems**.
