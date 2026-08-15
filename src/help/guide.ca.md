# Guia d'ús

## Carpetes i fitxers

Quasidian no té «vaults» ni configuració: **la carpeta del fitxer obert és el teu espai de treball**. Obre una carpeta o un fitxer `.md` amb els botons de la barra lateral; la llista mostra les notes de la carpeta (sense subcarpetes). Els enllaços, els backlinks i la cerca es resolen dins d'aquesta carpeta.

- **Cerca global**: `Ctrl+Maj+F` o la lupa de la barra lateral.
- **Quick switcher**: `Ctrl+O` — salta a qualsevol nota pel nom o pels seus àlies.
- **Paleta de comandes**: `Ctrl+P` — totes les accions disponibles.
- Clic dret sobre un fitxer: canviar el nom (els enllaços entrants es reapunten sols), copiar el camí, mostrar a l'explorador, exportar a PDF o eliminar.

## Modes d'edició i lectura

`Ctrl+E` commuta entre **edició** (Live Preview: la sintaxi s'amaga fora de la línia activa) i **lectura** (HTML renderitzat, només les caselles de tasca són interactives). El botó del llibre a la barra del fitxer fa el mateix.

## Enllaços i transclusions

- `[[nota]]` enllaça una nota; `[[nota|àlies]]` mostra un altre text; `[[nota#secció]]` salta a un heading.
- Clicar un enllaç l'obre (o **crea la nota** si no existeix). `Ctrl+clic` o clic del mig: pestanya nova.
- **Previsualització**: passa el ratolí per sobre d'un enllaç en mode lectura (o `Ctrl`+ratolí en edició) per veure el contingut en una finestra emergent.
- `![[nota]]` incrusta el contingut d'una altra nota (també `![[nota#secció]]` i imatges `![[imatge.png|500]]`).

## Propietats

Un bloc `---` a l'inici de la nota conté les propietats (tags, àlies…), editades sempre des del widget: afegeix, elimina o canvia valors amb els seus controls. Els **àlies** funcionen al switcher i als wikilinks; els **tags** són cercables.

## Format

- `Ctrl+B` negreta, `Ctrl+I` cursiva; també `==ressaltat==`, `~~ratllat~~`, `` `codi` `` i `$formula$` (KaTeX).
- **Llistes**: `- ` o `1. ` comencen una llista; `Tab`/`Maj+Tab` canvien el nivell (les numerades es renumeren soles); `- [ ]` crea una tasca.
- **Taules**: insereix-les des del menú contextual («Insereix ▸ Taula»). S'editen sempre per cel·les: `Tab`/fletxes per moure't, `Enter` per baixar, arrossega les nanses per moure files i columnes, clic dret per al menú complet.
- **Callouts**: `> [!note] Títol` crea una caixa acolorida (`warning`, `tip`, `check`, `danger`…). Amb `[!note]-` comença plegada; el xebró en commuta l'estat.
- **Footnotes**: `[^1]` amb la definició `[^1]: text`, o directes amb `^[text]`. En lectura es recullen al peu; el ratolí per sobre en mostra el contingut.

## Pestanyes

- Navegar reutilitza la pestanya activa; `Ctrl+clic` obre'n una de nova.
- `Ctrl+W` tanca; `Ctrl+Tab` / `Ctrl+Maj+Tab` cicla; arrossega per reordenar.
- Clic dret: tancar les altres, tancar-les totes o **fixar** (una pestanya fixada mai es reutilitza).
- En engegar, l'app restaura la sessió anterior (pestanyes, modes i finestra) — configurable als settings.

## Exportar a PDF

Al menú del fitxer (clic dret o botó de tres punts): «Exporta a PDF». La nota s'imprimeix tal com es veu en mode lectura, amb fons blanc i el nom de la nota com a títol.

## Dreceres principals

| Drecera | Acció |
| --- | --- |
| `Ctrl+P` | Paleta de comandes |
| `Ctrl+O` | Quick switcher |
| `Ctrl+E` | Mode edició/lectura |
| `Ctrl+S` | Desa la nota |
| `Ctrl+Maj+F` | Cerca global |
| `Ctrl+B` / `Ctrl+I` | Negreta / cursiva |
| `Ctrl+W` | Tanca la pestanya |
| `Ctrl+Tab` | Pestanya següent |
| `Ctrl+,` | Configuració |
