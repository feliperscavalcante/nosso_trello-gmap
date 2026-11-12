# Kanban GMAP

Sistema de quadros no estilo Kanban (listas e cartões) para organizar as demandas do setor. Funciona no navegador do computador e do celular, sem custo de licença.

**Tecnologia:** página estática hospedada no GitHub Pages + banco de dados e login no Supabase (plano gratuito).

## O que o sistema faz

| Recurso | Detalhes |
|---|---|
| Quadros, listas e cartões | Arrastar e soltar cartões entre listas e reordenar listas |
| Responsáveis | Um ou mais servidores por cartão; tela "Minhas tarefas" na página inicial |
| Prazos | Data de início, data e hora de entrega, alerta de atrasado e de vencimento em 48 h |
| Etiquetas | Cores e nomes personalizáveis por quadro (já vem com Urgente, Importante, Aguardando, Rotina, Processo SEI, Informativo) |
| Checklists | Várias por cartão, com barra de progresso e registro de quem marcou cada item |
| Comentários | Edição e exclusão apenas pelo autor; marca "(editado)" |
| Histórico | Registro automático e imutável de tudo o que foi feito, por quem e quando |
| Filtros | Busca por texto, responsável, etiqueta e prazo |
| Exportação | Planilha CSV do quadro (abre no Excel) |
| Tempo real | Alterações de um colega aparecem na tela dos outros sem recarregar |
| Login individual | Cadastro com aprovação do administrador e restrição por domínio de e-mail |

### Perfis de acesso

| Perfil | Pode fazer |
|---|---|
| **Administrador do sistema** | Aprova cadastros, desativa usuários, define o domínio permitido e enxerga e gerencia todos os quadros |
| **Dono do quadro** | Tudo no quadro: membros, configurações, arquivar e excluir |
| **Editor** | Cria, move e altera cartões, listas, etiquetas e checklists |
| **Leitor** | Apenas visualiza e comenta |

As permissões são aplicadas **no banco de dados** (Row Level Security), não só na tela. Mesmo que alguém manipule a página, o banco recusa o que o perfil não permite.

## Arquivos

```
index.html        página principal
app.js            lógica da aplicação
style.css         aparência
config.js         endereço e chave do Supabase (você preenche)
supabase/
  schema.sql      estrutura do banco, permissões e histórico
```

---

## Implantação passo a passo (cerca de 20 minutos)

### 1. Criar o banco no Supabase

1. Acesse **supabase.com**, crie uma conta e clique em **New project**.
2. Dê um nome (ex.: `kanban-gmap`), crie uma senha forte para o banco e guarde-a.
3. Em **Region**, escolha **South America (São Paulo)**.
4. Aguarde o projeto ficar pronto (1 a 2 minutos).

### 2. Criar as tabelas

1. No menu lateral, abra **SQL Editor** e clique em **New query**.
2. Abra o arquivo `supabase/schema.sql`, copie **todo** o conteúdo e cole no editor.
3. Clique em **Run**. Deve aparecer "Success. No rows returned".

O script pode ser executado novamente sem apagar dados (útil para atualizações).

### 3. Configurar o login

Em **Authentication**:

1. **Sign In / Providers > Email**: mantenha o provedor de e-mail ativo.
   - Recomendação: **desative "Confirm email"**. O sistema já exige aprovação do administrador, e o envio de e-mails do plano gratuito do Supabase tem limite baixo por hora, o que pode travar o cadastro de vários colegas no mesmo dia.
2. **URL Configuration**:
   - **Site URL**: o endereço que o GitHub Pages vai gerar (passo 5), por exemplo `https://seuusuario.github.io/kanban-gmap/`
   - **Redirect URLs**: adicione o mesmo endereço.
   - Isso é necessário para o link de "Esqueci minha senha" funcionar.

### 4. Preencher o `config.js`

1. No Supabase, abra **Project Settings > API** (ou **Data API**).
2. Copie o **Project URL** e a chave **anon public**.
3. Cole no `config.js`:

```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...',
  APP_NAME: 'Kanban GMAP',
  ORG_NAME: 'Gerência de Material e Patrimônio | SEDUC-PI'
};
```

> A chave **anon** é pública por natureza e pode ficar no site. **Nunca** coloque a chave `service_role` no `config.js`.

### 5. Publicar no GitHub Pages

1. Em **github.com**, crie um repositório (ex.: `kanban-gmap`).
2. Clique em **Add file > Upload files** e envie `index.html`, `app.js`, `style.css`, `config.js`, `README.md` e a pasta `supabase`.
3. Em **Settings > Pages**, em **Source** escolha **Deploy from a branch**, branch **main**, pasta **/ (root)** e salve.
4. Em 1 a 2 minutos o endereço aparece no topo da página de configurações. Confira se é o mesmo informado no passo 3.

> Repositório público no plano gratuito do GitHub é o padrão para o Pages. Isso expõe apenas o código, não os dados: os dados ficam no Supabase, protegidos por login e permissões.

### 6. Primeiro acesso

1. Abra o endereço do sistema e clique em **Criar conta**.
2. **A primeira conta criada vira administrador automaticamente.** Faça esse cadastro você mesmo.
3. Entre em **Administração** (canto superior direito) e:
   - Informe o domínio permitido (ex.: `seduc.pi.gov.br`) para bloquear cadastros com e-mails pessoais.
   - Mantenha marcada a opção de aprovação de novos cadastros.
4. Envie o link para os colegas. Cada um cria a própria conta e você aprova na tela de Administração.
5. Crie os quadros e adicione os colegas em **Membros**, escolhendo o perfil de cada um.

---

## Uso no dia a dia

- **Abrir um cartão:** clique nele. O endereço da página muda e pode ser copiado para enviar a um colega (botão "Copiar link").
- **Mover:** arraste o cartão; no celular, toque e segure por um instante antes de arrastar.
- **Concluir:** marque a caixa ao lado da data de entrega (ou "Marcar como concluído").
- **Arquivar x excluir:** prefira **arquivar**. Itens arquivados ficam em **Menu > Itens arquivados** e podem ser restaurados. A exclusão é definitiva e só o dono do quadro ou o administrador consegue fazer.
- **Atalhos:** `Enter` adiciona cartão ou item; `Shift + Enter` quebra linha; `Ctrl + Enter` envia comentário; `Esc` fecha janelas.
- **Relatório:** **Menu > Exportar planilha (CSV)** gera uma planilha com lista, responsáveis, prazos, situação e progresso de checklist.

## Sugestões de quadros para o setor

- **Demandas da gerência:** A receber, Em análise, Aguardando outro setor, Concluído.
- **Processos de aquisição:** Planejamento, Pesquisa de preços, Termo de referência, Jurídico, Licitação, Contratado.
- **Inventário e patrimônio:** por escola ou por regional, com checklist de etapas de conferência.

Use a etiqueta **Processo SEI** e coloque o número do processo no título ou na descrição: a busca encontra pelo número.

---

## Manutenção

**Pausa do plano gratuito.** O Supabase pausa projetos gratuitos após cerca de 7 dias sem nenhum acesso (ex.: recesso de fim de ano). Os dados não se perdem: basta entrar no painel do Supabase e clicar em **Restore project**. Com uso diário isso não acontece.

**Cópia de segurança.** O plano gratuito não guarda backups restauráveis por você. Recomendações:
- Exporte o CSV dos quadros principais periodicamente; e/ou
- No Supabase, **Database > Backups** (planos pagos) ou use `pg_dump` com a senha do banco.

**Recuperar acesso de administrador.** Se o único administrador perder o acesso, execute no SQL Editor (trocando o e-mail):

```sql
update public.profiles set is_admin = true, status = 'active'
where email = 'seu.email@seduc.pi.gov.br';
```

**Consultar o histórico completo** (útil para auditoria), no SQL Editor:

```sql
select a.created_at, a.user_name, b.title as quadro, a.action, a.details
from public.activity a left join public.boards b on b.id = a.board_id
order by a.created_at desc
limit 500;
```

## Solução de problemas

| Sintoma | Causa provável e solução |
|---|---|
| Tela "Configuração pendente" | O `config.js` não foi preenchido ou não foi enviado ao GitHub |
| "Perfil não encontrado" após entrar | O `schema.sql` não foi executado. Execute o script (ele cria o perfil de quem já tinha se cadastrado) e peça para a pessoa clicar em "Verificar novamente" |
| "Cadastro recusado" | O e-mail não é do domínio permitido em Administração |
| Link de redefinir senha abre página errada | Ajuste **Site URL** e **Redirect URLs** (passo 3) |
| Não recebe o e-mail de confirmação | Limite de envio do plano gratuito. Desative "Confirm email" (passo 3) ou configure um SMTP próprio em **Authentication > Emails** |
| Alterações de colegas não aparecem sozinhas | Recarregue a página. Confira em **Database > Publications** se `supabase_realtime` inclui `activity`, `cards` e `lists` |

## Cuidados com dados

O Supabase é um serviço em nuvem externo ao Estado. Antes de adotar oficialmente, vale alinhar com a área de TI da Secretaria. Evite registrar nos cartões dados pessoais sensíveis (CPF, dados de saúde etc.); use o número do processo SEI como referência ao documento oficial.
