# Quasidian

Minimalist desktop markdown editor that mimics Obsidian's look and behavior (Live Preview, wikilinks, dark theme) without the weight. Built with Tauri 2, Vite, TypeScript and CodeMirror 6.

The full spec and milestone plan live in [`docs/SPEC.md`](docs/SPEC.md).
## Prerequisites

### Windows 11

1. **Rust** (stable, MSVC toolchain):
   ```powershell
   winget install Rustlang.Rustup
   rustup default stable-x86_64-pc-windows-msvc
   ```
2. **Visual Studio C++ Build Tools** — install [Visual Studio](https://visualstudio.microsoft.com/) (Community is fine) with the *Desktop development with C++* workload, or the standalone Build Tools.
3. **WebView2** — preinstalled on Windows 11.
4. **Node.js** ≥ 20 with npm.

### Ubuntu

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

## Running

```sh
npm install
npm run tauri dev
```

The first run compiles the Rust shell and takes a few minutes; subsequent runs are fast.

## Building

```sh
npm run tauri build
```

Produces a platform installer/bundle under `src-tauri/target/release/bundle/`.

## Development

```sh
npm test           # Vitest unit tests (pure modules)
npm run typecheck  # tsc --noEmit; must pass before any commit
```

See [`CLAUDE.md`](CLAUDE.md) for architecture rules and workflow conventions.
