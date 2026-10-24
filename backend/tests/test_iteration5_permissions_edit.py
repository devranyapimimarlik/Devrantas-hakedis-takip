# Iteration 5: permissions matrix, transaction edit (Düzelt), role enforcement, accounting semantics, hakediş edit
# SAFE for real data: only TEST_ records; permissions restored to defaults at the end. Run with -n 0.
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = {"email": "admin@devrantas.com", "password": "Devrantas2026!"}
TODAY = "2026-01-15"
TAG = uuid.uuid4().hex[:6]


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
    c = {"tx": [], "pp": [], "acc": [], "site": [], "user": []}
    site = s.post(f"{BASE_URL}/api/sites", json={"name": f"TEST_Site_{TAG}"}).json()
    c["site"].append(site["id"]); c["site_obj"] = site
    pw = "TestPass123!"
    email = f"test_muh_{TAG}@example.com"
    u = s.post(f"{BASE_URL}/api/auth/register-sub", json={"email": email, "password": pw, "name": f"TEST_Muh_{TAG}", "role": "muhasebe"})
    assert u.status_code == 201, u.text
    c["user"].append(u.json()["id"])
    c["muh"] = _login(email, pw)
    yield c
    defaults = s.get(f"{BASE_URL}/api/auth/permissions").json()["defaults"]
    s.put(f"{BASE_URL}/api/auth/permissions", json={"roles": defaults})
    for t in c["tx"]: s.delete(f"{BASE_URL}/api/transactions/{t}")
    for p in c["pp"]: s.delete(f"{BASE_URL}/api/progress-payments/{p}")
    for a in c["acc"]: s.delete(f"{BASE_URL}/api/accounts/{a}")
    for x in c["site"]: s.delete(f"{BASE_URL}/api/sites/{x}")
    for x in c["user"]: s.delete(f"{BASE_URL}/api/auth/users/{x}")


def _gider(s, c, **kw):
    body = {"type": "gider", "category": "Malzeme", "amount": 100, "date": TODAY, "description": f"TEST_gider_{TAG}",
            "kasa": "nakit", "site_id": c["site_obj"]["id"]}
    body.update(kw)
    r = s.post(f"{BASE_URL}/api/transactions", json=body)
    assert r.status_code == 201, r.text
    c["tx"].append(r.json()["id"])
    return r.json()


class TestPermissions:
    def test_me_admin_permissions(self, s):
        me = s.get(f"{BASE_URL}/api/auth/me").json()
        assert me["role"] == "yonetici"
        assert isinstance(me["permissions"], dict) and len(me["permissions"]) == 8
        assert all(me["permissions"].values())

    def test_get_permissions_structure(self, s):
        d = s.get(f"{BASE_URL}/api/auth/permissions").json()
        assert set(d["roles"].keys()) == {"muhasebe", "santiye_sefi"}
        assert "edit_transactions" in d["labels"]
        assert d["defaults"]["muhasebe"]["approve_expenses"] is False

    def test_put_persists_and_nonadmin_403(self, s, ctx):
        d = s.get(f"{BASE_URL}/api/auth/permissions").json()
        roles = {r: dict(v) for r, v in d["roles"].items()}
        roles["muhasebe"]["view_reports"] = not roles["muhasebe"]["view_reports"]
        r = s.put(f"{BASE_URL}/api/auth/permissions", json={"roles": roles})
        assert r.status_code == 200
        assert s.get(f"{BASE_URL}/api/auth/permissions").json()["roles"]["muhasebe"]["view_reports"] == roles["muhasebe"]["view_reports"]
        me = ctx["muh"].get(f"{BASE_URL}/api/auth/me").json()
        assert me["permissions"]["view_reports"] == roles["muhasebe"]["view_reports"]
        assert ctx["muh"].get(f"{BASE_URL}/api/auth/permissions").status_code == 403
        assert ctx["muh"].put(f"{BASE_URL}/api/auth/permissions", json={"roles": d["defaults"]}).status_code == 403
        assert s.put(f"{BASE_URL}/api/auth/permissions", json={"roles": d["defaults"]}).status_code == 200


class TestTransactionEdit:
    def test_admin_edit_fields_and_log(self, s, ctx):
        t = _gider(s, ctx)
        r = s.put(f"{BASE_URL}/api/transactions/{t['id']}", json={"amount": 250, "description": f"TEST_edited_{TAG}", "category": "Nakliye"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["amount"] == 250 and d["category"] == "Nakliye" and d["description"] == f"TEST_edited_{TAG}"
        assert d["edited_by_name"] and len(d["edit_log"]) == 1 and d["edit_log"][0]["before"]["amount"] == 100
        lst = s.get(f"{BASE_URL}/api/transactions", params={"site_id": ctx["site_obj"]["id"]}).json()
        assert any(x["id"] == t["id"] and x["amount"] == 250 for x in lst)

    def test_invalid_kasa_and_category(self, s, ctx):
        t = _gider(s, ctx)
        assert s.put(f"{BASE_URL}/api/transactions/{t['id']}", json={"kasa": "banka"}).status_code == 400
        assert s.put(f"{BASE_URL}/api/transactions/{t['id']}", json={"category": "Hakediş Tahsilatı"}).status_code == 400
        assert s.put(f"{BASE_URL}/api/transactions/{t['id']}", json={"amount": 0}).status_code == 400
        assert s.put(f"{BASE_URL}/api/transactions/nonexistent", json={"amount": 5}).status_code == 404

    def test_endorsed_tx_edit_400(self, s, ctx):
        acc = s.post(f"{BASE_URL}/api/accounts", json={"name": f"TEST_EndTas_{TAG}", "type": "taseron"}).json()
        ctx["acc"].append(acc["id"])
        g = s.post(f"{BASE_URL}/api/transactions", json={"type": "gelir", "category": "Diğer", "amount": 300, "date": TODAY,
                    "kasa": "cek", "check_due_date": "2026-03-01", "description": f"TEST_chk_{TAG}"}).json()
        ctx["tx"].append(g["id"])
        r = s.post(f"{BASE_URL}/api/checks/{g['check_id']}/endorse", json={"account_id": acc["id"], "date": TODAY, "site_id": ctx["site_obj"]["id"]})
        if r.status_code not in (200, 201):
            pytest.skip(f"endorse unavailable: {r.status_code} {r.text}")
        etx = r.json().get("transaction", r.json()).get("id") or r.json().get("transaction_id")
        if not etx:
            lst = s.get(f"{BASE_URL}/api/transactions", params={"account_id": acc["id"]}).json()
            etx = [x for x in lst if x.get("endorsed")][0]["id"]
        ctx["tx"].insert(0, etx)
        assert s.put(f"{BASE_URL}/api/transactions/{etx}", json={"amount": 10}).status_code == 400


class TestRoleEnforcement:
    def test_muhasebe_defaults(self, s, ctx):
        m = ctx["muh"]
        t = _gider(s, ctx)
        r = m.put(f"{BASE_URL}/api/transactions/{t['id']}", json={"description": f"TEST_muh_{TAG}"})
        assert r.status_code == 200 and r.json()["edited_by_name"] == f"TEST_Muh_{TAG}"
        assert m.post(f"{BASE_URL}/api/transactions/{t['id']}/approve").status_code == 403
        assert m.post(f"{BASE_URL}/api/transactions/{t['id']}/reject", json={"reason": "x"}).status_code == 403
        site = ctx["site_obj"]
        assert m.put(f"{BASE_URL}/api/sites/{site['id']}", json={"name": site["name"]}).status_code == 403

    def test_muhasebe_edit_approved_resets_status(self, s, ctx):
        t = _gider(s, ctx)
        assert s.post(f"{BASE_URL}/api/transactions/{t['id']}/approve").status_code == 200
        r = ctx["muh"].put(f"{BASE_URL}/api/transactions/{t['id']}", json={"amount": 777})
        assert r.status_code == 200
        assert r.json()["status"] == "onay_bekliyor" and r.json()["approved_by"] is None

    def test_admin_edit_approved_keeps_status(self, s, ctx):
        t = _gider(s, ctx)
        s.post(f"{BASE_URL}/api/transactions/{t['id']}/approve")
        r = s.put(f"{BASE_URL}/api/transactions/{t['id']}", json={"amount": 888})
        assert r.json()["status"] == "onaylandi"

    def test_revoke_edit_transactions(self, s, ctx):
        t = _gider(s, ctx)
        d = s.get(f"{BASE_URL}/api/auth/permissions").json()
        roles = {r: dict(v) for r, v in d["defaults"].items()}
        roles["muhasebe"]["edit_transactions"] = False
        assert s.put(f"{BASE_URL}/api/auth/permissions", json={"roles": roles}).status_code == 200
        try:
            assert ctx["muh"].put(f"{BASE_URL}/api/transactions/{t['id']}", json={"description": "x"}).status_code == 403
        finally:
            s.put(f"{BASE_URL}/api/auth/permissions", json={"roles": d["defaults"]})
        assert ctx["muh"].put(f"{BASE_URL}/api/transactions/{t['id']}", json={"description": "TEST_y"}).status_code == 200


class TestAccounting:
    def test_taseron_avans_then_hakedis(self, s, ctx):
        acc = s.post(f"{BASE_URL}/api/accounts", json={"name": f"TEST_Tas_{TAG}", "type": "taseron"}).json()
        ctx["acc"].append(acc["id"])
        t = _gider(s, ctx, category="Taşeron Avansı", amount=1000, account_id=acc["id"])
        assert s.post(f"{BASE_URL}/api/transactions/{t['id']}/approve").status_code == 200
        st = s.get(f"{BASE_URL}/api/accounts/{acc['id']}/statement").json()
        assert len(st["rows"]) == 1
        row = st["rows"][0]
        assert row["type"] == "avans" and row["debit"] == 1000 and row["credit"] == 0 and row["balance"] == -1000
        assert st["account"]["advance_outstanding"] == 1000 and st["account"]["we_owe"] == 0
        pp = s.post(f"{BASE_URL}/api/progress-payments", json={"site_id": ctx["site_obj"]["id"], "account_id": acc["id"], "type": "taseron",
                    "date": TODAY, "items": [{"description": "TEST_k", "quantity": 30, "unit_price": 100}], "vat_rate": 0, "apply_overhead": False}).json()
        ctx["pp"].append(pp["id"])
        assert pp["net_amount"] == 3000
        assert s.patch(f"{BASE_URL}/api/progress-payments/{pp['id']}/status", json={"status": "onaylandi"}).status_code == 200
        st = s.get(f"{BASE_URL}/api/accounts/{acc['id']}/statement").json()
        hk = [r for r in st["rows"] if r["type"] == "hakedis"][0]
        assert hk["credit"] == 3000 and hk["debit"] == 0
        assert st["rows"][-1]["balance"] == 2000
        assert st["account"]["we_owe"] == 2000 and st["account"]["advance_outstanding"] == 0
        # admin edits a non-taslak hakediş → net recalculated
        r = s.put(f"{BASE_URL}/api/progress-payments/{pp['id']}", json={"site_id": ctx["site_obj"]["id"], "account_id": acc["id"], "type": "taseron",
                  "date": TODAY, "items": [{"description": "TEST_k", "quantity": 40, "unit_price": 100}], "vat_rate": 0, "apply_overhead": False})
        assert r.status_code == 200, r.text
        assert r.json()["net_amount"] == 4000 and r.json()["status"] == "onaylandi"
        assert s.get(f"{BASE_URL}/api/accounts/{acc['id']}").json()["we_owe"] == 3000

    def test_musteri_tahsilat(self, s, ctx):
        acc = s.post(f"{BASE_URL}/api/accounts", json={"name": f"TEST_Mus_{TAG}", "type": "musteri"}).json()
        ctx["acc"].append(acc["id"])
        g = s.post(f"{BASE_URL}/api/transactions", json={"type": "gelir", "category": "Hakediş Tahsilatı", "amount": 500, "date": TODAY,
                    "kasa": "nakit", "account_id": acc["id"], "site_id": ctx["site_obj"]["id"], "description": f"TEST_tah_{TAG}"}).json()
        ctx["tx"].append(g["id"])
        st = s.get(f"{BASE_URL}/api/accounts/{acc['id']}/statement").json()
        row = st["rows"][0]
        assert row["type"] == "tahsilat" and row["credit"] == 500 and row["debit"] == 0 and row["balance"] == -500
        assert st["account"]["customer_credit"] == 500 and st["account"]["receivable"] == 0
