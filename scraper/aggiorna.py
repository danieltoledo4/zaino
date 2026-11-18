"""Scarica compiti e verifiche dal Portale famiglie Mastercom e prepara i dati
cifrati per l'app "Zaino". Gira su GitHub Actions.

Variabili d'ambiente (segreti del repository):
  MC_UTENTE    codice utente Mastercom
  MC_PASSWORD  password Mastercom
  APP_CODICE   codice segreto per aprire l'app sui telefoni

Non stampa mai dati personali nei log (il repository è pubblico).
"""
import base64
import datetime as dt
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
PORTALE = os.environ.get("MC_PORTALE", "https://ictrento6-tn-sito.registroelettronico.com")
ROMA = ZoneInfo("Europe/Rome")
ITER = 310_000

MESI = {"gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6, "luglio": 7,
        "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12}

# parola chiave -> materia dell'app (l'ordine conta: le più specifiche prima)
CHIAVI_MATERIE = [
    ("SCIENZE MOTORIE", "Motoria"), ("MOTORI", "Motoria"), ("EDUCAZIONE FISICA", "Motoria"),
    ("ITALIAN", "Italiano"), ("FAVOLE", "Italiano"), ("BOOK", "Italiano"),
    ("STORIA", "Storia"), ("GEOGRAF", "Geografia"),
    ("MATEMAT", "Matematica"), ("GEOMETR", "Matematica"), ("ARITMET", "Matematica"),
    ("ESPRESSION", "Matematica"),
    ("SCIENZ", "Scienze"), ("INGLES", "Inglese"), ("ENGLISH", "Inglese"), ("VOCABULARY", "Inglese"),
    ("TEDESC", "Tedesco"), ("DEUTSCH", "Tedesco"), ("TECNOLOG", "Tecnologia"), ("INFORMATIC", "Tecnologia"),
    ("ARTE", "Arte e immagine"), ("MUSIC", "Musica"), ("FLAUTO", "Musica"),
    ("RELIGION", "Religione"), ("CIVICA", "Ed. civica"),
]

JS_GROUPS = r"""
(kind) => {
  const deepAll = (root) => { let res = []; const visit = (n) => {
      const all = n.querySelectorAll ? Array.from(n.querySelectorAll('*')) : [];
      res = res.concat(all); all.forEach(e => { if (e.shadowRoot) visit(e.shadowRoot); }); };
    visit(root); return res; };
  const txt = (el) => el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  const cards = deepAll(document).filter(e => e.matches && e.matches('mc-content-card.' + kind + '-card'));
  return cards.map(c => {
    const g = c.closest('.' + kind + '-list-group') || c.closest('.' + kind + '-content-panel');
    const badge = g ? g.querySelector('mc-event-date-badge[date]') : null;
    const metas = Array.from(c.querySelectorAll('.' + kind + '-card-meta')).map(m => ({
      label: txt(m.querySelector('.' + kind + '-card-meta-label')),
      value: txt(m.querySelector('.' + kind + '-card-meta-value'))}));
    return {
      titolo: txt(c.querySelector('.' + kind + '-card-title')),
      testo: txt(c.querySelector('.' + kind + '-card-assignments')),
      sotto: txt(c.querySelector('.' + kind + '-card-subtitle')),
      metas: metas,
      data: badge ? badge.getAttribute('date') : null,
      titoloGiorno: g ? txt(g.querySelector('.' + kind + '-day-title')) : ''
    };
  });
}
"""


def data_it(s):
    m = re.search(r"(\d{1,2})\s+([a-zà]+)\s+(\d{4})", (s or "").lower())
    if m and m.group(2) in MESI:
        return dt.date(int(m.group(3)), MESI[m.group(2)], int(m.group(1))).isoformat()
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", s or "")
    if m:
        return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1))).isoformat()
    return None


def materia_da(testo, docente, docenti):
    t = (testo or "").upper()
    for chiave, nome in CHIAVI_MATERIE:
        if chiave in t:
            return nome
    if docente:
        cognome = docente.split()[0].upper()
        if cognome in docenti:
            return docenti[cognome]
    return "Altro"


def tipo_da(testo, default):
    t = (testo or "").lower()
    if "interrog" in t:
        return "interrogazione"
    if re.search(r"\bverific|\btest\b|\bprova\b|compito in classe", t):
        return "verifica"
    return default


def pulisci(testo, tipo):
    t = re.sub(r"\s+", " ", testo or "").strip()
    if tipo in ("verifica", "interrogazione"):
        t = re.sub(r"^(verifica|test|prova|interrogazione)(\s+(di|de|d')\s*[\w']+)?\s*[:\-–]?\s*", "", t, flags=re.I)
        if t.lower() in ("verifica", "test", "interrogazione", ""):
            t = ""
    letters = [c for c in t if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.8:
        t = t[:1].upper() + t[1:].lower()
    return t


def evid(e):
    base = "|".join([e["tipo"], e.get("materia", ""), e["data"], e.get("testo", "")])
    return "m" + hashlib.sha1(base.encode("utf8")).hexdigest()[:10]


def normalizza(agenda_raw, compiti_raw, cfg, oggi):
    docenti = {k.upper(): v for k, v in cfg.get("docenti", {}).items()}
    s_ver = cfg.get("sessioni_verifica", 3)
    s_int = cfg.get("sessioni_interrogazione", 2)
    da = (oggi - dt.timedelta(days=21)).isoformat()
    a = (oggi + dt.timedelta(days=75)).isoformat()
    eventi = []

    for r in agenda_raw:
        data = r.get("data") or data_it(r.get("titoloGiorno"))
        titolo = r.get("titolo") or ""
        if not data or not titolo:
            continue
        m = re.search(r"\bda\s+(.+)$", r.get("sotto") or "")
        docente = m.group(1).strip() if m else ""
        tipo = tipo_da(titolo, "attivita")
        testo = titolo if tipo == "attivita" else pulisci(titolo, tipo)
        e = {"tipo": tipo, "materia": materia_da(titolo, docente, docenti), "data": data, "testo": testo[:160]}
        if tipo == "verifica":
            e["sessioni"] = s_ver
        elif tipo == "interrogazione":
            e["sessioni"] = s_int
        eventi.append(e)

    ver_keys = {(e["materia"], e["data"]) for e in eventi if e["tipo"] in ("verifica", "interrogazione")}
    for r in compiti_raw:
        data = r.get("data")
        if not data:
            for mt in r.get("metas", []):
                if "riferimento" in mt.get("label", "").lower():
                    data = data_it(mt.get("value"))
        testo = r.get("testo") or ""
        if not data or not testo:
            continue
        materia = materia_da(r.get("titolo"), "", docenti)
        if materia == "Altro":
            materia = materia_da(testo, "", docenti)
        tipo = tipo_da(testo, "compito")
        if tipo != "compito" and (materia, data) in ver_keys:
            tipo = "compito"  # la verifica c'è già in agenda
        e = {"tipo": tipo, "materia": materia, "data": data, "testo": pulisci(testo, "compito")[:220]}
        if tipo == "verifica":
            e["sessioni"] = s_ver
        elif tipo == "interrogazione":
            e["sessioni"] = s_int
        eventi.append(e)

    visti, out = set(), []
    for e in eventi:
        if not (da <= e["data"] <= a):
            continue
        e["id"] = evid(e)
        if e["id"] in visti:
            continue
        visti.add(e["id"])
        out.append(e)
    out.sort(key=lambda e: (e["data"], e["tipo"], e["materia"]))
    return out


def cifra(payload: dict, codice: str) -> dict:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(codice.encode("utf8"))
    ct = AESGCM(key).encrypt(iv, json.dumps(payload, ensure_ascii=False).encode("utf8"), None)
    b64 = lambda b: base64.b64encode(b).decode()
    return {"v": 1, "iter": ITER, "salt": b64(salt), "iv": b64(iv), "data": b64(ct)}


def scarica(utente, password):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(locale="it-IT", timezone_id="Europe/Rome", viewport={"width": 1280, "height": 900})
        page.goto(PORTALE + "/", wait_until="networkidle", timeout=60000)
        try:
            page.get_by_text("Ho capito", exact=True).click(timeout=3000)
        except Exception:
            pass
        page.locator("input#utente").fill(utente)
        page.locator("input#password").fill(password)
        page.get_by_role("button", name=re.compile("accedi", re.I)).first.click()
        try:
            page.wait_for_url(re.compile(r"/home"), timeout=45000)
        except Exception:
            print("ERRORE: accesso a Mastercom non riuscito (controlla utente e password nei segreti).")
            sys.exit(2)

        # Agenda: vista elenco, mese corrente + successivo
        page.locator('a[href="/agenda"]').first.click()
        page.wait_for_selector("agenda-desktop-ref-component", timeout=30000)
        page.wait_for_timeout(2500)
        try:
            page.locator("agenda-desktop-ref-component").get_by_text("☰", exact=True).first.click(timeout=5000)
            page.wait_for_timeout(1500)
        except Exception:
            print("Avviso: vista elenco dell'agenda non trovata, uso la vista calendario.")
        agenda = page.evaluate(JS_GROUPS, "agenda")
        try:
            page.locator('button[aria-label="Mese successivo"]').first.click(timeout=5000)
            page.wait_for_timeout(2500)
            agenda += page.evaluate(JS_GROUPS, "agenda")
        except Exception:
            print("Avviso: mese successivo dell'agenda non letto.")

        # Compiti: elenco dell'anno
        page.locator('a[href="/compiti"]').first.click()
        try:
            page.wait_for_selector("mc-content-card.compiti-card", timeout=30000)
        except Exception:
            print("Avviso: nessun compito trovato nella pagina Compiti.")
        page.wait_for_timeout(1500)
        compiti = page.evaluate(JS_GROUPS, "compiti")
        browser.close()
        return agenda, compiti


def main():
    utente, password, codice = (os.environ.get(k, "") for k in ("MC_UTENTE", "MC_PASSWORD", "APP_CODICE"))
    if not (utente and password and codice):
        print("ERRORE: mancano i segreti MC_UTENTE, MC_PASSWORD o APP_CODICE.")
        sys.exit(2)
    cfg = json.loads((ROOT / "config.json").read_text(encoding="utf8"))
    agenda, compiti = scarica(utente, password)
    if not agenda and not compiti:
        print("ERRORE: nessun dato letto da Mastercom: non aggiorno l'app.")
        sys.exit(3)
    adesso = dt.datetime.now(ROMA)
    eventi = normalizza(agenda, compiti, cfg, adesso.date())
    payload = dict(cfg)
    payload.pop("docenti", None)
    payload.update({"aggiornato": adesso.isoformat(timespec="minutes"), "fonte": "Mastercom", "eventi": eventi})
    (ROOT / "docs" / "data.enc.json").write_text(json.dumps(cifra(payload, codice)), encoding="utf8")
    conta = {t: sum(1 for e in eventi if e["tipo"] == t) for t in ("compito", "verifica", "interrogazione", "attivita")}
    print("Aggiornato:", ", ".join(f"{k} {v}" for k, v in conta.items()))


if __name__ == "__main__":
    main()
