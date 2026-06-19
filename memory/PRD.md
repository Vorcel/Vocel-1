# PRD — Sistema de Licitações (LicitaSys)

## Problem Statement
Centralized, modular Brazilian public bidding (licitações) management system — a Single Page Application with 5 interconnected screens, smart collapsible sidebar, top header with settings + avatar, light/dark theme. Cross-screen data integrity: dashboard month-card tracks bid disputa dates; bids set to "Adjudicado" auto-migrate to the post-sale screen; budget (ERP) totals feed post-sale financial columns.

## User & Choices
- Single operator/admin persona managing bids end-to-end.
- JWT email/password auth · MongoDB persistence · real object storage uploads · PT-BR · light theme default + dark toggle.

## Architecture
- Backend: FastAPI (`/app/backend`): `server.py` (app+startup), `auth.py` (Bearer JWT), `storage.py` (Emergent object storage `/api/upload`,`/api/files/{id}`), `routes.py` (bids, lists/params, budget, executions, company, preferences), `db.py`.
- Frontend: React + Tailwind + shadcn. Global state via `DataContext`; `AuthContext`, `ThemeContext`. Pages: Dashboard(T1), AllBids(T5), Budget/ERP(T2), Settings(T3), Execution(T4).
- Collections: users, bids, budgets, executions, params, company, preferences, files.

## Implemented (2026-05-31)
- Auth: login/register/me/profile/change-password (admin@licita.com / admin123 seeded).
- Tela 1 Dashboard: 3 summary cards (mês/adjudicadas/acompanhando, reactive), Today hero alerts (big session time), Nova Licitação modal (validation + itens regex + retroactive-date block + PDF drag-drop), quick filters + advanced offcanvas, 11-col table (star, item badges, status colored dropdown, PDF, orçamento link, edit, delete w/ 7s undo).
- Tela 5: same filter section + table, no cards.
- Tela 2 ERP: 21-col sticky spreadsheet, mutual exclusion VALOR VENDA <-> MARGEM (yellow), green profit / blue value columns, 4 global cards summing only selected rows; tax-inclusive markup engine in `lib/calc.js`.
- Tela 3 Settings: 5 tabs (Perfil+senha, Empresa+logo, Aparência light/dark, Padrões ICMS/PIS, Listas/Parâmetros CRUD).
- Tela 4 Execution: auto-created on Adjudicado; 3 KPI cards; master 11-col table (delivery-time modal, computed delivery date, financial inheritance from budget summary, 4 action icons); 10-step timeline with file uploads; donut progress; status<->step sync; document tabs.
- Verified: 26/26 backend pytest; frontend e2e (1 ERP bug found & fixed).

## Updates (Iteration 2)
- Dashboard cards renomeados (PARTICIPAÇÕES NO MÊS / ADJUDICADAS / EM ACOMPANHAMENTO) + badges de variação % (verde/vermelho) vs mês anterior.
- Modal Nova Licitação: asteriscos vermelhos, todos os campos obrigatórios exceto Observação (Pregão/UASG/PDF agora obrigatórios), Salvar bloqueado até validar.
- Cores globais de Status/Portais/Modalidades: listas agora são {nome,cor} com color picker + edição na Tela 3; dropdowns de status renderizam a cor definida (reativo). Rename propaga retroativamente às licitações.
- Date Range Picker (período DD/MM/AAAA até DD/MM/AAAA) nos filtros das Telas 1/4/5; Data da Disputa no modal segue data única.
- Filtros cumulativos (AND) + botão rápido de favoritos na barra de filtros.
- Colunas redimensionáveis (estilo Excel: table-layout fixed + ellipsis) em todas as tabelas (Telas 1/2/4/5), largura persistida em localStorage.

## Updates (Iteration 3 — Design System "White-on-Ice")
- Tipografia global Hanken Grotesk; tokens de cor refeitos (fundo gelo #f6faff, superfícies brancas, primário/brand Deep Charcoal #121417, texto #141d23, erro #ba1a1a) via CSS vars theme-aware (brand = hsl(var(--brand)/alpha)).
- Cores vibrantes reservadas para Tags de Portal (pílulas coloridas dinâmicas) e badges de Status.
- Sidebar fundo #E9ECEF; tabelas borderless com divisores sutis, hover tintado e botões de ação "ghost" (aparecem no hover da linha); inputs com borda sutil e foco charcoal; raios soft-modern.
- ErrorBoundary adicionado em volta do Outlet (uma falha de tela não derruba o app inteiro).
- Verificado: 100% frontend (iteration_4), round-trip bid→Adjudicado→Execução→ERP OK. Nota não-bloqueante: warning cosmético do Recharts no mount da Execução.

## Updates (Iteration 4 — Linha do tempo horizontal na Execução)
- "Gestão Detalhada" (Tela 4): linha do tempo agora HORIZONTAL com ícone por etapa (FileText, ClipboardCheck, ShoppingCart, Package, PackageCheck, Receipt, PackageOpen, Truck, CheckCircle2, Banknote). Estados: concluído = círculo charcoal preenchido (ícone branco), atual = círculo branco com anel charcoal, futuro = cinza muted; conectores charcoal/cinza.
- Nome do OBJETO em destaque (h2 grande) no topo do painel + subtítulo (modalidade • portal • Empenho) e badges de status + "Pagamento Pendente".
- Cada etapa mostra badge (Concluído/Em Andamento/Pendente) + chips de arquivo + uploader; donut e Resumo movidos para grade abaixo. Clique na etapa sincroniza status/donut. Verificado 100% (iteration_6).

## Updates (Iteration 7 — Tela 2 ERP estilo Excel)
- Edição inline: células viram `<input>` ao clicar (testid `-view` → input). Commit no Enter/Blur, cancela no Esc; spinners ocultos.
- Auto-save: removido o botão "Salvar" global; salvamento debounced (~1s) do orçamento inteiro via PUT `/bids/{id}/budget`. Indicador `budget-save-state` (Salvando/Salvo/Salvo na nuvem).
- Motor `calc.js`: ICMS "por fora" (base = Valor Compra + Outros C/ Imposto); `Preço = (Custo+Imposto)×(1+Margem%)`; novos campos `markup` e `margem_real`.
- Novas colunas: MARGEM DESEJADA (markup editável, amarela), MARGEM REAL (somente leitura, laranja), IMPOSTO UN. Exclusão mútua Valor Venda ↔ Margem Desejada mantida.
- Formatação no modo leitura: moeda R$ 0,00 e percentual 0,0%.
- Ocultar/Reexibir colunas via menu de contexto (botão direito no `<th>`, testid `col-context-menu`); SELECIONAR não pode ser oculta; estado em localStorage `erp_hidden`.
- Redimensionamento em lote: Ctrl/Shift+clique seleciona colunas; arrastar uma aplica a mesma largura px às selecionadas (`useColumnResize.startResize(i, syncIndices)`).
- Verificado: frontend 100% (iteration_7), persistência server-side OK.

## Updates (Iteration 8 — Tela 2 ERP: 4 refinamentos fiscais/UX)
- Custo: PIS/COFINS "por dentro" (gross-up) embutido no Custo Base Un. = Custo Inicial ÷ (1 − PIS%/100); ICMS mantido "por fora" sobre (Valor Compra + Outros C/ Imposto). Coluna "IMPOSTO UN." removida.
- Margem Real "por dentro": markup sobre o Custo Total (mesma base/fórmula da Margem Desejada); ambas alinham. `calc.js` atualizado.
- Reordenação das colunas finais: CUSTO BASE UN. → LUCRO UNIT. → VALOR DA UNIDADE → LUCRO TOTAL → VALOR TOTAL.
- Formatação condicional de prejuízo: LUCRO UNIT./LUCRO TOTAL negativos ficam vermelhos (texto #D93025, fundo #FCE8E6).
- Seleção de colunas por arraste (+ Ctrl/Shift), destaque #E8F0FE em header e células; "Ocultar Colunas (N)" no menu de contexto; indicador `hidden-col-indicator` com duplo-clique p/ reexibir.
- Navegação por teclado: Enter/Tab salva e avança o foco p/ a próxima célula editável à direita (pula calculadas/SELECIONAR/SITE; quebra p/ próxima linha).
- Verificado: frontend 100% (iteration_8).

## Updates (Iteration 9 — Tela 2 ERP: frete, exclusão mútua, cabeçalhos, seleção)
- Frete Receber agora SOMA ao custo (mesma mecânica do Frete Enviar) — `calc.js`.
- Margem Desejada sempre desbloqueada (sem readonly/disabled); exclusão mútua bidirecional com Valor Venda (digitar em uma limpa a outra; último comando vence). Margem Real continua read-only mostrando o markup.
- Cabeçalhos compostos em 2 linhas (campo `head` por coluna; ex.: PIS/ + COFINS, MARGEM + DESEJADA), com `white-space: normal; line-height: 1.2` — sem afetar o resize.
- Click-outside: clicar fora de um `<th>` (fundo, card ou célula) limpa a seleção de colunas e o destaque.
- Regressão: testes unitários `src/lib/__tests__/calc.test.js` (5/5) travando as regras do motor (frete soma, PIS por dentro, ICMS por fora, margem markup, lucro negativo).
- Verificado: frontend 100% (iteration_9) + unit tests verdes.

## Updates (Iteration 10 — Fonte numérica, cadastro fechado, margem por dentro)
- Tipografia: fonte condensada 'CondNum' (Roboto Condensed) aplicada EXCLUSIVAMENTE aos dígitos 0-9 via `@font-face unicode-range U+0030-0039`; letras seguem Hanken Grotesk. `tabular-nums` global. CondNum incluído em body, h1-5, `.font-mono-num` e nas famílias do Tailwind (sans/heading/mono) → cobertura global.
- Segurança: cadastro público DESATIVADO. `POST /api/auth/register` → 403 (sem gravar usuário); Login.jsx só com login (sem "Cadastre-se"/Nome); rotas `/register` e `/cadastro` → `/login`; `*` autenticado → `/`. Login/tokens/seed/admin preservados.
- Cálculo (Tela 2): Margem "por dentro" (markup divisor) → `VALOR UNIDADE = Custo Total / (1 - Margem%/100)`; `MARGEM REAL = (Preço - Custo Total)/Preço`. ICMS mantido "por fora" no Custo Total (opção C). Cascata recalcula Lucro Unit/Total e Valor Total.
- Verificado: backend 29/29 pytest (`/app/backend/tests/backend_test.py`), frontend 100% (iteration_10), 5/5 unit tests `calc.test.js` (R$100 + 10% = R$111,11).

## Updates (Iteration 11 — Tabela de Licitações: 6 requisitos + Single Source of Truth)
- Single Source of Truth confirmado: Dashboard ('/') e 'Todas as Licitações' ('/licitacoes') usam os mesmos componentes (BidsSection/BidsTable/AdvancedFilterSidebar/BidFormModal) — toda mudança reflete nas duas.
- #1 Coluna "Observação" (tags/chips coloridos): adicionar (+), editar inline (clique no texto), excluir com modal de confirmação. Substituiu o ícone de balão. Persiste via `PATCH /api/bids/{id}/observacoes` (campo `observacoes:[{id,text,color}]`); integrada no modal de cadastro/edição. Migra `observacao` (string) legada.
- #2 Drawer de Filtros Avançados: slide-in da direita + backdrop, header+subtítulo, De/Até, Portal "Todos os Portais", Modalidade (toggle buttons), Status (chips multi-seleção com bolinha colorida, OR), footer fixo Limpar/Aplicar. Status do filtro agora é array.
- #3 Itens: badges com fundos pastel alternados não-repetitivos (`tagColorAt`), número escuro.
- #4 Badges Portal/Status: texto preto (#1A1A1A) com fundo/borda temáticos (`colorStyles().badgeDark`); bolinha mantém cor.
- #5 Ordem das colunas: Modalidade > Portal > Itens (+ Observação ao lado de Objeto).
- #6 Ordenação por coluna: setas duplas, asc/desc, type-aware (texto pt-BR numeric, datas cronológicas) — `bid-th-<key>`.
- Verificado: backend 31/31 pytest, frontend 100% em ambas as rotas (iteration_11).

## Updates (Iteration 12 — Tabela de Licitações: PROP., ordenação restrita, multi-anexos, portal texto, title case, painel fluido)
- #1 Coluna "PROP." com toggle "P" por linha (cinza→azul, persiste via `PATCH /api/bids/{id}/proposta`) + botão "P" de filtro rápido no cabeçalho (ao lado da estrela) + "Status da Proposta" (Todas/Enviadas/Não Enviadas) no drawer.
- #2 Ordenação acionada SOMENTE pelo ícone de setas (não no texto/th); cursor pointer só nas setas; `stopPropagation`.
- #3 Múltiplos anexos: `BidInput.anexos[]`; modal aceita Termo (obrigatório) + Anexos adicionais; coluna "Arquivos" mostra ícone (1 arquivo abre direto) ou badge numérico laranja + Popover com lista (2+), abrindo cada arquivo em nova guia (click-away fecha).
- #4 Portal renderizado como texto em negrito colorido (cor dinâmica do parâmetro), sem badge/fundo/borda, com truncagem.
- #5 Smart Title Case (`lib/textcase.js`) aplicado no blur do campo Objeto (1ª letra maiúscula por palavra, exceto preposições/artigos; 1ª palavra sempre maiúscula). Não aplica em email/senha.
- #6 Painel "Licitações do Dia" em largura total (removido maxWidth fixo).
- a11y: drawer usa SheetTitle/SheetDescription. Verificado: frontend 100% (iteration_12) nas 2 rotas; backend pytest +2 testes (proposta, anexos).

## Updates (Iteration 13 — Tela 2 ERP: Lote, trava qtd=0, Margem Real verde, confirmação de exclusão)
- #1 Coluna "LOTE" entre SELECIONAR e ITEM (default "Lote 1"); célula é dropdown 1-5 + "Adicionar" (somente números) com máscara "Lote N". Filtro global "Filtrar por Lote" (multi-select) filtra a tabela.
- #1.4/1.5 Cartões dinâmicos por lote (camadas), 5 cards na ordem: Lote N (texto) | Valor Total (azul) | Lucro do Lote (verde) | Margem do Lote (laranja) | Valor Investido (branco). Soma APENAS linhas marcadas (checkbox) E do lote (`computeLote`). Layout flex: cartões scrolláveis + tabela preenche o resto.
- #2 Trava qtd=0/vazia: zera Valor Total, Lucro Total, Custo, Investido e Margem Real da linha (não soma nos cartões). `calc.js` usa divisor seguro para rateio por unidade.
- #3 Margem Real em verde (`text-emerald-700`, mesmo tom do Lucro).
- #4 Exclusão de linha com AlertDialog (Cancelar / Excluir vermelho); recalcula cartões após confirmar.
- Verificado: frontend 100% (iteration_13), persistência do campo `lote` após reload, 5/5 unit tests.

## Backlog
- P1: Produtos/Entregas/Notas Fiscais/Atestados/Comunicações/Histórico tabs in Tela 4 (currently placeholders).
- P2: Export/print proposal PDF from ERP; brute-force lockout & password reset email; pagination on large tables; per-row delivery sub-tracking.

## Changelog
- 2026-06-19: Realocados os 3 cards indicadores do Dashboard (Participações no Mês, Adjudicadas, Em Acompanhamento) para o Header fixo como mini-cards (ícone + label + número + delta) via `leftContent`. Subtítulo removido; corpo inicia no banner "Licitações do Dia".

## Test Credentials
admin@licita.com / admin123 — see /app/memory/test_credentials.md
