# Iteration 9: Receipt OCR (/api/receipt/parse) + advance reminders in /api/alerts/daily-summary + regressions
import os
from datetime import date, timedelta
from io import BytesIO
import pytest
import requests
from PIL import Image, ImageDraw, ImageFont

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
FONT = "/app/backend/fonts/DejaVuSans.ttf"
FONTB = "/app/backend/fonts/DejaVuSans-Bold.ttf"
CREATED = {"tx": [], "acc": []}
S = {}
TAS_NAME = "TEST_Hamza Yıldırımoğlu"
MUS_NAME = "TEST_Kemal Özdemiroğlu"


def make_receipt(payer, payee, path=None):
    img = Image.new("RGB", (900, 1100), "white")
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, 30); fb = ImageFont.truetype(FONTB, 40)
    d.rectangle([20, 20, 880, 1080], outline="black", width=3)
    d.text((60, 50), "ZİRAAT BANKASI", font=fb, fill="navy")
    d.text((60, 110), "EFT / HAVALE DEKONTU", font=fb, fill="black")
    d.line([60, 180, 840, 180], fill="black", width=2)
    lines = [f"Gönderen: {payer}", "Gönderen IBAN: TR12 0001 0000 1111 2222 3333 44",
             f"Alıcı: {payee}", "Alıcı IBAN: TR55 0006 2000 9999 8888 7777 66",
             "Tutar: 50.000,00 TL", "İşlem Tarihi: 26.10.2026", "Açıklama: Ekim avansı",
             "Dekont No: 2026102612345"]
    y = 220
    for ln in lines:
        d.text((60, y), ln, font=f, fill="black"); y += 80
    buf = BytesIO(); img.save(buf, format="JPEG", quality=90)
    if path:
        with open(path, "wb") as fh: fh.write(buf.getvalue())
    return buf.getvalue()


@pytest.fixture(scope="module")
def c():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@devrantas.com", "password": "Devrantas2026!"})
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    yield s
    for tid in CREATED["tx"]:
        s.delete(f"{API}/transactions/{tid}")
    for a in CREATED["acc"]:
        s.delete(f"{API}/accounts/{a}")


def tx(c, **kw):
    body = {"type": "gider", "category": "Taşeron Avansı", "amount": 100, "date": date.today().isoformat(), "kasa": "nakit", "description": "TEST_tx"}
    body.update(kw)
    r = c.post(f"{API}/transactions", json=body)
    assert r.status_code == 201, r.text
    CREATED["tx"].append(r.json()["id"])
    j = r.json()
    if j.get("status") != "onaylandi":
        ra = c.post(f"{API}/transactions/{j['id']}/approve")
        assert ra.status_code == 200, ra.text
    return j


def test_setup(c):
    for key, name, typ in (("tas", TAS_NAME, "taseron"), ("mus", MUS_NAME, "musteri"),
                           ("tas_old", "TEST_Taseron Eski Avans", "taseron"), ("tas_new", "TEST_Taseron Yeni Avans", "taseron")):
        r = c.post(f"{API}/accounts", json={"name": name, "type": typ}); assert r.status_code == 201, r.text
        S[key] = r.json()["id"]; CREATED["acc"].append(S[key])


# Receipt OCR
def test_receipt_taseron(c):
    raw = make_receipt("Devrantaş Yapı", TAS_NAME, "/tmp/dekont_tas.jpg")
    r = c.post(f"{API}/receipt/parse", files={"file": ("dekont.jpg", raw, "image/jpeg")}, timeout=90)
    assert r.status_code == 200, r.text
    d = r.json(); print(d)
    assert d["amount"] == 50000
    assert d["date"] == "2026-10-26"
    assert d["account_id"] == S["tas"], d
    assert d["type"] == "gider" and d["category"] == "Taşeron Avansı"


def test_receipt_musteri(c):
    raw = make_receipt(MUS_NAME, "Devrantaş Yapı")
    r = c.post(f"{API}/receipt/parse", files={"file": ("dekont.png", raw, "image/jpeg")}, timeout=90)
    assert r.status_code == 200, r.text
    d = r.json(); print(d)
    assert d["account_id"] == S["mus"], d
    assert d["type"] == "gelir" and d["account_type"] == "musteri"


def test_receipt_non_image(c):
    r = c.post(f"{API}/receipt/parse", files={"file": ("a.txt", b"hello world", "text/plain")}, timeout=30)
    assert r.status_code == 400, r.text


def test_receipt_no_auth():
    r = requests.post(f"{API}/receipt/parse", files={"file": ("a.jpg", make_receipt("a", "b"), "image/jpeg")}, timeout=30)
    assert r.status_code == 401, r.text


# Advances
def test_advances(c):
    tx(c, type="gelir", category="Avans", amount=100000, account_id=S["mus"])
    tx(c, type="gider", amount=20000, account_id=S["tas_old"], date=(date.today() - timedelta(days=40)).isoformat())
    tx(c, type="gider", amount=15000, account_id=S["tas_new"])
    r = c.get(f"{API}/alerts/daily-summary"); assert r.status_code == 200, r.text
    d = r.json()
    assert isinstance(d["advances"], list)
    by = {a["account_id"]: a for a in d["advances"]}
    assert S["mus"] in by and by[S["mus"]]["type"] == "musteri" and by[S["mus"]]["amount"] == 100000, by.get(S["mus"])
    assert S["tas_old"] in by and by[S["tas_old"]]["days"] >= 40, by.get(S["tas_old"])
    assert S["tas_new"] not in by
    assert "💰 Açık avanslar" in d["message"]


# Regression
def test_whatsapp_parse(c):
    r = c.post(f"{API}/whatsapp/parse", json={"text": "Kasa : Devrantaş Nakit\nÖdeme : Avans\nTarih : 26.10.2026\nTutar : 50.000 TL\nTaşeron : " + TAS_NAME})
    assert r.status_code == 200, r.text
    d = r.json(); print(d)
    assert d.get("amount") == 50000


def test_dashboard(c):
    r = c.get(f"{API}/dashboard"); assert r.status_code == 200, r.text
    assert "summary" in r.json() or r.json()
