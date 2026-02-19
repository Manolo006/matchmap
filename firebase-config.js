// Shared Firebase bootstrap for static pages (index + publisher).
(function () {
    // For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBCywez534t4m6czoTvMvrzzJsFotUJmiY",
  authDomain: "matchmap-6a917.firebaseapp.com",
  databaseURL: "https://matchmap-6a917-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "matchmap-6a917",
  storageBucket: "matchmap-6a917.firebasestorage.app",
  messagingSenderId: "529154650199",
  appId: "1:529154650199:web:86314bf9e8694967763312",
  measurementId: "G-NSTT9VLT18"
};

    const state = {
        ready: false,
        app: null,
        db: null,
        auth: null,
        error: null
    };

    try {
        if (!window.firebase) {
            throw new Error("Firebase SDK non caricato.");
        }

        state.app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
        state.db = firebase.database();
        state.auth = firebase.auth();
        state.ready = true;
    } catch (error) {
        state.error = error;
        state.ready = false;
        console.warn("Firebase init failed:", error.message);
    }

    window.matchMapFirebase = state;
})();
