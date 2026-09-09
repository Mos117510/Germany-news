# Deutschland-Update — finale Cloudflare-Version

Mobile-first Web-App für ein tägliches Deutschland-Newsbriefing. Sie speichert **ein Update pro Tag dauerhaft in Cloudflare D1**, aktualisiert dieses beim erneuten Refresh und markiert neu hinzugekommene Meldungen mit `NEW`.

## Quellenregeln
- tagesschau.de
- zdfheute.de / zdf.de
- Keine Ersatzquellen.
- Die KI bekommt nur Inhalte, die aus diesen Quellen geladen wurden, und wird angewiesen, Unsicherheiten und widersprüchliche Details wegzulassen.

## Kostenlos
Cloudflare Workers, D1 und Workers AI haben kostenlose Kontingente. Aktuell nennt Cloudflare für Workers Free 100.000 Requests/Tag, D1 5 Mio. gelesene und 100.000 geschriebene Zeilen/Tag sowie 5 GB Speicher. Workers AI enthält 10.000 Neurons/Tag kostenlos. Die Limits können bei sehr hoher Nutzung erreicht werden.

## Einrichtung (auch ohne PC möglich)
1. Cloudflare-Konto erstellen.
2. In **Workers & Pages** einen neuen Worker anlegen.
3. Dieses Projekt als Worker-Projekt deployen (am einfachsten mit Wrangler auf einem PC; alternativ den Code über Cloudflare Dashboard anpassen).
4. Eine D1-Datenbank namens `deutschland-news` erstellen.
5. `schema.sql` in D1 ausführen.
6. In `wrangler.jsonc` die erzeugte `database_id` eintragen.
7. Worker deployen.
8. Du bekommst eine kostenlose `*.workers.dev`-Adresse.

### CLI
```bash
npm install -g wrangler
wrangler login
wrangler d1 create deutschland-news
# database_id aus der Ausgabe in wrangler.jsonc eintragen
wrangler d1 execute deutschland-news --remote --file=./schema.sql
wrangler deploy
```

### Wichtig
Die App braucht kein OpenAI-Abo. Für die automatische Zusammenfassung nutzt sie Cloudflare Workers AI mit einem auf dem Free-Plan verfügbaren Modell. Das kostenlose AI-Kontingent ist begrenzt; wenn es ausgeschöpft ist, funktioniert der nächste AI-Lauf erst nach dem täglichen Reset.

## Sicherheitsmaßnahmen
Die App ist so gebaut, dass sie keine fremden Dateien aus Nachrichtenartikeln ausführt oder herunterlädt.
- Es werden ausschließlich HTTPS-URLs von `tagesschau.de`, `zdfheute.de` und den ausdrücklich erlaubten `zdf.de`-Zielen akzeptiert. Benutzername/Passwort in URLs werden blockiert.
- Redirects zu fremden Domains werden blockiert.
- Geladene Quellen haben Größenlimits, um übergroße Antworten abzuweisen.
- Artikel-HTML wird nur als Text verarbeitet; es wird nicht als HTML in die App übernommen.
- Die KI-Ausgabe wird nachträglich validiert: gespeicherte Quellen-Links müssen exakt aus den geladenen Artikeln stammen.
- Die Oberfläche escaped Inhalte vor dem Einsetzen in HTML und nutzt Sicherheits-Header wie CSP, `X-Content-Type-Options: nosniff` und `X-Frame-Options: DENY`.
- Der Refresh-Endpunkt besitzt zusätzlich eine kurze Rate-Limit-Sperre, damit das kostenlose KI-Kontingent nicht durch sehr schnelles mehrfaches Auslösen unnötig verbraucht wird.
- Es gibt keine Datei-Uploads, keine Shell-Kommandos und keine Ausführung von Code aus Nachrichteninhalten.

**Wichtig:** Keine Web-App kann seriös eine absolute „100 % virus-/trojanerfrei“-Garantie geben. Diese Version minimiert die typischen Angriffswege und führt insbesondere keine heruntergeladenen Nachrichteninhalte aus.

## Datenschutz
Es gibt keine Benutzerkonten und keine persönlichen Profildaten. Gespeichert werden nur Tagesdatum, generiertes Update, Artikel-URLs/Metadaten und Aktualisierungszeit.

## Wochen- und Monatsrückblicke

Die Oberfläche enthält jetzt **Heute**, **Woche** und **Monat**. Wochen- und Monatsrückblicke werden aus den bereits gespeicherten Tagesupdates erstellt und in D1 persistent gespeichert.

- Woche: deutlich ausführlicher (ca. 1.200–2.200 Wörter als Zielbereich).
- Monat: sehr ausführlich (ca. 4.500–8.000 Wörter als Zielbereich), aber bewusst zusammengefasst.
- Wiederkehrende Meldungen werden zu einem Thema zusammengeführt.
- Bei länger laufenden Parlaments- oder anderen politischen Vorgängen wird der **neueste relevante Stand** verwendet; der tägliche Ablauf wird nicht wiederholt.
- Dasselbe gilt für fortlaufende internationale und wirtschaftliche Ereignisse.
- Ein erneutes Aktualisieren ersetzt den gespeicherten Rückblick desselben Zeitraums, statt einen Duplikat-Eintrag zu erzeugen.
- Die Tagesupdates bleiben unverändert im Archiv und bilden die Grundlage für spätere Rückblicke.


## Languages
The interface and saved summaries support German (default), English, and Arabic. The German summary remains the canonical saved version. When another language is selected, the app asks Workers AI to translate the already-generated German summary and stores that translation in D1, so switching back does not replace the German source.

If you already created the D1 tables with an older version that does not contain `translations_json`, run `migration-language.sql` once in the D1 SQL console. For a brand-new database, `schema.sql` already includes the required columns.
