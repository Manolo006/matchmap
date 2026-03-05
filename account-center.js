(function () {
    const fb = window.matchMapFirebase || {};
    const MAX_AVATAR_DATAURL_LEN = 350000;
    const PREFERRED_REGION_OPTIONS = [
        'all',
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

    const el = {
        authEmail: document.getElementById('authEmail'),
        authPassword: document.getElementById('authPassword'),
        registerBtn: document.getElementById('registerBtn'),
        loginBtn: document.getElementById('loginBtn'),
        logoutBtn: document.getElementById('logoutBtn'),
        authStatus: document.getElementById('authStatus'),
        accountInfo: document.getElementById('accountInfo'),
        resetEmailInput: document.getElementById('resetEmailInput'),
        newEmailInput: document.getElementById('newEmailInput'),
        sendResetBtn: document.getElementById('sendResetBtn'),
        changeEmailBtn: document.getElementById('changeEmailBtn'),
        deleteAccountBtn: document.getElementById('deleteAccountBtn'),
        emailStatus: document.getElementById('emailStatus'),
        profileAvatarPreview: document.getElementById('profileAvatarPreview'),
        profileImageFile: document.getElementById('profileImageFile'),
        profileImageUrlInput: document.getElementById('profileImageUrlInput'),
        preferredRegionInput: document.getElementById('preferredRegionInput'),
        preferredRegionCustom: document.getElementById('preferredRegionCustom'),
        preferredRegionToggle: document.getElementById('preferredRegionToggle'),
        preferredRegionMenu: document.getElementById('preferredRegionMenu'),
        preferredRegionLabel: document.getElementById('preferredRegionLabel'),
        preferredRegionLogo: document.getElementById('preferredRegionLogo'),
        nicknameInput: document.getElementById('nicknameInput'),
        saveProfileBtn: document.getElementById('saveProfileBtn'),
        removeAvatarBtn: document.getElementById('removeAvatarBtn'),
        profileStatus: document.getElementById('profileStatus')
    };

    let uploadedAvatarDataUrl = '';
    let loadedProfile = { nickname: '', avatarUrl: '', preferredRegion: 'all' };
    let setPreferredRegionSelection = null;

    function setStatus(node, message, kind) {
        if (!node) return;
        node.textContent = message || '';
        node.classList.remove('ok', 'error');
        if (kind) node.classList.add(kind);
    }

    function normalizeError(error) {
        if (!error) return 'Errore sconosciuto.';
        if (error.code) return error.code + ': ' + (error.message || '');
        return error.message || String(error);
    }

    function getUser() {
        return fb?.ready && fb.auth ? fb.auth.currentUser : null;
    }

    function getProfileRef(uid) {
        if (!fb?.ready || !fb.db || !uid) {
            return null;
        }
        return fb.db.ref('users/' + uid + '/profile');
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

    function normalizePreferredRegion(value) {
        const normalizedInput = normalizeText(value);
        if (!normalizedInput || normalizedInput === 'all' || normalizedInput === 'tutte le regioni') {
            return 'all';
        }
        const match = PREFERRED_REGION_OPTIONS.find(option => normalizeText(option) === normalizedInput);
        return match || 'all';
    }

    function getRegionLogoPath(regionName) {
        const region = normalizeText(regionName);
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
        return regionLogoMap[region] || '';
    }

    function populatePreferredRegionOptions() {
        if (!el.preferredRegionInput || !el.preferredRegionCustom || !el.preferredRegionToggle || !el.preferredRegionMenu || !el.preferredRegionLabel || !el.preferredRegionLogo) {
            return;
        }

        el.preferredRegionInput.innerHTML = '';
        const options = PREFERRED_REGION_OPTIONS.map(region => ({
            value: region,
            label: region === 'all' ? 'Tutte le regioni (default)' : region,
            logo: region === 'all' ? '' : getRegionLogoPath(region)
        }));

        options.forEach(region => {
            const option = document.createElement('option');
            option.value = region.value;
            option.textContent = region.label;
            el.preferredRegionInput.appendChild(option);
        });

        const closeMenu = () => {
            el.preferredRegionMenu.hidden = true;
            el.preferredRegionToggle.setAttribute('aria-expanded', 'false');
        };
        const openMenu = () => {
            el.preferredRegionMenu.hidden = false;
            el.preferredRegionToggle.setAttribute('aria-expanded', 'true');
        };
        const setSelection = value => {
            const normalizedValue = normalizePreferredRegion(value);
            const selected = options.find(item => normalizePreferredRegion(item.value) === normalizedValue) || options[0];
            el.preferredRegionInput.value = selected.value;
            el.preferredRegionLabel.textContent = selected.label;
            if (selected.logo) {
                el.preferredRegionLogo.src = selected.logo;
                el.preferredRegionLogo.alt = `Logo ${selected.label}`;
                el.preferredRegionLogo.hidden = false;
            } else {
                el.preferredRegionLogo.hidden = true;
                el.preferredRegionLogo.removeAttribute('src');
                el.preferredRegionLogo.alt = '';
            }
            el.preferredRegionMenu.querySelectorAll('.pref-region-option').forEach(btn => {
                const isActive = btn.getAttribute('data-value') === selected.value;
                btn.classList.toggle('is-active', isActive);
            });
        };

        el.preferredRegionMenu.innerHTML = options.map(item => {
            const logoMarkup = item.logo
                ? `<img class="pref-region-logo" src="${item.logo}" alt="" loading="lazy" decoding="async">`
                : '';
            return `
                <button type="button" class="pref-region-option" data-value="${item.value}" role="option">
                    ${logoMarkup}
                    <span>${item.label}</span>
                </button>
            `;
        }).join('');

        el.preferredRegionToggle.onclick = event => {
            event.stopPropagation();
            if (el.preferredRegionMenu.hidden) {
                openMenu();
            } else {
                closeMenu();
            }
        };

        el.preferredRegionMenu.onclick = event => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }
            const btn = target.closest('.pref-region-option');
            if (!btn) {
                return;
            }
            const value = btn.getAttribute('data-value') || 'all';
            setSelection(value);
            closeMenu();
        };

        document.addEventListener('click', event => {
            if (!el.preferredRegionCustom.contains(event.target)) {
                closeMenu();
            }
        });

        setPreferredRegionSelection = setSelection;
        setSelection('all');
    }

    function isDataUrlImage(value) {
        return /^data:image\//i.test(String(value || ''));
    }

    function isHttpUrl(value) {
        return /^https?:\/\//i.test(String(value || '').trim());
    }

    function resolveAvatarUrl(profile, user) {
        const profileAvatar = String(profile?.avatarUrl || '').trim();
        if (profileAvatar && (isHttpUrl(profileAvatar) || isDataUrlImage(profileAvatar))) {
            return profileAvatar;
        }
        const userAvatar = String(user?.photoURL || '').trim();
        if (userAvatar && isHttpUrl(userAvatar)) {
            return userAvatar;
        }
        return 'img/logo.png';
    }

    function renderAuthControls(user) {
        const logged = Boolean(user);
        el.registerBtn.hidden = logged;
        el.loginBtn.hidden = logged;
        el.logoutBtn.hidden = !logged;
    }

    function renderAccountInfo(user, profile) {
        if (!user) {
            el.accountInfo.innerHTML = '<b>Stato</b><span>Non autenticato</span>';
            return;
        }

        const nickname = String(profile?.nickname || user.displayName || '-').trim() || '-';
        const preferredRegion = normalizePreferredRegion(profile?.preferredRegion);
        const avatar = String(profile?.avatarUrl || user.photoURL || '-').trim() || '-';
        el.accountInfo.innerHTML = [
            ['Email', user.email || '-'],
            ['Nickname', nickname],
            ['Regione preferita news', preferredRegion === 'all' ? 'Tutte le regioni' : preferredRegion],
            ['Avatar', avatar === '-' ? '-' : 'Impostato'],
            ['Creato', user.metadata?.creationTime || '-'],
            ['Ultimo accesso', user.metadata?.lastSignInTime || '-']
        ].map(row => '<b>' + row[0] + '</b><span>' + row[1] + '</span>').join('');
    }

    async function loadProfile(user) {
        uploadedAvatarDataUrl = '';
        loadedProfile = { nickname: '', avatarUrl: '', preferredRegion: 'all' };

        if (!user) {
            el.nicknameInput.value = '';
            el.profileImageUrlInput.value = '';
            if (setPreferredRegionSelection) {
                setPreferredRegionSelection('all');
            } else if (el.preferredRegionInput) {
                el.preferredRegionInput.value = 'all';
            }
            el.profileAvatarPreview.src = 'img/logo.png';
            return;
        }

        let profile = {};
        try {
            const ref = getProfileRef(user.uid);
            if (ref) {
                const snap = await ref.once('value');
                if (snap.exists()) {
                    profile = snap.val() || {};
                }
            }
        } catch (error) {
            setStatus(el.profileStatus, 'Profilo non caricato: ' + normalizeError(error), 'error');
        }

        const nickname = String(profile.nickname || user.displayName || '').trim();
        const avatarUrl = String(profile.avatarUrl || user.photoURL || '').trim();
        const preferredRegion = normalizePreferredRegion(profile.preferredRegion);

        loadedProfile = { nickname, avatarUrl, preferredRegion };
        el.nicknameInput.value = nickname;
        if (setPreferredRegionSelection) {
            setPreferredRegionSelection(preferredRegion);
        } else if (el.preferredRegionInput) {
            el.preferredRegionInput.value = preferredRegion;
        }
        el.profileImageUrlInput.value = isHttpUrl(avatarUrl) ? avatarUrl : '';
        el.profileAvatarPreview.src = resolveAvatarUrl(profile, user);

        if (!el.resetEmailInput.value) {
            el.resetEmailInput.value = user.email || '';
        }
        el.authEmail.value = user.email || '';
        renderAccountInfo(user, { nickname, avatarUrl, preferredRegion });
    }

    function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Lettura file fallita.'));
            reader.readAsDataURL(file);
        });
    }

    function trimTransparentPadding(dataUrl) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                try {
                    const srcW = img.naturalWidth || img.width;
                    const srcH = img.naturalHeight || img.height;
                    if (!srcW || !srcH) {
                        resolve(dataUrl);
                        return;
                    }

                    const srcCanvas = document.createElement('canvas');
                    srcCanvas.width = srcW;
                    srcCanvas.height = srcH;
                    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
                    if (!srcCtx) {
                        resolve(dataUrl);
                        return;
                    }
                    srcCtx.drawImage(img, 0, 0);
                    const pixels = srcCtx.getImageData(0, 0, srcW, srcH).data;

                    let minX = srcW;
                    let minY = srcH;
                    let maxX = -1;
                    let maxY = -1;

                    for (let y = 0; y < srcH; y++) {
                        for (let x = 0; x < srcW; x++) {
                            const alpha = pixels[(y * srcW + x) * 4 + 3];
                            if (alpha > 10) {
                                if (x < minX) minX = x;
                                if (y < minY) minY = y;
                                if (x > maxX) maxX = x;
                                if (y > maxY) maxY = y;
                            }
                        }
                    }

                    if (maxX < minX || maxY < minY) {
                        resolve(dataUrl);
                        return;
                    }

                    const contentW = maxX - minX + 1;
                    const contentH = maxY - minY + 1;
                    const side = Math.max(contentW, contentH);
                    const pad = Math.max(2, Math.round(side * 0.05));
                    const outSide = side + pad * 2;

                    const outCanvas = document.createElement('canvas');
                    outCanvas.width = outSide;
                    outCanvas.height = outSide;
                    const outCtx = outCanvas.getContext('2d');
                    if (!outCtx) {
                        resolve(dataUrl);
                        return;
                    }

                    const dx = Math.round((outSide - contentW) / 2);
                    const dy = Math.round((outSide - contentH) / 2);
                    outCtx.drawImage(srcCanvas, minX, minY, contentW, contentH, dx, dy, contentW, contentH);
                    resolve(outCanvas.toDataURL('image/png'));
                } catch {
                    resolve(dataUrl);
                }
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
        });
    }

    async function handleAvatarFileChange() {
        const file = el.profileImageFile.files && el.profileImageFile.files[0];
        if (!file) {
            return;
        }
        if (!String(file.type || '').startsWith('image/')) {
            setStatus(el.profileStatus, 'Seleziona un file immagine valido.', 'error');
            return;
        }
        try {
            const dataUrl = await fileToDataUrl(file);
            const processedDataUrl = await trimTransparentPadding(dataUrl);
            if (processedDataUrl.length > MAX_AVATAR_DATAURL_LEN) {
                setStatus(el.profileStatus, 'Immagine troppo grande. Usa un file piu leggero.', 'error');
                return;
            }
            uploadedAvatarDataUrl = processedDataUrl;
            el.profileImageUrlInput.value = '';
            el.profileAvatarPreview.src = processedDataUrl;
            setStatus(el.profileStatus, 'Immagine pronta. Premi Salva Profilo.', 'ok');
        } catch (error) {
            setStatus(el.profileStatus, 'Upload immagine fallito: ' + normalizeError(error), 'error');
        }
    }

    function removeAvatarDraft() {
        uploadedAvatarDataUrl = '';
        el.profileImageFile.value = '';
        el.profileImageUrlInput.value = '';
        el.profileAvatarPreview.src = 'img/logo.png';
        setStatus(el.profileStatus, 'Immagine rimossa. Premi Salva Profilo per confermare.', 'ok');
    }

    async function saveProfile() {
        const user = getUser();
        if (!user) {
            setStatus(el.profileStatus, 'Devi fare login per modificare il profilo.', 'error');
            return;
        }

        const nickname = String(el.nicknameInput.value || '').trim().slice(0, 40);
        const preferredRegion = normalizePreferredRegion(el.preferredRegionInput?.value);
        const typedUrl = String(el.profileImageUrlInput.value || '').trim();
        let avatarUrl = '';
        if (uploadedAvatarDataUrl) {
            avatarUrl = uploadedAvatarDataUrl;
        } else if (typedUrl && isHttpUrl(typedUrl)) {
            avatarUrl = typedUrl;
        } else if (loadedProfile.avatarUrl) {
            avatarUrl = loadedProfile.avatarUrl;
        }

        if (typedUrl && !isHttpUrl(typedUrl) && !uploadedAvatarDataUrl) {
            setStatus(el.profileStatus, 'URL immagine non valido. Usa un link https://', 'error');
            return;
        }

        const payload = {
            nickname,
            avatarUrl,
            preferredRegion,
            updatedAt: Date.now()
        };

        try {
            const ref = getProfileRef(user.uid);
            if (ref) {
                await ref.set(payload);
            }

            await user.updateProfile({
                displayName: nickname || null,
                photoURL: avatarUrl || null
            }).catch(() => {});
            await user.reload().catch(() => {});

            loadedProfile = { nickname, avatarUrl, preferredRegion };
            uploadedAvatarDataUrl = '';
            el.profileImageFile.value = '';
            el.profileAvatarPreview.src = resolveAvatarUrl(payload, getUser() || user);
            renderAccountInfo(getUser() || user, payload);
            setStatus(el.profileStatus, 'Profilo aggiornato.', 'ok');
        } catch (error) {
            setStatus(el.profileStatus, 'Salvataggio profilo fallito: ' + normalizeError(error), 'error');
        }
    }

    async function register() {
        if (!fb.auth) {
            setStatus(el.authStatus, 'Firebase non inizializzato.', 'error');
            return;
        }

        const email = el.authEmail.value.trim();
        const password = el.authPassword.value;
        if (!email || !password) {
            setStatus(el.authStatus, 'Inserisci email e password.', 'error');
            return;
        }

        try {
            await fb.auth.createUserWithEmailAndPassword(email, password);
            setStatus(el.authStatus, 'Registrazione completata.', 'ok');
            el.authPassword.value = '';
        } catch (error) {
            setStatus(el.authStatus, 'Registrazione fallita: ' + normalizeError(error), 'error');
        }
    }

    async function login() {
        if (!fb.auth) {
            setStatus(el.authStatus, 'Firebase non inizializzato.', 'error');
            return;
        }

        const email = el.authEmail.value.trim();
        const password = el.authPassword.value;
        if (!email || !password) {
            setStatus(el.authStatus, 'Inserisci email e password.', 'error');
            return;
        }

        try {
            await fb.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            await fb.auth.signInWithEmailAndPassword(email, password);
            setStatus(el.authStatus, 'Login effettuato.', 'ok');
            el.authPassword.value = '';
        } catch (error) {
            setStatus(el.authStatus, 'Login fallito: ' + normalizeError(error), 'error');
        }
    }

    async function logout() {
        if (!fb.auth) return;
        try {
            await fb.auth.signOut();
            setStatus(el.authStatus, 'Logout effettuato.', 'ok');
            setStatus(el.emailStatus, '');
            setStatus(el.profileStatus, 'Sessione chiusa.');
        } catch (error) {
            setStatus(el.authStatus, 'Logout fallito: ' + normalizeError(error), 'error');
        }
    }

    async function sendReset() {
        if (!fb.auth) {
            setStatus(el.emailStatus, 'Firebase non inizializzato.', 'error');
            return;
        }

        const email = el.resetEmailInput.value.trim();
        if (!email) {
            setStatus(el.emailStatus, 'Inserisci email per reset password.', 'error');
            return;
        }

        try {
            fb.auth.languageCode = 'it';
            await fb.auth.sendPasswordResetEmail(email);
            setStatus(el.emailStatus, 'Email reset inviata a ' + email + '.', 'ok');
        } catch (error) {
            setStatus(el.emailStatus, 'Invio reset fallito: ' + normalizeError(error), 'error');
        }
    }

    async function changeEmail() {
        const user = getUser();
        if (!user) {
            setStatus(el.emailStatus, 'Login richiesto per cambiare email.', 'error');
            return;
        }

        const newEmail = el.newEmailInput.value.trim();
        const currentPassword = window.prompt('Inserisci la password attuale per confermare il cambio email:') || '';
        if (!newEmail || !currentPassword) {
            setStatus(el.emailStatus, 'Nuova email o password attuale mancanti.', 'error');
            return;
        }

        try {
            const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
            await user.reauthenticateWithCredential(credential);
            await user.updateEmail(newEmail);
            await user.reload();
            await loadProfile(getUser());
            setStatus(el.emailStatus, 'Email aggiornata.', 'ok');
        } catch (error) {
            setStatus(el.emailStatus, 'Cambio email fallito: ' + normalizeError(error), 'error');
        }
    }

    async function deleteAccount() {
        const user = getUser();
        if (!user) {
            setStatus(el.emailStatus, 'Login richiesto per eliminare account.', 'error');
            return;
        }

        if (!window.confirm('Vuoi davvero eliminare il tuo account? Operazione irreversibile.')) return;
        if (!window.confirm('Conferma finale: eliminare definitivamente account e accesso?')) return;

        try {
            await user.delete();
            setStatus(el.emailStatus, 'Account eliminato correttamente.', 'ok');
        } catch (error) {
            if (error && error.code === 'auth/requires-recent-login') {
                const currentPassword = window.prompt('Inserisci la password attuale per confermare:') || '';
                if (!currentPassword) {
                    setStatus(el.emailStatus, 'Eliminazione annullata: password non inserita.', 'error');
                    return;
                }
                try {
                    const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
                    await user.reauthenticateWithCredential(credential);
                    await user.delete();
                    setStatus(el.emailStatus, 'Account eliminato correttamente.', 'ok');
                } catch (secondError) {
                    setStatus(el.emailStatus, 'Eliminazione account fallita: ' + normalizeError(secondError), 'error');
                }
                return;
            }
            setStatus(el.emailStatus, 'Eliminazione account fallita: ' + normalizeError(error), 'error');
        }
    }

    function bindEvents() {
        el.registerBtn.addEventListener('click', register);
        el.loginBtn.addEventListener('click', login);
        el.logoutBtn.addEventListener('click', logout);
        el.sendResetBtn.addEventListener('click', sendReset);
        el.changeEmailBtn.addEventListener('click', changeEmail);
        el.deleteAccountBtn.addEventListener('click', deleteAccount);
        el.saveProfileBtn.addEventListener('click', saveProfile);
        el.removeAvatarBtn.addEventListener('click', removeAvatarDraft);
        el.profileImageFile.addEventListener('change', handleAvatarFileChange);
        el.profileImageUrlInput.addEventListener('input', () => {
            const raw = String(el.profileImageUrlInput.value || '').trim();
            uploadedAvatarDataUrl = '';
            if (isHttpUrl(raw)) {
                el.profileAvatarPreview.src = raw;
            } else if (!raw) {
                el.profileAvatarPreview.src = loadedProfile.avatarUrl || 'img/logo.png';
            }
        });
    }

    function init() {
        populatePreferredRegionOptions();
        bindEvents();

        if (!fb.ready || !fb.auth) {
            setStatus(el.authStatus, 'Firebase non inizializzato.', 'error');
            renderAuthControls(null);
            renderAccountInfo(null, {});
            return;
        }

        fb.auth.onAuthStateChanged(async user => {
            renderAuthControls(user);
            if (user) {
                setStatus(el.authStatus, 'Connesso come ' + (user.email || user.uid), 'ok');
                await loadProfile(user);
            } else {
                setStatus(el.authStatus, 'Non autenticato.');
                await loadProfile(null);
            }
        });
    }

    init();
})();
