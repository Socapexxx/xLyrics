/* ---------------- State ---------------- */
let songs = [];
let currentSong = null;
let playlistIndex = -1;
let lastState = null;

let playlists = [];
let currentPlaylist = null;

let config = { sections: [], outputs: [] };
let availableLayouts = [];
let hotkeyMap = {};

// Arrangement state (non-destructive editing)
let currentArrangementName = 'default';
let localSequence = [];
let savedSequence = [];
let localPlaylist = [];

/* ---------------- DOM ---------------- */
const $ = (id) => document.getElementById(id);
const songsList = $('songs-list');
const playlistSongsList = $('playlist-songs-list');
const songSearch = $('song-search');
const playlistSearch = $('playlist-search');
const browserSort = $('browser-sort');
const playlistSelect = $('playlist-select');
const playlistNewBtn = $('playlist-new');
const structureList = $('structure-list');
const arrangementChipsEl = $('arrangement-chips');
const arrangementBar = $('arrangement-bar');
const arrangementExpand = $('arrangement-expand');
const arrangementSelector = $('arrangement-selector');
const arrangementNameEl = $('arrangement-name');
const dirtyIndicator = $('dirty-indicator');
const sidePreviews = $('side-previews');
const outputLinks = $('output-links');
const statusBar = $('status-bar');
const fadeSlider = $('fade-slider');
const fadeValue = $('fade-value');
const splitter = $('splitter');
const mainEl = document.querySelector('main');

/* ---------------- Utils ---------------- */
const DEFAULT_COLOR = '#5b8fd8';

function sectionSlug(name) {
  return String(name || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function colorForSection(name) {
  if (!name) return DEFAULT_COLOR;
  const lc = name.toLowerCase();
  let best = null;
  for (const entry of config.sections) {
    const elc = entry.name.toLowerCase();
    if (lc === elc) return entry.color || DEFAULT_COLOR;
    if (lc.startsWith(elc)) {
      if (!best || elc.length > best.name.length) best = entry;
    }
  }
  return (best && best.color) || DEFAULT_COLOR;
}

function applySectionColorStyle(el, name) {
  el.style.setProperty('--accent', colorForSection(name));
}

function arrangementDisplayName(n) {
  return (!n || n.toLowerCase() === 'default') ? 'Default' : n;
}

function isDirty() {
  return JSON.stringify(localSequence) !== JSON.stringify(savedSequence);
}

/* ---------------- Splitter ---------------- */
const SIDE_KEY = 'xlyrics.sideWidth';
const storedWidth = Number(localStorage.getItem(SIDE_KEY));
if (storedWidth > 0) mainEl.style.setProperty('--side-width', storedWidth + 'px');

let draggingSplitter = false;
splitter.addEventListener('mousedown', (e) => {
  draggingSplitter = true;
  splitter.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!draggingSplitter) return;
  const rect = mainEl.getBoundingClientRect();
  const width = Math.max(240, Math.min(640, rect.right - e.clientX));
  mainEl.style.setProperty('--side-width', width + 'px');
});
window.addEventListener('mouseup', () => {
  if (!draggingSplitter) return;
  draggingSplitter = false;
  splitter.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  const w = (mainEl.style.getPropertyValue('--side-width') || '').replace('px', '').trim();
  if (w) localStorage.setItem(SIDE_KEY, w);
});

/* ---------------- Tabs (left pane) ---------------- */
document.querySelectorAll('.tab-bar .tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.tab;
    document.querySelectorAll('.tab-bar .tab').forEach((t) => t.classList.toggle('active', t === btn));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.toggle('hidden', c.dataset.tab !== name));
  });
});

/* ---------------- Songs ---------------- */
async function loadSongs() {
  const res = await fetch('/api/songs');
  songs = await res.json();
  renderBrowser();
  renderPlaylistSongs();
}

function matchFilter(song, filter) {
  if (!filter) return true;
  return (
    (song.title || '').toLowerCase().includes(filter) ||
    (song.artist || '').toLowerCase().includes(filter)
  );
}

function folderOf(id) {
  const i = id.lastIndexOf('/');
  return i >= 0 ? id.slice(0, i) : '/';
}

function songListItem(s, opts = {}) {
  const li = document.createElement('li');
  const title = document.createElement('span');
  title.className = 'song-title';
  title.textContent = s.title;
  li.appendChild(title);
  if (s.artist) {
    const a = document.createElement('span');
    a.className = 'artist';
    a.textContent = s.artist;
    li.appendChild(a);
  }
  if (opts.action === 'add') {
    const btn = document.createElement('button');
    btn.className = 'song-action add';
    btn.textContent = '+';
    btn.title = 'Add to playlist…';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openAddToPlaylistMenu(btn, s.id);
    });
    li.appendChild(btn);
  } else if (opts.action === 'remove') {
    const btn = document.createElement('button');
    btn.className = 'song-action remove';
    btn.textContent = '×';
    btn.title = 'Remove from playlist';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromCurrentPlaylist(s.id);
    });
    li.appendChild(btn);
  }
  if (currentSong && currentSong.id === s.id) li.classList.add('active');
  li.addEventListener('click', (e) => {
    if (e.target.classList.contains('song-action')) return;
    selectSong(s.id);
  });
  return li;
}

function renderBrowser() {
  const mode = browserSort.value;
  const filter = (songSearch.value || '').toLowerCase();
  const filtered = songs.filter((s) => matchFilter(s, filter));
  songsList.innerHTML = '';

  const groupAndRender = (keyFn) => {
    const groups = new Map();
    for (const s of filtered) {
      const k = keyFn(s) || '(unknown)';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    [...groups.keys()].sort((a, b) => a.localeCompare(b)).forEach((k) => {
      const header = document.createElement('li');
      header.className = 'group-header';
      header.textContent = k;
      songsList.appendChild(header);
      groups.get(k).forEach((s) => songsList.appendChild(songListItem(s, { action: 'add' })));
    });
  };

  if (mode === 'artist') groupAndRender((s) => s.artist);
  else if (mode === 'folder') groupAndRender((s) => folderOf(s.id));
  else filtered.forEach((s) => songsList.appendChild(songListItem(s, { action: 'add' })));
}

async function selectSong(id) {
  const res = await fetch('/api/song/' + encodeURIComponent(id));
  if (!res.ok) return;
  currentSong = await res.json();
  loadArrangement('default');
  playlistIndex = -1;
  renderBrowser();
  renderPlaylistSongs();
  renderArrangement();
  renderStructure();
  updateStatus();
}

/* ---------------- Arrangements (non-destructive) ---------------- */
function loadArrangement(name) {
  if (!currentSong) return;
  const arr = currentSong.arrangements.find((a) => a.name.toLowerCase() === name.toLowerCase())
    || currentSong.arrangements.find((a) => a.name === 'default')
    || currentSong.arrangements[0];
  if (!arr) return;
  currentArrangementName = arr.name;
  savedSequence = [...arr.sequence];
  localSequence = [...arr.sequence];
  rebuildLocalPlaylist();
}

function rebuildLocalPlaylist() {
  if (!currentSong) { localPlaylist = []; return; }
  const byName = new Map();
  for (const s of currentSong.sections) byName.set(s.name.toLowerCase(), s);
  const out = [];
  localSequence.forEach((name, arrIndex) => {
    const section = byName.get(name.toLowerCase());
    if (!section) return;
    section.frames.forEach((frame, frameIndex) => {
      out.push({
        arrIndex,
        sectionName: section.name,
        frameIndex,
        totalFrames: section.frames.length,
        content: Array.isArray(frame) ? frame.join('\n') : String(frame),
      });
    });
  });
  localPlaylist = out;
}

function switchArrangement(name) {
  if (isDirty()) {
    if (!confirm(`Discard unsaved changes to "${arrangementDisplayName(currentArrangementName)}"?`)) return;
  }
  loadArrangement(name);
  playlistIndex = -1;
  renderArrangement();
  renderStructure();
  updateStatus();
}

async function saveCurrentArrangement() {
  if (!currentSong) { alert('Select a song first.'); return; }
  const defaultName = arrangementDisplayName(currentArrangementName);
  const input = prompt('Save arrangement as:', defaultName);
  if (input === null) return;
  const name = input.trim();
  if (!name) { alert('Please enter a name.'); return; }

  const saveAs = (name.toLowerCase() === 'default') ? 'default' : name;
  const existing = currentSong.arrangements.find((a) => a.name.toLowerCase() === saveAs.toLowerCase());
  if (existing && existing.name.toLowerCase() !== currentArrangementName.toLowerCase()) {
    if (!confirm(`Overwrite existing arrangement "${name}"?`)) return;
  }

  try {
    const res = await fetch(`/api/song/${encodeURIComponent(currentSong.id)}/arrangement`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: saveAs, sequence: localSequence }),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch {}
      alert('Save failed: ' + msg);
      return;
    }
    const data = await res.json();
    currentSong = data.song;
    currentArrangementName = saveAs;
    savedSequence = [...localSequence];
    renderArrangement();
    renderStructure();
    updateStatus();
  } catch (err) {
    alert('Save failed: ' + err.message);
    console.error('saveCurrentArrangement', err);
  }
}

function renderArrangement() {
  arrangementChipsEl.innerHTML = '';
  arrangementNameEl.textContent = arrangementDisplayName(currentArrangementName);
  dirtyIndicator.classList.toggle('hidden', !isDirty());

  if (!currentSong) return;

  const activeArr = (playlistIndex >= 0 && localPlaylist[playlistIndex])
    ? localPlaylist[playlistIndex].arrIndex : -1;

  localSequence.forEach((name, idx) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    applySectionColorStyle(chip, name);
    if (idx === activeArr) chip.classList.add('active');
    chip.textContent = name;
    chip.draggable = true;
    chip.dataset.idx = String(idx);

    const remove = document.createElement('span');
    remove.className = 'chip-remove';
    remove.textContent = '×';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      removeArrangementAt(idx);
    });
    chip.appendChild(remove);

    chip.addEventListener('click', () => jumpToArrangementIndex(idx));

    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    chip.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = chip.getBoundingClientRect();
      const isRight = e.clientX > rect.left + rect.width / 2;
      chip.classList.toggle('drop-before', !isRight);
      chip.classList.toggle('drop-after', isRight);
    });
    chip.addEventListener('dragleave', () => chip.classList.remove('drop-before', 'drop-after'));
    chip.addEventListener('drop', (e) => {
      e.preventDefault();
      chip.classList.remove('drop-before', 'drop-after');
      const fromIdx = Number(e.dataTransfer.getData('text/plain'));
      if (!Number.isFinite(fromIdx) || fromIdx === idx) return;
      const rect = chip.getBoundingClientRect();
      const isRight = e.clientX > rect.left + rect.width / 2;
      let to = isRight ? idx + 1 : idx;
      const arr = [...localSequence];
      const [moved] = arr.splice(fromIdx, 1);
      if (fromIdx < to) to--;
      arr.splice(to, 0, moved);
      applyLocalArrangement(arr);
    });

    arrangementChipsEl.appendChild(chip);
  });

  const add = document.createElement('button');
  add.className = 'chip-add';
  add.textContent = '+';
  add.title = 'Add section';
  add.addEventListener('click', (e) => { e.stopPropagation(); openAddMenu(add); });
  arrangementChipsEl.appendChild(add);
}

function removeArrangementAt(idx) {
  const arr = [...localSequence];
  arr.splice(idx, 1);
  applyLocalArrangement(arr);
}

function applyLocalArrangement(arr) {
  const prevEntry = playlistIndex >= 0 ? localPlaylist[playlistIndex] : null;
  localSequence = arr;
  rebuildLocalPlaylist();
  if (prevEntry) {
    const idx = localPlaylist.findIndex(
      (e) => e.sectionName === prevEntry.sectionName && e.frameIndex === prevEntry.frameIndex
    );
    playlistIndex = idx;
  } else {
    playlistIndex = -1;
  }
  renderArrangement();
  renderStructure();
  updateStatus();
}

function jumpToArrangementIndex(arrIdx) {
  if (!currentSong) return;
  const target = localPlaylist.findIndex((e) => e.arrIndex === arrIdx && e.frameIndex === 0);
  if (target >= 0) goTo(target);
}

/* Arrangement picker popover */
function openArrangementMenu() {
  const menu = ensureMenu();
  menu.innerHTML = '';
  if (!currentSong) {
    const empty = document.createElement('div');
    empty.className = 'add-menu-empty';
    empty.textContent = 'Select a song first';
    menu.appendChild(empty);
  } else {
    currentSong.arrangements.forEach((a) => {
      const item = document.createElement('div');
      item.className = 'add-menu-item';
      if (a.name === currentArrangementName) item.classList.add('current');
      item.textContent = arrangementDisplayName(a.name);
      item.addEventListener('click', () => {
        hideMenu();
        switchArrangement(a.name);
      });
      menu.appendChild(item);
    });
    const divider = document.createElement('div');
    divider.className = 'menu-divider';
    menu.appendChild(divider);
    const save = document.createElement('div');
    save.className = 'add-menu-item menu-action';
    save.textContent = 'Save arrangement as…';
    save.addEventListener('click', () => { hideMenu(); saveCurrentArrangement(); });
    menu.appendChild(save);
  }
  positionMenu(menu, arrangementSelector);
  menu.classList.remove('hidden');
  menu.dataset.kind = 'arrangement';
}

/* Add-section popover */
function openAddMenu(anchor) {
  const menu = ensureMenu();
  menu.innerHTML = '';
  if (!currentSong) return;
  const uniqueNames = [...new Set(currentSong.sections.map((s) => s.name))];
  if (uniqueNames.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'add-menu-empty';
    empty.textContent = 'No sections in this song';
    menu.appendChild(empty);
  } else {
    uniqueNames.forEach((name) => {
      const item = document.createElement('div');
      item.className = 'add-menu-item';
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.setProperty('--accent', colorForSection(name));
      item.appendChild(swatch);
      const label = document.createElement('span');
      label.textContent = name;
      item.appendChild(label);
      item.addEventListener('click', () => {
        hideMenu();
        applyLocalArrangement([...localSequence, name]);
      });
      menu.appendChild(item);
    });
  }
  positionMenu(menu, anchor);
  menu.classList.remove('hidden');
  menu.dataset.kind = 'add';
}

function ensureMenu() {
  let menu = $('floating-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'floating-menu';
    menu.className = 'add-menu hidden';
    document.body.appendChild(menu);
  }
  return menu;
}
function positionMenu(menu, anchor) {
  const rect = anchor.getBoundingClientRect();
  menu.style.left = rect.left + 'px';
  menu.style.top = rect.bottom + 4 + 'px';
}
function hideMenu() {
  const menu = $('floating-menu');
  if (menu) menu.classList.add('hidden');
}
document.addEventListener('click', (e) => {
  const menu = $('floating-menu');
  if (!menu || menu.classList.contains('hidden')) return;
  if (menu.contains(e.target)) return;
  if (e.target === arrangementSelector || arrangementSelector.contains(e.target)) return;
  if (e.target.classList && e.target.classList.contains('chip-add')) return;
  hideMenu();
});

arrangementSelector.addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('floating-menu');
  if (menu && !menu.classList.contains('hidden') && menu.dataset.kind === 'arrangement') {
    hideMenu();
  } else {
    openArrangementMenu();
  }
});
arrangementExpand.addEventListener('click', () => arrangementBar.classList.toggle('expanded'));

/* ---------------- Structure (tiles) ---------------- */
function renderStructure() {
  structureList.innerHTML = '';
  if (!currentSong) return;

  localSequence.forEach((name, arrIdx) => {
    const group = document.createElement('div');
    group.className = 'section-group';

    const header = document.createElement('div');
    header.className = 'section-name';
    applySectionColorStyle(header, name);
    header.textContent = `${arrIdx + 1}. ${name}`;
    group.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'frame-grid';

    localPlaylist.forEach((entry, pIdx) => {
      if (entry.arrIndex !== arrIdx) return;
      const tile = document.createElement('div');
      tile.className = 'frame-tile';
      applySectionColorStyle(tile, name);
      if (pIdx === playlistIndex) tile.classList.add('active');

      const num = document.createElement('span');
      num.className = 'frame-num';
      num.textContent = entry.frameIndex + 1;
      tile.appendChild(num);

      const content = document.createElement('div');
      content.className = 'tile-content';
      content.textContent = entry.content;
      tile.appendChild(content);

      tile.addEventListener('click', () => goTo(pIdx));
      grid.appendChild(tile);
    });

    group.appendChild(grid);
    structureList.appendChild(group);
  });
}

/* ---------------- Playback ---------------- */
async function goTo(index) {
  if (!currentSong) return;
  if (index < 0 || index >= localPlaylist.length) return;
  const entry = localPlaylist[index];
  const nextEntry = localPlaylist[index + 1];
  const res = await fetch('/api/display/update', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      songId: currentSong.id,
      songTitle: currentSong.header.title || currentSong.id,
      sectionName: entry.sectionName,
      arrIndex: entry.arrIndex,
      frameIndex: entry.frameIndex,
      content: entry.content,
      nextContent: nextEntry ? nextEntry.content : '',
    }),
  });
  if (!res.ok) return;
  playlistIndex = index;
  renderArrangement();
  renderStructure();
  updateStatus();
}

function next() {
  if (!currentSong) return;
  const target = Math.min(playlistIndex < 0 ? 0 : playlistIndex + 1, localPlaylist.length - 1);
  if (target !== playlistIndex) goTo(target);
}
function prev() {
  if (!currentSong || playlistIndex <= 0) return;
  goTo(playlistIndex - 1);
}
async function clearScreen() {
  await fetch('/api/display/clear', { method: 'POST' });
  updateStatus();
}
function home() { if (currentSong) goTo(0); }

function sectionStart() {
  if (!currentSong || playlistIndex < 0) return;
  const curArr = localPlaylist[playlistIndex].arrIndex;
  const target = localPlaylist.findIndex((e) => e.arrIndex === curArr && e.frameIndex === 0);
  if (target >= 0) goTo(target);
}

/* ---------------- Section-jump hotkeys ---------------- */
function rebuildHotkeyMap() {
  hotkeyMap = {};
  for (const entry of config.sections) {
    if (entry.hotkey) hotkeyMap[entry.hotkey.toLowerCase()] = entry.name;
  }
}

function sectionJump(targetName) {
  if (!currentSong) return false;
  const lc = targetName.toLowerCase();
  const occurrences = [];
  localPlaylist.forEach((entry, pIdx) => {
    if (entry.frameIndex !== 0) return;
    const s = (entry.sectionName || '').toLowerCase();
    if (s === lc || s.startsWith(lc) || lc.startsWith(s)) occurrences.push(pIdx);
  });
  if (occurrences.length === 0) return false;
  const nextIdx = occurrences.find((o) => o > playlistIndex);
  goTo(nextIdx !== undefined ? nextIdx : occurrences[0]);
  return true;
}

/* ---------------- Status ---------------- */
function updateStatus() {
  if (!currentSong) { statusBar.textContent = 'No song loaded'; return; }
  const title = currentSong.header.title || currentSong.id;
  const cleared = lastState && lastState.cleared;
  const prefix = cleared ? '<span class="cleared-tag">⏸ cleared</span>' : '';
  if (playlistIndex < 0) {
    statusBar.innerHTML = `${prefix}${escapeHtml(title)} · ready`;
    return;
  }
  const entry = localPlaylist[playlistIndex];
  const frames = localPlaylist.filter((e) => e.arrIndex === entry.arrIndex).length;
  statusBar.innerHTML =
    `${prefix}${escapeHtml(title)} · ${escapeHtml(entry.sectionName)} · frame ${entry.frameIndex + 1}/${frames} · step ${playlistIndex + 1}/${localPlaylist.length}`;
}

/* ---------------- Tile size ---------------- */
const TILE_SIZE_KEY = 'xlyrics.tileFontSize';
const TILE_MIN = 10;
const TILE_MAX = 32;
const TILE_DEFAULT = 14;
function applyTileSize(v) {
  document.documentElement.style.setProperty('--tile-font-size', v + 'px');
}
(function initTileSize() {
  const slider = $('tile-size-slider');
  const valueInput = $('tile-size-value');
  if (!slider) return;
  const saved = Number(localStorage.getItem(TILE_SIZE_KEY));
  const initial = Number.isFinite(saved) && saved >= TILE_MIN && saved <= TILE_MAX ? saved : TILE_DEFAULT;
  slider.value = initial;
  if (valueInput) valueInput.value = initial;
  applyTileSize(initial);

  function set(v) {
    const clamped = Math.max(TILE_MIN, Math.min(TILE_MAX, Math.round(v)));
    slider.value = clamped;
    if (valueInput) valueInput.value = clamped;
    applyTileSize(clamped);
    localStorage.setItem(TILE_SIZE_KEY, String(clamped));
  }
  slider.addEventListener('input', () => set(Number(slider.value)));
  if (valueInput) valueInput.addEventListener('input', () => {
    const v = Number(valueInput.value);
    if (Number.isFinite(v)) set(v);
  });
})();

/* ---------------- Output previews ---------------- */
const VISIBLE_KEY = 'xlyrics.visiblePreviews';

function loadVisiblePreviews() {
  try {
    const raw = localStorage.getItem(VISIBLE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch { /* ignore */ }
  return ['main'];
}
function saveVisiblePreviews(ids) {
  localStorage.setItem(VISIBLE_KEY, JSON.stringify(ids));
}

function renderOutputPreviews() {
  sidePreviews.innerHTML = '';
  outputLinks.innerHTML = '';
  if (!config.outputs || config.outputs.length === 0) return;

  let visible = loadVisiblePreviews().filter((id) => config.outputs.some((o) => o.id === id));
  if (visible.length === 0 && config.outputs.length > 0) {
    visible = [config.outputs.find((o) => o.id === 'main')?.id || config.outputs[0].id];
  }
  saveVisiblePreviews(visible);

  for (const id of visible) {
    const out = config.outputs.find((o) => o.id === id);
    if (!out) continue;
    sidePreviews.appendChild(buildPreviewBlock(out));
  }

  const hidden = config.outputs.filter((o) => !visible.includes(o.id));
  if (hidden.length > 0) {
    const add = document.createElement('button');
    add.className = 'add-preview-btn';
    add.textContent = '+ Add preview';
    add.addEventListener('click', (e) => {
      e.stopPropagation();
      openAddPreviewMenu(add, hidden);
    });
    sidePreviews.appendChild(add);
  }

  for (const out of config.outputs) {
    const link = document.createElement('a');
    link.className = 'link';
    link.href = '/' + out.path;
    link.target = '_blank';
    link.textContent = `${out.name} ↗`;
    outputLinks.appendChild(link);
  }
}

function buildPreviewBlock(out) {
  const block = document.createElement('div');
  block.className = 'preview-block';
  block.dataset.outputId = out.id;

  const header = document.createElement('div');
  header.className = 'preview-header';
  const name = document.createElement('span');
  name.textContent = out.name;
  header.appendChild(name);
  const pathEl = document.createElement('span');
  pathEl.className = 'preview-path';
  pathEl.textContent = '/' + out.path;
  header.appendChild(pathEl);
  const open = document.createElement('a');
  open.className = 'preview-open';
  open.href = '/' + out.path;
  open.target = '_blank';
  open.textContent = 'Open ↗';
  header.appendChild(open);
  const close = document.createElement('button');
  close.className = 'preview-close';
  close.textContent = '×';
  close.title = 'Hide preview';
  close.addEventListener('click', () => {
    const next = loadVisiblePreviews().filter((id) => id !== out.id);
    saveVisiblePreviews(next);
    renderOutputPreviews();
  });
  header.appendChild(close);
  block.appendChild(header);

  const scaler = document.createElement('div');
  scaler.className = 'preview-scaler';
  const iframe = document.createElement('iframe');
  iframe.src = '/' + out.path;
  iframe.setAttribute('scrolling', 'no');
  scaler.appendChild(iframe);
  block.appendChild(scaler);

  const applyScale = () => {
    const w = scaler.clientWidth;
    if (w > 0) iframe.style.transform = `scale(${w / 1920})`;
  };
  requestAnimationFrame(applyScale);
  const ro = new ResizeObserver(applyScale);
  ro.observe(scaler);

  const footer = document.createElement('div');
  footer.className = 'preview-footer';
  const label = document.createElement('label');
  label.textContent = 'Layout';
  footer.appendChild(label);
  const sel = document.createElement('select');
  sel.innerHTML = availableLayouts.map((l) => `<option value="${l}">${l}</option>`).join('');
  sel.value = out.layout;
  sel.addEventListener('change', async () => {
    await fetch(`/api/output/${encodeURIComponent(out.id)}/layout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layout: sel.value }),
    });
  });
  footer.appendChild(sel);
  block.appendChild(footer);

  return block;
}

function openAddPreviewMenu(anchor, hiddenOutputs) {
  const menu = ensureMenu();
  menu.innerHTML = '';
  hiddenOutputs.forEach((out) => {
    const item = document.createElement('div');
    item.className = 'add-menu-item';
    item.textContent = out.name + '  ';
    const pathSpan = document.createElement('span');
    pathSpan.className = 'preview-path';
    pathSpan.style.marginLeft = 'auto';
    pathSpan.textContent = '/' + out.path;
    item.appendChild(pathSpan);
    item.addEventListener('click', () => {
      hideMenu();
      const visible = loadVisiblePreviews();
      if (!visible.includes(out.id)) visible.push(out.id);
      saveVisiblePreviews(visible);
      renderOutputPreviews();
    });
    menu.appendChild(item);
  });
  positionMenu(menu, anchor);
  menu.classList.remove('hidden');
  menu.dataset.kind = 'add-preview';
}

/* ---------------- Keyboard ---------------- */
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!$('settings-modal').classList.contains('hidden')) return;

  switch (e.key) {
    case ' ':
    case 'ArrowRight':
    case 'ArrowDown':
      e.preventDefault(); next(); return;
    case 'ArrowLeft':
    case 'ArrowUp':
      e.preventDefault(); prev(); return;
    case 'Escape':
      e.preventDefault(); clearScreen(); return;
    case 'Home':
      e.preventDefault(); home(); return;
    case ',':
      e.preventDefault(); sectionStart(); return;
  }

  const k = e.key.toLowerCase();
  if (hotkeyMap[k]) {
    if (sectionJump(hotkeyMap[k])) e.preventDefault();
  }
});

/* ---------------- Playlists ---------------- */
async function loadPlaylists() {
  const res = await fetch('/api/playlists');
  playlists = await res.json();
  renderPlaylistSelect();
}
function renderPlaylistSelect() {
  const current = playlistSelect.value;
  playlistSelect.innerHTML =
    '<option value="">— No playlist —</option>' +
    playlists.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  playlistSelect.value = current && playlists.find((p) => p.id === current) ? current : '';
}
async function selectPlaylist(id) {
  if (!id) {
    currentPlaylist = null;
    renderPlaylistSongs();
    renderBrowser();
    return;
  }
  const res = await fetch('/api/playlist/' + encodeURIComponent(id));
  if (!res.ok) return;
  currentPlaylist = await res.json();
  renderPlaylistSongs();
  renderBrowser();
}
async function savePlaylist() {
  if (!currentPlaylist) return;
  await fetch('/api/playlist/' + encodeURIComponent(currentPlaylist.id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entries: currentPlaylist.entries }),
  });
}
function removeFromCurrentPlaylist(songId) {
  if (!currentPlaylist) return;
  const i = currentPlaylist.entries.indexOf(songId);
  if (i < 0) return;
  currentPlaylist.entries.splice(i, 1);
  savePlaylist();
  renderPlaylistSongs();
}
async function togglePlaylistMembershipFor(playlistId, songId, knownEntries) {
  let entries;
  if (Array.isArray(knownEntries)) entries = [...knownEntries];
  else {
    const res = await fetch('/api/playlist/' + encodeURIComponent(playlistId));
    if (!res.ok) return;
    entries = (await res.json()).entries || [];
  }
  const i = entries.indexOf(songId);
  if (i >= 0) entries.splice(i, 1);
  else entries.push(songId);
  await fetch('/api/playlist/' + encodeURIComponent(playlistId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entries }),
  });
  if (currentPlaylist && currentPlaylist.id === playlistId) {
    currentPlaylist.entries = entries;
    renderPlaylistSongs();
  }
}
async function newPlaylist() {
  const name = (prompt('Playlist name:') || '').trim();
  if (!name) return null;
  const safe = name.replace(/[^\w\-. ]+/g, '').trim();
  if (!safe) { alert('Invalid playlist name'); return null; }
  const id = safe + '.xpl';
  const res = await fetch('/api/playlist/' + encodeURIComponent(id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entries: [] }),
  });
  if (!res.ok) { alert('Failed to create playlist'); return null; }
  await loadPlaylists();
  return { id, name: safe };
}
async function openAddToPlaylistMenu(anchor, songId) {
  const menu = ensureMenu();
  menu.innerHTML = '<div class="add-menu-empty">Loading…</div>';
  positionMenu(menu, anchor);
  menu.classList.remove('hidden');
  menu.dataset.kind = 'add-to-playlist';

  const details = await Promise.all(
    playlists.map((p) =>
      fetch('/api/playlist/' + encodeURIComponent(p.id)).then((r) => r.ok ? r.json() : null).catch(() => null)
    )
  );

  menu.innerHTML = '';
  playlists.forEach((p, i) => {
    const pl = details[i];
    const isIn = pl && pl.entries.includes(songId);
    const item = document.createElement('div');
    item.className = 'add-menu-item';
    const check = document.createElement('span');
    check.className = 'menu-check';
    check.textContent = isIn ? '✓' : '';
    item.appendChild(check);
    const label = document.createElement('span');
    label.textContent = p.name;
    label.style.flex = '1';
    item.appendChild(label);
    item.addEventListener('click', async () => {
      hideMenu();
      await togglePlaylistMembershipFor(p.id, songId, pl ? pl.entries : null);
    });
    menu.appendChild(item);
  });
  if (playlists.length > 0) {
    const div = document.createElement('div');
    div.className = 'menu-divider';
    menu.appendChild(div);
  }
  const newItem = document.createElement('div');
  newItem.className = 'add-menu-item menu-action';
  newItem.textContent = '+ New playlist…';
  newItem.addEventListener('click', async () => {
    hideMenu();
    const created = await newPlaylist();
    if (!created) return;
    await togglePlaylistMembershipFor(created.id, songId, []);
    playlistSelect.value = created.id;
    await selectPlaylist(created.id);
  });
  menu.appendChild(newItem);
}
function renderPlaylistSongs() {
  playlistSongsList.innerHTML = '';
  if (!currentPlaylist) {
    const li = document.createElement('li');
    li.className = 'empty-note';
    li.textContent = 'Select a playlist above, or create a new one with +.';
    playlistSongsList.appendChild(li);
    return;
  }
  const filter = (playlistSearch.value || '').toLowerCase();
  currentPlaylist.entries.forEach((songId) => {
    const song = songs.find((s) => s.id === songId);
    if (!song) {
      const li = document.createElement('li');
      li.className = 'missing';
      li.textContent = songId + ' (missing)';
      playlistSongsList.appendChild(li);
      return;
    }
    if (filter && !matchFilter(song, filter)) return;
    playlistSongsList.appendChild(songListItem(song, { action: 'remove' }));
  });
}

/* ---------------- Config / layouts bootstrap ---------------- */
async function loadConfigAndLayouts() {
  const [cfgRes, layoutsRes] = await Promise.all([fetch('/api/config'), fetch('/api/layouts')]);
  config = await cfgRes.json();
  availableLayouts = await layoutsRes.json();
  if (!Array.isArray(config.sections)) config.sections = [];
  if (!Array.isArray(config.outputs)) config.outputs = [];
  rebuildHotkeyMap();
  renderArrangement();
  renderStructure();
  renderOutputPreviews();
}

/* ---------------- Theme ---------------- */
const THEME_KEY = 'xlyrics.theme';
const HEADER_LOGO_DARK = '/images/Text Dark Tsp.png';   // for dark UI bg
const HEADER_LOGO_LIGHT = '/images/Text Light Tsp.png'; // for light UI bg
const ABOUT_LOGO_DARK = '/images/Full Dark Tsp.png';
const ABOUT_LOGO_LIGHT = '/images/Full Light Tsp.png';

function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  const headerLogo = $('header-logo');
  if (headerLogo) headerLogo.src = t === 'light' ? HEADER_LOGO_LIGHT : HEADER_LOGO_DARK;
  const aboutLogo = $('about-logo');
  if (aboutLogo) aboutLogo.src = t === 'light' ? ABOUT_LOGO_LIGHT : ABOUT_LOGO_DARK;
  const themeBtn = $('btn-theme');
  if (themeBtn) {
    themeBtn.innerHTML = t === 'light' ? '&#9789;' : '&#9728;'; // moon : sun
    themeBtn.title = t === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
    themeBtn.setAttribute('aria-label', themeBtn.title);
  }
  try { localStorage.setItem(THEME_KEY, t); } catch {}
}

(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch {}
  const initial = saved === 'light' || saved === 'dark'
    ? saved
    : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  applyTheme(initial);
  const btn = $('btn-theme');
  if (btn) btn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    applyTheme(cur === 'light' ? 'dark' : 'light');
  });
})();

/* ---------------- Settings modal ---------------- */
const settingsModal = $('settings-modal');
$('btn-settings').addEventListener('click', openSettings);
$('settings-close').addEventListener('click', () => settingsModal.classList.add('hidden'));
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) settingsModal.classList.add('hidden');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !settingsModal.classList.contains('hidden')) {
    settingsModal.classList.add('hidden');
  }
});

document.querySelectorAll('.modal-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.mtab;
    document.querySelectorAll('.modal-tab').forEach((t) => t.classList.toggle('active', t === btn));
    document.querySelectorAll('.modal-tab-content').forEach((c) => c.classList.toggle('hidden', c.dataset.mtab !== name));
  });
});

async function openSettings() {
  settingsModal.classList.remove('hidden');
  await Promise.all([
    loadSectionsTab(),
    loadOutputsTab(),
    loadLayoutsTab(),
    loadResolumeTab(),
    loadNetworkTab(),
  ]);
}

/* ---- Sections tab ---- */
async function loadSectionsTab() {
  const discovered = await (await fetch('/api/meta/sections')).json();
  renderSectionsTable(discovered);
}

function renderSectionsTable(discovered) {
  const tbody = $('sections-tbody');
  tbody.innerHTML = '';
  const byName = new Map();
  for (const s of config.sections) byName.set(s.name.toLowerCase(), { ...s });
  for (const name of discovered) {
    if (!byName.has(name.toLowerCase())) {
      byName.set(name.toLowerCase(), { name, color: DEFAULT_COLOR, hotkey: null, _auto: true });
    }
  }
  const entries = [...byName.values()];
  entries.sort((a, b) => {
    if (!!a._auto !== !!b._auto) return a._auto ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  for (const entry of entries) tbody.appendChild(sectionRow(entry));
}

function sectionRow(entry) {
  const tr = document.createElement('tr');
  if (entry._auto) tr.classList.add('custom-added');

  const nameTd = document.createElement('td');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = entry.name;
  nameTd.appendChild(nameInput);
  tr.appendChild(nameTd);

  const colorTd = document.createElement('td');
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = entry.color || DEFAULT_COLOR;
  colorTd.appendChild(colorInput);
  tr.appendChild(colorTd);

  const keyTd = document.createElement('td');
  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.className = 'hotkey-input';
  keyInput.maxLength = 1;
  keyInput.value = entry.hotkey || '';
  keyInput.addEventListener('input', () => {
    keyInput.value = keyInput.value.toLowerCase().slice(0, 1);
  });
  keyTd.appendChild(keyInput);
  tr.appendChild(keyTd);

  const oscTd = document.createElement('td');
  const oscWrap = document.createElement('div');
  oscWrap.className = 'osc-suffix-wrap';
  const oscPrefix = document.createElement('span');
  oscPrefix.className = 'osc-prefix';
  oscPrefix.textContent = '/xlyrics/section/';
  const oscInput = document.createElement('input');
  oscInput.type = 'text';
  oscInput.className = 'osc-input osc-suffix-input';
  const refreshPlaceholder = () => { oscInput.placeholder = sectionSlug(nameInput.value || entry.name || ''); };
  oscInput.value = entry.osc || '';
  refreshPlaceholder();
  nameInput.addEventListener('input', refreshPlaceholder);
  oscWrap.appendChild(oscPrefix);
  oscWrap.appendChild(oscInput);
  oscTd.appendChild(oscWrap);
  tr.appendChild(oscTd);

  const removeTd = document.createElement('td');
  const rm = document.createElement('button');
  rm.className = 'row-remove';
  rm.textContent = '×';
  rm.title = 'Remove row';
  rm.addEventListener('click', () => tr.remove());
  removeTd.appendChild(rm);
  tr.appendChild(removeTd);

  return tr;
}

$('section-add').addEventListener('click', () => {
  $('sections-tbody').appendChild(sectionRow({ name: '', color: DEFAULT_COLOR, hotkey: null, osc: '' }));
});

$('sections-save').addEventListener('click', async () => {
  const rows = $('sections-tbody').querySelectorAll('tr');
  const sections = [];
  for (const tr of rows) {
    const name = tr.querySelector('td:nth-child(1) input').value.trim();
    if (!name) continue;
    const color = tr.querySelector('td:nth-child(2) input').value;
    const hotkey = tr.querySelector('td:nth-child(3) input').value.trim().toLowerCase().slice(0, 1) || null;
    const osc = tr.querySelector('td:nth-child(4) .osc-suffix-input').value.trim();
    sections.push({ name, color, hotkey, osc });
  }
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sections }),
  });
  if (!res.ok) { alert('Save failed'); return; }
  const data = await res.json();
  config = data.config;
  rebuildHotkeyMap();
  renderArrangement();
  renderStructure();
  settingsModal.classList.add('hidden');
});

/* ---- Outputs tab ---- */
async function loadOutputsTab() {
  $('origin-hint').textContent = window.location.origin;
  renderOutputsTable();
}

function renderOutputsTable() {
  const tbody = $('outputs-tbody');
  tbody.innerHTML = '';
  for (const out of config.outputs) tbody.appendChild(outputRow(out));
}

function outputRow(entry) {
  const tr = document.createElement('tr');
  tr.dataset.id = entry.id || '';

  const nameTd = document.createElement('td');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = entry.name || '';
  nameTd.appendChild(nameInput);
  tr.appendChild(nameTd);

  const pathTd = document.createElement('td');
  const pathWrap = document.createElement('span');
  pathWrap.className = 'path-cell';
  const prefix = document.createElement('span');
  prefix.className = 'path-prefix';
  prefix.textContent = '/';
  pathWrap.appendChild(prefix);
  const pathInput = document.createElement('input');
  pathInput.type = 'text';
  pathInput.value = entry.path || '';
  pathInput.placeholder = 'output';
  pathInput.addEventListener('input', () => {
    pathInput.value = pathInput.value
      .replace(/^\//, '').replace(/\.html$/i, '')
      .replace(/[^a-z0-9\-_]/gi, '-').toLowerCase();
    openLink.href = '/' + (pathInput.value || '');
    openLink.textContent = '/' + (pathInput.value || '');
  });
  pathWrap.appendChild(pathInput);
  pathTd.appendChild(pathWrap);
  tr.appendChild(pathTd);

  const layoutTd = document.createElement('td');
  const layoutSel = document.createElement('select');
  layoutSel.innerHTML = availableLayouts.map((l) => `<option value="${l}">${l}</option>`).join('');
  layoutSel.value = entry.layout || 'default';
  layoutTd.appendChild(layoutSel);
  tr.appendChild(layoutTd);

  const openTd = document.createElement('td');
  const openLink = document.createElement('a');
  openLink.className = 'open-link';
  openLink.href = '/' + (entry.path || '');
  openLink.target = '_blank';
  openLink.textContent = '/' + (entry.path || '');
  openTd.appendChild(openLink);
  tr.appendChild(openTd);

  const rmTd = document.createElement('td');
  const rm = document.createElement('button');
  rm.className = 'row-remove';
  rm.textContent = '×';
  rm.title = 'Remove output';
  rm.addEventListener('click', () => tr.remove());
  rmTd.appendChild(rm);
  tr.appendChild(rmTd);

  return tr;
}

$('output-add').addEventListener('click', () => {
  $('outputs-tbody').appendChild(outputRow({ id: '', name: 'New output', path: '', layout: availableLayouts[0] || 'default' }));
});

$('outputs-save').addEventListener('click', async () => {
  const rows = $('outputs-tbody').querySelectorAll('tr');
  const outputs = [];
  for (const tr of rows) {
    const id = tr.dataset.id || '';
    const name = tr.querySelector('td:nth-child(1) input').value.trim();
    const pth  = tr.querySelector('td:nth-child(2) input').value.trim();
    const layout = tr.querySelector('td:nth-child(3) select').value;
    if (!name) continue;
    outputs.push({ id: id || undefined, name, path: pth, layout });
  }
  if (outputs.length === 0) { alert('Keep at least one output.'); return; }
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ outputs }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch {}
    alert('Save failed: ' + msg);
    return;
  }
  const data = await res.json();
  config = data.config;
  renderOutputPreviews();
  renderOutputsTable();
  settingsModal.classList.add('hidden');
});

/* ---- Layouts tab ---- */
async function loadLayoutsTab() {
  const list = $('layouts-list');
  list.innerHTML = '';
  if (availableLayouts.length === 0) {
    list.innerHTML = '<div class="muted">No layouts found in layouts/.</div>';
    return;
  }
  for (const name of availableLayouts) {
    const row = document.createElement('div');
    row.className = 'layout-item';
    const swatch = document.createElement('div');
    swatch.className = 'layout-swatch';
    swatch.textContent = 'Aa';
    row.appendChild(swatch);
    const label = document.createElement('div');
    label.className = 'layout-name';
    label.textContent = name;
    row.appendChild(label);
    const file = document.createElement('div');
    file.className = 'layout-file';
    file.textContent = name + '.xlayout';
    row.appendChild(file);
    list.appendChild(row);
  }
}

/* ---- Resolume tab ---- */
const DEFAULT_RESOLUME_ADDRESS =
  '/composition/layers/1/clips/1/video/source/blocktextgenerator/text/params/lines';

async function loadResolumeTab() {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  const r = cfg.resolume || {};
  $('resolume-enabled').checked = !!r.enabled;
  $('resolume-host').value = r.host || '127.0.0.1';
  $('resolume-port').value = Number.isFinite(r.port) ? r.port : 7000;
  renderClipsTable(Array.isArray(r.clips) && r.clips.length ? r.clips : [
    { id: 'clip-1', name: 'Main', address: DEFAULT_RESOLUME_ADDRESS, triggerClip: true },
  ]);
}

function renderClipsTable(clips) {
  const tbody = $('clips-tbody');
  tbody.innerHTML = '';
  for (const c of clips) tbody.appendChild(clipRow(c));
}

function clipRow(clip) {
  const tr = document.createElement('tr');
  tr.dataset.clipId = clip.id || '';

  const nameTd = document.createElement('td');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = clip.name || '';
  nameInput.placeholder = 'Main';
  nameTd.appendChild(nameInput);
  tr.appendChild(nameTd);

  const addrTd = document.createElement('td');
  const addrInput = document.createElement('input');
  addrInput.type = 'text';
  addrInput.className = 'osc-input';
  addrInput.value = clip.address || DEFAULT_RESOLUME_ADDRESS;
  addrInput.placeholder = DEFAULT_RESOLUME_ADDRESS;
  addrTd.appendChild(addrInput);
  tr.appendChild(addrTd);

  const trigTd = document.createElement('td');
  trigTd.className = 'trigger-col';
  const trigInput = document.createElement('input');
  trigInput.type = 'checkbox';
  trigInput.checked = !!clip.triggerClip;
  trigInput.title = 'Also fire …/clips/N/connect on every new line';
  trigTd.appendChild(trigInput);
  tr.appendChild(trigTd);

  const testTd = document.createElement('td');
  const testBtn = document.createElement('button');
  testBtn.className = 'row-test';
  testBtn.textContent = 'Test';
  testBtn.addEventListener('click', () => testClip(tr));
  testTd.appendChild(testBtn);
  tr.appendChild(testTd);

  const removeTd = document.createElement('td');
  const rm = document.createElement('button');
  rm.className = 'row-remove';
  rm.textContent = '×';
  rm.title = 'Remove clip';
  rm.addEventListener('click', () => tr.remove());
  removeTd.appendChild(rm);
  tr.appendChild(removeTd);

  return tr;
}

function readResolumeForm() {
  const clips = [];
  for (const tr of $('clips-tbody').querySelectorAll('tr')) {
    const name = tr.querySelector('td:nth-child(1) input').value.trim();
    const address = tr.querySelector('td:nth-child(2) input').value.trim();
    const triggerClip = tr.querySelector('td:nth-child(3) input').checked;
    if (!address.startsWith('/')) continue;
    clips.push({
      id: tr.dataset.clipId || '',
      name: name || 'Clip',
      address,
      triggerClip,
    });
  }
  return {
    enabled: $('resolume-enabled').checked,
    host: $('resolume-host').value.trim() || '127.0.0.1',
    port: Number($('resolume-port').value) || 7000,
    clips,
  };
}

async function testClip(tr) {
  const r = readResolumeForm();
  const address = tr.querySelector('td:nth-child(2) input').value.trim();
  const triggerClip = tr.querySelector('td:nth-child(3) input').checked;
  if (!address.startsWith('/')) { alert('Address must start with /'); return; }
  const btn = tr.querySelector('.row-test');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await fetch('/api/resolume/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: r.host, port: r.port, address, triggerClip,
        message: 'xLyrics test — ' + new Date().toLocaleTimeString(),
      }),
    });
    if (!res.ok) {
      let msg = 'Test failed';
      try { const err = await res.json(); if (err.error) msg = err.error; } catch {}
      alert(msg);
    } else {
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1000);
      return;
    }
  } catch (err) {
    alert('Test failed: ' + err.message);
  }
  btn.textContent = original;
  btn.disabled = false;
}

$('clip-add').addEventListener('click', () => {
  $('clips-tbody').appendChild(clipRow({
    id: '', name: 'Clip', address: DEFAULT_RESOLUME_ADDRESS, triggerClip: false,
  }));
});

$('resolume-save').addEventListener('click', async () => {
  const resolume = readResolumeForm();
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolume }),
  });
  if (!res.ok) {
    let msg = 'Save failed';
    try { const err = await res.json(); if (err.error) msg = err.error; } catch {}
    alert(msg);
    return;
  }
  settingsModal.classList.add('hidden');
});

/* ---- Network tab ---- */
async function loadNetworkTab() {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  const n = cfg.network || {};
  const ln = n.listen || {};
  const fb = n.feedback || {};
  const ctrl = n.controls || {};
  $('net-listen-enabled').checked = !!ln.enabled;
  $('net-listen-port').value = Number.isFinite(ln.port) ? ln.port : 8000;
  $('net-fb-enabled').checked = !!fb.enabled;
  $('net-fb-host').value = fb.host || '127.0.0.1';
  $('net-fb-port').value = Number.isFinite(fb.port) ? fb.port : 9000;
  $('net-fb-prefix').value = fb.prefix || '/xlyrics';
  $('net-ctrl-clear').value = ctrl.clear || '/xlyrics/clear';
  $('net-ctrl-next').value  = ctrl.next  || '/xlyrics/next';
  $('net-ctrl-prev').value  = ctrl.prev  || '/xlyrics/prev';
  $('net-ctrl-home').value  = ctrl.home  || '/xlyrics/home';
}

function readNetworkForm() {
  return {
    listen: {
      enabled: $('net-listen-enabled').checked,
      port: Number($('net-listen-port').value) || 8000,
    },
    feedback: {
      enabled: $('net-fb-enabled').checked,
      host: $('net-fb-host').value.trim() || '127.0.0.1',
      port: Number($('net-fb-port').value) || 9000,
      prefix: $('net-fb-prefix').value.trim() || '/xlyrics',
    },
    controls: {
      clear: $('net-ctrl-clear').value.trim() || '/xlyrics/clear',
      next:  $('net-ctrl-next').value.trim()  || '/xlyrics/next',
      prev:  $('net-ctrl-prev').value.trim()  || '/xlyrics/prev',
      home:  $('net-ctrl-home').value.trim()  || '/xlyrics/home',
    },
  };
}

$('network-save').addEventListener('click', async () => {
  const network = readNetworkForm();
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ network }),
  });
  if (!res.ok) {
    let msg = 'Save failed';
    try { const err = await res.json(); if (err.error) msg = err.error; } catch {}
    alert(msg);
    return;
  }
  settingsModal.classList.add('hidden');
});

$('net-fb-test').addEventListener('click', async () => {
  const n = readNetworkForm();
  const btn = $('net-fb-test');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const res = await fetch('/api/network/feedback/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(n.feedback),
    });
    if (!res.ok) {
      let msg = 'Test failed';
      try { const err = await res.json(); if (err.error) msg = err.error; } catch {}
      alert(msg);
    } else {
      btn.textContent = 'Sent ✓';
      setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1200);
      return;
    }
  } catch (err) {
    alert('Test failed: ' + err.message);
  }
  btn.textContent = original;
  btn.disabled = false;
});

/* ---------------- SSE ---------------- */
function listenSSE() {
  const evt = new EventSource('/events');
  evt.addEventListener('state', (e) => {
    try {
      lastState = JSON.parse(e.data);
      if (Number.isFinite(lastState.fadeMs)
        && document.activeElement !== fadeSlider
        && document.activeElement !== fadeValue) {
        fadeSlider.value = lastState.fadeMs;
        fadeValue.value = lastState.fadeMs;
      }
      updateStatus();
    } catch { /* ignore */ }
  });
  evt.addEventListener('library', () => loadSongs());
  evt.addEventListener('song:updated', async (e) => {
    try {
      const { id } = JSON.parse(e.data);
      if (!currentSong || currentSong.id !== id) return;
      const prevEntry = playlistIndex >= 0 ? localPlaylist[playlistIndex] : null;
      const res = await fetch('/api/song/' + encodeURIComponent(id));
      if (!res.ok) return;
      currentSong = await res.json();
      loadArrangement(currentArrangementName);
      if (prevEntry) {
        const idx = localPlaylist.findIndex(
          (x) => x.sectionName === prevEntry.sectionName && x.frameIndex === prevEntry.frameIndex
        );
        playlistIndex = idx;
      }
      renderArrangement();
      renderStructure();
      updateStatus();
    } catch { /* ignore */ }
  });
  evt.addEventListener('playlists', () => loadPlaylists());
  evt.addEventListener('playlist:updated', async (e) => {
    try {
      const { id, deleted } = JSON.parse(e.data);
      await loadPlaylists();
      if (currentPlaylist && currentPlaylist.id === id) {
        if (deleted) { currentPlaylist = null; playlistSelect.value = ''; }
        else { await selectPlaylist(id); }
      }
    } catch { /* ignore */ }
  });
  evt.addEventListener('control', (e) => {
    try {
      const { action, name } = JSON.parse(e.data);
      if (action === 'next') next();
      else if (action === 'prev') prev();
      else if (action === 'home') home();
      else if (action === 'clear') clearScreen();
      else if (action === 'section' && typeof name === 'string') sectionJump(name);
    } catch { /* ignore */ }
  });
  evt.addEventListener('config', async (e) => {
    try {
      const body = JSON.parse(e.data);
      if (body && Array.isArray(body.sections) && Array.isArray(body.outputs)) {
        config = body;
      } else {
        config = await (await fetch('/api/config')).json();
      }
      availableLayouts = await (await fetch('/api/layouts')).json();
      rebuildHotkeyMap();
      renderArrangement();
      renderStructure();
      renderOutputPreviews();
    } catch { /* ignore */ }
  });
}

/* ---------------- Search / fade ---------------- */
songSearch.addEventListener('input', renderBrowser);
playlistSearch.addEventListener('input', renderPlaylistSongs);
browserSort.addEventListener('change', renderBrowser);
playlistSelect.addEventListener('change', () => selectPlaylist(playlistSelect.value));
playlistNewBtn.addEventListener('click', async () => {
  const created = await newPlaylist();
  if (!created) return;
  playlistSelect.value = created.id;
  await selectPlaylist(created.id);
});

fadeSlider.addEventListener('input', async () => {
  fadeValue.value = fadeSlider.value;
  await fetch('/api/display/fade', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fadeMs: Number(fadeSlider.value) }),
  });
});
fadeValue.addEventListener('change', () => {
  fadeSlider.value = fadeValue.value;
  fadeSlider.dispatchEvent(new Event('input'));
});

$('btn-clear').addEventListener('click', clearScreen);
$('btn-prev').addEventListener('click', prev);
$('btn-next').addEventListener('click', next);
$('btn-home').addEventListener('click', home);

/* ---------------- Boot ---------------- */
(async () => {
  await loadConfigAndLayouts();
  await loadSongs();
  await loadPlaylists();
  listenSSE();
})();
