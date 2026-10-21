"""
Devrantas ERP - Backend regression tests (pytest).
Covers: auth, accounts, sites, transactions (kasa validation, approvals, check auto-creation),
progress payments (overhead/vat/net calc + site summary effect), avans ledger behaviour,
kasa/dashboard/reports, PDFs & Excel exports, contracts/proposals/payments, reminders,
role-based auth, AI endpoints (lightweight).
"""
import os
import time
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    # Fallback: read from frontend/.env (testing env)
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    BASE_URL = line.split("=", 1)[1].strip()
                    break
    except Exception:
        pass
BASE_URL = (BASE_URL or "").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@devrantas.com"
ADMIN_PASSWORD = "Devrantas2026!"

TODAY = date.today().isoformat()
DUE_IN_5 = (date.today() + timedelta(days=5)).isoformat()


# -------------------- Fixtures --------------------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}",
                      "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def muhasebe(admin):
    """Create a non-admin muhasebe user and return an authenticated session."""
    email = f"muhasebe_{uuid.uuid4().hex[:8]}@example.com"
    pwd = "Testpass123!"
    r = admin.post(f"{API}/auth/register-sub",
                   json={"email": email, "password": pwd, "name": "Test Muhasebe", "role": "muhasebe"})
    assert r.status_code in (200, 201), f"register-sub failed: {r.status_code} {r.text}"
    s = requests.Session()
    lr = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    assert lr.status_code == 200
    s.headers.update({"Authorization": f"Bearer {lr.json()['access_token']}",
                      "Content-Type": "application/json"})
    return s


# Session-scoped entity fixtures - each xdist worker creates its own
@pytest.fixture(scope="session")
def musteri_id(admin):
    r = admin.post(f"{API}/accounts", json={"name": f"TEST_Müşteri_{uuid.uuid4().hex[:6]}",
                                             "type": "musteri"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture(scope="session")
def taseron_id(admin):
    r = admin.post(f"{API}/accounts", json={"name": f"TEST_Taşeron_{uuid.uuid4().hex[:6]}",
                                             "type": "taseron", "specialty": "Kaba inşaat"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture(scope="session")
def site_id(admin, musteri_id):
    payload = {"name": f"TEST_Site_{uuid.uuid4().hex[:6]}", "contract_amount": 1_000_000,
               "customer_id": musteri_id, "status": "devam", "progress_percent": 10}
    r = admin.post(f"{API}/sites", json=payload)
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture(scope="session")
def hakedis_id(admin, site_id, taseron_id):
    items = [{"description": "Kaba yapı", "unit": "m²", "quantity": 100, "unit_price": 1000}]
    r = admin.post(f"{API}/progress-payments",
                   json={"site_id": site_id, "account_id": taseron_id, "type": "taseron",
                         "date": TODAY, "items": items, "vat_rate": 20, "apply_overhead": True})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture(scope="session")
def proposal_id(admin):
    r = admin.post(f"{API}/proposals",
                   json={"title": "TEST Teklif Export", "date": TODAY,
                         "items": [{"description": "A", "quantity": 1, "unit_price": 100}]})
    assert r.status_code == 201
    return r.json()["id"]


@pytest.fixture(scope="session")
def contract_id(admin, taseron_id, site_id):
    r = admin.post(f"{API}/contracts",
                   json={"title": "TEST Export Sözleşme", "party_type": "taseron",
                         "account_id": taseron_id, "site_id": site_id, "date": TODAY,
                         "duration_days": 60,
                         "items": [{"description": "İş kalemi", "quantity": 10, "unit_price": 500}],
                         "vat_rate": 20})
    assert r.status_code == 201
    return r.json()["id"]


# Shared state for created entities
state = {}


# -------------------- 1. Auth --------------------
class TestAuth:
    def test_login_success(self, admin_token):
        assert isinstance(admin_token, str) and len(admin_token) > 20

    def test_me(self, admin):
        r = admin.get(f"{API}/auth/me")
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == ADMIN_EMAIL
        assert d["role"] == "yonetici"

    def test_login_bad_password(self):
        # Use a random-ish email to avoid lockout on admin account across tests
        r = requests.post(f"{API}/auth/login",
                          json={"email": f"nouser_{uuid.uuid4().hex[:6]}@x.io",
                                "password": "wrong"}, timeout=30)
        assert r.status_code == 401

    def test_unauthorized_without_token(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401


# -------------------- 2. Accounts --------------------
class TestAccounts:
    def test_create_musteri(self, musteri_id):
        assert musteri_id

    def test_create_taseron(self, taseron_id):
        assert taseron_id

    def test_list_by_type(self, admin, taseron_id):
        r = admin.get(f"{API}/accounts?type=taseron")
        assert r.status_code == 200
        ids = [a["id"] for a in r.json()]
        assert taseron_id in ids

    def test_statement_empty(self, admin, taseron_id):
        r = admin.get(f"{API}/accounts/{taseron_id}/statement")
        assert r.status_code == 200
        d = r.json()
        assert "account" in d and "rows" in d
        assert isinstance(d["rows"], list)


# -------------------- 3. Sites --------------------
class TestSites:
    def test_create_site_overhead(self, admin, site_id):
        d = admin.get(f"{API}/sites/{site_id}").json()
        s = d["summary"]
        assert s["overhead_rate"] == 0.06
        assert s["overhead_amount"] == 60000.0
        assert s["net_contract"] == 940000.0

    def test_assign_taseron_to_site(self, admin, site_id, taseron_id):
        r = admin.post(f"{API}/accounts/{taseron_id}/assign-site",
                       json={"site_id": site_id})
        assert r.status_code == 200
        acc = admin.get(f"{API}/accounts/{taseron_id}").json()
        assert site_id in acc["site_ids"]


# -------------------- 4. Transactions --------------------
class TestTransactions:
    def test_kasa_required_422_or_400(self, admin, site_id):
        r = admin.post(f"{API}/transactions",
                       json={"type": "gider", "category": "Malzeme", "amount": 1000,
                             "date": TODAY, "site_id": site_id})
        assert r.status_code in (400, 422), r.text

    def test_gider_creates_onay_bekliyor(self, admin, site_id):
        r = admin.post(f"{API}/transactions",
                       json={"type": "gider", "category": "Malzeme", "amount": 5000,
                             "date": TODAY, "site_id": site_id, "kasa": "nakit",
                             "description": "TEST malzeme alımı"})
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["status"] == "onay_bekliyor"
        state["expense_id"] = d["id"]

    def test_approve_expense_updates_site_summary(self, admin, site_id):
        site_before = admin.get(f"{API}/sites/{site_id}").json()["summary"]
        r = admin.post(f"{API}/transactions/{state['expense_id']}/approve")
        assert r.status_code == 200
        site_after = admin.get(f"{API}/sites/{site_id}").json()["summary"]
        assert site_after["total_expense"] - site_before["total_expense"] == pytest.approx(5000.0)
        assert site_after["direct_expense"] - site_before["direct_expense"] == pytest.approx(5000.0)

    def test_gelir_auto_approved(self, admin, site_id, musteri_id):
        r = admin.post(f"{API}/transactions",
                       json={"type": "gelir", "category": "Hakediş Tahsilatı", "amount": 2500,
                             "date": TODAY, "site_id": site_id,
                             "account_id": musteri_id, "kasa": "nakit"})
        assert r.status_code == 201
        assert r.json()["status"] == "onaylandi"

    def test_taseron_avansi_without_account_400(self, admin, site_id):
        r = admin.post(f"{API}/transactions",
                       json={"type": "gider", "category": "Taşeron Avansı", "amount": 1000,
                             "date": TODAY, "site_id": site_id, "kasa": "nakit"})
        assert r.status_code == 400

    def test_cek_with_due_date_creates_check(self, admin, site_id, musteri_id):
        before = admin.get(f"{API}/checks?direction=alinan").json()
        r = admin.post(f"{API}/transactions",
                       json={"type": "gelir", "category": "Hakediş Tahsilatı", "amount": 7777,
                             "date": TODAY, "site_id": site_id,
                             "account_id": musteri_id, "kasa": "cek",
                             "check_due_date": DUE_IN_5, "check_bank": "Ziraat",
                             "check_no": "A" + uuid.uuid4().hex[:6]})
        assert r.status_code == 201, r.text
        tx = r.json()
        assert tx.get("check_id")
        checks = admin.get(f"{API}/checks?direction=alinan").json()
        assert len(checks) == len(before) + 1
        chk = next(c for c in checks if c["id"] == tx["check_id"])
        assert chk["amount"] == 7777 and chk["direction"] == "alinan"
        rem = admin.get(f"{API}/reminders").json()
        all_ids = [rr["source_id"] for b in ("today", "three_days", "seven_days", "overdue")
                   for rr in rem.get(b, [])]
        assert tx["check_id"] in all_ids

    def test_non_admin_cannot_approve(self, admin, muhasebe, site_id):
        r = admin.post(f"{API}/transactions",
                       json={"type": "gider", "category": "Malzeme", "amount": 123,
                             "date": TODAY, "site_id": site_id, "kasa": "nakit"})
        tx_id = r.json()["id"]
        rr = muhasebe.post(f"{API}/transactions/{tx_id}/approve")
        assert rr.status_code == 403


# -------------------- 5. Progress payments (hakediş) --------------------
class TestProgress:
    def test_create_taseron_hakedis_calc(self, admin, hakedis_id):
        d = admin.get(f"{API}/progress-payments/{hakedis_id}").json()
        assert d["subtotal"] == 100000.0
        assert d["overhead_amount"] == 6000.0
        assert d["base_amount"] == 94000.0
        assert d["vat_amount"] == 18800.0
        assert d["net_amount"] == 112800.0

    def test_approve_hakedis_updates_site_and_balance(self, admin, site_id, taseron_id, hakedis_id):
        before = admin.get(f"{API}/sites/{site_id}").json()["summary"]
        r = admin.patch(f"{API}/progress-payments/{hakedis_id}/status",
                        json={"status": "onaylandi"})
        assert r.status_code == 200
        after = admin.get(f"{API}/sites/{site_id}").json()["summary"]
        assert after["subcontractor_expense"] - before["subcontractor_expense"] == pytest.approx(112800.0)
        assert after["total_expense"] - before["total_expense"] == pytest.approx(112800.0)
        acc = admin.get(f"{API}/accounts/{taseron_id}").json()
        assert acc["balance"] == pytest.approx(112800.0)

    def test_taseron_avans_decreases_balance_but_not_site_expense(self, admin, site_id, taseron_id):
        site_before = admin.get(f"{API}/sites/{site_id}").json()["summary"]
        acc_before = admin.get(f"{API}/accounts/{taseron_id}").json()
        c = admin.post(f"{API}/transactions",
                       json={"type": "gider", "category": "Taşeron Avansı", "amount": 10000,
                             "date": TODAY, "site_id": site_id,
                             "account_id": taseron_id, "kasa": "nakit"})
        assert c.status_code == 201
        tx_id = c.json()["id"]
        ar = admin.post(f"{API}/transactions/{tx_id}/approve")
        assert ar.status_code == 200
        site_after = admin.get(f"{API}/sites/{site_id}").json()["summary"]
        acc_after = admin.get(f"{API}/accounts/{taseron_id}").json()
        assert site_after["total_expense"] == pytest.approx(site_before["total_expense"])
        assert acc_before["balance"] - acc_after["balance"] == pytest.approx(10000.0)


# -------------------- 6. Dashboard / Kasa / Reports --------------------
class TestDashboardReports:
    def test_kasa_balances(self, admin):
        r = admin.get(f"{API}/transactions/kasa")
        assert r.status_code == 200
        d = r.json()
        assert "nakit" in d and "cek" in d and "toplam" in d
        assert "balance" in d["nakit"]

    def test_dashboard(self, admin):
        r = admin.get(f"{API}/dashboard")
        assert r.status_code == 200
        d = r.json()
        assert "kasa" in d
        for k in ("nakit", "cek", "toplam"):
            assert k in d["kasa"]

    def test_reports(self, admin):
        r = admin.get(f"{API}/reports")
        assert r.status_code == 200, r.text
        d = r.json()
        for key in ("kasa", "kar_zarar", "musteri_risk", "cek", "odeme", "tahsilat", "taseron", "para_akisi"):
            assert key in d, f"missing section: {key}"


# -------------------- 7. Contracts & proposals --------------------
class TestContractsProposals:
    def test_create_contract(self, admin, taseron_id, site_id):
        r = admin.post(f"{API}/contracts",
                       json={"title": "TEST Sözleşme", "party_type": "taseron",
                             "account_id": taseron_id, "site_id": site_id,
                             "date": TODAY, "duration_days": 60,
                             "items": [{"description": "İş kalemi", "quantity": 10, "unit_price": 500}],
                             "vat_rate": 20, "technical_spec": "Teknik şartname",
                             "terms": "Şartlar"})
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["number"].startswith("SZL-")
        assert d["subtotal"] == 5000.0
        assert d["total"] == 6000.0

    def test_create_proposal_number_sequential(self, admin):
        r1 = admin.post(f"{API}/proposals",
                        json={"title": "TEST Teklif 1", "date": TODAY,
                              "items": [{"description": "A", "quantity": 1, "unit_price": 100}]})
        r2 = admin.post(f"{API}/proposals",
                        json={"title": "TEST Teklif 2", "date": TODAY,
                              "items": [{"description": "B", "quantity": 2, "unit_price": 50}]})
        assert r1.status_code == 201 and r2.status_code == 201
        n1, n2 = int(r1.json()["number"]), int(r2.json()["number"])
        assert n2 == n1 + 1


# -------------------- 8. Payments & reminders --------------------
class TestPayments:
    def test_create_payment_creates_reminders(self, admin):
        r = admin.post(f"{API}/payments",
                       json={"type": "kira", "title": "TEST Kira", "amount": 500,
                             "due_date": (date.today() + timedelta(days=2)).isoformat()})
        assert r.status_code == 201
        state["payment_id"] = r.json()["id"]
        rem = admin.get(f"{API}/reminders").json()
        all_ids = [x["source_id"] for b in ("today", "three_days", "seven_days", "overdue")
                   for x in rem.get(b, [])]
        assert state["payment_id"] in all_ids

    def test_mark_paid_dismisses_reminders(self, admin):
        r = admin.patch(f"{API}/payments/{state['payment_id']}/paid")
        assert r.status_code == 200
        rem = admin.get(f"{API}/reminders").json()
        all_ids = [x["source_id"] for b in ("today", "three_days", "seven_days", "overdue")
                   for x in rem.get(b, [])]
        assert state["payment_id"] not in all_ids


# -------------------- 9. PDF & Excel exports --------------------
class TestExports:
    def test_pdf_progress(self, admin, hakedis_id):
        r = admin.get(f"{API}/pdf/progress-payment/{hakedis_id}", timeout=60)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

    def test_pdf_proposal(self, admin, proposal_id):
        r = admin.get(f"{API}/pdf/proposal/{proposal_id}", timeout=60)
        assert r.status_code == 200 and r.content[:4] == b"%PDF"

    def test_pdf_statement_detailed(self, admin, taseron_id):
        r = admin.get(f"{API}/pdf/statement/{taseron_id}?detailed=true", timeout=60)
        assert r.status_code == 200 and r.content[:4] == b"%PDF"

    def test_pdf_contract(self, admin, contract_id):
        r = admin.get(f"{API}/pdf/contract/{contract_id}", timeout=60)
        assert r.status_code == 200 and r.content[:4] == b"%PDF"

    def test_excel_progress(self, admin, hakedis_id):
        r = admin.get(f"{API}/progress-payments/{hakedis_id}/excel", timeout=60)
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers.get("content-type", "")
        assert r.content[:2] == b"PK"

    def test_excel_proposal(self, admin, proposal_id):
        r = admin.get(f"{API}/proposals/{proposal_id}/excel", timeout=60)
        assert r.status_code == 200 and r.content[:2] == b"PK"

    def test_excel_contract(self, admin, contract_id):
        r = admin.get(f"{API}/contracts/{contract_id}/excel", timeout=60)
        assert r.status_code == 200 and r.content[:2] == b"PK"


# -------------------- 10. AI (light) --------------------
class TestAI:
    def test_site_analysis(self, admin, site_id):
        r = admin.post(f"{API}/ai/site-analysis/{site_id}", timeout=120)
        # Allow 200 with text; if LLM key unavailable, may return 500 -- fail explicitly.
        assert r.status_code == 200, f"site-analysis failed: {r.status_code} {r.text[:300]}"
        d = r.json()
        assert any(k in d for k in ("analysis", "text", "ai_text", "summary", "content"))

    def test_chat_stream(self, admin):
        # Use raw requests to consume SSE briefly
        headers = dict(admin.headers)
        with requests.post(f"{API}/ai/chat",
                           headers=headers,
                           json={"message": "Merhaba, kısaca selam ver.", "session_id": None},
                           stream=True, timeout=90) as r:
            assert r.status_code == 200
            got = b""
            start = time.time()
            for chunk in r.iter_content(chunk_size=256):
                if chunk:
                    got += chunk
                    if len(got) > 20 or time.time() - start > 60:
                        break
            assert len(got) > 0, "AI stream returned no data"
