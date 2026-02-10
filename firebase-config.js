// ==========================================
// FIREBASE CONFIGURATION & INITIALIZATION
// ==========================================

const firebaseConfig = {
    apiKey: "AIzaSyD3lgHO_VLUog6KrvSSJ6ZSyKzBxaA9ks0",
    authDomain: "goldenthreads-ims.firebaseapp.com",
    projectId: "goldenthreads-ims",
    storageBucket: "goldenthreads-ims.firebasestorage.app",
    messagingSenderId: "165141018848",
    appId: "1:165141018848:web:ffc8ca84ca30a06320b885",
    measurementId: "G-ZDFTMTFN7W"
};

// Initialize Firebase App
let firebaseInitialized = false;

function initializeFirebaseSDK() {
    if (firebaseInitialized) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const checkFirebase = () => {
            // Check if Firebase SDK is available
            if (typeof firebase === 'undefined' || !firebase.initializeApp) {
                console.log('⏳ Waiting for Firebase SDK to load from CDN...');
                setTimeout(checkFirebase, 100);
                return;
            }

            try {
                console.log('✓ Firebase SDK detected, initializing...');

                // Initialize Firebase only if not already initialized
                if (!firebase.apps || firebase.apps.length === 0) {
                    firebase.initializeApp(firebaseConfig);
                    console.log('✓ Firebase app initialized with config');
                } else {
                    console.log('✓ Firebase app already initialized');
                }

                // Verify Firebase modules are available
                if (!firebase.auth || typeof firebase.auth !== 'function') {
                    throw new Error('Firebase auth module not available');
                }
                if (!firebase.firestore || typeof firebase.firestore !== 'function') {
                    throw new Error('Firebase firestore module not available');
                }
                if (!firebase.storage || typeof firebase.storage !== 'function') {
                    throw new Error('Firebase storage module not available');
                }

                // Get references to Firebase services (attach to window for global access)
                window.auth = firebase.auth();
                window.db = firebase.firestore();
                window.storage = firebase.storage();

                console.log('✓ Firebase Auth, Firestore, and Storage services obtained');

                // Set Firestore settings and enable caching/persistence in a forward-compatible way
                try {
                    if (!window._firestoreSettingsApplied) {
                        const baseSettings = {
                            cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED
                        };

                        // Try the newer `cache`/settings approach first (may exist on newer SDKs)
                        try {
                            const newSettings = Object.assign({}, baseSettings, { cache: { tabSynchronization: true }, merge: true });
                            window.db.settings(newSettings);
                            console.log('✓ Firestore settings configured (new cache settings)');
                        } catch (newApiError) {
                            // If the newer API isn't supported, fall back to the previous approach
                            try {
                                // include merge:true to avoid unintentionally overriding existing settings
                                const fallbackSettings = Object.assign({}, baseSettings, { merge: true });
                                window.db.settings(fallbackSettings);
                                if (typeof window.db.enablePersistence === 'function') {
                                    window.db.enablePersistence().catch((err) => {
                                        if (err && err.code == 'failed-precondition') {
                                            console.log('ℹ️ Multiple tabs open - offline persistence disabled on this tab');
                                        } else if (err && err.code == 'unimplemented') {
                                            console.log('ℹ️ Browser does not support offline persistence');
                                        } else {
                                            console.warn('⚠️ Firestore persistence error:', err && err.message);
                                        }
                                    });
                                }
                                console.log('✓ Firestore settings configured (fallback)');
                            } catch (fallbackErr) {
                                console.warn('⚠️ Could not configure Firestore settings (fallback):', fallbackErr.message);
                            }
                        }

                        window._firestoreSettingsApplied = true;
                    } else {
                        console.log('ℹ️ Firestore settings already applied; skipping');
                    }
                } catch (settingsError) {
                    console.warn('⚠️ Could not configure Firestore settings:', settingsError.message);
                }

                firebaseInitialized = true;
                console.log('%c✓✓✓ Firebase & Firestore Ready! ✓✓✓', 'color: #27AE60; font-size: 14px; font-weight: bold;');
                resolve();
            } catch (error) {
                console.error('❌ Firebase initialization error:', error.message);
                reject(error);
            }
        };

        // Start checking for Firebase availability
        checkFirebase();
    });
}

// Start initialization when this script loads
console.log('🔧 Firebase configuration module loaded');
initializeFirebaseSDK().catch(error => {
    console.error('❌ Firebase initialization failed:', error.message);
    console.warn('⚠️ The app may not work correctly without Firebase');
    console.warn('⚠️ Possible causes:');
    console.warn('   - Internet connection issue');
    console.warn('   - Firebase CDN is blocked (firewall/proxy)');
    console.warn('   - Browser security settings');
});
