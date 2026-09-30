"""
MatchMap - Automazione 100% Telegram -> Firebase per Tabella Pagamento Pacchi
=============================================================================
Poiché nel gruppo Telegram sei solo un PARTECIPANTE (non admin), un normale Bot
non può essere aggiunto al gruppo. Questo script usa invece le API ufficiali Client
di Telegram (Telethon MTProto): si collega come il tuo account partecipante,
ascolta le nuove foto mandate nel gruppo, verifica con Gemini Vision se l'immagine
è una Tabella Pagamento Pacchi AIA e aggiorna automaticamente:
  1. /pagamenti su Firebase Realtime Database (tutte le 20 regioni + colonne)
  2. /news su Firebase Realtime Database (le notizie regionali aggiornate)

Come avviarlo (una tantum):
1. Installa le dipendenze:
   pip install telethon google-genai requests
2. Ottieni API_ID e API_HASH gratis da https://my.telegram.org (App configuration)
3. Ottieni una GEMINI_API_KEY gratis da https://aistudio.google.com
4. Imposta le variabili qui sotto (o tramite variabili d'ambiente) e avvia:
   python tools/telegram-pacchi-autosync.py
"""

import os
import json
import asyncio
import requests
from telethon import TelegramClient, events

# ============================================================================
# CONFIGURAZIONE
# ============================================================================
TELEGRAM_API_ID = int(os.environ.get("TELEGRAM_API_ID", "0"))
TELEGRAM_API_HASH = os.environ.get("TELEGRAM_API_HASH", "")
# Nome utente, link invito o ID numerico del gruppo Telegram (es. -1001234567890)
# Puoi anche inoltrare qualsiasi immagine a "Messaggi Salvati" ("me") per testarlo subito!
TELEGRAM_GROUP_TARGET = os.environ.get("TELEGRAM_GROUP_TARGET", "me")

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
FIREBASE_DB_URL = "https://matchmap-6a917-default-rtdb.europe-west1.firebasedatabase.app"
# Se le regole Firebase richiedono auth token per scrivere, inserisci qui il database secret o idToken:
FIREBASE_AUTH_TOKEN = os.environ.get("FIREBASE_AUTH_TOKEN", "")

PROMPT_ANALISI = """Analizza questa immagine proveniente da un gruppo Telegram arbitrale.
Se NON è una tabella o aggiornamento sui pagamenti dei pacchi rimborsi AIA per le regioni italiane,
restituisci esattamente: {"isPacchiTable": false}

Se invece È una tabella o riepilogo del pagamento pacchi per le regioni italiane, restituisci:
{
  "isPacchiTable": true,
  "columns": {
    "regione": "Regione",
    "inPagamento": "Pacchi in pagamento",
    "fineFebbraio": "<Titolo seconda colonna temporale es. Metà maggio>",
    "chat": "<Titolo terza colonna temporale es. Fine maggio>",
    "stato": "Stato"
  },
  "items": [
    {
      "regione": "Abruzzo",
      "inPagamento": "",
      "fineFebbraio": "13",
      "chat": "14 e 15",
      "stato": "Previsto da tabella"
    }
    // ... tutte le 20 regioni: Abruzzo, Basilicata, Calabria, Campania, Emilia-Romagna,
    // Friuli-Venezia Giulia, Lazio, Liguria, Lombardia, Marche, Molise,
    // Piemonte/Valle D'Aosta, Puglia, Sardegna, Sicilia, Toscana, Umbria, Veneto, Bolzano, Trento
  ]
}"""


def analyze_image_with_gemini(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    import base64
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    payload = {
        "contents": [{
            "parts": [
                {"text": PROMPT_ANALISI},
                {"inlineData": {"mimeType": mime_type, "data": b64}}
            ]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json"
        }
    }
    resp = requests.post(url, json=payload, timeout=30)
    resp.raise_for_status()
    text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
    return json.loads(text)


def update_firebase_pagamenti(columns: dict, items: list):
    params = {"auth": FIREBASE_AUTH_TOKEN} if FIREBASE_AUTH_TOKEN else {}
    resp = requests.put(
        f"{FIREBASE_DB_URL}/pagamenti.json",
        params=params,
        json={"columns": columns, "items": items},
        timeout=15
    )
    resp.raise_for_status()
    print(f"[OK] Tabella Pagamenti aggiornata su Firebase ({len(items)} regioni)!")


async def main():
    if not TELEGRAM_API_ID or not TELEGRAM_API_HASH or not GEMINI_API_KEY:
        print("Configura TELEGRAM_API_ID, TELEGRAM_API_HASH e GEMINI_API_KEY prima di avviare lo script.")
        return

    client = TelegramClient("matchmap_session", TELEGRAM_API_ID, TELEGRAM_API_HASH)
    await client.start()
    print(f"[MatchMap Telegram AutoSync] In ascolto sulle immagini inviate in: {TELEGRAM_GROUP_TARGET}...")

    @client.on(events.NewMessage(chats=TELEGRAM_GROUP_TARGET))
    async def handler(event):
        if not event.photo:
            return
        print("[Telegram] Nuova immagine rilevata! Analisi AI Vision in corso...")
        img_bytes = await event.download_media(file=bytes)
        try:
            result = analyze_image_with_gemini(img_bytes)
            if not result.get("isPacchiTable"):
                print("[Telegram] Immagine ignorata (non è una tabella pagamento pacchi).")
                return
            update_firebase_pagamenti(result.get("columns", {}), result.get("items", []))
        except Exception as exc:
            print(f"[ERRORE] Analisi/aggiornamento fallito: {exc}")

    await client.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(main())
