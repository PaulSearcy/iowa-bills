const SESSION_FILES = {
    '2025': 'js/vote-data-2025.js',
    '2026': 'js/vote-data-2026.js'
};

function expandVoteData(data) {
    if (!data?.rosters || data.votes?.[0]?.voteDetails) return data;

    data.votes = data.votes.map((vote) => {
        const roster = data.rosters[vote.chamber] || [];
        const names = (idxs) => (idxs || []).map((i) => roster[i]).filter(Boolean);
        const nayIdx = vote.nayIdx || (Array.isArray(vote.nays) ? vote.nays : null);
        vote.voteDetails = {
            yeas: names(vote.yeas),
            nays: names(nayIdx),
            absentOrNotVoting: names(vote.absent)
        };
        if (Array.isArray(vote.nays)) {
            vote.nays = vote.voteDetails.nays.length;
        }
        return vote;
    });
    return data;
}

function getUrlState() {
    const params = new URLSearchParams(location.search);
    const session = params.get('session') === '2025' ? '2025' : '2026';
    const chamberParam = params.get('chamber');
    const chamber = ['House', 'Senate', 'Both'].includes(chamberParam) ? chamberParam : 'House';
    return {
        session,
        chamber,
        a: (params.get('a') || '').trim(),
        b: (params.get('b') || '').trim()
    };
}

function compareQueryExtra() {
    const extra = {};
    if (typeof currentCompareA === 'string' && currentCompareA) extra.a = currentCompareA;
    if (typeof currentCompareB === 'string' && currentCompareB) extra.b = currentCompareB;
    return extra;
}

function sessionQuery(session, chamber, extra) {
    const params = new URLSearchParams();
    params.set('session', session);
    params.set('chamber', chamber);
    const extraParams = extra || compareQueryExtra();
    if (extraParams.a) params.set('a', extraParams.a);
    if (extraParams.b) params.set('b', extraParams.b);
    return params.toString();
}

function setUrlState(session, chamber) {
    history.replaceState(null, '', `${location.pathname}?${sessionQuery(session, chamber)}`);
}

function setSession(session) {
    location.href = `${location.pathname}?${sessionQuery(session, currentChamber)}`;
}

function viewPage(view) {
    if (view === 'list') return 'bill-list.html';
    if (view === 'compare') return 'compare.html';
    return 'index.html';
}

function switchView(view) {
    const extra = view === 'compare' ? compareQueryExtra() : {};
    location.href = `${viewPage(view)}?${sessionQuery(currentSession, currentChamber, extra)}`;
}

function setViewUI(view) {
    ['table', 'list', 'compare'].forEach((name) => {
        const btn = document.getElementById(`btn-view-${name}`);
        if (!btn) return;
        const on = name === view;
        btn.classList.toggle('active', on);
        if (on) btn.setAttribute('aria-current', 'page');
        else btn.removeAttribute('aria-current');
    });
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load ' + src));
        document.head.appendChild(script);
    });
}

function preloadSessionData(session) {
    const href = SESSION_FILES[session];
    if (!href || document.querySelector(`link[rel="preload"][href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'script';
    link.href = href;
    document.head.appendChild(link);
}

function setChamberUI(chamber) {
    document.querySelectorAll('.chamber-toggle button').forEach((btn) => btn.classList.remove('active'));
    document.getElementById(`btn-${chamber.toLowerCase()}`).classList.add('active');
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function generalAssemblyNumber(sessionYear) {
    const year = Number(sessionYear);
    if (!Number.isFinite(year) || year < 1846) return null;
    // Iowa GAs are two-year biennia; 2025–2026 is the 91st.
    return Math.floor((year - 1843) / 2);
}

function billBookAbbreviation(legislation) {
    const text = String(legislation || '').trim();
    if (!text) return null;
    // Floor votes on "H-8494 to H-8491" are for the first amendment.
    const primary = text.split(/\s+to\s+/i)[0].trim();
    return primary || null;
}

function billBookUrl(legislation, sessionYear) {
    const ba = billBookAbbreviation(legislation);
    const ga = generalAssemblyNumber(sessionYear);
    if (!ba || !ga) return null;
    return `https://www.legis.iowa.gov/legislation/BillBook?ga=${ga}&ba=${encodeURIComponent(ba)}`;
}

function ballotpediaSearchName(name) {
    const text = String(name || '').trim();
    if (!text) return '';
    const comma = text.match(/^([^,]+),\s*(.+)$/);
    if (comma) return `${comma[2].trim()} ${comma[1].trim()}`;
    return text;
}

function ballotpediaUrl(name, chamber) {
    const searchName = ballotpediaSearchName(name);
    if (!searchName) return null;
    const chamberLabel = chamber === 'Senate' ? 'Iowa Senate' : chamber === 'House' ? 'Iowa House' : 'Iowa';
    const query = encodeURIComponent(`${searchName} ${chamberLabel}`).replace(/%20/g, '+');
    return `https://ballotpedia.org/wiki/index.php?search=${query}&ns0=1&ns4=1`;
}

function externalLink(url, text, options = {}) {
    if (!url) {
        return options.className
            ? `<span class="${escapeHtml(options.className)}">${escapeHtml(text)}</span>`
            : escapeHtml(text);
    }
    const cls = options.className ? ` class="${escapeHtml(options.className)}"` : '';
    const aria = options.ariaLabel ? ` aria-label="${escapeHtml(options.ariaLabel)}"` : '';
    const title = options.title ? ` title="${escapeHtml(options.title)}"` : '';
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"${cls}${aria}${title}>${escapeHtml(text)}</a>`;
}

function billLinkHtml(legislation, sessionYear, className) {
    return externalLink(billBookUrl(legislation, sessionYear), legislation, {
        className: className || 'source-link',
        ariaLabel: `Read ${legislation} on the Iowa Legislature site (opens in a new tab)`,
        title: 'Open bill details on legis.iowa.gov'
    });
}

function memberLabel(member) {
    if (!member) return '';
    return member.partyAbbr ? `${member.name} (${member.partyAbbr})` : member.name;
}

function memberLinkHtml(member, chamber, className) {
    const name = typeof member === 'string' ? member : member?.name;
    if (!name) return '';
    const label = typeof member === 'string' ? member : memberLabel(member);
    return externalLink(ballotpediaUrl(name, chamber), label, {
        className: className || 'source-link',
        ariaLabel: `${name} on Ballotpedia (opens in a new tab)`,
        title: 'Open Ballotpedia in a new tab'
    });
}

function partyClass(member) {
    const abbr = typeof member === 'string' ? '' : member?.partyAbbr;
    if (abbr === 'D') return 'party-d';
    if (abbr === 'R') return 'party-r';
    return '';
}

function voteKey(vote) {
    return `${vote.chamber}-${vote.legislation}-${vote.date}`;
}

function createVoteIndex(data) {
    const votes = data.votes || [];
    const votesByChamber = { House: [], Senate: [], Both: votes };

    votes.forEach((vote) => {
        if (vote.chamber === 'House') votesByChamber.House.push(vote);
        else if (vote.chamber === 'Senate') votesByChamber.Senate.push(vote);
    });

    const memberMaps = { House: new Map(), Senate: new Map(), Both: new Map() };
    const voteLookup = new Map();

    votes.forEach((vote) => {
        const lookup = new Map();
        const processVoters = (list, voteType) => {
            if (!list) return;
            list.forEach((m) => {
                lookup.set(m.name, voteType);
                const memberData = { name: m.name, party: m.party, partyAbbr: m.partyAbbr };
                memberMaps.Both.set(m.name, memberData);
                if (vote.chamber === 'House') memberMaps.House.set(m.name, memberData);
                else if (vote.chamber === 'Senate') memberMaps.Senate.set(m.name, memberData);
            });
        };

        processVoters(vote.voteDetails?.yeas, 'yea');
        processVoters(vote.voteDetails?.nays, 'nay');
        processVoters(vote.voteDetails?.absentOrNotVoting, 'absent');
        voteLookup.set(voteKey(vote), lookup);
    });

    const sortMembers = (map) => Array.from(map.values()).sort((a, b) => {
        if (a.partyAbbr !== b.partyAbbr) return a.partyAbbr === 'D' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    return {
        votesByChamber,
        membersByChamber: {
            House: sortMembers(memberMaps.House),
            Senate: sortMembers(memberMaps.Senate),
            Both: sortMembers(memberMaps.Both)
        },
        voteLookup
    };
}

function getIndexedVote(voteLookup, vote, memberName) {
    return voteLookup.get(voteKey(vote))?.get(memberName) || 'none';
}

function percentRounded(part, whole) {
    if (!whole) return null;
    if (part <= 0) return 0;
    if (part >= whole) return 100;
    const pct = Math.round((part / whole) * 100);
    if (pct === 100) return 99;
    if (pct === 0) return 1;
    return pct;
}

function recordedAbsence(voteLookup, votes, memberName) {
    let absent = 0;
    let recorded = 0;
    votes.forEach((vote) => {
        const result = getIndexedVote(voteLookup, vote, memberName);
        if (result === 'none') return;
        recorded += 1;
        if (result === 'absent') absent += 1;
    });
    return {
        absent,
        recorded,
        pct: percentRounded(absent, recorded)
    };
}

function formatAbsenceShort(stats) {
    if (!stats || !stats.recorded) return '–';
    return `${stats.pct}%`;
}

function formatAbsenceLong(stats) {
    if (!stats || !stats.recorded) return 'No recorded votes';
    return `${stats.pct}% (${stats.absent} of ${stats.recorded})`;
}

function absenceTitle(stats) {
    if (!stats || !stats.recorded) return 'No recorded votes in this chamber';
    return `Absent / not voting on ${stats.absent} of ${stats.recorded} recorded votes`;
}

function findMember(members, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    const exact = members.find((m) => m.name.toLowerCase() === q);
    if (exact) return exact;
    const starts = members.filter((m) => m.name.toLowerCase().startsWith(q));
    if (starts.length === 1) return starts[0];
    const includes = members.filter((m) =>
        m.name.toLowerCase().includes(q) ||
        (m.party || '').toLowerCase().includes(q) ||
        (m.partyAbbr || '').toLowerCase() === q
    );
    if (includes.length === 1) return includes[0];
    return null;
}

function voteWord(result) {
    if (result === 'yea') return 'Yea';
    if (result === 'nay') return 'Nay';
    if (result === 'absent') return 'Absent';
    return '–';
}

async function loadVoteData(session) {
    await loadScript(SESSION_FILES[session]);
    if (typeof voteData === 'undefined') {
        throw new Error(`${SESSION_FILES[session]} not loaded`);
    }
    expandVoteData(voteData);
    return voteData;
}

(() => {
    const session = new URLSearchParams(location.search).get('session') === '2025' ? '2025' : '2026';
    preloadSessionData(session);
})();
