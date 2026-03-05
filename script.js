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

function parseDesignazione(testo) {
    const dataRegex = /(\d{2}\/\d{2}\/\d{4})/i;
    const oraRegex = /alle ore\s*(\d{2}:\d{2})/i;
    const luogoRegex = /a\s+(.+?)\s+sull['’]impianto/i;
    const impiantoRegex = /sull['’]impianto\s+(.+?)\s+sito in/i;
    const indirizzoRegex = /sito in\s+([^\r\n]+)/i;
    const squadreRegex = /tra\s*[\r\n]+([^\r\n]+)\s*[\r\n]+/i;
    const categoriaRegex = /(U\d+\s[\w\s]+MASCHILE)/i;
    const garaNumeroRegex = /gara\s*n\.?\s*(\d+)/i;
    const gironeRegex = /girone\s+([A-Z0-9]+)/i;
    const arbitroRegex = /^([A-Z\s'`]+),\s*sei designato/i;
    const rimborsoRegex = /Rimborso:\s*(\d+)\s*[€\u20AC]/i;
    const kmRegex = /\((\d+)\s*Km\)/i;

    const luogo = testo.match(luogoRegex)?.[1]?.trim() || '';
    const impianto = testo.match(impiantoRegex)?.[1]?.trim() || '';
    const indirizzo = testo.match(indirizzoRegex)?.[1]?.trim() || '';
    const locationText = [luogo, impianto, indirizzo].filter(Boolean).join(', ');

    return {
        data: testo.match(dataRegex)?.[1]?.trim() || '',
        ora: testo.match(oraRegex)?.[1]?.trim() || '',
        luogo,
        impianto,
        indirizzo,
        locationText,
        squadre: testo.match(squadreRegex)?.[1]?.trim() || '',
        categoria: testo.match(categoriaRegex)?.[1]?.trim() || '',
        garaNumero: testo.match(garaNumeroRegex)?.[1]?.trim() || '',
        girone: testo.match(gironeRegex)?.[1]?.trim() || '',
        arbitro: testo.match(arbitroRegex)?.[1]?.trim() || '',
        rimborso: Number(testo.match(rimborsoRegex)?.[1] || 0),
        km: Number(testo.match(kmRegex)?.[1] || 0)
    };
}

function buildEventFingerprint(evento) {
    const keyParts = [
        evento.garaNumero || '',
        evento.data || '',
        evento.ora || '',
        evento.squadre || '',
        evento.categoria || '',
        evento.luogo || '',
        evento.impianto || ''
    ];
    return normalizeText(keyParts.join('|'));
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

    // Se il luogo e gia riconosciuto nel DB campi non serve segnalazione.
    const existingMatch = findLuogoDbMatch(evento.locationText);
    if (existingMatch) {
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
            indirizzo: evento.indirizzo || ''
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

function getCurrentDashboardUser() {
    const { fb } = getDashboardAuthState();
    return fb?.ready && fb.auth ? fb.auth.currentUser : null;
}

function computeTotalRimborso() {
    return dashboardEvents.reduce((sum, e) => sum + Number(e.rimborso || 0), 0);
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
    const row = document.createElement('tr');
    row.innerHTML = `
            <td>${evento.data}</td>
            <td>${evento.ora}</td>
            <td>${evento.squadre}</td>
            <td>${evento.categoria}</td>
            <td>${evento.rimborso} \u20AC</td>
            <td>
                <a class="icon-link maps-link" target="_blank" rel="noopener noreferrer" href="${mapsUrl}" title="Apri su Google Maps" aria-label="Apri su Google Maps">
                    <img src="img/maps.png" alt="Google Maps">
                </a>
            </td>
            <td>
                <a class="icon-link calendar-link" target="_blank" rel="noopener noreferrer" href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(calendarText)}&dates=${formatDataGoogle(evento.data, evento.ora)}&details=${encodeURIComponent(calendarDetails)}&location=${encodeURIComponent(evento.locationText)}" title="Aggiungi a Google Calendar" aria-label="Aggiungi a Google Calendar">
                    <img src="img/calendar.svg" alt="Google Calendar">
                </a>
            </td>
            <td>
                <button type="button" class="event-remove-btn" onclick="removeDashboardEvent(${item.index})" aria-label="Elimina evento" title="Elimina evento">
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M3 6h18"></path>
                        <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path>
                        <path d="M19 6l-1 14a1 1 0 0 1-1 .93H7a1 1 0 0 1-1-.93L5 6"></path>
                        <path d="M10 11v6"></path>
                        <path d="M14 11v6"></path>
                    </svg>
                </button>
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

    const total = computeTotalRimborso();
    const totalEl = document.getElementById('rimborsoTotale');
    if (totalEl) {
        totalEl.textContent = `Rimborso totale: ${total} \u20AC`;
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
        navigator.serviceWorker.register('./service-worker.js').then(registration => {
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
    renderDashboardEvents();
    await persistDashboardEvents();
}

async function persistDashboardEvents() {
    const user = getCurrentDashboardUser();
    if (user) {
        const { fb } = getDashboardAuthState();
        try {
            await fb.db.ref(`users/${user.uid}/dashboard/events`).set(dashboardEvents);
            return;
        } catch (error) {
            console.warn('Errore salvataggio cloud dashboard:', error.message);
        }
    }

    localStorage.setItem(GUEST_EVENTS_STORAGE_KEY, JSON.stringify(dashboardEvents));
}

async function loadDashboardEvents() {
    const user = getCurrentDashboardUser();
    if (user) {
        const { fb } = getDashboardAuthState();
        try {
            const snap = await fb.db.ref(`users/${user.uid}/dashboard/events`).once('value');
            const raw = snap.exists() ? snap.val() : [];
            dashboardEvents = Array.isArray(raw) ? raw : Object.values(raw || {});
            renderDashboardEvents();
            return;
        } catch (error) {
            console.warn('Errore lettura cloud dashboard:', error.message);
        }
    }

    try {
        const raw = JSON.parse(localStorage.getItem(GUEST_EVENTS_STORAGE_KEY) || '[]');
        dashboardEvents = Array.isArray(raw) ? raw : [];
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

    dashboardEvents.push(evento);
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
    const setSelection = (value) => {
        const selected = options.find(x => String(x.value) === String(value)) || options[0];
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
        setSelection(value);
        closeMenu();
    };

    document.addEventListener('click', event => {
        if (!customWrap.contains(event.target)) {
            closeMenu();
        }
    });

    setSelection(select.value || 'all');
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
    const email = document.getElementById('userEmail')?.value?.trim();
    const password = document.getElementById('userPassword')?.value || '';
    const fb = window.matchMapFirebase;
    if (!fb?.ready || !fb.auth) {
        setDashboardAuthStatus('Firebase non disponibile.');
        return;
    }
    if (!email || !password) {
        setDashboardAuthStatus('Inserisci email e password.');
        return;
    }
    try {
        await fb.auth.createUserWithEmailAndPassword(email, password);
        setDashboardAuthStatus(`Registrato e autenticato: ${email}`, true);
    } catch (error) {
        setDashboardAuthStatus(`Registrazione fallita: ${error.message}`);
    }
}

async function loginDashboardUser() {
    const email = document.getElementById('userEmail')?.value?.trim();
    const password = document.getElementById('userPassword')?.value || '';
    const fb = window.matchMapFirebase;
    if (!fb?.ready || !fb.auth) {
        setDashboardAuthStatus('Firebase non disponibile.');
        return;
    }
    if (!email || !password) {
        setDashboardAuthStatus('Inserisci email e password.');
        return;
    }
    try {
        await fb.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        await fb.auth.signInWithEmailAndPassword(email, password);
        setDashboardAuthStatus(`Login effettuato: ${email}`, true);
    } catch (error) {
        setDashboardAuthStatus(`Login fallito: ${error.message}`);
    }
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
        setDashboardAuthStatus('Logout effettuato. Modalita ospite attiva.');
        await loadDashboardEvents();
    } catch (error) {
        setDashboardAuthStatus(`Logout fallito: ${error.message}`);
    }
}

function initDashboardAuth() {
    const fb = window.matchMapFirebase;
    setPublisherAdminLinkVisible(false);
    if (!fb?.ready || !fb.auth) {
        setDashboardAuthStatus('Modalita ospite attiva (Firebase non disponibile).');
        loadDashboardEvents();
        return;
    }

    fb.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    fb.auth.onAuthStateChanged(async user => {
        if (!user) {
            setDashboardAuthStatus('Modalita ospite attiva.');
            setPublisherAdminLinkVisible(false);
        } else if (isDashboardAdmin(user)) {
            setDashboardAuthStatus(`Connesso come ${user.email}`, true);
            setPublisherAdminLinkVisible(true);
        } else {
            setDashboardAuthStatus(`Connesso come ${user.email} (no admin).`);
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
window.logoutDashboardUser = logoutDashboardUser;
window.removeDashboardEvent = removeDashboardEvent;
window.submitUserSuggestion = submitUserSuggestion;
window.searchSuggestionPlace = searchSuggestionPlace;
window.searchMapPlaceFromBar = searchMapPlaceFromBar;
window.toggleDashboardShowMore = toggleDashboardShowMore;

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
    renderNews('all');
    renderPaymentsTable();
});
initDashboardAuth();
setupAuthPopover();
ensureDashboardEventAutoRefresh();
registerServiceWorker();
setupInstallApp();

