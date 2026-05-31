"""Backend regression tests for Sistema de Licitações.

Covers: auth, lists, bids CRUD, dashboard summary, budget ERP, executions
(Adjudicado auto-creation + budget financial propagation), preferences, company.
"""
import os
import io
import uuid
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://licit-central.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@licita.com"
ADMIN_PASSWORD = "admin123"


# -------------------- fixtures --------------------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and "user" in data
    return data["token"]


@pytest.fixture(scope="session")
def session(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def created_bid_ids():
    return []


# -------------------- AUTH --------------------
class TestAuth:
    def test_login_admin(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d.get("token"), str) and len(d["token"]) > 20
        assert d["user"]["email"] == ADMIN_EMAIL
        assert "id" in d["user"]
        assert "password_hash" not in d["user"]

    def test_login_invalid(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=30)
        assert r.status_code == 401

    def test_me_requires_auth(self):
        r = requests.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 401

    def test_me_with_token(self, session):
        r = session.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_register_and_duplicate(self):
        email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{API}/auth/register", json={"name": "TEST User", "email": email, "password": "pass1234"}, timeout=30)
        assert r.status_code == 200
        assert "token" in r.json()
        # duplicate
        r2 = requests.post(f"{API}/auth/register", json={"name": "TEST User", "email": email, "password": "pass1234"}, timeout=30)
        assert r2.status_code == 400


# -------------------- LISTS --------------------
class TestLists:
    def test_get_lists_defaults(self, session):
        r = session.get(f"{API}/lists", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "Pregão Eletrônico" in d["modalidades"]
        assert "Comprasnet" in d["portais"]
        assert "Adjudicado" in d["statuses"]

    def test_add_and_remove_list_item(self, session):
        marker = f"TEST_MOD_{uuid.uuid4().hex[:6]}"
        r = session.post(f"{API}/lists/modalidades", json={"value": marker}, timeout=30)
        assert r.status_code == 200
        assert marker in r.json()["modalidades"]
        r2 = session.delete(f"{API}/lists/modalidades/{marker}", timeout=30)
        assert r2.status_code == 200
        assert marker not in r2.json()["modalidades"]

    def test_invalid_list_type(self, session):
        r = session.post(f"{API}/lists/badtype", json={"value": "x"}, timeout=30)
        assert r.status_code == 400


# -------------------- BIDS CRUD --------------------
def _bid_payload(status="Disputar", objeto="TEST_BID"):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return {
        "objeto": objeto,
        "modalidade": "Pregão Eletrônico",
        "itens": "1, 2, 3",
        "portal": "Comprasnet",
        "data_disputa": today,
        "hora": "10:00",
        "pregao": "PE001/2026",
        "uasg": "123456",
        "observacao": "teste",
        "status": status,
        "favorito": False,
    }


class TestBidsCRUD:
    def test_create_bid(self, session, created_bid_ids):
        r = session.post(f"{API}/bids", json=_bid_payload(), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["objeto"] == "TEST_BID"
        assert d["modalidade"] == "Pregão Eletrônico"
        assert d["itens_list"] == ["1", "2", "3"]
        assert "id" in d and "_id" not in d
        created_bid_ids.append(d["id"])

    def test_list_bids(self, session, created_bid_ids):
        r = session.get(f"{API}/bids", timeout=30)
        assert r.status_code == 200
        ids = [b["id"] for b in r.json()]
        assert created_bid_ids[0] in ids

    def test_update_bid(self, session, created_bid_ids):
        bid_id = created_bid_ids[0]
        p = _bid_payload(objeto="TEST_BID_UPDATED")
        r = session.put(f"{API}/bids/{bid_id}", json=p, timeout=30)
        assert r.status_code == 200
        assert r.json()["objeto"] == "TEST_BID_UPDATED"
        # Verify via GET
        g = session.get(f"{API}/bids/{bid_id}", timeout=30)
        assert g.status_code == 200 and g.json()["objeto"] == "TEST_BID_UPDATED"

    def test_toggle_favorite(self, session, created_bid_ids):
        bid_id = created_bid_ids[0]
        r = session.patch(f"{API}/bids/{bid_id}/favorite", json={"favorito": True}, timeout=30)
        assert r.status_code == 200
        assert r.json()["favorito"] is True

    def test_dashboard_summary_reflects(self, session, created_bid_ids):
        r = session.get(f"{API}/dashboard/summary", timeout=30)
        assert r.status_code == 200
        d = r.json()
        # We created one bid for current month + favorited above
        assert d["licitacoes_mes"] >= 1
        assert d["acompanhando"] >= 1
        assert isinstance(d["adjudicadas"], int)


# -------------------- ADJUDICADO -> EXECUTION AUTO-CREATE --------------------
class TestExecutionAutoCreate:
    def test_change_status_to_adjudicado_creates_execution(self, session, created_bid_ids):
        bid_id = created_bid_ids[0]
        r = session.patch(f"{API}/bids/{bid_id}/status", json={"status": "Adjudicado"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "Adjudicado"
        # execution must exist
        e = session.get(f"{API}/executions/{bid_id}", timeout=30)
        assert e.status_code == 200, f"Execution not auto-created: {e.text}"
        doc = e.json()
        assert doc["bid_id"] == bid_id
        assert doc["status_atual"] == "Aguardando Empenho"
        assert doc["current_step"] == 0
        assert len(doc["timeline"]) == 10

    def test_list_executions_contains(self, session, created_bid_ids):
        bid_id = created_bid_ids[0]
        r = session.get(f"{API}/executions", timeout=30)
        assert r.status_code == 200
        assert any(e["bid_id"] == bid_id for e in r.json())

    def test_execution_kpis(self, session):
        r = session.get(f"{API}/executions/kpis", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("lucro_total", "em_andamento", "pagamentos_pendentes"):
            assert k in d
        assert d["em_andamento"] >= 1

    def test_idempotent_adjudicado(self, session, created_bid_ids):
        # Re-trigger status set; should not create duplicate
        bid_id = created_bid_ids[0]
        r = session.patch(f"{API}/bids/{bid_id}/status", json={"status": "Adjudicado"}, timeout=30)
        assert r.status_code == 200
        all_exec = session.get(f"{API}/executions", timeout=30).json()
        matching = [e for e in all_exec if e["bid_id"] == bid_id]
        assert len(matching) == 1


# -------------------- BUDGET ERP & PROPAGATION --------------------
class TestBudget:
    def test_get_budget_defaults(self, session, created_bid_ids):
        bid_id = created_bid_ids[0]
        r = session.get(f"{API}/bids/{bid_id}/budget", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["bid_id"] == bid_id
        assert "defaults" in d
        assert "icms" in d["defaults"] and "pis_cofins" in d["defaults"]

    def test_save_budget_propagates_to_execution(self, session, created_bid_ids):
        bid_id = created_bid_ids[0]
        rows = [{"item": "1", "selecionado": True, "valor_venda": 1000, "valor_compra": 600, "qtd": 2}]
        summary = {"valor_total": 2000.0, "custo_global": 1200.0, "lucro_global": 800.0, "margem_global": 40.0}
        r = session.put(f"{API}/bids/{bid_id}/budget", json={"rows": rows, "summary": summary}, timeout=30)
        assert r.status_code == 200
        # GET budget and confirm persisted
        g = session.get(f"{API}/bids/{bid_id}/budget", timeout=30)
        assert g.status_code == 200
        gd = g.json()
        assert gd["summary"]["valor_total"] == 2000.0
        assert gd["rows"][0]["valor_venda"] == 1000
        # Verify execution inheritance
        e = session.get(f"{API}/executions/{bid_id}", timeout=30)
        assert e.status_code == 200
        ed = e.json()
        assert ed["valor_empenho"] == 2000.0
        assert ed["valor_compra"] == 1200.0
        assert ed["lucro_previsto"] == 800.0


# -------------------- EXECUTION UPDATES --------------------
class TestExecutionUpdates:
    def test_update_status_syncs_step(self, session, created_bid_ids):
        bid_id = created_bid_ids[0]
        r = session.put(f"{API}/executions/{bid_id}", json={"status_atual": "Empenho Recebido"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["status_atual"] == "Empenho Recebido"
        assert d["current_step"] == 1

    def test_update_step_syncs_status(self, session, created_bid_ids):
        bid_id = created_bid_ids[0]
        r = session.put(f"{API}/executions/{bid_id}", json={"current_step": 3}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["current_step"] == 3
        assert d["status_atual"] == "Aguardando Mercadoria"


# -------------------- COMPANY & PREFERENCES --------------------
class TestSettings:
    def test_preferences_get_default(self, session):
        r = session.get(f"{API}/preferences", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "theme" in d
        assert "icms_padrao" in d

    def test_preferences_update(self, session):
        r = session.put(f"{API}/preferences", json={"icms_padrao": 17.5, "theme": "light"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["icms_padrao"] == 17.5

    def test_company_update(self, session):
        payload = {"razao_social": "TEST EMPRESA LTDA", "cnpj": "00.000.000/0001-00"}
        r = session.put(f"{API}/company", json=payload, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["razao_social"] == "TEST EMPRESA LTDA"
        # GET verify
        g = session.get(f"{API}/company", timeout=30).json()
        assert g["razao_social"] == "TEST EMPRESA LTDA"


# -------------------- FILE UPLOAD --------------------
class TestFiles:
    def test_upload_and_fetch(self, admin_token):
        files = {"file": ("test.txt", io.BytesIO(b"hello world from test"), "text/plain")}
        r = requests.post(f"{API}/upload", files=files, headers={"Authorization": f"Bearer {admin_token}"}, timeout=60)
        assert r.status_code == 200, f"Upload failed: {r.status_code} {r.text}"
        d = r.json()
        assert "id" in d and d["url"].startswith("/api/files/")
        # fetch
        f = requests.get(f"{BASE_URL}{d['url']}", timeout=30)
        assert f.status_code == 200
        assert b"hello world" in f.content


# -------------------- CLEANUP --------------------
class TestZCleanup:
    """Runs last alphabetically to clean up TEST_ data."""
    def test_delete_created_bids(self, session, created_bid_ids):
        for bid_id in created_bid_ids:
            r = session.delete(f"{API}/bids/{bid_id}", timeout=30)
            assert r.status_code == 200
            # confirm 404 on get
            g = session.get(f"{API}/bids/{bid_id}", timeout=30)
            assert g.status_code == 404
            # execution should also be gone
            e = session.get(f"{API}/executions/{bid_id}", timeout=30)
            assert e.status_code == 404
