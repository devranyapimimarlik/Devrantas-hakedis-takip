# Iteration 6: delete_transactions / edit_checks / view_reports / edit_progress enforcement, close_if_paid revert,
# non-admin hakediş re-approval, kasa change guard. SAFE for real data: TEST_ records only, perms restored. Run with -n 0.
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = {"email": "admin@devrantas.com", "password": "Devrantas2026!"}
TODAY = "2026-01-15"
TAG = uuid.uuid4().hex[:6]
PW = "TestPass123!"


def _login(email, pw):
    ses = requests.Session()
    r = ses.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    ses.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return ses


@pytest.fixture(scope="module")
def s():
    return _login(ADMIN["email"], ADMIN["password"])


@pytest.fixture(scope="module")
def ctx(s):
    c = {"tx": [], "pp": [], "acc": [], "site": [], "user": [], "chk": []}
    site = s.post(f"{BASE_URL}/api/sites", json={"name": f"TEST_Site6_{TAG}"}).json()
    c["site"].append(site["id"]); c["site_obj"] = site
    acc = s.post(f"{BASE_URL}/api/accounts", json={"name": f"TEST_Tas6_{TAG}", "type": "taseron"}).json()
    c["acc"].append(acc["id"]); c["acc_obj"] = acc
    for role, key in (("muhasebe", "muh"), ("muhasebe", "muh2"), ("santiye_sefi", "sef")):
        email = f"test_{key}6_{TAG}@example.com"
        u = s.post(f"{BASE_URL}/api/auth/register-sub", json={"email": email, "password": PW, "name": f"TEST_{key}_{TAG}", "role": role})
        assert u.status_code == 201, u.text
        c["user"].append(u.json()["id"])
        c[key] = _login(email, PW)
    c["defaults"] = s.get(f"{BASE_URL}/api/auth/permissions").json()["defaults"]
    yield c
    s.put(f"{BASE_URL}/api/auth/permissions", json={"roles": c["defaults"]})
    for t in c["tx"]: s.delete(f"{BASE_URL}/api/transactions/{t}")
    for x in c["chk"]: s.delete(f"{BASE_URL}/api/checks/{x}")
    for p in c["pp"]: s.delete(f"{BASE_URL}/api/progress-payments/{p}")
    for a in c["acc"]: s.delete(f"{BASE_URL}/api/accounts/{a}")
    for x in c["site"]: s.delete(f"{BASE_URL}/api/sites/{x}")
    for x in c["user"]: s.delete(f"{BASE_URL}/api/auth/users/{x}")


def _set_perm(s, ctx, role, key, val):
    roles = {r: dict(v) for r, v in ctx["defaults"].items()}
    roles[role][key] = val
    r = s.put(f"{BASE_URL}/api/auth/permissions", json={"roles": roles})
    assert r.status_code == 200, r.text


def _restore(s, ctx):
    assert s.put(f"{BASE_URL}/api/auth/permissions", json={"roles": ctx["defaults"]}).status_code == 200


def _gider(ses, ctx, **kw):
    body = {"type": "gider", "category": "Malzeme", "amount": 100, "date": TODAY, "description": f"TEST_g6_{TAG}",
            "kasa": "nakit", "site_id": ctx["site_obj"]["id"]}
    body.update(kw)
    r = ses.post(f"{BASE_URL}/api/transactions", json=body)
    assert r.status_code == 201, r.text
    ctx["tx"].append(r.json()["id"])
    return r.json()


def _pp(s, ctx, qty=10, price=100):
    r = s.post(f"{BASE_URL}/api/progress-payments", json={"site_id": ctx["site_obj"]["id"], "account_id": ctx["acc_obj"]["id"], "type": "taseron",
               "date": TODAY, "items": [{"description": "TEST_k6", "quantity": qty, "unit_price": price}], "vat_rate": 0, "apply_overhead": False})
    assert r.status_code == 201, r.text
    ctx["pp"].append(r.json()["id"])
    return r.json()


def _pp_body(ctx, qty, price=100):
    return {"site_id": ctx["site_obj"]["id"], "account_id": ctx["acc_obj"]["id"], "type": "taseron", "date": TODAY,
            "items": [{"description": "TEST_k6", "quantity": qty, "unit_price": price}], "vat_rate": 0, "apply_overhead": False}


# ---- delete_transactions ----
class TestDeleteTx:
    def test_own_pending_delete_ok(self, s, ctx):
        t = _gider(ctx["muh"], ctx)
        assert t["status"] == "onay_bekliyor"
        assert ctx["muh"].delete(f"{BASE_URL}/api/transactions/{t['id']}").status_code == 200
        lst = s.get(f"{BASE_URL}/api/transactions", params={"site_id": ctx["site_obj"]["id"]}).json()
        assert not any(x["id"] == t["id"] for x in lst)

    def test_others_pending_403(self, s, ctx):
        t = _gider(ctx["muh2"], ctx)
        r = ctx["muh"].delete(f"{BASE_URL}/api/transactions/{t['id']}")
        assert r.status_code == 403

    def test_own_approved_403_then_grant(self, s, ctx):
        t = _gider(ctx["muh"], ctx)
        assert s.post(f"{BASE_URL}/api/transactions/{t['id']}/approve").status_code == 200
        assert ctx["muh"].delete(f"{BASE_URL}/api/transactions/{t['id']}").status_code == 403
        _set_perm(s, ctx, "muhasebe", "delete_transactions", True)
        try:
            assert ctx["muh"].delete(f"{BASE_URL}/api/transactions/{t['id']}").status_code == 200
        finally:
            _restore(s, ctx)
        lst = s.get(f"{BASE_URL}/api/transactions", params={"site_id": ctx["site_obj"]["id"]}).json()
        assert not any(x["id"] == t["id"] for x in lst)


# ---- edit_checks ----
class TestEditChecks:
    def test_checks_enforcement(self, s, ctx):
        body = {"direction": "alinan", "amount": 123, "due_date": "2026-12-01", "bank": "TEST_Bank", "check_no": f"TEST_{TAG}"}
        r = s.post(f"{BASE_URL}/api/checks", json=body)
        assert r.status_code == 201
        cid = r.json()["id"]; ctx["chk"].append(cid)
        r = ctx["muh"].put(f"{BASE_URL}/api/checks/{cid}", json={**body, "amount": 150})
        assert r.status_code == 200 and r.json()["amount"] == 150
        _set_perm(s, ctx, "muhasebe", "edit_checks", False)
        try:
            m = ctx["muh"]
            assert m.put(f"{BASE_URL}/api/checks/{cid}", json=body).status_code == 403
            assert m.patch(f"{BASE_URL}/api/checks/{cid}/status", json={"status": "tahsil_edildi"}).status_code == 403
            assert m.post(f"{BASE_URL}/api/checks/{cid}/endorse", json={"account_id": ctx["acc_obj"]["id"]}).status_code == 403
            assert m.delete(f"{BASE_URL}/api/checks/{cid}").status_code == 403
        finally:
            _restore(s, ctx)
        lst = s.get(f"{BASE_URL}/api/checks").json()
        c = [x for x in lst if x["id"] == cid][0]
        assert c["status"] == "portfoyde" and c["amount"] == 150
        assert s.delete(f"{BASE_URL}/api/checks/{cid}").status_code == 200
        assert not any(x["id"] == cid for x in s.get(f"{BASE_URL}/api/checks").json())
        ctx["chk"].remove(cid)


# ---- view_reports ----
class TestReports:
    def test_reports_perm(self, s, ctx):
        p = {"start": "2026-01-01", "end": "2026-12-31"}
        assert ctx["sef"].get(f"{BASE_URL}/api/reports", params=p).status_code == 403
        assert ctx["sef"].get(f"{BASE_URL}/api/reports/export", params=p).status_code == 403
        assert ctx["muh"].get(f"{BASE_URL}/api/reports", params=p).status_code == 200
        assert s.get(f"{BASE_URL}/api/reports", params=p).status_code == 200
        me = ctx["sef"].get(f"{BASE_URL}/api/auth/me").json()
        assert me["permissions"]["view_reports"] is False


# ---- edit_progress on status ----
class TestProgressStatus:
    def test_status_perm(self, s, ctx):
        pp = _pp(s, ctx)
        assert ctx["sef"].patch(f"{BASE_URL}/api/progress-payments/{pp['id']}/status", json={"status": "onaylandi"}).status_code == 200
        _set_perm(s, ctx, "santiye_sefi", "edit_progress", False)
        try:
            assert ctx["sef"].patch(f"{BASE_URL}/api/progress-payments/{pp['id']}/status", json={"status": "taslak"}).status_code == 403
        finally:
            _restore(s, ctx)
        assert s.get(f"{BASE_URL}/api/progress-payments/{pp['id']}").json()["status"] == "onaylandi"


# ---- close_if_paid revert & re-approval ----
class TestProgressFlows:
    def test_close_if_paid_revert(self, s, ctx):
        pp = _pp(s, ctx, qty=10)
        assert pp["net_amount"] == 1000
        assert s.patch(f"{BASE_URL}/api/progress-payments/{pp['id']}/status", json={"status": "onaylandi"}).status_code == 200
        r = s.post(f"{BASE_URL}/api/progress-payments/{pp['id']}/pay", json={"date": TODAY, "nakit_amount": 1000})
        assert r.status_code == 201, r.text
        for t in r.json()["created"]:
            ctx["tx"].insert(0, t["id"])
            if t["status"] == "onay_bekliyor":
                s.post(f"{BASE_URL}/api/transactions/{t['id']}/approve")
        assert s.get(f"{BASE_URL}/api/progress-payments/{pp['id']}").json()["status"] == "odendi"
        r = s.put(f"{BASE_URL}/api/progress-payments/{pp['id']}", json=_pp_body(ctx, 20))
        assert r.status_code == 200, r.text
        assert r.json()["net_amount"] == 2000 and r.json()["status"] == "onaylandi"

    def test_nonadmin_edit_approved_reapproval(self, s, ctx):
        pp = _pp(s, ctx, qty=5)
        s.patch(f"{BASE_URL}/api/progress-payments/{pp['id']}/status", json={"status": "onaylandi"})
        r = ctx["muh"].put(f"{BASE_URL}/api/progress-payments/{pp['id']}", json=_pp_body(ctx, 6))
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "taslak" and r.json().get("reapproval_note")
        pp2 = _pp(s, ctx, qty=5)
        s.patch(f"{BASE_URL}/api/progress-payments/{pp2['id']}/status", json={"status": "onaylandi"})
        r = s.put(f"{BASE_URL}/api/progress-payments/{pp2['id']}", json=_pp_body(ctx, 7))
        assert r.status_code == 200 and r.json()["status"] == "onaylandi" and r.json()["net_amount"] == 700

    def test_nonadmin_edit_same_net_keeps_status(self, s, ctx):
        pp = _pp(s, ctx, qty=5)
        s.patch(f"{BASE_URL}/api/progress-payments/{pp['id']}/status", json={"status": "onaylandi"})
        body = _pp_body(ctx, 5); body["notes"] = "TEST_note"
        r = ctx["muh"].put(f"{BASE_URL}/api/progress-payments/{pp['id']}", json=body)
        assert r.status_code == 200 and r.json()["status"] == "onaylandi"


# ---- kasa change guard ----
class TestKasa:
    def test_kasa_change_400(self, s, ctx):
        t = _gider(s, ctx)
        r = s.put(f"{BASE_URL}/api/transactions/{t['id']}", json={"kasa": "cek"})
        assert r.status_code == 400 and "değiştirilemez" in r.json()["detail"]
        r = s.put(f"{BASE_URL}/api/transactions/{t['id']}", json={"kasa": "nakit", "amount": 111})
        assert r.status_code == 200 and r.json()["amount"] == 111 and r.json()["kasa"] == "nakit"
