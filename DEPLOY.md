# Publisering på GitHub Pages

Denne appen er statisk. Den trenger ingen installasjon, database eller lokaladmin.

## Alternativ A: Last opp via GitHub-nettsiden

1. Lag et nytt repository på GitHub, for eksempel `referansevokter`.
2. Last opp alle filene i denne mappen til roten av repoet:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `README.md`
   - `test-cases.md`
   - `.nojekyll`
3. Gå til **Settings → Pages**.
4. Under **Build and deployment**, velg:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
5. Trykk **Save**.
6. Etter litt får du en URL som ligner:
   `https://brukernavn.github.io/referansevokter/`

## Alternativ B: Bruk Git lokalt

```powershell
git init
git add .
git commit -m "Initial reference checker app"
git branch -M main
git remote add origin https://github.com/BRUKERNAVN/referansevokter.git
git push -u origin main
```

Slå deretter på GitHub Pages som beskrevet i alternativ A.

## Viktig

Appen gjør automatiske oppslag direkte fra nettleseren mot åpne API-er som Crossref, OpenAlex, Semantic Scholar og DataCite. Hvis et universitetsnettverk blokkerer disse, kan enkelte kilder feile. Det betyr ikke at referansen er ugyldig; appen viser slike feil under `Warnings` og `Sources checked`.
