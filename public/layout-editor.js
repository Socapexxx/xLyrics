/* xLyrics Layout Editor */
'use strict';

/* ── Constants ─────────────────────────────────────────────── */
const CANVAS_W = 1920;
const CANVAS_H = 1080;

const SAMPLE = {
  current:  'When oceans rise\nMy soul will rest in Your embrace',
  next:     'I will call upon Your name',
  section:  'Chorus',
  song_title: 'Oceans',
  static:   'Static Text',
  clock:    '00:00:00',
};

const ELEMENT_LABELS = {
  current:   'Lyrics',
  next:      'Next',
  section:   'Section',
  title:     'Song Title',
  static:    'Static Text',
  clock:     'Clock',
};

const ELEMENT_DEFAULTS = {
  x: 10, y: 70, w: 80, h: 20,
  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  fontSize: 56,
  fontWeight: 'normal',
  fontStyle:  'normal',
  color: '#ffffff',
  textAlign: 'center',
  alignItems: 'center',
  lineHeight: 1.3,
  letterSpacing: 0,
  shadowOn: false,
  shadowColor: '#000000',
  shadowX: 0,
  shadowY: 2,
  shadowBlur: 10,
  bgColor: '#000000',
  bgOpacity: 0,
  padX: 0,
  padY: 0,
  radius: 0,
  borderColor: '#ffffff',
  borderWidth: 0,
  opacity: 1,
  staticText: '',
  fadeMs: 300,
};

/* ── State ─────────────────────────────────────────────────── */
let layout = { name: '', background: '#000000', elements: [] };
let selectedId = null;
let history = [];
let historyIdx = -1;
let isDirty = false;

/* ── DOM refs ──────────────────────────────────────────────── */
const canvas        = document.getElementById('le-canvas');
const canvasOuter   = document.getElementById('le-canvas-outer');
const canvasArea    = document.getElementById('le-canvas-area');
const propsEmpty    = document.getElementById('le-props-empty');
const propsPage     = document.getElementById('le-props-page');
const propsEl       = document.getElementById('le-props-el');
const codePanel     = document.getElementById('le-code-panel');
const codePre       = document.getElementById('le-code-pre');
const layoutSelect  = document.getElementById('le-layout-select');
const statusEl      = document.getElementById('le-status');
const nameDialog    = document.getElementById('le-name-dialog');

/* ── Utilities ─────────────────────────────────────────────── */
function uid() {
  return 'el-' + Math.random().toString(36).slice(2, 8);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function hexFromColor(color) {
  // color may be rgb() string or hex. Normalise to 6-char hex.
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (m) {
    return '#' + [m[1],m[2],m[3]].map(n => Number(n).toString(16).padStart(2,'0')).join('');
  }
  return '#000000';
}

function syncColorPair(picker, hexInput, val) {
  picker.value = val;
  hexInput.value = val;
}

/* ── Canvas scaling ────────────────────────────────────────── */
function scaleCanvas() {
  const availW = canvasArea.clientWidth  - 40;
  const availH = canvasArea.clientHeight - 40;
  const scale  = Math.min(availW / CANVAS_W, availH / CANVAS_H);
  canvasOuter.style.transform = `scale(${scale})`;
  canvasOuter.style.width  = CANVAS_W + 'px';
  canvasOuter.style.height = CANVAS_H + 'px';
  document.getElementById('le-canvas-info').textContent =
    `${CANVAS_W} × ${CANVAS_H}  (${Math.round(scale * 100)}%)`;
}
window.addEventListener('resize', scaleCanvas);

/* ── History ───────────────────────────────────────────────── */
function snapshot() {
  history = history.slice(0, historyIdx + 1);
  history.push(JSON.stringify(layout));
  if (history.length > 60) history.shift();
  historyIdx = history.length - 1;
  isDirty = true;
  updateStatus();
  updateCodePanel();
}

function undo() {
  if (historyIdx <= 0) return;
  historyIdx--;
  layout = JSON.parse(history[historyIdx]);
  selectedId = null;
  renderAll();
  updateStatus();
  updateCodePanel();
}

function redo() {
  if (historyIdx >= history.length - 1) return;
  historyIdx++;
  layout = JSON.parse(history[historyIdx]);
  selectedId = null;
  renderAll();
  updateStatus();
  updateCodePanel();
}

/* ── Layout load / save ────────────────────────────────────── */
async function loadLayoutList() {
  const res = await fetch('/api/layouts');
  const names = await res.json();
  layoutSelect.innerHTML = '<option value="">— open layout —</option>';
  for (const n of names) {
    const opt = document.createElement('option');
    opt.value = n; opt.textContent = n;
    layoutSelect.appendChild(opt);
  }
}

async function loadLayout(name) {
  try {
    const res = await fetch(`/api/layout/${encodeURIComponent(name)}/source`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const source = await res.text();
    layout = parseXlayout(source, name);
    selectedId = null;
    history = [JSON.stringify(layout)];
    historyIdx = 0;
    isDirty = false;
    document.getElementById('pp-layout-name').value = name;
    renderAll();
    updateCodePanel();
    updateStatus();
    setStatus('Loaded.');
  } catch(e) {
    alert('Could not load layout: ' + e.message);
  }
}

async function saveLayout() {
  const name = document.getElementById('pp-layout-name').value.trim().replace(/[^a-z0-9 _\-]/gi,'') || layout.name;
  if (!name) { alert('Give the layout a name first.'); return; }
  layout.name = name;
  const source = generateXlayout();
  try {
    const res = await fetch(`/api/layout/${encodeURIComponent(name)}/source`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: source,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    isDirty = false;
    setStatus('Saved ✓');
    await loadLayoutList();
    layoutSelect.value = name;
    setTimeout(() => setStatus(''), 2000);
  } catch(e) {
    alert('Save failed: ' + e.message);
  }
}

function newLayout(name) {
  layout = {
    name,
    background: '#000000',
    elements: [],
  };
  document.getElementById('pp-layout-name').value = name;
  document.getElementById('pp-bg-color').value = '#000000';
  document.getElementById('pp-bg-hex').value   = '#000000';
  selectedId = null;
  history = [JSON.stringify(layout)];
  historyIdx = 0;
  isDirty = false;
  renderAll();
  updateCodePanel();
  updateStatus();
}

function setStatus(msg) { statusEl.textContent = msg; }
function updateStatus() {
  if (isDirty) setStatus('Unsaved changes');
  document.getElementById('le-undo').disabled = historyIdx <= 0;
  document.getElementById('le-redo').disabled = historyIdx >= history.length - 1;
}

/* ── xlayout parser ────────────────────────────────────────── */
function parseXlayout(source, name) {
  // Extract the JSON metadata comment we embed on save.
  const metaMatch = source.match(/<!--\s*xl-editor-meta:([\s\S]*?)-->/);
  if (metaMatch) {
    try {
      const meta = JSON.parse(metaMatch[1].trim());
      meta.name = name;
      return meta;
    } catch { /* fall through to heuristic parse */ }
  }
  // Heuristic: pull background from body CSS
  const bgMatch = source.match(/background(?:-color)?\s*:\s*(#[0-9a-f]{6}|[a-z]+(?:\([^)]+\))?)/i);
  return {
    name,
    background: bgMatch ? bgMatch[1] : '#000000',
    elements: [],
  };
}

/* ── xlayout generator ─────────────────────────────────────── */
function valignToCss(v) {
  if (v === 'flex-start') return 'flex-start';
  if (v === 'flex-end')   return 'flex-end';
  return 'center';
}

function generateXlayout() {
  const els = layout.elements;
  let css = '';
  let html = '';

  for (const el of els) {
    const id    = el.id;
    const vAlign = valignToCss(el.alignItems);
    const hAlign = el.textAlign === 'left'  ? 'flex-start'
                 : el.textAlign === 'right' ? 'flex-end'
                 : 'center';
    const shadow = el.shadowOn
      ? `${el.shadowX}px ${el.shadowY}px ${el.shadowBlur}px ${el.shadowColor}`
      : 'none';
    const bgRgb = hexToRgb(el.bgColor);
    const bgCss = el.bgOpacity > 0
      ? `rgba(${bgRgb},${el.bgOpacity})`
      : 'transparent';
    const border = el.borderWidth > 0
      ? `${el.borderWidth}px solid ${el.borderColor}`
      : 'none';

    css += `
.xl-el-${id} {
  position: absolute;
  left: ${el.x.toFixed(3)}%;
  top: ${el.y.toFixed(3)}%;
  width: ${el.w.toFixed(3)}%;
  height: ${el.h.toFixed(3)}%;
  display: flex;
  flex-direction: column;
  align-items: ${hAlign};
  justify-content: ${vAlign};
  padding: ${el.padY}px ${el.padX}px;
  background: ${bgCss};
  border: ${border};
  border-radius: ${el.radius}px;
  opacity: ${el.opacity};
  box-sizing: border-box;
  overflow: hidden;
}`;

    const spanStyle = [
      `font-family: ${el.fontFamily}`,
      `font-size: ${el.fontSize}px`,
      `font-weight: ${el.fontWeight}`,
      `font-style: ${el.fontStyle}`,
      `color: ${el.color}`,
      `text-align: ${el.textAlign}`,
      `line-height: ${el.lineHeight}`,
      `letter-spacing: ${el.letterSpacing}em`,
      `white-space: pre-line`,
      `width: 100%`,
      shadow !== 'none' ? `text-shadow: ${shadow}` : null,
    ].filter(Boolean).join('; ');

    if (el.type === 'current') {
      css += `
.xl-el-${id} [data-xl="current"] {
  ${spanStyle};
  opacity: 0;
  transition: opacity ${el.fadeMs}ms ease-in-out;
}`;
      html += `<div class="xl-el-${id}">{{current}}</div>\n`;
    } else if (el.type === 'next') {
      css += `\n.xl-el-${id} [data-xl="next"] { ${spanStyle}; }`;
      html += `<div class="xl-el-${id}">{{next}}</div>\n`;
    } else if (el.type === 'section') {
      css += `\n.xl-el-${id} [data-xl="section"] { ${spanStyle}; }`;
      html += `<div class="xl-el-${id}">{{section}}</div>\n`;
    } else if (el.type === 'title') {
      css += `\n.xl-el-${id} [data-xl="song_title"] { ${spanStyle}; }`;
      html += `<div class="xl-el-${id}">{{song_title}}</div>\n`;
    } else if (el.type === 'static') {
      const escaped = el.staticText.replace(/</g,'&lt;').replace(/>/g,'&gt;');
      css += `\n.xl-el-${id} .xl-static { ${spanStyle}; }`;
      html += `<div class="xl-el-${id}"><span class="xl-static">${escaped}</span></div>\n`;
    } else if (el.type === 'clock') {
      css += `\n.xl-el-${id} .xl-clock { ${spanStyle}; }`;
      html += `<div class="xl-el-${id}"><span class="xl-clock" id="xl-clock-${id}">00:00:00</span></div>\n`;
    }
  }

  // Clock script if needed
  const hasClock = els.some(e => e.type === 'clock');
  const clockScript = hasClock ? `\n<script>
(function(){
  function tick(){
    var now=new Date();
    var h=String(now.getHours()).padStart(2,'0');
    var m=String(now.getMinutes()).padStart(2,'0');
    var s=String(now.getSeconds()).padStart(2,'0');
    var t=h+':'+m+':'+s;
    document.querySelectorAll('[class*="xl-clock"]').forEach(function(el){el.textContent=t;});
  }
  tick(); setInterval(tick,1000);
})();
<\/script>` : '';

  const meta = JSON.stringify({ name: layout.name, background: layout.background, elements: els });

  return `<!-- xl-editor-meta:${meta}-->
<!--
  xLyrics Layout: ${layout.name}
  Edit visually at /layout-editor.html
-->
<style>
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; cursor: none; background: ${layout.background}; }
${css}
</style>
${html.trim()}${clockScript}`;
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

/* ── Render ────────────────────────────────────────────────── */
function renderAll() {
  canvas.innerHTML = '';
  canvas.style.background = layout.background;
  document.getElementById('pp-bg-color').value = layout.background;
  document.getElementById('pp-bg-hex').value   = layout.background;
  for (const el of layout.elements) renderElement(el);
  updatePropsPanel();
}

function renderElement(el) {
  const div = document.createElement('div');
  div.className = 'le-el' + (el.id === selectedId ? ' selected' : '');
  div.dataset.id = el.id;
  applyElementStyle(div, el);

  // Preview text
  const span = document.createElement('span');
  span.className = 'le-el-preview';
  span.textContent = el.type === 'static' ? el.staticText : SAMPLE[el.type] || '';
  applyTextStyle(span, el);
  div.appendChild(span);

  if (el.id === selectedId) addHandles(div);
  canvas.appendChild(div);
  bindDrag(div, el);
}

function applyElementStyle(div, el) {
  const s = div.style;
  s.left   = el.x + '%';
  s.top    = el.y + '%';
  s.width  = el.w + '%';
  s.height = el.h + '%';
  s.justifyContent = el.alignItems;
  const hAlign = el.textAlign === 'left'  ? 'flex-start'
               : el.textAlign === 'right' ? 'flex-end'
               : 'center';
  s.alignItems = hAlign;
  s.paddingLeft = s.paddingRight = el.padX + 'px';
  s.paddingTop  = s.paddingBottom = el.padY + 'px';
  const bgRgb = hexToRgb(el.bgColor);
  s.background = el.bgOpacity > 0 ? `rgba(${bgRgb},${el.bgOpacity})` : 'transparent';
  s.border = el.borderWidth > 0 ? `${el.borderWidth}px solid ${el.borderColor}` : 'none';
  s.borderRadius = el.radius + 'px';
  s.opacity = el.opacity;
}

function applyTextStyle(span, el) {
  const s = span.style;
  s.fontFamily    = el.fontFamily;
  s.fontSize      = el.fontSize + 'px';
  s.fontWeight    = el.fontWeight;
  s.fontStyle     = el.fontStyle;
  s.color         = el.color;
  s.textAlign     = el.textAlign;
  s.lineHeight    = el.lineHeight;
  s.letterSpacing = el.letterSpacing + 'em';
  s.textShadow    = el.shadowOn
    ? `${el.shadowX}px ${el.shadowY}px ${el.shadowBlur}px ${el.shadowColor}`
    : 'none';
}

function addHandles(div) {
  for (const h of ['nw','n','ne','e','se','s','sw','w']) {
    const handle = document.createElement('div');
    handle.className = 'le-handle';
    handle.dataset.h = h;
    bindResize(handle, h);
    div.appendChild(handle);
  }
}

function refreshElement(el) {
  const existing = canvas.querySelector(`[data-id="${el.id}"]`);
  if (existing) existing.remove();
  renderElement(el);
}

/* ── Drag ──────────────────────────────────────────────────── */
let dragging = null;

function canvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width / CANVAS_W;
  return {
    x: (e.clientX - rect.left) / scale,
    y: (e.clientY - rect.top)  / scale,
  };
}

function bindDrag(div, el) {
  div.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('le-handle')) return;
    e.preventDefault();
    selectElement(el.id);
    const start = canvasCoords(e);
    const origX = el.x, origY = el.y;
    dragging = {
      move(e) {
        const cur = canvasCoords(e);
        el.x = clamp(origX + (cur.x - start.x) / CANVAS_W * 100, 0, 100 - el.w);
        el.y = clamp(origY + (cur.y - start.y) / CANVAS_H * 100, 0, 100 - el.h);
        const div2 = canvas.querySelector(`[data-id="${el.id}"]`);
        if (div2) { div2.style.left = el.x + '%'; div2.style.top = el.y + '%'; }
        syncPosInputs(el);
      },
      up() { snapshot(); },
    };
  });
}

function bindResize(handle, dir) {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const el = layout.elements.find(x => x.id === selectedId);
    if (!el) return;
    const start = canvasCoords(e);
    const orig = { x: el.x, y: el.y, w: el.w, h: el.h };
    dragging = {
      move(e) {
        const cur = canvasCoords(e);
        const dx = (cur.x - start.x) / CANVAS_W * 100;
        const dy = (cur.y - start.y) / CANVAS_H * 100;
        if (dir.includes('e')) el.w = Math.max(2, orig.w + dx);
        if (dir.includes('s')) el.h = Math.max(2, orig.h + dy);
        if (dir.includes('w')) { el.x = orig.x + dx; el.w = Math.max(2, orig.w - dx); }
        if (dir.includes('n')) { el.y = orig.y + dy; el.h = Math.max(2, orig.h - dy); }
        refreshElement(el);
        syncPosInputs(el);
      },
      up() { snapshot(); },
    };
  });
}

document.addEventListener('mousemove', (e) => { if (dragging) dragging.move(e); });
document.addEventListener('mouseup',   (e) => { if (dragging) { dragging.up(); dragging = null; } });

// Click canvas background → deselect
canvas.addEventListener('mousedown', (e) => {
  if (e.target === canvas) {
    selectedId = null;
    canvas.querySelectorAll('.le-el').forEach(d => d.classList.remove('selected'));
    canvas.querySelectorAll('.le-handle').forEach(h => h.remove());
    updatePropsPanel();
  }
});

/* ── Selection ─────────────────────────────────────────────── */
function selectElement(id) {
  selectedId = id;
  canvas.querySelectorAll('.le-el').forEach(d => {
    const sel = d.dataset.id === id;
    d.classList.toggle('selected', sel);
    d.querySelectorAll('.le-handle').forEach(h => h.remove());
    if (sel) addHandles(d);
  });
  updatePropsPanel();
}

/* ── Add / delete elements ─────────────────────────────────── */
function addElement(type) {
  const el = { ...ELEMENT_DEFAULTS, id: uid(), type };
  // Sensible per-type defaults
  if (type === 'next' || type === 'section' || type === 'title') {
    el.fontSize = type === 'section' ? 28 : 24;
    el.y = type === 'next' ? 88 : (type === 'section' ? 4 : 4);
    el.h = 8;
  }
  if (type === 'clock') { el.fontSize = 32; el.x = 72; el.y = 2; el.w = 26; el.h = 8; }
  if (type === 'static') { el.fontSize = 32; el.staticText = 'Text'; }
  layout.elements.push(el);
  renderElement(el);
  selectElement(el.id);
  snapshot();
}

function deleteSelected() {
  if (!selectedId) return;
  layout.elements = layout.elements.filter(e => e.id !== selectedId);
  const div = canvas.querySelector(`[data-id="${selectedId}"]`);
  if (div) div.remove();
  selectedId = null;
  updatePropsPanel();
  snapshot();
}

/* ── Properties panel ──────────────────────────────────────── */
function updatePropsPanel() {
  const el = selectedId ? layout.elements.find(x => x.id === selectedId) : null;
  propsEmpty.style.display = (!el && !layout) ? '' : 'none';
  propsPage.classList.toggle('hidden', !!el);
  propsEl.classList.toggle('hidden', !el);
  document.getElementById('le-delete-el').disabled = !el;

  if (el) populateElProps(el);
}

function populateElProps(el) {
  document.getElementById('ep-heading').textContent = ELEMENT_LABELS[el.type] || el.type;

  // Position
  document.getElementById('ep-x').value = el.x.toFixed(1);
  document.getElementById('ep-y').value = el.y.toFixed(1);
  document.getElementById('ep-w').value = el.w.toFixed(1);
  document.getElementById('ep-h').value = el.h.toFixed(1);

  // Alignment buttons
  setActiveBtn('ep-text-align', el.textAlign);
  setActiveBtn('ep-valign',     el.alignItems);

  // Font
  document.getElementById('ep-font-family').value   = el.fontFamily;
  document.getElementById('ep-font-size').value      = el.fontSize;
  document.getElementById('ep-font-weight').value    = el.fontWeight;
  document.getElementById('ep-italic').checked       = el.fontStyle === 'italic';
  syncColorPair(document.getElementById('ep-color'), document.getElementById('ep-color-hex'), el.color);
  setSlider('ep-line-height',     'ep-line-height-val',    el.lineHeight);
  setSlider('ep-letter-spacing',  'ep-letter-spacing-val', el.letterSpacing);

  // Shadow
  document.getElementById('ep-shadow-on').checked = el.shadowOn;
  syncColorPair(document.getElementById('ep-shadow-color'), document.getElementById('ep-shadow-color-hex'), el.shadowColor);
  document.getElementById('ep-shadow-x').value    = el.shadowX;
  document.getElementById('ep-shadow-y').value    = el.shadowY;
  document.getElementById('ep-shadow-blur').value = el.shadowBlur;
  document.querySelector('.le-shadow-fields').style.display = el.shadowOn ? '' : 'none';

  // Box
  syncColorPair(document.getElementById('ep-bg-color'), document.getElementById('ep-bg-color-hex'), el.bgColor);
  document.getElementById('ep-bg-opacity').value = el.bgOpacity;
  document.getElementById('ep-bg-opacity-val').textContent = Math.round(el.bgOpacity * 100) + '%';
  document.getElementById('ep-pad-x').value      = el.padX;
  document.getElementById('ep-pad-y').value      = el.padY;
  document.getElementById('ep-radius').value     = el.radius;
  syncColorPair(document.getElementById('ep-border-color'), document.getElementById('ep-border-color-hex'), el.borderColor);
  document.getElementById('ep-border-width').value = el.borderWidth;
  document.getElementById('ep-opacity').value    = el.opacity;
  document.getElementById('ep-opacity-val').textContent = Math.round(el.opacity * 100) + '%';

  // Static text
  document.getElementById('ep-static-group').style.display = el.type === 'static' ? '' : 'none';
  document.getElementById('ep-static-text').value = el.staticText || '';

  // Fade (only for 'current')
  document.getElementById('ep-fade-group').style.display = el.type === 'current' ? '' : 'none';
  setSlider('ep-fade', 'ep-fade-val', el.fadeMs);
}

function setActiveBtn(groupId, val) {
  document.getElementById(groupId).querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.val === val);
  });
}

function setSlider(sliderId, valId, val) {
  document.getElementById(sliderId).value = val;
  document.getElementById(valId).value   = val;
}

function syncPosInputs(el) {
  document.getElementById('ep-x').value = el.x.toFixed(1);
  document.getElementById('ep-y').value = el.y.toFixed(1);
  document.getElementById('ep-w').value = el.w.toFixed(1);
  document.getElementById('ep-h').value = el.h.toFixed(1);
}

/* ── Property change handlers ──────────────────────────────── */
function withEl(fn) {
  const el = selectedId ? layout.elements.find(x => x.id === selectedId) : null;
  if (!el) return;
  fn(el);
  refreshElement(el);
  isDirty = true;
  updateCodePanel();
}

function bindPropInput(id, key, parse) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => withEl(x => { x[key] = parse ? parse(el.value) : el.value; }));
  el.addEventListener('change', () => { snapshot(); updateStatus(); });
}

function bindColorPair(pickerId, hexId, key) {
  const picker = document.getElementById(pickerId);
  const hex    = document.getElementById(hexId);
  picker.addEventListener('input', () => {
    hex.value = picker.value;
    withEl(el => { el[key] = picker.value; });
  });
  picker.addEventListener('change', () => snapshot());
  hex.addEventListener('change', () => {
    if (/^#[0-9a-f]{6}$/i.test(hex.value)) {
      picker.value = hex.value;
      withEl(el => { el[key] = hex.value; });
      snapshot();
    }
  });
}

function bindSliderPair(sliderId, numId, key, parse) {
  const slider = document.getElementById(sliderId);
  const num    = document.getElementById(numId);
  const update = (val) => withEl(el => { el[key] = parse ? parse(val) : Number(val); });
  slider.addEventListener('input', () => { num.value = slider.value; update(slider.value); });
  slider.addEventListener('change', () => snapshot());
  num.addEventListener('change',   () => { slider.value = num.value; update(num.value); snapshot(); });
}

function bindBtnGroup(groupId, key) {
  document.getElementById(groupId).querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      setActiveBtn(groupId, btn.dataset.val);
      withEl(el => { el[key] = btn.dataset.val; });
      snapshot();
    });
  });
}

// Wire up all controls
bindBtnGroup('ep-text-align', 'textAlign');
bindBtnGroup('ep-valign',     'alignItems');

bindPropInput('ep-x',         'x',        Number);
bindPropInput('ep-y',         'y',        Number);
bindPropInput('ep-w',         'w',        Number);
bindPropInput('ep-h',         'h',        Number);
document.querySelectorAll('#ep-x,#ep-y,#ep-w,#ep-h').forEach(i => {
  i.addEventListener('change', () => snapshot());
});

bindPropInput('ep-font-family',   'fontFamily');
bindPropInput('ep-font-size',     'fontSize',     Number);
bindPropInput('ep-font-weight',   'fontWeight');
document.getElementById('ep-font-family').addEventListener('change',  () => snapshot());
document.getElementById('ep-font-size').addEventListener('change',    () => snapshot());
document.getElementById('ep-font-weight').addEventListener('change',  () => snapshot());
document.getElementById('ep-italic').addEventListener('change', () => {
  withEl(el => { el.fontStyle = document.getElementById('ep-italic').checked ? 'italic' : 'normal'; });
  snapshot();
});
bindColorPair('ep-color', 'ep-color-hex', 'color');
bindSliderPair('ep-line-height',    'ep-line-height-val',    'lineHeight',    Number);
bindSliderPair('ep-letter-spacing', 'ep-letter-spacing-val', 'letterSpacing', Number);

document.getElementById('ep-shadow-on').addEventListener('change', () => {
  withEl(el => { el.shadowOn = document.getElementById('ep-shadow-on').checked; });
  document.querySelector('.le-shadow-fields').style.display = document.getElementById('ep-shadow-on').checked ? '' : 'none';
  snapshot();
});
bindColorPair('ep-shadow-color', 'ep-shadow-color-hex', 'shadowColor');
bindPropInput('ep-shadow-x',    'shadowX',    Number);
bindPropInput('ep-shadow-y',    'shadowY',    Number);
bindPropInput('ep-shadow-blur', 'shadowBlur', Number);
document.querySelectorAll('#ep-shadow-x,#ep-shadow-y,#ep-shadow-blur').forEach(i => {
  i.addEventListener('change', () => snapshot());
});

bindColorPair('ep-bg-color', 'ep-bg-color-hex', 'bgColor');
document.getElementById('ep-bg-opacity').addEventListener('input', () => {
  const v = document.getElementById('ep-bg-opacity').value;
  document.getElementById('ep-bg-opacity-val').textContent = Math.round(v * 100) + '%';
  withEl(el => { el.bgOpacity = Number(v); });
});
document.getElementById('ep-bg-opacity').addEventListener('change', () => snapshot());

bindPropInput('ep-pad-x',  'padX',  Number);
bindPropInput('ep-pad-y',  'padY',  Number);
bindPropInput('ep-radius', 'radius',Number);
document.querySelectorAll('#ep-pad-x,#ep-pad-y,#ep-radius').forEach(i => i.addEventListener('change', () => snapshot()));

bindColorPair('ep-border-color', 'ep-border-color-hex', 'borderColor');
bindPropInput('ep-border-width', 'borderWidth', Number);
document.getElementById('ep-border-width').addEventListener('change', () => snapshot());

document.getElementById('ep-opacity').addEventListener('input', () => {
  const v = document.getElementById('ep-opacity').value;
  document.getElementById('ep-opacity-val').textContent = Math.round(v * 100) + '%';
  withEl(el => { el.opacity = Number(v); });
});
document.getElementById('ep-opacity').addEventListener('change', () => snapshot());

document.getElementById('ep-static-text').addEventListener('input', () => {
  withEl(el => { el.staticText = document.getElementById('ep-static-text').value; });
});
document.getElementById('ep-static-text').addEventListener('change', () => snapshot());

bindSliderPair('ep-fade', 'ep-fade-val', 'fadeMs', Number);

// Page background
function bindPageBg() {
  const picker = document.getElementById('pp-bg-color');
  const hex    = document.getElementById('pp-bg-hex');
  const apply = (val) => {
    layout.background = val;
    canvas.style.background = val;
    isDirty = true;
    updateCodePanel();
  };
  picker.addEventListener('input',  () => { hex.value = picker.value; apply(picker.value); });
  picker.addEventListener('change', () => snapshot());
  hex.addEventListener('change', () => {
    if (/^#[0-9a-f]{6}$/i.test(hex.value)) {
      picker.value = hex.value;
      apply(hex.value);
      snapshot();
    }
  });
  document.querySelectorAll('.le-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const col = btn.dataset.bg;
      picker.value = col; hex.value = col;
      apply(col); snapshot();
    });
  });
}
bindPageBg();

document.getElementById('pp-layout-name').addEventListener('input', () => {
  layout.name = document.getElementById('pp-layout-name').value.trim();
});

/* ── Code panel ────────────────────────────────────────────── */
function updateCodePanel() {
  if (!codePanel.classList.contains('hidden')) {
    codePre.textContent = generateXlayout();
  }
}

document.getElementById('le-code-toggle').addEventListener('click', () => {
  codePanel.classList.toggle('hidden');
  if (!codePanel.classList.contains('hidden')) updateCodePanel();
});
document.getElementById('le-code-close').addEventListener('click', () => codePanel.classList.add('hidden'));
document.getElementById('le-code-copy').addEventListener('click', () => {
  navigator.clipboard.writeText(codePre.textContent)
    .then(() => { setStatus('Copied!'); setTimeout(() => updateStatus(), 1500); })
    .catch(() => {});
});

/* ── Toolbar buttons ───────────────────────────────────────── */
document.querySelectorAll('.le-add-el').forEach(btn => {
  btn.addEventListener('click', () => addElement(btn.dataset.type));
});

document.getElementById('le-delete-el').addEventListener('click', deleteSelected);

document.getElementById('le-save').addEventListener('click', saveLayout);
document.getElementById('le-undo').addEventListener('click', undo);
document.getElementById('le-redo').addEventListener('click', redo);

layoutSelect.addEventListener('change', () => {
  if (layoutSelect.value) loadLayout(layoutSelect.value);
});

document.getElementById('le-new').addEventListener('click', () => {
  document.getElementById('le-name-input').value = '';
  nameDialog.classList.remove('hidden');
  document.getElementById('le-name-input').focus();
});
document.getElementById('le-name-cancel').addEventListener('click', () => nameDialog.classList.add('hidden'));
document.getElementById('le-name-ok').addEventListener('click', () => {
  const name = document.getElementById('le-name-input').value.trim().replace(/[^a-z0-9 _\-]/gi,'');
  if (!name) return;
  nameDialog.classList.add('hidden');
  newLayout(name);
});
document.getElementById('le-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('le-name-ok').click();
  if (e.key === 'Escape') nameDialog.classList.add('hidden');
});

/* ── Keyboard shortcuts ────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveLayout(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { deleteSelected(); return; }
  // Arrow nudge selected element
  if (selectedId && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
    const el = layout.elements.find(x => x.id === selectedId);
    if (!el) return;
    const step = e.shiftKey ? 1 : 0.1;
    if (e.key === 'ArrowLeft')  el.x = clamp(el.x - step, 0, 100 - el.w);
    if (e.key === 'ArrowRight') el.x = clamp(el.x + step, 0, 100 - el.w);
    if (e.key === 'ArrowUp')    el.y = clamp(el.y - step, 0, 100 - el.h);
    if (e.key === 'ArrowDown')  el.y = clamp(el.y + step, 0, 100 - el.h);
    refreshElement(el);
    syncPosInputs(el);
    snapshot();
  }
});

/* ── Theme (inherit from control page localStorage key) ─────── */
(function initTheme() {
  try {
    const t = localStorage.getItem('xlyrics.theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch {}
})();

/* ── Boot ──────────────────────────────────────────────────── */
(async function init() {
  scaleCanvas();
  await loadLayoutList();
  // Start with an empty layout ready to use.
  newLayout('');
  history = [JSON.stringify(layout)];
  historyIdx = 0;
  updateStatus();
})();
