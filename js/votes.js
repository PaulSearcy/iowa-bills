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
    return { session, chamber };
}

function sessionQuery(session, chamber) {
    const params = new URLSearchParams();
    params.set('session', session);
    params.set('chamber', chamber);
    return params.toString();
}

function setUrlState(session, chamber) {
    history.replaceState(null, '', `${location.pathname}?${sessionQuery(session, chamber)}`);
}

function setSession(session) {
    location.href = `${location.pathname}?${sessionQuery(session, currentChamber)}`;
}

function switchView(view) {
    const page = view === 'list' ? 'bill-list.html' : 'vote-table.html';
    location.href = `${page}?${sessionQuery(currentSession, currentChamber)}`;
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
