# Iteration 8: müşteri /pay blocked, advance-balance formula, customer income auto-category, dashboard summary, distribution status
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
CREATED = {"tx": [], "pp": [], "acc": [], "site": []}
S = {}


@pytest.fixture(scope="module")
def c():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@devrantas.com", "password": "Devrantas2026!"})
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    yield s
    for pid in CREATED["pp"]:
        s.delete(f"{API}/progress-payments/{pid}")
    for tid in CREATED["tx"]:
        s.delete(f"{API}/transactions/{tid}")
    for a in CREATED["acc"]:
        s.delete(f"{API}/accounts/{a}")
    for si in CREATED["site"]:
        s.delete(f"{API}/sites/{si}")
    s.put(f"{API}/settings/distribution", json={"github_repo": "", "testflight_url": ""})


def tx(c, **kw):
    body = {"type": "gelir", "category": "Avans", "amount": 100, "date": "2026-06-01", "kasa": "nakit", "description": "TEST_tx"}
    body.update(kw)
    r = c.post(f"{API}/transactions", json=body)
    if r.status_code == 201:
        CREATED["tx"].append(r.json()["id"])
    return r


def hak(c, typ, acc, subtotal, adv=0):
    body = {"site_id": S["site"], "account_id": acc, "type": typ, "date": "2026-06-05",
            "items": [{"description": "TEST_item", "unit": "m²", "quantity": 1, "unit_price": subtotal}],
            "vat_rate": 0, "apply_overhead": False, "advance_deduction": adv}
    r = c.post(f"{API}/progress-payments", json=body)
    assert r.status_code == 201, r.text
    CREATED["pp"].append(r.json()["id"])
    return r.json()


def approve(c, pid):
    assert c.patch(f"{API}/progress-payments/{pid}/status", json={"status": "onaylandi"}).status_code == 200


def adv(c, aid):
    return c.get(f"{API}/progress-payments/advance-balance", params={"account_id": aid}).json()


def acc_of(c, aid, typ="musteri"):
    return next(a for a in c.get(f"{API}/accounts", params={"type": typ}).json() if a["id"] == aid)


def test_setup(c):
    for key, name, typ in (("mus", "TEST_Musteri It8", "musteri"), ("mus2", "TEST_Musteri It8 B", "musteri"),
                           ("mus3", "TEST_Musteri It8 C", "musteri"), ("tas", "TEST_Taseron It8", "taseron")):
        r = c.post(f"{API}/accounts", json={"name": name, "type": typ}); assert r.status_code == 201, r.text
        S[key] = r.json()["id"]; CREATED["acc"].append(S[key])
    r = c.post(f"{API}/sites", json={"name": "TEST_Santiye It8", "contract_amount": 1000000, "customer_id": S["mus"]})
    assert r.status_code in (200, 201), r.text
    S["site"] = r.json()["id"]; CREATED["site"].append(S["site"])


# (1) müşteri pay blocked
def test_customer_pay_blocked(c):
    h = hak(c, "musteri", S["mus3"], 100000)
    approve(c, h["id"])
    r = c.post(f"{API}/progress-payments/{h['id']}/pay", json={"date": "2026-06-10", "nakit_amount": 1000})
    assert r.status_code == 400 and "İşlemler" in r.json()["detail"], r.text


def test_taseron_pay_ok(c):
    h = hak(c, "taseron", S["tas"], 10000)
    approve(c, h["id"])
    r = c.post(f"{API}/progress-payments/{h['id']}/pay", json={"date": "2026-06-10", "nakit_amount": 4000})
    assert r.status_code == 201, r.text
    for t in r.json()["created"]:
        CREATED["tx"].append(t["id"])
        assert t["category"] == "Taşeron Hakediş Ödemesi"
    assert r.json()["pending"] == 4000


# (2) advance-balance formula
def test_advance_balance_flow(c):
    a = S["mus"]
    r = tx(c, account_id=a, site_id=S["site"], amount=3000000, category="Avans"); assert r.status_code == 201
    assert r.json()["category"] == "Avans"
    assert adv(c, a)["outstanding"] == 3000000
    h = hak(c, "musteri", a, 8000000, adv=3000000)
    assert h["net_amount"] == 5000000
    ab = c.get(f"{API}/progress-payments/advance-balance", params={"account_id": a, "exclude_pid": h["id"]}).json()
    assert ab["outstanding"] == 3000000
    approve(c, h["id"])
    assert adv(c, a)["outstanding"] == 0
    r = tx(c, account_id=a, site_id=S["site"], amount=5000000, category="Hakediş Tahsilatı", date="2026-06-07"); assert r.status_code == 201
    assert r.json()["category"] == "Hakediş Tahsilatı"
    assert adv(c, a)["outstanding"] == 0
    assert acc_of(c, a)["balance"] == 0
    r = tx(c, account_id=a, site_id=S["site"], amount=1000000, category="Hakediş Tahsilatı", date="2026-06-09"); assert r.status_code == 201
    assert r.json()["category"] == "Avans"  # balance was 0 -> Avans
    assert adv(c, a)["outstanding"] == 1000000
    assert acc_of(c, a)["balance"] == -1000000


# (3) auto-category
def test_customer_income_auto_category(c):
    a = S["mus2"]
    r = tx(c, account_id=a, amount=500, category="Hakediş Tahsilatı"); assert r.status_code == 201
    assert r.json()["category"] == "Avans"
    h = hak(c, "musteri", a, 100000); approve(c, h["id"])
    r = tx(c, account_id=a, amount=600, category="Avans", date="2026-06-03"); assert r.status_code == 201
    assert r.json()["category"] == "Hakediş Tahsilatı"
    # Diğer untouched
    r = tx(c, account_id=a, amount=700, category="Diğer", date="2026-06-04"); assert r.status_code == 201
    assert r.json()["category"] == "Diğer"


# (4) dashboard summary
def test_dashboard_summary(c):
    d = c.get(f"{API}/dashboard").json()
    sm = d["summary"]
    for k in ("pending_expense", "pending_progress", "planned_payments"):
        assert isinstance(sm[k]["total"], (int, float)) and isinstance(sm[k]["count"], int)
    assert isinstance(sm["approved_expense_all"], (int, float))
    taslak = [p for p in c.get(f"{API}/progress-payments").json() if p["status"] == "taslak"]
    assert sm["pending_progress"]["count"] == len(taslak)
    assert abs(sm["pending_progress"]["total"] - sum(p["net_amount"] for p in taslak)) < 1


# (6) distribution
def test_distribution_parse_and_status(c):
    r = c.put(f"{API}/settings/distribution", json={"github_repo": "https://github.com/electron/electron/actions"})
    assert r.status_code == 200 and r.json()["github_repo"] == "electron/electron", r.text
    r = c.put(f"{API}/settings/distribution", json={"github_repo": "https://github.com/owner/repo/actions/runs/1"})
    assert r.json()["github_repo"] == "owner/repo"
    r = c.put(f"{API}/settings/distribution", json={"github_repo": "owner/repo.git"})
    assert r.json()["github_repo"] == "owner/repo"
    c.put(f"{API}/settings/distribution", json={"github_repo": "electron/electron"})
    st = c.get(f"{API}/settings/distribution/status", timeout=40).json()
    print(st)
    if st.get("error") and "sınır" in st["error"]:
        pytest.skip("GitHub rate limit")
    assert st["repo_ok"] is True and st["release_ok"] is True and st["assets"], st
    assert st["workflow_ok"] is False
    assert any("Save to GitHub" in s for s in st["steps"])
    for k in ("runs", "steps", "assets"):
        assert isinstance(st[k], list)


def test_distribution_empty(c):
    c.put(f"{API}/settings/distribution", json={"github_repo": ""})
    st = c.get(f"{API}/settings/distribution/status").json()
    assert st["repo"] == "" and any("Save to GitHub" in s for s in st["steps"])


# regression
def test_regression_taseron_avans_not_site_expense(c):
    r = tx(c, type="gider", account_id=S["tas"], site_id=S["site"], category="Malzeme", amount=1500); assert r.status_code == 201
    assert r.json()["category"] == "Taşeron Avansı"
    assert c.post(f"{API}/transactions/{r.json()['id']}/approve").status_code == 200
    sm = c.get(f"{API}/sites/{S['site']}").json()["summary"]
    assert sm["direct_expense"] == 0 and sm["total_expense"] == sm["subcontractor_expense"], sm  # avans not expense; approved taşeron hakediş is


def test_regression_kasalar_whatsapp(c):
    ids = {k["id"] for k in c.get(f"{API}/kasalar").json()}
    assert {"nakit", "cek", "genel_gider"} <= ids
    text = "Kasa : Devrantaş nakit\nÖdeme : avans\nTarih : 26.10.2026\nTutar : 50.000 tl\nŞantiye : TEST_Santiye It8\nTaşeron : TEST_Taseron It8"
    d = c.post(f"{API}/whatsapp/parse", json={"text": text}).json()
    assert d["amount"] == 50000 and d["account_id"] == S["tas"] and d["site_id"] == S["site"], d
