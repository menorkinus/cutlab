'use strict';
/* CutLab — editor de vídeo PWA (móvil + PC). Todo se procesa en el dispositivo. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = p => 1 - Math.pow(1 - clamp(p, 0, 1), 3);
const easeBack = p => { p = clamp(p, 0, 1) - 1; return 1 + 2.70158 * p * p * p + 1.70158 * p * p; };
const RATIOS = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] };
const HW = 44, MIN_DUR = 0.1;
const FX0 = { brightness: 100, contrast: 100, saturate: 100, blur: 0, hue: 0, gray: 0, sepia: 0 };
const FONTS = ['system-ui, sans-serif', 'Impact, sans-serif', '"Arial Black", sans-serif', 'Georgia, serif', '"Courier New", monospace', '"Comic Sans MS", cursive', '"Brush Script MT", cursive'];
const FONT_NAMES = ['Sistema', 'Impact', 'Arial Black', 'Georgia', 'Courier', 'Comic', 'Manuscrita'];
const TRANS = [['none', 'Ninguna'], ['fade', 'Fundido'], ['slideL', 'Deslizar ←'], ['slideR', 'Deslizar →'], ['slideU', 'Deslizar ↑'], ['slideD', 'Deslizar ↓'], ['zoom', 'Zoom +'], ['zoomOut', 'Zoom −'], ['spin', 'Giro']];
const PRESETS = {
  'Original': {}, 'Vívido': { contrast: 115, saturate: 140, brightness: 105 }, 'Cálido': { sepia: 25, saturate: 120, hue: -10, brightness: 105 },
  'Frío': { hue: 15, saturate: 90, contrast: 105 }, 'B/N': { gray: 100, contrast: 110 }, 'Vintage': { sepia: 60, contrast: 90, brightness: 105, saturate: 85 },
  'Dramático': { contrast: 140, saturate: 80, brightness: 90 }, 'Suave': { blur: 1.2, brightness: 108, contrast: 92 }, 'Neón': { saturate: 200, contrast: 120, hue: 20 }
};
const TEXT_PRESETS = [
  ['Título', { size: 120, bold: true, strokeW: 0, anim: 'pop' }],
  ['Subtítulo', { size: 64, bold: true, strokeW: 6, anim: 'fade', y: 0.3 }],
  ['Con fondo', { size: 70, bold: true, bgOn: true, bg: '#000000', color: '#ffffff', anim: 'slide' }],
  ['Neón', { size: 110, bold: true, color: '#25f4ee', glow: true, strokeW: 0, anim: 'fade' }],
  ['Máquina', { size: 80, bold: true, font: FONTS[4], anim: 'type', strokeW: 4 }],
  ['Impacto', { size: 130, font: FONTS[1], color: '#ffe600', strokeW: 10, anim: 'pop' }]
];

const S = { name: 'Mi proyecto', ratio: '9:16', media: {}, tracks: [], sel: null, t: 0, playing: false, pps: 80, tab: 'media' };
let pv = 0.5, exporting = null, last = 0, needs = true;
const undoStack = [], redoStack = [];
const isDesktop = () => matchMedia('(min-width:900px)').matches;
const cv = $('#cv'); let g = cv.getContext('2d');

/* ───────── utilidades ───────── */
function h(tag, props, ...kids) {
  const e = document.createElement(tag); let val;
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'value') val = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) { if (kid == null || kid === false) continue; e.append(kid.nodeType ? kid : document.createTextNode(kid)); }
  if (val !== undefined) e.value = val;
  return e;
}
const fmt = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };
let toastTO;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTO); toastTO = setTimeout(() => t.hidden = true, 2800); }
function once(el, ev, ms = 6000) {
  return new Promise((res, rej) => {
    let to; const ok = () => { clear(); res(); }, er = () => { clear(); rej(new Error('media error')); };
    const clear = () => { clearTimeout(to); el.removeEventListener(ev, ok); el.removeEventListener('error', er); };
    el.addEventListener(ev, ok); el.addEventListener('error', er); to = setTimeout(ok, ms);
  });
}
const total = () => Math.max(1, ...S.tracks.flatMap(t => t.clips.map(c => c.start + c.dur)));
function findClip(id) { if (!id) return null; for (const track of S.tracks) { const clip = track.clips.find(c => c.id === id); if (clip) return { track, clip }; } return null; }
const mainTrack = () => { const l = S.tracks.filter(t => t.kind === 'video'); return l[l.length - 1]; };

/* ───────── almacenamiento (IndexedDB) ───────── */
const DB = {
  p: null,
  open() { return this.p || (this.p = new Promise((res, rej) => { const r = indexedDB.open('cutlab', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); },
  async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', mode); const q = fn(t.objectStore('kv')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); },
  get(k) { return this.tx('readonly', s => s.get(k)); },
  set(k, v) { return this.tx('readwrite', s => s.put(v, k)); },
  del(k) { return this.tx('readwrite', s => s.delete(k)); },
  clear() { return this.tx('readwrite', s => s.clear()); }
};
let saveTO;
function scheduleSave() { clearTimeout(saveTO); saveTO = setTimeout(saveProject, 800); }
async function saveProject() { try { await DB.set('project', { v: 1, name: S.name, ratio: S.ratio, tracks: S.tracks, pps: S.pps, media: Object.keys(S.media) }); } catch (e) { } }
async function saveMedia(m) { try { await DB.set('media:' + m.id, { id: m.id, name: m.name, kind: m.kind, dur: m.dur, w: m.w, h: m.h, thumb: m.thumb, wave: m.wave, blob: m.blob }); } catch (e) { } }
async function loadProject() {
  try {
    const p = await DB.get('project'); if (!p) return false;
    for (const id of p.media) { const r = await DB.get('media:' + id); if (r) { r.url = URL.createObjectURL(r.blob); S.media[id] = r; } }
    S.name = p.name; S.ratio = p.ratio; S.tracks = p.tracks; S.pps = p.pps || 80;
    return S.tracks.length > 0;
  } catch (e) { return false; }
}

/* ───────── historial ───────── */
const snap = () => JSON.stringify({ ratio: S.ratio, tracks: S.tracks });
function checkpoint() { undoStack.push(snap()); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; scheduleSave(); updateUndo(); }
function restore(str) { const o = JSON.parse(str); S.ratio = o.ratio; S.tracks = o.tracks; if (!findClip(S.sel)) S.sel = null; $('#ratio').value = S.ratio; setCanvasSize(); changed(); }
function undo() { if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); updateUndo(); }
function redo() { if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); updateUndo(); }
function updateUndo() { $('#undo').disabled = !undoStack.length; $('#redo').disabled = !redoStack.length; }
let ckOpen = false;
const begin = () => { if (!ckOpen) { checkpoint(); ckOpen = true; } };
document.addEventListener('change', () => { ckOpen = false; scheduleSave(); }, true);
window.addEventListener('pointerup', () => setTimeout(() => { ckOpen = false; }, 0));

/* ───────── medios ───────── */
const imgs = new Map();
function getImg(id) { let i = imgs.get(id); if (!i) { i = new Image(); i.onload = requestRender; i.src = S.media[id].url; imgs.set(id, i); } return i; }
async function addFiles(files) {
  ensureAudio();
  for (const f of files) { try { await addMedia(f); } catch (e) { toast('No se pudo importar ' + f.name); } }
  renderPanel();
}
async function addMedia(blob, name) {
  name = name || blob.name || 'Medio';
  const kind = blob.type.startsWith('video') ? 'video' : blob.type.startsWith('audio') ? 'audio' : blob.type.startsWith('image') ? 'image' : null;
  if (!kind) throw new Error('tipo no soportado');
  const url = URL.createObjectURL(blob);
  const m = { id: uid(), name, kind, url, blob, dur: 3, w: 0, h: 0, thumb: '', wave: '' };
  if (kind === 'image') {
    const im = new Image(); im.src = url; await once(im, 'load'); m.w = im.naturalWidth; m.h = im.naturalHeight; m.thumb = thumbOf(im, m.w, m.h);
  } else {
    const el = document.createElement(kind === 'video' ? 'video' : 'audio'); el.preload = 'metadata'; el.muted = true; el.playsInline = true; el.src = url;
    await once(el, 'loadedmetadata');
    if (!isFinite(el.duration)) { el.currentTime = 1e9; await once(el, 'timeupdate', 3000); }
    m.dur = isFinite(el.duration) ? el.duration : 1;
    if (kind === 'video') {
      m.w = el.videoWidth; m.h = el.videoHeight; el.currentTime = Math.min(0.1, m.dur / 2);
      await once(el, 'seeked', 2500); try { m.thumb = thumbOf(el, m.w, m.h); } catch (e) { }
    }
    computeWave(m);
  }
  S.media[m.id] = m; saveMedia(m);
  return m;
}
function thumbOf(src, w, hh) { const c = document.createElement('canvas'); const k = 160 / Math.max(w, hh); c.width = Math.max(1, w * k | 0); c.height = Math.max(1, hh * k | 0); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', .7); }
async function computeWave(m) {
  try {
    if (m.blob.size > 200e6) return;
    const oc = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
    const buf = await oc.decodeAudioData(await m.blob.arrayBuffer());
    const d = buf.getChannelData(0), N = Math.min(2000, Math.ceil(buf.duration * 20)), bs = Math.floor(d.length / N) || 1;
    const c = document.createElement('canvas'); c.width = N; c.height = 48; const x = c.getContext('2d'); x.fillStyle = 'rgba(255,255,255,.75)';
    for (let i = 0; i < N; i++) { let mx = 0; const st = Math.ceil(bs / 50) || 1; for (let j = i * bs; j < Math.min(d.length, (i + 1) * bs); j += st) mx = Math.max(mx, Math.abs(d[j])); const hh = Math.max(1, mx * 46); x.fillRect(i, 24 - hh / 2, 1, hh); }
    m.wave = c.toDataURL(); saveMedia(m); renderTimeline();
  } catch (e) { }
}
function deleteMedia(id) {
  if (!confirm('¿Quitar este medio y los clips que lo usan?')) return;
  checkpoint();
  for (const tr of S.tracks) tr.clips = tr.clips.filter(c => c.mediaId !== id);
  delete S.media[id]; imgs.delete(id); DB.del('media:' + id).catch(() => { });
  changed(); renderPanel();
}

/* ───────── clips y pistas ───────── */
function newClipFromMedia(m, start) {
  const base = { id: uid(), kind: m.kind, mediaId: m.id, start, in: 0, dur: m.kind === 'image' ? 3 : m.dur, speed: 1, vol: 1, fadeIn: 0, fadeOut: 0 };
  if (m.kind === 'audio') return base;
  return Object.assign(base, { opacity: 1, x: 0, y: 0, scale: 1, rot: 0, flip: false, fit: 'contain', tin: { type: 'none', dur: .5 }, tout: { type: 'none', dur: .5 }, fx: { ...FX0 } });
}
function newText(over) {
  return Object.assign({ id: uid(), kind: 'text', start: S.t, dur: 3, text: 'Texto', font: FONTS[0], size: 90, color: '#ffffff', stroke: '#000000', strokeW: 0, bgOn: false, bg: '#000000', bold: true, glow: false, align: 'center', anim: 'pop', x: 0, y: 0, rot: 0, scale: 1, opacity: 1 }, over || {});
}
function trackFor(kind, clip, overlay) {
  const list = S.tracks.filter(t => t.kind === kind);
  const free = tr => !tr.clips.some(c => c !== clip && c.start < clip.start + clip.dur - 1e-6 && c.start + c.dur > clip.start + 1e-6);
  const pool = kind === 'video' ? (overlay ? list.slice(0, -1).reverse() : list.slice(-1)) : list;
  let tr = pool.find(free);
  if (!tr) {
    tr = { id: uid(), kind, muted: false, hidden: false, clips: [] };
    let idx;
    if (kind === 'text') idx = 0;
    else if (kind === 'audio') idx = S.tracks.length;
    else if (overlay) idx = Math.max(0, S.tracks.findIndex(t => t.kind === 'video'));
    else { idx = S.tracks.findIndex(t => t.kind === 'audio'); if (idx < 0) idx = S.tracks.length; }
    S.tracks.splice(idx, 0, tr);
  }
  return tr;
}
function placeClip(c, overlay) {
  const tr = trackFor(c.kind === 'audio' ? 'audio' : c.kind === 'text' ? 'text' : 'video', c, overlay);
  tr.clips.push(c); tr.clips.sort((a, b) => a.start - b.start); return tr;
}
function addToTimeline(m, opt = {}) {
  checkpoint();
  const c = newClipFromMedia(m, S.t);
  if (c.kind !== 'audio' && !opt.overlay) {
    const main = mainTrack();
    if (main && main.clips.some(o => o.start < c.start + c.dur - 1e-6 && o.start + o.dur > c.start + 1e-6)) c.start = main.clips.reduce((a, o) => Math.max(a, o.start + o.dur), 0);
  }
  placeClip(c, opt.overlay); select(c.id); changed();
  if (opt.at !== undefined) { c.start = opt.at; resolveOverlaps(); changed(); }
  return c;
}
function addText(over) { checkpoint(); const c = newText(over); placeClip(c); select(c.id); changed(); return c; }
function resolveOverlaps() {
  for (const tr of [...S.tracks]) {
    tr.clips.sort((a, b) => a.start - b.start); let end = -1; const bad = [];
    for (const c of tr.clips) { if (c.start < end - 1e-6) bad.push(c); else end = c.start + c.dur; }
    for (const c of bad) { tr.clips.splice(tr.clips.indexOf(c), 1); const t2 = trackFor(tr.kind, c, true); t2.clips.push(c); t2.clips.sort((a, b) => a.start - b.start); }
  }
  for (const kind of ['video', 'text', 'audio']) {
    const l = S.tracks.filter(t => t.kind === kind);
    for (const t of l) if (!t.clips.length && S.tracks.filter(x => x.kind === kind).length > 1) S.tracks.splice(S.tracks.indexOf(t), 1);
  }
}
function splitClip() {
  const T = S.t; let f = findClip(S.sel);
  if (!f || T <= f.clip.start + MIN_DUR || T >= f.clip.start + f.clip.dur - MIN_DUR) {
    f = null;
    for (const tr of S.tracks) { if (tr.hidden) continue; const c = tr.clips.find(c => T > c.start + MIN_DUR && T < c.start + c.dur - MIN_DUR); if (c) { f = { track: tr, clip: c }; break; } }
  }
  if (!f) return toast('Coloca el cursor sobre un clip');
  checkpoint();
  const c = f.clip, d = T - c.start, r = JSON.parse(JSON.stringify(c));
  r.id = uid(); r.start = T; r.dur = c.dur - d;
  if (c.kind === 'video' || c.kind === 'audio') r.in = c.in + d * c.speed;
  c.dur = d; c.fadeOut = 0; r.fadeIn = 0; if (c.tout) { c.tout = { type: 'none', dur: .5 }; r.tin = { type: 'none', dur: .5 }; }
  f.track.clips.push(r); f.track.clips.sort((a, b) => a.start - b.start); select(r.id); changed();
}
function dupClip() {
  const f = findClip(S.sel); if (!f) return toast('Selecciona un clip');
  checkpoint(); const r = JSON.parse(JSON.stringify(f.clip)); r.id = uid(); r.start = f.clip.start + f.clip.dur;
  const main = f.track === mainTrack(); placeClip(r, !main); select(r.id); changed();
}
function delClip() {
  const f = findClip(S.sel); if (!f) return toast('Selecciona un clip');
  checkpoint(); f.track.clips.splice(f.track.clips.indexOf(f.clip), 1); S.sel = null; resolveOverlaps(); changed();
}
function setSpeed(c, v) { const span = c.dur * c.speed; c.speed = v; c.dur = Math.max(MIN_DUR, span / v); }
function maxDur(c) { if (c.kind === 'video' || c.kind === 'audio') return (S.media[c.mediaId].dur - c.in) / c.speed; return 3600; }

/* ───────── audio ───────── */
let actx = null, master, monitor, expDest;
const rt = new Map();
function ensureAudio() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); monitor = actx.createGain(); expDest = actx.createMediaStreamDestination();
    master.connect(monitor); monitor.connect(actx.destination); master.connect(expDest);
  }
  if (actx.state === 'suspended') actx.resume();
  for (const r of rt.values()) route(r);
}
function route(r) { if (r.src || !actx) return; r.src = actx.createMediaElementSource(r.el); r.gain = actx.createGain(); r.src.connect(r.gain); r.gain.connect(master); }
function runtime(c) {
  let r = rt.get(c.id); if (r) return r;
  const m = S.media[c.mediaId]; if (!m || m.kind === 'image') return null;
  const el = document.createElement(m.kind === 'video' ? 'video' : 'audio');
  el.src = m.url; el.preload = 'auto'; el.playsInline = true; el.addEventListener('seeked', requestRender); el.addEventListener('loadeddata', requestRender);
  r = { el, src: null, gain: null }; route(r); rt.set(c.id, r); return r;
}
function pruneRuntime() {
  const alive = new Set(S.tracks.flatMap(t => t.clips.map(c => c.id)));
  for (const [id, r] of rt) if (!alive.has(id)) { r.el.pause(); r.el.removeAttribute('src'); r.el.load(); rt.delete(id); }
}
function fadeFactor(c, t) {
  let f = 1; if (c.fadeIn > 0) f *= clamp((t - c.start) / c.fadeIn, 0, 1); if (c.fadeOut > 0) f *= clamp((c.start + c.dur - t) / c.fadeOut, 0, 1); return f;
}
function syncMedia(t) {
  for (const tr of S.tracks) {
    if (tr.kind === 'text') continue;
    for (const c of tr.clips) {
      if (c.kind === 'image') continue;
      const inside = t >= c.start && t < c.start + c.dur;
      const near = !inside && S.playing && c.start > t && c.start - t < 1.5;
      if (!inside && !near) { const r = rt.get(c.id); if (r && !r.el.paused) r.el.pause(); continue; }
      const r = runtime(c); if (!r) continue; const el = r.el;
      if (near) { if (el.paused && Math.abs(el.currentTime - c.in) > 0.05) el.currentTime = c.in; continue; }
      const m = S.media[c.mediaId], want = clamp(c.in + (t - c.start) * c.speed, 0, Math.max(0, m.dur - 0.01));
      el.playbackRate = clamp(c.speed, 0.0625, 16);
      const vol = tr.muted ? 0 : c.vol * fadeFactor(c, t);
      if (r.gain) r.gain.gain.value = vol; else el.volume = clamp(vol, 0, 1);
      if (S.playing) {
        if (el.paused) { el.currentTime = want; el.play().catch(() => { }); }
        else if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = want;
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - want) > 0.04) el.currentTime = want;
      }
    }
  }
}

/* ───────── dibujo ───────── */
function setCanvasSize() { const [W, H] = RATIOS[S.ratio]; cv.width = Math.round(W * pv / 2) * 2; cv.height = Math.round(H * pv / 2) * 2; g = cv.getContext('2d'); requestRender(); }
function filterStr(f) {
  const p = [];
  if (f.brightness !== 100) p.push(`brightness(${f.brightness}%)`); if (f.contrast !== 100) p.push(`contrast(${f.contrast}%)`);
  if (f.saturate !== 100) p.push(`saturate(${f.saturate}%)`); if (f.hue) p.push(`hue-rotate(${f.hue}deg)`);
  if (f.gray) p.push(`grayscale(${f.gray}%)`); if (f.sepia) p.push(`sepia(${f.sepia}%)`); if (f.blur) p.push(`blur(${f.blur}px)`);
  return p.length ? p.join(' ') : 'none';
}
function draw(g, t) {
  const [W, H] = RATIOS[S.ratio];
  g.setTransform(pv, 0, 0, pv, 0, 0); g.globalAlpha = 1; g.filter = 'none'; g.shadowBlur = 0; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  let any = false;
  for (let i = S.tracks.length - 1; i >= 0; i--) {
    const tr = S.tracks[i]; if (tr.hidden || tr.kind === 'audio') continue;
    for (const c of tr.clips) { if (t < c.start || t >= c.start + c.dur) continue; any = true; if (c.kind === 'text') drawText(g, c, t, W, H); else drawVisual(g, c, t, W, H); }
  }
  if (!any && !exporting) { g.fillStyle = '#555'; g.font = '500 44px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(S.tracks.some(t => t.clips.length) ? '' : 'Importa vídeos, fotos o audio para empezar', W / 2, H / 2); }
}
function drawVisual(g, c, t, W, H) {
  let src, sw, sh;
  if (c.kind === 'image') { const im = getImg(c.mediaId); if (!im.complete || !im.naturalWidth) return; src = im; sw = im.naturalWidth; sh = im.naturalHeight; }
  else { const r = rt.get(c.id); if (!r) return; const el = r.el; if (!el.videoWidth || el.readyState < 2) return; src = el; sw = el.videoWidth; sh = el.videoHeight; }
  const base = c.fit === 'cover' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
  let alpha = c.opacity * fadeFactor(c, t), tx = 0, ty = 0, sc = 1, rot = 0;
  const apply = (tr, e, dir) => {
    if (!tr || tr.type === 'none' || e <= 0) return;
    switch (tr.type) {
      case 'fade': alpha *= 1 - e; break;
      case 'slideL': tx += dir * e * W; break; case 'slideR': tx -= dir * e * W; break;
      case 'slideU': ty += dir * e * H; break; case 'slideD': ty -= dir * e * H; break;
      case 'zoom': sc *= 1 + e * .6; alpha *= 1 - e; break; case 'zoomOut': sc *= 1 - e * .6; alpha *= 1 - e; break;
      case 'spin': rot += dir * e * Math.PI; sc *= 1 - e * .5; alpha *= 1 - e; break;
    }
  };
  const lt = t - c.start, rm = c.start + c.dur - t;
  if (c.tin.type !== 'none' && lt < c.tin.dur) apply(c.tin, 1 - ease(lt / c.tin.dur), 1);
  if (c.tout.type !== 'none' && rm < c.tout.dur) apply(c.tout, ease(1 - rm / c.tout.dur), -1);
  g.save(); g.globalAlpha = clamp(alpha, 0, 1); g.filter = filterStr(c.fx);
  g.translate(W / 2 + c.x * W + tx, H / 2 + c.y * H + ty); g.rotate(c.rot * Math.PI / 180 + rot);
  const s = base * c.scale * sc; g.scale(c.flip ? -s : s, s); g.drawImage(src, -sw / 2, -sh / 2, sw, sh); g.restore();
}
function wrapText(g, txt, maxW) {
  const out = [];
  for (const para of txt.split('\n')) {
    let line = ''; for (const w of para.split(' ')) { const test = line ? line + ' ' + w : w; if (line && g.measureText(test).width > maxW) { out.push(line); line = w; } else line = test; }
    out.push(line);
  }
  return out;
}
function drawText(g, c, t, W, H) {
  const lt = t - c.start, rem = c.start + c.dur - t; let txt = c.text || '', alpha = c.opacity, sc = c.scale, oy = 0; const A = .35;
  switch (c.anim) {
    case 'fade': alpha *= Math.min(clamp(lt / A, 0, 1), clamp(rem / A, 0, 1)); break;
    case 'pop': sc *= easeBack(lt / A); alpha *= clamp(rem / .15, 0, 1); break;
    case 'slide': oy = (1 - ease(lt / A)) * H * .08; alpha *= clamp(lt / A, 0, 1) * clamp(rem / .15, 0, 1); break;
    case 'type': { const d = Math.min(c.dur * .7, txt.length * .06); txt = txt.slice(0, Math.floor(txt.length * clamp(lt / Math.max(d, .01), 0, 1))); break; }
  }
  if (!txt) return;
  g.save(); g.globalAlpha = clamp(alpha, 0, 1); g.translate(W / 2 + c.x * W, H / 2 + c.y * H + oy); g.rotate(c.rot * Math.PI / 180); g.scale(sc, sc);
  g.font = `${c.bold ? 800 : 500} ${c.size}px ${c.font}`; g.textBaseline = 'middle'; g.textAlign = c.align;
  const lines = wrapText(g, txt, W * .88), lh = c.size * 1.2, y0 = -(lines.length - 1) * lh / 2;
  const ax = c.align === 'left' ? -W * .44 : c.align === 'right' ? W * .44 : 0;
  if (c.bgOn) {
    const mw = Math.max(...lines.map(l => g.measureText(l).width)), pad = c.size * .3;
    const bx = c.align === 'left' ? ax - pad : c.align === 'right' ? ax - mw - pad : -mw / 2 - pad;
    g.fillStyle = c.bg; g.beginPath(); g.roundRect(bx, y0 - lh / 2 - pad / 2, mw + pad * 2, lines.length * lh + pad, c.size * .25); g.fill();
  }
  if (c.glow) { g.shadowColor = c.color; g.shadowBlur = 30; }
  lines.forEach((l, i) => {
    const y = y0 + i * lh;
    if (c.strokeW > 0) { g.lineWidth = c.strokeW * 2; g.strokeStyle = c.stroke; g.lineJoin = 'round'; g.strokeText(l, ax, y); }
    g.fillStyle = c.color; g.fillText(l, ax, y);
  });
  g.restore();
}

/* ───────── reproducción ───────── */
function requestRender() { needs = true; }
let lastTick = 0;
function loop(ts) { requestAnimationFrame(loop); tick(ts); }
function tick(ts) {
  if (ts - lastTick < 8) return; lastTick = ts;
  if (S.playing) {
    S.t += Math.min(0.1, (ts - last) / 1000); needs = true;
    if (S.t >= total()) { if (exporting) { finishExport(); } else { pause(); S.t = Math.max(0, total() - 0.001); } }
  }
  last = ts;
  if (needs) { needs = false; syncMedia(S.t); draw(g, S.t); updateTimeUI(); }
}
function play() {
  ensureAudio(); if (S.t >= total() - 0.01) S.t = 0;
  S.playing = true; last = performance.now(); $('#play').textContent = '⏸'; requestRender();
}
function pause() { S.playing = false; $('#play').textContent = '▶'; for (const r of rt.values()) r.el.pause(); requestRender(); }
function seek(t) { S.t = clamp(t, 0, total()); requestRender(); }
function updateTimeUI() {
  $('#tcur').textContent = fmt(S.t); $('#ttot').textContent = '/ ' + fmt(total());
  const ph = $('#playhead'); ph.style.left = (HW + S.t * S.pps - 1) + 'px';
  if (S.playing) { const sc = $('#tlscroll'), x = HW + S.t * S.pps; if (x > sc.scrollLeft + sc.clientWidth - 30) sc.scrollLeft = x - HW - 30; else if (x < sc.scrollLeft + HW) sc.scrollLeft = Math.max(0, x - HW - 30); }
}

/* ───────── línea de tiempo ───────── */
function clipLabel(c) { return c.kind === 'text' ? c.text.replace(/\n/g, ' ') : (S.media[c.mediaId]?.name || ''); }
function renderTimeline() {
  const T = total(), sc = $('#tlscroll'), extra = Math.max(8, sc.clientWidth / S.pps);
  $('#tlinner').style.width = (HW + (T + extra) * S.pps) + 'px';
  const steps = [.1, .2, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300], step = steps.find(s => s * S.pps >= 70) || 300; let rh = '';
  for (let i = 0; i * step <= T + extra; i++) { const t = i * step; rh += `<span class="tick" style="left:${HW + t * S.pps}px">${step < 1 ? fmt(t) : Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0')}</span>`; }
  $('#ruler').innerHTML = rh;
  const box = $('#tracks'); box.innerHTML = '';
  for (const tr of S.tracks) {
    const lane = h('div', { class: 'lane' });
    for (const c of tr.clips) {
      const m = S.media[c.mediaId];
      const el = h('div', { class: 'clip k-' + c.kind + (c.id === S.sel ? ' sel' : ''), 'data-id': c.id, style: `left:${c.start * S.pps}px;width:${Math.max(6, c.dur * S.pps)}px` },
        h('span', { class: 'cl' }, clipLabel(c)), h('i', { class: 'h l' }), h('i', { class: 'h r' }));
      if (c.kind === 'audio' && m && m.wave) { const w = m.dur / c.speed * S.pps; el.style.backgroundImage = `url(${m.wave})`; el.style.backgroundSize = `${w}px 100%`; el.style.backgroundPosition = `${-c.in / c.speed * S.pps}px 0`; el.style.backgroundRepeat = 'no-repeat'; }
      else if ((c.kind === 'video' || c.kind === 'image') && m && m.thumb) el.style.backgroundImage = `url(${m.thumb})`;
      lane.append(el);
    }
    const ico = tr.kind === 'text' ? 'T' : tr.kind === 'audio' ? (tr.muted ? '🔇' : '🔊') : (tr.hidden ? '🚫' : '🎞');
    const th = h('div', { class: 'th' }, h('button', {
      class: (tr.muted || tr.hidden) ? 'off' : '', title: 'Silenciar / ocultar pista', onclick: () => {
        checkpoint(); if (tr.kind === 'audio') tr.muted = !tr.muted; else { tr.hidden = !tr.hidden; if (tr.kind === 'video') tr.muted = tr.hidden; } changed();
      }
    }, ico));
    box.append(h('div', { class: 'trk ' + tr.kind, 'data-id': tr.id }, th, lane));
  }
  updateTimeUI();
}
function select(id, opt = {}) {
  S.sel = id; renderTimeline(); requestRender();
  if (opt.panel) { if (isDesktop()) { S.tab = 'adjust'; } }
  renderPanel();
  $('#tabs [data-tab=adjust]').classList.toggle('dot', !!id && S.tab !== 'adjust');
}
function changed() { pruneRuntime(); renderTimeline(); if (S.tab === 'adjust' || !findClip(S.sel)) renderPanel(); requestRender(); updateUndo(); scheduleSave(); }
function setZoom(pps) {
  const sc = $('#tlscroll'), px = HW + S.t * S.pps - sc.scrollLeft;
  S.pps = clamp(pps, 8, 600); renderTimeline(); sc.scrollLeft = Math.max(0, HW + S.t * S.pps - px);
}
function timeAt(ev) { return Math.max(0, (ev.clientX - $('#tlinner').getBoundingClientRect().left - HW) / S.pps); }
function snapTo(v, dur, skipId, mode) {
  const pts = [0, S.t]; for (const tr of S.tracks) for (const c of tr.clips) if (c.id !== skipId) { pts.push(c.start, c.start + c.dur); }
  const th = 8 / S.pps; let best = v, bd = th;
  for (const p of pts) {
    if (mode !== 'end') { const d = Math.abs(v - p); if (d < bd) { bd = d; best = p; } }
    if (mode !== 'start' && dur !== undefined) { const d = Math.abs(v + dur - p); if (d < bd) { bd = d; best = p - dur; } }
  }
  return best;
}
$('#tlinner').addEventListener('pointerdown', e => {
  const ruler = e.target.closest('#ruler');
  if (ruler) { if (S.playing) pause(); const mv = ev => seek(timeAt(ev)); mv(e); const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); e.preventDefault(); return; }
  const ce = e.target.closest('.clip');
  if (!ce) { if (e.target.closest('.lane')) { S.sel = null; seek(timeAt(e)); renderTimeline(); renderPanel(); } return; }
  const f = findClip(ce.dataset.id); if (!f) return;
  const type = e.target.classList.contains('h') ? (e.target.classList.contains('l') ? 'l' : 'r') : 'move';
  if (S.sel !== f.clip.id) select(f.clip.id, { panel: true });
  dragClip(e, type, f);
});
function dragClip(e, type, f) {
  const c = f.clip, x0 = e.clientX, y0 = e.clientY, o = { start: c.start, in: c.in, dur: c.dur }; let moved = false, cur = f.track;
  const mv = ev => {
    if (!moved && Math.abs(ev.clientX - x0) < 4 && Math.abs(ev.clientY - y0) < 4) return;
    if (!moved) { moved = true; checkpoint(); }
    let dx = (ev.clientX - x0) / S.pps;
    if (type === 'move') {
      c.start = snapTo(Math.max(0, o.start + dx), c.dur, c.id);
      const lane = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.trk');
      if (lane) { const tr = S.tracks.find(t => t.id === lane.dataset.id); if (tr && tr !== cur && tr.kind === cur.kind) { cur.clips.splice(cur.clips.indexOf(c), 1); tr.clips.push(c); cur = tr; } }
    } else if (type === 'l') {
      const media = c.kind === 'video' || c.kind === 'audio';
      const lo = media ? -Math.min(o.start, o.in / c.speed) : -o.start;
      let d = clamp(dx, lo, o.dur - MIN_DUR); d = snapTo(o.start + d, undefined, c.id, 'start') - o.start; d = clamp(d, lo, o.dur - MIN_DUR);
      c.start = o.start + d; c.dur = o.dur - d; if (media) c.in = o.in + d * c.speed;
    } else {
      const mx = maxDurFrom(c, o); let nd = clamp(o.dur + dx, MIN_DUR, mx); nd = snapTo(o.start + nd, undefined, c.id, 'end') - o.start; c.dur = clamp(nd, MIN_DUR, mx);
    }
    renderTimeline(); requestRender();
  };
  const up = () => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
    if (moved) { resolveOverlaps(); changed(); }
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
function maxDurFrom(c, o) { return (c.kind === 'video' || c.kind === 'audio') ? (S.media[c.mediaId].dur - o.in) / c.speed : 3600; }
// zoom: rueda y pellizco
$('#tlscroll').addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(S.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); } }, { passive: false });
let pinch = null; const dist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
$('#tlscroll').addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = { d: dist(e), pps: S.pps }; }, { passive: true });
$('#tlscroll').addEventListener('touchmove', e => { if (pinch && e.touches.length === 2) { e.preventDefault(); setZoom(pinch.pps * dist(e) / pinch.d); } }, { passive: false });
$('#tlscroll').addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; });

/* ───────── vista previa: mover y escalar ───────── */
cv.addEventListener('pointerdown', e => {
  let f = findClip(S.sel), c = f && f.clip;
  if (!c || c.kind === 'audio' || S.t < c.start || S.t >= c.start + c.dur) {
    c = null; for (const tr of S.tracks) { if (tr.kind === 'audio' || tr.hidden) continue; const k = tr.clips.find(k => S.t >= k.start && S.t < k.start + k.dur); if (k) { c = k; break; } }
    if (!c) return; select(c.id, { panel: true });
  }
  const [W, H] = RATIOS[S.ratio], r = cv.getBoundingClientRect(), dw = Math.min(r.width, r.height * W / H), dh = dw * H / W, x0 = e.clientX, y0 = e.clientY, ox = c.x, oy = c.y; let moved = false;
  const mv = ev => { if (pinchC) return; if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return; if (!moved) { moved = true; begin(); } c.x = ox + (ev.clientX - x0) / dw; c.y = oy + (ev.clientY - y0) / dh; requestRender(); };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (moved && S.tab === 'adjust') renderPanel(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
});
let pinchC = null;
cv.addEventListener('touchstart', e => { const f = findClip(S.sel); if (e.touches.length === 2 && f && f.clip.kind !== 'audio') { pinchC = { d: dist(e), s: f.clip.scale, c: f.clip }; begin(); } }, { passive: true });
cv.addEventListener('touchmove', e => { if (pinchC && e.touches.length === 2) { e.preventDefault(); pinchC.c.scale = clamp(pinchC.s * dist(e) / pinchC.d, .05, 6); requestRender(); } }, { passive: false });
cv.addEventListener('touchend', e => { if (e.touches.length < 2 && pinchC) { pinchC = null; if (S.tab === 'adjust') renderPanel(); } });
cv.addEventListener('wheel', e => { const f = findClip(S.sel); if (!f || f.clip.kind === 'audio') return; e.preventDefault(); begin(); f.clip.scale = clamp(f.clip.scale * (e.deltaY < 0 ? 1.05 : 1 / 1.05), .05, 6); requestRender(); }, { passive: false });

/* ───────── paneles ───────── */
function setTab(tab, toggle) {
  const side = $('#side');
  if (toggle && !isDesktop() && S.tab === tab && side.classList.contains('open')) { side.classList.remove('open'); document.body.classList.remove('sheet'); return; }
  S.tab = tab; side.classList.add('open'); document.body.classList.add('sheet'); renderPanel();
  $('#tabs [data-tab=adjust]').classList.toggle('dot', !!S.sel && tab !== 'adjust');
}
function renderPanel() {
  const p = $('#panel'); p.innerHTML = '';
  ({ media: panelMedia, audio: panelAudio, text: panelText, fx: panelFx, adjust: panelAdjust }[S.tab])(p);
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
}
const sec = (title, ...kids) => h('div', { class: 'sec' }, h('h4', {}, title), ...kids);
function slider(label, get, set, min, max, step, unit = '') {
  const out = h('b', {}, '');
  const show = v => { out.textContent = (step < 1 ? (+v).toFixed(step < .1 ? 2 : 1) : Math.round(v)) + unit; };
  const inp = h('input', { type: 'range', min, max, step, value: get() });
  show(get());
  inp.addEventListener('input', () => { begin(); set(+inp.value); show(+inp.value); requestRender(); });
  return h('label', { class: 'row' }, h('span', {}, label), inp, out);
}
function select2(label, get, set, opts) {
  const s = h('select', { onchange: () => { begin(); set(s.value); requestRender(); } }, opts.map(([v, n]) => h('option', { value: v }, n)));
  s.value = get(); return h('label', { class: 'row two' }, h('span', {}, label), s);
}
function color2(label, get, set) { const i = h('input', { type: 'color', value: get(), oninput: () => { begin(); set(i.value); requestRender(); } }); return h('label', { class: 'row two' }, h('span', {}, label), i); }
function toggle2(label, get, set) { const i = h('input', { type: 'checkbox', onchange: () => { begin(); set(i.checked); requestRender(); } }); i.checked = !!get(); return h('label', { class: 'row two' }, h('span', {}, label), i); }
function numInput(label, get, set) {
  const i = h('input', { type: 'number', min: .1, step: .1, value: (+get()).toFixed(2), onchange: () => { checkpoint(); set(+i.value); resolveOverlaps(); changed(); } });
  return h('label', { class: 'row two' }, h('span', {}, label), i);
}

function panelMedia(p) {
  p.append(h('button', { class: 'primary big', onclick: () => { ensureAudio(); $('#file').click(); } }, '＋ Importar vídeo, foto o audio'));
  const ms = Object.values(S.media);
  if (!ms.length) { p.append(h('p', { class: 'empty' }, 'Aquí aparecerán tus medios. También puedes arrastrar archivos a la ventana.')); return; }
  const grid = h('div', { class: 'grid', style: 'margin-top:10px' });
  for (const m of ms) {
    const acts = h('div', { class: 'acts' }, h('button', { title: 'Añadir a la línea de tiempo', onclick: () => addToTimeline(m) }, '＋'));
    if (m.kind !== 'audio') acts.append(h('button', { title: 'Superponer (PiP)', onclick: () => addToTimeline(m, { overlay: true }) }, '⧉'));
    acts.append(h('button', { title: 'Quitar', onclick: () => deleteMedia(m.id) }, '✕'));
    grid.append(h('div', { class: 'card' },
      h('div', { class: 'th2', style: m.thumb ? `background-image:url(${m.thumb})` : (m.kind === 'audio' ? 'background:#1d7a64' : '') }, h('span', {}, m.kind === 'audio' ? '♪' : m.kind === 'image' ? '🖼' : '🎞'), h('span', {}, m.kind === 'image' ? 'foto' : fmt(m.dur))),
      h('div', { class: 'nm' }, m.name), acts));
  }
  p.append(grid);
}
let recState = null;
function panelAudio(p) {
  p.append(h('button', { class: 'primary big', onclick: () => { ensureAudio(); const f = $('#file'); f.accept = 'audio/*'; f.click(); } }, '＋ Importar audio / música'));
  const rb = h('button', { class: 'big', style: 'margin-top:8px', onclick: () => toggleRec(rb) }, recState ? '⏹ Parar grabación' : '🎙 Grabar voz en off');
  p.append(rb, h('p', { class: 'note' }, 'La voz se coloca en el cursor actual. Para música sin derechos, importa tus propios archivos.'));
  const as = Object.values(S.media).filter(m => m.kind === 'audio');
  if (as.length) p.append(sec('Tus audios', h('div', { class: 'grid' }, as.map(m => h('div', { class: 'card' }, h('div', { class: 'th2', style: 'background:#1d7a64' }, h('span', {}, '♪'), h('span', {}, fmt(m.dur))), h('div', { class: 'nm' }, m.name),
    h('div', { class: 'acts' }, h('button', { onclick: () => addToTimeline(m) }, '＋'), h('button', { onclick: () => deleteMedia(m.id) }, '✕')))))));
}
async function toggleRec(btn) {
  if (recState) { recState.rec.stop(); return; }
  try {
    ensureAudio();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }), rec = new MediaRecorder(stream), chunks = [], at = S.t;
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop()); recState = null;
      const type = rec.mimeType || 'audio/webm', blob = new Blob(chunks, { type }), f = new File([blob], 'Voz ' + new Date().toLocaleTimeString() + '.' + (type.includes('mp4') ? 'm4a' : 'webm'), { type });
      try { const m = await addMedia(f); S.t = at; addToTimeline(m); } catch (e) { toast('No se pudo guardar la grabación'); }
      pause(); renderPanel();
    };
    rec.start(); recState = { rec }; btn.textContent = '⏹ Parar grabación'; toast('Grabando…');
  } catch (e) { toast('No se pudo acceder al micrófono'); }
}
function panelText(p) {
  p.append(sec('Añadir texto', h('div', { class: 'grid' }, TEXT_PRESETS.map(([n, o]) => h('button', { class: 'chip', style: 'min-height:56px', onclick: () => addText(Object.assign({ text: n === 'Subtítulo' ? 'Subtítulo' : 'Tu texto' }, o)) }, n)))));
  const lang = h('select', {}, [['es', 'Español'], ['ca', 'Català'], ['en', 'English'], ['', 'Detectar']].map(([v, n]) => h('option', { value: v }, n)));
  const model = h('select', {}, [['Xenova/whisper-tiny', 'Rápido (tiny, ~40 MB)'], ['Xenova/whisper-base', 'Preciso (base, ~80 MB)']].map(([v, n]) => h('option', { value: v }, n)));
  const st = h('div', { class: 'note', id: 'capstat' }), bar = h('div', { class: 'bar', hidden: true }, h('i'));
  p.append(sec('Subtítulos automáticos',
    h('p', { class: 'note' }, 'Transcribe la voz del clip seleccionado (o el primero) en tu dispositivo. La primera vez descarga el modelo.'),
    h('label', { class: 'row two' }, h('span', {}, 'Idioma'), lang), h('label', { class: 'row two' }, h('span', {}, 'Modelo'), model),
    h('button', { class: 'primary big', onclick: () => autoCaptions(lang.value, model.value, st, bar) }, 'Generar subtítulos'), bar, st));
}
function panelFx(p) {
  const f = findClip(S.sel);
  const vis = f && (f.clip.kind === 'video' || f.clip.kind === 'image') ? f.clip : null;
  if (!vis) p.append(h('p', { class: 'note' }, 'Selecciona un clip de vídeo o foto en la línea de tiempo para aplicar filtros y transiciones.'));
  p.append(sec('Filtros', h('div', { class: 'chips' }, Object.entries(PRESETS).map(([n, v]) => h('button', {
    class: 'chip', onclick: () => { if (!vis) return toast('Selecciona un clip'); checkpoint(); vis.fx = { ...FX0, ...v }; requestRender(); }
  }, n)))));
  p.append(sec('Transición de entrada', h('div', { class: 'chips' }, TRANS.map(([v, n]) => h('button', {
    class: 'chip' + (vis && vis.tin.type === v ? ' on' : ''), onclick: () => { if (!vis) return toast('Selecciona un clip'); checkpoint(); vis.tin.type = v; changed(); renderPanel(); }
  }, n)))));
  p.append(sec('Transición de salida', h('div', { class: 'chips' }, TRANS.map(([v, n]) => h('button', {
    class: 'chip' + (vis && vis.tout.type === v ? ' on' : ''), onclick: () => { if (!vis) return toast('Selecciona un clip'); checkpoint(); vis.tout.type = v; changed(); renderPanel(); }
  }, n)))));
  p.append(h('p', { class: 'note' }, 'Los filtros usan ctx.filter: funciona en Chrome, Edge, Firefox y Android; Safari (iPhone/Mac) no lo soporta aún.'));
}
function panelAdjust(p) {
  const f = findClip(S.sel);
  if (!f) { p.append(h('p', { class: 'empty' }, 'Selecciona un clip de la línea de tiempo para editarlo.')); return; }
  const c = f.clip;
  if (c.kind === 'text') return adjustText(p, c);
  if (c.kind === 'audio') return adjustAudio(p, c);
  adjustVisual(p, c);
}
function speedRows(c) {
  const out = [slider('Velocidad', () => c.speed, v => { setSpeed(c, v); renderTimeline(); }, .1, 8, .05, '×'),
  h('div', { class: 'chips' }, [.5, 1, 1.5, 2, 4].map(v => h('button', { class: 'chip', onclick: () => { checkpoint(); setSpeed(c, v); resolveOverlaps(); changed(); renderPanel(); } }, v + '×')))];
  return out;
}
function fadeRows(c) { return [slider('Aparecer', () => c.fadeIn, v => c.fadeIn = v, 0, 5, .1, 's'), slider('Desvanecer', () => c.fadeOut, v => c.fadeOut = v, 0, 5, .1, 's')]; }
function adjustAudio(p, c) {
  p.append(sec('Audio', slider('Volumen', () => c.vol, v => c.vol = v, 0, 2, .01), ...fadeRows(c)), sec('Velocidad', ...speedRows(c)));
}
function adjustVisual(p, c) {
  p.append(sec('Transformar',
    slider('Escala', () => c.scale, v => c.scale = v, .1, 4, .01), slider('Posición X', () => c.x, v => c.x = v, -1, 1, .01), slider('Posición Y', () => c.y, v => c.y = v, -1, 1, .01),
    slider('Rotación', () => c.rot, v => c.rot = v, -180, 180, 1, '°'), slider('Opacidad', () => c.opacity, v => c.opacity = v, 0, 1, .01),
    h('div', { class: 'chips' },
      h('button', { class: 'chip', onclick: () => { checkpoint(); c.flip = !c.flip; requestRender(); } }, '⇋ Voltear'),
      h('button', { class: 'chip', onclick: () => { checkpoint(); c.fit = c.fit === 'cover' ? 'contain' : 'cover'; requestRender(); toast(c.fit === 'cover' ? 'Rellenar pantalla' : 'Ajustar a pantalla'); } }, '⤢ Rellenar / Ajustar'),
      h('button', { class: 'chip', onclick: () => { checkpoint(); Object.assign(c, { x: 0, y: 0, scale: 1, rot: 0, flip: false, opacity: 1 }); renderPanel(); requestRender(); } }, '↺ Restablecer'))));
  if (c.kind === 'video') p.append(sec('Velocidad', ...speedRows(c)), sec('Audio', slider('Volumen', () => c.vol, v => c.vol = v, 0, 2, .01)));
  if (c.kind === 'image') p.append(sec('Duración', numInput('Segundos', () => c.dur, v => c.dur = Math.max(MIN_DUR, v))));
  p.append(sec('Fundidos', ...fadeRows(c)));
  p.append(sec('Transiciones',
    select2('Entrada', () => c.tin.type, v => { c.tin.type = v; }, TRANS), slider('Duración', () => c.tin.dur, v => c.tin.dur = v, .1, 2, .05, 's'),
    select2('Salida', () => c.tout.type, v => { c.tout.type = v; }, TRANS), slider('Duración', () => c.tout.dur, v => c.tout.dur = v, .1, 2, .05, 's')));
  const fx = c.fx;
  p.append(sec('Color y filtros',
    slider('Brillo', () => fx.brightness, v => fx.brightness = v, 0, 200, 1, '%'), slider('Contraste', () => fx.contrast, v => fx.contrast = v, 0, 200, 1, '%'),
    slider('Saturación', () => fx.saturate, v => fx.saturate = v, 0, 300, 1, '%'), slider('Tono', () => fx.hue, v => fx.hue = v, -180, 180, 1, '°'),
    slider('Sepia', () => fx.sepia, v => fx.sepia = v, 0, 100, 1, '%'), slider('B/N', () => fx.gray, v => fx.gray = v, 0, 100, 1, '%'), slider('Desenfoque', () => fx.blur, v => fx.blur = v, 0, 30, .5, 'px')));
}
function adjustText(p, c) {
  const ta = h('textarea', { value: c.text, oninput: () => { begin(); c.text = ta.value; requestRender(); renderTimeline(); } });
  p.append(sec('Texto', ta,
    select2('Fuente', () => c.font, v => c.font = v, FONTS.map((f, i) => [f, FONT_NAMES[i]])),
    slider('Tamaño', () => c.size, v => c.size = v, 20, 300, 1),
    color2('Color', () => c.color, v => c.color = v), color2('Contorno', () => c.stroke, v => c.stroke = v), slider('Grosor', () => c.strokeW, v => c.strokeW = v, 0, 24, 1),
    toggle2('Fondo', () => c.bgOn, v => c.bgOn = v), color2('Color fondo', () => c.bg, v => c.bg = v),
    toggle2('Negrita', () => c.bold, v => c.bold = v), toggle2('Brillo neón', () => c.glow, v => c.glow = v),
    select2('Alineación', () => c.align, v => c.align = v, [['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']]),
    select2('Animación', () => c.anim, v => c.anim = v, [['none', 'Ninguna'], ['fade', 'Fundido'], ['pop', 'Pop'], ['slide', 'Deslizar'], ['type', 'Máquina de escribir']])));
  p.append(sec('Transformar', slider('Posición X', () => c.x, v => c.x = v, -1, 1, .01), slider('Posición Y', () => c.y, v => c.y = v, -1, 1, .01), slider('Escala', () => c.scale, v => c.scale = v, .2, 4, .01), slider('Rotación', () => c.rot, v => c.rot = v, -180, 180, 1, '°'), slider('Opacidad', () => c.opacity, v => c.opacity = v, 0, 1, .01), numInput('Duración (s)', () => c.dur, v => c.dur = Math.max(MIN_DUR, v))));
}

/* ───────── subtítulos automáticos (Whisper en el navegador) ───────── */
async function autoCaptions(lang, model, st, bar) {
  let f = findClip(S.sel); if (!f || f.clip.kind === 'text' || f.clip.kind === 'image') f = null;
  if (!f) { for (const tr of S.tracks) { const c = tr.clips.find(c => c.kind === 'video' || c.kind === 'audio'); if (c) { f = { track: tr, clip: c }; break; } } }
  if (!f) return toast('Añade un vídeo o audio con voz primero');
  const c = f.clip, m = S.media[c.mediaId]; bar.hidden = false; const fill = bar.firstChild;
  try {
    st.textContent = 'Preparando audio…'; fill.style.width = '5%';
    const oc = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 16000);
    const buf = await oc.decodeAudioData(await m.blob.arrayBuffer());
    const ch = buf.numberOfChannels, len = buf.length, mono = new Float32Array(len);
    for (let k = 0; k < ch; k++) { const d = buf.getChannelData(k); for (let i = 0; i < len; i++) mono[i] += d[i] / ch; }
    const sr = buf.sampleRate, a = Math.floor(c.in * sr), b = Math.min(len, Math.floor((c.in + c.dur * c.speed) * sr)), audio = mono.slice(a, b);
    st.textContent = 'Cargando modelo (la primera vez tarda)…'; fill.style.width = '15%';
    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2'); env.allowLocalModels = false;
    const asr = await pipeline('automatic-speech-recognition', model, { progress_callback: pr => { if (pr.status === 'progress') { fill.style.width = (15 + pr.progress * .6) + '%'; st.textContent = 'Descargando modelo… ' + Math.round(pr.progress) + '%'; } } });
    st.textContent = 'Transcribiendo…'; fill.style.width = '80%';
    const opts = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true, task: 'transcribe' }; if (lang) opts.language = { es: 'spanish', ca: 'catalan', en: 'english' }[lang];
    const out = await asr(audio, opts);
    checkpoint(); let n = 0;
    for (const ch of out.chunks || []) {
      const words = ch.text.trim().split(/\s+/).filter(Boolean); if (!words.length) continue;
      const s0 = ch.timestamp[0] || 0, e0 = ch.timestamp[1] ?? s0 + 2, groups = [];
      for (let i = 0; i < words.length; i += 4) groups.push(words.slice(i, i + 4).join(' '));
      const chars = groups.reduce((x, y) => x + y.length, 0); let acc = s0;
      for (const gtxt of groups) {
        const d = (e0 - s0) * gtxt.length / chars;
        const tc = newText({ text: gtxt, start: c.start + acc / c.speed, dur: Math.max(.3, d / c.speed), size: 64, y: .3, strokeW: 6, anim: 'none' });
        placeClip(tc); acc += d; n++;
      }
    }
    resolveOverlaps(); changed(); fill.style.width = '100%'; st.textContent = n ? `Listo: ${n} subtítulos añadidos (edítalos en la pista de texto).` : 'No se detectó voz.';
  } catch (e) { st.textContent = 'Error: ' + (e.message || e) + ' (necesita conexión la primera vez).'; }
}

/* ───────── exportar ───────── */
function pickMime() {
  return ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}
function exportDialog() {
  if (!S.tracks.some(t => t.clips.length)) return toast('La línea de tiempo está vacía');
  pause();
  const q = h('select', {}, [['1', '1080p (alta)'], ['0.667', '720p (rápida)']].map(([v, n]) => h('option', { value: v }, n))), fps = h('select', {}, [['30', '30 fps'], ['60', '60 fps']].map(([v, n]) => h('option', { value: v }, n)));
  const dlg = h('div', { class: 'dlg' }, h('h3', {}, 'Exportar vídeo'),
    h('label', { class: 'row two' }, h('span', {}, 'Calidad'), q), h('label', { class: 'row two' }, h('span', {}, 'Fotogramas'), fps),
    h('p', { class: 'note' }, `Duración ${fmt(total())}. La exportación va en tiempo real: ${fmt(total())} de espera. Mantén esta pestaña visible y la pantalla encendida.`),
    h('div', { class: 'btns' }, h('button', { onclick: closeModal }, 'Cancelar'), h('button', { class: 'primary', onclick: () => startExport(+q.value, +fps.value) }, 'Exportar')));
  openModal(dlg);
}
function openModal(el) { const m = $('#modal'); m.innerHTML = ''; m.append(el); m.hidden = false; }
function closeModal() { $('#modal').hidden = true; }
async function startExport(scale, fps) {
  const mime = pickMime(); if (!mime) return toast('Este navegador no puede exportar vídeo');
  ensureAudio(); monitor.gain.value = 0; pv = scale; setCanvasSize();
  const bar = h('div', { class: 'bar' }, h('i')), st = h('p', { class: 'note' }, 'Preparando…');
  const cancel = h('button', { onclick: () => finishExport(true) }, 'Cancelar');
  openModal(h('div', { class: 'dlg' }, h('h3', {}, 'Exportando…'), bar, st, h('div', { class: 'btns' }, cancel)));
  const stream = cv.captureStream(fps); expDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: scale >= 1 ? 10e6 : 6e6, audioBitsPerSecond: 192e3 }), chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  exporting = { rec, chunks, mime, done, bar: bar.firstChild, st, T: total(), cancelled: false };
  S.t = 0; syncMedia(0); requestRender(); await new Promise(r => setTimeout(r, 700)); syncMedia(0); draw(g, 0);
  rec.start(500); play();
  exporting.iv = setInterval(() => tick(performance.now()), 1000 / fps); // respaldo si el navegador frena requestAnimationFrame
  exporting.timer = setInterval(() => { if (!exporting) return; exporting.bar.style.width = (S.t / exporting.T * 100) + '%'; exporting.st.textContent = `${fmt(S.t)} / ${fmt(exporting.T)}`; }, 300);
}
async function finishExport(cancelled) {
  const ex = exporting; if (!ex || ex.finishing) return; ex.finishing = true; clearInterval(ex.timer); clearInterval(ex.iv);
  pause(); ex.rec.stop(); await ex.done; exporting = null; monitor.gain.value = 1; pv = isDesktop() ? .5 : .4; setCanvasSize(); S.t = 0; requestRender();
  if (cancelled) return closeModal();
  const ext = ex.mime.includes('mp4') ? 'mp4' : 'webm', blob = new Blob(ex.chunks, { type: ex.mime.split(';')[0] }), url = URL.createObjectURL(blob), name = (S.name || 'video').replace(/[^\w\- ]+/g, '') + '.' + ext;
  const btns = h('div', { class: 'btns' }, h('button', { onclick: closeModal }, 'Cerrar'));
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) btns.append(h('button', { onclick: () => navigator.share({ files: [file], title: name }).catch(() => { }) }, 'Compartir'));
  btns.append(h('a', { href: url, download: name }, h('button', { class: 'primary' }, 'Descargar ' + ext.toUpperCase())));
  openModal(h('div', { class: 'dlg' }, h('h3', {}, '¡Listo!'), h('video', { src: url, controls: true, playsinline: true, style: 'width:100%;max-height:50dvh;border-radius:8px;background:#000' }),
    h('p', { class: 'note' }, `${name} · ${(blob.size / 1048576).toFixed(1)} MB`), btns));
}

/* ───────── arranque y eventos ───────── */
$('#file').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; e.target.accept = 'video/*,audio/*,image/*'; });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab, true); });
$('#play').onclick = () => S.playing ? pause() : play();
$('#prev').onclick = () => seek(0);
$('#next').onclick = () => seek(total());
$('#split').onclick = splitClip; $('#dup').onclick = dupClip; $('#del').onclick = delClip;
$('#zin').onclick = () => setZoom(S.pps * 1.4); $('#zout').onclick = () => setZoom(S.pps / 1.4);
$('#undo').onclick = undo; $('#redo').onclick = redo; $('#export').onclick = exportDialog;
$('#ratio').onchange = e => { checkpoint(); S.ratio = e.target.value; setCanvasSize(); };
$('#pname').oninput = e => { S.name = e.target.value; scheduleSave(); };
$('#newp').onclick = async () => {
  if (!confirm('¿Empezar un proyecto nuevo? Se borrará el actual de este dispositivo.')) return;
  pause(); try { await DB.clear(); } catch (e) { }
  S.media = {}; imgs.clear(); S.sel = null; S.t = 0; undoStack.length = redoStack.length = 0; initTracks(); S.name = 'Mi proyecto'; $('#pname').value = S.name; changed(); renderPanel();
};
addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (k === ' ') { e.preventDefault(); S.playing ? pause() : play(); }
  else if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod && k === 'd') { e.preventDefault(); dupClip(); }
  else if (k === 's' && !mod) splitClip();
  else if (k === 'delete' || k === 'backspace') delClip();
  else if (k === 'arrowleft') seek(S.t - (e.shiftKey ? 1 : 1 / 30));
  else if (k === 'arrowright') seek(S.t + (e.shiftKey ? 1 : 1 / 30));
  else if (k === '+' || k === '=') setZoom(S.pps * 1.3);
  else if (k === '-') setZoom(S.pps / 1.3);
});
addEventListener('resize', () => { pv = exporting ? pv : (isDesktop() ? .5 : .4); renderTimeline(); });
function initTracks() { S.tracks = [{ id: uid(), kind: 'text', muted: false, hidden: false, clips: [] }, { id: uid(), kind: 'video', muted: false, hidden: false, clips: [] }, { id: uid(), kind: 'audio', muted: false, hidden: false, clips: [] }]; }
(async function init() {
  pv = isDesktop() ? .5 : .4;
  if (!(await loadProject())) initTracks();
  $('#pname').value = S.name; $('#ratio').value = S.ratio;
  setCanvasSize(); if (isDesktop()) document.body.classList.remove('sheet');
  renderTimeline(); renderPanel(); updateUndo();
  $('#side').classList.toggle('open', isDesktop());
  requestAnimationFrame(loop);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
window.__app = { S, addMedia, addToTimeline, addText, splitClip, play, pause, seek, total, startExport, undo, redo };
