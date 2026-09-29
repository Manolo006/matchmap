/* ============================================================================
 * MatchMap - Luoghi Database, Search & Interactive Map (js/luoghi-map.js)
 * ============================================================================ */

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
const DYNAMIC_TEAM_LOGO_CACHE_KEY = 'matchmap_dynamic_team_logos_v1';
const ENRICHED_LUOGHI_CACHE_KEY = 'matchmap_enriched_luoghi_v2';
try {
    localStorage.removeItem('matchmap_enriched_luoghi_v1');
} catch {}
const TUTTOCAMPO_TEAM_SEARCH_URL = 'https://www.tuttocampo.it/Ajax/GetTeams';
const DASHBOARD_ADMIN_EMAILS = new Set(['manuelcarpita@gmail.com']);
const AUTO_FIELD_SUGGESTIONS_CACHE_KEY = 'matchmap_auto_field_suggestions_v1';
const DASHBOARD_AUTH_SNAPSHOT_KEY = 'matchmap_dashboard_auth_snapshot_v1';
const GMAIL_INTEGRATION_STORAGE_KEY = 'matchmap_gmail_integration_v1';
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GMAIL_DEFAULT_QUERY = '(from:(aia OR "aia-figc.it" OR cra OR sinfonia4you OR servizisportivi OR designazioni) OR to:(aia OR "aia-figc.it") OR subject:(designazione OR "notifica di designazione" OR "sei designato" OR "gara n.")) -subject:(riunione OR assemblea OR convocazione OR polo OR quota OR circolare OR auguri OR cena) newer_than:730d';
const GMAIL_FALLBACK_QUERY = '("notifica di designazione" OR designazione OR "sei designato" OR "numero gara" OR "gara :") -subject:(riunione OR assemblea OR convocazione OR polo OR quota OR circolare) newer_than:730d';

let pendingFirebaseLuoghiRepair = false;


function readEnrichedLuoghiCache() {
    try {
        const raw = JSON.parse(localStorage.getItem(ENRICHED_LUOGHI_CACHE_KEY) || '[]');
        if (!Array.isArray(raw)) {
            return [];
        }
        return repairCorruptedLuoghiDatabase(raw).list;
    } catch {
        return [];
    }
}

function writeEnrichedLuoghiCache(list) {
    try {
        if (Array.isArray(list) && list.length) {
            localStorage.setItem(ENRICHED_LUOGHI_CACHE_KEY, JSON.stringify(list));
        }
    } catch {
        // ignore storage quota errors
    }
}

function mergeLuoghiLists(remoteList, cachedList) {
    const base = Array.isArray(remoteList) ? remoteList.map(x => ({ ...x })) : [];
    const extra = Array.isArray(cachedList) ? cachedList : [];
    if (!extra.length) {
        return base;
    }

    extra.forEach(cached => {
        if (!cached || typeof cached !== 'object') {
            return;
        }
        const cachedNome = normalizeText(cached.nome || '');
        const cachedIndirizzo = normalizeText(cached.indirizzo || '');
        const existingIdx = base.findIndex(item => {
            const itemNome = normalizeText(item?.nome || '');
            const itemInd = normalizeText(item?.indirizzo || '');
            return (cachedNome && itemNome === cachedNome)
                || (cachedIndirizzo && cachedIndirizzo.length >= 8 && itemInd === cachedIndirizzo);
        });

        if (existingIdx >= 0) {
            const existing = base[existingIdx];
            const mergedAliases = filterCleanAliases([
                ...(Array.isArray(existing.aliases) ? existing.aliases : []),
                ...(Array.isArray(cached.aliases) ? cached.aliases : [])
            ]);
            const mergedS4y = Array.from(new Set([
                ...(Array.isArray(existing.designazioneS4y) ? existing.designazioneS4y : (existing.designazioneS4y ? [existing.designazioneS4y] : [])),
                ...(Array.isArray(cached.designazioneS4y) ? cached.designazioneS4y : (cached.designazioneS4y ? [cached.designazioneS4y] : []))
            ].map(x => String(x || '').trim()).filter(Boolean)));

            base[existingIdx] = {
                ...existing,
                comune: existing.comune || cached.comune || '',
                indirizzo: existing.indirizzo || cached.indirizzo || '',
                lat: hasValidMapCoords(existing.lat, existing.lng) ? existing.lat : cached.lat,
                lng: hasValidMapCoords(existing.lat, existing.lng) ? existing.lng : cached.lng,
                mapsUrl: existing.mapsUrl || cached.mapsUrl || '',
                logoUrl: existing.logoUrl || existing.logo || cached.logoUrl || cached.logo || '',
                aliases: mergedAliases,
                designazioneS4y: mergedS4y
            };
        } else {
            base.push({ ...cached });
        }
    });

    return base;
}

async function persistRepairedLuoghiIfNeeded() {
    if (!pendingFirebaseLuoghiRepair || !luoghiDb.length) {
        return;
    }
    const user = getCurrentDashboardUser();
    const fb = window.matchMapFirebase;
    if (user && isDashboardAdmin(user) && fb?.ready && fb.db) {
        try {
            await fb.db.ref('luoghi').set(luoghiDb);
            pendingFirebaseLuoghiRepair = false;
        } catch (err) {
            console.warn('Ripristino luoghi su Firebase non riuscito:', err?.message);
        }
    }
}

let luoghiRealtimeBound = false;

async function loadLuoghiDb() {
    const cachedEnriched = readEnrichedLuoghiCache();
    if (cachedEnriched.length && !luoghiDb.length) {
        luoghiDb = cachedEnriched;
    }
    try {
        const fb = window.matchMapFirebase;
        if (fb?.ready && fb.db) {
            const applySnapshot = async snap => {
                if (!snap.exists()) {
                    return;
                }
                const raw = snap.val();
                const remoteList = Array.isArray(raw) ? raw : Object.values(raw || {});
                const repairedRemote = repairCorruptedLuoghiDatabase(remoteList);
                if (repairedRemote.changed) {
                    pendingFirebaseLuoghiRepair = true;
                }
                luoghiDb = repairCorruptedLuoghiDatabase(mergeLuoghiLists(repairedRemote.list, readEnrichedLuoghiCache())).list;
                writeEnrichedLuoghiCache(luoghiDb);
                await persistRepairedLuoghiIfNeeded();
                if (document.getElementById('map')?.classList.contains('active')) {
                    renderLuoghiMap();
                }
                renderMapSearchSuggestions();
                if (typeof dashboardEvents !== 'undefined' && dashboardEvents.length) {
                    renderDashboardEvents();
                }
                if (typeof gmailPreviewItems !== 'undefined' && gmailPreviewItems.length) {
                    renderGmailPreviewList();
                }
                scheduleAutoSyncRefereedMatches();
            };

            if (!luoghiRealtimeBound) {
                luoghiRealtimeBound = true;
                fb.db.ref('luoghi').on('value', snap => {
                    applySnapshot(snap);
                });
            }
            const snap = await fb.db.ref('luoghi').once('value');
            await applySnapshot(snap);
            return;
        }
        luoghiDb = cachedEnriched;
    } catch (error) {
        luoghiDb = cachedEnriched;
    }
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
        const venuePart = normalizeText(String(entry?.nome || '').includes('|') ? String(entry?.nome || '').split('|').pop() : '');
        const indirizzo = normalizeText(entry?.indirizzo);
        const aliases = filterCleanAliases(entry?.aliases)
            .map(normalizeText)
            .filter(Boolean);
        const designKeys = getLuogoDesignazioneKeys(entry);

        let score = 0;

        if (designKeys.some(k => k && (k === target || k.includes(target) || target.includes(k)))) {
            score += 240;
        }

        // Match forte su nome campo o nome impianto dopo '|'
        if (nome && nome.length >= 5 && target.includes(nome)) {
            score += 120;
        } else if (venuePart && venuePart.length >= 5 && target.includes(venuePart)) {
            score += 110;
        }

        // Match medio su indirizzo
        if (indirizzo && indirizzo.length >= 8 && target.includes(indirizzo)) {
            score += 80;
        }

        // Match su alias (ignora città pure e alias troppo corti)
        aliases.forEach(alias => {
            if (alias.length >= 5 && !CITY_ONLY_ALIAS_BLACKLIST.has(alias) && target.includes(alias)) {
                score += 55;
            }
        });

        // Intersezione parole utile per casi con ordine invertito (es. Capparella Ferdinando vs Ferdinando Capparella)
        const genericStop = new Set(['campo', 'sportivo', 'comunale', 'sintex', 'erba', 'terra', 'stadio', 'calcio', 'snc', 'via', 'viale', 'strada', 'largo', 'civitavecchia', 'cerveteri', 'ladispoli', 'tarquinia', 'roma', 'viterbo']);
        const candidateWords = new Set(
            [venuePart || nome, indirizzo, ...aliases]
                .join(' ')
                .split(' ')
                .filter(token => token.length >= 4 && !genericStop.has(token))
        );
        let overlap = 0;
        candidateWords.forEach(token => {
            if (words.has(token)) overlap += 1;
        });
        if (overlap >= 2) {
            score += overlap * 25;
        }

        if (score > bestScore) {
            bestScore = score;
            bestMatch = entry;
        }
    });

    // Soglia minima per evitare match casuali sulla sola città
    if (bestScore < 50) {
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
                <span class="map-search-suggestion-title">${escapeHtml(title)}</span>
                <span class="map-search-suggestion-meta">${escapeHtml(details || 'Dettagli non disponibili')}</span>
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
    if (!explicitUrl) {
        return TEAM_LOGO_FALLBACK_PATH;
    }
    const teamName = String(item?.team || item?.nome || '').trim();
    const slug = toTeamLogoSlug(teamName);
    const cacheKey = `${explicitUrl}|${slug}`;
    if (teamLogoUrlCache.has(cacheKey)) {
        return teamLogoUrlCache.get(cacheKey);
    }

    const tuttocampoCandidates = buildTuttocampoLogoCandidates(explicitUrl);
    if (tuttocampoCandidates.length) {
        const candidate = tuttocampoCandidates[0];
        teamLogoUrlCache.set(cacheKey, candidate);
        return candidate;
    }

    teamLogoUrlCache.set(cacheKey, explicitUrl);
    return explicitUrl;
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
        return `<img src="${url}" alt="Logo squadra ${index + 1}" loading="lazy" decoding="async" onerror="this.src='${TEAM_LOGO_FALLBACK_PATH}'">`;
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

let leafletLoadPromise = null;
let luoghiMapHasInitialFit = false;

function ensureLeafletLoaded() {
    if (window.L) {
        return Promise.resolve(window.L);
    }
    if (leafletLoadPromise) {
        return leafletLoadPromise;
    }
    leafletLoadPromise = new Promise((resolve, reject) => {
        if (!document.querySelector('link[href*="leaflet.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
            link.crossOrigin = '';
            document.head.appendChild(link);
        }
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
        script.crossOrigin = '';
        script.onload = () => resolve(window.L);
        script.onerror = err => {
            leafletLoadPromise = null;
            reject(err);
        };
        document.body.appendChild(script);
    });
    return leafletLoadPromise;
}

function ensureLuoghiMap() {
    if (luoghiMap || !window.L) {
        return;
    }
    const mapEl = document.getElementById('luoghiMap');
    if (!mapEl) {
        return;
    }
    luoghiMap = L.map('luoghiMap', { zoomControl: true }).setView([42.02, 12.10], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(luoghiMap);
    luoghiMapLayer = L.layerGroup().addTo(luoghiMap);
}

async function renderLuoghiMap(options = {}) {
    await ensureLeafletLoaded().catch(() => null);
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
        missingEl.innerHTML = `<h4>Coordinate mancanti</h4><p>${missing.map(x => escapeHtml(x.nome || 'Luogo senza nome')).join(', ')}</p>`;
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
        const mapsLink = item.mapsUrl ? `<p><a href="${escapeHtml(item.mapsUrl)}" target="_blank" rel="noopener noreferrer">Apri Maps</a></p>` : '';
        marker.bindPopup(`<strong>${escapeHtml(item.nome || 'Campo')}</strong><br>${escapeHtml(item.comune || '')}<br>${escapeHtml(item.indirizzo || '')}${mapsLink}`);
        marker.addTo(luoghiMapLayer);
        bounds.push([lat, lng]);
    });

    if (!luoghiMapHasInitialFit || options.forceFit) {
        if (bounds.length) {
            luoghiMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 11 });
            if (bounds.length === 1) {
                luoghiMap.setZoom(13);
            }
            luoghiMapHasInitialFit = true;
        } else {
            luoghiMap.setView([42.02, 12.10], 9);
        }
    }

    setTimeout(() => luoghiMap.invalidateSize(), 50);
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

    const impiantoStop = new Set(['a', 'erba', 'sintex', 'sintetico', 'terra', 'campo', 'sportivo', 'comunale', 'stadio', 'centro', 'calcio', 'di', 'del', 'della', 'snc', 'c11', 'c5', 'c8', 'rm', 'vt']);
    const addressStop = new Set(['via', 'viale', 'str', 'strada', 'vicinale', 'largo', 'vicolo', 'piazzale', 'piazza', 'di', 'del', 'della', 'dei', 'delle', 'san', 's', 'snc', 'n', 'km', 'rm', 'vt', 'roma', 'viterbo', 'fiumicino', 'cerveteri', 'civitavecchia', 'ladispoli', 'tarquinia']);

    const impiantoTokens = impiantoNorm.split(' ').filter(t => t.length >= 4 && !impiantoStop.has(t));
    const addressTokens = indirizzoNorm.split(' ').filter(t => t.length >= 4 && !addressStop.has(t));

    let best = null;
    let bestScore = 0;
    luoghiDb.forEach(entry => {
        const nome = normalizeText(entry?.nome);
        const indirizzo = normalizeText(entry?.indirizzo);
        const comune = normalizeText(entry?.comune);
        const aliases = filterCleanAliases(getLuogoAliases(entry)).map(normalizeText).filter(Boolean);
        const designKeys = getLuogoDesignazioneKeys(entry);
        const fields = [nome, indirizzo, ...aliases].filter(Boolean);
        if (!fields.length) {
            return;
        }

        const haystack = fields.join(' ');
        const haystackTokens = new Set(haystack.split(' ').filter(Boolean));
        let score = 0;

        if (designazioneKey) {
            if (designKeys.includes(designazioneKey)) {
                score += 420;
            } else if (designKeys.some(value => value && (value.includes(designazioneKey) || designazioneKey.includes(value)))) {
                score += 240;
            }
        }

        if (impiantoTokens.length) {
            const matchedImp = impiantoTokens.filter(t => haystackTokens.has(t) || haystack.includes(t));
            if (matchedImp.length === impiantoTokens.length) {
                score += 220;
            } else if (matchedImp.some(t => t.length >= 5)) {
                score += matchedImp.length * 110;
            }
        }

        if (addressTokens.length) {
            const matchedAddr = addressTokens.filter(t => haystackTokens.has(t) || haystack.includes(t));
            if (matchedAddr.length >= 1) {
                score += matchedAddr.length * 120;
            }
        }

        // Il comune fa solo da spareggio se c'è già un riscontro su impianto o indirizzo
        if (score > 0 && luogoNorm && (comune && (luogoNorm.includes(comune) || comune.includes(luogoNorm)))) {
            score += 25;
        }

        if (score > bestScore) {
            bestScore = score;
            best = entry;
        }
    });

    return bestScore >= 100 ? best : null;
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

function formatTitleCaseLabel(raw) {
    const str = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!str) {
        return '';
    }
    const upperAcronyms = new Set(['ASD', 'SSD', 'USD', 'POL', 'FC', 'AC', 'AS', 'SS', 'US', 'CSL', 'DLF', 'SNC', 'RM', 'VT', 'LT', 'FR', 'RI']);
    return str
        .split(' ')
        .map(word => {
            const clean = word.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            if (upperAcronyms.has(clean)) {
                return word.toUpperCase();
            }
            if (word.length <= 2) {
                return word.toLowerCase();
            }
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ')
        .replace(/^\w/, c => c.toUpperCase());
}

function isWithinLazioBounds(lat, lng) {
    const nLat = Number(lat);
    const nLng = Number(lng);
    return Number.isFinite(nLat) && Number.isFinite(nLng) && nLat >= 41.0 && nLat <= 42.9 && nLng >= 11.3 && nLng <= 14.0;
}

async function geocodeFieldLocation(rawInfo = {}) {
    const fromMaps = extractCoordinatesFromMapsUrl(rawInfo.mapsUrl || '');
    if (fromMaps && isWithinLazioBounds(fromMaps.lat, fromMaps.lng)) {
        return {
            lat: Number(fromMaps.lat.toFixed(6)),
            lng: Number(fromMaps.lng.toFixed(6))
        };
    }

    const rawComune = String(rawInfo.comune || rawInfo.luogo || '')
        .replace(/ANGUILLARALOC\.?[A-Z]*/gi, 'Anguillara Sabazia')
        .replace(/MAR\.?\s*S\.?\s*NICOLA/gi, 'Marina di San Nicola')
        .replace(/\bLOC\.?[A-Z0-9.]*/gi, '')
        .replace(/\s*\([A-Z]{2}\)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    const rawIndirizzo = String(rawInfo.indirizzo || '')
        .replace(/\bS\.?N\.?C\.?\b/gi, '')
        .replace(/\bKM\s*\d+(?:[.,]\d+)?\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    const rawImpianto = String(rawInfo.impianto || rawInfo.nome || '')
        .split('|').pop()
        .replace(/\b(?:SINTEX|SINTETICO|ERBA|TERRA|CAMPO\s+[A-Z0-9]|C11|C5|C8)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    const queries = [];
    const pushQ = q => {
        const clean = String(q || '').replace(/\s+/g, ' ').trim();
        if (clean.length >= 4 && !queries.includes(clean)) {
            queries.push(clean);
        }
    };

    if (rawIndirizzo && rawComune) {
        pushQ(`${rawIndirizzo}, ${rawComune}, Lazio, Italia`);
    }
    if (rawImpianto && rawComune) {
        pushQ(`Campo Sportivo ${rawImpianto}, ${rawComune}, Lazio, Italia`);
        pushQ(`${rawImpianto}, ${rawComune}, Lazio, Italia`);
    }
    if (rawComune) {
        pushQ(`Campo Sportivo ${rawComune}, Lazio, Italia`);
    }

    const normComune = normalizeText(rawComune);
    const comuneTokens = normComune.split(' ').filter(t => t.length >= 4);

    for (const q of queries) {
        try {
            const url = `https://photon.komoot.io/api/?limit=5&lat=42.0&lon=12.1&q=${encodeURIComponent(q)}`;
            const response = await fetch(url, { method: 'GET' });
            if (!response.ok) {
                continue;
            }
            const data = await response.json();
            const features = Array.isArray(data?.features) ? data.features : [];
            const validFeatures = features.filter(f => {
                const coords = f?.geometry?.coordinates;
                if (!Array.isArray(coords) || coords.length < 2) {
                    return false;
                }
                const lng = Number(coords[0]);
                const lat = Number(coords[1]);
                if (!isWithinLazioBounds(lat, lng)) {
                    return false;
                }
                if (comuneTokens.length) {
                    const p = f?.properties || {};
                    const hay = normalizeText([p.city, p.name, p.town, p.village, p.county, p.district, p.state].filter(Boolean).join(' '));
                    return comuneTokens.some(t => hay.includes(t));
                }
                return true;
            });
            if (!validFeatures.length) {
                continue;
            }

            const chosen = validFeatures[0];
            const [lng, lat] = chosen.geometry.coordinates;
            return {
                lat: Number(Number(lat).toFixed(6)),
                lng: Number(Number(lng).toFixed(6))
            };
        } catch {
            // try next query
        }
    }

    return null;
}

function findNearbyLuogoByCoords(coords) {
    if (!coords || !isWithinLazioBounds(coords.lat, coords.lng)) {
        return null;
    }
    return luoghiDb.find(item => {
        if (!hasValidMapCoords(item?.lat, item?.lng)) {
            return false;
        }
        return Math.abs(Number(item.lat) - Number(coords.lat)) < 0.0045
            && Math.abs(Number(item.lng) - Number(coords.lng)) < 0.0045;
    }) || null;
}

function scheduleAutoSyncRefereedMatches(delayMs = 600) {
    if (autoSyncRefereedTimer) {
        clearTimeout(autoSyncRefereedTimer);
    }
    autoSyncRefereedTimer = setTimeout(() => {
        autoSyncMapAndLogosFromRefereedMatches({ interactive: false });
    }, delayMs);
}

async function autoSyncMapAndLogosFromRefereedMatches(options = {}) {
    const interactive = Boolean(options?.interactive);
    if (isAutoSyncingRefereedMatches) {
        return;
    }
    isAutoSyncingRefereedMatches = true;

    const syncBtn = document.getElementById('syncRefereedMapBtn');
    if (syncBtn) {
        syncBtn.disabled = true;
        syncBtn.textContent = '⏳ Ricerca squadre, loghi e campi...';
    }

    try {
        const fb = window.matchMapFirebase;
        const user = getCurrentDashboardUser();

        if (!luoghiDb.length) {
            const cached = readEnrichedLuoghiCache();
            if (cached.length) {
                luoghiDb = cached;
            }
        }

        // Ripara eventuali voci corrotte o duplicate prima di qualsiasi sincronizzazione
        const repairedInitial = repairCorruptedLuoghiDatabase(luoghiDb);
        luoghiDb = repairedInitial.list;
        if (repairedInitial.changed) {
            pendingFirebaseLuoghiRepair = true;
        }

        // 1. Raccogli tutte le partite arbitrate da dashboardEvents, gmailPreviewItems e suggestions Firebase
        const allMatchRecords = [];
        dashboardEvents.forEach(ev => {
            if (ev && (ev.squadre || ev.locationText || ev.impianto || ev.luogo)) {
                allMatchRecords.push(ev);
            }
        });
        gmailPreviewItems.forEach(item => {
            if (item?.valid && item?.evento) {
                allMatchRecords.push(item.evento);
            }
        });

        if (user && fb?.ready && fb.db) {
            try {
                const sugSnap = await fb.db.ref('suggestions').once('value');
                if (sugSnap.exists()) {
                    const sugItems = Object.values(sugSnap.val() || {});
                    sugItems.forEach(s => {
                        const ext = s?.extracted || {};
                        if (ext.squadre || ext.locationText || ext.impianto || s?.team) {
                            allMatchRecords.push(sanitizeEventoLocation({
                                squadre: ext.squadre || s.team || '',
                                luogo: ext.luogo || '',
                                impianto: ext.impianto || '',
                                indirizzo: ext.indirizzo || '',
                                designazioneS4yRaw: ext.designazioneS4y || '',
                                locationText: ext.locationText || '',
                                mapsUrl: s.mapsUrl || '',
                                coordinates: s.coordinates || null
                            }));
                        }
                    });
                }
            } catch {
                // suggestions potrebbe non essere accessibile se non loggato
            }
        }

        let newFieldsAdded = 0;
        let updatedFieldsCount = 0;
        let logosResolvedCount = 0;

        // 2. Risolvi i loghi su Tuttocampo per tutte le squadre (casa e ospite) delle partite arbitrate
        //    Questo salva i loghi nella cache squadre per le card della Home Page senza alterare i pin della mappa!
        const uniqueTeams = new Set();
        allMatchRecords.forEach(ev => {
            const [teamA, teamB] = splitMatchTeams(ev?.squadre || '');
            if (teamA) uniqueTeams.add(teamA.trim());
            if (teamB) uniqueTeams.add(teamB.trim());
        });

        for (const teamName of uniqueTeams) {
            const info = await fetchTuttocampoTeamInfo(teamName);
            if (info?.logoUrl) {
                logosResolvedCount += 1;
            }
        }

        // 3. Collega l'impianto fisico in luoghiDb per ogni partita arbitrata
        //    IMPORTANTE: se il campo esiste già (es. Tarquinia o Ladispoli), NON aggiungiamo la squadra ospitata
        //    né il suo logo al pin del campo, perché una squadra può giocare su un campo neutro/prestato!
        for (const rawEv of allMatchRecords) {
            const ev = sanitizeEventoLocation(rawEv);
            const [teamA] = splitMatchTeams(ev.squadre || '');
            const homeTeam = String(teamA || '').trim();
            const hasLocationInfo = Boolean(ev.impianto || ev.indirizzo || ev.locationText);
            if (!hasLocationInfo) {
                continue;
            }

            const teamInfo = homeTeam ? await fetchTuttocampoTeamInfo(homeTeam) : null;
            const teamLogoOrScheda = teamInfo?.schedaUrl || teamInfo?.logoUrl || '';
            const designazioneS4y = buildDesignazioneS4y(ev);
            const cleanComune = formatTitleCaseLabel(
                String(ev.luogo || '')
                    .replace(/ANGUILLARALOC\.?[A-Z]*/gi, 'Anguillara Sabazia')
                    .replace(/\s*\([A-Z]{2}\)\s*$/i, '')
                    .trim()
            );

            let existing = findExistingLuogoForEvento(ev);

            if (!existing) {
                const candidateCoords = (rawEv.coordinates && isWithinLazioBounds(rawEv.coordinates.lat, rawEv.coordinates.lng))
                    ? rawEv.coordinates
                    : await geocodeFieldLocation({
                        impianto: ev.impianto,
                        indirizzo: ev.indirizzo,
                        comune: cleanComune,
                        mapsUrl: rawEv.mapsUrl
                    });
                if (candidateCoords) {
                    existing = findNearbyLuogoByCoords(candidateCoords);
                }
                if (!existing && candidateCoords && isWithinLazioBounds(candidateCoords.lat, candidateCoords.lng)) {
                    const prettyHome = teamInfo?.matchedLabel || formatTitleCaseLabel(homeTeam);
                    const prettyImpianto = formatTitleCaseLabel(ev.impianto);
                    let fieldTitle = '';
                    if (prettyHome && prettyImpianto && scoreTeamLabelMatch(prettyHome, prettyImpianto) < 120) {
                        fieldTitle = `${prettyHome} | ${prettyImpianto}`;
                    } else {
                        fieldTitle = prettyHome || prettyImpianto || cleanComune || 'Campo Sportivo';
                    }

                    const mapsUrl = `https://www.google.com/maps?q=${candidateCoords.lat},${candidateCoords.lng}`;
                    const aliases = filterCleanAliases([
                        homeTeam,
                        prettyHome,
                        ev.impianto,
                        prettyImpianto,
                        ev.indirizzo,
                        ev.locationText
                    ]);

                    luoghiDb.push({
                        nome: fieldTitle,
                        team: prettyHome || homeTeam,
                        comune: cleanComune,
                        indirizzo: formatTitleCaseLabel(ev.indirizzo || ''),
                        lat: candidateCoords.lat,
                        lng: candidateCoords.lng,
                        mapsUrl,
                        logoUrl: teamLogoOrScheda,
                        aliases,
                        designazioneS4y: designazioneS4y ? [designazioneS4y] : []
                    });
                    newFieldsAdded += 1;
                    continue;
                }
            }

            if (existing) {
                let touched = false;

                // Aggiorna solo designazioneS4y e alias fisici dell'impianto (MAI cambiare nome/team/logoUrl del campo esistente!)
                if (designazioneS4y && !luogoHasDesignazioneKey(existing, designazioneS4y)) {
                    const currentS4y = Array.isArray(existing.designazioneS4y)
                        ? [...existing.designazioneS4y]
                        : (existing.designazioneS4y ? [String(existing.designazioneS4y)] : []);
                    currentS4y.push(designazioneS4y);
                    existing.designazioneS4y = currentS4y;
                    touched = true;
                }

                const currentAliases = filterCleanAliases(getLuogoAliases(existing));
                const physicalAliases = filterCleanAliases([
                    ev.impianto || '',
                    ev.indirizzo || '',
                    ev.locationText || ''
                ]);

                physicalAliases.forEach(al => {
                    if (!currentAliases.some(a => normalizeText(a) === normalizeText(al))) {
                        currentAliases.push(al);
                        touched = true;
                    }
                });
                existing.aliases = currentAliases;

                if (!existing.indirizzo && ev.indirizzo) {
                    existing.indirizzo = formatTitleCaseLabel(ev.indirizzo);
                    touched = true;
                }
                if (!existing.comune && cleanComune) {
                    existing.comune = cleanComune;
                    touched = true;
                }

                if (touched) {
                    updatedFieldsCount += 1;
                }
            }
        }

        // 5. Salva nella cache locale e, se admin loggato, direttamente su Firebase RTDB ('luoghi')
        writeEnrichedLuoghiCache(luoghiDb);
        if ((pendingFirebaseLuoghiRepair || newFieldsAdded > 0 || updatedFieldsCount > 0) && user && isDashboardAdmin(user) && fb?.ready && fb.db) {
            try {
                await fb.db.ref('luoghi').set(luoghiDb);
                pendingFirebaseLuoghiRepair = false;
            } catch (err) {
                console.warn('Salvataggio luoghi su Firebase non riuscito:', err?.message);
            }
        }

        // 6. Ricarica la mappa e le card della Home Page collegate
        renderLuoghiMap();
        renderMapSearchSuggestions();
        if (dashboardEvents.length) {
            renderDashboardEvents();
        }
        if (gmailPreviewItems.length) {
            renderGmailPreviewList();
        }

        if (interactive) {
            const totalMatches = allMatchRecords.length;
            showDashboardToast(
                `Mappa e Home sincronizzate (${totalMatches} gare analizzate, +${newFieldsAdded} nuovi campi, ${updatedFieldsCount} aggiornati, ${logosResolvedCount} loghi).`,
                'ok'
            );
        }
    } catch (error) {
        if (interactive) {
            showDashboardToast(`Errore sincronizzazione campi: ${error.message}`, 'err');
        }
    } finally {
        isAutoSyncingRefereedMatches = false;
        if (syncBtn) {
            syncBtn.disabled = false;
            syncBtn.textContent = '🔄 Sincronizza Squadre e Campi Arbitrati';
        }
    }
}


function setSuggestionStatus(message, isOk = false) {
    const statusEl = document.getElementById('suggestionStatus');
    if (!statusEl) {
        return;
    }
    statusEl.textContent = message;
    statusEl.style.color = isOk ? '#6ee7b7' : '#9fb2dd';
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
    const notFoundMessage = 'Campo non ancora presente: ho pre-compilato il modulo qui sotto per segnalarlo velocemente!';
    const query = (document.getElementById('mapQuickSearchInput')?.value || '').trim();
    if (!query) {
        setSuggestionStatus('Inserisci campo/squadra/via nella barra sopra la mappa.');
        return;
    }
    hideMapSearchSuggestions();

    const trySearch = async () => {
        const bestMatch = preselectedMatch || findBestLuogoForMapSearch(query);
        if (!bestMatch || !hasValidMapCoords(bestMatch?.lat, bestMatch?.lng)) {
            const titleEl = document.getElementById('suggestTitle');
            const teamEl = document.getElementById('suggestTeam');
            const mapsEl = document.getElementById('suggestMaps');
            if (titleEl && !titleEl.value.trim()) {
                titleEl.value = `Nuovo campo: ${query}`;
            }
            if (teamEl && !teamEl.value.trim()) {
                teamEl.value = query;
            }
            setSuggestionStatus(notFoundMessage);
            mapsEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            mapsEl?.focus();
            return;
        }

        const lat = getNumericCoord(bestMatch.lat);
        const lng = getNumericCoord(bestMatch.lng);
        await ensureLeafletLoaded().catch(() => null);
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
