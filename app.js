/* The Golden Star - GitHub Pages + Apps Script Edition */
const API_URL = 'https://script.google.com/macros/s/AKfycbztyDUtMktktR5sJwYQF-4VDUx3qTjapr3m9geGdwozyb8-XfaozROCWIUEiPur0Saq/exec'; // ضع رابط /exec من Apps Script هنا
const SESSION_KEY = 'golden_star_session_excel_v2';
let currentUser = null;
let currentPage = 'dashboard';
let qrScanner = null;
let DB = null;

const $ = id => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
const nowAr = () => new Date().toLocaleString('ar-SY');
const money = n => `${Number(n || 0).toLocaleString('ar-SY')} ل.س`;
const defaultFee = () => Number(DB?.settings?.defaultFee || 0);
function normalizePhone(phone){ let p = String(phone||'').replace(/[^0-9]/g,''); if(p.startsWith('00')) p = p.slice(2); if(p.startsWith('0')) p = '963' + p.slice(1); return p; }
function waLink(phone, msg){ const p = normalizePhone(phone); if(!p){ toast('رقم ولي الأمر غير موجود','error'); return; } window.open(`https://wa.me/${p}?text=${encodeURIComponent(msg)}`,'_blank'); }
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const uid = p => `${p}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;


/* ===== تحسين الاستجابة: تحميل الأزرار + منع تجميد إحساس المستخدم ===== */
let __lastClickedButton = null;
let __lastClickedAt = 0;
let __busyDepth = 0;
let __busyContext = null;

function installBusyStyles(){
  if(document.getElementById('golden-star-busy-style')) return;
  const style = document.createElement('style');
  style.id = 'golden-star-busy-style';
  style.textContent = `
    button.gs-busy, .btn.gs-busy{
      opacity:.88!important; cursor:wait!important; pointer-events:none!important;
      filter:saturate(.9); position:relative;
    }
    .gs-spin{
      width:15px;height:15px;border:2px solid rgba(7,17,31,.25);border-top-color:#07111f;
      border-radius:50%;display:inline-block;vertical-align:middle;margin-inline-end:7px;
      animation:gsSpin .75s linear infinite;
    }
    @keyframes gsSpin{to{transform:rotate(360deg)}}
    #gsBusyOverlay{
      position:fixed;z-index:999999;top:18px;left:50%;transform:translateX(-50%);
      background:#07111f;color:#fff;border:1px solid rgba(212,175,55,.7);border-radius:999px;
      box-shadow:0 12px 35px rgba(0,0,0,.25);padding:10px 18px;font-weight:800;
      display:none;align-items:center;gap:8px;font-family:Cairo,Arial,sans-serif;
    }
    #gsBusyOverlay.show{display:flex;}
    #gsBusyOverlay .gs-spin{border-color:rgba(255,255,255,.35);border-top-color:#f6d76b;margin:0;}
  `;
  document.head.appendChild(style);
}

function rememberButton(btn){
  if(!btn) return;
  __lastClickedButton = btn;
  __lastClickedAt = Date.now();
}

function recentButton(){
  if(!__lastClickedButton) return null;
  if(Date.now() - __lastClickedAt > 4000) return null;
  if(!document.body.contains(__lastClickedButton)) return null;
  return __lastClickedButton;
}

document.addEventListener('click', e => {
  const btn = e.target.closest('button,.btn');
  if(btn && !btn.classList.contains('menu-item')) rememberButton(btn);
}, true);

document.addEventListener('submit', e => {
  rememberButton(e.submitter || e.target.querySelector('button[type="submit"],button,.btn'));
}, true);

function showBusy(label='جاري العمل...', btn=null){
  installBusyStyles();
  if(__busyDepth > 0){ __busyDepth++; return { nested:true }; }
  __busyDepth = 1;
  btn = btn || recentButton();
  const overlay = document.getElementById('gsBusyOverlay') || (() => {
    const o = document.createElement('div');
    o.id = 'gsBusyOverlay';
    document.body.appendChild(o);
    return o;
  })();
  overlay.innerHTML = `<span class="gs-spin"></span><span>${esc(label)}</span>`;
  overlay.classList.add('show');
  let oldHtml = null;
  if(btn){
    oldHtml = btn.innerHTML;
    btn.classList.add('gs-busy');
    btn.disabled = true;
    btn.innerHTML = `<span class="gs-spin"></span>${esc(label)}`;
  }
  __busyContext = { btn, oldHtml, overlay, started:Date.now() };
  return __busyContext;
}

function hideBusy(ctx){
  if(ctx && ctx.nested){ __busyDepth = Math.max(0, __busyDepth - 1); return; }
  if(__busyDepth <= 0) return;
  __busyDepth = 0;
  const c = ctx || __busyContext;
  const elapsed = c ? Date.now() - c.started : 0;
  const finish = () => {
    if(c && c.btn){
      c.btn.disabled = false;
      c.btn.classList.remove('gs-busy');
      if(c.oldHtml !== null) c.btn.innerHTML = c.oldHtml;
    }
    if(c && c.overlay) c.overlay.classList.remove('show');
    __busyContext = null;
    __lastClickedButton = null;
  };
  if(elapsed < 450) setTimeout(finish, 450 - elapsed); else finish();
}

function apiBusyLabel(path, method){
  method = String(method || 'GET').toUpperCase();
  if(path === '/api/data') return 'جاري تحديث البيانات...';
  if(path.includes('/api/players') && method === 'POST') return 'جاري حفظ اللاعب...';
  if(path.includes('/api/payments') && method === 'POST') return 'جاري حفظ الدفعة...';
  if(path.includes('/api/users') && method === 'POST') return 'جاري حفظ المشرف...';
  if(path.includes('/api/settings')) return 'جاري حفظ الإعدادات...';
  if(method === 'DELETE') return 'جاري الحذف...';
  return 'جاري العمل...';
}

async function refreshDataSilent(){
  try{ await loadData({ silent:true }); }
  catch(e){ console.warn('تعذر تحديث البيانات في الخلفية:', e); }
}

const fallbackUsers = [
  { username: 'admin', password: 'admin123', role: 'admin', displayName: 'المدير العام', permissions:'all', active:'1' },
  { username: 'finance', password: 'finance123', role: 'finance', displayName: 'قسم المالية', permissions:'dashboard,finance,paymentsQuery', active:'1' },
  { username: 'attendance', password: 'att123', role: 'attendance', displayName: 'قسم التفقد والغياب', permissions:'dashboard,qrAttendance,absences', active:'1' }
];
const menuItems = [
  { id:'dashboard', title:'الرئيسية', icon:'fa-chart-pie', roles:['admin','finance','attendance'] },
  { id:'players', title:'شؤون اللاعبين', icon:'fa-person-running', roles:['admin'] },
  { id:'qrAttendance', title:'التفقد عبر QR', icon:'fa-qrcode', roles:['admin','attendance'] },
  { id:'finance', title:'المالية والمحاسبة', icon:'fa-wallet', roles:['admin','finance'] },
  { id:'paymentsQuery', title:'الاستعلام عن الدفعات', icon:'fa-magnifying-glass-dollar', roles:['admin','finance'] },
  { id:'absences', title:'الغيابات', icon:'fa-user-xmark', roles:['admin','attendance'] },
  { id:'supervisors', title:'المشرفون والصلاحيات', icon:'fa-users-gear', roles:['admin'] },
  { id:'settings', title:'إعدادات المؤسسة', icon:'fa-gear', roles:['admin'] }
];


function userList(){ return (DB?.users?.length ? DB.users : fallbackUsers).map(u => ({...u, name: u.displayName || u.name || u.username})); }
function userPerms(u){ return String(u?.permissions || '').split(',').map(x=>x.trim()).filter(Boolean); }
function isActiveUser(u){ return String(u?.active ?? '1') !== '0'; }
function canAccess(page){
  if(!currentUser) return false;
  if(currentUser.role === 'admin' || currentUser.permissions === 'all') return true;
  return userPerms(currentUser).includes(page);
}
function ensureApiUrl(){
  if(!API_URL || API_URL.includes('PASTE_APPS_SCRIPT_EXEC_URL_HERE')){
    throw new Error('لم يتم وضع رابط Apps Script داخل ملف app.js');
  }
}
function jsonpRequest(path){
  ensureApiUrl();
  return new Promise((resolve, reject) => {
    const cb = 'gs_cb_' + Date.now() + '_' + Math.random().toString(16).slice(2);
    const url = API_URL + '?action=api&path=' + encodeURIComponent(path) + '&callback=' + encodeURIComponent(cb) + '&_=' + Date.now();
    const s = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error('انتهت مهلة الاتصال بالسيرفر')); }, 30000);
    function cleanup(){ clearTimeout(timer); delete window[cb]; if(s.parentNode) s.parentNode.removeChild(s); }
    window[cb] = data => { cleanup(); data && data.error ? reject(new Error(data.error)) : resolve(data || {}); };
    s.onerror = () => { cleanup(); reject(new Error('فشل الاتصال بسيرفر Apps Script')); };
    s.src = url;
    document.body.appendChild(s);
  });
}
function postToAppsScript(path, method, payload){
  ensureApiUrl();
  return new Promise((resolve, reject) => {
    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(16).slice(2);
    const iframeName = 'iframe_' + requestId;
    const iframe = document.createElement('iframe');
    iframe.name = iframeName;
    iframe.style.display = 'none';
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = API_URL;
    form.target = iframeName;
    form.style.display = 'none';
    const fields = { requestId, action:'api', path, method:method || 'POST', payload: JSON.stringify(payload || {}) };
    Object.keys(fields).forEach(k => {
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = k; input.value = fields[k];
      form.appendChild(input);
    });
    const timer = setTimeout(() => { cleanup(); reject(new Error('انتهت مهلة حفظ البيانات في السيرفر')); }, 60000);
    function cleanup(){ clearTimeout(timer); window.removeEventListener('message', onMessage); setTimeout(()=>{ iframe.remove(); form.remove(); }, 50); }
    function onMessage(e){
      const data = e.data || {};
      if(!data || data.requestId !== requestId) return;
      cleanup();
      if(data.error) reject(new Error(data.error)); else resolve(data.result || {});
    }
    window.addEventListener('message', onMessage);
    document.body.appendChild(iframe);
    document.body.appendChild(form);
    form.submit();
  });
}
async function api(path, options={}){
  const method = String(options.method || 'GET').toUpperCase();
  const silent = options.silent === true;
  const ctx = silent ? null : showBusy(apiBusyLabel(path, method));
  try{
    if(method === 'GET') return await jsonpRequest(path);
    let payload = {};
    try{ payload = options.body ? JSON.parse(options.body) : {}; }catch(e){ payload = {}; }
    return await postToAppsScript(path, method, payload);
  }finally{
    if(ctx) hideBusy(ctx);
  }
}
async function loadData(options={}){ DB = await api('/api/data', { silent: options.silent !== false }); return DB; }
function fileToBase64(file){ return new Promise(resolve => { if(!file) return resolve(''); const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(file); }); }
function logoHtml(){ const logo = DB?.settings?.logo || ''; return logo ? `<img src="${esc(logo)}" alt="logo" onerror="this.style.display='none'; this.parentElement.innerHTML='<i class=&quot;fa-solid fa-star&quot;></i>';">` : `<i class="fa-solid fa-star"></i>`; }
function avatar(p, cls='avatar'){ return p?.photo ? `<img class="${cls}" src="${p.photo}" alt="${esc(p.name)}">` : `<div class="${cls}" style="display:grid;place-items:center"><i class="fa-solid fa-user"></i></div>`; }
function toast(msg, type='gold'){
  const host = $('toastHost');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fa-solid ${type==='success'?'fa-circle-check':type==='error'?'fa-triangle-exclamation':'fa-star'}"></i><span>${esc(msg)}</span>`;
  host.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateY(15px)'; setTimeout(()=>t.remove(),250); }, 3200);
}
function beep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = .08; o.start();
    setTimeout(()=>{ o.stop(); ctx.close(); }, 130);
  }catch(e){}
}

async function init(){
  bind();
  await loadData();
  renderLoginBrand();
  const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  if(s){ currentUser = s; openApp(); }
}
function bind(){
  $('loginBtn').addEventListener('click', login);
  $('loginPass').addEventListener('keydown', e => { if(e.key === 'Enter') login(); });
  $('logoutBtn').addEventListener('click', logout);
  $('mobileToggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', e => { if(e.target.id === 'modal') closeModal(); });
  $('quickScanBtn').addEventListener('click', () => navigate('qrAttendance'));
  $('backupBtn').addEventListener('click', openDatabaseFile);
  $('importFile').addEventListener('change', async e => toast('الاستيراد المباشر غير مفعل في نسخة GitHub. يمكنك تعديل Google Sheet مباشرة أو طلب ميزة استيراد لاحقاً.'));
  if(!API_URL.includes('PASTE_')) console.log('Apps Script API:', API_URL);
}
function renderLoginBrand(){
  $('loginAcademyName').textContent = DB.settings.academyName;
  $('loginLogoBox').innerHTML = logoHtml();
}
function login(){
  const ctx = showBusy('جاري الدخول...', $('loginBtn'));
  setTimeout(() => {
    const u = $('loginUser').value.trim(); const p = $('loginPass').value.trim();
    const found = userList().find(x => String(x.username) === u && String(x.password) === p && isActiveUser(x));
    if(!found){ $('loginError').textContent = 'اسم المستخدم أو كلمة المرور غير صحيحة أو الحساب غير مفعل'; hideBusy(ctx); return; }
    currentUser = {
      username:found.username,
      role:found.role || 'custom',
      name:found.displayName || found.name || found.username,
      permissions:found.permissions || 'dashboard'
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
    $('loginError').textContent = '';
    openApp();
    hideBusy(ctx);
  }, 120);
}
function logout(){ stopScanner(); localStorage.removeItem(SESSION_KEY); currentUser=null; $('appView').classList.add('hidden'); $('loginView').classList.remove('hidden'); renderLoginBrand(); }
function openApp(){
  $('loginView').classList.add('hidden'); $('appView').classList.remove('hidden');
  $('sideAcademyName').textContent = DB.settings.academyName.replace('أكاديمية ', '');
  $('brandLogo').innerHTML = logoHtml().replace('fa-star','fa-trophy');
  $('roleName').textContent = currentUser.name;
  renderMenu(); navigate('dashboard');
}
function renderMenu(){
  $('menu').innerHTML = menuItems.filter(m => m.roles.includes(currentUser.role) || canAccess(m.id)).map(m => `
    <button class="menu-item ${currentPage===m.id?'active':''}" data-page="${m.id}">
      <i class="fa-solid ${m.icon}"></i><span>${m.title}</span>
    </button>`).join('');
  document.querySelectorAll('.menu-item').forEach(btn => btn.onclick = () => navigate(btn.dataset.page));
}
async function navigate(page){
  stopScanner(); if(!DB) await loadData({silent:true});
  if(!canAccess(page)){
    const first = menuItems.find(m => m.roles.includes(currentUser.role) || userPerms(currentUser).includes(m.id));
    page = first?.id || 'dashboard';
  }
  currentPage = page; renderMenu();
  const item = menuItems.find(x => x.id === page);
  $('pageTitle').textContent = item?.title || 'النظام';
  $('pageSubTitle').textContent = DB.settings.description || 'نظام إدارة أكاديمية رياضية أونلاين';
  const map = { dashboard, players, qrAttendance, finance, paymentsQuery, absences, supervisors, settings };
  map[page]();
  $('sidebar').classList.remove('open');
}

function dashboard(){
  const players = DB.players.length;
  const todayAtt = DB.attendance.filter(a => String(a.date) === today()).length;
  const absent = Math.max(players - todayAtt, 0);
  const revenue = DB.payments.reduce((s,p)=>s+Number(p.amount||0),0);
  const logs = DB.logs.slice(-10).reverse();
  $('content').innerHTML = `
    <div class="stats-grid">
      ${stat('fa-person-running','إجمالي اللاعبين',players,'blue')}
      ${stat('fa-circle-check','حضور اليوم',todayAtt,'green')}
      ${stat('fa-user-xmark','غيابات اليوم',absent,'red')}
      ${stat('fa-wallet','إجمالي الإيرادات',money(revenue),'gold')}
    </div>
    <div class="panel">
      <div class="panel-head"><h3><i class="fa-solid fa-clock-rotate-left"></i> آخر الحركات</h3><button class="btn btn-gold" onclick="openDatabaseFile()"><i class="fa-solid fa-table"></i> فتح قاعدة البيانات</button></div>
      <div class="table-wrap"><table><thead><tr><th>النوع</th><th>الحركة</th><th>الوقت</th></tr></thead><tbody>
        ${logs.length?logs.map(l=>`<tr><td><span class="badge">${esc(l.type)}</span></td><td>${esc(l.text)}</td><td>${esc(l.at)}</td></tr>`).join(''):'<tr><td colspan="3" class="empty">لا توجد حركات بعد</td></tr>'}
      </tbody></table></div>
    </div>`;
}
function stat(icon,title,value,color){ return `<div class="stat-card ${color}"><div class="stat-icon"><i class="fa-solid ${icon}"></i></div><div><span>${title}</span><strong>${value}</strong></div></div>`; }

function players(){
  $('content').innerHTML = `
    <div class="panel"><div class="panel-head"><h3><i class="fa-solid fa-user-plus"></i> إضافة لاعب</h3><span class="badge gold">بعد الحفظ ستجد البطاقة في السجل فقط</span></div>
      <form id="playerForm" class="form-grid">
        <div class="field"><label>اسم اللاعب</label><input id="pName" required placeholder="اسم اللاعب الكامل"></div>
        <div class="field"><label>العمر</label><input id="pAge" type="number" min="3" placeholder="12"></div>
        <div class="field"><label>الفئة الرياضية</label><input id="pCategory" placeholder="براعم / ناشئين / شباب"></div>
        <div class="field"><label>هاتف ولي الأمر</label><input id="pPhone" placeholder="9639xxxxxxxx أو 09xxxxxxxx"></div>
        <div class="field"><label>تاريخ التسجيل</label><input id="pDate" type="date" value="${today()}"></div>
        <div class="field"><label>صورة شخصية</label><input id="pPhoto" type="file" accept="image/*"></div>
        <button class="btn btn-gold span-2" type="submit"><i class="fa-solid fa-floppy-disk"></i> حفظ اللاعب وإضافته إلى السجل</button>
      </form>
    </div>
    <div class="panel"><div class="panel-head players-head"><h3><i class="fa-solid fa-list"></i> سجل اللاعبين من Google Sheets</h3><div class="actions-row"><button class="btn btn-dark" id="printAllCards"><i class="fa-solid fa-print"></i> طباعة الكل</button><button class="btn btn-gold" id="printSelectedCards"><i class="fa-solid fa-id-card"></i> طباعة المحدد</button><input id="playerSearch" class="mini-input" placeholder="بحث سريع..."></div></div><div id="playersTable"></div></div>`;
  $('playerForm').onsubmit = savePlayer;
  $('playerSearch').oninput = renderPlayersTable;
  $('printAllCards').onclick = () => printCards(DB.players);
  $('printSelectedCards').onclick = () => { const ids=[...document.querySelectorAll('.player-check:checked')].map(x=>x.value); printCards(DB.players.filter(p=>ids.includes(String(p.id)))); };
  renderPlayersTable();
}
async function savePlayer(e){
  e.preventDefault();
  const ctx = showBusy('جاري حفظ اللاعب...', e.submitter);
  try{
    const photo = await fileToBase64($('pPhoto').files[0]);
    const payload = { id: uid('PLAYER'), name:$('pName').value.trim(), age:$('pAge').value, category:$('pCategory').value.trim(), phone:$('pPhone').value.trim(), registerDate:$('pDate').value, photo };
    if(!payload.name){ toast('اسم اللاعب مطلوب','error'); return; }
    const player = await api('/api/players', { method:'POST', body:JSON.stringify(payload), silent:true });
    DB.players = DB.players.filter(p => String(p.id) !== String(player.id));
    DB.players.push(player);
    $('playerForm').reset(); $('pDate').value = today();
    renderPlayersTable();
    toast('تم حفظ اللاعب وظهر مباشرة في القائمة','success');
    refreshDataSilent();
  }catch(err){ toast(err.message || 'تعذر حفظ اللاعب','error'); }
  finally{ hideBusy(ctx); }
}
function renderPlayersTable(){
  const q = ($('playerSearch')?.value || '').trim();
  const list = DB.players.filter(p => !q || String(p.name).includes(q) || String(p.category).includes(q) || String(p.phone).includes(q));
  $('playersTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="checkAllPlayers"></th><th>الصورة</th><th>الاسم</th><th>العمر</th><th>الفئة</th><th>ولي الأمر</th><th>تاريخ التسجيل</th><th>بطاقة</th></tr></thead><tbody>
    ${list.length?list.map(p=>`<tr><td><input class="player-check" type="checkbox" value="${esc(p.id)}"></td><td>${avatar(p)}</td><td>${esc(p.name)}</td><td>${esc(p.age)}</td><td>${esc(p.category)}</td><td>${esc(p.phone)}</td><td>${esc(p.registerDate)}</td><td><button class="btn btn-sm btn-gold" onclick="showCard('${p.id}')"><i class="fa-solid fa-id-card"></i> عرض/طباعة</button></td></tr>`).join(''):'<tr><td colspan="8" class="empty">لا يوجد لاعبون</td></tr>'}
  </tbody></table></div>`;
  const all = $('checkAllPlayers');
  if(all) all.onchange = () => document.querySelectorAll('.player-check').forEach(c => c.checked = all.checked);
}
function playerCard(p, withPrint=false){
  return `<div class="id-card-print" id="card-${esc(p.id)}">
    <div class="id-bg-navy"></div><div class="id-bg-gold"></div><div class="id-net"></div>
    <div class="id-title"><h2>${esc(DB.settings.academyName)}</h2><span>بطاقة لاعب</span></div>
    <div class="id-logo">${logoHtml()}</div>
    <div class="id-photo">${avatar(p,'id-photo-img')}</div>
    <div class="id-info">
      <h3><i class="fa-regular fa-user"></i> ${esc(p.name)}</h3>
      <p><i class="fa-solid fa-shield-halved"></i> <b>الفئة:</b> ${esc(p.category || '-')}</p>
      <p><i class="fa-regular fa-calendar"></i> <b>العمر:</b> ${esc(p.age || '-')}</p>
      <small><b>ID:</b> ${esc(p.id)}</small>
    </div>
    <div id="qr-${esc(p.id)}" class="id-qr"></div>
    <div class="id-ball"><i class="fa-solid fa-futbol"></i></div>
  </div>${withPrint?`<div class="center-actions"><button class="btn btn-gold" onclick="printCards([DB.players.find(x=>x.id==='${p.id}')])"><i class="fa-solid fa-print"></i> طباعة البطاقة</button></div>`:''}`;
}
function showCard(id){ const p = DB.players.find(x=>x.id===id); openModal(playerCard(p,true)); setTimeout(()=>makeQR(`qr-${p.id}`, p.id),50); }
function makeQR(id, text){ const el=$(id); if(el && window.QRCode){ el.innerHTML=''; new QRCode(el,{ text, width:130, height:130 }); } }

function renderCardsForPrint(list){
  return `<div class="bulk-print-toolbar no-print"><button class="btn btn-dark" onclick="printElement('bulkPrintArea')"><i class="fa-solid fa-print"></i> طباعة الآن</button><span class="badge gold">${list.length} بطاقة</span><span class="badge blue">ورقة A4 - 10 بطاقات تقريباً</span></div><div id="bulkPrintArea" class="a4-sheet">${list.map(p=>`<div class="card-slot">${playerCard(p,false)}</div>`).join('')}</div>`;
}
function printCards(list){
  list = (list || []).filter(Boolean);
  if(!list.length) return toast('اختر لاعباً واحداً على الأقل للطباعة','error');
  openModal(renderCardsForPrint(list));
  setTimeout(()=>list.forEach(p=>makeQR(`qr-${p.id}`, p.id)),80);
}
function qrAttendance(){
  const nameOptions = DB.players.map(p=>`<option value="${esc(p.name)}">${esc(p.name)} - ${esc(p.category)}</option>`).join('');
  $('content').innerHTML = `<div class="panel scan-panel"><div class="panel-head"><h3><i class="fa-solid fa-qrcode"></i> نقطة التفقد الذكي</h3><span class="badge blue">يدعم QR + إدخال ID أو الاسم</span></div><div id="reader" class="reader"></div><div class="manual-scan"><input id="manualCode" list="playersNames" placeholder="امسح البطاقة، أو اكتب ID، أو اكتب اسم اللاعب"><datalist id="playersNames">${nameOptions}</datalist><button class="btn btn-gold" id="manualBtn">تسجيل</button></div><div id="scanResult"></div></div>`;
  $('manualBtn').onclick = () => handleScan($('manualCode').value.trim());
  $('manualCode').addEventListener('keydown', e => { if(e.key==='Enter') handleScan(e.target.value.trim()); });
  startScanner();
}
async function startScanner(){
  if(!window.Html5Qrcode){
    $('reader').innerHTML = '<div class="empty">مكتبة قراءة QR لم يتم تحميلها. تأكد من وجود إنترنت لأول مرة أو استخدم إدخال ID/الاسم يدوياً.</div>';
    return;
  }
  if(!window.isSecureContext){
    $('reader').innerHTML = '<div class="empty"><b>تنبيه مهم:</b><br>كاميرا الموبايل لا تعمل على رابط HTTP. افتح النظام من الموبايل بالرابط الذي يبدأ بـ <b>https://</b> مثل:<br><span style="direction:ltr;display:inline-block;margin-top:8px">https://IP:5443</span><br>ثم وافق على تحذير الأمان واسمح للكاميرا.</div>';
    return;
  }
  try{
    const formats = window.Html5QrcodeSupportedFormats ? [
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.UPC_A
    ].filter(Boolean) : undefined;
    qrScanner = new Html5Qrcode('reader', formats ? { formatsToSupport: formats } : undefined);
    const scanConfig = { fps:12, qrbox:{width:280,height:280}, aspectRatio:1.0 };
    try{
      await qrScanner.start({ facingMode: 'environment' }, scanConfig, code => handleScan(code));
      return;
    }catch(backCameraError){
      const cams = await Html5Qrcode.getCameras();
      if(cams && cams.length){
        const preferred = cams.find(c => /back|rear|environment|خلف/i.test(c.label || '')) || cams[0];
        await qrScanner.start(preferred.id, scanConfig, code => handleScan(code));
        return;
      }
      throw backCameraError;
    }
  }catch(e){
    $('reader').innerHTML = '<div class="empty">الكاميرا غير متاحة أو لم تتمكن من قراءة الرمز. تأكد أنك فتحت الرابط من HTTPS ووافقت على صلاحية الكاميرا، أو استخدم إدخال ID/الاسم يدوياً.</div>';
  }
}
async function stopScanner(){ if(qrScanner){ try{ await qrScanner.stop(); await qrScanner.clear(); }catch(e){} qrScanner=null; } }
let lastScanValue = '';
let lastScanTime = 0;
async function handleScan(code){
  code = String(code||'').trim();
  if(!code) return;
  const now = Date.now();
  if(code === lastScanValue && now - lastScanTime < 2500) return;
  lastScanValue = code; lastScanTime = now;
  const localMatch = DB.players.find(p => String(p.id) === code || String(p.name) === code || String(p.name).includes(code));
  const query = localMatch ? localMatch.id : code;
  beep();
  try{
    const res = await api('/api/attendance', { method:'POST', body:JSON.stringify({playerId:query, query:code}) });
    await loadData({silent:true});
    const p = res.player;
    $('scanResult').innerHTML = `<div class="scan-success"><div>${avatar(p,'success-photo')}</div><h2>${esc(p.name)}</h2><p>${res.already ? 'تم تسجيل حضوره مسبقاً اليوم' : 'تم تسجيل الحضور بنجاح'}</p><strong>${esc(res.time || '')}</strong></div>`;
    if($('manualCode')) $('manualCode').value='';
  }catch(e){ $('scanResult').innerHTML = `<div class="scan-error"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(e.message)}</div>`; }
}

function finance(){
  const opts = DB.players.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} - ${esc(p.category)}</option>`).join('');
  $('content').innerHTML = `<div class="panel"><div class="panel-head"><h3><i class="fa-solid fa-wallet"></i> تسجيل دفعة مالية</h3></div><form id="payForm" class="form-grid"><div class="field span-2"><label>اختر اللاعب</label><select id="payPlayer"><option value="">اختر من القائمة</option>${opts}</select></div><div class="field"><label>المبلغ المدفوع</label><input id="payAmount" type="number" value="${esc(DB.settings.defaultFee)}"></div><div class="field"><label>نوع الاشتراك</label><select id="payType"><option>شهري</option><option>سنوي</option></select></div><div class="field"><label>تاريخ الدفع</label><input id="payDate" type="date" value="${today()}"></div><button class="btn btn-gold" type="submit"><i class="fa-solid fa-receipt"></i> حفظ وطباعة إيصال</button></form></div><div class="panel"><div class="panel-head"><h3>سجل الدفعات من Excel</h3></div>${paymentsTable()}</div>`;
  $('payForm').onsubmit = savePayment;
}
async function savePayment(e){
  e.preventDefault();
  const ctx = showBusy('جاري حفظ الدفعة...', e.submitter);
  try{
    const pay = await api('/api/payments', { method:'POST', body:JSON.stringify({ playerId:$('payPlayer').value, amount:$('payAmount').value, type:$('payType').value, paymentDate:$('payDate').value }), silent:true });
    DB.payments = DB.payments.filter(p => String(p.id) !== String(pay.id));
    DB.payments.push(pay);
    toast('تم حفظ الدفعة داخل Google Sheets','success');
    openModal(receipt(pay));
    // تحديث القسم فوراً حتى يظهر السجل بدون ريفريش
    if(currentPage === 'finance') finance();
    refreshDataSilent();
  }catch(err){ toast(err.message,'error'); }
  finally{ hideBusy(ctx); }
}
function paymentsTable(){ return `<div class="table-wrap"><table><thead><tr><th>اللاعب</th><th>المبلغ</th><th>النوع</th><th>تاريخ الدفع</th><th>الانتهاء</th><th>إيصال</th></tr></thead><tbody>${DB.payments.length?DB.payments.slice().reverse().map(p=>`<tr><td>${esc(p.playerName)}</td><td>${money(p.amount)}</td><td>${esc(p.type)}</td><td>${esc(p.paymentDate)}</td><td>${esc(p.expireDate)}</td><td><button class="btn btn-sm btn-gold" onclick="printReceipt('${p.id}')"><i class="fa-solid fa-print"></i></button></td></tr>`).join(''):'<tr><td colspan="6" class="empty">لا توجد دفعات</td></tr>'}</tbody></table></div>`; }
function receipt(p){ return `<div class="receipt" id="receipt-${p.id}"><div class="receipt-logo">${logoHtml()}</div><h2>${esc(DB.settings.academyName)}</h2><p>${esc(DB.settings.address)}</p><hr><h3>إيصال دفع</h3><p><b>اللاعب:</b> ${esc(p.playerName)}</p><p><b>المبلغ:</b> ${money(p.amount)}</p><p><b>نوع الاشتراك:</b> ${esc(p.type)}</p><p><b>تاريخ الدفع:</b> ${esc(p.paymentDate)}</p><p><b>تاريخ الانتهاء:</b> ${esc(p.expireDate)}</p><small>${nowAr()}</small><button class="btn btn-gold" onclick="printElement('receipt-${p.id}')"><i class="fa-solid fa-print"></i> طباعة الإيصال</button></div>`; }
function printReceipt(id){ const p = DB.payments.find(x=>x.id===id); openModal(receipt(p)); }

function paymentsQuery(){
  const opts = DB.players.map(p=>`<option value="${esc(p.name)}">${esc(p.name)} - ${esc(p.category)}</option>`).join('');
  $('content').innerHTML = `<div class="panel query-panel"><div class="panel-head"><h3><i class="fa-solid fa-magnifying-glass-dollar"></i> الاستعلام الذكي عن الدفعات</h3></div><input id="queryInput" class="big-search" list="queryNames" placeholder="اكتب اسم اللاعب أو امسح QR"><datalist id="queryNames">${opts}</datalist><div id="queryResult"></div></div>`;
  $('queryInput').oninput = () => queryPayment($('queryInput').value.trim());
  $('queryInput').addEventListener('keydown', e => { if(e.key==='Enter') queryPayment(e.target.value.trim()); });
}
function getPlayerFinance(player){
  const pays = DB.payments.filter(x=>String(x.playerId)===String(player.id)).sort((a,b)=>String(b.expireDate).localeCompare(String(a.expireDate)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const last = pays[0];
  const fee = defaultFee();
  const paid = last ? Number(last.amount || 0) : 0;
  const remaining = Math.max(fee - paid, 0);
  const active = !!(last && String(last.expireDate) >= today());
  const complete = active && remaining <= 0;
  return { pays, last, fee, paid, remaining, active, complete };
}
function queryPayment(q){
  if(!q){ $('queryResult').innerHTML=''; return; }
  const p = DB.players.find(x => String(x.id)===q || String(x.name)===q || String(x.name).includes(q));
  if(!p){ $('queryResult').innerHTML = `<div class="scan-error">لا يوجد لاعب مطابق</div>`; return; }
  const f = getPlayerFinance(p);
  const statusClass = f.active ? (f.complete ? 'active' : 'partial') : 'expired';
  const statusText = f.active ? 'الاشتراك ساري' : 'الاشتراك منتهي أو لا توجد دفعات';
  const payText = f.complete ? 'حالة الدفع: مكتمل' : (f.active ? `حالة الدفع: باقي ${money(f.remaining)}` : 'حالة الدفع: يحتاج تسديد');
  const reminderBtn = f.active && f.remaining > 0
    ? `<button class="btn btn-gold" onclick="sendPaymentReminder('${p.id}','partial')"><i class="fa-brands fa-whatsapp"></i> إرسال رسالة تذكير بالدفع</button>`
    : (!f.active ? `<button class="btn btn-danger" onclick="sendPaymentReminder('${p.id}','expired')"><i class="fa-brands fa-whatsapp"></i> إرسال رسالة تجديد الاشتراك</button>` : '');
  $('queryResult').innerHTML = `<div class="payment-status ${statusClass}">
    ${avatar(p,'success-photo')}
    <h2>${esc(p.name)}</h2>
    <h3>${statusText}</h3>
    <p><b>${payText}</b></p>
    ${f.last?`<p>آخر دفعة: <b>${money(f.paid)}</b> | تاريخ الانتهاء: <b>${esc(f.last.expireDate)}</b></p>`:`<p>لا توجد أي دفعة مسجلة لهذا اللاعب.</p>`}
    ${f.fee?`<p>قيمة الاشتراك المعتمدة: <b>${money(f.fee)}</b></p>`:''}
    <div class="actions-row center-actions">${reminderBtn}</div>
  </div>`;
}
function sendPaymentReminder(id, type){
  const p = DB.players.find(x=>x.id===id);
  if(!p) return;
  const f = getPlayerFinance(p);
  const msg = type === 'partial'
    ? `تحية طيبة من إدارة ${DB.settings.academyName}. نذكّركم بأن اشتراك البطل ${p.name} ساري، ويوجد مبلغ متبقٍ قدره ${money(f.remaining)}. نرجو تسديد المبلغ لاستكمال ملفه المالي، ونتمنى له دوام التألق والنجاح.`
    : `تحية طيبة من إدارة ${DB.settings.academyName}. نود إعلامكم بأن اشتراك البطل ${p.name} منتهٍ ويحتاج إلى تجديد للاستمرار في التدريب. بانتظاركم ليستمر بطلنا بخطواته نحو التميز والنجمة الذهبية.`;
  waLink(p.phone, msg);
}

function absences(){
  const attended = new Set(DB.attendance.filter(a=>String(a.date)===today()).map(a=>String(a.playerId)));
  const absent = DB.players.filter(p=>!attended.has(String(p.id)));
  $('content').innerHTML = `<div class="panel"><div class="panel-head"><h3><i class="fa-solid fa-user-xmark"></i> غيابات اليوم ${today()}</h3><span class="badge danger">${absent.length} غائب</span></div><div class="table-wrap"><table><thead><tr><th>اللاعب</th><th>الفئة</th><th>هاتف ولي الأمر</th><th>تنبيه</th></tr></thead><tbody>${absent.length?absent.map(p=>`<tr><td>${avatar(p)} ${esc(p.name)}</td><td>${esc(p.category)}</td><td>${esc(p.phone)}</td><td><button class="btn btn-sm btn-gold" onclick="whatsapp('${p.id}')"><i class="fa-brands fa-whatsapp"></i> تنبيه ولي الأمر</button></td></tr>`).join(''):'<tr><td colspan="4" class="empty">لا يوجد غياب اليوم</td></tr>'}</tbody></table></div></div>`;
}
function whatsapp(id){
  const p = DB.players.find(x=>x.id===id);
  const msg = `تحية طيبة من إدارة ${DB.settings.academyName}، نود إعلامكم بأن البطل ${p.name} لم يحضر تدريب اليوم.`;
  waLink(p.phone, msg);
}

function roleLabel(role){ return role==='admin'?'مدير عام':role==='finance'?'قسم المالية':role==='attendance'?'قسم التفقد والغياب':'مشرف مخصص'; }
function defaultPermsForRole(role){
  if(role==='admin') return 'all';
  if(role==='finance') return 'dashboard,finance,paymentsQuery';
  if(role==='attendance') return 'dashboard,qrAttendance,absences';
  return 'dashboard';
}
function supervisors(){
  const perms = menuItems.filter(m=>m.id!=='supervisors').map(m=>`<label class="perm-check"><input type="checkbox" value="${m.id}"> ${m.title}</label>`).join('');
  $('content').innerHTML = `<div class="panel"><div class="panel-head"><h3><i class="fa-solid fa-user-plus"></i> تعيين مشرف أو إداري</h3><span class="badge gold">المدير فقط يستطيع إنشاء الحسابات</span></div>
    <form id="userForm" class="form-grid">
      <div class="field"><label>اسم المشرف</label><input id="uDisplay" placeholder="مثال: مشرف الحضور"></div>
      <div class="field"><label>اسم المستخدم للدخول</label><input id="uName" placeholder="مثال: coach1"></div>
      <div class="field"><label>كلمة المرور</label><input id="uPass" placeholder="كلمة مرور سهلة للمشرف"></div>
      <div class="field"><label>نوع الحساب</label><select id="uRole"><option value="custom">مشرف مخصص</option><option value="finance">مالية</option><option value="attendance">تفقد وغياب</option><option value="admin">مدير عام</option></select></div>
      <div class="field full"><label>تحديد الصلاحيات التي ستظهر للمشرف</label><div class="permissions-grid" id="permBox">${perms}</div></div>
      <button class="btn btn-gold full" type="submit"><i class="fa-solid fa-floppy-disk"></i> حفظ المشرف والصلاحيات</button>
    </form></div>
    <div class="panel"><div class="panel-head"><h3><i class="fa-solid fa-users-gear"></i> حسابات الدخول</h3></div><div id="usersTable"></div></div>`;
  $('uRole').onchange = () => applyRolePerms($('uRole').value);
  $('userForm').onsubmit = saveUser;
  applyRolePerms('custom');
  renderUsersTable();
}
function applyRolePerms(role){
  const perms = defaultPermsForRole(role);
  document.querySelectorAll('#permBox input').forEach(c => c.checked = perms==='all' || perms.split(',').includes(c.value));
}
function selectedPerms(){ return [...document.querySelectorAll('#permBox input:checked')].map(x=>x.value).join(','); }
async function saveUser(e){
  e.preventDefault();
  const ctx = showBusy('جاري حفظ المشرف...', e.submitter);
  const role = $('uRole').value;
  const payload = { username:$('uName').value.trim(), password:$('uPass').value.trim(), displayName:$('uDisplay').value.trim() || $('uName').value.trim(), role, permissions: role==='admin' ? 'all' : selectedPerms(), active:'1' };
  if(!payload.username || !payload.password){ toast('اسم المستخدم وكلمة المرور مطلوبان','error'); hideBusy(ctx); return; }
  try{
    const user = await api('/api/users',{method:'POST', body:JSON.stringify(payload), silent:true});
    DB.users = DB.users.filter(u => String(u.username) !== String(user.username));
    DB.users.push(user);
    toast('تم إنشاء المشرف بنجاح','success'); supervisors(); refreshDataSilent();
  }
  catch(err){ toast(err.message,'error'); }
  finally{ hideBusy(ctx); }
}
function renderUsersTable(){
  const rows = userList();
  $('usersTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th>الصلاحيات</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>${rows.map(u=>`<tr><td>${esc(u.displayName||u.name||u.username)}</td><td>${esc(u.username)}</td><td>${roleLabel(u.role)}</td><td>${esc(u.permissions)}</td><td>${isActiveUser(u)?'<span class="badge green">مفعل</span>':'<span class="badge red">موقوف</span>'}</td><td>${u.username==='admin'?'<span class="badge gold">أساسي</span>':`<button class="btn btn-sm btn-danger" onclick="deleteUser('${esc(u.username)}')"><i class="fa-solid fa-trash"></i> حذف</button>`}</td></tr>`).join('')}</tbody></table></div>`;
}
async function deleteUser(username){
  if(!confirm('هل تريد حذف هذا الحساب؟')) return;
  const ctx = showBusy('جاري الحذف...');
  try{
    await api(`/api/users/${encodeURIComponent(username)}`, {method:'DELETE', silent:true});
    DB.users = DB.users.filter(u => String(u.username) !== String(username));
    renderUsersTable(); toast('تم حذف الحساب','success'); refreshDataSilent();
  }
  catch(err){ toast(err.message,'error'); }
  finally{ hideBusy(ctx); }
}
function settings(){
  const s = DB.settings;
  $('content').innerHTML = `<div class="panel"><div class="panel-head"><h3><i class="fa-solid fa-gear"></i> إعدادات المؤسسة</h3></div><form id="settingsForm" class="form-grid"><div class="field"><label>اسم الأكاديمية</label><input id="sName" value="${esc(s.academyName)}"></div><div class="field"><label>الاسم الإنجليزي</label><input id="sEn" value="${esc(s.academyEn)}"></div><div class="field span-2"><label>الوصف</label><input id="sDesc" value="${esc(s.description)}"></div><div class="field span-2"><label>العنوان</label><input id="sAddress" value="${esc(s.address)}"></div><div class="field"><label>قيمة الاشتراك الافتراضية</label><input id="sFee" type="number" value="${esc(s.defaultFee)}"></div><div class="field"><label>تغيير الشعار</label><input id="sLogo" type="file" accept="image/*"></div><button class="btn btn-gold span-2" type="submit"><i class="fa-solid fa-floppy-disk"></i> حفظ الإعدادات داخل Google Sheets</button></form></div>`;
  $('settingsForm').onsubmit = saveSettings;
}
async function saveSettings(e){
  e.preventDefault();
  const ctx = showBusy('جاري حفظ الإعدادات...', e.submitter);
  try{
    const logo = await fileToBase64($('sLogo').files[0]);
    const payload = { academyName:$('sName').value, academyEn:$('sEn').value, description:$('sDesc').value, address:$('sAddress').value, defaultFee:$('sFee').value };
    if(logo) payload.logo = logo;
    const settingsRes = await api('/api/settings', { method:'PUT', body:JSON.stringify(payload), silent:true });
    DB.settings = settingsRes || Object.assign(DB.settings, payload);
    toast('تم حفظ الإعدادات داخل Google Sheets','success'); openApp(); refreshDataSilent();
  }catch(err){ toast(err.message || 'تعذر حفظ الإعدادات','error'); }
  finally{ hideBusy(ctx); }
}

function openModal(html){ $('modalContent').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal(){ $('modal').classList.add('hidden'); $('modalContent').innerHTML=''; }
function printElement(id){
  const el = document.getElementById(id);
  if(!el){ toast('لم يتم العثور على عنصر الطباعة','error'); return; }
  const printable = el.cloneNode(true);
  printable.querySelectorAll('canvas').forEach(canvas => {
    const img = document.createElement('img');
    try { img.src = canvas.toDataURL('image/png'); } catch(e) {}
    img.width = canvas.width || 130; img.height = canvas.height || 130;
    canvas.replaceWith(img);
  });
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.top = '0';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`<html dir="rtl"><head><title>طباعة</title><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet"><style>
  @page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}body{font-family:Cairo,Arial;margin:0;padding:0;background:white;text-align:center;color:#07111f}button,.no-print{display:none!important}img{max-width:100%}
  .a4-sheet{width:194mm;margin:auto;display:grid;grid-template-columns:repeat(2,85.6mm);gap:6mm 8mm;align-content:start;justify-content:center;padding:2mm;background:white}.card-slot{break-inside:avoid;page-break-inside:avoid}
  .id-card-print{width:85.6mm;height:54mm;position:relative;overflow:hidden;border:0.35mm solid #d7ad37;border-radius:4mm;background:#fff;box-shadow:none;text-align:right;margin:auto;break-inside:avoid;page-break-inside:avoid}.id-bg-navy{position:absolute;right:0;top:0;width:62%;height:19mm;background:#07111f;clip-path:polygon(0 0,100% 0,100% 100%,17% 100%)}.id-bg-gold{position:absolute;left:0;bottom:0;width:30mm;height:30mm;background:#d7ad37;clip-path:polygon(0 0,100% 100%,0 100%);opacity:.95}.id-net{position:absolute;left:3mm;top:11mm;width:31mm;height:31mm;background:linear-gradient(60deg,rgba(215,173,55,.14) 25%,transparent 25% 50%,rgba(215,173,55,.14) 50% 75%,transparent 75%);background-size:5mm 5mm;opacity:.45}.id-title{position:absolute;right:7mm;top:3mm;color:white;z-index:2}.id-title h2{margin:0;color:#f6d978;font-size:13px;font-weight:900}.id-title span{display:block;text-align:center;font-size:8px}.id-logo{position:absolute;left:5mm;top:4mm;width:18mm;height:18mm;display:grid;place-items:center;overflow:hidden;z-index:3;color:#d7ad37}.id-logo img{width:100%;height:100%;object-fit:contain}.id-photo{position:absolute;right:7mm;top:19mm;width:25mm;height:29mm;border:1mm solid #f6d978;border-radius:4mm;overflow:hidden;background:#f3f4f6;z-index:3}.id-photo-img{width:100%;height:100%;object-fit:cover}.id-info{position:absolute;right:35mm;top:20mm;width:24mm;z-index:3}.id-info h3{margin:0 0 2mm;font-size:13px;font-weight:900}.id-info p{margin:1.5mm 0;font-size:7.5px}.id-info small{display:block;margin-top:2mm;font-size:5.5px;direction:ltr;text-align:left}.id-qr{position:absolute;left:6mm;bottom:7mm;width:20mm;height:20mm;background:white;border:.4mm solid #d7ad37;border-radius:2mm;padding:1.2mm;display:grid;place-items:center;z-index:4}.id-qr img,.id-qr canvas{width:17mm!important;height:17mm!important}.id-ball{position:absolute;right:2.5mm;bottom:2.5mm;color:white;font-size:10px;z-index:4}.receipt{max-width:420px;margin:20px auto;border:2px solid #d4af37;border-radius:22px;padding:20px}.receipt-logo{width:74px;height:74px;border-radius:50%;background:#07111f;color:#d4af37;display:grid;place-items:center;margin:0 auto 10px;overflow:hidden;font-size:32px}.receipt-logo img{width:100%;height:100%;object-fit:contain}
  </style></head><body>${printable.outerHTML}</body></html>`);
  doc.close();
  setTimeout(() => {
    try{ iframe.contentWindow.focus(); iframe.contentWindow.print(); }
    finally{ setTimeout(()=>iframe.remove(), 1200); }
  }, 450);
}

async function openDatabaseFile(){
  try{
    const res = await jsonpRequest('/api/database-url');
    if(res.url) window.open(res.url, '_blank');
    else toast('لم يتم العثور على رابط قاعدة البيانات','error');
  }catch(err){ toast(err.message,'error'); }
}

init().catch(err => { console.error(err); alert('حدث خطأ أثناء تشغيل النظام: ' + err.message); });
