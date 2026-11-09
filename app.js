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
    openCard: null, cd: null,
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
      [/Email not confirmed/i, 'Confirme seu e-mail (link enviado na criação da conta) antes de entrar.'],
      [/User already registered/i, 'Este e-mail já está cadastrado. Use "Entrar" ou "Esqueci a senha".'],
      [/Database error saving new user/i, 'Cadastro recusado. Verifique se está usando o e-mail institucional permitido.'],
      [/Password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
      [/row-level security|permission denied|violates row-level/i, 'Você não tem permissão para esta ação.'],
      [/rate limit|too many/i, 'Muitas tentativas seguidas. Aguarde alguns minutos.'],
      [/Failed to fetch|NetworkError/i, 'Sem conexão com o servidor. Verifique sua internet.'],
      [/JWT expired/i, 'Sua sessão expirou. Entre novamente.']
    ];
    for (const [re, txt] of map) if (re.test(m)) return txt;
    return m;
  }

  function toast(msg, err = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.textContent = msg;
    $('#toast-root').appendChild(el);
    setTimeout(() => el.remove(), err ? 5000 : 2800);
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
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>'
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
    if (event === 'SIGNED_OUT') { cleanupBoard(); S.me = null; S.profiles = {}; closeModal(); return route(); }
    if (event === 'SIGNED_IN' && session && session.user.id !== prevUser) { await loadMe(); route(); }
  }

  async function loadMe() {
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
          <label class="field"><span>E-mail</span><input class="input" type="email" name="email" required autocomplete="email" data-autofocus></label>
          <label class="field"><span>Senha</span><input class="input" type="password" name="password" required autocomplete="current-password"></label>
          <button class="btn primary" style="width:100%" type="submit">Entrar</button>
          <p class="small" style="text-align:center;margin:14px 0 0"><a href="#" data-act="auth-mode" data-mode="forgot">Esqueci minha senha</a></p>
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
    S.boards = await q(sb.from('boards').select('*').order('title'));
    const asg = await q(sb.from('card_assignees').select('card_id').eq('user_id', S.me.id));
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
    S.myTasks = tasks;
    renderHome();
  }

  function renderHome() {
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
      S.filters = { q: '', member: '', label: '', due: '' };
      S.showFilters = false;
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
      q(sb.rpc('board_card_stats', { b: id }))
    ]);
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
    if (S.dragging || isEditing() || S.pop) { S.pendingRefresh = true; return; }
    S.pendingRefresh = false;
    try {
      await refreshBoard();
      if (S.cd) { S.cd.stale = false; await reloadCard(); }
    } catch (e) { console.error(e); }
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (S.pendingRefresh && !isEditing() && !S.pop) doRefresh(); }, 80));

  function cleanupBoard() {
    if (S.channel) { try { sb.removeChannel(S.channel); } catch (e) { /* ignora */ } }
    Object.assign(S, { channel: null, board: null, role: null, drawer: null, addingCardTo: null, addingList: false, renamingList: null, pendingRefresh: false });
    if (S.openCard) closeModal();
  }

  // ------------------------------------------------------------------------
  // Quadro: renderização
  // ------------------------------------------------------------------------
  const cardLabelIds = (cid) => S.cardLabels.filter((x) => x.card_id === cid).map((x) => x.label_id);
  const cardAssigneeIds = (cid) => S.assignees.filter((x) => x.card_id === cid).map((x) => x.user_id);
  const activeLists = () => S.lists.filter((l) => !l.archived);
  const filtersActive = () => !!(S.filters.q || S.filters.member || S.filters.label || S.filters.due);

  function matchesFilters(c) {
    const f = S.filters;
    if (f.q) {
      const t = (c.title + ' ' + c.description).toLowerCase();
      if (!t.includes(f.q.toLowerCase())) return false;
    }
    if (f.member) {
      const who = f.member === 'me' ? S.me.id : f.member;
      if (f.member === 'none') { if (cardAssigneeIds(c.id).length) return false; }
      else if (!cardAssigneeIds(c.id).includes(who)) return false;
    }
    if (f.label && !cardLabelIds(c.id).includes(f.label)) return false;
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
    const b = S.board;
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
          <button class="btn sm ${S.showFilters || fa ? 'on' : ''}" data-act="toggle-filters">${icon('filter', 14)}<span class="hide-sm">Filtros${fa ? ' (ativos)' : ''}</span></button>
          <button class="btn sm" data-act="drawer" data-view="members">${icon('users', 14)}<span class="hide-sm">Membros</span></button>
          <button class="btn sm" data-act="drawer" data-view="menu" title="Menu do quadro">${icon('dots', 14)}</button>
        </div>
        ${S.showFilters || fa ? renderFilters(members) : ''}
        <div class="lists" id="lists">
          ${activeLists().map(renderList).join('')}
          ${canEdit() ? renderAddList() : ''}
        </div>
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
        ${canEdit() ? `<div class="list-foot">${S.addingCardTo === l.id ? `
          <form data-submit="add-card" data-list="${l.id}">
            <textarea class="textarea" name="title" rows="2" style="min-height:56px" placeholder="Insira um título para este cartão..." maxlength="300" data-autofocus data-enter-submit></textarea>
            <div class="row" style="margin-top:8px"><button class="btn primary sm" type="submit">Adicionar cartão</button><button class="icon-btn" type="button" data-act="cancel-add-card">${icon('x')}</button></div>
          </form>` : `<button class="btn add-card-btn" data-act="add-card" data-list="${l.id}">${icon('plus')} Adicionar um cartão</button>`}</div>` : '<div style="height:8px"></div>'}
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
    if (c.description) badges.push(`<span class="badge" title="Possui descrição">${icon('desc', 13)}</span>`);
    if (s.comments) badges.push(`<span class="badge" title="Comentários">${icon('comment', 13)} ${s.comments}</span>`);
    if (s.items_total) badges.push(`<span class="badge ${s.items_done === s.items_total ? 'ok' : ''}" title="Checklist">${icon('checksq', 13)} ${s.items_done}/${s.items_total}</span>`);
    return `
      <div class="card ${c.completed ? 'done' : ''}" data-card="${c.id}" data-act="open-card" data-id="${c.id}">
        ${labs.length ? `<div class="labels">${labs.map((l) => `<span class="lab" style="background:${safeColor(l.color)}" title="${esc(l.name)}"></span>`).join('')}</div>` : ''}
        <div class="ct">${esc(c.title)}</div>
        ${badges.length || who.length ? `<div class="badges">${badges.join('')}${who.length ? `<div class="avatars">${who.map((u) => avatar(u, 'sm')).join('')}</div>` : ''}</div>` : ''}
      </div>`;
  }

  // Arrastar e soltar
  let sortables = [];
  function setupSortable() {
    sortables.forEach((s) => s.destroy());
    sortables = [];
    if (!canEdit() || !window.Sortable) return;
    const common = { animation: 150, delay: 180, delayOnTouchOnly: true, forceFallback: true, fallbackTolerance: 4,
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
    S.cd = { card: null, checklists: [], items: [], comments: [], activity: [], showDetails: true, editingDesc: false, editingComment: null, addingItemTo: null, editingItem: null, renamingChecklist: null };
    try {
      const ok = await reloadCard();
      if (!ok) { toast('Cartão não encontrado.', true); S.openCard = null; S.cd = null; return go(`#/b/${S.board.id}`); }
    } catch (e) { toast(errMsg(e), true); }
  }

  async function reloadCard() {
    if (!S.cd) return false;
    const id = S.openCard;
    const [card, checklists, items, comments, activity] = await Promise.all([
      q(sb.from('cards').select('*').eq('id', id).maybeSingle()),
      q(sb.from('checklists').select('*').eq('card_id', id).order('position').order('created_at')),
      q(sb.from('checklist_items').select('*').eq('card_id', id).order('position').order('created_at')),
      q(sb.from('comments').select('*').eq('card_id', id).order('created_at', { ascending: false })),
      q(sb.from('activity').select('*').eq('card_id', id).order('created_at', { ascending: false }).limit(150))
    ]);
    if (!S.cd || S.openCard !== id) return true;
    if (!card || card.board_id !== S.board.id) return false;
    Object.assign(S.cd, { card, checklists, items, comments, activity });
    const i = S.cards.findIndex((c) => c.id === id);
    if (i >= 0) S.cards[i] = card;
    renderCardModal();
    return true;
  }

  function closeCard() { if (S.board) go(`#/b/${S.board.id}`); else closeModal(); }

  function renderCardModal() {
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
            <div class="cm-section"><h4>${icon('desc')} Descrição ${ed && c.description && !cd.editingDesc ? '<button class="btn sm" data-act="edit-desc" style="margin-left:auto">Editar</button>' : ''}</h4>${desc}</div>
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
    S.admin = { cfg: cfg || {}, boards };
    renderAdmin();
  }

  function renderAdmin() {
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
        <section class="panel" style="margin-bottom:20px">
          <h2>${icon('users')} Usuários (${users.length})</h2>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Servidor</th><th>Situação</th><th>Admin</th><th class="hide-sm">Cadastro</th><th style="text-align:right">Ações</th></tr></thead>
            <tbody>${users.map((u) => `
              <tr>
                <td><div class="row">${avatar(u.id)}<div style="min-width:0"><div style="font-weight:600">${esc(u.full_name)}${u.id === S.me.id ? ' <span class="muted small">(você)</span>' : ''}</div><div class="small muted">${esc(u.email)}</div></div></div></td>
                <td><span class="status ${u.status}">${statusName[u.status]}</span></td>
                <td><input type="checkbox" ${u.is_admin ? 'checked' : ''} data-change="admin-toggle" data-id="${u.id}" title="Administrador do sistema"></td>
                <td class="hide-sm small muted">${fmtDate(u.created_at, false)}</td>
                <td style="text-align:right;white-space:nowrap">
                  ${u.status === 'pending' ? `<button class="btn primary sm" data-act="user-status" data-id="${u.id}" data-status="active">Aprovar</button> <button class="btn sm" data-act="user-status" data-id="${u.id}" data-status="inactive">Recusar</button>` : ''}
                  ${u.status === 'active' && u.id !== S.me.id ? `<button class="btn sm" data-act="user-status" data-id="${u.id}" data-status="inactive">Desativar</button>` : ''}
                  ${u.status === 'inactive' ? `<button class="btn sm" data-act="user-status" data-id="${u.id}" data-status="active">Reativar</button>` : ''}
                </td>
              </tr>`).join('')}</tbody>
          </table></div>
          <p class="small muted" style="line-height:1.5;margin-bottom:0">Desativar bloqueia o acesso imediatamente, mas preserva o histórico do servidor. Administradores enxergam e gerenciam todos os quadros.</p>
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
  // Exportação CSV
  // ------------------------------------------------------------------------
  async function exportCsv() {
    const id = S.board.id;
    const cards = await q(sb.from('cards').select('*').eq('board_id', id).order('position'));
    const lmap = Object.fromEntries(S.lists.map((l) => [l.id, l]));
    const lord = Object.fromEntries(S.lists.map((l, i) => [l.id, i]));
    cards.sort((a, b) => (lord[a.list_id] - lord[b.list_id]) || (a.position - b.position));
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Lista', 'Cartão', 'Descrição', 'Etiquetas', 'Responsáveis', 'Início', 'Entrega', 'Situação', 'Checklist', 'Arquivado', 'Criado por', 'Criado em', 'Atualizado em'];
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
        c.archived ? 'Sim' : 'Não',
        userName(c.created_by),
        new Date(c.created_at).toLocaleString('pt-BR'),
        new Date(c.updated_at).toLocaleString('pt-BR')
      ].map(cell).join(';');
    });
    const csv = '﻿' + [head.map(cell).join(';'), ...rows].join('\r\n');
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
    logout: async () => { closePopover(); await sb.auth.signOut(); location.hash = '#/'; },
    'user-menu': (el) => openPopover(el, S.me.full_name, () => `
      <p class="small muted" style="text-align:center;margin:-6px 0 10px">${esc(S.me.email)}</p>
      <button class="opt" data-act="edit-profile">${icon('user')} Meu perfil</button>
      <button class="opt" data-act="change-password">${icon('key')} Alterar senha</button>
      <button class="opt" data-act="logout">${icon('logout')} Sair</button>`),
    'edit-profile': () => { closePopover(); openProfileModal(); },
    'change-password': () => { closePopover(); openPasswordModal(false); },

    // genéricos
    'close-modal': () => closeModal(),
    overlay: (el, ev) => { if (ev.target === el) { if (el.dataset.kind === 'card') closeCard(); else closeModal(); } },
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
    'toggle-filters': () => { S.showFilters = !S.showFilters; renderBoard(); },
    'clear-filters': () => { S.filters = { q: '', member: '', label: '', due: '' }; renderBoard(); },
    'add-card': (el) => { S.addingCardTo = el.dataset.list; renderBoard(); },
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
      if (!(await confirmDialog('Excluir este cartão definitivamente? Comentários e checklists serão apagados. O registro no histórico do quadro é mantido.', { confirmText: 'Excluir', danger: true }))) return;
      await q(sb.from('cards').delete().eq('id', el.dataset.id));
      toast('Cartão excluído.');
      if (S.cd && S.cd.card.id === el.dataset.id) closeCard();
      await refreshBoard();
    },
    'restore-list': async (el) => { await q(sb.from('lists').update({ archived: false }).eq('id', el.dataset.id)); await refreshBoard(); },
    'delete-list': async (el) => {
      const l = S.lists.find((x) => x.id === el.dataset.id);
      if (!(await confirmDialog(`Excluir definitivamente a lista <b>${esc(l.title)}</b> e todos os cartões dela?`, { confirmText: 'Excluir', danger: true }))) return;
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
      if (!(await confirmDialog('Esta ação apaga o quadro, as listas, os cartões e os comentários. Não pode ser desfeita.', { confirmText: 'Excluir quadro', danger: true, requireText: S.board.title }))) return;
      await q(sb.from('boards').delete().eq('id', S.board.id));
      toast('Quadro excluído.');
      cleanupBoard();
      go('#/');
    },
    'export-csv': () => exportCsv(),

    // cartão
    'open-card': (el, ev) => { if (ev.target.closest('a')) return; go(`#/b/${S.board.id}/c/${el.dataset.id}`); },
    'close-card': () => closeCard(),
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
        const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
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
        const dom = await q(sb.rpc('signup_domain'));
        if (dom && email.split('@')[1] !== dom.toLowerCase()) throw new Error(`Use seu e-mail institucional (@${dom}).`);
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

  document.addEventListener('keydown', (ev) => {
    const el = ev.target;
    if (ev.key === 'Enter' && !ev.shiftKey && el.hasAttribute && el.hasAttribute('data-enter-submit')) {
      ev.preventDefault(); el.closest('form').requestSubmit(); return;
    }
    if (ev.key === 'Enter' && el.hasAttribute && el.hasAttribute('data-enter-blur')) { ev.preventDefault(); el.blur(); return; }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && el.hasAttribute && el.hasAttribute('data-ctrl-submit')) {
      ev.preventDefault(); el.closest('form').requestSubmit(); return;
    }
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
      if ($('#modal-root .overlay')) return closeModal();
      if (S.addingCardTo || S.addingList) { S.addingCardTo = null; S.addingList = false; return renderBoard(); }
      if (S.drawer) { S.drawer = null; return renderBoard(); }
    }
  });

  // Recupera quando a aba volta a ficar visível (ex.: computador hibernou)
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.board) scheduleRefresh(); });

  init().catch((e) => { console.error(e); $('#app').innerHTML = `<div class="boot">Erro ao iniciar: ${esc(errMsg(e))}</div>`; });
})();
