# Flugbuch (PWA)

Persönliches Flugtagebuch: Liste, Detailansicht, Globus/Weltkarte mit allen Strecken, Statistiken.
Statische Web-App (HTML/CSS/JS-Module, kein Build), gehostet über GitHub Pages, auf dem iPhone als
Home-Bildschirm-App genutzt (Safari → Teilen → „Zum Home-Bildschirm“). Kein Live-Tracking.

## Daten

- `data/flights.json` – **die Flüge** (Quelle der Wahrheit, wird von Claude gepflegt). Die App lädt sie bei
  jedem Öffnen/Zurückkehren neu.
- Im Browser angelegte/importierte/geänderte Flüge liegen nur in `localStorage` (`flugbuch.lokal.v1`:
  `added`, `overrides` nach id, `deleted` ids). Über Mehr → „Für Claude kopieren“ bekommt der Nutzer einen
  JSON-Block (`neu`, `geaendert`, `geloescht`), den er hier einfügt.
- `data/airports.json` (`IATA → [Name, Stadt, ISO-Land, lat, lon, Zeitzone, ICAO, Rang]`), `data/airlines.json`
  (`IATA → [Name, ICAO, Land]`), `data/countries.json` (`ISO → world-atlas-id`), `data/regions.json` (`ISO → Region` für die Kontinent-Kacheln) werden von
  `tools/build_data.cjs` aus OurAirports/OpenFlights erzeugt – nicht von Hand ändern.

### Flug-Format (`data/flights.json`)

```json
{"id":"2025-03-14-lh400","date":"2025-03-14","flightNo":"LH400","airline":"LH","from":"FRA","to":"JFK",
 "dep":"10:05","arr":"12:50","aircraft":"Airbus A340-300","reg":"D-AIGX","seat":"34A","seatType":"Fenster",
 "cabin":"Economy","reason":"Urlaub","note":"…"}
```

- Pflicht: `date` (JJJJ-MM-TT, **lokales Abflugdatum**), `from`, `to` (IATA, müssen in `airports.json` stehen).
- Zeiten `dep`/`arr` = planmäßige **Ortszeit** am jeweiligen Flughafen (HH:MM). Die Dauer rechnet die App
  über die Zeitzonen aus; Ankunft am Folgetag wird automatisch erkannt. Nur bei Ankunft ≥ 2 Tage später
  oder Datumsgrenze in Gegenrichtung `arrDate` setzen. Optional `depActual`/`arrActual`.
- Ohne Zeiten: `durationMin` angeben, sonst schätzt die App aus der Distanz. Wenn nur die Blockzeit sicher ist
  (Flugplan schwankt), lieber `durationMin` statt geratener Uhrzeiten.
- `seatType`: Fenster | Mitte | Gang. `cabin`: Economy | Premium Economy | Business | First.
  `reason`: Urlaub | Geschäftlich | Privat | Sonstiges.
- `via`: optionale Wegpunkte `[[lon, lat], …]` in Flugrichtung, damit die Karte die echte Routenführung statt
  des Großkreises zeigt (z. B. MUC–HND südlich um Russland herum). Nur setzen, wenn der Großkreis klar falsch ist.
- `id` nicht ändern (lokale Änderungen auf Geräten hängen daran). Neue Flüge ohne id eintragen –
  `tools/pruefen.cjs` vergibt sie.

## Workflow: Flüge hinzufügen

Der Nutzer nennt Flüge im Chat (z. B. „LH400 am 14.3.2025, Sitz 34A“), schickt Fotos von Bordkarten/
Buchungsbestätigungen, eine CSV oder den JSON-Block aus „Für Claude kopieren“.

1. Fehlende Angaben (Strecke, planmäßige Zeiten, Flugzeugtyp) per Websuche zur Flugnummer ergänzen
   (Flugplan-Seiten wie flightera, flightaware, flightradar24). Unsicheres beim Nutzer nachfragen bzw. in der
   Zusammenfassung markieren; lieber `dep`/`arr` weglassen als raten.
2. In `data/flights.json` eintragen; bei JSON-Block aus der App: `neu` anhängen, `geaendert` per id ersetzen,
   `geloescht` entfernen.
3. `version` in `data/flights.json` um 1 erhöhen.
4. `node tools/pruefen.cjs` – muss ohne FEHLER durchlaufen (formatiert und sortiert die Datei).
5. Commit (`Flüge: +3 (Mallorca Juli 2025)`) und `git push`. GitHub Pages ist nach ca. 1 Minute aktuell.
6. Dem Nutzer eine kurze Tabelle der eingetragenen Flüge zeigen. Wenn sie aus „Für Claude kopieren“
   stammen: daran erinnern, in der App „Lokale Änderungen verwerfen“ zu tippen (sonst doppelt).

Für große CSV-Mengen kann der Nutzer auch direkt in der App importieren (Mehr → Import; erkennt eigenes
Format, deutsche Spaltennamen, Flighty- und myFlightradar24-Exporte).

## Code

- `js/data.js` Laden/Mischen (Repo + lokal), Zeitzonen-Rechnung, Distanz. `js/csv.js` Import/Export.
  `js/map.js` Canvas-Karte (d3-geo, Globus/flach). `js/stats.js` Kennzahlen + Erfolge. `js/pass.js` Pass-Seite
  (Reisepass-Karte, Diagramme, Ranglisten, Teilen als PNG). `js/util.js` Formatierung, deutsche Städtenamen, Airline-Kreise. `js/api.js` optionale
  AeroDataBox-Abfrage (RapidAPI-Key nur im localStorage des Geräts). `js/app.js` Oberfläche.
- Bibliotheken liegen in `vendor/` (d3-geo, d3-array, topojson-client, world-atlas 110m) – kein CDN.
- Nach Änderungen an App-Dateien `CACHE` in `sw.js` hochzählen.
- Lokal testen: `python -m http.server 8766` im Ordner `flugbuch`.
- Referenzdaten neu bauen: Rohdaten (OurAirports `airports.csv`, `countries.csv`; OpenFlights
  `airports.dat`→`of_airports.dat`, `airlines.dat`) und world-atlas `countries-50m.json` in einen Ordner laden,
  dann `node tools/build_data.cjs <ordner> <countries-50m.json>`.
- App-Icon: `python tools/icon.py`.
