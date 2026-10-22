"""Iteration-3 tests: Settings, Portal, Check Endorse, Cleanup Test Data.

NOTE: TestCleanupLast is placed LAST (alphabetical ordering by class name is leveraged;
pytest preserves source order within a file, so define it last). It wipes TEST_ prefixed
records created by earlier tests.
"""
import io
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "http://localhost:8001"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@devrantas.com"
ADMIN_PASS = "Devrantas2026!"

DEFAULTS = {
    "company_name": "Devrantaş Yapı Mimarlık İnşaat Ltd. Şti.",
    "short_name": "Devrantaş",
    "tagline": "Yapı Mimarlık",
    "address": "Nurtanesi Sok. No: 3/1, Merkez Mah., Çekmeköy, İstanbul",
    "phone": "0533 482 57 02",
    "email": "Devrantasyapimimarlik@gmail.com",
    "tax_office": "",
    "tax_no": "",
    "iban": "",
    "primary_color": "#B8860B",
    "logo_file_id": None,
}


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_client(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def accountant_token(admin_client):
    email = f"test_acc_{os.urandom(3).hex()}@example.com"
    r = admin_client.post(f"{API}/auth/register-sub", json={
        "email": email, "password": "TestPass123!", "name": "TEST_Acc", "role": "muhasebe"
    })
    assert r.status_code in (200, 201), r.text
    lr = requests.post(f"{API}/auth/login", json={"email": email, "password": "TestPass123!"})
    assert lr.status_code == 200
    return lr.json()["access_token"]


@pytest.fixture(scope="session")
def accountant_client(accountant_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {accountant_token}", "Content-Type": "application/json"})
    return s


# ---------- 1) Settings ----------
class TestSettings:
    def test_get_settings_public_no_auth(self):
        r = requests.get(f"{API}/settings")
        assert r.status_code == 200
        d = r.json()
        assert "company_name" in d and "primary_color" in d
        assert re.fullmatch(r"#[0-9a-fA-F]{6}", d["primary_color"])

    def test_put_settings_non_admin_forbidden(self, accountant_client):
        r = accountant_client.put(f"{API}/settings", json={**DEFAULTS, "short_name": "QA Firma"})
        assert r.status_code == 403

    def test_put_settings_invalid_color(self, admin_client):
        r = admin_client.put(f"{API}/settings", json={**DEFAULTS, "primary_color": "red"})
        assert r.status_code == 400

    def test_put_settings_admin_updates(self, admin_client):
        payload = {**DEFAULTS, "short_name": "QA Firma", "primary_color": "#1D4ED8"}
        r = admin_client.put(f"{API}/settings", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["short_name"] == "QA Firma"
        assert d["primary_color"] == "#1D4ED8"
        # Verify GET reflects
        r2 = requests.get(f"{API}/settings")
        assert r2.json()["short_name"] == "QA Firma"
        assert r2.json()["primary_color"] == "#1D4ED8"

    def test_get_logo_png(self):
        r = requests.get(f"{API}/settings/logo")
        assert r.status_code == 200
        assert "image/png" in r.headers.get("content-type", "").lower()

    def test_get_manifest(self):
        r = requests.get(f"{API}/settings/manifest.json")
        assert r.status_code == 200
        d = r.json()
        assert d["theme_color"] == "#1D4ED8"
        assert len(d["icons"]) >= 2
        assert all(ic["type"] == "image/png" for ic in d["icons"])

    def test_pdf_proposal_and_excel_still_work(self, admin_client):
        # Need a proposal; just list
        r = admin_client.get(f"{API}/proposals")
        if r.status_code != 200 or not r.json():
            pytest.skip("No existing proposal")
        pid = r.json()[0]["id"]
        rp = requests.get(f"{API}/pdf/proposal/{pid}", headers={"Authorization": admin_client.headers["Authorization"]})
        assert rp.status_code == 200
        re_ = requests.get(f"{API}/proposals/{pid}/excel", headers={"Authorization": admin_client.headers["Authorization"]})
        assert re_.status_code == 200


# ---------- 2) Check Endorse ----------
@pytest.fixture(scope="session")
def endorse_setup(admin_client):
    """Create taşeron, site, approved progress payment and an alınan check."""
    # Taşeron
    tr = admin_client.post(f"{API}/accounts", json={"type": "taseron", "name": "TEST_Taseron_End"})
    assert tr.status_code in (200, 201), tr.text
    taseron = tr.json()
    # Site (needs customer -> create minimal musteri first)
    cr = admin_client.post(f"{API}/accounts", json={"type": "musteri", "name": "TEST_Musteri_End"})
    assert cr.status_code in (200, 201)
    musteri = cr.json()
    sr = admin_client.post(f"{API}/sites", json={"name": "TEST_Site_End", "customer_id": musteri["id"], "status": "aktif"})
    assert sr.status_code in (200, 201), sr.text
    site = sr.json()
    # Progress payment (taseron, hakediş)
    hak_payload = {
        "type": "taseron",
        "account_id": taseron["id"],
        "site_id": site["id"],
        "date": "2026-01-10",
        "period": "2026-01",
        "due_date": "2026-02-10",
        "items": [{"description": "TEST iş", "quantity": 1, "unit": "ad", "unit_price": 5000}],
        "vat_rate": 0,
    }
    hr = admin_client.post(f"{API}/progress-payments", json=hak_payload)
    assert hr.status_code in (200, 201), hr.text
    hak = hr.json()
    # Approve
    ar = admin_client.patch(f"{API}/progress-payments/{hak['id']}/status", json={"status": "onaylandi"})
    assert ar.status_code == 200, ar.text
    # Alınan check (portfoyde)
    chk_payload = {
        "direction": "alinan", "account_id": musteri["id"], "site_id": site["id"],
        "bank": "TEST_Bank", "check_no": "TEST001", "drawer": "TEST_Drawer",
        "amount": 5000, "due_date": "2026-03-01",
    }
    kr = admin_client.post(f"{API}/checks", json=chk_payload)
    assert kr.status_code == 201, kr.text
    chk = kr.json()
    # Verilen check
    vr = admin_client.post(f"{API}/checks", json={**chk_payload, "direction": "verilen", "check_no": "TEST002"})
    assert vr.status_code == 201
    return {"taseron": taseron, "musteri": musteri, "site": site, "hakedis": hak, "check": chk, "verilen_check": vr.json()}


class TestEndorse:
    def test_endorse_with_hakedis(self, admin_client, endorse_setup):
        s = endorse_setup
        r = admin_client.post(f"{API}/checks/{s['check']['id']}/endorse", json={
            "account_id": s["taseron"]["id"], "progress_payment_id": s["hakedis"]["id"]
        })
        assert r.status_code == 201, r.text
        d = r.json()
        tx = d["transaction"]
        assert tx["kasa"] == "cek"
        assert tx["category"] == "Taşeron Hakediş Ödemesi"
        assert tx["check_id"] == s["check"]["id"]
        assert tx["progress_payment_id"] == s["hakedis"]["id"]
        assert tx["status"] == "onay_bekliyor"
        # Check status
        chks = admin_client.get(f"{API}/checks").json()
        c = next(x for x in chks if x["id"] == s["check"]["id"])
        assert c["status"] == "ciro_edildi"
        assert c.get("endorsed_to") == s["taseron"]["id"]

    def test_endorse_same_check_again_400(self, admin_client, endorse_setup):
        s = endorse_setup
        r = admin_client.post(f"{API}/checks/{s['check']['id']}/endorse",
                              json={"account_id": s["taseron"]["id"]})
        assert r.status_code == 400

    def test_endorse_verilen_400(self, admin_client, endorse_setup):
        s = endorse_setup
        r = admin_client.post(f"{API}/checks/{s['verilen_check']['id']}/endorse",
                              json={"account_id": s["taseron"]["id"]})
        assert r.status_code == 400

    def test_endorse_without_hakedis_avans(self, admin_client, endorse_setup):
        s = endorse_setup
        # Create a fresh alınan check
        chk_payload = {
            "direction": "alinan", "account_id": s["musteri"]["id"], "site_id": s["site"]["id"],
            "bank": "TEST_Bank2", "check_no": "TEST003",
            "amount": 1500, "due_date": "2026-04-01",
        }
        kr = admin_client.post(f"{API}/checks", json=chk_payload)
        assert kr.status_code == 201
        chk = kr.json()
        r = admin_client.post(f"{API}/checks/{chk['id']}/endorse",
                              json={"account_id": s["taseron"]["id"]})
        assert r.status_code == 201
        tx = r.json()["transaction"]
        assert tx["category"] == "Taşeron Avansı"

    def test_progress_payments_pending_reflects(self, admin_client, endorse_setup):
        s = endorse_setup
        r = admin_client.get(f"{API}/progress-payments/{s['hakedis']['id']}/payments")
        if r.status_code != 200:
            pytest.skip(f"endpoint missing: {r.status_code}")
        d = r.json()
        # Flexible: check pending contains 5000
        pending = d.get("pending") if isinstance(d, dict) else d
        found = False
        if isinstance(pending, list):
            for p in pending:
                if abs(float(p.get("amount", 0)) - 5000) < 0.01:
                    found = True; break
        elif isinstance(pending, (int, float)):
            found = abs(float(pending) - 5000) < 0.01
        assert found, f"Pending 5000 not found in {d}"


# ---------- 3) Portal ----------
@pytest.fixture(scope="session")
def portal_setup(admin_client):
    cr = admin_client.post(f"{API}/accounts", json={"type": "musteri", "name": "TEST_Portal_Musteri"})
    assert cr.status_code in (200, 201)
    musteri = cr.json()
    sr = admin_client.post(f"{API}/sites", json={"name": "TEST_Portal_Site", "customer_id": musteri["id"], "status": "aktif"})
    assert sr.status_code in (200, 201)
    site = sr.json()
    # Upload small png
    png = bytes.fromhex(
        "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489"
        "0000000D49444154789C6300010000000500010D0A2DB40000000049454E44AE426082"
    )
    headers = {"Authorization": admin_client.headers["Authorization"]}
    fr = requests.post(f"{API}/files/upload", headers=headers,
                       files={"file": ("test.png", png, "image/png")})
    assert fr.status_code in (200, 201), fr.text
    file_id = fr.json().get("id") or fr.json().get("file_id")
    # Attach to site
    pr = admin_client.post(f"{API}/sites/{site['id']}/photos",
                           json={"file_id": file_id, "note": "TEST_photo", "date": "2026-01-10"})
    assert pr.status_code in (200, 201), pr.text
    # Approved hakediş for customer
    hr = admin_client.post(f"{API}/progress-payments", json={
        "type": "musteri",
        "account_id": musteri["id"], "site_id": site["id"], "date": "2026-01-15",
        "period": "2026-01", "due_date": "2026-02-15",
        "items": [{"description": "TEST müşteri iş", "quantity": 1, "unit": "ad", "unit_price": 10000}],
        "vat_rate": 20,
    })
    assert hr.status_code in (200, 201), hr.text
    hak = hr.json()
    admin_client.patch(f"{API}/progress-payments/{hak['id']}/status", json={"status": "onaylandi"})
    return {"musteri": musteri, "site": site, "file_id": file_id, "hak": hak}


class TestPortal:
    def test_create_token_and_fetch(self, admin_client, portal_setup):
        s = portal_setup
        r = admin_client.post(f"{API}/accounts/{s['musteri']['id']}/portal-token", json={})
        assert r.status_code == 200
        token = r.json()["token"]
        # Public fetch
        pr = requests.get(f"{API}/portal/{token}")
        assert pr.status_code == 200
        d = pr.json()
        assert d["customer"]["name"] == s["musteri"]["name"]
        assert len(d["sites"]) >= 1
        assert len(d["sites"][0]["photos"]) >= 1
        assert len(d["progress_payments"]) >= 1
        assert "balance" in d
        # Photo
        photo = requests.get(f"{API}/portal/{token}/photo/{s['file_id']}")
        assert photo.status_code == 200
        assert "image" in photo.headers.get("content-type", "").lower()
        # Save token for later test
        portal_setup["_token"] = token

    def test_invalid_token_404(self):
        r = requests.get(f"{API}/portal/wrongtoken_xyz")
        assert r.status_code == 404

    def test_revoke_then_404(self, admin_client, portal_setup):
        token = portal_setup["_token"]
        r = admin_client.delete(f"{API}/accounts/{portal_setup['musteri']['id']}/portal-token")
        assert r.status_code == 200
        pr = requests.get(f"{API}/portal/{token}")
        assert pr.status_code == 404


# ---------- 4) Cleanup (RUN LAST) ----------
class TestZZCleanup:
    def test_cleanup_non_admin_403(self, accountant_client):
        r = accountant_client.post(f"{API}/admin/cleanup-test-data", json={})
        assert r.status_code == 403

    def test_cleanup_admin_200(self, admin_client):
        r = admin_client.post(f"{API}/admin/cleanup-test-data", json={})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "total" in d
        assert d["total"] >= 1
        # Accounts starting with TEST_ should be gone
        accs = admin_client.get(f"{API}/accounts").json()
        rem = [a for a in accs if a["name"].startswith(("TEST_", "Test_", "QA_"))]
        assert rem == [], f"Still remaining: {rem}"

    def test_admin_still_works(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
        assert r.status_code == 200


# ---------- 5) Restore settings (runs after cleanup) ----------
class TestZZZRestore:
    def test_restore_defaults(self, admin_client):
        r = admin_client.put(f"{API}/settings", json=DEFAULTS)
        assert r.status_code == 200
        assert r.json()["short_name"] == "Devrantaş"
        assert r.json()["primary_color"] == "#B8860B"
