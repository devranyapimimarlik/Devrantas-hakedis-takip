"""
Devrantas ERP — Iteration 2 backend tests.
Covers: (1) /progress-payments/{id}/pay flow (nakit+cek split, auto odendi, site expense not doubled),
(2) reports export xlsx+pdf for all 8 tabs, (3) daily summary + cron + alerts/history + alerts/send,
(4) site photos add/list/delete and PDF append, (5) AI work-catalog (19 items).
"""
import io
import os
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip()
                break
API = f"{BASE_URL.rstrip('/')}/api"

ADMIN_EMAIL = "admin@devrantas.com"
ADMIN_PASSWORD = "Devrantas2026!"

TODAY = date.today().isoformat()
IN_15 = (date.today() + timedelta(days=15)).isoformat()
IN_2 = (date.today() + timedelta(days=2)).isoformat()

CRON_SECRET = None
with open("/app/backend/.env") as f:
    for line in f:
        if line.startswith("WEBHOOK_CRON_SECRET"):
            CRON_SECRET = line.split("=", 1)[1].strip().strip('"').strip("'")
            break


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def ctx(admin):
    """Create a dedicated taseron+site+approved hakedis for iteration-2 tests."""
    tag = uuid.uuid4().hex[:6]
    musteri = admin.post(f"{API}/accounts", json={"name": f"TEST_Musteri_I2_{tag}", "type": "musteri"}).json()
    taseron = admin.post(f"{API}/accounts", json={"name": f"TEST_Taseron_I2_{tag}", "type": "taseron", "specialty": "Kaba"}).json()
    site = admin.post(f"{API}/sites", json={"name": f"TEST_Site_I2_{tag}", "contract_amount": 1_000_000,
                                             "customer_id": musteri["id"], "status": "devam", "progress_percent": 10}).json()
    hak = admin.post(f"{API}/progress-payments", json={
        "site_id": site["id"], "account_id": taseron["id"], "type": "taseron", "date": TODAY,
        "items": [{"description": "Kaba yapı", "unit": "m²", "quantity": 100, "unit_price": 1000}],
        "vat_rate": 20, "apply_overhead": True,
    }).json()
    return {"musteri_id": musteri["id"], "taseron_id": taseron["id"], "site_id": site["id"],
            "hakedis_id": hak["id"], "net": hak["net_amount"]}


# ======================= 1. Hakediş Pay flow =======================
class TestProgressPay:
    def test_pay_taslak_rejected(self, admin, ctx):
        r = admin.post(f"{API}/progress-payments/{ctx['hakedis_id']}/pay",
                       json={"date": TODAY, "nakit_amount": 100})
        assert r.status_code == 400

    def test_approve_hakedis(self, admin, ctx):
        r = admin.patch(f"{API}/progress-payments/{ctx['hakedis_id']}/status", json={"status": "onaylandi"})
        assert r.status_code == 200

    def test_cek_without_due_rejected(self, admin, ctx):
        r = admin.post(f"{API}/progress-payments/{ctx['hakedis_id']}/pay",
                       json={"date": TODAY, "cek_amount": 500})
        assert r.status_code == 400

    def test_zero_amounts_rejected(self, admin, ctx):
        r = admin.post(f"{API}/progress-payments/{ctx['hakedis_id']}/pay",
                       json={"date": TODAY, "nakit_amount": 0, "cek_amount": 0})
        assert r.status_code == 400

    def test_split_pay_creates_two_transactions_and_check(self, admin, ctx):
        half = round(ctx["net"] / 2, 2)
        r = admin.post(f"{API}/progress-payments/{ctx['hakedis_id']}/pay", json={
            "date": TODAY, "nakit_amount": half, "cek_amount": ctx["net"] - half,
            "check_due_date": IN_15, "check_bank": "Garanti", "check_no": f"TEST{uuid.uuid4().hex[:6]}",
        })
        assert r.status_code == 201, r.text
        data = r.json()
        assert len(data["created"]) == 2
        for tx in data["created"]:
            assert tx["status"] == "onay_bekliyor"
            assert tx["category"] == "Taşeron Hakediş Ödemesi"
            assert tx["progress_payment_id"] == ctx["hakedis_id"]
        # payments list reflects pending/remaining
        p = admin.get(f"{API}/progress-payments/{ctx['hakedis_id']}/payments").json()
        assert round(p["pending"], 2) == round(ctx["net"], 2)
        assert round(p["remaining"], 2) == round(ctx["net"], 2)
        # check (direction=verilen) was created
        checks = admin.get(f"{API}/checks?account_id={ctx['taseron_id']}").json()
        verilen = [c for c in checks if c["direction"] == "verilen"]
        assert len(verilen) >= 1
        ctx["tx_ids"] = [tx["id"] for tx in data["created"]]

    def test_approve_both_tx_sets_hakedis_odendi(self, admin, ctx):
        for tx_id in ctx["tx_ids"]:
            r = admin.post(f"{API}/transactions/{tx_id}/approve")
            assert r.status_code == 200, r.text
        h = admin.get(f"{API}/progress-payments/{ctx['hakedis_id']}").json()
        assert h["status"] == "odendi", f"expected odendi got {h['status']}"
        p = admin.get(f"{API}/progress-payments/{ctx['hakedis_id']}/payments").json()
        assert round(p["paid"], 2) == round(ctx["net"], 2)
        assert round(p["remaining"], 2) == 0.0

    def test_site_expense_not_doubled(self, admin, ctx):
        s = admin.get(f"{API}/sites/{ctx['site_id']}").json()
        sm = s["summary"]
        # subcontractor_expense should equal hakedis net (not doubled by paid txs)
        assert round(sm["subcontractor_expense"], 2) == round(ctx["net"], 2), sm


# ======================= 2. Reports export =======================
class TestReportsExport:
    TABS = ["kasa", "kar_zarar", "musteri_risk", "cek", "odeme", "tahsilat", "taseron", "para_akisi"]

    @pytest.mark.parametrize("tab", TABS)
    def test_export_xlsx(self, admin, tab):
        r = admin.get(f"{API}/reports/export", params={"tab": tab, "format": "xlsx"})
        assert r.status_code == 200, f"{tab}: {r.status_code} {r.text[:200]}"
        assert "spreadsheet" in r.headers.get("content-type", "")
        assert len(r.content) > 100

    @pytest.mark.parametrize("tab", TABS)
    def test_export_pdf(self, admin, tab):
        r = admin.get(f"{API}/reports/export", params={"tab": tab, "format": "pdf"})
        assert r.status_code == 200, f"{tab}: {r.status_code} {r.text[:200]}"
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content.startswith(b"%PDF")

    def test_invalid_tab(self, admin):
        r = admin.get(f"{API}/reports/export", params={"tab": "foobar", "format": "xlsx"})
        assert r.status_code == 400

    def test_export_with_filters(self, admin, ctx):
        r = admin.get(f"{API}/reports/export", params={
            "tab": "kasa", "format": "xlsx", "start": TODAY, "end": TODAY, "site_id": ctx["site_id"]})
        assert r.status_code == 200
        assert len(r.content) > 100


# ======================= 3. Alerts =======================
class TestAlerts:
    def test_setup_due_check_and_risky_musteri(self, admin):
        # Create a musteri with approved hakedis (no tahsilat) -> customer_risk 100%
        tag = uuid.uuid4().hex[:6]
        m = admin.post(f"{API}/accounts", json={"name": f"TEST_RiskMusteri_{tag}", "type": "musteri"}).json()
        s = admin.post(f"{API}/sites", json={"name": f"TEST_RiskSite_{tag}", "contract_amount": 500_000,
                                              "customer_id": m["id"], "status": "devam"}).json()
        h = admin.post(f"{API}/progress-payments", json={
            "site_id": s["id"], "account_id": m["id"], "type": "musteri", "date": TODAY,
            "items": [{"description": "Kaba", "unit": "m²", "quantity": 10, "unit_price": 1000}],
            "vat_rate": 20, "apply_overhead": True,
        }).json()
        admin.patch(f"{API}/progress-payments/{h['id']}/status", json={"status": "onaylandi"})

        # Create a check due in 2 days (alinan from the musteri)
        chk = admin.post(f"{API}/checks", json={
            "direction": "alinan", "account_id": m["id"], "amount": 1000,
            "due_date": IN_2, "bank": "Yapi Kredi", "check_no": f"T{uuid.uuid4().hex[:6]}",
        })
        assert chk.status_code in (200, 201), chk.text
        return m["id"]

    def test_daily_summary(self, admin):
        self.test_setup_due_check_and_risky_musteri(admin)
        r = admin.get(f"{API}/alerts/daily-summary")
        assert r.status_code == 200
        d = r.json()
        for k in ("due_items", "loss_risks", "customer_risks", "anomalies", "message", "alert_count", "twilio_configured", "manager_phone"):
            assert k in d, f"missing key: {k}"
        assert d["twilio_configured"] is False
        # due check in 2 days should appear
        assert any(i["type"] == "cek" and i["days_left"] <= 3 for i in d["due_items"]), d["due_items"][:3]
        # at least one customer_risk with ratio>33
        assert any(c["ratio"] > 33 for c in d["customer_risks"]), d["customer_risks"][:3]

    def test_cron_unauth(self):
        r = requests.post(f"{API}/cron/daily-reminders", timeout=15)
        assert r.status_code == 401

    def test_cron_wrong_secret(self):
        r = requests.post(f"{API}/cron/daily-reminders",
                          headers={"Authorization": "Bearer wrong"}, timeout=15)
        assert r.status_code == 401

    def test_cron_ok_and_duplicate(self):
        assert CRON_SECRET, "WEBHOOK_CRON_SECRET not loaded"
        run_id = f"test-{uuid.uuid4().hex[:10]}"
        h = {"Authorization": f"Bearer {CRON_SECRET}", "X-Webhook-Id": run_id}
        r1 = requests.post(f"{API}/cron/daily-reminders", headers=h, json={}, timeout=30)
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1.get("queued") is True
        # Wait for background task
        import time
        time.sleep(3)
        # Duplicate run_id -> {duplicate: true}
        r2 = requests.post(f"{API}/cron/daily-reminders", headers=h, json={}, timeout=30)
        assert r2.status_code == 200
        assert r2.json().get("duplicate") is True

    def test_history_has_twilio_yok(self, admin):
        import time
        time.sleep(1)
        r = admin.get(f"{API}/alerts/history")
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and rows
        statuses = {row.get("status") for row in rows}
        assert "twilio_yok" in statuses, statuses

    def test_send_without_twilio(self, admin):
        r = admin.post(f"{API}/alerts/send", json={})
        assert r.status_code == 400


# ======================= 4. Site photos =======================
PNG_BYTES = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
             b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?"
             b"\x00\x05\xfe\x02\xfe\xdc\xccY\xe7\x00\x00\x00\x00IEND\xaeB`\x82")


class TestSitePhotos:
    def test_full_photo_flow(self, admin, ctx):
        # Upload PNG
        up = requests.post(f"{API}/files/upload",
                           headers={"Authorization": admin.headers["Authorization"]},
                           files={"file": ("test.png", io.BytesIO(PNG_BYTES), "image/png")}, timeout=30)
        assert up.status_code in (200, 201), up.text
        file_id = up.json()["id"]

        # Add photo with progress 40
        r = admin.post(f"{API}/sites/{ctx['site_id']}/photos",
                       json={"file_id": file_id, "date": TODAY, "note": "Test foto", "progress_percent": 40})
        assert r.status_code == 201, r.text
        photo = r.json()
        assert photo["file_id"] == file_id

        # Site progress updated
        s = admin.get(f"{API}/sites/{ctx['site_id']}").json()
        assert s["progress_percent"] == 40

        # List
        lst = admin.get(f"{API}/sites/{ctx['site_id']}/photos").json()
        assert any(p["id"] == photo["id"] for p in lst)

        # Hakediş PDF still OK (photo page appended)
        pdf = admin.get(f"{API}/pdf/progress-payment/{ctx['hakedis_id']}")
        assert pdf.status_code == 200
        assert pdf.content.startswith(b"%PDF")

        # Delete
        d = admin.delete(f"{API}/sites/{ctx['site_id']}/photos/{photo['id']}")
        assert d.status_code == 200
        lst2 = admin.get(f"{API}/sites/{ctx['site_id']}/photos").json()
        assert not any(p["id"] == photo["id"] for p in lst2)


# ======================= 5. AI work-catalog =======================
class TestWorkCatalog:
    def test_catalog_19_items(self, admin):
        r = admin.get(f"{API}/ai/work-catalog")
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 19, f"expected 19 got {len(items)}"
        for it in items:
            assert "name" in it and "unit" in it
