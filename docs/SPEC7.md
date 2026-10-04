# Fase 7 — Quasidian

Les fases 1–6 (`SPEC.md` 1–11, `SPEC2.md` 12–23, `SPEC3.md` 24–29, `SPEC4.md` 30–34, `SPEC5.md` 35, `SPEC6.md` 36–43) estan completes: l'app és pública (v1.0.2), amb el nucli publicat com a `@aisvision/quasidian-core`, CSP acotada i actualitzacions signades. Aquest document defineix la fase 7, que surt de l'ús diari de la v1.0.2: **tres bugs del Live Preview** (taules que queden sense renderitzar, saltets espontanis i format que no es veu dins les cel·les), **enllaços markdown amb espais**, **poliment del panell esquerre, la tipografia de la interfície i les pestanyes**, **canviar el nom des d'un enllaç**, i **inserir fitxers enganxant-los o arrossegant-los**.

Llegeix els sis SPECs anteriors abans de començar: tot el que hi diu segueix vigent excepte on aquest document ho ampliï o esmeni.

## Invariants (no els canviïs)

- **Un sol parser**: els enllaços amb espais (milestone 47) són **una extensió inline de Lezer** registrada a `parser.ts`, mai un segon parser ni un preprocés de text; el format de les cel·les (46) es renderitza des del mateix arbre que fa servir el mode lectura.
- **Carpeta = vault implícit** (pla, o recursiu pels marcadors). **Mai fitxers de configuració ni d'índex dins dels vaults.** L'única escriptura nova en carpetes de notes són els fitxers que **l'usuari** hi enganxa o hi arrossega (51) — contingut seu, mai estat de l'app — i **mai sobreescrivint** un fitxer existent.
- **Tot text d'UI per `t(key)`** (ca, es, en) i **tot color per variable CSS**.
- **Rust mínim**: l'única comanda nova de la fase és `write_binary_file` (51), d'una sola responsabilitat i sense lògica de negoci.
- **Mòduls purs + Vitest**: la lògica nova (diff mínim de document, memòria cau d'alçades, edició de cel·les, destinació d'enllaços, noms d'adjunts, punt d'inserció) va a mòduls o funcions testables amb tests unitaris.
- **Cada canvi al parser o a les decoracions dual-mode porta tests** dels dos modes; **cada setting nou** amplia schema tipat + defaults + modal + i18n ×3 al mateix PR.
- **Una sola font de veritat per al nucli**: el paquet no importa mai res de l'app. El nucli només guanya **hooks opcionals** i mètodes del handle de l'editor; cap cadena nova ni cap dependència nova.
- **El mode lectura segueix sent només lectura** (tret de les caselles de tasca): canviar el nom d'un fitxer des d'un enllaç (50) és una operació de fitxer, no una edició del contingut.

## Fora d'abast permanent

- Graph view, sistema de plugins, sync, publish.
- WYSIWYG de model de document (l'edició és sempre text pla).
- Vim mode (només el forat a settings).

## Fora d'abast d'aquesta fase

- **Renderització de Mermaid (`graph TD`)**: **ajornada** a una fase posterior pel pes que afegeix a un editor minimalista. No s'ha de confondre amb el graph view de notes, que segueix exclòs per sempre: Mermaid és el render d'un bloc de codi.
- Resolució local d'imatges markdown `![](camí)` (no es renderitzen en edició ni es resolen en lectura): per això tota referència que insereix l'app és `![[nom]]`.
- Un setting de carpeta d'adjunts: els fitxers enganxats o arrossegats van sempre a la carpeta de la nota.
- Arrossegar **carpetes**, multiselecció, arrossegar entre finestres i deixar anar sobre la barra de pestanyes.
- Conservar els finals de línia CRLF en desar (CodeMirror normalitza a LF, com fins ara) i recarregar canvis externs en panes no actius.

## Milestones (implementa'ls en ordre, un PR per milestone)

44. **Arbre sintàctic complet i recàrrega mínima** (bug):
    - **Símptomes**: de vegades, en obrir un fitxer, les taules es mostren sense renderitzar (barres verticals crues); canviar a lectura i tornar a edició les arregla, però al cap d'una estona es tornen a esguerrar. De tant en tant el text fa saltets sense cap interacció.
    - **Causa de les taules**: `buildBlockDecorations` (`packages/core/src/editor/livePreview.ts`) crida `ensureSyntaxTree` però **en descarta el resultat** i itera `syntaxTree(state)`, que és l'arbre congelat en crear l'estat (uns 3000 caràcters analitzats); i el `StateField` de decoracions de bloc només es reconstrueix amb canvis de document, de selecció o l'efecte `refreshBlockDecorations`, mai quan l'analitzador acaba en segon pla. Fix: iterar l'arbre que retorna `ensureSyntaxTree` (amb `syntaxTree(state)` de reserva) — `computeMathRanges` rep l'arbre per paràmetre — i reconstruir també quan canvia la identitat de l'arbre; la decisió va a un predicat pur exportat (`blockRebuildNeeded`) amb test.
    - **Títol inline per editor**: avui és una variable de mòdul que cada canvi de pane reescriu. Amb el disparador nou, un pane que es reconstrueix en segon pla pintaria el títol d'un altre: el títol passa a ser estat de cada editor (`StateField` + efecte, i `setInlineTitle` al handle de l'editor). La funció exportada actual es manté com a valor per defecte perquè la demo no canviï.
    - **Recàrrega mínima**: `reloadDoc` substitueix avui el document sencer, cosa que llença els fragments de l'arbre i les alçades mesurades — per això les taules «es tornen a esguerrar». Mòdul pur nou `docDiff.ts` (`normalizeLineEndings`, `minimalChange` per prefix i sufix comuns, sense partir mai un parell subrogat) i `reloadDoc` despatxa només el rang canviat; retorna si ha canviat res. Això cobreix també el mirall entre panes bessons i el repunt d'enllaços en canviar un nom.
    - **Recàrregues espúries i cursa**: `maybeReloadOpenFile` (`src/ui/layout.ts`) compara el disc amb el document sense normalitzar finals de línia, de manera que una nota CRLF oberta i no editada es recarrega sencera a cada esdeveniment del watcher; i comprova els canvis pendents **abans** de l'`await` de lectura. Fix: comparar normalitzat; capturar pane i camí abans de l'`await` i abandonar si han canviat o si mentrestant hi ha edicions pendents (mai carregar el contingut d'un fitxer al buffer d'un altre); en mode edició, treure el re-ancoratge manual del scroll, que amb el canvi mínim ja no cal i és ell mateix una font de saltets.
    - **No desfacis res del milestone 36**: `scrollPastEnd()`, el `resizeAnchor` amb el seu `ResizeObserver`, la sembra de la memòria cau d'embeds i `ImageWidget.estimatedHeight` es queden.
    - **Criteris d'acceptació**: una nota amb una taula (i un bloc `$$` multilínia) després de més de 3000 caràcters les mostra renderitzades en obrir-la, sense tocar res — amb test que **no** pre-analitza el document, a `livePreview.test.ts`, i el mateix document a `render.test.ts`; una nota CRLF oberta no es recarrega quan canvia un altre fitxer de la carpeta. Provat a Windows i Ubuntu (watcher i finals de línia).

45. **Alçades estables dels widgets de bloc** (bug):
    - **Diagnostica primer** què queda dels saltets un cop fusionat el 44 (traça temporal de canvis de scroll sense entrada de l'usuari; no s'envia).
    - **Alçades estimades**: CM6 estima en **una línia** qualsevol widget de bloc sense `estimatedHeight`, i avui només el té `ImageWidget`. Mòdul pur nou `widgetHeightCache.ts` (memòria cau acotada d'alçades mesurades per clau de contingut, i una estimació de taula per nombre de files) alimentat per un `ResizeObserver` compartit; `estimatedHeight` per a la taula, el bloc de fórmula, les propietats, el títol inline i l'embed de nota.
    - **Widgets que no es reconstrueixen per res**: `TableWidget.eq` i `MathWidget.eq` inclouen la posició, de manera que cada tecla per sobre d'una taula en reconstrueix tot el DOM. Treu la posició de la igualtat i resol-la quan calgui amb `posAtDOM`, comprovant abans de despatxar que el document encara conté la font del widget (una clausura caducada mai pot corrompre una taula).
    - **Embeds de nota**: el refresc en calent substitueix avui l'HTML per un de nou amb els embeds interiors per omplir, i l'alçada s'encongeix i torna a créixer. Construeix el contingut nou fora del document i substitueix-lo només si difereix.
    - **Criteris d'acceptació**: cap desplaçament visible del text en repòs ni en escriure per sobre d'una taula, una fórmula o un embed; tests del mòdul de memòria cau i de la igualtat dels widgets.

46. **Format inline dins les cel·les de taula** (bug):
    - **Causa**: el widget de taula del mode edició omple cada cel·la amb `textContent`, de manera que `**negreta**`, `*cursiva*`, codi, wikilinks, enllaços i fórmules es veuen com a font crua; el mode lectura sí que els renderitza.
    - **Un sol camí de render**: `render.ts` exporta `renderTableCells(source)` — el mateix `renderInline` sobre els nodes `TableCell` que fa servir el mode lectura — i el widget el fa servir. Els dos modes no poden divergir.
    - **Cicle de la cel·la**: sense focus mostra l'HTML renderitzat; en rebre el focus (clic, Tab, Enter, fletxes) passa a la font crua, editable com fins ara; en perdre'l sense canvis es torna a renderitzar. En entrar en edició es fixen l'amplada mínima i l'alçada perquè la taula no s'encongeixi. Un clic sobre un enllaç d'una cel·la sense focus navega, com a la resta del Live Preview.
    - **Seguretat del commit**: `sanitizeCell` i un `applyCellEdit` pur passen a `tableCommands.ts`; el text d'una cel·la només es confirma si la cel·la és en estat d'edició — mai es desa text renderitzat com a font.
    - Tests: `render.test.ts` (negreta, cursiva, codi, ressaltat, ratllat, wikilink, enllaç, fórmula, barra escapada, cel·la buida, files curtes; i que surten iguals dins de `renderToHtml`) i `tableCommands.test.ts`. Els embeds de nota dins d'una cel·la es queden com a marcador.

47. **Enllaços markdown amb espais a la destinació**:
    - **Problema**: `[exemple](docs/Exemple.md#Secció primera)` es trenca perquè CommonMark talla la destinació al primer espai. La forma `[x](<docs/Exemple.md#Secció primera>)`, vàlida a CommonMark, tampoc funciona perquè ningú en treu els angles.
    - **Extensió** nova `packages/core/src/markdown/links.ts`, registrada a `parser.ts` amb el patró de `wikilinks.ts` (`parseInline` abans de `Link`). **Regla d'acceptació**: `]` a la mateixa línia seguit de `(`, i `)` equilibrat a la mateixa línia; s'accepta **només** si la destinació conté espais, no encaixa amb la gramàtica estàndard (destinació nua o entre angles amb títol opcional entre cometes o parèntesis) i no és externa. En qualsevol altre cas l'extensió es retira i s'aplica l'anàlisi estàndard, que no canvia. Emet els noms de node estàndard (`Link`, `LinkMark`, `URL`, `LinkTitle`), de manera que el Live Preview, els clics i el render no canvien d'estructura. Les imatges `![](…)` no reben aquesta permissivitat.
    - **Destinació compartida**: un helper `linkDestination` treu els angles i descodifica amb seguretat; l'usen el render de lectura, el clic de l'editor i l'extracció de destinacions de l'índex de backlinks.
    - Tests dual-mode: `links.test.ts` (nodes i posicions; paritat exacta amb l'anàlisi estàndard per a títols, forma amb angles, imatges, URL externes, enllaços sense tancar, escapats, de referència, dins de codi i wikilinks), `render.test.ts`, `livePreview.test.ts` (rangs amagats amb el cursor fora i dins) i `backlinkIndex.test.ts`.

48. **Panell esquerre i tipografia de la interfície**:
    - **Bug del ressaltat**: el fitxer marcat a l'arbre no segueix el focus — `is-active` només es calcula en reconstruir la llista, i ni canviar de pane ni canviar de pestanya la reconstrueixen. Les files porten el camí (`data-path`) i una funció barata (`syncTreeActive`) actualitza la classe en canviar el pane actiu, la pestanya activa o la llista. El fitxer ressaltat és sempre el del pane actiu.
    - **Setting «Mida de la font de la interfície»** (`appearance.interfaceFontSize`, per defecte **16**, rang 10–24): governa el text de tots dos panells i de totes les barres (arbre, cerca, esquema, backlinks, pestanyes, títol de la vista, barra d'estat), que avui barregen la mida de l'editor (18) amb 12 px. Una variable `--font-ui-size` i un interlineat comú `--line-height-ui`, definits a l'app (el tema del nucli no té panells). Aplicació en calent. Schema + defaults + modal + i18n ×3 al mateix PR.
    - **Arbre més compacte**: menys farciment vertical a les files i sense separació entre elles.

49. **Pestanyes que s'encongeixen**:
    - Quan no hi caben totes, les pestanyes **redueixen l'amplada** fins a un mínim (avui es perden per la dreta amb la barra de desplaçament amagada); la pestanya activa no s'encongeix. El botó de tancar de les inactives deixa de reservar espai i apareix superposat en passar-hi el ratolí.
    - Si encara no hi caben al mínim: la barra conserva el desplaçament en redibuixar-se, la pestanya activa es porta sempre a la vista i la roda vertical desplaça la barra horitzontalment. Arrossegar pestanyes no canvia.

50. **«Canvia el nom…» des d'un enllaç**:
    - Clic dret sobre un wikilink, un embed o un enllaç markdown intern: el menú contextual ofereix **«Canvia el nom…»**, que canvia el nom del **fitxer enllaçat** amb el flux existent (`renameFromMenu` → `relocateFile`: fitxer, pestanyes, enllaços i índex).
    - **Hook opcional** `linkMenuItems(link)` a l'editor i al visor: el nucli pregunta quines entrades afegir i l'app hi retorna la seva, amb `t("menu.rename")` — el nucli no guanya cap cadena ni coneix cap fitxer. En edició les entrades s'anteposen al menú del text; els widgets d'imatge i d'embed de nota hi responen també; en lectura, un menú només amb aquestes entrades sobre els enllaços interns. La cerca de l'enllaç sota el cursor passa a un mòdul pur (`linkAt.ts`) amb test.
    - **Casos**: cap entrada per a enllaços no resolts, externs o només d'encapçalament (`[[#secció]]`); `[[nota#secció]]` canvia el nom de `nota` i conserva l'àncora; un embed d'imatge canvia el nom de la imatge conservant-ne l'extensió.
    - **`renameLinkTargets` reescriu també els enllaços markdown** (avui només wikilinks i embeds), conservant el prefix de carpeta, l'àncora i l'estil de codificació — si no, l'enllaç sobre el qual s'acaba de fer clic quedaria trencat. Tests a `renameLinks.test.ts`.

51. **Enganxar o arrossegar fitxers de fora cap a una nota**:
    - **Tipus admesos** (de moment): `.md` i imatges. La resta es rebutja amb un missatge i18n i no es copia res.
    - **Enganxar una imatge**: es desa a la **carpeta de la nota** amb un nom generat (clau i18n + data i hora) i s'insereix `![[nom]]` al punt d'inserció. Cal la comanda Rust nova **`write_binary_file(path, contents)`** — les d'escriptura existents són de text i corromprien binaris —, que falla si el destí existeix. L'editor rep el hook opcional `onPasteFiles`, cridat només quan el porta-retalls porta fitxers i no text (el text sempre guanya).
    - **Arrossegar des del sistema**: es manté l'arrossegament natiu de Tauri (dona camins reals) amb un wrapper a `src/ipc/`; un fitxer de fora es **copia** amb `copy_file` a la carpeta de la nota amb el primer nom lliure, i un que ja és dins la carpeta o el vault només s'insereix. Rep el fitxer el pane sota el punter, en mode edició i amb una nota oberta; s'insereix `![[nom]]` on es deixa anar. Mode lectura, pestanyes d'imatge i pestanyes buides el rebutgen amb un missatge.
    - **API d'inserció compartida** amb el milestone 52 al handle de l'editor: inserir text en un punt de pantalla (o al cursor) i mostrar el cursor de destinació; un helper pur treu el punt d'inserció de dins del frontmatter i de les taules.
    - Mòdul pur nou `src/lib/attachments.ts` amb tests: tipus admesos, extensió per tipus MIME, nom de la imatge enganxada, primer nom lliure, conversió de coordenades físiques a punts de client, i destinació de l'embed (nom sol, o camí relatiu al vault quan el nom sol resoldria a un altre fitxer). i18n ×3. Provat a Windows i Ubuntu (Rust, camins, coordenades amb escalat i imatges del porta-retalls).

52. **Arrossegar fitxers al panell esquerre**:
    - **Origen**: només les files de fitxer (notes i imatges); les carpetes no s'arrosseguen. Arrossegament **amb esdeveniments de ratolí**, com el de les pestanyes — l'HTML5 drag-and-drop queda interceptat per l'arrossegament natiu de Tauri —, en un helper compartit (`src/ui/pointerDrag.ts`: llindar, cancel·lació amb Escape, etiqueta fantasma).
    - **Deixar anar sobre una carpeta** (o sobre un fitxer: la seva carpeta; o sobre el fons de la llista: l'arrel) **mou** el fitxer amb el flux de «Mou el fitxer a…» del milestone 39 (`moveFileTo`): enllaços, pestanyes i sessió actualitzats, i el mateix error suau en col·lisió. Només en mode vault; sobre la mateixa carpeta no fa res.
    - **Deixar anar dins d'una nota oberta** en mode edició només **insereix `![[fitxer]]`** on es deixa anar — ni mou ni copia el fitxer —, amb l'API d'inserció del milestone 51. En mode pla aquesta és l'única destinació.
    - **Retorn visual** per variables CSS: fila d'origen atenuada, carpeta de destinació ressaltada, cursor de destinació a l'editor; una carpeta plegada es desplega en mantenir-s'hi a sobre, i el panell es desplaça prop de les vores.

## Convencions

Les mateixes de sempre: TypeScript estricte, conventional commits en anglès, lògica en mòduls purs amb Vitest, Rust mínim, tests dual-mode per a cada canvi de parser o de decoracions, i schema + modal + i18n ×3 per a cada setting nou, sempre al mateix PR.

## Primer pas concret

Executa el milestone 44 sencer en un sol PR, començant pel test de regressió que falla (una taula després de més de 3000 caràcters, sense pre-analitzar): és el bug que més afecta l'ús diari, elimina la causa principal dels saltets i deixa el camp de decoracions i la recàrrega en l'estat sobre el qual el 45 i el 46 treballen el mateix widget de taula sense reajustar res.
