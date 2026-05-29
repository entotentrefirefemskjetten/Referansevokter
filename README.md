# Referansevokter

En lokal prototype for å undersøke hvor godt akademiske referanser kan verifiseres i åpne registre.

Åpne `index.html` i en nettleser, eller publiser mappen med GitHub Pages. Lim inn en referanseliste og trykk **Sjekk referanser**. Appen søker automatisk i DOI/Crossref, OpenAlex, Semantic Scholar og DataCite og gir en forsiktig triage-vurdering.

Lovdata, Oria/BIBSYS og Google Scholar brukes som manuelle kontrollkilder via søkelenker. Appen scraper dem ikke. Oria-lenkene bruker den nye Primo VE-adressen (`bibsys-network.primo.exlibrisgroup.com`).

- **Verifisert**: DOI eller flere metadatafelt matcher godt.
- **Sannsynlig verifisert**: ingen perfekt DOI-match, men tittel/år/forfatter ligner sterkt.
- **Delvis treff**: noe matcher, men ikke nok til trygg verifisering.
- **Metadata-avvik**: DOI eller sterkt treff peker mot et annet verk.
- **Ikke funnet i sjekkede kilder**: ikke verifisert i registrene som ble brukt.
- **Må gjennomgås manuelt**: kilden er trolig bok, kapittel, rapport, nettside eller vanskelig å parse.
- **Sjekk feilet**: teknisk feil hindret alle kildesøk.

Dette er ikke en endelig fasit. Manglende treff betyr ikke at referansen er ugyldig; det betyr bare at appen ikke kunne verifisere den i kildene som faktisk ble sjekket.

Se `DEPLOY.md` for GitHub Pages-oppsett.
