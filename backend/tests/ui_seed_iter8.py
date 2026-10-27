# Seed/cleanup TEST_ data for iteration 8 UI tests. Usage: python ui_seed_iter8.py seed|clean
import os, sys, json, requests
API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
s = requests.Session()
s.headers["Authorization"] = "Bearer " + s.post(f"{API}/auth/login", json={"email": "admin@devrantas.com", "password": "Devrantas2026!"}).json()["access_token"]
F = "/tmp/iter8_seed.json"
if sys.argv[1] == "seed":
    site = s.post(f"{API}/sites", json={"name": "TEST_UI8 Santiye", "contract_amount": 500000, "status": "devam"}).json()["id"]
    mus = s.post(f"{API}/accounts", json={"name": "TEST_UI8 Musteri", "type": "musteri", "site_ids": [site]}).json()["id"]
    tas = s.post(f"{API}/accounts", json={"name": "TEST_UI8 Taseron", "type": "taseron"}).json()["id"]
    r = s.put(f"{API}/accounts/{tas}", json={"name": "TEST_UI8 Taseron", "type": "taseron", "site_ids": [site]}); print("put", r.status_code)
    h = s.post(f"{API}/progress-payments", json={"site_id": site, "account_id": mus, "type": "musteri", "date": "2026-01-10", "vat_rate": 0, "apply_overhead": False,
                                                 "items": [{"description": "TEST_item", "quantity": 1, "unit_price": 100000}]}).json()["id"]
    s.patch(f"{API}/progress-payments/{h}/status", json={"status": "onaylandi"})
    json.dump({"tas": tas, "mus": mus, "site": site, "pp": h}, open(F, "w")); print(json.load(open(F)))
else:
    d = json.load(open(F))
    print("pp", s.delete(f"{API}/progress-payments/{d['pp']}").status_code)
    for t in s.get(f"{API}/transactions").json():
        if (t.get("description") or "").startswith("TEST") or t.get("account_id") in (d["tas"], d["mus"]) or t.get("site_id") == d["site"]:
            print("del tx", s.delete(f"{API}/transactions/{t['id']}").status_code)
    print(s.delete(f"{API}/accounts/{d['tas']}").status_code, s.delete(f"{API}/accounts/{d['mus']}").status_code, s.delete(f"{API}/sites/{d['site']}").status_code)
    s.put(f"{API}/settings/distribution", json={"github_repo": "", "testflight_url": ""})
