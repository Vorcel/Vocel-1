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

## Backlog
- P1: Produtos/Entregas/Notas Fiscais/Atestados/Comunicações/Histórico tabs in Tela 4 (currently placeholders).
- P2: Export/print proposal PDF from ERP; brute-force lockout & password reset email; pagination on large tables; per-row delivery sub-tracking.

## Test Credentials
admin@licita.com / admin123 — see /app/memory/test_credentials.md
