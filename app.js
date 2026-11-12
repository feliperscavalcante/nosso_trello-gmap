/* ==========================================================================
   QUADROS GMAP | Aplicação (HTML + JavaScript puro + Supabase)
   ========================================================================== */
(() => {
  'use strict';

  // ------------------------------------------------------------------------
  // Configuração e cliente
  // ------------------------------------------------------------------------
  const CFG = window.APP_CONFIG || {};
  const APP_NAME = CFG.APP_NAME || 'Quadros';
  const ORG_NAME = CFG.ORG_NAME || '';
  const configured = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY &&
    !CFG.SUPABASE_URL.includes('SEU-PROJETO') && !CFG.SUPABASE_ANON_KEY.includes('COLE_AQUI'));
  const sb = configured ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
  // Ganchos opcionais usados apenas pela versão de demonstração (ausentes no sistema publicado)
  const demoHook = (k, ...args) => (typeof CFG[k] === 'function' ? (CFG[k](...args), true) : false);
  document.title = APP_NAME;

  const BOARD_COLORS = ['#1f6fb5', '#24507d', '#2e8b57', '#0f766e', '#7a4fa3', '#b23a48', '#c0632b', '#8a6d1f', '#475569'];
  const USER_COLORS = ['#2f6f9f', '#7a4fa3', '#2e8b57', '#c0632b', '#b23a48', '#3f7f7f', '#8a6d1f', '#5560c4'];
  const LABEL_COLORS = ['#c9372c', '#e2711d', '#d4a72c', '#2e8b57', '#2f6f9f', '#7a4fa3', '#0f766e', '#64748b'];
  const ROLE_NAMES = { owner: 'Dono', editor: 'Editor', viewer: 'Leitor', admin: 'Administrador' };

  // ------------------------------------------------------------------------
  // Estado
  // ------------------------------------------------------------------------
  const S = {
    session: null, me: null, profiles: {},
    boards: [], myTasks: [], showArchivedBoards: false,
    board: null, role: null, lists: [], cards: [], labels: [], members: [],
    cardLabels: [], assignees: [], stats: {},
    filters: { q: '', member: '', label: '', due: '' }, showFilters: false,
    drawer: null, drawerData: {}, addingCardTo: null, addingList: false, renamingList: null,
    openCard: null, cd: null, zoom: 1,
    channel: null, refreshTimer: null, pendingRefresh: false, dragging: false,
    pop: null, authMode: 'login', authMsg: null, admin: null
  };

  // ------------------------------------------------------------------------
  // Utilitários
  // ------------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const safeColor = (c, fb = '#2f6f9f') => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : fb);
  const uniq = (arr) => [...new Set(arr)];

  async function q(promise) {
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  }

  function errMsg(e) {
    const m = (e && (e.message || e.error_description || e.msg)) || String(e);
    const map = [
      [/Invalid login credentials/i, 'E-mail ou senha incorretos.'],
      [/Signups? not allowed|signup_disabled|Email signups are disabled/i, 'O cadastro pela tela de login está desligado no servidor. Peça ao administrador para criar sua conta pela tela de Administração ou para reativar os cadastros no Supabase.'],
      [/Email not confirmed/i, 'Confirme seu e-mail (link enviado na criação da conta) antes de entrar.'],
      [/User already registered/i, 'Este e-mail já está cadastrado. Use "Entrar" ou "Esqueci a senha".'],
      [/Database error saving new user/i, 'Cadastro recusado. Verifique se está usando o e-mail institucional permitido.'],
      [/Password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
      [/row-level security|permission denied|violates row-level/i, 'Você não tem permissão para esta ação.'],
      [/rate limit|too many/i, 'Muitas tentativas seguidas. Aguarde alguns minutos.'],
      [/Failed to fetch|NetworkError/i, 'Sem conexão com o servidor. Verifique sua internet.'],
      [/JWT expired/i, 'Sua sessão expirou. Entre novamente.'],
      [/should be different from the old password/i, 'A nova senha precisa ser diferente da senha provisória.'],
      [/Bucket not found/i, 'O armazenamento de anexos ainda não foi ativado. Execute o arquivo atualizacao-02-anexos.sql no Supabase.'],
      [/mime type .* is not supported|invalid mime/i, 'Tipo de arquivo não permitido.'],
      [/exceeded the maximum allowed size|Payload too large/i, 'O arquivo passa do limite de 10 MB.']
    ];
    for (const [re, txt] of map) if (re.test(m)) return txt;
    return m;
  }

  function toast(msg, err = false, ms = 0) {
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.textContent = msg;
    $('#toast-root').appendChild(el);
    setTimeout(() => el.remove(), ms || (err ? 5000 : 2800));
  }

  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const a = parts[0][0] || '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] || '');
    return (a + b).toUpperCase();
  }
  function avatar(uid, cls = '') {
    const p = S.profiles[uid] || { full_name: 'Usuário removido', color: '#8590a2' };
    return `<span class="avatar ${cls}" style="background:${safeColor(p.color)}" title="${esc(p.full_name)}">${esc(initials(p.full_name))}</span>`;
  }
  const userName = (uid) => (S.profiles[uid] ? S.profiles[uid].full_name : 'Usuário');

  const pad = (n) => String(n).padStart(2, '0');
  function parseDateOnly(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
  function fmtDate(iso, withTime = true) {
    if (!iso) return '';
    const d = typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? parseDateOnly(iso) : new Date(iso);
    const now = new Date();
    let s = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
    if (d.getFullYear() !== now.getFullYear()) s += ` de ${d.getFullYear()}`;
    if (withTime && (d.getHours() || d.getMinutes())) s += ` às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return s;
  }
  function relTime(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'agora';
    if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
    if (diff < 86400 * 7) return `há ${Math.floor(diff / 86400)} d`;
    return fmtDate(iso);
  }
  function dueStatus(c) {
    if (!c.due_date) return null;
    if (c.completed) return 'done';
    const diff = new Date(c.due_date).getTime() - Date.now();
    if (diff < 0) return 'overdue';
    if (diff < 48 * 3600 * 1000) return 'soon';
    return '';
  }
  const DUE_TAG = { overdue: 'Atrasado', soon: 'Vence em breve', done: 'Concluído' };
  function toLocalInputs(iso) {
    if (!iso) return { d: '', t: '' };
    const d = new Date(iso);
    return { d: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, t: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }

  // Ícones (traço simples)
  const ICONS = {
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    desc: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    check: '<path d="m5 12 4 4 10-10"/>',
    checksq: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
    comment: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    move: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
    restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    board: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="10" rx="1.5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
    minus: '<path d="M5 12h14"/>',
    form: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v3h6V3M9 11h6M9 15h4"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    clip: '<path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/>'
  };
  const icon = (n, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

  const canEdit = () => ['admin', 'owner', 'editor'].includes(S.role);
  const canManage = () => ['admin', 'owner'].includes(S.role);
  const isEditing = () => {
    const a = document.activeElement;
    return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('#app, #modal-root, #popover-root'));
  };

  // ------------------------------------------------------------------------
  // Inicialização e autenticação
  // ------------------------------------------------------------------------
  async function init() {
    if (!configured) return renderNotConfigured();
    const { data } = await sb.auth.getSession();
    S.session = data.session;
    sb.auth.onAuthStateChange((event, session) => {
      // Chamadas ao Supabase dentro deste callback precisam ser adiadas
      setTimeout(() => onAuthEvent(event, session), 0);
    });
    if (S.session) await loadMe();
    route();
  }

  async function onAuthEvent(event, session) {
    const prevUser = S.session && S.session.user && S.session.user.id;
    S.session = session;
    if (event === 'PASSWORD_RECOVERY') { S.recovery = true; return openNewPasswordModal(); }
    if (event === 'SIGNED_OUT') { if (!prevUser) return; cleanupBoard(); S.me = null; S.profiles = {}; closeModal(); return route(); }
    if (event === 'SIGNED_IN' && session && session.user.id !== prevUser) { await loadMe(); route(); }
  }

  async function loadMe() {
    if (!S.session) { S.me = null; return; }
    try {
      const rows = await q(sb.from('profiles').select('*').order('full_name'));
      S.profiles = Object.fromEntries(rows.map((p) => [p.id, p]));
      S.me = S.profiles[S.session.user.id] || null;
    } catch (e) {
      S.me = null;
      toast(errMsg(e), true);
    }
  }

  // ------------------------------------------------------------------------
  // Rotas: #/  |  #/b/<quadro>  |  #/b/<quadro>/c/<cartão>  |  #/admin
  // ------------------------------------------------------------------------
  async function route() {
    closePopover();
    if (!configured) return renderNotConfigured();
    if (!S.session) { cleanupBoard(); return renderAuth(); }
    if (!S.me || S.me.status !== 'active') { cleanupBoard(); return renderPending(); }
    if (S.me.must_change_password && !S.recovery) { cleanupBoard(); closeModal(); return renderForceChange(); }
    maybeSyncCatalogs();
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    try {
      if (parts[0] === 'b' && parts[1]) return await showBoard(parts[1], parts[2] === 'c' ? parts[3] : null);
      cleanupBoard();
      if (!S.recovery) closeModal();
      if (parts[0] === 'admin' && S.me.is_admin) return await showAdmin();
      await showHome();
      if (S.recovery && !$('#modal-root .overlay')) openNewPasswordModal();
    } catch (e) {
      console.error(e);
      toast(errMsg(e), true);
    }
  }
  window.addEventListener('hashchange', route);
  const go = (hash) => { if (location.hash !== hash) location.hash = hash; else route(); };

  // ------------------------------------------------------------------------
  // Telas de acesso
  // ------------------------------------------------------------------------
  function renderNotConfigured() {
    $('#app').innerHTML = `
      <div class="auth-wrap"><div class="auth-card">
        <div class="brand-mark" style="background:#1b3a5c;color:#fff;width:36px;height:36px">${icon('board', 20)}</div>
        <h1>Configuração pendente</h1>
        <p class="org">Abra o arquivo <b>config.js</b> e preencha <b>SUPABASE_URL</b> e <b>SUPABASE_ANON_KEY</b> com os dados do seu projeto Supabase (Project Settings &gt; API). Depois publique novamente.</p>
      </div></div>`;
  }

  function renderAuth() {
    const m = S.authMode;
    const msg = S.authMsg ? `<div class="notice ${S.authMsg.type || ''}">${esc(S.authMsg.text)}</div>` : '';
    let form = '';
    if (m === 'login') {
      form = `
        <form data-submit="login">
          <label class="field"><span>E-mail</span><input class="input" type="email" name="email" required autocomplete="email" value="${esc(S.authEmail || '')}" ${S.authEmail ? '' : 'data-autofocus'}></label>
          <label class="field"><span>Senha</span><input class="input" type="password" name="password" required autocomplete="current-password" ${S.authEmail ? 'data-autofocus' : ''}></label>
          <button class="btn primary" style="width:100%" type="submit">Entrar</button>
          ${CFG.EMAIL_ENABLED
            ? '<p class="small" style="text-align:center;margin:14px 0 0"><a href="#" data-act="auth-mode" data-mode="forgot">Esqueci minha senha</a></p>'
            : '<p class="small muted" style="text-align:center;margin:14px 0 0;line-height:1.5">Esqueceu a senha? Peça ao administrador do sistema para redefinir.</p>'}
        </form>`;
    } else if (m === 'signup') {
      form = `
        <form data-submit="signup">
          <label class="field"><span>Nome completo</span><input class="input" name="full_name" required autocomplete="name" data-autofocus></label>
          <label class="field"><span>E-mail institucional</span><input class="input" type="email" name="email" required autocomplete="email"></label>
          <label class="field"><span>Senha (mínimo 8 caracteres)</span><input class="input" type="password" name="password" minlength="8" required autocomplete="new-password"></label>
          <label class="field"><span>Confirme a senha</span><input class="input" type="password" name="password2" minlength="8" required autocomplete="new-password"></label>
          <button class="btn primary" style="width:100%" type="submit">Criar conta</button>
          <p class="small muted" style="margin:12px 0 0;line-height:1.5">Após o cadastro, o administrador do setor precisa aprovar seu acesso.</p>
        </form>`;
    } else {
      form = `
        <form data-submit="forgot">
          <p class="small muted" style="margin-top:0;line-height:1.5">Informe seu e-mail. Enviaremos um link para você criar uma nova senha.</p>
          <label class="field"><span>E-mail</span><input class="input" type="email" name="email" required data-autofocus></label>
          <button class="btn primary" style="width:100%" type="submit">Enviar link</button>
          <p class="small" style="text-align:center;margin:14px 0 0"><a href="#" data-act="auth-mode" data-mode="login">Voltar para o login</a></p>
        </form>`;
    }
    $('#app').innerHTML = `
      <div class="auth-wrap"><div class="auth-card">
        <div class="brand-mark" style="background:#1b3a5c;color:#fff;width:36px;height:36px">${icon('board', 20)}</div>
        <h1>${esc(APP_NAME)}</h1>
        <div class="org">${esc(ORG_NAME)}</div>
        ${m !== 'forgot' ? `<div class="tabs">
          <button type="button" class="${m === 'login' ? 'active' : ''}" data-act="auth-mode" data-mode="login">Entrar</button>
          <button type="button" class="${m === 'signup' ? 'active' : ''}" data-act="auth-mode" data-mode="signup">Criar conta</button>
        </div>` : ''}
        ${msg}${form}
      </div></div>`;
    autofocus();
  }

  function renderPending() {
    let text = 'Seu cadastro foi recebido e está aguardando aprovação do administrador do setor. Assim que for aprovado, você poderá acessar os quadros.';
    let title = 'Aguardando aprovação';
    if (S.me && S.me.status === 'inactive') { title = 'Acesso desativado'; text = 'Seu acesso foi desativado pelo administrador. Procure a chefia do setor caso precise reativá-lo.'; }
    if (!S.me) { title = 'Perfil não encontrado'; text = 'Não foi possível carregar seu perfil. Verifique se o banco de dados foi configurado corretamente (arquivo schema.sql) e tente novamente.'; }
    $('#app').innerHTML = `
      <div class="auth-wrap"><div class="auth-card">
        <div class="brand-mark" style="background:#1b3a5c;color:#fff;width:36px;height:36px">${icon('clock', 20)}</div>
        <h1>${title}</h1>
        <div class="org">${esc(S.session.user.email)}</div>
        <div class="notice">${text}</div>
        <div class="row">
          <button class="btn primary" data-act="recheck">Verificar novamente</button>
          <button class="btn" data-act="logout">Sair</button>
        </div>
      </div></div>`;
  }

  // ------------------------------------------------------------------------
  // Barra superior
  // ------------------------------------------------------------------------
  function topbar() {
    return `
      <header class="topbar">
        <a class="brand" href="#/"><span class="brand-mark">${icon('board', 16)}</span><span class="full">${esc(APP_NAME)}</span></a>
        <div class="spacer"></div>
        ${S.me.is_admin ? `<a class="btn sm" href="#/admin">${icon('shield', 14)}<span class="hide-sm">Administração</span></a>` : ''}
        <button class="icon-btn" data-act="user-menu" title="${esc(S.me.full_name)}">${avatar(S.me.id)}</button>
      </header>`;
  }

  // ------------------------------------------------------------------------
  // Página inicial
  // ------------------------------------------------------------------------
  async function showHome() {
    const me = S.me;
    if (!me) return;
    S.boards = await q(sb.from('boards').select('*').order('title'));
    if (S.me !== me) return; // a sessão mudou durante o carregamento
    const asg = await q(sb.from('card_assignees').select('card_id').eq('user_id', me.id));
    const ids = uniq(asg.map((a) => a.card_id));
    let tasks = [];
    if (ids.length) {
      tasks = await q(sb.from('cards').select('id,title,board_id,list_id,due_date,completed,archived')
        .in('id', ids.slice(0, 300)).eq('archived', false).eq('completed', false));
      const listIds = uniq(tasks.map((t) => t.list_id));
      const lists = listIds.length ? await q(sb.from('lists').select('id,title,archived').in('id', listIds)) : [];
      const lmap = Object.fromEntries(lists.map((l) => [l.id, l]));
      const bmap = Object.fromEntries(S.boards.map((b) => [b.id, b]));
      tasks = tasks
        .filter((t) => bmap[t.board_id] && !bmap[t.board_id].archived && lmap[t.list_id] && !lmap[t.list_id].archived)
        .map((t) => ({ ...t, list: lmap[t.list_id].title, board: bmap[t.board_id] }))
        .sort((a, b) => (a.due_date ? new Date(a.due_date) : Infinity) - (b.due_date ? new Date(b.due_date) : Infinity));
    }
    if (S.me !== me) return;
    S.myTasks = tasks;
    renderHome();
  }

  function renderHome() {
    if (!S.session || !S.me) return;
    const boards = S.boards.filter((b) => S.showArchivedBoards || !b.archived);
    const nArch = S.boards.filter((b) => b.archived).length;
    const first = S.me.full_name.split(' ')[0];
    $('#app').innerHTML = `
      ${topbar()}
      <main class="page">
        <p class="muted" style="margin:0 0 20px">Olá, <b style="color:var(--ink)">${esc(first)}</b>. ${esc(ORG_NAME)}</p>
        <div class="home-grid">
          <section>
            <h2>${icon('board')} Quadros
              <span class="spacer"></span>
              ${nArch ? `<button class="btn sm ghost" data-act="toggle-archived-boards">${S.showArchivedBoards ? 'Ocultar arquivados' : `Mostrar arquivados (${nArch})`}</button>` : ''}
            </h2>
            <div class="boards-grid">
              ${boards.map((b) => `
                <a class="board-tile ${b.archived ? 'archived' : ''}" href="#/b/${b.id}" style="background:${safeColor(b.color)}">
                  <div class="t">${esc(b.title)}</div>
                  <div class="d">${b.archived ? 'Arquivado' : esc(b.description || '')}</div>
                </a>`).join('')}
              <button class="board-tile new" data-act="new-board">${icon('plus')} Criar novo quadro</button>
            </div>
            ${!S.boards.length ? '<p class="empty">Você ainda não participa de nenhum quadro. Crie um novo ou peça para ser adicionado.</p>' : ''}
          </section>
          <aside class="panel">
            <h2>${icon('user')} Minhas tarefas <span class="muted small" style="font-weight:500">${S.myTasks.length ? `(${S.myTasks.length})` : ''}</span></h2>
            ${S.myTasks.length ? S.myTasks.map((t) => {
              const st = dueStatus(t);
              return `
              <button class="task-item" data-act="goto-card" data-board="${t.board_id}" data-id="${t.id}">
                <div class="t">${esc(t.title)}</div>
                <div class="m">
                  <span style="display:inline-flex;align-items:center;gap:4px"><i style="width:8px;height:8px;border-radius:2px;background:${safeColor(t.board.color)};display:inline-block"></i>${esc(t.board.title)}</span>
                  <span>${esc(t.list)}</span>
                  ${t.due_date ? `<span class="badge due ${st || ''}">${icon('clock', 12)} ${fmtDate(t.due_date)}</span>` : ''}
                </div>
              </button>`;
            }).join('') : '<p class="empty">Nenhuma tarefa aberta atribuída a você.</p>'}
          </aside>
        </div>
      </main>`;
  }

  function openNewBoardModal() {
    let color = BOARD_COLORS[0];
    openModal(`
      <div class="modal sm"><button class="icon-btn modal-close" data-act="close-modal">${icon('x')}</button>
      <div class="modal-body">
        <h3>Criar quadro</h3>
        <form data-submit="create-board">
          <label class="field"><span>Título do quadro</span><input class="input" name="title" required maxlength="80" data-autofocus placeholder="Ex.: Aquisições 2026"></label>
          <label class="field"><span>Descrição (opcional)</span><input class="input" name="description" maxlength="160"></label>
          <div class="field"><span>Cor</span>
            <div class="color-row">${BOARD_COLORS.map((c) => `<button type="button" class="swatch ${c === color ? 'sel' : ''}" style="background:${c}" data-act="pick-swatch" data-color="${c}"></button>`).join('')}</div>
            <input type="hidden" name="color" value="${color}">
          </div>
          <p class="small muted" style="line-height:1.5">O quadro já vem com as listas "A fazer", "Em andamento" e "Concluído" e algumas etiquetas padrão. Você pode alterá-las depois.</p>
          <div class="row"><button class="btn primary" type="submit">Criar quadro</button><button class="btn" type="button" data-act="close-modal">Cancelar</button></div>
        </form>
      </div></div>`);
  }

  // ------------------------------------------------------------------------
  // Quadro: carregamento
  // ------------------------------------------------------------------------
  async function showBoard(boardId, cardId) {
    if (!S.board || S.board.id !== boardId) {
      cleanupBoard();
      S.filters = { q: '', member: '', label: '', due: '', template: '' };
      S.showFilters = false;
      S.zoom = loadZoom(boardId);
      const ok = await loadBoard(boardId);
      if (!ok) { toast('Quadro não encontrado ou você não tem acesso.', true); return go('#/'); }
      renderBoard();
      subscribeBoard(boardId);
    }
    if (cardId && S.openCard !== cardId) await openCard(cardId);
    if (!cardId && S.openCard) closeModal();
  }

  async function loadBoard(id) {
    const [board, lists, cards, labels, members, cardLabels, assignees, stats] = await Promise.all([
      q(sb.from('boards').select('*').eq('id', id).maybeSingle()),
      q(sb.from('lists').select('*').eq('board_id', id).order('position')),
      q(sb.from('cards').select('*').eq('board_id', id).eq('archived', false).order('position')),
      q(sb.from('labels').select('*').eq('board_id', id).order('created_at')),
      q(sb.from('board_members').select('*').eq('board_id', id)),
      q(sb.from('card_labels').select('card_id,label_id').eq('board_id', id)),
      q(sb.from('card_assignees').select('card_id,user_id').eq('board_id', id)),
      q(sb.rpc('board_card_stats', { b: id })),
      sb.from('card_templates').select('*').eq('active', true).order('name')
    ]).then((r) => { const t = r.pop(); S.templates = t.error ? [] : t.data; return r; });
    if (!board) return false;
    Object.assign(S, { board, lists, cards, labels, members, cardLabels, assignees });
    S.stats = Object.fromEntries((stats || []).map((s) => [s.card_id, s]));
    const mine = members.find((m) => m.user_id === S.me.id);
    S.role = S.me.is_admin ? 'admin' : (mine ? mine.role : null);
    // perfis novos que ainda não estão no cache
    const missing = members.map((m) => m.user_id).filter((u) => !S.profiles[u]);
    if (missing.length) await loadMe();
    return true;
  }

  async function refreshBoard() {
    if (!S.board) return;
    const ok = await loadBoard(S.board.id);
    if (!ok) { toast('Este quadro não está mais disponível.', true); return go('#/'); }
    renderBoard();
    if (S.drawer) await reloadDrawerData();
    if (S.drawer) renderDrawer();
  }

  function subscribeBoard(id) {
    if (!sb.channel) return;
    const f = `board_id=eq.${id}`;
    S.channel = sb.channel(`board-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity', filter: f }, (p) => scheduleRefresh(p.new && p.new.card_id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cards', filter: f }, () => scheduleRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lists', filter: f }, () => scheduleRefresh())
      .subscribe();
  }

  function scheduleRefresh(cardId) {
    clearTimeout(S.refreshTimer);
    if (cardId && S.cd && S.cd.card && S.cd.card.id === cardId) S.cd.stale = true;
    S.refreshTimer = setTimeout(doRefresh, 400);
  }
  async function doRefresh() {
    if (!S.board) return;
    if (S.dragging || isEditing() || S.pop || S.tplForm || S.tplEdit) { S.pendingRefresh = true; return; }
    S.pendingRefresh = false;
    try {
      await refreshBoard();
      if (S.cd) { S.cd.stale = false; await reloadCard(); }
    } catch (e) { console.error(e); }
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (S.pendingRefresh && !isEditing() && !S.pop) doRefresh(); }, 80));

  function cleanupBoard() {
    if (S.channel) { try { sb.removeChannel(S.channel); } catch (e) { /* ignora */ } }
    document.body.classList.remove('board-zoomed');
    Object.assign(S, { channel: null, board: null, role: null, drawer: null, addingCardTo: null, addingList: false, renamingList: null, pendingRefresh: false });
    if (S.openCard) closeModal();
  }

  // ------------------------------------------------------------------------
  // Quadro: renderização
  // ------------------------------------------------------------------------
  const cardLabelIds = (cid) => S.cardLabels.filter((x) => x.card_id === cid).map((x) => x.label_id);
  const cardAssigneeIds = (cid) => S.assignees.filter((x) => x.card_id === cid).map((x) => x.user_id);
  const activeLists = () => S.lists.filter((l) => !l.archived);
  const filtersActive = () => !!(S.filters.q || S.filters.member || S.filters.label || S.filters.due || S.filters.template);

  function matchesFilters(c) {
    const f = S.filters;
    if (f.q) {
      const t = (c.title + ' ' + c.description + ' ' + formDataText(c)).toLowerCase();
      if (!t.includes(f.q.toLowerCase())) return false;
    }
    if (f.member) {
      const who = f.member === 'me' ? S.me.id : f.member;
      if (f.member === 'none') { if (cardAssigneeIds(c.id).length) return false; }
      else if (!cardAssigneeIds(c.id).includes(who)) return false;
    }
    if (f.label && !cardLabelIds(c.id).includes(f.label)) return false;
    if (f.template && (f.template === 'none' ? c.template_id || c.template_name : c.template_name !== f.template)) return false;
    if (f.due) {
      const st = dueStatus(c);
      if (f.due === 'overdue' && st !== 'overdue') return false;
      if (f.due === 'week') {
        if (!c.due_date || c.completed) return false;
        const diff = new Date(c.due_date) - Date.now();
        if (diff < 0 || diff > 7 * 86400000) return false;
      }
      if (f.due === 'none' && c.due_date) return false;
      if (f.due === 'done' && !c.completed) return false;
      if (f.due === 'open' && c.completed) return false;
    }
    return true;
  }

  function renderBoard() {
    if (!S.session || !S.me) return;
    const b = S.board;
    document.body.classList.toggle('board-zoomed', S.zoom !== 1);
    const color = safeColor(b.color);
    const members = S.members.slice().sort((x, y) => userName(x.user_id).localeCompare(userName(y.user_id)));
    const fa = filtersActive();
    $('#app').innerHTML = `
      ${topbar()}
      <div class="board-view" style="background:linear-gradient(135deg, ${color} 0%, ${color}cc 100%)">
        <div class="board-head">
          <button class="board-title" data-act="drawer" data-view="settings" title="Configurações do quadro">${esc(b.title)}</button>
          <span class="role-chip" title="Seu papel neste quadro">${ROLE_NAMES[S.role] || ''}</span>
          ${b.archived ? '<span class="role-chip" style="background:#f5cd47;color:#533f04">Arquivado</span>' : ''}
          <div class="spacer"></div>
          <div class="avatars hide-sm" style="margin-right:4px">${members.slice(0, 6).map((m) => avatar(m.user_id, 'sm')).join('')}${members.length > 6 ? `<span class="avatar sm" style="background:#44546f">+${members.length - 6}</span>` : ''}</div>
          <div class="zoom-ctl" role="group" aria-label="Zoom do quadro">
            <button data-act="zoom" data-dir="-1" title="Diminuir zoom">${icon('minus', 14)}</button>
            <button data-act="zoom-reset" class="zoom-pct" title="Voltar para 100%">${Math.round(S.zoom * 100)}%</button>
            <button data-act="zoom" data-dir="1" title="Aumentar zoom">${icon('plus', 14)}</button>
            <button data-act="zoom-fit" title="Ajustar à tela (mostrar todas as listas)">${icon('fit', 14)}</button>
          </div>
          <button class="btn sm ${S.showFilters || fa ? 'on' : ''}" data-act="toggle-filters">${icon('filter', 14)}<span class="hide-sm">Filtros${fa ? ' (ativos)' : ''}</span></button>
          <button class="btn sm" data-act="drawer" data-view="members">${icon('users', 14)}<span class="hide-sm">Membros</span></button>
          <button class="btn sm" data-act="drawer" data-view="menu" title="Menu do quadro">${icon('dots', 14)}</button>
        </div>
        ${S.showFilters || fa ? renderFilters(members) : ''}
        <div class="lists-wrap"><div class="lists" id="lists" style="--z:${S.zoom}">
          ${activeLists().map(renderList).join('')}
          ${canEdit() ? renderAddList() : ''}
        </div></div>
      </div>
      ${S.drawer ? '<aside class="drawer" id="drawer"></aside>' : ''}`;
    if (S.drawer) renderDrawer();
    setupSortable();
    autofocus();
  }

  function renderFilters(members) {
    const f = S.filters;
    return `
      <div class="filters">
        <input class="input" type="search" placeholder="Buscar cartões..." value="${esc(f.q)}" data-input="filter-q">
        <select class="select" data-change="filter" data-key="member">
          <option value="">Todos os responsáveis</option>
          <option value="me" ${f.member === 'me' ? 'selected' : ''}>Meus cartões</option>
          <option value="none" ${f.member === 'none' ? 'selected' : ''}>Sem responsável</option>
          ${members.map((m) => `<option value="${m.user_id}" ${f.member === m.user_id ? 'selected' : ''}>${esc(userName(m.user_id))}</option>`).join('')}
        </select>
        <select class="select" data-change="filter" data-key="label">
          <option value="">Todas as etiquetas</option>
          ${S.labels.map((l) => `<option value="${l.id}" ${f.label === l.id ? 'selected' : ''}>${esc(l.name || 'Sem nome')}</option>`).join('')}
        </select>
        <select class="select" data-change="filter" data-key="due">
          <option value="">Qualquer prazo</option>
          <option value="overdue" ${f.due === 'overdue' ? 'selected' : ''}>Atrasados</option>
          <option value="week" ${f.due === 'week' ? 'selected' : ''}>Vencem em 7 dias</option>
          <option value="none" ${f.due === 'none' ? 'selected' : ''}>Sem prazo</option>
          <option value="open" ${f.due === 'open' ? 'selected' : ''}>Não concluídos</option>
          <option value="done" ${f.due === 'done' ? 'selected' : ''}>Concluídos</option>
        </select>
        ${(() => { const names = uniq(S.cards.map((c) => c.template_name).filter(Boolean)).sort(); return names.length ? `
        <select class="select" data-change="filter" data-key="template">
          <option value="">Todos os tipos de cartão</option>
          <option value="none" ${f.template === 'none' ? 'selected' : ''}>Cartões padrão</option>
          ${names.map((n) => `<option value="${esc(n)}" ${f.template === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        </select>` : ''; })()}
        ${filtersActive() ? '<button class="btn sm" data-act="clear-filters">Limpar filtros</button>' : ''}
      </div>`;
  }

  function renderList(l) {
    const all = S.cards.filter((c) => c.list_id === l.id);
    const cards = all.filter(matchesFilters);
    const count = filtersActive() ? `${cards.length}/${all.length}` : all.length;
    const renaming = S.renamingList === l.id;
    return `
      <div class="list" data-list="${l.id}">
        <div class="list-head">
          ${renaming
            ? `<form data-submit="rename-list" data-id="${l.id}" style="flex:1;display:flex"><input class="input" name="title" value="${esc(l.title)}" maxlength="80" data-autofocus data-blur-submit></form>`
            : `<div class="lt" ${canEdit() ? `data-act="rename-list" data-id="${l.id}"` : ''}>${esc(l.title)}</div>`}
          <span class="count">${count}</span>
          ${canEdit() ? `<button class="icon-btn" data-act="list-menu" data-id="${l.id}" title="Ações da lista">${icon('dots')}</button>` : ''}
        </div>
        <div class="cards" data-list-cards="${l.id}">${cards.map(renderCardTile).join('')}</div>
        ${!canEdit() && canUseTemplates() ? `<div class="list-foot"><button class="btn add-card-btn" data-act="add-card" data-list="${l.id}">${icon('form')} Nova solicitação</button></div>` : ''}
        ${canEdit() ? `<div class="list-foot">${S.addingCardTo === l.id ? `
          <form data-submit="add-card" data-list="${l.id}">
            <textarea class="textarea" name="title" rows="2" style="min-height:56px" placeholder="Insira um título para este cartão..." maxlength="300" data-autofocus data-enter-submit></textarea>
            <div class="row" style="margin-top:8px"><button class="btn primary sm" type="submit">Adicionar cartão</button><button class="icon-btn" type="button" data-act="cancel-add-card">${icon('x')}</button></div>
          </form>` : `<button class="btn add-card-btn" data-act="add-card" data-list="${l.id}">${icon('plus')} Adicionar um cartão</button>`}</div>` : (canUseTemplates() ? '' : '<div style="height:8px"></div>')}
      </div>`;
  }

  function renderAddList() {
    return `<div class="add-list">${S.addingList ? `
      <form data-submit="add-list">
        <input class="input" name="title" placeholder="Insira o título da lista..." maxlength="80" required data-autofocus>
        <div class="row" style="margin-top:8px"><button class="btn primary sm" type="submit">Adicionar lista</button><button class="icon-btn" type="button" data-act="cancel-add-list">${icon('x')}</button></div>
      </form>` : `<button class="btn" data-act="add-list">${icon('plus')} Adicionar outra lista</button>`}</div>`;
  }

  function renderCardTile(c) {
    const labs = cardLabelIds(c.id).map((id) => S.labels.find((l) => l.id === id)).filter(Boolean);
    const who = cardAssigneeIds(c.id);
    const st = dueStatus(c);
    const s = S.stats[c.id] || {};
    const badges = [];
    if (c.due_date) badges.push(`<span class="badge due ${st || ''}" title="Entrega">${icon(c.completed ? 'checksq' : 'clock', 13)} ${fmtDate(c.due_date)}</span>`);
    else if (c.completed) badges.push(`<span class="badge ok">${icon('checksq', 13)} Concluído</span>`);
    if (c.template_name) badges.push(`<span class="badge" title="${esc(c.template_name)}">${icon('form', 13)}</span>`);
    if (c.description) badges.push(`<span class="badge" title="Possui descrição">${icon('desc', 13)}</span>`);
    if (s.comments) badges.push(`<span class="badge" title="Comentários">${icon('comment', 13)} ${s.comments}</span>`);
    if (s.attachments) badges.push(`<span class="badge" title="Anexos">${icon('clip', 13)} ${s.attachments}</span>`);
    if (s.items_total) badges.push(`<span class="badge ${s.items_done === s.items_total ? 'ok' : ''}" title="Checklist">${icon('checksq', 13)} ${s.items_done}/${s.items_total}</span>`);
    return `
      <div class="card ${c.completed ? 'done' : ''}" data-card="${c.id}" data-act="open-card" data-id="${c.id}">
        ${labs.length ? `<div class="labels">${labs.map((l) => `<span class="lab" style="background:${safeColor(l.color)}" title="${esc(l.name)}"></span>`).join('')}</div>` : ''}
        <div class="ct">${esc(c.title)}</div>
        ${badges.length || who.length ? `<div class="badges">${badges.join('')}${who.length ? `<div class="avatars">${who.map((u) => avatar(u, 'sm')).join('')}</div>` : ''}</div>` : ''}
      </div>`;
  }

  // Zoom do quadro (salvo por quadro, neste navegador)
  const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
  function loadZoom(boardId) {
    try { const v = Number(localStorage.getItem('zoom:' + boardId)); if (v >= 0.5 && v <= 1.5) return v; } catch (e) { /* sem armazenamento */ }
    return 1;
  }
  function setZoom(z) {
    S.zoom = Math.round(z * 100) / 100;
    try { localStorage.setItem('zoom:' + S.board.id, String(S.zoom)); } catch (e) { /* sem armazenamento */ }
    const el = $('#lists');
    if (el) {
      const ratio = el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth);
      el.style.setProperty('--z', S.zoom);
      el.scrollLeft = ratio * Math.max(0, el.scrollWidth - el.clientWidth);
    }
    const pct = $('.zoom-pct');
    if (pct) pct.textContent = Math.round(S.zoom * 100) + '%';
    document.body.classList.toggle('board-zoomed', S.zoom !== 1);
  }

  // Arrastar e soltar
  let sortables = [];
  function setupSortable() {
    sortables.forEach((s) => s.destroy());
    sortables = [];
    if (!canEdit() || !window.Sortable) return;
    const common = { animation: 150, delay: 180, delayOnTouchOnly: true, forceFallback: true, fallbackTolerance: 4, fallbackOnBody: true,
      ghostClass: 'card-ghost', chosenClass: 'card-drag',
      onStart: () => { S.dragging = true; }, };
    $$('.cards').forEach((el) => {
      sortables.push(Sortable.create(el, {
        ...common, group: 'cards', draggable: '.card',
        onEnd: (evt) => { S.dragging = false; onCardDrop(evt); }
      }));
    });
    const listsEl = $('#lists');
    if (listsEl) {
      sortables.push(Sortable.create(listsEl, {
        ...common, draggable: '.list', handle: '.list-head', filter: 'input,button,form', preventOnFilter: false,
        onEnd: (evt) => { S.dragging = false; onListDrop(evt); }
      }));
    }
  }

  function posBetween(prev, next) {
    if (prev != null && next != null) return (prev + next) / 2;
    if (prev != null) return prev + 1000;
    if (next != null) return next / 2;
    return 1000;
  }

  async function onCardDrop(evt) {
    const id = evt.item.dataset.card;
    const toList = evt.to.dataset.listCards;
    const card = S.cards.find((c) => c.id === id);
    if (!card) return;
    const p = evt.item.previousElementSibling, n = evt.item.nextElementSibling;
    const pc = p && S.cards.find((c) => c.id === p.dataset.card);
    const nc = n && S.cards.find((c) => c.id === n.dataset.card);
    const position = posBetween(pc ? pc.position : null, nc ? nc.position : null);
    if (card.list_id === toList && card.position === position) return;
    card.list_id = toList; card.position = position;
    S.cards.sort((a, b) => a.position - b.position);
    renderBoard();
    try {
      await q(sb.from('cards').update({ list_id: toList, position }).eq('id', id));
    } catch (e) { toast(errMsg(e), true); await refreshBoard(); }
    if (S.pendingRefresh) doRefresh();
  }

  async function onListDrop(evt) {
    const id = evt.item.dataset.list;
    const p = evt.item.previousElementSibling, n = evt.item.nextElementSibling;
    const pl = p && p.dataset.list && S.lists.find((l) => l.id === p.dataset.list);
    const nl = n && n.dataset.list && S.lists.find((l) => l.id === n.dataset.list);
    const list = S.lists.find((l) => l.id === id);
    if (!list) return;
    list.position = posBetween(pl ? pl.position : null, nl ? nl.position : null);
    S.lists.sort((a, b) => a.position - b.position);
    renderBoard();
    try { await q(sb.from('lists').update({ position: list.position }).eq('id', id)); }
    catch (e) { toast(errMsg(e), true); await refreshBoard(); }
  }

  const nextCardPos = (listId) => Math.max(0, ...S.cards.filter((c) => c.list_id === listId).map((c) => c.position)) + 1000;

  // ------------------------------------------------------------------------
  // Painel lateral do quadro
  // ------------------------------------------------------------------------
  async function openDrawer(view) {
    S.drawer = view;
    await reloadDrawerData();
    if (!$('#drawer')) renderBoard(); else renderDrawer();
  }
  async function reloadDrawerData() {
    const id = S.board.id;
    if (S.drawer === 'activity') {
      S.drawerData.activity = await q(sb.from('activity').select('*').eq('board_id', id).order('created_at', { ascending: false }).limit(S.drawerData.actLimit || 60));
    }
    if (S.drawer === 'archived') {
      S.drawerData.archivedCards = await q(sb.from('cards').select('id,title,list_id,updated_at').eq('board_id', id).eq('archived', true).order('updated_at', { ascending: false }));
    }
  }

  function renderDrawer() {
    const el = $('#drawer');
    if (!el) return;
    const v = S.drawer;
    const titles = { menu: 'Menu', members: 'Membros do quadro', labels: 'Etiquetas', activity: 'Atividade', archived: 'Itens arquivados', settings: 'Configurações do quadro' };
    let body = '';
    if (v === 'menu') body = drawerMenu();
    if (v === 'members') body = drawerMembers();
    if (v === 'labels') body = drawerLabels();
    if (v === 'activity') body = drawerActivity();
    if (v === 'archived') body = drawerArchived();
    if (v === 'settings') body = drawerSettings();
    el.innerHTML = `
      <div class="drawer-head">
        ${v !== 'menu' ? `<button class="icon-btn" data-act="drawer" data-view="menu" title="Voltar">${icon('back')}</button>` : ''}
        <div style="flex:1;text-align:${v === 'menu' ? 'left' : 'center'}">${titles[v]}</div>
        <button class="icon-btn" data-act="close-drawer" title="Fechar">${icon('x')}</button>
      </div>
      <div class="drawer-body">${body}</div>`;
    autofocus();
  }

  function drawerMenu() {
    const b = S.board;
    const mine = S.members.find((m) => m.user_id === S.me.id);
    return `
      <div class="menu-list">
        ${b.description ? `<p class="small muted" style="margin:0 0 12px;line-height:1.5">${esc(b.description)}</p>` : ''}
        <button class="btn ghost block" data-act="drawer" data-view="settings">${icon('settings')} Configurações do quadro</button>
        <button class="btn ghost block" data-act="drawer" data-view="members">${icon('users')} Membros</button>
        <button class="btn ghost block" data-act="drawer" data-view="labels">${icon('tag')} Etiquetas</button>
        <button class="btn ghost block" data-act="drawer" data-view="activity">${icon('history')} Atividade</button>
        <button class="btn ghost block" data-act="drawer" data-view="archived">${icon('archive')} Itens arquivados</button>
        <button class="btn ghost block" data-act="export-csv">${icon('download')} Exportar planilha (CSV)</button>
        ${mine && mine.role !== 'owner' ? `<hr style="border:0;border-top:1px solid var(--line);margin:12px 0"><button class="btn ghost block" data-act="leave-board">${icon('logout')} Sair deste quadro</button>` : ''}
      </div>`;
  }

  function drawerMembers() {
    const members = S.members.slice().sort((x, y) => userName(x.user_id).localeCompare(userName(y.user_id)));
    const inBoard = new Set(members.map((m) => m.user_id));
    const candidates = Object.values(S.profiles).filter((p) => p.status === 'active' && !inBoard.has(p.id)).sort((a, b) => a.full_name.localeCompare(b.full_name));
    return `
      ${members.map((m) => {
        const p = S.profiles[m.user_id] || {};
        return `
        <div class="member-row">
          ${avatar(m.user_id)}
          <div class="nm"><div style="font-weight:600">${esc(p.full_name || 'Usuário')}${m.user_id === S.me.id ? ' <span class="muted small">(você)</span>' : ''}</div><div class="small muted">${esc(p.email || '')}</div></div>
          ${canManage() ? `
            <select class="select" data-change="member-role" data-user="${m.user_id}">
              ${['owner', 'editor', 'viewer'].map((r) => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${ROLE_NAMES[r]}</option>`).join('')}
            </select>
            <button class="icon-btn" data-act="remove-member" data-user="${m.user_id}" title="Remover do quadro">${icon('x')}</button>`
            : `<span class="small muted">${ROLE_NAMES[m.role]}</span>`}
        </div>`;
      }).join('')}
      ${canManage() ? `
        <h4 style="margin:20px 0 8px;font-size:14px">Adicionar membro</h4>
        ${candidates.length ? `
        <form data-submit="add-member">
          <label class="field"><span>Servidor</span><select class="select" name="user" required>
            <option value="">Selecione...</option>
            ${candidates.map((p) => `<option value="${p.id}">${esc(p.full_name)} (${esc(p.email)})</option>`).join('')}
          </select></label>
          <label class="field"><span>Papel</span><select class="select" name="role">
            <option value="editor">Editor: cria e altera cartões</option>
            <option value="viewer">Leitor: só visualiza e comenta</option>
            <option value="owner">Dono: gerencia membros e o quadro</option>
          </select></label>
          <button class="btn primary" type="submit">Adicionar</button>
        </form>` : '<p class="empty">Todos os usuários ativos já participam deste quadro. Novos servidores precisam criar conta e ser aprovados pelo administrador.</p>'}
      ` : ''}
      <div class="notice" style="margin-top:20px"><b>Papéis:</b> Dono gerencia o quadro e os membros. Editor cria, move e altera cartões. Leitor apenas visualiza e comenta.</div>`;
  }

  function drawerLabels() {
    return `
      ${S.labels.map((l) => `
        <div class="label-row">
          <input type="color" value="${safeColor(l.color)}" data-change="label-color" data-id="${l.id}" ${canEdit() ? '' : 'disabled'}>
          <input class="input" value="${esc(l.name)}" maxlength="40" placeholder="Sem nome" data-change="label-name" data-id="${l.id}" ${canEdit() ? '' : 'disabled'}>
          ${canEdit() ? `<button class="icon-btn" data-act="delete-label" data-id="${l.id}" title="Excluir etiqueta">${icon('trash')}</button>` : ''}
        </div>`).join('')}
      ${canEdit() ? `
        <form data-submit="add-label" class="label-row" style="margin-top:16px">
          <input type="color" name="color" value="${LABEL_COLORS[S.labels.length % LABEL_COLORS.length]}">
          <input class="input" name="name" maxlength="40" placeholder="Nova etiqueta" required>
          <button class="btn primary sm" type="submit">Criar</button>
        </form>` : ''}`;
  }

  function drawerActivity() {
    const acts = S.drawerData.activity || [];
    return `
      ${acts.length ? acts.map((a) => feedActivity(a, true)).join('') : '<p class="empty">Nenhuma atividade registrada.</p>'}
      ${acts.length >= (S.drawerData.actLimit || 60) ? '<button class="btn block" data-act="more-activity" style="justify-content:center">Carregar mais</button>' : ''}`;
  }

  function drawerArchived() {
    const cards = S.drawerData.archivedCards || [];
    const lists = S.lists.filter((l) => l.archived);
    return `
      <h4 style="margin:0 0 8px;font-size:14px">Cartões (${cards.length})</h4>
      ${cards.length ? cards.map((c) => `
        <div class="arch-row">
          <a class="t" href="#/b/${S.board.id}/c/${c.id}">${esc(c.title)}</a>
          ${canEdit() ? `<button class="btn sm" data-act="restore-card" data-id="${c.id}">Restaurar</button>` : ''}
          ${canManage() ? `<button class="icon-btn" data-act="delete-card" data-id="${c.id}" title="Excluir definitivamente">${icon('trash')}</button>` : ''}
        </div>`).join('') : '<p class="empty">Nenhum cartão arquivado.</p>'}
      <h4 style="margin:20px 0 8px;font-size:14px">Listas (${lists.length})</h4>
      ${lists.length ? lists.map((l) => `
        <div class="arch-row">
          <span class="t">${esc(l.title)}</span>
          ${canEdit() ? `<button class="btn sm" data-act="restore-list" data-id="${l.id}">Restaurar</button>` : ''}
          ${canManage() ? `<button class="icon-btn" data-act="delete-list" data-id="${l.id}" title="Excluir definitivamente">${icon('trash')}</button>` : ''}
        </div>`).join('') : '<p class="empty">Nenhuma lista arquivada.</p>'}`;
  }

  function drawerSettings() {
    const b = S.board;
    if (!canManage()) {
      return `<p style="font-weight:600;margin-top:0">${esc(b.title)}</p><p class="muted" style="line-height:1.5">${esc(b.description || 'Sem descrição.')}</p><div class="notice">Somente o dono do quadro ou o administrador pode alterar estas configurações.</div>`;
    }
    return `
      <form data-submit="board-settings">
        <label class="field"><span>Título</span><input class="input" name="title" value="${esc(b.title)}" required maxlength="80"></label>
        <label class="field"><span>Descrição</span><textarea class="textarea" name="description" maxlength="300">${esc(b.description)}</textarea></label>
        <div class="field"><span>Cor</span>
          <div class="color-row">${BOARD_COLORS.map((c) => `<button type="button" class="swatch ${c === b.color ? 'sel' : ''}" style="background:${c}" data-act="pick-swatch" data-color="${c}"></button>`).join('')}</div>
          <input type="hidden" name="color" value="${safeColor(b.color)}">
        </div>
        <button class="btn primary" type="submit">Salvar alterações</button>
      </form>
      <hr style="border:0;border-top:1px solid var(--line);margin:24px 0 16px">
      <button class="btn block" data-act="archive-board">${icon(b.archived ? 'restore' : 'archive')} ${b.archived ? 'Restaurar quadro' : 'Arquivar quadro'}</button>
      <button class="btn danger block" data-act="delete-board" style="margin-top:8px">${icon('trash')} Excluir quadro definitivamente</button>
      <p class="small muted" style="line-height:1.5">Prefira arquivar. A exclusão apaga listas, cartões e comentários; apenas o registro de atividade é preservado.</p>`;
  }

  // ------------------------------------------------------------------------
  // Textos do histórico
  // ------------------------------------------------------------------------
  function actText(a, withCard) {
    const d = a.details || {};
    const T = (s) => `<b>${esc(s)}</b>`;
    const on = withCard && d.title ? ` em ${T(d.title)}` : '';
    const role = (r) => (ROLE_NAMES[r] || r || '').toLowerCase();
    switch (a.action) {
      case 'board_created': return `criou o quadro ${T(d.title)}`;
      case 'board_renamed': return `renomeou o quadro de ${T(d.from)} para ${T(d.to)}`;
      case 'board_archived': return 'arquivou o quadro';
      case 'board_restored': return 'restaurou o quadro';
      case 'board_deleted': return `excluiu o quadro ${T(d.title)}`;
      case 'board_imported': return `importou este quadro do ${esc(d.source || 'Trello')} (${d.lists || 0} listas, ${d.cards || 0} cartões, ${d.items || 0} itens de checklist, ${d.comments || 0} comentários)`;
      case 'member_added': return `adicionou ${T(d.name)} ao quadro como ${role(d.role)}`;
      case 'member_role': return `alterou o papel de ${T(d.name)} para ${role(d.to)}`;
      case 'member_removed': return `removeu ${T(d.name)} do quadro`;
      case 'list_created': return `criou a lista ${T(d.title)}`;
      case 'list_renamed': return `renomeou a lista ${T(d.from)} para ${T(d.to)}`;
      case 'list_archived': return `arquivou a lista ${T(d.title)}`;
      case 'list_restored': return `restaurou a lista ${T(d.title)}`;
      case 'list_deleted': return `excluiu a lista ${T(d.title)}`;
      case 'labels_changed': return `alterou as etiquetas do quadro${d.name ? ` (${esc(d.name)})` : ''}`;
      case 'card_created': return withCard ? `criou o cartão ${T(d.title)} em ${esc(d.list)}` : `criou este cartão em ${T(d.list)}`;
      case 'card_moved': return withCard ? `moveu ${T(d.title)} de ${esc(d.from)} para ${T(d.to)}` : `moveu este cartão de ${esc(d.from)} para ${T(d.to)}`;
      case 'card_renamed': return `renomeou o cartão de ${T(d.from)} para ${T(d.to)}`;
      case 'card_description': return `atualizou a descrição${on}`;
      case 'card_due': return d.to ? `definiu a entrega${on} para ${T(fmtDate(d.to))}` : `removeu a data de entrega${on}`;
      case 'card_start': return d.to ? `definiu o início${on} para ${T(fmtDate(d.to, false))}` : `removeu a data de início${on}`;
      case 'card_completed': return withCard ? `concluiu ${T(d.title)}` : 'marcou este cartão como concluído';
      case 'card_reopened': return withCard ? `reabriu ${T(d.title)}` : 'reabriu este cartão';
      case 'card_archived': return withCard ? `arquivou ${T(d.title)}` : 'arquivou este cartão';
      case 'card_restored': return withCard ? `restaurou ${T(d.title)}` : 'restaurou este cartão';
      case 'card_deleted': return `excluiu o cartão ${T(d.title)}`;
      case 'assignee_added': return `atribuiu ${T(d.name)}${on || (withCard ? '' : ' a este cartão')}`;
      case 'assignee_removed': return `removeu ${T(d.name)} dos responsáveis${on}`;
      case 'label_added': return `adicionou a etiqueta ${T(d.name || 'sem nome')}${on}`;
      case 'label_removed': return `removeu a etiqueta ${T(d.name || 'sem nome')}${on}`;
      case 'checklist_added': return `adicionou a checklist ${T(d.name)}${on}`;
      case 'checklist_renamed': return `renomeou a checklist ${T(d.from)} para ${T(d.to)}`;
      case 'checklist_removed': return `removeu a checklist ${T(d.name)}${on}`;
      case 'item_added': return `adicionou o item ${T(d.text)}${on}`;
      case 'item_checked': return `concluiu o item ${T(d.text)}${on}`;
      case 'item_unchecked': return `desmarcou o item ${T(d.text)}${on}`;
      case 'item_edited': return `editou o item ${T(d.from)} para ${T(d.to)}`;
      case 'item_removed': return `removeu o item ${T(d.text)}${on}`;
      case 'comment_added': return `comentou${on}: "${esc(d.text)}"`;
      case 'comment_edited': return `editou um comentário${on}`;
      case 'comment_deleted': return `excluiu um comentário${on}`;
      case 'attachment_added': return `anexou ${T(d.name)}${on}`;
      case 'attachment_removed': return `removeu o anexo ${T(d.name)}${on}`;
      case 'card_form_edited': return `editou as respostas da solicitação${on}`;
      default: return esc(a.action);
    }
  }

  function feedActivity(a, withCard) {
    const clickable = withCard && a.card_id && a.action !== 'card_deleted';
    return `
      <div class="feed-item act" ${clickable ? `data-act="open-card" data-id="${a.card_id}" style="cursor:pointer"` : ''}>
        ${a.user_id && S.profiles[a.user_id] ? avatar(a.user_id, 'sm') : `<span class="avatar sm" style="background:#8590a2">${esc(initials(a.user_name || 'Sistema'))}</span>`}
        <div class="txt"><span class="who">${esc(a.user_name || 'Sistema')}</span> ${actText(a, withCard)}<div class="when">${relTime(a.created_at)}</div></div>
      </div>`;
  }

  // ------------------------------------------------------------------------
  // Cartão aberto
  // ------------------------------------------------------------------------
  async function openCard(id) {
    S.openCard = id;
    S.cd = { card: null, checklists: [], items: [], comments: [], activity: [], showDetails: true, editingDesc: false, editingComment: null, addingItemTo: null, editingItem: null, renamingChecklist: null, attachments: [], uploading: [], attUnavailable: false };
    try {
      const ok = await reloadCard();
      if (!ok) { toast('Cartão não encontrado.', true); S.openCard = null; S.cd = null; return go(`#/b/${S.board.id}`); }
    } catch (e) { toast(errMsg(e), true); }
  }

  async function reloadCard() {
    if (!S.cd) return false;
    const id = S.openCard;
    const [card, checklists, items, comments, activity, attachments] = await Promise.all([
      q(sb.from('cards').select('*').eq('id', id).maybeSingle()),
      q(sb.from('checklists').select('*').eq('card_id', id).order('position').order('created_at')),
      q(sb.from('checklist_items').select('*').eq('card_id', id).order('position').order('created_at')),
      q(sb.from('comments').select('*').eq('card_id', id).order('created_at', { ascending: false })),
      q(sb.from('activity').select('*').eq('card_id', id).order('created_at', { ascending: false }).limit(150)),
      sb.from('attachments').select('*').eq('card_id', id).order('created_at', { ascending: false })
    ]).then(async (r) => {
      const att = r.pop();
      if (S.cd) S.cd.attUnavailable = !!att.error;
      const list = att.error ? [] : att.data;
      await signThumbs(list);
      return [...r, list];
    });
    if (!S.cd || S.openCard !== id) return true;
    if (!card || card.board_id !== S.board.id) return false;
    Object.assign(S.cd, { card, checklists, items, comments, activity, attachments });
    const i = S.cards.findIndex((c) => c.id === id);
    if (i >= 0) S.cards[i] = card;
    renderCardModal();
    return true;
  }

  function closeCard() { if (S.board) go(`#/b/${S.board.id}`); else closeModal(); }

  function renderCardModal() {
    if (!S.session || !S.me) return;
    const cd = S.cd; const c = cd.card;
    const ed = canEdit() && !S.board.archived;
    const list = S.lists.find((l) => l.id === c.list_id);
    const labs = cardLabelIds(c.id).map((id) => S.labels.find((l) => l.id === id)).filter(Boolean);
    const who = cardAssigneeIds(c.id);
    const st = dueStatus(c);

    const meta = [];
    if (who.length || ed) meta.push(`<div><h5>Responsáveis</h5><div class="row wrap" style="gap:4px">${who.map((u) => avatar(u, 'lg')).join('')}${ed ? `<button class="chip add" data-act="pop-members" title="Responsáveis">${icon('plus')}</button>` : ''}</div></div>`);
    if (labs.length || ed) meta.push(`<div><h5>Etiquetas</h5><div class="row wrap" style="gap:4px">${labs.map((l) => `<button class="chip" style="background:${safeColor(l.color)}" ${ed ? 'data-act="pop-labels"' : ''}>${esc(l.name) || '&nbsp;'}</button>`).join('')}${ed ? `<button class="chip add" data-act="pop-labels" title="Etiquetas">${icon('plus')}</button>` : ''}</div></div>`);
    if (c.start_date) meta.push(`<div><h5>Início</h5><button class="due-box" style="border:0;cursor:${ed ? 'pointer' : 'default'}" ${ed ? 'data-act="pop-dates"' : ''}>${fmtDate(c.start_date, false)}</button></div>`);
    if (c.due_date) meta.push(`<div><h5>Entrega</h5><div class="due-box">
        <input type="checkbox" ${c.completed ? 'checked' : ''} ${ed ? 'data-change="toggle-complete"' : 'disabled'} title="Marcar como concluído" style="width:16px;height:16px;accent-color:var(--ok)">
        <span ${ed ? 'data-act="pop-dates" style="cursor:pointer"' : ''}>${fmtDate(c.due_date)}</span>
        ${st ? `<span class="tag ${st}">${DUE_TAG[st]}</span>` : ''}</div></div>`);
    else if (ed || c.completed) meta.push(`<div><h5>Situação</h5><label class="due-box" style="cursor:${ed ? 'pointer' : 'default'}"><input type="checkbox" ${c.completed ? 'checked' : ''} ${ed ? 'data-change="toggle-complete"' : 'disabled'} style="width:16px;height:16px;accent-color:var(--ok)"> ${c.completed ? 'Concluído' : 'Marcar como concluído'}</label></div>`);

    const desc = cd.editingDesc ? `
      <form data-submit="save-desc">
        <textarea class="textarea" name="description" rows="6" maxlength="10000" data-autofocus placeholder="Adicione uma descrição mais detalhada...">${esc(c.description)}</textarea>
        <div class="row" style="margin-top:8px"><button class="btn primary" type="submit">Salvar</button><button class="btn ghost" type="button" data-act="cancel-desc">Cancelar</button></div>
      </form>`
      : `<div class="desc-view ${c.description ? '' : 'empty-desc'}" ${ed ? 'data-act="edit-desc"' : ''}>${c.description ? linkify(c.description) : (ed ? 'Adicione uma descrição mais detalhada...' : 'Sem descrição.')}</div>`;

    const checklists = cd.checklists.map((cl) => {
      const items = cd.items.filter((i) => i.checklist_id === cl.id);
      const done = items.filter((i) => i.done).length;
      const pct = items.length ? Math.round((done / items.length) * 100) : 0;
      return `
        <div class="cm-section">
          <h4>${icon('checksq')}
            ${cd.renamingChecklist === cl.id
              ? `<form data-submit="rename-checklist" data-id="${cl.id}" style="flex:1"><input class="input" name="title" value="${esc(cl.title)}" maxlength="80" data-autofocus data-blur-submit></form>`
              : `<span style="flex:1;${ed ? 'cursor:pointer' : ''}" ${ed ? `data-act="rename-checklist" data-id="${cl.id}"` : ''}>${esc(cl.title)}</span>`}
            ${ed ? `<button class="btn sm" data-act="delete-checklist" data-id="${cl.id}">Excluir</button>` : ''}
          </h4>
          <div class="progress"><span>${pct}%</span><div class="bar"><i class="${pct === 100 ? 'full' : ''}" style="width:${pct}%"></i></div></div>
          ${items.map((it) => `
            <div class="check-item ${it.done ? 'done' : ''}">
              <input type="checkbox" ${it.done ? 'checked' : ''} ${ed ? `data-change="toggle-item" data-id="${it.id}"` : 'disabled'}>
              ${cd.editingItem === it.id
                ? `<form data-submit="edit-item" data-id="${it.id}" style="flex:1"><input class="input" name="text" value="${esc(it.text)}" maxlength="300" data-autofocus data-blur-submit></form>`
                : `<span class="tx" ${ed ? `data-act="edit-item" data-id="${it.id}"` : ''} title="${it.done && it.done_by ? esc(`Concluído por ${userName(it.done_by)} ${it.done_at ? 'em ' + fmtDate(it.done_at) : ''}`) : ''}">${linkify(it.text)}</span>
                   ${ed ? `<button class="icon-btn" data-act="delete-item" data-id="${it.id}" title="Excluir item">${icon('x', 14)}</button>` : ''}`}
            </div>`).join('')}
          ${ed ? (cd.addingItemTo === cl.id ? `
            <form data-submit="add-item" data-id="${cl.id}" style="margin:6px 0 0 30px">
              <input class="input" name="text" placeholder="Adicionar um item" maxlength="300" data-autofocus>
              <div class="row" style="margin-top:6px"><button class="btn primary sm" type="submit">Adicionar</button><button class="btn ghost sm" type="button" data-act="cancel-item">Cancelar</button></div>
            </form>` : `<button class="btn sm" style="margin:6px 0 0 30px" data-act="add-item" data-id="${cl.id}">Adicionar um item</button>`) : ''}
        </div>`;
    }).join('');

    const feed = [
      ...cd.comments.map((cm) => ({ t: 'c', at: cm.created_at, cm })),
      ...(cd.showDetails ? cd.activity.filter((a) => !a.action.startsWith('comment_')).map((a) => ({ t: 'a', at: a.created_at, a })) : [])
    ].sort((x, y) => new Date(y.at) - new Date(x.at));

    const feedHtml = feed.map((f) => {
      if (f.t === 'a') return feedActivity(f.a, false);
      const cm = f.cm;
      const mine = cm.user_id === S.me.id;
      const editing = cd.editingComment === cm.id;
      return `
        <div class="feed-item">
          ${avatar(cm.user_id)}
          <div style="flex:1;min-width:0">
            <span class="who">${esc(userName(cm.user_id))}</span> <span class="when">${relTime(cm.created_at)}${cm.edited_at ? ' (editado)' : ''}</span>
            ${editing ? `
              <form data-submit="edit-comment" data-id="${cm.id}" style="margin-top:4px">
                <textarea class="textarea" name="body" maxlength="5000" data-autofocus data-ctrl-submit>${esc(cm.body)}</textarea>
                <div class="row" style="margin-top:6px"><button class="btn primary sm" type="submit">Salvar</button><button class="btn ghost sm" type="button" data-act="cancel-comment">Cancelar</button></div>
              </form>` : `<div class="bubble">${linkify(cm.body)}</div>
              <div class="acts">${mine ? `<button data-act="edit-comment" data-id="${cm.id}">Editar</button>` : ''}${mine || canManage() ? `<button data-act="delete-comment" data-id="${cm.id}">Excluir</button>` : ''}</div>`}
          </div>
        </div>`;
    }).join('');

    const side = ed ? `
      <h5>Adicionar ao cartão</h5>
      <button class="btn block" data-act="pop-members">${icon('user')} Responsáveis</button>
      <button class="btn block" data-act="pop-labels">${icon('tag')} Etiquetas</button>
      <button class="btn block" data-act="pop-checklist">${icon('checksq')} Checklist</button>
      <button class="btn block" data-act="pop-dates">${icon('calendar')} Datas</button>
      ${S.cd.attUnavailable ? '' : `<button class="btn block" data-act="pick-files">${icon('clip')} Anexo</button>`}
      <h5 style="margin-top:16px">Ações</h5>
      <button class="btn block" data-act="pop-move">${icon('move')} Mover</button>
      <button class="btn block" data-act="copy-link">${icon('link')} Copiar link</button>
      ${c.archived
        ? `<button class="btn block" data-act="restore-card" data-id="${c.id}">${icon('restore')} Restaurar</button>`
        : `<button class="btn block" data-act="archive-card">${icon('archive')} Arquivar</button>`}
      ${canManage() ? `<button class="btn block danger" data-act="delete-card" data-id="${c.id}">${icon('trash')} Excluir</button>` : ''}`
      : `<h5>Ações</h5><button class="btn block" data-act="copy-link">${icon('link')} Copiar link</button>
         <p class="small muted" style="line-height:1.5">Você tem acesso de leitura neste quadro. Pode comentar, mas não alterar o cartão.</p>`;

    const html = `
      <div class="modal" role="dialog" aria-modal="true">
        ${c.archived ? `<div class="archived-banner">${icon('archive', 14)} Este cartão está arquivado.</div>` : ''}
        <button class="icon-btn modal-close" data-act="close-card" title="Fechar">${icon('x')}</button>
        <div class="cm-head">
          <span style="margin-top:8px;color:var(--ink-2)">${icon('card', 20)}</span>
          <textarea class="cm-title" rows="1" maxlength="300" ${ed ? 'data-change="card-title" data-enter-blur' : 'readonly'}>${esc(c.title)}</textarea>
        </div>
        <div class="cm-sub">na lista ${ed ? `<select data-change="move-list">${activeLists().map((l) => `<option value="${l.id}" ${l.id === c.list_id ? 'selected' : ''}>${esc(l.title)}</option>`).join('')}${list && list.archived ? `<option selected>${esc(list.title)} (arquivada)</option>` : ''}</select>` : `<b>${esc(list ? list.title : '')}</b>`}
          <span class="muted small" style="margin-left:6px">· criado por ${esc(userName(c.created_by))} ${relTime(c.created_at)}</span></div>
        <div class="cm-grid">
          <div>
            ${meta.length ? `<div class="meta-row">${meta.join('')}</div>` : ''}
            ${renderFormData(c)}
            <div class="cm-section"><h4>${icon('desc')} Descrição ${ed && c.description && !cd.editingDesc ? '<button class="btn sm" data-act="edit-desc" style="margin-left:auto">Editar</button>' : ''}</h4>${desc}</div>
            ${renderAttachments(ed)}
            ${checklists}
            <div class="cm-section">
              <h4>${icon('comment')} Comentários e atividade
                <button class="btn sm" style="margin-left:auto" data-act="toggle-details">${cd.showDetails ? 'Ocultar detalhes' : 'Mostrar detalhes'}</button></h4>
              <form data-submit="add-comment" class="feed-item">
                ${avatar(S.me.id)}
                <div style="flex:1">
                  <textarea class="textarea" name="body" rows="2" style="min-height:44px" placeholder="Escreva um comentário..." maxlength="5000" data-ctrl-submit></textarea>
                  <div class="row" style="margin-top:6px"><button class="btn primary sm" type="submit">Comentar</button><span class="small muted hide-sm">Ctrl + Enter envia</span></div>
                </div>
              </form>
              ${feedHtml || '<p class="empty">Nenhum comentário ainda.</p>'}
            </div>
          </div>
          <div class="side">${side}</div>
        </div>
      </div>`;

    const overlay = $('#modal-root .overlay[data-kind="card"]');
    const scroll = overlay ? overlay.scrollTop : 0;
    openModal(html, 'card');
    const ov = $('#modal-root .overlay');
    if (ov) ov.scrollTop = scroll;
    autosize($('.cm-title'));
  }

  function autosize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  // Popovers do cartão
  function openPopover(anchor, title, bodyFn) {
    closePopover();
    S.pop = { anchor, title, bodyFn };
    const el = document.createElement('div');
    el.className = 'popover';
    $('#popover-root').appendChild(el);
    renderPopover();
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - w - 8);
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    el.style.left = Math.max(8, left) + 'px';
    el.style.top = top + 'px';
    autofocus();
  }
  function renderPopover() {
    const el = $('#popover-root .popover');
    if (!el || !S.pop) return;
    el.innerHTML = `<h4>${esc(S.pop.title)}</h4><button class="icon-btn pop-close" data-act="pop-close">${icon('x', 14)}</button>${S.pop.bodyFn()}`;
  }
  function closePopover() {
    S.pop = null;
    const r = $('#popover-root');
    if (r) r.innerHTML = '';
    if (S.pendingRefresh) setTimeout(doRefresh, 50);
  }

  const popMembers = () => {
    const sel = cardAssigneeIds(S.cd.card.id);
    const members = S.members.slice().sort((x, y) => userName(x.user_id).localeCompare(userName(y.user_id)));
    return members.map((m) => `
      <button class="opt" data-act="toggle-assignee" data-user="${m.user_id}">
        ${avatar(m.user_id, 'sm')}<span style="flex:1">${esc(userName(m.user_id))}</span><span class="check">${sel.includes(m.user_id) ? icon('check', 16) : ''}</span>
      </button>`).join('') + '<p class="small muted" style="margin:8px 4px 0">Só membros do quadro podem ser responsáveis.</p>';
  };
  const popLabels = () => {
    const sel = cardLabelIds(S.cd.card.id);
    return S.labels.map((l) => `
      <button class="opt" data-act="toggle-label" data-id="${l.id}">
        <span class="check">${sel.includes(l.id) ? icon('check', 16) : ''}</span>
        <span class="lbl" style="background:${safeColor(l.color)}">${esc(l.name)}</span>
      </button>`).join('') + `<button class="btn block" style="justify-content:center;margin-top:8px" data-act="manage-labels">Gerenciar etiquetas</button>`;
  };
  const popChecklist = () => `
    <form data-submit="add-checklist">
      <label class="field"><span>Título</span><input class="input" name="title" value="Checklist" maxlength="80" data-autofocus required></label>
      <button class="btn primary" type="submit">Adicionar</button>
    </form>`;
  const popDates = () => {
    const c = S.cd.card;
    const due = toLocalInputs(c.due_date);
    return `
      <form data-submit="save-dates">
        <label class="field"><span>Data de início</span><input class="input" type="date" name="start" value="${c.start_date || ''}"></label>
        <div class="field"><span>Data de entrega</span>
          <div class="row"><input class="input" type="date" name="due" value="${due.d}"><input class="input" type="time" name="time" value="${due.t || '17:00'}" style="width:110px"></div>
        </div>
        <div class="row"><button class="btn primary" type="submit">Salvar</button><button class="btn" type="button" data-act="clear-dates">Remover datas</button></div>
      </form>`;
  };
  const popMove = () => `
    <form data-submit="move-card">
      <label class="field"><span>Lista de destino</span><select class="select" name="list">${activeLists().map((l) => `<option value="${l.id}" ${l.id === S.cd.card.list_id ? 'selected' : ''}>${esc(l.title)}</option>`).join('')}</select></label>
      <label class="field"><span>Posição</span><select class="select" name="where"><option value="end">No final</option><option value="start">No início</option></select></label>
      <button class="btn primary" type="submit">Mover</button>
    </form>`;

  // ------------------------------------------------------------------------
  // Modais genéricos
  // ------------------------------------------------------------------------
  function openModal(html, kind = 'generic') {
    $('#modal-root').innerHTML = `<div class="overlay" data-kind="${kind}" data-act="overlay">${html}</div>`;
    document.body.style.overflow = 'hidden';
    autofocus();
  }
  function closeModal() {
    closePopover();
    $('#modal-root').innerHTML = '';
    document.body.style.overflow = '';
    S.openCard = null; S.cd = null;
  }

  function confirmDialog(message, { confirmText = 'Confirmar', danger = false, requireText = null } = {}) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'overlay';
      wrap.style.zIndex = 80;
      wrap.innerHTML = `
        <div class="modal sm"><div class="modal-body">
          <h3>Confirmação</h3>
          <p style="line-height:1.5;margin-top:0">${message}</p>
          ${requireText ? `<label class="field"><span>Digite <b>${esc(requireText)}</b> para confirmar</span><input class="input" data-confirm-input></label>` : ''}
          <div class="row"><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(confirmText)}</button><button class="btn" data-cancel>Cancelar</button></div>
        </div></div>`;
      document.body.appendChild(wrap);
      const input = wrap.querySelector('[data-confirm-input]');
      const ok = wrap.querySelector('[data-ok]');
      if (input) { ok.disabled = true; input.addEventListener('input', () => { ok.disabled = input.value.trim() !== requireText.trim(); }); input.focus(); } else ok.focus();
      const done = (v) => { wrap.remove(); document.removeEventListener('keydown', onEsc, true); resolve(v); };
      const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
      document.addEventListener('keydown', onEsc, true);
      ok.addEventListener('click', () => done(true));
      wrap.querySelector('[data-cancel]').addEventListener('click', () => done(false));
      wrap.addEventListener('click', (e) => { if (e.target === wrap) done(false); });
    });
  }

  function openProfileModal() {
    const p = S.me;
    openModal(`
      <div class="modal sm"><button class="icon-btn modal-close" data-act="close-modal">${icon('x')}</button>
      <div class="modal-body">
        <h3>Meu perfil</h3>
        <form data-submit="profile">
          <label class="field"><span>Nome completo</span><input class="input" name="full_name" value="${esc(p.full_name)}" required maxlength="80" data-autofocus></label>
          <label class="field"><span>E-mail</span><input class="input" value="${esc(p.email)}" disabled></label>
          <div class="field"><span>Cor do avatar</span>
            <div class="color-row">${USER_COLORS.map((c) => `<button type="button" class="swatch ${c === p.color ? 'sel' : ''}" style="background:${c}" data-act="pick-swatch" data-color="${c}"></button>`).join('')}</div>
            <input type="hidden" name="color" value="${safeColor(p.color)}">
          </div>
          <div class="row"><button class="btn primary" type="submit">Salvar</button><button class="btn" type="button" data-act="close-modal">Cancelar</button></div>
        </form>
      </div></div>`);
  }

  function openPasswordModal(recovery = false) {
    openModal(`
      <div class="modal sm">${recovery ? '' : `<button class="icon-btn modal-close" data-act="close-modal">${icon('x')}</button>`}
      <div class="modal-body">
        <h3>${recovery ? 'Defina sua nova senha' : 'Alterar senha'}</h3>
        <form data-submit="password">
          <label class="field"><span>Nova senha (mínimo 8 caracteres)</span><input class="input" type="password" name="password" minlength="8" required autocomplete="new-password" data-autofocus></label>
          <label class="field"><span>Confirme a nova senha</span><input class="input" type="password" name="password2" minlength="8" required autocomplete="new-password"></label>
          <div class="row"><button class="btn primary" type="submit">Salvar senha</button>${recovery ? '' : '<button class="btn" type="button" data-act="close-modal">Cancelar</button>'}</div>
        </form>
      </div></div>`);
  }
  const openNewPasswordModal = () => openPasswordModal(true);

  // ------------------------------------------------------------------------
  // Administração
  // ------------------------------------------------------------------------
  async function showAdmin() {
    await loadMe();
    const cfg = await q(sb.from('app_config').select('*').eq('id', 1).maybeSingle());
    const boards = await q(sb.from('boards').select('id,title,archived'));
    const us = await sb.rpc('attachments_usage');
    const usage = us.error ? null : (Array.isArray(us.data) ? us.data[0] : us.data);
    const limit = (S.admin && S.admin.auditLimit) || 30;
    const pr = await sb.from('pre_registrations').select('*').is('used_at', null).order('created_at', { ascending: false });
    const au = await sb.from('admin_audit').select('*').order('created_at', { ascending: false }).limit(limit);
    const tp = await sb.from('card_templates').select('*').order('name');
    const ct = await sb.from('catalogs').select('*').order('name');
    if (!ct.error) S.catalogs = ct.data;
    S.admin = { catalogs: ct.error ? null : ct.data, templates: tp.error ? null : tp.data, cfg: cfg || {}, boards, usage, prereg: pr.error ? null : pr.data, audit: au.error ? null : au.data, auditLimit: limit };
    renderAdmin();
  }

  function renderUsage() {
    const u = S.admin.usage;
    if (!u) {
      return `<div class="notice">Os anexos ainda não foram ativados. Execute o arquivo <b>atualizacao-02-anexos.sql</b> no SQL Editor do Supabase.</div>`;
    }
    const pct = Math.min(100, (Number(u.total_bytes) / STORAGE_QUOTA) * 100);
    const level = pct >= 90 ? 'var(--danger)' : pct >= 75 ? '#d4a72c' : 'var(--primary)';
    return `
      <section class="panel" style="margin-bottom:20px">
        <h2>${icon('clip')} Espaço dos anexos</h2>
        <div class="progress" style="font-size:13px;margin-bottom:6px"><div class="bar" style="height:10px"><i style="width:${Math.max(pct, 0.5).toFixed(1)}%;background:${level}"></i></div><span><b>${pct.toFixed(1).replace('.', ',')}%</b></span></div>
        <p class="small muted" style="margin:0;line-height:1.5">${fmtSize(Number(u.total_bytes))} usados de 1 GB, em ${u.files} arquivo(s). Limite do plano gratuito do Supabase.
        ${pct >= 75 ? ' <b style="color:var(--danger)">O espaço está acabando: exclua anexos antigos de quadros arquivados ou avalie o plano pago.</b>' : ''}</p>
      </section>`;
  }

  function renderAdmin() {
    if (!S.session || !S.me) return;
    const order = { pending: 0, active: 1, inactive: 2 };
    const users = Object.values(S.profiles).sort((a, b) => order[a.status] - order[b.status] || a.full_name.localeCompare(b.full_name));
    const pend = users.filter((u) => u.status === 'pending').length;
    const cfg = S.admin.cfg;
    const statusName = { pending: 'Pendente', active: 'Ativo', inactive: 'Inativo' };
    $('#app').innerHTML = `
      ${topbar()}
      <main class="page">
        <h2 style="font-size:20px">${icon('shield', 20)} Administração</h2>
        ${pend ? `<div class="notice">Há <b>${pend}</b> cadastro(s) aguardando aprovação.</div>` : ''}
        ${renderUsage()}
        <section class="panel" style="margin-bottom:20px">
          <h2>${icon('users')} Usuários (${users.length})
            <span class="spacer"></span>
            ${S.admin.prereg === null ? '' : `<button class="btn primary sm" data-act="new-user">${icon('plus', 14)} Novo usuário</button>`}</h2>
          ${S.admin.prereg === null ? '<div class="notice">Para cadastrar usuários por aqui, execute o arquivo <b>atualizacao-03-usuarios.sql</b> no SQL Editor do Supabase.</div>' : ''}
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Servidor</th><th>Situação</th><th>Admin</th><th class="hide-sm">Cadastro</th><th style="text-align:right">Ações</th></tr></thead>
            <tbody>${users.map((u) => `
              <tr>
                <td><div class="row">${avatar(u.id)}<div style="min-width:0"><div style="font-weight:600">${esc(u.full_name)}${u.id === S.me.id ? ' <span class="muted small">(você)</span>' : ''}</div><div class="small muted">${esc(u.email)}</div></div></div></td>
                <td><span class="status ${u.status}">${statusName[u.status]}</span>${u.must_change_password ? '<div class="small muted" style="margin-top:4px">Senha provisória</div>' : ''}</td>
                <td><input type="checkbox" ${u.is_admin ? 'checked' : ''} data-change="admin-toggle" data-id="${u.id}" title="Administrador do sistema"></td>
                <td class="hide-sm small muted">${fmtDate(u.created_at, false)}</td>
                <td style="text-align:right;white-space:nowrap">
                  ${u.status === 'pending' ? `<button class="btn primary sm" data-act="user-status" data-id="${u.id}" data-status="active">Aprovar</button> <button class="btn sm" data-act="user-status" data-id="${u.id}" data-status="inactive">Recusar</button>` : ''}
                  ${u.status === 'active' && u.id !== S.me.id ? `<button class="btn sm" data-act="user-status" data-id="${u.id}" data-status="inactive">Desativar</button>` : ''}
                  ${u.status === 'inactive' ? `<button class="btn sm" data-act="user-status" data-id="${u.id}" data-status="active">Reativar</button>` : ''}
                  ${u.status !== 'pending' && u.id !== S.me.id && S.admin.prereg !== null ? `<button class="btn sm" data-act="reset-password" data-id="${u.id}" title="Gerar uma senha provisória nova">Redefinir senha</button>` : ''}
                </td>
              </tr>`).join('')}</tbody>
          </table></div>
          <p class="small muted" style="line-height:1.5;margin-bottom:0">Desativar bloqueia o acesso imediatamente, mas preserva o histórico do servidor. Administradores enxergam e gerenciam todos os quadros.</p>
          ${renderPreRegs()}
        </section>
        ${renderTemplatesAdmin()}
        ${renderCatalogsAdmin()}
        ${renderAudit()}
        <section class="panel" style="margin-bottom:20px">
          <h2>${icon('board')} Importar do Trello</h2>
          ${renderImport()}
        </section>
        <section class="panel">
          <h2>${icon('settings')} Regras de cadastro</h2>
          <form data-submit="admin-config" style="max-width:480px">
            <label class="field"><span>Domínio de e-mail permitido (deixe vazio para aceitar qualquer e-mail)</span>
              <input class="input" name="allowed_domain" value="${esc(cfg.allowed_domain || '')}" placeholder="ex.: seduc.pi.gov.br"></label>
            <label class="row" style="margin-bottom:16px;cursor:pointer"><input type="checkbox" name="require_approval" ${cfg.require_approval !== false ? 'checked' : ''}> Novos cadastros precisam de aprovação do administrador</label>
            <button class="btn primary" type="submit">Salvar regras</button>
          </form>
        </section>
      </main>`;
  }

  // ------------------------------------------------------------------------
  // Importação do Trello
  // ------------------------------------------------------------------------
  const TRELLO_LABEL_COLORS = {
    green: '#2e8b57', yellow: '#d4a72c', orange: '#e2711d', red: '#c9372c', purple: '#7a4fa3',
    blue: '#2f6f9f', sky: '#0e8fb0', lime: '#65a30d', pink: '#db2777', black: '#475569'
  };
  const TRELLO_BOARD_COLORS = {
    blue: '#1f6fb5', orange: '#c0632b', green: '#2e8b57', red: '#b23a48', purple: '#7a4fa3',
    pink: '#b23a48', lime: '#2e8b57', sky: '#0f766e', grey: '#475569'
  };
  const normName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const trelloIdDate = (id) => { const t = parseInt(String(id || '').slice(0, 8), 16); return t ? new Date(t * 1000).toISOString() : null; };
  const isoToLocalDate = (iso) => { if (!iso) return null; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const fmtDateTimeBR = (iso) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  function trelloMembers(t) {
    const byId = Object.fromEntries((t.members || []).map((m) => [m.id, m]));
    const used = uniq((t.cards || []).flatMap((c) => c.idMembers || []));
    return used.map((id) => ({ id, name: (byId[id] && (byId[id].fullName || byId[id].username)) || 'Membro do Trello' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function trelloSummary(t) {
    const lists = t.lists || [], cards = t.cards || [];
    const comments = (t.actions || []).filter((a) => a.type === 'commentCard').length;
    const items = (t.checklists || []).reduce((n, c) => n + (c.checkItems || []).filter((i) => String(i.name || '').trim()).length, 0);
    return {
      lists: lists.length, listsArch: lists.filter((l) => l.closed).length,
      cards: cards.length, cardsArch: cards.filter((c) => c.closed).length,
      labels: (t.labels || []).length, checklists: (t.checklists || []).length, items, comments,
      actionsCapped: (t.actions || []).length >= 1000
    };
  }

  function buildTrelloPayload(t, opts) {
    const map = opts.map || {};
    const memberName = Object.fromEntries(trelloMembers(t).map((m) => [m.id, m.name]));
    const lists = (t.lists || []).filter((l) => opts.includeArchived || !l.closed)
      .sort((a, b) => (a.pos || 0) - (b.pos || 0))
      .map((l, i) => ({ key: l.id, title: l.name, position: (i + 1) * 1000, archived: !!l.closed }));
    const listKeys = new Set(lists.map((l) => l.key));

    const labels = (t.labels || []).map((l) => ({
      key: l.id, name: l.name || '',
      color: TRELLO_LABEL_COLORS[String(l.color || '').replace(/_(light|dark)$/, '')] || '#64748b'
    }));

    const checklistsByCard = {};
    (t.checklists || []).slice().sort((a, b) => (a.pos || 0) - (b.pos || 0)).forEach((cl) => {
      (checklistsByCard[cl.idCard] = checklistsByCard[cl.idCard] || []).push({
        title: cl.name,
        items: (cl.checkItems || []).slice().sort((a, b) => (a.pos || 0) - (b.pos || 0))
          .map((it) => ({ text: it.name, done: it.state === 'complete' }))
      });
    });

    const commentsByCard = {};
    if (opts.includeComments) {
      (t.actions || []).filter((a) => a.type === 'commentCard' && a.data && a.data.card && a.data.text)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .forEach((a) => {
          const who = (a.memberCreator && (a.memberCreator.fullName || a.memberCreator.username)) || 'Membro do Trello';
          (commentsByCard[a.data.card.id] = commentsByCard[a.data.card.id] || [])
            .push({ body: `Comentário de ${who} no Trello em ${fmtDateTimeBR(a.date)}:\n\n${a.data.text}` });
        });
    }

    const byList = {};
    (t.cards || []).filter((c) => listKeys.has(c.idList) && (opts.includeArchived || !c.closed))
      .forEach((c) => (byList[c.idList] = byList[c.idList] || []).push(c));

    const cards = [];
    const usedMembers = new Set();
    Object.values(byList).forEach((arr) => {
      arr.sort((a, b) => (a.pos || 0) - (b.pos || 0)).forEach((c, i) => {
        const ids = c.idMembers || [];
        const assignees = ids.filter((id) => map[id]).map((id) => map[id]);
        assignees.forEach((u) => usedMembers.add(u));
        const notes = ids.filter((id) => !map[id]).map((id) => memberName[id] || 'Membro do Trello');
        const parts = [];
        if (c.desc && c.desc.trim()) parts.push(c.desc.trim());
        if (notes.length) parts.push(`Responsáveis no Trello: ${notes.join(', ')}`);
        const att = (c.attachments || []).filter((a) => a.url);
        if (att.length) parts.push('Anexos no Trello:\n' + att.map((a) => `- ${a.name || 'arquivo'}: ${a.url}`).join('\n'));
        cards.push({
          key: c.id, list: c.idList, title: String(c.name || '').slice(0, 300),
          description: parts.join('\n\n'),
          position: (i + 1) * 1000,
          start_date: isoToLocalDate(c.start),
          due_date: c.due || null,
          completed: !!c.dueComplete,
          archived: !!c.closed,
          created_at: trelloIdDate(c.id),
          labels: c.idLabels || [],
          assignees,
          checklists: checklistsByCard[c.id] || [],
          comments: commentsByCard[c.id] || []
        });
      });
    });

    const bg = t.prefs || {};
    const color = /^#[0-9a-f]{6}$/i.test(bg.backgroundColor || '') ? bg.backgroundColor : (TRELLO_BOARD_COLORS[bg.background] || '#1f6fb5');
    return {
      title: opts.title || t.name || 'Quadro importado',
      description: (t.desc || '').slice(0, 300),
      color, members: [...usedMembers], lists, labels, cards
    };
  }

  function renderImport() {
    const imp = S.imp;
    const intro = `
      <p class="small muted" style="line-height:1.6;margin-top:0">No Trello, abra o quadro e vá em <b>Menu (···) &gt; Imprimir, exportar e compartilhar &gt; Exportar como JSON</b>.
      Salve o arquivo e selecione-o abaixo. Importe um quadro por vez; cada importação cria um quadro novo, sem alterar os existentes.</p>
      <label class="btn">${icon('download', 14)} Escolher arquivo JSON<input type="file" accept=".json,application/json" data-change="trello-file" style="display:none"></label>`;
    if (!imp) return intro;
    const s = imp.summary;
    const profiles = Object.values(S.profiles).filter((p) => p.status === 'active').sort((a, b) => a.full_name.localeCompare(b.full_name));
    return `
      ${intro} <span class="small muted" style="margin-left:6px">${esc(imp.fileName)}</span>
      <form data-submit="import-trello" style="margin-top:18px;max-width:640px">
        <label class="field"><span>Nome do quadro no sistema</span><input class="input" name="title" value="${esc(imp.data.name || '')}" maxlength="80" required></label>
        <div class="notice">
          Encontrado no arquivo: <b>${s.lists}</b> listas${s.listsArch ? ` (${s.listsArch} arquivadas)` : ''},
          <b>${s.cards}</b> cartões${s.cardsArch ? ` (${s.cardsArch} arquivados)` : ''},
          <b>${s.labels}</b> etiquetas, <b>${s.checklists}</b> checklists com <b>${s.items}</b> itens e
          <b>${s.comments}</b> comentários.
          ${s.actionsCapped ? '<br>O Trello inclui no arquivo apenas as ações mais recentes, então comentários muito antigos podem não vir.' : ''}
        </div>
        <label class="row" style="margin-bottom:8px;cursor:pointer"><input type="checkbox" name="archived" checked> Importar também listas e cartões arquivados (entram como arquivados)</label>
        <label class="row" style="margin-bottom:16px;cursor:pointer"><input type="checkbox" name="comments" checked> Importar comentários (entram com o nome do autor e a data original no texto)</label>
        ${imp.members.length ? `
          <h4 style="margin:8px 0 4px;font-size:14px">Responsáveis do Trello</h4>
          <p class="small muted" style="margin:0 0 8px;line-height:1.5">Quem ainda não tem conta fica anotado na descrição do cartão. Se a pessoa já estiver cadastrada, escolha o servidor para que ela vire responsável de verdade.</p>
          <div class="table-wrap"><table class="table"><tbody>
            ${imp.members.map((m) => `
              <tr><td style="width:45%">${esc(m.name)}</td><td>
                <select class="select" name="map_${esc(m.id)}">
                  <option value="">Anotar no cartão</option>
                  ${profiles.map((p) => `<option value="${p.id}" ${imp.guess[m.id] === p.id ? 'selected' : ''}>${esc(p.full_name)}</option>`).join('')}
                </select></td></tr>`).join('')}
          </tbody></table></div>` : ''}
        <div class="row" style="margin-top:16px">
          <button class="btn primary" type="submit">Importar quadro</button>
          <button class="btn" type="button" data-act="cancel-import">Cancelar</button>
        </div>
      </form>`;
  }

  // ------------------------------------------------------------------------
  // Anexos
  // ------------------------------------------------------------------------
  const ATT_MAX = 10 * 1024 * 1024;
  const STORAGE_QUOTA = 1024 * 1024 * 1024;
  const ATT_TYPES = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed'
  };
  const ATT_ACCEPT = Object.keys(ATT_TYPES).map((e) => '.' + e).join(',');
  const extOf = (n) => (String(n || '').includes('.') ? String(n).split('.').pop().toLowerCase() : '');
  const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1).replace('.', ',')} MB`);
  const safeFileName = (n) => (String(n).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'arquivo');
  const isPreviewable = (a) => /^(application\/pdf|image\/(jpeg|png|gif|webp))$/.test(a.mime_type || '');
  const isImage = (a) => /^image\/(jpeg|png|gif|webp)$/.test(a.mime_type || '');
  const thumbCache = {};
  const bucket = () => sb.storage.from('anexos');

  // Reduz fotos grandes (lado maior até 1920 px, JPEG) antes do envio
  async function shrinkImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600 * 1024 || !window.createImageBitmap) return null;
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { return null; }
    const scale = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size * 0.9) return null;
    return { blob, name: file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', type: 'image/jpeg' };
  }

  async function uploadFiles(fileList) {
    if (!S.cd || !canEdit() || S.board.archived) return;
    const cardId = S.cd.card.id;
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let sent = 0;
    for (const f of files) {
      const fname = f.name && f.name !== 'image.png' ? f.name : `print-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`;
      let type = ATT_TYPES[extOf(fname)];
      if (!type) {
        toast(`"${fname}" não foi enviado: tipo de arquivo não permitido. Aceitos: PDF, imagens, Word, Excel e compactados (ZIP, RAR, 7Z).`, true, 7000);
        continue;
      }
      let blob = f, name = fname, note = null;
      const small = await shrinkImage(f).catch(() => null);
      if (small) {
        blob = small.blob; name = small.name; type = small.type;
        note = `A imagem "${fname}" foi reduzida de ${fmtSize(f.size)} para ${fmtSize(blob.size)} antes do envio. Motivo: o sistema usa o armazenamento gratuito do Supabase (1 GB para todo o setor) e fotos de celular ocupam muito espaço. A imagem continua nítida para leitura.`;
      }
      if (blob.size > ATT_MAX) { toast(`"${fname}" tem ${fmtSize(blob.size)} e passa do limite de 10 MB por arquivo.`, true, 7000); continue; }
      if (!S.cd || S.cd.card.id !== cardId) return;
      S.cd.uploading.push(name);
      renderCardModal();
      const path = `${S.board.id}/${cardId}/${crypto.randomUUID()}-${safeFileName(name)}`;
      try {
        const { error } = await bucket().upload(path, new Blob([blob], { type }), { contentType: type, upsert: false });
        if (error) throw error;
        try {
          await q(sb.from('attachments').insert({ card_id: cardId, file_name: name, storage_path: path, mime_type: type, size_bytes: blob.size, uploaded_by: S.me.id }));
        } catch (e) { await bucket().remove([path]); throw e; }
        sent++;
        if (note) toast(note, false, 10000);
      } catch (e) {
        toast(`Falha ao enviar "${name}": ${errMsg(e)}`, true, 7000);
      } finally {
        if (S.cd) S.cd.uploading = S.cd.uploading.filter((x) => x !== name);
      }
    }
    if (sent) toast(sent === 1 ? 'Anexo enviado.' : `${sent} anexos enviados.`);
    await afterCardChange();
  }

  async function signThumbs(atts) {
    const now = Date.now();
    const need = atts.filter((a) => isImage(a) && !(thumbCache[a.storage_path] && thumbCache[a.storage_path].exp > now));
    if (!need.length) return;
    try {
      const { data } = await bucket().createSignedUrls(need.map((a) => a.storage_path), 3600);
      (data || []).forEach((d) => { if (d.signedUrl) thumbCache[d.path] = { url: d.signedUrl, exp: now + 50 * 60 * 1000 }; });
    } catch (e) { /* miniaturas são opcionais */ }
  }

  async function attachmentPaths(filter) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      let qb = sb.from('attachments').select('storage_path');
      Object.entries(filter).forEach(([k, v]) => { qb = Array.isArray(v) ? qb.in(k, v) : qb.eq(k, v); });
      const { data, error } = await qb.range(from, from + 999);
      if (error) return out; // atualização de anexos ainda não aplicada
      out.push(...data.map((r) => r.storage_path));
      if (data.length < 1000) return out;
    }
  }
  async function removeStoredFiles(paths) {
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await bucket().remove(paths.slice(i, i + 100));
      if (error) throw error;
    }
  }

  function renderAttachments(ed) {
    const cd = S.cd;
    if (cd.attUnavailable) {
      return ed ? `<div class="cm-section"><h4>${icon('clip')} Anexos</h4><div class="notice">Os anexos ainda não foram ativados no banco. O administrador precisa executar o arquivo <b>atualizacao-02-anexos.sql</b> no SQL Editor do Supabase.</div></div>` : '';
    }
    if (!cd.attachments.length && !cd.uploading.length && !ed) return '';
    const rows = cd.attachments.map((a) => {
      const th = thumbCache[a.storage_path];
      const ext = (extOf(a.file_name) || '?').toUpperCase().slice(0, 4);
      return `
        <div class="att">
          <button class="att-thumb" data-act="open-att" data-id="${a.id}" title="Abrir">${th && isImage(a) ? `<img src="${esc(th.url)}" alt="">` : `<span>${esc(ext)}</span>`}</button>
          <div class="att-info">
            <button class="att-name" data-act="open-att" data-id="${a.id}">${esc(a.file_name)}</button>
            <div class="small muted">${fmtSize(a.size_bytes)} · ${esc(userName(a.uploaded_by))} · ${relTime(a.created_at)}</div>
            <div class="att-acts">
              <button data-act="download-att" data-id="${a.id}">Baixar</button>
              ${canManage() ? `<button data-act="delete-att" data-id="${a.id}">Excluir</button>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');
    const up = cd.uploading.map((n) => `<div class="att uploading"><div class="att-thumb"><span class="spin"></span></div><div class="att-info"><div>${esc(n)}</div><div class="small muted">Enviando...</div></div></div>`).join('');
    return `
      <div class="cm-section">
        <h4>${icon('clip')} Anexos ${cd.attachments.length ? `<span class="muted small" style="font-weight:500">(${cd.attachments.length})</span>` : ''}
          ${ed ? '<button class="btn sm" data-act="pick-files" style="margin-left:auto">Adicionar</button>' : ''}</h4>
        ${up}${rows}
        ${ed ? `<p class="small muted" style="line-height:1.5;margin:6px 0 0">PDF, imagens, Word, Excel e compactados, até 10 MB cada. Você também pode arrastar arquivos para esta janela ou colar um print com Ctrl + V. Fotos grandes são reduzidas automaticamente para economizar o espaço do sistema.</p>
          <input type="file" id="att-input" multiple accept="${ATT_ACCEPT}" hidden data-change="att-files">` : ''}
        ${!ed && !cd.attachments.length ? '<p class="empty">Nenhum anexo.</p>' : ''}
      </div>`;
  }

  // ------------------------------------------------------------------------
  // Cadastro de usuários pelo administrador
  // ------------------------------------------------------------------------
  async function invokeAdmin(body, fn = 'admin-users') {
    const { data, error } = await sb.functions.invoke(fn, { body });
    if (error) {
      let msg = error.message || 'Falha ao chamar a função do servidor.';
      try {
        if (error.context && typeof error.context.json === 'function') {
          const b = await error.context.json();
          if (b && (b.error || b.message || b.msg)) msg = b.error || b.message || b.msg;
        }
      } catch (e) { /* mantém a mensagem original */ }
      if (/invalid jwt|jwt/i.test(msg) && !/Sessão/.test(msg)) {
        msg = 'O Supabase recusou a chamada da função (JWT). No painel do Supabase, abra Edge Functions > admin-users > Settings, desligue a opção "Verify JWT" e salve. A própria função já confere se quem chama é administrador.';
      } else if (/not found|404|Failed to send a request|FunctionsFetchError|FunctionsRelayError/i.test(msg)) {
        msg = fn === 'admin-users'
          ? 'A função "admin-users" ainda não foi criada no Supabase. Siga o passo a passo do guia (Edge Function) ou use a opção "Pré-cadastro", que não depende dela.'
          : `A função "${fn}" ainda não foi criada no Supabase. Siga o passo a passo do guia (Edge Function).`;
      }
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  const AUDIT_TEXT = {
    user_created: (t) => `criou a conta de ${t} com senha provisória`,
    pre_registration_created: (t) => `fez o pré-cadastro de ${t}`,
    pre_registration_cancelled: (t) => `cancelou o pré-cadastro de ${t}`,
    pre_registration_used: (t) => `teve o pré-cadastro de ${t} utilizado (a pessoa criou a própria senha)`,
    password_reset: (t) => `redefiniu a senha de ${t}`,
    password_changed: () => 'trocou a senha provisória pela própria senha',
    user_status: (t, d) => `alterou a situação de ${t} de ${esc(STATUS_NAME[d.from] || d.from)} para <b>${esc(STATUS_NAME[d.to] || d.to)}</b>`,
    user_admin: (t, d) => (d.to ? `tornou ${t} administrador do sistema` : `retirou de ${t} o perfil de administrador`),
    template_created: (t) => `criou o template ${t}`,
    template_updated: (t) => `alterou o template ${t}`,
    template_deleted: (t) => `excluiu o template ${t}`,
    template_activated: (t) => `ativou o template ${t}`,
    template_deactivated: (t) => `desativou o template ${t}`,
    catalog_created: (t) => `criou o cadastro de referência ${t}`,
    catalog_updated: (t) => `alterou a configuração do cadastro ${t}`,
    catalog_deleted: (t) => `excluiu o cadastro de referência ${t}`,
    catalog_synced: (t, d) => `sincronizou o cadastro ${t} (${d.total} itens${d.deactivated ? `, ${d.deactivated} desativado(s)` : ''})`
  };
  const STATUS_NAME = { pending: 'Pendente', active: 'Ativo', inactive: 'Inativo' };

  function auditLine(a) {
    const p = a.target_id && S.profiles[a.target_id];
    const t = `<b>${esc(p ? p.full_name : (a.details && a.details.name) || a.target_email || 'usuário')}</b>`;
    const fn = AUDIT_TEXT[a.action];
    return `
      <div class="feed-item act">
        ${a.actor_id && S.profiles[a.actor_id] ? avatar(a.actor_id, 'sm') : `<span class="avatar sm" style="background:#8590a2">${esc(initials(a.actor_name || 'Sistema'))}</span>`}
        <div class="txt"><span class="who">${esc(a.actor_name || 'Sistema')}</span> ${fn ? fn(t, a.details || {}) : esc(a.action)}
          <div class="when">${fmtDate(a.created_at)} · ${relTime(a.created_at)}</div></div>
      </div>`;
  }

  function renderPreRegs() {
    const list = S.admin.prereg;
    if (list === null) return '';
    const open = list.filter((r) => !r.used_at && !r.temp_password);
    if (!open.length) return '';
    return `
      <h4 style="margin:20px 0 8px;font-size:14px">Pré-cadastros aguardando a pessoa criar a conta (${open.length})</h4>
      <div class="table-wrap"><table class="table"><tbody>
        ${open.map((r) => `
          <tr>
            <td><div style="font-weight:600">${esc(r.full_name)}</div><div class="small muted">${esc(r.email)}</div></td>
            <td class="small muted hide-sm">${r.boards.length} quadro(s)${r.is_admin ? ' · administrador' : ''}</td>
            <td class="small muted hide-sm">${fmtDate(r.created_at, false)}</td>
            <td style="text-align:right"><button class="btn sm" data-act="cancel-prereg" data-id="${r.id}">Cancelar</button></td>
          </tr>`).join('')}
      </tbody></table></div>`;
  }

  function renderAudit() {
    const list = S.admin.audit;
    if (list === null) return '';
    return `
      <section class="panel" style="margin-bottom:20px">
        <h2>${icon('history')} Histórico de administração</h2>
        ${list.length ? list.map(auditLine).join('') : '<p class="empty">Nenhuma ação registrada ainda.</p>'}
        ${list.length >= S.admin.auditLimit ? '<button class="btn block" style="justify-content:center" data-act="more-audit">Carregar mais</button>' : ''}
      </section>`;
  }

  function openNewUserModal() {
    const boards = (S.admin.boards || []).slice().sort((a, b) => (a.archived - b.archived) || a.title.localeCompare(b.title));
    openModal(`
      <div class="modal"><button class="icon-btn modal-close" data-act="close-modal">${icon('x')}</button>
      <div class="modal-body">
        <h3>Novo usuário</h3>
        <form data-submit="new-user">
          <div class="row wrap" style="gap:12px;align-items:flex-start">
            <label class="field" style="flex:1 1 240px"><span>Nome completo</span><input class="input" name="full_name" required maxlength="80" data-autofocus></label>
            <label class="field" style="flex:1 1 240px"><span>E-mail</span><input class="input" type="email" name="email" required maxlength="120"></label>
          </div>
          <div class="field"><span>Forma de acesso</span>
            <label class="choice"><input type="radio" name="mode" value="temp" checked>
              <div><b>Criar a conta agora com senha provisória</b> (recomendado)<div class="small muted">O sistema gera uma senha que aparece uma única vez para você repassar. No primeiro acesso, a pessoa é obrigada a criar a própria senha.</div></div></label>
            <label class="choice"><input type="radio" name="mode" value="pre">
              <div><b>Pré-cadastro</b><div class="small muted">A pessoa cria a própria senha em "Criar conta" no site, usando este e-mail, e entra já aprovada e nos quadros escolhidos. Nenhuma senha passa por você.</div></div></label>
          </div>
          <label class="row" style="margin-bottom:14px;cursor:pointer"><input type="checkbox" name="is_admin"> Administrador do sistema (vê e gerencia todos os quadros e usuários)</label>
          <div class="field"><span>Quadros e papel</span>
            ${boards.length ? `<div class="table-wrap" style="max-height:260px;overflow-y:auto;border:1px solid var(--line);border-radius:8px"><table class="table" style="margin:0"><tbody>
              ${boards.map((b) => `<tr><td>${esc(b.title)}${b.archived ? ' <span class="muted small">(arquivado)</span>' : ''}</td><td style="width:170px">
                <select class="select" name="board_${b.id}" style="padding:5px 8px">
                  <option value="">Sem acesso</option><option value="editor">Editor</option><option value="viewer">Leitor</option><option value="owner">Dono</option>
                </select></td></tr>`).join('')}
            </tbody></table></div>` : '<p class="empty">Nenhum quadro criado ainda.</p>'}
          </div>
          <div class="row"><button class="btn primary" type="submit">Cadastrar</button><button class="btn" type="button" data-act="close-modal">Cancelar</button></div>
        </form>
      </div></div>`);
  }

  function accessMessage(r) {
    const first = String(r.full_name || '').split(' ')[0];
    return `Olá, ${first}! Seu acesso ao ${APP_NAME} foi ${r.reset ? 'redefinido' : 'criado'}.\n\n` +
      `Endereço: ${location.origin}${location.pathname.replace(/index\.html$/, '')}\nE-mail: ${r.email}\nSenha provisória: ${r.password}\n\n` +
      'No primeiro acesso, o sistema vai pedir para você criar uma senha nova.';
  }

  function openPasswordResult(r) {
    S.lastAccess = r;
    openModal(`
      <div class="modal sm"><div class="modal-body">
        <h3>${r.reset ? 'Senha redefinida' : 'Conta criada'}</h3>
        <p style="margin-top:0;line-height:1.5"><b>${esc(r.full_name)}</b><br><span class="muted">${esc(r.email)}</span></p>
        <div class="field"><span>Senha provisória</span>
          <div class="row"><code class="temp-pass">${esc(r.password)}</code><button class="btn sm" data-act="copy-text" data-what="password">Copiar</button></div>
        </div>
        <div class="notice err" style="line-height:1.5"><b>Esta senha não será exibida novamente.</b> Copie agora e repasse pessoalmente ou por um canal seguro. Se perder, use "Redefinir senha" para gerar outra.</div>
        <button class="btn block" style="justify-content:center;margin-bottom:12px" data-act="copy-text" data-what="message">${icon('comment', 14)} Copiar mensagem pronta para enviar</button>
        <button class="btn primary block" style="justify-content:center" data-act="close-access">Concluído</button>
      </div></div>`, 'locked');
  }

  function renderForceChange() {
    $('#app').innerHTML = `
      <div class="auth-wrap"><div class="auth-card">
        <div class="brand-mark" style="background:#1b3a5c;color:#fff;width:36px;height:36px">${icon('key', 20)}</div>
        <h1>Crie sua senha</h1>
        <div class="org">${esc(S.me.full_name)} · ${esc(S.me.email)}</div>
        <div class="notice">Você entrou com uma senha provisória. Para continuar, crie uma senha pessoal. Ninguém, nem o administrador, terá acesso a ela.</div>
        <form data-submit="force-password">
          <label class="field"><span>Nova senha (mínimo 8 caracteres)</span><input class="input" type="password" name="password" minlength="8" required autocomplete="new-password" data-autofocus></label>
          <label class="field"><span>Confirme a nova senha</span><input class="input" type="password" name="password2" minlength="8" required autocomplete="new-password"></label>
          <div class="row"><button class="btn primary" type="submit">Salvar e continuar</button><button class="btn" type="button" data-act="logout">Sair</button></div>
        </form>
      </div></div>`;
    autofocus();
  }

  // ------------------------------------------------------------------------
  // Templates de cartão (formulários de solicitação)
  // ------------------------------------------------------------------------
  const FIELD_TYPES = {
    checkbox: 'Múltipla escolha (várias respostas)',
    radio: 'Escolha única (botões)',
    select: 'Lista suspensa (uma resposta)',
    text: 'Texto curto',
    textarea: 'Texto longo',
    number: 'Número',
    date: 'Data',
    catalog: 'Pesquisa em cadastro (uma resposta)',
    items: 'Lista de itens com quantidade (cadastro)'
  };
  const CHOICE = (t) => t === 'checkbox' || t === 'radio' || t === 'select';
  const boardTemplates = () => (S.templates || []).filter((t) => t.active && (t.all_boards || (t.boards || []).includes(S.board.id)));
  const canUseTemplates = () => !!S.role && !S.board.archived && boardTemplates().length > 0;

  function slugKey(label, used) {
    let base = String(label || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'campo';
    let k = base, i = 2;
    while (used.has(k)) k = `${base}_${i++}`;
    return k;
  }
  function ensureKeys(tpl) {
    const used = new Set(tpl.fields.filter((f) => f.key).map((f) => f.key));
    tpl.fields.forEach((f) => { if (!f.key) { f.key = slugKey(f.label, used); used.add(f.key); } });
  }

  // Respostas atuais do formulário
  function collectAnswers(form, tpl) {
    const a = {};
    tpl.fields.forEach((f) => {
      const n = 'f_' + f.key;
      if (CATALOG_TYPES(f.type)) {
        const st = S.tplForm && S.tplForm.cat && S.tplForm.cat[f.key];
        if (f.type === 'catalog') a[f.key] = st && st.value ? { key: st.value.key, label: st.value.label } : null;
        else a[f.key] = st ? st.value.filter((r) => r.key).map((r) => ({ key: r.key, label: r.label, qty: String(r.qty ?? '').trim(), cols: { ...(r.cols || {}) } })) : [];
        return;
      }
      if (f.type === 'checkbox') a[f.key] = $$(`input[name="${n}"]:checked`, form).map((i) => i.value);
      else if (f.type === 'radio') { const c = $(`input[name="${n}"]:checked`, form); a[f.key] = c ? c.value : ''; }
      else { const el = form.elements[n]; a[f.key] = el ? el.value.trim() : ''; }
      const o = form.elements[n + '__other'];
      if (o) a[f.key + '__other'] = o.value.trim();
    });
    return a;
  }
  function answerText(f, a) {
    const v = a[f.key];
    if (f.type === 'catalog') return v && v.label ? v.label : '';
    if (f.type === 'items') { const l = (v || []).map((r) => r.label); return l.length > 2 ? `${l.slice(0, 2).join(', ')} e mais ${l.length - 2}` : l.join(', '); }
    const list = Array.isArray(v) ? v : (v ? [v] : []);
    return list.map((x) => (x === '__other__' ? (a[f.key + '__other'] || '') : x)).filter(Boolean).join(', ');
  }
  function suggestTitle(tpl, a) {
    const pattern = (tpl.title_pattern || '').trim();
    if (!pattern) return tpl.name;
    let s = pattern.replace(/\{([a-z0-9_]+)\}/g, (m, k) => { const f = tpl.fields.find((x) => x.key === k); return f ? answerText(f, a) : ''; });
    s = s.replace(/\s*([|,;])\s*(?=[|,;]|$)/g, '').replace(/:\s*(?=[|,;]|$)/g, ':').replace(/\s*[|,;:]\s*$/g, '').replace(/^\s*[|,;]\s*/, '');
    s = s.replace(/:\s*\|\s*/g, ': ').replace(/\s{2,}/g, ' ').trim();
    return s.length > 300 ? s.slice(0, 297) + '...' : s;
  }
  // Converte a cópia guardada no cartão de volta em respostas (para editar)
  function answersFromCard(tpl, data) {
    const a = {};
    (data || []).forEach((d) => {
      const f = tpl.fields.find((x) => x.key === d.key);
      if (!f) return;
      if (f.type === 'catalog') { a[f.key] = d.ref && d.ref[0] ? { ...d.ref[0] } : null; return; }
      if (f.type === 'items') { a[f.key] = (d.ref || []).map((r) => ({ ...r })); return; }
      const vals = (d.values || []).map((v) => {
        if (CHOICE(f.type) && /^Outros: /.test(v) && !(f.options || []).some((o) => o.label === v)) { a[f.key + '__other'] = v.replace(/^Outros: /, ''); return '__other__'; }
        return v;
      });
      a[f.key] = f.type === 'checkbox' ? vals : (vals[0] || '');
    });
    return a;
  }

  function renderField(f, a) {
    const n = 'f_' + f.key;
    const v = a[f.key];
    const req = f.required ? ' <span style="color:var(--danger)">*</span>' : '';
    const help = f.help ? `<div class="small muted" style="margin:-2px 0 6px">${esc(f.help)}</div>` : '';
    const otherVal = a[f.key + '__other'] || '';
    let input = '';
    if (CATALOG_TYPES(f.type)) {
      input = `<div class="cat-field" data-key="${esc(f.key)}">${renderCatInner(f)}</div>`;
    } else if (f.type === 'checkbox' || f.type === 'radio') {
      const sel = f.type === 'checkbox' ? (Array.isArray(v) ? v : []) : [v];
      const opts = (f.options || []).map((o) => `
        <label class="opt-check"><input type="${f.type}" name="${n}" value="${esc(o.label)}" ${sel.includes(o.label) ? 'checked' : ''} ${o.exclusive ? 'data-excl="1"' : ''}> <span>${esc(o.label)}</span></label>`).join('');
      const other = f.allow_other ? `
        <label class="opt-check"><input type="${f.type}" name="${n}" value="__other__" ${sel.includes('__other__') ? 'checked' : ''}> <span>Outros</span></label>
        <input class="input other-input ${sel.includes('__other__') ? '' : 'hidden'}" name="${n}__other" value="${esc(otherVal)}" placeholder="Descreva" maxlength="200">` : '';
      input = `<div class="opt-grid">${opts}${other}</div>`;
    } else if (f.type === 'select') {
      input = `<select class="select" name="${n}"><option value="">Selecione...</option>
        ${(f.options || []).map((o) => `<option ${v === o.label ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        ${f.allow_other ? `<option value="__other__" ${v === '__other__' ? 'selected' : ''}>Outros...</option>` : ''}</select>
        ${f.allow_other ? `<input class="input other-input ${v === '__other__' ? '' : 'hidden'}" style="margin-top:6px" name="${n}__other" value="${esc(otherVal)}" placeholder="Descreva" maxlength="200">` : ''}`;
    } else if (f.type === 'textarea') {
      input = `<textarea class="textarea" name="${n}" rows="4" maxlength="4000">${esc(v || '')}</textarea>`;
    } else if (f.type === 'number') {
      input = `<input class="input" type="number" step="any" name="${n}" value="${esc(v || '')}" style="max-width:220px">`;
    } else if (f.type === 'date') {
      input = `<input class="input" type="date" name="${n}" value="${esc(v || '')}" style="max-width:220px">`;
    } else {
      input = `<input class="input" name="${n}" value="${esc(v || '')}" maxlength="300">`;
    }
    return `<div class="field tpl-field" data-key="${esc(f.key)}"><span>${esc(f.label)}${req}</span>${help}${input}</div>`;
  }

  // mode: 'new' (criar cartão), 'edit' (editar respostas), 'preview' (pré-visualizar no construtor)
  async function openTemplateForm(tpl, opts) {
    const catFields = tpl.fields.filter((f) => CATALOG_TYPES(f.type));
    if (catFields.length) {
      if (!S.catalogs || !S.catalogs.length) await loadCatalogs();
      catFields.filter((f) => f.group_filter && f.catalog).forEach((f) => {
        loadCatalogGroups(f.catalog).then(() => { if (S.tplForm && S.tplForm.tpl === tpl) refreshGroupSelect(f); });
      });
    }
    const a = opts.mode === 'edit' ? answersFromCard(tpl, opts.card.form_data) : {};
    S.tplForm = { tpl, ...opts, cat: initCatState(tpl, a) };
    const lists = opts.mode === 'new' ? activeLists() : [];
    const title = opts.mode === 'edit' ? 'Editar respostas' : opts.mode === 'preview' ? `Pré-visualização: ${tpl.name}` : tpl.name;
    openModal(`
      <div class="modal"><button class="icon-btn modal-close" data-act="close-tplform">${icon('x')}</button>
      <div class="modal-body">
        <h3>${icon('form', 18)} ${esc(title)}</h3>
        ${tpl.description ? `<p class="muted" style="margin:-8px 0 16px;line-height:1.5">${esc(tpl.description)}</p>` : ''}
        <form data-submit="tpl-form" data-tplform="1">
          ${tpl.fields.map((f) => renderField(f, a)).join('')}
          ${opts.mode !== 'edit' ? `
          <hr style="border:0;border-top:1px solid var(--line);margin:8px 0 16px">
          <label class="field"><span>Título do cartão</span>
            <input class="input" name="__title" maxlength="300" value="${esc(suggestTitle(tpl, a))}" data-title-auto="1">
            <div class="small muted" style="margin-top:4px">Sugerido a partir das respostas. Você pode ajustar.</div></label>
          ${opts.mode === 'new' ? `<label class="field"><span>Lista</span><select class="select" name="__list">
            ${lists.map((l) => `<option value="${l.id}" ${l.id === opts.listId ? 'selected' : ''}>${esc(l.title)}</option>`).join('')}</select></label>` : ''}` : `
          <div class="notice">Se a prioridade for alterada, o prazo é recalculado a partir de agora e a etiqueta é trocada.</div>`}
          <div class="row">
            ${opts.mode === 'preview' ? '<button class="btn primary" type="button" data-act="close-tplform">Fechar pré-visualização</button>' : `
            <button class="btn primary" type="submit">${opts.mode === 'edit' ? 'Salvar respostas' : 'Criar cartão'}</button>
            <button class="btn" type="button" data-act="close-tplform">Cancelar</button>`}
          </div>
        </form>
      </div></div>`, 'tplform');
  }

  function closeTemplateForm() {
    const tf = S.tplForm;
    S.tplForm = null;
    if (S.pendingRefresh) setTimeout(doRefresh, 50);
    if (!tf) return closeModal();
    if (tf.mode === 'edit' && S.cd) return renderCardModal();
    if (tf.mode === 'preview') return renderTplEditor();
    closeModal();
  }

  function onTemplateFormInput(ev) {
    const form = ev.target.closest('form[data-tplform]');
    if (!form || !S.tplForm) return;
    const el = ev.target;
    if (el.name === '__title') { el.dataset.titleAuto = ''; return; }
    if (ev.type === 'change' && el.type === 'checkbox' && el.checked) {
      const group = $$(`input[name="${el.name}"]`, form);
      if (el.dataset.excl) group.forEach((g) => { if (g !== el) g.checked = false; });
      else group.forEach((g) => { if (g.dataset.excl) g.checked = false; });
    }
    $$('.tpl-field', form).forEach((fd) => {
      const other = $('.other-input', fd);
      if (!other) return;
      const k = fd.dataset.key;
      const on = $$(`[name="f_${k}"]`, form).some((i) => (i.tagName === 'SELECT' ? i.value === '__other__' : i.checked && i.value === '__other__'));
      other.classList.toggle('hidden', !on);
    });
    const t = form.elements.__title;
    if (t && t.dataset.titleAuto) t.value = suggestTitle(S.tplForm.tpl, collectAnswers(form, S.tplForm.tpl));
  }
  document.addEventListener('input', onTemplateFormInput);
  document.addEventListener('change', onTemplateFormInput);

  function validateAnswers(tpl, a) {
    for (const f of tpl.fields) {
      const v = a[f.key];
      const empty = Array.isArray(v) ? !v.length : !v;
      if (f.required && empty) return `Responda o campo obrigatório "${f.label}".`;
      if (f.type === 'items' && (v || []).some((r) => !/^\d+$/.test(r.qty) || Number(r.qty) < 1)) return `Informe quantidades inteiras maiores que zero em "${f.label}".`;
      if (f.type === 'items') for (const r of v || []) for (const c of f.columns || []) if (c.required !== false && !(r.cols || {})[c.key]) return `Informe "${c.label}" para o item "${r.label}".`;
      if (CATALOG_TYPES(f.type)) continue;
      const vals = Array.isArray(v) ? v : [v];
      if (vals.includes('__other__') && !a[f.key + '__other']) return `Descreva a opção "Outros" em "${f.label}".`;
    }
    return null;
  }

  function renderFormData(c) {
    if (!c.form_data || !c.form_data.length) return '';
    const tplExists = (S.templates || []).some((t) => t.id === c.template_id);
    return `
      <div class="cm-section">
        <h4>${icon('form')} ${esc(c.template_name || 'Solicitação')}
          ${canEdit() && !S.board.archived && tplExists ? '<button class="btn sm" data-act="edit-answers" style="margin-left:auto">Editar respostas</button>' : ''}</h4>
        <div class="small muted" style="margin:-4px 0 8px">Solicitado por ${esc(userName(c.created_by))} em ${fmtDate(c.created_at)}</div>
        <dl class="form-data">
          ${c.form_data.map((d) => `<dt>${esc(d.label)}</dt><dd>${(d.values || []).length
            ? (d.type === 'items' ? itemsTable(d)
              : d.type === 'catalog' ? `${esc(d.values[0])}${d.ref && d.ref[0] && d.ref[0].group ? `<div class="small muted">${esc(d.ref[0].group)}</div>` : ''}`
              : d.type === 'textarea' ? `<div style="white-space:pre-wrap">${linkify(d.values[0])}</div>`
              : (d.values.length > 1 || d.type === 'checkbox') ? d.values.map((v) => `<span class="pill">${esc(v)}</span>`).join(' ')
              : esc(d.type === 'date' ? fmtDate(d.values[0], false) : d.values[0]))
            : '<span class="muted">Não informado</span>'}</dd>`).join('')}
        </dl>
      </div>`;
  }
  function itemsTable(d) {
    const rows = d.ref || [];
    const total = rows.reduce((n, r) => n + (Number(r.qty) || 0), 0);
    const cols = d.columns || [];
    const meta = (r) => cols.filter((c) => (r.cols || {})[c.key]).map((c) => `<span><b>${esc(c.label)}:</b> ${esc(r.cols[c.key])}</span>`).join('');
    return `<div class="table-wrap"><table class="items-table"><thead><tr><th style="width:56px">Qtd.</th><th>Item</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="num">${esc(r.qty)}</td><td>${esc(r.label)}${cols.length ? `<div class="item-meta">${meta(r)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="small muted" style="margin-top:4px">${rows.length} item(ns) · ${total} unidade(s)</div>`;
  }
  const formDataText = (c) => (c.form_data || []).map((d) => `${d.label}: ${(d.values || []).join(', ')}`).join('; ');

  // ---------- Cadastros de referência (pesquisa e lista de itens) ----------
  const CATALOG_TYPES = (t) => t === 'catalog' || t === 'items';
  const catalogById = (id) => (S.catalogs || []).find((c) => c.id === id);
  async function loadCatalogs() {
    const r = await sb.from('catalogs').select('*').order('name');
    S.catalogs = r.error ? [] : r.data;
    return S.catalogs;
  }
  async function loadCatalogGroups(id) {
    S.catGroups = S.catGroups || {};
    if (S.catGroups[id]) return S.catGroups[id];
    const r = await sb.rpc('catalog_groups', { p_catalog: id });
    S.catGroups[id] = r.error ? [] : r.data;
    return S.catGroups[id];
  }
  async function maybeSyncCatalogs() {
    if (S.catAutoSynced) return;
    S.catAutoSynced = true;
    try {
      const cats = await loadCatalogs();
      const limit = Date.now() - 12 * 3600 * 1000;
      if (cats.some((c) => !c.last_sync_at || new Date(c.last_sync_at).getTime() < limit)) {
        await sb.functions.invoke('sync-catalogs', { body: { action: 'sync' } });
        await loadCatalogs();
      }
    } catch (e) { /* a sincronização automática é silenciosa */ }
  }

  function initCatState(tpl, a) {
    const st = {};
    tpl.fields.filter((f) => CATALOG_TYPES(f.type)).forEach((f) => {
      const v = a[f.key];
      if (f.type === 'catalog') st[f.key] = { group: '', value: v && v.key ? v : null };
      else {
        const rows = Array.isArray(v) ? v.filter((r) => r && r.key).map((r) => ({ ...r, cols: { ...(r.cols || {}) } })) : [];
        rows.push({ key: '', qty: 1, cols: {} });
        st[f.key] = { group: '', value: rows };
      }
    });
    return st;
  }
  const comboHtml = (key, i) => `
    <div class="combo">
      <input class="input combo-input" data-key="${esc(key)}" ${i != null ? `data-i="${i}"` : ''} placeholder="Digite para pesquisar (nome ou código)..." autocomplete="off" aria-label="Pesquisar">
      <div class="combo-list hidden" role="listbox"></div>
    </div>`;

  function renderCatInner(f) {
    const st = S.tplForm.cat[f.key];
    const cat = catalogById(f.catalog);
    if (!cat) return '<div class="notice err">O cadastro usado nesta pergunta não foi encontrado. O administrador precisa revisar o template.</div>';
    if (!cat.active_count && !cat.last_sync_at) return '<div class="notice">Este cadastro ainda não foi sincronizado. O administrador precisa clicar em "Sincronizar" na tela de Administração.</div>';
    const groupSel = f.group_filter && cat.group_column ? `
      <select class="select cat-group" data-key="${esc(f.key)}" style="max-width:380px;margin-bottom:6px" aria-label="Filtrar por ${esc(cat.group_label || cat.group_column)}">
        ${groupOptions(f, cat, st)}
      </select>` : '';
    if (f.type === 'catalog') {
      return groupSel + (st.value
        ? `<div class="cat-chip"><span>${esc(st.value.label)}${st.value.group ? `<small>${esc(st.value.group)}</small>` : ''}</span><button type="button" class="icon-btn" data-act="cat-clear" data-key="${esc(f.key)}" title="Trocar">${icon('x', 14)}</button></div>`
        : comboHtml(f.key, null));
    }
    const rows = st.value;
    const filled = rows.filter((r) => r.key);
    const total = filled.reduce((n, r) => n + (parseInt(r.qty, 10) || 0), 0);
    return groupSel + `
      <div class="items-head"><span style="flex:1">${esc(cat.name)}</span><span style="width:110px">${esc(f.qty_label || 'Quantidade')}</span><span style="width:32px"></span></div>
      ${rows.map((r, i) => `
        <div class="${(f.columns || []).length ? 'item-block' : ''}">
        <div class="item-row">
          <div style="flex:1;min-width:0">${r.key ? `<div class="cat-chip"><span>${esc(r.label)}</span></div>` : comboHtml(f.key, i)}</div>
          <input class="input qty" type="number" min="1" step="1" inputmode="numeric" value="${esc(r.qty ?? 1)}" data-key="${esc(f.key)}" data-i="${i}" aria-label="${esc(f.qty_label || 'Quantidade')}">
          <button type="button" class="icon-btn" data-act="item-del" data-key="${esc(f.key)}" data-i="${i}" title="Remover linha">${icon('x', 14)}</button>
        </div>
        ${(f.columns || []).length ? `<div class="item-cols">${f.columns.map((c) => `
          <select class="select item-col ${r.key && c.required !== false && !(r.cols || {})[c.key] ? 'missing' : ''}" data-key="${esc(f.key)}" data-i="${i}" data-col="${esc(c.key)}" aria-label="${esc(c.label)}">
            <option value="">${esc(c.label)}${c.required !== false ? ' *' : ''}</option>
            ${(c.options || []).map((o) => `<option ${(r.cols || {})[c.key] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
          </select>`).join('')}</div>` : ''}
        </div>`).join('')}
      <div class="row wrap" style="justify-content:space-between">
        <button type="button" class="btn sm" data-act="item-add" data-key="${esc(f.key)}">${icon('plus', 14)} Adicionar linha</button>
        <span class="small muted items-summary">${filled.length} item(ns) · ${total} unidade(s)</span>
      </div>`;
  }
  function groupOptions(f, cat, st) {
    const groups = (S.catGroups || {})[f.catalog];
    return `<option value="">${esc(cat.group_label || cat.group_column)}: ${groups ? 'todas' : 'carregando...'}</option>
      ${(groups || []).map((g) => `<option value="${esc(g.group_value)}" ${st.group === g.group_value ? 'selected' : ''}>${esc(g.group_value)} (${g.items})</option>`).join('')}`;
  }
  // Atualiza só as opções do filtro, sem apagar o que a pessoa já digitou
  function refreshGroupSelect(f) {
    const sel = $(`.cat-field[data-key="${f.key}"] select.cat-group`);
    const cat = catalogById(f.catalog);
    if (sel && cat) sel.innerHTML = groupOptions(f, cat, S.tplForm.cat[f.key]);
  }
  function rerenderCatField(key, focus) {
    const f = S.tplForm.tpl.fields.find((x) => x.key === key);
    const box = $(`.cat-field[data-key="${key}"]`);
    if (!f || !box) return;
    box.innerHTML = renderCatInner(f);
    refreshTplTitle();
    if (focus === 'combo') { const i = $('.combo-input', box); if (i) i.focus(); }
    if (typeof focus === 'number') { const q = $(`.qty[data-i="${focus}"]`, box); if (q) { q.focus(); q.select(); } }
  }
  function refreshTplTitle() {
    const form = $('form[data-tplform]');
    if (!form || !S.tplForm) return;
    const t = form.elements.__title;
    if (t && t.dataset.titleAuto) t.value = suggestTitle(S.tplForm.tpl, collectAnswers(form, S.tplForm.tpl));
  }
  function markText(label, q) {
    let out = esc(label);
    String(q || '').trim().split(/\s+/).filter((w) => w.length > 1).forEach((w) => {
      const re = new RegExp(`(${w.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split('').map((ch) => `${ch}[\\u0300-\\u036f]*`).join('')})`, 'ig');
      out = out.normalize('NFD').replace(re, '<mark>$1</mark>').normalize('NFC');
    });
    return out;
  }
  async function runComboSearch(input) {
    if (!S.tplForm) return;
    const key = input.dataset.key;
    const f = S.tplForm.tpl.fields.find((x) => x.key === key);
    const st = S.tplForm.cat[key];
    const list = input.nextElementSibling;
    list.classList.remove('hidden');
    if (!list.innerHTML) list.innerHTML = '<div class="combo-empty">Pesquisando...</div>';
    const seq = (input._seq = (input._seq || 0) + 1);
    const { data, error } = await sb.rpc('search_catalog', { p_catalog: f.catalog, p_query: input.value, p_group: st.group || null, p_limit: 20 });
    if (seq !== input._seq || !document.contains(input)) return;
    if (error) { list.innerHTML = `<div class="combo-empty">${esc(errMsg(error))}</div>`; return; }
    input._results = data || [];
    input._hi = 0;
    list.innerHTML = input._results.length
      ? input._results.map((r, j) => `<button type="button" class="combo-opt ${j === 0 ? 'hi' : ''}" data-act="combo-pick" data-j="${j}"><span>${markText(r.label, input.value)}</span>${r.group_value && !st.group ? `<small>${esc(r.group_value)}</small>` : ''}</button>`).join('') +
        (input._results.length >= 20 ? '<div class="combo-empty">Mostrando os 20 primeiros. Digite mais para refinar.</div>' : '')
      : `<div class="combo-empty">Nenhum resultado${st.group ? ` em ${esc(st.group)}` : ''}. Tente outra palavra${st.group ? ' ou mude o filtro' : ''}.</div>`;
  }
  function pickCatalogItem(input, r) {
    const key = input.dataset.key;
    const f = S.tplForm.tpl.fields.find((x) => x.key === key);
    const st = S.tplForm.cat[key];
    const item = { key: r.key, label: r.label, group: r.group_value };
    if (f.type === 'catalog') { st.value = item; return rerenderCatField(key); }
    const i = Number(input.dataset.i);
    const own = st.value[i].cols || {}, prev = i > 0 ? st.value[i - 1].cols || {} : {};
    const cols = Object.values(own).some(Boolean) ? own : { ...prev };
    if (!(f.columns || []).length && st.value.some((x, k) => k !== i && x.key === r.key)) toast('Este item já está na lista. As quantidades serão somadas ao salvar.');
    st.value[i] = { ...item, qty: st.value[i].qty || 1, cols };
    if (i === st.value.length - 1) st.value.push({ key: '', qty: 1, cols: {} });
    rerenderCatField(key, i);
  }
  function moveComboHighlight(input, d) {
    const opts = $$('.combo-opt', input.nextElementSibling);
    if (!opts.length) return;
    input._hi = Math.max(0, Math.min(opts.length - 1, (input._hi || 0) + d));
    opts.forEach((o, j) => o.classList.toggle('hi', j === input._hi));
    opts[input._hi].scrollIntoView({ block: 'nearest' });
  }
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.classList && el.classList.contains('combo-input')) {
      clearTimeout(el._t);
      el._t = setTimeout(() => runComboSearch(el), 220);
    }
    if (el.classList && el.classList.contains('qty') && S.tplForm) {
      const st = S.tplForm.cat[el.dataset.key];
      if (st && st.value[Number(el.dataset.i)]) st.value[Number(el.dataset.i)].qty = el.value;
      const box = el.closest('.cat-field');
      const filled = st.value.filter((r) => r.key);
      const sum = $('.items-summary', box);
      if (sum) sum.textContent = `${filled.length} item(ns) · ${filled.reduce((n, r) => n + (parseInt(r.qty, 10) || 0), 0)} unidade(s)`;
    }
  });
  document.addEventListener('focusin', (ev) => {
    const el = ev.target;
    if (el.classList && el.classList.contains('combo-input') && !el.value) runComboSearch(el);
  });
  document.addEventListener('focusout', (ev) => {
    const el = ev.target;
    if (el.classList && el.classList.contains('combo-input')) setTimeout(() => { if (document.activeElement !== el && el.nextElementSibling) el.nextElementSibling.classList.add('hidden'); }, 180);
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (!(el.classList && el.classList.contains('item-col')) || !S.tplForm) return;
    const row = S.tplForm.cat[el.dataset.key].value[Number(el.dataset.i)];
    if (row) { row.cols = row.cols || {}; row.cols[el.dataset.col] = el.value; }
    el.classList.toggle('missing', !el.value && row && !!row.key);
  });
  document.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (!(el.classList && el.classList.contains('cat-group')) || !S.tplForm) return;
    S.tplForm.cat[el.dataset.key].group = el.value;
    const box = el.closest('.cat-field');
    const input = $('.combo-input', box);
    if (input) { input.focus(); runComboSearch(input); }
  });
  function handleCatalogKeys(ev) {
    const el = ev.target;
    if (!el.classList) return false;
    if (el.classList.contains('combo-input')) {
      const list = el.nextElementSibling;
      const open = list && !list.classList.contains('hidden');
      if (ev.key === 'ArrowDown') { ev.preventDefault(); if (!open) runComboSearch(el); else moveComboHighlight(el, 1); return true; }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); moveComboHighlight(el, -1); return true; }
      if (ev.key === 'Enter') { ev.preventDefault(); if (open && el._results && el._results[el._hi || 0]) pickCatalogItem(el, el._results[el._hi || 0]); return true; }
      if (ev.key === 'Escape' && open) { ev.preventDefault(); ev.stopPropagation(); list.classList.add('hidden'); return true; }
    }
    if (el.classList.contains('qty') && ev.key === 'Enter') {
      ev.preventDefault();
      const box = el.closest('.cat-field');
      const next = $('.combo-input', box);
      if (next) next.focus();
      return true;
    }
    return false;
  }

  // ---------- Cadastros de referência (Administração) ----------
  function renderCatalogsAdmin() {
    const list = S.admin.catalogs;
    if (list === null) return `<section class="panel" style="margin-bottom:20px"><h2>${icon('board')} Cadastros de referência</h2><div class="notice">Para usar cadastros (Entidades, Materiais), execute o arquivo <b>atualizacao-05-cadastros.sql</b> no SQL Editor do Supabase.</div></section>`;
    return `
      <section class="panel" style="margin-bottom:20px">
        <h2>${icon('board')} Cadastros de referência
          <span class="spacer"></span>
          ${list.length ? `<button class="btn sm" data-act="cat-sync">${icon('restore', 14)} Sincronizar todos</button>` : ''}
          <button class="btn primary sm" data-act="cat-new">${icon('plus', 14)} Novo cadastro</button></h2>
        <p class="small muted" style="margin:0 0 8px;line-height:1.5">Listas lidas de planilhas publicadas no Google Planilhas e usadas nas perguntas de pesquisa dos templates. A atualização é automática a cada 12 horas, quando alguém usa o sistema; depois de editar a planilha, use <b>Sincronizar</b> para ver a mudança na hora.</p>
        ${list.length ? `<div class="table-wrap"><table class="table"><tbody>
          ${list.map((c) => `
            <tr>
              <td><div style="font-weight:600">${esc(c.name)}</div><div class="small muted">${c.active_count} itens ativos${c.group_column ? ` · filtro por ${esc(c.group_label || c.group_column)}` : ''}</div></td>
              <td>${c.last_sync_at
                ? `<span class="status ${c.last_sync_status === 'ok' ? 'active' : 'error'}">${c.last_sync_status === 'ok' ? 'Sincronizado' : 'Erro'}</span> <span class="small muted">${relTime(c.last_sync_at)}</span>
                   <div class="small ${c.last_sync_status === 'ok' ? 'muted' : ''}" style="margin-top:4px;line-height:1.4;${c.last_sync_status === 'ok' ? '' : 'color:var(--danger)'}">${esc(c.last_sync_message || '')}</div>`
                : '<span class="small muted">Ainda não sincronizado</span>'}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn sm" data-act="cat-sync" data-id="${esc(c.id)}">Sincronizar</button>
                <button class="btn sm" data-act="cat-edit" data-id="${esc(c.id)}">Editar</button>
                <button class="btn sm" data-act="cat-del" data-id="${esc(c.id)}">Excluir</button>
              </td>
            </tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">Nenhum cadastro configurado.</p>'}
      </section>`;
  }

  function renderCatEditor() {
    const c = S.catEdit;
    const opts = (sel) => (c.header || []).map((h) => `<option value="${esc(h)}" ${sel === h ? 'selected' : ''}>${esc(h)}</option>`).join('');
    const sampleLabels = (c.sample || []).slice(0, 4).map((r) => {
      const idx = (h) => (c.header || []).indexOf(h);
      const label = (c.label_columns || []).filter(Boolean).map((h) => (r[idx(h)] || '').trim()).filter(Boolean).join(' - ');
      const g = c.group_column ? (r[idx(c.group_column)] || '').trim() : '';
      return `<li>${esc(label || '(vazio)')}${g ? ` <span class="muted small">· ${esc(g)}</span>` : ''}</li>`;
    }).join('');
    openModal(`
      <div class="modal"><button class="icon-btn modal-close" data-act="cat-cancel">${icon('x')}</button>
      <div class="modal-body">
        <h3>${c.id ? 'Editar cadastro' : 'Novo cadastro de referência'}</h3>
        <form data-submit="cat-save">
          <label class="field"><span>Nome</span><input class="input" value="${esc(c.name)}" data-ce="name" maxlength="60" required placeholder="Ex.: Entidades"></label>
          <label class="field"><span>Link da planilha publicada (CSV)</span>
            <div class="row"><input class="input" value="${esc(c.source_url)}" data-ce="source_url" required placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&single=true&output=csv">
            <button class="btn" type="button" data-act="cat-preview">${c.loading ? 'Lendo...' : 'Ler colunas'}</button></div>
            <div class="small muted" style="margin-top:4px;line-height:1.5">No Google Planilhas: Arquivo &gt; Compartilhar &gt; Publicar na Web, escolha a aba e o formato CSV. A aba precisa abrir sem login.</div></label>
          ${c.header ? `
            <div class="notice ok">Planilha lida: ${c.total} linha(s) e ${c.header.length} coluna(s).</div>
            <label class="field"><span>Coluna com o identificador único (código)</span><select class="select" data-ce="key_column" data-cerender="1"><option value="">Escolha...</option>${opts(c.key_column)}</select>
              <div class="small muted" style="margin-top:4px">Não pode se repetir nem mudar com o tempo. É por ela que o sistema sabe o que foi incluído, alterado ou removido.</div></label>
            <div class="field"><span>Texto exibido na pesquisa (colunas unidas por " - ")</span>
              <div class="row wrap">${[0, 1, 2].map((k) => `<select class="select" style="flex:1 1 180px" data-ce="label_columns.${k}" data-cerender="1"><option value="">${k ? '(opcional)' : 'Escolha...'}</option>${opts((c.label_columns || [])[k])}</select>`).join('')}</div></div>
            <div class="row wrap" style="gap:12px;align-items:flex-start">
              <label class="field" style="flex:1 1 220px"><span>Coluna para o filtro encadeado (opcional)</span><select class="select" data-ce="group_column" data-cerender="1"><option value="">Sem filtro</option>${opts(c.group_column)}</select></label>
              <label class="field" style="flex:1 1 180px"><span>Nome do filtro na tela</span><input class="input" value="${esc(c.group_label || '')}" data-ce="group_label" maxlength="30" placeholder="Ex.: GRE"></label>
            </div>
            ${sampleLabels ? `<div class="field"><span>Prévia</span><ul class="small" style="margin:0;padding-left:18px;line-height:1.6">${sampleLabels}</ul></div>` : ''}`
          : c.id ? '<div class="notice">Clique em "Ler colunas" para revisar a configuração das colunas.</div>' : ''}
          <div class="row wrap" style="margin-top:8px">
            <button class="btn primary" type="submit" ${c.header ? '' : 'disabled'}>Salvar e sincronizar</button>
            <button class="btn" type="button" data-act="cat-cancel">Cancelar</button>
          </div>
        </form>
      </div></div>`, 'locked');
  }
  document.addEventListener('input', (ev) => { const el = ev.target; if (S.catEdit && el.dataset && el.dataset.ce && !el.dataset.cerender) setPath(S.catEdit, el.dataset.ce, el.value); });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (!S.catEdit || !el.dataset || !el.dataset.ce) return;
    if (el.dataset.ce.startsWith('label_columns.')) { S.catEdit.label_columns = S.catEdit.label_columns || []; }
    setPath(S.catEdit, el.dataset.ce, el.value);
    if (el.dataset.cerender) renderCatEditor();
  });
  async function catPreview() {
    const c = S.catEdit;
    if (!c.source_url) return toast('Cole o link da planilha publicada.', true);
    c.loading = true; renderCatEditor();
    try {
      const r = await invokeAdmin({ action: 'preview', url: c.source_url }, 'sync-catalogs');
      Object.assign(c, { header: r.header, sample: r.sample, total: r.total });
      if (c.key_column && !r.header.includes(c.key_column)) c.key_column = '';
      c.label_columns = (c.label_columns || []).map((h) => (r.header.includes(h) ? h : ''));
      if (c.group_column && !r.header.includes(c.group_column)) c.group_column = '';
    } finally { c.loading = false; if (S.catEdit) renderCatEditor(); }
  }
  async function catSync(id) {
    const r = await invokeAdmin(id ? { action: 'sync', catalog_id: id } : { action: 'sync' }, 'sync-catalogs');
    (r.results || []).forEach((x) => toast(`${x.name}: ${x.message}`, !x.ok, 9000));
    S.catGroups = {};
    await loadCatalogs();
  }

  // ---------- Construtor de templates (Administração) ----------
  function renderTemplatesAdmin() {
    const list = S.admin.templates;
    if (list === null) return `<section class="panel" style="margin-bottom:20px"><h2>${icon('form')} Templates de cartão</h2><div class="notice">Para usar templates, execute o arquivo <b>atualizacao-04-templates.sql</b> no SQL Editor do Supabase.</div></section>`;
    const bmap = Object.fromEntries((S.admin.boards || []).map((b) => [b.id, b.title]));
    return `
      <section class="panel" style="margin-bottom:20px">
        <h2>${icon('form')} Templates de cartão <span class="spacer"></span><button class="btn primary sm" data-act="tpl-new">${icon('plus', 14)} Novo template</button></h2>
        <p class="small muted" style="margin:0 0 8px;line-height:1.5">Formulários que os membros usam ao adicionar um cartão. Leitores também podem criar cartões por template.</p>
        ${list.length ? `<div class="table-wrap"><table class="table"><tbody>
          ${list.map((t) => `
            <tr>
              <td><div style="font-weight:600">${esc(t.name)}</div><div class="small muted">${t.fields.length} pergunta(s) · ${t.all_boards ? 'todos os quadros' : (t.boards || []).length ? esc((t.boards || []).map((b) => bmap[b]).filter(Boolean).join(', ')) : '<b style="color:var(--danger)">nenhum quadro</b>'}</div></td>
              <td style="width:110px"><label class="row small" style="cursor:pointer"><input type="checkbox" ${t.active ? 'checked' : ''} data-change="tpl-toggle" data-id="${t.id}"> Ativo</label></td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn sm" data-act="tpl-edit" data-id="${t.id}">Editar</button>
                <button class="btn sm" data-act="tpl-dup" data-id="${t.id}">Duplicar</button>
                <button class="btn sm" data-act="tpl-del" data-id="${t.id}">Excluir</button>
              </td>
            </tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">Nenhum template criado.</p>'}
      </section>`;
  }

  const blankField = () => ({ key: '', label: '', type: 'radio', required: true, help: '', allow_other: false, priority: false, options: [{ label: '' }, { label: '' }] });

  function renderTplEditor() {
    const t = S.tplEdit;
    const boards = (S.admin.boards || []).slice().sort((a, b) => (a.archived - b.archived) || a.title.localeCompare(b.title));
    const fieldHtml = t.fields.map((f, i) => {
      const choice = CHOICE(f.type);
      const prio = f.priority && (f.type === 'radio' || f.type === 'select');
      return `
        <div class="tpl-q">
          <div class="row wrap" style="gap:8px;align-items:flex-end">
            <span class="tpl-num">${i + 1}</span>
            <label class="field" style="flex:2 1 260px;margin:0"><span>Pergunta</span><input class="input" value="${esc(f.label)}" data-tf="fields.${i}.label" maxlength="120" placeholder="Ex.: Período de análise"></label>
            <label class="field" style="flex:1 1 200px;margin:0"><span>Tipo</span><select class="select" data-tf="fields.${i}.type" data-rerender="1">
              ${Object.entries(FIELD_TYPES).map(([k, v]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
            <div class="row" style="gap:2px">
              <button type="button" class="icon-btn" data-act="tpl-move" data-i="${i}" data-dir="-1" title="Subir" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
              <button type="button" class="icon-btn" data-act="tpl-move" data-i="${i}" data-dir="1" title="Descer" ${i === t.fields.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
              <button type="button" class="icon-btn" data-act="tpl-del-field" data-i="${i}" title="Remover pergunta">${icon('trash')}</button>
            </div>
          </div>
          <label class="field" style="margin:10px 0 8px"><span>Texto de ajuda (opcional)</span><input class="input" value="${esc(f.help || '')}" data-tf="fields.${i}.help" maxlength="200"></label>
          ${CATALOG_TYPES(f.type) ? (() => { const cat = (S.admin.catalogs || []).find((c) => c.id === f.catalog); return `
            <div class="row wrap" style="gap:12px;margin-bottom:8px;align-items:flex-end">
              <label class="field" style="flex:1 1 220px;margin:0"><span>Cadastro usado na pesquisa</span><select class="select" data-tf="fields.${i}.catalog" data-rerender="1">
                <option value="">Escolha...</option>${(S.admin.catalogs || []).map((c) => `<option value="${esc(c.id)}" ${f.catalog === c.id ? 'selected' : ''}>${esc(c.name)} (${c.active_count} itens)</option>`).join('')}</select></label>
              ${f.type === 'items' ? `<label class="field" style="flex:1 1 180px;margin:0"><span>Nome da coluna de quantidade</span><input class="input" value="${esc(f.qty_label || 'Quantidade')}" data-tf="fields.${i}.qty_label" maxlength="30"></label>` : ''}
            </div>
            ${!(S.admin.catalogs || []).length ? '<div class="notice">Nenhum cadastro de referência configurado. Crie um em "Cadastros de referência", nesta mesma tela.</div>' : ''}
            ${cat && cat.group_column ? `<label class="row small" style="cursor:pointer;margin-bottom:6px"><input type="checkbox" ${f.group_filter ? 'checked' : ''} data-tf="fields.${i}.group_filter" data-tf-type="bool"> Mostrar filtro por ${esc(cat.group_label || cat.group_column)} antes da pesquisa (filtro encadeado)</label>` : ''}
            ${f.type === 'items' ? `
              <div class="small" style="font-weight:600;color:var(--ink-2);margin:10px 0 4px">Colunas por item</div>
              <div class="small muted" style="margin-bottom:6px;line-height:1.5">Escolhas feitas em cada linha da lista (ex.: motivo, prioridade, ambiente). Escreva uma opção por linha.</div>
              ${(f.columns || []).map((c, j) => `
                <div class="tpl-col">
                  <div class="row wrap" style="gap:8px">
                    <input class="input" style="flex:1 1 200px" value="${esc(c.label)}" data-tf="fields.${i}.columns.${j}.label" maxlength="40" placeholder="Nome da coluna (ex.: Motivo)">
                    <label class="row small" style="cursor:pointer"><input type="checkbox" ${c.required !== false ? 'checked' : ''} data-tf="fields.${i}.columns.${j}.required" data-tf-type="bool"> Obrigatória</label>
                    <button type="button" class="icon-btn" data-act="tpl-move-col" data-i="${i}" data-j="${j}" data-dir="-1" title="Mover para a esquerda" ${j === 0 ? 'disabled' : ''}>${icon('up', 14)}</button>
                    <button type="button" class="icon-btn" data-act="tpl-move-col" data-i="${i}" data-j="${j}" data-dir="1" title="Mover para a direita" ${j === f.columns.length - 1 ? 'disabled' : ''}>${icon('down', 14)}</button>
                    <button type="button" class="icon-btn" data-act="tpl-del-col" data-i="${i}" data-j="${j}" title="Remover coluna">${icon('trash', 14)}</button>
                  </div>
                  <textarea class="textarea" rows="4" style="margin-top:6px;min-height:80px" data-tf="fields.${i}.columns.${j}.options_text" placeholder="Uma opção por linha">${esc(c.options_text ?? (c.options || []).join('\n'))}</textarea>
                </div>`).join('')}
              <button type="button" class="btn sm" data-act="tpl-add-col" data-i="${i}">${icon('plus', 14)} Adicionar coluna</button>` : ''}`; })() : ''}
          <div class="row wrap" style="gap:16px;margin-bottom:${choice ? 10 : 0}px">
            <label class="row small" style="cursor:pointer"><input type="checkbox" ${f.required ? 'checked' : ''} data-tf="fields.${i}.required" data-tf-type="bool"> Obrigatória</label>
            ${choice ? `<label class="row small" style="cursor:pointer"><input type="checkbox" ${f.allow_other ? 'checked' : ''} data-tf="fields.${i}.allow_other" data-tf-type="bool"> Incluir "Outros" com campo aberto</label>` : ''}
            ${f.type === 'radio' || f.type === 'select' ? `<label class="row small" style="cursor:pointer"><input type="checkbox" ${f.priority ? 'checked' : ''} data-tf="fields.${i}.priority" data-tf-type="bool" data-rerender="1"> Esta pergunta define a prioridade (prazo e etiqueta)</label>` : ''}
          </div>
          ${choice ? `
            <div class="small" style="font-weight:600;color:var(--ink-2);margin-bottom:6px">Opções</div>
            ${prio ? '<div class="small muted" style="margin-bottom:6px">Prazo em horas corridas a partir da criação do cartão (deixe vazio para "sem prazo"). A etiqueta é criada no quadro automaticamente.</div>' : ''}
            ${(f.options || []).map((o, j) => `
              <div class="row wrap tpl-opt">
                <input class="input" style="flex:2 1 200px" value="${esc(o.label)}" data-tf="fields.${i}.options.${j}.label" maxlength="120" placeholder="Opção ${j + 1}">
                ${f.type === 'checkbox' ? `<label class="row small" style="cursor:pointer" title="Ao marcar esta opção, as demais são desmarcadas (ex.: Todas)"><input type="checkbox" ${o.exclusive ? 'checked' : ''} data-tf="fields.${i}.options.${j}.exclusive" data-tf-type="bool"> Exclusiva</label>` : ''}
                ${prio ? `
                  <input class="input" type="number" min="0" step="1" style="width:110px" value="${o.due_hours ?? ''}" data-tf="fields.${i}.options.${j}.due_hours" data-tf-type="num" placeholder="Horas">
                  <input class="input" style="flex:1 1 160px" value="${esc(o.tag_name || '')}" data-tf="fields.${i}.options.${j}.tag_name" maxlength="40" placeholder="Etiqueta (opcional)">
                  <input type="color" value="${safeColor(o.tag_color, '#64748b')}" data-tf="fields.${i}.options.${j}.tag_color" title="Cor da etiqueta">` : ''}
                <span class="row" style="gap:0">
                  <button type="button" class="icon-btn" data-act="tpl-move-opt" data-i="${i}" data-j="${j}" data-dir="-1" title="Subir opção" ${j === 0 ? 'disabled' : ''}>${icon('up', 14)}</button>
                  <button type="button" class="icon-btn" data-act="tpl-move-opt" data-i="${i}" data-j="${j}" data-dir="1" title="Descer opção" ${j === f.options.length - 1 ? 'disabled' : ''}>${icon('down', 14)}</button>
                  <button type="button" class="icon-btn" data-act="tpl-del-opt" data-i="${i}" data-j="${j}" title="Remover opção">${icon('x', 14)}</button>
                </span>
              </div>`).join('')}
            <button type="button" class="btn sm" data-act="tpl-add-opt" data-i="${i}">${icon('plus', 14)} Adicionar opção</button>` : ''}
        </div>`;
    }).join('');
    const scroll = $('#modal-root .overlay') ? $('#modal-root .overlay').scrollTop : 0;
    openModal(`
      <div class="modal wide"><button class="icon-btn modal-close" data-act="tpl-cancel">${icon('x')}</button>
      <div class="modal-body">
        <h3>${t.id ? 'Editar template' : 'Novo template'}</h3>
        <form data-submit="tpl-save">
          <div class="row wrap" style="gap:12px;align-items:flex-start">
            <label class="field" style="flex:1 1 260px"><span>Nome do template</span><input class="input" value="${esc(t.name)}" data-tf="name" maxlength="80" required placeholder="Ex.: Solicitação de relatório"></label>
            <label class="field" style="flex:2 1 320px"><span>Descrição (aparece no topo do formulário)</span><input class="input" value="${esc(t.description)}" data-tf="description" maxlength="300"></label>
          </div>
          <div class="field"><span>Título sugerido do cartão</span>
            <div class="row wrap" style="gap:8px">
              <input class="input" style="flex:1 1 320px" value="${esc(t.title_pattern)}" data-tf="title_pattern" maxlength="200" placeholder="Ex.: Relatório: {assunto} | {periodo}">
              <select class="select" style="width:auto" data-change="tpl-insert-key"><option value="">Inserir resposta de...</option>
                ${t.fields.map((f, i) => `<option value="${i}">${esc(f.label || `Pergunta ${i + 1}`)}</option>`).join('')}</select>
            </div>
            <div class="small muted" style="margin-top:4px">Os trechos entre chaves são trocados pelas respostas. A pessoa pode ajustar o título antes de criar.</div>
          </div>
          <div class="field"><span>Disponível nos quadros</span>
            <label class="row" style="cursor:pointer;margin-bottom:6px"><input type="checkbox" ${t.all_boards ? 'checked' : ''} data-tf="all_boards" data-tf-type="bool" data-rerender="1"> Todos os quadros (inclusive os criados no futuro)</label>
            ${t.all_boards ? '' : `<div class="opt-grid">${boards.map((b) => `<label class="opt-check"><input type="checkbox" data-board-pick="${b.id}" ${(t.boards || []).includes(b.id) ? 'checked' : ''}> <span>${esc(b.title)}${b.archived ? ' (arquivado)' : ''}</span></label>`).join('')}</div>`}
          </div>
          <label class="row" style="cursor:pointer;margin-bottom:16px"><input type="checkbox" ${t.active ? 'checked' : ''} data-tf="active" data-tf-type="bool"> Ativo (aparece para os membros)</label>
          <h4 style="margin:8px 0 10px;font-size:15px">Perguntas</h4>
          ${fieldHtml || '<p class="empty">Nenhuma pergunta ainda.</p>'}
          <button type="button" class="btn" data-act="tpl-add-field" style="margin:4px 0 20px">${icon('plus', 14)} Adicionar pergunta</button>
          <div class="row wrap">
            <button class="btn primary" type="submit">Salvar template</button>
            <button class="btn" type="button" data-act="tpl-preview">${icon('eye', 14)} Pré-visualizar</button>
            <button class="btn" type="button" data-act="tpl-cancel">Cancelar</button>
          </div>
        </form>
      </div></div>`, 'locked');
    const ov = $('#modal-root .overlay');
    if (ov) ov.scrollTop = scroll;
  }

  function setPath(obj, path, val) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[/^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i]];
    const last = parts[parts.length - 1];
    if (val === undefined) delete o[last]; else o[last] = val;
  }
  function onTplEditInput(ev) {
    const el = ev.target;
    if (!S.tplEdit) return;
    if (el.dataset.boardPick && ev.type === 'change') {
      const set = new Set(S.tplEdit.boards || []);
      if (el.checked) set.add(el.dataset.boardPick); else set.delete(el.dataset.boardPick);
      S.tplEdit.boards = [...set];
      return;
    }
    if (!el.dataset.tf) return;
    const kind = el.dataset.tfType;
    let val = kind === 'bool' ? el.checked : el.value;
    if (kind === 'num') val = el.value === '' ? undefined : Math.max(0, Number(el.value));
    setPath(S.tplEdit, el.dataset.tf, val);
    if (el.dataset.rerender && ev.type === 'change') {
      S.tplEdit.fields.forEach((f) => {
        if (CHOICE(f.type) && !(f.options && f.options.length)) f.options = [{ label: '' }, { label: '' }];
        if (!(f.type === 'radio' || f.type === 'select')) f.priority = false;
      });
      const pr = S.tplEdit.fields.filter((f) => f.priority);
      if (pr.length > 1 && el.checked) pr.forEach((f, i) => { if (`fields.${S.tplEdit.fields.indexOf(f)}.priority` !== el.dataset.tf) f.priority = false; });
      renderTplEditor();
    }
  }
  document.addEventListener('input', onTplEditInput);
  document.addEventListener('change', onTplEditInput);

  function cleanTemplate(t) {
    ensureKeys(t);
    const fields = t.fields.map((f) => {
      const out = { key: f.key, label: f.label.trim(), type: f.type, required: !!f.required };
      if (f.help && f.help.trim()) out.help = f.help.trim();
      if (CATALOG_TYPES(f.type)) {
        out.catalog = f.catalog || '';
        out.group_filter = !!f.group_filter;
        if (f.type === 'items') {
          out.qty_label = (f.qty_label || '').trim() || 'Quantidade';
          const used = new Set();
          out.columns = (f.columns || []).filter((c) => (c.label || '').trim()).map((c) => {
            const key = c.key || slugKey(c.label, used); used.add(key);
            const options = (c.options_text != null ? String(c.options_text).split('\n') : (c.options || [])).map((o) => o.trim()).filter(Boolean);
            return { key, label: c.label.trim(), required: c.required !== false, options: [...new Set(options)] };
          });
        }
      }
      if (CHOICE(f.type)) {
        out.options = (f.options || []).filter((o) => o.label && o.label.trim()).map((o) => {
          const x = { label: o.label.trim() };
          if (f.type === 'checkbox' && o.exclusive) x.exclusive = true;
          if (f.priority) {
            if (o.due_hours !== undefined && o.due_hours !== '' && !isNaN(o.due_hours)) x.due_hours = Number(o.due_hours);
            if (o.tag_name && o.tag_name.trim()) { x.tag_name = o.tag_name.trim(); x.tag_color = safeColor(o.tag_color, '#64748b'); }
          }
          return x;
        });
        if (f.allow_other) out.allow_other = true;
        if (f.priority && (f.type === 'radio' || f.type === 'select')) out.priority = true;
      }
      return out;
    });
    return { name: t.name.trim(), description: (t.description || '').trim(), title_pattern: (t.title_pattern || '').trim(),
      fields, all_boards: !!t.all_boards, boards: t.all_boards ? [] : (t.boards || []), active: !!t.active };
  }
  function templateProblem(t) {
    if (!t.name) return 'Informe o nome do template.';
    if (!t.fields.length) return 'Adicione pelo menos uma pergunta.';
    for (const [i, f] of t.fields.entries()) {
      if (!f.label) return `A pergunta ${i + 1} está sem texto.`;
      if (CATALOG_TYPES(f.type) && !f.catalog) return `Escolha o cadastro usado na pergunta "${f.label}".`;
      for (const c of f.columns || []) if (!c.options.length) return `A coluna "${c.label}" da pergunta "${f.label}" precisa de pelo menos uma opção.`;
      if (CHOICE(f.type) && !f.options.length) return `A pergunta "${f.label}" precisa de pelo menos uma opção.`;
      if (CHOICE(f.type) && new Set(f.options.map((o) => o.label)).size !== f.options.length) return `A pergunta "${f.label}" tem opções repetidas.`;
    }
    if (!t.all_boards && !t.boards.length && t.active) return 'Escolha em quais quadros o template fica disponível (ou marque "Todos os quadros").';
    return null;
  }

  // ------------------------------------------------------------------------
  // Exportação CSV
  // ------------------------------------------------------------------------
  async function exportCsv() {
    const id = S.board.id;
    const cards = await q(sb.from('cards').select('*').eq('board_id', id).order('position'));
    const lmap = Object.fromEntries(S.lists.map((l) => [l.id, l]));
    const lord = Object.fromEntries(S.lists.map((l, i) => [l.id, i]));
    cards.sort((a, b) => (lord[a.list_id] - lord[b.list_id]) || (a.position - b.position));
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Lista', 'Cartão', 'Descrição', 'Etiquetas', 'Responsáveis', 'Início', 'Entrega', 'Situação', 'Checklist', 'Anexos', 'Template', 'Respostas da solicitação', 'Arquivado', 'Criado por', 'Criado em', 'Atualizado em'];
    const rows = cards.map((c) => {
      const s = S.stats[c.id] || {};
      const st = dueStatus(c);
      return [
        lmap[c.list_id] ? lmap[c.list_id].title : '',
        c.title, c.description,
        cardLabelIds(c.id).map((x) => (S.labels.find((l) => l.id === x) || {}).name).filter(Boolean).join(', '),
        cardAssigneeIds(c.id).map(userName).join(', '),
        c.start_date ? parseDateOnly(c.start_date).toLocaleDateString('pt-BR') : '',
        c.due_date ? new Date(c.due_date).toLocaleString('pt-BR') : '',
        c.completed ? 'Concluído' : st === 'overdue' ? 'Atrasado' : 'Em aberto',
        s.items_total ? `${s.items_done}/${s.items_total}` : '',
        s.attachments || '',
        c.template_name || '',
        formDataText(c),
        c.archived ? 'Sim' : 'Não',
        userName(c.created_by),
        new Date(c.created_at).toLocaleString('pt-BR'),
        new Date(c.updated_at).toLocaleString('pt-BR')
      ].map(cell).join(';');
    });
    const csv = '\ufeff' + [head.map(cell).join(';'), ...rows].join('\r\n');
    if (demoHook('onDownload', `${S.board.title}.csv`, csv)) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const d = new Date();
    a.download = `${S.board.title.replace(/[^\p{L}\p{N}]+/gu, '_')}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ------------------------------------------------------------------------
  // Ações (cliques)
  // ------------------------------------------------------------------------
  const afterCardChange = async () => { await refreshBoard(); if (S.cd) await reloadCard(); };

  const A = {
    // acesso
    'auth-mode': (el) => { S.authMode = el.dataset.mode; S.authMsg = null; renderAuth(); },
    recheck: async () => { await loadMe(); route(); },
    logout: async () => {
      closePopover(); closeModal(); cleanupBoard();
      S.session = null; S.me = null; S.profiles = {}; S.admin = null; S.authMsg = null;
      renderAuth();
      try { history.replaceState(null, '', location.pathname + location.search + '#/'); } catch (e) { /* ignora */ }
      await sb.auth.signOut();
    },
    'user-menu': (el) => openPopover(el, S.me.full_name, () => `
      <p class="small muted" style="text-align:center;margin:-6px 0 10px">${esc(S.me.email)}</p>
      <button class="opt" data-act="edit-profile">${icon('user')} Meu perfil</button>
      <button class="opt" data-act="change-password">${icon('key')} Alterar senha</button>
      <button class="opt" data-act="logout">${icon('logout')} Sair</button>`),
    'edit-profile': () => { closePopover(); openProfileModal(); },
    'change-password': () => { closePopover(); openPasswordModal(false); },

    // genéricos
    'close-modal': () => closeModal(),
    overlay: (el, ev) => { if (ev.target === el && el.dataset.kind === 'tplform') return closeTemplateForm(); if (ev.target === el && el.dataset.kind !== 'locked') { if (el.dataset.kind === 'card') closeCard(); else closeModal(); } },
    'pop-close': () => closePopover(),
    'pick-swatch': (el) => {
      const form = el.closest('form');
      $$('.swatch', form).forEach((s) => s.classList.toggle('sel', s === el));
      form.elements.color.value = el.dataset.color;
    },

    // início
    'new-board': () => openNewBoardModal(),
    'toggle-archived-boards': () => { S.showArchivedBoards = !S.showArchivedBoards; renderHome(); },
    'goto-card': (el) => go(`#/b/${el.dataset.board}/c/${el.dataset.id}`),

    // quadro
    zoom: (el) => {
      const dir = Number(el.dataset.dir);
      const cur = S.zoom;
      const next = dir > 0 ? ZOOM_STEPS.find((z) => z > cur + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.001);
      setZoom(next || cur);
    },
    'zoom-reset': () => setZoom(1),
    'zoom-fit': () => {
      const el = $('#lists');
      if (!el) return;
      const natural = el.scrollWidth / S.zoom;
      const fit = Math.floor((el.clientWidth / natural) * 100) / 100;
      setZoom(Math.max(ZOOM_STEPS[0], Math.min(1, fit)));
      if (fit < ZOOM_STEPS[0]) toast('O quadro tem listas demais para caber inteiro; ajustado ao menor zoom (50%).');
    },
    'toggle-filters': () => { S.showFilters = !S.showFilters; renderBoard(); },
    'clear-filters': () => { S.filters = { q: '', member: '', label: '', due: '', template: '' }; renderBoard(); },
    'add-card': (el) => {
      const tpls = canUseTemplates() ? boardTemplates() : [];
      if (!tpls.length) { S.addingCardTo = el.dataset.list; return renderBoard(); }
      if (!canEdit() && tpls.length === 1) return openTemplateForm(tpls[0], { mode: 'new', listId: el.dataset.list });
      openPopover(el, canEdit() ? 'Adicionar cartão' : 'Nova solicitação', () => `
        ${canEdit() ? `<button class="opt" data-act="add-card-plain" data-list="${el.dataset.list}">${icon('card')}<span style="flex:1"><b>Cartão padrão</b><div class="small muted">Só o título; o resto você preenche depois</div></span></button>
        <div class="small muted" style="margin:10px 8px 4px;font-weight:600">Usar um template</div>` : ''}
        ${tpls.map((t) => `<button class="opt" data-act="use-template" data-id="${t.id}" data-list="${el.dataset.list}">${icon('form')}<span style="flex:1"><b>${esc(t.name)}</b>${t.description ? `<div class="small muted">${esc(t.description)}</div>` : ''}</span></button>`).join('')}`);
    },
    'add-card-plain': (el) => { closePopover(); S.addingCardTo = el.dataset.list; renderBoard(); },
    'use-template': async (el) => { const t = (S.templates || []).find((x) => x.id === el.dataset.id); closePopover(); if (t) await openTemplateForm(t, { mode: 'new', listId: el.dataset.list }); },
    'close-tplform': () => closeTemplateForm(),
    'combo-pick': (el) => { const input = $('.combo-input', el.closest('.combo')); if (input && input._results) pickCatalogItem(input, input._results[Number(el.dataset.j)]); },
    'cat-clear': (el) => { S.tplForm.cat[el.dataset.key].value = null; rerenderCatField(el.dataset.key, 'combo'); },
    'item-add': (el) => {
      const st = S.tplForm.cat[el.dataset.key];
      if (!st.value.length || st.value[st.value.length - 1].key) st.value.push({ key: '', qty: 1, cols: {} });
      rerenderCatField(el.dataset.key); const box = $(`.cat-field[data-key="${el.dataset.key}"]`); const ins = $$('.combo-input', box); if (ins.length) ins[ins.length - 1].focus();
    },
    'item-del': (el) => {
      const st = S.tplForm.cat[el.dataset.key];
      st.value.splice(Number(el.dataset.i), 1);
      if (!st.value.length || st.value[st.value.length - 1].key) st.value.push({ key: '', qty: 1, cols: {} });
      rerenderCatField(el.dataset.key);
    },
    'edit-answers': () => {
      const t = (S.templates || []).find((x) => x.id === S.cd.card.template_id);
      if (t) return openTemplateForm(t, { mode: 'edit', card: S.cd.card });
    },
    'cat-new': () => { S.catEdit = { name: '', source_url: '', key_column: '', label_columns: [], group_column: '', group_label: '' }; renderCatEditor(); },
    'cat-edit': (el) => {
      const c = S.admin.catalogs.find((x) => x.id === el.dataset.id);
      S.catEdit = JSON.parse(JSON.stringify(c));
      renderCatEditor();
      return catPreview();
    },
    'cat-preview': () => catPreview(),
    'cat-cancel': () => { S.catEdit = null; closeModal(); },
    'cat-sync': async (el) => {
      el.disabled = true; const old = el.textContent; el.textContent = 'Sincronizando...';
      try { await catSync(el.dataset.id); } finally { await showAdmin(); }
      el.textContent = old;
    },
    'cat-del': async (el) => {
      const c = S.admin.catalogs.find((x) => x.id === el.dataset.id);
      const used = (S.admin.templates || []).filter((t) => t.fields.some((f) => f.catalog === c.id)).map((t) => t.name);
      if (!(await confirmDialog(`Excluir o cadastro <b>${esc(c.name)}</b>? Os cartões já criados mantêm as respostas.${used.length ? `<br><br><b>Atenção:</b> os templates ${esc(used.join(', '))} usam este cadastro e deixarão de funcionar até serem ajustados.` : ''}`, { confirmText: 'Excluir', danger: true }))) return;
      await q(sb.from('catalogs').delete().eq('id', c.id));
      toast('Cadastro excluído.');
      await showAdmin();
    },
    'tpl-new': () => { S.tplEdit = { name: '', description: '', title_pattern: '', fields: [blankField()], all_boards: false, boards: [], active: true }; renderTplEditor(); },
    'tpl-edit': (el) => { const t = S.admin.templates.find((x) => x.id === el.dataset.id); S.tplEdit = JSON.parse(JSON.stringify(t)); renderTplEditor(); },
    'tpl-dup': (el) => {
      const t = JSON.parse(JSON.stringify(S.admin.templates.find((x) => x.id === el.dataset.id)));
      delete t.id; t.name = t.name + ' (cópia)'; t.active = false;
      S.tplEdit = t; renderTplEditor();
    },
    'tpl-del': async (el) => {
      const t = S.admin.templates.find((x) => x.id === el.dataset.id);
      if (!(await confirmDialog(`Excluir o template <b>${esc(t.name)}</b>? Os cartões já criados com ele mantêm as respostas, mas não poderão mais ter as respostas editadas. Para apenas esconder, desmarque "Ativo".`, { confirmText: 'Excluir', danger: true }))) return;
      await q(sb.from('card_templates').delete().eq('id', t.id));
      toast('Template excluído.');
      await showAdmin();
    },
    'tpl-cancel': async () => {
      if (!(await confirmDialog('Sair sem salvar as alterações do template?', { confirmText: 'Sair sem salvar' }))) return;
      S.tplEdit = null; closeModal();
    },
    'tpl-add-field': () => { S.tplEdit.fields.push(blankField()); renderTplEditor(); const ov = $('#modal-root .overlay'); if (ov) ov.scrollTop = ov.scrollHeight; },
    'tpl-del-field': async (el) => {
      const f = S.tplEdit.fields[Number(el.dataset.i)];
      if (f.label && !(await confirmDialog(`Remover a pergunta <b>${esc(f.label)}</b>?`, { confirmText: 'Remover', danger: true }))) return;
      S.tplEdit.fields.splice(Number(el.dataset.i), 1); renderTplEditor();
    },
    'tpl-move': (el) => {
      const i = Number(el.dataset.i), j = i + Number(el.dataset.dir), F = S.tplEdit.fields;
      if (j < 0 || j >= F.length) return;
      [F[i], F[j]] = [F[j], F[i]]; renderTplEditor();
    },
    'tpl-add-col': (el) => { const f = S.tplEdit.fields[Number(el.dataset.i)]; f.columns = f.columns || []; f.columns.push({ label: '', required: true, options_text: '' }); renderTplEditor(); },
    'tpl-del-col': async (el) => {
      const f = S.tplEdit.fields[Number(el.dataset.i)]; const c = f.columns[Number(el.dataset.j)];
      if (c.label && !(await confirmDialog(`Remover a coluna <b>${esc(c.label)}</b>?`, { confirmText: 'Remover', danger: true }))) return;
      f.columns.splice(Number(el.dataset.j), 1); renderTplEditor();
    },
    'tpl-move-col': (el) => {
      const C = S.tplEdit.fields[Number(el.dataset.i)].columns; const j = Number(el.dataset.j), k = j + Number(el.dataset.dir);
      if (k < 0 || k >= C.length) return; [C[j], C[k]] = [C[k], C[j]]; renderTplEditor();
    },
    'tpl-add-opt': (el) => { S.tplEdit.fields[Number(el.dataset.i)].options.push({ label: '' }); renderTplEditor(); },
    'tpl-move-opt': (el) => {
      const O = S.tplEdit.fields[Number(el.dataset.i)].options;
      const j = Number(el.dataset.j), k = j + Number(el.dataset.dir);
      if (k < 0 || k >= O.length) return;
      [O[j], O[k]] = [O[k], O[j]];
      renderTplEditor();
    },
    'tpl-del-opt': (el) => { S.tplEdit.fields[Number(el.dataset.i)].options.splice(Number(el.dataset.j), 1); renderTplEditor(); },
    'tpl-preview': () => {
      const t = cleanTemplate(JSON.parse(JSON.stringify(S.tplEdit)));
      if (!t.fields.length) return toast('Adicione pelo menos uma pergunta.', true);
      if (S.admin && S.admin.catalogs) S.catalogs = S.admin.catalogs;
      return openTemplateForm(t, { mode: 'preview' });
    },
    'cancel-add-card': () => { S.addingCardTo = null; renderBoard(); },
    'add-list': () => { S.addingList = true; renderBoard(); },
    'cancel-add-list': () => { S.addingList = false; renderBoard(); },
    'rename-list': (el) => { S.renamingList = el.dataset.id; renderBoard(); },
    'list-menu': (el) => {
      const l = S.lists.find((x) => x.id === el.dataset.id);
      openPopover(el, l.title, () => `
        <button class="opt" data-act="add-card-from-menu" data-list="${l.id}">${icon('plus')} Adicionar cartão</button>
        <button class="opt" data-act="rename-list-menu" data-id="${l.id}">${icon('desc')} Renomear lista</button>
        <button class="opt" data-act="archive-list-cards" data-id="${l.id}">${icon('archive')} Arquivar todos os cartões desta lista</button>
        <button class="opt" data-act="archive-list" data-id="${l.id}">${icon('archive')} Arquivar esta lista</button>`);
    },
    'add-card-from-menu': (el) => { closePopover(); S.addingCardTo = el.dataset.list; renderBoard(); },
    'rename-list-menu': (el) => { closePopover(); S.renamingList = el.dataset.id; renderBoard(); },
    'archive-list': async (el) => {
      closePopover();
      await q(sb.from('lists').update({ archived: true }).eq('id', el.dataset.id));
      toast('Lista arquivada. Restaure em Menu > Itens arquivados.');
      await refreshBoard();
    },
    'archive-list-cards': async (el) => {
      closePopover();
      const n = S.cards.filter((c) => c.list_id === el.dataset.id).length;
      if (!n) return toast('A lista não tem cartões.');
      if (!(await confirmDialog(`Arquivar os <b>${n}</b> cartões desta lista?`, { confirmText: 'Arquivar' }))) return;
      await q(sb.from('cards').update({ archived: true }).eq('list_id', el.dataset.id).eq('archived', false));
      await refreshBoard();
    },
    drawer: (el) => openDrawer(el.dataset.view),
    'close-drawer': () => { S.drawer = null; renderBoard(); },
    'more-activity': async () => { S.drawerData.actLimit = (S.drawerData.actLimit || 60) + 100; await reloadDrawerData(); renderDrawer(); },
    'remove-member': async (el) => {
      const uid = el.dataset.user;
      const self = uid === S.me.id;
      if (!(await confirmDialog(self ? 'Sair deste quadro? Você perderá o acesso a ele.' : `Remover <b>${esc(userName(uid))}</b> deste quadro? Ele deixará de ser responsável pelos cartões.`, { confirmText: 'Remover', danger: true }))) return;
      if (self) {
        await q(sb.from('card_assignees').delete().eq('board_id', S.board.id).eq('user_id', uid));
        await q(sb.from('board_members').delete().eq('board_id', S.board.id).eq('user_id', uid));
      } else {
        await q(sb.from('board_members').delete().eq('board_id', S.board.id).eq('user_id', uid));
        await q(sb.from('card_assignees').delete().eq('board_id', S.board.id).eq('user_id', uid));
      }
      if (self && !S.me.is_admin) return go('#/');
      await refreshBoard();
    },
    'leave-board': async () => {
      if (!(await confirmDialog('Sair deste quadro? Você perderá o acesso a ele.', { confirmText: 'Sair', danger: true }))) return;
      await q(sb.from('board_members').delete().eq('board_id', S.board.id).eq('user_id', S.me.id));
      go('#/');
    },
    'delete-label': async (el) => {
      const l = S.labels.find((x) => x.id === el.dataset.id);
      if (!(await confirmDialog(`Excluir a etiqueta <b>${esc(l.name || 'sem nome')}</b>? Ela será removida de todos os cartões.`, { confirmText: 'Excluir', danger: true }))) return;
      await q(sb.from('labels').delete().eq('id', l.id));
      await refreshBoard();
    },
    'restore-card': async (el) => {
      const c = S.cd && S.cd.card.id === el.dataset.id ? S.cd.card : null;
      const lst = c && S.lists.find((l) => l.id === c.list_id);
      if (lst && lst.archived) return toast('A lista deste cartão está arquivada. Restaure a lista primeiro ou mova o cartão.', true);
      await q(sb.from('cards').update({ archived: false }).eq('id', el.dataset.id));
      toast('Cartão restaurado.');
      await afterCardChange();
    },
    'delete-card': async (el) => {
      if (!(await confirmDialog('Excluir este cartão definitivamente? Comentários, checklists e anexos serão apagados. O registro no histórico do quadro é mantido.', { confirmText: 'Excluir', danger: true }))) return;
      await removeStoredFiles(await attachmentPaths({ card_id: el.dataset.id }));
      await q(sb.from('cards').delete().eq('id', el.dataset.id));
      toast('Cartão excluído.');
      if (S.cd && S.cd.card.id === el.dataset.id) closeCard();
      await refreshBoard();
    },
    'restore-list': async (el) => { await q(sb.from('lists').update({ archived: false }).eq('id', el.dataset.id)); await refreshBoard(); },
    'delete-list': async (el) => {
      const l = S.lists.find((x) => x.id === el.dataset.id);
      if (!(await confirmDialog(`Excluir definitivamente a lista <b>${esc(l.title)}</b> e todos os cartões e anexos dela?`, { confirmText: 'Excluir', danger: true }))) return;
      const ids = (await q(sb.from('cards').select('id').eq('list_id', l.id))).map((c) => c.id);
      for (let i = 0; i < ids.length; i += 100) await removeStoredFiles(await attachmentPaths({ card_id: ids.slice(i, i + 100) }));
      await q(sb.from('lists').delete().eq('id', l.id));
      await refreshBoard();
    },
    'archive-board': async () => {
      const arch = !S.board.archived;
      if (arch && !(await confirmDialog('Arquivar este quadro? Ele sai da lista principal, mas pode ser restaurado.', { confirmText: 'Arquivar' }))) return;
      await q(sb.from('boards').update({ archived: arch }).eq('id', S.board.id));
      toast(arch ? 'Quadro arquivado.' : 'Quadro restaurado.');
      await refreshBoard();
    },
    'delete-board': async () => {
      if (!(await confirmDialog('Esta ação apaga o quadro, as listas, os cartões, os comentários e os anexos. Não pode ser desfeita.', { confirmText: 'Excluir quadro', danger: true, requireText: S.board.title }))) return;
      await removeStoredFiles(await attachmentPaths({ board_id: S.board.id }));
      await q(sb.from('boards').delete().eq('id', S.board.id));
      toast('Quadro excluído.');
      cleanupBoard();
      go('#/');
    },
    'export-csv': () => exportCsv(),

    // cartão
    'open-card': (el, ev) => { if (ev.target.closest('a')) return; go(`#/b/${S.board.id}/c/${el.dataset.id}`); },
    'close-card': () => closeCard(),
    'pick-files': () => { const i = $('#att-input'); if (i) i.click(); },
    'open-att': async (el) => {
      const a = S.cd.attachments.find((x) => x.id === el.dataset.id);
      if (!a) return;
      if (!isPreviewable(a)) return A['download-att'](el);
      if (CFG.onOpenFile) { const r = await bucket().createSignedUrl(a.storage_path, 300); if (r.error) throw r.error; return demoHook('onOpenFile', a, r.data.signedUrl); }
      const w = window.open('', '_blank');
      const { data, error } = await bucket().createSignedUrl(a.storage_path, 300);
      if (error) { if (w) w.close(); throw error; }
      if (w) w.location.href = data.signedUrl; else location.href = data.signedUrl;
    },
    'download-att': async (el) => {
      const a = S.cd.attachments.find((x) => x.id === el.dataset.id);
      if (!a) return;
      const { data, error } = await bucket().createSignedUrl(a.storage_path, 300, { download: a.file_name });
      if (error) throw error;
      if (demoHook('onOpenFile', a, data.signedUrl, true)) return;
      const link = document.createElement('a');
      link.href = data.signedUrl; link.rel = 'noopener';
      document.body.appendChild(link); link.click(); link.remove();
    },
    'delete-att': async (el) => {
      const a = S.cd.attachments.find((x) => x.id === el.dataset.id);
      if (!a) return;
      if (!(await confirmDialog(`Excluir o anexo <b>${esc(a.file_name)}</b>? O arquivo será apagado definitivamente.`, { confirmText: 'Excluir', danger: true }))) return;
      await q(sb.from('attachments').delete().eq('id', a.id));
      try { await removeStoredFiles([a.storage_path]); } catch (e) { console.warn(e); }
      toast('Anexo excluído.');
      await afterCardChange();
    },
    'edit-desc': (el, ev) => { if (ev.target.closest('a')) return; S.cd.editingDesc = true; renderCardModal(); },
    'cancel-desc': () => { S.cd.editingDesc = false; renderCardModal(); },
    'toggle-details': () => { S.cd.showDetails = !S.cd.showDetails; renderCardModal(); },
    'edit-comment': (el) => { S.cd.editingComment = el.dataset.id; renderCardModal(); },
    'cancel-comment': () => { S.cd.editingComment = null; renderCardModal(); },
    'delete-comment': async (el) => {
      if (!(await confirmDialog('Excluir este comentário?', { confirmText: 'Excluir', danger: true }))) return;
      await q(sb.from('comments').delete().eq('id', el.dataset.id));
      await afterCardChange();
    },
    'pop-members': (el) => openPopover(el, 'Responsáveis', popMembers),
    'pop-labels': (el) => openPopover(el, 'Etiquetas', popLabels),
    'pop-checklist': (el) => openPopover(el, 'Adicionar checklist', popChecklist),
    'pop-dates': (el) => openPopover(el, 'Datas', popDates),
    'pop-move': (el) => openPopover(el, 'Mover cartão', popMove),
    'manage-labels': () => { closePopover(); go(`#/b/${S.board.id}`); openDrawer('labels'); },
    'toggle-assignee': async (el) => {
      const cid = S.cd.card.id, uid = el.dataset.user;
      const has = cardAssigneeIds(cid).includes(uid);
      if (has) {
        S.assignees = S.assignees.filter((a) => !(a.card_id === cid && a.user_id === uid));
        renderPopover();
        await q(sb.from('card_assignees').delete().eq('card_id', cid).eq('user_id', uid));
      } else {
        S.assignees.push({ card_id: cid, user_id: uid });
        renderPopover();
        await q(sb.from('card_assignees').insert({ card_id: cid, user_id: uid }));
      }
      renderCardModal(); renderBoardKeepDrawer();
    },
    'toggle-label': async (el) => {
      const cid = S.cd.card.id, lid = el.dataset.id;
      const has = cardLabelIds(cid).includes(lid);
      if (has) {
        S.cardLabels = S.cardLabels.filter((a) => !(a.card_id === cid && a.label_id === lid));
        renderPopover();
        await q(sb.from('card_labels').delete().eq('card_id', cid).eq('label_id', lid));
      } else {
        S.cardLabels.push({ card_id: cid, label_id: lid });
        renderPopover();
        await q(sb.from('card_labels').insert({ card_id: cid, label_id: lid }));
      }
      renderCardModal(); renderBoardKeepDrawer();
    },
    'clear-dates': async () => {
      closePopover();
      await q(sb.from('cards').update({ start_date: null, due_date: null }).eq('id', S.cd.card.id));
      await afterCardChange();
    },
    'archive-card': async () => {
      await q(sb.from('cards').update({ archived: true }).eq('id', S.cd.card.id));
      toast('Cartão arquivado.');
      await afterCardChange();
    },
    'copy-link': async () => {
      try { await navigator.clipboard.writeText(location.href); toast('Link copiado.'); }
      catch (e) { toast('Não foi possível copiar. Copie o endereço da barra do navegador.', true); }
    },
    'rename-checklist': (el) => { S.cd.renamingChecklist = el.dataset.id; renderCardModal(); },
    'delete-checklist': async (el) => {
      if (!(await confirmDialog('Excluir esta checklist e todos os itens?', { confirmText: 'Excluir', danger: true }))) return;
      await q(sb.from('checklists').delete().eq('id', el.dataset.id));
      await afterCardChange();
    },
    'add-item': (el) => { S.cd.addingItemTo = el.dataset.id; renderCardModal(); },
    'cancel-item': () => { S.cd.addingItemTo = null; renderCardModal(); },
    'edit-item': (el, ev) => { if (ev.target.closest('a')) return; S.cd.editingItem = el.dataset.id; renderCardModal(); },
    'delete-item': async (el) => {
      S.cd.items = S.cd.items.filter((i) => i.id !== el.dataset.id);
      renderCardModal();
      await q(sb.from('checklist_items').delete().eq('id', el.dataset.id));
      await afterCardChange();
    },

    // administração
    'cancel-import': () => { S.imp = null; renderAdmin(); },
    'new-user': () => openNewUserModal(),
    'reset-password': async (el) => {
      const u = S.profiles[el.dataset.id];
      if (!(await confirmDialog(`Gerar uma senha provisória nova para <b>${esc(u.full_name)}</b>? A senha atual deixa de funcionar e a pessoa terá de criar outra no próximo acesso.`, { confirmText: 'Redefinir senha' }))) return;
      const r = await invokeAdmin({ action: 'reset_password', user_id: u.id });
      openPasswordResult({ ...r, reset: true });
    },
    'copy-text': async (el) => {
      const r = S.lastAccess;
      if (!r) return;
      const text = el.dataset.what === 'password' ? r.password : accessMessage(r);
      try { await navigator.clipboard.writeText(text); toast(el.dataset.what === 'password' ? 'Senha copiada.' : 'Mensagem copiada.'); }
      catch (e) { toast('Não foi possível copiar automaticamente. Selecione e copie manualmente.', true); }
    },
    'close-access': async () => {
      if (!(await confirmDialog('Você já copiou a senha provisória? Ela não poderá ser vista de novo.', { confirmText: 'Sim, já copiei' }))) return;
      S.lastAccess = null;
      closeModal();
      await showAdmin();
    },
    'cancel-prereg': async (el) => {
      const r = S.admin.prereg.find((x) => x.id === el.dataset.id);
      if (!(await confirmDialog(`Cancelar o pré-cadastro de <b>${esc(r.full_name)}</b> (${esc(r.email)})?`, { confirmText: 'Cancelar pré-cadastro', danger: true }))) return;
      await q(sb.from('pre_registrations').delete().eq('id', r.id));
      toast('Pré-cadastro cancelado.');
      await showAdmin();
    },
    'more-audit': async () => { S.admin.auditLimit += 50; await showAdmin(); },
    'user-status': async (el) => {
      const st = el.dataset.status;
      const u = S.profiles[el.dataset.id];
      if (st === 'inactive' && !(await confirmDialog(`${u.status === 'pending' ? 'Recusar o cadastro de' : 'Desativar o acesso de'} <b>${esc(u.full_name)}</b>?`, { confirmText: 'Confirmar', danger: true }))) return;
      await q(sb.from('profiles').update({ status: st }).eq('id', u.id));
      toast(st === 'active' ? 'Acesso liberado.' : 'Acesso bloqueado.');
      await showAdmin();
    }
  };

  function renderBoardKeepDrawer() { if (S.board) { const sc = $('#lists') ? $('#lists').scrollLeft : 0; renderBoard(); if ($('#lists')) $('#lists').scrollLeft = sc; } }

  // ------------------------------------------------------------------------
  // Formulários
  // ------------------------------------------------------------------------
  const F = {
    login: async (f) => {
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      try {
        S.authEmail = f.email.value.trim();
        const { error } = await sb.auth.signInWithPassword({ email: S.authEmail, password: f.password.value });
        if (error) throw error;
        S.authMsg = null;
      } catch (e) { S.authMsg = { type: 'err', text: errMsg(e) }; renderAuth(); }
      finally { btn.disabled = false; }
    },
    signup: async (f) => {
      const email = f.email.value.trim().toLowerCase();
      if (f.password.value !== f.password2.value) { S.authMsg = { type: 'err', text: 'As senhas não conferem.' }; return renderAuth(); }
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const allowed = await sb.rpc('signup_allowed', { p_email: email });
        if (!allowed.error) {
          if (allowed.data === false) {
            const dom = await q(sb.rpc('signup_domain'));
            throw new Error(`Use seu e-mail institucional${dom ? ` (@${dom})` : ''}. Se você usa outro e-mail, peça ao administrador um pré-cadastro.`);
          }
        } else {
          const dom = await q(sb.rpc('signup_domain'));
          if (dom && email.split('@')[1] !== dom.toLowerCase()) throw new Error(`Use seu e-mail institucional (@${dom}).`);
        }
        const { data, error } = await sb.auth.signUp({
          email, password: f.password.value,
          options: { data: { full_name: f.full_name.value.trim() }, emailRedirectTo: location.origin + location.pathname }
        });
        if (error) throw error;
        if (!data.session) {
          S.authMode = 'login';
          S.authMsg = { type: 'ok', text: 'Conta criada. Enviamos um link de confirmação para o seu e-mail. Depois de confirmar, entre aqui e aguarde a aprovação do administrador.' };
          renderAuth();
        }
      } catch (e) { S.authMsg = { type: 'err', text: errMsg(e) }; renderAuth(); }
      finally { btn.disabled = false; }
    },
    forgot: async (f) => {
      try {
        const { error } = await sb.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: location.origin + location.pathname });
        if (error) throw error;
        S.authMode = 'login';
        S.authMsg = { type: 'ok', text: 'Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.' };
      } catch (e) { S.authMsg = { type: 'err', text: errMsg(e) }; }
      renderAuth();
    },
    password: async (f) => {
      if (f.password.value !== f.password2.value) return toast('As senhas não conferem.', true);
      const { error } = await sb.auth.updateUser({ password: f.password.value });
      if (error) throw error;
      toast('Senha alterada com sucesso.');
      S.recovery = false;
      closeModal();
      if (location.hash.includes('access_token') || location.hash.includes('type=recovery')) location.hash = '#/';
      if (!S.me) await loadMe();
      route();
    },
    profile: async (f) => {
      await q(sb.from('profiles').update({ full_name: f.full_name.value.trim(), color: f.color.value }).eq('id', S.me.id));
      await loadMe();
      closeModal();
      toast('Perfil atualizado.');
      route();
    },
    'create-board': async (f) => {
      const row = await q(sb.from('boards').insert({ title: f.title.value.trim(), description: f.description.value.trim(), color: f.color.value, created_by: S.me.id }).select().single());
      closeModal();
      go(`#/b/${row.id}`);
    },
    'add-card': async (f) => {
      const title = f.title.value.trim();
      if (!title) return;
      const listId = f.dataset.list;
      f.title.value = '';
      await q(sb.from('cards').insert({ list_id: listId, board_id: S.board.id, title, position: nextCardPos(listId) }));
      S.addingCardTo = listId;
      await refreshBoard();
      const cardsEl = $(`[data-list-cards="${listId}"]`);
      if (cardsEl) cardsEl.scrollTop = cardsEl.scrollHeight;
    },
    'add-list': async (f) => {
      const pos = Math.max(0, ...S.lists.map((l) => l.position)) + 1000;
      await q(sb.from('lists').insert({ board_id: S.board.id, title: f.title.value.trim(), position: pos }));
      S.addingList = true;
      await refreshBoard();
      const el = $('#lists'); if (el) el.scrollLeft = el.scrollWidth;
    },
    'rename-list': async (f) => {
      const id = f.dataset.id, title = f.title.value.trim();
      S.renamingList = null;
      const l = S.lists.find((x) => x.id === id);
      if (title && l && title !== l.title) { l.title = title; renderBoard(); await q(sb.from('lists').update({ title }).eq('id', id)); }
      else renderBoard();
    },
    'board-settings': async (f) => {
      await q(sb.from('boards').update({ title: f.title.value.trim(), description: f.description.value.trim(), color: f.color.value }).eq('id', S.board.id));
      toast('Quadro atualizado.');
      await refreshBoard();
    },
    'add-member': async (f) => {
      if (!f.user.value) return;
      await q(sb.from('board_members').insert({ board_id: S.board.id, user_id: f.user.value, role: f.role.value }));
      toast('Membro adicionado.');
      await refreshBoard();
    },
    'add-label': async (f) => {
      await q(sb.from('labels').insert({ board_id: S.board.id, name: f.name.value.trim(), color: f.color.value }));
      await refreshBoard();
    },
    'save-desc': async (f) => {
      S.cd.editingDesc = false;
      await q(sb.from('cards').update({ description: f.description.value }).eq('id', S.cd.card.id));
      await afterCardChange();
    },
    'add-checklist': async (f) => {
      closePopover();
      const pos = Math.max(0, ...S.cd.checklists.map((c) => c.position)) + 1000;
      const row = await q(sb.from('checklists').insert({ card_id: S.cd.card.id, title: f.title.value.trim() || 'Checklist', position: pos }).select().single());
      S.cd.addingItemTo = row.id;
      await afterCardChange();
    },
    'rename-checklist': async (f) => {
      const id = f.dataset.id, title = f.title.value.trim();
      S.cd.renamingChecklist = null;
      const cl = S.cd.checklists.find((x) => x.id === id);
      if (title && cl && title !== cl.title) { cl.title = title; renderCardModal(); await q(sb.from('checklists').update({ title }).eq('id', id)); }
      else renderCardModal();
    },
    'add-item': async (f) => {
      const text = f.text.value.trim();
      if (!text) return;
      const clId = f.dataset.id;
      const pos = Math.max(0, ...S.cd.items.filter((i) => i.checklist_id === clId).map((i) => i.position)) + 1000;
      f.text.value = '';
      await q(sb.from('checklist_items').insert({ checklist_id: clId, text, position: pos }));
      S.cd.addingItemTo = clId;
      await afterCardChange();
    },
    'edit-item': async (f) => {
      const id = f.dataset.id, text = f.text.value.trim();
      S.cd.editingItem = null;
      const it = S.cd.items.find((x) => x.id === id);
      if (text && it && text !== it.text) { it.text = text; renderCardModal(); await q(sb.from('checklist_items').update({ text }).eq('id', id)); await afterCardChange(); }
      else renderCardModal();
    },
    'add-comment': async (f) => {
      const body = f.body.value.trim();
      if (!body) return;
      f.body.value = '';
      await q(sb.from('comments').insert({ card_id: S.cd.card.id, body, user_id: S.me.id }));
      await afterCardChange();
    },
    'edit-comment': async (f) => {
      const body = f.body.value.trim();
      if (!body) return;
      S.cd.editingComment = null;
      await q(sb.from('comments').update({ body }).eq('id', f.dataset.id));
      await afterCardChange();
    },
    'save-dates': async (f) => {
      const start = f.start.value || null;
      const due = f.due.value ? new Date(`${f.due.value}T${f.time.value || '17:00'}`).toISOString() : null;
      closePopover();
      await q(sb.from('cards').update({ start_date: start, due_date: due }).eq('id', S.cd.card.id));
      await afterCardChange();
    },
    'move-card': async (f) => {
      const listId = f.list.value;
      const inList = S.cards.filter((c) => c.list_id === listId && c.id !== S.cd.card.id);
      const position = f.where.value === 'start'
        ? (inList.length ? Math.min(...inList.map((c) => c.position)) / 2 : 1000)
        : Math.max(0, ...inList.map((c) => c.position)) + 1000;
      closePopover();
      await q(sb.from('cards').update({ list_id: listId, position }).eq('id', S.cd.card.id));
      await afterCardChange();
    },
    'import-trello': async (f) => {
      const imp = S.imp;
      const map = {};
      imp.members.forEach((m) => { const v = f.elements['map_' + m.id] && f.elements['map_' + m.id].value; if (v) map[m.id] = v; });
      const payload = buildTrelloPayload(imp.data, {
        title: f.title.value.trim(), includeArchived: f.archived.checked, includeComments: f.comments.checked, map
      });
      if (!payload.cards.length && !payload.lists.length) return toast('Nada para importar neste arquivo.', true);
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true; btn.textContent = 'Importando...';
      try {
        const boardId = await q(sb.rpc('import_board', { payload }));
        S.imp = null;
        toast(`Quadro importado: ${payload.cards.length} cartões.`);
        go(`#/b/${boardId}`);
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Importar quadro';
        if (/import_board/.test(e.message || '') && /function|schema cache/i.test(e.message || '')) {
          throw new Error('A função de importação ainda não existe no banco. Execute o arquivo atualizacao-01-importar-trello.sql no SQL Editor do Supabase.');
        }
        throw e;
      }
    },
    'new-user': async (f) => {
      const full_name = f.full_name.value.trim();
      const email = f.email.value.trim().toLowerCase();
      const boards = (S.admin.boards || []).map((b) => ({ board_id: b.id, role: f.elements['board_' + b.id] ? f.elements['board_' + b.id].value : '' })).filter((b) => b.role);
      const is_admin = f.is_admin.checked;
      const mode = f.mode.value;
      if (Object.values(S.profiles).some((p) => p.email.toLowerCase() === email)) throw new Error('Já existe uma conta com este e-mail.');
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true; btn.textContent = 'Cadastrando...';
      try {
        if (mode === 'temp') {
          const r = await invokeAdmin({ action: 'create', full_name, email, is_admin, boards });
          openPasswordResult(r);
        } else {
          await sb.from('pre_registrations').delete().eq('email', email).is('used_at', null);
          await q(sb.from('pre_registrations').insert({ email, full_name, is_admin, boards }));
          closeModal();
          toast(`Pré-cadastro feito. Peça para ${full_name.split(' ')[0]} acessar o site, clicar em "Criar conta" e usar o e-mail ${email}.`, false, 9000);
          await showAdmin();
        }
      } finally { btn.disabled = false; btn.textContent = 'Cadastrar'; }
    },
    'force-password': async (f) => {
      if (f.password.value !== f.password2.value) return toast('As senhas não conferem.', true);
      const { error } = await sb.auth.updateUser({ password: f.password.value });
      if (error) throw error;
      await q(sb.rpc('password_changed'));
      await loadMe();
      toast('Senha criada. Bem-vindo(a)!');
      route();
    },
    'tpl-form': async (f) => {
      const tf = S.tplForm;
      if (!tf || tf.mode === 'preview') return;
      const a = collectAnswers(f, tf.tpl);
      const problem = validateAnswers(tf.tpl, a);
      if (problem) return toast(problem, true);
      if (tf.mode === 'edit') {
        await q(sb.rpc('update_card_answers', { p_card: tf.card.id, p_answers: a }));
        S.tplForm = null;
        toast('Respostas atualizadas.');
        return afterCardChange();
      }
      const title = f.__title.value.trim();
      if (!title) return toast('Informe o título do cartão.', true);
      const cardId = await q(sb.rpc('create_card_from_template', { p_list: f.__list.value, p_template: tf.tpl.id, p_title: title, p_answers: a }));
      S.tplForm = null;
      closeModal();
      toast('Cartão criado.');
      await refreshBoard();
      if (cardId) go(`#/b/${S.board.id}/c/${cardId}`);
    },
    'cat-save': async () => {
      const c = S.catEdit;
      const label_columns = (c.label_columns || []).filter(Boolean);
      if (!c.name.trim() || !c.source_url.trim()) return toast('Informe o nome e o link da planilha.', true);
      if (!c.key_column) return toast('Escolha a coluna com o identificador único.', true);
      if (!label_columns.length) return toast('Escolha pelo menos uma coluna para o texto exibido.', true);
      const row = { name: c.name.trim(), source_url: c.source_url.trim(), key_column: c.key_column, label_columns,
        group_column: c.group_column || null, group_label: c.group_column ? (c.group_label || '').trim() || c.group_column : null };
      let id = c.id;
      if (id) await q(sb.from('catalogs').update(row).eq('id', id));
      else {
        id = slugKey(c.name, new Set((S.admin.catalogs || []).map((x) => x.id))).slice(0, 40);
        if (id.length < 2) id = 'cadastro_' + id;
        await q(sb.from('catalogs').insert({ id, ...row }));
      }
      S.catEdit = null;
      closeModal();
      toast('Cadastro salvo. Sincronizando...');
      try { await catSync(id); } finally { await showAdmin(); }
    },
    'tpl-save': async () => {
      const t = cleanTemplate(JSON.parse(JSON.stringify(S.tplEdit)));
      const problem = templateProblem(t);
      if (problem) return toast(problem, true);
      if (S.tplEdit.id) await q(sb.from('card_templates').update(t).eq('id', S.tplEdit.id));
      else await q(sb.from('card_templates').insert(t));
      S.tplEdit = null;
      closeModal();
      toast('Template salvo.');
      await showAdmin();
    },
    'admin-config': async (f) => {
      const dom = f.allowed_domain.value.trim().replace(/^@/, '').toLowerCase() || null;
      await q(sb.from('app_config').update({ allowed_domain: dom, require_approval: f.require_approval.checked, updated_at: new Date().toISOString() }).eq('id', 1));
      toast('Regras salvas.');
      await showAdmin();
    }
  };

  // ------------------------------------------------------------------------
  // Alterações em campos (change)
  // ------------------------------------------------------------------------
  const C = {
    filter: (el) => { S.filters[el.dataset.key] = el.value; renderBoard(); },
    'member-role': async (el) => {
      try { await q(sb.from('board_members').update({ role: el.value }).eq('board_id', S.board.id).eq('user_id', el.dataset.user)); toast('Papel atualizado.'); }
      finally { await refreshBoard(); }
    },
    'label-color': async (el) => { await q(sb.from('labels').update({ color: el.value }).eq('id', el.dataset.id)); await refreshBoard(); },
    'label-name': async (el) => { await q(sb.from('labels').update({ name: el.value.trim() }).eq('id', el.dataset.id)); await refreshBoard(); },
    'card-title': async (el) => {
      const title = el.value.replace(/\s+/g, ' ').trim();
      if (!title) { el.value = S.cd.card.title; return; }
      if (title === S.cd.card.title) return;
      await q(sb.from('cards').update({ title }).eq('id', S.cd.card.id));
      await afterCardChange();
    },
    'move-list': async (el) => {
      const position = nextCardPos(el.value);
      await q(sb.from('cards').update({ list_id: el.value, position }).eq('id', S.cd.card.id));
      await afterCardChange();
    },
    'tpl-toggle': async (el) => {
      try { await q(sb.from('card_templates').update({ active: el.checked }).eq('id', el.dataset.id)); toast(el.checked ? 'Template ativado.' : 'Template desativado.'); }
      finally { await showAdmin(); }
    },
    'tpl-insert-key': (el) => {
      if (el.value === '') return;
      ensureKeys(S.tplEdit);
      const f = S.tplEdit.fields[Number(el.value)];
      S.tplEdit.title_pattern = ((S.tplEdit.title_pattern || '').trim() + (S.tplEdit.title_pattern ? ' | ' : '') + `{${f.key}}`).trim();
      renderTplEditor();
    },
    'att-files': async (el) => { const files = Array.from(el.files || []); el.value = ''; await uploadFiles(files); },
    'toggle-complete': async (el) => {
      await q(sb.from('cards').update({ completed: el.checked }).eq('id', S.cd.card.id));
      await afterCardChange();
    },
    'toggle-item': async (el) => {
      const it = S.cd.items.find((i) => i.id === el.dataset.id);
      if (it) { it.done = el.checked; renderCardModal(); }
      await q(sb.from('checklist_items').update({ done: el.checked }).eq('id', el.dataset.id));
      await afterCardChange();
    },
    'trello-file': async (el) => {
      const file = el.files && el.files[0];
      if (!file) return;
      let data;
      try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('Não foi possível ler o arquivo. Confirme que é o JSON exportado do Trello.'); }
      if (!data || !Array.isArray(data.lists) || !Array.isArray(data.cards)) {
        throw new Error('Este arquivo não parece ser a exportação JSON de um quadro do Trello.');
      }
      const members = trelloMembers(data);
      const byName = Object.fromEntries(Object.values(S.profiles).filter((p) => p.status === 'active').map((p) => [normName(p.full_name), p.id]));
      const guess = Object.fromEntries(members.map((m) => [m.id, byName[normName(m.name)] || '']));
      S.imp = { data, fileName: file.name, summary: trelloSummary(data), members, guess };
      renderAdmin();
    },
    'admin-toggle': async (el) => {
      try {
        await q(sb.from('profiles').update({ is_admin: el.checked }).eq('id', el.dataset.id));
        toast(el.checked ? 'Agora é administrador.' : 'Permissão de administrador removida.');
      } finally { await showAdmin(); }
    }
  };

  // ------------------------------------------------------------------------
  // Ouvintes globais
  // ------------------------------------------------------------------------
  function autofocus() {
    const el = $('#popover-root [data-autofocus]') || $('#modal-root [data-autofocus]') || $('#app [data-autofocus]');
    if (el) { el.focus(); if (el.select && el.tagName === 'INPUT' && el.type === 'text') el.select(); }
  }

  const safely = (fn) => async (...args) => {
    try { await fn(...args); } catch (e) { console.error(e); toast(errMsg(e), true); }
  };

  document.addEventListener('mousedown', (ev) => {
    if (S.pop && !ev.target.closest('.popover')) {
      const anchor = S.pop.anchor;
      if (anchor && anchor.contains(ev.target)) return;
      closePopover();
    }
  });

  document.addEventListener('click', safely(async (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const fn = A[el.dataset.act];
    if (!fn) return;
    if (el.tagName === 'A' && el.getAttribute('href') && el.getAttribute('href') !== '#') return;
    if (el.tagName === 'A' || el.tagName === 'BUTTON') ev.preventDefault();
    // reabrir o mesmo popover funciona como alternância
    if (S.pop && S.pop.anchor === el && el.dataset.act.startsWith('pop-')) { closePopover(); return; }
    await fn(el, ev);
  }));

  document.addEventListener('change', safely(async (ev) => {
    const el = ev.target.closest('[data-change]');
    if (!el) return;
    const fn = C[el.dataset.change];
    if (fn) await fn(el, ev);
  }));

  document.addEventListener('submit', safely(async (ev) => {
    const f = ev.target.closest('form[data-submit]');
    if (!f) return;
    ev.preventDefault();
    if (f.dataset.busy) return;
    f.dataset.busy = '1';
    try { const fn = F[f.dataset.submit]; if (fn) await fn(f, ev); }
    finally { delete f.dataset.busy; }
  }));

  let filterTimer = null;
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.input === 'filter-q') {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        S.filters.q = el.value;
        const pos = el.selectionStart;
        renderBoard();
        const n = $('[data-input="filter-q"]');
        if (n) { n.focus(); n.setSelectionRange(pos, pos); }
      }, 250);
    }
    if (el.classList.contains('cm-title')) autosize(el);
  });

  document.addEventListener('focusout', (ev) => {
    const el = ev.target;
    if (el.hasAttribute && el.hasAttribute('data-blur-submit')) {
      const f = el.closest('form');
      if (f && document.contains(f)) setTimeout(() => { if (document.contains(f)) f.requestSubmit(); }, 0);
    }
  });

  // Arrastar arquivos para o cartão aberto e colar prints
  const hasFiles = (ev) => ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files');
  document.addEventListener('dragover', (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    const m = $('#modal-root .modal');
    const ok = S.cd && canEdit() && !S.cd.attUnavailable && m && m.contains(ev.target);
    ev.dataTransfer.dropEffect = ok ? 'copy' : 'none';
    if (m) m.classList.toggle('dropping', !!ok);
  });
  document.addEventListener('dragleave', (ev) => {
    const m = $('#modal-root .modal');
    if (m && (!ev.relatedTarget || !m.contains(ev.relatedTarget))) m.classList.remove('dropping');
  });
  document.addEventListener('drop', safely(async (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    const m = $('#modal-root .modal');
    if (m) m.classList.remove('dropping');
    if (S.cd && canEdit() && !S.cd.attUnavailable && m && m.contains(ev.target)) await uploadFiles(ev.dataTransfer.files);
  }));
  document.addEventListener('paste', safely(async (ev) => {
    if (!S.cd || !canEdit() || S.cd.attUnavailable || !ev.clipboardData) return;
    const files = Array.from(ev.clipboardData.files || []);
    if (!files.length) return;
    ev.preventDefault();
    await uploadFiles(files);
  }));

  document.addEventListener('keydown', (ev) => {
    const el = ev.target;
    if (S.tplForm && handleCatalogKeys(ev)) return;
    if (ev.key === 'Enter' && !ev.shiftKey && el.hasAttribute && el.hasAttribute('data-enter-submit')) {
      ev.preventDefault(); el.closest('form').requestSubmit(); return;
    }
    if (ev.key === 'Enter' && el.hasAttribute && el.hasAttribute('data-enter-blur')) { ev.preventDefault(); el.blur(); return; }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && el.hasAttribute && el.hasAttribute('data-ctrl-submit')) {
      ev.preventDefault(); el.closest('form').requestSubmit(); return;
    }
    if (ev.key === 'Escape' && S.tplForm && !S.pop && !document.querySelector('body > .overlay')) { ev.preventDefault(); closeTemplateForm(); return; }
    if (ev.key === 'Escape') {
      if (S.pop) return closePopover();
      if (el.hasAttribute && el.hasAttribute('data-blur-submit')) {
        el.removeAttribute('data-blur-submit');
        if (S.cd) { S.cd.editingItem = null; S.cd.renamingChecklist = null; renderCardModal(); }
        else { S.renamingList = null; renderBoard(); }
        return;
      }
      if (S.cd) {
        if (S.cd.editingDesc || S.cd.editingComment || S.cd.addingItemTo) {
          Object.assign(S.cd, { editingDesc: false, editingComment: null, addingItemTo: null }); return renderCardModal();
        }
        return closeCard();
      }
      const ov = $('#modal-root .overlay');
      if (ov && ov.dataset.kind === 'locked') return;
      if (ov) return closeModal();
      if (S.addingCardTo || S.addingList) { S.addingCardTo = null; S.addingList = false; return renderBoard(); }
      if (S.drawer) { S.drawer = null; return renderBoard(); }
    }
  });

  // Recupera quando a aba volta a ficar visível (ex.: computador hibernou)
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.board) scheduleRefresh(); });

  init().catch((e) => { console.error(e); $('#app').innerHTML = `<div class="boot">Erro ao iniciar: ${esc(errMsg(e))}</div>`; });
})();
