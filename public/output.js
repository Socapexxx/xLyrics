/* xLyrics output runtime — renders a .xlayout file populated from live state. */

const XL_VARS = ['current', 'next', 'section', 'song_title'];

let outputId = null;
let currentLayoutName = null;
let currentLayoutText = null;
let lastState = null;

function resolveCandidatePath() {
  const p = window.location.pathname.replace(/^\//, '').replace(/\.html$/, '');
  return p || 'output';
}

async function resolveOutput() {
  const candidate = resolveCandidatePath();
  try {
    const outputs = await (await fetch('/api/outputs')).json();
    let out = outputs.find((o) => o.path === candidate);
    if (!out && candidate === 'output') out = outputs.find((o) => o.id === 'main') || outputs[0];
    if (!out) out = outputs[0];
    if (out) {
      outputId = out.id;
      return out;
    }
  } catch { /* fall through */ }
  outputId = 'main';
  return { id: 'main', name: 'Main', layout: 'default' };
}

async function fetchLayout(name) {
  const res = await fetch(`/layouts/${encodeURIComponent(name)}.xlayout`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`layout "${name}" not found (${res.status})`);
  return res.text();
}

function varsToSpans(html) {
  let out = html;
  for (const v of XL_VARS) {
    const re = new RegExp(`\\{\\{\\s*${v}\\s*\\}\\}`, 'g');
    out = out.replace(re, `<span data-xl="${v}"></span>`);
  }
  return out;
}

function installLayout(text) {
  let body = text;

  // Extract <style> blocks into dynamic <style data-xl-layout> in <head>.
  const styles = [];
  body = body.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_m, css) => { styles.push(css); return ''; });

  // Extract <link rel="stylesheet"> tags into head (allows external CSS references).
  const links = [];
  body = body.replace(/<link\b[^>]*>/gi, (tag) => { links.push(tag); return ''; });

  // Extract <script> blocks so they can run after the body is installed
  // (innerHTML assignment does not execute embedded scripts).
  const scripts = [];
  body = body.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (_m, attrs, code) => {
    scripts.push({ attrs, code });
    return '';
  });

  // Substitute template vars with populatable spans.
  body = varsToSpans(body);

  // Clear previous dynamic layout artefacts (styles, links, scripts).
  document.querySelectorAll('[data-xl-layout]').forEach((n) => n.remove());

  for (const css of styles) {
    const s = document.createElement('style');
    s.setAttribute('data-xl-layout', '');
    s.textContent = css;
    document.head.appendChild(s);
  }
  for (const linkTag of links) {
    const container = document.createElement('div');
    container.innerHTML = linkTag;
    const el = container.firstElementChild;
    if (el) {
      el.setAttribute('data-xl-layout', '');
      document.head.appendChild(el);
    }
  }

  // Replace body content.
  document.body.innerHTML = body;

  for (const { attrs, code } of scripts) {
    const s = document.createElement('script');
    s.setAttribute('data-xl-layout', '');
    const srcMatch = attrs && attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (srcMatch) s.src = srcMatch[1];
    else s.textContent = code;
    document.body.appendChild(s);
  }
}

function setVarText(name, text) {
  const nodes = document.querySelectorAll(`[data-xl="${name}"]`);
  for (const n of nodes) n.textContent = text || '';
}

function fadeCurrent(text, fadeMs) {
  const nodes = document.querySelectorAll('[data-xl="current"]');
  if (nodes.length === 0) return;
  if (fadeMs === 0) {
    for (const n of nodes) {
      n.style.transition = 'none';
      n.textContent = text || '';
      n.style.opacity = text ? '1' : '0';
      void n.offsetWidth;
    }
    return;
  }
  for (const n of nodes) {
    n.style.transition = `opacity ${fadeMs}ms ease-in-out`;
    n.style.opacity = '0';
  }
  setTimeout(() => {
    for (const n of nodes) {
      n.textContent = text || '';
      n.style.opacity = text ? '1' : '0';
    }
  }, fadeMs);
}

function applyState(state) {
  lastState = state;
  const cleared = !!state.cleared;
  const content = cleared ? '' : (state.content || '');
  const fadeMs = Number.isFinite(state.fadeMs) ? state.fadeMs : 300;
  fadeCurrent(content, fadeMs);
  setVarText('next', cleared ? '' : (state.nextContent || ''));
  setVarText('section', cleared ? '' : (state.sectionName || ''));
  setVarText('song_title', cleared ? '' : (state.songTitle || ''));
}

async function applyConfig(cfg) {
  const me = (cfg.outputs || []).find((o) => o.id === outputId);
  if (!me) return;
  if (me.layout === currentLayoutName) return;
  try {
    const text = await fetchLayout(me.layout);
    currentLayoutName = me.layout;
    currentLayoutText = text;
    installLayout(text);
    if (lastState) applyState(lastState);
  } catch (err) {
    console.error('[output] layout load failed:', err);
    // Fallback to a barebones frame so the page isn't blank.
    document.body.innerHTML = `<div style="color:#c66;padding:2em;font-family:sans-serif">Layout "${me.layout}" failed to load.<br><small>${err.message}</small></div>`;
  }
}

(async () => {
  const out = await resolveOutput();
  // Pull full config for initial layout name, then listen on SSE for updates.
  try {
    const cfg = await (await fetch('/api/config')).json();
    await applyConfig(cfg);
  } catch (err) {
    console.error('[output] initial config fetch failed:', err);
  }

  const evt = new EventSource('/events');
  evt.addEventListener('state', (e) => {
    try { applyState(JSON.parse(e.data)); } catch (err) { console.error(err); }
  });
  evt.addEventListener('config', (e) => {
    try {
      const cfg = JSON.parse(e.data);
      // SSE config event may be just {} from older broadcasts — re-fetch in that case.
      if (cfg && Array.isArray(cfg.outputs)) applyConfig(cfg);
      else fetch('/api/config').then((r) => r.json()).then(applyConfig).catch(() => {});
    } catch (err) { console.error(err); }
  });
})();
