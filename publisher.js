const NEWS_DRAFT_KEY = 'matchmap_publisher_news_draft_v2';
const LUOGHI_DRAFT_KEY = 'matchmap_publisher_luoghi_draft_v1';
const PAYMENTS_DRAFT_KEY = 'matchmap_publisher_payments_draft_v1';
const ADMIN_EMAILS = new Set(['manuelcarpita@gmail.com']);
const ADMIN_UIDS = new Set([]);

const ITALIAN_REGIONS = [
    'Tutti',
    'Abruzzo',
    'Basilicata',
    'Calabria',
    'Campania',
    'Emilia-Romagna',
    'Friuli-Venezia Giulia',
    'Lazio',
    'Liguria',
    'Lombardia',
    'Marche',
    'Molise',
    'Piemonte',
    'Puglia',
    'Sardegna',
    'Sicilia',
    'Toscana',
    'Trentino-Alto Adige',
    'Umbria',
    "Valle d'Aosta",
    'Veneto'
];

let newsItems = [];
let luoghiItems = [];
let paymentsItems = [];
let paymentsColumns = {
    regione: 'Regione',
    inPagamento: 'Pacchi in pagamento',
    fineFebbraio: 'Fine febbraio',
    chat: 'Riscontro chat',
    stato: 'Stato'
};
let suggestionItems = [];
let editNewsIndex = -1;
let editLuogoIndex = -1;
let geoResolveTimer = null;
let lastGeoResolveKey = '';
let luoghiSearchTerm = '';
let paymentsSelectedRowIndex = -1;

const regionInput = document.getElementById('regionInput');
const titleInput = document.getElementById('titleInput');
const textInput = document.getElementById('textInput');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const newsList = document.getElementById('newsList');
const emptyState = document.getElementById('emptyState');
const publishBtn = document.getElementById('publishBtn');
const loadRemoteBtn = document.getElementById('loadRemoteBtn');
const statusEl = document.getElementById('status');
const preview = document.getElementById('preview');

const luogoNomeInput = document.getElementById('luogoNomeInput');
const luogoIndirizzoInput = document.getElementById('luogoIndirizzoInput');
const luogoMapsInput = document.getElementById('luogoMapsInput');
const luogoLogoInput = document.getElementById('luogoLogoInput');
const luogoCoordsInput = document.getElementById('luogoCoordsInput');
const luogoDesignazioneKeyInput = document.getElementById('luogoDesignazioneKeyInput');
const pasteCoordsBtn = document.getElementById('pasteCoordsBtn');
const luogoAutofillLogosBtn = document.getElementById('luogoAutofillLogosBtn');
const luogoSaveBtn = document.getElementById('luogoSaveBtn');
const luogoClearBtn = document.getElementById('luogoClearBtn');
const luoghiList = document.getElementById('luoghiList');
const luoghiEmptyState = document.getElementById('luoghiEmptyState');
const luoghiSearchInput = document.getElementById('luoghiSearchInput');
const luoghiPublishBtn = document.getElementById('luoghiPublishBtn');
const luoghiLoadBtn = document.getElementById('luoghiLoadBtn');
const luoghiStatusEl = document.getElementById('luoghiStatus');
const luoghiPreview = document.getElementById('luoghiPreview');
const paymentsSheetBody = document.getElementById('paymentsSheetBody');
const paymentsAddRowBtn = document.getElementById('paymentsAddRowBtn');
const paymentsDeleteRowBtn = document.getElementById('paymentsDeleteRowBtn');
const paymentsPublishBtn = document.getElementById('paymentsPublishBtn');
const paymentsLoadBtn = document.getElementById('paymentsLoadBtn');
const paymentsExportCsvBtn = document.getElementById('paymentsExportCsvBtn');
const paymentsImportCsvBtn = document.getElementById('paymentsImportCsvBtn');
const paymentsCsvFileInput = document.getElementById('paymentsCsvFileInput');
const paymentsStatusEl = document.getElementById('paymentsStatus');
const suggestionsLoadBtn = document.getElementById('suggestionsLoadBtn');
const suggestionsStatusEl = document.getElementById('suggestionsStatus');
const suggestionsEmptyState = document.getElementById('suggestionsEmptyState');
const suggestionsList = document.getElementById('suggestionsList');

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function debounce(fn, delay = 180) {
    let timer = null;
    return function (...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            fn.apply(this, args);
        }, delay);
    };
}
const TUTTOCAMPO_TEAM_SEARCH_URL = 'https://www.tuttocampo.it/Ajax/GetTeams';
const TUTTOCAMPO_DEFAULT_REGION = 'Lazio';
const TUTTOCAMPO_LOGO_OVERRIDES = {
    'leocon': 'https://www.tuttocampo.it/Lazio/TerzaCategoria/GironeARoma/Squadra/Leocon/1204237/Scheda',
    'campo di cesano': 'https://www.tuttocampo.it/Lazio/PrimaCategoria/GironeC/Squadra/Cesano/1040338/Scheda',
    'aurelia academy': 'https://www.tuttocampo.it/Lazio/GiovanissimiProvincialiU14/GironeUnicoViterbo/Squadra/AureliaAcademy/1290354/Scheda',
    'campo di aranova': 'https://www.tuttocampo.it/Lazio/Eccellenza/GironeA/Squadra/Aranova/935549/Scheda',
    'campo di santa marinella': 'https://www.tuttocampo.it/Lazio/Promozione/GironeA/Squadra/SantaMarinella1947/920919/Scheda',
    'campo di pallidoro': 'https://www.tuttocampo.it/Lazio/Promozione/GironeA/Squadra/BorgoPalidoro/81212/Scheda',
    'campo di bracciano': 'https://www.tuttocampo.it/Lazio/SecondaCategoria/GironeC/Squadra/VisBraccianoFC/931324/Scheda',
    'campo di anguillara': 'https://www.tuttocampo.it/Lazio/PrimaCategoria/GironeC/Squadra/AnguillaraCalcio/79163/Scheda',
    'san pio x': 'https://www.tuttocampo.it/Lazio/AllieviProvincialiU16/GironeUnicoViterbo/Squadra/SanPioX/1245004/Scheda',
    'campo del oro': 'https://www.tuttocampo.it/Lazio/PrimaCategoria/GironeA/Squadra/QuartiereCampodellOro/1204238/Scheda',
    'dlf civitavecchia': 'https://www.tuttocampo.it/Lazio/PrimaCategoria/GironeA/Squadra/DopolavoroFootballClub/1140172/Scheda',
    'campo di ladispoli': 'https://www.tuttocampo.it/Lazio/Promozione/GironeA/Squadra/AcademyLadispoli/650008/Scheda',
    'dm84 duencasette': 'https://www.tuttocampo.it/Lazio/PrimaCategoria/GironeA/Squadra/DM84Cerveteri/917262/Scheda',
    'tarquinia': 'https://www.tuttocampo.it/Lazio/Promozione/GironeA/Squadra/TarquiniaCalcio/932915/Scheda',
    'campo cerveteri': 'https://www.tuttocampo.it/Lazio/Promozione/GironeA/Squadra/CittadiCerveteri/77986/Scheda',
    'club calcio passoscuro': 'https://www.tuttocampo.it/Lazio/PrimaCategoria/GironeC/Squadra/Passoscuro/80486/Scheda'
};

const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginBtn = document.getElementById('loginBtn');
const loginGoogleBtn = document.getElementById('loginGoogleBtn');
const logoutBtn = document.getElementById('logoutBtn');
const authStatus = document.getElementById('authStatus');
const publisherAuthAvatarImg = document.getElementById('publisherAuthAvatarImg');
const publisherAuthAvatarFallback = document.getElementById('publisherAuthAvatarFallback');
const publisherAuthProfileSummary = document.getElementById('publisherAuthProfileSummary');
const publisherAuthProfileSummaryImg = document.getElementById('publisherAuthProfileSummaryImg');
const publisherAuthProfileSummaryName = document.getElementById('publisherAuthProfileSummaryName');
const publisherCredentialsGrid = document.getElementById('publisherCredentialsGrid');
const publisherMainAuthActions = document.getElementById('publisherMainAuthActions');
const publisherLogoutLinkBtn = document.getElementById('publisherLogoutLinkBtn');
const accessDeniedCard = document.getElementById('publisherAccessDenied');

function getFirebaseState() {
    return window.matchMapFirebase || { ready: false, auth: null, db: null };
}

function setStatus(message, type = '') {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`.trim();
}

function setLuoghiStatus(message, type = '') {
    luoghiStatusEl.textContent = message;
    luoghiStatusEl.className = `status ${type}`.trim();
}

function setPaymentsStatus(message, type = '') {
    if (!paymentsStatusEl) {
        return;
    }
    paymentsStatusEl.textContent = message;
    paymentsStatusEl.className = `status ${type}`.trim();
}

function setSuggestionsStatus(message, type = '') {
    if (!suggestionsStatusEl) {
        return;
    }
    suggestionsStatusEl.textContent = message;
    suggestionsStatusEl.className = `status ${type}`.trim();
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function pickFirst(obj, keys) {
    for (const key of keys) {
        if (obj && obj[key] != null && String(obj[key]).trim() !== '') {
            return obj[key];
        }
    }
    return '';
}

function setAuthStatus(message, ok = false) {
    authStatus.textContent = message;
    authStatus.className = ok ? 'status ok' : 'muted';
}

function setPublisherAuthAvatar(avatarUrl) {
    if (!publisherAuthAvatarImg || !publisherAuthAvatarFallback) {
        return;
    }
    const value = String(avatarUrl || '').trim();
    if (!value) {
        publisherAuthAvatarImg.hidden = true;
        publisherAuthAvatarImg.removeAttribute('src');
        publisherAuthAvatarFallback.hidden = false;
        return;
    }
    publisherAuthAvatarImg.src = value;
    publisherAuthAvatarImg.hidden = false;
    publisherAuthAvatarFallback.hidden = true;
}

function setPublisherAuthProfileSummary(user, profile = {}) {
    if (!publisherAuthProfileSummary || !publisherAuthProfileSummaryImg || !publisherAuthProfileSummaryName) {
        return;
    }
    if (!user) {
        publisherAuthProfileSummary.hidden = true;
        publisherAuthProfileSummaryName.textContent = '';
        publisherAuthProfileSummaryImg.hidden = true;
        publisherAuthProfileSummaryImg.removeAttribute('src');
        return;
    }

    const nickname = String(profile?.nickname || user.displayName || user.email || '').trim() || 'Utente';
    const avatar = String(profile?.avatarUrl || user.photoURL || '').trim();
    publisherAuthProfileSummaryName.textContent = nickname;
    if (avatar) {
        publisherAuthProfileSummaryImg.src = avatar;
        publisherAuthProfileSummaryImg.hidden = false;
    } else {
        publisherAuthProfileSummaryImg.hidden = true;
        publisherAuthProfileSummaryImg.removeAttribute('src');
    }
    publisherAuthProfileSummary.hidden = false;
}

function setPublisherAuthControlsVisibility(user) {
    const isLogged = Boolean(user);
    if (publisherCredentialsGrid) {
        publisherCredentialsGrid.hidden = isLogged;
        publisherCredentialsGrid.style.display = isLogged ? 'none' : '';
    }
    if (publisherMainAuthActions) {
        publisherMainAuthActions.hidden = isLogged;
        publisherMainAuthActions.style.display = isLogged ? 'none' : '';
    }
    if (loginGoogleBtn) {
        loginGoogleBtn.hidden = isLogged;
        loginGoogleBtn.style.display = isLogged ? 'none' : '';
    }
    if (logoutBtn) {
        logoutBtn.hidden = true;
        logoutBtn.style.display = 'none';
    }
    if (publisherLogoutLinkBtn) {
        publisherLogoutLinkBtn.hidden = !isLogged;
        publisherLogoutLinkBtn.style.display = isLogged ? 'inline-flex' : 'none';
    }
}

async function loadPublisherUserProfile(user) {
    if (!user) {
        setPublisherAuthAvatar('');
        setPublisherAuthProfileSummary(null, {});
        return { nickname: '', avatarUrl: '' };
    }
    const fb = getFirebaseState();
    let profile = {};
    try {
        if (fb?.ready && fb.db) {
            const snap = await fb.db.ref(`users/${user.uid}/profile`).once('value');
            if (snap.exists()) {
                profile = snap.val() || {};
            }
        }
    } catch {}
    const avatar = String(profile?.avatarUrl || user.photoURL || '').trim();
    setPublisherAuthAvatar(avatar);
    setPublisherAuthProfileSummary(user, profile);
    return {
        nickname: String(profile?.nickname || user.displayName || '').trim(),
        avatarUrl: avatar
    };
}

function isPublisherAdmin(user) {
    if (!user) {
        return false;
    }
    const email = String(user.email || '').trim().toLowerCase();
    return ADMIN_UIDS.has(user.uid) || ADMIN_EMAILS.has(email);
}
function setPublisherAccess(isAdmin) {
    document.body.classList.toggle('publisher-locked', !isAdmin);
    if (accessDeniedCard) {
        accessDeniedCard.hidden = isAdmin;
    }
}
function getPublisherUser() {
    const fb = getFirebaseState();
    return fb?.ready && fb.auth ? fb.auth.currentUser : null;
}
function requirePublisherAdmin() {
    const user = getPublisherUser();
    const isAdmin = isPublisherAdmin(user);
    if (!isAdmin) {
        setStatus('Accesso negato: solo admin autorizzato.', 'err');
        setLuoghiStatus('Accesso negato: solo admin autorizzato.', 'err');
        setPaymentsStatus('Accesso negato: solo admin autorizzato.', 'err');
    }
    return isAdmin;
}
function ensureRegionOption(value) {
    const normalized = (value || '').trim();
    if (!normalized) {
        return;
    }
    const exists = Array.from(regionInput.options).some(option => option.value === normalized);
    if (exists) {
        return;
    }
    const option = document.createElement('option');
    option.value = normalized;
    option.textContent = `${normalized} (personalizzata)`;
    regionInput.appendChild(option);
}

function populateRegionSelect() {
    regionInput.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Seleziona regione';
    regionInput.appendChild(placeholder);

    ITALIAN_REGIONS.forEach(region => {
        const option = document.createElement('option');
        option.value = region;
        option.textContent = region;
        regionInput.appendChild(option);
    });
}

function normalizeNews(item) {
    return {
        regione: (item?.regione || '').trim(),
        titolo: (item?.titolo || '').trim(),
        testo: (item?.testo || '').trim()
    };
}

const CITY_ONLY_ALIAS_BLACKLIST = new Set([
    'civitavecchia', 'civitavecchia rm', 'civitavecchia campo dell oro rm',
    'cerveteri', 'cerveteri rm', 'cerveteri due casette rm',
    'ladispoli', 'ladispoli rm', 'ladispoli campi di vaccina snc rm', 'ladispoli mar s nicola rm',
    'tarquinia', 'tarquinia vt',
    'bracciano', 'bracciano rm',
    'tolfa', 'tolfa rm',
    'fiumicino', 'fiumicino rm',
    'cesano di roma', 'cesano di roma rm',
    'santa marinella', 'santa marinella rm',
    'montalto di castro', 'montalto di castro vt',
    'oriolo romano', 'oriolo romano vt',
    'passoscuro', 'passoscuro rm',
    'palidoro', 'palidoro rm', 'palidoro ladispoli rm',
    'viterbo', 'viterbo pilastro', 'viterbo pilastro vt',
    'anguillara', 'anguillara sabazia', 'anguillaraloc pratoviale', 'anguillaraloc pratoviale rm',
    'anguillaraloc pratoviale anguillara sabazia rm', 'a'
]);

function filterCleanAliases(rawAliases) {
    const list = Array.isArray(rawAliases)
        ? rawAliases.map(x => String(x || '').trim()).filter(Boolean)
        : String(rawAliases || '')
            .split(/[\n;,]+/)
            .map(x => x.trim())
            .filter(Boolean);
    const seen = new Set();
    const out = [];
    list.forEach(item => {
        const str = String(item || '').trim();
        const norm = normalizeText(str);
        if (!norm || norm.length < 3 || CITY_ONLY_ALIAS_BLACKLIST.has(norm) || seen.has(norm)) {
            return;
        }
        seen.add(norm);
        out.push(str);
    });
    return out;
}

function normalizeLuogo(item) {
    const raw = item || {};
    const nome = String(pickFirst(raw, ['nome', 'Nome', 'name', 'Name'])).trim();
    const latRaw = pickFirst(raw, ['lat', 'latitude', 'Latitude']);
    const lngRaw = pickFirst(raw, ['lng', 'lon', 'longitude', 'Longitude']);
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    const rawAliases = pickFirst(raw, ['aliases', 'Aliases', 'alias']);
    const aliases = filterCleanAliases(rawAliases);
    const rawDesignazione = pickFirst(raw, ['designazioneS4y', 'designazioneKey', 'designazioneKeys', 's4y']);
    const designazioneRawList = Array.isArray(rawDesignazione)
        ? rawDesignazione.map(x => String(x || '').trim()).filter(Boolean)
        : String(rawDesignazione || '')
            .split(/[\n;,]+/)
            .map(x => x.trim())
            .filter(Boolean);
    const designazioneS4y = [];
    const seenDesignazione = new Set();
    designazioneRawList.forEach(value => {
        const key = normalizeText(value);
        if (!key || seenDesignazione.has(key)) {
            return;
        }
        seenDesignazione.add(key);
        designazioneS4y.push(value);
    });
    const normalized = {
        nome,
        indirizzo: String(pickFirst(raw, ['indirizzo', 'Indirizzo', 'address', 'Address'])).trim(),
        mapsUrl: String(pickFirst(raw, ['mapsUrl', 'MapsUrl', 'mapsURL', 'maps', 'map', 'url', 'Url'])).trim(),
        logoUrl: String(pickFirst(raw, ['logoUrl', 'LogoUrl', 'logoURL', 'logo', 'Logo'])).trim(),
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        aliases,
        designazioneS4y,
        fatto: true
    };
    const team = String(raw.team || '').trim();
    const comune = String(raw.comune || '').trim();
    if (team) normalized.team = team;
    if (comune) normalized.comune = comune;
    return normalized;
}

function repairCorruptedLuoghiDatabase(rawList) {
    const input = Array.isArray(rawList) ? rawList.filter(Boolean).map(x => ({ ...x })) : [];
    let changed = false;
    const out = [];

    for (const item of input) {
        const nomeNorm = normalizeText(item.nome || '');
        const lat = Number(item.lat);
        const lng = Number(item.lng);

        if (!item.fatto) {
            const isOutOfLazio = Number.isFinite(lat) && Number.isFinite(lng) && (lat < 41.0 || lat > 42.9 || lng < 11.3 || lng > 14.0);
            const isDuplicateOfExisting =
                nomeNorm.includes('salvo d acquisto') ||
                nomeNorm.includes('sale angelo') ||
                nomeNorm.includes('capparella ferdinando') ||
                nomeNorm.includes('rossi vincenzo') ||
                nomeNorm.includes('fontana angelo');
            if (isOutOfLazio || isDuplicateOfExisting) {
                changed = true;
                continue;
            }
            if (nomeNorm.includes('virtus marina') && nomeNorm.includes('lombardi')) {
                if (item.nome !== 'Virtus Marina di San Nicola | A. Lombardi') {
                    item.nome = 'Virtus Marina di San Nicola | A. Lombardi';
                    item.team = 'Virtus Marina di San Nicola';
                    item.comune = 'Marina di San Nicola';
                    item.indirizzo = 'Via della Luna, Marina di San Nicola RM';
                    changed = true;
                }
            }
        }

        if (nomeNorm.includes('leocon') && nomeNorm.includes('di ianne')) {
            if (nomeNorm.includes('dopolavoro') || nomeNorm.includes('civitavecchia calcio')) {
                item.nome = 'Leocon / Evergreen | Di Ianne Luca';
                item.team = 'Leocon / Evergreen';
                item.logoUrl = 'https://www.tuttocampo.it/Lazio/TerzaCategoria/GironeARoma/Squadra/Leocon/1204237/Scheda, https://www.tuttocampo.it/Lazio/SecondaCategoria/GironeC/Squadra/EvergreenCivitavecchia/1244966/Scheda';
                item.designazioneS4y = ["a CIVITAVECCHIA (RM) sull'impianto DI IANNE LUCA SINTEX sito in VIA GIULIO BIANCONE SNC"];
                item.aliases = [
                    'LEOCON',
                    'EVERGREEN CIVITAVECCHIA',
                    'DI IANNE LUCA SINTEX',
                    'VIA GIULIO BIANCONE SNC',
                    'CIVITAVECCHIA (RM), DI IANNE LUCA SINTEX, VIA GIULIO BIANCONE SNC'
                ];
                changed = true;
            }
        }

        if (nomeNorm.startsWith('tarquinia') && nomeNorm.includes('dopolavoro')) {
            item.nome = 'Tarquinia';
            item.team = '';
            item.logoUrl = 'https://www.tuttocampo.it/Lazio/Promozione/GironeA/Squadra/TarquiniaCalcio/932915/Scheda';
            item.aliases = [
                'TARQUINIA CALCIO',
                'BONELLI LIVIANO SINTEX',
                'VIA RAFFAELLO SANZIO SNC',
                'TARQUINIA (VT), BONELLI LIVIANO SINTEX, VIA RAFFAELLO SANZIO SNC'
            ];
            changed = true;
        }

        if (nomeNorm.includes('citta di cerveteri') && nomeNorm.includes('enrico galli') && nomeNorm.includes('dm 84')) {
            item.nome = 'Città di Cerveteri | Enrico Galli';
            item.team = '';
            item.logoUrl = 'https://www.tuttocampo.it/Lazio/Promozione/GironeA/Squadra/CittadiCerveteri/77986/Scheda';
            item.designazioneS4y = ["a CERVETERI (RM) sull'impianto GALLI ENRICO A SINTEX sito in VIA SETTEVENEPALO"];
            item.aliases = [
                'CITTA DI CERVETERI',
                'GALLI ENRICO A SINTEX',
                'VIA SETTEVENEPALO',
                'CERVETERI (RM), GALLI ENRICO A SINTEX, VIA SETTEVENEPALO'
            ];
            changed = true;
        }

        if (nomeNorm.includes('borgo pallidoro') || (nomeNorm === 'borgo palidoro')) {
            const wantS4y = [
                "a PALIDORO (RM) sull'impianto FONTANA ANGELO A ERBA sito in VIA FILIPPO CUGGIANI 21/23",
                "a PALIDORO (RM) sull'impianto FONTANA ANGELO A TERRA sito in VIA FILIPPO CUGGIANI 21/23",
                "a PALIDORO - LADISPOLI (RM) sull'impianto FONTANA ANGELO A TERRA sito in VIA FILIPPO CUGGIANI 21/23"
            ];
            if (!Array.isArray(item.designazioneS4y) || !item.designazioneS4y.length) {
                item.designazioneS4y = wantS4y;
                item.comune = item.comune || 'Palidoro';
                item.aliases = ['BORGO PALIDORO', 'FONTANA ANGELO A TERRA', 'VIA FILIPPO CUGGIANI 21/23'];
                changed = true;
            }
        } else if (nomeNorm.includes('campo di anguillara') || nomeNorm.includes('ferdinando capparella')) {
            if (!Array.isArray(item.designazioneS4y) || !item.designazioneS4y.length) {
                item.designazioneS4y = [
                    "a ANGUILLARALOC.PRATOVIALE (RM) sull'impianto CAPPARELLA FERDINANDO A ERBA sito in STR.VICINALE DEI VIGNALI",
                    "a ANGUILLARALOC.PRATOVIALE - ANGUILLARA SABAZIA (RM) sull'impianto CAPPARELLA FERDINANDO A ERBA sito in STR.VICINALE DEI VIGNALI"
                ];
                item.comune = item.comune || 'Anguillara Sabazia';
                item.aliases = ['ANGUILLARA CALCIO', 'CAPPARELLA FERDINANDO A ERBA', 'STR.VICINALE DEI VIGNALI'];
                changed = true;
            }
        } else if (nomeNorm.includes('tamagnini vittorio')) {
            if (!Array.isArray(item.designazioneS4y) || !item.designazioneS4y.length) {
                item.designazioneS4y = [
                    "a CIVITAVECCHIA CAMPO DELL''ORO (RM) sull'impianto TAMAGNINI VITTORIO SINTEX sito in LARGO MARTIRI DI VIA FANI SNC"
                ];
                item.comune = item.comune || 'Civitavecchia';
                item.aliases = ['CIVITAVECCHIA CALCIO 1920', 'QUARTIERE CAMPO DELL ORO', 'TAMAGNINI VITTORIO SINTEX', 'LARGO MARTIRI DI VIA FANI SNC'];
                changed = true;
            }
        } else if (nomeNorm.includes('dopolavoro ferroviario')) {
            if (!Array.isArray(item.designazioneS4y) || !item.designazioneS4y.length) {
                item.designazioneS4y = [
                    "a CIVITAVECCHIA (RM) sull'impianto DOPOLAVORO FERROVIARIO SINTEX sito in VIA BACCELLI"
                ];
                item.comune = item.comune || 'Civitavecchia';
                item.aliases = ['DOPOLAVORO FOOTBALL CLUB', 'CSL SOCCER 21 8.0', 'DOPOLAVORO FERROVIARIO SINTEX', 'VIA BACCELLI'];
                changed = true;
            }
        } else if (nomeNorm.includes('accademy ladispoli') || nomeNorm === 'academy ladispoli') {
            if (!Array.isArray(item.designazioneS4y) || !item.designazioneS4y.length) {
                item.designazioneS4y = [
                    "a LADISPOLI CAMPI DI VACCINA SNC (RM) sull'impianto SALE ANGELO SINTEX sito in CAMPI DI VACCINA SNC"
                ];
                item.comune = item.comune || 'Ladispoli';
                item.aliases = ['ACADEMY LADISPOLI SRL', 'SALE ANGELO SINTEX', 'CAMPI DI VACCINA SNC'];
                changed = true;
            }
        } else if (nomeNorm.includes('daniele mataloni')) {
            if (!Array.isArray(item.designazioneS4y) || !item.designazioneS4y.length) {
                item.designazioneS4y = [
                    "a CERVETERI DUE CASETTE (RM) sull'impianto COMUNALE DANIELE MATALONI sito in VIA DELLE PISCINE 36"
                ];
                item.comune = item.comune || 'Cerveteri';
                item.aliases = ['DM 84 CERVETERI', 'COMUNALE DANIELE MATALONI', 'VIA DELLE PISCINE 36'];
                changed = true;
            }
        } else if (nomeNorm === 'club calcio passoscuro') {
            if (!Array.isArray(item.designazioneS4y) || !item.designazioneS4y.length) {
                item.designazioneS4y = [
                    "a PASSOSCURO (RM) sull'impianto SALVO D''ACQUISTO A ERBA sito in VIA S.CARLO A PALIDORO 360"
                ];
                item.comune = item.comune || 'Passoscuro';
                item.aliases = ['CLUB CALCIO PASSOSCURO', 'SALVO D ACQUISTO A ERBA', 'VIA S.CARLO A PALIDORO 360'];
                changed = true;
            }
        } else if (nomeNorm === 'viterbese') {
            if (!Array.isArray(item.designazioneS4y) || !item.designazioneS4y.length) {
                item.designazioneS4y = [
                    "a VITERBO PILASTRO (VT) sull'impianto ROSSI VINCENZO SINTEX sito in VIA CARLO MINCIOTTI N. 4"
                ];
                item.comune = item.comune || 'Viterbo';
                item.aliases = ['VITERBESE S.S.D. A R.L.', 'ROSSI VINCENZO SINTEX', 'VIA CARLO MINCIOTTI N. 4'];
                changed = true;
            }
        }

        if (Array.isArray(item.aliases)) {
            const cleanedAliases = filterCleanAliases(item.aliases);
            if (cleanedAliases.length !== item.aliases.length) {
                item.aliases = cleanedAliases;
                changed = true;
            }
        }

        out.push(normalizeLuogo(item));
    }

    return { cleaned: out, list: out, changed };
}

function normalizePayment(item) {
    return {
        regione: String(item?.regione || '').trim(),
        inPagamento: String(item?.inPagamento || '').trim(),
        fineFebbraio: String(item?.fineFebbraio || '').trim(),
        chat: String(item?.chat || '').trim(),
        stato: String(item?.stato || '').trim()
    };
}

function createEmptyPaymentRow() {
    return normalizePayment({
        regione: '',
        inPagamento: '',
        fineFebbraio: '',
        chat: '',
        stato: ''
    });
}

function normalizePaymentColumns(value) {
    const fallback = {
        regione: 'Regione',
        inPagamento: 'Pacchi in pagamento',
        fineFebbraio: 'Fine febbraio',
        chat: 'Riscontro chat',
        stato: 'Stato'
    };
    const raw = value || {};
    return {
        regione: String(raw.regione || fallback.regione).trim() || fallback.regione,
        inPagamento: String(raw.inPagamento || fallback.inPagamento).trim() || fallback.inPagamento,
        fineFebbraio: String(raw.fineFebbraio || fallback.fineFebbraio).trim() || fallback.fineFebbraio,
        chat: String(raw.chat || fallback.chat).trim() || fallback.chat,
        stato: String(raw.stato || fallback.stato).trim() || fallback.stato
    };
}

function getPaymentsForPublish() {
    return paymentsItems
        .map(normalizePayment)
        .filter(item => {
            return [item.regione, item.inPagamento, item.fineFebbraio, item.chat, item.stato]
                .some(value => String(value || '').trim() !== '');
        });
}

function normalizeSuggestion(item, key) {
    const raw = item || {};
    return {
        id: key || raw.id || '',
        type: String(raw.type || '').trim(),
        team: String(raw.team || '').trim(),
        title: String(raw.title || '').trim(),
        text: String(raw.text || '').trim(),
        mapsUrl: String(raw.mapsUrl || '').trim(),
        proofUrl: String(raw.proofUrl || '').trim(),
        status: String(raw.status || 'pending').trim(),
        checks: raw.checks || {},
        coordinates: raw.coordinates || null,
        target: raw.target || {},
        extracted: raw.extracted || {},
        createdAt: Number(raw.createdAt || 0),
        createdByEmail: String(raw.createdByEmail || '').trim(),
        createdByUid: String(raw.createdByUid || '').trim()
    };
}

function getSuggestionAddressCandidate(suggestion) {
    return String(suggestion?.extracted?.indirizzo || '').trim();
}

function findLuogoIndexForUpdateSuggestion(suggestion) {
    const targetMaps = normalizeText(suggestion?.target?.mapsUrl || suggestion?.mapsUrl);
    const targetName = normalizeText(suggestion?.target?.nome || suggestion?.team || suggestion?.title);
    return luoghiItems.findIndex(item => {
        const sameMaps = targetMaps && normalizeText(item?.mapsUrl) === targetMaps;
        if (sameMaps) {
            return true;
        }
        const itemName = normalizeText(item?.nome);
        return Boolean(targetName && itemName && (itemName.includes(targetName) || targetName.includes(itemName)));
    });
}

function mergeLuogoAddressHint(luogo, newAddress) {
    const address = String(newAddress || '').trim();
    if (!address) {
        return luogo;
    }

    const currentAddress = String(luogo?.indirizzo || '').trim();
    const normalizedCurrent = normalizeText(currentAddress);
    const normalizedNew = normalizeText(address);
    const aliases = Array.isArray(luogo?.aliases)
        ? luogo.aliases.map(x => String(x || '').trim()).filter(Boolean)
        : [];

    if (!currentAddress) {
        luogo.indirizzo = address;
        return luogo;
    }

    if (!normalizedCurrent || normalizedCurrent === normalizedNew || normalizedCurrent.includes(normalizedNew) || normalizedNew.includes(normalizedCurrent)) {
        return luogo;
    }

    const alreadyInAliases = aliases.some(alias => {
        const normalizedAlias = normalizeText(alias);
        return normalizedAlias === normalizedNew || normalizedAlias.includes(normalizedNew) || normalizedNew.includes(normalizedAlias);
    });
    if (!alreadyInAliases) {
        aliases.push(address);
    }
    luogo.aliases = aliases;
    return luogo;
}

function mergeLuogoDesignazioneKey(luogo, rawKey) {
    const rawValue = String(rawKey || '').trim();
    const key = normalizeText(rawValue);
    if (!rawValue || !key) {
        return luogo;
    }
    const existingRaw = Array.isArray(luogo?.designazioneS4y)
        ? luogo.designazioneS4y.map(x => String(x || '').trim()).filter(Boolean)
        : [];
    const existingKeys = new Set(existingRaw.map(x => normalizeText(x)).filter(Boolean));
    if (!existingKeys.has(key)) {
        existingRaw.push(rawValue);
    }
    luogo.designazioneS4y = existingRaw;
    return luogo;
}

function buildLuogoFromFieldSuggestion(suggestion) {
    const extracted = suggestion?.extracted || {};
    const nome = String(
        extracted.impianto
        || extracted.luogo
        || suggestion?.team
        || suggestion?.title
        || ''
    ).trim();
    const indirizzo = String(extracted.indirizzo || '').trim();

    return normalizeLuogo({
        nome,
        indirizzo,
        mapsUrl: suggestion?.mapsUrl || '',
        lat: suggestion?.coordinates?.lat ?? null,
        lng: suggestion?.coordinates?.lng ?? null,
        designazioneS4y: extracted.designazioneS4y || ''
    });
}

function saveNewsDraft() {
    localStorage.setItem(NEWS_DRAFT_KEY, JSON.stringify(newsItems));
}

function saveLuoghiDraft() {
    localStorage.setItem(LUOGHI_DRAFT_KEY, JSON.stringify(luoghiItems));
}

function savePaymentsDraft() {
    localStorage.setItem(PAYMENTS_DRAFT_KEY, JSON.stringify({
        columns: normalizePaymentColumns(paymentsColumns),
        items: paymentsItems.map(normalizePayment)
    }));
}

function restoreDrafts() {
    try {
        const rawNews = JSON.parse(localStorage.getItem(NEWS_DRAFT_KEY) || '[]');
        newsItems = Array.isArray(rawNews) ? rawNews.map(normalizeNews) : [];
    } catch {
        newsItems = [];
    }

    try {
        const rawLuoghi = JSON.parse(localStorage.getItem(LUOGHI_DRAFT_KEY) || '[]');
        const normalizedDraft = Array.isArray(rawLuoghi) ? rawLuoghi.map(normalizeLuogo) : [];
        const { cleaned } = repairCorruptedLuoghiDatabase(normalizedDraft);
        luoghiItems = cleaned;
    } catch {
        luoghiItems = [];
    }

    try {
        const rawPayments = JSON.parse(localStorage.getItem(PAYMENTS_DRAFT_KEY) || '[]');
        if (Array.isArray(rawPayments)) {
            paymentsItems = rawPayments.map(normalizePayment);
            paymentsColumns = normalizePaymentColumns({});
        } else {
            paymentsItems = Array.isArray(rawPayments?.items)
                ? rawPayments.items.map(normalizePayment)
                : [];
            paymentsColumns = normalizePaymentColumns(rawPayments?.columns);
        }
    } catch {
        paymentsItems = [];
        paymentsColumns = normalizePaymentColumns({});
    }
}

function renderNewsPreview() {
    if (!preview) {
        return;
    }
    preview.textContent = JSON.stringify({ news: newsItems.map(normalizeNews) }, null, 2);
}

function renderLuoghiPreview() {
    if (!luoghiPreview) {
        return;
    }
    luoghiPreview.textContent = JSON.stringify({ luoghi: luoghiItems.map(normalizeLuogo) }, null, 2);
}

function resetNewsForm() {
    regionInput.value = '';
    titleInput.value = '';
    textInput.value = '';
    editNewsIndex = -1;
    saveBtn.textContent = 'Aggiungi';
}

function resetLuogoForm() {
    luogoNomeInput.value = '';
    luogoIndirizzoInput.value = '';
    luogoMapsInput.value = '';
    luogoLogoInput.value = '';
    luogoCoordsInput.value = '';
    if (luogoDesignazioneKeyInput) {
        luogoDesignazioneKeyInput.value = '';
    }
    lastGeoResolveKey = '';
    editLuogoIndex = -1;
    luogoSaveBtn.textContent = 'Aggiungi Luogo';
}

function fillNewsForm(index) {
    const item = newsItems[index];
    if (!item) {
        return;
    }
    ensureRegionOption(item.regione);
    regionInput.value = item.regione;
    titleInput.value = item.titolo;
    textInput.value = item.testo;
    editNewsIndex = index;
    saveBtn.textContent = 'Salva Modifica';
}

function fillLuogoForm(index) {
    const item = luoghiItems[index];
    if (!item) {
        return;
    }
    luogoNomeInput.value = item.nome;
    luogoIndirizzoInput.value = item.indirizzo;
    luogoMapsInput.value = item.mapsUrl;
    luogoLogoInput.value = item.logoUrl || '';
    if (luogoDesignazioneKeyInput) {
        luogoDesignazioneKeyInput.value = Array.isArray(item.designazioneS4y)
            ? item.designazioneS4y.join('; ')
            : '';
    }
    const latNum = Number(item.lat);
    const lngNum = Number(item.lng);
    luogoCoordsInput.value = (Number.isFinite(latNum) && Number.isFinite(lngNum))
        ? `${latNum}, ${lngNum}`
        : '';
    editLuogoIndex = index;
    luogoSaveBtn.textContent = 'Salva Modifica';
}

function renderNewsList() {
    newsList.innerHTML = '';

    if (!newsItems.length) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    newsItems.forEach((item, index) => {
        const card = document.createElement('article');
        card.className = 'item';
        card.innerHTML = `
            <h3>${escapeHtml(item.titolo)}</h3>
            <div class="meta">Regione: ${escapeHtml(item.regione)}</div>
            <p>${escapeHtml(item.testo)}</p>
            <div class="item-actions">
                <button type="button" data-action="edit-news" data-index="${index}">Modifica</button>
                <button type="button" data-action="delete-news" data-index="${index}">Elimina</button>
            </div>
        `;
        newsList.appendChild(card);
    });
}

function renderLuoghiList() {
    luoghiList.innerHTML = '';

    if (!luoghiItems.length) {
        luoghiEmptyState.style.display = 'block';
        luoghiEmptyState.textContent = 'Nessun luogo presente.';
        return;
    }

    const q = normalizeText(luoghiSearchTerm);
    const filteredLuoghi = luoghiItems
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => {
            if (!q) {
                return true;
            }
            const searchable = normalizeText([
                item.nome,
                item.indirizzo,
                item.mapsUrl,
                item.logoUrl,
                item.lat,
                item.lng
            ].filter(value => value !== null && value !== undefined).join(' '));
            return searchable.includes(q);
        });

    if (!filteredLuoghi.length) {
        luoghiEmptyState.style.display = 'block';
        luoghiEmptyState.textContent = 'Nessun luogo trovato con questa ricerca.';
        return;
    }

    luoghiEmptyState.style.display = 'none';
    luoghiEmptyState.textContent = 'Nessun luogo presente.';

    filteredLuoghi.forEach(({ item, index }) => {
        const latNum = Number(item.lat);
        const lngNum = Number(item.lng);
        const hasCoords = Number.isFinite(latNum)
            && Number.isFinite(lngNum)
            && !(Math.abs(latNum) < 0.000001 && Math.abs(lngNum) < 0.000001);
        const safeMapsUrl = item.mapsUrl ? escapeHtml(item.mapsUrl) : '';
        const mapsBtn = (!hasCoords && safeMapsUrl)
            ? `<div class="item-actions item-actions-right"><a class="item-action-link" href="${safeMapsUrl}" target="_blank" rel="noopener noreferrer">Google Maps</a></div>`
            : '';
        const card = document.createElement('article');
        card.className = 'item';
        card.innerHTML = `
            <h3>${escapeHtml(item.nome)}</h3>
            <div class="meta">${escapeHtml(item.indirizzo || '-')}</div>
            <p class="item-pre"><strong>Maps:</strong> ${safeMapsUrl || '-'}</p>
            <p class="item-pre"><strong>Logo squadra:</strong> ${escapeHtml(item.logoUrl || '-')}</p>
            <p class="item-pre"><strong>Designazione s4y:</strong> ${(Array.isArray(item.designazioneS4y) && item.designazioneS4y.length) ? escapeHtml(item.designazioneS4y.join('; ')) : '-'}</p>
            <p class="item-pre"><strong>Coordinate:</strong> ${escapeHtml(item.lat ?? '-')}, ${escapeHtml(item.lng ?? '-')}</p>
            <div class="item-actions">
                <button type="button" data-action="edit-luogo" data-index="${index}">Modifica</button>
                <button type="button" data-action="delete-luogo" data-index="${index}">Elimina</button>
            </div>
            ${mapsBtn}
        `;
        luoghiList.appendChild(card);
    });
}

function renderPaymentsSheet() {
    if (!paymentsSheetBody) {
        return;
    }
    const tableHeadCells = document.querySelectorAll('#paymentsSheet thead th[data-colkey]');
    tableHeadCells.forEach(cell => {
        const key = String(cell.dataset.colkey || '').trim();
        if (!key) {
            return;
        }
        cell.textContent = paymentsColumns[key] || cell.textContent || '';
    });

    paymentsSheetBody.innerHTML = '';

    if (!paymentsItems.length) {
        paymentsItems.push(createEmptyPaymentRow());
    }

    paymentsItems.forEach((item, index) => {
        const row = document.createElement('tr');
        row.dataset.index = String(index);
        row.innerHTML = `
            <td contenteditable="true" data-field="regione">${escapeHtml(item.regione || '')}</td>
            <td contenteditable="true" data-field="inPagamento">${escapeHtml(item.inPagamento || '')}</td>
            <td contenteditable="true" data-field="fineFebbraio">${escapeHtml(item.fineFebbraio || '')}</td>
            <td contenteditable="true" data-field="chat">${escapeHtml(item.chat || '')}</td>
            <td contenteditable="true" data-field="stato">${escapeHtml(item.stato || '')}</td>
        `;
        paymentsSheetBody.appendChild(row);
    });

    refreshPaymentsSelectedRowUI();
}

function refreshPaymentsSelectedRowUI() {
    if (!paymentsSheetBody) {
        return;
    }
    const rows = paymentsSheetBody.querySelectorAll('tr');
    rows.forEach(row => {
        const index = Number(row.dataset.index);
        row.classList.toggle('is-selected', index === paymentsSelectedRowIndex);
    });
}

function renderAll() {
    renderNewsList();
    renderNewsPreview();
    renderLuoghiList();
    renderLuoghiPreview();
    renderPaymentsSheet();
    renderSuggestionsList();
}

function renderSuggestionsList() {
    if (!suggestionsList || !suggestionsEmptyState) {
        return;
    }
    suggestionsList.innerHTML = '';

    if (!suggestionItems.length) {
        suggestionsEmptyState.style.display = 'block';
        return;
    }
    suggestionsEmptyState.style.display = 'none';

    suggestionItems.forEach(item => {
        const created = item.createdAt
            ? new Date(item.createdAt).toLocaleString('it-IT')
            : '-';
        const canReview = item.status === 'pending';
        const score = Number(Boolean(item.checks?.hasProofUrl)) + Number(Boolean(item.checks?.hasMapsCoords));
        const scoreLabel = score === 2 ? 'Alta' : score === 1 ? 'Media' : 'Bassa';
        const safeMapsUrl = item.mapsUrl ? escapeHtml(item.mapsUrl) : '';
        const safeProofUrl = item.proofUrl ? escapeHtml(item.proofUrl) : '';
        const mapsLink = safeMapsUrl ? `<a class="item-action-link" href="${safeMapsUrl}" target="_blank" rel="noopener noreferrer">Maps</a>` : '';
        const proofLink = safeProofUrl ? `<a class="item-action-link" href="${safeProofUrl}" target="_blank" rel="noopener noreferrer">Fonte</a>` : '';
        const isUpdateSuggestion = item.type === 'campo_update';
        const approveLabel = isUpdateSuggestion ? 'Implementa' : 'Approva';
        const rejectLabel = isUpdateSuggestion ? 'Scarta' : 'Rifiuta';
        const safeId = escapeHtml(item.id);
        const actions = canReview
            ? `<button type="button" data-action="approve-suggestion" data-id="${safeId}">${approveLabel}</button>
               <button type="button" data-action="reject-suggestion" data-id="${safeId}">${rejectLabel}</button>`
            : `<span class="muted">Gia revisionata (${escapeHtml(item.status)})</span>`;

        const card = document.createElement('article');
        card.className = 'item';
        card.innerHTML = `
            <h3>${escapeHtml(item.title || '(senza titolo)')}</h3>
            <div class="meta">Tipo: ${escapeHtml(item.type || '-')} | Squadra: ${escapeHtml(item.team || '-')} | Affidabilita: ${escapeHtml(scoreLabel)}</div>
            <div class="meta">Utente: ${escapeHtml(item.createdByEmail || 'anonimo')} | Data: ${escapeHtml(created)}</div>
            <p>${escapeHtml(item.text || '-')}</p>
            <div class="item-actions">${mapsLink}${proofLink}</div>
            <div class="item-actions">${actions}</div>
        `;
        suggestionsList.appendChild(card);
    });
}

function validateNewsForm() {
    const regione = regionInput.value.trim();
    const titolo = titleInput.value.trim();
    const testo = textInput.value.trim();

    if (!regione || !titolo || !testo) {
        setStatus('Compila Regione, Titolo e Testo.', 'err');
        return null;
    }

    return { regione, titolo, testo };
}

function validateLuogoForm() {
    const nome = luogoNomeInput.value.trim();
    const indirizzo = luogoIndirizzoInput.value.trim();
    const mapsUrl = luogoMapsInput.value.trim();
    const logoUrl = luogoLogoInput.value.trim();
    const designazioneS4yRaw = String(luogoDesignazioneKeyInput?.value || '')
        .split(/[\n;,]+/)
        .map(x => String(x || '').trim())
        .filter(Boolean);
    const designazioneS4y = [];
    const seenDesignazione = new Set();
    designazioneS4yRaw.forEach(value => {
        const key = normalizeText(value);
        if (!key || seenDesignazione.has(key)) {
            return;
        }
        seenDesignazione.add(key);
        designazioneS4y.push(value);
    });
    const coordsText = luogoCoordsInput.value.trim();
    let lat = null;
    let lng = null;

    if (!nome) {
        setLuoghiStatus('Il nome squadra/campo e obbligatorio.', 'err');
        return null;
    }

    if (coordsText) {
        const match = coordsText.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
        if (!match) {
            setLuoghiStatus('Coordinate non valide: usa formato "lat, lng".', 'err');
            return null;
        }
        lat = Number(match[1]);
        lng = Number(match[2]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            setLuoghiStatus('Coordinate non valide: usa numeri decimali.', 'err');
            return null;
        }
    } else if (editLuogoIndex >= 0 && luoghiItems[editLuogoIndex]) {
        // In modifica, se il campo coordinate e vuoto, mantieni quelle gia presenti.
        const existing = luoghiItems[editLuogoIndex];
        const existingLat = Number(existing.lat);
        const existingLng = Number(existing.lng);
        lat = Number.isFinite(existingLat) ? existingLat : null;
        lng = Number.isFinite(existingLng) ? existingLng : null;
    }

    const existing = (editLuogoIndex >= 0 && luoghiItems[editLuogoIndex]) ? luoghiItems[editLuogoIndex] : {};
    return normalizeLuogo({
        ...existing,
        nome,
        indirizzo,
        mapsUrl,
        logoUrl,
        designazioneS4y,
        lat,
        lng
    });
}

function addPaymentRow() {
    if (!requirePublisherAdmin()) {
        return;
    }
    paymentsItems.push(createEmptyPaymentRow());
    paymentsSelectedRowIndex = paymentsItems.length - 1;
    savePaymentsDraft();
    renderPaymentsSheet();
    setPaymentsStatus('Riga aggiunta. Modifica le celle direttamente.', 'ok');
}

function deleteSelectedPaymentRow() {
    if (!requirePublisherAdmin()) {
        return;
    }
    if (paymentsSelectedRowIndex < 0 || paymentsSelectedRowIndex >= paymentsItems.length) {
        setPaymentsStatus('Seleziona una riga da eliminare.', 'err');
        return;
    }
    paymentsItems.splice(paymentsSelectedRowIndex, 1);
    paymentsSelectedRowIndex = -1;
    savePaymentsDraft();
    renderPaymentsSheet();
    setPaymentsStatus('Riga eliminata.', 'ok');
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

    match = value.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
    if (match) {
        return { lat: Number(match[1]), lng: Number(match[2]) };
    }

    return null;
}

function extractCoordinatesFromText(rawText) {
    const text = String(rawText || '').trim();
    if (!text) {
        return null;
    }

    const direct = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (direct) {
        return { lat: Number(direct[1]), lng: Number(direct[2]) };
    }

    return extractCoordinatesFromMapsUrl(text);
}

function hasManualCoordinatesInForm() {
    const coordsText = luogoCoordsInput.value.trim();
    const coords = extractCoordinatesFromText(coordsText);
    return Boolean(coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng));
}

function stripHtmlTags(value) {
    return String(value || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildTuttocampoTeamPageUrl(rawId) {
    const path = String(rawId || '').trim().replace(/^\/+/, '');
    if (!path) {
        return '';
    }
    return `https://www.tuttocampo.it/${path}/Scheda`;
}

function cleanLuogoNameForTeamSearch(nome) {
    return String(nome || '')
        .replace(/^campo di\s+/i, '')
        .replace(/^campo del\s+/i, '')
        .replace(/^campo\s+/i, '')
        .trim();
}

function scoreTuttocampoCandidate(candidate, searchValue, originalName) {
    const display = stripHtmlTags(candidate?.text || '');
    const candidateName = display.split('(')[0].trim();
    const normCandidate = normalizeText(candidateName);
    const normSearch = normalizeText(searchValue);
    const normOriginal = normalizeText(originalName);
    const typeLabel = String(candidate?.typeLabel || '');

    let score = 0;
    if (normCandidate && (normCandidate === normSearch || normCandidate === normOriginal)) {
        score += 140;
    }
    if (normCandidate && normSearch && (normCandidate.includes(normSearch) || normSearch.includes(normCandidate))) {
        score += 80;
    }
    if (normCandidate && normOriginal && (normCandidate.includes(normOriginal) || normOriginal.includes(normCandidate))) {
        score += 60;
    }
    if (typeLabel === 'Dilettanti') {
        score += 25;
    }
    if (/prima categoria|promozione|eccellenza|seconda categoria|terza categoria/i.test(display)) {
        score += 12;
    }
    if (/calcio a 5/i.test(display)) {
        score -= 80;
    }
    return score;
}

async function fetchTuttocampoTeamCandidates(searchValue, regionName = TUTTOCAMPO_DEFAULT_REGION) {
    const query = String(searchValue || '').trim();
    if (!query) {
        return [];
    }
    const params = new URLSearchParams({
        search_value: query,
        region_name: regionName
    });
    const response = await fetch(`${TUTTOCAMPO_TEAM_SEARCH_URL}?${params.toString()}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json, text/javascript, */*; q=0.01'
        }
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
        return [];
    }

    const items = [];
    payload.forEach(group => {
        const typeLabel = String(group?.text || '').trim();
        const children = Array.isArray(group?.children) ? group.children : [];
        children.forEach(child => {
            const url = buildTuttocampoTeamPageUrl(child?.id);
            if (url) {
                items.push({
                    ...child,
                    typeLabel,
                    url
                });
            }
        });
    });
    return items;
}

async function resolveTuttocampoLogoUrlForLuogo(item) {
    const originalName = String(item?.nome || '').split('|')[0].trim();
    const normalizedName = normalizeText(originalName);
    if (!normalizedName) {
        return '';
    }

    const override = TUTTOCAMPO_LOGO_OVERRIDES[normalizedName];
    if (override) {
        return override;
    }

    const searchValue = cleanLuogoNameForTeamSearch(originalName);
    if (searchValue.length < 3) {
        return '';
    }

    const withAccents = searchValue
        .replace(/\bcitta\b/gi, 'Città')
        .replace(/\bsocieta\b/gi, 'Società');
    const queries = Array.from(new Set([withAccents, searchValue]));

    let candidates = [];
    for (const q of queries) {
        candidates = await fetchTuttocampoTeamCandidates(q, TUTTOCAMPO_DEFAULT_REGION);
        if (candidates.length) {
            break;
        }
    }
    if (!candidates.length) {
        return '';
    }

    const ranked = candidates
        .map(candidate => ({
            candidate,
            score: scoreTuttocampoCandidate(candidate, searchValue, originalName)
        }))
        .sort((a, b) => b.score - a.score);

    if (!ranked.length || ranked[0].score < 95) {
        return '';
    }
    return ranked[0].candidate.url;
}

async function autoFillMissingLuoghiLogos() {
    if (!requirePublisherAdmin()) {
        return;
    }
    if (!luoghiItems.length) {
        setLuoghiStatus('Nessun luogo da analizzare.', 'err');
        return;
    }

    if (luogoAutofillLogosBtn) {
        luogoAutofillLogosBtn.disabled = true;
    }

    const missingIndexes = [];
    luoghiItems.forEach((item, index) => {
        if (!String(item?.logoUrl || '').trim()) {
            missingIndexes.push(index);
        }
    });

    if (!missingIndexes.length) {
        if (luogoAutofillLogosBtn) {
            luogoAutofillLogosBtn.disabled = false;
        }
        setLuoghiStatus('Tutti i luoghi hanno gia un logo squadra.', 'ok');
        return;
    }

    let updated = 0;
    const unresolved = [];
    let hadNetworkErrors = false;
    for (const index of missingIndexes) {
        const item = luoghiItems[index];
        const nome = String(item?.nome || '').trim() || `Luogo ${index + 1}`;
        try {
            const logoUrl = await resolveTuttocampoLogoUrlForLuogo(item);
            if (logoUrl) {
                luoghiItems[index].logoUrl = logoUrl;
                updated += 1;
            } else {
                unresolved.push(nome);
            }
        } catch {
            hadNetworkErrors = true;
            unresolved.push(nome);
        }
    }

    saveLuoghiDraft();
    renderAll();
    if (editLuogoIndex >= 0) {
        fillLuogoForm(editLuogoIndex);
    }

    if (luogoAutofillLogosBtn) {
        luogoAutofillLogosBtn.disabled = false;
    }

    if (!updated) {
        const suffix = hadNetworkErrors ? ' Possibile blocco rete/CORS su Tuttocampo.' : '';
        setLuoghiStatus(`Nessun logo trovato automaticamente. Verifica manuale per: ${unresolved.slice(0, 5).join(', ') || 'tutti i luoghi'}.${suffix}`, 'err');
        return;
    }

    if (!unresolved.length) {
        setLuoghiStatus(`Logo squadra compilato per ${updated} luoghi. Premi "Pubblica Luoghi" per salvare su Firebase.`, 'ok');
        return;
    }

    setLuoghiStatus(`Logo squadra compilato per ${updated} luoghi. Da verificare: ${unresolved.slice(0, 5).join(', ')}. Poi premi "Pubblica Luoghi".`, 'ok');
}

async function geocodeCoordinatesByText(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=it&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
        headers: { 'Accept-Language': 'it' }
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const results = await response.json();
    if (!Array.isArray(results) || !results.length) {
        return null;
    }
    const best = results[0];
    const lat = Number(best.lat);
    const lng = Number(best.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }
    return { lat, lng };
}

async function autoResolveCoordinatesFromLink() {
    if (hasManualCoordinatesInForm()) {
        return;
    }

    const mapsUrl = luogoMapsInput.value.trim();
    if (!mapsUrl) {
        return;
    }

    const direct = extractCoordinatesFromMapsUrl(mapsUrl);
    if (direct && Number.isFinite(direct.lat) && Number.isFinite(direct.lng)) {
        luogoCoordsInput.value = `${direct.lat}, ${direct.lng}`;
        setLuoghiStatus('Coordinate estratte direttamente dal link.', 'ok');
        return;
    }

    const queryParts = [
        luogoNomeInput.value.trim(),
        luogoIndirizzoInput.value.trim(),
        'Italia'
    ].filter(Boolean);
    const query = queryParts.join(', ');
    if (!query) {
        luogoCoordsInput.value = '';
        setLuoghiStatus('Link senza coordinate: inserisci nome e indirizzo per lookup automatico.', 'err');
        return;
    }

    const resolveKey = `${mapsUrl}||${query}`;
    if (resolveKey === lastGeoResolveKey) {
        return;
    }
    lastGeoResolveKey = resolveKey;

    try {
        setLuoghiStatus('Link corto rilevato: ricerca coordinate gratis in corso...', '');
        const resolved = await geocodeCoordinatesByText(query);
        if (!resolved) {
            luogoCoordsInput.value = '';
            setLuoghiStatus('Coordinate non trovate automaticamente. Inseriscile manualmente.', 'err');
            return;
        }
        luogoCoordsInput.value = `${resolved.lat}, ${resolved.lng}`;
        setLuoghiStatus('Coordinate trovate automaticamente (OpenStreetMap).', 'ok');
    } catch (error) {
        luogoCoordsInput.value = '';
        setLuoghiStatus(`Errore lookup coordinate: ${error.message}`, 'err');
    }
}

function scheduleAutoCoordinateResolve() {
    if (hasManualCoordinatesInForm()) {
        return;
    }

    const mapsUrl = luogoMapsInput.value.trim();
    if (!mapsUrl) {
        return;
    }
    if (geoResolveTimer) {
        clearTimeout(geoResolveTimer);
    }
    geoResolveTimer = setTimeout(() => {
        autoResolveCoordinatesFromLink();
    }, 700);
}

function scheduleAutoResolveIfLinkPresent() {
    if (luogoMapsInput.value.trim()) {
        scheduleAutoCoordinateResolve();
    }
}

async function pasteCoordinatesFromClipboard() {
    if (!navigator.clipboard?.readText) {
        setLuoghiStatus('Clipboard non supportata dal browser.', 'err');
        return;
    }
    try {
        const text = await navigator.clipboard.readText();
        const coords = extractCoordinatesFromText(text);
        if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
            setLuoghiStatus('Nessuna coordinata valida trovata negli appunti.', 'err');
            return;
        }
        luogoCoordsInput.value = `${coords.lat}, ${coords.lng}`;
        setLuoghiStatus('Coordinate incollate dagli appunti.', 'ok');
    } catch (error) {
        setLuoghiStatus(`Impossibile leggere appunti: ${error.message}`, 'err');
    }
}

function handleSaveNews() {
    if (!requirePublisherAdmin()) {
        return;
    }
    const data = validateNewsForm();
    if (!data) {
        return;
    }

    if (editNewsIndex >= 0) {
        newsItems[editNewsIndex] = data;
        setStatus('News aggiornata.', 'ok');
    } else {
        newsItems.push(data);
        setStatus('News aggiunta.', 'ok');
    }

    saveNewsDraft();
    renderAll();
    resetNewsForm();
    publishNewsFirebase();
}

function handleSaveLuogo() {
    if (!requirePublisherAdmin()) {
        return;
    }
    const data = validateLuogoForm();
    if (!data) {
        return;
    }

    if (editLuogoIndex >= 0) {
        luoghiItems[editLuogoIndex] = data;
        setLuoghiStatus('Luogo aggiornato.', 'ok');
    } else {
        luoghiItems.push(data);
        setLuoghiStatus('Luogo aggiunto.', 'ok');
    }

    saveLuoghiDraft();
    renderAll();
    resetLuogoForm();
    publishLuoghiFirebase();
}

async function publishNewsFirebase() {
    if (!requirePublisherAdmin()) {
        return;
    }
    const fb = getFirebaseState();
    if (!fb.ready || !fb.db || !fb.auth) {
        setStatus('Firebase non inizializzato.', 'err');
        return;
    }

    if (!fb.auth.currentUser) {
        setStatus('Effettua prima il login Firebase.', 'err');
        return;
    }

    try {
        await fb.db.ref('news').set(newsItems.map(normalizeNews));
        setStatus('News pubblicate su Firebase.', 'ok');
    } catch (error) {
        setStatus(`Errore Firebase: ${error.message}`, 'err');
    }
}

async function loadNewsFromFirebase(silent = false) {
    const fb = getFirebaseState();
    if (!fb.ready || !fb.db) {
        if (!silent) {
            setStatus('Firebase non inizializzato.', 'err');
        }
        return false;
    }

    try {
        const snap = await fb.db.ref('news').once('value');
        const raw = snap.exists() ? snap.val() : [];
        const fromDb = Array.isArray(raw) ? raw : Object.values(raw || {});
        newsItems = fromDb.map(normalizeNews);
        saveNewsDraft();
        populateRegionSelect();
        newsItems.forEach(item => ensureRegionOption(item.regione));
        renderAll();
        if (!silent) {
            setStatus('News caricate da Firebase.', 'ok');
        }
        return true;
    } catch (error) {
        if (!silent) {
            setStatus(`Errore caricamento Firebase: ${error.message}`, 'err');
        }
        return false;
    }
}

async function publishLuoghiFirebase() {
    if (!requirePublisherAdmin()) {
        return;
    }
    const fb = getFirebaseState();
    if (!fb.ready || !fb.db || !fb.auth) {
        setLuoghiStatus('Firebase non inizializzato.', 'err');
        return;
    }

    if (!fb.auth.currentUser) {
        setLuoghiStatus('Effettua prima il login Firebase.', 'err');
        return;
    }

    if (!luoghiItems.length) {
        setLuoghiStatus('Nessun luogo da pubblicare: importa o aggiungi almeno un record.', 'err');
        return;
    }

    try {
        await fb.db.ref('luoghi').set(luoghiItems.map(normalizeLuogo));
        setLuoghiStatus(`Luoghi pubblicati su Firebase: ${luoghiItems.length}.`, 'ok');
    } catch (error) {
        setLuoghiStatus(`Errore Firebase: ${error.message}`, 'err');
    }
}

let pendingLuoghiRepairSync = false;

async function loadLuoghiFromFirebase(silent = false) {
    const fb = getFirebaseState();
    if (!fb.ready || !fb.db) {
        if (!silent) {
            setLuoghiStatus('Firebase non inizializzato.', 'err');
        }
        return false;
    }

    try {
        const snap = await fb.db.ref('luoghi').once('value');
        const raw = snap.exists() ? snap.val() : [];
        const fromDb = Array.isArray(raw) ? raw : Object.values(raw || {});
        const { cleaned, changed } = repairCorruptedLuoghiDatabase(fromDb);
        luoghiItems = cleaned;
        saveLuoghiDraft();
        renderAll();
        if (changed) {
            if (fb.auth?.currentUser && isPublisherAdmin(fb.auth.currentUser)) {
                fb.db.ref('luoghi').set(luoghiItems.map(normalizeLuogo)).catch(() => {});
                pendingLuoghiRepairSync = false;
            } else {
                pendingLuoghiRepairSync = true;
            }
        }
        if (!silent) {
            setLuoghiStatus('Luoghi caricati da Firebase.', 'ok');
        }
        return true;
    } catch (error) {
        if (!silent) {
            setLuoghiStatus(`Errore caricamento Firebase: ${error.message}`, 'err');
        }
        return false;
    }
}

async function firebaseLogin() {
    const fb = getFirebaseState();
    if (!fb.ready || !fb.auth) {
        setStatus('Firebase non inizializzato.', 'err');
        setLuoghiStatus('Firebase non inizializzato.', 'err');
        return;
    }

    const email = loginEmail.value.trim();
    const password = loginPassword.value;
    if (!email || !password) {
        setStatus('Inserisci email e password.', 'err');
        return;
    }

    try {
        await fb.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        await fb.auth.signInWithEmailAndPassword(email, password);
        setStatus('Login Firebase effettuato.', 'ok');
        setLuoghiStatus('Login Firebase effettuato.', 'ok');
        setPaymentsStatus('Login Firebase effettuato.', 'ok');
        loginPassword.value = '';
    } catch (error) {
        setStatus(`Login fallito: ${error.message}`, 'err');
        setLuoghiStatus(`Login fallito: ${error.message}`, 'err');
        setPaymentsStatus(`Login fallito: ${error.message}`, 'err');
    }
}

async function firebaseLoginWithGoogle() {
    const fb = getFirebaseState();
    if (!fb.ready || !fb.auth || !window.firebase?.auth) {
        setStatus('Firebase non inizializzato.', 'err');
        setLuoghiStatus('Firebase non inizializzato.', 'err');
        setPaymentsStatus('Firebase non inizializzato.', 'err');
        return;
    }

    try {
        await fb.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({
            prompt: 'select_account'
        });
        await fb.auth.signInWithPopup(provider);
        setStatus('Login Google effettuato.', 'ok');
        setLuoghiStatus('Login Google effettuato.', 'ok');
        setPaymentsStatus('Login Google effettuato.', 'ok');
    } catch (error) {
        const message = String(error?.message || 'Login Google fallito.');
        setStatus(`Login Google fallito: ${message}`, 'err');
        setLuoghiStatus(`Login Google fallito: ${message}`, 'err');
        setPaymentsStatus(`Login Google fallito: ${message}`, 'err');
    }
}

async function firebaseLogout() {
    const fb = getFirebaseState();
    if (!fb.ready || !fb.auth) {
        setStatus('Firebase non inizializzato.', 'err');
        setLuoghiStatus('Firebase non inizializzato.', 'err');
        return;
    }

    try {
        await fb.auth.signOut();
        setStatus('Logout effettuato.', 'ok');
        setLuoghiStatus('Logout effettuato.', 'ok');
        setPaymentsStatus('Logout effettuato.', 'ok');
    } catch (error) {
        setStatus(`Logout fallito: ${error.message}`, 'err');
        setLuoghiStatus(`Logout fallito: ${error.message}`, 'err');
        setPaymentsStatus(`Logout fallito: ${error.message}`, 'err');
    }
}

function bindAuthState() {
    const fb = getFirebaseState();
    setPublisherAuthControlsVisibility(null);
    setPublisherAuthAvatar('');
    setPublisherAuthProfileSummary(null, {});
    if (!fb.ready || !fb.auth) {
        setAuthStatus('Firebase non disponibile', false);
        setPublisherAccess(false);
        return;
    }

    fb.auth.onAuthStateChanged(async user => {
        setPublisherAuthControlsVisibility(user);
        const profile = await loadPublisherUserProfile(user);
        const isAdmin = isPublisherAdmin(user);
        setPublisherAccess(isAdmin);

        if (user && isAdmin) {
            const label = String(profile?.nickname || user.displayName || user.email || '').trim();
            setAuthStatus(`Autenticato admin: ${label}`, true);
            if (pendingLuoghiRepairSync && fb.db && luoghiItems.length) {
                pendingLuoghiRepairSync = false;
                fb.db.ref('luoghi').set(luoghiItems.map(normalizeLuogo)).catch(() => {});
            }
        } else if (user) {
            const label = String(profile?.nickname || user.displayName || user.email || '').trim();
            setAuthStatus(`Accesso negato per ${label}`, false);
        } else {
            setAuthStatus('Non autenticato', false);
        }
    });
}

async function publishPaymentsFirebase() {
    if (!requirePublisherAdmin()) {
        return;
    }
    const fb = getFirebaseState();
    if (!fb.ready || !fb.db || !fb.auth) {
        setPaymentsStatus('Firebase non inizializzato.', 'err');
        return;
    }

    if (!fb.auth.currentUser) {
        setPaymentsStatus('Effettua prima il login Firebase.', 'err');
        return;
    }

    const payload = {
        columns: normalizePaymentColumns(paymentsColumns),
        items: getPaymentsForPublish()
    };

    try {
        await fb.db.ref('pagamenti').set(payload);
        setPaymentsStatus(`Pagamenti pubblicati su Firebase: ${payload.items.length}.`, 'ok');
    } catch (error) {
        setPaymentsStatus(`Errore Firebase: ${error.message}`, 'err');
    }
}

async function loadPaymentsFromFirebase(silent = false) {
    const fb = getFirebaseState();
    if (!fb.ready || !fb.db) {
        if (!silent) {
            setPaymentsStatus('Firebase non inizializzato.', 'err');
        }
        return false;
    }

    try {
        const snap = await fb.db.ref('pagamenti').once('value');
        const raw = snap.exists() ? snap.val() : [];
        if (Array.isArray(raw)) {
            paymentsItems = raw.map(normalizePayment);
            paymentsColumns = normalizePaymentColumns({});
        } else {
            const items = Array.isArray(raw?.items)
                ? raw.items
                : Array.isArray(raw?.pagamenti)
                    ? raw.pagamenti
                    : Object.values(raw || {});
            paymentsItems = items.map(normalizePayment);
            paymentsColumns = normalizePaymentColumns(raw?.columns);
        }
        savePaymentsDraft();
        renderAll();
        if (!silent) {
            setPaymentsStatus('Pagamenti caricati da Firebase.', 'ok');
        }
        return true;
    } catch (error) {
        if (!silent) {
            setPaymentsStatus(`Errore caricamento Firebase: ${error.message}`, 'err');
        }
        return false;
    }
}

async function loadSuggestionsFromFirebase(silent = false) {
    const fb = getFirebaseState();
    if (!fb.ready || !fb.db) {
        if (!silent) {
            setSuggestionsStatus('Firebase non inizializzato.', 'err');
        }
        return false;
    }

    try {
        const snap = await fb.db.ref('suggestions').once('value');
        const raw = snap.exists() ? snap.val() : {};
        suggestionItems = Object.entries(raw || {})
            .map(([key, value]) => normalizeSuggestion(value, key))
            .filter(item => item.status === 'pending')
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        renderSuggestionsList();
        if (!silent) {
            setSuggestionsStatus(`Segnalazioni in coda: ${suggestionItems.length}`, 'ok');
        }
        return true;
    } catch (error) {
        if (!silent) {
            setSuggestionsStatus(`Errore caricamento: ${error.message}`, 'err');
        }
        return false;
    }
}

function isDuplicateLuogoSuggestion(suggestion) {
    const targetName = normalizeText(suggestion.team || suggestion.title);
    const targetMaps = normalizeText(suggestion.mapsUrl);
    return luoghiItems.some(item => {
        const sameName = targetName && normalizeText(item.nome).includes(targetName);
        const sameMaps = targetMaps && normalizeText(item.mapsUrl) === targetMaps;
        return sameName || sameMaps;
    });
}

async function approveSuggestionById(suggestionId) {
    if (!requirePublisherAdmin()) {
        return;
    }
    const fb = getFirebaseState();
    const suggestion = suggestionItems.find(item => item.id === suggestionId);
    if (!suggestion || !fb.ready || !fb.db || !fb.auth?.currentUser) {
        setSuggestionsStatus('Segnalazione non trovata o Firebase non pronto.', 'err');
        return;
    }

    try {
        if (suggestion.type === 'campo_update') {
            const luogoIndex = findLuogoIndexForUpdateSuggestion(suggestion);
            if (luogoIndex < 0) {
                setSuggestionsStatus('Campo da aggiornare non trovato in archivio.', 'err');
                return;
            }

            const candidateAddress = getSuggestionAddressCandidate(suggestion);
            const designazioneKey = String(suggestion?.extracted?.designazioneS4y || '').trim();
            if (!candidateAddress && !designazioneKey) {
                setSuggestionsStatus('Segnalazione senza indirizzo/designazione utili da implementare.', 'err');
                return;
            }

            const updated = mergeLuogoDesignazioneKey(
                mergeLuogoAddressHint({ ...luoghiItems[luogoIndex] }, candidateAddress),
                designazioneKey
            );
            luoghiItems[luogoIndex] = normalizeLuogo(updated);
            saveLuoghiDraft();
            await fb.db.ref('luoghi').set(luoghiItems.map(normalizeLuogo));
            await fb.db.ref(`suggestions/${suggestion.id}`).update({
                status: 'implemented',
                reviewedAt: Date.now(),
                reviewedBy: fb.auth.currentUser.email || fb.auth.currentUser.uid,
                target: 'luoghi_update'
            });
            setSuggestionsStatus('Aggiornamento implementato sul campo esistente.', 'ok');
        } else if (suggestion.type === 'campo') {
            if (isDuplicateLuogoSuggestion(suggestion)) {
                await fb.db.ref(`suggestions/${suggestion.id}`).update({
                    status: 'duplicate',
                    reviewedAt: Date.now(),
                    reviewedBy: fb.auth.currentUser.email || fb.auth.currentUser.uid
                });
                setSuggestionsStatus('Campo gia presente: segnalazione marcata come duplicata.', 'err');
            } else {
                luoghiItems.push(buildLuogoFromFieldSuggestion(suggestion));
                saveLuoghiDraft();
                await fb.db.ref('luoghi').set(luoghiItems.map(normalizeLuogo));
                await fb.db.ref(`suggestions/${suggestion.id}`).update({
                    status: 'approved',
                    reviewedAt: Date.now(),
                    reviewedBy: fb.auth.currentUser.email || fb.auth.currentUser.uid,
                    target: 'luoghi'
                });
                setSuggestionsStatus('Segnalazione approvata e pubblicata in luoghi.', 'ok');
            }
        } else {
            newsItems.push(normalizeNews({
                regione: 'Tutti',
                titolo: suggestion.title,
                testo: suggestion.text
            }));
            saveNewsDraft();
            await fb.db.ref('news').set(newsItems.map(normalizeNews));
            await fb.db.ref(`suggestions/${suggestion.id}`).update({
                status: 'approved',
                reviewedAt: Date.now(),
                reviewedBy: fb.auth.currentUser.email || fb.auth.currentUser.uid,
                target: 'news'
            });
            setSuggestionsStatus('Segnalazione approvata e pubblicata in news.', 'ok');
        }

        await Promise.all([
            loadSuggestionsFromFirebase(true),
            loadNewsFromFirebase(true),
            loadLuoghiFromFirebase(true)
        ]);
        renderAll();
    } catch (error) {
        setSuggestionsStatus(`Errore approvazione: ${error.message}`, 'err');
    }
}

async function rejectSuggestionById(suggestionId) {
    if (!requirePublisherAdmin()) {
        return;
    }
    const fb = getFirebaseState();
    if (!fb.ready || !fb.db || !fb.auth?.currentUser) {
        setSuggestionsStatus('Firebase non pronto.', 'err');
        return;
    }

    const reason = window.prompt('Motivo rifiuto (opzionale):', '') || '';
    try {
        await fb.db.ref(`suggestions/${suggestionId}`).update({
            status: 'rejected',
            rejectReason: reason.trim(),
            reviewedAt: Date.now(),
            reviewedBy: fb.auth.currentUser.email || fb.auth.currentUser.uid
        });
        setSuggestionsStatus('Segnalazione rifiutata.', 'ok');
        await loadSuggestionsFromFirebase(true);
        renderSuggestionsList();
    } catch (error) {
        setSuggestionsStatus(`Errore rifiuto: ${error.message}`, 'err');
    }
}

function setupPublisherAuthPopover() {
    const toggleBtn = document.getElementById('publisherAuthToggleBtn');
    const popover = document.getElementById('publisherAuthPopover');
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

function setupPageTabs() {
    const tabs = document.querySelectorAll('.page-tab');
    const pages = document.querySelectorAll('.publisher-page');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.dataset.pageTarget;
            tabs.forEach(t => t.classList.remove('active'));
            pages.forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const targetPage = document.getElementById(targetId);
            if (targetPage) {
                targetPage.classList.add('active');
            }
        });
    });
}

newsList.addEventListener('click', event => {
    if (!requirePublisherAdmin()) {
        return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }

    const index = Number(target.dataset.index);
    if (Number.isNaN(index)) {
        return;
    }

    if (target.dataset.action === 'edit-news') {
        fillNewsForm(index);
        titleInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        titleInput?.focus();
    }

    if (target.dataset.action === 'delete-news') {
        newsItems.splice(index, 1);
        saveNewsDraft();
        renderAll();
        setStatus('News eliminata.', 'ok');
        publishNewsFirebase();
    }
});

luoghiList.addEventListener('click', event => {
    if (!requirePublisherAdmin()) {
        return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }

    const index = Number(target.dataset.index);
    if (Number.isNaN(index)) {
        return;
    }

    if (target.dataset.action === 'edit-luogo') {
        fillLuogoForm(index);
        luogoNomeInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        luogoNomeInput?.focus();
    }

    if (target.dataset.action === 'delete-luogo') {
        luoghiItems.splice(index, 1);
        saveLuoghiDraft();
        renderAll();
        setLuoghiStatus('Luogo eliminato.', 'ok');
        publishLuoghiFirebase();
    }
});

const scheduleAutoPublishPayments = debounce(() => {
    const fb = getFirebaseState();
    if (fb.ready && fb.auth?.currentUser && isPublisherAdmin(fb.auth.currentUser)) {
        publishPaymentsFirebase();
    }
}, 900);

if (paymentsSheetBody) {
    paymentsSheetBody.addEventListener('click', event => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const row = target.closest('tr');
        if (!row) {
            return;
        }
        const index = Number(row.dataset.index);
        if (Number.isNaN(index)) {
            return;
        }
        paymentsSelectedRowIndex = index;
        refreshPaymentsSelectedRowUI();
    });

    paymentsSheetBody.addEventListener('input', event => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const cell = target.closest('td[data-field]');
        const row = target.closest('tr');
        if (!cell || !row) {
            return;
        }
        const index = Number(row.dataset.index);
        const field = String(cell.dataset.field || '').trim();
        if (Number.isNaN(index) || !field || !paymentsItems[index]) {
            return;
        }
        paymentsItems[index][field] = String(cell.textContent || '').trim();
        savePaymentsDraft();
        setPaymentsStatus('Bozza aggiornata (salvataggio automatico in corso...).', 'ok');
        scheduleAutoPublishPayments();
    });

    paymentsSheetBody.addEventListener('paste', event => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const cell = target.closest('td[data-field]');
        if (!cell) {
            return;
        }
        event.preventDefault();
        const plain = String(event.clipboardData?.getData('text/plain') || '').replace(/\r?\n/g, ' ').trim();
        document.execCommand('insertText', false, plain);
    });
}
const paymentsSheetHead = document.querySelector('#paymentsSheet thead');
if (paymentsSheetHead) {
    paymentsSheetHead.addEventListener('input', event => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const cell = target.closest('th[data-colkey]');
        if (!cell) {
            return;
        }
        const key = String(cell.dataset.colkey || '').trim();
        if (!key) {
            return;
        }
        paymentsColumns[key] = String(cell.textContent || '').trim() || normalizePaymentColumns({})[key];
        savePaymentsDraft();
        setPaymentsStatus('Nome colonna aggiornato (salvataggio automatico in corso...).', 'ok');
        scheduleAutoPublishPayments();
    });
}

saveBtn.addEventListener('click', handleSaveNews);
clearBtn.addEventListener('click', resetNewsForm);
publishBtn.addEventListener('click', publishNewsFirebase);
loadRemoteBtn.addEventListener('click', () => loadNewsFromFirebase(false));

luogoSaveBtn.addEventListener('click', handleSaveLuogo);
luogoClearBtn.addEventListener('click', resetLuogoForm);
if (luogoAutofillLogosBtn) {
    luogoAutofillLogosBtn.addEventListener('click', autoFillMissingLuoghiLogos);
}
luoghiPublishBtn.addEventListener('click', publishLuoghiFirebase);
luoghiLoadBtn.addEventListener('click', () => loadLuoghiFromFirebase(false));
luogoMapsInput.addEventListener('input', scheduleAutoCoordinateResolve);
luogoNomeInput.addEventListener('input', scheduleAutoResolveIfLinkPresent);
luogoIndirizzoInput.addEventListener('input', scheduleAutoResolveIfLinkPresent);
pasteCoordsBtn.addEventListener('click', pasteCoordinatesFromClipboard);
function exportPaymentsToCsv() {
    if (!paymentsItems.length) {
        setPaymentsStatus('Nessun dato pagamenti da esportare.', 'err');
        return;
    }
    const cols = [
        { key: 'regione', label: paymentsColumns.regione || 'Regione' },
        { key: 'inPagamento', label: paymentsColumns.inPagamento || 'Pacchi in pagamento' },
        { key: 'fineFebbraio', label: paymentsColumns.fineFebbraio || 'Fine febbraio' },
        { key: 'chat', label: paymentsColumns.chat || 'Riscontro chat' },
        { key: 'stato', label: paymentsColumns.stato || 'Stato' }
    ];
    const escapeCsv = val => {
        const str = String(val ?? '').trim();
        if (/[;"\r\n]/.test(str)) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };
    const headerRow = cols.map(c => escapeCsv(c.label)).join(';');
    const dataRows = paymentsItems.map(item => {
        return cols.map(c => escapeCsv(item[c.key])).join(';');
    });
    const csvContent = '\uFEFF' + [headerRow, ...dataRows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `matchmap_pagamenti_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setPaymentsStatus(`Esportate ${paymentsItems.length} righe in CSV con successo!`, 'ok');
}

function importPaymentsFromCsv(csvText) {
    const text = String(csvText || '').trim();
    if (!text) {
        setPaymentsStatus('File CSV vuoto.', 'err');
        return;
    }
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) {
        setPaymentsStatus("Il file CSV deve contenere un'intestazione e almeno una riga.", 'err');
        return;
    }
    const delimiter = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
    
    const parseLine = line => {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === delimiter && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current.trim());
        return result;
    };

    const header = parseLine(lines[0]).map(h => normalizeText(h));
    const findIndex = keywords => header.findIndex(h => keywords.some(k => h.includes(k)));

    let regIdx = findIndex(['region']);
    let inPagIdx = findIndex(['pacch', 'pagament', 'inpagamento']);
    let fineFebIdx = findIndex(['fine', 'febbraio']);
    let chatIdx = findIndex(['chat', 'riscontro']);
    let statoIdx = findIndex(['stat']);

    if (regIdx === -1) regIdx = 0;
    if (inPagIdx === -1) inPagIdx = 1;
    if (fineFebIdx === -1) fineFebIdx = 2;
    if (chatIdx === -1) chatIdx = 3;
    if (statoIdx === -1) statoIdx = 4;

    const newItems = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = parseLine(lines[i]);
        if (!cells || !cells.length || cells.every(c => !c)) continue;
        const regione = cells[regIdx] || '';
        const inPagamento = cells[inPagIdx] || '';
        const fineFebbraio = cells[fineFebIdx] || '';
        const chat = cells[chatIdx] || '';
        const stato = cells[statoIdx] || '';
        if (regione || inPagamento || stato) {
            newItems.push({
                regione,
                inPagamento,
                fineFebbraio,
                chat,
                stato
            });
        }
    }

    if (!newItems.length) {
        setPaymentsStatus('Nessuna riga valida trovata nel file CSV.', 'err');
        return;
    }

    paymentsItems = newItems;
    savePaymentsDraft();
    renderPaymentsSheet();
    setPaymentsStatus(`Importate con successo ${paymentsItems.length} righe pagamenti dal CSV!`, 'ok');
}

if (luoghiSearchInput) {
    const handleLuoghiSearch = debounce(event => {
        luoghiSearchTerm = String(event.target?.value || '');
        renderLuoghiList();
    }, 180);
    luoghiSearchInput.addEventListener('input', handleLuoghiSearch);
}
if (paymentsAddRowBtn) {
    paymentsAddRowBtn.addEventListener('click', addPaymentRow);
}
if (paymentsDeleteRowBtn) {
    paymentsDeleteRowBtn.addEventListener('click', deleteSelectedPaymentRow);
}
if (paymentsPublishBtn) {
    paymentsPublishBtn.addEventListener('click', publishPaymentsFirebase);
}
if (paymentsLoadBtn) {
    paymentsLoadBtn.addEventListener('click', () => loadPaymentsFromFirebase(false));
}
if (paymentsExportCsvBtn) {
    paymentsExportCsvBtn.addEventListener('click', exportPaymentsToCsv);
}
if (paymentsImportCsvBtn) {
    paymentsImportCsvBtn.addEventListener('click', () => {
        if (paymentsCsvFileInput) paymentsCsvFileInput.click();
    });
}
if (paymentsCsvFileInput) {
    paymentsCsvFileInput.addEventListener('change', event => {
        const file = event.target?.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            const content = String(e.target?.result || '');
            importPaymentsFromCsv(content);
            paymentsCsvFileInput.value = '';
        };
        reader.onerror = () => {
            setPaymentsStatus('Errore nella lettura del file CSV.', 'err');
            paymentsCsvFileInput.value = '';
        };
        reader.readAsText(file, 'utf-8');
    });
}

loginBtn.addEventListener('click', firebaseLogin);
if (loginGoogleBtn) {
    loginGoogleBtn.addEventListener('click', firebaseLoginWithGoogle);
}
logoutBtn.addEventListener('click', firebaseLogout);
if (publisherLogoutLinkBtn) {
    publisherLogoutLinkBtn.addEventListener('click', firebaseLogout);
}
if (suggestionsLoadBtn) {
    suggestionsLoadBtn.addEventListener('click', () => loadSuggestionsFromFirebase(false));
}

if (suggestionsList) {
    suggestionsList.addEventListener('click', event => {
        if (!requirePublisherAdmin()) {
            return;
        }
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const suggestionId = String(target.dataset.id || '').trim();
        if (!suggestionId) {
            return;
        }
        if (target.dataset.action === 'approve-suggestion') {
            approveSuggestionById(suggestionId);
        }
        if (target.dataset.action === 'reject-suggestion') {
            rejectSuggestionById(suggestionId);
        }
    });
}

const GEMINI_VISION_API_KEY_STORAGE = 'matchmap_publisher_gemini_api_key_v1';

const STANDARD_AIA_PAYMENT_REGIONS = [
    { canonical: 'Abruzzo', patterns: ['abruzzo'] },
    { canonical: 'Basilicata', patterns: ['basilicata'] },
    { canonical: 'Calabria', patterns: ['calabria'] },
    { canonical: 'Campania', patterns: ['campania'] },
    { canonical: 'Emilia-Romagna', patterns: ['emilia romagna', 'emilia-romagna', 'emilia'] },
    { canonical: 'Friuli-Venezia Giulia', patterns: ['friuli venezia giulia', 'friuli-venezia giulia', 'friuli'] },
    { canonical: 'Lazio', patterns: ['lazio'] },
    { canonical: 'Liguria', patterns: ['liguria'] },
    { canonical: 'Lombardia', patterns: ['lombardia'] },
    { canonical: 'Marche', patterns: ['marche'] },
    { canonical: 'Molise', patterns: ['molise'] },
    { canonical: "Piemonte/Valle D'Aosta", patterns: ['piemonte valle d aosta', 'piemonte vda', 'piemonte', 'valle d aosta'] },
    { canonical: 'Puglia', patterns: ['puglia'] },
    { canonical: 'Sardegna', patterns: ['sardegna'] },
    { canonical: 'Sicilia', patterns: ['sicilia'] },
    { canonical: 'Toscana', patterns: ['toscana'] },
    { canonical: 'Umbria', patterns: ['umbria'] },
    { canonical: 'Veneto', patterns: ['veneto'] },
    { canonical: 'Bolzano', patterns: ['bolzano', 'cpa bolzano'] },
    { canonical: 'Trento', patterns: ['trento', 'cpa trento'] }
];

function setOcrStatus(message, type = '') {
    const el = document.getElementById('paymentsOcrStatus');
    if (!el) {
        return;
    }
    el.textContent = message;
    el.className = `status ${type}`.trim();
}

function buildNewsSummaryForRegionRow(regionLabel, row, cols) {
    const colInPag = String(cols?.inPagamento || 'Pacchi in pagamento').trim();
    const colMid = String(cols?.fineFebbraio || 'Metà mese').trim();
    const colEnd = String(cols?.chat || 'Fine mese').trim();
    const valInPag = String(row?.inPagamento || '').trim();
    const valMid = String(row?.fineFebbraio || '').trim();
    const valEnd = String(row?.chat || '').trim();
    const stato = String(row?.stato || 'Previsto da tabella').trim();

    const parts = [];
    const titleBadges = [];
    if (valInPag) {
        parts.push(`${colInPag}: pacco/i ${valInPag}`);
        titleBadges.push(valInPag);
    }
    if (valMid) {
        parts.push(`${colMid}: pacco/i ${valMid}`);
        titleBadges.push(valMid);
    }
    if (valEnd) {
        parts.push(`${colEnd}: pacco/i ${valEnd}`);
        titleBadges.push(valEnd);
    }

    const badgeSummary = titleBadges.length ? `pacchi ${titleBadges.join(' / ')}` : 'situazione aggiornata';
    const titolo = `${regionLabel}: quadro ${badgeSummary}`;
    const testo = parts.length
        ? `Tabella aggiornata — ${parts.join('; ')}. Stato: ${stato}.`
        : `Tabella: nessun nuovo pacco indicato al momento per ${regionLabel}. Stato: ${stato}.`;

    return normalizeNews({ regione: regionLabel, titolo, testo });
}

async function syncRegionalNewsFromPaymentsTable(autoPublish = false) {
    if (!requirePublisherAdmin()) {
        return false;
    }
    if (!paymentsItems.length) {
        setOcrStatus('La tabella pagamenti e vuota: importa o compila prima i dati.', 'err');
        return false;
    }

    const cols = normalizePaymentColumns(paymentsColumns);
    const generatedByRegion = new Map();

    let bolzanoRow = null;
    let trentoRow = null;

    paymentsItems.forEach(rawRow => {
        const row = normalizePayment(rawRow);
        const regNorm = normalizeText(row.regione);
        if (!regNorm) {
            return;
        }
        if (regNorm.includes('piemonte') || regNorm.includes('valle d aosta')) {
            generatedByRegion.set('piemonte', buildNewsSummaryForRegionRow('Piemonte', row, cols));
            generatedByRegion.set('valle d aosta', buildNewsSummaryForRegionRow("Valle d'Aosta", row, cols));
            return;
        }
        if (regNorm.includes('bolzano')) {
            bolzanoRow = row;
            return;
        }
        if (regNorm.includes('trento')) {
            trentoRow = row;
            return;
        }
        generatedByRegion.set(regNorm, buildNewsSummaryForRegionRow(row.regione, row, cols));
    });

    if (bolzanoRow || trentoRow) {
        const bzText = bolzanoRow
            ? [
                bolzanoRow.inPagamento ? `in pagamento ${bolzanoRow.inPagamento}` : '',
                bolzanoRow.fineFebbraio ? `${cols.fineFebbraio}: ${bolzanoRow.fineFebbraio}` : '',
                bolzanoRow.chat ? `${cols.chat}: ${bolzanoRow.chat}` : ''
            ].filter(Boolean).join(', ')
            : '';
        const tnText = trentoRow
            ? [
                trentoRow.inPagamento ? `in pagamento ${trentoRow.inPagamento}` : '',
                trentoRow.fineFebbraio ? `${cols.fineFebbraio}: ${trentoRow.fineFebbraio}` : '',
                trentoRow.chat ? `${cols.chat}: ${trentoRow.chat}` : ''
            ].filter(Boolean).join(', ')
            : '';
        const combinedText = `Tabella: Bolzano (${bzText || 'n.d.'}); Trento (${tnText || 'n.d.'}).`;
        generatedByRegion.set('trentino alto adige', normalizeNews({
            regione: 'Trentino-Alto Adige',
            titolo: 'Trentino-Alto Adige: quadro Bolzano/Trento',
            testo: combinedText
        }));
    }

    const updatedNews = [];
    const handledKeys = new Set();

    newsItems.forEach(item => {
        const key = normalizeText(item.regione);
        if (key && key !== 'tutti' && generatedByRegion.has(key)) {
            if (!handledKeys.has(key)) {
                updatedNews.push(generatedByRegion.get(key));
                handledKeys.add(key);
            }
        } else {
            updatedNews.push(normalizeNews(item));
        }
    });

    generatedByRegion.forEach((newsObj, key) => {
        if (!handledKeys.has(key)) {
            updatedNews.unshift(newsObj);
            handledKeys.add(key);
        }
    });

    newsItems = updatedNews;
    saveNewsDraft();
    populateRegionSelect();
    newsItems.forEach(item => ensureRegionOption(item.regione));
    renderAll();

    if (autoPublish) {
        await publishNewsFirebase();
    }
    setOcrStatus(`News regionali sincronizzate (${generatedByRegion.size} regioni aggiornate dalla tabella)!`, 'ok');
    return true;
}

function parseTelegramPacchiTableText(rawText) {
    const text = String(rawText || '').trim();
    if (!text) {
        return { updatedCount: 0, columnsUpdated: false };
    }

    const lines = text
        .split(/\r?\n/)
        .map(l => l.replace(/[|¦]/g, '  ').trim())
        .filter(Boolean);

    let columnsUpdated = false;
    const monthsRegex = /(?:meta|metà|fine|inizio)\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)/gi;
    const detectedHeaders = [];
    lines.slice(0, 6).forEach(line => {
        const matches = line.match(monthsRegex);
        if (matches) {
            matches.forEach(m => {
                const clean = m.trim().replace(/^meta\b/i, 'Metà').replace(/^fine\b/i, 'Fine');
                if (!detectedHeaders.some(h => normalizeText(h) === normalizeText(clean))) {
                    detectedHeaders.push(clean);
                }
            });
        }
    });

    if (detectedHeaders.length >= 2) {
        paymentsColumns.fineFebbraio = detectedHeaders[0];
        paymentsColumns.chat = detectedHeaders[1];
        columnsUpdated = true;
    } else if (detectedHeaders.length === 1) {
        paymentsColumns.fineFebbraio = detectedHeaders[0];
        columnsUpdated = true;
    }

    const existingByRegion = new Map();
    paymentsItems.forEach(item => {
        const key = normalizeText(item.regione);
        if (key) {
            existingByRegion.set(key, normalizePayment(item));
        }
    });

    let updatedCount = 0;
    const parsedMap = new Map();

    for (const line of lines) {
        const lineNorm = normalizeText(line);
        if (!lineNorm) {
            continue;
        }
        let matchedRegion = null;
        let matchedPattern = '';
        for (const reg of STANDARD_AIA_PAYMENT_REGIONS) {
            for (const pat of reg.patterns) {
                if (lineNorm.startsWith(pat + ' ') || lineNorm === pat || lineNorm.includes(pat)) {
                    if (pat.length > matchedPattern.length) {
                        matchedRegion = reg;
                        matchedPattern = pat;
                    }
                }
            }
        }
        if (!matchedRegion) {
            continue;
        }

        // Remove region name from the line to parse the pacchi columns
        const regRegex = new RegExp(matchedPattern.split(' ').join('[\\s\\-/\\\']*'), 'i');
        let remainder = line.replace(regRegex, '').trim();
        remainder = remainder
            .replace(/previsto da tabella|pagamento confermato|da monitorare/gi, '')
            .trim();

        // Extract pacchi groups (e.g. "13 e 14", "14-15", "15")
        const pacchiGroups = [];
        const groupRegex = /\b\d{1,2}(?:\s*(?:e|,|-|\/|ed)\s*\d{1,2})*\b/gi;
        const rawMatches = [];
        let m;
        while ((m = groupRegex.exec(remainder)) !== null) {
            const val = m[0].replace(/\s+/g, ' ').trim();
            const nums = val.match(/\d+/g)?.map(Number) || [];
            if (nums.every(n => n >= 1 && n <= 30)) {
                rawMatches.push({
                    text: val,
                    index: m.index
                });
            }
        }

        let inPagamento = '';
        let fineFebbraio = '';
        let chat = '';

        if (rawMatches.length >= 3) {
            inPagamento = rawMatches[0].text;
            fineFebbraio = rawMatches[1].text;
            chat = rawMatches[2].text;
        } else if (rawMatches.length === 2) {
            // In typical AIA tables with 2 active columns (e.g. Metà mese & Fine mese)
            fineFebbraio = rawMatches[0].text;
            chat = rawMatches[1].text;
        } else if (rawMatches.length === 1) {
            const matchPos = rawMatches[0].index;
            if (matchPos > remainder.length * 0.55 && remainder.length > 6) {
                chat = rawMatches[0].text;
            } else {
                fineFebbraio = rawMatches[0].text;
            }
        }

        let stato = 'Previsto da tabella';
        if (/confermat|pagat|accredit/i.test(line)) {
            stato = 'Pagamento confermato';
        } else if (/monitor/i.test(line)) {
            stato = 'Da monitorare';
        }

        parsedMap.set(matchedRegion.canonical, normalizePayment({
            regione: matchedRegion.canonical,
            inPagamento,
            fineFebbraio,
            chat,
            stato
        }));
        updatedCount += 1;
    }

    if (updatedCount > 0) {
        paymentsItems = STANDARD_AIA_PAYMENT_REGIONS.map(reg => {
            if (parsedMap.has(reg.canonical)) {
                return parsedMap.get(reg.canonical);
            }
            const existing = existingByRegion.get(normalizeText(reg.canonical));
            return existing || normalizePayment({
                regione: reg.canonical,
                inPagamento: '',
                fineFebbraio: '',
                chat: '',
                stato: 'Previsto da tabella'
            });
        });
    }

    return { updatedCount, columnsUpdated };
}

async function analyzeTelegramImageWithGemini(fileOrBlob, apiKey) {
    const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const res = String(reader.result || '');
            const commaIdx = res.indexOf(',');
            resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
        };
        reader.onerror = () => reject(new Error('Impossibile leggere il file immagine.'));
        reader.readAsDataURL(fileOrBlob);
    });

    const mimeType = fileOrBlob.type || 'image/jpeg';
    const prompt = `Analizza questa immagine inviata su un gruppo Telegram arbitrale riguardante la tabella pagamento pacchi (rimborsi AIA) per le 20 regioni/CRA italiani.
Estrai con precisione assoluta:
1. I titoli delle colonne in "columns":
   - "regione": "Regione"
   - "inPagamento": titolo prima colonna pacchi (es. "Pacchi in pagamento")
   - "fineFebbraio": titolo seconda colonna temporale visibile nell'immagine (es. "Metà aprile", "Metà maggio", "Fine febbraio", ecc.)
   - "chat": titolo terza colonna temporale o riscontro (es. "Fine aprile", "Fine maggio", "Riscontro chat", ecc.)
   - "stato": "Stato"
2. L'array "items" con tutte le 20 regioni nell'ordine esatto:
   Abruzzo, Basilicata, Calabria, Campania, Emilia-Romagna, Friuli-Venezia Giulia, Lazio, Liguria, Lombardia, Marche, Molise, Piemonte/Valle D'Aosta, Puglia, Sardegna, Sicilia, Toscana, Umbria, Veneto, Bolzano, Trento.
   Per ogni regione inserisci le stringhe esatte dei pacchi nelle rispettive colonne ("inPagamento", "fineFebbraio", "chat") lasciando "" se la cella e vuota, e imposta "stato" a "Previsto da tabella" (o "Pagamento confermato" se evidenziato in verde/pagato).
Restituisci ESCLUSIVAMENTE un oggetto JSON valido con chiavi "columns" e "items".`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: prompt },
                    { inlineData: { mimeType, data: base64Data } }
                ]
            }],
            generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json'
            }
        })
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Gemini API HTTP ${response.status}: ${errText.slice(0, 140)}`);
    }

    const result = await response.json();
    const rawJsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(rawJsonText);
    if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) {
        throw new Error('Risposta Gemini non contiene righe valide.');
    }
    return parsed;
}

let tesseractScriptPromise = null;
function ensureTesseractLoaded() {
    if (window.Tesseract) {
        return Promise.resolve(window.Tesseract);
    }
    if (tesseractScriptPromise) {
        return tesseractScriptPromise;
    }
    tesseractScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        script.onload = () => resolve(window.Tesseract);
        script.onerror = () => {
            tesseractScriptPromise = null;
            reject(new Error('Impossibile caricare il motore OCR Tesseract.js.'));
        };
        document.head.appendChild(script);
    });
    return tesseractScriptPromise;
}

async function preprocessImageForOcr(fileOrBlob) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(fileOrBlob);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const scale = img.width < 1100 ? 2 : 1;
            const canvas = document.createElement('canvas');
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imgData.data;
            for (let i = 0; i < data.length; i += 4) {
                const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                const contrasted = gray > 165 ? 255 : gray < 90 ? 0 : gray;
                data[i] = contrasted;
                data[i + 1] = contrasted;
                data[i + 2] = contrasted;
            }
            ctx.putImageData(imgData, 0, 0);
            canvas.toBlob(blob => resolve(blob || fileOrBlob), 'image/png');
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(fileOrBlob);
        };
        img.src = url;
    });
}

async function processTelegramPaymentImage(fileOrBlob) {
    if (!requirePublisherAdmin()) {
        return;
    }
    if (!fileOrBlob) {
        return;
    }

    const previewWrap = document.getElementById('paymentsOcrPreviewWrap');
    const previewImg = document.getElementById('paymentsOcrPreviewImg');
    if (previewWrap && previewImg) {
        previewImg.src = URL.createObjectURL(fileOrBlob);
        previewWrap.hidden = false;
    }

    const apiKeyInput = document.getElementById('paymentsGeminiApiKey');
    const apiKey = String(apiKeyInput?.value || localStorage.getItem(GEMINI_VISION_API_KEY_STORAGE) || '').trim();
    if (apiKey) {
        localStorage.setItem(GEMINI_VISION_API_KEY_STORAGE, apiKey);
    }

    const autoNews = Boolean(document.getElementById('paymentsAutoNewsChk')?.checked);
    const autoPublish = Boolean(document.getElementById('paymentsAutoPublishChk')?.checked);

    try {
        if (apiKey) {
            setOcrStatus('🤖 Analisi immagine Telegram in corso con Gemini AI Vision...', '');
            const geminiData = await analyzeTelegramImageWithGemini(fileOrBlob, apiKey);
            if (geminiData.columns) {
                paymentsColumns = normalizePaymentColumns({
                    ...paymentsColumns,
                    ...geminiData.columns
                });
            }
            paymentsItems = geminiData.items.map(normalizePayment);
            savePaymentsDraft();
            renderPaymentsSheet();

            if (autoNews) {
                await syncRegionalNewsFromPaymentsTable(false);
            }
            if (autoPublish) {
                await publishPaymentsFirebase();
                if (autoNews) {
                    await publishNewsFirebase();
                }
            }
            setOcrStatus(`✅ Tabella letta con precisione AI Vision (${paymentsItems.length} regioni)${autoPublish ? ' e pubblicata live su Firebase!' : '!'}`, 'ok');
            return;
        }

        setOcrStatus('🔍 Lettura OCR dell\'immagine Telegram in corso (attendere 3-5 secondi)...', '');
        const TesseractLib = await ensureTesseractLoaded();
        const processedBlob = await preprocessImageForOcr(fileOrBlob);
        const { data } = await TesseractLib.recognize(processedBlob, 'ita', {});
        const extractedText = String(data?.text || '').trim();
        const rawTextInput = document.getElementById('paymentsRawTextPaste');
        if (rawTextInput && extractedText) {
            rawTextInput.value = extractedText;
        }

        const { updatedCount } = parseTelegramPacchiTableText(extractedText);
        if (!updatedCount) {
            setOcrStatus('Nessuna riga regione riconosciuta nitidamente via OCR base. Inserisci una chiave Gemini API gratuita nelle impostazioni qui sopra per la lettura AI Vision al 100%, oppure verifica il testo estratto.', 'err');
            return;
        }

        savePaymentsDraft();
        renderPaymentsSheet();

        if (autoNews) {
            await syncRegionalNewsFromPaymentsTable(false);
        }
        if (autoPublish) {
            await publishPaymentsFirebase();
            if (autoNews) {
                await publishNewsFirebase();
            }
        }
        setOcrStatus(`✅ Estratte e aggiornate ${updatedCount} regioni dallo screenshot Telegram${autoPublish ? ' e pubblicate live su Firebase!' : '!'}`, 'ok');
    } catch (error) {
        setOcrStatus(`Errore analisi immagine: ${error.message}`, 'err');
    }
}

function setupTelegramOcrAutomation() {
    const uploadBtn = document.getElementById('paymentsUploadImageBtn');
    const fileInput = document.getElementById('paymentsImageFileInput');
    const pasteBtn = document.getElementById('paymentsPasteClipboardBtn');
    const generateNewsBtn = document.getElementById('paymentsGenerateNewsBtn');
    const parseTextBtn = document.getElementById('paymentsParseTextBtn');
    const rawTextInput = document.getElementById('paymentsRawTextPaste');
    const geminiKeyInput = document.getElementById('paymentsGeminiApiKey');
    const dropZone = document.getElementById('telegramOcrDropZone');

    if (geminiKeyInput) {
        const savedKey = localStorage.getItem(GEMINI_VISION_API_KEY_STORAGE) || '';
        if (savedKey) {
            geminiKeyInput.value = savedKey;
        }
        geminiKeyInput.addEventListener('change', () => {
            const val = geminiKeyInput.value.trim();
            if (val) {
                localStorage.setItem(GEMINI_VISION_API_KEY_STORAGE, val);
            } else {
                localStorage.removeItem(GEMINI_VISION_API_KEY_STORAGE);
            }
        });
    }

    if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', event => {
            const file = event.target?.files?.[0];
            if (file) {
                processTelegramPaymentImage(file);
                fileInput.value = '';
            }
        });
    }

    if (generateNewsBtn) {
        generateNewsBtn.addEventListener('click', async () => {
            const autoPublish = Boolean(document.getElementById('paymentsAutoPublishChk')?.checked);
            await syncRegionalNewsFromPaymentsTable(autoPublish);
        });
    }

    if (parseTextBtn && rawTextInput) {
        parseTextBtn.addEventListener('click', async () => {
            if (!requirePublisherAdmin()) {
                return;
            }
            const raw = rawTextInput.value.trim();
            if (!raw) {
                setOcrStatus('Incolla prima il testo da analizzare.', 'err');
                return;
            }
            const { updatedCount } = parseTelegramPacchiTableText(raw);
            if (!updatedCount) {
                setOcrStatus('Nessuna regione riconosciuta nel testo incollato.', 'err');
                return;
            }
            savePaymentsDraft();
            renderPaymentsSheet();
            const autoNews = Boolean(document.getElementById('paymentsAutoNewsChk')?.checked);
            const autoPublish = Boolean(document.getElementById('paymentsAutoPublishChk')?.checked);
            if (autoNews) {
                await syncRegionalNewsFromPaymentsTable(false);
            }
            if (autoPublish) {
                await publishPaymentsFirebase();
                if (autoNews) {
                    await publishNewsFirebase();
                }
            }
            setOcrStatus(`✅ Aggiornate ${updatedCount} regioni dal testo incollato!`, 'ok');
        });
    }

    if (pasteBtn) {
        pasteBtn.addEventListener('click', async () => {
            if (!requirePublisherAdmin()) {
                return;
            }
            try {
                if (navigator.clipboard?.read) {
                    const items = await navigator.clipboard.read();
                    for (const item of items) {
                        const imgType = item.types.find(t => t.startsWith('image/'));
                        if (imgType) {
                            const blob = await item.getType(imgType);
                            await processTelegramPaymentImage(blob);
                            return;
                        }
                    }
                }
                if (navigator.clipboard?.readText) {
                    const text = await navigator.clipboard.readText();
                    if (text && text.trim()) {
                        if (rawTextInput) {
                            rawTextInput.value = text.trim();
                        }
                        const { updatedCount } = parseTelegramPacchiTableText(text);
                        if (updatedCount > 0) {
                            savePaymentsDraft();
                            renderPaymentsSheet();
                            const autoNews = Boolean(document.getElementById('paymentsAutoNewsChk')?.checked);
                            const autoPublish = Boolean(document.getElementById('paymentsAutoPublishChk')?.checked);
                            if (autoNews) {
                                await syncRegionalNewsFromPaymentsTable(false);
                            }
                            if (autoPublish) {
                                await publishPaymentsFirebase();
                                if (autoNews) {
                                    await publishNewsFirebase();
                                }
                            }
                            setOcrStatus(`✅ Aggiornate ${updatedCount} regioni dagli appunti!`, 'ok');
                            return;
                        }
                    }
                }
                setOcrStatus('Nessuno screenshot o tabella valida trovata negli appunti. Premi Ctrl+V dopo aver copiato l\'immagine da Telegram.', 'err');
            } catch {
                setOcrStatus('Premi direttamente Ctrl+V sulla pagina per incollare l\'immagine copiata da Telegram.', 'err');
            }
        });
    }

    if (dropZone) {
        dropZone.addEventListener('dragover', event => {
            event.preventDefault();
            dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });
        dropZone.addEventListener('drop', event => {
            event.preventDefault();
            dropZone.classList.remove('drag-over');
            const file = Array.from(event.dataTransfer?.files || []).find(f => f.type.startsWith('image/'));
            if (file) {
                processTelegramPaymentImage(file);
            }
        });
    }

    document.addEventListener('paste', event => {
        const paymentsPage = document.getElementById('paymentsPage');
        if (!paymentsPage || !paymentsPage.classList.contains('active')) {
            return;
        }
        const items = Array.from(event.clipboardData?.items || []);
        const imgItem = items.find(item => item.type.startsWith('image/'));
        if (imgItem) {
            event.preventDefault();
            const blob = imgItem.getAsFile();
            if (blob) {
                processTelegramPaymentImage(blob);
            }
        }
    });
}

async function initPublisher() {
    setPublisherAccess(false);
    restoreDrafts();
    populateRegionSelect();
    newsItems.forEach(item => ensureRegionOption(item.regione));
    renderAll();
    bindAuthState();
    setupPublisherAuthPopover();
    setupPageTabs();
    setupTelegramOcrAutomation();

    await Promise.all([
        loadNewsFromFirebase(true),
        loadPaymentsFromFirebase(true),
        loadLuoghiFromFirebase(true),
        loadSuggestionsFromFirebase(true)
    ]);

    setStatus('Pronto. Pagina News collegata a /news.', 'ok');
    setPaymentsStatus('Pronto. Pagina Pagamenti collegata a /pagamenti.', 'ok');
    setLuoghiStatus('Pronto. Pagina Luoghi collegata a /luoghi.', 'ok');
    setSuggestionsStatus('Pronto. Coda segnalazioni collegata a /suggestions.', 'ok');
}

initPublisher();

if (publisherAuthAvatarImg) {
    publisherAuthAvatarImg.addEventListener('error', () => setPublisherAuthAvatar(''));
}
if (publisherAuthProfileSummaryImg) {
    publisherAuthProfileSummaryImg.addEventListener('error', () => {
        publisherAuthProfileSummaryImg.hidden = true;
        publisherAuthProfileSummaryImg.removeAttribute('src');
    });
}


