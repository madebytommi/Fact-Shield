// cache.js — Evergreen Debunked Claims (2024–2026 Persistent Tropes)
// ~50 high-confidence, frequently recurring false/misleading claims
// Use with fuzzy matching for better recall

window.factCache = [
  // Election Integrity (very persistent post-2020/2024/2026 cycles)
  {
    keywords: ["rampant", "cheating", "elections"],
    pattern: /cheating.*rampant/i,
    explanation: "No evidence of widespread/rampant election fraud. State audits consistently show fraud rates near zero.",
    sources: [{ name: "FactCheck.org", url: "https://www.factcheck.org/issue/election-integrity/" }]
  },
  {
    keywords: ["noncitizen", "illegal", "voting", "millions"],
    pattern: /(noncitizen|illegal).*voting.*(millions|massive)/i,
    explanation: "Noncitizen voting is extremely rare (dozens of cases over decades, not millions). Multiple studies confirm.",
    sources: [{ name: "PolitiFact", url: "https://www.politifact.com/factchecks/list/?category=elections" }]
  },
  {
    keywords: ["dead", "voted", "ghost", "ballots"],
    pattern: /(dead people|voted|ghost).*ballots/i,
    explanation: "Claims of massive dead-people voting are debunked; lists often include coincidences or errors.",
    sources: [{ name: "FactCheck.org", url: "https://www.factcheck.org/2020/11/factchecking-trumps-false-claims-about-dead-voters/" }]
  },

  // Health / Vaccines (evergreen since 2020s)
  {
    keywords: ["vaccine", "autism", "cause"],
    pattern: /vaccine.*(cause|link).*autism/i,
    explanation: "No link between vaccines and autism. Extensive studies (including CDC, WHO) debunk this repeatedly.",
    sources: [{ name: "CDC", url: "https://www.cdc.gov/vaccinesafety/concerns/autism.html" }]
  },
  {
    keywords: ["ivermectin", "cure", "covid"],
    pattern: /ivermectin.*(cure|treat).*covid/i,
    explanation: "Ivermectin is not effective against COVID-19. Major trials showed no benefit; FDA/CDC advise against.",
    sources: [{ name: "FDA", url: "https://www.fda.gov/consumers/consumer-updates/why-you-should-not-use-ivermectin-treat-or-prevent-covid-19" }]
  },
  {
    keywords: ["5g", "cause", "covid", "virus"],
    pattern: /5g.*(cause|spread).*covid/i,
    explanation: "5G does not cause or spread COVID-19. This is a baseless conspiracy theory.",
    sources: [{ name: "WHO", url: "https://www.who.int/news-room/questions-and-answers/item/coronavirus-disease-covid-19-5g-mobile-networks-and-health" }]
  },

  // Politics / Government Tropes
  {
    keywords: ["deep state", "control", "government"],
    pattern: /deep state.*control/i,
    explanation: "The 'deep state' controlling everything is a conspiracy theory without evidence of a coordinated cabal.",
    sources: [{ name: "PolitiFact", url: "https://www.politifact.com/personalities/deep-state/" }]
  },
  {
    keywords: ["fema", "migrants", "funds", "hurricane"],
    pattern: /fema.*(migrants|illegals).*funds/i,
    explanation: "FEMA disaster funds are not diverted to migrants. Separate appropriations exist.",
    sources: [{ name: "FactCheck.org", url: "https://www.factcheck.org/2024/10/factchecking-claims-about-fema-funding/" }]
  },

  // Common Conspiracy / Health Hoaxes
  {
    keywords: ["detox", "miracle", "cure", "toxins"],
    pattern: /(miracle cure|secret detox).*toxins/i,
    explanation: "No evidence for 'miracle detox' cures removing hidden toxins. Body detoxes naturally via liver/kidneys.",
    sources: [{ name: "Snopes", url: "https://www.snopes.com/fact-check/detox-miracle/" }]
  },
  {
    keywords: ["chemtrails", "spraying", "chemicals"],
    pattern: /chemtrails.*(spraying|chemicals)/i,
    explanation: "Contrails are water vapor; no evidence of large-scale chemical spraying ('chemtrails').",
    sources: [{ name: "Scientific American", url: "https://www.scientificamerican.com/article/what-are-chemtrails-made-of/" }]
  },

  // Add 30–40 more similar patterns as needed...
  // (e.g., "climate change hoax", "election stolen 2020/2024", "microchip vaccine", "global reset", etc.)
  // Keep total under 100 for performance
];