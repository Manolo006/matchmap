/* ============================================================================
 * MatchMap - Gmail Sync, S4Y Parser & Team Logos (js/gmail-designazioni.js)
 * ============================================================================ */

/* PARSING DESIGNAZIONE */
const GUEST_EVENTS_STORAGE_KEY = 'matchmap_guest_dashboard_events_v1';
let dashboardEvents = [];
let dashboardShowAllHidden = false;
let dashboardEventAutoRefreshTimer = null;
const SUGGESTION_COOLDOWN_KEY = 'matchmap_last_suggestion_ts_v1';
const GMAIL_TOKEN_CACHE_KEY = 'matchmap_gmail_token_cache_v1';
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

function saveGmailTokenCache(token, expiresAt) {
    gmailAccessToken = String(token || '').trim();
    gmailTokenExpiresAt = Number(expiresAt || 0);
    try {
        if (gmailAccessToken && gmailTokenExpiresAt > Date.now()) {
            localStorage.setItem(GMAIL_TOKEN_CACHE_KEY, JSON.stringify({
                accessToken: gmailAccessToken,
                expiresAt: gmailTokenExpiresAt
            }));
        } else {
            localStorage.removeItem(GMAIL_TOKEN_CACHE_KEY);
        }
    } catch {
        // ignore storage errors
    }
}

function loadGmailTokenCache() {
    try {
        const raw = JSON.parse(localStorage.getItem(GMAIL_TOKEN_CACHE_KEY) || 'null');
        const token = String(raw?.accessToken || '').trim();
        const expiresAt = Number(raw?.expiresAt || 0);
        if (token && Date.now() < (expiresAt - 10000)) {
            gmailAccessToken = token;
            gmailTokenExpiresAt = expiresAt;
            return true;
        }
        localStorage.removeItem(GMAIL_TOKEN_CACHE_KEY);
    } catch {
        // ignore storage errors
    }
    return false;
}

loadGmailTokenCache();

function getGmailUiRefs() {
    return {
        queryInput: document.getElementById('gmailQueryInput'),
        statusEl: document.getElementById('gmailStatus'),
        badgeEl: document.getElementById('gmailBadgeStatus'),
        connectBtn: document.getElementById('gmailConnectBtn'),
        disconnectBtn: document.getElementById('gmailDisconnectBtn'),
        loadBtn: document.getElementById('gmailLoadBtn'),
        previewWrap: document.getElementById('gmailPreviewWrap'),
        previewList: document.getElementById('gmailPreviewList'),
        importBtn: document.getElementById('gmailImportSelectedBtn'),
        selectAllBtn: document.getElementById('gmailSelectAllBtn'),
        autoSyncBtn: document.getElementById('gmailAutoSyncBtn'),
        syncInnerBtn: document.getElementById('gmailSyncInnerBtn')
    };
}

function isGmailTokenValid() {
    if (!gmailAccessToken || Date.now() >= (gmailTokenExpiresAt - 5000)) {
        loadGmailTokenCache();
    }
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

function upgradeGmailQueryWindow(rawQuery) {
    const q = String(rawQuery || GMAIL_DEFAULT_QUERY).trim() || GMAIL_DEFAULT_QUERY;
    return q.replace(/\bnewer_than:(?:180|365)d\b/gi, 'newer_than:730d');
}

function readGmailIntegrationPrefs() {
    try {
        const raw = JSON.parse(localStorage.getItem(GMAIL_INTEGRATION_STORAGE_KEY) || '{}');
        return {
            enabled: Boolean(raw?.enabled),
            query: upgradeGmailQueryWindow(raw?.query),
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
        query: upgradeGmailQueryWindow(gmailIntegrationPrefs?.query),
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
            query: upgradeGmailQueryWindow(gmailIntegrationPrefs?.query),
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
                    query: upgradeGmailQueryWindow(cloud?.query || local.query),
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
        query: upgradeGmailQueryWindow(merged.query),
        linkedEmail: String(merged.linkedEmail || '').trim(),
        updatedAt: Number(merged.updatedAt || 0)
    };

    const { queryInput } = getGmailUiRefs();
    if (queryInput) {
        queryInput.value = gmailIntegrationPrefs.query || GMAIL_DEFAULT_QUERY;
    }
    loadGmailTokenCache();
    updateGmailUiState();
    if (gmailIntegrationPrefs.enabled && isGmailTokenValid()) {
        autoSyncGmailDesignazioni({ silent: true });
    }
}

async function restoreGmailSessionSilently() {
    loadGmailTokenCache();
    updateGmailUiState();
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
        .replace(/<\/(?:tr|p|div|li|h[1-6])>|<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .trim();
}

function cleanEmailFieldNoise(rawValue) {
    return String(rawValue || '')
        .replace(/\b(?:Attivit[àa]|Comitato\/Delegazione|Categoria|Girone|Giornata|Numero\s+Gara|Gara|Data|Ora|Campo|Indirizzo|Localit[àa]|Provincia|Distanza\s*\(\s*km\s*\)|Rimborso\s+Totale(?:\s*\(\s*€\s*\))?)\s*:[\s\S]*$/i, '')
        .replace(/\b(?:Accedi\s+a\s+(?:\[?\s*Sinfonia4You|http)|EMAIL\s+GENERATA\s+AUTOMATICAMENTE|Operazione\s+processata\s+il)\b[\s\S]*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatLuogoWithProvincia(rawLocalita, rawProvincia = '') {
    const rawLocStr = String(rawLocalita || '');
    const inlineProv = rawLocStr.match(/\bProvincia\s*:\s*([A-Z]{2})\b/i)?.[1]?.toUpperCase() || '';
    let luogoClean = cleanEmailFieldNoise(rawLocStr);
    if (!luogoClean) {
        return '';
    }
    const dashParts = luogoClean.split(/\s*-\s*/).map(x => x.trim()).filter(Boolean);
    if (dashParts.length === 2 && normalizeText(dashParts[0]) === normalizeText(dashParts[1])) {
        luogoClean = dashParts[0];
    }
    const provClean = cleanEmailFieldNoise(rawProvincia || inlineProv).toUpperCase();
    if (/^[A-Z]{2}$/.test(provClean) && !new RegExp(`\\(\\s*${provClean}\\s*\\)$`, 'i').test(luogoClean)) {
        luogoClean = `${luogoClean} (${provClean})`;
    }
    return luogoClean;
}

function sanitizeEventoLocation(evento) {
    const item = { ...(evento || {}) };
    const rawLuogo = String(item.luogo || '');
    const rawLocationText = String(item.locationText || '');
    const inlineProv = (rawLuogo.match(/\bProvincia\s*:\s*([A-Z]{2})\b/i)
        || rawLocationText.match(/\bProvincia\s*:\s*([A-Z]{2})\b/i))?.[1]?.toUpperCase() || '';

    const cleanLuogo = formatLuogoWithProvincia(rawLuogo, item.provincia || inlineProv);
    const cleanImpianto = cleanEmailFieldNoise(item.impianto || '');
    const cleanIndirizzo = cleanEmailFieldNoise(item.indirizzo || '');

    item.luogo = cleanLuogo;
    item.impianto = cleanImpianto;
    item.indirizzo = cleanIndirizzo;

    const rebuiltLocation = [cleanLuogo, cleanImpianto, cleanIndirizzo].filter(Boolean).join(', ').trim();
    item.locationText = rebuiltLocation || cleanEmailFieldNoise(rawLocationText);
    return item;
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
    const item = sanitizeEventoLocation(evento);
    if (!item.ora) {
        const fallback = String(item._gmailDate || '').match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
        item.ora = fallback ? `${fallback[1]}:${fallback[2]}` : '';
    }
    item.rimborso = Number(item.rimborso || 0);
    item.km = Number(item.km || 0);
    return item;
}

function extractSquadreFromSubject(subject) {
    const raw = String(subject || '').trim();
    if (!raw) {
        return '';
    }
    const cleaned = raw
        .replace(/^\[[^\]]+\]\s*/i, '')
        .replace(/^(?:notifica\s+di\s+)?designazione(?:\s+gara\s*n\.?\s*\d+)?(?:\s+del\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)?\s*:\s*/i, '')
        .replace(/^variazione(?:\s+designazione)?(?:\s+gara\s*n\.?\s*\d+)?\s*:\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    const m = cleaned.match(/^(.+?)\s*(?:-|–|—|vs\.?)\s*(.+)$/i);
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

function isAiaSender(fromHeader) {
    const raw = String(fromHeader || '').toLowerCase();
    if (!raw) {
        return false;
    }
    // Riconosce abbreviazioni come "a.i.a." -> "aia" evitando parole casuali
    const normalizedAia = raw.replace(/\ba\.i\.a\.?\b/gi, 'aia');
    const clean = normalizedAia.replace(/[\.\-_]/g, ' ');

    // 1. Contiene 'aia' come parola separata (es. "Sezione A.I.A.", "AIA Civitavecchia", "AIA Roma 1")
    const hasAiaWord = /\baia\b/.test(clean);
    // 2. Contiene il dominio o prefisso aia (tutte le sezioni d'Italia usano @aia-figc.it oppure sezione.aia.*@gmail.com / aia*@...)
    const hasAiaEmail = /@(?:[a-z0-9-]+\.)*aia(?:-figc)?\.[a-z]{2,}/i.test(raw)
        || /(?:^|[^a-z0-9])aia[a-z0-9._-]*@/i.test(raw)
        || /@aia-figc\.it/i.test(raw);
    // 3. Piattaforme ufficiali FIGC/Sinfonia4You o caselle designazioni
    const hasAiaPlatform = /sinfonia4you|servizisportivi|@.*figc\.it|designaz/i.test(raw);
    // 4. CRA (Comitati Regionali Arbitri)
    const hasCra = /\bcra\b/.test(clean) || /(?:^|[^a-z0-9])cra[a-z0-9._-]*@/i.test(raw);

    return Boolean(hasAiaWord || hasAiaEmail || hasAiaPlatform || hasCra);
}

function isAiaEventOrCircular(subject, snippet = '', body = '') {
    const subjectClean = normalizeText(subject || '');
    const fullClean = normalizeText(`${subject || ''} ${snippet || ''} ${String(body || '').slice(0, 1000)}`);
    if (!fullClean) {
        return false;
    }

    // Parole chiave che identificano eventi amministrativi o riunioni da scartare
    const eventKeywords = [
        /\brto\b/,
        /\briunione\b/,
        /\briunioni\b/,
        /\bassemblea\b/,
        /\bconvocazione\b/,
        /\bpolo\s+(?:sezionale|atletico|di\s+allenamento)\b/,
        /\ballenament/,
        /\btest\s+atletic/,
        /\byo\s*yo\b/,
        /\bvisita\s+medica\b/,
        /\bvisite\s+mediche\b/,
        /\bcertificat[oi]\s+medic/,
        /\bquota\s+(?:sezionale|associativa)\b/,
        /\bquote\s+(?:sezionali|associative)\b/,
        /\bbollettin/,
        /\bcomunicato\s+ufficiale\b/,
        /\bcircolar/,
        /\bcorso\s+arbitr/,
        /\blezion[ei]\s+corso\b/,
        /\bcena\s+(?:sezionale|di\s+natale|degli\s+auguri|di\s+fine\s+anno)\b/,
        /\bpranzo\s+(?:sezionale|degli\s+auguri)\b/,
        /\btorneo\s+sezionale\b/,
        /\bfesta\s+sezionale\b/,
        /\bauguri\s+di\b/,
        /\bbuone\s+feste\b/,
        /\bbuon\s+natale\b/,
        /\bbuona\s+pasqua\b/,
        /\bcondoglianz/,
        /\blutto\s+sezionale\b/
    ];

    // Se l'oggetto della mail è una riunione/assemblea/circolare, scarta tassativamente
    const subjectIsEvent = eventKeywords.some(rx => rx.test(subjectClean));
    if (subjectIsEvent) {
        return true;
    }

    // Se l'evento è citato nel corpo, verifica che non sia in realtà una designazione con promemoria
    const textIsEvent = eventKeywords.some(rx => rx.test(fullClean));
    if (textIsEvent) {
        const hasMatchClues = /\b(tra|gara\s*n|numero\s+gara|squadre|arbitro\s+effettivo|assistente\s+n|sei\s+designato)\b/.test(fullClean)
            && /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(fullClean);
        if (hasMatchClues) {
            return false;
        }
        return true;
    }

    return false;
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
        const extraCampo = cleanEmailFieldNoise(sourceMetaText.match(/\bcampo\s*:\s*([^\r\n]+)/i)?.[1] || '');
        const extraIndirizzo = cleanEmailFieldNoise(sourceMetaText.match(/\bindirizzo\s*:\s*([^\r\n]+)/i)?.[1] || '');
        const extraLocalita = sourceMetaText.match(/\blocalit[àa]\s*:\s*([^\r\n]+)/i)?.[1] || '';
        const extraProvincia = cleanEmailFieldNoise(sourceMetaText.match(/\bprovincia\s*:\s*([A-Z]{2})\b/i)?.[1] || '');
        evento.impianto = evento.impianto || extraCampo;
        evento.indirizzo = evento.indirizzo || extraIndirizzo;
        evento.luogo = evento.luogo || formatLuogoWithProvincia(extraLocalita, extraProvincia);
        evento.locationText = [evento.luogo, evento.impianto, evento.indirizzo].filter(Boolean).join(', ').trim();
    }

    const isEvent = isAiaEventOrCircular(subject, snippet, sourceText);
    const hasData = Boolean(evento.data);
    const hasTeams = Boolean(evento.squadre && (evento.squadre.includes('-') || evento.squadre.length >= 5));
    const hasGaraNumero = Boolean(evento.garaNumero);

    // Valida per importazione se non è evento/circolare ed ha data e (squadre oppure numero gara)
    const valid = !isEvent && Boolean(hasData && (hasTeams || hasGaraNumero));

    return {
        id: String(message?.id || ''),
        selected: valid,
        valid,
        isEvent,
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
    const subject = meta.subject || '';
    const from = meta.from || '';
    const snippet = meta.snippet || '';

    // 1. Se è classificata come riunione, assemblea, polo atletico o circolare, scarta tassativamente
    if (isAiaEventOrCircular(subject, snippet, evento?.designazioneS4yRaw || '')) {
        return false;
    }

    // 2. Controllo se il mittente è AIA di qualunque sezione d'Italia
    const fromAia = isAiaSender(from);
    const hay = normalizeText(`${subject} ${from} ${snippet}`);
    const hasDesignazioneWords = /\b(designazione|designazioni|designato|designata|gara n|notifica di designazione|variazione|arbitro effettivo|assistente n)\b/i.test(hay);
    const hasMatchStructure = Boolean(evento?.data && (evento?.squadre || evento?.garaNumero));

    // Se proviene da un'AIA: basta che abbia termini di designazione o una struttura partita estratta
    if (fromAia) {
        return hasDesignazioneWords || hasMatchStructure;
    }

    // Mittente non esplicitamente riconosciuto come AIA: richiede entrambi per evitare spam
    return hasDesignazioneWords && hasMatchStructure;
}

function splitMatchTeams(squadreText) {
    const raw = String(squadreText || '').trim();
    if (!raw) {
        return ['', ''];
    }
    const parts = raw.split(/\s*(?:-|–|—|vs\.?|v\.?s\.?|\/)\s*/i).map(x => x.trim()).filter(Boolean);
    if (parts.length >= 2) {
        return [parts[0], parts[1]];
    }
    return [raw, ''];
}

const GENERIC_TEAM_LOGO_WORDS = new Set([
    'calcio', 'football', 'club', 'asd', 'ssd', 'usd', 'pol', 'polisportiva',
    'sporting', 'citta', 'campo', 'ac', 'fc', 'as', 'ss', 'us', 'di', 'del', 'della',
    'san', 'santa', 'sant', 'nuova', 'real', 'vis', 'pro', 'academy', 'scuola',
    'giovanili', 'boys', 'atletico', 'virtus', 'unione', 'sportiva', 'calcistica',
    'dilettantistica', 'associazione', 'giovanile', 'soccer', 'team', 'united'
]);

let dynamicTeamLogoCache = (() => {
    try {
        const raw = JSON.parse(localStorage.getItem(DYNAMIC_TEAM_LOGO_CACHE_KEY) || '{}');
        return (raw && typeof raw === 'object') ? raw : {};
    } catch {
        return {};
    }
})();
const pendingTeamLogoLookups = new Set();
let autoSyncRefereedTimer = null;
let isAutoSyncingRefereedMatches = false;

function saveDynamicTeamLogoCache() {
    try {
        localStorage.setItem(DYNAMIC_TEAM_LOGO_CACHE_KEY, JSON.stringify(dynamicTeamLogoCache));
    } catch {
        // ignore storage quota errors
    }
}

const debouncedRefreshTeamLogosUi = debounce(() => {
    if (dashboardEvents.length) {
        renderDashboardEvents();
    }
    if (gmailPreviewItems.length) {
        renderGmailPreviewList();
    }
}, 220);

function extractTuttocampoTeamSlug(rawUrl) {
    const match = String(rawUrl || '').match(/\/Squadra\/([^/]+)\/\d+/i);
    if (!match) {
        return '';
    }
    const spaced = match[1]
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-zA-Z])(\d)/g, '$1 $2')
        .replace(/(\d)([a-zA-Z])/g, '$1 $2');
    return normalizeText(spaced);
}

function scoreTeamLabelMatch(teamName, candidateLabel) {
    const normTarget = normalizeText(teamName);
    const normCand = normalizeText(candidateLabel);
    if (!normTarget || !normCand) {
        return 0;
    }

    const compactTarget = normTarget.replace(/\s+/g, '');
    const compactCand = normCand.replace(/\s+/g, '');
    let score = 0;

    if (compactTarget === compactCand) {
        score += 300;
    } else if (compactTarget.length >= 4 && compactCand.length >= 4 && (compactCand.includes(compactTarget) || compactTarget.includes(compactCand))) {
        score += 180;
    } else if (normCand === normTarget) {
        score += 260;
    } else if (normTarget.length >= 4 && normCand.length >= 4 && (normCand.includes(normTarget) || normTarget.includes(normCand))) {
        score += 140;
    }

    const targetTokens = normTarget.split(' ').filter(t => t.length >= 3 && !GENERIC_TEAM_LOGO_WORDS.has(t));
    const candTokens = normCand.split(' ').filter(t => t.length >= 3 && !GENERIC_TEAM_LOGO_WORDS.has(t));
    targetTokens.forEach(token => {
        if (candTokens.includes(token)) {
            score += 55;
        } else if (token.length >= 4 && candTokens.some(ct => ct.length >= 4 && (ct.includes(token) || token.includes(ct)))) {
            score += 30;
        }
    });

    return score;
}

function extractLogoCandidateFromLuogo(entry, teamName = '') {
    const raw = entry?.loghiUrl ?? entry?.logoUrl ?? entry?.logo ?? '';
    const explicitRaw = Array.isArray(raw) ? raw.join(',') : String(raw || '');
    const parts = explicitRaw
        .split(/[,;\n]+/)
        .map(x => x.trim())
        .filter(Boolean);
    if (!parts.length) {
        return '';
    }

    const resolveSingleUrl = urlPart => {
        const tuttocampoCandidates = buildTuttocampoLogoCandidates(urlPart);
        return tuttocampoCandidates[0] || urlPart;
    };

    if (!String(teamName || '').trim()) {
        return resolveSingleUrl(parts[0]);
    }

    const nameSegments = String(entry?.team || entry?.squadra || entry?.nome || '')
        .split('|')[0]
        .split('/')
        .map(x => x.trim())
        .filter(Boolean);

    const bestMatchingSegment = nameSegments
        .map(seg => ({ seg, score: scoreTeamLabelMatch(teamName, seg) }))
        .sort((a, b) => b.score - a.score)[0];
    const effectiveSegment = (bestMatchingSegment && bestMatchingSegment.score >= 50)
        ? bestMatchingSegment.seg
        : '';

    if (parts.length === 1) {
        const singleSlug = extractTuttocampoTeamSlug(parts[0]);
        if (singleSlug) {
            const directScore = scoreTeamLabelMatch(teamName, singleSlug);
            const segScore = effectiveSegment ? scoreTeamLabelMatch(effectiveSegment, singleSlug) : 0;
            if (Math.max(directScore, segScore) < 45 && nameSegments.length <= 1) {
                return '';
            }
        }
        return resolveSingleUrl(parts[0]);
    }

    let bestPart = parts[0];
    let bestScore = -1;

    parts.forEach((part, idx) => {
        const slugLabel = extractTuttocampoTeamSlug(part);
        const directSlugScore = scoreTeamLabelMatch(teamName, slugLabel);
        const bridgedSlugScore = (effectiveSegment && slugLabel)
            ? scoreTeamLabelMatch(effectiveSegment, slugLabel)
            : 0;
        const positionalScore = (!slugLabel && nameSegments[idx])
            ? scoreTeamLabelMatch(teamName, nameSegments[idx])
            : 0;
        const total = Math.max(directSlugScore, bridgedSlugScore, positionalScore);
        if (total > bestScore) {
            bestScore = total;
            bestPart = part;
        }
    });

    return resolveSingleUrl(bestPart);
}

function findBestLogoEntryForTeam(teamName) {
    const norm = normalizeText(teamName);
    if (!norm) {
        return null;
    }

    let best = null;
    let bestScore = 0;

    luoghiDb.forEach(item => {
        const rawLogo = item?.loghiUrl ?? item?.logoUrl ?? item?.logo ?? '';
        const logoParts = (Array.isArray(rawLogo) ? rawLogo.join(',') : String(rawLogo || ''))
            .split(/[,;\n]+/)
            .map(x => x.trim())
            .filter(Boolean);
        if (!logoParts.length) {
            return;
        }

        const rawName = String(item?.team || item?.squadra || item?.nome || '');
        const teamPartOnly = rawName.split('|')[0] || rawName;
        const subTeams = teamPartOnly.split('/').map(x => x.trim()).filter(Boolean);

        let itemScore = scoreTeamLabelMatch(teamName, teamPartOnly);
        subTeams.forEach(sub => {
            itemScore = Math.max(itemScore, scoreTeamLabelMatch(teamName, sub));
        });
        logoParts.forEach(part => {
            const slug = extractTuttocampoTeamSlug(part);
            if (slug) {
                itemScore = Math.max(itemScore, scoreTeamLabelMatch(teamName, slug));
            }
        });

        if (itemScore > bestScore) {
            bestScore = itemScore;
            best = item;
        }
    });

    return bestScore >= 55 ? best : null;
}

function buildTuttocampoSearchQueries(rawTeamName) {
    const cleaned = String(rawTeamName || '')
        .replace(/^campo\s+(?:di|del|della)?\s*/i, '')
        .replace(/\b(?:a\.?s\.?d\.?|s\.?s\.?d\.?|u\.?s\.?d\.?|p\.?o\.?l\.?|f\.?c\.?|a\.?c\.?|u\.?s\.?|s\.?s\.?|a\.?s\.?|s\.?r\.?l\.?)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned || cleaned.length < 2) {
        return [];
    }

    const withAccents = cleaned
        .replace(/\bcitta\b/gi, 'Città')
        .replace(/\bsocieta\b/gi, 'Società')
        .replace(/\buniversita\b/gi, 'Università')
        .replace(/\btrinita\b/gi, 'Trinità');

    const distinctiveTokens = normalizeText(cleaned)
        .split(' ')
        .filter(t => t.length >= 3 && !GENERIC_TEAM_LOGO_WORDS.has(t));

    const queries = [];
    const pushUnique = q => {
        const val = String(q || '').replace(/\s+/g, ' ').trim();
        if (val.length >= 3 && !queries.some(x => x.toLowerCase() === val.toLowerCase())) {
            queries.push(val);
        }
    };

    pushUnique(withAccents);
    pushUnique(cleaned);
    if (distinctiveTokens.length) {
        pushUnique(distinctiveTokens.join(' '));
        const longest = [...distinctiveTokens].sort((a, b) => b.length - a.length)[0];
        if (longest && longest.length >= 4) {
            pushUnique(longest);
        }
    }
    return queries.slice(0, 4);
}

async function queryTuttocampoAjax(searchValue, regionName = 'Lazio') {
    const q = String(searchValue || '').trim();
    if (!q) {
        return [];
    }
    const params = new URLSearchParams({ search_value: q });
    if (regionName) {
        params.set('region_name', regionName);
    }
    try {
        const response = await fetch(`${TUTTOCAMPO_TEAM_SEARCH_URL}?${params.toString()}`, {
            method: 'GET',
            headers: {
                Accept: 'application/json, text/javascript, */*; q=0.01'
            }
        });
        if (!response.ok) {
            return [];
        }
        const payload = await response.json();
        if (!Array.isArray(payload)) {
            return [];
        }
        const out = [];
        payload.forEach(group => {
            const groupLabel = String(group?.text || '').trim();
            const children = Array.isArray(group?.children) ? group.children : [];
            children.forEach(child => {
                const rawId = String(child?.id || '').trim().replace(/^\/+/, '');
                if (!rawId) {
                    return;
                }
                const teamId = extractTuttocampoTeamId(`/Squadra/${rawId}`);
                const schedaUrl = `https://www.tuttocampo.it/${rawId}/Scheda`;
                const logoUrl = teamId
                    ? `https://b-content.tuttocampo.it/Teams/200/${teamId}.png?v=1`
                    : '';
                out.push({
                    id: rawId,
                    teamId,
                    text: stripHtmlTags(child?.text || ''),
                    groupLabel,
                    schedaUrl,
                    logoUrl
                });
            });
        });
        return out;
    } catch {
        return [];
    }
}

async function fetchTuttocampoTeamInfo(teamName) {
    const normKey = normalizeText(teamName);
    if (!normKey || normKey.length < 2) {
        return null;
    }

    const cached = dynamicTeamLogoCache[normKey];
    if (cached && (cached.logoUrl || cached.notFound)) {
        const ageMs = Date.now() - Number(cached.updatedAt || 0);
        if (cached.logoUrl || ageMs < 24 * 60 * 60 * 1000) {
            return cached.logoUrl ? cached : null;
        }
    }

    const fromDb = findBestLogoEntryForTeam(teamName);
    if (fromDb) {
        const dbLogo = extractLogoCandidateFromLuogo(fromDb, teamName);
        if (dbLogo) {
            const rawParts = String(fromDb?.logoUrl || fromDb?.logo || '')
                .split(/[,;\n]+/)
                .map(x => x.trim())
                .filter(Boolean);
            const matchingScheda = rawParts.find(p => buildTuttocampoLogoCandidates(p).includes(dbLogo)) || dbLogo;
            const entry = {
                teamName: String(teamName).trim(),
                logoUrl: dbLogo,
                schedaUrl: matchingScheda,
                updatedAt: Date.now()
            };
            dynamicTeamLogoCache[normKey] = entry;
            saveDynamicTeamLogoCache();
            return entry;
        }
    }

    const queries = buildTuttocampoSearchQueries(teamName);
    let bestCandidate = null;
    let bestScore = 0;

    for (const q of queries) {
        const candidates = await queryTuttocampoAjax(q, 'Lazio');
        candidates.forEach(cand => {
            const cleanName = String(cand.text || '').split('(')[0].trim();
            const slugName = extractTuttocampoTeamSlug(cand.schedaUrl);
            let score = Math.max(
                scoreTeamLabelMatch(teamName, cleanName),
                scoreTeamLabelMatch(teamName, slugName)
            );
            if (cand.groupLabel === 'Dilettanti') {
                score += 25;
            } else if (cand.groupLabel === 'Giovanili') {
                score += 15;
            }
            if (/eccellenza|promozione|prima categoria|seconda categoria|terza categoria|juniores|allievi|giovanissimi/i.test(cand.text)) {
                score += 12;
            }
            if (/calcio a 5|calcio a 8|femminile|amatori/i.test(cand.text) && !/c5|calcio a 5|femminile/i.test(teamName)) {
                score -= 75;
            }
            if (score > bestScore) {
                bestScore = score;
                bestCandidate = cand;
            }
        });
        if (bestScore >= 170) {
            break;
        }
    }

    if (bestCandidate && bestScore >= 55 && bestCandidate.logoUrl) {
        const result = {
            teamName: String(teamName).trim(),
            matchedLabel: String(bestCandidate.text || '').split('(')[0].trim(),
            logoUrl: bestCandidate.logoUrl,
            schedaUrl: bestCandidate.schedaUrl || bestCandidate.logoUrl,
            updatedAt: Date.now()
        };
        dynamicTeamLogoCache[normKey] = result;
        saveDynamicTeamLogoCache();
        return result;
    }

    dynamicTeamLogoCache[normKey] = {
        teamName: String(teamName).trim(),
        logoUrl: '',
        notFound: true,
        updatedAt: Date.now()
    };
    saveDynamicTeamLogoCache();
    return null;
}

function ensureTeamLogoResolvedAsync(teamName) {
    const normKey = normalizeText(teamName);
    if (!normKey || normKey.length < 2 || pendingTeamLogoLookups.has(normKey)) {
        return;
    }
    const cached = dynamicTeamLogoCache[normKey];
    if (cached && (cached.logoUrl || (cached.notFound && (Date.now() - Number(cached.updatedAt || 0) < 24 * 60 * 60 * 1000)))) {
        return;
    }
    pendingTeamLogoLookups.add(normKey);
    fetchTuttocampoTeamInfo(teamName)
        .then(info => {
            if (info?.logoUrl) {
                debouncedRefreshTeamLogosUi();
            }
        })
        .catch(() => {})
        .finally(() => {
            pendingTeamLogoLookups.delete(normKey);
        });
}

function getTeamLogoForPreview(teamName) {
    const name = String(teamName || '').trim();
    if (!name) {
        return '';
    }
    const fromDb = findBestLogoEntryForTeam(name);
    const dbLogo = extractLogoCandidateFromLuogo(fromDb, name);
    if (dbLogo) {
        return dbLogo;
    }
    const normKey = normalizeText(name);
    const cached = dynamicTeamLogoCache[normKey];
    if (cached?.logoUrl) {
        return cached.logoUrl;
    }
    ensureTeamLogoResolvedAsync(name);
    return '';
}

function renderTeamAvatar(teamName, logoUrl) {
    const name = String(teamName || '').trim();
    const words = name
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 0 && !/^(di|del|della|dei|degli|da|in|con|su|per|tra|fra|a|e|ed|c|fc|as|ss|usd|asd|cr|ac|calcio|football|club)$/i.test(w));

    let initials = '';
    if (words.length >= 2) {
        initials = (words[0][0] + words[1][0]).toUpperCase();
    } else if (words.length === 1) {
        initials = words[0].slice(0, 2).toUpperCase();
    } else {
        const fallbackWord = name.replace(/[^a-zA-Z0-9]/g, '');
        initials = (fallbackWord.slice(0, 2) || 'SQ').toUpperCase();
    }

    const gradients = [
        'linear-gradient(135deg, #1e3a8a, #3b82f6)',
        'linear-gradient(135deg, #065f46, #10b981)',
        'linear-gradient(135deg, #7c2d12, #f97316)',
        'linear-gradient(135deg, #581c87, #a855f7)',
        'linear-gradient(135deg, #831843, #ec4899)',
        'linear-gradient(135deg, #164e63, #06b6d4)',
        'linear-gradient(135deg, #312e81, #6366f1)',
        'linear-gradient(135deg, #713f12, #eab308)'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % gradients.length;
    const bgGradient = gradients[Math.abs(hash) % gradients.length];

    const hasRealLogo = Boolean(logoUrl && !logoUrl.includes('img/logo.png') && !logoUrl.startsWith('img/teams/'));

    if (hasRealLogo) {
        return `
            <div class="team-avatar-box">
                <img src="${escapeHtml(logoUrl)}" alt="Logo ${escapeHtml(name)}" class="team-avatar-img" loading="lazy" decoding="async" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <div class="team-avatar-fallback" style="display:none; background: ${bgGradient};">
                    <span>${escapeHtml(initials)}</span>
                </div>
            </div>
        `;
    }

    return `
        <div class="team-avatar-box">
            <div class="team-avatar-fallback" style="background: ${bgGradient};">
                <span>${escapeHtml(initials)}</span>
            </div>
        </div>
    `;
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
                            ${renderTeamAvatar(teamA, logoA)}
                            <span>${escapeHtml(teamA || 'Squadra A')}</span>
                        </div>
                        <div class="gmail-vs">VS</div>
                        <div class="gmail-team-chip">
                            ${renderTeamAvatar(teamB, logoB)}
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
    const { connectBtn, disconnectBtn, loadBtn, queryInput, badgeEl, autoSyncBtn } = getGmailUiRefs();
    if (!connectBtn && !disconnectBtn) {
        return;
    }

    const tokenReady = isGmailTokenValid();
    if (connectBtn) {
        connectBtn.hidden = tokenReady;
    }
    if (disconnectBtn) {
        disconnectBtn.hidden = !gmailIntegrationPrefs.enabled;
    }
    if (loadBtn) {
        loadBtn.hidden = !tokenReady;
    }
    if (queryInput) {
        queryInput.disabled = !gmailIntegrationPrefs.enabled;
    }
    if (autoSyncBtn) {
        autoSyncBtn.disabled = false;
    }

    if (badgeEl) {
        if (tokenReady) {
            badgeEl.textContent = 'Attiva';
            badgeEl.className = 'auth-gmail-badge badge-active';
        } else if (gmailIntegrationPrefs.enabled) {
            badgeEl.textContent = 'Collegata';
            badgeEl.className = 'auth-gmail-badge badge-linked';
        } else {
            badgeEl.textContent = 'Non collegata';
            badgeEl.className = 'auth-gmail-badge';
        }
    }

    if (!gmailIntegrationPrefs.enabled) {
        setGmailStatus('Gmail non collegata. Clicca "Collega Gmail" per sincronizzare le partite in automatico.');
    } else if (!tokenReady) {
        const linked = gmailIntegrationPrefs.linkedEmail ? ` (${gmailIntegrationPrefs.linkedEmail})` : '';
        setGmailStatus(`Gmail collegata${linked}. Clicca "⚡ Sincronizza Partite" per rinnovare la sessione.`);
    } else {
        const linked = gmailIntegrationPrefs.linkedEmail ? ` come ${gmailIntegrationPrefs.linkedEmail}` : '';
        setGmailStatus(`Gmail attiva${linked}. Pronto alla sincronizzazione automatica.`, true);
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
        const token = String(tokenResponse?.access_token || '').trim();
        const expiresIn = Number(tokenResponse?.expires_in || 0);
        const expiresAt = Date.now() + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 0);
        saveGmailTokenCache(token, expiresAt);

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
    saveGmailTokenCache('', 0);
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
        saveGmailTokenCache('', 0);
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
            const collected = [];
            let pageToken = '';
            for (let page = 0; page < 2; page++) {
                const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
                const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=150&includeSpamTrash=false&q=${encodeURIComponent(rawQuery)}${tokenParam}`;
                const listData = await gmailApiFetchJson(listUrl);
                if (Array.isArray(listData?.messages)) {
                    collected.push(...listData.messages);
                }
                pageToken = String(listData?.nextPageToken || '').trim();
                if (!pageToken || collected.length >= 220) {
                    break;
                }
            }
            return collected;
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
        scheduleAutoSyncRefereedMatches();
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
        await autoSyncMapAndLogosFromRefereedMatches({ interactive: false });
        return;
    }

    renderDashboardEvents();
    await persistDashboardEvents();
    setGmailStatus(`Import completato. Nuovi eventi: ${imported}. Duplicati saltati: ${duplicates}.`, true);
    showDashboardToast(`Import Gmail completato: ${imported} eventi.`, 'ok');
    await autoSyncMapAndLogosFromRefereedMatches({ interactive: true });
}

async function autoSyncGmailDesignazioni(options = {}) {
    const silent = Boolean(options?.silent);
    const quickBtn = document.getElementById('gmailAutoSyncBtn');
    const innerBtn = document.getElementById('gmailSyncInnerBtn');
    const syncBtns = [quickBtn, innerBtn].filter(Boolean);

    const setSyncLoading = isLoading => {
        syncBtns.forEach(btn => {
            btn.disabled = isLoading;
            if (btn === quickBtn) {
                btn.innerHTML = isLoading
                    ? '<svg class="spin-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg> <span>Sincronizzazione in corso...</span>'
                    : '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg> <span>Sincronizza Gmail</span>';
            } else if (btn === innerBtn) {
                btn.textContent = isLoading ? '⏳ Sincronizzazione in corso...' : '⚡ Sincronizzazione automatica 1-Click';
            }
        });
    };

    try {
        if (!isGmailTokenValid() && silent) {
            updateGmailUiState();
            return;
        }
        setSyncLoading(true);

        if (!isGmailTokenValid()) {
            setGmailStatus('Richiesta autorizzazione Gmail in corso...');
            const tokenResponse = await createGmailTokenRequester({ silent: false });
            const token = String(tokenResponse?.access_token || '').trim();
            const expiresIn = Number(tokenResponse?.expires_in || 0);
            const expiresAt = Date.now() + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 0);
            saveGmailTokenCache(token, expiresAt);
            gmailIntegrationPrefs.enabled = true;
            const profileEmail = await fetchGmailProfileEmail();
            if (profileEmail) {
                gmailIntegrationPrefs.linkedEmail = profileEmail;
            }
            await persistGmailIntegrationPrefs();
            updateGmailUiState();
        }

        setGmailStatus('Ricerca designazioni AIA da tutte le sezioni...', false);

        const query = upgradeGmailQueryWindow(gmailIntegrationPrefs.query || GMAIL_DEFAULT_QUERY);
        const fetchMessageRefs = async rawQuery => {
            const collected = [];
            let pageToken = '';
            for (let page = 0; page < 2; page++) {
                const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
                const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=150&includeSpamTrash=false&q=${encodeURIComponent(rawQuery)}${tokenParam}`;
                const listData = await gmailApiFetchJson(listUrl);
                if (Array.isArray(listData?.messages)) {
                    collected.push(...listData.messages);
                }
                pageToken = String(listData?.nextPageToken || '').trim();
                if (!pageToken || collected.length >= 220) {
                    break;
                }
            }
            return collected;
        };

        let messages = await fetchMessageRefs(query);
        let usedFallback = false;
        if (!messages.length) {
            messages = await fetchMessageRefs(GMAIL_FALLBACK_QUERY);
            usedFallback = true;
        }

        if (!messages.length) {
            clearGmailPreview();
            setGmailStatus('Nessuna email di designazione trovata nella casella.');
            if (!silent) {
                showDashboardToast('Nessuna email di designazione trovata su Gmail.', 'warn');
            }
            return;
        }

        setGmailStatus(`Analisi automatica di ${messages.length} email in corso...`, false);

        const fullMessages = await Promise.all(messages.map(async msg => {
            const id = String(msg?.id || '').trim();
            if (!id) return null;
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

        let designationItems = parsedItems.filter(isLikelyDesignazioneEmail);

        if (!designationItems.length && !usedFallback) {
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
                    designationItems = fallbackLikely;
                    usedFallback = true;
                }
            }
        }

        gmailPreviewItems = designationItems;
        renderGmailPreviewList();

        const validMatches = designationItems.filter(item => item.valid);

        if (!validMatches.length) {
            setGmailStatus(`Lette ${messages.length} email: nessuna nuova partita valida trovata (riunioni ed eventi amministrativi sono stati esclusi).`);
            if (!silent) {
                showDashboardToast('Nessuna nuova partita valida estratta da Gmail.', 'warn');
            }
            return;
        }

        const existingFingerprints = new Set(dashboardEvents.map(buildEventFingerprint));
        let imported = 0;
        let duplicates = 0;

        for (const item of validMatches) {
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

        if (imported > 0) {
            renderDashboardEvents();
            await persistDashboardEvents();
            const msg = `Sincronizzate ${imported} nuove partite da Gmail!${duplicates > 0 ? ` (${duplicates} già presenti)` : ''}`;
            setGmailStatus(msg, true);
            showDashboardToast(`⚡ ${msg}`, 'ok');
        } else {
            const msg = `Tutte le ${duplicates} partite trovate nelle email sono già presenti nella dashboard.`;
            setGmailStatus(msg, true);
            if (!silent) {
                showDashboardToast(msg, 'warn');
            }
        }

        await autoSyncMapAndLogosFromRefereedMatches({ interactive: !silent });

    } catch (error) {
        if (!silent) {
            setGmailStatus(`Errore sincronizzazione: ${error.message}`);
            showDashboardToast(`Errore Gmail: ${error.message}`, 'err');
        }
    } finally {
        setSyncLoading(false);
    }
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
            ? `(?=(?:\\b(?:${nextLabelSources.join('|')})\\s*:)|\\bAccedi\\s+a\\b|\\bEMAIL\\s+GENERATA\\b|\\bOperazione\\s+processata\\b|$)`
            : '(?=\\bAccedi\\s+a\\b|\\bEMAIL\\s+GENERATA\\b|\\bOperazione\\s+processata\\b|$)';
        const pattern = new RegExp(`\\b(?:${labelRegexSource})\\s*:\\s*([\\s\\S]*?)${nextBlock}`, 'i');
        const match = String(testo || '').match(pattern);
        return cleanEmailFieldNoise(match?.[1] || '');
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
    const gironeRegex = /\bgirone\s*[:\-]?\s*([A-Z0-9]+)\b/i;
    const arbitroRegex = /^([A-Z\s'`]+),\s*sei designato/i;
    const rimborsoRegex = /\brimborso\s+totale\s*\(\s*€\s*\)\s*:\s*(\d+(?:[\.,]\d{1,2})?)/i;
    const rimborsoInlineRegex = /\brimborso\s*:\s*(\d+(?:[\.,]\d{1,2})?)\s*€/i;
    const kmRegex = /\bdistanza\s*\(\s*km\s*\)\s*:\s*(\d+)/i;
    const kmInlineRegex = /\(\s*(\d+)\s*km\s*\)/i;
    const designazioneS4yRegex = /a\s+(.+?)\s+sull['’]impianto\s+(.+?)\s+sito in\s+([^\r\n]+)/i;

    const campoFromTable = extractFieldByLabel('Campo', fieldOrder.filter(x => x !== 'Campo'));
    const indirizzoFromTable = extractFieldByLabel('Indirizzo', fieldOrder.filter(x => x !== 'Indirizzo'));
    const localitaFromTable = extractFieldByLabel('Localit[àa]', fieldOrder.filter(x => x !== 'Localit[àa]'));
    const provinciaFromTable = extractFieldByLabel('Provincia', fieldOrder.filter(x => x !== 'Provincia'));

    const luogoFromS4y = cleanEmailFieldNoise(testo.match(luogoRegex)?.[1]?.trim() || '');
    const impiantoFromS4y = cleanEmailFieldNoise(testo.match(impiantoRegex)?.[1]?.trim() || '');
    const indirizzoFromS4y = cleanEmailFieldNoise(testo.match(indirizzoRegex)?.[1]?.trim() || '');

    const luogo = luogoFromS4y || formatLuogoWithProvincia(localitaFromTable, provinciaFromTable);
    const impianto = impiantoFromS4y || campoFromTable;
    const indirizzo = indirizzoFromS4y || indirizzoFromTable;
    const designazioneS4yMatch = testo.match(designazioneS4yRegex);
    const designazioneS4yRaw = designazioneS4yMatch
        ? `a ${designazioneS4yMatch[1].trim()} sull'impianto ${designazioneS4yMatch[2].trim()} sito in ${designazioneS4yMatch[3].trim()}`
        : (luogo && impianto && indirizzo ? `a ${luogo} sull'impianto ${impianto} sito in ${indirizzo}` : '');
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
    const gironeFromTable = extractFieldByLabel('Girone', fieldOrder.filter(x => x !== 'Girone'));

    return {
        data: dataValue,
        ora: oraValue,
        luogo,
        impianto,
        indirizzo,
        designazioneS4yRaw,
        locationText,
        squadre: squadreValue,
        categoria: categoriaFromTable || cleanEmailFieldNoise(testo.match(categoriaRegex)?.[1]?.trim() || '') || testo.match(categoriaInlineRegex)?.[1]?.trim() || '',
        garaNumero: testo.match(garaNumeroRegex)?.[1]?.trim() || '',
        girone: gironeFromTable || testo.match(gironeRegex)?.[1]?.trim() || '',
        arbitro: testo.match(arbitroRegex)?.[1]?.trim() || '',
        rimborso: rimborsoValue,
        km: Number(testo.match(kmRegex)?.[1] || testo.match(kmInlineRegex)?.[1] || 0)
    };
}

function buildEventFingerprint(evento) {
    if (evento.garaNumero && evento.data) {
        return normalizeText(`gara|${evento.garaNumero}|${evento.data}`);
    }
    const keyParts = [
        evento.garaNumero || '',
        evento.data || '',
        evento.ora || '',
        evento.squadre || '',
        evento.categoria || ''
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

