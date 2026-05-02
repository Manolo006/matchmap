/* TAB SWITCH */
function showTab(tabId, clickedButton) {
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelectorAll('.tab-buttons button').forEach(b => b.classList.remove('active'));
    clickedButton.classList.add('active');
    if (tabId === 'map') {
        renderLuoghiMap();
    }
}

/* DATABASE LUOGHI (TEMP) */
let luoghiDb = [];
let dashboardToastTimer = null;
let luoghiMap = null;
let luoghiMapLayer = null;
let mapSearchSuggestions = [];
let mapSearchActiveIndex = -1;
let mapSearchHideTimer = null;
let mapSearchLastEnterTs = 0;
let deferredInstallPrompt = null;
const TEAM_LOGO_FALLBACK_PATH = 'img/logo.png';
const teamLogoUrlCache = new Map();
const DASHBOARD_ADMIN_EMAILS = new Set(['manuelcarpita@gmail.com']);
const AUTO_FIELD_SUGGESTIONS_CACHE_KEY = 'matchmap_auto_field_suggestions_v1';
const DASHBOARD_AUTH_SNAPSHOT_KEY = 'matchmap_dashboard_auth_snapshot_v1';
const GMAIL_INTEGRATION_STORAGE_KEY = 'matchmap_gmail_integration_v1';
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GMAIL_DEFAULT_QUERY = 'from:(noreply OR no-reply OR designazioni OR aia) (sinfonia OR designazione OR "sei designato" OR "gara n.") newer_than:365d';
const GMAIL_FALLBACK_QUERY = '("notifica di designazione" OR designazione OR rimborso OR "rimborso totale" OR "gara :" OR "numero gara") newer_than:365d';

async function loadLuoghiDb() {
    try {
        const fb = window.matchMapFirebase;
        if (fb?.ready && fb.db) {
            const snap = await fb.db.ref('luoghi').once('value');
            if (snap.exists()) {
                const raw = snap.val();
                luoghiDb = Array.isArray(raw) ? raw : Object.values(raw || {});
                renderLuoghiMap();
                renderMapSearchSuggestions();
                return;
            }
        }
    } catch (error) {
        luoghiDb = [];
    }
}

function normalizeText(value) {
    return (value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getQueryTokens(rawQuery, minLen = 2) {
    return normalizeText(rawQuery)
        .split(' ')
        .filter(token => token.length >= minLen);
}

function buildLuogoSearchHaystack(entry) {
    const nome = normalizeText(entry?.nome);
    const comune = normalizeText(entry?.comune);
    const indirizzo = normalizeText(entry?.indirizzo);
    const maps = normalizeText(entry?.mapsUrl);
    const aliases = (Array.isArray(entry?.aliases) ? entry.aliases : [])
        .map(normalizeText)
        .filter(Boolean);
    return [nome, comune, indirizzo, maps, ...aliases]
        .filter(Boolean)
        .join(' ');
}

function getRegionLogoPath(regionName) {
    const region = normalizeText(regionName);
    if (!region) {
        return null;
    }

    const regionLogoMap = {
        'abruzzo': 'img/abruzzo.png',
        'basilicata': 'img/basilicata.png',
        'calabria': 'img/calabria.png',
        'campania': 'img/campania.png',
        'emilia romagna': 'img/emilia_romania.png',
        'friuli venezia giulia': 'img/friuli.png',
        'lazio': 'img/lazio.png',
        'liguria': 'img/liguria.png',
        'lombardia': 'img/lombardia.png',
        'marche': 'img/marche.png',
        'molise': 'img/molise.png',
        'piemonte': 'img/piemonte.png',
        'puglia': 'img/puglia.png',
        'sardegna': 'img/sardegna.png',
        'sicilia': 'img/sicilia.png',
        'toscana': 'img/toscana.png',
        'trentino alto adige': 'img/trentino_alto_adige.png',
        'umbria': 'img/umbria.png',
        'valle d aosta': 'img/valle_daosta.png',
        'veneto': 'img/veneto.png'
    };

    return regionLogoMap[region] || null;
}

function showDashboardToast(message, type = 'warn') {
    let toast = document.getElementById('dashboardToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'dashboardToast';
        toast.className = 'dashboard-toast';
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.className = `dashboard-toast ${type}`.trim();
    toast.classList.add('show');

    if (dashboardToastTimer) {
        clearTimeout(dashboardToastTimer);
    }
    dashboardToastTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, 3400);
}

function findLuogoDbMatch(rawLocation) {
    const target = normalizeText(rawLocation);
    if (!target) {
        return null;
    }

    const words = new Set(target.split(' ').filter(Boolean));
    let bestMatch = null;
    let bestScore = 0;

    luoghiDb.forEach(entry => {
        const nome = normalizeText(entry?.nome);
        const indirizzo = normalizeText(entry?.indirizzo);
        const aliases = (Array.isArray(entry?.aliases) ? entry.aliases : [])
            .map(normalizeText)
            .filter(Boolean);

        let score = 0;

        // Match forte su nome campo
        if (nome && nome.length >= 5 && target.includes(nome)) {
            score += 120;
        }

        // Match medio su indirizzo
        if (indirizzo && indirizzo.length >= 8 && target.includes(indirizzo)) {
            score += 80;
        }

        // Match su alias (ignora alias troppo corti o generici)
        aliases.forEach(alias => {
            if (alias.length >= 4 && target.includes(alias)) {
                score += 45;
            }
        });

        // Intersezione parole utile per casi incompleti
        const candidateWords = new Set(
            [nome, indirizzo, ...aliases]
                .join(' ')
                .split(' ')
                .filter(token => token.length >= 4)
        );
        let overlap = 0;
        candidateWords.forEach(token => {
            if (words.has(token)) overlap += 1;
        });
        score += overlap * 4;

        if (score > bestScore) {
            bestScore = score;
            bestMatch = entry;
        }
    });

    // Soglia minima per evitare match casuali
    if (bestScore < 45) {
        return null;
    }
    return bestMatch;
}

function findBestLuogoForMapSearch(rawQuery) {
    const target = normalizeText(rawQuery);
    if (!target) {
        return null;
    }

    const tokens = getQueryTokens(rawQuery, 2);
    const words = new Set(target.split(' ').filter(token => token.length >= 2));
    let bestMatch = null;
    let bestScore = 0;

    luoghiDb.forEach(entry => {
        const haystackText = buildLuogoSearchHaystack(entry);
        if (!haystackText) {
            return;
        }
        if (tokens.length > 1) {
            const hasAllTokens = tokens.every(token => haystackText.includes(token));
            if (!hasAllTokens) {
                return;
            }
        }

        const nome = normalizeText(entry?.nome);
        const indirizzo = normalizeText(entry?.indirizzo);
        const comune = normalizeText(entry?.comune);
        const aliases = (Array.isArray(entry?.aliases) ? entry.aliases : [])
            .map(normalizeText)
            .filter(Boolean);
        const haystack = [nome, indirizzo, comune, ...aliases].filter(Boolean);
        if (!haystack.length) {
            return;
        }

        let score = 0;
        if (haystackText.includes(target)) {
            score += 220;
        }
        haystack.forEach(value => {
            if (value === target) {
                score += 220;
                return;
            }
            if (value.includes(target) || target.includes(value)) {
                score += 95;
            }
        });

        const candidateWords = new Set(haystack.join(' ').split(' ').filter(token => token.length >= 3));
        let overlap = 0;
        candidateWords.forEach(token => {
            if (words.has(token)) overlap += 1;
        });
        score += overlap * 8;

        if (score > bestScore) {
            bestScore = score;
            bestMatch = entry;
        }
    });

    if (bestScore < 24) {
        return null;
    }
    return bestMatch;
}

function getLuogoSearchSuggestions(rawQuery, limit = 8) {
    const target = normalizeText(rawQuery);
    if (!target || target.length < 1) {
        return [];
    }

    const words = getQueryTokens(rawQuery, 1);
    const scored = luoghiDb.map(item => {
        const haystackText = buildLuogoSearchHaystack(item);
        if (!haystackText) {
            return null;
        }
        if (words.length > 1) {
            const hasAllTokens = words.every(token => haystackText.includes(token));
            if (!hasAllTokens) {
                return null;
            }
        }

        const nome = normalizeText(item?.nome);
        const comune = normalizeText(item?.comune);
        const indirizzo = normalizeText(item?.indirizzo);
        const aliases = (Array.isArray(item?.aliases) ? item.aliases : [])
            .map(normalizeText)
            .filter(Boolean);
        const fields = [nome, comune, indirizzo, ...aliases].filter(Boolean);
        if (!fields.length) {
            return null;
        }

        let score = 0;
        if (haystackText.includes(target)) {
            score += 240;
        }
        fields.forEach(value => {
            if (value === target) score += 250;
            if (value.startsWith(target)) score += 140;
            if (value.includes(target)) score += 90;
            if (target.includes(value) && value.length >= 4) score += 48;
        });

        words.forEach(word => {
            fields.forEach(value => {
                if (value.includes(word)) {
                    score += 10;
                }
            });
        });

        if (score <= 0) {
            return null;
        }

        return {
            item,
            score
        };
    }).filter(Boolean);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(entry => entry.item);
}

function hideMapSearchSuggestions() {
    const list = document.getElementById('mapQuickSearchSuggestions');
    if (!list) {
        return;
    }
    list.hidden = true;
    list.innerHTML = '';
    mapSearchSuggestions = [];
    mapSearchActiveIndex = -1;
}

function renderMapSearchSuggestions() {
    const input = document.getElementById('mapQuickSearchInput');
    const list = document.getElementById('mapQuickSearchSuggestions');
    if (!input || !list) {
        return;
    }

    const query = String(input.value || '').trim();
    mapSearchSuggestions = getLuogoSearchSuggestions(query);
    mapSearchActiveIndex = mapSearchSuggestions.length ? 0 : -1;

    if (!mapSearchSuggestions.length) {
        hideMapSearchSuggestions();
        return;
    }

    list.innerHTML = mapSearchSuggestions.map((item, index) => {
        const title = String(item?.nome || 'Campo senza nome');
        const details = [item?.comune, item?.indirizzo].filter(Boolean).join(' - ');
        const isActive = index === mapSearchActiveIndex ? ' is-active' : '';
        return `
            <button type="button" class="map-search-suggestion${isActive}" data-index="${index}">
                <span class="map-search-suggestion-title">${title}</span>
                <span class="map-search-suggestion-meta">${details || 'Dettagli non disponibili'}</span>
            </button>
        `;
    }).join('');
    list.hidden = false;
}

function setMapSearchActiveIndex(index) {
    const list = document.getElementById('mapQuickSearchSuggestions');
    if (!list || !mapSearchSuggestions.length) {
        return;
    }
    const nextIndex = Math.max(0, Math.min(index, mapSearchSuggestions.length - 1));
    mapSearchActiveIndex = nextIndex;
    list.querySelectorAll('.map-search-suggestion').forEach((el, currentIndex) => {
        el.classList.toggle('is-active', currentIndex === nextIndex);
    });
}

function selectMapSearchSuggestion(index) {
    const selected = mapSearchSuggestions[index];
    if (!selected) {
        return false;
    }
    const input = document.getElementById('mapQuickSearchInput');
    if (input) {
        input.value = String(selected.nome || '').trim();
    }
    hideMapSearchSuggestions();
    searchMapPlaceFromBar(selected);
    return true;
}

function getMapsUrl(evento) {
    const match = findLuogoDbMatch(evento.locationText);
    if (match?.mapsUrl) {
        return match.mapsUrl;
    }

    const fallbackExisting = findExistingLuogoForEvento(evento);
    if (fallbackExisting?.mapsUrl) {
        return fallbackExisting.mapsUrl;
    }

    const primaryTeam = normalizeText(getPrimaryTeamName(evento?.squadre || ''));
    if (primaryTeam) {
        const byTeam = luoghiDb.find(item => {
            const team = normalizeText(item?.team || item?.squadra || '');
            const nome = normalizeText(item?.nome || '');
            return (team && (team.includes(primaryTeam) || primaryTeam.includes(team)))
                || (nome && nome.includes(primaryTeam));
        });
        if (byTeam?.mapsUrl) {
            return byTeam.mapsUrl;
        }
    }

    const query = evento.locationText || evento.luogo || evento.impianto || 'campo sportivo';
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function getNumericCoord(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function toTeamLogoSlug(value) {
    return normalizeText(value).replace(/\s+/g, '-');
}

function canLoadImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
    });
}

function extractTuttocampoTeamId(url) {
    const value = String(url || '').trim();
    if (!value) {
        return '';
    }
    const match = value.match(/\/Squadra\/[^/]+\/(\d+)(?:\/|$|\?)/i);
    return match ? match[1] : '';
}

function buildTuttocampoLogoCandidates(rawUrl) {
    const value = String(rawUrl || '').trim();
    const lower = value.toLowerCase();
    const isTuttocampoPage = lower.includes('tuttocampo.it') && lower.includes('/squadra/');
    if (!isTuttocampoPage) {
        return [];
    }
    const teamId = extractTuttocampoTeamId(value);
    if (!teamId) {
        return [];
    }
    return [
        `https://b-content.tuttocampo.it/Teams/200/${teamId}.png?v=1`,
        `https://b-content.tuttocampo.it/Teams/Original/${teamId}.png?v=1`
    ];
}

async function resolveTeamLogoUrl(item) {
    const explicitUrl = String(item?.logoUrl || item?.logo || '').trim();
    const teamName = String(item?.team || item?.nome || '').trim();
    const slug = toTeamLogoSlug(teamName);
    const cacheKey = `${explicitUrl}|${slug}`;
    if (teamLogoUrlCache.has(cacheKey)) {
        return teamLogoUrlCache.get(cacheKey);
    }

    const candidates = [];
    if (explicitUrl) {
        const tuttocampoCandidates = buildTuttocampoLogoCandidates(explicitUrl);
        if (tuttocampoCandidates.length) {
            candidates.push(...tuttocampoCandidates);
        } else {
            candidates.push(explicitUrl);
        }
    }
    if (slug) {
        candidates.push(`img/teams/${slug}.png`);
        candidates.push(`img/teams/${slug}.webp`);
        candidates.push(`img/teams/${slug}.jpg`);
        candidates.push(`img/teams/${slug}.jpeg`);
    }
    candidates.push(TEAM_LOGO_FALLBACK_PATH);

    for (const url of candidates) {
        // usa il primo logo raggiungibile, altrimenti fallback logo app
        const exists = await canLoadImage(url);
        if (exists) {
            teamLogoUrlCache.set(cacheKey, url);
            return url;
        }
    }

    teamLogoUrlCache.set(cacheKey, TEAM_LOGO_FALLBACK_PATH);
    return TEAM_LOGO_FALLBACK_PATH;
}

async function resolveTeamLogoUrls(item) {
    const explicitRaw = String(item?.logoUrl || item?.logo || '').trim();
    const explicitParts = explicitRaw
        .split(/[,;\n]+/)
        .map(x => x.trim())
        .filter(Boolean);

    const resolved = [];
    if (explicitParts.length) {
        for (const part of explicitParts) {
            const single = await resolveTeamLogoUrl({ ...item, logoUrl: part });
            if (single && !resolved.includes(single)) {
                resolved.push(single);
            }
            if (resolved.length >= 3) {
                break;
            }
        }
    }

    if (!resolved.length) {
        resolved.push(await resolveTeamLogoUrl(item));
    }

    if (!resolved.length) {
        resolved.push(TEAM_LOGO_FALLBACK_PATH);
    }
    return resolved.slice(0, 3);
}

function buildTeamLogoStackMarkerHtml(urls) {
    const safeUrls = (Array.isArray(urls) ? urls : [])
        .map(x => String(x || '').replace(/"/g, '&quot;'))
        .filter(Boolean)
        .slice(0, 3);
    const slots = safeUrls.map((url, index) => {
        return `<img src="${url}" alt="Logo squadra ${index + 1}" loading="lazy" decoding="async">`;
    }).join('');
    return `<div class="team-logo-stack ${safeUrls.length > 1 ? 'is-multi' : 'is-single'}">${slots}</div>`;
}

function hasValidMapCoords(latValue, lngValue) {
    const lat = getNumericCoord(latValue);
    const lng = getNumericCoord(lngValue);
    if (lat === null || lng === null) {
        return false;
    }
    // Esclude 0,0 (placeholder/non valido nel nostro contesto)
    if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) {
        return false;
    }
    return true;
}

function ensureLuoghiMap() {
    if (luoghiMap || !window.L) {
        return;
    }
    const mapEl = document.getElementById('luoghiMap');
    if (!mapEl) {
        return;
    }
    luoghiMap = L.map('luoghiMap', { zoomControl: true }).setView([41.9, 12.5], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(luoghiMap);
    luoghiMapLayer = L.layerGroup().addTo(luoghiMap);
}

async function renderLuoghiMap() {
    ensureLuoghiMap();
    const summaryEl = document.getElementById('mapSummary');
    const missingEl = document.getElementById('missingCoordsList');
    if (!summaryEl || !missingEl) {
        return;
    }

    const completed = luoghiDb.filter(item => {
        return hasValidMapCoords(item?.lat, item?.lng);
    });
    const missing = luoghiDb.filter(item => {
        return !hasValidMapCoords(item?.lat, item?.lng);
    });

    summaryEl.textContent = `Campi in mappa: ${completed.length}. Coordinate mancanti: ${missing.length}.`;
    if (missing.length) {
        missingEl.innerHTML = `<h4>Coordinate mancanti</h4><p>${missing.map(x => x.nome || 'Luogo senza nome').join(', ')}</p>`;
    } else {
        missingEl.innerHTML = '<h4>Tutto pronto</h4><p>Tutti i luoghi hanno coordinate.</p>';
    }

    if (!luoghiMap || !luoghiMapLayer) {
        return;
    }
    luoghiMapLayer.clearLayers();

    const bounds = [];
    const logoUrlSets = await Promise.all(completed.map(item => resolveTeamLogoUrls(item)));
    completed.forEach((item, index) => {
        const lat = getNumericCoord(item.lat);
        const lng = getNumericCoord(item.lng);
        const logoUrls = logoUrlSets[index] || [TEAM_LOGO_FALLBACK_PATH];
        const teamLogoIcon = L.divIcon({
            html: buildTeamLogoStackMarkerHtml(logoUrls),
            className: 'team-logo-stack-marker',
            iconSize: [56, 56],
            iconAnchor: [28, 28],
            popupAnchor: [0, -22]
        });
        const marker = L.marker([lat, lng], { icon: teamLogoIcon });
        const mapsLink = item.mapsUrl ? `<p><a href="${item.mapsUrl}" target="_blank">Apri Maps</a></p>` : '';
        marker.bindPopup(`<strong>${item.nome || 'Campo'}</strong><br>${item.comune || ''}<br>${item.indirizzo || ''}${mapsLink}`);
        marker.addTo(luoghiMapLayer);
        bounds.push([lat, lng]);
    });

    if (bounds.length) {
        luoghiMap.fitBounds(bounds, { padding: [5, 5], maxZoom: 5.5 });
        if (bounds.length === 1) {
            luoghiMap.setZoom(10);
        }
    } else {
        luoghiMap.setView([41.9, 12.5], 6);
    }

    setTimeout(() => luoghiMap.invalidateSize(), 50);
}

/* PARSING DESIGNAZIONE */
const GUEST_EVENTS_STORAGE_KEY = 'matchmap_guest_dashboard_events_v1';
let dashboardEvents = [];
let dashboardShowAllHidden = false;
let dashboardEventAutoRefreshTimer = null;
const SUGGESTION_COOLDOWN_KEY = 'matchmap_last_suggestion_ts_v1';
let gmailTokenClient = null;
let gmailAccessToken = '';
let gmailTokenExpiresAt = 0;
let gmailPreviewItems = [];
let gmailSelectAllState = false;
let gmailIntegrationPrefs = {
    enabled: false,
    query: GMAIL_DEFAULT_QUERY,
    linkedEmail: '',
    updatedAt: 0
};

function getGmailUiRefs() {
    return {
        queryInput: document.getElementById('gmailQueryInput'),
        statusEl: document.getElementById('gmailStatus'),
        connectBtn: document.getElementById('gmailConnectBtn'),
        disconnectBtn: document.getElementById('gmailDisconnectBtn'),
        loadBtn: document.getElementById('gmailLoadBtn'),
        previewWrap: document.getElementById('gmailPreviewWrap'),
        previewList: document.getElementById('gmailPreviewList'),
        importBtn: document.getElementById('gmailImportSelectedBtn'),
        selectAllBtn: document.getElementById('gmailSelectAllBtn')
    };
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isGmailTokenValid() {
    return Boolean(gmailAccessToken) && Date.now() < (gmailTokenExpiresAt - 5000);
}

function setGmailStatus(message, isOk = false) {
    const { statusEl } = getGmailUiRefs();
    if (!statusEl) {
        return;
    }
    statusEl.textContent = message;
    statusEl.style.color = isOk ? '#6ee7b7' : '#9fb2dd';
}

function readGmailIntegrationPrefs() {
    try {
        const raw = JSON.parse(localStorage.getItem(GMAIL_INTEGRATION_STORAGE_KEY) || '{}');
        return {
            enabled: Boolean(raw?.enabled),
            query: String(raw?.query || GMAIL_DEFAULT_QUERY).trim() || GMAIL_DEFAULT_QUERY,
            linkedEmail: String(raw?.linkedEmail || '').trim(),
            updatedAt: Number(raw?.updatedAt || 0)
        };
    } catch {
        return {
            enabled: false,
            query: GMAIL_DEFAULT_QUERY,
            linkedEmail: '',
            updatedAt: 0
        };
    }
}

function writeGmailIntegrationPrefsLocal() {
    localStorage.setItem(GMAIL_INTEGRATION_STORAGE_KEY, JSON.stringify({
        enabled: Boolean(gmailIntegrationPrefs?.enabled),
        query: String(gmailIntegrationPrefs?.query || GMAIL_DEFAULT_QUERY).trim() || GMAIL_DEFAULT_QUERY,
        linkedEmail: String(gmailIntegrationPrefs?.linkedEmail || '').trim(),
        updatedAt: Date.now()
    }));
}

async function persistGmailIntegrationPrefs() {
    writeGmailIntegrationPrefsLocal();
    const user = getCurrentDashboardUser();
    const { fb } = getDashboardAuthState();
    if (!user || !fb?.ready || !fb.db) {
        return;
    }
    try {
        await fb.db.ref(`users/${user.uid}/integrations/gmail`).set({
            enabled: Boolean(gmailIntegrationPrefs?.enabled),
            query: String(gmailIntegrationPrefs?.query || GMAIL_DEFAULT_QUERY).trim() || GMAIL_DEFAULT_QUERY,
            linkedEmail: String(gmailIntegrationPrefs?.linkedEmail || '').trim(),
            updatedAt: Date.now()
        });
    } catch {
        // fallback gia salvato in locale
    }
}

async function loadGmailIntegrationPrefsForCurrentUser() {
    const local = readGmailIntegrationPrefs();
    let merged = { ...local };
    const user = getCurrentDashboardUser();
    const { fb } = getDashboardAuthState();
    if (user && fb?.ready && fb.db) {
        try {
            const snap = await fb.db.ref(`users/${user.uid}/integrations/gmail`).once('value');
            if (snap.exists()) {
                const cloud = snap.val() || {};
                merged = {
                    enabled: Boolean(cloud?.enabled),
                    query: String(cloud?.query || local.query || GMAIL_DEFAULT_QUERY).trim() || GMAIL_DEFAULT_QUERY,
                    linkedEmail: String(cloud?.linkedEmail || local.linkedEmail || '').trim(),
                    updatedAt: Number(cloud?.updatedAt || local.updatedAt || 0)
                };
            }
        } catch {
            merged = { ...local };
        }
    }

    gmailIntegrationPrefs = {
        enabled: Boolean(merged.enabled),
        query: String(merged.query || GMAIL_DEFAULT_QUERY).trim() || GMAIL_DEFAULT_QUERY,
        linkedEmail: String(merged.linkedEmail || '').trim(),
        updatedAt: Number(merged.updatedAt || 0)
    };

    const { queryInput } = getGmailUiRefs();
    if (queryInput) {
        queryInput.value = gmailIntegrationPrefs.query || GMAIL_DEFAULT_QUERY;
    }
    updateGmailUiState();

    // prova a ripristinare in automatico il token Gmail dopo refresh
    // (senza prompt consenso, best-effort)
    if (user && gmailIntegrationPrefs.enabled && !isGmailTokenValid()) {
        restoreGmailSessionSilently();
    }
}

async function restoreGmailSessionSilently() {
    try {
        const tokenResponse = await createGmailTokenRequester();
        const token = String(tokenResponse?.access_token || '').trim();
        if (!token) {
            return;
        }
        gmailAccessToken = token;
        const expiresIn = Number(tokenResponse?.expires_in || 0);
        gmailTokenExpiresAt = Date.now() + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 0);
        updateGmailUiState();
        setGmailStatus('Sessione Gmail ripristinata automaticamente.', true);
    } catch {
        // normale: in alcuni browser/account Google richiede comunque interazione utente
        updateGmailUiState();
    }
}

function decodeBase64Url(value) {
    const input = String(value || '').trim();
    if (!input) {
        return '';
    }
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (base64.length % 4)) % 4;
    const padded = base64 + '='.repeat(padLen);
    try {
        return decodeURIComponent(escape(atob(padded)));
    } catch {
        try {
            return atob(padded);
        } catch {
            return '';
        }
    }
}

function stripHtmlTags(value) {
    return String(value || '')
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractHeaderValue(headers, name) {
    const target = String(name || '').trim().toLowerCase();
    const list = Array.isArray(headers) ? headers : [];
    const hit = list.find(item => String(item?.name || '').trim().toLowerCase() === target);
    return String(hit?.value || '').trim();
}

function extractBodyFromGmailPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return '';
    }

    const directMime = String(payload.mimeType || '').toLowerCase();
    const directData = decodeBase64Url(payload?.body?.data || '');
    if (directMime === 'text/plain' && directData) {
        return directData;
    }
    if (directMime === 'text/html' && directData) {
        return stripHtmlTags(directData);
    }

    const queue = Array.isArray(payload.parts) ? [...payload.parts] : [];
    let htmlFallback = '';
    while (queue.length) {
        const part = queue.shift();
        if (!part || typeof part !== 'object') {
            continue;
        }
        const mime = String(part.mimeType || '').toLowerCase();
        const data = decodeBase64Url(part?.body?.data || '');
        if (mime === 'text/plain' && data) {
            return data;
        }
        if (mime === 'text/html' && data && !htmlFallback) {
            htmlFallback = stripHtmlTags(data);
        }
        if (Array.isArray(part.parts) && part.parts.length) {
            queue.push(...part.parts);
        }
    }

    return htmlFallback || '';
}

function formatTimestampAsMatchMapDate(timestampValue) {
    const ts = Number(timestampValue || 0);
    if (!Number.isFinite(ts) || ts <= 0) {
        return '';
    }
    const date = new Date(ts);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());
    return `${day}/${month}/${year}`;
}

function ensureEventoShape(evento, fallbackTimestamp = 0) {
    const item = { ...(evento || {}) };
    if (!item.ora) {
        const fallback = String(item._gmailDate || '').match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
        item.ora = fallback ? `${fallback[1]}:${fallback[2]}` : '';
    }
    item.rimborso = Number(item.rimborso || 0);
    item.km = Number(item.km || 0);
    item.locationText = String(item.locationText || [item.luogo, item.impianto, item.indirizzo].filter(Boolean).join(', ')).trim();
    return item;
}

function extractSquadreFromSubject(subject) {
    const raw = String(subject || '').trim();
    if (!raw) {
        return '';
    }
    const cleaned = raw
        .replace(/^\[[^\]]+\]\s*/i, '')
        .replace(/^designazione\s+del\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s*:\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    const m = cleaned.match(/^(.+?)\s*-\s*(.+)$/);
    if (!m) {
        return '';
    }
    const a = String(m[1] || '').trim();
    const b = String(m[2] || '').trim();
    if (!a || !b) {
        return '';
    }
    return `${a} - ${b}`;
}

function buildPreviewEventoFromMessage(message) {
    const payload = message?.payload || {};
    const subject = extractHeaderValue(payload.headers, 'Subject');
    const from = extractHeaderValue(payload.headers, 'From');
    const dateHeader = extractHeaderValue(payload.headers, 'Date');
    const body = extractBodyFromGmailPayload(payload);
    const snippet = String(message?.snippet || '').trim();

    const sourceText = body || snippet;
    const sourceMetaText = `${subject || ''} ${snippet || ''} ${body || ''}`;
    const parsedFromBody = parseDesignazione(sourceText, {
        emailDateHeader: dateHeader,
        emailInternalTimestamp: Number(message?.internalDate || 0)
    });
    const parsedFromMeta = parseDesignazione(sourceMetaText, {
        emailDateHeader: dateHeader,
        emailInternalTimestamp: Number(message?.internalDate || 0)
    });

    const mergedParsed = {
        ...parsedFromBody,
        luogo: parsedFromBody.luogo || parsedFromMeta.luogo || '',
        impianto: parsedFromBody.impianto || parsedFromMeta.impianto || '',
        indirizzo: parsedFromBody.indirizzo || parsedFromMeta.indirizzo || '',
        locationText: parsedFromBody.locationText || parsedFromMeta.locationText || '',
        designazioneS4yRaw: parsedFromBody.designazioneS4yRaw || parsedFromMeta.designazioneS4yRaw || '',
        squadre: parsedFromBody.squadre || parsedFromMeta.squadre || ''
    };

    const evento = ensureEventoShape({
        ...mergedParsed,
        _gmailMessageId: String(message?.id || ''),
        _gmailThreadId: String(message?.threadId || ''),
        _gmailSubject: subject,
        _gmailFrom: from,
        _gmailDate: dateHeader,
        _gmailSnippet: snippet
    }, Number(message?.internalDate || 0));

    if (!evento.squadre) {
        evento.squadre = extractSquadreFromSubject(subject);
    }

    if (!evento.locationText) {
        const extraCampo = sourceMetaText.match(/\bcampo\s*:\s*([^\r\n]+)/i)?.[1]?.trim() || '';
        const extraIndirizzo = sourceMetaText.match(/\bindirizzo\s*:\s*([^\r\n]+)/i)?.[1]?.trim() || '';
        const extraLocalita = sourceMetaText.match(/\blocalit[àa]\s*:\s*([^\r\n]+)/i)?.[1]?.trim() || '';
        evento.impianto = evento.impianto || extraCampo;
        evento.indirizzo = evento.indirizzo || extraIndirizzo;
        evento.luogo = evento.luogo || extraLocalita;
        evento.locationText = [evento.luogo, evento.impianto, evento.indirizzo].filter(Boolean).join(', ').trim();
    }

    const hasActivityArbitro = /\battivit[àa]\s*:\s*arbitro\b/i.test(sourceText) || /\bsei\s+designato\b/i.test(sourceText);
    const hasCategoria = /\bcategoria\s*:/i.test(sourceText) || /\bgara\s*n\.?\s*\d+\s+di\s+.+?\s+girone\b/i.test(sourceText);
    const hasData = /\bdata\s*:/i.test(sourceText) || /\bla\s+partita\s+si\s+disputer[aà]\b/i.test(sourceText);
    const hasOra = /\bora\s*:/i.test(sourceText) || /\balle\s+ore\s+([01]?\d|2[0-3])[:.]([0-5]\d)\b/i.test(sourceText);
    const hasCampo = /\bcampo\s*:/i.test(sourceText) || /\bsull['’]impianto\b/i.test(sourceText);
    const hasKm = /\bdistanza\s*\(\s*km\s*\)\s*:/i.test(sourceText) || /\(\s*\d+\s*km\s*\)/i.test(sourceText);
    const hasRimborsoLabel = /\brimborso\s+totale\s*\(\s*€\s*\)\s*:/i.test(sourceText) || /\brimborso\s*:\s*\d+(?:[\.,]\d{1,2})?\s*€/i.test(sourceText);
    const hasRimborsoPositive = Number(evento.rimborso || 0) > 0;
    const hasCoreImportData = Boolean(
        evento.data &&
        evento.ora &&
        evento.categoria &&
        hasRimborsoPositive
    );

    const valid = Boolean(
        hasActivityArbitro &&
        hasCategoria &&
        hasData &&
        hasOra &&
        hasCampo &&
        (hasKm || Number(evento.km || 0) > 0) &&
        hasRimborsoLabel &&
        hasRimborsoPositive &&
        hasCoreImportData
    );
    return {
        id: String(message?.id || ''),
        selected: valid,
        valid,
        messageMeta: {
            subject,
            from,
            date: dateHeader,
            snippet
        },
        evento
    };
}

function isLikelyDesignazioneEmail(item) {
    const meta = item?.messageMeta || {};
    const evento = item?.evento || {};
    const hay = normalizeText(`${meta.subject || ''} ${meta.from || ''} ${meta.snippet || ''}`);
    const hasDesignazioneWords = /designazione|sinfonia|aia|gara n|sei designato/.test(hay);
    const hasCoreParsedFields = Boolean(evento?.data && evento?.ora && evento?.squadre);
    return hasDesignazioneWords || hasCoreParsedFields;
}

function splitMatchTeams(squadreText) {
    const raw = String(squadreText || '').trim();
    if (!raw) {
        return ['', ''];
    }
    const parts = raw.split(/\s*-\s*/).map(x => x.trim()).filter(Boolean);
    if (parts.length >= 2) {
        return [parts[0], parts[1]];
    }
    return [raw, ''];
}

function extractLogoCandidateFromLuogo(entry) {
    const raw = entry?.loghiUrl ?? entry?.logoUrl ?? entry?.logo ?? '';
    const explicitRaw = Array.isArray(raw) ? raw.join(',') : String(raw || '');
    const explicitFirst = explicitRaw
        .split(/[,;\n]+/)
        .map(x => x.trim())
        .find(Boolean);
    if (!explicitFirst) {
        return '';
    }
    const tuttocampoCandidates = buildTuttocampoLogoCandidates(explicitFirst);
    return tuttocampoCandidates[0] || explicitFirst;
}

function findBestLogoEntryForTeam(teamName) {
    const norm = normalizeText(teamName);
    if (!norm) {
        return null;
    }
    const queryTokens = norm.split(' ').filter(token => token.length >= 3);
    let best = null;
    let bestScore = 0;

    luoghiDb.forEach(item => {
        const team = normalizeText(item?.team || item?.squadra || item?.nome || '');
        if (!team) {
            return;
        }
        let score = 0;
        if (team === norm) {
            score += 200;
        }
        if (team.includes(norm) || norm.includes(team)) {
            score += 120;
        }
        const teamTokens = team.split(' ').filter(token => token.length >= 3);
        queryTokens.forEach(token => {
            if (teamTokens.includes(token)) {
                score += 20;
            }
        });
        const hasLogo = Boolean(extractLogoCandidateFromLuogo(item));
        if (hasLogo) {
            score += 15;
        }
        if (score > bestScore) {
            bestScore = score;
            best = item;
        }
    });

    return bestScore >= 35 ? best : null;
}

function getTeamLogoForPreview(teamName) {
    const name = String(teamName || '').trim();
    if (!name) {
        return TEAM_LOGO_FALLBACK_PATH;
    }
    const fromDb = findBestLogoEntryForTeam(name);
    const dbLogo = extractLogoCandidateFromLuogo(fromDb);
    if (dbLogo) {
        return dbLogo;
    }
    return `img/teams/${toTeamLogoSlug(name)}.png`;
}

function renderGmailPreviewList() {
    const { previewWrap, previewList, importBtn, selectAllBtn } = getGmailUiRefs();
    if (!previewWrap || !previewList || !importBtn || !selectAllBtn) {
        return;
    }

    if (!gmailPreviewItems.length) {
        previewWrap.hidden = true;
        previewList.innerHTML = '';
        importBtn.hidden = true;
        selectAllBtn.hidden = true;
        return;
    }

    previewWrap.hidden = false;
    const validCount = gmailPreviewItems.filter(item => item.valid).length;
    const selectedCount = gmailPreviewItems.filter(item => item.valid && item.selected).length;

    gmailSelectAllState = Boolean(validCount && selectedCount === validCount);

    previewList.innerHTML = gmailPreviewItems.map((item, index) => {
        const evento = item.evento || {};
        const [teamA, teamB] = splitMatchTeams(evento.squadre || '');
        const logoA = getTeamLogoForPreview(teamA);
        const logoB = getTeamLogoForPreview(teamB);
        const kmText = Number(evento.km || 0) > 0 ? `${Number(evento.km || 0)} km` : 'km n/d';
        const rimborsoText = `${Number(evento.rimborso || 0)} €`;
        const dateTime = [evento.data, evento.ora].filter(Boolean).join(' · ');
        const validityClass = item.valid ? 'is-valid' : 'is-invalid';
        const validityLabel = item.valid ? 'Estrazione ok' : 'Non riconosciuta (controlla manualmente)';
        const checked = item.selected ? 'checked' : '';
        const disabled = item.valid ? '' : 'disabled';
        return `
            <article class="gmail-preview-item ${validityClass}">
                <label class="gmail-preview-check">
                    <input type="checkbox" data-gmail-preview-index="${index}" ${checked} ${disabled}>
                    <span>${escapeHtml(validityLabel)}</span>
                </label>
                <div class="gmail-match-card">
                    <div class="gmail-match-teams">
                        <div class="gmail-team-chip">
                            <img src="${escapeHtml(logoA)}" alt="Logo ${escapeHtml(teamA || 'Squadra')}" loading="lazy" decoding="async" onerror="this.src='${TEAM_LOGO_FALLBACK_PATH}'">
                            <span>${escapeHtml(teamA || 'Squadra A')}</span>
                        </div>
                        <div class="gmail-vs">VS</div>
                        <div class="gmail-team-chip">
                            <img src="${escapeHtml(logoB)}" alt="Logo ${escapeHtml(teamB || 'Squadra')}" loading="lazy" decoding="async" onerror="this.src='${TEAM_LOGO_FALLBACK_PATH}'">
                            <span>${escapeHtml(teamB || 'Squadra B')}</span>
                        </div>
                    </div>
                    <div class="gmail-match-meta">${escapeHtml(dateTime || 'Data/Ora n/d')}</div>
                    <div class="gmail-match-badges">
                        <span class="gmail-badge">${escapeHtml(evento.categoria || 'Categoria n/d')}</span>
                        <span class="gmail-badge">${escapeHtml(kmText)}</span>
                        <span class="gmail-badge gmail-badge-money">${escapeHtml(rimborsoText)}</span>
                    </div>
                </div>
            </article>
        `;
    }).join('');

    importBtn.hidden = selectedCount <= 0;
    selectAllBtn.hidden = validCount <= 0;
    selectAllBtn.textContent = gmailSelectAllState ? 'Deseleziona tutti' : 'Seleziona tutti';
}

function clearGmailPreview() {
    gmailPreviewItems = [];
    gmailSelectAllState = false;
    renderGmailPreviewList();
}

function updateGmailUiState() {
    const { connectBtn, disconnectBtn, loadBtn, queryInput } = getGmailUiRefs();
    if (!connectBtn || !disconnectBtn || !loadBtn || !queryInput) {
        return;
    }

    const tokenReady = isGmailTokenValid();
    connectBtn.hidden = tokenReady;
    disconnectBtn.hidden = !gmailIntegrationPrefs.enabled;
    loadBtn.hidden = !tokenReady;
    queryInput.disabled = !gmailIntegrationPrefs.enabled;

    if (!gmailIntegrationPrefs.enabled) {
        setGmailStatus('Funzione disattivata. Usa il flusso principale copia/incolla.');
    } else if (!tokenReady) {
        const linked = gmailIntegrationPrefs.linkedEmail ? ` (${gmailIntegrationPrefs.linkedEmail})` : '';
        setGmailStatus(`Gmail collegata${linked}. Premi "Collega Gmail" per autorizzare lettura in questa sessione.`);
    } else {
        const linked = gmailIntegrationPrefs.linkedEmail ? ` come ${gmailIntegrationPrefs.linkedEmail}` : '';
        setGmailStatus(`Gmail autorizzata${linked}. Puoi cercare email rilevanti.`, true);
    }
}

async function fetchGmailProfileEmail() {
    if (!isGmailTokenValid()) {
        return '';
    }
    try {
        const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
            headers: {
                Authorization: `Bearer ${gmailAccessToken}`
            }
        });
        if (!response.ok) {
            return '';
        }
        const payload = await response.json();
        return String(payload?.emailAddress || '').trim();
    } catch {
        return '';
    }
}

function createGmailTokenRequester(options = {}) {
    return new Promise((resolve, reject) => {
        const silent = Boolean(options?.silent);
        const config = window.matchMapGoogleConfig || {};
        const clientId = String(config?.gmailClientId || '').trim();
        if (!clientId) {
            reject(new Error('Client ID Gmail non configurato in firebase-config.js'));
            return;
        }
        if (!window.google?.accounts?.oauth2) {
            reject(new Error('Google Identity Services non disponibile'));
            return;
        }
        if (!gmailTokenClient) {
            gmailTokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: GMAIL_READONLY_SCOPE,
                include_granted_scopes: true,
                callback: tokenResponse => {
                    if (!tokenResponse || tokenResponse.error) {
                        reject(new Error(String(tokenResponse?.error || 'Autorizzazione Gmail negata')));
                        return;
                    }
                    resolve(tokenResponse);
                }
            });
        } else {
            gmailTokenClient.callback = tokenResponse => {
                if (!tokenResponse || tokenResponse.error) {
                    reject(new Error(String(tokenResponse?.error || 'Autorizzazione Gmail negata')));
                    return;
                }
                resolve(tokenResponse);
            };
        }
        const loginHint = String(gmailIntegrationPrefs?.linkedEmail || '').trim();
        gmailTokenClient.requestAccessToken({
            prompt: silent ? 'none' : (gmailIntegrationPrefs.enabled ? '' : 'consent'),
            login_hint: loginHint || undefined
        });
    });
}

async function connectGmailIntegration() {
    try {
        setGmailStatus('Autorizzazione Gmail in corso...');
        const tokenResponse = await createGmailTokenRequester({ silent: false });
        gmailAccessToken = String(tokenResponse?.access_token || '').trim();
        const expiresIn = Number(tokenResponse?.expires_in || 0);
        gmailTokenExpiresAt = Date.now() + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 0);

        gmailIntegrationPrefs.enabled = true;
        const queryInput = document.getElementById('gmailQueryInput');
        gmailIntegrationPrefs.query = String(queryInput?.value || gmailIntegrationPrefs.query || GMAIL_DEFAULT_QUERY).trim() || GMAIL_DEFAULT_QUERY;
        const profileEmail = await fetchGmailProfileEmail();
        if (profileEmail) {
            gmailIntegrationPrefs.linkedEmail = profileEmail;
        }
        await persistGmailIntegrationPrefs();
        updateGmailUiState();
        showDashboardToast('Gmail collegata in sola lettura (beta).', 'ok');
    } catch (error) {
        setGmailStatus(`Connessione Gmail fallita: ${error.message}`);
        showDashboardToast('Connessione Gmail non riuscita.', 'err');
    }
}

async function disconnectGmailIntegration() {
    const previousToken = gmailAccessToken;
    gmailAccessToken = '';
    gmailTokenExpiresAt = 0;
    gmailPreviewItems = [];
    gmailSelectAllState = false;
    gmailIntegrationPrefs.enabled = false;
    gmailIntegrationPrefs.linkedEmail = '';
    await persistGmailIntegrationPrefs();
    if (window.google?.accounts?.oauth2 && previousToken) {
        try {
            window.google.accounts.oauth2.revoke(previousToken, () => {});
        } catch {
            // best effort
        }
    }
    clearGmailPreview();
    updateGmailUiState();
    showDashboardToast('Integrazione Gmail disattivata.', 'warn');
}

async function gmailApiFetchJson(url) {
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${gmailAccessToken}`
        }
    });

    if (response.status === 401 || response.status === 403) {
        gmailAccessToken = '';
        gmailTokenExpiresAt = 0;
        updateGmailUiState();
        throw new Error('Sessione Gmail scaduta. Ricollega Gmail.');
    }
    if (!response.ok) {
        throw new Error(`Gmail API errore ${response.status}`);
    }
    return response.json();
}

async function loadRelevantGmailMessages() {
    if (!gmailIntegrationPrefs.enabled) {
        setGmailStatus('Attiva prima la funzione Gmail beta.');
        return;
    }
    if (!isGmailTokenValid()) {
        setGmailStatus('Autorizzazione richiesta: premi Collega Gmail.');
        return;
    }

    const { queryInput } = getGmailUiRefs();
    const query = String(queryInput?.value || gmailIntegrationPrefs.query || GMAIL_DEFAULT_QUERY).trim() || GMAIL_DEFAULT_QUERY;
    gmailIntegrationPrefs.query = query;
    await persistGmailIntegrationPrefs();

    try {
        setGmailStatus('Ricerca email rilevanti in corso...');
        const fetchMessageRefs = async rawQuery => {
            const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=60&includeSpamTrash=false&q=${encodeURIComponent(rawQuery)}`;
            const listData = await gmailApiFetchJson(listUrl);
            return Array.isArray(listData?.messages) ? listData.messages : [];
        };

        let messages = await fetchMessageRefs(query);
        let usedFallback = false;
        if (!messages.length) {
            messages = await fetchMessageRefs(GMAIL_FALLBACK_QUERY);
            usedFallback = true;
        }
        if (!messages.length) {
            clearGmailPreview();
            setGmailStatus('Nessuna email rilevante trovata con questo filtro.');
            return;
        }

        const fullMessages = await Promise.all(messages.map(async msg => {
            const id = String(msg?.id || '').trim();
            if (!id) {
                return null;
            }
            try {
                const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`;
                return await gmailApiFetchJson(detailUrl);
            } catch {
                return null;
            }
        }));

        const parsedItems = fullMessages
            .filter(Boolean)
            .map(buildPreviewEventoFromMessage)
            .filter(item => item?.id);

        let likelyItems = parsedItems.filter(isLikelyDesignazioneEmail);

        // Se la query utente era troppo stretta, prova un secondo tentativo automatico
        // con query fallback prima di mostrare lista vuota/poco utile.
        if (!likelyItems.length && !usedFallback) {
            const fallbackRefs = await fetchMessageRefs(GMAIL_FALLBACK_QUERY);
            if (fallbackRefs.length) {
                const fallbackFull = await Promise.all(fallbackRefs.map(async msg => {
                    const id = String(msg?.id || '').trim();
                    if (!id) return null;
                    try {
                        const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`;
                        return await gmailApiFetchJson(detailUrl);
                    } catch {
                        return null;
                    }
                }));
                const fallbackParsed = fallbackFull
                    .filter(Boolean)
                    .map(buildPreviewEventoFromMessage)
                    .filter(item => item?.id);
                const fallbackLikely = fallbackParsed.filter(isLikelyDesignazioneEmail);
                if (fallbackLikely.length) {
                    likelyItems = fallbackLikely;
                    usedFallback = true;
                }
            }
        }

        // Mostra solo email realmente pertinenti a designazioni.
        // Le altre devono restare invisibili in preview.
        gmailPreviewItems = likelyItems;

        if (!gmailPreviewItems.length) {
            clearGmailPreview();
            setGmailStatus('Nessuna email di designazione trovata con questo filtro.');
            return;
        }

        renderGmailPreviewList();
        const validCount = gmailPreviewItems.filter(item => item.valid).length;
        const sourceLabel = usedFallback ? ' (query fallback automatica)' : '';
        setGmailStatus(`Email lette: ${gmailPreviewItems.length}. Partite riconosciute: ${validCount}.${sourceLabel}`, true);
    } catch (error) {
        setGmailStatus(`Import Gmail fallito: ${error.message}`);
    }
}

function toggleSelectAllGmailEvents() {
    const validItems = gmailPreviewItems.filter(item => item.valid);
    if (!validItems.length) {
        return;
    }
    gmailSelectAllState = !gmailSelectAllState;
    gmailPreviewItems = gmailPreviewItems.map(item => {
        if (!item.valid) {
            return item;
        }
        return {
            ...item,
            selected: gmailSelectAllState
        };
    });
    renderGmailPreviewList();
}

async function importSelectedGmailEvents() {
    const selectedValid = gmailPreviewItems.filter(item => item.valid && item.selected);
    if (!selectedValid.length) {
        setGmailStatus('Seleziona almeno una partita valida da importare.');
        return;
    }

    const existingFingerprints = new Set(dashboardEvents.map(buildEventFingerprint));
    let imported = 0;
    let duplicates = 0;

    for (const item of selectedValid) {
        const evento = ensureEventoShape(item.evento || {}, 0);
        const fingerprint = buildEventFingerprint(evento);
        if (!fingerprint || existingFingerprints.has(fingerprint)) {
            duplicates += 1;
            continue;
        }
        existingFingerprints.add(fingerprint);
        dashboardEvents.push(normalizeDashboardEvent({
            data: evento.data,
            ora: evento.ora,
            luogo: evento.luogo || '',
            impianto: evento.impianto || '',
            indirizzo: evento.indirizzo || '',
            designazioneS4yRaw: evento.designazioneS4yRaw || '',
            locationText: evento.locationText || '',
            squadre: evento.squadre || '',
            categoria: evento.categoria || '',
            garaNumero: evento.garaNumero || '',
            girone: evento.girone || '',
            arbitro: evento.arbitro || '',
            rimborso: Number(evento.rimborso || 0),
            km: Number(evento.km || 0)
        }));
        imported += 1;
    }

    if (!imported) {
        setGmailStatus(`Nessun nuovo evento importato. Duplicati: ${duplicates}.`);
        return;
    }

    renderDashboardEvents();
    await persistDashboardEvents();
    setGmailStatus(`Import completato. Nuovi eventi: ${imported}. Duplicati saltati: ${duplicates}.`, true);
    showDashboardToast(`Import Gmail completato: ${imported} eventi.`, 'ok');
}

function handleGmailPreviewSelectionChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
        return;
    }
    const index = Number(target.dataset.gmailPreviewIndex);
    if (!Number.isFinite(index) || index < 0 || index >= gmailPreviewItems.length) {
        return;
    }
    gmailPreviewItems[index].selected = Boolean(target.checked);
    renderGmailPreviewList();
}

function initGmailIntegration() {
    const { previewList, queryInput } = getGmailUiRefs();
    if (previewList) {
        previewList.addEventListener('change', handleGmailPreviewSelectionChange);
    }
    if (queryInput) {
        queryInput.value = GMAIL_DEFAULT_QUERY;
        queryInput.addEventListener('change', () => {
            gmailIntegrationPrefs.query = String(queryInput.value || GMAIL_DEFAULT_QUERY).trim() || GMAIL_DEFAULT_QUERY;
            persistGmailIntegrationPrefs();
        });
    }
    loadGmailIntegrationPrefsForCurrentUser();
}

function parseDesignazione(testo, options = {}) {
    const extractFieldByLabel = (labelRegexSource, nextLabelSources = []) => {
        const nextBlock = nextLabelSources.length
            ? `(?=\\b(?:${nextLabelSources.join('|')})\\s*:)`
            : '(?=$)';
        const pattern = new RegExp(`\\b(?:${labelRegexSource})\\s*:\\s*([\\s\\S]*?)${nextBlock}`, 'i');
        const match = String(testo || '').match(pattern);
        return String(match?.[1] || '')
            .replace(/\s+/g, ' ')
            .trim();
    };

    const fieldOrder = [
        'Attivit[àa]',
        'Comitato\\/Delegazione',
        'Categoria',
        'Girone',
        'Giornata',
        'Numero\\s+Gara',
        'Gara',
        'Data',
        'Ora',
        'Campo',
        'Indirizzo',
        'Localit[àa]',
        'Provincia',
        'Distanza\\s*\\(\\s*km\\s*\\)',
        'Rimborso\\s+Totale\\s*\\(\\s*€\\s*\\)'
    ];

    const dataLabelRegex = /\bdata(?:\s+gara)?\s*[:\-]?\s*(?:[A-ZÀ-Úa-zà-ú]+\s+)?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i;
    const dataRegex = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i;
    const oraRegex = /\bora\s*[:\-]?\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/i;
    const oraFallbackRegex = /\b(?:ore\s*)?([01]\d|2[0-3])[:.]([0-5]\d)\b/i;
    const luogoRegex = /a\s+(.+?)\s+sull['’]impianto/i;
    const impiantoRegex = /sull['’]impianto\s+(.+?)\s+sito in/i;
    const indirizzoRegex = /sito in\s+([^\r\n]+)/i;
    const squadreRegex = /tra\s*[:\-]?\s*([^\r\n]+)/i;
    const squadreBlockRegex = /\btra\b\s*([\s\S]{0,220}?)\b(?:La\s+partita\s+si\s+disputer[aà]|Rimborso|Data|Ora|Campo|Indirizzo|$)/i;
    const squadreVsRegex = /\b([A-Z0-9][A-Z0-9\s'.-]{2,}?)\s*(?:-|–|—|vs\.?|v\.?s\.?|contro)\s*([A-Z0-9][A-Z0-9\s'.-]{2,})\b/i;
    const categoriaRegex = /\bcategoria\s*:\s*([^\r\n]+)/i;
    const categoriaInlineRegex = /\bgara\s*n\.?\s*\d+\s+di\s+(.+?)\s+girone\b/i;
    const garaNumeroRegex = /\b(?:numero\s+gara|gara\s*n\.?)\s*[:\-]?\s*(\d+)/i;
    const gironeRegex = /girone\s+([A-Z0-9]+)/i;
    const arbitroRegex = /^([A-Z\s'`]+),\s*sei designato/i;
    const rimborsoRegex = /\brimborso\s+totale\s*\(\s*€\s*\)\s*:\s*(\d+(?:[\.,]\d{1,2})?)/i;
    const rimborsoInlineRegex = /\brimborso\s*:\s*(\d+(?:[\.,]\d{1,2})?)\s*€/i;
    const kmRegex = /\bdistanza\s*\(\s*km\s*\)\s*:\s*(\d+)/i;
    const kmInlineRegex = /\(\s*(\d+)\s*km\s*\)/i;
    const designazioneS4yRegex = /a\s+(.+?)\s+sull['’]impianto\s+(.+?)\s+sito in\s+([^\r\n]+)/i;

    const luogo = testo.match(luogoRegex)?.[1]?.trim() || '';
    const impianto = testo.match(impiantoRegex)?.[1]?.trim() || '';
    const indirizzo = testo.match(indirizzoRegex)?.[1]?.trim() || '';
    const designazioneS4yMatch = testo.match(designazioneS4yRegex);
    const designazioneS4yRaw = designazioneS4yMatch
        ? `a ${designazioneS4yMatch[1].trim()} sull'impianto ${designazioneS4yMatch[2].trim()} sito in ${designazioneS4yMatch[3].trim()}`
        : '';
    const locationText = [luogo, impianto, indirizzo].filter(Boolean).join(', ');

    const oraMainMatch = testo.match(oraRegex);
    const oraMain = oraMainMatch ? `${String(oraMainMatch[1]).padStart(2, '0')}:${oraMainMatch[2]}` : '';
    const oraFallback = testo.match(oraFallbackRegex);
    const oraValue = oraMain || (oraFallback ? `${oraFallback[1]}:${oraFallback[2]}` : '');

    const garaFromTable = extractFieldByLabel('Gara', fieldOrder.filter(x => x !== 'Gara'));

    const extractGaraSegment = sourceText => {
        const text = String(sourceText || '');
        if (!text) return '';

        const labelRegex = /\bGara\s*:\s*/gi;
        let match;
        let lastStart = -1;
        while ((match = labelRegex.exec(text)) !== null) {
            const before = text.slice(Math.max(0, match.index - 24), match.index);
            // evita il falso positivo su "Numero Gara :"
            if (/Numero\s*$/i.test(before)) {
                continue;
            }
            lastStart = match.index + match[0].length;
        }
        if (lastStart < 0) return '';

        const tail = text.slice(lastStart);
        const stop = tail.match(/\b(?:Data|Ora|Campo|Indirizzo|Localit[àa]|Provincia|Distanza\s*\(\s*km\s*\)|Rimborso\s+Totale\s*\(\s*€\s*\)|Accedi\s+a\s+Sinfonia4You|EMAIL\s+GENERATA\s+AUTOMATICAMENTE|Attivit[àa]|Comitato\/Delegazione|Categoria|Girone|Giornata|Numero\s+Gara)\s*:/i);
        const segment = stop ? tail.slice(0, stop.index) : tail;
        return String(segment).replace(/\s+/g, ' ').trim();
    };

    const garaLineRaw = extractGaraSegment(testo);
    const garaLineClean = String(garaLineRaw)
        .replace(/\b(?:Data|Ora|Campo|Indirizzo|Localit[àa]|Provincia|Distanza\s*\(\s*km\s*\)|Rimborso\s+Totale\s*\(\s*€\s*\)|Accedi\s+a\s+Sinfonia4You|EMAIL\s+GENERATA\s+AUTOMATICAMENTE)\b[\s\S]*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    const normalizeTeamsPair = raw => {
        const cleaned = String(raw || '').replace(/\s+/g, ' ').trim();
        if (!cleaned) return '';
        const parts = cleaned
            .split(/\s*(?:-|–|—|vs\.?|v\.?s\.?|\/|\|)\s*/i)
            .map(x => x.trim())
            .filter(Boolean);
        if (parts.length < 2) return '';
        const teamA = parts[0];
        const teamB = parts[1];
        if (!teamA || !teamB) return '';
        if (/:/.test(teamA) || /:/.test(teamB)) return '';
        return `${teamA} - ${teamB}`;
    };

    const squadreFromGaraDirect = (() => {
        const garaSegment = extractGaraSegment(testo);
        const m = String(garaSegment || '').match(/^\s*(.*?)\s*(?:-|–|—|vs\.?|v\.?s\.?)\s*(.*?)\s*$/i);
        if (!m) return '';
        const a = String(m[1] || '').replace(/\s+/g, ' ').trim();
        const b = String(m[2] || '').replace(/\s+/g, ' ').trim();
        if (!a || !b) return '';
        if (/:/.test(a) || /:/.test(b)) return '';
        return `${a} - ${b}`;
    })();

    const squadreFromTraBlock = (() => {
        const block = String(testo.match(squadreBlockRegex)?.[1] || '')
            .replace(/\s+/g, ' ')
            .trim();
        return normalizeTeamsPair(block);
    })();

    const squadreMain = squadreFromGaraDirect
        || normalizeTeamsPair(garaLineClean)
        || normalizeTeamsPair(garaFromTable)
        || squadreFromTraBlock
        || normalizeTeamsPair(testo.match(squadreRegex)?.[1]?.trim() || '')
        || '';
    const squadreVs = testo.match(squadreVsRegex);
    let squadreValue = squadreMain || (squadreVs ? `${squadreVs[1].trim()} - ${squadreVs[2].trim()}` : '');

    // pulizia anti-rumore: evita subject/footer Gmail tipo
    // "Designazione ... AIA - Sinfonia4You Notifica ..."
    squadreValue = String(squadreValue || '')
        .replace(/\bdesignazione\b[\s\S]*$/i, '')
        .replace(/\bnotifica\s+di\s+designazione\b[\s\S]*$/i, '')
        .replace(/\bsinfonia\s*4\s*you\b[\s\S]*$/i, '')
        .replace(/\baia\b\s*-\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    // fallback forte: se resta vuoto o sporco, riprova dalla sola riga Gara:
    if (!squadreValue || /sinfonia|notifica|associato|designazione/i.test(squadreValue)) {
        const garaStrict = String(testo || '').match(/\bGara\s*:\s*([^\r\n]+)/i)?.[1] || '';
        const garaStrictClean = String(garaStrict)
            .replace(/\s+/g, ' ')
            .trim();
        if (garaStrictClean) {
            squadreValue = garaStrictClean;
        }
    }

    // hard filter: tieni SOLO formato partita "TEAM A - TEAM B"
    // se ci sono label (":") o parole tipiche del template, annulla e ricalcola da Gara:
    if (/[:]|attivit|categoria|girone|giornata|numero\s+gara|data|ora|campo|indirizzo|localit|provincia|distanza|rimborso/i.test(squadreValue)) {
        const garaOnly = String(testo || '').match(/\bGara\s*:\s*([^\r\n]+)/i)?.[1] || '';
        squadreValue = String(garaOnly)
            .replace(/\b(?:Data|Ora|Campo|Indirizzo|Localit[àa]|Provincia|Distanza\s*\(\s*km\s*\)|Rimborso\s+Totale\s*\(\s*€\s*\)|Accedi\s+a\s+Sinfonia4You|EMAIL\s+GENERATA\s+AUTOMATICAMENTE)\b[\s\S]*$/i, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // ultimo guardrail: preferisci formato "SQUADRA A - SQUADRA B"
    // ma non scartare completamente designazioni manuali valide
    const strictPair = normalizeTeamsPair(squadreValue);
    if (strictPair) {
        squadreValue = strictPair;
    } else {
        const garaOnlyRaw = String(testo || '').match(/\bGara\s*:\s*([^\r\n]+)/i)?.[1] || '';
        const garaOnlyClean = String(garaOnlyRaw)
            .replace(/\b(?:Data|Ora|Campo|Indirizzo|Localit[àa]|Provincia|Distanza\s*\(\s*km\s*\)|Rimborso\s+Totale\s*\(\s*€\s*\)|Accedi\s+a\s+Sinfonia4You|EMAIL\s+GENERATA\s+AUTOMATICAMENTE)\b[\s\S]*$/i, '')
            .replace(/\s+/g, ' ')
            .trim();
        const garaPair = normalizeTeamsPair(garaOnlyClean);
        if (garaPair) {
            squadreValue = garaPair;
        } else if (squadreFromTraBlock) {
            squadreValue = squadreFromTraBlock;
        } else if (garaOnlyClean && !/[:]|attivit|categoria|girone|giornata|numero\s+gara|data|ora|campo|indirizzo|localit|provincia|distanza|rimborso/i.test(garaOnlyClean)) {
            squadreValue = garaOnlyClean;
        } else {
            squadreValue = '';
        }
    }

    const rimborsoRaw = testo.match(rimborsoRegex)?.[1] || testo.match(rimborsoInlineRegex)?.[1] || '0';
    const rimborsoValue = Number(String(rimborsoRaw).replace(',', '.')) || 0;

    const emailYearFromHeader = (() => {
        const rawHeader = String(options?.emailDateHeader || '').trim();
        const fromHeaderMatch = rawHeader.match(/\b(20\d{2})\b/);
        if (fromHeaderMatch) {
            return Number(fromHeaderMatch[1]);
        }
        const ts = Number(options?.emailInternalTimestamp || 0);
        if (Number.isFinite(ts) && ts > 0) {
            return new Date(ts).getFullYear();
        }
        return new Date().getFullYear();
    })();

    const normalizeMatchDate = rawDate => {
        const value = String(rawDate || '').trim();
        if (!value) {
            return '';
        }
        const parts = value.split('/').map(x => x.trim());
        if (parts.length < 2) {
            return '';
        }
        const dd = String(parts[0]).padStart(2, '0');
        const mm = String(parts[1]).padStart(2, '0');
        let yy = String(parts[2] || '').trim();
        if (!yy) {
            yy = String(emailYearFromHeader);
        } else if (yy.length === 2) {
            yy = `20${yy}`;
        }
        return `${dd}/${mm}/${yy}`;
    };

    const rawDateValue = testo.match(dataLabelRegex)?.[1]?.trim() || testo.match(dataRegex)?.[1]?.trim() || '';
    const dataValue = normalizeMatchDate(rawDateValue);

    const categoriaFromTable = extractFieldByLabel('Categoria', fieldOrder.filter(x => x !== 'Categoria'));

    return {
        data: dataValue,
        ora: oraValue,
        luogo,
        impianto,
        indirizzo,
        designazioneS4yRaw,
        locationText,
        squadre: squadreValue,
        categoria: categoriaFromTable || testo.match(categoriaRegex)?.[1]?.trim() || testo.match(categoriaInlineRegex)?.[1]?.trim() || '',
        garaNumero: testo.match(garaNumeroRegex)?.[1]?.trim() || '',
        girone: testo.match(gironeRegex)?.[1]?.trim() || '',
        arbitro: testo.match(arbitroRegex)?.[1]?.trim() || '',
        rimborso: rimborsoValue,
        km: Number(testo.match(kmRegex)?.[1] || testo.match(kmInlineRegex)?.[1] || 0)
    };
}

function buildEventFingerprint(evento) {
    const keyParts = [
        evento.garaNumero || '',
        evento.data || '',
        evento.ora || '',
        evento.squadre || '',
        evento.categoria || '',
        Number(evento.rimborso || 0) || 0
    ];
    return normalizeText(keyParts.join('|'));
}

function dedupeDashboardEvents(events) {
    const list = Array.isArray(events) ? events : [];
    const seen = new Set();
    const out = [];
    list.forEach(raw => {
        const evento = normalizeDashboardEvent(raw);
        const fp = buildEventFingerprint(evento);
        if (!fp || seen.has(fp)) {
            return;
        }
        seen.add(fp);
        out.push(evento);
    });
    return out;
}

function buildAutoFieldSuggestionKey(evento) {
    const keyParts = [
        evento.squadre || '',
        evento.luogo || '',
        evento.impianto || '',
        evento.indirizzo || '',
        evento.data || '',
        evento.ora || ''
    ];
    return normalizeText(keyParts.join('|'));
}

function buildAutoFieldUpdateSuggestionKey(evento, luogo) {
    const keyParts = [
        'update',
        luogo?.nome || '',
        luogo?.mapsUrl || '',
        evento?.indirizzo || '',
        evento?.locationText || ''
    ];
    return normalizeText(keyParts.join('|'));
}

function buildDesignazioneS4y(evento) {
    const explicit = String(evento?.designazioneS4yRaw || '').trim();
    if (explicit) {
        return explicit;
    }
    const base = [
        String(evento?.luogo || '').trim(),
        String(evento?.impianto || '').trim(),
        String(evento?.indirizzo || '').trim()
    ];
    if (!base.some(Boolean)) {
        return '';
    }
    return `a ${base[0]} sull'impianto ${base[1]} sito in ${base[2]}`.replace(/\s+/g, ' ').trim();
}

function getLuogoAliases(entry) {
    const raw = entry?.aliases;
    if (Array.isArray(raw)) {
        return raw.map(x => String(x || '').trim()).filter(Boolean);
    }
    if (typeof raw === 'string') {
        return raw.split(/[\n;,]+/).map(x => x.trim()).filter(Boolean);
    }
    return [];
}

function getLuogoDesignazioneKeys(entry) {
    const raw = entry?.designazioneS4y;
    if (Array.isArray(raw)) {
        return raw.map(x => normalizeText(x)).filter(Boolean);
    }
    if (typeof raw === 'string') {
        return raw.split(/[\n;,]+/).map(x => normalizeText(x)).filter(Boolean);
    }
    return [];
}

function luogoHasDesignazioneKey(entry, rawKey) {
    const key = normalizeText(rawKey);
    if (!key) {
        return false;
    }
    return getLuogoDesignazioneKeys(entry).includes(key);
}

function luogoContainsAddressHint(entry, rawAddress) {
    const target = normalizeText(rawAddress);
    if (!target) {
        return true;
    }
    const candidates = [
        entry?.indirizzo,
        entry?.mapsUrl,
        ...getLuogoAliases(entry)
    ]
        .map(normalizeText)
        .filter(Boolean);

    return candidates.some(value => {
        if (!value) {
            return false;
        }
        return value === target || value.includes(target) || target.includes(value);
    });
}

function findExistingLuogoForEvento(evento) {
    const strictMatch = findLuogoDbMatch(evento?.locationText || '');
    if (strictMatch) {
        return strictMatch;
    }

    const designazioneKey = normalizeText(buildDesignazioneS4y(evento));
    const impiantoNorm = normalizeText(evento?.impianto || '');
    const luogoNorm = normalizeText(evento?.luogo || '');
    const indirizzoNorm = normalizeText(evento?.indirizzo || '');
    const eventTokens = new Set(
        [impiantoNorm, luogoNorm, indirizzoNorm]
            .join(' ')
            .split(' ')
            .filter(token => token.length >= 3)
    );

    let best = null;
    let bestScore = 0;
    luoghiDb.forEach(entry => {
        const nome = normalizeText(entry?.nome);
        const indirizzo = normalizeText(entry?.indirizzo);
        const comune = normalizeText(entry?.comune);
        const aliases = getLuogoAliases(entry).map(normalizeText).filter(Boolean);
        const designKeys = getLuogoDesignazioneKeys(entry);
        const fields = [nome, indirizzo, comune, ...aliases].filter(Boolean);
        if (!fields.length) {
            return;
        }

        const haystack = fields.join(' ');
        let score = 0;

        if (designazioneKey) {
            if (designKeys.includes(designazioneKey)) {
                score += 420;
            } else if (designKeys.some(value => value && (value.includes(designazioneKey) || designazioneKey.includes(value)))) {
                score += 220;
            }
        }

        if (impiantoNorm) {
            if (haystack.includes(impiantoNorm)) {
                score += 180;
            } else {
                fields.forEach(value => {
                    if (value.length >= 5 && (value.includes(impiantoNorm) || impiantoNorm.includes(value))) {
                        score += 90;
                    }
                });
            }
        }

        if (luogoNorm) {
            if (haystack.includes(luogoNorm)) {
                score += 120;
            } else {
                fields.forEach(value => {
                    if (value.length >= 5 && (value.includes(luogoNorm) || luogoNorm.includes(value))) {
                        score += 60;
                    }
                });
            }
        }

        if (indirizzoNorm && haystack.includes(indirizzoNorm)) {
            score += 70;
        }

        if (eventTokens.size) {
            const candidateTokens = new Set(haystack.split(' ').filter(token => token.length >= 3));
            let overlap = 0;
            candidateTokens.forEach(token => {
                if (eventTokens.has(token)) {
                    overlap += 1;
                }
            });
            score += overlap * 8;
        }

        if (score > bestScore) {
            bestScore = score;
            best = entry;
        }
    });

    return bestScore >= 55 ? best : null;
}

function getPrimaryTeamName(squadreText) {
    const teams = String(squadreText || '')
        .split(/\s*-\s*/)
        .map(item => item.trim())
        .filter(Boolean);
    return teams[0] || String(squadreText || '').trim() || 'Squadra non trovata';
}

function readAutoSuggestionsCache() {
    try {
        const raw = JSON.parse(localStorage.getItem(AUTO_FIELD_SUGGESTIONS_CACHE_KEY) || '[]');
        return new Set(Array.isArray(raw) ? raw : []);
    } catch {
        return new Set();
    }
}

function writeAutoSuggestionsCache(cacheSet) {
    localStorage.setItem(AUTO_FIELD_SUGGESTIONS_CACHE_KEY, JSON.stringify([...cacheSet]));
}

async function hasPendingSuggestionWithSameKey(db, suggestionKey) {
    try {
        const snap = await db.ref('suggestions').once('value');
        if (!snap.exists()) {
            return false;
        }
        const items = Object.values(snap.val() || {});
        return items.some(item => {
            const status = String(item?.status || '').trim().toLowerCase();
            const existingKey = String(item?.sourceKey || '').trim();
            return status === 'pending' && existingKey === suggestionKey;
        });
    } catch {
        return false;
    }
}

async function autoSuggestFieldFromDesignazione(evento) {
    const fb = window.matchMapFirebase;
    if (!fb?.ready || !fb.db) {
        return;
    }

    if (!evento?.squadre || !evento?.locationText) {
        return;
    }

    // Se la cache locale e vuota prova a ricaricare i luoghi prima di classificare il campo.
    if (!luoghiDb.length) {
        await loadLuoghiDb();
    }

    const designazioneS4y = buildDesignazioneS4y(evento);

    // Se il luogo e gia riconosciuto nel DB campi prova a proporre un aggiornamento indirizzo.
    const existingMatch = findExistingLuogoForEvento(evento);
    if (existingMatch) {
        const candidateAddress = String(evento?.indirizzo || '').trim();
        const shouldUpdateAddress = Boolean(candidateAddress && !luogoContainsAddressHint(existingMatch, candidateAddress));
        const shouldUpdateDesignazione = Boolean(designazioneS4y && !luogoHasDesignazioneKey(existingMatch, designazioneS4y));
        if (!shouldUpdateAddress && !shouldUpdateDesignazione) {
            return;
        }

        const updateSuggestionKey = buildAutoFieldUpdateSuggestionKey(evento, existingMatch);
        if (!updateSuggestionKey) {
            return;
        }

        const cache = readAutoSuggestionsCache();
        if (cache.has(updateSuggestionKey)) {
            return;
        }

        const alreadyPending = await hasPendingSuggestionWithSameKey(fb.db, updateSuggestionKey);
        if (alreadyPending) {
            cache.add(updateSuggestionKey);
            writeAutoSuggestionsCache(cache);
            return;
        }

        const mapsCandidateUrl = existingMatch.mapsUrl || getMapsUrl(evento);
        const coords = extractCoordinatesFromMapsUrl(mapsCandidateUrl);
        const hasCoords = Boolean(coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng));
        const teamName = getPrimaryTeamName(evento.squadre);
        const user = getCurrentDashboardUser();
        if (!user) {
            return;
        }

        const payload = {
            type: 'campo_update',
            team: teamName,
            title: `Aggiornamento campo da designazione: ${existingMatch.nome || teamName}`,
            text: `Proposta automatica per campo esistente.${shouldUpdateAddress ? ` Nuovo indirizzo estratto: ${candidateAddress}.` : ''}${shouldUpdateDesignazione ? ` Nuova designazione s4y: ${designazioneS4y}.` : ''} Gara n.${evento.garaNumero || 'N/D'} del ${evento.data || 'N/D'} ore ${evento.ora || 'N/D'}.`,
            mapsUrl: mapsCandidateUrl,
            proofUrl: `https://www.google.com/search?q=${encodeURIComponent(`${existingMatch.nome || teamName} ${candidateAddress || designazioneS4y || evento.locationText}`)}`,
            status: 'pending',
            source: 'auto_designazione_update',
            sourceKey: updateSuggestionKey,
            target: {
                nome: existingMatch.nome || '',
                indirizzo: existingMatch.indirizzo || '',
                mapsUrl: existingMatch.mapsUrl || ''
            },
            extracted: {
                garaNumero: evento.garaNumero || '',
                categoria: evento.categoria || '',
                squadre: evento.squadre || '',
                luogo: evento.luogo || '',
                impianto: evento.impianto || '',
                indirizzo: candidateAddress,
                designazioneS4y,
                locationText: evento.locationText || ''
            },
            checks: {
                hasProofUrl: true,
                hasMapsCoords: hasCoords
            },
            coordinates: hasCoords ? coords : null,
            createdAt: Date.now(),
            createdByUid: user?.uid || null,
            createdByEmail: user?.email || null
        };

        try {
            await fb.db.ref('suggestions').push(payload);
            cache.add(updateSuggestionKey);
            writeAutoSuggestionsCache(cache);
        } catch {
            // silenzioso
        }
        return;
    }

    const suggestionKey = buildAutoFieldSuggestionKey(evento);
    if (!suggestionKey) {
        return;
    }

    const cache = readAutoSuggestionsCache();
    if (cache.has(suggestionKey)) {
        return;
    }

    const alreadyPending = await hasPendingSuggestionWithSameKey(fb.db, suggestionKey);
    if (alreadyPending) {
        cache.add(suggestionKey);
        writeAutoSuggestionsCache(cache);
        return;
    }

    const teamName = getPrimaryTeamName(evento.squadre);
    const mapsCandidateUrl = getMapsUrl(evento);
    const proofUrl = `https://www.google.com/search?q=${encodeURIComponent(`${teamName} ${evento.indirizzo || evento.locationText}`)}`;
    const coords = extractCoordinatesFromMapsUrl(mapsCandidateUrl);
    const hasCoords = Boolean(coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng));
    const user = getCurrentDashboardUser();
    if (!user) {
        showDashboardToast('Segnalazione automatica bloccata: registrati o effettua il login.', 'err');
        return;
    }

    const payload = {
        type: 'campo',
        team: teamName,
        title: `Nuovo campo da designazione: ${teamName}`,
        text: `Proposta automatica da designazione. Campo: ${evento.impianto || evento.luogo || 'N/D'}. Indirizzo: ${evento.indirizzo || evento.locationText}. Gara n.${evento.garaNumero || 'N/D'} del ${evento.data || 'N/D'} ore ${evento.ora || 'N/D'}.`,
        mapsUrl: mapsCandidateUrl,
        proofUrl,
        status: 'pending',
        source: 'auto_designazione',
        sourceKey: suggestionKey,
        extracted: {
            garaNumero: evento.garaNumero || '',
            categoria: evento.categoria || '',
            squadre: evento.squadre || '',
            luogo: evento.luogo || '',
            impianto: evento.impianto || '',
            indirizzo: evento.indirizzo || '',
            designazioneS4y,
            locationText: evento.locationText || ''
        },
        checks: {
            hasProofUrl: true,
            hasMapsCoords: hasCoords
        },
        coordinates: hasCoords ? coords : null,
        createdAt: Date.now(),
        createdByUid: user?.uid || null,
        createdByEmail: user?.email || null
    };

    try {
        await fb.db.ref('suggestions').push(payload);
        cache.add(suggestionKey);
        writeAutoSuggestionsCache(cache);
        showDashboardToast('Nuovo campo non presente: inviato automaticamente in revisione.', 'warn');
    } catch {
        // silenzioso: non blocca l'inserimento evento dashboard
    }
}

function subtractOneHour(timeStr) {
    const [h, m] = (timeStr || '00:00').split(':').map(Number);
    const totalMinutes = (h * 60 + m - 60 + 24 * 60) % (24 * 60);
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    const mm = String(totalMinutes % 60).padStart(2, '0');
    return `${hh}:${mm}`;
}

function buildCalendarDescription(evento) {
    const garaNum = evento.garaNumero || 'N/D';
    const categoria = evento.categoria || 'Categoria non trovata';
    const gironePart = evento.girone ? ` girone ${evento.girone}` : '';
    const arbitro = evento.arbitro || 'N/D';
    const rimborso = `${evento.rimborso || 0} €`;
    const kmPart = evento.km ? ` (${evento.km} Km)` : '';
    const oraUfficiale = evento.ora || 'N/D';
    const arrivoPrevisto = evento.ora ? subtractOneHour(evento.ora) : 'N/D';

    return `Gara n.${garaNum} di ${categoria}${gironePart}. Arbitro: ${arbitro}. Rimborso: ${rimborso}${kmPart}. Orario ufficiale gara: ${oraUfficiale}. Arrivo previsto: ${arrivoPrevisto}.`;
}

function getDashboardAuthState() {
    const statusEl = document.getElementById('dashboardAuthStatus');
    const publisherLinkEl = document.getElementById('publisherAdminLink');
    const fb = window.matchMapFirebase;
    return { fb, statusEl, publisherLinkEl };
}

function setDashboardAuthStatus(text, isOk = false) {
    const { statusEl } = getDashboardAuthState();
    if (!statusEl) {
        return;
    }
    statusEl.textContent = text;
    statusEl.style.color = isOk ? '#6ee7b7' : '#9fb2dd';
}

function readDashboardAuthSnapshot() {
    try {
        const raw = JSON.parse(localStorage.getItem(DASHBOARD_AUTH_SNAPSHOT_KEY) || 'null');
        if (!raw || typeof raw !== 'object') {
            return null;
        }
        const savedAt = Number(raw.savedAt || 0);
        const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
        if (!Number.isFinite(savedAt) || savedAt <= 0 || Date.now() - savedAt > maxAgeMs) {
            return null;
        }
        return {
            isLogged: Boolean(raw.isLogged),
            nickname: String(raw.nickname || '').trim(),
            avatarUrl: String(raw.avatarUrl || '').trim(),
            isAdmin: Boolean(raw.isAdmin),
            savedAt
        };
    } catch {
        return null;
    }
}

function writeDashboardAuthSnapshot(payload) {
    try {
        localStorage.setItem(DASHBOARD_AUTH_SNAPSHOT_KEY, JSON.stringify({
            isLogged: Boolean(payload?.isLogged),
            nickname: String(payload?.nickname || '').trim(),
            avatarUrl: String(payload?.avatarUrl || '').trim(),
            isAdmin: Boolean(payload?.isAdmin),
            savedAt: Date.now()
        }));
    } catch {
        // ignora errori localStorage
    }
}

function clearDashboardAuthSnapshot() {
    try {
        localStorage.removeItem(DASHBOARD_AUTH_SNAPSHOT_KEY);
    } catch {
        // ignora errori localStorage
    }
}

function applyDashboardAuthSnapshot(snapshot) {
    if (!snapshot || !snapshot.isLogged) {
        return false;
    }
    const pseudoUser = { displayName: snapshot.nickname || 'Utente', email: '' };
    setDashboardAuthButtonsVisibility({ uid: '__snapshot__' });
    setDashboardAuthAvatar(snapshot.avatarUrl || '');
    setDashboardProfileSummary(pseudoUser, {
        nickname: snapshot.nickname || 'Utente',
        avatarUrl: snapshot.avatarUrl || ''
    });
    setDashboardAuthStatus(`Connesso come ${snapshot.nickname || 'Utente'}`, true);
    setPublisherAdminLinkVisible(Boolean(snapshot.isAdmin));
    return true;
}

function isDashboardAdmin(user) {
    if (!user) {
        return false;
    }
    const email = String(user.email || '').trim().toLowerCase();
    return DASHBOARD_ADMIN_EMAILS.has(email);
}

function setPublisherAdminLinkVisible(isVisible) {
    const { publisherLinkEl } = getDashboardAuthState();
    if (!publisherLinkEl) {
        return;
    }
    publisherLinkEl.hidden = !isVisible;
    publisherLinkEl.style.display = isVisible ? 'inline-flex' : 'none';
    if (!isVisible) {
        publisherLinkEl.removeAttribute('href');
    } else {
        publisherLinkEl.setAttribute('href', 'publisher.html');
    }
}

function setDashboardAuthAvatar(avatarUrl) {
    const avatarImg = document.getElementById('authAvatarImg');
    const fallbackIcon = document.getElementById('authAvatarFallback');
    if (!avatarImg || !fallbackIcon) {
        return;
    }
    const value = String(avatarUrl || '').trim();
    if (!value) {
        avatarImg.hidden = true;
        avatarImg.removeAttribute('src');
        fallbackIcon.hidden = false;
        return;
    }
    avatarImg.src = value;
    avatarImg.hidden = false;
    fallbackIcon.hidden = true;
}

function setDashboardProfileSummary(user, profile = {}) {
    const summaryWrap = document.getElementById('authProfileSummary');
    const summaryImg = document.getElementById('authProfileSummaryImg');
    const summaryName = document.getElementById('authProfileSummaryName');
    if (!summaryWrap || !summaryImg || !summaryName) {
        return;
    }

    if (!user) {
        summaryWrap.hidden = true;
        summaryName.textContent = '';
        summaryImg.hidden = true;
        summaryImg.removeAttribute('src');
        return;
    }

    const nickname = String(profile?.nickname || user.displayName || user.email || '').trim();
    const avatar = String(profile?.avatarUrl || user.photoURL || '').trim();
    summaryName.textContent = nickname || 'Utente';
    if (avatar) {
        summaryImg.src = avatar;
        summaryImg.hidden = false;
    } else {
        summaryImg.hidden = true;
        summaryImg.removeAttribute('src');
    }
    summaryWrap.hidden = false;
}

async function syncDashboardAuthProfile(user) {
    if (!user) {
        setDashboardAuthAvatar('');
        setDashboardProfileSummary(null, {});
        return { nickname: '', avatarUrl: '', preferredRegion: 'all' };
    }
    let profile = {};
    try {
        const fb = window.matchMapFirebase;
        if (fb?.ready && fb.db) {
            const snap = await fb.db.ref(`users/${user.uid}/profile`).once('value');
            if (snap.exists()) {
                profile = snap.val() || {};
            }
        }
    } catch {}

    const avatarCandidate = String(profile?.avatarUrl || '').trim() || String(user.photoURL || '').trim();
    setDashboardProfileSummary(user, profile);
    setDashboardAuthAvatar(avatarCandidate);
    return {
        nickname: String(profile?.nickname || user.displayName || '').trim(),
        avatarUrl: String(profile?.avatarUrl || '').trim(),
        preferredRegion: String(profile?.preferredRegion || 'all').trim() || 'all'
    };
}

function setDashboardAuthButtonsVisibility(user) {
    const googleLoginBtn = document.getElementById('dashboardGoogleLoginBtn');
    const logoutBtn = document.getElementById('dashboardLogoutBtn');
    const logoutLinkBtn = document.getElementById('dashboardLogoutLinkBtn');
    const mainActions = document.getElementById('authMainActions');
    if (!googleLoginBtn || !logoutBtn || !logoutLinkBtn || !mainActions) {
        return;
    }
    const isLogged = Boolean(user);
    googleLoginBtn.hidden = isLogged;
    logoutBtn.hidden = true;
    logoutLinkBtn.hidden = !isLogged;
    mainActions.hidden = isLogged;
    googleLoginBtn.style.display = isLogged ? 'none' : '';
    logoutBtn.style.display = 'none';
    logoutLinkBtn.style.display = isLogged ? 'inline-flex' : 'none';
    mainActions.style.display = isLogged ? 'none' : '';
    updateDashboardGoogleLinkButton(user);
}

function hasGoogleProviderLinked(user) {
    if (!user) {
        return false;
    }
    const providers = Array.isArray(user.providerData) ? user.providerData : [];
    return providers.some(provider => String(provider?.providerId || '').trim() === 'google.com');
}

function updateDashboardGoogleLinkButton(user) {
    const linkBtn = document.getElementById('dashboardLinkGoogleBtn');
    if (!linkBtn) {
        return;
    }
    const shouldShow = false;
    linkBtn.hidden = !shouldShow;
    linkBtn.style.display = shouldShow ? 'inline-flex' : 'none';
}

function getCurrentDashboardUser() {
    const { fb } = getDashboardAuthState();
    return fb?.ready && fb.auth ? fb.auth.currentUser : null;
}

function normalizeDashboardEvent(raw) {
    const item = raw || {};
    return {
        ...item,
        pagata: Boolean(item.pagata)
    };
}

function computeTotalRimborso() {
    return dashboardEvents.reduce((sum, e) => sum + Number(e.rimborso || 0), 0);
}

function computeDashboardPaymentStats() {
    return dashboardEvents.reduce((acc, evento) => {
        const rimborso = Number(evento?.rimborso || 0);
        acc.total += rimborso;
        if (evento?.pagata) {
            acc.paidTotal += rimborso;
            acc.paidCount += 1;
        } else {
            acc.unpaidTotal += rimborso;
            acc.unpaidCount += 1;
        }
        return acc;
    }, {
        total: 0,
        paidTotal: 0,
        unpaidTotal: 0,
        paidCount: 0,
        unpaidCount: 0
    });
}

function parseEventoDateTime(evento) {
    const data = String(evento?.data || '').trim();
    const ora = String(evento?.ora || '').trim();
    const dateMatch = data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const timeMatch = ora.match(/^(\d{2}):(\d{2})$/);
    if (!dateMatch || !timeMatch) {
        return null;
    }
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const year = Number(dateMatch[3]);
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    const ts = new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
    return Number.isFinite(ts) ? ts : null;
}

function getSortedDashboardEventsWithIndex() {
    return dashboardEvents
        .map((evento, index) => {
            const startTs = parseEventoDateTime(evento);
            return {
                evento,
                index,
                startTs,
                expired: startTs !== null && Date.now() >= (startTs + 60 * 1000)
            };
        })
        .sort((a, b) => {
            const aTs = a.startTs === null ? Number.POSITIVE_INFINITY : a.startTs;
            const bTs = b.startTs === null ? Number.POSITIVE_INFINITY : b.startTs;
            if (aTs !== bTs) {
                return aTs - bTs;
            }
            return a.index - b.index;
        });
}

function buildDashboardEventRow(item) {
    const evento = item.evento;
    const mapsUrl = getMapsUrl(evento);
    const calendarText = `${evento.categoria}: ${evento.squadre}`;
    const calendarDetails = buildCalendarDescription(evento);
    const [teamA, teamB] = splitMatchTeams(evento.squadre || '');
    const logoA = getTeamLogoForPreview(teamA);
    const logoB = getTeamLogoForPreview(teamB);
    const kmText = Number(evento.km || 0) > 0 ? `${Number(evento.km || 0)} km` : 'km n/d';
    const rimborsoText = `${Number(evento.rimborso || 0)} €`;
    const dateTime = [evento.data, evento.ora].filter(Boolean).join(' · ');
    const row = document.createElement('tr');
    row.classList.add(evento.pagata ? 'event-paid-row' : 'event-unpaid-row');
    row.innerHTML = `
            <td colspan="8" class="event-card-cell">
                <article class="gmail-preview-item dashboard-preview-item ${evento.pagata ? 'is-valid' : 'is-invalid'}">
                    <div class="gmail-match-card">
                        <div class="gmail-match-teams">
                            <div class="gmail-team-chip">
                                <img src="${escapeHtml(logoA)}" alt="Logo ${escapeHtml(teamA || 'Squadra')}" loading="lazy" decoding="async" onerror="this.src='${TEAM_LOGO_FALLBACK_PATH}'">
                                <span>${escapeHtml(teamA || 'Squadra A')}</span>
                            </div>
                            <div class="gmail-vs">VS</div>
                            <div class="gmail-team-chip">
                                <img src="${escapeHtml(logoB)}" alt="Logo ${escapeHtml(teamB || 'Squadra')}" loading="lazy" decoding="async" onerror="this.src='${TEAM_LOGO_FALLBACK_PATH}'">
                                <span>${escapeHtml(teamB || 'Squadra B')}</span>
                            </div>
                        </div>
                        <div class="gmail-match-meta">${escapeHtml(dateTime || 'Data/Ora n/d')}</div>
                        <div class="gmail-match-badges">
                            <span class="gmail-badge">${escapeHtml(evento.categoria || 'Categoria n/d')}</span>
                            <span class="gmail-badge">${escapeHtml(kmText)}</span>
                            <span class="gmail-badge gmail-badge-money">${escapeHtml(rimborsoText)}</span>
                        </div>
                        <div class="dashboard-card-actions">
                            <a class="icon-link maps-link" target="_blank" rel="noopener noreferrer" href="${mapsUrl}" title="Apri su Google Maps" aria-label="Apri su Google Maps">
                                <img src="img/maps.png" alt="Google Maps">
                            </a>
                            <a class="icon-link calendar-link" target="_blank" rel="noopener noreferrer" href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(calendarText)}&dates=${formatDataGoogle(evento.data, evento.ora)}&details=${encodeURIComponent(calendarDetails)}&location=${encodeURIComponent(evento.locationText)}" title="Aggiungi a Google Calendar" aria-label="Aggiungi a Google Calendar">
                                <img src="img/calendar.svg" alt="Google Calendar">
                            </a>
                            <button type="button" class="event-paid-btn ${evento.pagata ? 'is-paid' : ''}" onclick="toggleDashboardEventPaid(${item.index})" aria-label="${evento.pagata ? 'Segna non pagata' : 'Segna pagata'}" title="${evento.pagata ? 'Segna non pagata' : 'Segna pagata'}">
                                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                    <path d="M20 6L9 17l-5-5"></path>
                                </svg>
                            </button>
                            <button type="button" class="event-remove-btn" onclick="removeDashboardEvent(${item.index})" aria-label="Elimina evento" title="Elimina evento">
                                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                    <path d="M3 6h18"></path>
                                    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path>
                                    <path d="M19 6l-1 14a1 1 0 0 1-1 .93H7a1 1 0 0 1-1-.93L5 6"></path>
                                    <path d="M10 11v6"></path>
                                    <path d="M14 11v6"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                </article>
            </td>
        `;
    return row;
}

function updateDashboardShowMoreControls(hiddenCount) {
    const btn = document.getElementById('dashboardShowMoreBtn');
    if (!btn) {
        return;
    }
    if (hiddenCount <= 0) {
        btn.hidden = true;
        return;
    }
    btn.hidden = false;
    btn.textContent = dashboardShowAllHidden
        ? 'Mostra meno'
        : `Mostra di piu (${hiddenCount})`;
}

function renderDashboardEvents() {
    const tbody = document.querySelector('#eventTable tbody');
    if (!tbody) {
        return;
    }
    tbody.innerHTML = '';

    const sortedItems = getSortedDashboardEventsWithIndex();
    const visibleItems = [];
    const hiddenItems = [];

    sortedItems.forEach(item => {
        if (item.expired) {
            hiddenItems.push(item);
            return;
        }
        if (visibleItems.length < 4) {
            visibleItems.push(item);
            return;
        }
        hiddenItems.push(item);
    });

    visibleItems.forEach(item => {
        tbody.appendChild(buildDashboardEventRow(item));
    });

    if (dashboardShowAllHidden) {
        hiddenItems.forEach(item => {
            const row = buildDashboardEventRow(item);
            row.classList.add('event-hidden-row');
            tbody.appendChild(row);
        });
    }

    updateDashboardShowMoreControls(hiddenItems.length);

    const stats = computeDashboardPaymentStats();
    const totalEl = document.getElementById('rimborsoTotale');
    if (totalEl) {
        totalEl.classList.add('dashboard-totals');
        totalEl.innerHTML = `
            <span class="total-chip chip-total" title="Totale rimborsi">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"></path><path d="M8 9h8"></path><path d="M8 12h8"></path><path d="M8 15h5"></path></svg>
                <span>${stats.total} \u20AC</span>
            </span>
            <span class="total-chip chip-paid" title="Partite pagate">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"></path></svg>
                <span>${stats.paidTotal} \u20AC</span>
            </span>
            <span class="total-chip chip-unpaid" title="Da pagare">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v10H3z"></path><path d="M7 12h5"></path><circle cx="17" cy="12" r="2"></circle></svg>
                <span>${stats.unpaidTotal} \u20AC (${stats.unpaidCount})</span>
            </span>
        `;
    }
}

function isIosDevice() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isMacTouch = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    return isIOS || isMacTouch;
}

function isStandaloneMode() {
    const standaloneByMedia = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    const standaloneByNavigator = Boolean(window.navigator.standalone);
    return standaloneByMedia || standaloneByNavigator;
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return;
    }
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).then(registration => {
            registration.update().catch(() => {});
            setInterval(() => {
                registration.update().catch(() => {});
            }, 60000);

            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                if (!newWorker) {
                    return;
                }
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        newWorker.postMessage('SKIP_WAITING');
                    }
                });
            });
        }).catch(() => {});

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (window.__matchmapSwRefreshing) {
                return;
            }
            window.__matchmapSwRefreshing = true;
            window.location.reload();
        });
    });
}


function setupInstallApp() {
    const installBtn = document.getElementById('installAppBtn');
    const iosModal = document.getElementById('iosInstallModal');
    const closeModalBtn = document.getElementById('closeInstallModalBtn');
    if (!installBtn) {
        return;
    }

    const refreshInstallButton = () => {
        if (isStandaloneMode()) {
            installBtn.hidden = true;
            return;
        }
        if (deferredInstallPrompt || isIosDevice()) {
            installBtn.hidden = false;
            return;
        }
        installBtn.hidden = true;
    };

    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferredInstallPrompt = event;
        refreshInstallButton();
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        installBtn.hidden = true;
        showDashboardToast('App installata con successo.', 'ok');
    });

    const openInstallModal = () => {
        if (!iosModal) {
            return;
        }
        iosModal.classList.add('open');
        iosModal.setAttribute('aria-hidden', 'false');
    };

    const closeInstallModal = () => {
        if (!iosModal) {
            return;
        }
        iosModal.classList.remove('open');
        iosModal.setAttribute('aria-hidden', 'true');
    };
    window.closeInstallModal = closeInstallModal;

    installBtn.addEventListener('click', async () => {
        if (isStandaloneMode()) {
            installBtn.hidden = true;
            return;
        }

        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            const choice = await deferredInstallPrompt.userChoice.catch(() => null);
            if (choice?.outcome !== 'accepted') {
                showDashboardToast('Installazione annullata.', 'warn');
            }
            deferredInstallPrompt = null;
            refreshInstallButton();
            return;
        }

        if (isIosDevice()) {
            openInstallModal();
            return;
        }

        showDashboardToast('Installazione non disponibile in questo browser.', 'warn');
    });

    if (closeModalBtn && iosModal) {
        closeModalBtn.addEventListener('click', closeInstallModal);
        closeModalBtn.addEventListener('touchend', event => {
            event.preventDefault();
            closeInstallModal();
        }, { passive: false });
        iosModal.addEventListener('click', event => {
            if (event.target === iosModal) {
                closeInstallModal();
            }
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                closeInstallModal();
            }
        });
        document.addEventListener('click', event => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }
            if (target.closest('[data-close-install]')) {
                closeInstallModal();
            }
        });
    }

    refreshInstallButton();
}

function toggleDashboardShowMore() {
    dashboardShowAllHidden = !dashboardShowAllHidden;
    renderDashboardEvents();
}

function ensureDashboardEventAutoRefresh() {
    if (dashboardEventAutoRefreshTimer) {
        return;
    }
    dashboardEventAutoRefreshTimer = setInterval(() => {
        renderDashboardEvents();
    }, 15000);
}

async function removeDashboardEvent(index) {
    if (index < 0 || index >= dashboardEvents.length) {
        return;
    }
    dashboardEvents.splice(index, 1);
    dashboardEvents = dedupeDashboardEvents(dashboardEvents);
    renderDashboardEvents();
    await persistDashboardEvents();
}

async function toggleDashboardEventPaid(index) {
    if (index < 0 || index >= dashboardEvents.length) {
        return;
    }
    dashboardEvents[index].pagata = !Boolean(dashboardEvents[index].pagata);
    renderDashboardEvents();
    await persistDashboardEvents();
}

async function persistDashboardEvents() {
    const user = getCurrentDashboardUser();
    dashboardEvents = dedupeDashboardEvents(dashboardEvents);
    const payload = dashboardEvents.map(normalizeDashboardEvent);
    if (user) {
        const { fb } = getDashboardAuthState();
        try {
            await fb.db.ref(`users/${user.uid}/dashboard/events`).set(payload);
            return;
        } catch (error) {
            console.warn('Errore salvataggio cloud dashboard:', error.message);
        }
    }

    localStorage.setItem(GUEST_EVENTS_STORAGE_KEY, JSON.stringify(payload));
}

async function loadDashboardEvents() {
    const user = getCurrentDashboardUser();
    if (user) {
        const { fb } = getDashboardAuthState();
        try {
            const snap = await fb.db.ref(`users/${user.uid}/dashboard/events`).once('value');
            const raw = snap.exists() ? snap.val() : [];
            const list = Array.isArray(raw) ? raw : Object.values(raw || {});
            dashboardEvents = dedupeDashboardEvents(list.map(normalizeDashboardEvent));
            renderDashboardEvents();
            return;
        } catch (error) {
            console.warn('Errore lettura cloud dashboard:', error.message);
        }
    }

    try {
        const raw = JSON.parse(localStorage.getItem(GUEST_EVENTS_STORAGE_KEY) || '[]');
        dashboardEvents = dedupeDashboardEvents((Array.isArray(raw) ? raw : []).map(normalizeDashboardEvent));
    } catch (error) {
        dashboardEvents = [];
    }
    renderDashboardEvents();
}

async function aggiungiEvento() {
    const textarea = document.getElementById('designazione');
    const evento = parseDesignazione(textarea.value);
    if (!evento.data || !evento.ora || !evento.squadre) {
        showDashboardToast('Designazione non valida: controlla data, ora e squadre.', 'err');
        return;
    }

    const newFingerprint = buildEventFingerprint(evento);
    const alreadyExists = dashboardEvents.some(existing => buildEventFingerprint(existing) === newFingerprint);
    if (alreadyExists) {
        showDashboardToast('Designazione gia caricata nel tuo MatchMap.', 'warn');
        return;
    }

    dashboardEvents.push(normalizeDashboardEvent(evento));
    dashboardEvents = dedupeDashboardEvents(dashboardEvents);
    renderDashboardEvents();
    await persistDashboardEvents();
    await autoSuggestFieldFromDesignazione(evento);
    textarea.value = '';
}

/* GOOGLE CALENDAR FORMATO */
function formatDataGoogle(data, ora) {
    const [giorno, mese, anno] = data.split('/');
    const [hh, mm] = ora.split(':');
    const start = `${anno}${mese}${giorno}T${hh}${mm}00`;
    const endDate = new Date(`${anno}-${mese}-${giorno}T${hh}:${mm}:00`);
    endDate.setHours(endDate.getHours() + 1);
    endDate.setMinutes(endDate.getMinutes() + 30);
    const fine = endDate.toISOString().replace(/[-:]/g, '').split('.')[0];
    return `${start}/${fine}`;
}

/* NEWS PER REGIONE */
let newsDb = [];
let preferredNewsRegion = 'all';
let newsFilterManuallyChanged = false;
let setNewsRegionSelection = null;

function normalizeNewsPayload(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (Array.isArray(payload?.news)) {
        return payload.news;
    }
    return [];
}

async function loadNewsFromFirebase() {
    const fb = window.matchMapFirebase;
    if (!fb?.ready || !fb.db) {
        return null;
    }
    const snap = await fb.db.ref('news').once('value');
    if (!snap.exists()) {
        return [];
    }
    const raw = snap.val();
    return Array.isArray(raw) ? raw : Object.values(raw || {});
}

async function loadNewsDb() {
    try {
        const firebaseNews = await loadNewsFromFirebase();
        if (firebaseNews) {
            newsDb = normalizeNewsPayload(firebaseNews);
            return;
        }
    } catch (error) {
        newsDb = [];
    }
}

function renderNews(selectedRegion = 'all') {
    const container = document.getElementById('newsContainer');
    if (!container) {
        return;
    }

    const normalizedSelected = normalizeText(selectedRegion);
    const parseNewsTimestamp = item => {
        const fromNumeric = Number(item?.createdAt ?? item?.timestamp ?? item?.ts ?? item?.updatedAt);
        if (Number.isFinite(fromNumeric) && fromNumeric > 0) {
            return fromNumeric;
        }
        const dateText = String(item?.data || item?.date || '').trim();
        const match = dateText.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (match) {
            const day = Number(match[1]);
            const month = Number(match[2]);
            const year = Number(match[3]);
            const ts = new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
            return Number.isFinite(ts) ? ts : null;
        }
        return null;
    };

    const newsEntries = newsDb.map((item, sourceIndex) => ({ item, sourceIndex }));
    const filteredEntries = normalizedSelected === 'all'
        ? newsEntries
        : newsEntries.filter(({ item }) => {
            const normalizedRegion = normalizeText(item.regione);
            return normalizedRegion === normalizedSelected || normalizedRegion === 'tutti';
        });
    filteredEntries.sort((a, b) => {
        const tsA = parseNewsTimestamp(a.item);
        const tsB = parseNewsTimestamp(b.item);
        if (tsA !== null && tsB !== null && tsA !== tsB) {
            return tsB - tsA; // piu recente prima
        }
        if (tsA !== null && tsB === null) {
            return -1;
        }
        if (tsA === null && tsB !== null) {
            return 1;
        }
        return b.sourceIndex - a.sourceIndex; // fallback: ultimi inseriti prima
    });

    container.innerHTML = '';

    if (!filteredEntries.length) {
        container.innerHTML = '<article class="news-item"><h4>Nessuna notizia disponibile</h4><p>Non ci sono aggiornamenti per la regione selezionata.</p></article>';
        return;
    }

    filteredEntries.forEach(({ item }) => {
        const normalizedRegion = normalizeText(item.regione);
        const normalizedContent = normalizeText(`${item.titolo || ''} ${item.testo || ''}`);
        const paymentKeywords = ['pagament', 'rimbor', 'bonific', 'accredit', 'liquid', 'pacco', 'pacchi'];
        const isPaymentNews = paymentKeywords.some(keyword => normalizedContent.includes(keyword));
        const colorClass = normalizedRegion === 'tutti'
            ? 'news-global'
            : isPaymentNews
                ? 'news-payment'
                : 'news-default-blue';

        const card = document.createElement('article');
        card.className = `news-item ${colorClass}`;
        const regionLogoPath = getRegionLogoPath(item.regione);
        const logoMarkup = regionLogoPath
            ? `<img class="news-region-logo" src="${regionLogoPath}" alt="Logo ${item.regione}" loading="lazy" decoding="async" onerror="this.style.display='none'">`
            : '';
        card.innerHTML = `
            <div class="news-item-head">
                ${logoMarkup}
                <h4>${item.titolo}</h4>
            </div>
            <p><strong>${item.regione}:</strong> ${item.testo}</p>
        `;
        container.appendChild(card);
    });
}

function resolveNewsRegionValue(value, options = []) {
    const target = normalizeText(value);
    if (!target || target === 'all' || target === 'tutte le regioni') {
        return 'all';
    }
    const match = options.find(option => normalizeText(option.value) === target);
    return match ? match.value : 'all';
}

function applyPreferredNewsRegion(force = false) {
    if (!setNewsRegionSelection) {
        return;
    }
    if (newsFilterManuallyChanged && !force) {
        return;
    }
    setNewsRegionSelection(preferredNewsRegion || 'all', false);
}

async function loadPreferredNewsRegionForUser(user, profilePreferredRegion = null) {
    preferredNewsRegion = 'all';
    if (!user) {
        applyPreferredNewsRegion(true);
        return;
    }
    if (profilePreferredRegion && String(profilePreferredRegion).trim()) {
        preferredNewsRegion = String(profilePreferredRegion).trim();
        applyPreferredNewsRegion(true);
        return;
    }
    const fb = window.matchMapFirebase;
    if (!fb?.ready || !fb.db) {
        applyPreferredNewsRegion(true);
        return;
    }
    try {
        const snap = await fb.db.ref(`users/${user.uid}/profile/preferredRegion`).once('value');
        if (snap.exists()) {
            preferredNewsRegion = String(snap.val() || 'all').trim() || 'all';
        }
    } catch {
        preferredNewsRegion = 'all';
    }
    applyPreferredNewsRegion(true);
}

function setupNewsRegionFilter() {
    const select = document.getElementById('regionFilter');
    const customWrap = document.getElementById('regionFilterCustom');
    const toggleBtn = document.getElementById('regionFilterToggle');
    const menu = document.getElementById('regionFilterMenu');
    const labelEl = document.getElementById('regionFilterLabel');
    const logoEl = document.getElementById('regionFilterLogo');
    if (!select || !customWrap || !toggleBtn || !menu || !labelEl || !logoEl) {
        return;
    }

    const uniqueRegions = [...new Set(newsDb.map(item => item.regione).filter(Boolean))]
        .filter(region => normalizeText(region) !== 'tutti')
        .sort((a, b) => a.localeCompare(b, 'it'));

    select.innerHTML = '<option value="all">Tutte le regioni</option>';
    const options = [{
        value: 'all',
        label: 'Tutte le regioni',
        logo: ''
    }];
    uniqueRegions.forEach(region => {
        const option = document.createElement('option');
        option.value = region;
        option.textContent = region;
        select.appendChild(option);
        options.push({
            value: region,
            label: region,
            logo: getRegionLogoPath(region) || ''
        });
    });

    const closeMenu = () => {
        menu.hidden = true;
        toggleBtn.setAttribute('aria-expanded', 'false');
    };
    const openMenu = () => {
        menu.hidden = false;
        toggleBtn.setAttribute('aria-expanded', 'true');
    };
    const setSelection = (value, manual = false) => {
        const resolvedValue = resolveNewsRegionValue(value, options);
        const selected = options.find(x => String(x.value) === String(resolvedValue)) || options[0];
        select.value = selected.value;
        labelEl.textContent = selected.label;
        if (selected.logo) {
            logoEl.src = selected.logo;
            logoEl.alt = `Logo ${selected.label}`;
            logoEl.hidden = false;
        } else {
            logoEl.hidden = true;
            logoEl.removeAttribute('src');
            logoEl.alt = '';
        }
        menu.querySelectorAll('.region-filter-option').forEach(btn => {
            const isActive = btn.getAttribute('data-value') === String(selected.value);
            btn.classList.toggle('is-active', isActive);
        });
        if (manual) {
            newsFilterManuallyChanged = true;
        }
        renderNews(selected.value);
    };

    menu.innerHTML = options.map(option => {
        const logoMarkup = option.logo
            ? `<img class="region-filter-logo" src="${option.logo}" alt="" loading="lazy" decoding="async">`
            : '';
        return `
            <button type="button" class="region-filter-option" data-value="${option.value}" role="option">
                ${logoMarkup}
                <span>${option.label}</span>
            </button>
        `;
    }).join('');

    toggleBtn.onclick = event => {
        event.stopPropagation();
        if (menu.hidden) {
            openMenu();
        } else {
            closeMenu();
        }
    };

    menu.onclick = event => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const btn = target.closest('.region-filter-option');
        if (!btn) {
            return;
        }
        const value = btn.getAttribute('data-value') || 'all';
        setSelection(value, true);
        closeMenu();
    };

    document.addEventListener('click', event => {
        if (!customWrap.contains(event.target)) {
            closeMenu();
        }
    });

    setNewsRegionSelection = (value, manual = false) => {
        setSelection(value, manual);
    };
    setSelection(select.value || 'all');
    applyPreferredNewsRegion(true);
}

/* TABELLA PAGAMENTI */
let paymentsDb = [];
let paymentsColumns = {
    regione: 'Regione',
    inPagamento: 'Pacchi in pagamento',
    fineFebbraio: 'Fine febbraio',
    chat: 'Riscontro chat',
    stato: 'Stato'
};

function normalizePaymentsPayload(payload) {
    const fallbackColumns = {
        regione: 'Regione',
        inPagamento: 'Pacchi in pagamento',
        fineFebbraio: 'Fine febbraio',
        chat: 'Riscontro chat',
        stato: 'Stato'
    };
    const normalizeColumns = value => {
        const raw = value || {};
        return {
            regione: String(raw.regione || fallbackColumns.regione).trim() || fallbackColumns.regione,
            inPagamento: String(raw.inPagamento || fallbackColumns.inPagamento).trim() || fallbackColumns.inPagamento,
            fineFebbraio: String(raw.fineFebbraio || fallbackColumns.fineFebbraio).trim() || fallbackColumns.fineFebbraio,
            chat: String(raw.chat || fallbackColumns.chat).trim() || fallbackColumns.chat,
            stato: String(raw.stato || fallbackColumns.stato).trim() || fallbackColumns.stato
        };
    };

    if (Array.isArray(payload)) {
        return { items: payload, columns: normalizeColumns({}) };
    }
    if (Array.isArray(payload?.pagamenti)) {
        return { items: payload.pagamenti, columns: normalizeColumns(payload?.columns) };
    }
    if (Array.isArray(payload?.items)) {
        return { items: payload.items, columns: normalizeColumns(payload?.columns) };
    }
    if (payload && typeof payload === 'object') {
        const values = Object.values(payload || {});
        const looksLikePaymentRow = values.some(entry => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                return false;
            }
            return ['regione', 'inPagamento', 'fineFebbraio', 'chat', 'stato']
                .some(key => key in entry);
        });
        if (looksLikePaymentRow) {
            return { items: values, columns: normalizeColumns(payload?.columns) };
        }
    }
    return { items: [], columns: normalizeColumns(payload?.columns) };
}

async function loadPaymentsFromFirebase() {
    const fb = window.matchMapFirebase;
    if (!fb?.ready || !fb.db) {
        return null;
    }
    const snap = await fb.db.ref('pagamenti').once('value');
    if (!snap.exists()) {
        return [];
    }
    return snap.val();
}

async function loadPaymentsDb() {
    try {
        const firebasePayments = await loadPaymentsFromFirebase();
        if (firebasePayments) {
            const normalized = normalizePaymentsPayload(firebasePayments);
            paymentsDb = Array.isArray(normalized.items) ? normalized.items : [];
            paymentsColumns = normalized.columns || paymentsColumns;
            return;
        }
    } catch (error) {
        paymentsDb = [];
    }
}

function renderPaymentsTable() {
    const tbody = document.querySelector('#paymentsTable tbody');
    const table = document.getElementById('paymentsTable');
    const headers = document.querySelectorAll('#paymentsTable thead th');
    if (!tbody) {
        return;
    }
    const isEmptyChatValue = value => {
        const raw = String(value ?? '').trim();
        if (!raw) {
            return true;
        }
        const normalized = normalizeText(raw);
        return !normalized || normalized === 'na' || normalized === 'n a' || normalized === 'nessuno';
    };
    const hasAnyChatValue = paymentsDb.some(item => !isEmptyChatValue(item?.chat));
    if (table) {
        table.classList.toggle('payments-hide-chat', !hasAnyChatValue);
    }
    if (headers.length >= 5) {
        headers[0].textContent = paymentsColumns.regione || 'Regione';
        headers[1].textContent = paymentsColumns.inPagamento || 'Pacchi in pagamento';
        headers[2].textContent = paymentsColumns.fineFebbraio || 'Fine febbraio';
        headers[3].textContent = paymentsColumns.chat || 'Riscontro chat';
        headers[4].textContent = paymentsColumns.stato || 'Stato';
        headers[3].hidden = !hasAnyChatValue;
    }

    tbody.innerHTML = '';

    const statusClassMap = {
        confermato: 'pay-confirmed',
        monitoraggio: 'pay-monitoring',
        previsto: 'pay-planned'
    };

    if (!paymentsDb.length) {
        const row = document.createElement('tr');
        row.className = 'payments-empty-row';
        row.innerHTML = `<td colspan="${hasAnyChatValue ? 5 : 4}">Nessun aggiornamento pagamenti disponibile al momento.</td>`;
        tbody.appendChild(row);
        return;
    }

    paymentsDb.forEach(item => {
        const statusKey = normalizeText(item.stato);
        const row = document.createElement('tr');
        row.className = statusClassMap[statusKey] || '';

        const statusBadgeClass = statusClassMap[statusKey] || 'pay-planned';
        const statoText = item.stato || 'aggiornamento';
        const cells = [
            { label: paymentsColumns.regione || 'Regione', value: item.regione || '-', className: 'pay-cell-region' },
            { label: paymentsColumns.inPagamento || 'Pacchi in pagamento', value: item.inPagamento || '-', className: 'pay-cell-num' },
            { label: paymentsColumns.fineFebbraio || 'Fine febbraio', value: item.fineFebbraio || '-', className: 'pay-cell-num' }
        ];
        if (hasAnyChatValue) {
            cells.push({
                label: paymentsColumns.chat || 'Riscontro chat',
                value: item.chat || '-',
                className: 'pay-cell-chat'
            });
        }
        cells.push({
            label: paymentsColumns.stato || 'Stato',
            value: `<span class="payments-status-badge ${statusBadgeClass}">${statoText}</span>`,
            className: 'pay-cell-status'
        });

        row.innerHTML = cells
            .map(cell => `<td data-label="${cell.label}" class="${cell.className || ''}">${cell.value}</td>`)
            .join('');

        tbody.appendChild(row);
    });
}

async function registerDashboardUser() {
    setDashboardAuthStatus('Registrazione email/password disattivata. Usa Continua con Google.');
}

async function loginDashboardUser() {
    setDashboardAuthStatus('Login email/password disattivato. Usa Continua con Google.');
}

async function loginDashboardUserWithGoogle() {
    const fb = window.matchMapFirebase;
    if (!fb?.ready || !fb.auth || !window.firebase?.auth) {
        setDashboardAuthStatus('Firebase non disponibile.');
        return;
    }

    try {
        await fb.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({
            prompt: 'select_account consent'
        });
        try {
            await fb.auth.signInWithPopup(provider);
            setDashboardAuthStatus('Login Google effettuato.', true);
        } catch (popupError) {
            const code = String(popupError?.code || '').trim();
            const shouldFallbackToRedirect = code === 'auth/popup-blocked'
                || code === 'auth/cancelled-popup-request'
                || code === 'auth/operation-not-supported-in-this-environment';
            if (!shouldFallbackToRedirect) {
                throw popupError;
            }

            await fb.auth.signInWithRedirect(provider);
            setDashboardAuthStatus('Reindirizzamento Google avviato...');
        }
    } catch (error) {
        setDashboardAuthStatus(`Login Google fallito: ${describeFirebaseAuthError(error, 'google-login')}`);
    }
}

async function linkDashboardCurrentUserWithGoogle() {
    setDashboardAuthStatus('Funzione non necessaria: accesso consentito solo con Google.');
}

function describeFirebaseAuthError(error, context = '') {
    const code = String(error?.code || '').trim();
    const rawMessage = String(error?.message || '').trim();
    const rawLower = rawMessage.toLowerCase();
    const base = rawMessage || 'Errore autenticazione non previsto.';

    if (rawLower.includes('org_internal') || rawLower.includes('error 403') || rawLower.includes('errore 403')) {
        return 'Google OAuth bloccato (errore 403 org_internal). In Google Cloud imposta OAuth consent screen come External oppure aggiungi il tuo account tra Test users.';
    }

    if (code === 'auth/invalid-email') return 'Email non valida.';
    if (code === 'auth/missing-password') return 'Password mancante.';
    if (code === 'auth/weak-password') return 'Password troppo debole (minimo 6 caratteri).';
    if (code === 'auth/email-already-in-use') return 'Email gia registrata. Prova Login.';
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        return 'Credenziali non corrette.';
    }
    if (code === 'auth/too-many-requests') return 'Troppi tentativi. Riprova tra poco.';
    if (code === 'auth/network-request-failed') return 'Errore rete. Controlla connessione.';
    if (code === 'auth/popup-closed-by-user') return 'Popup Google chiuso prima del completamento.';
    if (code === 'auth/popup-blocked') return 'Popup Google bloccato dal browser.';
    if (code === 'auth/operation-not-supported-in-this-environment') {
        return 'Ambiente non supporta popup (tipico in PWA/iOS). Usa browser normale o flusso redirect.';
    }
    if (code === 'auth/unauthorized-domain') {
        return 'Dominio non autorizzato su Firebase Auth. Aggiungi dominio in Firebase Console > Authentication > Settings > Authorized domains.';
    }
    if (code === 'auth/operation-not-allowed') {
        if (context === 'google-login' || context === 'google-link') {
            return 'Provider Google disattivato su Firebase Console > Authentication > Sign-in method.';
        }
        return 'Provider Email/Password disattivato su Firebase Console > Authentication > Sign-in method.';
    }
    return base;
}

async function logoutDashboardUser() {
    const fb = window.matchMapFirebase;
    setPublisherAdminLinkVisible(false);
    if (!fb?.ready || !fb.auth) {
        setDashboardAuthStatus('Firebase non disponibile.');
        return;
    }
    try {
        await fb.auth.signOut();
        clearDashboardAuthSnapshot();
        setDashboardAuthStatus('Logout effettuato. Modalita ospite attiva.');
        await loadDashboardEvents();
    } catch (error) {
        setDashboardAuthStatus(`Logout fallito: ${error.message}`);
    }
}

function initDashboardAuth() {
    const fb = window.matchMapFirebase;
    setPublisherAdminLinkVisible(false);
    const bootstrapSnapshot = readDashboardAuthSnapshot();
    const hasAppliedSnapshot = applyDashboardAuthSnapshot(bootstrapSnapshot);
    if (!hasAppliedSnapshot) {
        setDashboardAuthStatus('Verifica sessione in corso...');
    }
    if (!fb?.ready || !fb.auth) {
        setDashboardAuthStatus('Modalita ospite attiva (Firebase non disponibile).');
        setDashboardAuthButtonsVisibility(null);
        setDashboardAuthAvatar('');
        setDashboardProfileSummary(null, {});
        loadGmailIntegrationPrefsForCurrentUser();
        loadDashboardEvents();
        return;
    }

    fb.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    fb.auth.getRedirectResult().catch(error => {
        const msg = describeFirebaseAuthError(error, 'google-login');
        setDashboardAuthStatus(`Login Google fallito: ${msg}`);
    });
    fb.auth.onAuthStateChanged(async user => {
        setDashboardAuthButtonsVisibility(user);
        if (!user) {
            clearDashboardAuthSnapshot();
            setDashboardAuthStatus('Modalita ospite attiva.');
            setPublisherAdminLinkVisible(false);
            setDashboardAuthAvatar('');
            setDashboardProfileSummary(null, {});
            await loadPreferredNewsRegionForUser(null, null);
            await loadGmailIntegrationPrefsForCurrentUser();
            await loadDashboardEvents();
            return;
        }

        // Evita effetto "logout/login" percepito durante il ripristino sessione.
        setDashboardAuthStatus('Connessione account...', true);
        const profile = await syncDashboardAuthProfile(user);
        await loadPreferredNewsRegionForUser(user, profile?.preferredRegion);
        await loadGmailIntegrationPrefsForCurrentUser();
        writeDashboardAuthSnapshot({
            isLogged: true,
            nickname: String(profile?.nickname || user.displayName || user.email || '').trim(),
            avatarUrl: String(profile?.avatarUrl || user.photoURL || '').trim(),
            isAdmin: isDashboardAdmin(user)
        });

        if (isDashboardAdmin(user)) {
            const label = String(profile?.nickname || user.displayName || user.email || '').trim();
            setDashboardAuthStatus(`Connesso come ${label}`, true);
            setPublisherAdminLinkVisible(true);
        } else {
            const label = String(profile?.nickname || user.displayName || user.email || '').trim();
            setDashboardAuthStatus(`Connesso come ${label}`);
            setPublisherAdminLinkVisible(false);
        }
        await loadDashboardEvents();
    });
}

function setupAuthPopover() {
    const toggleBtn = document.getElementById('authToggleBtn');
    const popover = document.getElementById('authPopover');
    if (!toggleBtn || !popover) {
        return;
    }

    toggleBtn.addEventListener('click', event => {
        event.stopPropagation();
        popover.hidden = !popover.hidden;
    });

    popover.addEventListener('click', event => {
        event.stopPropagation();
    });

    document.addEventListener('click', () => {
        popover.hidden = true;
    });
}

function setSuggestionStatus(message, isOk = false) {
    const statusEl = document.getElementById('suggestionStatus');
    if (!statusEl) {
        return;
    }
    statusEl.textContent = message;
    statusEl.style.color = isOk ? '#6ee7b7' : '#9fb2dd';
}

function extractCoordinatesFromMapsUrl(url) {
    const value = String(url || '').trim();
    if (!value) {
        return null;
    }
    let match = value.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i);
    if (match) {
        return { lat: Number(match[1]), lng: Number(match[2]) };
    }
    match = value.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
    if (match) {
        return { lat: Number(match[1]), lng: Number(match[2]) };
    }
    return null;
}

function searchSuggestionPlace() {
    const team = (document.getElementById('suggestTeam')?.value || '').trim();
    const title = (document.getElementById('suggestTitle')?.value || '').trim();
    const text = (document.getElementById('suggestText')?.value || '').trim();
    const mapsUrl = (document.getElementById('suggestMaps')?.value || '').trim();

    if (/^https?:\/\//i.test(mapsUrl)) {
        window.open(mapsUrl, '_blank', 'noopener,noreferrer');
        setSuggestionStatus('Apro il link Maps inserito.', true);
        return;
    }

    const queryParts = [team, title, text, 'Italia'].filter(Boolean);
    if (!queryParts.length) {
        setSuggestionStatus('Compila almeno squadra, titolo o descrizione per avviare la ricerca.');
        return;
    }

    const query = queryParts.join(', ');
    const searchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    document.getElementById('suggestMaps').value = searchUrl;
    window.open(searchUrl, '_blank', 'noopener,noreferrer');
    setSuggestionStatus('Ricerca aperta su Google Maps.', true);
}

function searchMapPlaceFromBar(preselectedMatch = null) {
    const notFoundMessage = 'campo non ancora inserito, se vuoi aggiungerlo fai una segnalazione nella sezione apposita sotto la mappa';
    const query = (document.getElementById('mapQuickSearchInput')?.value || '').trim();
    if (!query) {
        setSuggestionStatus('Inserisci campo/squadra/via nella barra sopra la mappa.');
        return;
    }
    hideMapSearchSuggestions();

    const trySearch = () => {
        const bestMatch = preselectedMatch || findBestLuogoForMapSearch(query);
        if (!bestMatch || !hasValidMapCoords(bestMatch?.lat, bestMatch?.lng)) {
            setSuggestionStatus(notFoundMessage);
            return;
        }

        const lat = getNumericCoord(bestMatch.lat);
        const lng = getNumericCoord(bestMatch.lng);
        ensureLuoghiMap();
        if (luoghiMap) {
            luoghiMap.setView([lat, lng], 16, { animate: true });
            if (luoghiMapLayer && window.L) {
                luoghiMapLayer.eachLayer(layer => {
                    if (!(layer instanceof L.Marker)) {
                        return;
                    }
                    const markerLatLng = layer.getLatLng();
                    if (Math.abs(markerLatLng.lat - lat) < 0.000001 && Math.abs(markerLatLng.lng - lng) < 0.000001) {
                        layer.openPopup();
                    }
                });
            }
        }

        const suggestMapsEl = document.getElementById('suggestMaps');
        if (suggestMapsEl && !suggestMapsEl.value.trim() && bestMatch.mapsUrl) {
            suggestMapsEl.value = bestMatch.mapsUrl;
        }

        setSuggestionStatus(`Campo trovato: zoom su ${bestMatch.nome || query}.`, true);
    };

    if (!luoghiDb.length) {
        loadLuoghiDb().finally(() => {
            trySearch();
        });
        return;
    }

    trySearch();
}

async function submitUserSuggestion() {
    const fb = window.matchMapFirebase;
    if (!fb?.ready || !fb.db) {
        setSuggestionStatus('Firebase non disponibile. Riprova tra poco.');
        return;
    }

    const type = 'campo';
    const team = (document.getElementById('suggestTeam')?.value || '').trim();
    const title = (document.getElementById('suggestTitle')?.value || '').trim();
    const text = (document.getElementById('suggestText')?.value || '').trim();
    const mapsUrl = (document.getElementById('suggestMaps')?.value || '').trim();
    const proofUrl = (document.getElementById('suggestProofUrl')?.value || '').trim();

    if (!title || !team || !text || !mapsUrl) {
        setSuggestionStatus('Compila titolo, squadra, link maps e descrizione.');
        return;
    }

    const now = Date.now();
    const lastTs = Number(localStorage.getItem(SUGGESTION_COOLDOWN_KEY) || 0);
    if (now - lastTs < 15000) {
        setSuggestionStatus('Attendi qualche secondo prima di inviare un altra segnalazione.');
        return;
    }

    const coords = extractCoordinatesFromMapsUrl(mapsUrl);
    const hasCoords = Boolean(coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng));
    const user = getCurrentDashboardUser();
    if (!user) {
        setSuggestionStatus('Per inviare segnalazioni devi essere registrato e fare login.');
        return;
    }

    const payload = {
        type,
        team: team || '',
        title,
        text,
        mapsUrl: mapsUrl || '',
        proofUrl: proofUrl || '',
        status: 'pending',
        checks: {
            hasProofUrl: /^https?:\/\//i.test(proofUrl || ''),
            hasMapsCoords: hasCoords
        },
        coordinates: hasCoords ? coords : null,
        createdAt: now,
        createdByUid: user?.uid || null,
        createdByEmail: user?.email || null
    };

    try {
        await fb.db.ref('suggestions').push(payload);
        localStorage.setItem(SUGGESTION_COOLDOWN_KEY, String(now));
        setSuggestionStatus('Segnalazione inviata. Rimane in revisione fino ad approvazione admin.', true);
        document.getElementById('suggestTitle').value = '';
        document.getElementById('suggestText').value = '';
        document.getElementById('suggestMaps').value = '';
        document.getElementById('suggestProofUrl').value = '';
        document.getElementById('suggestTeam').value = '';
    } catch (error) {
        setSuggestionStatus(`Errore invio: ${error.message}`);
    }
}

window.registerDashboardUser = registerDashboardUser;
window.loginDashboardUser = loginDashboardUser;
window.loginDashboardUserWithGoogle = loginDashboardUserWithGoogle;
window.linkDashboardCurrentUserWithGoogle = linkDashboardCurrentUserWithGoogle;
window.logoutDashboardUser = logoutDashboardUser;
window.removeDashboardEvent = removeDashboardEvent;
window.toggleDashboardEventPaid = toggleDashboardEventPaid;
window.submitUserSuggestion = submitUserSuggestion;
window.searchSuggestionPlace = searchSuggestionPlace;
window.searchMapPlaceFromBar = searchMapPlaceFromBar;
window.toggleDashboardShowMore = toggleDashboardShowMore;
window.connectGmailIntegration = connectGmailIntegration;
window.disconnectGmailIntegration = disconnectGmailIntegration;
window.loadRelevantGmailMessages = loadRelevantGmailMessages;
window.importSelectedGmailEvents = importSelectedGmailEvents;
window.toggleSelectAllGmailEvents = toggleSelectAllGmailEvents;

const mapQuickSearchInput = document.getElementById('mapQuickSearchInput');
const mapQuickSearchSuggestions = document.getElementById('mapQuickSearchSuggestions');
const dashboardShowMoreBtn = document.getElementById('dashboardShowMoreBtn');
if (dashboardShowMoreBtn) {
    dashboardShowMoreBtn.addEventListener('click', toggleDashboardShowMore);
}
if (mapQuickSearchInput) {
    mapQuickSearchInput.addEventListener('input', () => {
        renderMapSearchSuggestions();
    });
    mapQuickSearchInput.addEventListener('focus', () => {
        if (mapSearchHideTimer) {
            clearTimeout(mapSearchHideTimer);
            mapSearchHideTimer = null;
        }
        renderMapSearchSuggestions();
    });
    mapQuickSearchInput.addEventListener('blur', () => {
        mapSearchHideTimer = setTimeout(() => {
            hideMapSearchSuggestions();
        }, 120);
    });
    mapQuickSearchInput.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' && mapSearchSuggestions.length) {
            event.preventDefault();
            setMapSearchActiveIndex(mapSearchActiveIndex + 1);
            return;
        }
        if (event.key === 'ArrowUp' && mapSearchSuggestions.length) {
            event.preventDefault();
            setMapSearchActiveIndex(mapSearchActiveIndex - 1);
            return;
        }
        if (event.key === 'Escape') {
            hideMapSearchSuggestions();
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            mapSearchLastEnterTs = Date.now();
            if (mapSearchActiveIndex >= 0 && mapSearchSuggestions.length) {
                selectMapSearchSuggestion(mapSearchActiveIndex);
                return;
            }
            searchMapPlaceFromBar();
        }
    });
    mapQuickSearchInput.addEventListener('keyup', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            if (Date.now() - mapSearchLastEnterTs < 220) {
                return;
            }
            searchMapPlaceFromBar();
        }
    });
}
if (mapQuickSearchSuggestions) {
    mapQuickSearchSuggestions.addEventListener('mousedown', event => {
        event.preventDefault();
    });
    mapQuickSearchSuggestions.addEventListener('click', event => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const button = target.closest('.map-search-suggestion');
        if (!button) {
            return;
        }
        const index = Number(button.dataset.index);
        if (Number.isNaN(index)) {
            return;
        }
        selectMapSearchSuggestion(index);
    });
}

loadLuoghiDb();
Promise.all([loadNewsDb(), loadPaymentsDb()]).then(() => {
    setupNewsRegionFilter();
    applyPreferredNewsRegion(true);
    renderPaymentsTable();
});
initGmailIntegration();
initDashboardAuth();
setupAuthPopover();
ensureDashboardEventAutoRefresh();
registerServiceWorker();
setupInstallApp();

const authAvatarImg = document.getElementById('authAvatarImg');
if (authAvatarImg) {
    authAvatarImg.addEventListener('error', () => {
        setDashboardAuthAvatar('');
    });
}

const authProfileSummaryImg = document.getElementById('authProfileSummaryImg');
if (authProfileSummaryImg) {
    authProfileSummaryImg.addEventListener('error', () => {
        authProfileSummaryImg.hidden = true;
        authProfileSummaryImg.removeAttribute('src');
    });
}
















































