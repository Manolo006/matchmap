/* ============================================================================
 * MatchMap - Core Dashboard, News, Payments, Auth & Init (script.js)
 * ============================================================================ */

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
    const item = sanitizeEventoLocation(raw || {});
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
    const calendarText = `${evento.categoria || 'Gara'}: ${evento.squadre || 'Partita'}`;
    const calendarDetails = buildCalendarDescription(evento);
    const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(calendarText)}&dates=${formatDataGoogle(evento.data, evento.ora)}&details=${encodeURIComponent(calendarDetails)}&location=${encodeURIComponent(evento.locationText || '')}`;
    const [teamA, teamB] = splitMatchTeams(evento.squadre || '');
    const logoA = getTeamLogoForPreview(teamA);
    const logoB = getTeamLogoForPreview(teamB);
    const kmText = Number(evento.km || 0) > 0 ? `${Number(evento.km || 0)} km` : '';
    const rimborsoText = `${Number(evento.rimborso || 0)} €`;
    const dateTime = [evento.data, evento.ora].filter(Boolean).join(' · ');
    const venueText = evento.locationText || evento.luogo || evento.impianto || '';

    const row = document.createElement('tr');
    row.classList.add(evento.pagata ? 'event-paid-row' : 'event-unpaid-row');
    row.innerHTML = `
        <td colspan="8" class="event-card-cell">
            <article class="match-card ${evento.pagata ? 'is-paid' : 'is-unpaid'}">
                <header class="match-card-header">
                    <div class="match-time-pill" title="Data e ora gara">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <span>${escapeHtml(dateTime || 'Data da definire')}</span>
                    </div>
                    <div class="match-header-badges">
                        ${evento.categoria ? `<span class="match-badge match-category-badge">${escapeHtml(evento.categoria)}</span>` : ''}
                        ${evento.pagata ? `
                            <span class="match-badge match-status-paid" title="Compenso saldato">
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                                <span>Pagata</span>
                            </span>
                        ` : `
                            <span class="match-badge match-status-unpaid" title="In attesa di liquidazione">
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>
                                <span>Da pagare</span>
                            </span>
                        `}
                    </div>
                </header>

                <div class="match-versus-area ${teamB ? '' : 'is-single-team'}">
                    <div class="match-team match-team-home">
                        ${renderTeamAvatar(teamA, logoA)}
                        <span class="match-team-name" title="${escapeHtml(teamA || 'Squadra Casa')}">${escapeHtml(teamA || 'Squadra Casa')}</span>
                    </div>

                    ${teamB ? `
                        <div class="match-vs-badge" aria-label="Versus">VS</div>
                        <div class="match-team match-team-away">
                            ${renderTeamAvatar(teamB, logoB)}
                            <span class="match-team-name" title="${escapeHtml(teamB || 'Squadra Trasferta')}">${escapeHtml(teamB || 'Squadra Trasferta')}</span>
                        </div>
                    ` : ''}
                </div>

                <div class="match-details-strip">
                    <div class="match-venue-box">
                        ${venueText ? `
                            <a class="match-venue-link" href="${mapsUrl}" target="_blank" rel="noopener noreferrer" title="Vedi impianto su mappa">
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                                <span class="match-venue-text">${escapeHtml(venueText)}</span>
                            </a>
                        ` : `
                            <span class="match-venue-muted">Impianto non specificato</span>
                        `}
                    </div>

                    <div class="match-metrics-group">
                        ${kmText ? `
                            <span class="match-meta-pill" title="Distanza stimata">
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M16.2 7.8l-2 6.3-6.4 2 2-6.3z"/></svg>
                                <span>${escapeHtml(kmText)}</span>
                            </span>
                        ` : ''}
                        <span class="match-meta-pill match-pill-money" title="Rimborso gara">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                            <span>${escapeHtml(rimborsoText)}</span>
                        </span>
                    </div>
                </div>

                <footer class="match-actions-bar">
                    <a class="match-action-btn action-link-maps" target="_blank" rel="noopener noreferrer" href="${mapsUrl}" title="Apri navigazione Google Maps" aria-label="Apri su Google Maps">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
                        <span>Mappa</span>
                    </a>
                    <a class="match-action-btn action-link-calendar" target="_blank" rel="noopener noreferrer" href="${calendarUrl}" title="Aggiungi a Google Calendar" aria-label="Aggiungi a Google Calendar">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        <span>Calendario</span>
                    </a>
                    <button type="button" class="match-action-btn action-btn-pay ${evento.pagata ? 'is-paid' : 'is-unpaid'}" onclick="toggleDashboardEventPaid(${item.index})" title="${evento.pagata ? 'Segna come non pagata' : 'Segna come pagata'}" aria-label="${evento.pagata ? 'Segna non pagata' : 'Segna pagata'}">
                        ${evento.pagata ? `
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                            <span>Pagata</span>
                        ` : `
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>
                            <span>Segna pagata</span>
                        `}
                    </button>
                    <button type="button" class="match-action-btn action-btn-delete" onclick="removeDashboardEvent(${item.index})" title="Elimina evento dal calendario" aria-label="Elimina evento">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                        <span>Elimina</span>
                    </button>
                </footer>
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

let lastDashboardExpirationSignature = '';
let dashboardEventSearchQuery = '';

function getDashboardEventStateSignature() {
    return dashboardEvents.map((evento, idx) => {
        const startTs = parseEventoDateTime(evento);
        const expired = startTs !== null && Date.now() >= (startTs + 60 * 1000);
        return `${idx}:${expired ? 1 : 0}:${evento.pagata ? 1 : 0}`;
    }).join('|');
}

function renderDashboardEvents() {
    const tbody = document.querySelector('#eventTable tbody');
    if (!tbody) {
        return;
    }
    lastDashboardExpirationSignature = getDashboardEventStateSignature();
    tbody.innerHTML = '';

    const sortedItems = getSortedDashboardEventsWithIndex();
    const searchNorm = normalizeText(dashboardEventSearchQuery);
    const filteredItems = searchNorm
        ? sortedItems.filter(({ evento }) => {
            const haystack = normalizeText([
                evento.data,
                evento.ora,
                evento.squadre,
                evento.categoria,
                evento.girone,
                evento.garaNumero,
                evento.locationText,
                evento.luogo,
                evento.impianto,
                evento.indirizzo,
                evento.pagata ? 'pagata' : 'da pagare'
            ].filter(Boolean).join(' '));
            return haystack.includes(searchNorm);
        })
        : sortedItems;

    const visibleItems = [];
    const hiddenItems = [];

    if (searchNorm) {
        filteredItems.forEach(item => visibleItems.push(item));
    } else {
        filteredItems.forEach(item => {
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
    }

    if (!visibleItems.length && searchNorm) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `<td colspan="8" class="event-card-cell"><div class="news-item">Nessuna partita trovata per "${escapeHtml(dashboardEventSearchQuery)}".</div></td>`;
        tbody.appendChild(emptyRow);
    } else {
        visibleItems.forEach(item => {
            tbody.appendChild(buildDashboardEventRow(item));
        });
    }

    if (!searchNorm && dashboardShowAllHidden) {
        hiddenItems.forEach(item => {
            const row = buildDashboardEventRow(item);
            row.classList.add('event-hidden-row');
            tbody.appendChild(row);
        });
    }

    updateDashboardShowMoreControls(searchNorm ? 0 : hiddenItems.length);

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

function isAndroidDevice() {
    const ua = navigator.userAgent || '';
    return /Android/i.test(ua);
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
    const doRegister = () => {
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
    };

    if (document.readyState === 'complete') {
        doRegister();
    } else {
        window.addEventListener('load', doRegister);
    }
}


function setupInstallApp() {
    const installBtn = document.getElementById('installAppBtn');
    const iosModal = document.getElementById('iosInstallModal');
    const closeModalBtn = document.getElementById('closeInstallModalBtn');
    if (!installBtn) {
        return;
    }

    if (window.__matchmapInstallPrompt && !deferredInstallPrompt) {
        deferredInstallPrompt = window.__matchmapInstallPrompt;
    }

    const refreshInstallButton = () => {
        if (isStandaloneMode()) {
            installBtn.hidden = true;
            return;
        }
        const activePrompt = deferredInstallPrompt || window.__matchmapInstallPrompt;
        if (activePrompt || isIosDevice() || isAndroidDevice()) {
            installBtn.hidden = false;
            return;
        }
        installBtn.hidden = true;
    };

    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferredInstallPrompt = event;
        window.__matchmapInstallPrompt = event;
        refreshInstallButton();
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        window.__matchmapInstallPrompt = null;
        installBtn.hidden = true;
        showDashboardToast('App installata con successo.', 'ok');
    });

    const openInstallModal = (mode = 'ios') => {
        if (!iosModal) {
            return;
        }
        const modalTextEl = iosModal.querySelector('p');
        if (modalTextEl) {
            if (mode === 'android') {
                modalTextEl.innerHTML = 'Su Android apri il menu <strong>⋮</strong> (tre puntini in alto a destra su Chrome) e tocca <strong>Installa app</strong> oppure <strong>Aggiungi a schermata Home</strong>.';
            } else {
                modalTextEl.textContent = 'Su iPhone/iPad apri il menu Condividi di Safari e scegli Aggiungi alla schermata Home.';
            }
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

        const activePrompt = deferredInstallPrompt || window.__matchmapInstallPrompt;
        if (activePrompt) {
            activePrompt.prompt();
            const choice = await activePrompt.userChoice.catch(() => null);
            if (choice?.outcome !== 'accepted') {
                showDashboardToast('Installazione annullata.', 'warn');
            }
            deferredInstallPrompt = null;
            window.__matchmapInstallPrompt = null;
            refreshInstallButton();
            return;
        }

        if (isAndroidDevice()) {
            openInstallModal('android');
            return;
        }

        if (isIosDevice()) {
            openInstallModal('ios');
            return;
        }

        showDashboardToast('Usa il menu del browser (⋮) -> Installa MatchMap.', 'warn');
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

function checkAndRefreshDashboardEvents() {
    const currentSig = getDashboardEventStateSignature();
    if (currentSig !== lastDashboardExpirationSignature) {
        lastDashboardExpirationSignature = currentSig;
        renderDashboardEvents();
    }
}

function ensureDashboardEventAutoRefresh() {
    if (dashboardEventAutoRefreshTimer) {
        return;
    }
    dashboardEventAutoRefreshTimer = setInterval(() => {
        checkAndRefreshDashboardEvents();
    }, 15000);
}

function exportDashboardEventsToCsv() {
    if (!dashboardEvents.length) {
        showDashboardToast('Nessuna partita presente da esportare.', 'warn');
        return;
    }

    const headers = [
        'Data',
        'Ora',
        'Squadra Casa',
        'Squadra Trasferta',
        'Squadre',
        'Categoria',
        'Km',
        'Rimborso',
        'Pagata',
        'Impianto/Indirizzo',
        'Google Maps'
    ];

    const escapeCsv = val => {
        const str = String(val ?? '').trim();
        if (/[;"\r\n]/.test(str)) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const headerLine = headers.map(escapeCsv).join(';');
    const rows = dashboardEvents.map(evento => {
        const [teamA, teamB] = splitMatchTeams(evento.squadre || '');
        const mapsUrl = evento.mapsUrl || getMapsUrl(evento) || '';
        const location = evento.locationText || evento.indirizzo || evento.campo || '';
        return [
            escapeCsv(evento.data || ''),
            escapeCsv(evento.ora || ''),
            escapeCsv(teamA || ''),
            escapeCsv(teamB || ''),
            escapeCsv(evento.squadre || ''),
            escapeCsv(evento.categoria || ''),
            escapeCsv(evento.km || '0'),
            escapeCsv(evento.rimborso || '0'),
            escapeCsv(evento.pagata ? 'Sì' : 'No'),
            escapeCsv(location),
            escapeCsv(mapsUrl)
        ].join(';');
    });

    const csvContent = '\uFEFF' + [headerLine, ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `matchmap_partite_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showDashboardToast(`Esportate ${dashboardEvents.length} partite in CSV!`, 'ok');
}

async function importDashboardEventsFromCsv(csvText) {
    const text = String(csvText || '').trim();
    if (!text) {
        showDashboardToast('File CSV vuoto.', 'err');
        return;
    }

    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 1) {
        showDashboardToast('Nessun dato trovato nel file CSV.', 'err');
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

    const firstRow = parseLine(lines[0]);
    const normFirstRow = firstRow.map(h => normalizeText(h));
    const isHeader = normFirstRow.some(h => 
        h.includes('data') || h.includes('ora') || h.includes('squadr') || h.includes('categ') || h.includes('rimbors')
    );

    const startIdx = isHeader ? 1 : 0;
    const findIdx = keywords => normFirstRow.findIndex(h => keywords.some(k => h.includes(k)));

    let dataIdx = isHeader ? findIdx(['data', 'date']) : 0;
    let oraIdx = isHeader ? findIdx(['ora', 'orario', 'time']) : 1;
    let squadreIdx = isHeader ? findIdx(['squadr', 'gara', 'partita']) : 2;
    let catIdx = isHeader ? findIdx(['categ', 'serie']) : 3;
    let kmIdx = isHeader ? findIdx(['km', 'distanz']) : 4;
    let rimborsoIdx = isHeader ? findIdx(['rimbors', 'comp']) : 5;
    let pagataIdx = isHeader ? findIdx(['pagat', 'stato']) : 6;
    let locationIdx = isHeader ? findIdx(['impiant', 'camp', 'indirizz', 'luog']) : 7;
    let mapsIdx = isHeader ? findIdx(['maps', 'link']) : 8;

    let addedCount = 0;
    let duplicateCount = 0;

    for (let i = startIdx; i < lines.length; i++) {
        const cells = parseLine(lines[i]);
        if (!cells || cells.length < 2 || cells.every(c => !c)) continue;

        let data = (dataIdx >= 0 && cells[dataIdx]) ? cells[dataIdx].trim() : '';
        const isoMatch = data.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) {
            data = `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
        }

        let ora = (oraIdx >= 0 && cells[oraIdx]) ? cells[oraIdx].trim() : '';
        if (ora.length === 4 && ora.includes(':')) {
            ora = '0' + ora;
        }

        let squadre = (squadreIdx >= 0 && cells[squadreIdx]) ? cells[squadreIdx].trim() : '';
        if (!squadre && isHeader) {
            const casaIdx = findIdx(['casa', 'home']);
            const trasIdx = findIdx(['trasf', 'away', 'ospit']);
            if (casaIdx >= 0 && trasIdx >= 0 && (cells[casaIdx] || cells[trasIdx])) {
                squadre = `${cells[casaIdx] || ''} - ${cells[trasIdx] || ''}`.trim();
            }
        }

        if (!data && !squadre) continue;

        const categoria = (catIdx >= 0 && cells[catIdx]) ? cells[catIdx].trim() : '';
        const km = (kmIdx >= 0 && cells[kmIdx]) ? Number(cells[kmIdx].replace(',', '.')) || 0 : 0;
        const rimborso = (rimborsoIdx >= 0 && cells[rimborsoIdx]) ? Number(cells[rimborsoIdx].replace(',', '.')) || 0 : 0;
        
        let pagata = false;
        if (pagataIdx >= 0 && cells[pagataIdx]) {
            const pText = normalizeText(cells[pagataIdx]);
            pagata = ['si', 'sì', 'yes', 'true', '1', 'pagata', 'pagato'].includes(pText);
        }

        const locationText = (locationIdx >= 0 && cells[locationIdx]) ? cells[locationIdx].trim() : '';
        const mapsUrl = (mapsIdx >= 0 && cells[mapsIdx]) ? cells[mapsIdx].trim() : '';

        const newEvento = normalizeDashboardEvent({
            data,
            ora,
            squadre,
            categoria,
            km,
            rimborso,
            pagata,
            locationText,
            mapsUrl
        });

        const fp = buildEventFingerprint(newEvento);
        const alreadyExists = dashboardEvents.some(e => buildEventFingerprint(e) === fp);
        if (alreadyExists) {
            duplicateCount++;
        } else {
            dashboardEvents.push(newEvento);
            addedCount++;
        }
    }

    if (addedCount > 0) {
        dashboardEvents = dedupeDashboardEvents(dashboardEvents);
        renderDashboardEvents();
        await persistDashboardEvents();
        scheduleAutoSyncRefereedMatches();
        const msg = duplicateCount > 0
            ? `Importate ${addedCount} nuove partite (${duplicateCount} duplicati saltati).`
            : `Importate con successo ${addedCount} partite!`;
        showDashboardToast(msg, 'ok');
    } else {
        showDashboardToast(duplicateCount > 0 ? 'Tutte le partite nel file risultano già presenti.' : 'Nessuna partita valida importata.', 'warn');
    }
}

function handleDashboardCsvFileSelect(event) {
    const file = event.target?.files?.[0];
    if (!file) {
        return;
    }
    const reader = new FileReader();
    reader.onload = async e => {
        const content = String(e.target?.result || '');
        await importDashboardEventsFromCsv(content);
        event.target.value = '';
    };
    reader.onerror = () => {
        showDashboardToast('Errore lettura file CSV.', 'err');
        event.target.value = '';
    };
    reader.readAsText(file, 'utf-8');
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
            const normalizedList = list.map(normalizeDashboardEvent);
            const needsCleanupSave = list.some((orig, idx) => String(orig?.locationText || '') !== String(normalizedList[idx]?.locationText || ''));
            dashboardEvents = dedupeDashboardEvents(normalizedList);
            renderDashboardEvents();
            if (needsCleanupSave) {
                persistDashboardEvents();
            }
            scheduleAutoSyncRefereedMatches();
            return;
        } catch (error) {
            console.warn('Errore lettura cloud dashboard:', error.message);
        }
    }

    try {
        const raw = JSON.parse(localStorage.getItem(GUEST_EVENTS_STORAGE_KEY) || '[]');
        const list = Array.isArray(raw) ? raw : [];
        const normalizedList = list.map(normalizeDashboardEvent);
        const needsCleanupSave = list.some((orig, idx) => String(orig?.locationText || '') !== String(normalizedList[idx]?.locationText || ''));
        dashboardEvents = dedupeDashboardEvents(normalizedList);
        if (needsCleanupSave) {
            localStorage.setItem(GUEST_EVENTS_STORAGE_KEY, JSON.stringify(dashboardEvents));
        }
    } catch (error) {
        dashboardEvents = [];
    }
    renderDashboardEvents();
    scheduleAutoSyncRefereedMatches();
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
        scheduleAutoSyncRefereedMatches();
        return;
    }

    dashboardEvents.push(normalizeDashboardEvent(evento));
    dashboardEvents = dedupeDashboardEvents(dashboardEvents);
    renderDashboardEvents();
    await persistDashboardEvents();
    await autoSuggestFieldFromDesignazione(evento);
    scheduleAutoSyncRefereedMatches(150);
    textarea.value = '';
    showDashboardToast('Partita aggiunta con successo!', 'ok');
}

async function incollaEAggiungiEvento() {
    const textarea = document.getElementById('designazione');
    if (!textarea) {
        return;
    }
    if (!navigator.clipboard?.readText) {
        showDashboardToast('Incolla il testo nel riquadro e premi Aggiungi Evento.', 'warn');
        textarea.focus();
        return;
    }
    try {
        const clipText = await navigator.clipboard.readText();
        if (!String(clipText || '').trim()) {
            showDashboardToast('Appunti vuoti: copia prima la designazione da Sinfonia4You o email.', 'warn');
            return;
        }
        textarea.value = clipText;
        await aggiungiEvento();
    } catch {
        showDashboardToast('Permesso appunti non concesso: incolla nel riquadro e premi Aggiungi.', 'warn');
        textarea.focus();
    }
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
const NEWS_CACHE_STORAGE_KEY = 'matchmap_news_cache_v1';
let newsDb = [];
let preferredNewsRegion = 'all';
let newsFilterManuallyChanged = false;
let setNewsRegionSelection = null;
let newsRealtimeBound = false;

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
        const cached = JSON.parse(localStorage.getItem(NEWS_CACHE_STORAGE_KEY) || '[]');
        if (Array.isArray(cached) && cached.length && !newsDb.length) {
            newsDb = normalizeNewsPayload(cached);
        }
    } catch {}

    try {
        const fb = window.matchMapFirebase;
        if (fb?.ready && fb.db && !newsRealtimeBound) {
            newsRealtimeBound = true;
            fb.db.ref('news').on('value', snap => {
                const raw = snap.exists() ? snap.val() : [];
                const list = Array.isArray(raw) ? raw : Object.values(raw || {});
                newsDb = normalizeNewsPayload(list);
                try {
                    localStorage.setItem(NEWS_CACHE_STORAGE_KEY, JSON.stringify(newsDb));
                } catch {}
                setupNewsRegionFilter();
                applyPreferredNewsRegion(false);
            });
        }
        const firebaseNews = await loadNewsFromFirebase();
        if (firebaseNews) {
            newsDb = normalizeNewsPayload(firebaseNews);
            try {
                localStorage.setItem(NEWS_CACHE_STORAGE_KEY, JSON.stringify(newsDb));
            } catch {}
            return;
        }
    } catch (error) {
        if (!newsDb.length) {
            newsDb = [];
        }
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
                <h4>${escapeHtml(item.titolo)}</h4>
            </div>
            <p><strong>${escapeHtml(item.regione)}:</strong> ${escapeHtml(item.testo)}</p>
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

const PAYMENTS_CACHE_STORAGE_KEY = 'matchmap_payments_cache_v1';
let paymentsRealtimeBound = false;

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
        const cached = JSON.parse(localStorage.getItem(PAYMENTS_CACHE_STORAGE_KEY) || 'null');
        if (cached && !paymentsDb.length) {
            const normalized = normalizePaymentsPayload(cached);
            paymentsDb = Array.isArray(normalized.items) ? normalized.items : [];
            paymentsColumns = normalized.columns || paymentsColumns;
        }
    } catch {}

    try {
        const fb = window.matchMapFirebase;
        if (fb?.ready && fb.db && !paymentsRealtimeBound) {
            paymentsRealtimeBound = true;
            fb.db.ref('pagamenti').on('value', snap => {
                const raw = snap.exists() ? snap.val() : [];
                const normalized = normalizePaymentsPayload(raw);
                paymentsDb = Array.isArray(normalized.items) ? normalized.items : [];
                paymentsColumns = normalized.columns || paymentsColumns;
                try {
                    localStorage.setItem(PAYMENTS_CACHE_STORAGE_KEY, JSON.stringify({ items: paymentsDb, columns: paymentsColumns }));
                } catch {}
                renderPaymentsTable();
            });
        }
        const firebasePayments = await loadPaymentsFromFirebase();
        if (firebasePayments) {
            const normalized = normalizePaymentsPayload(firebasePayments);
            paymentsDb = Array.isArray(normalized.items) ? normalized.items : [];
            paymentsColumns = normalized.columns || paymentsColumns;
            try {
                localStorage.setItem(PAYMENTS_CACHE_STORAGE_KEY, JSON.stringify({ items: paymentsDb, columns: paymentsColumns }));
            } catch {}
            return;
        }
    } catch (error) {
        if (!paymentsDb.length) {
            paymentsDb = [];
        }
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
            { label: paymentsColumns.regione || 'Regione', value: escapeHtml(item.regione || '-'), className: 'pay-cell-region' },
            { label: paymentsColumns.inPagamento || 'Pacchi in pagamento', value: escapeHtml(item.inPagamento || '-'), className: 'pay-cell-num' },
            { label: paymentsColumns.fineFebbraio || 'Fine febbraio', value: escapeHtml(item.fineFebbraio || '-'), className: 'pay-cell-num' }
        ];
        if (hasAnyChatValue) {
            cells.push({
                label: paymentsColumns.chat || 'Riscontro chat',
                value: escapeHtml(item.chat || '-'),
                className: 'pay-cell-chat'
            });
        }
        cells.push({
            label: paymentsColumns.stato || 'Stato',
            value: `<span class="payments-status-badge ${statusBadgeClass}">${escapeHtml(statoText)}</span>`,
            className: 'pay-cell-status'
        });

        row.innerHTML = cells
            .map(cell => `<td data-label="${escapeHtml(cell.label)}" class="${cell.className || ''}">${cell.value}</td>`)
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
            await persistRepairedLuoghiIfNeeded();
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

    const setPopoverOpen = isOpen => {
        popover.hidden = !isOpen;
        toggleBtn.setAttribute('aria-expanded', String(isOpen));
    };

    toggleBtn.addEventListener('click', event => {
        event.stopPropagation();
        setPopoverOpen(popover.hidden);
    });

    popover.addEventListener('click', event => {
        event.stopPropagation();
        const target = event.target;
        if (target && target.tagName === 'A') {
            setPopoverOpen(false);
        }
    });

    document.addEventListener('click', () => {
        setPopoverOpen(false);
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !popover.hidden) {
            setPopoverOpen(false);
        }
    });
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
window.incollaEAggiungiEvento = incollaEAggiungiEvento;
window.autoSyncMapAndLogosFromRefereedMatches = autoSyncMapAndLogosFromRefereedMatches;

const dashboardSearchInput = document.getElementById('dashboardSearchInput');
if (dashboardSearchInput) {
    dashboardSearchInput.addEventListener('input', debounce(() => {
        dashboardEventSearchQuery = dashboardSearchInput.value.trim();
        renderDashboardEvents();
    }, 90));
}

const suggestMapsInput = document.getElementById('suggestMaps');
if (suggestMapsInput) {
    suggestMapsInput.addEventListener('input', debounce(() => {
        const val = suggestMapsInput.value.trim();
        if (!val) {
            return;
        }
        const coords = extractCoordinatesFromMapsUrl(val);
        if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
            setSuggestionStatus(`✓ Coordinate rilevate automaticamente dal link Maps (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}).`, true);
        } else if (/^https?:\/\//i.test(val)) {
            setSuggestionStatus('Link Maps valido inserito. Compila titolo, squadra e descrizione per inviare.', true);
        }
    }, 150));
}

const mapQuickSearchInput = document.getElementById('mapQuickSearchInput');
const mapQuickSearchSuggestions = document.getElementById('mapQuickSearchSuggestions');
const dashboardShowMoreBtn = document.getElementById('dashboardShowMoreBtn');
if (dashboardShowMoreBtn) {
    dashboardShowMoreBtn.addEventListener('click', toggleDashboardShowMore);
}
if (mapQuickSearchInput) {
    const debouncedMapSuggestions = debounce(() => {
        renderMapSearchSuggestions();
    }, 180);
    mapQuickSearchInput.addEventListener('input', debouncedMapSuggestions);
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

// Precarica Leaflet in background durante i tempi morti per apertura mappa istantanea
if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => {
        ensureLeafletLoaded().catch(() => {});
    }, { timeout: 3500 });
} else {
    setTimeout(() => {
        ensureLeafletLoaded().catch(() => {});
    }, 2800);
}

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

