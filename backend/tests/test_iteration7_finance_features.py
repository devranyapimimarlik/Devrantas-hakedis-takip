# Iteration 7: taşeron normalization, advance deduction, kasalar, %6 virman, duplicates, WhatsApp, active accounts, planned payments, settings
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
CREATED = {"tx": [], "pp": [], "acc": [], "site": [], "kasa": [], "pay": [], "check": []}
S = {}


@pytest.fixture(scope="module")
def c():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@devrantas.com", "password": "Devrantas2026!"})
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    yield s
    # cleanup
    for pid in CREATED["pay"]:
        s.delete(f"{API}/payments/{pid}")
    for pid in CREATED["pp"]:
        s.delete(f"{API}/progress-payments/{pid}")
    for tid in CREATED["tx"]:
        s.delete(f"{API}/transactions/{tid}")
    for cid in CREATED["check"]:
        s.delete(f"{API}/checks/{cid}")
    for k in CREATED["kasa"]:
        s.delete(f"{API}/kasalar/{k}")
    for a in CREATED["acc"]:
        s.delete(f"{API}/accounts/{a}")
    for si in CREATED["site"]:
        s.delete(f"{API}/sites/{si}")


def tx(c, **kw):
    body = {"type": "gider", "category": "Malzeme", "amount": 100, "date": "2026-06-01", "kasa": "nakit", "description": "TEST_tx"}
    body.update(kw)
    r = c.post(f"{API}/transactions", json=body)
    if r.status_code == 201:
        CREATED["tx"].append(r.json()["id"])
    return r


# ---------- setup ----------
def test_setup(c):
    r = c.post(f"{API}/accounts", json={"name": "TEST_Taseron Zeki", "type": "taseron"}); assert r.status_code == 201
    S["tas"] = r.json()["id"]; CREATED["acc"].append(S["tas"])
    r = c.post(f"{API}/accounts", json={"name": "TEST_Musteri Kemal", "type": "musteri"}); assert r.status_code == 201
    S["mus"] = r.json()["id"]; CREATED["acc"].append(S["mus"])
    r = c.post(f"{API}/sites", json={"name": "TEST_Santiye Ylmz", "contract_amount": 1000000, "customer_id": S["mus"]}); assert r.status_code in (200, 201), r.text
    S["site"] = r.json()["id"]; CREATED["site"].append(S["site"])


# ---------- (1) taşeron normalization & site summary ----------
def test_taseron_gider_normalized_and_not_site_expense(c):
    r = tx(c, account_id=S["tas"], site_id=S["site"], category="Malzeme", amount=20000, date="2026-05-01")
    assert r.status_code == 201
    assert r.json()["category"] == "Taşeron Avansı"
    S["adv_tx"] = r.json()["id"]
    assert c.post(f"{API}/transactions/{S['adv_tx']}/approve").status_code == 200
    sm = c.get(f"{API}/sites/{S['site']}").json()["summary"]
    assert sm["total_expense"] == 0, sm
    assert sm["subcontractor_paid"] == 20000, sm


def test_categories(c):
    d = c.get(f"{API}/transactions/categories").json()
    assert "Taşeron Hakediş Ödemesi" not in d["gider"]
    ids = {k["id"] for k in d["kasa_list"]}
    assert {"nakit", "cek", "genel_gider"} <= ids


# ---------- (3) kasalar ----------
def test_kasalar_crud(c):
    rows = c.get(f"{API}/kasalar").json()
    sys_ids = {k["id"] for k in rows if k.get("system")}
    assert {"nakit", "cek", "genel_gider"} <= sys_ids
    r = c.post(f"{API}/kasalar", json={"name": "TEST Banka", "kind": "banka"})
    assert r.status_code == 201, r.text
    kid = r.json()["id"]; assert kid == "test_banka"; CREATED["kasa"].append(kid)
    assert c.put(f"{API}/kasalar/{kid}", json={"name": "TEST Banka 2", "kind": "banka"}).status_code == 200
    assert any(k["id"] == kid and k["name"] == "TEST Banka 2" for k in c.get(f"{API}/kasalar").json())
    r = c.delete(f"{API}/kasalar/genel_gider"); assert r.status_code == 400 and "Sistem kasası silinemez" in r.text
    r = tx(c, type="gelir", category="Diğer", amount=10, kasa=kid); assert r.status_code == 201
    # delete blocked while used
    assert c.delete(f"{API}/kasalar/{kid}").status_code == 400
    c.delete(f"{API}/transactions/{r.json()['id']}")
    assert c.delete(f"{API}/kasalar/{kid}").status_code == 200
    CREATED["kasa"].remove(kid)
    assert tx(c, kasa="yok").status_code == 400


# ---------- (3) müşteri hakediş %6 virman ----------
def _hak(c, typ, acc, subtotal, vat=20, overhead=True, adv=0):
    body = {"site_id": S["site"], "account_id": acc, "type": typ, "date": "2026-06-05",
            "items": [{"description": "TEST_item", "unit": "m²", "quantity": 1, "unit_price": subtotal}],
            "vat_rate": vat, "apply_overhead": overhead, "advance_deduction": adv}
    r = c.post(f"{API}/progress-payments", json=body)
    assert r.status_code == 201, r.text
    CREATED["pp"].append(r.json()["id"])
    return r.json()


def _gg_balance(c):
    return next(k["balance"] for k in c.get(f"{API}/kasalar").json() if k["id"] == "genel_gider")


def test_customer_overhead_virman(c):
    h = _hak(c, "musteri", S["mus"], 100000)
    assert h["overhead_amount"] == 6000
    before = _gg_balance(c)
    assert c.patch(f"{API}/progress-payments/{h['id']}/status", json={"status": "onaylandi"}).status_code == 200
    g = c.get(f"{API}/progress-payments/{h['id']}").json()
    assert g.get("overhead_tx_id")
    vt = [t for t in c.get(f"{API}/transactions", params={"type": "virman"}).json() if t.get("progress_payment_id") == h["id"]]
    assert len(vt) == 1 and vt[0]["amount"] == 6000 and vt[0]["kasa"] == "genel_gider" and vt[0]["category"] == "Genel Gider Payı (%6)"
    assert vt[0].get("kasa_from") is None
    assert round(_gg_balance(c) - before, 2) == 6000
    # virman delete blocked
    assert c.delete(f"{API}/transactions/{vt[0]['id']}").status_code == 400
    # dashboard/reports while approved
    d = c.get(f"{API}/dashboard").json()
    assert any(k.get("id") == "genel_gider" for k in d["kasa"]["list"]), d["kasa"]
    assert "realized_overhead" in d["totals"]
    rep = c.get(f"{API}/reports").json()
    assert any(k["id"] == "genel_gider" for k in rep["kasa"]["list"])
    allv = sum(t["amount"] for t in c.get(f"{API}/transactions", params={"type": "virman"}).json()
               if t.get("category") == "Genel Gider Payı (%6)" and t.get("status") == "onaylandi" and t.get("site_id"))
    S["rep_gg"] = (rep["kar_zarar"]["genel_gider"], allv)
    # back to taslak
    assert c.patch(f"{API}/progress-payments/{h['id']}/status", json={"status": "taslak"}).status_code == 200
    g = c.get(f"{API}/progress-payments/{h['id']}").json()
    assert not g.get("overhead_tx_id")
    assert not [t for t in c.get(f"{API}/transactions", params={"type": "virman"}).json() if t.get("progress_payment_id") == h["id"]]
    # approve again then delete
    c.patch(f"{API}/progress-payments/{h['id']}/status", json={"status": "onaylandi"})
    assert [t for t in c.get(f"{API}/transactions", params={"type": "virman"}).json() if t.get("progress_payment_id") == h["id"]]
    assert c.delete(f"{API}/progress-payments/{h['id']}").status_code == 200
    CREATED["pp"].remove(h["id"])
    assert not [t for t in c.get(f"{API}/transactions", params={"type": "virman"}).json() if t.get("progress_payment_id") == h["id"]]
    assert round(_gg_balance(c) - before, 2) == 0


def test_reports_genel_gider_matches_virman(c):
    rep, allv = S["rep_gg"]
    assert abs(rep - allv) < 1, S["rep_gg"]


def test_taseron_no_overhead(c):
    h = _hak(c, "taseron", S["tas"], 10000, overhead=True)
    assert h["overhead_amount"] == 0 and h["overhead_rate"] == 0
    c.delete(f"{API}/progress-payments/{h['id']}"); CREATED["pp"].remove(h["id"])


# ---------- (2) advance deduction ----------
def test_advance_deduction_flow(c):
    ab = c.get(f"{API}/progress-payments/advance-balance", params={"account_id": S["tas"]}).json()
    assert ab["outstanding"] == 20000, ab
    h = _hak(c, "taseron", S["tas"], 50000, vat=0, adv=20000)
    assert h["net_amount"] == 30000 and h["advance_deduction"] == 20000
    S["tas_h"] = h["id"]
    assert c.patch(f"{API}/progress-payments/{h['id']}/status", json={"status": "onaylandi"}).status_code == 200
    acc = next(a for a in c.get(f"{API}/accounts", params={"type": "taseron"}).json() if a["id"] == S["tas"])
    assert acc["total_progress"] == 50000 and acc["total_paid"] == 20000 and acc["balance"] == 30000, acc
    ab = c.get(f"{API}/progress-payments/advance-balance", params={"account_id": S["tas"]}).json()
    assert ab["outstanding"] == 0, ab


def test_statement_consistent_with_balance(c):
    st = c.get(f"{API}/accounts/{S['tas']}/statement").json()
    av = [r for r in st["rows"] if r["type"] == "avans"]
    assert av and av[0].get("tx", {}).get("id")
    last = st["rows"][-1]["balance"]
    assert last == st["account"]["balance"], f"statement final balance {last} != account balance {st['account']['balance']}"


def test_progress_pay_closes(c):
    r = c.post(f"{API}/progress-payments/{S['tas_h']}/pay", json={"date": "2026-06-20", "nakit_amount": 30000})
    assert r.status_code == 201, r.text
    for t in r.json()["created"]:
        CREATED["tx"].append(t["id"])
        assert t["category"] == "Taşeron Hakediş Ödemesi"
        c.post(f"{API}/transactions/{t['id']}/approve")
    assert c.get(f"{API}/progress-payments/{S['tas_h']}").json()["status"] == "odendi"


# ---------- (4) duplicates ----------
def test_duplicates(c):
    r1 = tx(c, account_id=S["mus"], type="gider", category="Diğer", amount=1234.5, date="2026-06-10"); assert r1.status_code == 201
    r2 = tx(c, account_id=S["mus"], type="gider", category="Diğer", amount=1234.5, date="2026-06-11"); assert r2.status_code == 201
    assert r1.json()["id"] in r2.json()["duplicate_of"]
    d = c.get(f"{API}/transactions/check-duplicate", params={"amount": 1234.5, "date": "2026-06-12", "account_id": S["mus"], "type": "gider"}).json()
    assert len(d["duplicates"]) >= 1 and d["warning"]
    d = c.get(f"{API}/transactions/check-duplicate", params={"amount": 1234.5, "date": "2026-06-20", "account_id": S["mus"], "type": "gider"}).json()
    assert d["duplicates"] == [] and not d["warning"]


# ---------- (5) WhatsApp ----------
def test_whatsapp_template(c):
    d = c.get(f"{API}/whatsapp/template").json()
    assert "Kasa :" in d["template"]


def test_whatsapp_parse_taseron(c):
    text = "Kasa : Devrantaş nakit\nÖdeme : avans\nTarih : 26.10.2026\nTutar : 50.000 tl\nŞantiye : TEST_Santiye Ylmz\nTaşeron : TEST_Taseron Zeki"
    d = c.post(f"{API}/whatsapp/parse", json={"text": text}).json()
    assert d["type"] == "gider" and d["category"] == "Taşeron Avansı" and d["amount"] == 50000
    assert d["date"] == "2026-10-26" and d["kasa"] == "nakit"
    assert d["site_id"] == S["site"] and d["account_id"] == S["tas"], d


def test_whatsapp_parse_musteri(c):
    text = "Kasa : Devrantaş Çek\nÖdeme : Tahsilat\nTarih : 26.10.2026\nTutar : 120.000 TL\nŞantiye : TEST_Santiye Ylmz\nMüşteri : TEST_Musteri Kemal"
    d = c.post(f"{API}/whatsapp/parse", json={"text": text}).json()
    assert d["type"] == "gelir" and d["category"] == "Hakediş Tahsilatı" and d["account_id"] == S["mus"] and d["kasa"] == "cek", d
    assert d["amount"] == 120000


def test_whatsapp_inbound_unknown():
    r = requests.post(f"{API}/whatsapp/inbound", data={"From": "whatsapp:+905000000000", "Body": "Tutar : 10 TL"})
    assert r.status_code == 200 and "xml" in r.headers.get("content-type", "") and "tanımlı değil" in r.text


# ---------- (6) accounts active ----------
def test_accounts_active(c):
    assert c.patch(f"{API}/accounts/{S['tas']}/active", json={"is_active": False}).status_code == 200
    act = [a["id"] for a in c.get(f"{API}/accounts", params={"type": "taseron", "active": "true"}).json()]
    pas = [a["id"] for a in c.get(f"{API}/accounts", params={"type": "taseron", "active": "false"}).json()]
    assert S["tas"] not in act and S["tas"] in pas
    assert c.patch(f"{API}/accounts/{S['tas']}/active", json={"is_active": True}).status_code == 200
    assert S["tas"] in [a["id"] for a in c.get(f"{API}/accounts", params={"type": "taseron", "active": "true"}).json()]


# ---------- (7) planned payments ----------
def test_planned_payment_cek(c):
    r = c.post(f"{API}/payments", json={"type": "cek", "kasa": "cek", "title": "TEST_Cek odeme", "amount": 777, "due_date": "2026-07-01"})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]; CREATED["pay"].append(pid)
    r = c.patch(f"{API}/payments/{pid}/paid", json={"kasa": "cek", "date": "2026-06-15"})
    assert r.status_code == 200, r.text
    tid = r.json()["transaction_id"]; assert tid; CREATED["tx"].append(tid)
    t = next(x for x in c.get(f"{API}/transactions", params={"type": "gider"}).json() if x["id"] == tid)
    assert t["description"] == "Planlı ödeme: TEST_Cek odeme" and t["kasa"] == "cek" and t["date"] == "2026-06-15"
    assert t.get("check_id")
    chk = [x for x in c.get(f"{API}/checks").json() if x["id"] == t["check_id"]]
    assert chk and chk[0]["due_date"] == "2026-07-01"
    r = c.patch(f"{API}/payments/{pid}/paid", json={"kasa": "cek", "date": "2026-06-15"})
    assert r.json()["transaction_id"] == tid
    assert c.post(f"{API}/payments", json={"type": "foo", "title": "TEST_x", "amount": 1, "due_date": "2026-07-01"}).status_code == 400


# ---------- dashboard / reports export ----------
def test_reports_export_kasa(c):
    r = c.get(f"{API}/reports/export", params={"tab": "kasa", "format": "excel"})
    assert r.status_code == 200 and len(r.content) > 100


# ---------- (8) settings distribution ----------
def test_settings_distribution(c):
    cur = c.get(f"{API}/settings").json()
    orig = {"github_repo": cur.get("github_repo") or "", "testflight_url": cur.get("testflight_url") or ""}
    try:
        r = c.put(f"{API}/settings/distribution", json={"github_repo": "https://github.com/a/b/", "testflight_url": orig["testflight_url"]})
        assert r.status_code == 200 and r.json()["github_repo"] == "a/b", r.text
        assert c.put(f"{API}/settings/distribution", json={"github_repo": "bad repo"}).status_code == 400
    finally:
        c.put(f"{API}/settings/distribution", json=orig)


# ---------- regression: tx edit/delete ----------
def test_tx_edit_delete(c):
    r = tx(c, category="Nakliye", amount=55, site_id=S["site"]); assert r.status_code == 201
    tid = r.json()["id"]
    r = c.put(f"{API}/transactions/{tid}", json={"amount": 66, "description": "TEST_edited"})
    assert r.status_code == 200 and r.json()["amount"] == 66
    assert c.delete(f"{API}/transactions/{tid}").status_code == 200
    assert tid not in [t["id"] for t in c.get(f"{API}/transactions").json()]
