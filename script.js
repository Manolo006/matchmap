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
const DASHBOARD_ADMIN_EMAILS = new Set(['manuelcarpita@gmail.com']);

async function loadLuoghiDb() {
    try {
        const fb = window.matchMapFirebase;
        if (fb?.ready && fb.db) {
            const snap = await fb.db.ref('luoghi').once('value');
            if (snap.exists()) {
                const raw = snap.val();
                luoghiDb = Array.isArray(raw) ? raw : Object.values(raw || {});
                renderLuoghiMap();
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

function renderLuoghiMap() {
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

    const markerIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    const bounds = [];
    completed.forEach(item => {
        const lat = getNumericCoord(item.lat);
        const lng = getNumericCoord(item.lng);
        const marker = L.marker([lat, lng], { icon: markerIcon });
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

function renderDashboardEvents() {
    const tbody = document.querySelector('#eventTable tbody');
    if (!tbody) {
        return;
    }
    tbody.innerHTML = '';

    dashboardEvents.forEach((evento, index) => {
        const mapsUrl = getMapsUrl(evento);
        const calendarText = `${evento.categoria}: ${evento.squadre}`;
        const calendarDetails = buildCalendarDescription(evento);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${evento.data}</td>
            <td>${evento.ora}</td>
            <td>${evento.squadre}</td>
            <td>${evento.categoria}</td>
            <td>${evento.rimborso} €</td>
            <td>
                <a class="icon-link maps-link" target="_blank" rel="noopener noreferrer" href="${mapsUrl}" title="Apri su Google Maps" aria-label="Apri su Google Maps">
                    <img src="maps.png" alt="Google Maps">
                </a>
            </td>
            <td>
                <a class="icon-link calendar-link" target="_blank" rel="noopener noreferrer" href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(calendarText)}&dates=${formatDataGoogle(evento.data, evento.ora)}&details=${encodeURIComponent(calendarDetails)}&location=${encodeURIComponent(evento.locationText)}" title="Aggiungi a Google Calendar" aria-label="Aggiungi a Google Calendar">
                    <img src="calendar.svg" alt="Google Calendar">
                </a>
            </td>
            <td>
                <button type="button" class="event-remove-btn" onclick="removeDashboardEvent(${index})" aria-label="Elimina evento" title="Elimina evento">
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 1 0 5.7 7.12L10.59 12l-4.9 4.89a1 1 0 0 0 1.42 1.41L12 13.41l4.89 4.9a1 1 0 0 0 1.41-1.42L13.41 12l4.9-4.89a1 1 0 0 0-.01-1.4z"></path>
                    </svg>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    const total = computeTotalRimborso();
    const totalEl = document.getElementById('rimborsoTotale');
    if (totalEl) {
        totalEl.textContent = `Rimborso totale: ${total} €`;
    }
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
    const filtered = normalizedSelected === 'all'
        ? newsDb
        : newsDb.filter(item => {
            const normalizedRegion = normalizeText(item.regione);
            return normalizedRegion === normalizedSelected || normalizedRegion === 'tutti';
        });

    container.innerHTML = '';

    if (!filtered.length) {
        container.innerHTML = '<article class="news-item"><h4>Nessuna notizia disponibile</h4><p>Non ci sono aggiornamenti per la regione selezionata.</p></article>';
        return;
    }

    filtered.forEach(item => {
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
        card.innerHTML = `
            <h4>${item.titolo}</h4>
            <p><strong>${item.regione}:</strong> ${item.testo}</p>
        `;
        container.appendChild(card);
    });
}

function setupNewsRegionFilter() {
    const select = document.getElementById('regionFilter');
    if (!select) {
        return;
    }

    const uniqueRegions = [...new Set(newsDb.map(item => item.regione).filter(Boolean))]
        .filter(region => normalizeText(region) !== 'tutti')
        .sort((a, b) => a.localeCompare(b, 'it'));

    select.innerHTML = '<option value="all">Tutte le regioni</option>';

    uniqueRegions.forEach(region => {
        const option = document.createElement('option');
        option.value = region;
        option.textContent = region;
        select.appendChild(option);
    });

    select.addEventListener('change', event => {
        renderNews(event.target.value);
    });
}

/* TABELLA PAGAMENTI */
let paymentsDb = [];

function normalizePaymentsPayload(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (Array.isArray(payload?.pagamenti)) {
        return payload.pagamenti;
    }
    return [];
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
    const raw = snap.val();
    return Array.isArray(raw) ? raw : Object.values(raw || {});
}

async function loadPaymentsDb() {
    try {
        const firebasePayments = await loadPaymentsFromFirebase();
        if (firebasePayments) {
            paymentsDb = normalizePaymentsPayload(firebasePayments);
            return;
        }
    } catch (error) {
        paymentsDb = [];
    }
}

function renderPaymentsTable() {
    const tbody = document.querySelector('#paymentsTable tbody');
    if (!tbody) {
        return;
    }

    tbody.innerHTML = '';

    const statusClassMap = {
        confermato: 'pay-confirmed',
        monitoraggio: 'pay-monitoring',
        previsto: 'pay-planned'
    };

    paymentsDb.forEach(item => {
        const statusKey = normalizeText(item.stato);
        const row = document.createElement('tr');
        row.className = statusClassMap[statusKey] || '';
        row.innerHTML = `
            <td>${item.regione || '-'}</td>
            <td>${item.inPagamento || '-'}</td>
            <td>${item.fineFebbraio || '-'}</td>
            <td>${item.chat || '-'}</td>
            <td>${item.stato || 'aggiornamento'}</td>
        `;
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

window.registerDashboardUser = registerDashboardUser;
window.loginDashboardUser = loginDashboardUser;
window.logoutDashboardUser = logoutDashboardUser;
window.removeDashboardEvent = removeDashboardEvent;

loadLuoghiDb();
Promise.all([loadNewsDb(), loadPaymentsDb()]).then(() => {
    setupNewsRegionFilter();
    renderNews('all');
    renderPaymentsTable();
});
initDashboardAuth();
setupAuthPopover();
