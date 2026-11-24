# Campaign templates

Resources for new **Iowa House** Democratic candidates, based on [templatePrompt.md](templatePrompt.md).

**Start here:** from the repo root run `npm run serve`, then open **http://localhost:3000/campaignTemplate/** (the guide needs a local server so district JSON can load).

| File | Purpose |
| --- | --- |
| [index.html](index.html) | Interactive step-by-step candidate guide (HTML) |
| [iowaHouseCandidateTemplate.md](iowaHouseCandidateTemplate.md) | Fill-in campaign plan: forms, deadlines, finance, vendors, party contacts |
| [countyDemocraticChairs.md](countyDemocraticChairs.md) | County chair names (from [IDP](https://iowademocrats.org/county-parties/)) |
| [districtPrintShops.md](districtPrintShops.md) | Nearest recommended print vendor per HD (1–100) |
| `data/districtPrintShops.json` | Machine-readable vendor list |

To refresh the print-shop table after editing `data/districtPrintShops.json`:

```bash
node tools/build-district-print-shops.mjs
```

District print partners are chosen by geographic distance from each district center (Census 2024 Iowa House boundaries). Chairs list can be re-scraped from the IDP county parties page when leadership changes.
