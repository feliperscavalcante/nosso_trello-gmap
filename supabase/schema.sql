-- ==========================================================================
-- QUADROS GMAP | Estrutura do banco de dados (Supabase / PostgreSQL)
-- Execute este arquivo inteiro, uma única vez, no SQL Editor do Supabase.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. CONFIGURAÇÃO GERAL
-- --------------------------------------------------------------------------
create table if not exists public.app_config (
  id               int primary key default 1 check (id = 1),
  allowed_domain   text,                          -- ex.: 'seduc.pi.gov.br' (vazio = qualquer e-mail)
  require_approval boolean not null default true, -- novos cadastros aguardam aprovação do administrador
  updated_at       timestamptz not null default now()
);
insert into public.app_config (id) values (1) on conflict do nothing;

-- --------------------------------------------------------------------------
-- 2. PERFIS DE USUÁRIO
-- --------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  email      text not null,
  color      text not null default '#2f6f9f',
  is_admin   boolean not null default false,
  status     text not null default 'pending' check (status in ('pending','active','inactive')),
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- 3. QUADROS, LISTAS, CARTÕES E ITENS RELACIONADOS
-- --------------------------------------------------------------------------
create table if not exists public.boards (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(trim(title)) > 0),
  description text not null default '',
  color       text not null default '#2f6f9f',
  archived    boolean not null default false,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.board_members (
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  role     text not null default 'editor' check (role in ('owner','editor','viewer')),
  added_by uuid default auth.uid(),
  added_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create table if not exists public.lists (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards(id) on delete cascade,
  title      text not null check (length(trim(title)) > 0),
  position   double precision not null default 0,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.labels (
  id       uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name       text not null default '',
  color      text not null,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.cards (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.boards(id) on delete cascade,
  list_id      uuid not null references public.lists(id) on delete cascade,
  title        text not null check (length(trim(title)) > 0),
  description  text not null default '',
  position     double precision not null default 0,
  start_date   date,
  due_date     timestamptz,
  completed    boolean not null default false,
  completed_at timestamptz,
  archived     boolean not null default false,
  created_by   uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.card_assignees (
  card_id  uuid not null references public.cards(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  board_id uuid,
  primary key (card_id, user_id)
);

create table if not exists public.card_labels (
  card_id  uuid not null references public.cards(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  board_id uuid,
  primary key (card_id, label_id)
);

create table if not exists public.checklists (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references public.cards(id) on delete cascade,
  board_id   uuid,
  title      text not null default 'Checklist',
  position   double precision not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.checklist_items (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  card_id      uuid,
  board_id     uuid,
  text         text not null check (length(trim(text)) > 0),
  done         boolean not null default false,
  done_by      uuid references public.profiles(id) on delete set null,
  done_at      timestamptz,
  position     double precision not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references public.cards(id) on delete cascade,
  board_id   uuid,
  user_id    uuid references public.profiles(id) on delete set null default auth.uid(),
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);

-- Histórico (trilha de auditoria). Sem chaves estrangeiras de propósito:
-- o registro permanece mesmo que o cartão ou o quadro seja excluído.
create table if not exists public.activity (
  id         bigint generated always as identity primary key,
  board_id   uuid,
  card_id    uuid,
  user_id    uuid,
  user_name  text,
  action     text not null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_board_members_user on public.board_members(user_id);
create index if not exists idx_lists_board        on public.lists(board_id);
create index if not exists idx_labels_board       on public.labels(board_id);
create index if not exists idx_cards_board        on public.cards(board_id);
create index if not exists idx_cards_list         on public.cards(list_id);
create index if not exists idx_assignees_user     on public.card_assignees(user_id);
create index if not exists idx_assignees_board    on public.card_assignees(board_id);
create index if not exists idx_card_labels_board  on public.card_labels(board_id);
create index if not exists idx_checklists_card    on public.checklists(card_id);
create index if not exists idx_items_checklist    on public.checklist_items(checklist_id);
create index if not exists idx_items_board        on public.checklist_items(board_id);
create index if not exists idx_comments_card      on public.comments(card_id);
create index if not exists idx_activity_board     on public.activity(board_id, created_at desc);
create index if not exists idx_activity_card      on public.activity(card_id, created_at desc);

-- --------------------------------------------------------------------------
-- 4. FUNÇÕES DE PERMISSÃO
-- --------------------------------------------------------------------------
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active');
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active' and is_admin);
$$;

-- Papel do usuário logado no quadro: admin | owner | editor | viewer | null
create or replace function public.board_role(b uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then 'admin'
    else (select m.role from board_members m
            join profiles p on p.id = m.user_id
           where m.board_id = b and m.user_id = auth.uid() and p.status = 'active')
  end;
$$;

create or replace function public.can_view_board(b uuid) returns boolean
language sql stable as $$ select public.board_role(b) is not null; $$;

create or replace function public.can_edit_board(b uuid) returns boolean
language sql stable as $$ select coalesce(public.board_role(b) in ('admin','owner','editor'), false); $$;

create or replace function public.can_manage_board(b uuid) returns boolean
language sql stable as $$ select coalesce(public.board_role(b) in ('admin','owner'), false); $$;

-- Domínio permitido para cadastro (consultado pela tela de login, sem autenticação)
create or replace function public.signup_domain() returns text
language sql stable security definer set search_path = public as $$
  select nullif(trim(allowed_domain), '') from app_config where id = 1;
$$;

-- Contadores dos cartões abertos de um quadro (comentários e checklist).
-- Roda com as permissões de quem consulta (security invoker).
create or replace function public.board_card_stats(b uuid)
returns table (card_id uuid, comments int, items_total int, items_done int)
language sql stable security invoker set search_path = public as $$
  select c.id,
         (select count(*)::int from comments m where m.card_id = c.id),
         (select count(*)::int from checklist_items i where i.card_id = c.id),
         (select count(*)::int from checklist_items i where i.card_id = c.id and i.done)
    from cards c
   where c.board_id = b and not c.archived;
$$;

-- --------------------------------------------------------------------------
-- 5. CADASTRO AUTOMÁTICO DE PERFIL
--    O primeiro usuário vira administrador e já entra ativo.
--    Os demais aguardam aprovação (se require_approval = true).
-- --------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cfg        app_config;
  first_user boolean;
  palette    text[] := array['#2f6f9f','#7a4fa3','#2e8b57','#c0632b','#b23a48','#3f7f7f','#8a6d1f','#5560c4'];
begin
  select * into cfg from app_config where id = 1;
  if coalesce(trim(cfg.allowed_domain), '') <> ''
     and lower(split_part(new.email, '@', 2)) <> lower(trim(cfg.allowed_domain)) then
    raise exception 'Cadastro permitido apenas para e-mails @%', cfg.allowed_domain;
  end if;

  select not exists (select 1 from profiles) into first_user;

  insert into profiles (id, full_name, email, color, is_admin, status)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    palette[1 + floor(random() * array_length(palette, 1))::int],
    first_user,
    case when first_user or not coalesce(cfg.require_approval, true) then 'active' else 'pending' end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Usuários que já existiam antes deste script ganham perfil (pendente).
-- Se ainda não houver administrador ativo, o cadastro mais antigo vira administrador.
insert into public.profiles (id, full_name, email, status)
select u.id,
       coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1)),
       u.email, 'pending'
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);

update public.profiles set is_admin = true, status = 'active'
 where id = (select u.id from auth.users u join public.profiles p on p.id = u.id order by u.created_at limit 1)
   and not exists (select 1 from public.profiles where is_admin and status = 'active');

-- Impede que um usuário comum se promova a admin ou se aprove sozinho,
-- e impede que o último administrador ativo seja removido.
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.is_admin := old.is_admin;
    new.status   := old.status;
  end if;
  new.email := old.email;

  if old.is_admin and old.status = 'active'
     and (not new.is_admin or new.status <> 'active')
     and not exists (select 1 from profiles
                      where is_admin and status = 'active' and id <> old.id) then
    raise exception 'O sistema precisa de pelo menos um administrador ativo';
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_profile on public.profiles;
create trigger trg_protect_profile before update on public.profiles
  for each row execute function public.protect_profile();

-- --------------------------------------------------------------------------
-- 6. REGRAS DE CONSISTÊNCIA
-- --------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_boards_touch on public.boards;
create trigger trg_boards_touch before update on public.boards
  for each row execute function public.touch_updated_at();

-- Cartão: lista precisa ser do mesmo quadro; controla data de conclusão
create or replace function public.cards_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select board_id into new.board_id from lists where id = new.list_id;
  if new.board_id is null then raise exception 'Lista inexistente'; end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.created_by is distinct from old.created_by then new.created_by := old.created_by; end if;
  end if;
  if new.completed and (tg_op = 'INSERT' or not old.completed) then new.completed_at := now(); end if;
  if not new.completed then new.completed_at := null; end if;
  return new;
end $$;

drop trigger if exists trg_cards_before on public.cards;
create trigger trg_cards_before before insert or update on public.cards
  for each row execute function public.cards_before_write();

-- Tabelas filhas herdam o board_id do cartão (usado nas permissões)
create or replace function public.inherit_board_from_card() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select board_id into new.board_id from cards where id = new.card_id;
  if new.board_id is null then raise exception 'Cartão inexistente'; end if;
  return new;
end $$;

drop trigger if exists trg_assignees_board on public.card_assignees;
create trigger trg_assignees_board before insert or update on public.card_assignees
  for each row execute function public.inherit_board_from_card();
drop trigger if exists trg_card_labels_board on public.card_labels;
create trigger trg_card_labels_board before insert or update on public.card_labels
  for each row execute function public.inherit_board_from_card();
drop trigger if exists trg_checklists_board on public.checklists;
create trigger trg_checklists_board before insert or update on public.checklists
  for each row execute function public.inherit_board_from_card();
drop trigger if exists trg_comments_board on public.comments;
create trigger trg_comments_board before insert or update on public.comments
  for each row execute function public.inherit_board_from_card();

-- Responsável precisa ser membro do quadro
create or replace function public.check_assignee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from board_members where board_id = new.board_id and user_id = new.user_id) then
    raise exception 'O responsável precisa ser membro do quadro';
  end if;
  return new;
end $$;
drop trigger if exists trg_check_assignee on public.card_assignees;
create trigger trg_check_assignee before insert on public.card_assignees
  for each row execute function public.check_assignee();

-- Etiqueta precisa ser do mesmo quadro do cartão
create or replace function public.check_card_label() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from labels where id = new.label_id and board_id = new.board_id) then
    raise exception 'Etiqueta não pertence a este quadro';
  end if;
  return new;
end $$;
drop trigger if exists trg_check_card_label on public.card_labels;
create trigger trg_check_card_label before insert on public.card_labels
  for each row execute function public.check_card_label();

-- Itens de checklist herdam cartão e quadro; registram quem marcou
create or replace function public.items_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select card_id, board_id into new.card_id, new.board_id from checklists where id = new.checklist_id;
  if new.board_id is null then raise exception 'Checklist inexistente'; end if;
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_by := auth.uid(); new.done_at := now();
  elsif not new.done then
    new.done_by := null; new.done_at := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_items_before on public.checklist_items;
create trigger trg_items_before before insert or update on public.checklist_items
  for each row execute function public.items_before_write();

-- Comentário: autor fixo e marca de edição
create or replace function public.comments_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := coalesce(auth.uid(), new.user_id);
    new.created_at := now();
  else
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    new.card_id := old.card_id;
    if new.body is distinct from old.body then new.edited_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_comments_before on public.comments;
create trigger trg_comments_before before insert or update on public.comments
  for each row execute function public.comments_before_write();

-- Quadro novo: criador vira dono, recebe listas e etiquetas padrão
create or replace function public.boards_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.seeding', new.id::text, true);
  if new.created_by is not null then
    insert into board_members (board_id, user_id, role, added_by)
    values (new.id, new.created_by, 'owner', new.created_by)
    on conflict do nothing;
  end if;
  insert into lists (board_id, title, position) values
    (new.id, 'A fazer', 1000), (new.id, 'Em andamento', 2000), (new.id, 'Concluído', 3000);
  insert into labels (board_id, name, color) values
    (new.id, 'Urgente', '#c9372c'), (new.id, 'Importante', '#e2711d'),
    (new.id, 'Aguardando', '#d4a72c'), (new.id, 'Rotina', '#2e8b57'),
    (new.id, 'Processo SEI', '#2f6f9f'), (new.id, 'Informativo', '#7a4fa3');
  perform set_config('app.seeding', '', true);
  return new;
end $$;
drop trigger if exists trg_boards_after_insert on public.boards;
create trigger trg_boards_after_insert after insert on public.boards
  for each row execute function public.boards_after_insert();

-- Quadro precisa manter pelo menos um dono
create or replace function public.keep_one_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from boards where id = old.board_id) then
    return coalesce(new, old); -- quadro sendo excluído
  end if;
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (select 1 from board_members
                      where board_id = old.board_id and role = 'owner' and user_id <> old.user_id) then
    raise exception 'O quadro precisa ter pelo menos um dono';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_keep_one_owner on public.board_members;
create trigger trg_keep_one_owner before update or delete on public.board_members
  for each row execute function public.keep_one_owner();

-- --------------------------------------------------------------------------
-- 7. HISTÓRICO AUTOMÁTICO (AUDITORIA)
--    Toda alteração relevante é registrada por gatilhos no próprio banco.
--    Ninguém consegue editar ou apagar o histórico pela aplicação.
-- --------------------------------------------------------------------------
create or replace function public.log_activity(p_board uuid, p_card uuid, p_action text, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into activity (board_id, card_id, user_id, user_name, action, details)
  values (p_board, p_card, auth.uid(),
          (select full_name from profiles where id = auth.uid()),
          p_action, coalesce(p_details, '{}'::jsonb));
end $$;

create or replace function public.profile_name(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select full_name from profiles where id = u;
$$;

create or replace function public.trg_log_boards() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform log_activity(new.id, null, 'board_created', jsonb_build_object('title', new.title));
  elsif tg_op = 'UPDATE' then
    if new.title is distinct from old.title then
      perform log_activity(new.id, null, 'board_renamed', jsonb_build_object('from', old.title, 'to', new.title));
    end if;
    if new.archived is distinct from old.archived then
      perform log_activity(new.id, null, case when new.archived then 'board_archived' else 'board_restored' end, '{}');
    end if;
  elsif tg_op = 'DELETE' then
    perform log_activity(old.id, null, 'board_deleted', jsonb_build_object('title', old.title));
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_log_boards on public.boards;
create trigger trg_log_boards after insert or update or delete on public.boards
  for each row execute function public.trg_log_boards();

create or replace function public.trg_log_members() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform log_activity(new.board_id, null, 'member_added',
      jsonb_build_object('name', profile_name(new.user_id), 'role', new.role));
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    perform log_activity(new.board_id, null, 'member_role',
      jsonb_build_object('name', profile_name(new.user_id), 'from', old.role, 'to', new.role));
  elsif tg_op = 'DELETE' and exists (select 1 from boards where id = old.board_id) then
    perform log_activity(old.board_id, null, 'member_removed', jsonb_build_object('name', profile_name(old.user_id)));
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_log_members on public.board_members;
create trigger trg_log_members after insert or update or delete on public.board_members
  for each row execute function public.trg_log_members();

create or replace function public.trg_log_lists() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if current_setting('app.seeding', true) = new.board_id::text then
      return new; -- listas padrão do quadro recém-criado
    end if;
    perform log_activity(new.board_id, null, 'list_created', jsonb_build_object('title', new.title));
  elsif tg_op = 'UPDATE' then
    if new.title is distinct from old.title then
      perform log_activity(new.board_id, null, 'list_renamed', jsonb_build_object('from', old.title, 'to', new.title));
    end if;
    if new.archived is distinct from old.archived then
      perform log_activity(new.board_id, null, case when new.archived then 'list_archived' else 'list_restored' end,
        jsonb_build_object('title', new.title));
    end if;
  elsif tg_op = 'DELETE' and exists (select 1 from boards where id = old.board_id) then
    perform log_activity(old.board_id, null, 'list_deleted', jsonb_build_object('title', old.title));
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_log_lists on public.lists;
create trigger trg_log_lists after insert or update or delete on public.lists
  for each row execute function public.trg_log_lists();

create or replace function public.trg_log_cards() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  l_from text; l_to text;
begin
  if tg_op = 'INSERT' then
    perform log_activity(new.board_id, new.id, 'card_created',
      jsonb_build_object('title', new.title, 'list', (select title from lists where id = new.list_id)));
  elsif tg_op = 'UPDATE' then
    if new.list_id is distinct from old.list_id then
      select title into l_from from lists where id = old.list_id;
      select title into l_to   from lists where id = new.list_id;
      perform log_activity(new.board_id, new.id, 'card_moved',
        jsonb_build_object('title', new.title, 'from', l_from, 'to', l_to));
    end if;
    if new.title is distinct from old.title then
      perform log_activity(new.board_id, new.id, 'card_renamed', jsonb_build_object('from', old.title, 'to', new.title));
    end if;
    if new.description is distinct from old.description then
      perform log_activity(new.board_id, new.id, 'card_description', jsonb_build_object('title', new.title));
    end if;
    if new.due_date is distinct from old.due_date then
      perform log_activity(new.board_id, new.id, 'card_due',
        jsonb_build_object('title', new.title, 'from', old.due_date, 'to', new.due_date));
    end if;
    if new.start_date is distinct from old.start_date then
      perform log_activity(new.board_id, new.id, 'card_start',
        jsonb_build_object('title', new.title, 'to', new.start_date));
    end if;
    if new.completed is distinct from old.completed then
      perform log_activity(new.board_id, new.id, case when new.completed then 'card_completed' else 'card_reopened' end,
        jsonb_build_object('title', new.title));
    end if;
    if new.archived is distinct from old.archived then
      perform log_activity(new.board_id, new.id, case when new.archived then 'card_archived' else 'card_restored' end,
        jsonb_build_object('title', new.title));
    end if;
  elsif tg_op = 'DELETE' and exists (select 1 from boards where id = old.board_id) then
    perform log_activity(old.board_id, old.id, 'card_deleted', jsonb_build_object('title', old.title));
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_log_cards on public.cards;
create trigger trg_log_cards after insert or update or delete on public.cards
  for each row execute function public.trg_log_cards();

create or replace function public.trg_log_assignees() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  r := coalesce(new, old);
  if not exists (select 1 from cards where id = r.card_id) then return r; end if;
  perform log_activity(r.board_id, r.card_id,
    case when tg_op = 'INSERT' then 'assignee_added' else 'assignee_removed' end,
    jsonb_build_object('name', profile_name(r.user_id), 'title', (select title from cards where id = r.card_id)));
  return r;
end $$;
drop trigger if exists trg_log_assignees on public.card_assignees;
create trigger trg_log_assignees after insert or delete on public.card_assignees
  for each row execute function public.trg_log_assignees();

create or replace function public.trg_log_card_labels() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; l labels;
begin
  r := coalesce(new, old);
  if not exists (select 1 from cards where id = r.card_id) then return r; end if;
  select * into l from labels where id = r.label_id;
  if l.id is null then return r; end if;
  perform log_activity(r.board_id, r.card_id,
    case when tg_op = 'INSERT' then 'label_added' else 'label_removed' end,
    jsonb_build_object('name', l.name, 'color', l.color));
  return r;
end $$;
drop trigger if exists trg_log_card_labels on public.card_labels;
create trigger trg_log_card_labels after insert or delete on public.card_labels
  for each row execute function public.trg_log_card_labels();

create or replace function public.trg_log_labels() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if current_setting('app.seeding', true) = new.board_id::text then
      return new;
    end if;
    perform log_activity(new.board_id, null, 'labels_changed', jsonb_build_object('name', new.name));
  elsif tg_op = 'UPDATE' then
    perform log_activity(new.board_id, null, 'labels_changed', jsonb_build_object('name', new.name));
  elsif exists (select 1 from boards where id = old.board_id) then
    perform log_activity(old.board_id, null, 'labels_changed', jsonb_build_object('name', old.name));
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_log_labels on public.labels;
create trigger trg_log_labels after insert or update or delete on public.labels
  for each row execute function public.trg_log_labels();

create or replace function public.trg_log_checklists() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  r := coalesce(new, old);
  if not exists (select 1 from cards where id = r.card_id) then return r; end if;
  if tg_op = 'INSERT' then
    perform log_activity(r.board_id, r.card_id, 'checklist_added', jsonb_build_object('name', new.title));
  elsif tg_op = 'UPDATE' and new.title is distinct from old.title then
    perform log_activity(r.board_id, r.card_id, 'checklist_renamed', jsonb_build_object('from', old.title, 'to', new.title));
  elsif tg_op = 'DELETE' then
    perform log_activity(r.board_id, r.card_id, 'checklist_removed', jsonb_build_object('name', old.title));
  end if;
  return r;
end $$;
drop trigger if exists trg_log_checklists on public.checklists;
create trigger trg_log_checklists after insert or update or delete on public.checklists
  for each row execute function public.trg_log_checklists();

create or replace function public.trg_log_items() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  r := coalesce(new, old);
  if not exists (select 1 from checklists where id = r.checklist_id) then return r; end if;
  if tg_op = 'INSERT' then
    perform log_activity(r.board_id, r.card_id, 'item_added', jsonb_build_object('text', new.text));
  elsif tg_op = 'UPDATE' then
    if new.done is distinct from old.done then
      perform log_activity(r.board_id, r.card_id, case when new.done then 'item_checked' else 'item_unchecked' end,
        jsonb_build_object('text', new.text));
    elsif new.text is distinct from old.text then
      perform log_activity(r.board_id, r.card_id, 'item_edited', jsonb_build_object('from', old.text, 'to', new.text));
    end if;
  elsif tg_op = 'DELETE' then
    perform log_activity(r.board_id, r.card_id, 'item_removed', jsonb_build_object('text', old.text));
  end if;
  return r;
end $$;
drop trigger if exists trg_log_items on public.checklist_items;
create trigger trg_log_items after insert or update or delete on public.checklist_items
  for each row execute function public.trg_log_items();

create or replace function public.trg_log_comments() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  r := coalesce(new, old);
  if not exists (select 1 from cards where id = r.card_id) then return r; end if;
  if tg_op = 'INSERT' then
    perform log_activity(r.board_id, r.card_id, 'comment_added', jsonb_build_object('text', left(new.body, 140)));
  elsif tg_op = 'UPDATE' and new.body is distinct from old.body then
    perform log_activity(r.board_id, r.card_id, 'comment_edited',
      jsonb_build_object('from', left(old.body, 140), 'to', left(new.body, 140)));
  elsif tg_op = 'DELETE' then
    perform log_activity(r.board_id, r.card_id, 'comment_deleted', jsonb_build_object('text', left(old.body, 140)));
  end if;
  return r;
end $$;
drop trigger if exists trg_log_comments on public.comments;
create trigger trg_log_comments after insert or update or delete on public.comments
  for each row execute function public.trg_log_comments();

-- --------------------------------------------------------------------------
-- 8. SEGURANÇA EM NÍVEL DE LINHA (RLS)
-- --------------------------------------------------------------------------
alter table public.app_config      enable row level security;
alter table public.profiles        enable row level security;
alter table public.boards          enable row level security;
alter table public.board_members   enable row level security;
alter table public.lists           enable row level security;
alter table public.labels          enable row level security;
alter table public.cards           enable row level security;
alter table public.card_assignees  enable row level security;
alter table public.card_labels     enable row level security;
alter table public.checklists      enable row level security;
alter table public.checklist_items enable row level security;
alter table public.comments        enable row level security;
alter table public.activity        enable row level security;

-- Configuração: só administradores
drop policy if exists cfg_select on public.app_config;
create policy cfg_select on public.app_config for select to authenticated using (public.is_admin());
drop policy if exists cfg_update on public.app_config;
create policy cfg_update on public.app_config for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Perfis: usuários ativos veem todos (para atribuir tarefas); cada um edita o próprio
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- Quadros
drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards for select to authenticated
  using (public.can_view_board(id) or (created_by = auth.uid() and public.is_active_user()));
drop policy if exists boards_insert on public.boards;
create policy boards_insert on public.boards for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());
drop policy if exists boards_update on public.boards;
create policy boards_update on public.boards for update to authenticated
  using (public.can_manage_board(id)) with check (public.can_manage_board(id));
drop policy if exists boards_delete on public.boards;
create policy boards_delete on public.boards for delete to authenticated
  using (public.can_manage_board(id));

-- Membros do quadro
drop policy if exists members_select on public.board_members;
create policy members_select on public.board_members for select to authenticated
  using (public.can_view_board(board_id));
drop policy if exists members_insert on public.board_members;
create policy members_insert on public.board_members for insert to authenticated
  with check (public.can_manage_board(board_id));
drop policy if exists members_update on public.board_members;
create policy members_update on public.board_members for update to authenticated
  using (public.can_manage_board(board_id)) with check (public.can_manage_board(board_id));
drop policy if exists members_delete on public.board_members;
create policy members_delete on public.board_members for delete to authenticated
  using (public.can_manage_board(board_id) or user_id = auth.uid());

-- Tabelas de conteúdo: leitura para membros, escrita para editores
do $$
declare t text;
begin
  foreach t in array array['lists','labels','card_assignees','card_labels','checklists','checklist_items'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.can_view_board(board_id))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.can_edit_board(board_id))', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.can_edit_board(board_id)) with check (public.can_edit_board(board_id))', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.can_edit_board(board_id))', t);
  end loop;
end $$;

-- Cartões: editores criam e alteram; só dono do quadro ou admin exclui definitivamente
drop policy if exists cards_select on public.cards;
create policy cards_select on public.cards for select to authenticated using (public.can_view_board(board_id));
drop policy if exists cards_insert on public.cards;
create policy cards_insert on public.cards for insert to authenticated with check (public.can_edit_board(board_id));
drop policy if exists cards_update on public.cards;
create policy cards_update on public.cards for update to authenticated
  using (public.can_edit_board(board_id)) with check (public.can_edit_board(board_id));
drop policy if exists cards_delete on public.cards;
create policy cards_delete on public.cards for delete to authenticated using (public.can_manage_board(board_id));

-- Comentários: qualquer membro (inclusive leitor) comenta; cada um edita o seu
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select to authenticated using (public.can_view_board(board_id));
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check (public.can_view_board(board_id) and user_id = auth.uid());
drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments for update to authenticated
  using (user_id = auth.uid() and public.can_view_board(board_id)) with check (user_id = auth.uid());
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated
  using ((user_id = auth.uid() and public.can_view_board(board_id)) or public.can_manage_board(board_id));

-- Histórico: somente leitura (gravado apenas pelos gatilhos)
drop policy if exists activity_select on public.activity;
create policy activity_select on public.activity for select to authenticated
  using (public.can_view_board(board_id) or (board_id is null and public.is_admin()));

-- --------------------------------------------------------------------------
-- 9. ATUALIZAÇÃO EM TEMPO REAL
-- --------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['activity','cards','lists'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
