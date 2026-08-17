# Fase 4 — Quasidian

Les fases 1 (`SPEC.md`, milestones 1–11), 2 (`SPEC2.md`, milestones 12–23) i 3 (`SPEC3.md`, milestones 24–29) estan completes: l'aplicació és un workspace amb pestanyes, particions, finestres, modes multicarpeta i persistència de sessió. Aquest document defineix la fase 4: la gestió de **sessions per vault** i l'**encaminament de finestres per vault**. Avui hi ha una sola sessió per finestra: obrir un fitxer d'un altre vault barreja les pestanyes de l'última sessió amb el fitxer nou. L'objectiu és que cada vault (o carpeta) recordi la seva pròpia sessió i que cada finestra pertanyi a un sol vault, com les finestres de vault d'Obsidian.

Llegeix `SPEC.md`, `SPEC2.md` i `SPEC3.md` abans de començar: tot el que hi diu segueix vigent excepte on aquest document ho ampliï o esmeni. La fase assumeix els fixos d'arrencada del PR #31 (obertura des del sistema dins del seu vault, restauració d'estat, entrada `.desktop` amb `%f`).

## Invariants (no els canviïs)

- **Un sol parser**: res d'aquesta fase no toca el pipeline de markdown.
- **Carpeta = vault implícit** (pla o recursiu segons els marcadors del milestone 29); l'**scope** d'un fitxer o carpeta és l'arrel del vault detectada per `detectVault`, o la carpeta immediata si no hi ha marcadors.
- **Mai barrejar vaults en una finestra per obertures explícites** (nou): doble clic des del sistema i diàlegs d'obrir fitxer/carpeta sempre acaben a la finestra del vault de destí (o una de nova). Seguir un enllaç cap a fora del vault continua obrint una pestanya al workspace actual, com fins ara, i **no** canvia la sessió de cap vault.
- **Mai fitxers de configuració ni d'índex dins dels vaults**: totes les sessions viuen a l'appConfigDir.
- **Tot text d'UI per `t(key)`** (ca, es, en) i **tot color per variable CSS**.
- **Rust mínim**: aquesta fase no hauria de necessitar cap canvi a Rust (events i finestres via l'API JS de Tauri).
- **Mòduls purs + Vitest**: claus d'scope, resolució d'scope, estat d'UI global i decisió d'encaminament van a mòduls sense Tauri ni DOM, amb tests unitaris.

## Fora d'abast permanent

- Graph view, sistema de plugins, sync, publish.
- WYSIWYG de model de document (l'edició és sempre text pla).
- Vim mode (només el forat a settings).

## Milestones (implementa'ls en ordre, un PR per milestone)

30. **Sessions per vault**:
    - **Scope i clau**: l'scope d'un fitxer és l'arrel del seu vault (marcadors, avantpassat més llunyà) o la seva carpeta; el d'una carpeta, ella mateixa o la seva arrel de vault. Clau canònica = camí normalitzat en minúscules (el mateix idioma que la comprovació `insideVault` existent). La lògica va a un mòdul pur nou (p. ex. `src/lib/vaultSession.ts`) amb `detectVault` reutilitzat via `contains` injectat, i tests.
    - **Emmagatzematge** a l'appConfigDir: un fitxer `vault-<hash>.json` per scope (hash curt sense dependències, p. ex. FNV-1a) amb el **format `SessionData` actual reutilitzat sense canvis** més un camp `scope` amb l'arrel original: en llegir, si el camp no correspon a la clau (col·lisió de hash, carpeta moguda), es tracta com a inexistent — mai es barregen sessions. A més, un `ui-state.json` global amb `{panels, rightView, lastVault}`.
    - **Home scope**: cada finestra té un scope de pertinença, fixat **només** per obertures explícites i per la restauració d'arrencada — mai per seguir enllaços ni canviar de pestanya. El desat de sessió (debounce i tancament) escriu sota el home scope; si és nul, només s'actualitza l'`ui-state` global. El panell lateral continua seguint el fitxer actiu com fins ara.
    - **Arrencada**: amb fitxer d'argument → es restaura la sessió del vault del fitxer i el fitxer s'obre (o se selecciona) al damunt; sense sessió prèvia, el fitxer sol. Sense argument → es restaura la sessió de `lastVault`. Mides de panells i vista del panell dret: les de la sessió del vault si n'hi ha; si no, les globals d'`ui-state.json`. Les pestanyes es restauren segons el setting `files.restoreSession` existent (actualitza'n la descripció ca/es/en: la sessió es recorda per vault).
    - **Migració única**: si no hi ha `ui-state.json` i existeixen els `session.json`/`session-*.json`/`last-window.json` antics, s'adopta la sessió de l'última finestra (regla actual), es desa sota el vault de la seva pestanya activa, s'escriu `ui-state.json` i s'esborren els fitxers antics. Mai es toca `settings.json`.

31. **Encaminament de finestres per vault**:
    - **Registre de finestres**: cada finestra publica el seu home scope a `localStorage` (compartit entre finestres del mateix origen) amb **una clau per finestra** `{key, root, focusedAt}` — cada finestra escriu només la seva (sense curses), l'esborra en tancar-se, i les lectures s'intersequen amb la llista de finestres vives (`getAllWebviewWindows`) per ignorar restes d'un tancament brusc. Amaga-ho rere un parell de funcions perquè, si alguna plataforma no compartís el `localStorage`, es pugui substituir per un handshake d'events sense tocar cap crida.
    - **Decisió d'encaminament** (funció pura amb tests): scope de destí igual al propi, o finestra encara sense scope → obrir **in situ** (adoptant l'scope si era nul); una altra finestra viva té l'scope → **focus** a aquella finestra (la de `focusedAt` més recent si n'hi ha més d'una) i event dirigit amb el destí; cap finestra → **finestra nova** que fa la restauració per-vault del milestone 30 (paràmetres de query nous, p. ex. `?vopen=<fitxer>` / `?vfolder=<carpeta>`; el `?open=` de «mou a una finestra nova» es manté, fixant el home scope del fitxer mogut).
    - **Receptor** a totes les finestres: per a un fitxer, si ja és obert en **qualsevol** partició se'n selecciona la pestanya (no només a la partició activa); si no, pestanya nova. Per a una carpeta, es refresca la vista sense destruir les pestanyes de la finestra de destí.
    - **Single-instance**: totes les finestres escolten l'event; el gestiona la d'etiqueta menor entre les vives (elecció determinista, «main» abans que «w*») — això cobreix també el cas actual de la finestra principal tancada amb secundàries obertes. El gestor aplica la mateixa decisió d'encaminament.
    - **Diàlegs** d'obrir fitxer i obrir carpeta passen per l'encaminament. Wikilinks, llista lateral, quick switcher i backlinks: sense canvis (obren in situ).
    - **Dues finestres al mateix scope** (via «mou a una finestra nova»): el desat de pestanyes el fa només la finestra amb `focusedAt` més recent entre les vives del mateix scope, perquè una finestra d'una sola pestanya no esclafi la sessió rica del vault.
    - Capabilities: afegeix `core:window:allow-unminimize` (la resta de permisos necessaris ja són dins `core:default`). Cap canvi a Rust: el plugin single-instance ja emet a totes les finestres.

## Convencions

Les mateixes de `SPEC.md`, `SPEC2.md` i `SPEC3.md`: TypeScript estricte, conventional commits en anglès, lògica en mòduls purs amb Vitest, Rust mínim, i schema + modal + i18n ×3 per a cada setting nou, sempre al mateix PR.

## Primer pas concret

Executa el milestone 30 sencer en un sol PR: les sessions per vault són útils per si soles (arrencada i finestra única) i deixen el terreny — scope, claus, `ui-state`, migració — perquè el milestone 31 només hi afegeixi l'encaminament.
