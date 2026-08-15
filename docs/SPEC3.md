# Fase 3 — Quasidian

Les fases 1 (`SPEC.md`, milestones 1–11) i 2 (`SPEC2.md`, milestones 12–23) estan completes: l'aplicació ja és un workspace amb pestanyes, propietats, taules interactives, footnotes, callouts i persistència de sessió. Aquest document defineix la fase 3: el backlog que les fases anteriors van deixar explícitament fora d'abast, més la pàgina de crèdits i ajuda. L'objectiu no canvia: aparença i comportament d'Obsidian sense perdre el minimalisme.

Llegeix `SPEC.md` i `SPEC2.md` abans de començar: tot el que hi diu segueix vigent excepte on aquest document ho ampliï o esmeni.

## Invariants (no els canviïs)

- **Un sol parser**: qualsevol novetat de sintaxi s'implementa com a extensió del parser Lezer compartit (`src/markdown/parser.ts`). Mai un segon parser de markdown; lectura, popups, embeds i exportació renderitzen sempre des del mateix arbre.
- **Carpeta = vault implícit, no recursiu** — amb una excepció deliberada i acotada: el milestone 29 introdueix els modes multicarpeta, que activen un vault recursiu **només** quan la carpeta conté els fitxers marcadors. Fora d'aquests modes, el comportament pla actual queda intacte.
- **Tot text d'UI per `t(key)`** (ca, es, en) i **tot color per variable CSS**. També a les particions, finestres noves, pàgina de crèdits i documentació.
- **Rust mínim**: comandes de filesystem d'una sola responsabilitat, watcher, i reenviaments de plugins (single-instance). Res de lògica de negoci. Les novetats d'aquesta fase que toquin Rust (impressió a PDF, watcher recursiu, finestres) han de mantenir aquesta línia.
- **Mòduls purs + Vitest**: la lògica nova (arbre de particions, detecció de vault, resolució recursiva de links) va a mòduls sense Tauri ni DOM, amb tests unitaris.
- **Cada canvi al parser porta tests dual-mode**; **cada setting nou** amplia schema tipat + defaults + modal + i18n ×3 al mateix PR.

## Fora d'abast permanent

- Graph view, sistema de plugins, sync, publish.
- WYSIWYG de model de document (l'edició és sempre text pla).
- Vim mode (només el forat a settings).

## Milestones (implementa'ls en ordre, un PR per milestone)

24. **Exportar a PDF**:
    - Nova entrada «Exporta a PDF» al menú contextual del fitxer (llista lateral, capçalera i botó de tres punts) i a la paleta de comandes.
    - El document s'exporta **renderitzat com el mode lectura** (mateix arbre Lezer, mateix pipeline): embeds resolts, imatges, taules amb alineacions, callouts, footnotes al peu, fórmules KaTeX.
    - Full d'estil d'impressió propi: fons blanc i text fosc independentment del tema de l'app, marges de pàgina raonables, sense chrome (barres, botons, xebrons de plegat).
    - Diàleg de desar amb el nom de la nota com a proposta (`nota.pdf`).
    - Implementació per l'API d'impressió/PDF del WebView (WebView2 a Windows, webkit a Ubuntu); si cal una comanda Rust, que sigui un pont fi sense lògica de negoci. Provar a les dues plataformes.

25. **Pàgina de crèdits i ajuda**:
    - Nou botó amb icona **«?»** (help-circle) a la barra inferior, immediatament **a la dreta del botó de settings**, amb tooltip i aria-label i18n.
    - Obre una pàgina de crèdits amb el **logo** de Quasidian (la icona de l'app), el **nom**, el **número de versió** (llegit de la configuració de Tauri en temps d'execució, mai hardcodejat) i l'**autor**.
    - Des de la mateixa pàgina, accés a la **documentació d'ús**: una guia de com utilitzar l'aplicació (obrir carpetes i fitxers, modes edició/lectura, wikilinks i embeds, propietats, taules, callouts i footnotes, pestanyes, cerca, paleta i dreceres de teclat).
    - La documentació s'escriu en **markdown empaquetat amb l'app** (mai dins de les carpetes de notes) i es renderitza amb el pipeline de lectura compartit — l'app es documenta amb el seu propi format. Una guia per idioma (ca, es, en), seleccionada segons l'idioma de la UI.
    - La pàgina es tanca com el modal de settings (X, Escape, clic fora).

26. **Ajustos del workspace**:
    - **Redimensionar panells**: les vores dels panells esquerre i dret es poden arrossegar per canviar-ne l'amplada, amb mínims raonables; les amplades persisteixen a la sessió.
    - **Menú contextual de la vista**: clic dret als marges buits de l'editor (fora del text) o sobre el gutter de números de línia obre un menú propi (mateix component de menú) amb tres commutadors amb check: **Amplada de línia llegible**, **Números de línia** i **Títol integrat**. Cada ítem commuta el setting corresponent — els dos primers ja existeixen (`appearance.readableLineLength`, `editor.showLineNumbers`) i s'apliquen en calent com des del modal.
    - **Títol integrat (inline title)**: setting nou (per defecte **activat**; schema + modal + i18n al mateix PR). El nom del fitxer (sense extensió) es mostra com a títol estil H1 al principi de la nota, **per sobre del bloc de propietats**, idèntic als dos modes; mai s'escriu al fitxer. És navegable: el cursor hi pot entrar des de l'editor i el títol és editable in situ; confirmar l'edició (Enter o perdre el focus) es tracta com un **canvi de nom** amb el flux existent (rename amb re-apuntat de wikilinks, estat per fitxer i pestanyes).
    - **Historial de navegació per pestanya**: fletxes enrere/endavant a l'esquerra de la barra del fitxer (desactivades quan no hi ha on anar), dreceres Alt+←/Alt+→ i botons laterals del ratolí. Cada pestanya manté el seu propi historial (model al mòdul pur del workspace, amb tests), inclòs a la persistència de sessió.

27. **Vistes dividides (splits) i docking**:
    - **Botó «+» de pestanya nova** a la dreta de cada grup de pestanyes: obre una pestanya buida («Nova pestanya») amb tres accions centrades en el color d'accent — crear una nota nova (`Ctrl+N`), obrir un fitxer (`Ctrl+O`, el quick switcher) i tancar la pestanya. `Ctrl+N` és drecera global: crea una nota amb nom lliure («Sense títol», «Sense títol 1»…) a la carpeta actual i l'obre.
    - El panell central es pot **partir verticalment** («split right»); cada partició té la seva barra de pestanyes i la seva barra de fitxer, i una de les particions és l'activa (la que rep les obertures de fitxers i les comandes). Les vores entre particions reutilitzen la mecànica de redimensionament del milestone 26, i la sessió ja en persisteix les mides.
    - Refactor previ: extreure el «pane» (editor CM6 + vista de lectura + barres) com a component instanciable — el model d'un únic editor reutilitzat de la fase 2 deixa de ser suficient. L'arbre de particions va a un mòdul pur amb tests.
    - Crear splits: menú contextual de pestanya («Obre a la dreta») i de la barra del fitxer; **arrossegar una pestanya** a la vora dreta/esquerra d'una partició o entre barres de pestanyes la mou o crea la partició (docking).
    - Tancar l'última pestanya d'una partició la col·lapsa i el veí recupera l'espai.
    - La persistència de sessió s'amplia a l'arbre de particions (fitxers, pestanya activa i mides per partició).
    - «Split down» (partició horitzontal) només si surt de manera natural del mateix refactor; no és un requisit.

28. **Múltiples instàncies d'un fitxer i finestres noves**:
    - Una mateixa nota pot ser oberta **en més d'una pestanya o partició alhora**: totes les vistes comparteixen el mateix buffer (una edició es reflecteix a l'instant a totes), però cada vista manté el seu mode, scroll i plegat. Cau la restricció «una pestanya per fitxer» del mòdul workspace.
    - **Finestres noves**: «Mou a una finestra nova» al menú de pestanya. Cada finestra té el seu workspace (pestanyes i particions pròpies); totes comparteixen la mateixa carpeta/vault i es mantenen coherents (edicions, canvis de nom, esborrats) via els events de Tauri i el watcher.
    - La instància única de l'app es manté: les finestres noves són finestres de la mateixa instància.
    - La sessió recorda les finestres obertes (posició i workspace de cadascuna).

29. **Modes multicarpeta (CLAUDE/GPT)** — l'excepció acotada a l'invariant «no recursiu»:
    - **Detecció automàtica**: si la carpeta oberta — o qualsevol avantpassat — conté un fitxer marcador, l'app entra en mode vault recursiu amb aquella carpeta com a **arrel del vault**. Marcadors: `CLAUDE.md` o `.claude` (mode CLAUDE) i els equivalents GPT (p. ex. `AGENTS.md`); la llista viu en un mòdul pur fàcil d'ajustar, amb tests de detecció.
    - **Vault recursiu estil Obsidian**: el panell esquerre mostra l'arbre de subcarpetes (plegables); la resolució de wikilinks, els backlinks, la cerca global, els aliases i el quick switcher cobreixen tot el vault. Els wikilinks resolen per nom de fitxer a tot el vault, amb desambiguació per camí quan hi ha duplicats (com Obsidian).
    - Watcher recursiu sobre l'arrel del vault (ampliació mínima del costat Rust: el mode recursiu del watcher existent).
    - Títol de finestra «vault - fitxer» (nom de l'arrel del vault en comptes de la carpeta immediata).
    - Fora del mode (cap marcador present), **res no canvia**: carpeta plana, no recursiva, com fins ara. Mai s'escriu cap fitxer de configuració ni d'índex dins del vault.

## Convencions

Les mateixes de `SPEC.md` i `SPEC2.md`: TypeScript estricte, conventional commits en anglès, lògica en mòduls purs amb Vitest, Rust mínim, tests dual-mode per a cada canvi de parser, i schema + modal + i18n ×3 per a cada setting nou, sempre al mateix PR.

## Primer pas concret

Executa el milestone 24 sencer en un sol PR: l'exportació a PDF és autònoma, reutilitza el pipeline de lectura existent i dona valor immediat sense tocar cap invariant.
