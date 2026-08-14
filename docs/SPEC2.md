# Fase 2 — Quasidian

La fase 1 (milestones 1–11 de `SPEC.md`) està completa. Aquest document defineix la fase 2: millores sorgides de l'ús real de l'aplicació, recollides a `Quasidian improvements.md` amb captures d'Obsidian com a referència visual. L'objectiu segueix sent el mateix: acostar l'aparença i el comportament als d'Obsidian sense perdre el minimalisme.

Llegeix `SPEC.md` abans de començar: tot el que hi diu segueix vigent excepte on aquest document ho ampliï.

## Invariants (no els canviïs)

- **Un sol parser**: tota funcionalitat nova de sintaxi (frontmatter, footnotes, callouts) s'implementa com a extensió `MarkdownConfig` del parser Lezer compartit (`src/markdown/parser.ts`). Mai un segon parser de markdown; el mode lectura sempre renderitza des del mateix arbre.
- **Carpeta = vault implícit, no recursiu**. La fase 2 no ho toca; els modes multicarpeta són fase 3.
- **Tot text d'UI per `t(key)`** (ca, es, en) i **tot color per variable CSS**. Cap string ni color hardcodejat, tampoc als menús, barres i widgets nous.
- **Rust mínim**: només comandes de filesystem i watcher. Les comandes noves d'aquesta fase (p. ex. `rename_file`) han de ser operacions de fitxer d'una sola responsabilitat, sense lògica de negoci.
- **Mòduls purs + Vitest**: la lògica nova (parsing de frontmatter, model de pestanyes, outline) va a mòduls sense Tauri ni DOM, amb tests unitaris.
- **Cada canvi al parser porta tests dual-mode**: decoracions d'edició i HTML de lectura, perquè els dos modes no discrepin mai.
- **Cada opció nova de settings** amplia l'schema tipat + defaults + modal + claus i18n als tres idiomes, al mateix PR.

## Fora d'abast de la fase 2 (queda per a la fase 3)

- **Vistes dividides i docking**: particions del panell central, arrossegar pestanyes entre particions.
- **Múltiples instàncies d'un mateix fitxer** (obert en més d'una pestanya alhora) i **finestres noves**.
- **Modes multicarpeta (CLAUDE/GPT)**: vault recursiu activat automàticament quan la carpeta conté `CLAUDE.md` o `.claude` (o penja d'una que en té), comportament de vault d'Obsidian, títol «vault - fitxer». És un canvi de l'invariant «no recursiu» i es farà en una fase dedicada.
- **Exportar a PDF** des del menú contextual del fitxer (fase 3).
- Segueix fora d'abast permanent: graph view, plugins, sync, publish, WYSIWYG de model de document, vim mode (només el forat a settings).

## Milestones (implementa'ls en ordre, un PR per milestone)

12. **Quick wins d'edició i finestra**:
    - Tab a l'editor indenta (llistes) o insereix la indentació configurada; mai treu el focus de l'editor (`indentWithTab`; respecta el setting espais/tabs existent).
    - Setext headings només amb **3 o més** guions: avui una línia amb un sol `-` sota un paràgraf el converteix en H2 (comportament per defecte de Lezer). Extensió que ho restringeixi, amb tests dual-mode.
    - Títol de finestra «nom de la carpeta - nom del fitxer» (no «Quasidian»), actualitzat en obrir cada fitxer. Cal el permís `core:window:allow-set-title` a les capabilities de Tauri.
    - Botó **X** per tancar el modal de settings (a més d'Escape i clic fora).
    - Barra inferior completa: backlinks del fitxer obert, paraules, caràcters, mode edició/lectura (paraules i mode ja hi són).
    - Botó de copiar el contingut als code blocks del mode lectura (l'etiqueta del llenguatge ja hi és).
13. **Tema i tipografia**:
    - Text blanc (`--text-normal` blanc suau, no el crema actual), enllaços liles i selecció amb fons lila: `--text-accent` i `--text-selection` derivats del color d'accent configurable. Els enllaços van subratllats sempre (el hover només aclareix el color).
    - Línies horitzontals `---` i vores de taula més visibles/brillants, amb variable pròpia (p. ex. `--hr-color`) per no apujar `--background-modifier-border`, que comparteix tot el chrome.
    - Headings amb lletra més grossa i més espai vertical, sobretot a sobre (escala tipus Obsidian: h1 ~1.8em … h6 1em). En mode edició cal decoració de línia per nivell (l'estil actual només afecta el text, no la línia); el mode lectura ha de quedar mirall.
    - Llistes iguals als dos modes, estil Obsidian: el guió/número només es mostra quan el cursor el toca (no amb tota la línia activa); la resta del temps, bullet — més gran i més indentat (no arran de text). Sagnat penjant: les línies embolcallades s'alineen amb la primera lletra, no amb el guió; igual per a numeracions. Línies verticals de guia per a cada nivell de niuament. Tasques completades amb el text ratllat i esmorteït.
    - Comportament d'edició de llistes: Tab inicia un nou nivell (les numerades recomencen per 1.), Shift+Tab retorna l'ítem al nivell anterior, i Enter en un ítem buit retrocedeix un nivell (o surt a text pla si és al primer). Les llistes numerades es renumeren automàticament a cada canvi estructural.
14. **Icones i identitat**:
    - Substituir els emojis de botons (`📖 ✎ 🔗 ⚙ ×`) per icones SVG inline estil lucide (les d'Obsidian), a totes les barres i botons presents i futurs.
    - Icona pròpia de l'aplicació (substituir les icones stock de Tauri a `src-tauri/icons/` amb `tauri icon`).
15. **Auto-pair i envoltar la selecció**:
    - Amb text seleccionat, teclejar `(`, `[`, `{`, `"`, `*`, `==`, `$` envolta la selecció amb el parell corresponent en lloc de substituir-la.
    - Auto-pair en escriure (tancament automàtic de parèntesis/claudàtors i de sintaxi markdown), amb **dos settings nous**: habilitar/deshabilitar auto-pair de brackets i auto-pair de sintaxi markdown.
16. **Barres i panells**:
    - Tres barres superiors, una per panell: **esquerra** (fitxers, cerca, obrir una altra carpeta/fitxer), **central** (col·lapsar panell esquerre, nom del fitxer centrat, col·lapsar panell dret; aquí aterrarà la barra de pestanyes al milestone 23), **dreta** (commutar backlinks / enllaços sortints / outline).
    - Panell dret multi-vista: backlinks (existent), enllaços sortints del fitxer obert, i outline de headings navegable (clic → desplaçar-s'hi).
    - Botó d'obrir amb símbol i tooltip per obrir una altra carpeta (especificant o no un fitxer concret): picker de directori a més del picker de fitxer actual.
    - Els panells esquerre i dret es poden col·lapsar i restaurar.
17. **Plegat de seccions**: col·lapsar/expandir per heading (xebró al marge en fer hover, com Obsidian), a partir de l'estructura de l'arbre Lezer; estat de plegat en memòria per fitxer; comandes de plegar/desplegar tot a la paleta.
18. **Menús contextuals** (component propi estil Obsidian, res del menú natiu del WebView):
    - Sobre un fitxer (llista lateral i capçalera): canviar nom, eliminar (amb la confirmació configurada), copiar camí (relatiu/absolut), obrir amb l'aplicació per defecte, mostrar a l'explorador del sistema. Nova comanda Rust `rename_file`.
    - Sobre el text de l'editor: tallar/copiar/enganxar, enganxar sense format, seleccionar-ho tot, afegir enllaç, submenú de format (negreta, cursiva, highlight, codi).
    - Els ítems que depenen de pestanyes o splits (tancar altres, split right…) s'afegiran quan existeixin.
    - Barra inferior: botons amb icona per a la paleta de comandes i el quick switcher, i el botó de settings s'hi trasllada des de la barra lateral.
19. **Propietats YAML**:
    - Frontmatter `---` a l'inici del document com a extensió Lezer pròpia (i que el `---` de tancament no creï mai setext/HR falsos).
    - Parsing del subconjunt YAML necessari (tags, aliases, escalars) en un mòdul pur amb tests. No és un parser de markdown.
    - Widget «Properties» estil Obsidian en mode edició (pills de tags, aliases, «Add property»); el YAML cru només es veu amb el cursor dins, com la resta de sintaxi. Render equivalent en mode lectura.
    - Els **aliases** es fan servir per resoldre wikilinks i al quick switcher; els **tags** són cercables a la cerca global.
20. **Wikilinks avançats**:
    - Els links sense referència (la nota no existeix) es mostren amb un to apagat i sense subratllat, tant en mode edició com en lectura.
    - Àncores de secció: `[[nota#secció]]` i `[[#secció]]` (mateix fitxer) resolen contra els headings de la nota, naveguen fins a la secció i s'autocompleten en teclejar `#` dins del wikilink.
    - Transclusió amb profunditat > 1: un `![[nota]]` que conté altres transclusions les renderitza recursivament, amb detecció de cicles i un límit de profunditat raonable. També transclusió de seccions: `![[nota#secció]]`.
    - Finestra emergent de previsualització: en mode lectura, fer hover sobre un wikilink mostra el contingut de la nota (o de la secció, si el link porta àncora) en un popup; en mode edició, el mateix amb Ctrl+hover. El popup es renderitza amb el mateix pipeline de lectura (mateix arbre Lezer).
21. **Taules**:
    - Respectar l'alineació de columnes del delimitador GFM (`:---`, `:---:`, `---:`), que avui s'ignora al render.
    - Facilitar l'edició: Tab/Shift-Tab per moure's entre cel·les, comandes per afegir/eliminar/moure files i columnes i fixar l'alineació, accessibles des de la paleta i el menú contextual.
22. **Footnotes i callouts**:
    - Footnotes `[^1]` (referència i definició) com a extensió Lezer pròpia, amb Live Preview i mode lectura (retorn a la referència inclòs).
    - Callouts `> [!nota] Títol` sobre el node de blockquote, amb els tipus bàsics d'Obsidian (note, info, tip, warning, error…), color per variable CSS (hi ha un stub `.callout` reservat a `theme.css`) i render als dos modes.
23. **Pestanyes**:
    - El workspace passa d'un sol fitxer obert a una llista de pestanyes amb estat per pestanya (fitxer, mode edició/lectura, scroll, plegat). Un únic editor reutilitzat en canviar de pestanya activa és suficient.
    - Barra de pestanyes a la barra central del milestone 16: tancar, tancar altres, tancar totes, fixar (pin), reordenar arrossegant, menú contextual de pestanya.
    - Obertura estil Obsidian: navegar (wikilink, switcher, llista de fitxers) reutilitza la pestanya activa; Ctrl+clic obre pestanya nova.
    - **Instància única**: obrir un `.md` des del sistema (doble clic, línia de comandes) quan l'app ja corre l'obre en una pestanya nova de la finestra existent, no en una finestra nova (plugin single-instance de Tauri; el reenviament de l'argument és l'única lògica al costat Rust).
    - **Persistència de finestra**: en engegar, l'app recorda l'última posició, mida, pantalla i estat maximitzat.
    - **Persistència de sessió**: es restauren els fitxers oberts, la pestanya activa i el mode de cadascun, **excepte** quan l'app s'obre amb un fitxer per paràmetre (doble clic a un `.md`). Controlat per un setting nou (per defecte activat), amb schema + modal + i18n com sempre.
    - **Reordenació de la barra del fitxer**: el botó de col·lapsar el panell dret es mou al costat de les pestanyes; la barra del fitxer conserva el commutador de mode i incorpora una icona de **tres punts** que desplega el menú contextual del fitxer.

## Convencions

Les mateixes de `SPEC.md`: TypeScript estricte, conventional commits en anglès, lògica en mòduls purs amb Vitest, Rust mínim. I les d'aquest document: tests dual-mode per a cada canvi de parser, i schema + modal + i18n ×3 per a cada setting nou, sempre al mateix PR.

## Primer pas concret

Executa el milestone 12 sencer en un sol PR: són sis canvis petits i independents que milloren l'ús diari immediatament.
