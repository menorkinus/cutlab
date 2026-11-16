# Proyecto: editor-video

PWA tipo CapCut ("CutLab") para móvil y PC. HTML/CSS/JS sin compilación; todo se procesa en el dispositivo (Canvas + MediaRecorder + Web Audio). Datos del proyecto y medios en IndexedDB del navegador.

## Archivos
- `index.html`, `style.css`, `app.js` (toda la lógica), `sw.js`, `manifest.json`, `icon*.{svg,png}` (`tools/make_icons.py` regenera los PNG).
- `test/` (ignorado en git): vídeos de prueba generados con ffmpeg.

## Probar
- `python -m http.server 8765` en esta carpeta y abrir http://localhost:8765. `window.__app` expone funciones de prueba (`addMedia`, `addToTimeline`, `startExport`…).
- Si el navegador cachea: `fetch('app.js',{cache:'reload'})` y recargar.

## Decisiones
- Exportación con MediaRecorder sobre canvas (tiempo real, MP4 si el navegador lo permite, si no WebM). Hay un temporizador de respaldo porque `requestAnimationFrame` se frena en pestañas no visibles.
- Subtítulos: Whisper en el navegador (transformers.js desde jsDelivr, descarga el modelo la primera vez). [PENDIENTE] probar con voz real.
- Filtros con `ctx.filter`: no funciona en Safari.

## Estado
Ver `trabajo/estado-editor.md`.

## Publicación
- https://menorkinus.github.io/cutlab/ (GitHub Pages, repo público menorkinus/cutlab, rama main). Cada push a main se publica solo en ~1 minuto.
