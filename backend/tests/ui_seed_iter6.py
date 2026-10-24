# Seed/cleanup helper for iteration 6 UI tests (TEST_ data only). usage: python ui_seed_iter6.py seed|cleanup
import os, sys, json, requests
B = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
s = requests.Session()
tok = s.post(f"{B}/api/auth/login", json={"email": "admin@devrantas.com", "password": "Devrantas2026!"}).json()["access_token"]
s.headers["Authorization"] = f"Bearer {tok}"
F = "/tmp/ui_seed6.json"
if sys.argv[1] == "seed":
    site = s.post(f"{B}/api/sites", json={"name": "TEST_UISite6"}).json()
    tas = s.post(f"{B}/api/accounts", json={"name": "TEST_UITaseron6", "type": "taseron"}).json()
    mus = s.post(f"{B}/api/accounts", json={"name": "TEST_UIMusteri6", "type": "musteri"}).json()
    pp = s.post(f"{B}/api/progress-payments", json={"site_id": site["id"], "account_id": tas["id"], "type": "taseron", "date": "2026-01-12", "items": [{"description": "TEST_UIkalem6", "quantity": 10, "unit_price": 100}], "vat_rate": 0, "apply_overhead": False}).json()
    s.patch(f"{B}/api/progress-payments/{pp['id']}/status", json={"status": "onaylandi"})
    r = s.post(f"{B}/api/progress-payments/{pp['id']}/pay", json={"date": "2026-01-13", "nakit_amount": 1000}).json()
    txs = [t["id"] for t in r["created"]]
    for t in r["created"]:
        if t["status"] == "onay_bekliyor": s.post(f"{B}/api/transactions/{t['id']}/approve")
    u = s.post(f"{B}/api/auth/register-sub", json={"email": "test_ui_sef6@example.com", "password": "TestPass123!", "name": "TEST_UISef6", "role": "santiye_sefi"}).json()
    st = s.get(f"{B}/api/progress-payments/{pp['id']}").json()["status"]
    d = {"site": site["id"], "tas": tas["id"], "mus": mus["id"], "tx": txs, "pp": pp["id"], "user": u["id"], "pp_status": st}
    json.dump(d, open(F, "w")); print(json.dumps(d))
else:
    d = json.load(open(F))
    for t in d["tx"]: s.delete(f"{B}/api/transactions/{t}")
    s.delete(f"{B}/api/progress-payments/{d['pp']}")
    for a in (d["tas"], d["mus"]): s.delete(f"{B}/api/accounts/{a}")
    s.delete(f"{B}/api/sites/{d['site']}")
    s.delete(f"{B}/api/auth/users/{d['user']}")
    defaults = s.get(f"{B}/api/auth/permissions").json()["defaults"]
    s.put(f"{B}/api/auth/permissions", json={"roles": defaults})
    print("cleaned")
