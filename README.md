# Iowa Legislature Floor Votes

A readable view of Iowa House and Senate floor votes. Pick a session, switch between a comparison table and a bill-by-bill list, and see who voted yea, nay, or was absent.

This is a civic record, not an official source. Roll calls still live on [legis.iowa.gov](https://www.legis.iowa.gov/).

**Live site:** [paulsearcy.github.io/iowa-bills](https://paulsearcy.github.io/iowa-bills/)

## View the site

| Page | What it shows |
| --- | --- |
| [Table](index.html) | Members across many votes |
| [List](bill-list.html) | Bills with yea / nay / absent names |

Open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

## GitHub Pages

Pushes to `main` publish the public HTML, CSS, and compact vote data. Excel, JSON, and conversion scripts stay in the repo and are not deployed.

One-time setup if Pages is not on yet:

1. Open the repo on GitHub → **Settings** → **Pages**
2. Set **Source** to **GitHub Actions**

The site will be at `https://<user>.github.io/<repo>/`.

## Updating vote data

```bash
npm install
npm run fetch-votes:2025
npm run fetch-votes:2026
```
