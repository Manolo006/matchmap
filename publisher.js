const NEWS_DRAFT_KEY = 'matchmap_publisher_news_draft_v2';
const LUOGHI_DRAFT_KEY = 'matchmap_publisher_luoghi_draft_v1';

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
let editNewsIndex = -1;
let editLuogoIndex = -1;
let geoResolveTimer = null;
let lastGeoResolveKey = '';

const regionInput = document.getElementById('regionInput');
const titleInput = document.getElementById('titleInput');
const textInput = document.getElementById('textInput');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const newsList = document.getElementById('newsList');
const emptyState = document.getElementById('emptyState');
const publishBtn = document.getElementById('publishBtn');
const loadRemoteBtn = document.getElementById('loadRemoteBtn');
const preview = document.getElementById('preview');
const statusEl = document.getElementById('status');

const luogoNomeInput = document.getElementById('luogoNomeInput');
const luogoIndirizzoInput = document.getElementById('luogoIndirizzoInput');
const luogoMapsInput = document.getElementById('luogoMapsInput');
const luogoCoordsInput = document.getElementById('luogoCoordsInput');
const pasteCoordsBtn = document.getElementById('pasteCoordsBtn');
const luogoSaveBtn = document.getElementById('luogoSaveBtn');
const luogoClearBtn = document.getElementById('luogoClearBtn');
const luoghiList = document.getElementById('luoghiList');
const luoghiEmptyState = document.getElementById('luoghiEmptyState');
const luoghiPublishBtn = document.getElementById('luoghiPublishBtn');
const luoghiLoadBtn = document.getElementById('luoghiLoadBtn');
const luoghiPreview = document.getElementById('luoghiPreview');
const luoghiStatusEl = document.getElementById('luoghiStatus');

const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const authStatus = document.getElementById('authStatus');

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

function normalizeLuogo(item) {
    const raw = item || {};
    const latRaw = pickFirst(raw, ['lat', 'latitude', 'Latitude']);
    const lngRaw = pickFirst(raw, ['lng', 'lon', 'longitude', 'Longitude']);
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    return {
        nome: String(pickFirst(raw, ['nome', 'Nome', 'name', 'Name'])).trim(),
        indirizzo: String(pickFirst(raw, ['indirizzo', 'Indirizzo', 'address', 'Address'])).trim(),
        mapsUrl: String(pickFirst(raw, ['mapsUrl', 'MapsUrl', 'mapsURL', 'maps', 'map', 'url', 'Url'])).trim(),
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        fatto: true
    };
}

function saveNewsDraft() {
    localStorage.setItem(NEWS_DRAFT_KEY, JSON.stringify(newsItems));
}

function saveLuoghiDraft() {
    localStorage.setItem(LUOGHI_DRAFT_KEY, JSON.stringify(luoghiItems));
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
        luoghiItems = Array.isArray(rawLuoghi) ? rawLuoghi.map(normalizeLuogo) : [];
    } catch {
        luoghiItems = [];
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
    luogoCoordsInput.value = '';
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
            <h3>${item.titolo}</h3>
            <div class="meta">Regione: ${item.regione}</div>
            <p>${item.testo}</p>
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
        return;
    }

    luoghiEmptyState.style.display = 'none';

    luoghiItems.forEach((item, index) => {
        const latNum = Number(item.lat);
        const lngNum = Number(item.lng);
        const hasCoords = Number.isFinite(latNum)
            && Number.isFinite(lngNum)
            && !(Math.abs(latNum) < 0.000001 && Math.abs(lngNum) < 0.000001);
        const mapsBtn = (!hasCoords && item.mapsUrl)
            ? `<div class="item-actions item-actions-right"><a class="item-action-link" href="${item.mapsUrl}" target="_blank" rel="noopener noreferrer">Google Maps</a></div>`
            : '';
        const card = document.createElement('article');
        card.className = 'item';
        card.innerHTML = `
            <h3>${item.nome}</h3>
            <div class="meta">${item.indirizzo || '-'}</div>
            <p class="item-pre"><strong>Maps:</strong> ${item.mapsUrl || '-'}</p>
            <p class="item-pre"><strong>Coordinate:</strong> ${item.lat ?? '-'}, ${item.lng ?? '-'}</p>
            <div class="item-actions">
                <button type="button" data-action="edit-luogo" data-index="${index}">Modifica</button>
                <button type="button" data-action="delete-luogo" data-index="${index}">Elimina</button>
            </div>
            ${mapsBtn}
        `;
        luoghiList.appendChild(card);
    });
}

function renderAll() {
    renderNewsList();
    renderNewsPreview();
    renderLuoghiList();
    renderLuoghiPreview();
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

    return { nome, indirizzo, mapsUrl, lat, lng };
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
}

function handleSaveLuogo() {
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
}

async function publishNewsFirebase() {
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
        luoghiItems = fromDb.map(normalizeLuogo);
        saveLuoghiDraft();
        renderAll();
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
        loginPassword.value = '';
    } catch (error) {
        setStatus(`Login fallito: ${error.message}`, 'err');
        setLuoghiStatus(`Login fallito: ${error.message}`, 'err');
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
    } catch (error) {
        setStatus(`Logout fallito: ${error.message}`, 'err');
        setLuoghiStatus(`Logout fallito: ${error.message}`, 'err');
    }
}

function bindAuthState() {
    const fb = getFirebaseState();
    if (!fb.ready || !fb.auth) {
        setAuthStatus('Firebase non disponibile', false);
        return;
    }

    fb.auth.onAuthStateChanged(user => {
        if (user) {
            setAuthStatus(`Autenticato: ${user.email}`, true);
        } else {
            setAuthStatus('Non autenticato', false);
        }
    });
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
    }

    if (target.dataset.action === 'delete-news') {
        newsItems.splice(index, 1);
        saveNewsDraft();
        renderAll();
        setStatus('News eliminata.', 'ok');
    }
});

luoghiList.addEventListener('click', event => {
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
    }

    if (target.dataset.action === 'delete-luogo') {
        luoghiItems.splice(index, 1);
        saveLuoghiDraft();
        renderAll();
        setLuoghiStatus('Luogo eliminato.', 'ok');
    }
});

saveBtn.addEventListener('click', handleSaveNews);
clearBtn.addEventListener('click', resetNewsForm);
publishBtn.addEventListener('click', publishNewsFirebase);
loadRemoteBtn.addEventListener('click', () => loadNewsFromFirebase(false));

luogoSaveBtn.addEventListener('click', handleSaveLuogo);
luogoClearBtn.addEventListener('click', resetLuogoForm);
luoghiPublishBtn.addEventListener('click', publishLuoghiFirebase);
luoghiLoadBtn.addEventListener('click', () => loadLuoghiFromFirebase(false));
luogoMapsInput.addEventListener('input', scheduleAutoCoordinateResolve);
luogoNomeInput.addEventListener('input', scheduleAutoResolveIfLinkPresent);
luogoIndirizzoInput.addEventListener('input', scheduleAutoResolveIfLinkPresent);
pasteCoordsBtn.addEventListener('click', pasteCoordinatesFromClipboard);

loginBtn.addEventListener('click', firebaseLogin);
logoutBtn.addEventListener('click', firebaseLogout);

async function initPublisher() {
    restoreDrafts();
    populateRegionSelect();
    newsItems.forEach(item => ensureRegionOption(item.regione));
    renderAll();
    bindAuthState();
    setupPublisherAuthPopover();
    setupPageTabs();

    await Promise.all([
        loadNewsFromFirebase(true),
        loadLuoghiFromFirebase(true)
    ]);

    setStatus('Pronto. Pagina News collegata a /news.', 'ok');
    setLuoghiStatus('Pronto. Pagina Luoghi collegata a /luoghi.', 'ok');
}

initPublisher();
