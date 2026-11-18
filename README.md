# Zaino

App per organizzare zaino, compiti e studio. Tre volte al giorno un programma legge
compiti e verifiche dal Portale famiglie Mastercom e aggiorna l'app.

- `config.json` – orario, materie e materiale da portare (si può modificare qui su GitHub)
- `docs/` – l'app (pubblicata con GitHub Pages)
- `scraper/aggiorna.py` – il programma che legge Mastercom
- I dati di compiti e verifiche sono cifrati: per aprirli serve il codice dell'app.

Segreti necessari (Settings → Secrets and variables → Actions):
`MC_UTENTE`, `MC_PASSWORD`, `APP_CODICE`.
