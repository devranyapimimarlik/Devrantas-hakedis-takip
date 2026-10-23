# Iteration 4: bug-fix verification (hakediş pay, check endorse, client_key dedup, import validation, admin RBAC)
# SAFE for real data: creates only TEST_ records and deletes them; import calls are always invalid payloads (must 400).
import os
import io
import json
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = {"email": "admin@devrantas.com", "password": "Devrantas2026!"}
TODAY = "2026-01-15"


@pytest.fixture(scope="module")
def s():
    ses = requests.Session()
    r = ses.post(f"{BASE_URL}/api/auth/login", json=ADMIN)
    if r.status_code != 200:
        pytest.skip(f"admin login failed {r.status_code}")
    ses.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return ses


@pytest.fixture(scope="module")
def fixtures(s):
    """TEST_ site + TEST_ taşeron + approved taşeron hakediş; cleaned up afterwards."""
    created = {"tx": [], "checks": []}
    tag = uuid.uuid4().hex[:6]
    site = s.post(f"{BASE_URL}/api/sites", json={"name": f"TEST_Site_{tag}"})
    assert site.status_code in (200, 201), site.text
    acc = s.post(f"{BASE_URL}/api/accounts", json={"name": f"TEST_Taseron_{tag}", "type": "taseron"})
    assert acc.status_code in (200, 201), acc.text
    site, acc = site.json(), acc.json()
    pp = s.post(f"{BASE_URL}/api/progress-payments", json={
        "site_id": site["id"], "account_id": acc["id"], "type": "taseron", "date": TODAY,
        "items": [{"description": "TEST_kalem", "quantity": 10, "unit_price": 100}],
        "vat_rate": 0, "apply_overhead": False})
    assert pp.status_code == 201, pp.text
    pp = pp.json()
    r = s.patch(f"{BASE_URL}/api/progress-payments/{pp['id']}/status", json={"status": "onaylandi"})
    assert r.status_code == 200
    created.update(site=site, acc=acc, pp=pp)
    yield created
    # teardown
    for t in s.get(f"{BASE_URL}/api/transactions", params={"account_id": acc["id"]}).json():
        s.delete(f"{BASE_URL}/api/transactions/{t['id']}")
    for cid in created["checks"]:
        s.delete(f"{BASE_URL}/api/checks/{cid}")
    s.delete(f"{BASE_URL}/api/progress-payments/{pp['id']}")
    s.delete(f"{BASE_URL}/api/accounts/{acc['id']}")
    s.delete(f"{BASE_URL}/api/sites/{site['id']}")


# BUG FIX 1: hakediş pay
class TestProgressPay:
    def test_pay_nakit(self, s, fixtures):
        pid = fixtures["pp"]["id"]
        r = s.post(f"{BASE_URL}/api/progress-payments/{pid}/pay", json={"date": TODAY, "nakit_amount": 300, "description": "TEST_pay"})
        assert r.status_code == 201, r.text
        d = r.json()
        assert len(d["created"]) == 1
        tx = d["created"][0]
        assert tx["progress_payment_id"] == pid and tx["amount"] == 300 and tx["type"] == "gider"
        assert tx["category"] == "Taşeron Hakediş Ödemesi" and tx["status"] == "onay_bekliyor"
        assert d["pending"] == 300
        lst = s.get(f"{BASE_URL}/api/progress-payments/{pid}/payments").json()
        assert any(t["id"] == tx["id"] for t in lst["rows"])

    def test_pay_cek_requires_due(self, s, fixtures):
        pid = fixtures["pp"]["id"]
        r = s.post(f"{BASE_URL}/api/progress-payments/{pid}/pay", json={"date": TODAY, "cek_amount": 100})
        assert r.status_code == 400

    def test_pay_cek_with_due_creates_check(self, s, fixtures):
        pid = fixtures["pp"]["id"]
        r = s.post(f"{BASE_URL}/api/progress-payments/{pid}/pay", json={"date": TODAY, "cek_amount": 100, "check_due_date": "2026-02-20",
                                                                            "check_bank": "TEST_Bank", "check_no": "T1"})
        assert r.status_code == 201, r.text
        tx = r.json()["created"][0]
        assert tx["kasa"] == "cek" and tx["check_id"] and tx["progress_payment_id"] == pid

    def test_approve_closes_when_fully_paid(self, s, fixtures):
        pid = fixtures["pp"]["id"]
        r = s.post(f"{BASE_URL}/api/progress-payments/{pid}/pay", json={"date": TODAY, "nakit_amount": 600})
        assert r.status_code == 201
        rows = s.get(f"{BASE_URL}/api/progress-payments/{pid}/payments").json()["rows"]
        for t in rows:
            assert s.post(f"{BASE_URL}/api/transactions/{t['id']}/approve").status_code == 200
        assert s.get(f"{BASE_URL}/api/progress-payments/{pid}").json()["status"] == "odendi"

    def test_pay_draft_rejected(self, s, fixtures):
        pp = s.post(f"{BASE_URL}/api/progress-payments", json={
            "site_id": fixtures["site"]["id"], "account_id": fixtures["acc"]["id"], "type": "taseron", "date": TODAY,
            "items": [{"description": "TEST_x", "quantity": 1, "unit_price": 1}]}).json()
        try:
            r = s.post(f"{BASE_URL}/api/progress-payments/{pp['id']}/pay", json={"date": TODAY, "nakit_amount": 1})
            assert r.status_code == 400
        finally:
            s.delete(f"{BASE_URL}/api/progress-payments/{pp['id']}")


# BUG FIX 2: check endorse
class TestEndorse:
    def test_endorse_received_check(self, s, fixtures):
        c = s.post(f"{BASE_URL}/api/checks", json={"direction": "alinan", "amount": 250, "due_date": "2026-03-01",
                                                   "bank": "TEST_Bank", "check_no": "TEND1", "notes": "TEST_endorse"})
        assert c.status_code == 201, c.text
        cid = c.json()["id"]
        fixtures["checks"].append(cid)
        r = s.post(f"{BASE_URL}/api/checks/{cid}/endorse", json={"account_id": fixtures["acc"]["id"]})
        assert r.status_code == 201, r.text
        tx = r.json()["transaction"]
        assert tx["check_id"] == cid and tx["endorsed"] is True and tx["amount"] == 250 and tx["kasa"] == "cek"
        assert tx["category"] == "Taşeron Avansı"
        chk = [x for x in s.get(f"{BASE_URL}/api/checks").json() if x["id"] == cid][0]
        assert chk["status"] == "ciro_edildi" and chk["endorse_transaction_id"] == tx["id"]
        # second endorse must fail
        assert s.post(f"{BASE_URL}/api/checks/{cid}/endorse", json={"account_id": fixtures["acc"]["id"]}).status_code == 400

    def test_endorse_linked_to_hakedis(self, s, fixtures):
        pp = s.post(f"{BASE_URL}/api/progress-payments", json={
            "site_id": fixtures["site"]["id"], "account_id": fixtures["acc"]["id"], "type": "taseron", "date": TODAY,
            "items": [{"description": "TEST_y", "quantity": 1, "unit_price": 500}], "vat_rate": 0, "apply_overhead": False}).json()
        s.patch(f"{BASE_URL}/api/progress-payments/{pp['id']}/status", json={"status": "onaylandi"})
        c = s.post(f"{BASE_URL}/api/checks", json={"direction": "alinan", "amount": 500, "due_date": "2026-03-02", "bank": "TEST_Bank", "check_no": "TEND2"}).json()
        fixtures["checks"].append(c["id"])
        try:
            r = s.post(f"{BASE_URL}/api/checks/{c['id']}/endorse", json={"account_id": fixtures["acc"]["id"], "progress_payment_id": pp["id"]})
            assert r.status_code == 201, r.text
            tx = r.json()["transaction"]
            assert tx["progress_payment_id"] == pp["id"] and tx["category"] == "Taşeron Hakediş Ödemesi"
            assert tx["site_id"] == fixtures["site"]["id"]
        finally:
            for t in s.get(f"{BASE_URL}/api/progress-payments/{pp['id']}/payments").json()["rows"]:
                s.delete(f"{BASE_URL}/api/transactions/{t['id']}")
            s.delete(f"{BASE_URL}/api/progress-payments/{pp['id']}")

    def test_endorse_given_check_rejected(self, s, fixtures):
        c = s.post(f"{BASE_URL}/api/checks", json={"direction": "verilen", "amount": 10, "due_date": "2026-03-03", "bank": "TEST_Bank"}).json()
        fixtures["checks"].append(c["id"])
        assert s.post(f"{BASE_URL}/api/checks/{c['id']}/endorse", json={"account_id": fixtures["acc"]["id"]}).status_code == 400


# FIX 3: client_key idempotency
class TestClientKey:
    def test_dedup(self, s, fixtures):
        key = f"TEST_ck_{uuid.uuid4().hex}"
        body = {"type": "gider", "category": "Diğer", "amount": 12.5, "date": TODAY, "kasa": "nakit",
                "description": "TEST_clientkey", "client_key": key, "account_id": fixtures["acc"]["id"]}
        r1 = s.post(f"{BASE_URL}/api/transactions", json=body)
        r2 = s.post(f"{BASE_URL}/api/transactions", json=body)
        assert r1.status_code == 201 and r2.status_code in (200, 201)
        assert r1.json()["id"] == r2.json()["id"]
        matches = [t for t in s.get(f"{BASE_URL}/api/transactions", params={"account_id": fixtures["acc"]["id"]}).json()
                   if t.get("client_key") == key]
        assert len(matches) == 1


# FIX 4: import validation / export / pull dry-run
class TestAdminTransfer:
    def _stats(self, s):
        d = s.get(f"{BASE_URL}/api/admin/stats").json()
        d["restore_points"] = [x["id"] for x in d["restore_points"]]
        return d

    def test_export(self, s):
        r = s.get(f"{BASE_URL}/api/admin/export", timeout=120)
        assert r.status_code == 200
        d = r.json()
        assert d["version"] == 1
        for c in ["users", "sites", "accounts", "transactions", "checks", "payments", "progress_payments", "proposals",
                  "contracts", "site_photos", "files", "reminders", "ai_messages", "ai_sessions", "alert_logs"]:
            assert c in d["collections"], c

    def test_import_missing_collection(self, s):
        before = self._stats(s)
        f = io.BytesIO(json.dumps({"version": 1, "collections": {"users": [{"id": "x", "role": "yonetici"}]}}).encode())
        r = s.post(f"{BASE_URL}/api/admin/import", files={"file": ("bad.json", f, "application/json")})
        assert r.status_code == 400, r.text
        assert self._stats(s) == before

    def test_import_doc_without_id(self, s):
        before = self._stats(s)
        cols = {c: [] for c in ["users", "sites", "accounts", "transactions", "checks", "payments", "progress_payments", "proposals",
                                "contracts", "site_photos", "files", "reminders", "ai_messages", "ai_sessions", "alert_logs"]}
        cols["users"] = [{"id": "u1", "role": "yonetici", "email": "TEST_x@x.com"}]
        cols["sites"] = [{"name": "TEST_noid"}]
        f = io.BytesIO(json.dumps({"version": 1, "collections": cols}).encode())
        r = s.post(f"{BASE_URL}/api/admin/import", files={"file": ("bad.json", f, "application/json")})
        assert r.status_code == 400, r.text
        assert self._stats(s) == before

    def test_import_not_json(self, s):
        r = s.post(f"{BASE_URL}/api/admin/import", files={"file": ("bad.json", io.BytesIO(b"not json"), "application/json")})
        assert r.status_code == 400

    def test_pull_dry_run(self, s):
        before = self._stats(s)
        r = s.post(f"{BASE_URL}/api/admin/pull", json={"source_url": BASE_URL, **ADMIN, "dry_run": True}, timeout=180)
        assert r.status_code == 200, r.text
        assert "preview" in r.json() and r.json()["preview"]["users"] >= 1
        assert self._stats(s) == before

    def test_pull_bad_creds(self, s):
        r = s.post(f"{BASE_URL}/api/admin/pull", json={"source_url": BASE_URL, "email": ADMIN["email"], "password": "wrong", "dry_run": True})
        assert r.status_code == 400


class TestAdminRBAC:
    def test_non_admin_forbidden(self, s):
        email = f"test_{uuid.uuid4().hex[:6]}@example.com"
        r = s.post(f"{BASE_URL}/api/auth/register-sub", json={"email": email, "password": "TestPass123", "name": "TEST_Sub", "role": "muhasebe"})
        assert r.status_code == 201, r.text
        uid = r.json().get("id") or r.json().get("user", {}).get("id")
        try:
            sub = requests.Session()
            tok = sub.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": "TestPass123"}).json()["access_token"]
            sub.headers.update({"Authorization": f"Bearer {tok}"})
            assert sub.get(f"{BASE_URL}/api/admin/export").status_code == 403
            assert sub.get(f"{BASE_URL}/api/admin/stats").status_code == 403
            assert sub.post(f"{BASE_URL}/api/admin/import", files={"file": ("x.json", io.BytesIO(b"{}"), "application/json")}).status_code == 403
            assert sub.post(f"{BASE_URL}/api/admin/pull", json={"source_url": "x", "email": "a@b.com", "password": "x", "dry_run": True}).status_code == 403
        finally:
            if uid:
                s.delete(f"{BASE_URL}/api/auth/users/{uid}")
