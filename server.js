import express from 'express';
import chokidar from 'chokidar';
import dgram from 'dgram';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { parseSong, SEPARATOR, isArrangementLine, formatArrangementLine } from './parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 3000;
const SONGS_DIR = path.join(__dirname, 'songs');
const LAYOUTS_DIR = path.join(__dirname, 'layouts');
const PLAYLISTS_DIR = path.join(__dirname, 'playlists');
const PUBLIC_DIR = path.join(__dirname, 'public');
const IMAGES_DIR = path.join(__dirname, 'images');
const CONFIG_FILE = path.join(__dirname, 'config.json');

for (const dir of [SONGS_DIR, LAYOUTS_DIR, PLAYLISTS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const RESERVED_PATHS = new Set(['api', 'events', 'layouts', 'images', 'control', 'public', 'favicon']);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ limit: '1mb', type: 'text/plain' }));

/* ---------------- Config ---------------- */
const DEFAULT_RESOLUME_ADDRESS =
  '/composition/layers/1/clips/1/video/source/blocktextgenerator/text/params/lines';

const DEFAULT_CONFIG = {
  sections: [
    { name: 'Chorus',      color: '#e06464', hotkey: 'a', osc: '' },
    { name: 'Chorus 1',    color: '#e06464', hotkey: 's', osc: '' },
    { name: 'Chorus 2',    color: '#c95454', hotkey: 'd', osc: '' },
    { name: 'Chorus 3',    color: '#b04545', hotkey: 'f', osc: '' },
    { name: 'Chorus 4',    color: '#963838', hotkey: 'g', osc: '' },
    { name: 'Pre Chorus',  color: '#d8b848', hotkey: 'z', osc: '' },
    { name: 'Post Chorus', color: '#b58d2e', hotkey: 'x', osc: '' },
    { name: 'Verse 1',     color: '#5bb570', hotkey: 'q', osc: '' },
    { name: 'Verse 2',     color: '#4ea260', hotkey: 'w', osc: '' },
    { name: 'Verse 3',     color: '#428f52', hotkey: 'e', osc: '' },
    { name: 'Verse 4',     color: '#377c44', hotkey: 'r', osc: '' },
    { name: 'Verse 5',     color: '#2e6a39', hotkey: 't', osc: '' },
    { name: 'Verse 6',     color: '#24572d', hotkey: 'y', osc: '' },
    { name: 'Bridge',      color: '#c458c8', hotkey: 'c', osc: '' },
    { name: 'Tag',         color: '#5b8fd8', hotkey: null, osc: '' },
    { name: 'Intro',       color: '#5b8fd8', hotkey: 'v', osc: '' },
    { name: 'Outro',       color: '#5b8fd8', hotkey: 'b', osc: '' },
  ],
  outputs: [
    { id: 'main', name: 'Main', path: 'output', layout: 'default' },
  ],
  resolume: {
    enabled: false,
    host: '127.0.0.1',
    port: 7000,
    clips: [
      {
        id: 'clip-1',
        name: 'Main',
        address: DEFAULT_RESOLUME_ADDRESS,
        triggerClip: true,
      },
    ],
  },
  network: {
    listen: { enabled: false, port: 8000 },
    feedback: {
      enabled: false,
      host: '127.0.0.1',
      port: 9000,
      prefix: '/xlyrics',
    },
    controls: {
      clear: '/xlyrics/clear',
      next: '/xlyrics/next',
      prev: '/xlyrics/prev',
      home: '/xlyrics/home',
    },
  },
};

let config = loadConfig();

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

      // Migrate legacy single-clip osc block → resolume.clips[0]
      let resolume = parsed.resolume;
      if (!resolume && parsed.osc && typeof parsed.osc === 'object') {
        resolume = {
          enabled: !!parsed.osc.enabled,
          host: parsed.osc.host || DEFAULT_CONFIG.resolume.host,
          port: parsed.osc.port || DEFAULT_CONFIG.resolume.port,
          clips: [{
            id: 'clip-1',
            name: 'Main',
            address: parsed.osc.address || DEFAULT_RESOLUME_ADDRESS,
            triggerClip: true,
          }],
        };
      }
      const mergedResolume = {
        ...DEFAULT_CONFIG.resolume,
        ...(resolume || {}),
        clips: Array.isArray(resolume?.clips) && resolume.clips.length
          ? resolume.clips
          : DEFAULT_CONFIG.resolume.clips,
      };

      const network = parsed.network || {};
      const mergedNetwork = {
        listen:   { ...DEFAULT_CONFIG.network.listen,   ...(network.listen   || {}) },
        feedback: { ...DEFAULT_CONFIG.network.feedback, ...(network.feedback || {}) },
        controls: { ...DEFAULT_CONFIG.network.controls, ...(network.controls || {}) },
      };

      const sections = (Array.isArray(parsed.sections) && parsed.sections.length ? parsed.sections : DEFAULT_CONFIG.sections)
        .map((s) => ({ ...s, osc: cleanSectionOscSuffix(s && s.osc) }));

      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        sections,
        outputs:  Array.isArray(parsed.outputs)  && parsed.outputs.length  ? parsed.outputs  : DEFAULT_CONFIG.outputs,
        resolume: mergedResolume,
        network: mergedNetwork,
      };
    } catch (err) { console.error('[config] failed to parse, using defaults:', err.message); }
  }
  return structuredClone(DEFAULT_CONFIG);
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

/* ---------------- OSC ---------------- */
const oscSendSocket = dgram.createSocket('udp4');
oscSendSocket.on('error', (err) => console.error('[osc] send socket error:', err.message));

function pad4(len) { return (4 - (len % 4)) % 4; }

function oscString(s) {
  const buf = Buffer.from(String(s), 'utf8');
  const nul = Buffer.alloc(1);
  const pad = Buffer.alloc(pad4(buf.length + 1));
  return Buffer.concat([buf, nul, pad]);
}

function oscInt32(n) {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(n | 0, 0);
  return buf;
}

function oscFloat32(n) {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(Number(n) || 0, 0);
  return buf;
}

function oscMessage(address, args) {
  // args: array of { type: 's'|'i'|'f'|'T'|'F', value? }
  // Backwards-compat: if args is a string, treat as single ,s.
  if (typeof args === 'string') args = [{ type: 's', value: args }];
  const addr = oscString(address);
  const tagStr = ',' + args.map((a) => a.type).join('');
  const tags = oscString(tagStr);
  const argBufs = args.map((a) => {
    if (a.type === 's') return oscString(a.value);
    if (a.type === 'i') return oscInt32(a.value);
    if (a.type === 'f') return oscFloat32(a.value);
    if (a.type === 'T' || a.type === 'F') return Buffer.alloc(0);
    return Buffer.alloc(0);
  });
  return Buffer.concat([addr, tags, ...argBufs]);
}

function sendOscRaw(host, port, buf) {
  return new Promise((resolve, reject) => {
    oscSendSocket.send(buf, 0, buf.length, port, host, (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

function sendOscString(host, port, address, text) {
  return sendOscRaw(host, port, oscMessage(address, [{ type: 's', value: String(text) }]));
}

function sendOscInt(host, port, address, value) {
  return sendOscRaw(host, port, oscMessage(address, [{ type: 'i', value: value | 0 }]));
}

/* ---------- OSC parser (incoming) ---------- */
function readOscString(buf, off) {
  let end = off;
  while (end < buf.length && buf[end] !== 0) end++;
  const s = buf.slice(off, end).toString('utf8');
  // Advance past the null and pad to 4-byte boundary
  let next = end + 1;
  next += (4 - (next % 4)) % 4;
  return [s, next];
}

function parseOscMessage(buf) {
  // Returns { address, args } or null if malformed. Bundles unsupported here
  // (we strip the bundle wrapper at the listener layer).
  try {
    const [address, p1] = readOscString(buf, 0);
    if (!address.startsWith('/')) return null;
    let off = p1;
    if (off >= buf.length) return { address, args: [] };
    const [tagStr, p2] = readOscString(buf, off);
    if (!tagStr.startsWith(',')) return { address, args: [] };
    off = p2;
    const args = [];
    for (const t of tagStr.slice(1)) {
      if (t === 's') {
        const [s, np] = readOscString(buf, off);
        args.push(s); off = np;
      } else if (t === 'i') {
        if (off + 4 > buf.length) break;
        args.push(buf.readInt32BE(off)); off += 4;
      } else if (t === 'f') {
        if (off + 4 > buf.length) break;
        args.push(buf.readFloatBE(off)); off += 4;
      } else if (t === 'T') { args.push(true); }
      else if (t === 'F') { args.push(false); }
      else if (t === 'N') { args.push(null); }
      else { /* unsupported type — bail */ break; }
    }
    return { address, args };
  } catch { return null; }
}

function* iterateOsc(buf) {
  // Yields parsed messages, descending into bundles (#bundle).
  if (buf.length >= 8 && buf.slice(0, 7).toString() === '#bundle') {
    let off = 16; // skip '#bundle\0' (8 bytes) + timetag (8 bytes)
    while (off + 4 <= buf.length) {
      const size = buf.readInt32BE(off);
      off += 4;
      if (size <= 0 || off + size > buf.length) break;
      yield* iterateOsc(buf.slice(off, off + size));
      off += size;
    }
    return;
  }
  const m = parseOscMessage(buf);
  if (m) yield m;
}

/* ---------- Resolume sender ---------- */
let lastResolumeText = null;

function deriveConnectAddress(addr) {
  // /composition/layers/2/clips/3/video/source/...  →  /composition/layers/2/clips/3/connect
  const m = String(addr || '').match(/^(\/composition\/layers\/\d+\/clips\/\d+)(?:\/|$)/);
  return m ? `${m[1]}/connect` : null;
}

function sendCurrentToResolume(text) {
  const r = config.resolume;
  if (!r || !r.enabled || !Array.isArray(r.clips) || !r.clips.length) return;
  const t = String(text || '');
  if (t === lastResolumeText) return;
  lastResolumeText = t;
  for (const clip of r.clips) {
    if (!clip || !clip.address) continue;
    sendOscString(r.host, r.port, clip.address, t)
      .catch((err) => console.error(`[osc] resolume "${clip.name || clip.id}" send failed:`, err.message));
    if (clip.triggerClip && t) {
      const connectAddr = deriveConnectAddress(clip.address);
      if (connectAddr) {
        sendOscInt(r.host, r.port, connectAddr, 1)
          .catch((err) => console.error(`[osc] resolume connect "${connectAddr}" failed:`, err.message));
      }
    }
  }
}

/* ---------- Feedback sender ---------- */
function sendFeedback(suffix, args) {
  const fb = config.network && config.network.feedback;
  if (!fb || !fb.enabled) return;
  const prefix = (fb.prefix || '/xlyrics').replace(/\/+$/, '');
  const address = `${prefix}${suffix.startsWith('/') ? '' : '/'}${suffix}`;
  const buf = oscMessage(address, args);
  sendOscRaw(fb.host, fb.port, buf)
    .catch((err) => console.error('[osc] feedback send failed:', err.message));
}

function broadcastFeedback(state) {
  if (!config.network || !config.network.feedback || !config.network.feedback.enabled) return;
  sendFeedback('cleared',  [{ type: 'i', value: state.cleared ? 1 : 0 }]);
  sendFeedback('current',  [{ type: 's', value: state.cleared ? '' : (state.content || '') }]);
  sendFeedback('next',     [{ type: 's', value: state.cleared ? '' : (state.nextContent || '') }]);
  sendFeedback('section',  [{ type: 's', value: state.sectionName || '' }]);
  sendFeedback('song',     [{ type: 's', value: state.songTitle || '' }]);
  sendFeedback('frame',    [{ type: 'i', value: Number.isFinite(state.frameIndex) ? state.frameIndex : -1 }]);
  sendFeedback('step',     [{ type: 'i', value: Number.isFinite(state.arrIndex) ? state.arrIndex : -1 }]);
}

/* ---------- Listener ---------- */
let oscListenSocket = null;
let oscListenPort = null;

function stopOscListener() {
  if (oscListenSocket) {
    try { oscListenSocket.close(); } catch { /* ignore */ }
    oscListenSocket = null;
    oscListenPort = null;
  }
}

function startOscListener() {
  stopOscListener();
  const ln = config.network && config.network.listen;
  if (!ln || !ln.enabled || !ln.port) return;
  const sock = dgram.createSocket('udp4');
  sock.on('error', (err) => {
    console.error('[osc] listen error:', err.message);
    stopOscListener();
  });
  sock.on('message', (buf) => {
    for (const msg of iterateOsc(buf)) handleIncomingOsc(msg);
  });
  sock.bind(ln.port, () => {
    oscListenSocket = sock;
    oscListenPort = ln.port;
    console.log(`[osc] listening on udp ${ln.port}`);
  });
}

function refreshOscListener() {
  const ln = config.network && config.network.listen;
  const wantOn = !!(ln && ln.enabled && ln.port);
  const isOn = !!oscListenSocket;
  if (wantOn && (!isOn || ln.port !== oscListenPort)) startOscListener();
  else if (!wantOn && isOn) stopOscListener();
}

const SECTION_OSC_PREFIX = '/xlyrics/section/';

function sectionSlug(name) {
  return String(name || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function handleIncomingOsc({ address, args }) {
  // Companion press/release: a "release" comes through as int 0. Ignore so we
  // only react to the press (any int !== 0, or no int args at all).
  const firstArg = args && args.length ? args[0] : undefined;
  if (typeof firstArg === 'number' && firstArg === 0) return;

  const ctrl = config.network && config.network.controls;
  const norm = (s) => String(s || '').trim().replace(/\/+$/, '').toLowerCase();
  const a = norm(address);

  if (ctrl) {
    if (a === norm(ctrl.clear)) { clearDisplay(); return; }
    if (a === norm(ctrl.next))  { broadcast('control', { action: 'next' }); return; }
    if (a === norm(ctrl.prev))  { broadcast('control', { action: 'prev' }); return; }
    if (a === norm(ctrl.home))  { broadcast('control', { action: 'home' }); return; }
  }

  // Section trigger: anything under /xlyrics/section/<slug>
  if (a.startsWith(SECTION_OSC_PREFIX)) {
    const incomingSuffix = a.slice(SECTION_OSC_PREFIX.length);
    if (!incomingSuffix) return;
    for (const s of config.sections || []) {
      if (!s) continue;
      const expected = (s.osc && s.osc.trim()) ? s.osc.trim().toLowerCase() : sectionSlug(s.name);
      if (expected && expected === incomingSuffix) {
        broadcast('control', { action: 'section', name: s.name });
        return;
      }
    }
  }
}

/* ---------- Validators ---------- */
function cleanResolume(x, prev) {
  const base = prev || DEFAULT_CONFIG.resolume;
  if (!x || typeof x !== 'object') return base;
  const port = Number(x.port);
  const usedIds = new Set();
  let clips = Array.isArray(x.clips) ? x.clips : [];
  clips = clips
    .filter((c) => c && typeof c.address === 'string' && c.address.trim().startsWith('/'))
    .map((c, i) => {
      let id = typeof c.id === 'string' && c.id.trim() ? c.id.trim() : `clip-${i + 1}`;
      let base = id, n = 2;
      while (usedIds.has(id)) id = `${base}-${n++}`;
      usedIds.add(id);
      return {
        id,
        name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : `Clip ${i + 1}`,
        address: c.address.trim(),
        triggerClip: !!c.triggerClip,
      };
    });
  if (!clips.length) clips = base.clips;
  return {
    enabled: !!x.enabled,
    host: typeof x.host === 'string' && x.host.trim() ? x.host.trim() : base.host,
    port: Number.isFinite(port) && port > 0 && port < 65536 ? Math.floor(port) : base.port,
    clips,
  };
}

function cleanNetwork(x, prev) {
  const base = prev || DEFAULT_CONFIG.network;
  if (!x || typeof x !== 'object') return base;
  const lp = Number(x.listen && x.listen.port);
  const fp = Number(x.feedback && x.feedback.port);
  const validAddr = (s, fallback) =>
    typeof s === 'string' && s.trim().startsWith('/') ? s.trim() : fallback;
  return {
    listen: {
      enabled: !!(x.listen && x.listen.enabled),
      port: Number.isFinite(lp) && lp > 0 && lp < 65536 ? Math.floor(lp) : base.listen.port,
    },
    feedback: {
      enabled: !!(x.feedback && x.feedback.enabled),
      host: (x.feedback && typeof x.feedback.host === 'string' && x.feedback.host.trim())
        ? x.feedback.host.trim() : base.feedback.host,
      port: Number.isFinite(fp) && fp > 0 && fp < 65536 ? Math.floor(fp) : base.feedback.port,
      prefix: (x.feedback && typeof x.feedback.prefix === 'string' && x.feedback.prefix.trim().startsWith('/'))
        ? x.feedback.prefix.trim().replace(/\/+$/, '') : base.feedback.prefix,
    },
    controls: {
      clear: validAddr(x.controls && x.controls.clear, base.controls.clear),
      next:  validAddr(x.controls && x.controls.next,  base.controls.next),
      prev:  validAddr(x.controls && x.controls.prev,  base.controls.prev),
      home:  validAddr(x.controls && x.controls.home,  base.controls.home),
    },
  };
}

/* ---------------- Song library ---------------- */
const library = new Map();
const recentWrites = new Map();

const idFromPath = (filePath) =>
  path.relative(SONGS_DIR, filePath).split(path.sep).join('/');

function loadSong(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const hash = crypto.createHash('sha1').update(text).digest('hex');
    const parsed = parseSong(text);
    const id = idFromPath(filePath);
    library.set(id, { id, path: filePath, parsed, hash });
    return { id, hash };
  } catch (err) {
    console.error(`[song] failed ${filePath}: ${err.message}`);
    return null;
  }
}

function removeSong(filePath) {
  const id = idFromPath(filePath);
  library.delete(id);
  if (displayState.songId === id) clearDisplay();
  return id;
}

function walkSongs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSongs(full);
    else if (entry.name.toLowerCase().endsWith('.txt')) loadSong(full);
  }
}
walkSongs(SONGS_DIR);
console.log(`[library] loaded ${library.size} song(s) from ${SONGS_DIR}`);

chokidar
  .watch(SONGS_DIR, { ignoreInitial: true, ignored: /(^|[\/\\])\../ })
  .on('add', (p) => {
    if (!p.endsWith('.txt')) return;
    const r = loadSong(p);
    if (r) { broadcast('library', {}); broadcast('song:updated', { id: r.id }); }
  })
  .on('change', (p) => {
    if (!p.endsWith('.txt')) return;
    const prevHash = recentWrites.get(p);
    if (prevHash) {
      const text = fs.readFileSync(p, 'utf8');
      const hash = crypto.createHash('sha1').update(text).digest('hex');
      if (hash === prevHash) { recentWrites.delete(p); return; }
    }
    const r = loadSong(p);
    if (r) { broadcast('library', {}); broadcast('song:updated', { id: r.id }); }
  })
  .on('unlink', (p) => {
    if (!p.endsWith('.txt')) return;
    const id = removeSong(p);
    broadcast('library', {});
    broadcast('song:removed', { id });
  });

chokidar
  .watch(PLAYLISTS_DIR, { ignoreInitial: true, ignored: /(^|[\/\\])\../ })
  .on('all', () => broadcast('playlists', {}));

/* ---------------- Arrangement write-back ---------------- */
function writeArrangementsToFile(filePath, arrangements) {
  const text = fs.readFileSync(filePath, 'utf8');
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);

  let sepIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (SEPARATOR.test(lines[i].trim())) { sepIdx = i; break; }
  }

  let firstArrPos = -1;
  for (let i = 0; i < sepIdx; i++) {
    if (isArrangementLine(lines[i])) { firstArrPos = i; break; }
  }

  const headerCleaned = [];
  for (let i = 0; i < sepIdx; i++) {
    if (!isArrangementLine(lines[i])) headerCleaned.push(lines[i]);
  }

  let insertAt;
  if (firstArrPos >= 0) {
    let before = 0;
    for (let i = 0; i < firstArrPos; i++) if (!isArrangementLine(lines[i])) before++;
    insertAt = before;
  } else {
    insertAt = headerCleaned.length;
  }

  const arrLines = arrangements.map(formatArrangementLine);
  const newHeader = [
    ...headerCleaned.slice(0, insertAt),
    ...arrLines,
    ...headerCleaned.slice(insertAt),
  ];
  const newText = [...newHeader, ...lines.slice(sepIdx)].join(eol);

  const hash = crypto.createHash('sha1').update(newText).digest('hex');
  recentWrites.set(filePath, hash);
  fs.writeFileSync(filePath, newText, 'utf8');
  return hash;
}

/* ---------------- SSE ---------------- */
const sseClients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { /* ignore */ }
  }
}

app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  sseClients.add(res);
  res.write(`event: state\ndata: ${JSON.stringify(displayState)}\n\n`);
  res.write(`event: config\ndata: ${JSON.stringify(config)}\n\n`);
  req.on('close', () => sseClients.delete(res));
});

/* ---------------- Display state ---------------- */
let displayState = {
  cleared: true,
  songId: null,
  songTitle: null,
  sectionName: null,
  arrIndex: -1,
  frameIndex: -1,
  content: '',
  nextContent: '',
  fadeMs: 0,
};

function setDisplay(patch) {
  const prevContent = displayState.content;
  const prevCleared = displayState.cleared;
  displayState = { ...displayState, ...patch };
  broadcast('state', displayState);
  const oscText = displayState.cleared ? '' : displayState.content;
  if (oscText !== prevContent || displayState.cleared !== prevCleared) {
    sendCurrentToResolume(oscText);
  }
  broadcastFeedback(displayState);
}
function clearDisplay() {
  setDisplay({ cleared: true, content: '', nextContent: '' });
}

/* ---------------- API: songs ---------------- */
app.get('/api/songs', (req, res) => {
  const songs = [...library.values()].map((s) => ({
    id: s.id,
    title: s.parsed.header.title || path.basename(s.path, '.txt'),
    artist: s.parsed.header.artist || '',
    album: s.parsed.header.album || '',
  }));
  songs.sort((a, b) => a.title.localeCompare(b.title));
  res.json(songs);
});

app.get('/api/song/:id', (req, res) => {
  const song = library.get(req.params.id);
  if (!song) return res.status(404).json({ error: 'not found' });
  res.json(serializeSong(song));
});

app.post('/api/song/:id/arrangement', (req, res) => {
  const song = library.get(req.params.id);
  if (!song) return res.status(404).json({ error: 'song not found: ' + req.params.id });
  const name = String((req.body && req.body.name) || 'default').trim() || 'default';
  const sequence = Array.isArray(req.body && req.body.sequence)
    ? req.body.sequence.map((x) => String(x).trim()).filter(Boolean)
    : null;
  if (!sequence) return res.status(400).json({ error: 'sequence must be an array of strings' });

  const existing = song.parsed.arrangements.map(a => ({ name: a.name, sequence: [...a.sequence] }));
  const idx = existing.findIndex((a) => a.name.toLowerCase() === name.toLowerCase());
  if (idx >= 0) existing[idx] = { name, sequence };
  else existing.push({ name, sequence });

  try { writeArrangementsToFile(song.path, existing); }
  catch (err) { return res.status(500).json({ error: 'write failed: ' + err.message }); }

  loadSong(song.path);
  broadcast('song:updated', { id: song.id });
  res.json({ ok: true, song: serializeSong(library.get(song.id)) });
});

app.delete('/api/song/:id/arrangement/:name', (req, res) => {
  const song = library.get(req.params.id);
  if (!song) return res.status(404).json({ error: 'not found' });
  const name = String(req.params.name || '').trim();
  if (!name || name.toLowerCase() === 'default') return res.status(400).json({ error: 'cannot delete default' });

  const existing = song.parsed.arrangements.map(a => ({ name: a.name, sequence: [...a.sequence] }));
  const idx = existing.findIndex((a) => a.name.toLowerCase() === name.toLowerCase());
  if (idx < 0) return res.status(404).json({ error: 'arrangement not found' });
  existing.splice(idx, 1);

  try { writeArrangementsToFile(song.path, existing); }
  catch (err) { return res.status(500).json({ error: err.message }); }
  loadSong(song.path);
  broadcast('song:updated', { id: song.id });
  res.json({ ok: true, song: serializeSong(library.get(song.id)) });
});

function serializeSong(song) {
  return {
    id: song.id,
    header: song.parsed.header,
    sections: song.parsed.sections,
    arrangements: song.parsed.arrangements,
    arrangement: song.parsed.arrangement,
    playlist: song.parsed.playlist,
  };
}

/* ---------------- API: metadata ---------------- */
app.get('/api/meta/sections', (req, res) => {
  const set = new Set();
  for (const song of library.values()) {
    for (const s of song.parsed.sections) set.add(s.name);
  }
  res.json([...set].sort((a, b) => a.localeCompare(b)));
});

/* ---------------- API: layouts ---------------- */
app.get('/api/layouts', (req, res) => {
  if (!fs.existsSync(LAYOUTS_DIR)) return res.json([]);
  const names = fs.readdirSync(LAYOUTS_DIR)
    .filter((f) => /\.xlayout$/i.test(f))
    .map((f) => f.replace(/\.xlayout$/i, ''));
  res.json([...new Set(names)].sort());
});

/* ---------------- API: playlists ---------------- */
const PLAYLIST_ID_RE = /^[\w\-. ]+\.xpl$/i;
const playlistPath = (id) => path.join(PLAYLISTS_DIR, id);

app.get('/api/playlists', (req, res) => {
  const files = fs.existsSync(PLAYLISTS_DIR)
    ? fs.readdirSync(PLAYLISTS_DIR).filter((f) => f.toLowerCase().endsWith('.xpl'))
    : [];
  files.sort((a, b) => a.localeCompare(b));
  res.json(files.map((f) => ({ id: f, name: f.replace(/\.xpl$/i, '') })));
});

app.get('/api/playlist/:id', (req, res) => {
  if (!PLAYLIST_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  const file = playlistPath(req.params.id);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  const text = fs.readFileSync(file, 'utf8');
  const entries = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  res.json({ id: req.params.id, name: req.params.id.replace(/\.xpl$/i, ''), entries });
});

app.post('/api/playlist/:id', (req, res) => {
  if (!PLAYLIST_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  const entries = Array.isArray(req.body && req.body.entries) ? req.body.entries.map(String) : null;
  if (!entries) return res.status(400).json({ error: 'entries must be an array' });
  fs.writeFileSync(playlistPath(req.params.id), entries.join('\n') + (entries.length ? '\n' : ''), 'utf8');
  broadcast('playlist:updated', { id: req.params.id });
  res.json({ ok: true });
});

app.delete('/api/playlist/:id', (req, res) => {
  if (!PLAYLIST_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  const file = playlistPath(req.params.id);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  fs.unlinkSync(file);
  broadcast('playlist:updated', { id: req.params.id, deleted: true });
  res.json({ ok: true });
});

/* ---------------- API: config ---------------- */
app.get('/api/config', (req, res) => { res.json(config); });

function cleanSectionOscSuffix(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  // Tolerate users pasting a full path — strip the known prefix and any leading slashes.
  s = s.replace(/^\/+/, '');
  if (s.toLowerCase().startsWith('xlyrics/section/')) s = s.slice('xlyrics/section/'.length);
  s = s.replace(/^\/+|\/+$/g, '').toLowerCase();
  return s;
}

function cleanSections(list) {
  return list
    .filter((x) => x && typeof x.name === 'string' && x.name.trim())
    .map((x) => ({
      name: String(x.name).trim(),
      color: typeof x.color === 'string' && /^#[0-9a-f]{6}$/i.test(x.color) ? x.color : '#5b8fd8',
      hotkey: typeof x.hotkey === 'string' && x.hotkey.trim() ? x.hotkey.trim().toLowerCase().slice(0, 1) : null,
      osc: cleanSectionOscSuffix(x.osc),
    }));
}

function slugify(s) {
  return String(s || '').trim().replace(/^\//, '').replace(/\.html$/i, '')
    .replace(/[^a-z0-9\-_]/gi, '-').toLowerCase().replace(/^-+|-+$/g, '');
}

function cleanOutputs(list, prev) {
  const seenIds = new Set();
  const seenPaths = new Set();
  const out = [];
  for (const x of list) {
    if (!x || typeof x.name !== 'string' || !x.name.trim()) continue;
    const name = String(x.name).trim();
    let id = typeof x.id === 'string' && x.id.trim() ? slugify(x.id) : slugify(name);
    if (!id) id = 'output';
    let base = id, n = 2;
    while (seenIds.has(id)) id = `${base}-${n++}`;
    let pth = slugify(typeof x.path === 'string' && x.path.trim() ? x.path : id);
    if (!pth || RESERVED_PATHS.has(pth)) continue;
    let pbase = pth, pn = 2;
    while (seenPaths.has(pth)) pth = `${pbase}-${pn++}`;
    const layout = typeof x.layout === 'string' && x.layout.trim() ? x.layout.trim() : 'default';
    seenIds.add(id); seenPaths.add(pth);
    out.push({ id, name, path: pth, layout });
  }
  return out.length ? out : prev;
}

app.post('/api/config', (req, res) => {
  const body = req.body || {};
  const patch = {};
  if (Array.isArray(body.sections)) patch.sections = cleanSections(body.sections);
  if (Array.isArray(body.outputs))  patch.outputs  = cleanOutputs(body.outputs, config.outputs);
  if (body.resolume && typeof body.resolume === 'object') patch.resolume = cleanResolume(body.resolume, config.resolume);
  if (body.network  && typeof body.network  === 'object') patch.network  = cleanNetwork(body.network,  config.network);
  config = { ...config, ...patch };
  saveConfig();
  broadcast('config', config);
  refreshOscListener();
  // Reset dedupe so the new clip set re-receives the current text on next change
  lastResolumeText = null;
  // Push current state out via feedback if just enabled
  broadcastFeedback(displayState);
  res.json({ ok: true, config });
});

// Send a one-shot test to a Resolume clip (or arbitrary host/port/address).
app.post('/api/resolume/test', async (req, res) => {
  const b = req.body || {};
  const r = config.resolume;
  const host = typeof b.host === 'string' && b.host.trim() ? b.host.trim() : r.host;
  const port = Number.isFinite(Number(b.port)) && Number(b.port) > 0 ? Math.floor(Number(b.port)) : r.port;
  const address = typeof b.address === 'string' && b.address.trim().startsWith('/') ? b.address.trim() : null;
  if (!address) return res.status(400).json({ error: 'address required' });
  const message = typeof b.message === 'string' ? b.message : 'xLyrics test';
  try {
    await sendOscString(host, port, address, message);
    if (b.triggerClip) {
      const connectAddr = deriveConnectAddress(address);
      if (connectAddr) await sendOscInt(host, port, connectAddr, 1);
    }
    lastResolumeText = null;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send a feedback ping using the configured feedback host/port/prefix.
app.post('/api/network/feedback/test', async (req, res) => {
  const fb = config.network && config.network.feedback;
  if (!fb) return res.status(400).json({ error: 'feedback not configured' });
  const b = req.body || {};
  const host = typeof b.host === 'string' && b.host.trim() ? b.host.trim() : fb.host;
  const port = Number.isFinite(Number(b.port)) && Number(b.port) > 0 ? Math.floor(Number(b.port)) : fb.port;
  const prefix = (typeof b.prefix === 'string' && b.prefix.trim().startsWith('/')
    ? b.prefix.trim() : fb.prefix).replace(/\/+$/, '');
  try {
    const buf = oscMessage(`${prefix}/test`, [{ type: 's', value: 'xLyrics feedback test' }]);
    await sendOscRaw(host, port, buf);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- API: outputs ---------------- */
app.get('/api/outputs', (req, res) => { res.json(config.outputs); });

app.post('/api/output/:id/layout', (req, res) => {
  const id = req.params.id;
  const layout = String((req.body && req.body.layout) || 'default').trim() || 'default';
  const idx = config.outputs.findIndex((o) => o.id === id);
  if (idx < 0) return res.status(404).json({ error: 'output not found' });
  config.outputs[idx] = { ...config.outputs[idx], layout };
  saveConfig();
  broadcast('config', config);
  res.json({ ok: true });
});

/* ---------------- API: display ---------------- */
app.post('/api/display/update', (req, res) => {
  const b = req.body || {};
  if (typeof b.content !== 'string') return res.status(400).json({ error: 'content (string) required' });
  setDisplay({
    cleared: false,
    songId: b.songId || null,
    songTitle: b.songTitle || null,
    sectionName: b.sectionName || null,
    arrIndex: Number.isFinite(b.arrIndex) ? b.arrIndex : -1,
    frameIndex: Number.isFinite(b.frameIndex) ? b.frameIndex : -1,
    content: b.content,
    nextContent: typeof b.nextContent === 'string' ? b.nextContent : '',
  });
  res.json({ ok: true, state: displayState });
});

app.post('/api/display/clear', (req, res) => {
  clearDisplay();
  res.json({ ok: true });
});

app.post('/api/display/fade', (req, res) => {
  const ms = Math.max(0, Math.min(2000, Number(req.body && req.body.fadeMs) || 0));
  setDisplay({ fadeMs: ms });
  res.json({ ok: true });
});

/* ---------------- API: layout source (editor) ---------------- */
const LAYOUT_NAME_RE = /^[a-z0-9][a-z0-9 _\-]*$/i;

app.get('/api/layout/:name/source', (req, res) => {
  const name = req.params.name;
  if (!LAYOUT_NAME_RE.test(name)) return res.status(400).json({ error: 'invalid name' });
  const file = path.join(LAYOUTS_DIR, `${name}.xlayout`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.type('text/plain').send(fs.readFileSync(file, 'utf8'));
});

app.put('/api/layout/:name/source', (req, res) => {
  const name = req.params.name;
  if (!LAYOUT_NAME_RE.test(name)) return res.status(400).json({ error: 'invalid name' });
  const body = req.body;
  if (typeof body !== 'string' && typeof body?.source !== 'string')
    return res.status(400).json({ error: 'source string required' });
  const source = typeof body === 'string' ? body : body.source;
  const file = path.join(LAYOUTS_DIR, `${name}.xlayout`);
  fs.writeFileSync(file, source, 'utf8');
  broadcast('layout:updated', { name });
  res.json({ ok: true });
});


app.delete('/api/layout/:name', (req, res) => {
  const name = req.params.name;
  if (!LAYOUT_NAME_RE.test(name)) return res.status(400).json({ error: 'invalid name' });
  const file = path.join(LAYOUTS_DIR, `${name}.xlayout`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  fs.unlinkSync(file);
  broadcast('layout:updated', { name, deleted: true });
  res.json({ ok: true });
});

/* ---------------- Static & output routes ---------------- */
app.use(express.static(PUBLIC_DIR));
app.use('/layouts', express.static(LAYOUTS_DIR));
app.use('/images', express.static(IMAGES_DIR));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(IMAGES_DIR, 'xlyrics-favicon.png')));

// Dynamic output routes — serve output.html for any configured output path.
app.get('/:slug', (req, res, next) => {
  const slug = req.params.slug;
  if (!slug || slug.includes('.')) return next();
  if (RESERVED_PATHS.has(slug)) return next();
  const out = config.outputs.find((o) => o.path === slug);
  if (!out) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'output.html'));
});

app.get('/', (req, res) => res.redirect('/control.html'));

app.listen(PORT, () => {
  console.log(`\nxLyrics running`);
  console.log(`  Control: http://localhost:${PORT}/control.html`);
  for (const o of config.outputs) {
    console.log(`  Output "${o.name}": http://localhost:${PORT}/${o.path}`);
  }
  console.log();
  refreshOscListener();
});
