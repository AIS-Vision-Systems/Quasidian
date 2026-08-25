# Quasidian

[English](README.md) · [Català](README.ca.md) · **Español**

Editor de escritorio de markdown minimalista que imita el aspecto y el comportamiento de Obsidian (Live Preview, wikilinks, tema oscuro) sin su peso. Hecho con Tauri 2, Vite, TypeScript y CodeMirror 6, por [AIS Vision Systems](https://github.com/AIS-Vision-Systems).

## Funcionalidades

- **Edición con Live Preview** — los símbolos de sintaxis markdown se ocultan fuera de la línea activa, al estilo Obsidian. La edición es siempre texto plano.
- **Modo de lectura** (Ctrl+E) — HTML renderizado desde el mismo árbol de parseo que usa el editor; las casillas de tareas siguen siendo clicables.
- **Wikilinks y backlinks** — `[[enlaces]]` con autocompletado, resueltos contra la carpeta del archivo abierto.
- **Carpeta = vault** — sin configuración, sin base de datos, sin archivos de índice escritos en tus notas. Abre un archivo markdown y su carpeta se convierte en el espacio de trabajo.
- **Búsqueda global** en la carpeta, mantenida al día por un vigilante de archivos.
- **Matemáticas** renderizadas con KaTeX.
- **Interfaz trilingüe** — English, Català, Español.
- Compatible con **Windows 11 y Ubuntu**, con comprobación de actualizaciones integrada.

## Descarga

Descarga el último instalador desde la [página de Releases](https://github.com/AIS-Vision-Systems/Quasidian/releases/latest):

- **Windows**: instalador NSIS (`.exe`)
- **Ubuntu/Linux**: paquete `.deb` o `.AppImage`

La aplicación comprueba si hay versiones nuevas al arrancar (configurable en Configuración) y te avisa discretamente en la barra de estado.

## Licencia

Quasidian tiene doble licencia:

- **Gratuito para uso no comercial** bajo la [PolyForm Noncommercial License 1.0.0](LICENSE.md).
- El **uso comercial** requiere una [licencia comercial](LICENSE-COMMERCIAL.md) de AIS Vision Systems.

## Compilar desde el código fuente

### Prerrequisitos — Windows 11

1. **Rust** (stable, toolchain MSVC):
   ```powershell
   winget install Rustlang.Rustup
   rustup default stable-x86_64-pc-windows-msvc
   ```
2. **Visual Studio C++ Build Tools** — instala [Visual Studio](https://visualstudio.microsoft.com/) (la Community sirve) con la carga de trabajo *Desktop development with C++*, o las Build Tools independientes.
3. **WebView2** — preinstalado en Windows 11.
4. **Node.js** ≥ 20 con npm.

### Prerrequisitos — Ubuntu

1. Paquetes del sistema:
   ```sh
   sudo apt update
   sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
     libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
   ```
2. **Rust** (stable):
   ```sh
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
3. **Node.js** ≥ 20 con npm (p. ej. via [nvm](https://github.com/nvm-sh/nvm) o NodeSource).

### Ejecutar

```sh
npm install
npm run tauri dev
```

La primera ejecución compila la parte Rust y tarda unos minutos; las siguientes son rápidas.

### Compilar

```sh
npm run tauri build
```

Genera el instalador/paquete de la plataforma en `src-tauri/target/release/bundle/`.

## Desarrollo

```sh
npm test           # tests unitarios Vitest (módulos puros)
npm run typecheck  # tsc --noEmit; debe pasar antes de cada commit
```

Consulta [`CLAUDE.md`](CLAUDE.md) para las reglas de arquitectura y las convenciones de trabajo, y [`CONTRIBUTING.md`](CONTRIBUTING.md) para saber cómo contribuir. Las contribuciones requieren aceptar el [Contributor License Agreement](CLA.md).

## Núcleo integrable

[![npm](https://img.shields.io/npm/v/@aisvision/quasidian-core?logo=npm&label=%40aisvision%2Fquasidian-core&color=blue)](https://www.npmjs.com/package/@aisvision/quasidian-core)

El núcleo de edición de Quasidian —el editor con Live Preview y el renderizado del modo lectura, que comparten un mismo árbol Lezer— se publica en npm como **[`@aisvision/quasidian-core`](https://www.npmjs.com/package/@aisvision/quasidian-core)**, un paquete integrable en aplicaciones web sin ninguna dependencia de Tauri:

```sh
npm install @aisvision/quasidian-core
```

Vive en [`packages/core`](packages/core), de donde la aplicación de escritorio lo consume desde las mismas fuentes, y su [README](packages/core/README.md) documenta la superficie pública: la factoría del editor, el renderizado de lectura y la resolución de enlaces, los iconos y los textos, que se inyectan desde fuera. `@codemirror/*` y `@lezer/*` son peer dependencies, porque dos copias de CodeMirror en una misma página rompen el editor. En [`packages/demo`](packages/demo) hay una integración mínima para navegador.

## Publicar una release (mantenedores)

1. Sube la versión en `package.json`, `src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml` (más los dos lockfiles) y haz merge a `main`.
2. Etiquétala: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. El workflow `release` crea una release en borrador en este mismo repositorio, compila los instaladores de Windows (NSIS) y Linux (deb, AppImage), los sube, y publica la release cuando todos los instaladores están — la comprobación de actualizaciones de la app lee la última release publicada a través de la API de GitHub.

El paquete del núcleo se versiona independientemente de la aplicación: sube la versión en `packages/core/package.json`, haz merge a `main` y etiqueta `core-vX.Y.Z`. El workflow `publish-core` lo publica en npm mediante **trusted publishing** (OIDC), de modo que no hay que guardar ningún token de npm en ninguna parte y npm le adjunta la procedencia automáticamente. El trusted publisher registrado en npmjs.com está ligado al nombre del archivo del workflow — si se renombra `publish-core.yml`, la publicación deja de funcionar hasta que se reconfigure allí.

## Créditos

Idea y desarrollo original de **Xavi Anguera**. Un proyecto de **AIS Vision Systems**.
