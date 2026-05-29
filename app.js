const refsInput = document.querySelector("#references");
const checkButton = document.querySelector("#checkReferences");
const clearButton = document.querySelector("#clearAll");
const sampleButton = document.querySelector("#loadSample");
const resultList = document.querySelector("#resultList");
const statusLine = document.querySelector("#status");
const referenceCount = document.querySelector("#referenceCount");
const tabs = [...document.querySelectorAll(".tab")];

const counters = {
  total: document.querySelector("#totalCount"),
  found: document.querySelector("#foundCount"),
  uncertain: document.querySelector("#uncertainCount"),
  suspicious: document.querySelector("#suspiciousCount"),
};

const statusLabels = {
  verified: "Verifisert",
  likely_verified: "Sannsynlig verifisert",
  partial_match: "Delvis treff",
  metadata_mismatch: "Metadata-avvik",
  not_found_in_checked_sources: "Ikke funnet i sjekkede kilder",
  needs_manual_review: "Må gjennomgås manuelt",
  check_failed: "Sjekk feilet",
};

const manualReviewKinds = new Set(["book", "chapter", "legal", "report", "thesis", "guideline", "web"]);

const sourceLabels = {
  doi: "DOI",
  crossref: "Crossref",
  openalex: "OpenAlex",
  semantic_scholar: "Semantic Scholar",
  datacite: "DataCite",
  lovdata: "Lovdata",
  oria: "Oria/BIBSYS",
  google_scholar: "Google Scholar",
};

const sampleReferences = [
  "Knuth, D. E. (1984). Literate Programming. The Computer Journal, 27(2), 97-111. https://doi.org/10.1093/comjnl/27.2.97",
  "Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, L., & Polosukhin, I. (2017). Attention Is All You Need. Advances in Neural Information Processing Systems, 30.",
  "Hansen, L. M., & Fjeld, K. (2023). Quantum Footnotes in Medieval Botany. Nordic Journal of Synthetic Historiography, 18(4), 201-219.",
];

let allResults = [];
let currentFilter = "all";

const checkIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m9 11 3 3L22 4"></path>
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
  </svg>
`;

sampleButton.addEventListener("click", () => {
  refsInput.value = sampleReferences.join("\n\n");
  updateReferenceCount();
  refsInput.focus();
});

clearButton.addEventListener("click", () => {
  refsInput.value = "";
  allResults = [];
  updateReferenceCount();
  render();
  updateStatus("Klar til å sjekke.");
});

refsInput.addEventListener("input", updateReferenceCount);

checkButton.addEventListener("click", async () => {
  const references = parseReferences(refsInput.value);
  if (!references.length) {
    updateStatus("Lim inn minst en referanse først.");
    return;
  }

  setBusy(true);
  allResults = references.map((reference, index) => ({
    id: index,
    reference,
    state: "checking",
  }));
  render();

  try {
    for (let index = 0; index < references.length; index += 1) {
      updateStatus(`Sjekker ${index + 1} av ${references.length}...`);
      allResults[index] = await checkReference(references[index], index);
      render();
    }
    updateStatus("Ferdig. Bruk funnene som triage, ikke som endelig dom.");
  } catch (error) {
    updateStatus("Noe stoppet under sjekken. Prøv igjen, eller test færre referanser om gangen.");
    console.error(error);
  } finally {
    setBusy(false);
  }
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    currentFilter = tab.dataset.filter;
    render();
  });
});

function parseReferences(text) {
  const cleaned = text
    .replace(/\r/g, "")
    .replace(/&(?:#39|apos);/g, "'")
    .replace(/\bhttps?:\/\/\s+/gi, "https://");

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim().replace(/^\d{1,3}\s+(\d{1,3}[.)]\s+)/, "$1"))
    .filter(Boolean)
    .filter((line) => !/^referanser?:?$/i.test(line))
    .filter((line) => !/^\d{1,3}$/.test(line));

  const startsNumberedReference = (line) => /^(\[\d+\]|\d{1,3}[.)])\s+/.test(line);
  if (lines.some(startsNumberedReference)) {
    const references = [];
    let current = [];

    lines.forEach((line) => {
      if (startsNumberedReference(line) && current.length) {
        references.push(joinReferenceLines(current));
        current = [line];
      } else {
        current.push(line);
      }
    });

    if (current.length) references.push(joinReferenceLines(current));
    return references.filter((item) => item.length > 20);
  }

  const blocks = cleaned
    .split(/\n\s*\n/g)
    .map((item) => joinReferenceLines(item.split("\n")))
    .filter((item) => item.length > 20);

  if (blocks.length > 1) return blocks;

  return lines
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 20);
}

function joinReferenceLines(lines) {
  return lines
    .join(" ")
    .replace(/(10\.\d{4,9}\/\S*?)\s*-\s+(\S+)/gi, "$1-$2")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

async function checkReference(reference, id) {
  const parsed = parseMetadata(reference);
  const sourceChecks = await Promise.all([
    checkDoi(reference, parsed),
    searchCrossref(reference, parsed),
    searchOpenAlex(reference, parsed),
    searchSemanticScholar(reference, parsed),
    searchDataCite(reference, parsed),
  ]);
  sourceChecks.push(...getManualSourceChecks(reference, parsed));

  const candidates = sourceChecks
    .flatMap((sourceCheck) => sourceCheck.matches || [])
    .map((candidate) => scoreCandidate(candidate, parsed, reference, sourceChecks));

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] || null;
  const verdict = getVerdict(best, parsed, candidates, sourceChecks);

  return {
    id,
    reference,
    originalReference: reference,
    parsed,
    best,
    bestMatch: best,
    candidates,
    sourcesChecked: sourceChecks,
    ...verdict,
  };
}

function parseMetadata(reference) {
  const doi = normalizeDoi(reference.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0] || "");
  const year = Number(reference.match(/\((19|20)\d{2}\)|\b(19|20)\d{2}\b/)?.[0].replace(/[()]/g, "")) || null;
  const quotedTitle = reference.match(/[“"]([^”"]{8,180})[”"]/);
  const afterYear = reference.match(/\)\.?\s*([^.]*(?:\.[^A-ZÆØÅ]?)?)/);
  const title = cleanTitle((quotedTitle?.[1] || afterYear?.[1] || parseVancouverTitle(reference) || reference).slice(0, 220));
  const hasUrl = /https?:\/\/\S+/i.test(reference);
  const kind = inferReferenceKind(reference, doi);

  const authors = parseAuthors(reference);
  const venue = parseVenue(reference);
  const containerTitle = parseContainerTitle(reference, kind);

  return { doi, year, title, authors, venue, containerTitle, hasUrl, kind };
}

async function checkDoi(reference, parsed) {
  if (!parsed.doi) return sourceNotSearched("doi");

  return runSource("doi", async () => {
    const response = await fetchWithTimeout(`https://api.crossref.org/works/${encodeURIComponent(parsed.doi)}`);
    if (!response.ok) return [];
    const data = await response.json();
    return [normalizeCrossrefWork(data.message, "doi")];
  });
}

async function searchCrossref(reference, parsed) {
  return runSource("crossref", async () => {
    const matches = [];

    if (parsed.doi) {
      const doiResponse = await fetchWithTimeout(`https://api.crossref.org/works/${encodeURIComponent(parsed.doi)}`);
      if (doiResponse.ok) {
        const doiData = await doiResponse.json();
        matches.push(normalizeCrossrefWork(doiData.message, "crossref"));
      }
    }

    const query = parsed.title.length > 8 ? parsed.title : reference;
    const params = new URLSearchParams({ rows: "5", "query.bibliographic": query });
    const response = await fetchWithTimeout(`https://api.crossref.org/works?${params}`);
    if (response.ok) {
      const data = await response.json();
      matches.push(...(data.message?.items || []).map((item) => normalizeCrossrefWork(item, "crossref")));
    }

    return dedupeWorks(matches);
  });
}

async function searchOpenAlex(reference, parsed) {
  return runSource("openalex", async () => {
    const query = parsed.doi ? `doi:${parsed.doi}` : parsed.title.length > 8 ? parsed.title : reference;
    const params = new URLSearchParams({ per_page: "5", search: query });
    const response = await fetchWithTimeout(`https://api.openalex.org/works?${params}`);
    if (!response.ok) return [];
    const data = await response.json();
    return (data.results || []).map(normalizeOpenAlexWork);
  });
}

async function searchSemanticScholar(reference, parsed) {
  return runSource("semantic_scholar", async () => {
    const fields = "title,year,authors,venue,externalIds,url";
    if (parsed.doi) {
      const response = await fetchWithTimeout(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(parsed.doi)}?fields=${fields}`);
      if (response.ok) return [normalizeSemanticScholarWork(await response.json())];
    }

    const query = parsed.title.length > 8 ? parsed.title : reference;
    const params = new URLSearchParams({ query, limit: "5", fields });
    const response = await fetchWithTimeout(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`);
    if (!response.ok) return [];
    const data = await response.json();
    return (data.data || []).map(normalizeSemanticScholarWork);
  });
}

async function searchDataCite(reference, parsed) {
  return runSource("datacite", async () => {
    if (parsed.doi) {
      const response = await fetchWithTimeout(`https://api.datacite.org/dois/${encodeURIComponent(parsed.doi)}`);
      if (response.ok) {
        const data = await response.json();
        return [normalizeDataCiteWork(data.data)];
      }
    }

    if (!/zenodo|figshare|osf|dryad|dataset|data set|repository|archive/i.test(reference)) return [];

    const params = new URLSearchParams({ query: parsed.title || reference, "page[size]": "5" });
    const response = await fetchWithTimeout(`https://api.datacite.org/dois?${params}`);
    if (!response.ok) return [];
    const data = await response.json();
    return (data.data || []).map(normalizeDataCiteWork);
  });
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runSource(source, searchFn) {
  try {
    const matches = (await searchFn()).filter(Boolean);
    return { source, searched: true, found: matches.length > 0, matches };
  } catch (error) {
    return { source, searched: true, found: false, error: getErrorMessage(error), matches: [] };
  }
}

function sourceNotSearched(source) {
  return { source, searched: false, found: false, matches: [] };
}

function getManualSourceChecks(reference, parsed) {
  const checks = [];

  // Lovdata, Oria/BIBSYS and Google Scholar are useful human verification
  // sources, but this GitHub Pages app should not scrape them. We expose
  // search links instead, so the app stays lightweight and policy-friendly.
  if (parsed.kind === "legal" || /lovdata\.no/i.test(reference)) {
    checks.push({ source: "lovdata", searched: false, found: false, matches: [] });
  }

  if (["book", "chapter", "thesis", "report", "guideline"].includes(parsed.kind) || /\bisbn\b|gyldendal|universitetsforlaget|sage|routledge|elsevier/i.test(reference)) {
    checks.push({ source: "oria", searched: false, found: false, matches: [] });
  }

  checks.push({ source: "google_scholar", searched: false, found: false, matches: [] });
  return checks;
}

function normalizeCrossrefWork(item, source) {
  return {
    source,
    sourceId: item?.DOI || item?.URL || "",
    doi: normalizeDoi(item?.DOI || ""),
    title: cleanTitle(item?.title?.[0] || ""),
    authors: (item?.author || []).map((author) => [author.given, author.family].filter(Boolean).join(" ").trim()).filter(Boolean),
    year: item?.published?.["date-parts"]?.[0]?.[0] || item?.issued?.["date-parts"]?.[0]?.[0] || null,
    venue: item?.["container-title"]?.[0] || "",
    publisher: item?.publisher || "",
    url: item?.URL || (item?.DOI ? `https://doi.org/${item.DOI}` : ""),
  };
}

function normalizeOpenAlexWork(item) {
  return {
    source: "openalex",
    sourceId: item?.id || "",
    doi: normalizeDoi((item?.doi || "").replace(/^https:\/\/doi.org\//i, "")),
    title: cleanTitle(item?.title || item?.display_name || ""),
    authors: (item?.authorships || []).map((entry) => entry.author?.display_name).filter(Boolean),
    year: item?.publication_year || null,
    venue: item?.primary_location?.source?.display_name || item?.host_venue?.display_name || "",
    publisher: item?.primary_location?.source?.host_organization_name || "",
    url: item?.doi || item?.id || "",
  };
}

function normalizeSemanticScholarWork(item) {
  return {
    source: "semantic_scholar",
    sourceId: item?.paperId || "",
    doi: normalizeDoi(item?.externalIds?.DOI || ""),
    title: cleanTitle(item?.title || ""),
    authors: (item?.authors || []).map((author) => author.name).filter(Boolean),
    year: item?.year || null,
    venue: item?.venue || "",
    publisher: "",
    url: item?.url || (item?.externalIds?.DOI ? `https://doi.org/${item.externalIds.DOI}` : ""),
  };
}

function normalizeDataCiteWork(item) {
  const attributes = item?.attributes || {};
  return {
    source: "datacite",
    sourceId: item?.id || "",
    doi: normalizeDoi(attributes.doi || item?.id || ""),
    title: cleanTitle(attributes.titles?.[0]?.title || ""),
    authors: (attributes.creators || []).map((creator) => creator.name).filter(Boolean),
    year: Number(attributes.publicationYear) || null,
    venue: attributes.container?.title || "",
    publisher: attributes.publisher || "",
    url: attributes.url || (attributes.doi ? `https://doi.org/${attributes.doi}` : ""),
  };
}

function dedupeWorks(works) {
  const seen = new Set();
  return works.filter((work) => {
    const key = (work.doi || `${work.title}-${work.year}`).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreCandidate(candidate, parsed, reference, sourceChecks) {
  const titleScore = similarity(cleanTitle(parsed.title), cleanTitle(candidate.title));
  const doiMatches = Boolean(parsed.doi && candidate.doi && parsed.doi.toLowerCase() === candidate.doi.toLowerCase());
  const firstAuthorMatches = authorSimilarity(parsed.authors?.[0], candidate.authors?.[0]) > 0.66;
  const yearMatches = Boolean(parsed.year && candidate.year && parsed.year === candidate.year);
  const yearDistance = parsed.year && candidate.year ? Math.abs(parsed.year - candidate.year) : null;
  const venueMatches = Boolean(parsed.venue && candidate.venue && similarity(parsed.venue, candidate.venue) > 0.45);
  const independentMatches = countIndependentMatches(candidate, sourceChecks);

  let score = 0;
  if (doiMatches) score += 45;
  if (titleScore > 0.86) score += 30;
  else if (titleScore > 0.62) score += 18;
  else if (titleScore > 0.38) score += 8;
  else if (candidate.title) score -= 10;
  if (firstAuthorMatches) score += 15;
  if (yearMatches) score += 10;
  else if (yearDistance !== null && yearDistance > 2) score -= 15;
  if (venueMatches) score += 10;
  if (independentMatches > 1) score += 10;

  if (parsed.doi && candidate.doi && !doiMatches && titleScore < 0.45) score -= 45;
  if (parsed.authors?.[0] && candidate.authors?.[0] && !firstAuthorMatches && titleScore < 0.72) score -= 25;

  return {
    ...candidate,
    score: Math.max(0, Math.min(100, Math.round(score))),
    titleScore,
    doiMatches,
    firstAuthorMatches,
    yearMatches,
    yearDistance,
    venueMatches,
    independentMatches,
  };
}

function getVerdict(best, parsed, candidates, sourceChecks) {
  const evidence = [];
  const warnings = [];
  const searched = sourceChecks.filter((sourceCheck) => sourceCheck.searched);
  const successfulSearches = searched.filter((sourceCheck) => !sourceCheck.error);
  const errors = searched.filter((sourceCheck) => sourceCheck.error);

  errors.forEach((sourceCheck) => {
    warnings.push(`${sourceLabels[sourceCheck.source]} feilet teknisk: ${sourceCheck.error}. Dette betyr ikke at referansen er ugyldig.`);
  });

  if (!successfulSearches.length) {
    return makeVerdict("check_failed", 0, evidence, warnings.concat("Ingen kilder kunne sjekkes på grunn av tekniske feil."));
  }

  if (!best) {
    const message = "Vi fant ikke denne referansen i kildene som ble sjekket. Det beviser ikke at referansen er ugyldig; den kan mangle i indeksene, være formatert annerledes eller kreve manuell kontroll.";
    if (!parsed.doi || parsed.kind !== "article") {
      return makeVerdict("needs_manual_review", 25, [message], warnings.concat(`Referansen ser ut som ${describeKind(parsed.kind)}, som ofte er dårligere dekket i åpne registre.`));
    }
    return makeVerdict("not_found_in_checked_sources", 20, [message], warnings);
  }

  if (best.doiMatches) evidence.push(`Exact DOI match found in ${sourceLabels[best.source]}.`);
  if (best.titleScore > 0.86) evidence.push(`${sourceLabels[best.source]} found a work with a very similar title.`);
  if (best.firstAuthorMatches) evidence.push("First author appears to match.");
  if (best.yearMatches) evidence.push("Publication year matches.");
  if (best.venueMatches) evidence.push("Venue or journal appears to match.");
  if (best.independentMatches > 1) evidence.push("More than one checked source found what appears to be the same work.");

  const hasStrongDoiEvidence = best.doiMatches && best.score >= 65;
  const hasStrongOverallEvidence = best.score >= 75 && (best.doiMatches || best.independentMatches > 1);

  if (parsed.doi && best.doi && !best.doiMatches) warnings.push("The reference DOI points to a different DOI in the best match.");
  if (parsed.year && best.year && best.yearDistance > 2) warnings.push(`Publication year differs by more than two years: reference says ${parsed.year}, best match says ${best.year}.`);
  if (parsed.authors?.[0] && best.authors?.[0] && !best.firstAuthorMatches && best.titleScore < 0.72 && !hasStrongDoiEvidence) warnings.push("The first author differs from the best match.");
  if (best.titleScore < 0.45 && best.title && !hasStrongDoiEvidence) warnings.push("The best title match is weak.");
  if (candidates.length > 1 && candidates[1].score > best.score - 8 && !hasStrongOverallEvidence) warnings.push("Several similar candidates were found, so manual review is recommended.");
  if (!parsed.title || !parsed.year) warnings.push("The reference could not be parsed reliably, so manual review is recommended.");

  const hasSeriousMismatch = warnings.some((warning) => /different DOI|first author differs|year differs|title match is weak/i.test(warning)) && best.score < 65;
  if (hasSeriousMismatch && (parsed.doi || best.titleScore > 0.7)) return makeVerdict("metadata_mismatch", best.score, evidence, warnings);
  if (best.score >= 85 && !hasSeriousMismatch) return makeVerdict("verified", best.score, evidence, warnings);
  if (best.score >= 65) return makeVerdict("likely_verified", best.score, evidence, warnings);
  if (best.score >= 40 && !manualReviewKinds.has(parsed.kind)) return makeVerdict("partial_match", best.score, evidence, warnings);
  if (!parsed.doi || parsed.kind !== "article") return makeVerdict("needs_manual_review", best.score, evidence, warnings.concat(`Referansen ser ut som ${describeKind(parsed.kind)}, så den bør sjekkes manuelt.`));
  return makeVerdict("not_found_in_checked_sources", best.score, evidence, warnings.concat("No strong match was found in the sources checked."));
}

function makeVerdict(status, confidence, evidence, warnings) {
  return {
    status,
    label: statusLabels[status],
    confidence,
    evidence: evidence.length ? evidence : ["No strong evidence was found in the checked sources."],
    warnings,
    reasons: evidence.length ? evidence : warnings,
  };
}

function normalizeDoi(value) {
  return String(value)
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, "")
    .replace(/[.,;:)]+$/g, "")
    .trim();
}

function parseVancouverTitle(reference) {
  const withoutNumber = reference.replace(/^(\[\d+\]|\d{1,3}[.)])\s+/, "");
  const parts = withoutNumber.split(/\.\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return "";
  return parts[1];
}

function parseAuthors(reference) {
  const beforeYear = reference.split(/\((?:19|20)\d{2}\)|\b(?:19|20)\d{2}\b/)[0] || "";
  return beforeYear
    .replace(/^(\[\d+\]|\d{1,3}[.)])\s+/, "")
    .split(/\s+(?:&|and|et al\.?|red\.|editor)\s+|;\s*/)
    .flatMap((part) => part.split(/,\s+(?=[A-ZÆØÅ][a-zæøå-]+\s+[A-Z])/))
    .map((author) => author.replace(/[.,]+$/g, "").trim())
    .filter((author) => author.length > 2)
    .slice(0, 8);
}

function parseVenue(reference) {
  const parts = reference.split(".");
  const likelyVenue = parts.find((part) => /journal|tidsskrift|forskning|nursing|surgery|education|medicine|care|radiology|health/i.test(part));
  return cleanTitle(likelyVenue || "");
}

function parseContainerTitle(reference, kind) {
  if (kind !== "chapter") return "";
  const match = reference.match(/\b(?:in|i)\s*:\s*(.+?)(?:\s+\d+(?:st|nd|rd|th)?\s*ed\.|\s+\d+\s*utg\.|[.;]\s*(?:st\.?\s*louis|oslo|london|new york|australia|philadelphia)|:\s*[A-ZÆØÅ])/i);
  if (!match) return "";
  return cleanTitle(match[1].replace(/\b(editor|red\.?|redaktør)\b/gi, ""));
}

function inferReferenceKind(reference, doi) {
  const value = reference.toLowerCase();
  if (/\bin\s*:|\bi\s*:|editor|red\.|redaktør|kapittel|chapter/.test(value)) return "chapter";
  if (doi) return "article";
  if (/lovdata\.no|forskrift|lov om|for-\d{4}|lov-\d{4}|§/.test(value)) return "legal";
  if (/masteroppgave|phd|doktoravhandling|thesis|dissertation/.test(value)) return "thesis";
  if (/rapport|report|white paper|veileder/.test(value)) return "report";
  if (/tilgjengelig fra|available from|https?:\/\//.test(value)) return "web";
  if (/forskrift|retningslinje|guideline|standard|world health organization|who/.test(value)) return "guideline";
  if (/\bi:\s|in:\s|red\.|editor|utg\.|edition|forlag|publisher|elsevier health sciences|gyldendal|sage|routledge|universitetsforlaget/.test(value)) return "book";
  return "article";
}

function describeKind(kind) {
  return {
    article: "en artikkel",
    book: "bok",
    chapter: "bokkapittel",
    web: "nettkilde",
    guideline: "retningslinje, standard eller rapport",
    legal: "lov, forskrift eller juridisk kilde",
    report: "rapport",
    thesis: "oppgave eller avhandling",
  }[kind] || "en kilde uten tydelig registerspor";
}

function authorSimilarity(left, right) {
  if (!left || !right) return 0;
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((word) => rightTokens.has(word)).length;
  return intersection / Math.min(leftTokens.size, rightTokens.size);
}

function countIndependentMatches(candidate, sourceChecks) {
  return sourceChecks.filter((sourceCheck) =>
    (sourceCheck.matches || []).some((match) => {
      const doiMatch = candidate.doi && match.doi && candidate.doi.toLowerCase() === match.doi.toLowerCase();
      const titleMatch = candidate.title && match.title && similarity(candidate.title, match.title) > 0.86;
      return doiMatch || titleMatch;
    }),
  ).length;
}

function getErrorMessage(error) {
  if (error?.name === "AbortError") return "timeout";
  return error?.message || "ukjent API-feil";
}

function cleanTitle(value) {
  return String(value)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\bdoi:\s*\S+/gi, "")
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a, b) {
  const left = tokenize(a);
  const right = tokenize(b);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

function tokenize(value) {
  return new Set(
    String(value)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9æøå ]/gi, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !["the", "and", "for", "with", "from", "journal", "article"].includes(word)),
  );
}

function render() {
  const visible = allResults.filter((result) => matchesFilter(result, currentFilter));
  updateCounters();

  if (!allResults.length) {
    resultList.innerHTML = '<div class="empty">Ingen resultater ennå.</div>';
    return;
  }

  if (!visible.length) {
    resultList.innerHTML = '<div class="empty">Ingen referanser i dette filteret.</div>';
    return;
  }

  resultList.innerHTML = visible.map(renderResult).join("");
}

function matchesFilter(result, filter) {
  if (filter === "all") return true;
  if (filter === "verified") return ["verified", "likely_verified"].includes(result.status);
  if (filter === "partial") return result.status === "partial_match";
  if (filter === "review") return ["not_found_in_checked_sources", "needs_manual_review", "check_failed"].includes(result.status);
  return result.status === filter;
}

function renderResult(result) {
  if (result.state === "checking") {
    return `
      <article class="reference-row">
        <div>
          <div class="reference-text">${escapeHtml(result.reference)}</div>
          <p class="meta">Søker i åpne akademiske registre...</p>
        </div>
        <div class="score">
          <span class="badge uncertain">Sjekker</span>
          <div class="score-meter"><span class="warn" style="width: 45%"></span></div>
        </div>
      </article>
    `;
  }

  const scoreClass = ["verified", "likely_verified"].includes(result.status) ? "" : result.status === "partial_match" ? "warn" : result.status === "metadata_mismatch" ? "danger" : "review";
  const score = Math.max(0, Math.min(100, Math.round(result.confidence || result.best?.score || 0)));
  const links = result.best?.url
    ? `<div class="source-links"><a href="${escapeAttribute(result.best.url)}" target="_blank" rel="noreferrer">Åpne beste treff hos ${escapeHtml(sourceLabels[result.best.source] || result.best.source)}</a></div>`
    : "";
  const manualLinks = renderManualLinks(result);
  const parsedFields = [
    result.parsed?.doi ? `DOI: ${result.parsed.doi}` : "",
    result.parsed?.year ? `År: ${result.parsed.year}` : "",
    result.parsed?.authors?.[0] ? `Første forfatter: ${result.parsed.authors[0]}` : "",
    result.parsed?.containerTitle ? `Bok: ${result.parsed.containerTitle}` : "",
  ].filter(Boolean);
  const sources = (result.sourcesChecked || []).map(renderSourcePill).join("");

  return `
    <article class="reference-row" data-status="${result.status}">
      <div>
        <div class="reference-text">${escapeHtml(result.reference)}</div>
        <p class="match-title"><strong>Beste treff:</strong> ${escapeHtml(result.best?.title || "Ingen treff")}</p>
        <p class="meta">${escapeHtml([result.best?.venue, result.best?.year, result.best?.doi ? `DOI ${result.best.doi}` : ""].filter(Boolean).join(" · "))}</p>
        <div class="source-list">${sources}</div>
        <div class="detail-grid">
          <div class="detail-box">
            <h3>Parsed fields</h3>
            <p class="meta">${escapeHtml(parsedFields.join(" · ") || "Kunne ikke hente sikre felt")}</p>
          </div>
          <div class="detail-box">
            <h3>Evidence</h3>
            <ul class="reason-list">
              ${(result.evidence || []).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
            </ul>
          </div>
          <div class="detail-box">
            <h3>Warnings</h3>
            <ul class="reason-list">
              ${(result.warnings?.length ? result.warnings : ["Ingen tydelige advarsler."]).map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}
            </ul>
          </div>
        </div>
        ${links}
        ${manualLinks}
      </div>
      <div class="score">
        <span class="badge ${result.status}">${result.label}</span>
        <div class="score-meter"><span class="${scoreClass}" style="width: ${score}%"></span></div>
        <p class="meta">${score}/100 confidence</p>
      </div>
    </article>
  `;
}

function renderSourcePill(sourceCheck) {
  const label = sourceLabels[sourceCheck.source] || sourceCheck.source;
  const state = !sourceCheck.searched ? "manuell" : sourceCheck.error ? "feilet" : sourceCheck.found ? "treff" : "ingen treff";
  const className = sourceCheck.error ? "error" : sourceCheck.found ? "found" : "";
  return `<span class="source-pill ${className}">${escapeHtml(label)}: ${escapeHtml(state)}</span>`;
}

function renderManualLinks(result) {
  const links = getManualSearchLinks(result);
  if (!links.length) return "";

  return `
    <div class="source-links">
      ${links.map((link) => `<a href="${escapeAttribute(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`).join("")}
    </div>
  `;
}

function getManualSearchLinks(result) {
  const reference = result.originalReference || result.reference;
  const query = buildSearchQuery(result);
  const encodedQuery = encodeURIComponent(query || reference);
  const links = [];

  if (result.parsed?.kind === "legal" || /lovdata\.no/i.test(reference)) {
    links.push({ label: "Søk i Lovdata", url: `https://lovdata.no/sok?q=${encodedQuery}` });
  }

  if (["book", "chapter", "thesis", "report", "guideline"].includes(result.parsed?.kind) || /\bisbn\b|gyldendal|universitetsforlaget|sage|routledge|elsevier/i.test(reference)) {
    links.push({ label: "Søk i Oria/BIBSYS", url: `https://bibsys-network.primo.exlibrisgroup.com/discovery/search?vid=47BIBSYS_NETWORK:BIBSYS_UNION&query=any,contains,${encodedQuery}` });
  }

  links.push({ label: "Søk manuelt i Google Scholar", url: `https://scholar.google.com/scholar?q=${encodedQuery}` });
  return links;
}

function buildSearchQuery(result) {
  if (result.parsed?.kind === "chapter" && result.parsed?.containerTitle) {
    return [
      result.parsed.containerTitle,
      findEditorName(result.originalReference || result.reference),
      result.parsed.year,
    ].filter(Boolean).join(" ");
  }

  const query = [
    result.parsed?.title,
    result.parsed?.authors?.[0],
    result.parsed?.year,
    result.parsed?.doi,
  ].filter(Boolean).join(" ");

  return query.length > 12 ? query : cleanSearchQuery(result.originalReference || result.reference);
}

function findEditorName(reference) {
  const match = reference.match(/\b(?:in|i)\s*:\s*([^,.;]+(?:\s+[A-ZÆØÅ][^,.;]+)?)\s*,?\s*(?:editor|red\.?|redaktør)/i);
  return match ? cleanTitle(match[1]) : "";
}

function cleanSearchQuery(reference) {
  return reference
    .replace(/^(\[\d+\]|\d{1,3}[.)])\s+/, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\b10\.\d{4,9}\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .slice(0, 180)
    .trim();
}

function updateCounters() {
  const counts = allResults.reduce(
    (acc, result) => {
      acc.total += 1;
      return acc;
    },
    { total: 0, found: 0, uncertain: 0, suspicious: 0 },
  );

  counters.total.textContent = counts.total;
  counters.found.textContent = allResults.filter((result) => ["verified", "likely_verified"].includes(result.status)).length;
  counters.uncertain.textContent = allResults.filter((result) => result.status === "partial_match").length;
  counters.suspicious.textContent = allResults.filter((result) => ["metadata_mismatch", "not_found_in_checked_sources", "needs_manual_review", "check_failed"].includes(result.status)).length;
}

function updateReferenceCount() {
  const count = parseReferences(refsInput.value).length;
  referenceCount.textContent = `${count} ${count === 1 ? "referanse" : "referanser"} oppdaget`;
}

function updateStatus(message) {
  statusLine.textContent = message;
}

function setBusy(isBusy) {
  checkButton.disabled = isBusy;
  sampleButton.disabled = isBusy;
  checkButton.innerHTML = `${checkIcon}${isBusy ? "Sjekker..." : "Sjekk referanser"}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

render();
updateReferenceCount();
