# Seed/cleanup TEST_ data for iteration 7 UI tests. Usage: python ui_seed_iter7.py seed|clean
import os, sys, json, requests
API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
s = requests.Session()
s.headers["Authorization"] = "Bearer " + s.post(f"{API}/auth/login", json={"email": "admin@devrantas.com", "password": "Devrantas2026!"}).json()["access_token"]
F = "/tmp/iter7_seed.json"
if sys.argv[1] == "seed":
    tas = s.post(f"{API}/accounts", json={"name": "TEST_UI Taseron", "type": "taseron"}).json()["id"]
    site = s.post(f"{API}/sites", json={"name": "TEST_UI Santiye", "contract_amount": 500000, "status": "devam"}).json()["id"]
    t = s.post(f"{API}/transactions", json={"type": "gider", "category": "Malzeme", "amount": 4321, "date": "2026-01-10", "kasa": "nakit",
                                           "account_id": tas, "site_id": site, "description": "TEST_UI avans"}).json()["id"]
    s.post(f"{API}/transactions/{t}/approve")
    json.dump({"tas": tas, "site": site, "tx": t}, open(F, "w")); print(json.load(open(F)))
else:
    d = json.load(open(F))
    for t in s.get(f"{API}/transactions").json():
        if (t.get("description") or "").startswith("TEST") or t.get("account_id") == d["tas"]:
            print("del tx", s.delete(f"{API}/transactions/{t['id']}").status_code)
    for k in s.get(f"{API}/kasalar").json():
        if k["name"].startswith("TEST"):
            print("del kasa", s.delete(f"{API}/kasalar/{k['id']}").status_code)
    print(s.delete(f"{API}/accounts/{d['tas']}").status_code, s.delete(f"{API}/sites/{d['site']}").status_code)
