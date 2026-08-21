# Guía de uso

## Carpetas y archivos

Quasidian no tiene «vaults» ni configuración: **la carpeta del archivo abierto es tu espacio de trabajo**. Abre una carpeta o un archivo `.md` con los botones de la barra lateral; la lista muestra las notas de la carpeta (sin subcarpetas). Los enlaces, los backlinks y la búsqueda se resuelven dentro de esa carpeta.

Si la carpeta — o un ancestro — contiene un marcador de proyecto (`CLAUDE.md`, `.claude`, `AGENTS.md`, `.codex`, `.obsidian` o la carpeta `.git`), esa carpeta pasa a ser la raíz de un **vault recursivo**: el árbol muestra las subcarpetas y los enlaces, los backlinks y la búsqueda abarcan todo el proyecto. Las carpetas ocultas (que empiezan por punto) se incluyen por defecto — desactiva «Mostrar las carpetas ocultas» en la configuración para dejarlas fuera. El contenido de `.git` y `.obsidian` no se escanea nunca.

- **Búsqueda global**: `Ctrl+Mayús+F` o la lupa de la barra lateral.
- **Quick switcher**: `Ctrl+O` — salta a cualquier nota por su nombre o sus alias.
- **Paleta de comandos**: `Ctrl+P` — todas las acciones disponibles.
- Clic derecho sobre un archivo: renombrar (los enlaces entrantes se reapuntan solos), hacer una copia (`Nombre 1.md`…), moverlo a otra carpeta del vault (los enlaces por ruta se reapuntan), copiar la ruta, abrirlo con la aplicación por defecto, mostrar en el explorador, exportar a PDF o eliminar.

## Modos de edición y lectura

`Ctrl+E` conmuta entre **edición** (Live Preview: la sintaxis se oculta fuera de la línea activa) y **lectura** (HTML renderizado, solo las casillas de tarea son interactivas). El botón del libro en la barra del archivo hace lo mismo. El menú de tres puntos del panel también conmuta el modo y pliega o despliega todos los encabezados, en ambos modos. Dentro del modo edición, el **modo fuente** (en el mismo menú o desde la paleta) muestra toda la sintaxis como texto plano con resaltado, por pestaña.

## Enlaces y transclusiones

- `[[nota]]` enlaza una nota; `[[nota|alias]]` muestra otro texto; `[[nota#sección]]` salta a un heading.
- Hacer clic en un enlace lo abre (o **crea la nota** si no existe). `Ctrl+clic` o clic central: pestaña nueva.
- Desde el menú contextual, «Insertar ▸ Wikilink» escribe `[[]]` y abre el autocompletado de notas.
- **Previsualización**: pasa el ratón sobre un enlace en modo lectura (o `Ctrl`+ratón en edición) para ver el contenido en una ventana emergente.
- `![[nota]]` incrusta el contenido de otra nota (también `![[nota#sección]]` e imágenes `![[imagen.png|500]]`).

## Propiedades

Un bloque `---` al inicio de la nota contiene las propiedades (tags, alias…), editadas siempre desde el widget: añade, elimina o cambia valores con sus controles. Los **alias** funcionan en el switcher y en los wikilinks; los **tags** son buscables.

## Formato

- `Ctrl+B` negrita, `Ctrl+I` cursiva; también `==resaltado==`, `~~tachado~~`, `` `código` `` y `$formula$` (KaTeX).
- **Listas**: `- ` o `1. ` empiezan una lista; `Tab`/`Mayús+Tab` cambian el nivel (las numeradas se renumeran solas); `- [ ]` crea una tarea.
- **Tablas**: insértalas desde el menú contextual («Insertar ▸ Tabla»). Se editan siempre por celdas: `Tab`/flechas para moverte, `Enter` para bajar, arrastra los tiradores para mover filas y columnas, clic derecho para el menú completo.
- **Callouts**: `> [!note] Título` crea una caja coloreada (`warning`, `tip`, `check`, `danger`…). Con `[!note]-` empieza plegada; el chevrón conmuta su estado.
- **Footnotes**: `[^1]` con la definición `[^1]: texto`, o directas con `^[texto]`. En lectura se recogen al pie; el ratón encima muestra su contenido.

## Pestañas

- Navegar reutiliza la pestaña activa; `Ctrl+clic` abre una nueva.
- `Ctrl+W` cierra; `Ctrl+Tab` / `Ctrl+Mayús+Tab` cicla; arrastra para reordenar.
- Clic derecho: cerrar las demás, cerrarlas todas o **fijar** (una pestaña fijada nunca se reutiliza).
- Al arrancar, la app restaura la sesión anterior (pestañas, modos y ventana) — configurable en los ajustes.

## Exportar a PDF

En el menú del archivo (clic derecho o botón de tres puntos): «Exportar a PDF». La nota se imprime tal como se ve en modo lectura, con fondo blanco y el nombre de la nota como título.

## Atajos principales

| Atajo | Acción |
| --- | --- |
| `Ctrl+P` | Paleta de comandos |
| `Ctrl+O` | Quick switcher |
| `Ctrl+E` | Modo edición/lectura |
| `Ctrl+S` | Guardar la nota |
| `Ctrl+Mayús+F` | Búsqueda global |
| `Ctrl+B` / `Ctrl+I` | Negrita / cursiva |
| `Ctrl+W` | Cerrar la pestaña |
| `Ctrl+Tab` | Pestaña siguiente |
| `Ctrl+,` | Ajustes |
