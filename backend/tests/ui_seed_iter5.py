# Seed/cleanup helper for iteration 5 UI tests (TEST_ data only). usage: python ui_seed_iter5.py seed|cleanup
import os, sys, json, requests
B = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
s = requests.Session()
tok = s.post(f"{B}/api/auth/login", json={"email": "admin@devrantas.com", "password": "Devrantas2026!"}).json()["access_token"]
s.headers["Authorization"] = f"Bearer {tok}"
F = "/tmp/ui_seed5.json"
if sys.argv[1] == "seed":
    site = s.post(f"{B}/api/sites", json={"name": "TEST_UISite"}).json()
    tas = s.post(f"{B}/api/accounts", json={"name": "TEST_UITaseron", "type": "taseron"}).json()
    mus = s.post(f"{B}/api/accounts", json={"name": "TEST_UIMusteri", "type": "musteri"}).json()
    av = s.post(f"{B}/api/transactions", json={"type": "gider", "category": "Taşeron Avansı", "amount": 1000, "date": "2026-01-10", "kasa": "nakit", "account_id": tas["id"], "site_id": site["id"], "description": "TEST_UIavans"}).json()
    s.post(f"{B}/api/transactions/{av['id']}/approve")
    pp = s.post(f"{B}/api/progress-payments", json={"site_id": site["id"], "account_id": tas["id"], "type": "taseron", "date": "2026-01-12", "items": [{"description": "TEST_UIkalem", "quantity": 30, "unit_price": 100}], "vat_rate": 0, "apply_overhead": False}).json()
    s.patch(f"{B}/api/progress-payments/{pp['id']}/status", json={"status": "onaylandi"})
    th = s.post(f"{B}/api/transactions", json={"type": "gelir", "category": "Hakediş Tahsilatı", "amount": 500, "date": "2026-01-11", "kasa": "nakit", "account_id": mus["id"], "site_id": site["id"], "description": "TEST_UItahsilat"}).json()
    g = s.post(f"{B}/api/transactions", json={"type": "gider", "category": "Malzeme", "amount": 123, "date": "2026-10-24", "kasa": "nakit", "site_id": site["id"], "description": "TEST_UIgider"}).json()
    d = {"site": site["id"], "tas": tas["id"], "mus": mus["id"], "tx": [av["id"], th["id"], g["id"]], "gider": g["id"], "pp": pp["id"]}
    json.dump(d, open(F, "w")); print(json.dumps(d))
else:
    d = json.load(open(F))
    for t in d["tx"]: s.delete(f"{B}/api/transactions/{t}")
    s.delete(f"{B}/api/progress-payments/{d['pp']}")
    for a in (d["tas"], d["mus"]): s.delete(f"{B}/api/accounts/{a}")
    s.delete(f"{B}/api/sites/{d['site']}")
    defaults = s.get(f"{B}/api/auth/permissions").json()["defaults"]
    s.put(f"{B}/api/auth/permissions", json={"roles": defaults})
    print("cleaned")
