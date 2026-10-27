# Image integration testing rules (saved from integration playbook)

- Always use base64-encoded images (JPEG/PNG/WEBP only) for tests.
- Never upload blank/solid-color images; images must have real visual features (text, edges).
- Re-detect MIME after any conversion; animated images → first frame only; resize oversized images.
- Endpoint under test: POST /api/receipt/parse (multipart `file`) → JSON {amount, date, payer, payee, bank, description, kasa_hint, confidence, warnings}.
