# Prompt inicial — Quasidian

**Quasidian**: editor de markdown d'escriptori minimalista amb aparença i comportament el més semblants possible a Obsidian. Repo: `quasidian` (privat de moment). Nom del binari/paquet: `quasidian`.

Aquest document defineix l'abast, l'stack i el pla. Comença creant l'estructura del projecte i el primer milestone.

## Stack (decidit, no el canviïs)

- **Tauri 2** com a shell d'escriptori (Rust només per a comandes de sistema de fitxers).
- **Vite + TypeScript** per al frontend. Sense framework d'UI pesat; vanilla TS o com a molt una llibreria mínima si es justifica.
- **CodeMirror 6** com a nucli de l'editor, amb `@codemirror/lang-markdown` i `@lezer/markdown` per al parsing. Mai un parser de markdown propi.
- Targets: Windows 11 i Ubuntu.

## Concepte clau: carpeta = vault implícit

No hi ha vaults explícits ni configuració de vault:

- En obrir un fitxer `.md`, **la seva carpeta immediata actua com a vault**.
- Els **wikilinks** `[[nom]]` es resolen només contra fitxers `.md` de la mateixa carpeta (no recursiu, sense subcarpetes).
- Els **backlinks** i la **cerca global** operen només sobre la carpeta del fitxer obert (no recursiu).
- Per enllaçar fitxers d'altres carpetes cal ruta relativa o completa: `[[subcarpeta/nota]]`, `[[../altres/nota]]`.
- Cap base de dades: els fitxers `.md` al disc són l'única font de veritat. Els índexs (backlinks, cerca) es construeixen en memòria en obrir la carpeta i s'actualitzen amb un watcher de fitxers.

## Fora d'abast (no ho implementis)

- Graph view.
- Plugins de tercers, sync, publish.
- WYSIWYG de model de document (ProseMirror-style). Sempre s'edita text pla.

## Aparença

- Tema fosc per defecte, calcant l'estètica d'Obsidian.
- Usa els **noms de variables CSS d'Obsidian** (`--background-primary`, `--background-secondary`, `--text-normal`, `--text-muted`, `--text-accent`, `--interactive-accent`, etc.) perquè es puguin adaptar temes existents amb poc esforç.
- Layout: barra lateral esquerra amb arbre de fitxers de la carpeta actual, àrea d'editor a la dreta, barra d'estat inferior (recompte de paraules, mode).

## Comportament de l'editor (Live Preview)

El tret definitori: **amagar els tokens de sintaxi fora de la línia/selecció activa**, com el Live Preview d'Obsidian.

- `**negreta**` es renderitza en negreta; els `**` reapareixen quan el cursor entra al rang.
- Igual per a *cursiva*, `codi inline`, ~~ratllat~~, headings (amagar `#` i aplicar mida), blockquotes, enllaços.
- Implementació: un `ViewPlugin` de CM6 que recorre l'arbre de sintaxi de Lezer i aplica `Decoration.replace` sobre els tokens quan el cursor no hi és dins.
- Wikilinks com a extensió de Lezer pròpia; renderitzats com a enllaç clicable (Ctrl+clic obre el fitxer; si no existeix, el crea).

## Mode edició / mode lectura

Commutables amb **Ctrl+E** (com a Obsidian) i amb un botó a la barra de pestanyes/estat:

- **Mode edició** = el Live Preview descrit a dalt (sempre editable, text pla amb sintaxi amagada).
- **Mode lectura** = document renderitzat com a HTML final, no editable: sense cap token de sintaxi, espaiat de paràgrafs propi de document, llistes de tasques clicables (l'únic element interactiu que sí escriu al fitxer), wikilinks i enllaços navegables amb la mateixa lògica de resolució que en mode edició.
- El renderitzat del mode lectura ha de sortir **del mateix parse de Lezer** que fa servir l'editor (arbre de sintaxi → HTML), no d'un segon parser, perquè els dos modes no discrepin mai.
- Conservar la posició de scroll aproximada en commutar de mode.
- El mode és per pestanya/fitxer, i la barra d'estat indica el mode actual.

## Configuració de l'aplicació

L'app ha de tenir opcions de configuració, accessibles des d'un modal de settings amb estètica calcada a la d'Obsidian (llista de seccions a l'esquerra, opcions a la dreta):

- **Emmagatzematge**: un únic `settings.json` al directori de configuració de l'app (via `appConfigDir` de Tauri), **mai** dins les carpetes de notes — com que carpeta = vault implícit, no volem embrutar-les amb dotfiles. Escriptura atòmica i recàrrega en calent: canviar una opció s'aplica a l'instant, sense reiniciar.
- **Idioma de la interfície (i18n)**: diccionaris JSON per idioma (`ca`, `es`, `en` d'inici) amb claus planes; res de llibreries pesades. Tot el text d'UI passa per una funció `t(key)` des del primer dia — cap string hardcodejat als components.
- **Aparença**: tema fosc/clar/segons sistema, color d'accent (`--interactive-accent`), font de l'interfície, font de l'editor (proporcional/monospace), mida de font, amplada màxima de línia (readable line length).
- **Comportament de l'editor**: mode per defecte en obrir un fitxer (edició/lectura), autosave (on/off + interval), mostrar números de línia, vim mode off per defecte (no cal implementar-lo, només deixar el forat), indentació (espais/tabs), spellcheck del navegador on/off.
- **Fitxers**: confirmació abans d'esborrar, extensió per defecte en crear des de wikilink.
- Un mòdul pur `settings` amb schema tipat (TypeScript), valors per defecte i validació en carregar (si el JSON és invàlid o incomplet, fusionar amb defaults, mai petar). Tests unitaris d'aquesta lògica.

## Milestones (implementa'ls en ordre, un PR per milestone)

1. **Esquelet**: projecte Tauri 2 + Vite + TS funcionant; finestra amb tema fosc i variables CSS; comandes Rust per obrir/llegir/escriure fitxers i llistar la carpeta. Des d'aquest milestone, tot text d'UI ja passa per `t(key)` i tot color per variable CSS, encara que el modal de settings no arribi fins al milestone 6.
2. **Editor pla**: CM6 amb lang-markdown en text pla, obrir/desar (Ctrl+S), arbre de fitxers funcional, autosave opcional.
3. **Live Preview bàsic**: ViewPlugin d'amagar sintaxi per a headings, bold, italic, codi inline, blockquote.
4. **Wikilinks**: extensió Lezer, resolució dins la carpeta, Ctrl+clic per navegar, creació de fitxer si no existeix, autocompletat de `[[` amb els fitxers de la carpeta.
5. **Quick switcher (Ctrl+O) i paleta de comandes (Ctrl+P)** amb cerca difusa.
6. **Configuració**: mòdul `settings` tipat + `settings.json` + modal de settings estil Obsidian + i18n (`ca`, `es`, `en`) + opcions d'aparença i comportament aplicades en calent.
7. **Mode lectura**: renderitzat HTML des de l'arbre de Lezer, toggle Ctrl+E, navegació de links, conservació de scroll.
8. **Backlinks**: panell lateral que mostra quins fitxers de la carpeta enllacen al fitxer obert; índex en memòria + watcher.
9. **Cerca global (Ctrl+Shift+F)** sobre la carpeta.
10. **Polit**: imatges incrustades `![[img.png]]` via `Decoration.widget`, llistes de tasques clicables en mode edició, code blocks amb highlight.

## Convencions

- TypeScript estricte (`strict: true`).
- Commits en anglès, estil conventional commits (`feat:`, `fix:`, `refactor:`).
- La lògica de resolució de links i d'indexació ha d'estar en mòduls purs (sense dependre de Tauri ni del DOM) amb tests unitaris (Vitest).
- El codi Rust, mínim: només filesystem i watcher; res de lògica de negoci.

## Primer pas concret

Executa el milestone 1: crea el projecte, deixa'l compilant i executable amb `npm run tauri dev`, i documenta al README com engegar-lo a Windows i a Ubuntu.
