(() => {
  const STORAGE_KEY = "iowaHouseCandidateGuide:v1";
  const hdSelect = document.getElementById("hd-select");
  const profileHd = document.getElementById("profile-hd");
  const vendorPanel = document.getElementById("vendor-panel");
  const countyBody = document.getElementById("county-chair-body");
  const countySearch = document.getElementById("county-search");
  const countyHint = document.getElementById("county-hint");

  let printShops = [];
  let countyChairs = [];
  let districtCounties = {};

  const loadState = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  };

  const saveState = (patch) => {
    const next = { ...loadState(), ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const restoreFields = () => {
    const s = loadState();
    document.querySelectorAll("[data-store]").forEach((el) => {
      const key = el.dataset.store;
      if (s[key] !== undefined) el.value = s[key];
    });
    document.querySelectorAll("[data-check]").forEach((el) => {
      if (s[el.dataset.check]) el.checked = true;
    });
    if (s.hd && hdSelect) {
      hdSelect.value = s.hd;
      onHdChange();
    }
  };

  const bindPersistence = () => {
    document.querySelectorAll("[data-store]").forEach((el) => {
      el.addEventListener("input", () => saveState({ [el.dataset.store]: el.value }));
    });
    document.querySelectorAll("[data-check]").forEach((el) => {
      el.addEventListener("change", () => saveState({ [el.dataset.check]: el.checked }));
    });
    hdSelect?.addEventListener("change", () => {
      saveState({ hd: hdSelect.value });
      onHdChange();
    });
    profileHd?.addEventListener("input", () => {
      const v = profileHd.value.trim();
      if (hdSelect && [...hdSelect.options].some((o) => o.value === v)) hdSelect.value = v;
      saveState({ hd: v, [profileHd.dataset.store]: v });
      renderVendor(v);
      renderCounties(v, countySearch?.value || "");
    });
  };

  const renderVendor = (hd) => {
    if (!vendorPanel) return;
    const row = printShops.find((r) => r.hd === Number(hd));
    if (!row) {
      vendorPanel.innerHTML = "";
      return;
    }
    const link = row.web
      ? `<a href="${row.web}" rel="noopener noreferrer">${escapeHtml(row.name)}</a>`
      : escapeHtml(row.name);
    vendorPanel.innerHTML = `
      <h3>Print vendor for HD ${hd}</h3>
      <p><strong>${link}</strong></p>
      <p class="muted">Phone: <a href="tel:${row.phone.replace(/\D/g, "")}">${escapeHtml(row.phone)}</a></p>
      <p>${escapeHtml(row.notes)}</p>
      <p class="muted">Also see <a href="https://cwaprintshops.com/printers/cat/d7/iowa/">CWA Iowa union printers</a>.</p>`;
  };

  const chairByCounty = () => {
    const map = new Map();
    for (const c of countyChairs) map.set(c.county, c.chair);
    return map;
  };

  const renderCounties = (hd, filter = "") => {
    if (!countyBody) return;
    const counties = districtCounties[String(hd)] || [];
    const chairs = chairByCounty();
    const q = filter.trim().toLowerCase();
    const list = counties.length
      ? counties.map((name) => ({ county: name, chair: chairs.get(name) || "— see IDP site" }))
      : countyChairs;
    const filtered = q
      ? list.filter(
          (r) =>
            r.county.toLowerCase().includes(q) ||
            r.chair.toLowerCase().includes(q),
        )
      : list;

    countyBody.innerHTML = filtered
      .map(
        (r) => `<tr>
      <td>${escapeHtml(r.county)}</td>
      <td>${escapeHtml(r.chair)}</td>
      <td><input type="text" placeholder="Date contacted" aria-label="Contacted ${escapeHtml(r.county)}" data-store="county-${r.county.replace(/'/g, "")}" /></td>
    </tr>`,
      )
      .join("");

    if (countyHint) {
      countyHint.textContent = counties.length
        ? `Counties that overlap HD ${hd} (${counties.length}). Confirm exact boundaries on the official district map.`
        : "Pick a district above to list its counties, or search all county chairs.";
    }

    document.querySelectorAll("#county-chair-body [data-store]").forEach((el) => {
      const s = loadState();
      if (s[el.dataset.store] !== undefined) el.value = s[el.dataset.store];
      el.addEventListener("input", () => saveState({ [el.dataset.store]: el.value }));
    });
  };

  const onHdChange = () => {
    const hd = hdSelect?.value || "";
    if (profileHd) profileHd.value = hd;
    if (profileHd?.dataset.store) saveState({ [profileHd.dataset.store]: hd });
    renderVendor(hd);
    renderCounties(hd, countySearch?.value || "");
  };

  const escapeHtml = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const initNav = () => {
    const links = document.querySelectorAll(".guide-nav a[href^='#']");
    const sections = [...links].map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);

    const onScroll = () => {
      let current = sections[0]?.id;
      const y = window.scrollY + 120;
      for (const sec of sections) {
        if (sec.offsetTop <= y) current = sec.id;
      }
      links.forEach((a) => {
        a.setAttribute("aria-current", a.getAttribute("href") === `#${current}` ? "true" : "false");
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  };

  const fillHdOptions = () => {
    if (!hdSelect) return;
    hdSelect.innerHTML =
      '<option value="">Select district…</option>' +
      printShops.map((r) => `<option value="${r.hd}">House District ${r.hd}</option>`).join("");
  };

  const loadData = async () => {
    const base = new URL(".", import.meta.url);
    const get = async (file) => {
      const res = await fetch(new URL(file, base));
      if (!res.ok) throw new Error(file);
      return res.json();
    };
    [printShops, countyChairs, districtCounties] = await Promise.all([
      get("data/districtPrintShops.json"),
      get("data/countyChairs.json"),
      get("data/districtCounties.json"),
    ]);
    fillHdOptions();
    restoreFields();
    bindPersistence();
    initNav();
  };

  countySearch?.addEventListener("input", () => {
    renderCounties(hdSelect?.value || "", countySearch.value);
  });

  loadData().catch(() => {
    if (vendorPanel) {
      vendorPanel.innerHTML =
        '<p class="muted">Could not load district data. Open this guide through a local server (e.g. <code>npx serve .</code> from the repo root) or GitHub Pages.</p>';
    }
    bindPersistence();
    initNav();
    const s = loadState();
    if (s.hd && hdSelect) {
      for (let i = 1; i <= 100; i++) {
        hdSelect.innerHTML += `<option value="${i}">House District ${i}</option>`;
      }
      hdSelect.value = s.hd;
    }
  });
})();