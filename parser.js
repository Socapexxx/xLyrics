const SHORTHAND = {
  v: 'Verse', c: 'Chorus', b: 'Bridge',
  pc: 'Pre Chorus', t: 'Tag', i: 'Intro', o: 'Outro',
};

export const SEPARATOR = /^(-{3,}|—+-*|_{3,})$/;

function resolveShorthand(rawName) {
  const name = rawName.trim();
  const lc = name.toLowerCase();
  if (SHORTHAND[lc]) return SHORTHAND[lc];
  const m = lc.match(/^([vcb])(\d+)$/);
  if (m) return `${SHORTHAND[m[1]]} ${m[2]}`;
  return name;
}

/**
 * Parses header "key" part into arrangement info.
 * Returns { name } if this is an arrangement line, or null.
 *   - "Arrangement"            -> { name: 'default' }
 *   - "Default Arrangement"    -> { name: 'default' }
 *   - "Arrangement Live"       -> { name: 'Live' }
 *   - "Arrangement Album Take" -> { name: 'Album Take' }
 */
function parseArrangementKey(key) {
  const trimmed = key.trim();
  const lc = trimmed.toLowerCase();
  if (lc === 'arrangement' || lc === 'default arrangement') return { name: 'default' };
  const m = trimmed.match(/^arrangement\s+(.+)$/i);
  if (m) return { name: m[1].trim() };
  return null;
}

// Header keys we never want to mistake for a section, even if the line is
// "Key:" with an empty value.
const HEADER_KEYWORDS = /^(title|artist|album|tags?|notes?|key|tempo|bpm|ccli|copyright|©|year|composer|author|authors|book|number|publisher|capo|time)$/i;

// Patterns commonly used as section names in lyric files. Used to disambiguate
// "Verse 1:" (section) from a header key followed by an empty value.
const SECTION_KEYWORDS = /^(verse|chorus|bridge|intro|outro|tag|pre[\s-]?chorus|post[\s-]?chorus|interlude|coda|refrain|ending|hook|vamp|turnaround|breakdown|instrumental|solo|prechorus|postchorus)(\s*\d+)?$/i;

function explicitSectionMarker(raw) {
  const t = raw.trim();
  if (t.startsWith('#')) return { name: t.slice(1).trim() };
  const br = t.match(/^\[(.+)\]$/);
  if (br) return { name: br[1].trim() };
  return null;
}

function colonSectionMarker(raw) {
  // "Verse 1:" — non-empty name, optional spaces, colon, nothing else after
  const t = raw.trim();
  const m = t.match(/^([^:]+):\s*$/);
  if (!m) return null;
  const name = m[1].trim();
  if (HEADER_KEYWORDS.test(name)) return null;
  if (!SECTION_KEYWORDS.test(name)) return null;
  return { name };
}

export function parseSong(text) {
  const lines = text.split(/\r?\n/);
  const header = {};
  const arrangements = [];
  const sections = [];
  let currentSection = null;
  let currentFrame = null;
  let inBody = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Explicit `---` / `___` separator forces transition to body
    if (!inBody && SEPARATOR.test(trimmed)) { inBody = true; continue; }

    // Any recognised section marker also flips us into body mode
    const marker = explicitSectionMarker(raw) || colonSectionMarker(raw);
    if (marker) {
      inBody = true;
      currentSection = { name: marker.name, frames: [] };
      sections.push(currentSection);
      currentFrame = null;
      continue;
    }

    if (!inBody) {
      const m = raw.match(/^([^:]+):\s*(.*)$/);
      if (m) {
        const key = m[1];
        const value = m[2].trim();
        const arr = parseArrangementKey(key);
        if (arr) {
          const sequence = value.split(',').map(resolveShorthand).filter(Boolean);
          arrangements.push({ name: arr.name, sequence });
        } else if (value) {
          header[key.trim().toLowerCase()] = value;
        }
      }
      continue;
    }

    // Body — collect lyric frames into the current section
    if (!currentSection) continue;
    if (trimmed === '') { currentFrame = null; continue; }
    if (!currentFrame) {
      currentFrame = [];
      currentSection.frames.push(currentFrame);
    }
    currentFrame.push(raw);
  }

  // Auto-number duplicate section names (#Chorus appearing twice -> "Chorus 1", "Chorus 2")
  const totals = {};
  for (const s of sections) totals[s.name] = (totals[s.name] || 0) + 1;
  const seen = {};
  for (const s of sections) {
    if (totals[s.name] > 1) {
      seen[s.name] = (seen[s.name] || 0) + 1;
      s.name = `${s.name} ${seen[s.name]}`;
    }
  }

  // If no explicit arrangements, fall back to file-order as the default
  if (arrangements.length === 0) {
    arrangements.push({ name: 'default', sequence: sections.map(s => s.name) });
  }

  // Make sure there is always a 'default' arrangement — use the first if not
  let hasDefault = arrangements.some(a => a.name === 'default');
  if (!hasDefault) {
    arrangements.unshift({ name: 'default', sequence: arrangements[0].sequence.slice() });
  }

  const defaultArrangement = arrangements.find(a => a.name === 'default');
  const playlist = buildPlaylist(sections, defaultArrangement.sequence);

  return {
    header,
    sections,
    arrangements,
    arrangement: defaultArrangement.sequence, // back-compat
    playlist, // built from default
  };
}

export function buildPlaylist(sections, sequence) {
  const byName = new Map();
  for (const s of sections) byName.set(s.name.toLowerCase(), s);
  const out = [];
  sequence.forEach((name, arrIndex) => {
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
  return out;
}

/**
 * Returns true if the line is any "Arrangement ...:" or "Default Arrangement:" header line.
 */
export function isArrangementLine(line) {
  return /^\s*(default\s+arrangement|arrangement(\s+[^:]+)?)\s*:/i.test(line);
}

/**
 * Formats an arrangement into its file header line.
 */
export function formatArrangementLine({ name, sequence }) {
  const label = !name || name.toLowerCase() === 'default'
    ? 'Arrangement'
    : `Arrangement ${name}`;
  return `${label}: ${sequence.join(', ')}`;
}
