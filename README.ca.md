# Quasidian

[English](README.md) · **Català** · [Español](README.es.md)

Editor d'escriptori de markdown minimalista que imita l'aspecte i el comportament d'Obsidian (Live Preview, wikilinks, tema fosc) sense el seu pes. Fet amb Tauri 2, Vite, TypeScript i CodeMirror 6, per [AIS Vision Systems](https://github.com/AIS-Vision-Systems).

## Funcionalitats

- **Edició amb Live Preview** — els símbols de sintaxi markdown s'amaguen fora de la línia activa, a l'estil Obsidian. L'edició és sempre text pla.
- **Mode de lectura** (Ctrl+E) — HTML renderitzat des del mateix arbre de parseig que fa servir l'editor; les caselles de tasques continuen sent clicables.
- **Wikilinks i backlinks** — `[[enllaços]]` amb autocompleció, resolts contra la carpeta del fitxer obert.
- **Carpeta = vault** — sense configuració, sense base de dades, sense fitxers d'índex escrits a les teves notes. Obre un fitxer markdown i la seva carpeta esdevé l'espai de treball.
- **Cerca global** a la carpeta, mantinguda al dia per un vigilant de fitxers.
- **Matemàtiques** renderitzades amb KaTeX.
- **Interfície trilingüe** — English, Català, Español.
- Compatible amb **Windows 11 i Ubuntu**, amb comprovació d'actualitzacions integrada.

## Descàrrega

Baixa l'últim instal·lador de la [pàgina de Releases](https://github.com/AIS-Vision-Systems/Quasidian/releases/latest):

- **Windows**: instal·lador NSIS (`.exe`)
- **Ubuntu/Linux**: paquet `.deb` o `.AppImage`

L'aplicació comprova si hi ha versions noves en arrencar (configurable a Configuració) i t'avisa discretament a la barra d'estat.

## Llicència

Quasidian té doble llicència:

- **Gratuït per a ús no comercial** sota la [PolyForm Noncommercial License 1.0.0](LICENSE.md).
- L'**ús comercial** requereix una [llicència comercial](LICENSE-COMMERCIAL.md) d'AIS Vision Systems.

## Compilar des del codi font

### Prerequisits — Windows 11

1. **Rust** (stable, toolchain MSVC):
   ```powershell
   winget install Rustlang.Rustup
   rustup default stable-x86_64-pc-windows-msvc
   ```
2. **Visual Studio C++ Build Tools** — instal·la [Visual Studio](https://visualstudio.microsoft.com/) (la Community serveix) amb la càrrega de treball *Desktop development with C++*, o les Build Tools independents.
3. **WebView2** — preinstal·lat a Windows 11.
4. **Node.js** ≥ 20 amb npm.

### Prerequisits — Ubuntu

1. Paquets del sistema:
   ```sh
   sudo apt update
   sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
     libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
   ```
2. **Rust** (stable):
   ```sh
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
3. **Node.js** ≥ 20 amb npm (p. ex. via [nvm](https://github.com/nvm-sh/nvm) o NodeSource).

### Executar

```sh
npm install
npm run tauri dev
```

La primera execució compila la part Rust i triga uns minuts; les següents són ràpides.

### Compilar

```sh
npm run tauri build
```

Genera l'instal·lador/paquet de la plataforma a `src-tauri/target/release/bundle/`.

## Desenvolupament

```sh
npm test           # tests unitaris Vitest (mòduls purs)
npm run typecheck  # tsc --noEmit; ha de passar abans de cada commit
```

Consulta [`CLAUDE.md`](CLAUDE.md) per a les regles d'arquitectura i les convencions de treball, i [`CONTRIBUTING.md`](CONTRIBUTING.md) per saber com contribuir. Les contribucions requereixen acceptar el [Contributor License Agreement](CLA.md).

## Full de ruta

El nucli de Quasidian (resolució d'enllaços, indexació, renderitzat de markdown) és TypeScript pur sense dependències de Tauri ni del DOM, sobre CodeMirror 6 i Lezer. Un objectiu de futur és empaquetar aquest nucli com a **visor/editor de markdown integrable en aplicacions web**, més enllà de l'aplicació d'escriptori.

## Publicar una release (mantenidors)

1. Puja la versió a `package.json`, `src-tauri/tauri.conf.json` i `src-tauri/Cargo.toml` (més els dos lockfiles) i fes merge a `main`.
2. Etiqueta-la: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. El workflow `release` crea una release en esborrany en aquest mateix repositori, compila els instal·ladors de Windows (NSIS) i Linux (deb, AppImage), els puja, i publica la release quan tots els instal·ladors hi són — la comprovació d'actualitzacions de l'app llegeix l'última release publicada a través de l'API de GitHub.

## Crèdits

Idea i desenvolupament original de **Xavi Anguera**. Un projecte d'**AIS Vision Systems**.
