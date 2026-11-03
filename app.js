'use strict';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const APP = 'biblioteka';
const MISTRAL_URL = 'https://api.mistral.ai/v1';
const DEFAULTS = {
  user: '',
  mistralKey: '',
  model: 'mistral-large-latest',
  githubToken: '',
  repo: 'gchrupala/app-data',
};

const LANGS = {
  pl: 'polski',
  en: 'angielski',
  nl: 'niderlandzki',
  fa: 'perski (farsi)',
  es: 'hiszpański',
};

const MODES = {
  brainstorm: { label: 'Pomysły', placeholder: 'O czym jest twoje opowiadanie? Z czym potrzebujesz pomocy?' },
  translate: { label: 'Tłumaczenie', placeholder: 'Wklej tekst do przetłumaczenia albo napisz, co zmienić.' },
};

function systemPrompt(conv) {
  if (conv.mode === 'translate') {
    const lang = LANGS[conv.targetLang] || conv.targetLang;
    return `Jesteś tłumaczem literackim. Tłumaczysz opowiadania dwunastoletniej autorki na język ${lang}.

Zasady:
- Przetłumacz cały tekst. Niczego nie pomijaj i nie streszczaj.
- Zachowaj jej styl, ton i sposób opowiadania. Nie upiększaj tekstu i nie poprawiaj treści.
- Imiona i nazwy własne zostaw bez zmian, chyba że autorka poprosi inaczej.
- Gry słów, rymy i powiedzonka oddaj tak, żeby działały w języku docelowym.
- Po persku pisz alfabetem perskim, chyba że autorka poprosi o transkrypcję łacińską.
- Najpierw podaj samo tłumaczenie. Potem, tylko jeśli to potrzebne, dodaj krótką listę „Uwagi” z wyjaśnieniem trudniejszych decyzji, w języku, w którym pisze autorka.
- Jeśli autorka zadaje pytanie o tłumaczenie albo prosi o zmianę, odpowiedz na to, zamiast tłumaczyć jej wiadomość.`;
  }
  return `Jesteś pomocnikiem dwunastoletniej pisarki. Pomagasz jej wymyślać i rozwijać jej własne opowiadania: postacie, świat, fabułę, zwroty akcji, tytuły i dialogi.

Zasady:
- To jej historia. Proponuj, pytaj i podsuwaj kilka możliwości do wyboru, ale nie pisz całego opowiadania za nią, chyba że wyraźnie o to poprosi.
- Zadawaj pytania, które pomagają jej samej wpaść na pomysł, na przykład czego chce bohater i co stoi mu na drodze.
- Kiedy pokazuje fragment tekstu, powiedz konkretnie, co działa, i zaproponuj jedną lub dwie rzeczy do poprawy.
- Odpowiadaj krótko i jasno, w języku, w którym ona pisze.
- Pisz prosto, ale nie infantylnie.`;
}

// ---------------------------------------------------------------------------
// Local storage
// ---------------------------------------------------------------------------

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

const settings = { ...DEFAULTS, ...load(`${APP}-settings`, {}) };
const state = load(`${APP}-state`, { conversations: {}, activeId: null });
let device = load(`${APP}-device`, null);
if (!device) {
  device = Math.random().toString(36).slice(2, 18);
  store(`${APP}-device`, device);
}

function saveState() { store(`${APP}-state`, state); }
function saveSettings() { store(`${APP}-settings`, settings); }

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}

function liveConversations() {
  return Object.values(state.conversations)
    .filter(c => !c.deleted)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function activeConv() {
  const c = state.conversations[state.activeId];
  return c && !c.deleted ? c : null;
}

function createConversation(mode) {
  const now = Date.now();
  const conv = {
    id: newId(),
    mode,
    targetLang: mode === 'translate' ? (settings.lastTargetLang || 'en') : null,
    title: '',
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  state.conversations[conv.id] = conv;
  state.activeId = conv.id;
  saveState();
  render();
  closeSidebar();
  $('#input').focus();
}

function touch(conv) {
  conv.updatedAt = Date.now();
  saveState();
}

function deleteConversation(conv) {
  if (!confirm('Usunąć tę rozmowę?')) return;
  // Keep a tombstone so the deletion also reaches other devices on sync.
  state.conversations[conv.id] = { id: conv.id, deleted: true, updatedAt: Date.now() };
  state.activeId = liveConversations()[0]?.id || null;
  saveState();
  render();
  scheduleSync();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const $ = sel => document.querySelector(sel);

function renderMarkdown(text) {
  if (window.marked && window.DOMPurify) {
    return DOMPurify.sanitize(marked.parse(text, { breaks: true }));
  }
  const div = document.createElement('div');
  div.textContent = text;
  div.style.whiteSpace = 'pre-wrap';
  return div.outerHTML;
}

// Sets rendered Markdown and lets each block pick its own text direction,
// so Persian (right-to-left) and Latin-script paragraphs both display correctly.
function setMarkdown(el, text) {
  el.innerHTML = renderMarkdown(text);
  el.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, div')
    .forEach(block => { block.dir = 'auto'; });
}

function formatDate(ms) {
  return new Date(ms).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
}

function renderList() {
  const list = $('#conv-list');
  list.innerHTML = '';
  for (const conv of liveConversations()) {
    const li = document.createElement('li');
    if (conv.id === state.activeId) li.classList.add('active');
    const title = document.createElement('span');
    title.className = 'conv-title';
    title.textContent = conv.title || 'Nowa rozmowa';
    title.dir = 'auto';
    const meta = document.createElement('span');
    meta.className = 'conv-meta';
    meta.textContent = `${MODES[conv.mode].label} · ${formatDate(conv.updatedAt)}`;
    li.append(title, meta);
    li.onclick = () => {
      state.activeId = conv.id;
      saveState();
      render();
      closeSidebar();
    };
    list.append(li);
  }
}

function messageElement(msg) {
  const div = document.createElement('div');
  div.className = `msg ${msg.role}`;
  div.dir = 'auto';
  if (msg.role === 'user') {
    div.textContent = msg.content;
  } else {
    const body = document.createElement('div');
    body.className = 'msg-body';
    setMarkdown(body, msg.content);
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const copy = document.createElement('button');
    copy.textContent = 'Kopiuj';
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(msg.content);
        copy.textContent = 'Skopiowano';
        setTimeout(() => { copy.textContent = 'Kopiuj'; }, 1500);
      } catch { /* clipboard not available */ }
    };
    actions.append(copy);
    div.append(body, actions);
  }
  return div;
}

function renderWelcome(container) {
  const div = document.createElement('div');
  div.className = 'welcome';
  div.innerHTML = `
    <h2>Cześć!</h2>
    <p>Wybierz <strong>Pomysły</strong>, żeby razem wymyślać opowiadanie,
    albo <strong>Tłumaczenie</strong>, żeby przetłumaczyć tekst.</p>
    <div class="new-buttons">
      <button class="primary" data-mode="brainstorm">+ Pomysły</button>
      <button class="primary" data-mode="translate">+ Tłumaczenie</button>
    </div>`;
  div.querySelectorAll('button').forEach(b => { b.onclick = () => createConversation(b.dataset.mode); });
  container.append(div);
}

function renderChat() {
  const conv = activeConv();
  const messages = $('#messages');
  messages.innerHTML = '';
  $('#composer').hidden = !conv;
  $('#delete-conv').hidden = !conv;
  $('#lang-wrap').hidden = !conv || conv.mode !== 'translate';

  if (!conv) {
    $('#chat-title').textContent = '';
    renderWelcome(messages);
    return;
  }

  $('#chat-title').textContent = conv.title || MODES[conv.mode].label;
  $('#input').placeholder = MODES[conv.mode].placeholder;
  if (conv.mode === 'translate') $('#target-lang').value = conv.targetLang;
  for (const msg of conv.messages) messages.append(messageElement(msg));
  messages.scrollTop = messages.scrollHeight;
}

function render() {
  renderList();
  renderChat();
}

function openSidebar() { $('#sidebar').classList.add('open'); }
function closeSidebar() { $('#sidebar').classList.remove('open'); }

// ---------------------------------------------------------------------------
// Mistral chat
// ---------------------------------------------------------------------------

let controller = null;

async function send(text) {
  let conv = activeConv();
  if (!conv || controller) return;
  if (!settings.mistralKey) {
    openSettings();
    return;
  }

  conv.messages.push({ role: 'user', content: text, at: Date.now() });
  if (!conv.title) conv.title = text.replace(/\s+/g, ' ').slice(0, 50);
  touch(conv);
  render();

  const reply = { role: 'assistant', content: '', at: Date.now() };
  const el = messageElement(reply);
  const body = el.querySelector('.msg-body');
  const messages = $('#messages');
  messages.append(el);
  messages.scrollTop = messages.scrollHeight;

  controller = new AbortController();
  setBusy(true);

  try {
    const res = await fetch(`${MISTRAL_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.mistralKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.model || DEFAULTS.model,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt(conv) },
          ...conv.messages.map(m => ({ role: m.role, content: m.content })),
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(await errorText(res));

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const data = line.replace(/^data: ?/, '').trim();
        if (!line.startsWith('data:') || !data || data === '[DONE]') continue;
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (typeof delta === 'string') reply.content += delta;
      }
      setMarkdown(body, reply.content);
      messages.scrollTop = messages.scrollHeight;
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      const e = document.createElement('div');
      e.className = 'msg error';
      e.textContent = `Błąd: ${err.message}`;
      messages.append(e);
    }
  } finally {
    controller = null;
    setBusy(false);
  }

  conv = state.conversations[conv.id];
  if (reply.content && conv?.messages) {
    conv.messages.push(reply);
    touch(conv);
    renderList();
    scheduleSync();
  } else {
    el.remove();
  }
}

async function errorText(res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j.message || j.detail || JSON.stringify(j);
  } catch { /* not JSON */ }
  if (res.status === 401) return 'nieprawidłowy klucz API (sprawdź ustawienia)';
  if (res.status === 429) return 'za dużo zapytań, spróbuj za chwilę';
  return `${res.status} ${detail}`.trim();
}

function setBusy(busy) {
  $('#send').disabled = busy;
  $('#stop').hidden = !busy;
}

async function loadModels() {
  if (!settings.mistralKey) return;
  try {
    const res = await fetch(`${MISTRAL_URL}/models`, {
      headers: { 'Authorization': `Bearer ${settings.mistralKey}` },
    });
    if (!res.ok) return;
    const { data } = await res.json();
    const list = $('#model-list');
    list.innerHTML = '';
    for (const m of data.filter(m => m.capabilities?.completion_chat !== false)) {
      const opt = document.createElement('option');
      opt.value = m.id;
      list.append(opt);
    }
  } catch { /* offline */ }
}

// ---------------------------------------------------------------------------
// GitHub sync: one JSON file per user at <user>/biblioteka.json
// ---------------------------------------------------------------------------

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function syncConfigured() {
  return settings.githubToken && settings.repo && settings.user;
}

function dataPath() {
  return [settings.user.trim(), `${APP}.json`].map(encodeURIComponent).join('/');
}

async function gh(path, options = {}) {
  const res = await fetch(`https://api.github.com/repos/${settings.repo}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${settings.githubToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
    cache: 'no-store',
  });
  return res;
}

async function fetchRemote() {
  const res = await gh(`/contents/${dataPath()}`);
  if (res.status === 404) return { sha: null, conversations: {} };
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const meta = await res.json();
  let content = meta.content;
  // The contents API leaves `content` empty for files over 1 MB; the blob API has no such limit.
  if (!content && meta.size > 0) {
    const blob = await gh(`/git/blobs/${meta.sha}`);
    if (!blob.ok) throw new Error(`GitHub ${blob.status}`);
    content = (await blob.json()).content;
  }
  const json = content ? JSON.parse(b64decode(content)) : {};
  return { sha: meta.sha, conversations: json.data?.conversations || {} };
}

function merge(local, remote) {
  const out = { ...remote };
  for (const [id, conv] of Object.entries(local)) {
    // Ties keep the local object, so references held elsewhere stay valid.
    if (!out[id] || conv.updatedAt >= out[id].updatedAt) out[id] = conv;
  }
  return out;
}

let syncing = false;
let syncTimer = null;

function scheduleSync() {
  if (!syncConfigured()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, 3000);
}

function setSyncStatus(text, isError = false) {
  const el = $('#sync-status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

async function sync() {
  if (!syncConfigured()) {
    setSyncStatus('wyłączona');
    return;
  }
  // Don't sync while a reply is streaming in; try again afterwards.
  if (syncing || controller) { scheduleSync(); return; }
  syncing = true;
  setSyncStatus('synchronizuję…');
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await fetchRemote();
      const merged = merge(state.conversations, remote.conversations);
      state.conversations = merged;
      if (state.activeId && !activeConv()) state.activeId = liveConversations()[0]?.id || null;
      saveState();
      render();

      if (JSON.stringify(merged) === JSON.stringify(remote.conversations)) break;

      const body = {
        message: `Biblioteka: zapis ${new Date().toISOString()}`,
        content: b64encode(JSON.stringify({
          [APP]: 1,
          saved: Date.now(),
          device,
          data: { conversations: merged },
        }, null, 1)),
      };
      if (remote.sha) body.sha = remote.sha;
      const res = await gh(`/contents/${dataPath()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) break;
      // 409/422: the file changed on another device since we read it; fetch and merge again.
      if (res.status !== 409 && res.status !== 422) throw new Error(`GitHub ${res.status}`);
      if (attempt === 2) throw new Error('konflikt zapisu');
    }
    setSyncStatus(`zsynchronizowano ${new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (err) {
    setSyncStatus(`błąd: ${err.message}`, true);
  } finally {
    syncing = false;
  }
}

// ---------------------------------------------------------------------------
// Settings dialog
// ---------------------------------------------------------------------------

function openSettings() {
  const form = $('#settings-form');
  for (const key of Object.keys(DEFAULTS)) form.elements[key].value = settings[key] || '';
  loadModels();
  $('#settings').showModal();
}

$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'save') return;
  const form = $('#settings-form');
  for (const key of Object.keys(DEFAULTS)) settings[key] = form.elements[key].value.trim();
  saveSettings();
  sync();
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

for (const [code, name] of Object.entries(LANGS)) {
  const opt = document.createElement('option');
  opt.value = code;
  opt.textContent = name;
  $('#target-lang').append(opt);
}

$('#target-lang').onchange = e => {
  const conv = activeConv();
  if (!conv) return;
  conv.targetLang = e.target.value;
  settings.lastTargetLang = e.target.value;
  saveSettings();
  touch(conv);
  scheduleSync();
};

$('#new-brainstorm').onclick = () => createConversation('brainstorm');
$('#new-translate').onclick = () => createConversation('translate');
$('#delete-conv').onclick = () => { const c = activeConv(); if (c) deleteConversation(c); };
$('#settings-btn').onclick = openSettings;
$('#sync-btn').onclick = sync;
$('#open-sidebar').onclick = openSidebar;
$('#close-sidebar').onclick = closeSidebar;
$('#stop').onclick = () => controller?.abort();

$('#composer').onsubmit = e => {
  e.preventDefault();
  const text = $('#input').value.trim();
  if (!text) return;
  $('#input').value = '';
  send(text);
};

$('#input').addEventListener('keydown', e => {
  // Ctrl+Enter (Cmd+Enter on Mac) sends; plain Enter adds a new line.
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sync();
});

if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* not installable, still works */ });
}

render();
if (!settings.mistralKey) openSettings();
sync();
