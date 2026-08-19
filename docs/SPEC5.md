# Fase 5 — Quasidian

Les fases 1–4 (`SPEC.md` 1–11, `SPEC2.md` 12–23, `SPEC3.md` 24–29, `SPEC4.md` 30–34) estan completes: l'app és funcional, trilingüe, amb sessions per vault, releases automatitzades i comprovació d'actualitzacions. Aquest document defineix la fase 5: la **publicació del repositori com a codi disponible públicament** sota l'organització **AIS Vision Systems**, amb doble llicència (no comercial + comercial), governança de contribucions, i les releases i la comprovació d'actualitzacions apuntant al mateix repo públic — cosa que permet retirar el repo de distribució separat (`Quasidian-releases`), que només existia perquè el repo de codi era privat (vegeu `SPEC4.md`, milestone 34).

Llegeix els quatre SPECs anteriors abans de començar: tot el que hi diu segueix vigent excepte on aquest document ho ampliï o esmeni.

## Invariants (no els canviïs)

- **Un sol parser**, **carpeta = vault implícit**, **mai fitxers de config dins dels vaults**, **tot text d'UI per `t(key)`** (ca, es, en), **tot color per variable CSS**, **Rust mínim**, **mòduls purs + Vitest**: tots els invariants de les fases anteriors continuen.
- **Mai cap token ni secret al binari ni al repo**: l'update check només fa lectures públiques; l'escriptura la fa la CI amb el token efímer del workflow.
- **La carpeta `test/` i qualsevol material personal queden fora del repo** (`.gitignore`); res del que es publiqui pot contenir dades personals o d'empresa no volgudes.
- **Els SPECs són documents històrics**: no es reescriuen per adaptar-los al present (p. ex. `SPEC.md` diu «privat de moment»); el README és la font pública de veritat.

## Decisions de llicència i governança

- **Doble llicència**: **PolyForm Noncommercial 1.0.0** (gratuïta per a ús no comercial; text oficial verbatim) + **llicència comercial** atorgada per AIS Vision Systems. Titular del copyright: **AIS Vision Systems**. No és open source segons l'OSI — és *source-available*; el README ho comunica amb precisió.
- **CLA obligatori**: les contribucions externes s'accepten només sota un Contributor License Agreement que permet a AIS Vision Systems distribuir-les sota les dues llicències. Sense CLA no hi ha via comercial viable per a codi de tercers.
- **Tot per PR**: `main` no accepta pushos directes de ningú (ni de l'administrador); CODEOWNERS = @XaviAnguera i el merge requereix la seva review (l'admin pot mergear els seus propis PRs via bypass «pull requests only», perquè GitHub no permet auto-aprovar-se).
- **Limitació assumida**: en un repo públic no es pot impedir que qualsevol faci fork i obri PRs; el control és sobre qui mergeja i sobre l'execució de workflows de forks (aprovació manual).

## Milestone (un de sol, executat en dos PRs + operacions)

35. **Publicació open source**:
    - **PR A — llicència, governança i README**: `LICENSE.md` (resum dual + PolyForm NC 1.0.0 verbatim), `LICENSE-COMMERCIAL.md` (contacte AIS Vision Systems), `CLA.md`, `CONTRIBUTING.md` (regles d'arquitectura destil·lades de `CLAUDE.md`, conventional commits, CLA), `SECURITY.md` (reporting privat), `.github/CODEOWNERS` (`* @XaviAnguera`), plantilla de PR amb checkbox de CLA, i workflow `ci.yml` (typecheck + Vitest a cada PR; serà required status check). Metadades: `license`/`author`/`repository` a `package.json`, `license-file`/`repository` a `Cargo.toml`, `publisher`/`copyright` a `tauri.conf.json`. README públic **en anglès** amb traduccions **`README.ca.md` i `README.es.md`** enllaçades: funcionalitats, descàrrega (releases del mateix repo), llicència, contribució, i full de ruta que esmenta l'evolució cap a un **visor/editor de markdown integrable en aplicacions web** (el nucli ja és TS pur sense Tauri ni DOM).
    - **PR B — releases al mateix repo i update check per l'API de GitHub**: el `latest.json` desapareix. L'update check (`src/ipc/updates.ts`) passa a consultar `https://api.github.com/repos/AIS-Vision-Systems/Quasidian/releases/latest` (CORS verificat: `api.github.com` envia `Access-Control-Allow-Origin: *`; la redirecció de `releases/latest/download/...` no, per això no serveix un asset). El parser del mòdul pur (`src/lib/updates.ts`) llegeix `tag_name`/`html_url`/`body` mantenint `LatestInfo` i `UpdateCheck` idèntics perquè la UI no canviï; tests actualitzats. El workflow `release.yml` es reestructura en 3 jobs amb `GITHUB_TOKEN` (`permissions: contents: write`), sense `RELEASES_TOKEN` ni `DIST_REPO`: (1) crear la release **en esborrany** (guard de coherència tag↔versió), (2) matriu Windows/Ubuntu que compila i puja instal·ladors, (3) publicar l'esborrany — `releases/latest` no anuncia la versió fins que tots els instal·ladors hi són, la mateixa garantia que donava el `publish-feed`. A més, la pàgina de crèdits mostra el **logo d'AIS Vision Systems** (variant blava en tema clar, blanca en fosc, assets a `src/assets/`), «An AIS Vision Systems application», el crèdit «Idea and original development: Xavi Anguera», i la línia de llicència amb enllaç al `LICENSE.md` públic (opener existent) — tot amb i18n ×3.
    - **Operacions GitHub** (fora del codi): ruleset de `main` (PR obligatori, review de code owner, status check `test`, bypass d'admin només per a PRs), ruleset de tags `v*` (només admins), `delete branch on merge`, aprovació manual de workflows de contribuïdors externs, permís per defecte de l'org de `write` a `read`, flip a **públic**, i activar secret scanning + push protection + Dependabot alerts.
    - **Migració de les instal·lacions existents**: release **v1.0.1** al repo nou (bump als tres fitxers + lockfiles, tag) i **última actualització** del `latest.json` del repo antic apuntant-hi, perquè les v1.0.0 instal·lades vegin l'avís. El repo `Quasidian-releases` s'esborra al cap d'unes setmanes, juntament amb la revocació del PAT `RELEASES_TOKEN`.

## Convencions

Les mateixes de sempre: TypeScript estricte, conventional commits en anglès, lògica en mòduls purs amb Vitest, Rust mínim, i18n ×3 al mateix PR.

## Futur (fora d'abast d'aquesta fase)

- `tauri-plugin-updater` amb artefactes signats (el «futur» del milestone 34 continua pendent: ara el repo és públic, falta la signatura).
- Paquet embeddable del nucli (visor/editor markdown per a web): requereix la seva pròpia fase amb spec.
- CSP acotada i revisió de `assetProtocol.scope` — esperable com a issue extern un cop públic.
