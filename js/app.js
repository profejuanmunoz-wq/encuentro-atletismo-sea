/* ============================================================
   VI Encuentro Nacional de Atletismo — lógica de la app
   Fuente de datos: Google Sheets (si está configurada abajo) con
   data/data.json local como respaldo automático si algo falla.
   ============================================================ */

const REFRESH_MS = 25000; // cada cuánto se re-consultan los datos ("en vivo")

// -------- 1) CONFIGURA AQUÍ TU GOOGLE SHEETS --------
// spreadsheetId: en la URL de tu hoja, la parte entre '/d/' y '/edit'
// gids: haz clic en cada pestaña y copia el número después de '#gid=' en la URL
// Mientras spreadsheetId diga 'PON_AQUI...', la app usa data/data.json local.
const SHEETS_CONFIG = {
  spreadsheetId: '1eCKmNfi4gXksNteiMGsBD0FvYw7BJo2U',
  gids: {
    evento: '942667199',
    colegios: '1147733201',
    programa: '338808942',
    enVivo: '1925098239',
    enVivoSiguientes: '62098836',
    enVivoFeed: '701881838',
    medallero: '1945758813',
    fotos: '2035909068'
  }
};
// -----------------------------------------------------

let DATA = null;
let colegiosById = {};
let dataSource = null; // 'sheets' | 'local' — para poder diagnosticar desde la app

function sheetsConfigured(){
  return SHEETS_CONFIG.spreadsheetId && !SHEETS_CONFIG.spreadsheetId.startsWith('PON_AQUI');
}

function csvUrlCandidates(gid){
  return [
    `https://docs.google.com/spreadsheets/d/${SHEETS_CONFIG.spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${SHEETS_CONFIG.spreadsheetId}/export?format=csv&gid=${gid}`
  ];
}

function parseCsv(text){
  // parser simple de CSV (soporta comillas y comas dentro de campos)
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i=0; i<text.length; i++){
    const c = text[i], next = text[i+1];
    if(inQuotes){
      if(c === '"' && next === '"'){ field += '"'; i++; }
      else if(c === '"'){ inQuotes = false; }
      else field += c;
    }else{
      if(c === '"') inQuotes = true;
      else if(c === ','){ row.push(field); field = ''; }
      else if(c === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
      else if(c === '\r'){ /* ignorar */ }
      else field += c;
    }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim() !== ''));
}

async function fetchSheet(key){
  const gid = SHEETS_CONFIG.gids[key];
  let lastErr;
  for(const base of csvUrlCandidates(gid)){
    try{
      const sep = base.includes('?') ? '&' : '?';
      const res = await fetch(base + sep + '_=' + Date.now(), { cache: 'no-store' });
      if(!res.ok) throw new Error(`HTTP ${res.status} leyendo la pestaña "${key}"`);
      const text = await res.text();
      if(!text || !text.trim()) throw new Error(`Respuesta vacía leyendo la pestaña "${key}"`);
      return parseCsv(text);
    }catch(e){
      lastErr = e;
    }
  }
  throw lastErr;
}

function rowsToObjects(rows){
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => Object.fromEntries(headers.map((h,i) => [h, (r[i] ?? '').trim()])));
}
function kvRowsToObject(rows){
  return Object.fromEntries(rowsToObjects(rows).map(o => [o.Campo, o.Valor]));
}
function groupPrograma(rows){
  const order = [], map = new Map();
  rowsToObjects(rows).forEach(r => {
    const key = r.dia + '||' + r.fecha;
    if(!map.has(key)){ map.set(key, { dia: r.dia, fecha: r.fecha, bloques: [] }); order.push(key); }
    map.get(key).bloques.push({
      hora: r.hora, prueba: r.prueba, categoria: r.categoria,
      genero: r.genero, estado: (r.estado || 'programado').trim()
    });
  });
  return order.map(k => map.get(k));
}

async function loadFromSheets(){
  const keys = Object.keys(SHEETS_CONFIG.gids);
  const rowsByKey = Object.fromEntries(
    await Promise.all(keys.map(async k => [k, await fetchSheet(k)]))
  );

  const evento = kvRowsToObject(rowsByKey.evento);
  const enVivoKv = kvRowsToObject(rowsByKey.enVivo);

  return {
    evento,
    colegios: rowsToObjects(rowsByKey.colegios),
    programa: groupPrograma(rowsByKey.programa),
    enVivo: {
      activo: String(enVivoKv.activo).trim().toUpperCase() === 'TRUE',
      actual: {
        prueba: enVivoKv.actual_prueba || '',
        categoria: enVivoKv.actual_categoria || '',
        genero: enVivoKv.actual_genero || ''
      },
      siguientes: rowsToObjects(rowsByKey.enVivoSiguientes),
      feed: rowsToObjects(rowsByKey.enVivoFeed)
    },
    medallero: rowsToObjects(rowsByKey.medallero).map(m => ({
      id: m.id, oro: Number(m.oro) || 0, plata: Number(m.plata) || 0, bronce: Number(m.bronce) || 0
    })),
    fotos: rowsToObjects(rowsByKey.fotos).filter(f => f.url)
  };
}

async function loadFromLocalJson(){
  const res = await fetch('data/data.json?t=' + Date.now(), { cache: 'no-store' });
  if(!res.ok) throw new Error('No se pudo cargar data.json');
  return res.json();
}

async function loadData(){
  if(sheetsConfigured()){
    try{
      DATA = await loadFromSheets();
      dataSource = 'sheets';
    }catch(err){
      console.error('No se pudo leer Google Sheets, uso el respaldo local. Motivo:', err);
      try{ DATA = await loadFromLocalJson(); dataSource = 'local-fallback'; }
      catch(err2){ console.error('Tampoco se pudo cargar el respaldo local:', err2); return; }
    }
  }else{
    DATA = await loadFromLocalJson();
    dataSource = 'local-not-configured';
  }
  colegiosById = Object.fromEntries(DATA.colegios.map(c => [c.id, c]));
  renderAll();
}

function renderAll(){
  renderTopbar();
  renderInicio();
  renderPrograma();
  renderEnVivo();
  renderMedallas();
  renderUbicacion();
  renderFotos();
}

/* ---------------- Topbar ---------------- */
function renderTopbar(){
  const { evento, enVivo } = DATA;
  document.getElementById('tb-edicion').textContent = evento.edicion;
  document.getElementById('tb-nombre').textContent = evento.nombre;
  document.getElementById('live-pill').hidden = !enVivo.activo;

  const warn = document.getElementById('source-warning');
  if(dataSource === 'local-fallback'){
    warn.hidden = false;
    warn.textContent = '⚠️ No se pudo conectar con tu planilla de Google Sheets — mostrando datos de respaldo guardados en la app (pueden no ser los más recientes).';
  }else if(dataSource === 'local-not-configured'){
    warn.hidden = false;
    warn.textContent = 'ℹ️ Esta app aún no está conectada a Google Sheets — mostrando datos de ejemplo guardados en la app.';
  }else{
    warn.hidden = true;
  }
}

/* ---------------- Inicio ---------------- */
function renderInicio(){
  const { evento, enVivo, colegios, programa } = DATA;
  document.getElementById('hero-org').textContent = evento.organizacion;
  document.getElementById('hero-fecha').textContent = evento.fechaTexto;
  document.getElementById('hero-lugar').textContent = evento.lugar;

  document.getElementById('stat-colegios').textContent = colegios.length;
  document.getElementById('stat-dias').textContent = programa.length;
  const totalPruebas = programa.reduce((sum, d) => sum + d.bloques.length, 0);
  document.getElementById('stat-pruebas').textContent = totalPruebas;

  const liveCard = document.getElementById('home-live-card');
  if(enVivo.activo && enVivo.actual && enVivo.actual.prueba){
    liveCard.hidden = false;
    document.getElementById('home-live-prueba').textContent = enVivo.actual.prueba;
    document.getElementById('home-live-meta').textContent =
      [enVivo.actual.categoria, enVivo.actual.genero].filter(Boolean).join(' · ');
  }else{
    liveCard.hidden = true;
  }

  startCountdown(evento.fechaInicio);
}

let countdownTimer = null;
function startCountdown(fechaInicioISO){
  if(countdownTimer) clearInterval(countdownTimer);
  const target = new Date(fechaInicioISO).getTime();

  function tick(){
    const diff = target - Date.now();
    const card = document.getElementById('countdown-card');
    const liveMsg = document.getElementById('countdown-live');
    if(diff <= 0){
      card.querySelector('.countdown').hidden = true;
      liveMsg.hidden = false;
      clearInterval(countdownTimer);
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    document.getElementById('cd-d').textContent = String(d).padStart(2,'0');
    document.getElementById('cd-h').textContent = String(h).padStart(2,'0');
    document.getElementById('cd-m').textContent = String(m).padStart(2,'0');
    document.getElementById('cd-s').textContent = String(s).padStart(2,'0');
  }
  tick();
  countdownTimer = setInterval(tick, 1000);
}

/* ---------------- Programa ---------------- */
let diaActivo = 0;
function renderPrograma(){
  const tabsEl = document.getElementById('day-tabs');
  tabsEl.innerHTML = '';
  DATA.programa.forEach((dia, i) => {
    const btn = document.createElement('button');
    btn.className = 'day-tab' + (i === diaActivo ? ' is-active' : '');
    btn.textContent = dia.dia;
    btn.addEventListener('click', () => { diaActivo = i; renderPrograma(); });
    tabsEl.appendChild(btn);
  });
  renderProgramaLista();
}

const ESTADO_LABEL = { programado: 'Programado', en_curso: 'En curso', finalizado: 'Finalizado' };

function renderProgramaLista(){
  const lista = document.getElementById('programa-lista');
  const dia = DATA.programa[diaActivo];
  if(!dia || !dia.bloques.length){
    lista.innerHTML = '<p class="empty-state">Aún no hay pruebas cargadas para esta jornada.</p>';
    return;
  }
  lista.innerHTML = dia.bloques.map(b => `
    <div class="prueba-item">
      <span class="prueba-hora">${escapeHtml(b.hora)}</span>
      <div class="prueba-info">
        <p class="prueba-nombre">${escapeHtml(b.prueba)}</p>
        <div class="prueba-tags">
          ${b.categoria ? `<span class="tag">${escapeHtml(b.categoria)}</span>` : ''}
          ${b.genero ? `<span class="tag">${escapeHtml(b.genero)}</span>` : ''}
          <span class="tag tag-estado ${escapeAttr(b.estado)}">${escapeHtml(ESTADO_LABEL[b.estado] || b.estado)}</span>
        </div>
      </div>
    </div>
  `).join('');
}

/* ---------------- En vivo ---------------- */
function renderEnVivo(){
  const el = document.getElementById('envivo-contenido');
  const { enVivo, evento } = DATA;

  if(!enVivo.activo){
    el.innerHTML = `<p class="empty-state">La transmisión en vivo comenzará cuando inicie el encuentro, el ${escapeHtml(evento.fechaTexto)}.</p>`;
    return;
  }

  let html = '';

  if(enVivo.actual && enVivo.actual.prueba){
    html += `
      <div class="card envivo-actual">
        <p class="card-label">Compitiendo ahora</p>
        <p class="live-prueba">${escapeHtml(enVivo.actual.prueba)}</p>
        <p class="live-meta">${escapeHtml([enVivo.actual.categoria, enVivo.actual.genero].filter(Boolean).join(' · '))}</p>
      </div>`;
  }

  if(enVivo.siguientes && enVivo.siguientes.length){
    html += `<div class="card"><p class="card-label">A continuación</p>`;
    html += enVivo.siguientes.map(s => `
      <div class="envivo-siguientes-item">
        <span class="feed-hora">${escapeHtml(s.hora)}</span>
        <span class="feed-texto">${escapeHtml(s.prueba)}</span>
      </div>`).join('');
    html += `</div>`;
  }

  if(enVivo.feed && enVivo.feed.length){
    html += `<div class="card"><p class="card-label">Actualizaciones</p>`;
    html += enVivo.feed.slice().reverse().map(f => `
      <div class="feed-item">
        <span class="feed-hora">${escapeHtml(f.hora)}</span>
        <span class="feed-texto">${escapeHtml(f.texto)}</span>
      </div>`).join('');
    html += `</div>`;
  }

  if(!html){
    html = '<p class="empty-state">El encuentro está en curso. Aún no hay actualizaciones cargadas.</p>';
  }

  el.innerHTML = html;
}

/* ---------------- Medallas ---------------- */
function renderMedallas(){
  const body = document.getElementById('medal-body');
  const rows = DATA.medallero
    .map(m => ({ ...m, colegio: colegiosById[m.id] }))
    .filter(m => m.colegio)
    .sort((a,b) => (b.oro - a.oro) || (b.plata - a.plata) || (b.bronce - a.bronce));

  body.innerHTML = rows.map(m => `
    <tr>
      <td class="medal-colegio">
        <span class="medal-dot" style="background:${escapeAttr(m.colegio.color)}"></span>
        ${escapeHtml(m.colegio.corto)}
      </td>
      <td>${m.oro}</td>
      <td>${m.plata}</td>
      <td>${m.bronce}</td>
      <td class="medal-total">${m.oro + m.plata + m.bronce}</td>
    </tr>
  `).join('');
}

/* ---------------- Ubicación ---------------- */
function renderUbicacion(){
  const { evento } = DATA;
  document.getElementById('ubic-lugar').textContent = evento.lugar;
  document.getElementById('ubic-dir').textContent = evento.direccion;
  document.getElementById('ubic-btn').href = evento.mapsDirLink;
  document.getElementById('ubic-transporte').textContent = evento.comoLlegar;
  document.getElementById('map-frame').src =
    'https://maps.google.com/maps?q=' + encodeURIComponent(evento.mapsQuery) + '&z=15&output=embed';
}

/* ---------------- Fotos ---------------- */
function driveImageUrl(raw){
  if(!raw) return raw;
  const url = raw.trim();
  // Convierte un link normal de "Compartir" de Google Drive en una imagen directa.
  // Sirve con cualquiera de estos formatos que Drive suele entregar:
  //  https://drive.google.com/file/d/FILE_ID/view?usp=sharing
  //  https://drive.google.com/open?id=FILE_ID
  let match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if(match) return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1000`;
  return url; // no es un link de Drive: se usa tal cual (ej. Imgur u otro hosting)
}

function renderFotos(){
  const grid = document.getElementById('fotos-grid');
  const empty = document.getElementById('fotos-empty');
  if(!DATA.fotos || !DATA.fotos.length){
    grid.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  grid.innerHTML = DATA.fotos.map(f => `
    <div class="foto-item"><img src="${escapeAttr(driveImageUrl(f.url))}" alt="${escapeAttr(f.caption || '')}" loading="lazy"></div>
  `).join('');
}

/* ---------------- Navegación entre pestañas ---------------- */
const VIEW_IDS = ['inicio','programa','en-vivo','medallas','ubicacion','fotos'];

function goto(viewId){
  VIEW_IDS.forEach(id => {
    document.getElementById('view-' + id).hidden = (id !== viewId);
  });
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.goto === viewId);
  });
  document.getElementById('views').scrollTo?.(0,0);
  window.scrollTo(0,0);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-goto]');
  if(btn) goto(btn.dataset.goto);
});

/* ---------------- Utilidades ---------------- */
function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
function escapeAttr(str){ return escapeHtml(str); }

/* ---------------- Arranque ---------------- */
loadData();
setInterval(loadData, REFRESH_MS);

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW no registrado:', err));
  });
}
