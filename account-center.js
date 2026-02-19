(function () {
    const fb = window.matchMapFirebase || {};

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
        emailStatus: document.getElementById('emailStatus')
    };

    function setStatus(node, message, kind) {
        node.textContent = message || '';
        node.classList.remove('ok', 'error');
        if (kind) node.classList.add(kind);
    }

    function normalizeError(error) {
        if (!error) return 'Errore sconosciuto.';
        if (error.code) return error.code + ': ' + (error.message || '');
        return error.message || String(error);
    }

    function renderUser(user) {
        if (!user) {
            el.accountInfo.innerHTML = '<b>Stato</b><span>Non autenticato</span>';
            return;
        }

        el.accountInfo.innerHTML = [
            ['Email', user.email || '-'],
            ['Display Name', user.displayName || '-'],
            ['Creato', user.metadata && user.metadata.creationTime ? user.metadata.creationTime : '-'],
            ['Ultimo accesso', user.metadata && user.metadata.lastSignInTime ? user.metadata.lastSignInTime : '-']
        ].map(function (row) {
            return '<b>' + row[0] + '</b><span>' + row[1] + '</span>';
        }).join('');

        el.authEmail.value = user.email || '';
        if (!el.resetEmailInput.value) {
            el.resetEmailInput.value = user.email || '';
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
            setStatus(el.emailStatus, 'Inserisci l\'email per reset.', 'error');
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
        const user = fb.auth && fb.auth.currentUser;
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
            renderUser(fb.auth.currentUser);
            setStatus(el.emailStatus, 'Email aggiornata.', 'ok');
        } catch (error) {
            setStatus(el.emailStatus, 'Cambio email fallito: ' + normalizeError(error), 'error');
        }
    }

    async function deleteAccount() {
        const user = fb.auth && fb.auth.currentUser;
        if (!user) {
            setStatus(el.emailStatus, 'Login richiesto per eliminare account.', 'error');
            return;
        }

        const firstConfirm = window.confirm('Vuoi davvero eliminare il tuo account? Operazione irreversibile.');
        if (!firstConfirm) return;

        const secondConfirm = window.confirm('Conferma finale: eliminare definitivamente account e accesso?');
        if (!secondConfirm) return;

        try {
            await user.delete();
            setStatus(el.emailStatus, 'Account eliminato correttamente.', 'ok');
        } catch (error) {
            if (error && error.code === 'auth/requires-recent-login') {
                const currentPassword = window.prompt('Per sicurezza, inserisci la password attuale:') || '';
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
    }

    function init() {
        bindEvents();

        if (!fb.ready || !fb.auth) {
            setStatus(el.authStatus, 'Firebase non inizializzato.', 'error');
            renderUser(null);
            return;
        }

        fb.auth.onAuthStateChanged(function (user) {
            renderUser(user);
            if (user) {
                setStatus(el.authStatus, 'Connesso come ' + (user.email || user.uid), 'ok');
            } else {
                setStatus(el.authStatus, 'Non autenticato.');
            }
        });
    }

    init();
})();
